#!/usr/bin/env python3
"""
Build a gazetteer of named water features inside Prince William Sound
from two sources:

  1. USGS GNIS Domestic Names — Alaska subset (pipe-delimited text)
     → gives us a representative point for every named bay/cove/inlet
       in the state, plus official feature_class / feature_id.

  2. OpenStreetMap — Alaska extract (.osm.pbf)
     → gives us polygons where OSM has them (tagged natural=bay,
       natural=strait, place=sea, water=bay/lagoon/cove, etc.)

Output:

  data/pws_features.geojson   — FeatureCollection, one feature per named
                                 water body, geometry=polygon if OSM has
                                 one, else point from GNIS.
  data/pws_gazetteer.json     — dict keyed by normalized name →
                                 {name, lat, lon, feature_class, source,
                                  gnis_id, has_polygon}

Both files are derived, cacheable, and safe to commit.

Usage:
  python3 scripts/build_feature_gazetteer.py

Inputs expected at:
  data/OSM&GNIS/Text/DomesticNames_AK.txt
  data/OSM&GNIS/alaska-260410.osm.pbf
"""
import json
import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "data" / "OSM&GNIS"
GNIS_TXT = SRC_DIR / "Text" / "DomesticNames_AK.txt"
OSM_PBF = next(SRC_DIR.glob("alaska-*.osm.pbf"), None)
OUT_GJ = ROOT / "data" / "pws_features.geojson"
OUT_GAZ = ROOT / "data" / "pws_gazetteer.json"

# Prince William Sound bounding box (generous — we'll intersect more
# precisely against district polygons if needed later).
PWS_MINLON = -149.0
PWS_MAXLON = -143.8
PWS_MINLAT = 59.3
PWS_MAXLAT = 61.3

# GNIS feature classes that can appear in a closure scope.
# Note: GNIS 2026 schema collapses Cove/Inlet/Fiord/Lagoon/Harbor/Arm all
# under "Bay" — the granular class names from the old schema are gone.
# "Channel" covers things like Valdez Narrows. "Gut" covers narrow tidal
# passages. "Sea" is reserved for Prince William Sound itself.
GNIS_CLASSES = {
    "Bay", "Channel", "Gut", "Sea",
}

# OSM tag filters that identify named water bodies.
def osm_is_water_feature(tags):
    nat = tags.get("natural")
    if nat in ("bay", "strait"):
        return True
    pl = tags.get("place")
    if pl in ("sea", "ocean"):
        return True
    w = tags.get("water")
    if w in ("bay", "lagoon", "cove"):
        return True
    return False


def in_pws(lat, lon):
    return (PWS_MINLAT <= lat <= PWS_MAXLAT and
            PWS_MINLON <= lon <= PWS_MAXLON)


def normalize_name(name):
    """Normalize for name matching: lowercase, strip punctuation,
    collapse whitespace, canonicalize 'Saint'/'St.'/'St' → 'saint'.
    Keeps the full name including suffixes like 'Bay', 'Cove' — we
    match on the full form so 'Jack Bay' doesn't collide with 'Jack
    Cove'."""
    if not name:
        return ""
    n = name.lower().strip()
    n = re.sub(r"[^\w\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # Canonicalize saint abbreviations
    n = re.sub(r"\bst\b", "saint", n)
    return n


# --------------------------------------------------------------------
# GNIS
# --------------------------------------------------------------------

def load_gnis():
    """Parse the pipe-delimited Alaska GNIS file, filter to water
    feature classes inside PWS, return list of dicts."""
    features = []
    with open(GNIS_TXT, encoding="utf-8-sig") as f:
        header = f.readline().rstrip("\n").split("|")
        col = {name: i for i, name in enumerate(header)}
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) != len(header):
                continue
            fclass = parts[col["feature_class"]]
            if fclass not in GNIS_CLASSES:
                continue
            try:
                lat = float(parts[col["prim_lat_dec"]])
                lon = float(parts[col["prim_long_dec"]])
            except ValueError:
                continue
            if lat == 0.0 and lon == 0.0:
                continue
            if not in_pws(lat, lon):
                continue
            features.append({
                "gnis_id": parts[col["feature_id"]],
                "name": parts[col["feature_name"]],
                "feature_class": fclass,
                "lat": lat,
                "lon": lon,
                "county": parts[col["county_name"]],
            })
    return features


