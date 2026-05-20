#!/usr/bin/env python3
"""Compare hand-created closures vs rule-based pipeline output.

Reads:
  docs/hand-created/layers/permanent_closed_waters_hand.geojson
  data/permanent_closed_waters.geojson

For each closure id that exists in both, computes:
  - area_hand_km2
  - area_pipeline_km2
  - area_pct_diff
  - iou                 (intersection-over-union; 1.0 = identical)
  - hand_only_km2       (area in hand but not in pipeline)
  - pipeline_only_km2   (area in pipeline but not in hand)

Writes docs/hand-created/diff_report.md sorted by worst IoU first.
"""
import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union

BASE = Path(__file__).resolve().parent.parent.parent.parent
HAND = BASE / 'docs' / 'hand-created' / 'layers' / 'permanent_closed_waters_hand.geojson'
PIPE = BASE / 'data' / 'permanent_closed_waters.geojson'
OUT  = BASE / 'docs' / 'hand-created' / 'diff_report.md'

# Approx scale: 1 degree ≈ 111 km at equator; for PWS (~60.5°N) 1 deg lat ≈ 111 km,
# 1 deg lon ≈ 55 km. area in deg² * 111 * 55 ≈ km² (rough).
DEG_TO_KM2 = 111.0 * 55.0

def load(path):
    if not path.exists():
        print(f'Missing: {path}')
        return {}
    fc = json.loads(path.read_text())
    out = {}
    for f in fc.get('features', []):
        cid = f['properties'].get('id')
        if not cid: continue
        g = shape(f['geometry'])
        if not g.is_valid: g = g.buffer(0)
        # Merge multi-entries (shouldn't happen but safety)
        out[cid] = unary_union([out[cid], g]) if cid in out else g
    return out

def main():
    hand = load(HAND)
    pipe = load(PIPE)

    all_ids = sorted(set(hand) | set(pipe))
    rows = []
    for cid in all_ids:
        h = hand.get(cid); p = pipe.get(cid)
        if h and p:
            inter = h.intersection(p).area
            union = h.union(p).area
            iou = inter / union if union > 0 else 0.0
            ha = h.area * DEG_TO_KM2
            pa = p.area * DEG_TO_KM2
            rows.append({
                'id': cid,
                'iou': iou,
                'hand_km2': ha,
                'pipe_km2': pa,
                'hand_only_km2': (h.difference(p)).area * DEG_TO_KM2,
                'pipe_only_km2': (p.difference(h)).area * DEG_TO_KM2,
                'status': 'both',
            })
        elif h:
            rows.append({'id': cid, 'iou': None, 'hand_km2': h.area * DEG_TO_KM2,
                         'pipe_km2': None, 'hand_only_km2': None, 'pipe_only_km2': None,
                         'status': 'hand_only'})
        else:
            rows.append({'id': cid, 'iou': None, 'hand_km2': None,
                         'pipe_km2': p.area * DEG_TO_KM2, 'hand_only_km2': None, 'pipe_only_km2': None,
                         'status': 'pipeline_only'})

    # Sort: both first by IoU ascending (worst match first), then single-side entries
    both = [r for r in rows if r['status'] == 'both']
    both.sort(key=lambda r: r['iou'])
    hand_only = [r for r in rows if r['status'] == 'hand_only']
    pipe_only = [r for r in rows if r['status'] == 'pipeline_only']

    lines = []
    lines.append('# Hand-digitized vs. rule-based pipeline — diff report')
    lines.append('')
    lines.append(f'Closures in both: {len(both)} — hand-only: {len(hand_only)} — pipeline-only: {len(pipe_only)}')
    lines.append('')
    lines.append('IoU of 1.0 = identical polygons. IoU < 0.8 worth reviewing.')
    lines.append('')
    lines.append('| id | IoU | hand km² | pipe km² | hand-only km² | pipe-only km² |')
    lines.append('|----|-----|----------|----------|---------------|---------------|')
    for r in both:
        lines.append(f'| `{r["id"]}` | {r["iou"]:.3f} | {r["hand_km2"]:.3f} | {r["pipe_km2"]:.3f} | {r["hand_only_km2"]:.3f} | {r["pipe_only_km2"]:.3f} |')

    if hand_only:
        lines.append('')
        lines.append('## Hand-only (no pipeline match)')
        for r in hand_only:
            lines.append(f'- `{r["id"]}` — {r["hand_km2"]:.3f} km²')
    if pipe_only:
        lines.append('')
        lines.append('## Pipeline-only (not yet digitized)')
        for r in pipe_only:
            lines.append(f'- `{r["id"]}` — {r["pipe_km2"]:.3f} km²')

    OUT.write_text('\n'.join(lines) + '\n')
    print(f'Wrote {OUT.relative_to(BASE)}')
    print(f'  both: {len(both)}  hand_only: {len(hand_only)}  pipe_only: {len(pipe_only)}')

if __name__ == '__main__':
    main()
