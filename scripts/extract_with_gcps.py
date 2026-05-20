#!/usr/bin/env python3
"""Extract permanent closed-water polygons from ADF&G PDFs using user-clicked GCPs.

Improvements over v1:
  - Thin-plate-spline (TPS) transform instead of affine — passes through every GCP
    exactly, so the map doesn't drift between clicked points.
  - Main-map frame detected from the largest rectangular border on the page; only
    polygons inside that frame are kept (removes inset maps + legends + decoration).
  - Polygons with holes are reconstructed via even-odd fill rule so bays-with-
    islands render as solid water with holes, not "open cavities".
"""
import json
import sys
from pathlib import Path

import fitz
import numpy as np
from scipy.interpolate import RBFInterpolator
from shapely.geometry import Polygon, MultiPolygon, box, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

BASE = Path(__file__).resolve().parent.parent
PDF_DIR = BASE / 'docs' / 'closedwaters'
GCPS_FILE = BASE / 'data' / 'pdf_gcps.json'
OUT = BASE / 'data' / 'permanent_closed_waters.geojson'
PUBLIC_OUT = BASE / 'public' / 'static' / 'permanent_closed_waters.geojson'

GREY_TARGET = (78, 78, 78)
GREY_TOL = 8
MIN_AREA_SQDEG = 1e-6

DISTRICT_BY_PDF = {
    '212-200': 'Copper River District',
    '221': 'Eastern District',
    '222': 'Northern District',
    '223': 'Coghill District',
    '224': 'Northwestern District',
    '225': 'Eshamy District',
    '226': 'Southwestern District',
    '227': 'Montague District',
    '228': 'Southeastern District',
    '229': 'Unakwik District',
}


# ── colour test ──────────────────────────────────────────────────────────
def is_grey(rgb01):
    if rgb01 is None: return False
    r, g, b = (round(c * 255) for c in rgb01[:3])
    return all(abs(c - t) <= GREY_TOL for c, t in zip((r, g, b), GREY_TARGET))


# ── subpath → polygon with even-odd fill rule ────────────────────────────
def build_subpaths(items):
    """Walk a drawing's items list, emit a list of raw rings (list of (x,y))."""
    rings = []
    sub = []
    for it in items:
        op = it[0]
        if op == 'l':
            p1, p2 = it[1], it[2]
            if not sub: sub.append((p1.x, p1.y))
            sub.append((p2.x, p2.y))
        elif op == 'c':
            p1, p2, p3, p4 = it[1], it[2], it[3], it[4]
            if not sub: sub.append((p1.x, p1.y))
            for t in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0):
                bx = (1-t)**3*p1.x + 3*(1-t)**2*t*p2.x + 3*(1-t)*t**2*p3.x + t**3*p4.x
                by = (1-t)**3*p1.y + 3*(1-t)**2*t*p2.y + 3*(1-t)*t**2*p3.y + t**3*p4.y
                sub.append((bx, by))
        elif op == 're':
            r = it[1]
            rings.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)])
        elif op == 'qu':
            q = it[1]
            rings.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y), (q.ul.x, q.ul.y)])
        elif op == 'h':
            if sub:
                if sub[0] != sub[-1]: sub.append(sub[0])
                rings.append(sub)
                sub = []
    if sub:
        if sub[0] != sub[-1]: sub.append(sub[0])
        rings.append(sub)
    return rings


