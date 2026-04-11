# Eastern District and Northern District — geometry trace (announcement #13, PDF 7_19_2023pws.pdf)

This document explains, in plaintext, exactly what the parser did to each of
these two districts, why the open area came out wrong, and which piece of
code is responsible. It's a pre-change write-up — no code changes proposed
here, just the evidence and the mechanism. The change list is your call.

Data was pulled live from the Railway Postgres (`parsed_results.html_content`
for `announcement_id=13`) and then re-run through `live_test_server.py` with
`ANTHROPIC_API_KEY=dummy` so shapely reproduces the exact numbers the live
server produced.


## Ground truth from the shapefile

```
Eastern District  : area 0.23324°²   bounds  lon -146.979 → -145.589
                                              lat  60.599 →  61.148
Northern District : area 0.29588°²   bounds  lon -148.175 → -146.917
                                              lat  60.615 →  61.044   (INVALID ring, make_valid'd at load)

Eastern subdistricts:
  Valdez Narrows Subdistrict   area 0.01830°²   lon -146.697 → -146.252  lat 61.056 → 61.148
  Port Fidalgo Subdistrict     area 0.00971°²   lon -146.402 → -146.051  lat 60.781 → 60.892

Northern subdistricts:
  Perry Island Subdistrict     area 0.04483°²   lon -148.175 → -147.711  lat 60.615 → 60.850
  General Subdistrict          area 0.24111°²   lon -148.102 → -146.917  lat 60.615 → 61.044
  Cannery Creek Subdistrict    area 0.00994°²   lon -147.692 → -147.518  lat 60.893 → 61.024
```


## What came out of the live server

```
eastern_district   area 0.11531°²   bounds  lon -146.979 → -146.533
                                              lat  60.610 →  61.084
northern_district  area 0.17974°²   bounds  lon -148.175 → -146.979
                                              lat  60.615 →  60.860
```

Eastern lost 0.11793°² (50.6% of the district).
Northern lost 0.11614°² (39.3% of the district).
Of Northern's loss, 0.05477°² is the two named-subdistrict subtractions
(Perry Island + Cannery Creek) — the remaining 0.06137°² is incorrect
over-closure from one closure: "Eaglek Bay".


## EASTERN DISTRICT — closures returned by Claude

The PDF describes an Eastern District purse-seine opening with these
internal closures (verbatim, from the card rendered on disk):

```
  1. Port Valdez Closure   "east of the longitude of 146° 32.00' W."
  2. Jack Bay              shore markers (61.039, -146.5878) → (61.0362, -146.6628), closed S
  3. Sawmill Bay           shore markers (61.0452, -146.774) → (61.043, -146.7845),  closed N
  4. Galena Bay            shore markers (60.9478, -146.6645) → (60.9425, -146.6608), closed E
  5. Landlocked Bay        "waters north of 60° 50.76' N. lat."
  6. Irish Cove            shore markers (60.7788, -146.4437) → (60.7712, -146.452),  closed S
  7. Port Fidalgo Subdistrict  "waters east of 146° 24.12' W. long."
  8. St. Matthews Bay      shore markers (60.7227, -146.3178) → (60.7268, -146.3528), closed N
```

### How each closure was processed

```
  Port Valdez Closure   → bay_scope=False, synthesized=True    FULL DISTRICT HALF-PLANE CUT  ← over-closes
  Jack Bay              → bay_scope=True,  synthesized=False   split + <30% filter           ok
  Sawmill Bay           → bay_scope=True,  synthesized=False   split + <30% filter           ok
  Galena Bay            → bay_scope=True,  synthesized=False   split + <30% filter           ok
  Landlocked Bay        → bay_scope=True,  synthesized=True    skipped (returns None)        not painted, acceptable
  Irish Cove            → bay_scope=True,  synthesized=False   split + <30% filter           ok
  Port Fidalgo Subd.    → subdistrict-name-match               whole-polygon subtract        ok
  St. Matthews Bay      → bay_scope=True,  synthesized=False   split + <30% filter           ok
```

### Why Port Valdez over-closes

The root fact is this: **"Port Valdez Closure" does not contain any of the
words in `BAY_KEYWORDS`**. That tuple is
`('bay','cove','inlet','lagoon','pass','fiord','fjord','arm','harbor')`.
`_is_bay_named("Port Valdez Closure")` returns `False`. The word "Port" is
not in the list because "Port Fidalgo Subdistrict", "Port Chalmers
Subdistrict", etc. are full subdistricts and we handle those earlier via
the subdistrict-name-match. But Port Valdez is *not* a registered
subdistrict in the PWS shapefile, so it falls all the way through to the
generic closure path.