# --------------------------------------------------------------------
# OSM
# --------------------------------------------------------------------

def load_osm_polygons():
    """Walk the .osm.pbf once, collecting polygon geometry for every
    water feature inside the PWS bbox. Returns list of dicts with
    geometry as GeoJSON."""
    import osmium
    from osmium import FileProcessor
    from osmium.geom import GeoJSONFactory

    geojson = GeoJSONFactory()
    results = []

    # Use .with_areas() to have osmium build areas from closed ways
    # and multipolygon relations. Then we filter by tags.
    fp = FileProcessor(str(OSM_PBF)).with_areas()

    for obj in fp:
        # Point features (nodes tagged natural=bay etc.)
        if obj.is_node():
            tags = dict(obj.tags)
            if not osm_is_water_feature(tags):
                continue
            lat = obj.location.lat
            lon = obj.location.lon
            if not in_pws(lat, lon):
                continue
            results.append({
                "name": tags.get("name", ""),
                "osm_id": f"node/{obj.id}",
                "osm_type": "node",
                "tags": {k: v for k, v in tags.items() if k in ("natural", "place", "water", "name")},
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            })
            continue

        # Area features (closed ways + multipolygon relations)
        if hasattr(obj, "is_area") and obj.is_area():
            tags = dict(obj.tags)
            if not osm_is_water_feature(tags):
                continue
            try:
                gj_str = geojson.create_multipolygon(obj)
            except Exception:
                continue
            try:
                geom = json.loads(gj_str)
            except Exception:
                continue
            # Check bbox overlap with PWS
            try:
                from shapely.geometry import shape as _shape
                from shapely.geometry import box as _box
                s = _shape(geom)
                if s.is_empty:
                    continue
                pws_box = _box(PWS_MINLON, PWS_MINLAT, PWS_MAXLON, PWS_MAXLAT)
                if not s.intersects(pws_box):
                    continue
            except Exception:
                pass
            # Area id in osmium is encoded as 2*way_id or 2*rel_id+1
            osm_type = "relation" if obj.from_way() is False else "way"
            src_id = obj.orig_id()
            results.append({
                "name": tags.get("name", ""),
                "osm_id": f"{osm_type}/{src_id}",
                "osm_type": osm_type,
                "tags": {k: v for k, v in tags.items() if k in ("natural", "place", "water", "name")},
                "geometry": geom,
            })
    return results


# --------------------------------------------------------------------
# Merge
# --------------------------------------------------------------------

def merge(gnis_feats, osm_feats):
    """For each GNIS feature, try to attach an OSM polygon whose name
    matches. OSM features with no GNIS match still get kept — they
    might be the only record of some feature."""
    # Index OSM features by normalized name
    osm_by_name = {}
    for f in osm_feats:
        key = normalize_name(f.get("name", ""))
        if not key:
            continue
        osm_by_name.setdefault(key, []).append(f)

    merged = []
    used_osm = set()
    for g in gnis_feats:
        key = normalize_name(g["name"])
        osm_matches = osm_by_name.get(key, [])
        polygon_match = next(
            (o for o in osm_matches if o["geometry"]["type"] != "Point"),
            None,
        )
        # Prefer OSM polygon when available; otherwise use GNIS point (authoritative).
        if polygon_match is not None:
            used_osm.add(polygon_match["osm_id"])
            geometry = polygon_match["geometry"]
            source = "osm_polygon"
            osm_id = polygon_match["osm_id"]
        else:
            geometry = {"type": "Point", "coordinates": [g["lon"], g["lat"]]}
            source = "gnis_point"
            osm_id = None
        # Mark OSM point matches as used so they don't get re-added as
        # osm_only duplicates later.
        for o in osm_matches:
            if o["geometry"]["type"] == "Point":
                used_osm.add(o["osm_id"])

        entry = {
            "name": g["name"],
            "feature_class": g["feature_class"],
            "gnis_id": g["gnis_id"],
            "county": g["county"],
            "gnis_lat": g["lat"],
            "gnis_lon": g["lon"],
            "osm_id": osm_id,
            "has_polygon": bool(polygon_match),
            "geometry": geometry,
            "source": source,
        }
        merged.append(entry)

    # Include any OSM features that didn't match a GNIS entry
    for f in osm_feats:
        if f["osm_id"] in used_osm:
            continue
        name = f.get("name") or ""
        if not name.strip():
            continue
        merged.append({
            "name": name,
            "feature_class": None,
            "gnis_id": None,
            "county": None,
            "gnis_lat": None,
            "gnis_lon": None,
            "osm_id": f["osm_id"],
            "has_polygon": f["geometry"]["type"] != "Point",
            "geometry": f["geometry"],
            "source": "osm_only",
        })

    return merged


