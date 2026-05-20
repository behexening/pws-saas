#!/usr/bin/env python3
"""Detect AAC closure points that fall outside the hand-drawn bbox for their feature.

For each closure in data/closed_waters_source.json that references a named feature
(directly via scope.feature, or via op.scope_feature / op.feature / op.filter.within_feature):
  - find the matching polygon in data/pws_bboxes.geojson (using the same alias logic
    as build_permanent_closed_waters.py)
  - walk every coordinate point in ops (half_plane, polyline_split, buffer_points,
    custom_polygon) and check whether it falls inside the bbox polygon
  - any point that falls outside, OR any feature without a bbox, is recorded

Output: docs/closedwaters/out_of_bbox_points.md
"""
import json, re, sys
from pathlib import Path
from shapely.geometry import Point, shape

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / 'data' / 'closed_waters_source.json'
BBOXES = BASE / 'data' / 'pws_bboxes.geojson'
OUT = BASE / 'docs' / 'closedwaters' / 'out_of_bbox_points.md'

DMS_RE = re.compile(r'^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+([NSEW])\s*$', re.I)

def parse_dms(s):
    m = DMS_RE.match(s); deg, mn, hem = float(m.group(1)), float(m.group(2)), m.group(3).upper()
    v = deg + mn / 60.0
    return -v if hem in ('S', 'W') else v

def parse_pt(latstr, lonstr):
    return (parse_dms(lonstr), parse_dms(latstr))

def norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())

def load_bboxes():
    fc = json.loads(BBOXES.read_text())
    out = []
    for f in fc['features']:
        nm = norm(f['properties'].get('name'))
        d = norm(f['properties'].get('district'))
        g = shape(f['geometry'])
        aliases = {nm}
        m = re.search(r'^(.*?)\s*\((.+?)\)\s*$', nm)
        if m:
            if m.group(1).strip(): aliases.add(m.group(1).strip())
            if m.group(2).strip(): aliases.add(m.group(2).strip())
        # saint/st. equivalence
        for a in list(aliases):
            aliases.add(a.replace('saint ', 'st. '))
            aliases.add(a.replace('st. ', 'saint '))
        out.append({'name': nm, 'district': d, 'aliases': aliases, 'geom': g})
    return out

def find_bbox(feat_name, district_name, bboxes):
    if not feat_name: return None
    n = norm(feat_name)
    aliases = {n, n.replace('saint ', 'st. '), n.replace('st. ', 'saint ')}
    d = norm(district_name) if district_name else None
    cands = [b for b in bboxes if b['aliases'] & aliases]
    if not cands:
        return None
    # Prefer bbox in matching district
    if d:
        same = [c for c in cands if c['district'] and d.startswith(c['district'].split()[0])]
        if same: return same[0]
    return cands[0]

def collect_points(op):
    """Return list of (lon, lat, label) tuples from an op."""
    pts = []
    kind = op['op']
    if kind in ('half_plane', 'polyline_split'):
        for i, p in enumerate(op['line']):
            pts.append((*parse_pt(p[0], p[1]), f"line[{i}]"))
    elif kind == 'buffer_points':
        for i, p in enumerate(op['points']):
            pts.append((*parse_pt(p[0], p[1]), f"points[{i}]"))
    elif kind == 'custom_polygon':
        for i, p in enumerate(op['ring']):
            pts.append((*parse_pt(p[0], p[1]), f"ring[{i}]"))
    # buffer_streams / whole_feature have no explicit coords
    return pts

def feature_refs(closure):
    """Yield (level, feature_name) tuples for every named-feature reference."""
    feat = closure.get('scope', {}).get('feature')
    if feat: yield ('scope', feat)
    for i, op in enumerate(closure.get('ops', [])):
        if op.get('scope_feature'): yield (f'op[{i}].scope_feature', op['scope_feature'])
        if op.get('op') == 'whole_feature' and op.get('feature'): yield (f'op[{i}].feature', op['feature'])
        within = (op.get('filter') or {}).get('within_feature')
        if within: yield (f'op[{i}].filter.within_feature', within)