def assemble_with_holes(rings, even_odd=True):
    """Given a list of raw rings from a single drawing, reconstruct them as
    MultiPolygon with holes (even-odd fill: outer, hole, outer, hole, ...).

    Strategy:
      - Make each ring into a simple Polygon.
      - Sort by area descending.
      - Walk outer→inner: the first (largest) ring is an outer; any smaller ring
        *contained* in it is a hole (subtract); once a hole is consumed,
        subsequent rings contained in it are outers again (holes-of-holes), etc.
      - If even_odd is False, just union all as outers.
    """
    polys = []
    for r in rings:
        if len(r) < 4: continue
        try:
            p = Polygon(r)
            if not p.is_valid: p = make_valid(p)
            if p.is_empty: continue
            if p.geom_type == 'Polygon':
                polys.append(p)
            elif p.geom_type == 'MultiPolygon':
                polys.extend(list(p.geoms))
        except Exception:
            pass
    if not polys: return None
    if not even_odd:
        return unary_union(polys)
    # Even-odd: XOR all rings. Shapely's symmetric_difference does exactly this.
    acc = polys[0]
    for p in polys[1:]:
        try:
            acc = acc.symmetric_difference(p)
        except Exception:
            try: acc = make_valid(acc).symmetric_difference(make_valid(p))
            except Exception: continue
    if acc.is_empty: return None
    # Drop tiny slivers
    if acc.geom_type == 'Polygon':
        return acc if acc.area > 0.5 else None
    if acc.geom_type == 'MultiPolygon':
        keep = [g for g in acc.geoms if g.area > 0.5]
        if not keep: return None
        return keep[0] if len(keep) == 1 else MultiPolygon(keep)
    return None


def extract_grey_drawings(page):
    """Return list of shapely Polygon/MultiPolygon, one per grey-filled drawing,
    honouring even-odd fill."""
    out = []
    for d in page.get_drawings():
        if not is_grey(d.get('fill')): continue
        rings = build_subpaths(d.get('items', []))
        even_odd = d.get('even_odd', True)  # default to even-odd (matches what cartographers do)
        g = assemble_with_holes(rings, even_odd=even_odd)
        if g is None or g.is_empty: continue
        out.append(g)
    return out


# ── find main map frame: the largest stroked rectangle on the page ───────
def find_main_map_frame(page):
    """Return a shapely box for the main map border (stroked rectangle) — any
    grey polygon with centroid outside this frame is inset/decoration and
    gets rejected. Fallback: largest bounding box of all drawings that touch
    near the page centre.
    """
    best = None
    best_area = 0
    page_rect = page.rect
    for d in page.get_drawings():
        # Looking for stroked (not filled) rectangular frames
        if d.get('fill') is not None and not d.get('stroke_opacity', 0):
            # Filled but not stroked → skip
            pass
        r = d.get('rect')
        if r is None: continue
        w = r.x1 - r.x0
        h = r.y1 - r.y0
        area = w * h
        # Skip tiny or page-sized
        if area < 1000: continue
        if area > page_rect.width * page_rect.height * 0.95: continue
        # Must be largely aspect-reasonable (not a sliver)
        if w < 80 or h < 80: continue
        if area > best_area:
            best_area = area
            best = (r.x0, r.y0, r.x1, r.y1)
    if best:
        return box(*best)
    # Fallback: whole page minus 5% margin
    m = 0.05
    w, h = page_rect.width, page_rect.height
    return box(w*m, h*m, w*(1-m), h*(1-m))


# ── TPS transform ────────────────────────────────────────────────────────
class TPSTransform:
    def __init__(self, pdf_pts, geo_pts):
        """pdf_pts: Nx2 (x, y)  geo_pts: Nx2 (lon, lat)"""
        X = np.asarray(pdf_pts, dtype=float)
        Y = np.asarray(geo_pts, dtype=float)
        # One RBF per output dim. smoothing=0 ⇒ exact pass-through at every GCP.
        self._lon = RBFInterpolator(X, Y[:, 0], kernel='thin_plate_spline', smoothing=0)
        self._lat = RBFInterpolator(X, Y[:, 1], kernel='thin_plate_spline', smoothing=0)

    def transform_many(self, pts):
        """pts: Nx2 array → Nx2 array (lon, lat)"""
        pts = np.asarray(pts, dtype=float)
        lon = self._lon(pts)
        lat = self._lat(pts)
        return np.column_stack([lon, lat])

    def transform_one(self, x, y):
        r = self.transform_many([[x, y]])[0]
        return (float(r[0]), float(r[1]))


