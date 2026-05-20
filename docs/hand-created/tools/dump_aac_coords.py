#!/usr/bin/env python3
"""Dump every AAC coordinate from closed_waters_source.json into point GeoJSON.

Each point gets a label like `24.350(3)(G)-line[0]` so when you hover it in QGIS
you know exactly which closure it belongs to and its role in the op. Use these
points as **snap targets** when digitizing polygons.

Output:
  docs/hand-created/layers/aac_coords.geojson
"""
import json, re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent.parent
SRC  = BASE / 'data' / 'closed_waters_source.json'
OUT  = BASE / 'docs' / 'hand-created' / 'layers' / 'aac_coords.geojson'

DMS_RE = re.compile(r'^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+([NSEW])\s*$', re.I)

def parse_dms(s):
    m = DMS_RE.match(s)
    deg, mn, hem = float(m.group(1)), float(m.group(2)), m.group(3).upper()
    v = deg + mn / 60.0
    return -v if hem in ('S', 'W') else v

def parse_pt(latstr, lonstr):
    return parse_dms(lonstr), parse_dms(latstr)

def op_coords(op):
    """Yield (lon, lat, sub_label) for every coord in the op."""
    kind = op['op']
    if kind in ('half_plane', 'polyline_split'):
        for i, p in enumerate(op['line']):
            lon, lat = parse_pt(p[0], p[1])
            yield lon, lat, f'line[{i}]'
    elif kind == 'buffer_points':
        for i, p in enumerate(op['points']):
            lon, lat = parse_pt(p[0], p[1])
            yield lon, lat, f'points[{i}]'
    elif kind == 'custom_polygon':
        for i, p in enumerate(op['ring']):
            lon, lat = parse_pt(p[0], p[1])
            yield lon, lat, f'ring[{i}]'

def main():
    src = json.loads(SRC.read_text())
    features = []
    for c in src['closures']:
        cid = c['id']
        cname = c['name']
        district = c.get('district', '')
        for op_i, op in enumerate(c.get('ops', [])):
            for lon, lat, sub in op_coords(op):
                features.append({
                    'type': 'Feature',
                    'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                    'properties': {
                        'label':    f'{cid}-op{op_i}-{sub}',
                        'closure':  cid,
                        'name':     cname,
                        'district': district,
                        'op_index': op_i,
                        'op_kind':  op['op'],
                        'op_side':  op.get('side', ''),
                        'role':     sub,
                    }
                })
    fc = {'type': 'FeatureCollection', 'features': features}
    OUT.write_text(json.dumps(fc, indent=2))
    print(f'Wrote {len(features)} points → {OUT.relative_to(BASE)}')

if __name__ == '__main__':
    main()