Because `bay_scope=False`, the `(bay_scope and synthesized) → return None`
short-circuit in `get_closed_area` does not fire. The code synthesizes a
meridian at -146.5333 (from the definition text), extends it 2° at each
end, splits Eastern District along it, and picks every piece whose
centroid is east of the meridian as "closed". Every piece of the district
east of -146.5333 gets removed. That includes Port Valdez itself but also
Sheep Bay, Gravina Bay, Port Gravina, Simpson Bay, the north end of
Hawkins Island, and the entire eastern mainland lobe of the district.

You can see this directly in the rendered bounds: the open area's east
edge is at exactly -146.533, which is the synthesized meridian to four
decimals. That is the signature of a district-wide half-plane cut, not a
bay-scoped cut.

For comparison, the real Port Valdez bay is roughly 0.01-0.02°²; the
closure chopped ~0.097°² out of Eastern District (about 5-10x too much).

The relevant code path is in `live_test_server.py`:

- `BAY_KEYWORDS` tuple and `_is_bay_named()` — decides whether
  `bay_scope` gets set when the closure is collected.
- `get_closed_area(closed_side, coords, district_geom, bay_scope, synthesized)`
  — at the top: `if bay_scope and synthesized: return None`. This is the
  guard that *would* have skipped Port Valdez if `_is_bay_named()` had
  recognized it.
- `_build_half_plane()` — builds the infinite half-plane for the fallback
  path.
- The closure-collection loop in `build_html()` — sets
  `bay_scope = _is_bay_named(c_name)` using *only* the closure name, not
  the closure definition text.

### What the Claude prompt actually returned

The closure name Claude returned for Port Valdez is literally `"Port
Valdez Closure"`. The definition Claude returned is `"east of the
longitude of 146° 32.00' W."` — stripped of the "waters of Port Valdez,"
prefix that the real PDF contains. So the "Port Valdez" feature name is
only preserved in the *name* field, and even there it's followed by the
generic word "Closure". Neither the name nor the definition contains a
bay keyword.

Two independent failures compound here:
1. Claude dropped the "waters of Port Valdez," scope prefix from the
   definition, reducing it to just the longitude clause.
2. Our bay detector only looks at the name, and the name happens not to
   contain a bay keyword.


## NORTHERN DISTRICT — closures returned by Claude

```
  excluded_subdistricts : Perry Island Subdistrict, Cannery Creek Subdistrict
  closures              : 1. Eaglek Bay   shore markers (60.8443, -147.6712) → (60.8427, -147.7428), closed N
```

### How each was processed

```
  Perry Island Subdistrict  → excluded_subdistricts path → whole-polygon subtract     ok (-0.04483°²)
  Cannery Creek Subdistrict → excluded_subdistricts path → whole-polygon subtract     ok (-0.00994°²)
  Eaglek Bay                → bay_scope=True, synthesized=False → split + <30% filter OVER-CLOSES
```

Northern District after subdistrict subtraction, before Eaglek: 0.24112°².
Northern District after Eaglek:                                 0.17974°².
Eaglek removed:                                                 0.06138°².

That is roughly 25% of the remaining district. Eaglek Bay as an actual
geographic feature is a small pocket on the north shore near -147.70,
60.85, maybe 0.002°². We cut ~30x too much.

### Why Eaglek Bay over-closes

This is more subtle than Port Valdez. The bay_scope logic *does* run, but
its small-piece filter fails to discriminate between the bay pocket and a
large separate piece of the district that happens to sit on the same side
of the extended cut line.

Here is the split, step by step, with real numbers:

1. The Eaglek Bay mouth is defined by two shore markers at
   (-147.6712, 60.8443) and (-147.7428, 60.8427). This is essentially an
   east-west segment about 0.072° wide (roughly 4 km). The intended
   meaning is "close the small pocket of water north of this line, inside
   Eaglek Bay".

2. `_extend_polyline(coords, extension=2.0)` extends the segment 2° at
   each end, so the line that actually gets fed to `split()` has bounds
   `lon -149.742 → -145.672, lat 60.798 → 60.889`. That is a ~4-degree
   east-west line spanning the entire width of Northern District (and
   well beyond).

3. `split(northern, line)` returns a GeometryCollection. Because Northern
   District was an invalid polygon originally and `make_valid()` turned
   it into a MultiPolygon with thousands of degenerate slivers, the split
   result contains 4794 pieces. Almost all of them are zero-area slivers.
   The three real pieces are:

   ```
   piece 1567   S  area 0.17974°²  (74.55%)  centroid (-147.376, 60.730)  ← main district body below the line
   piece 1568   N  area 0.00759°²  ( 3.15%)  centroid (-147.735, 60.881)  ← the Eaglek Bay pocket itself (correct)
   piece 1572   N  area 0.05376°²  (22.30%)  centroid (-147.234, 60.923)  ← entire NE lobe of the district (wrong)
   ```

