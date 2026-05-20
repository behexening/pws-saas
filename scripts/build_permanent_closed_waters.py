#!/usr/bin/env python3
"""Derive data/permanent_closed_waters.geojson from data/closed_waters_source.json.

For each closure entry:
  scope_geom = (named-feature polygon ∩ district polygon) or district polygon
  ops_geom   = union/intersection of half-planes / polyline-splits / buffers / whole-features
  result     = scope_geom ∩ ops_geom

Result is written as a GeoJSON FeatureCollection with one Feature per closure.
Properties carry id, district, paragraph, name, definition_text, exception, review_notes.
"""
import json
import math
import re
import sys
from pathlib import Path

import shapefile
from shapely.geometry import (Point, Polygon, MultiPolygon, LineString, box, shape)
from shapely.ops import unary_union, split
from shapely.validation import make_valid

BASE = Path(__file__).resolve().parent.parent
SRC  = BASE / 'data' / 'closed_waters_source.json'
OUT  = BASE / 'data' / 'permanent_closed_waters.geojson'

DISTRICTS_SHP = BASE / 'data' / 'PWS_Districts_2024' / 'districts'
SUBDISTRICTS_SHP = BASE / 'data' / 'PWS_Subdistricts_2024' / 'subdistricts'
BBOXES_GJ        = BASE / 'data' / 'pws_bboxes.geojson'
GAZETTEER_JSON   = BASE / 'data' / 'pws_gazetteer.json'
AWC_POINTS_JSON  = BASE / 'public' / 'awc-points.json'
BBOX_TODO_MD     = BASE / 'docs' / 'closedwaters' / 'bbox_todo.md'

# ── Coordinate parsing ─────────────────────────────────────────────────────
DMS_RE = re.compile(r'^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+([NSEW])\s*$', re.I)

def parse_dms(s):
    """'60 41.99 N' → 60.6998 ; '145 56.11 W' → -145.9352"""
    m = DMS_RE.match(s)
    if not m:
        raise ValueError(f"Bad DMS: {s!r}")
    deg, mn, hem = float(m.group(1)), float(m.group(2)), m.group(3).upper()
    val = deg + mn / 60.0
    if hem in ('S', 'W'):
        val = -val
    return val

def parse_pt(latstr, lonstr):
    """Returns (lon, lat)."""
    return (parse_dms(lonstr), parse_dms(latstr))

def parse_line(line_pts):
    """[['60 41.99 N','145 56.11 W'], ...] → [(lon,lat), ...]"""
    return [parse_pt(p[0], p[1]) for p in line_pts]


# ── Loaders ────────────────────────────────────────────────────────────────
def _polys_only(g):
    if g is None or g.is_empty: return None
    if g.geom_type == 'Polygon': return g
    if g.geom_type == 'MultiPolygon': return g
    if g.geom_type == 'GeometryCollection':
        polys = [x for x in g.geoms if x.geom_type in ('Polygon', 'MultiPolygon')]
        if not polys: return None
        return unary_union(polys)
    return None

def load_districts():
    sf = shapefile.Reader(str(DISTRICTS_SHP))
    fields = [f[0] for f in sf.fields[1:]]
    out = {}
    for sr in sf.shapeRecords():
        rec = dict(zip(fields, list(sr.record)))
        name = rec['DISTRICT_N']
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = make_valid(g)
            g = _polys_only(g) or g
        out[name.lower()] = g
    return out

def load_bboxes():
    """Hand-drawn named-feature polygons.

    Each entry carries all name aliases: the full name, the name with any
    trailing parenthetical stripped ('Long Bay (Culross Passage)' → 'Long Bay'),
    and the parenthetical contents themselves ('Long Bay (Culross Passage)' →
    'Culross Passage'). This way source closure scope names like 'Long Bay',
    'Shotgun Cove', 'Culross Passage' all hit the right polygon.
    """
    if not BBOXES_GJ.exists(): return {}
    fc = json.loads(BBOXES_GJ.read_text())
    out = []
    for f in fc.get('features', []):
        nm = (f['properties'].get('name') or '').strip().lower()
        d  = (f['properties'].get('district') or '').strip().lower() or None
        g  = shape(f['geometry'])
        if not g.is_valid:
            g = make_valid(g)
            g = _polys_only(g) or g
        aliases = {nm}
        m = re.search(r'^(.*?)\s*\((.+?)\)\s*$', nm)
        if m:
            bare = m.group(1).strip()
            inner = m.group(2).strip()
            if bare:  aliases.add(bare)
            if inner: aliases.add(inner)
        out.append({'name': nm, 'aliases': aliases, 'district': d, 'geom': g})
    return out

