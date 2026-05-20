 # Hand-tracing closed waters in QGIS (Mac trackpad)

Goal: draw closure polygons over the georeferenced PDFs and export as one GeoJSON.

## One-time setup

1. **Project CRS:** `EPSG:4326 WGS 84` (bottom-right of the QGIS window → click → set).
2. **Create the output layer:**
   - Menu: `Layer → Create Layer → New GeoPackage Layer…`
   - Filename: `data/closedwaters/permanent_closed_waters.gpkg`
   - Geometry type: **Polygon**
   - CRS: `EPSG:4326`
   - Add fields:
     - `name` (text, length 120)
     - `source_pdf` (text, length 120)
   - OK.
3. **Snapping** (optional but nicer):
   - `Project → Snapping Options…` → enable snapping, mode **All Layers**, tolerance **10 px**, type **Vertex**.

## Per-polygon workflow

For each closed-water boundary on a PDF:

1. **Select the layer** in the Layers panel (left side) — click `permanent_closed_waters`.
2. **Toggle editing:** `Cmd+E` (pencil icon turns yellow).
3. **Pick the Add Polygon tool:** `Cmd+.` (or toolbar: green polygon with a yellow star).
4. **Click each vertex** along the closure boundary on the PDF.
5. **Finish the polygon:** two-finger tap (right-click) anywhere.
6. **Attribute form pops up:** type the `name` (e.g. `Eshamy Bay E`) and `source_pdf` (e.g. `225_Eshamy_District_ReportingAreas`). OK.
7. **Save edits:** `Cmd+S`.

## Keybinds (Mac)

| Action | Key |
|---|---|
| Toggle editing | `Cmd+E` |
| Add Polygon Feature | `Cmd+.` |
| Finish polygon | two-finger tap (right-click) |
| Cancel current polygon | `Esc` |
| Undo last vertex / edit | `Cmd+Z` |
| Redo | `Cmd+Shift+Z` |
| Save edits | `Cmd+S` |
| Pan tool | `P` then drag, or hold `Space` + drag while in any tool |
| Zoom in / out | `Ctrl+=` / `Ctrl+-` (or two-finger pinch on trackpad if enabled) |
| Zoom to layer | right-click layer → `Zoom to Layer` |
| Toggle snapping | `S` |
| Vertex tool (edit existing vertices) | `Cmd+Shift+G` then click polygon |
| Delete selected polygon | select with the Select tool, then `Delete` |

### Trackpad gotchas

- **Right-click = two-finger tap.** If you don't have that enabled: System Settings → Trackpad → "Secondary click" → Click or tap with two fingers.
- **Pan instead of click-and-drag-to-rubber-band:** hit `P` once, or hold `Space` while dragging.
- **Zoom with the trackpad:** if pinch doesn't work, use `Ctrl+=`/`Ctrl+-` or Ctrl + two-finger scroll up/down.
- **If a click does nothing,** you probably aren't in editing mode (`Cmd+E`) or have the wrong tool active. Look at the toolbar — the polygon-add tool should be visibly depressed.

## Offshore endpoints (closures that end in open water)

Two options:
1. **Approximate:** eyeball the offshore endpoint against the PDF's lat/lng grid lines. v1 launch is fine — these are visual heads-up overlays, not legal boundaries.
2. **Precise:** the PDFs usually label the endpoint with explicit coordinates. While placing the polygon, when you get to that vertex, use the **"Add a vertex by typing coordinates"** mode: turn on `Advanced Digitizing Toolbar` (View → Toolbars), or just place the vertex approximately, then use the **Vertex Tool** (`Cmd+Shift+G`) after closing the polygon: double-click the vertex → it shows X/Y at the bottom → edit, press Enter.

## Editing a polygon after the fact

- **Move a vertex:** Vertex Tool (`Cmd+Shift+G`) → click polygon → drag the red vertex dot.
- **Add a vertex on an existing edge:** Vertex Tool → double-click the edge mid-segment.
- **Delete a vertex:** Vertex Tool → click vertex → `Delete`.
- **Rename / re-tag:** Identify tool, or right-click layer → `Open Attribute Table` → toggle editing → edit cell.

## Export to GeoJSON when done

1. Right-click `permanent_closed_waters` layer → `Export → Save Features As…`
2. Format: **GeoJSON**
3. File name: `data/permanent_closed_waters.geojson`
4. CRS: `EPSG:4326`
5. Coordinate precision: 6 (≈ 10 cm — overkill but tiny file)
6. Save.
7. Copy/symlink to `public/static/permanent_closed_waters.geojson` for the app to serve.

```bash
cp data/permanent_closed_waters.geojson public/static/permanent_closed_waters.geojson
```

## Sanity check before shipping

- Open the exported `.geojson` in [geojson.io](https://geojson.io) — every polygon should render on the right basemap location.
- Spot-check 2-3 polygons against the original PDF.
- Look for self-intersections (QGIS shows them as broken fill).

## If you screw up

- `Cmd+Z` works for everything inside an editing session, including vertex placement.
- Rolling back the entire session: `Edit → Rollback Edits` (then re-toggle editing to start over without saving).
- Last resort: the `.gpkg` is just a file — copy it before risky operations.