# --------------------------------------------------------------------
# Output
# --------------------------------------------------------------------

def write_outputs(merged):
    fc = {"type": "FeatureCollection", "features": []}
    gaz = {}
    for m in merged:
        props = {k: v for k, v in m.items() if k != "geometry"}
        fc["features"].append({
            "type": "Feature",
            "geometry": m["geometry"],
            "properties": props,
        })
        key = normalize_name(m["name"])
        if not key:
            continue
        # If two entries collide on normalized name (e.g., multiple
        # Sawmill Bays), keep a list.
        entry = {
            "name": m["name"],
            "feature_class": m["feature_class"],
            "gnis_id": m["gnis_id"],
            "osm_id": m["osm_id"],
            "has_polygon": m["has_polygon"],
            "source": m["source"],
            "centroid": _centroid(m["geometry"]),
        }
        if key in gaz:
            existing = gaz[key]
            if isinstance(existing, list):
                existing.append(entry)
            else:
                gaz[key] = [existing, entry]
        else:
            gaz[key] = entry

    OUT_GJ.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_GJ, "w") as f:
        json.dump(fc, f)
    with open(OUT_GAZ, "w") as f:
        json.dump(gaz, f, indent=2)


def _centroid(geom):
    from shapely.geometry import shape
    try:
        c = shape(geom).centroid
        return [round(c.x, 6), round(c.y, 6)]
    except Exception:
        return None


def main():
    if not GNIS_TXT.exists():
        sys.exit(f"ERROR: GNIS text file not found at {GNIS_TXT}")
    if OSM_PBF is None or not OSM_PBF.exists():
        sys.exit(f"ERROR: OSM PBF not found in {SRC_DIR}")

    print(f"Loading GNIS from {GNIS_TXT.name}...")
    gnis = load_gnis()
    print(f"  {len(gnis)} water features inside PWS bbox")
    fclass_counts = {}
    for g in gnis:
        fclass_counts[g["feature_class"]] = fclass_counts.get(g["feature_class"], 0) + 1
    for k, v in sorted(fclass_counts.items(), key=lambda x: -x[1]):
        print(f"    {k:12s} {v}")

    print(f"\nLoading OSM water features from {OSM_PBF.name}...")
    osm = load_osm_polygons()
    poly_count = sum(1 for o in osm if o["geometry"]["type"] != "Point")
    pt_count = len(osm) - poly_count
    print(f"  {poly_count} polygon features, {pt_count} point features")

    print("\nMerging GNIS + OSM...")
    merged = merge(gnis, osm)
    with_poly = sum(1 for m in merged if m["has_polygon"])
    print(f"  {len(merged)} total merged features, {with_poly} with polygon")

    write_outputs(merged)
    print(f"\nWrote {OUT_GJ.relative_to(ROOT)}  ({OUT_GJ.stat().st_size} bytes)")
    print(f"Wrote {OUT_GAZ.relative_to(ROOT)}  ({OUT_GAZ.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
