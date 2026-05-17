#!/usr/bin/env python3
"""Generate the buffer-style permanent closures from 5 AAC 24.350.

The DONECLOSURES.shp polygons cover the regulations that describe a closed
area with a line+side ("south of a line from X to Y"). The rules in this
script cover the remaining patterns:

  - "within R yds of the terminus of all salmon streams [scope]"
  - "within R yds of the [N/S/E/W] shore from point A to point B"

For each rule, buffer the relevant feature(s) by the override radius,
intersect with the district / bay scope so we don't leak into unrelated
waters, and write a single FeatureCollection.

Inputs:
  public/awc-points.json
  data/PWS_Districts_2024/districts.shp

Output:
  data/closedwaters/buffer_closures.geojson
"""

import json
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import (
    Point, LineString, Polygon, MultiPolygon, box, mapping, shape,
)
from shapely.ops import nearest_points, substring, transform as shp_transform, unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent.parent
AWC_PATH = ROOT / "public" / "awc-points.json"
DISTRICTS_SHP = ROOT / "data" / "PWS_Districts_2024" / "districts.shp"
OUT_PATH = ROOT / "data" / "closedwaters" / "buffer_closures.geojson"
OVERRIDES_PATH = ROOT / "public" / "awc-point-overrides.json"

YARDS_TO_M = 0.9144
TO_M = Transformer.from_crs("EPSG:4326", "EPSG:3338", always_xy=True).transform
TO_WGS = Transformer.from_crs("EPSG:3338", "EPSG:4326", always_xy=True).transform


def buffer_yards(geom, yards):
    """Reproject to Alaska Albers (meters), buffer by R yards, reproject back."""
    g_m = shp_transform(TO_M, geom)
    buf = g_m.buffer(yards * YARDS_TO_M)
    return shp_transform(TO_WGS, buf)


def valid(g):
    if g is None or g.is_empty:
        return g
    if not g.is_valid:
        g = make_valid(g)
    return g


def load_districts():
    sf = shapefile.Reader(str(DISTRICTS_SHP))
    fields = [f[0] for f in sf.fields[1:]]
    out = {}
    for rec in sf.shapeRecords():
        attrs = dict(zip(fields, rec.record))
        g = valid(shape(rec.shape.__geo_interface__))
        out[attrs["DISTRICT_N"]] = g
    return out


def load_awc():
    return json.loads(AWC_PATH.read_text())


def filter_awc(awc, *, lat_min=None, lat_max=None, lon_min=None, lon_max=None,
               bbox=None, name_substring=None, exclude_awc_ids=None):
    """Returns the full AWC point dicts that pass the filter."""
    exclude_awc_ids = set(exclude_awc_ids or [])
    pts = []
    for p in awc:
        if p.get("awc") in exclude_awc_ids:
            continue
        if lat_min is not None and p["lat"] < lat_min:
            continue
        if lat_max is not None and p["lat"] > lat_max:
            continue
        if lon_min is not None and p["lon"] < lon_min:
            continue
        if lon_max is not None and p["lon"] > lon_max:
            continue
        if bbox is not None and not bbox.contains(Point(p["lon"], p["lat"])):
            continue
        if name_substring is not None and name_substring.lower() not in p["name"].lower():
            continue
        pts.append(p)
    return pts


def _round_coords(obj, precision=6):
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, (list, tuple)):
        return [_round_coords(v, precision) for v in obj]
    if isinstance(obj, dict):
        return {k: _round_coords(v, precision) for k, v in obj.items()}
    return obj


