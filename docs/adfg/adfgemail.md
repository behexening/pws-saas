# Draft email to ADF&G — bay-level shapefile / named-feature request

Context for why this email exists: see `geometry_eastern_northern.md`. The
short version is that ADF&G's district and subdistrict shapefiles,
combined with 5 AAC 24.200–24.240 (the PWS salmon management plan —
where all the district/subdistrict definitions and terminology come
from) are enough for district-level opening/closing but not enough for
the closure-by-closure text in the emergency orders. Those texts
routinely reference named bays/coves/inlets (Port Valdez, Eaglek Bay,
Jack Bay, Landlocked Bay, etc.) that are NOT present as polygons in
the published shapefiles and are NOT given hard geographic boundaries
in 5 AAC 24.240 either — the regulation names them but doesn't scope
them. So we're currently parsing lat/long definitions and
reconstructing them ourselves. That reconstruction is what's
over-closing Eastern and Northern right now.

If ADF&G has any of this data internally, getting it from them solves the
problem at the source.


## Who to send it to

- Primary: the ADF&G Commercial Fisheries Division GIS contact for Region
  II / PWS management area. Cordova Commercial Fisheries office is
  probably the right starting point because PWS salmon is managed out of
  Cordova.
- If no GIS contact responds: the PWS area management biologist(s) whose
  names are on the emergency orders (the "Contact:" line on the PDF,
  typically a Cordova number).
- Likely email aliases to try:
  - `dfg.cf.cordova@alaska.gov`
  - the biologist listed on the bottom of any recent PWS seine
    emergency order (they sign the orders)
  - `dfg.webmaster@alaska.gov` as a fallback routing address


## Subject line (pick one)

- "Request: bay/cove-level shapefiles or gazetteer for PWS commercial
  salmon closure areas"
- "GIS data request — named internal-closure features for PWS salmon
  emergency orders"
- "akFISHinfo — need polygon or point data for Port Valdez, Eaglek Bay,
  and similar closure features"


## Outline of what the email has to ask

Keep it short. They're busy in-season. Three asks, each a single
paragraph, in order of usefulness to us:

1. **Bay-level shapefile.** Do you publish, or can you share, a
   shapefile (or any GIS layer) of the *named water bodies* inside each
   PWS district that the emergency orders reference as closure areas?
   These are the features smaller than a subdistrict — individual bays,
   coves, inlets, lagoons. Examples: Port Valdez, Jack Bay, Sawmill
   Bay, Galena Bay, Landlocked Bay, Irish Cove, St. Matthews Bay,
   Eaglek Bay. We already have your District and Subdistrict layers
   and they work fine; what we're missing is the next level down.

2. **Canonical feature list / gazetteer.** If there is no polygon
   layer, do you have a canonical list of which named bays belong to
   which district or subdistrict, with either centroids or bounding
   boxes? Even a spreadsheet of
   `feature_name, district, subdistrict, lat, lon, approximate_extent`
   would let us stop synthesizing boundaries from the closure text and
   instead match each named feature to a known location.

3. **"Port Valdez" definition — Eastern District.** The emergency
   orders describe closures like *"waters of Port Valdez, east of the
   longitude of 146° 32.00' W."* We need to know what ADF&G considers
   the outer boundary of "Port Valdez" for regulatory purposes. Does
   it extend west to the Valdez Narrows Subdistrict boundary? Is there
   a canonical point where Port Valdez ends and Valdez Arm begins?
   This is the single feature giving us the worst over-closure today.

4. **Northern District internal features.** We specifically need to
   know every named water body inside Northern District that can
   appear in a closure, with its extent or mouth-line. Features we've
   already seen in orders: **Eaglek Bay**. Features we expect to see
   but haven't pinned down yet: Unakwik Inlet (whole or partial?),
   Bettles Bay, Main Bay, Cedar Bay, Paddy Bay, Wells Bay. Confirmation
   of which of these are even valid closure areas inside Northern,
   plus their geometry, would let us handle every Northern closure
   without text parsing.


## Draft email body

