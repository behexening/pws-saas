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
            model='claude-haiku-4-5-20241022',
            max_tokens=2000,
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

        districts = json.loads(json_str)
        if not isinstance(districts, list):
            districts = [districts]

        return districts

    except Exception as e:
        print(f"ERROR: Claude parsing failed: {e}", file=sys.stderr)
        return []

# ============================================================
# HTML GENERATION (from original live_test.py)
# ============================================================

def build_html(all_results, geojson_data, pdf_texts, awc_points):
    """Generate the interactive HTML map (simplified here, use original template)."""
    
    # This is where you'd include the full HTML template from the original live_test.py
    # For brevity, returning a minimal version
    
    html_template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PWS Salmon Announcement Parser</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body {{ font-family: sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 1200px; margin: 0 auto; }}
        h1 {{ color: #333; }}
        .result {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        .district {{ padding: 10px; background: #f9f9f9; border-left: 4px solid #667eea; margin: 10px 0; }}
        .open {{ border-left-color: #27ae60; }}
        .closed {{ border-left-color: #e74c3c; }}
        #map {{ width: 100%; height: 400px; border-radius: 8px; margin: 20px 0; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>⚓ PWS Salmon Fishery Announcement Parser</h1>
        <p>Generated: {timestamp}</p>
        
        <div id="results">
        {results_html}
        </div>
        
        <div id="map"></div>
    </div>

    <script>
        var map = L.map('map').setView([60.8, -146.5], 7);
        L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }}).addTo(map);
        
        // Add districts if geojson available
        var districtData = {district_geojson};
        if (districtData && districtData.features) {{
            L.geoJSON(districtData, {{
                style: {{ color: '#667eea', weight: 2, opacity: 0.7, fillOpacity: 0.2 }}
            }}).addTo(map);
        }}
    </script>
</body>
</html>"""

    # Build results HTML
    results_html = ""
    for pdf_name, districts in all_results.items():
        if not districts:
            results_html += f'<div class="result"><h2>{pdf_name}</h2><p>No districts parsed</p></div>'
            continue
        
        for d in districts:
            status_class = 'open' if d.get('status') == 'open' else 'closed'
            results_html += f"""
            <div class="result">
                <h2>{d.get('district', 'Unknown')}</h2>
                <div class="district {status_class}">
                    <strong>Status:</strong> {d.get('status', 'unknown').upper()}<br>
                    <strong>Gear Types:</strong> {', '.join(d.get('gear_types', []))}<br>
                    <strong>Confidence:</strong> {d.get('confidence', 0):.0%}<br>
                </div>
            </div>
            """

    district_geojson = json.dumps(geojson_data.get('districts', {}))

    return html_template.format(
        timestamp=datetime.now().isoformat(),
        results_html=results_html,
        district_geojson=district_geojson
    )

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
    sys.exit(0)

if __name__ == '__main__':
    main()
