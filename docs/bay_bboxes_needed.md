# Named-feature bounding boxes needed (QGIS hand-draw list)

This is the ordered list of named water bodies we've hit geometry problems
with while parsing PWS commercial salmon emergency orders. The gazetteer
built from GNIS + OSM now gives us a **centroid** for each of these, and
the runtime clips closure cuts to a circular buffer around that centroid.
That works for compact features but fails for **long** or **wide** ones —
the buffer either misses the far end of the bay or spills outside it.

Drawing a tight bounding polygon for each of these in QGIS and shipping
it as a shapefile / GeoJSON solves that structurally: the clip region
becomes the actual feature extent instead of a circle.

Entries are in priority order — start at the top. Each entry has the
GNIS centroid as a QGIS waypoint so you can fly straight to the feature.


## Tier 1 — Confirmed over-closures (MUST have a bbox)

These are the two features the `geometry_eastern_northern.md` trace
identified as the root cause of the Eastern and Northern over-closures.
Even with the gazetteer in place, they're long enough that a circular
scope may not cover the full extent of the closure text.

| # | Feature | District | GNIS centroid (lon, lat) | Why |
|---|---------|----------|--------------------------|-----|
| 1 | **Port Valdez** | Eastern | `-146.501944, 61.105556` | ~20 km east-west fjord. Emergency orders scope "waters of Port Valdez, east of …". Centroid+circle won't cover the east end where most closures actually fall. Needs a tight E-W rectangle from Valdez Narrows boundary to the head of the fjord. |
| 2 | **Eaglek Bay** | Northern | `-147.7425, 60.876111` | Small bay pocket on the north shore. Extended closure line hit the NE lobe of Northern District 0.44° east of the actual bay mouth. Bbox should be the compact pocket only — roughly `lon -147.78 → -147.65, lat 60.84 → 60.91`. |


## Tier 2 — Long / wide features, high structural risk

These are features that WILL show up in future orders (5 AAC 24.240 names
them) and that are too large for a circular buffer to cover without also
spilling into neighbors. Draw them before the first closure lands so we
don't have to hotfix.

| # | Feature | District | GNIS centroid (lon, lat) | Why |
|---|---------|----------|--------------------------|-----|
| 3 | **Unakwik Inlet** | Northern | `-147.564444, 61.008333` | Long N-S fjord, 30+ km. Classic case where a circle is strictly wrong. Needs a narrow N-S rectangle following the inlet axis. |
| 4 | **Main Bay** | Northern | `-148.058333, 60.539444` | Deep N-S embayment on the west side of Perry Island Subdistrict. Fish hatchery location, likely to appear in closures. |
| 5 | **Wells Bay** | Northern | `-147.47, 60.973056` | Northeast of Unakwik, moderately wide. Sits near the Cannery Creek Subdistrict boundary, so a loose circle can leak into it. |
| 6 | **Bettles Bay** | Northern | `-148.283889, 60.94` | West end of the Northern District general subdistrict. Adjacent to Perry Island — same leak risk as Wells. |


## Tier 3 — Short features, gazetteer works but insurance is cheap

These already handle OK with the centroid+circle path because they're
small and compact. A bbox doesn't buy us much precision but it removes
any residual dependency on circle radius tuning. Do these last, or skip
them if time-constrained.

| # | Feature | District | GNIS centroid (lon, lat) | Notes |
|---|---------|----------|--------------------------|-------|
| 7  | **Jack Bay**           | Eastern | `-146.601111, 61.031111` | Shore markers in orders span ~4 km — draw the tight bay, not the extended entrance. |
| 8  | **Sawmill Bay**        | Eastern | `-146.783611, 61.054722` | **⚠️ Name collision** — there's another Sawmill Bay at `-148.011667, 60.058611` in the Southeastern District. Disambiguate by district when drawing; label the Eastern one. |
| 9  | **Galena Bay**         | Eastern | `-146.640278, 60.942778` | Small and compact. |
| 10 | **Landlocked Bay**     | Eastern | `-146.587222, 60.834444` | Order text uses a latitude cut (`north of 60° 50.76' N`); the bbox should cover the full pocket so the cut gets clipped correctly. |
| 11 | **Irish Cove**         | Eastern | `-146.445556, 60.772222` | **⚠️ Name collision** — another Irish Cove at `-147.291111, 60.885556` is inside Northern District. The Eastern one is the regulated feature; label accordingly. |
| 12 | **St. Matthews Bay**   | Eastern | `-146.32, 60.750833`     | Small. GNIS stores as "Saint Matthews Bay"; our normalizer handles `St. ↔ Saint`, so either label works. |


## Features to watch but not yet drawn

These are in the gazetteer but haven't caused problems yet. Leave them
alone unless an order references them:

- Paddy Bay (Southwestern) — `-148.091389, 60.396667`
- Cedar Bay (two of them — Eastern `-146.009722, 60.558056` and Northern `-147.401667, 60.962222`)
- Jackpot Bay (Southwestern) — `-148.224699, 60.339207` — OSM already has a polygon, no bbox needed
- Falls Bay — `-147.986944, 60.521389`
- Hells Hole — `-146.392778, 60.704444`
- Chenega Bay — **not in gazetteer** (populated place, not a water body in GNIS). Would need a manual bbox if it ever shows up in an order.


## File format for the output

When you're done drawing in QGIS, export as **GeoJSON** (not shapefile —
we'll avoid the shp/shx/dbf sidecar dance) to:

```
data/pws_bay_bboxes.geojson
```

Schema per feature — keep it this exact shape so the Python loader can
key on `name` without guessing:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Port Valdez",
        "district": "Eastern District",
        "gnis_id": "1405737",
        "notes": "E-W axis, west end at Valdez Narrows"
      },
      "geometry": { "type": "Polygon", "coordinates": [[[...]]] }
    }
  ]
}
```

`name` is the authoritative key (case-insensitive; we normalize the same
way as the gazetteer). `district` resolves name collisions (Sawmill Bay,
Irish Cove). `gnis_id` is optional but lets us cross-reference the
original GNIS point if we want to.

Once the file is in place, I'll add a loader to `live_test_server.py`
that prefers the hand-drawn bbox over the GNIS circular buffer whenever
the closure name matches a feature in `pws_bay_bboxes.geojson`.