def main():
    src = json.loads(SRC.read_text())
    bboxes = load_bboxes()

    missing_features = []     # (closure_id, closure_name, feat_ref_level, feat_name)
    out_of_bbox = []          # (closure_id, closure_name, feat_name, op_idx, kind, pt_label, lon, lat)

    for c in src['closures']:
        cid = c['id']; cname = c['name']

        # 1. Collect every feature reference; flag if no bbox exists
        refs = list(feature_refs(c))
        ref_bbox = {}
        for level, feat in refs:
            bb = find_bbox(feat, c.get('district'), bboxes)
            if bb is None:
                missing_features.append((cid, cname, level, feat))
            else:
                ref_bbox[(level, feat)] = bb

        # 2. For scope.feature bbox (the dominant one), walk all op coords
        scope_feat = c.get('scope', {}).get('feature')
        scope_bb = find_bbox(scope_feat, c.get('district'), bboxes) if scope_feat else None
        for i, op in enumerate(c.get('ops', [])):
            # op-level scope overrides scope.feature
            per_bb = scope_bb
            if op.get('scope_feature'):
                b = find_bbox(op['scope_feature'], c.get('district'), bboxes)
                if b is not None: per_bb = b
            if per_bb is None: continue

            geom = per_bb['geom']
            # Small tolerance buffer — lines often sit on the bay mouth, ~200m outside
            # the ballpark bbox is acceptable.
            tol_deg = 0.003   # ≈ 330m
            for lon, lat, label in collect_points(op):
                pt = Point(lon, lat)
                if geom.buffer(tol_deg).contains(pt): continue
                # Compute how far outside (in approx meters)
                dist_deg = geom.distance(pt)
                dist_m = dist_deg * 111000
                out_of_bbox.append((cid, cname, per_bb['name'], i, op['op'], label, lon, lat, dist_m))

    # Render markdown
    lines = []
    lines.append('# AAC coordinates falling outside hand-drawn bboxes')
    lines.append('')
    lines.append(f'Generated from `data/closed_waters_source.json` vs `data/pws_bboxes.geojson`.')
    lines.append(f'Tolerance for "inside": 330 m (0.003°) buffer around the bbox.')
    lines.append('')
    lines.append('---')
    lines.append('')

    # Section 1: points outside their bbox
    if out_of_bbox:
        lines.append('## Points outside their referenced feature bbox')
        lines.append('')
        lines.append('These regulatory coordinates fell outside (or just barely outside) the bbox you drew for the named feature. Likely the bbox is too small or the wrong polygon.')
        lines.append('')
        # Group by closure
        from collections import defaultdict
        by_close = defaultdict(list)
        for row in out_of_bbox:
            by_close[(row[0], row[1], row[2])].append(row)
        for (cid, cname, feat), rows in sorted(by_close.items()):
            lines.append(f'### `{cid}` — {cname}')
            lines.append(f'- bbox: **{feat}**')
            for (_, _, _, op_i, kind, label, lon, lat, dist_m) in rows:
                # Convert back to DMS-ish for readability
                lines.append(f'  - op[{op_i}] ({kind}) {label}: {lat:.4f}°, {lon:.4f}° — {dist_m:.0f} m outside bbox')
            lines.append('')

    # Section 2: feature references with no bbox at all
    if missing_features:
        lines.append('## Feature references with no bbox at all')
        lines.append('')
        lines.append('The regulation names these features but `closedwatersbboxes.shp` has no polygon for them. The pipeline falls back to the full district (too broad) or the op silently skips.')
        lines.append('')
        from collections import defaultdict
        by_feat = defaultdict(list)
        for cid, cname, level, feat in missing_features:
            by_feat[feat].append((cid, cname, level))
        for feat, rows in sorted(by_feat.items()):
            lines.append(f'### {feat}')
            for cid, cname, level in rows:
                lines.append(f'- `{cid}` ({level}) — {cname}')
            lines.append('')

    # Section 3: pipeline failures (hardcoded from last run; update if source changes)
    lines.append('## Pipeline failures (did not produce geometry)')
    lines.append('')
    lines.append('- `24.350(1)(B)` — Copper River Flats inside closure. `polyline_split` did not cut the Copper River District polygon; needs manual polygon or a bbox for the Copper Flats inside corridor.')
    lines.append('- `24.350(4)(H)` — Unakwik Inlet Northern stream buffer. No AWC stream points north of 60°51.97′ within Unakwik. Either the AWC dataset is missing those streams or the closure lies outside AWC coverage.')
    lines.append('')
    lines.append('## Pipeline warnings worth reviewing')
    lines.append('')
    lines.append('- `24.350(10)(H)` — Green Island: one `half_plane` built with a horizontal line + `side=west`, which is ambiguous; the pipeline fell back to the remaining op. Result geometry may be partial.')
    lines.append('- `24.350(3)(V/W/X)` — Mineral Creek / Head of Port Valdez / Allison Creek-Sawmill-Alyeska: scope falls back to the full Eastern District because no `Port Valdez` bbox exists. Result is the named-feature bbox intersected with the half-plane, but if the feature bbox itself is wrong, the closure will be too.')
    lines.append('- `24.350(3)(A)` — Simpson Bay / Orca Inlet / Nelson Bay: no bbox exists for Simpson Bay, Orca Inlet, or Nelson Bay. The `whole_feature` ops are skipped.')
    lines.append('- `24.350(7)(D)` — Cochrane Bay (multi-arm): `op[3].scope_feature = Surprise Cove` has no bbox; that sub-op uses the whole Cochrane Bay bbox.')
    lines.append('- `24.350(11)(H)` — Hawkins Cutoff / Orca Inlet: `Orca Inlet southeast of Hawkins Island` has no bbox.')
    lines.append('')

    OUT.write_text('\n'.join(lines) + '\n')
    print(f"Wrote {OUT.relative_to(BASE)}")
    print(f"  Points outside bbox: {len(out_of_bbox)}")
    print(f"  Missing features:    {len(missing_features)}")

if __name__ == '__main__':
    main()
