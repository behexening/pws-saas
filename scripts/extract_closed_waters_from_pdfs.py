#!/usr/bin/env python3
"""Extract permanent closed-water polygons directly from ADF&G district PDFs.

For each PDF in docs/closedwaters/:
  1. Pull dark-gray vector polygons (rgb 78,78,78 = #4E4E4E).
  2. Pull text labels with their PDF coordinates.
  3. Match labels to bbox_todo.md (which has known lat/lon for named features).
  4. Compute an affine transform (least squares) from PDF coords → lat/lon.
  5. Apply transform to each gray polygon → write as GeoJSON FeatureCollection.

Output: data/permanent_closed_waters.geojson (overwrites the rule-derived version).
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import fitz
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

BASE = Path(__file__).resolve().parent.parent
PDF_DIR = BASE / 'docs' / 'closedwaters'
BBOX_TODO = PDF_DIR / 'bbox_todo.md'
OUT = BASE / 'data' / 'permanent_closed_waters.geojson'
PUBLIC_OUT = BASE / 'public' / 'static' / 'permanent_closed_waters.geojson'

# rgb(78,78,78) ± tolerance
GREY_TARGET = (78, 78, 78)
GREY_TOL = 8

DISTRICT_BY_PDF = {
    '212-200': 'Copper River District',  # also includes Bering
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

# Extra hardcoded GCPs (towns, capes, points) not in bbox_todo.md.
EXTRA_GCPS = {
    'cordova':              (60.5440, -145.7589),
    'whittier':             (60.7733, -148.6814),
    'valdez':               (61.1308, -146.3483),
    'chenega':              (60.0596, -148.0036),
    'cape hinchinbrook':    (60.231,  -146.654),
    'cape suckling':        (59.999,  -143.873),
    'cape st. elias':       (59.793,  -144.601),
    'cape cleare':          (59.832,  -147.823),
    'bear cape':            (60.358,  -146.717),
    'point whitshed':       (60.434,  -145.873),
    'pt. whitshed':         (60.434,  -145.873),
    'strawberry reef':      (60.281,  -145.075),
    'point bentinck':       (60.405,  -146.166),
    'pt. bentinck':         (60.405,  -146.166),
    'point hey':            (60.149,  -144.443),
    'pt. hey':              (60.149,  -144.443),
    'kanak island':         (60.156,  -144.605),
    'okalee point':         (60.166,  -144.498),
    'kayak island':         (59.917,  -144.418),
    'wingham island':       (60.038,  -144.438),
    'controller bay':       (60.143,  -144.105),
    'softuk bar':           (60.300,  -145.430),
    'palm point':           (60.314,  -145.354),
    'pete dahl':            (60.245,  -145.405),
    'orca inlet':           (60.501,  -145.787),
    'simpson bay':          (60.621,  -145.857),
    'nelson bay':           (60.589,  -145.823),
    'hawkins island':       (60.522,  -146.150),
    'hichinbrook island':   (60.330,  -146.400),
    'hinchinbrook island':  (60.330,  -146.400),
    'montague island':      (60.105,  -147.450),
    'green island':         (60.286,  -147.430),
    'wooded islands':       (59.892,  -147.385),
    'patton bay':           (60.020,  -147.330),
    'jeanie cove':          (59.918,  -147.640),
    'gibbon anchorage':     (60.310,  -147.490),
    'pt. bazil':            (60.115,  -147.620),
    'point bazil':          (60.115,  -147.620),
    'pt. woodcock':         (59.985,  -147.760),
    'point woodcock':       (59.985,  -147.760),
    'graveyard pt.':        (60.343,  -147.327),
    'graveyard point':      (60.343,  -147.327),
    'montague pt.':         (60.382,  -147.118),
    'montague point':       (60.382,  -147.118),
    'zaikof pt.':           (60.275,  -147.005),
    'zaikof point':         (60.275,  -147.005),
    'hook pt.':             (60.213,  -146.305),
    'hook point':           (60.213,  -146.305),
    'johnstone pt.':        (60.485,  -146.602),
    'johnstone point':      (60.485,  -146.602),
    'makaka pt.':           (60.532,  -146.350),
    'salmo pt.':            (60.595,  -145.815),
    'shepherd pt.':         (60.601,  -145.795),
    'cannery creek hatchery': (60.880, -147.560),
    'miners lake':          (60.945,  -147.428),
    'unalkwik inlet':       (60.870,  -147.530),
    'unakwik inlet':        (60.870,  -147.530),
    'esther passage':       (60.876,  -147.926),
    'eshamy lagoon':        (60.464,  -147.923),
    'eshamy bay':           (60.470,  -147.880),
    'main bay':             (60.535,  -147.940),
    'crafton island':       (60.503,  -147.748),
}


def load_bbox_todo():
    """Parse bbox_todo.md → {normalized_name: (lat, lon)} merged with EXTRA_GCPS."""
    out = dict(EXTRA_GCPS)
    if not BBOX_TODO.exists(): return out
    for ln in BBOX_TODO.read_text().splitlines():
        m = re.match(r'^\s*-\s*\[[ x]\]\s*(.+?)\s*--\s*(.+)$', ln)
        if not m: continue
        name = norm(m.group(1))
        nums = re.findall(r'-?\d+\.\d+', m.group(2))
        if len(nums) < 2: continue
        lat, lon = float(nums[0]), float(nums[1])
        if not (50 < lat < 70 and -160 < lon < -140): continue
        out[name] = (lat, lon)
        bare = re.sub(r'\s*\(.+?\)\s*$', '', name).strip()
        if bare and bare != name:
            out[bare] = (lat, lon)
    return out


def norm(s):
    s = re.sub(r'\s+', ' ', (s or '').strip().lower())
    s = s.replace('saint ', 'st. ')
    return s


def is_grey(rgb01):
    if rgb01 is None: return False
    r, g, b = (round(c * 255) for c in rgb01[:3])
    return all(abs(c - t) <= GREY_TOL for c, t in zip((r, g, b), GREY_TARGET))


def extract_grey_polygons(page):
    """Return list of shapely Polygons in PDF coord space (y goes DOWN in PDF).

    Each grey-filled drawing's `items` list contains path segments (lines, beziers,
    moves). We linearise everything into points and form polygons per closed sub-path.
    """
    polys = []
    for d in page.get_drawings():
        if not is_grey(d.get('fill')): continue
        # Walk items; each starts with operator letter. Build sub-paths.
        sub = []
        all_subs = []
        last_pt = None
        for it in d.get('items', []):
            op = it[0]
            if op == 'l':  # line
                p1, p2 = it[1], it[2]
                if not sub: sub.append((p1.x, p1.y))
                sub.append((p2.x, p2.y))
                last_pt = p2
            elif op == 'c':  # bezier curve
                p1, p2, p3, p4 = it[1], it[2], it[3], it[4]
                if not sub: sub.append((p1.x, p1.y))
                # Sample 6 pts along the curve (cubic bezier)
                for t in (0.2, 0.4, 0.6, 0.8, 1.0):
                    bx = (1 - t)**3 * p1.x + 3*(1 - t)**2 * t * p2.x + 3*(1 - t) * t**2 * p3.x + t**3 * p4.x
                    by = (1 - t)**3 * p1.y + 3*(1 - t)**2 * t * p2.y + 3*(1 - t) * t**2 * p3.y + t**3 * p4.y
                    sub.append((bx, by))
                last_pt = p4
            elif op == 're':  # rectangle
                rect = it[1]
                all_subs.append([(rect.x0, rect.y0), (rect.x1, rect.y0),
                                 (rect.x1, rect.y1), (rect.x0, rect.y1),
                                 (rect.x0, rect.y0)])
            elif op == 'qu':  # quad
                q = it[1]
                all_subs.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y),
                                 (q.lr.x, q.lr.y), (q.ll.x, q.ll.y),
                                 (q.ul.x, q.ul.y)])
            elif op == 'h':  # close subpath
                if sub:
                    if sub[0] != sub[-1]: sub.append(sub[0])
                    all_subs.append(sub)
                    sub = []
        if sub:
            if sub[0] != sub[-1]: sub.append(sub[0])
            all_subs.append(sub)
        for s in all_subs:
            if len(s) < 4: continue
            try:
                p = Polygon(s)
                if not p.is_valid:
                    p = make_valid(p)
                if p.geom_type == 'Polygon' and p.area > 1e-3:
                    polys.append(p)
                elif p.geom_type == 'MultiPolygon':
                    for sp in p.geoms:
                        if sp.area > 1e-3: polys.append(sp)
            except Exception:
                pass
    # Union touching polygons (sometimes a closure is broken into adjacent paths)
    if not polys: return []
    try:
        u = unary_union(polys)
        if u.geom_type == 'Polygon': return [u]
        if u.geom_type == 'MultiPolygon': return list(u.geoms)
    except Exception:
        pass
    return polys


def extract_labels(page):
    """Return [(text_normalized, x, y), ...] for each text span. Multi-word
    labels get re-joined when consecutive spans share a y and reasonable x gap."""
    spans = []
    td = page.get_text('dict')
    for block in td['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                t = span['text'].strip()
                if not t: continue
                x0, y0, x1, y1 = span['bbox']
                spans.append({'text': t, 'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2,
                              'x0': x0, 'x1': x1, 'y': y0, 'h': y1 - y0})
    # Group multi-line / multi-span feature names: spans within ~1.5x line height vertically and overlapping x ranges
    used = [False] * len(spans)
    out = []
    for i, s in enumerate(spans):
        if used[i]: continue
        group = [s]; used[i] = True
        for j in range(i + 1, len(spans)):
            if used[j]: continue
            t = spans[j]
            # Same x neighbourhood AND adjacent y (multi-line label)
            if abs(t['cx'] - s['cx']) < 30 and 0 < (t['y'] - s['y']) < s['h'] * 2.5:
                group.append(t); used[j] = True
        text = ' '.join(g['text'] for g in group)
        cx = sum(g['cx'] for g in group) / len(group)
        cy = sum(g['cy'] for g in group) / len(group)
        out.append((norm(text), cx, cy))
    return out


def fit_affine(pdf_pts, geo_pts):
    """Solve [lat,lon] = A · [x,y,1]ᵀ via least squares.
    Returns 2x3 matrix M such that M @ [x,y,1] = [lat, lon]."""
    n = len(pdf_pts)
    if n < 3: return None
    A = np.zeros((2 * n, 6))
    b = np.zeros(2 * n)
    for i, ((x, y), (lat, lon)) in enumerate(zip(pdf_pts, geo_pts)):
        A[2*i]     = [x, y, 1, 0, 0, 0]
        A[2*i + 1] = [0, 0, 0, x, y, 1]
        b[2*i]     = lat
        b[2*i + 1] = lon
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    return sol.reshape(2, 3)


def apply_affine(M, x, y):
    lat = M[0, 0] * x + M[0, 1] * y + M[0, 2]
    lon = M[1, 0] * x + M[1, 1] * y + M[1, 2]
    return (lon, lat)


def transform_polygon(poly, M):
    def tx(coords):
        return [apply_affine(M, x, y) for x, y in coords]
    ext = tx(list(poly.exterior.coords))
    holes = [tx(list(r.coords)) for r in poly.interiors]
    p = Polygon(ext, holes)
    if not p.is_valid:
        p = make_valid(p)
    return p


def process_pdf(pdf_path, bbox_todo):
    name = pdf_path.stem  # "221_Eastern_District_ReportingAreas"
    code = name.split('_', 1)[0]
    district = DISTRICT_BY_PDF.get(code, code)
    print(f"\n=== {pdf_path.name} ({district}) ===", file=sys.stderr)

    doc = fitz.open(pdf_path)
    page = doc[0]

    polys = extract_grey_polygons(page)
    print(f"  grey polygons: {len(polys)}", file=sys.stderr)

    labels = extract_labels(page)
    # Match labels → bbox_todo
    pdf_pts = []; geo_pts = []; matched = []
    for text, cx, cy in labels:
        if text in bbox_todo:
            lat, lon = bbox_todo[text]
            pdf_pts.append((cx, cy))
            geo_pts.append((lat, lon))
            matched.append(text)
            continue
        # Try removing trailing common words ("Bay", "Cove", "Inlet", etc) — usually they appear in the label
        # Try fuzzy: bare key match
        bare = text
        if bare in bbox_todo:
            lat, lon = bbox_todo[bare]
            pdf_pts.append((cx, cy)); geo_pts.append((lat, lon)); matched.append(text)
    print(f"  matched labels: {len(matched)} / {len(labels)}", file=sys.stderr)
    if matched:
        print(f"    e.g. {matched[:5]}", file=sys.stderr)

    if len(pdf_pts) < 3:
        print(f"  [WARN] only {len(pdf_pts)} GCPs — cannot georef", file=sys.stderr)
        return [], district

    # Filter outliers: fit, compute residuals, drop worst, refit
    M = fit_affine(pdf_pts, geo_pts)
    residuals = []
    for (x, y), (lat, lon) in zip(pdf_pts, geo_pts):
        plon, plat = apply_affine(M, x, y)[0], apply_affine(M, x, y)[1]
        # apply_affine returns (lon, lat)
        plat = M[0, 0] * x + M[0, 1] * y + M[0, 2]
        plon = M[1, 0] * x + M[1, 1] * y + M[1, 2]
        residuals.append(np.hypot(plat - lat, plon - lon))
    residuals = np.array(residuals)
    keep = residuals < (residuals.mean() + 1.5 * residuals.std() + 1e-9)
    if keep.sum() >= 3 and keep.sum() < len(pdf_pts):
        pdf_pts = [p for p, k in zip(pdf_pts, keep) if k]
        geo_pts = [g for g, k in zip(geo_pts, keep) if k]
        matched = [m for m, k in zip(matched, keep) if k]
        M = fit_affine(pdf_pts, geo_pts)
        print(f"  after outlier filter: {len(matched)} GCPs", file=sys.stderr)

    # Determine inset region: assume the largest "Area of Detail" inset is in the
    # upper-left of the page. Reject any polygon whose centroid falls inside the
    # bounding box of all matched-label positions ONLY IF the polygon is in the
    # opposite corner of the page (i.e. likely inset).
    page_w, page_h = page.rect.width, page.rect.height
    # Heuristic: the inset is typically in the corner farthest from the centroid
    # of matched labels. Drop polygons whose centroid lies outside the convex
    # hull of label points (extended by a margin) — they're likely in the inset.
    from shapely.geometry import MultiPoint
    if len(pdf_pts) >= 3:
        hull = MultiPoint(pdf_pts).convex_hull.buffer(50)  # 50 pt margin
    else:
        hull = None

    # Transform polys
    feats = []
    skipped_inset = 0
    skipped_small = 0
    for i, p in enumerate(polys):
        # Skip polygons in the inset (outside hull of matched labels)
        if hull is not None and not hull.contains(p.centroid):
            skipped_inset += 1
            continue
        try:
            tp = transform_polygon(p, M)
        except Exception as e:
            print(f"    poly {i}: transform failed: {e}", file=sys.stderr)
            continue
        if tp is None or tp.is_empty: continue
        # Drop sub-hectare junk (text fragments, ticks, dots)
        if tp.area < 1e-5:
            skipped_small += 1
            continue
        if tp.geom_type not in ('Polygon', 'MultiPolygon'):
            continue
        feats.append({
            'type': 'Feature',
            'properties': {
                'id': f'{code}-grey-{i:03d}',
                'source_pdf': pdf_path.name,
                'district': district,
                'polygon_index': i,
            },
            'geometry': mapping(tp),
        })
    print(f"  kept: {len(feats)}  (skipped inset: {skipped_inset}, small: {skipped_small})", file=sys.stderr)
    return feats, district


def main():
    bbox_todo = load_bbox_todo()
    print(f"loaded bbox_todo: {len(bbox_todo)} names", file=sys.stderr)

    all_feats = []
    pdfs = sorted(PDF_DIR.glob('*.pdf'))
    for p in pdfs:
        feats, _ = process_pdf(p, bbox_todo)
        all_feats.extend(feats)

    fc = {
        'type': 'FeatureCollection',
        'name': 'permanent_closed_waters',
        'source': 'ADF&G district PDFs (vector grey polygons #4E4E4E)',
        'features': all_feats,
    }
    OUT.write_text(json.dumps(fc, separators=(',', ':')))
    PUBLIC_OUT.write_text(json.dumps(fc, separators=(',', ':')))
    print(f"\nWrote {OUT}: {len(all_feats)} features", file=sys.stderr)
    print(f"Wrote {PUBLIC_OUT}", file=sys.stderr)


if __name__ == '__main__':
    sys.exit(main() or 0)