def stream_buffer_feature(awc, yards, *, scope_geom=None, rule, overrides=None,
                          **filter_kwargs):
    """Build a stream-buffer feature AND, if `overrides` dict provided, record
    `{awc_id: {radius_yds, rule}}` for each matched point so the frontend
    AWC overlay can draw correctly-sized circles."""
    pts = filter_awc(awc, **filter_kwargs)
    # Pre-filter to scope so we don't buffer streams from unrelated waters,
    # then clip the buffer to scope to trim any spillover into adjacent waters.
    if scope_geom is not None:
        pts = [p for p in pts if scope_geom.contains(Point(p["lon"], p["lat"]))]
    if not pts:
        return None
    if overrides is not None:
        for p in pts:
            awc_id = p.get("awc")
            if not awc_id:
                continue
            prev = overrides.get(awc_id)
            # If two rules cover the same stream, keep the more-restrictive radius.
            if prev is None or yards > prev["radius_yds"]:
                overrides[awc_id] = {"radius_yds": yards, "rule": rule}
    multi = unary_union([Point(p["lon"], p["lat"]) for p in pts])
    buf = buffer_yards(multi, yards)
    if scope_geom is not None:
        buf = buf.intersection(scope_geom)
    buf = valid(buf)
    if buf is None or buf.is_empty:
        return None
    return {
        "type": "Feature",
        "geometry": _round_coords(mapping(buf)),
        "properties": {"rule": rule, "n_streams": len(pts), "yards": yards, "kind": "stream"},
    }


def _best_ring_for(boundary, p1, p2):
    """Pick the boundary LineString where both p1 and p2 sit closest."""
    rings = list(boundary.geoms) if hasattr(boundary, "geoms") else [boundary]
    best, best_score = None, float("inf")
    for r in rings:
        score = r.distance(Point(*p1)) + r.distance(Point(*p2))
        if score < best_score:
            best, best_score = r, score
    return best


def shore_buffer_feature(district_geom, p1, p2, yards, rule):
    """Buffer the district boundary between p1 and p2 by yards, clipped to the
    district polygon. Returns a GeoJSON feature dict (or None).

    Picks the shorter arc on the ring whose closest points to (p1, p2) are
    minimal. For typical bay-shore closures the shorter arc is the intended
    one; if a regulation ever needs the longer arc, override here.
    """
    boundary = district_geom.boundary
    ring = _best_ring_for(boundary, p1, p2)
    if ring is None:
        return None
    t1 = ring.project(Point(*p1))
    t2 = ring.project(Point(*p2))
    lo, hi = sorted([t1, t2])
    arc = substring(ring, lo, hi)
    buf = buffer_yards(arc, yards).intersection(district_geom)
    buf = valid(buf)
    if buf is None or buf.is_empty:
        return None
    return {
        "type": "Feature",
        "geometry": _round_coords(mapping(buf)),
        "properties": {"rule": rule, "yards": yards, "kind": "shore"},
    }


# Approximate bay/passage scopes — used when a regulation's filter (e.g. a
# longitude range) is by itself too coarse and would catch streams from
# unrelated waterbodies. These are intentionally generous bboxes that just
# need to exclude *other* bays. Refine if a parsed announcement ever shows
# unexpected leakage.
SCOPE_BBOXES = {
    "jack_bay":           box(-146.65, 61.00, -146.50, 61.07),
    # South edge anchored at Brizgaloff Creek's latitude — regulation scopes
    # to "streams in Dangerous Passage" and per local guidance anything south
    # of Brizgaloff Creek is outside the passage. Chenega Creek sits inside
    # the bbox geographically but is also outside the passage and is
    # explicitly excluded in the rule below.
    "dangerous_passage":  box(-148.18, 60.31629, -148.00, 60.42),
}