def transform_geometry(geom, tps):
    """Apply TPS to a shapely polygon/multipolygon."""
    if geom.geom_type == 'Polygon':
        ext = tps.transform_many(list(geom.exterior.coords)).tolist()
        holes = [tps.transform_many(list(r.coords)).tolist() for r in geom.interiors]
        p = Polygon(ext, holes)
        if not p.is_valid: p = make_valid(p)
        return p
    if geom.geom_type == 'MultiPolygon':
        polys = []
        for sub in geom.geoms:
            tp = transform_geometry(sub, tps)
            if tp is None or tp.is_empty: continue
            if tp.geom_type == 'Polygon': polys.append(tp)
            elif tp.geom_type == 'MultiPolygon': polys.extend(list(tp.geoms))
        if not polys: return None
        return MultiPolygon(polys) if len(polys) > 1 else polys[0]
    return None


# ── per-PDF processing ───────────────────────────────────────────────────
def process_pdf(pdf_path, gcps_for_pdf):
    code = pdf_path.stem.split('_', 1)[0]
    district = DISTRICT_BY_PDF.get(code, code)
    print(f"\n=== {pdf_path.name} ({district}) ===", file=sys.stderr)

    if not gcps_for_pdf or len(gcps_for_pdf) < 4:
        print(f"  [SKIP] need ≥4 GCPs for TPS, got {len(gcps_for_pdf or [])}", file=sys.stderr)
        return []

    pdf_pts = [(g['pdf']['x'], g['pdf']['y']) for g in gcps_for_pdf]
    geo_pts = [(g['geo']['lng'], g['geo']['lat']) for g in gcps_for_pdf]
    tps = TPSTransform(pdf_pts, geo_pts)

    # Verify: every GCP should transform back to its clicked lat/lon to numerical precision.
    residuals = []
    for (x, y), (lon, lat) in zip(pdf_pts, geo_pts):
        tlon, tlat = tps.transform_one(x, y)
        residuals.append(np.hypot(tlon - lon, tlat - lat))
    residuals = np.array(residuals)
    print(f"  {len(pdf_pts)} GCPs, TPS residuals: max={residuals.max()*111*1000:.1f}m (should be ~0)", file=sys.stderr)

    doc = fitz.open(pdf_path)
    page = doc[0]
    frame = find_main_map_frame(page)
    print(f"  main map frame: {frame.bounds}", file=sys.stderr)

    drawings = extract_grey_drawings(page)
    print(f"  grey drawings: {len(drawings)}", file=sys.stderr)

    feats = []
    skipped_frame = skipped_small = 0
    for i, g in enumerate(drawings):
        # Inset filter: drawing's representative point must sit inside main map frame
        try:
            rep = g.representative_point()
        except Exception:
            rep = g.centroid
        if not frame.contains(rep):
            skipped_frame += 1
            continue
        try:
            tg = transform_geometry(g, tps)
        except Exception as e:
            print(f"    poly {i}: transform failed: {e}", file=sys.stderr)
            continue
        if tg is None or tg.is_empty: continue
        if tg.area < MIN_AREA_SQDEG:
            skipped_small += 1
            continue
        feats.append({
            'type': 'Feature',
            'properties': {
                'id': f'{code}-grey-{i:03d}',
                'source_pdf': pdf_path.name,
                'district': district,
                'polygon_index': i,
            },
            'geometry': mapping(tg),
        })
    print(f"  kept: {len(feats)}  (outside frame: {skipped_frame}, too small: {skipped_small})", file=sys.stderr)
    return feats


def main():
    if not GCPS_FILE.exists():
        print(f"ERROR: {GCPS_FILE} not found. Click GCPs in /georef.html and Export.", file=sys.stderr)
        return 1
    gcps = json.loads(GCPS_FILE.read_text())
    print(f"loaded GCPs for {len(gcps)} PDFs", file=sys.stderr)

    all_feats = []
    for pdf in sorted(PDF_DIR.glob('*.pdf')):
        feats = process_pdf(pdf, gcps.get(pdf.stem, []))
        all_feats.extend(feats)

    fc = {
        'type': 'FeatureCollection',
        'name': 'permanent_closed_waters',
        'source': 'ADF&G district PDFs (rgb 78,78,78 vector fills) + user-clicked TPS georef',
        'features': all_feats,
    }
    OUT.write_text(json.dumps(fc, separators=(',', ':')))
    PUBLIC_OUT.write_text(json.dumps(fc, separators=(',', ':')))
    print(f"\nWrote {len(all_feats)} features → {OUT}", file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