def load_gazetteer():
    if not GAZETTEER_JSON.exists(): return []
    raw = json.loads(GAZETTEER_JSON.read_text())
    if isinstance(raw, dict) and 'features' in raw:
        out = []
        for f in raw['features']:
            props = f.get('properties', {})
            nm = (props.get('name') or '').strip().lower()
            geom = f.get('geometry') or {}
            if geom.get('type') == 'Point':
                lon, lat = geom['coordinates'][:2]
                out.append({'name': nm, 'lon': lon, 'lat': lat})
        return out
    if isinstance(raw, list):
        out = []
        for e in raw:
            nm = (e.get('name') or '').strip().lower()
            lat = e.get('lat'); lon = e.get('lon') or e.get('lng')
            if nm and lat is not None and lon is not None:
                out.append({'name': nm, 'lon': lon, 'lat': lat})
        return out
    return []

def load_awc():
    if not AWC_POINTS_JSON.exists(): return []
    return json.loads(AWC_POINTS_JSON.read_text())


def load_bbox_todo():
    """Parse docs/closedwaters/bbox_todo.md → {name_lower: (lon, lat)}.

    Lines look like '- [x] Sheep Bay -- 60.6779,-145.9561' (lat,lon).
    Some entries have only one coord — those are skipped.
    """
    if not BBOX_TODO_MD.exists(): return {}
    out = {}
    for ln in BBOX_TODO_MD.read_text().splitlines():
        m = re.match(r'^\s*-\s*\[[ x]\]\s*(.+?)\s*--\s*(.+)$', ln)
        if not m: continue
        name = _norm(m.group(1))
        coord = m.group(2).strip()
        nums = re.findall(r'-?\d+\.\d+', coord)
        if len(nums) < 2: continue
        lat, lon = float(nums[0]), float(nums[1])
        if abs(lat) > 90 or abs(lon) > 180: continue
        out[name] = (lon, lat)
        # Also index without trailing parenthetical, e.g. "deer cove (hinchinbrook island)" → "deer cove"
        bare = re.sub(r'\s*\(.+?\)\s*$', '', name).strip()
        if bare and bare != name:
            out[bare] = (lon, lat)
    return out


# ── Feature scope lookup ───────────────────────────────────────────────────
def _norm(s):
    return re.sub(r'\s+', ' ', (s or '').strip().lower())

def find_feature_geom(name, district_geom, bboxes, gazetteer, bbox_todo=None,
                      default_buffer_km=3.0):
    """Return a shapely polygon for a named feature.

    Priority:
      1. Hand-drawn bbox in pws_bboxes.geojson.
      2. Gazetteer centroid → buffer.
      3. bbox_todo.md anchor coord → buffer (intersected with district).
      4. None.
    """
    if not name: return None
    n = _norm(name).replace('saint ', 'st. ')
    aliases = {n, n.replace('st. ', 'saint ')}

    # 1. Hand-drawn bbox — match against any of the bbox's aliases
    def _bbox_matches(b):
        for a in b.get('aliases', {b['name']}):
            if a in aliases or a.replace('saint ', 'st. ') in aliases:
                return True
        return False
    cands = [b for b in bboxes if _bbox_matches(b)]
    if cands:
        if len(cands) == 1:
            return cands[0]['geom']
        if district_geom is not None:
            for c in cands:
                if c['geom'].intersects(district_geom):
                    return c['geom']
        return cands[0]['geom']

    # 2. Gazetteer centroid + buffer
    for entry in gazetteer:
        if entry['name'] in aliases:
            buf_deg = default_buffer_km / 111.0
            pt = Point(entry['lon'], entry['lat'])
            buf = pt.buffer(buf_deg)
            if district_geom is not None and buf.intersects(district_geom):
                clip = buf.intersection(district_geom)
                if not clip.is_empty:
                    return clip
            return buf

    # 3. bbox_todo.md anchor → buffer, clipped to district
    if bbox_todo:
        for alias in aliases:
            if alias in bbox_todo:
                lon, lat = bbox_todo[alias]
                buf_deg = default_buffer_km / 111.0
                pt = Point(lon, lat)
                buf = pt.buffer(buf_deg)
                if district_geom is not None and buf.intersects(district_geom):
                    clip = buf.intersection(district_geom)
                    if not clip.is_empty:
                        return clip
                return buf

    return None


