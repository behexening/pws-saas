#!/usr/bin/env python3
"""
Live test: Enhanced for server deployment.

Usage (called by backend):
    python3 live_test.py --announcement-id 42 --output /path/to/output.html --input-text "..."

Or locally:
    python3 live_test.py --pdf-path /path/to/announcement.pdf

Behavior:
    1. Accepts announcement input (text or PDF file)
    2. Parses with Claude API
    3. Generates HTML visualization
    4. Outputs to specified location
    5. Returns exit code 0 on success, 1 on failure
"""

import json
import os
import sys
import struct
import zipfile
import xml.etree.ElementTree as ET
import argparse
from pathlib import Path
from datetime import datetime
import shapefile
from shapely.geometry import Point, shape

import pdfplumber
from anthropic import Anthropic

# ============================================================
# CONFIG
# ============================================================

BASE = Path(__file__).parent
ANNOTATED = BASE / "annotated"
DATA = BASE / "data"

# Load API key
def load_api_env():
    env_file = BASE / "api.env"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ[key.strip()] = val.strip()

load_api_env()
if not os.environ.get("ANTHROPIC_API_KEY"):
    print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
    sys.exit(1)

client = Anthropic()

# ============================================================
# SHAPEFILE & AWC LOADING (from original)
# ============================================================

def shp_to_geojson(shp_path, name_field):
    """Convert a shapefile to GeoJSON FeatureCollection."""
    features = []
    try:
        sf = shapefile.Reader(str(shp_path))
        fields = [f[0] for f in sf.fields[1:]]
        for rec in sf.shapeRecords():
            attrs = dict(zip(fields, rec.record))
            geom = rec.shape.__geo_interface__
            features.append({
                "type": "Feature",
                "properties": {k: (v.strip() if isinstance(v, str) else v) for k, v in attrs.items()},
                "geometry": geom
            })
    except Exception as e:
        print(f"WARNING: could not read {shp_path}: {e}", file=sys.stderr)
    return {"type": "FeatureCollection", "features": features}

def load_shapefiles():
    districts_dir  = next(DATA.glob("*Districts*"), None)
    subdists_dir   = next(DATA.glob("*Subdistricts*"), None)
    stat_areas_dir = next(DATA.glob("*StatisticalAreas*"), None)

    result = {}
    if districts_dir:
        shp = next(districts_dir.glob("*.shp"), None)
        if shp:
            result["districts"] = shp_to_geojson(shp, "DISTRICT_N")
    if subdists_dir:
        shp = next(subdists_dir.glob("*.shp"), None)
        if shp:
            result["subdistricts"] = shp_to_geojson(shp, "SUBDISTRIC")
    if stat_areas_dir:
        shp = next(stat_areas_dir.glob("*.shp"), None)
        if shp:
            result["stat_areas"] = shp_to_geojson(shp, "STAT_AREA_")
    return result

def load_awc_points():
    """Parse AWC stream points."""
    kmz_path = BASE / "data" / "2025PWSAWC" / "scn_point.shp.kmz"
    if not kmz_path.exists():
        print(f"WARNING: AWC KMZ not found", file=sys.stderr)
        return []
    points = []
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    with zipfile.ZipFile(kmz_path) as z:
        kml_text = z.read("doc.kml").decode("utf-8")
    root = ET.fromstring(kml_text)
    for pm in root.findall(".//k:Placemark", ns):
        coords_text = pm.findtext(".//k:coordinates", default="", namespaces=ns) or ""
        parts = coords_text.strip().split(",")
        if len(parts) >= 2:
            try:
                lon, lat = float(parts[0]), float(parts[1])
                data = {sd.get("name"): sd.text for sd in pm.findall(".//k:SimpleData", ns)}
                name = data.get("NAME") or pm.findtext("k:name", default="Stream", namespaces=ns) or "Stream"
                points.append((lat, lon, name.strip()))
            except ValueError:
                pass
    return points

