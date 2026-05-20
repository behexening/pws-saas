#!/usr/bin/env python3
"""Build QGIS reference layers from docs/closedwaters/5AAC24.350.md.

Outputs two GeoJSON files into data/closedwaters/:
  - closure_reference_points.geojson  (one Point per labeled coord in the law)
  - closure_reference_lines.geojson   (one LineString per declared boundary line)

Each feature carries `closure_id`, `district`, `name`, and a human label,
so you can drop these layers into QGIS and label/symbolize by attribute.

For closures defined only by a single coord ("north of 60° 44.06' N"),
a single approximate point is emitted at a hand-curated bay-center hint
so it shows up somewhere sensible in the map. The `partial` property is true.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/closedwaters/5AAC24.350.md"
OUT_DIR = ROOT / "data/closedwaters"
OUT_DIR.mkdir(parents=True, exist_ok=True)
POINTS_OUT = OUT_DIR / "closure_reference_points.geojson"
LINES_OUT = OUT_DIR / "closure_reference_lines.geojson"

# Rough bay-center coords for closures whose rule is partial (e.g. "north of 60° X' N").
# These are hand-eyeballed — accurate to within a couple of miles, just for labeling.
PARTIAL_HINTS = {
    ("3", "A"): (60.65, -145.85),   # Simpson Bay / Orca Inlet area
    ("3", "E"): (60.74, -146.20),   # Olsen Bay
    ("3", "G"): (60.77, -146.30),   # Port Gravina
    ("3", "Q"): (60.82, -146.40),   # Fish Bay
    ("4", "C"): (60.97, -147.30),   # Cedar Bay
    ("4", "D"): (60.89, -147.70),   # Eaglek Bay
    ("4", "J"): (60.92, -147.65),   # Schoppe Bay
    ("7", "G"): (60.54, -148.15),   # East Finger Inlet
    ("8", "A"): (60.47, -147.95),   # Eshamy Bay & Lagoon
    ("8", "B"): (60.48, -147.97),   # Gumboot Creek (N shore Eshamy)
    ("9", "A"): (60.27, -148.05),   # Dangerous Passage (mid)
    ("9", "B"): (60.27, -148.13),   # Ewan Bay
    ("9", "E"): (60.22, -148.06),   # Whale Bay
    ("9", "L"): (60.18, -147.78),   # Hogan Bay
    ("9", "M"): (60.22, -147.76),   # Snug Harbor
}

DMS_RE = re.compile(r"(\d{1,3})°\s*(\d{1,2}(?:\.\d+)?)'?\s*([NSEW])")


def dms_to_dd(deg, minutes, hemi):
    val = float(deg) + float(minutes) / 60.0
    if hemi in ("S", "W"):
        val = -val
    return val


def parse_coords(text):
    """Return list of (lat, lng) decimal-degree pairs found in `text`, in order."""
    matches = DMS_RE.findall(text)
    coords = []
    i = 0
    while i < len(matches) - 1:
        a, b = matches[i], matches[i + 1]
        if a[2] in ("N", "S") and b[2] in ("E", "W"):
            coords.append((dms_to_dd(*a), dms_to_dd(*b)))
            i += 2
        else:
            i += 1
    return coords


def parse_md():
    """Parse the markdown into a list of (dnum, dname, letter, closure_name, bullets[])."""
    lines = SRC.read_text().splitlines()
    out = []
    district = None
    closure = None
    body = []

    d_re = re.compile(r"^##\s+\((\d+)\)\s+(.+)$")
    c_re = re.compile(r"^###\s+\(([A-Za-z])\)\s+(.+)$")

    def flush():
        nonlocal closure, body
        if closure:
            out.append((*closure, body[:]))
        closure = None
        body = []

    for ln in lines:
        m_d = d_re.match(ln)
        if m_d:
            flush()
            district = (m_d.group(1), m_d.group(2))
            continue
        m_c = c_re.match(ln)
        if m_c:
            flush()
            if district:
                closure = (district[0], district[1], m_c.group(1).upper(), m_c.group(2))
                body = []
            continue
        if closure:
            body.append(ln)
    flush()
    return out


def main():
    closures = parse_md()
    pt_features = []
    ln_features = []
    pt_id = 0
    ln_id = 0

    def add_point(cid, dname, cname, lat, lng, vertex_idx, partial=False, note=""):
        nonlocal pt_id
        pt_id += 1
        label = f"{cid} {cname}" + (f" #{vertex_idx}" if vertex_idx else "")
        if partial:
            label += " (approx)"
        pt_features.append({
            "type": "Feature",
            "properties": {
                "id": pt_id,
                "closure_id": cid,
                "district": dname,
                "name": cname,
                "vertex": vertex_idx,
                "label": label,
                "partial": partial,
                "note": note,
            },
            "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
        })

    def add_line(cid, dname, cname, coords, segment_idx):
        nonlocal ln_id
        ln_id += 1
        ln_features.append({
            "type": "Feature",
            "properties": {
                "id": ln_id,
                "closure_id": cid,
                "district": dname,
                "name": cname,
                "segment": segment_idx,
                "label": f"{cid} {cname} seg{segment_idx}",
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(lng, 6), round(lat, 6)] for lat, lng in coords],
            },
        })

    for (dnum, dname, letter, cname, body) in closures:
        cid = f"{dnum}-{letter}"
        chained = []  # buffer for single-coord bullets that form one shared polyline
        segment_idx = 0
        emitted_anything = False

        for bullet in body:
            bullet = bullet.strip()
            if not bullet.startswith("-"):
                continue
            coords = parse_coords(bullet)
            if not coords:
                continue
            if len(coords) == 1:
                chained.append(coords[0])
            else:
                segment_idx += 1
                add_line(cid, dname, cname, coords, segment_idx)
                for idx, (lat, lng) in enumerate(coords, 1):
                    add_point(cid, dname, cname, lat, lng, idx)
                emitted_anything = True

        if len(chained) >= 2:
            segment_idx += 1
            add_line(cid, dname, cname, chained, segment_idx)
            for idx, (lat, lng) in enumerate(chained, 1):
                add_point(cid, dname, cname, lat, lng, idx)
            emitted_anything = True
        elif len(chained) == 1:
            lat, lng = chained[0]
            add_point(cid, dname, cname, lat, lng, 1)
            emitted_anything = True

        # Also scan any non-bullet body text for coords (e.g. closure (1)(A) intro)
        non_bullet = "\n".join(l for l in body if not l.strip().startswith("-"))
        extra = parse_coords(non_bullet)
        if extra and not emitted_anything:
            for idx, (lat, lng) in enumerate(extra, 1):
                add_point(cid, dname, cname, lat, lng, idx)
            emitted_anything = True

        if not emitted_anything:
            hint = PARTIAL_HINTS.get((dnum, letter))
            if hint:
                lat, lng = hint
                # Try to capture the rule text as a short note
                rule = " ".join(b.strip() for b in body if b.strip())[:240]
                add_point(cid, dname, cname, lat, lng, None,
                          partial=True, note=rule)

    POINTS_OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": pt_features}, indent=2))
    LINES_OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": ln_features}, indent=2))
    print(f"Wrote {len(pt_features):4d} points -> {POINTS_OUT.relative_to(ROOT)}")
    print(f"Wrote {len(ln_features):4d} lines  -> {LINES_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