# ── Half-plane / polyline construction ─────────────────────────────────────
def build_half_plane(side, coords, scope_geom):
    """Half-plane polygon on the closed `side` of the line `coords`.
    coords: list of (lon, lat). Uses scope_geom bounds for sizing."""
    if scope_geom is None or scope_geom.is_empty:
        return None
    minx, miny, maxx, maxy = scope_geom.bounds
    pad = max(maxx - minx, maxy - miny) * 2.0 + 0.5

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    lon_span = max(lons) - min(lons)
    lat_span = max(lats) - min(lats)

    if lon_span < 0.001:  # vertical line (meridian)
        lon = sum(lons) / len(lons)
        if side == 'east':  return box(lon,        miny - pad, maxx + pad, maxy + pad)
        if side == 'west':  return box(minx - pad, miny - pad, lon,        maxy + pad)
        return None

    if lat_span < 0.001:  # horizontal line (parallel)
        lat = sum(lats) / len(lats)
        if side == 'north': return box(minx - pad, lat,        maxx + pad, maxy + pad)
        if side == 'south': return box(minx - pad, miny - pad, maxx + pad, lat)
        return None

    # Diagonal: extend line, build trapezoid on the chosen side.
    p1, p2 = coords[0], coords[-1]
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    if L < 1e-10: return None
    ux, uy = dx / L, dy / L                 # along-line unit
    # Extend endpoints along the line
    ext = max(maxx - minx, maxy - miny) + 1.0
    e1 = (p1[0] - ux * ext, p1[1] - uy * ext)
    e2 = (p2[0] + ux * ext, p2[1] + uy * ext)
    # Two perpendiculars
    lp = (-uy, ux); rp = (uy, -ux)
    if   side == 'north': perp = lp if lp[1] >= 0 else rp
    elif side == 'south': perp = lp if lp[1] <  0 else rp
    elif side == 'east':  perp = lp if lp[0] >= 0 else rp
    elif side == 'west':  perp = lp if lp[0] <  0 else rp
    else: return None
    big = max(maxx - minx, maxy - miny) * 4.0 + 1.0
    q1 = (e1[0] + perp[0] * big, e1[1] + perp[1] * big)
    q2 = (e2[0] + perp[0] * big, e2[1] + perp[1] * big)
    try:
        return Polygon([e1, e2, q2, q1])
    except Exception:
        return None


def split_along_polyline(scope_geom, coords, side):
    """Split scope_geom by the polyline and return the side indicated by `side`.

    For multi-segment lines we approximate `side` by using the polyline's
    overall bearing the same way build_half_plane does for the diagonal case
    (treats first→last endpoints as the reference axis), then keep pieces
    whose centroid lies on the indicated side of an extended straight line
    through the endpoints.
    """
    if scope_geom is None or scope_geom.is_empty: return None
    extended = list(coords)
    # Extend both endpoints along the local segment direction
    if len(extended) >= 2:
        p0, p1 = extended[0], extended[1]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        if L > 1e-10:
            extended[0] = (p0[0] - dx / L * 5.0, p0[1] - dy / L * 5.0)
        pn, pm = extended[-2], extended[-1]
        dx, dy = pm[0] - pn[0], pm[1] - pn[1]
        L = math.hypot(dx, dy)
        if L > 1e-10:
            extended[-1] = (pm[0] + dx / L * 5.0, pm[1] + dy / L * 5.0)
    try:
        line = LineString(extended)
        result = split(scope_geom, line)
    except Exception as e:
        print(f"  split failed: {e}", file=sys.stderr)
        return None

    pieces = list(getattr(result, 'geoms', [result]))
    if not pieces: return None

    # Use the half-plane built from endpoints to classify pieces.
    hp = build_half_plane(side, [coords[0], coords[-1]], scope_geom)
    if hp is None:
        return _polys_only(unary_union(pieces))

    keep = []
    for p in pieces:
        try:
            if p.intersection(hp).area > p.area * 0.5:
                keep.append(p)
        except Exception:
            continue
    if not keep:
        return None
    return _polys_only(unary_union(keep))


# ── Buffer ops ────────────────────────────────────────────────────────────
YARD_PER_DEG_LAT = 121800.0  # approx yards per degree latitude
def yards_to_deg(yards, lat=60.5):
    deg_lat = yards / YARD_PER_DEG_LAT
    deg_lon = yards / (YARD_PER_DEG_LAT * math.cos(math.radians(lat)))
    return max(deg_lat, deg_lon)


