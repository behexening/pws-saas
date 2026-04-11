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
from shapely.geometry import Point, shape, Polygon, box, MultiPolygon, LineString
from shapely.ops import unary_union, split
from shapely.validation import make_valid

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

For each district mentioned return one JSON object:
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
      "definition": "exact text description of the closure boundary",
      "closed_side": "north" | "south" | "east" | "west",
      "points": [{"name": "Point Name", "lat": 60.5, "lon": -145.5}, ...],
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

CRITICAL rules for closures:
- closed_side MUST always be set: use "north"/"south"/"east"/"west" based on the direction word in the text (e.g. "north of a line" → "north", "east of longitude" → "east"). Never return null for closed_side.
- points MUST include every named coordinate point mentioned in the closure definition. If the text gives lat/lon for Entrance Point and Potato Point, include both with their exact coordinates. If a point has no explicit coordinates in the text, omit it from points rather than guessing. Extract coordinates in DMS format and convert to decimal degrees (e.g. 61° 05.00' N = 61.0833, 146° 38.00' W = -146.6333).
- If closure is defined by a single meridian ("east of longitude 146° 32.00' W"), points should be empty and closed_side="east". The definition text will let us reconstruct the line.
- If a closure's "name" is a registered subdistrict (e.g. "Port Fidalgo Subdistrict", "Port Chalmers Subdistrict", "Bettles Bay Subdistrict", "Perry Island Subdistrict", "Cannery Creek Subdistrict", "Valdez Narrows Subdistrict", "Main Bay Subdistrict", etc.), write the name EXACTLY as "<Name> Subdistrict" so the downstream code can match it to the shapefile and remove the whole subdistrict polygon.
- If a subdistrict is being EXCLUDED from an opening (e.g. "Waters of Montague District, excluding the Port Chalmers Subdistrict, will open"), put it in "excluded_subdistricts" — NOT in "closures". Again, use the exact "<Name> Subdistrict" form.

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

# ============================================================
# SHAPELY GEOMETRY HELPERS
# ============================================================

def infer_closed_side(text):
    """Infer which side is closed from closure name or definition text."""
    import re
    t = (text or '').lower()
    if re.search(r'\bnorth\s+of\b', t): return 'north'
    if re.search(r'\bsouth\s+of\b', t): return 'south'
    if re.search(r'\beast\s+of\b',  t): return 'east'
    if re.search(r'\bwest\s+of\b',  t): return 'west'
    # fallback: bare compass word
    if 'north' in t: return 'north'
    if 'south' in t: return 'south'
    if 'east'  in t: return 'east'
    if 'west'  in t: return 'west'
    return None


def extract_coord_pairs(text):
    """Extract all lat/lon pairs embedded in text.
    Handles DMS like '61° 05.00' N, 146° 38.00' W' and decimal forms.
    Returns list of [lon, lat] pairs (GeoJSON order).
    """
    import re
    pairs = []

    # DMS lat+lon together: 61° 05.00' N, 146° 38.00' W
    dms_both = re.findall(
        r'(\d{1,2})\s*[°º]\s*(\d+(?:\.\d+)?)[\'′]?\s*N[.,\s]+(\d{2,3})\s*[°º]\s*(\d+(?:\.\d+)?)[\'′]?\s*W',
        text, re.IGNORECASE
    )
    for m in dms_both:
        lat = float(m[0]) + float(m[1]) / 60
        lon = -(float(m[2]) + float(m[3]) / 60)
        pairs.append([lon, lat])

    # Decimal: 61.0833 N, 146.6333 W
    dec_both = re.findall(
        r'(\d{2}\.\d+)\s*N[.,\s]+(\d{2,3}\.\d+)\s*W',
        text, re.IGNORECASE
    )
    for m in dec_both:
        pairs.append([-float(m[1]), float(m[0])])

    return pairs