# ============================================================
# TEXT EXTRACTION
# ============================================================

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file."""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            return "".join(page.extract_text() or "" for page in pdf.pages)
    except Exception as e:
        print(f"ERROR: Could not extract text from {pdf_path}: {e}", file=sys.stderr)
        return None

def extract_text_from_string(text):
    """Already have text, just return it."""
    return text if text else None

# ============================================================
# CLAUDE PARSING
# ============================================================

def call_claude(pdf_name_or_id, text):
    """
    Parse announcement text with Claude.
    Returns list of district dicts.
    """
    print(f"  Calling Claude API...", file=sys.stderr)

    system_prompt = """You are a PWS (Prince William Sound) salmon fishery parser.
Extract all district openings/closings from the announcement text.

For each district mentioned:
{
  "district": "District Name",
  "status": "open" or "closed",
  "gear_types": ["drift_gillnet", "purse_seine", "set_gillnet"],
  "opens_at": "ISO8601 datetime or null",
  "closes_at": "ISO8601 datetime or null",
  "duration_hours": integer or null,
  "confidence": 0.0 to 1.0,
  "closures": [
    {
      "name": "closure area name",
      "definition": "description of closure",
      "closed_side": "north" | "south" | "east" | "west" | null,
      "points": [{"lat": 60.5, "lon": -145.5}, ...],
      "applies": "this_period" | "all_periods"
    }
  ],
  "excluded_subdistricts": ["name1", "name2"],
  "unscheduled_possible": true/false,
  "sonar_data": {
    "cumulative_actual": int or null,
    "cumulative_expected": int or null,
    "daily_count": int or null
  }
}