def build(awc, districts):
    features = []
    overrides = {}  # {awc_id: {radius_yds, rule}}

    # ── Stream-buffer closures ───────────────────────────────────────────
    # (3)(U) Jack Bay — 1,000 yds of all OTHER salmon streams of the bay.
    f = stream_buffer_feature(
        awc, 1000, bbox=SCOPE_BBOXES["jack_bay"],
        scope_geom=districts.get("Eastern District"),
        rule="5 AAC 24.350(3)(U) Jack Bay — 1000yd stream buffers",
        overrides=overrides,
    )
    if f: features.append(f)

    # (4)(H) Unakwik Inlet — 1,000 yds, north of 60.86617.
    f = stream_buffer_feature(
        awc, 1000, lat_min=60.86617,
        scope_geom=districts.get("Northern District"),
        rule="5 AAC 24.350(4)(H) Unakwik Inlet — 1000yd stream buffers north of 60.86617",
        overrides=overrides,
    )
    if f: features.append(f)

    # (5)(A) Unakwik District — 1,000 yds, south of 61.08283.
    f = stream_buffer_feature(
        awc, 1000, lat_max=61.08283,
        scope_geom=districts.get("Unakwik District"),
        rule="5 AAC 24.350(5)(A) Unakwik District — 1000yd stream buffers south of 61.08283",
        overrides=overrides,
    )
    if f: features.append(f)

    # (8)(B) Gumboot Creek — 750 yds, single named creek.
    f = stream_buffer_feature(
        awc, 750, name_substring="Gumboot Creek",
        rule="5 AAC 24.350(8)(B) Gumboot Creek — 750yd",
        overrides=overrides,
    )
    if f: features.append(f)

    # (9)(A) Dangerous Passage — 1,000 yds, all streams between two longitudes.
    # Chenega Creek (226-20-16280) sits inside the bbox but isn't part of
    # the passage per local guidance — excluded.
    f = stream_buffer_feature(
        awc, 1000, bbox=SCOPE_BBOXES["dangerous_passage"],
        exclude_awc_ids={"226-20-16280"},
        rule="5 AAC 24.350(9)(A) Dangerous Passage — 1000yd stream buffers (provisional bbox)",
        overrides=overrides,
    )
    if f: features.append(f)

    # ── Shore-buffer closures ────────────────────────────────────────────
    eastern = districts.get("Eastern District")
    montague = districts.get("Montague District")

    # (3)(T) Galena Bay — 1,000 yds of N shore between two coords.
    if eastern is not None:
        f = shore_buffer_feature(
            eastern,
            (-146.64717, 60.95217),
            (-146.60917, 60.94683),
            1000,
            "5 AAC 24.350(3)(T) Galena Bay — 1000yd N shore",
        )
        if f: features.append(f)

    # (3)(X) Allison/Sawmill Alyeska Safety Zone — 200 yds of shore.
    if eastern is not None:
        f = shore_buffer_feature(
            eastern,
            (-146.34533, 61.08600),  # Allison Point
            (-146.45533, 61.08017),  # west of Sawmill Creek
            200,
            "5 AAC 24.350(3)(X) Allison/Sawmill — 200yd shore",
        )
        if f: features.append(f)

    # (10)(A) Zaikof Bay — 1,000 yds of SE shore from a point to a lat line.
    # We project the lat-line endpoint onto the SE Zaikof shore by giving a
    # nearby coordinate at the right latitude.
    if montague is not None:
        f = shore_buffer_feature(
            montague,
            (-147.00250, 60.29900),
            (-146.96, 60.28100),
            1000,
            "5 AAC 24.350(10)(A) Zaikof Bay — 1000yd SE shore",
        )
        if f: features.append(f)

    # (10)(G) Montague Strait — 500 yds of NW shore of Montague Island, two segments.
    if montague is not None:
        for (p1, p2, label) in [
            ((-147.28820, 60.04611), (-147.33170, 60.03130), "seg1"),
            ((-147.34280, 60.02100), (-147.40570, 59.99940), "seg2"),
        ]:
            f = shore_buffer_feature(
                montague, p1, p2, 500,
                f"5 AAC 24.350(10)(G) Montague Strait NW shore — 500yd {label}",
            )
            if f: features.append(f)

    return features, overrides


def main():
    districts = load_districts()
    awc = load_awc()
    features, overrides = build(awc, districts)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    OVERRIDES_PATH.write_text(json.dumps(overrides))
    print(f"wrote {len(features)} features → {OUT_PATH.relative_to(ROOT)}")
    print(f"wrote {len(overrides)} AWC radius overrides → {OVERRIDES_PATH.relative_to(ROOT)}")
    for f in features:
        p = f["properties"]
        extra = f" (n_streams={p['n_streams']})" if "n_streams" in p else ""
        print(f"  • {p['rule']}{extra}")


if __name__ == "__main__":
    main()