def parse_simple_boundary(definition):
    """Extract a single pivot coordinate from text-only boundary definitions
    that reference a single meridian or parallel ('east of longitude X').
    Returns (lon, None) for a meridian, (None, lat) for a parallel, or (None, None).
    """
    import re

    # Longitude DMS: 146° 32.00' W
    lon_m = re.search(r'(\d{2,3})\s*[°º]\s*(\d+(?:\.\d+)?)[\'′]?\s*W', definition, re.IGNORECASE)
    if lon_m:
        return -(float(lon_m.group(1)) + float(lon_m.group(2)) / 60), None

    # Longitude decimal: longitude 146.533 W
    dec_lon = re.search(r'longitude\s+(\d{2,3}\.\d+)\s*[°\s]*W', definition, re.IGNORECASE)
    if dec_lon:
        return -float(dec_lon.group(1)), None

    # Latitude DMS: 60° 50.76' N
    lat_m = re.search(r'(\d{1,2})\s*[°º]\s*(\d+(?:\.\d+)?)[\'′]?\s*N', definition, re.IGNORECASE)
    if lat_m:
        return None, float(lat_m.group(1)) + float(lat_m.group(2)) / 60

    # Latitude decimal: 60.846 N lat
    dec_lat = re.search(r'(\d{2}\.\d+)\s*[°]?\s*N\.?\s*lat', definition, re.IGNORECASE)
    if dec_lat:
        return None, float(dec_lat.group(1))

    return None, None


def _build_half_plane(closed_side, coords, district_geom):
    """Build a large half-plane polygon on the closed side of the closure line."""
    minx, miny, maxx, maxy = district_geom.bounds
    B = 1.5

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    lon_span = max(lons) - min(lons)
    lat_span = max(lats) - min(lats)

    if lon_span < 0.001:  # meridian
        lon = sum(lons) / len(lons)
        if closed_side == 'east':  return box(lon,    miny-B, maxx+B, maxy+B)
        if closed_side == 'west':  return box(minx-B, miny-B, lon,    maxy+B)

    if lat_span < 0.001:  # parallel
        lat = sum(lats) / len(lats)
        if closed_side == 'north': return box(minx-B, lat,    maxx+B, maxy+B)
        if closed_side == 'south': return box(minx-B, miny-B, maxx+B, lat)

    # Diagonal: half-plane quadrilateral
    p1, p2 = coords[0], coords[-1]
    dx, dy = p2[0]-p1[0], p2[1]-p1[1]
    L = (dx**2+dy**2)**0.5
    if L < 1e-10: return None
    nx, ny = dx/L, dy/L
    ext = 10.0
    ep1 = (p1[0]-nx*ext, p1[1]-ny*ext)
    ep2 = (p2[0]+nx*ext, p2[1]+ny*ext)
    lp = (-ny, nx); rp = (ny, -nx)
    if   closed_side == 'north': perp = lp if lp[1] >= 0 else rp
    elif closed_side == 'south': perp = lp if lp[1] <  0 else rp
    elif closed_side == 'east':  perp = lp if lp[0] >= 0 else rp
    elif closed_side == 'west':  perp = lp if lp[0] <  0 else rp
    else: return None
    big = 20.0
    return Polygon([ep1, ep2,
                    (ep2[0]+perp[0]*big, ep2[1]+perp[1]*big),
                    (ep1[0]+perp[0]*big, ep1[1]+perp[1]*big)])


BAY_KEYWORDS = ('bay', 'cove', 'inlet', 'lagoon', 'pass', 'fiord', 'fjord', 'arm', 'harbor')


def _is_bay_named(closure_name):
    """True if the closure name references a small local feature (bay/cove/etc)."""
    n = (closure_name or '').lower()
    # Explicit exclusion of district/subdistrict-scale features
    if 'district' in n or 'subdistrict' in n:
        return False
    return any(w in n for w in BAY_KEYWORDS)