Return ONLY valid JSON array, no markdown, no preamble."""

    try:
        response = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=8096,
            messages=[
                {
                    "role": "user",
                    "content": text,
                }
            ],
            system=system_prompt,
        )

        content = response.content[0]
        if content.type != 'text':
            raise ValueError(f"Unexpected response type: {content.type}")

        # Parse JSON from response
        json_match = None
        json_str = content.text
        
        # Try to find JSON in the response
        if '[' in json_str:
            start = json_str.index('[')
            end = json_str.rfind(']') + 1
            json_str = json_str[start:end]

        try:
            districts = json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"  Raw response (first 500 chars): {json_str[:500]}", file=sys.stderr)
            raise e
        if not isinstance(districts, list):
            districts = [districts]

        return districts

    except Exception as e:
        print(f"ERROR: Claude parsing failed: {e}", file=sys.stderr)
        return []

# ============================================================
# HTML GENERATION (from original live_test.py)
# ============================================================

DISTRICT_COLORS = [
    '#3498db','#e74c3c','#27ae60','#f39c12','#9b59b6',
    '#1abc9c','#e91e63','#ff5722','#00bcd4','#8bc34a',
    '#ff9800','#607d8b','#795548',
]

GEAR_COLORS = {
    'drift_gillnet': '#2980b9',
    'purse_seine':   '#8e44ad',
    'set_gillnet':   '#27ae60',
}

def build_html(all_results, geojson_data, pdf_texts, awc_points):
    """Generate rich interactive HTML matching live_output3 style."""

    import datetime as _dt
    class _DateEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, (_dt.date, _dt.datetime)):
                return obj.isoformat()
            return super().default(obj)

    districts_gj  = json.dumps(geojson_data.get('districts',  {}), cls=_DateEncoder)
    subdistricts_gj = json.dumps(geojson_data.get('subdistricts', {}), cls=_DateEncoder)

    # ── Build district cards ──────────────────────────────────────
    cards_html = ""
    color_idx = 0
    for pdf_name, districts in all_results.items():
        if not districts:
            continue
        for d in districts:
            color = DISTRICT_COLORS[color_idx % len(DISTRICT_COLORS)]
            color_idx += 1
            district_id = d.get('district', 'unknown').lower().replace(' ', '_').replace('/', '_')
            status = d.get('status', 'unknown')
            status_html = (
                '<span class="status-open">OPEN</span>' if status == 'open'
                else '<span class="status-closed">CLOSED</span>'
            )

            # Gear badges
            gear_html = ""
            for g in (d.get('gear_types') or []):
                gc = GEAR_COLORS.get(g, '#555')
                label = g.replace('_', ' ').title()
                gear_html += f'<span class="badge" style="background:{gc}">{label}</span>'
            if not gear_html:
                gear_html = '<span class="no-gear">No gear mentioned</span>'

            # Time block
            opens  = d.get('opens_at')  or '—'
            closes = d.get('closes_at') or '—'
            dur    = d.get('duration_hours')
            dur_html = f'<div class="duration-tag">{dur}-hour period</div>' if dur else ''
            time_html = f"""<div class="time-block">
              <div class="time-row"><span class="time-label">Opens:</span><span class="time-val">{opens}</span></div>
              <div class="time-row"><span class="time-label">Closes:</span><span class="time-val">{closes}</span></div>
              {dur_html}
            </div>"""

            # Closures
            closures_html = ""
            for c in (d.get('closures') or []):
                applies_cls = 'allperiods' if c.get('applies') == 'all_periods' else 'period'
                applies_lbl = 'All Periods (Permanent)' if c.get('applies') == 'all_periods' else 'This Period Only'
                side = c.get('closed_side')
                side_html = f'<div class="closed-side-warning">Waters {side.upper()} of this line are CLOSED</div>' if side else ''
                pts = c.get('points') or []
                pts_rows = ''.join(f'<tr><td>{p.get("name","")}</td><td>{p.get("lat","")}</td><td>{p.get("lon","")}</td></tr>' for p in pts)
                pts_html = f'<table class="points-table"><thead><tr><th>Point</th><th>Lat</th><th>Lon</th></tr></thead><tbody>{pts_rows}</tbody></table>' if pts_rows else ''
                closures_html += f"""<div class="closure-entry">
                  <div class="closure-header">
                    <span class="closure-name">{c.get('name','')}</span>
                    <span class="applies-badge {applies_cls}">{applies_lbl}</span>
                  </div>
                  {side_html}
                  <div class="closure-desc">{c.get('definition','')}</div>
                  {pts_html}
                </div>"""
            if closures_html:
                closures_html = f'<div class="closures-section"><div class="closures-label">Internal Closure Areas</div>{closures_html}</div>'

            # Excluded subdistricts
            excl = d.get('excluded_subdistricts') or []
            excl_html = ""
            if excl:
                tags = ''.join(f'<span class="excl-tag subdistrict">{e}</span>' for e in excl)
                excl_html = f'<div class="excl-section"><div class="excl-label">Excluded from this opening:</div><div class="excl-list">{tags}</div></div>'

            # Sonar
            sonar = d.get('sonar_data') or {}
            sonar_html = ""
            if sonar.get('cumulative_actual') is not None:
                exp = sonar.get('cumulative_expected') or 1
                act = sonar.get('cumulative_actual', 0)
                pct = round(act / exp * 100) if exp else 0
                sonar_html = f'<div class="sonar-block"><span class="sonar-label">Sonar:</span> {act:,} cumulative ({pct}% of expected)</div>'

            # Confidence bar
            conf = d.get('confidence', 0)
            conf_pct = int(conf * 100)
            bar_color = '#27ae60' if conf >= 0.8 else ('#f39c12' if conf >= 0.6 else '#e74c3c')
            conf_html = f"""<div class="conf-row">
              <span class="conf-text">Parse confidence</span>
              <div class="conf-bar-wrap"><div class="conf-bar" style="width:{conf_pct}%;background:{bar_color}"></div>
              <span class="conf-label">{conf_pct}%</span></div>
            </div>"""

            notes = d.get('notes') or d.get('raw_text') or ''
            notes_html = f'<div class="card-notes">{notes}</div>' if notes else ''

            cards_html += f"""<div class="district-card" id="card-{district_id}" data-district="{district_id}" style="border-left:4px solid {color}">
              <div class="card-header">
                <div class="card-title-row">
                  <span class="district-dot" style="background:{color}"></span>
                  <h3 class="district-name">{d.get('district','Unknown')}</h3>
                </div>
                {status_html}
              </div>
              <div class="card-body">
                <div class="gear-row">{gear_html}</div>
                {time_html}
                {excl_html}
                {sonar_html}
                {closures_html}
                {conf_html}
                {notes_html}
              </div>
            </div>"""

    timestamp = datetime.now().strftime('%b %d, %Y %H:%M')

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ADF&G PWS Commercial Salmon</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
  :root{{--bg:#0f1117;--surface:#1a1d27;--surface2:#22263a;--border:#2e3250;--text:#e8eaf6;--muted:#8890b0;--open:#27ae60;--closed:#e74c3c;--warn:#f39c12;--radius:8px}}
  body{{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}}
  .cards-grid{{display:flex;flex-direction:column;gap:8px;padding:12px}}
  .district-card{{background:var(--surface);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:background 0.15s}}
  .district-card:hover{{background:var(--surface2)}}
  .district-card.highlighted{{background:var(--surface2);outline:1px solid var(--border)}}
  .card-header{{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 6px}}
  .card-title-row{{display:flex;align-items:center;gap:8px}}
  .district-dot{{width:10px;height:10px;border-radius:50%;flex-shrink:0}}
  .district-name{{font-size:13px;font-weight:600}}
  .status-open{{color:var(--open);font-size:11px;font-weight:700}}
  .status-closed{{color:var(--closed);font-size:11px;font-weight:700}}
  .card-body{{padding:0 12px 12px;display:flex;flex-direction:column;gap:7px}}
  .gear-row{{display:flex;flex-wrap:wrap;gap:4px}}
  .badge{{color:white;font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;letter-spacing:.3px}}
  .no-gear{{font-size:11px;color:var(--muted);font-style:italic}}
  .time-block{{background:var(--surface2);border-radius:6px;padding:7px 10px;display:flex;flex-direction:column;gap:3px}}
  .time-row{{display:flex;gap:6px;font-size:11px}}
  .time-label{{color:var(--muted);min-width:36px}}
  .time-val{{color:var(--text)}}
  .duration-tag{{font-size:10px;color:var(--warn);font-weight:600;margin-top:2px}}
  .excl-section{{display:flex;flex-direction:column;gap:4px}}
  .excl-label{{font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px}}
  .excl-list{{display:flex;flex-wrap:wrap;gap:4px}}
  .excl-tag{{font-size:10px;padding:2px 7px;border-radius:4px;font-weight:500}}
  .excl-tag.subdistrict{{background:rgba(52,152,219,.15);color:#74b9e0;border:1px solid rgba(52,152,219,.3)}}
  .sonar-block{{font-size:11px;color:var(--muted);background:var(--surface2);padding:6px 10px;border-radius:5px}}
  .closures-section{{border-top:1px solid var(--border);padding-top:7px}}
  .closures-label{{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}}
  .closure-entry{{background:rgba(231,76,60,.06);border:1px solid rgba(231,76,60,.2);border-radius:5px;padding:7px 9px;margin-bottom:5px}}
  .closure-header{{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px}}
  .closure-name{{font-size:11px;font-weight:700;color:#ff9999}}
  .closed-side-warning{{font-size:11px;font-weight:700;color:#e74c3c;background:rgba(231,76,60,.15);padding:4px 8px;border-radius:4px;border-left:3px solid #e74c3c;margin-bottom:4px}}
  .closure-desc{{font-size:11px;color:var(--muted);margin-bottom:4px}}
  .applies-badge{{font-size:9px;padding:1px 6px;border-radius:3px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}}
  .applies-badge.period{{background:rgba(231,76,60,.15);color:#e74c3c;border:1px solid rgba(231,76,60,.3)}}
  .applies-badge.allperiods{{background:rgba(231,76,60,.3);color:#ff4444;border:1px solid rgba(231,76,60,.5)}}
  .points-table{{width:100%;border-collapse:collapse;font-size:10px}}
  .points-table th{{color:var(--muted);font-weight:600;text-align:left;padding:2px 6px;border-bottom:1px solid var(--border)}}
  .points-table td{{padding:2px 6px;color:#a0b0d0;font-family:monospace}}
  .conf-row{{display:flex;align-items:center;gap:8px}}
  .conf-text{{font-size:10px;color:var(--muted);min-width:64px}}
  .conf-bar-wrap{{flex:1;background:var(--surface2);border-radius:3px;height:6px;display:flex;align-items:center}}
  .conf-bar{{height:6px;border-radius:3px}}
  .conf-label{{font-size:10px;color:var(--muted);margin-left:6px;min-width:28px}}
  .card-notes{{font-size:10px;color:var(--muted);font-style:italic;padding-top:2px}}
  #map{{width:100%;height:100vh}}
</style>
</head>
<body>
<div class="cards-grid" id="cards">
{cards_html}
</div>
<script>
const DISTRICTS_GJ = {districts_gj};
const SUBDISTRICTS_GJ = {subdistricts_gj};
</script>
</body>
</html>"""