4. `_pick_pieces_on_side` with `closed_side="north"` and
   `mid_y = (60.8443 + 60.8427)/2 = 60.8435` keeps every piece whose
   centroid is north of 60.8435. That's piece 1568 AND piece 1572.

5. The bay_scope filter is `area < 0.30 * district_area`. With
   district_area = 0.24112°², the threshold is 0.07234°². Both pieces are
   under that threshold:
   ```
   1568  0.00759°²  <  0.07234°²   keep
   1572  0.05376°²  <  0.07234°²   keep  ← this is the bug
   ```

6. Both pieces get unioned into the "closed area", the 0.00759 + 0.05376
   = 0.06135°² gets subtracted from the district, and you end up with the
   open bounds we observed:
   `lon -148.175 → -146.979, lat 60.615 → 60.860`.

### The core failure

The <30%-of-district heuristic is a blunt instrument. It was added to
distinguish a small bay pocket from a district-spanning half that
accidentally ended up on one side of an extended line. It succeeds at
that — piece 1567 (74.55%) is correctly rejected. But it cannot
distinguish between:

  * a true bay pocket immediately adjacent to the bay-mouth segment
    (piece 1568, the correct target), and
  * a large, disconnected piece of the district that sits on the same
    side of the *extended* line purely because `_extend_polyline` pushed
    the line 2° further east than it needed to (piece 1572, the
    over-close).

Piece 1572's centroid is at lon -147.234 — that is **0.44° east of the
east end of the real bay-mouth segment** (-147.6712). It only ends up
classified as "north of the line" because the extension made the line
reach -145.672 (2° past the segment's east end). The real Eaglek Bay
mouth line, unextended, does not touch piece 1572 at all.

In other words: the bug is that pieces are classified by the *extended*
line, not by adjacency to the *original* segment.

The relevant code path is in `live_test_server.py`:

- `_extend_polyline(coords, extension=2.0)` — extends 2° at each end,
  which is way more than necessary. The extension exists because split()
  needs the line to fully cross the polygon, but 2° is overkill for any
  bay mouth shorter than a degree.
- `_pick_pieces_on_side(pieces, coords, closed_side)` — uses `mid_x`,
  `mid_y` of the *unextended* coords for the centroid comparison, which
  is correct, but the pieces it chooses from are the ones that split
  produced off the *extended* line, so pieces that have nothing to do
  with the bay mouth can still be picked.
- `get_closed_area()`, the `if bay_scope:` branch — filters picked pieces
  by `< 0.30 * district_area`. 22% passes this filter even though 22% of
  a district is obviously not a bay pocket.
- `_build_half_plane()` and the buffer-fallback inside the `bay_scope`
  branch — never runs for Eaglek because pieces pass the small filter,
  so this path isn't the culprit here. (But it *is* a latent problem for
  other bays where the filter drops everything.)


## Summary of the two failures

| District | Closure          | Flag state              | Path taken                        | Why it over-closed |
| -------- | ---------------- | ----------------------- | --------------------------------- | ------------------ |
| Eastern  | Port Valdez      | bay=False, synth=True   | full district half-plane cut      | name doesn't contain a BAY_KEYWORD, so bay_scope never set, so the `bay && synth → None` short-circuit never fires |
| Northern | Eaglek Bay       | bay=True,  synth=False  | split + centroid + <30% filter    | pieces come from a line extended 2° beyond the segment, and the 30% filter doesn't reject a 22% lobe that happens to sit on the same side of the extension |

The Eastern fix lives around `_is_bay_named`, `BAY_KEYWORDS`, and/or
`get_closed_area`'s `(bay_scope and synthesized)` guard. The Northern fix
lives around `_extend_polyline`, `_pick_pieces_on_side`, and the small-
piece filter in `get_closed_area`. They are independent bugs — you can
address them in either order.

## Supporting files

- `/tmp/ann13.html`             — full `parsed_results.html_content` for announcement #13
- `/tmp/ann13_parsed.json`      — `parsed_json` column for the same row (currently `null`)
- `FIXTHEFUCKINGGEOMETRY/pt3/logs.1775889071021.log`  — Railway deploy log
- `FIXTHEFUCKINGGEOMETRY/pt3/akFISHinfo.html`         — homepage render that was flagged