def buffer_streams(awc, scope_geom, radius_yards, filt):
    """Return union of buffered AWC stream points filtered by `filt`."""
    if scope_geom is None or scope_geom.is_empty: return None
    pts = []
    for p in awc:
        lon, lat = p['lon'], p['lat']
        if not scope_geom.contains(Point(lon, lat)):
            continue
        if filt:
            if 'north_of_lat' in filt:
                if lat <= parse_dms(filt['north_of_lat']): continue
            if 'south_of_lat' in filt:
                if lat >= parse_dms(filt['south_of_lat']): continue
            if 'east_of_lon' in filt:
                if lon <= parse_dms(filt['east_of_lon']): continue
            if 'west_of_lon' in filt:
                if lon >= parse_dms(filt['west_of_lon']): continue
            if 'between_lon' in filt:
                a = parse_dms(filt['between_lon'][0])
                b = parse_dms(filt['between_lon'][1])
                lo, hi = min(a, b), max(a, b)
                if not (lo <= lon <= hi): continue
            if 'name_contains' in filt:
                if filt['name_contains'].lower() not in (p.get('name') or '').lower():
                    continue
        pts.append((lon, lat))
    if not pts: return None
    bufs = []
    for lon, lat in pts:
        rad = yards_to_deg(radius_yards, lat)
        bufs.append(Point(lon, lat).buffer(rad))
    return _polys_only(unary_union(bufs))


def buffer_points(coords, radius_yards):
    """coords: list of (lon, lat). Returns union of yard-buffer disks."""
    if not coords: return None
    bufs = []
    for lon, lat in coords:
        rad = yards_to_deg(radius_yards, lat)
        bufs.append(Point(lon, lat).buffer(rad))
    return _polys_only(unary_union(bufs))


def custom_polygon(ring):
    if not ring or len(ring) < 3: return None
    pts = [parse_pt(p[0], p[1]) for p in ring]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    try:
        g = Polygon(pts)
        if not g.is_valid:
            g = make_valid(g)
            g = _polys_only(g) or g
        return g
    except Exception:
        return None