```
Subject: Request: bay/cove-level shapefiles or gazetteer for PWS commercial
salmon closure areas

Hello,

I'm building akFISHinfo, a tool that ingests the PWS commercial salmon
emergency orders as they go out and renders the open/closed areas on a map
so captains can see at a glance what's been opened that period. It relies
on the District and Subdistrict shapefiles ADF&G publishes, and on
5 AAC 24.200–24.240 (the PWS salmon management plan and district/
subdistrict definitions) for anything the emergency orders don't spell
out in full. That combination works well for district-level openings
and for excluding named subdistricts like Port Fidalgo or Port Chalmers.

The problem is the internal closure text inside a district-level opening.
Those closures are almost always scoped to named bays, coves, or inlets
that aren't defined as polygons in either the published shapefiles or
5 AAC 24.240 — for example, "waters of Port Valdez, east of 146° 32.00' W.",
or "Eaglek Bay, north of a line from <shore marker> to <shore marker>".
The regulation names the feature but doesn't give it a polygon, and the
emergency order gives a cut line without giving the feature's outer
boundary. We currently try to reconstruct those boundaries from the
lat/long text alone, but without knowing where Port Valdez or Eaglek
Bay actually are, we end up cutting more of the district than the
order intends.

I have a few questions, in order of usefulness:

1. Do you publish or can you share a shapefile (or any GIS layer) of the
   named water bodies inside each PWS district that the emergency orders
   reference as closure areas — the features one level below Subdistrict?
   Examples we've seen in orders: Port Valdez, Jack Bay, Sawmill Bay,
   Galena Bay, Landlocked Bay, Irish Cove, St. Matthews Bay, Eaglek Bay.

2. If no polygon layer exists, is there a canonical list / gazetteer of
   which named bays belong to which district and subdistrict, with
   centroids or approximate extents? A spreadsheet would be enough for
   us to match each closure name to a known feature.

3. For the Eastern District specifically: how does ADF&G scope "Port
   Valdez" for regulatory purposes? We want to know the outer boundary
   of Port Valdez so that "waters of Port Valdez, east of 146° 32.00' W."
   can be interpreted correctly.

4. For the Northern District specifically: what is the complete list of
   named water bodies inside Northern that can appear in a closure, and
   do you have their geometry? We've seen Eaglek Bay so far; we expect
   to see Unakwik Inlet, Bettles Bay, Main Bay, and others in future
   orders and would like to handle them ahead of time.

Any of these — a shapefile, a spreadsheet, or even a pointer to the
person who owns this data — would save us a lot of downstream guessing.
Happy to credit ADF&G as the data source in-app, and happy to share the
tool with your area biologists if it's useful on your side.

Thanks,
<your name>
<contact info>
akFISHinfo
```


## Attachments worth including

- One screenshot of the rendered map with the current over-closure
  (e.g., the pt3 Eastern District showing everything east of -146.533
  incorrectly shaded).
- The specific closure text that produced that over-closure, copy-pasted
  from the emergency order PDF, so they can see exactly which words are
  tripping us up.
- Optionally: a list of all closure-area names we've encountered in the
  last year of announcements, so they can see the scope of what we're
  trying to match. That list can be generated from the
  `parsed_results.html_content` rows in the Railway DB — search for
  `closure-name` spans and dedupe.


## What we will actually do with each answer

- **If they have a bay shapefile** → load it alongside the subdistrict
  layer, add `find_bay_key()` analogous to `find_subd_key()`, and make
  bay-named closures take the whole-polygon subtraction path instead of
  the lat/long path. This would fully fix Eastern (Port Valdez) and
  Northern (Eaglek Bay) in one shot.
- **If they have a gazetteer only** → build a `bay_bbox.json` keyed by
  feature name, and clip all synthesized closures to the bounding box of
  the named feature before applying them. Less precise than a real
  polygon but removes the district-wide over-close.
- **If they have nothing but can confirm the list of valid names per
  district** → at minimum we can hard-fail on unknown names instead of
  silently running them through the synthesized-line path.
- **If they never reply** → we build our own `bay_bbox.json` by
  centroid-guessing from the shore markers in the closure text, and
  ship it as a hand-maintained gazetteer inside the repo. (This is the
  fallback, not the preferred path.)
