#!/usr/bin/env python3
"""Create an empty skeleton GeoJSON for hand-digitized closures in QGIS.

Produces one feature per closure with a minimal placeholder geometry (a tiny
point at the named-feature bbox centroid, or at (0,0) if no bbox) plus all
regulatory attributes pre-filled. Open this layer in QGIS, then for each row
enter edit mode, delete the placeholder geometry, and draw the real polygon.

Output:
  docs/hand-created/layers/closures_skeleton.geojson

Columns populated for each row:
  id                — e.g. '24.350(3)(G)'
  regulation        — '5 AAC 24.350'
  district          — e.g. 'Eastern District'
  paragraph         — e.g. '(3)(G)'
  name              — e.g. 'Port Gravina'
  definition_text   — verbatim AAC text (copy it verbatim while digitizing)
  exception         — '5 AAC 24.361(b)' if Copper River, else null
  status            — 'todo' | 'in_progress' | 'done' | 'blocked' (you flip this)
  source            — free text, fill with 'AAC + coastline + ADF&G PDF'
  notes             — free text, anything weird
"""
import json, re
from pathlib import Path
from shapely.geometry import shape

BASE = Path(__file__).resolve().parent.parent.parent.parent
SRC    = BASE / 'data' / 'closed_waters_source.json'
BBOXES = BASE / 'data' / 'pws_bboxes.geojson'
OUT    = BASE / 'docs' / 'hand-created' / 'layers' / 'closures_skeleton.geojson'

def norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())

def bbox_centroid_map():
    fc = json.loads(BBOXES.read_text())
    out = {}
    for f in fc['features']:
        nm = norm(f['properties'].get('name'))
        g = shape(f['geometry'])
        out[nm] = (g.centroid.x, g.centroid.y)
        # Also index bare (parenthetical stripped)
        m = re.search(r'^(.*?)\s*\((.+?)\)\s*$', nm)
        if m:
            if m.group(1).strip(): out[m.group(1).strip()] = (g.centroid.x, g.centroid.y)
            if m.group(2).strip(): out[m.group(2).strip()] = (g.centroid.x, g.centroid.y)
    return out

def main():
    src = json.loads(SRC.read_text())
    centroids = bbox_centroid_map()

    features = []
    for c in src['closures']:
        feat_name = (c.get('scope', {}).get('feature') or '').strip()
        fn = norm(feat_name)
        lonlat = centroids.get(fn) or (0.0, 0.0)

        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': list(lonlat)},
            'properties': {
                'id':              c['id'],
                'regulation':      '5 AAC 24.350',
                'district':        c.get('district'),
                'paragraph':       c.get('paragraph'),
                'name':            c.get('name'),
                'definition_text': c.get('definition_text'),
                'exception':       c.get('exception'),
                'status':          'todo',
                'source':          'AAC + coastline + ADF&G PDF',
                'notes':           '',
            }
        })

    fc = {'type': 'FeatureCollection', 'features': features}
    OUT.write_text(json.dumps(fc, indent=2))
    print(f'Wrote {len(features)} skeleton rows → {OUT.relative_to(BASE)}')
    print('Open in QGIS, toggle edit mode, delete the placeholder point geometry')
    print('for each feature, and draw the real polygon using the Add Part tool.')

if __name__ == '__main__':
    main()