# ── Main per-closure derivation ────────────────────────────────────────────
def derive_closure(closure, districts, bboxes, gazetteer, awc, bbox_todo=None):
    name = closure['name']
    cid  = closure['id']
    district_name = closure['scope'].get('district') or closure['district']
    feature_name  = closure['scope'].get('feature')
    combine = closure.get('combine', 'union')

    d_geom = districts.get((district_name or '').lower())
    if d_geom is None:
        print(f"  [{cid}] WARN: district not found: {district_name}", file=sys.stderr)

    # Build scope geometry: prefer the named-feature polygon if available;
    # otherwise fall back to district.
    scope_geom = None
    if feature_name:
        scope_geom = find_feature_geom(feature_name, d_geom, bboxes, gazetteer, bbox_todo)
        if scope_geom is None:
            print(f"  [{cid}] note: no feature polygon for '{feature_name}' — falling back to district scope", file=sys.stderr)
    if scope_geom is None:
        scope_geom = d_geom

    if scope_geom is None or scope_geom.is_empty:
        print(f"  [{cid}] FAIL: no scope geometry", file=sys.stderr)
        return None

    # Build each op's geometry; per-op `scope_feature` overrides the closure scope.
    op_geoms = []
    for op in closure.get('ops', []):
        kind = op['op']
        per_scope = scope_geom
        if op.get('scope_feature'):
            sub = find_feature_geom(op['scope_feature'], d_geom, bboxes, gazetteer, bbox_todo)
            if sub is not None and not sub.is_empty:
                per_scope = sub

        if kind == 'half_plane':
            coords = parse_line(op['line'])
            hp = build_half_plane(op['side'], coords, per_scope)
            if hp is None:
                print(f"  [{cid}] WARN: half_plane build failed", file=sys.stderr)
                continue
            try:
                g = per_scope.intersection(hp)
            except Exception as e:
                print(f"  [{cid}] WARN: half_plane intersect failed: {e}", file=sys.stderr)
                continue
            g = _polys_only(g)
            if g is not None: op_geoms.append(g)

        elif kind == 'polyline_split':
            coords = parse_line(op['line'])
            g = split_along_polyline(per_scope, coords, op['side'])
            if g is not None: op_geoms.append(g)

        elif kind == 'whole_feature':
            f = find_feature_geom(op['feature'], d_geom, bboxes, gazetteer, bbox_todo)
            if f is not None and not f.is_empty:
                op_geoms.append(f)
            else:
                print(f"  [{cid}] WARN: whole_feature '{op['feature']}' not found", file=sys.stderr)

        elif kind == 'buffer_streams':
            sub_scope = per_scope
            f = (op.get('filter') or {}).get('within_feature')
            if f:
                sub = find_feature_geom(f, d_geom, bboxes, gazetteer, bbox_todo)
                if sub is not None: sub_scope = sub
            g = buffer_streams(awc, sub_scope, op['radius_yards'], op.get('filter'))
            if g is not None:
                # Clip to district to prevent leak across district boundaries
                if d_geom is not None:
                    try: g = g.intersection(d_geom)
                    except Exception: pass
                g = _polys_only(g)
                if g is not None and not g.is_empty: op_geoms.append(g)
            else:
                print(f"  [{cid}] WARN: buffer_streams produced no geometry (no AWC matches?)", file=sys.stderr)

        elif kind == 'buffer_points':
            coords = parse_line(op['points'])
            g = buffer_points(coords, op['radius_yards'])
            if g is not None:
                if d_geom is not None:
                    try: g = g.intersection(d_geom)
                    except Exception: pass
                g = _polys_only(g)
                if g is not None and not g.is_empty: op_geoms.append(g)

        elif kind == 'custom_polygon':
            g = custom_polygon(op['ring'])
            if g is not None:
                if d_geom is not None:
                    try: g = g.intersection(d_geom)
                    except Exception: pass
                g = _polys_only(g)
                if g is not None: op_geoms.append(g)

        else:
            print(f"  [{cid}] WARN: unknown op {kind}", file=sys.stderr)

    if not op_geoms:
        print(f"  [{cid}] FAIL: no op produced geometry", file=sys.stderr)
        return None

    if combine == 'intersection':
        result = op_geoms[0]
        for g in op_geoms[1:]:
            try: result = result.intersection(g)
            except Exception as e:
                print(f"  [{cid}] WARN: intersection combine failed: {e}", file=sys.stderr)
                return None
    else:
        try: result = unary_union(op_geoms)
        except Exception as e:
            print(f"  [{cid}] WARN: union combine failed: {e}", file=sys.stderr)
            return None

    # Final clip to district bounds if district is known and not already clipped
    if d_geom is not None and combine == 'union':
        try:
            result = result.intersection(d_geom)
        except Exception as e:
            print(f"  [{cid}] WARN: final district clip failed: {e}", file=sys.stderr)

    result = _polys_only(result)
    if result is None or result.is_empty:
        print(f"  [{cid}] FAIL: empty result after combine", file=sys.stderr)
        return None
    # Simplify ~10m tolerance for browser-sized output
    try:
        simp = result.simplify(0.0005, preserve_topology=True)
        if simp is not None and not simp.is_empty:
            result = _polys_only(simp) or result
    except Exception:
        pass
    return result


def feature_for(closure, geom):
    return {
        "type": "Feature",
        "properties": {
            "id":              closure['id'],
            "regulation":      "5 AAC 24.350",
            "district":        closure['district'],
            "paragraph":       closure['paragraph'],
            "name":            closure['name'],
            "definition_text": closure.get('definition_text'),
            "exception":       closure.get('exception'),
            "review_notes":    closure.get('review_notes'),
        },
        "geometry": geom.__geo_interface__,
    }


def main():
    print("Loading shapefiles…", file=sys.stderr)
    districts = load_districts()
    bboxes    = load_bboxes()
    gazetteer = load_gazetteer()
    awc       = load_awc()
    bbox_todo = load_bbox_todo()
    print(f"  districts: {len(districts)}  bboxes: {len(bboxes)}  gazetteer: {len(gazetteer)}  awc: {len(awc)}  bbox_todo: {len(bbox_todo)}",
          file=sys.stderr)

    src = json.loads(SRC.read_text())
    features = []
    failures = []

    for closure in src['closures']:
        print(f"[{closure['id']}] {closure['name']}", file=sys.stderr)
        geom = derive_closure(closure, districts, bboxes, gazetteer, awc, bbox_todo)
        if geom is None:
            failures.append(closure['id'])
            continue
        features.append(feature_for(closure, geom))

    fc = {
        "type": "FeatureCollection",
        "name": "permanent_closed_waters",
        "regulation": src.get('regulation'),
        "captured_date": src.get('captured_date'),
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }

    OUT.write_text(json.dumps(fc, separators=(',', ':')))
    print(f"\nWrote {OUT.relative_to(BASE)}: {len(features)} features ({len(failures)} failed)",
          file=sys.stderr)
    if failures:
        print(f"Failures: {failures}", file=sys.stderr)
    return 0 if not failures else 1

if __name__ == '__main__':
    sys.exit(main())