# ============================================================
# DATE EXTRACTION
# ============================================================

def extract_announcement_date(text):
    """Extract the announcement date from text using regex."""
    import re
    from datetime import datetime as _datetime

    # "July 19, 2023" or "July 19 2023"
    m = re.search(
        r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b',
        text, re.IGNORECASE
    )
    if m:
        try:
            dt = _datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", '%B %d %Y')
            return dt.strftime('%Y-%m-%d')
        except Exception:
            pass

    # MM/DD/YYYY or M/D/YYYY
    m = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b', text)
    if m:
        try:
            dt = _datetime.strptime(f"{m.group(1)}/{m.group(2)}/{m.group(3)}", '%m/%d/%Y')
            return dt.strftime('%Y-%m-%d')
        except Exception:
            pass

    return None

# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='PWS Announcement Parser')
    parser.add_argument('--pdf-path', type=str, help='Path to PDF file (local mode)')
    parser.add_argument('--input-text', type=str, help='Announcement text (server mode)')
    parser.add_argument('--announcement-id', type=int, help='Announcement ID (server mode)')
    parser.add_argument('--output', type=str, help='Output HTML path')
    
    args = parser.parse_args()

    # Get input text
    if args.input_text:
        text = args.input_text
        pdf_name = f'announcement_{args.announcement_id}'
    elif args.pdf_path:
        text = extract_text_from_pdf(args.pdf_path)
        pdf_name = Path(args.pdf_path).name
        if not text:
            print("ERROR: Could not extract text from PDF", file=sys.stderr)
            sys.exit(1)
    else:
        print("ERROR: Provide --pdf-path or --input-text", file=sys.stderr)
        sys.exit(1)

    # Parse
    print(f"Parsing {pdf_name}...", file=sys.stderr)
    
    print("Loading shapefiles...", file=sys.stderr)
    geojson_data = load_shapefiles()
    
    print("Calling Claude...", file=sys.stderr)
    districts = call_claude(pdf_name, text)
    
    if not districts:
        print("ERROR: Claude parsing returned no results", file=sys.stderr)
        sys.exit(1)

    print(f"Parsed {len(districts)} district(s)", file=sys.stderr)
    for d in districts:
        print(f"  · {d.get('district')} — {d.get('status')} — confidence: {d.get('confidence', '?')}", file=sys.stderr)

    # Load AWC points
    print("Loading AWC stream points...", file=sys.stderr)
    awc_points = load_awc_points()

    # Generate HTML
    print("Generating HTML...", file=sys.stderr)
    all_results = {pdf_name: districts}
    html = build_html(all_results, geojson_data, {pdf_name: text}, awc_points)

    # Write output
    output_path = args.output or Path('live_output.html')
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        f.write(html)

    print(f"✓ Saved to {output_path}", file=sys.stderr)

    # Extract announcement date from text
    announcement_date = extract_announcement_date(text)
    has_open = any(d.get('status') == 'open' for d in districts)
    district_names = [d.get('district', '') for d in districts if d.get('district')]

    # Extract opening window from parsed districts
    opens_times  = [d['opens_at']  for d in districts if d.get('opens_at')]
    closes_times = [d['closes_at'] for d in districts if d.get('closes_at')]
    earliest_opens_at = min(opens_times)  if opens_times  else None
    latest_closes_at  = max(closes_times) if closes_times else None

    # Print structured JSON to stdout for the Node.js backend to read
    print(json.dumps({
        "districts": district_names,
        "announcement_date": announcement_date,
        "has_open": has_open,
        "earliest_opens_at": earliest_opens_at,
        "latest_closes_at": latest_closes_at,
    }))
    sys.exit(0)

if __name__ == '__main__':
    main()