# ── PWS named-feature gazetteer (GNIS + OSM, built by scripts/build_feature_gazetteer.py) ──
_GAZETTEER = None
_GAZETTEER_PATH = Path(__file__).parent / 'data' / 'pws_gazetteer.json'

def _load_gazetteer():
    """Load and cache the PWS water-feature gazetteer. Returns {} on failure
    so the rest of the pipeline keeps working (with degraded precision)."""
    global _GAZETTEER
    if _GAZETTEER is not None:
        return _GAZETTEER
    if not _GAZETTEER_PATH.exists():
        print(f"WARNING: gazetteer not found at {_GAZETTEER_PATH}", file=sys.stderr)
        _GAZETTEER = {}
        return _GAZETTEER
    try:
        with open(_GAZETTEER_PATH) as f:
            _GAZETTEER = json.load(f)
    except Exception as e:
        print(f"WARNING: failed to load gazetteer: {e}", file=sys.stderr)
        _GAZETTEER = {}
    return _GAZETTEER


def _normalize_feature_name(name):
    """Normalize a closure name for gazetteer lookup. Strips punctuation,
    collapses whitespace, canonicalizes 'St./St' → 'saint', and strips
    trailing descriptors like 'Closure', 'Area', 'Section' so 'Port
    Valdez Closure' matches the gazetteer's 'Port Valdez'."""
    if not name:
        return ""
    import re
    n = name.lower().strip()
    n = re.sub(r"[^\w\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    n = re.sub(r"\bst\b", "saint", n)
    # Strip trailing descriptor words — closure names often add these
    for suffix in (" closure", " closed area", " area", " section",
                   " waters", " portion"):
        if n.endswith(suffix):
            n = n[:-len(suffix)].strip()
            break
    return n


def find_gazetteer_feature(name, district_geom=None):
    """Look up a named PWS water feature. When a name collides (e.g., two
    Sawmill Bays) disambiguate by district: pick the entry whose centroid
    lies inside `district_geom`. Returns entry dict or None."""
    gaz = _load_gazetteer()
    if not gaz:
        return None
    key = _normalize_feature_name(name)
    if not key:
        return None
    entry = gaz.get(key)
    if entry is None:
        return None
    # Single entry — no disambiguation needed
    if isinstance(entry, dict):
        return entry
    # Multiple entries — disambiguate by district containment
    if district_geom is not None:
        try:
            for e in entry:
                c = e.get('centroid')
                if not c:
                    continue
                if district_geom.contains(Point(c[0], c[1])):
                    return e
        except Exception:
            pass
    # Can't disambiguate — refuse the lookup rather than return the wrong one
    return None


def build_feature_scope(centroid, coords, synthesized, district_geom=None):
    """Build a polygon scope around a named feature's centroid.

    The scope is a circle centered on the gazetteer centroid, sized so it
    captures the whole feature but not its neighbors:

    - If real shore-marker `coords` are provided, radius = max distance
      from centroid to any shore marker × 1.25, clamped to [0.035, 0.12]°.
      That range is ~4-13km in PWS latitudes.
    - If `synthesized` (no shore markers, just a lat or lon line from the
      definition text), use 0.08° ≈ 9km — enough for any single bay.

    Returns a shapely Polygon, optionally intersected with district_geom
    so the scope never extends outside the district."""
    if centroid is None:
        return None
    cx, cy = centroid[0], centroid[1]
    if coords and not synthesized:
        try:
            dists = [
                ((float(p[0]) - cx) ** 2 + (float(p[1]) - cy) ** 2) ** 0.5
                for p in coords
            ]
            radius = max(dists) * 1.25
            radius = max(0.035, min(radius, 0.12))
        except Exception:
            radius = 0.08
    else:
        radius = 0.08
    try:
        buf = Point(cx, cy).buffer(radius)
    except Exception:
        return None
    if district_geom is not None:
        try:
            buf = buf.intersection(district_geom)
            if buf.is_empty:
                return None
        except Exception:
            pass
    return buf


def _polys_only(geom):
    """Extract polygon/multipolygon components from any shapely geometry."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in ('Polygon', 'MultiPolygon'):
        return geom
    if geom.geom_type == 'GeometryCollection':
        polys = [g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon')]
        if not polys:
            return None
        u = unary_union(polys)
        return u if not u.is_empty else None
    return None


def _extend_polyline(coords, extension=0.5):
    """Extend a polyline by `extension` degrees at both ends to ensure it
    fully crosses any district polygon when used with split().
    """
    if len(coords) < 2:
        return list(coords)
    # Extend at start (direction from coords[1] → coords[0])
    dx = coords[0][0] - coords[1][0]
    dy = coords[0][1] - coords[1][1]
    L = (dx*dx + dy*dy) ** 0.5
    if L > 1e-12:
        start = (coords[0][0] + dx/L * extension, coords[0][1] + dy/L * extension)
    else:
        start = tuple(coords[0])
    # Extend at end (direction from coords[-2] → coords[-1])
    dx = coords[-1][0] - coords[-2][0]
    dy = coords[-1][1] - coords[-2][1]
    L = (dx*dx + dy*dy) ** 0.5
    if L > 1e-12:
        end = (coords[-1][0] + dx/L * extension, coords[-1][1] + dy/L * extension)
    else:
        end = tuple(coords[-1])
    return [start] + [tuple(c) for c in coords] + [end]


def _pick_pieces_on_side(pieces, coords, closed_side):
    """From a list of polygon pieces, return those whose centroid lies on the
    closed side of the closure line.
    """
    mid_x = sum(c[0] for c in coords) / len(coords)
    mid_y = sum(c[1] for c in coords) / len(coords)
    keep = []
    for p in pieces:
        if p is None or p.is_empty or p.area <= 0:
            continue
        cx, cy = p.centroid.x, p.centroid.y
        if closed_side == 'north' and cy > mid_y: keep.append(p)
        elif closed_side == 'south' and cy < mid_y: keep.append(p)
        elif closed_side == 'east'  and cx > mid_x: keep.append(p)
        elif closed_side == 'west'  and cx < mid_x: keep.append(p)
    return keep


def get_closed_area(closed_side, coords, district_geom, bay_scope=False, synthesized=False, scope_geom=None):
    """Return the closed water area within `district_geom` for ONE closure.

    Parameters
    ----------
    closed_side : 'north'/'south'/'east'/'west'
    coords      : list of [lon, lat] points defining the closure boundary line
    district_geom : the (valid) district polygon the closure applies to
    bay_scope   : if True the closure is scoped to a local bay (not district-wide)
    synthesized : if True the coords were synthesized from a single meridian/parallel
                  in the definition text (no real shore markers given)
    scope_geom  : optional shapely polygon that constrains the closed area
                  geographically. When provided, the closed area is the
                  intersection of (district ∩ half-plane ∩ scope). This is
                  the authoritative path for closures whose name matches a
                  PWS gazetteer entry — the scope is a buffer around the
                  feature's GNIS centroid.

    Strategy:
    - If `scope_geom` is provided → trust it. Compute half-plane ∩ district
      ∩ scope and return. This is the cleanest path and bypasses every
      split-based heuristic.
    - If bay_scope and synthesized → we don't know where the bay is located
      along the parallel/meridian, so skip the cut entirely (return None).
    - If bay_scope (coords are real shore markers crossing a bay mouth):
      split the district along an extended version of the line and keep the
      small piece on the closed side. This is the BAY POCKET approach.
    - Otherwise (district-spanning closure): split the district along the
      extended polyline and take ALL pieces on the closed side.
    """
    if not coords or len(coords) < 2 or not closed_side:
        return None
    if district_geom is None or district_geom.is_empty:
        return None

    # Gazetteer-scoped closure — the named feature has a known location.
    # Use half-plane ∩ district ∩ scope. This bypasses split() entirely.
    if scope_geom is not None and not scope_geom.is_empty:
        hp = _build_half_plane(closed_side, coords, district_geom)
        if hp is None:
            # No half-plane built → treat the whole named feature as closed
            try:
                region = district_geom.intersection(scope_geom)
            except Exception as e:
                print(f"WARNING: gazetteer-only intersection failed: {e}", file=sys.stderr)
                return None
            return _polys_only(region)
        try:
            region = district_geom.intersection(hp).intersection(scope_geom)
        except Exception as e:
            print(f"WARNING: gazetteer scope intersection failed: {e}", file=sys.stderr)
            return None
        return _polys_only(region)

    # Bay referenced but no geographic anchor point — can't cut safely
    if bay_scope and synthesized:
        return None

    try:
        extended = _extend_polyline(coords, extension=2.0)
        line = LineString(extended)
    except Exception as e:
        print(f"WARNING: could not build closure line: {e}", file=sys.stderr)
        return None

    try:
        split_result = split(district_geom, line)
    except Exception as e:
        print(f"WARNING: split failed: {e}", file=sys.stderr)
        split_result = None

    pieces = []
    if split_result is not None and not split_result.is_empty:
        pieces = list(getattr(split_result, 'geoms', [split_result]))

    # If split produced no division (line didn't actually cross), fall back
    # to half-plane intersection.
    if len(pieces) < 2:
        hp = _build_half_plane(closed_side, coords, district_geom)
        if hp is None:
            return None
        try:
            result = district_geom.intersection(hp)
        except Exception:
            return None
        return _polys_only(result)

    closed_pieces = _pick_pieces_on_side(pieces, coords, closed_side)
    if not closed_pieces:
        return None

    closed_region = unary_union(closed_pieces)

    if bay_scope:
        # For bay closures we want only the SMALL bay pocket, not the large
        # connected main-district area. Keep only pieces within reasonable
        # distance of the actual closure line.
        line_only = LineString(coords)  # un-extended
        # Keep each connected piece iff it touches/is near the closure line.
        # Bay pockets are created by the shore markers crossing the mouth, so
        # they always abut the line, while the main district does too — we
        # need to distinguish by size instead.
        # Heuristic: keep pieces whose area is less than 30% of the district
        # area (real bay pockets are small; main district water is the big one).
        district_area = district_geom.area
        small_pieces = [p for p in closed_pieces if p.area < 0.30 * district_area]
        if small_pieces:
            closed_region = unary_union(small_pieces)
        else:
            # No small piece found — closure line didn't create a proper pocket.
            # Fall back to the buffer method to avoid over-closing.
            try:
                buf = line_only.buffer(0.14)  # ~15km
                hp = _build_half_plane(closed_side, coords, district_geom)
                if hp is not None:
                    clip = hp.intersection(buf)
                    closed_region = district_geom.intersection(clip)
            except Exception:
                return None

    return _polys_only(closed_region)


def extract_open_geom(district_geom, closures, excl_geoms):
    """Subtract closed areas and directly-subtracted geometries from the district.

    closures : list of dicts {closed_side, coords, bay_scope, synthesized}
    excl_geoms : list of shapely polygons to directly subtract (named subdistricts)
    """
    g = district_geom
    if g is None:
        return None
    if not g.is_valid:
        g = make_valid(g)
        g = _polys_only(g) or g

    # Direct subtractions first (named subdistricts). These are unambiguous
    # and should never be defeated by later geometric cuts.
    for excl in excl_geoms:
        try:
            if excl is None or excl.is_empty:
                continue
            if not excl.is_valid:
                excl = make_valid(excl)
                excl = _polys_only(excl) or excl
            g = g.difference(excl)
        except Exception as e:
            print(f"WARNING: direct subtract failed: {e}", file=sys.stderr)

    if g is None or g.is_empty:
        return None

    for c in closures:
        try:
            closed_area = get_closed_area(
                c.get('closed_side'),
                c.get('coords'),
                g,
                bay_scope=c.get('bay_scope', False),
                synthesized=c.get('synthesized', False),
                scope_geom=c.get('scope_geom'),
            )
            if closed_area is not None and not closed_area.is_empty:
                g = g.difference(closed_area)
                if g.is_empty:
                    print(
                        f"WARNING: district became empty after closure "
                        f"name={c.get('name')} side={c.get('closed_side')}",
                        file=sys.stderr,
                    )
                    return None
        except Exception as e:
            print(f"WARNING: closure subtraction failed ({c.get('name')}): {e}",
                  file=sys.stderr)

    return _polys_only(g)


def build_html(all_results, geojson_data, pdf_texts, awc_points):
    """Generate rich interactive HTML matching live_output3 style."""

    import datetime as _dt
    class _DateEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, (_dt.date, _dt.datetime)):
                return obj.isoformat()
            return super().default(obj)

    districts_gj    = json.dumps(geojson_data.get('districts',    {}), cls=_DateEncoder)
    subdistricts_gj = json.dumps(geojson_data.get('subdistricts', {}), cls=_DateEncoder)

    # ── Build Shapely geometry dicts from shapefiles ───────────────────────
    # Several PWS shapefiles have self-intersecting rings; make_valid() fixes
    # those so later .difference() / .intersection() operations produce clean
    # polygons instead of microfragments.
    district_geoms = {}   # lower-stripped DISTRICT_N → Shapely geom
    for feat in geojson_data.get('districts', {}).get('features', []):
        name = (feat['properties'].get('DISTRICT_N') or '').strip()
        if name and feat.get('geometry'):
            try:
                g = shape(feat['geometry'])
                if not g.is_valid:
                    g = make_valid(g)
                    g = _polys_only(g) or g
                district_geoms[name.lower()] = g
            except Exception as e:
                print(f"WARNING: shapely parse district '{name}': {e}", file=sys.stderr)

    # Subdistrict key → (district_key, geom)
    subd_geoms = {}
    subd_by_district = {}  # district_key → list of (subd_key, geom)
    for feat in geojson_data.get('subdistricts', {}).get('features', []):
        name = (feat['properties'].get('SUBDISTRIC') or '').strip()
        parent = (feat['properties'].get('DISTRICT_N') or '').strip().lower()
        if name and feat.get('geometry'):
            try:
                g = shape(feat['geometry'])
                if not g.is_valid:
                    g = make_valid(g)
                    g = _polys_only(g) or g
                key = name.lower()
                subd_geoms[key] = g
                if parent:
                    subd_by_district.setdefault(parent, []).append((key, g))
            except Exception as e:
                print(f"WARNING: shapely parse subd '{name}': {e}", file=sys.stderr)

    # ── Helper: fuzzy-match a district name to shapefile key ──────────────
    def find_district_key(d_name):
        """Return the matching key in district_geoms or None."""
        n = d_name.lower().strip()
        if n in district_geoms:
            return n
        # Try with/without " district" suffix
        if n + ' district' in district_geoms:
            return n + ' district'
        for k in district_geoms:
            if k.startswith(n) or n.startswith(k):
                return k
        return None

    def find_subd_key(subd_name):
        """Return the matching key in subd_geoms or None.

        Matching strategy (tightest → loosest):
        1. Exact match on the lowercased name
        2. Exact match with " subdistrict" suffix appended
        3. Exact match on the name with " subdistrict" stripped
        4. Prefix match of the core name (requires >= 6 characters to avoid
           matching generic words like "port" to random subdistricts)
        """
        if not subd_name:
            return None
        n = subd_name.lower().strip()
        if n in subd_geoms:
            return n
        if n + ' subdistrict' in subd_geoms:
            return n + ' subdistrict'
        short = n.replace(' subdistrict', '').strip()
        if short in subd_geoms:
            return short
        if len(short) >= 6:
            for k in subd_geoms:
                k_short = k.replace(' subdistrict', '').strip()
                if k_short == short or k.startswith(short) or short.startswith(k_short):
                    return k
        return None

    # ── Build CLOSURE_LINES + collect per-district closure specs ──────────
    #
    # User-specified policy (docs/geometrylogicsimple.md): if a named closure
    # or exclusion matches a subdistrict that already exists in the shapefile,
    # just subtract that subdistrict polygon directly — DO NOT try to apply
    # its lat/long definition on top of the district. Lat/long parsing is
    # ONLY for closures that don't correspond to a named subdistrict.
    closure_lines = []
    district_closure_specs = {}   # dk → list of closure dicts for extract_open_geom
    district_direct_subtract = {} # dk → list of (name, shapely geom) to subtract

    for pdf_name, districts in all_results.items():
        for d in districts:
            d_name = d.get('district', '')
            dk = find_district_key(d_name)
            d_geom = district_geoms.get(dk) if dk else None

            # Excluded subdistricts → always direct-subtract
            for excl_name in (d.get('excluded_subdistricts') or []):
                ek = find_subd_key(excl_name)
                if ek and ek in subd_geoms:
                    district_direct_subtract.setdefault(dk, []).append(
                        (excl_name, subd_geoms[ek]))

            for c in (d.get('closures') or []):
                c_name = c.get('name', '') or ''

                # STEP 1 — subdistrict name match: if the closure is named after
                # a subdistrict in the shapefile, remove the whole subdistrict
                # polygon and move on. This bypasses fragile lat/long parsing.
                ek = find_subd_key(c_name)
                if ek and ek in subd_geoms:
                    district_direct_subtract.setdefault(dk, []).append(
                        (c_name, subd_geoms[ek]))
                    # Still record the visual closure line (best-effort) if we
                    # can extract coords — useful for the sidebar card.
                    pts = c.get('points') or []
                    vis_coords = [[p.get('lon', 0), p.get('lat', 0)] for p in pts]
                    if len(vis_coords) >= 2:
                        closure_lines.append({
                            'name': c_name,
                            'closed_side': c.get('closed_side'),
                            'applies': c.get('applies', 'this_period'),
                            'coords': vis_coords,
                            'district': dk or d_name.lower().replace(' ', '_'),
                        })
                    continue  # done with this closure — skip lat/long parsing

                # STEP 2 — parse lat/long definition
                pts = c.get('points') or []
                coords = [[p.get('lon', 0), p.get('lat', 0)] for p in pts]
                synthesized = False

                closed_side = c.get('closed_side') or \
                    infer_closed_side(c.get('definition', '')) or \
                    infer_closed_side(c_name)

                if len(coords) < 2 and d_geom is not None:
                    definition = c.get('definition', '')
                    minx, miny, maxx, maxy = d_geom.bounds

                    extracted = extract_coord_pairs(definition)
                    if len(extracted) >= 2:
                        coords = extracted
                    else:
                        lon_val, lat_val = parse_simple_boundary(definition)
                        if lon_val is not None:
                            coords = [[lon_val, miny - 0.05], [lon_val, maxy + 0.05]]
                            synthesized = True
                        elif lat_val is not None:
                            coords = [[minx - 0.05, lat_val], [maxx + 0.05, lat_val]]
                            synthesized = True

                if len(coords) < 2 or not closed_side:
                    continue

                bay_scope = _is_bay_named(c_name)

                # STEP 3 — gazetteer lookup: if the closure name matches a
                # known PWS water feature, compute a geographic scope buffer
                # around its centroid. This bounds the cut so it can't spill
                # into the rest of the district.
                scope_geom = None
                gaz_entry = find_gazetteer_feature(c_name, d_geom)
                if gaz_entry is not None:
                    centroid = gaz_entry.get('centroid')
                    if centroid:
                        scope_geom = build_feature_scope(
                            centroid, coords, synthesized, district_geom=d_geom,
                        )

                closure_lines.append({
                    'name': c_name,
                    'closed_side': closed_side,
                    'applies': c.get('applies', 'this_period'),
                    'coords': coords,
                    'district': dk or d_name.lower().replace(' ', '_'),
                })

                if dk:
                    district_closure_specs.setdefault(dk, []).append({
                        'name': c_name,
                        'closed_side': closed_side,
                        'coords': coords,
                        'bay_scope': bay_scope,
                        'synthesized': synthesized,
                        'scope_geom': scope_geom,
                    })

    closure_lines_json = json.dumps(closure_lines, cls=_DateEncoder)

    # ── Pre-compute per-district colors (same order as cards loop) ────────
    district_colors_map = {}  # district_key → color hex
    _ci = 0
    for _pdf, _dists in all_results.items():
        for _d in _dists:
            _key = (_d.get('district', '') or '').lower().replace(' ', '_').replace('/', '_')
            district_colors_map[_key] = DISTRICT_COLORS[_ci % len(DISTRICT_COLORS)]
            _ci += 1

    # ── Compute OPEN_AREAS_GJ via Shapely polygon cutting ─────────────────
    open_areas_features = []
    seen_district_keys = set()

    for pdf_name, districts in all_results.items():
        for d in districts:
            if d.get('status') != 'open':
                continue
            d_name = d.get('district', '')
            dk = find_district_key(d_name)
            if not dk:
                continue
            d_geom = district_geoms.get(dk)
            if d_geom is None or d_geom.is_empty:
                continue

            district_key = d_name.lower().replace(' ', '_').replace('/', '_')
            # Skip duplicates (some announcements list the same district twice
            # under different gear types). Use the first entry's specs.
            if district_key in seen_district_keys:
                continue
            seen_district_keys.add(district_key)

            color = district_colors_map.get(district_key, DISTRICT_COLORS[0])

            closures = district_closure_specs.get(dk, [])
            excl_geoms_list = [g for (_name, g) in district_direct_subtract.get(dk, [])]

            open_geom = extract_open_geom(d_geom, closures, excl_geoms_list)
            if open_geom is None:
                print(f"WARNING: open area is empty/invalid for '{d_name}', skipping", file=sys.stderr)
                continue

            import shapely.geometry as _sg
            open_areas_features.append({
                'type': 'Feature',
                'properties': {
                    'district_key': district_key,
                    'district_name': d_name,
                    'color': color,
                },
                'geometry': _sg.mapping(open_geom),
            })

    open_areas_gj_json = json.dumps(
        {'type': 'FeatureCollection', 'features': open_areas_features},
        cls=_DateEncoder
    )

    # ── Build district cards ──────────────────────────────────────
    cards_html = ""
    for pdf_name, districts in all_results.items():
        if not districts:
            continue
        for d in districts:
            district_id = d.get('district', 'unknown').lower().replace(' ', '_').replace('/', '_')
            color = district_colors_map.get(district_id, DISTRICT_COLORS[0])
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
                act = sonar.get('cumulative_actual', 0)
                exp = sonar.get('cumulative_expected')
                if exp and exp > 0:
                    pct = round(act / exp * 100)
                    sonar_html = f'<div class="sonar-block"><span class="sonar-label">Sonar:</span> {act:,} cumulative ({pct}% of expected)</div>'
                else:
                    sonar_html = f'<div class="sonar-block"><span class="sonar-label">Sonar:</span> {act:,} cumulative</div>'

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
const CLOSURE_LINES = {closure_lines_json};
const OPEN_AREAS_GJ = {open_areas_gj_json};
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
