# Georeferencing the ADF&G PDFs in QGIS (using the Georef Extension plugin)

Do this once, before you start digitizing. The georeferenced PDFs are your **visual truth** for where the gray closure areas are drawn.

The **Georef Extension** plugin (`cxcandid/GeorefExtension`) adds three buttons to the built-in QGIS Georeferencer:
- **Set Background Color**
- **Delete all GCPs**
- **Create Virtual Raster** (the main one — exports to VRT instead of GeoTIFF)

Key differences from the stock Georeferencer workflow:

| Stock Georeferencer                     | With Georef Extension                  |
|-----------------------------------------|----------------------------------------|
| Output = GeoTIFF (duplicates image)     | Output = **VRT** (points at the original; no duplication, no quality loss) |
| Transformation Settings used            | Transformation Settings **ignored** — GDAL picks the transform based on GCP count (polynomial 1/2/3) |
| Re-doing requires overwriting a locked file | VRT overwrites anytime → **iterative refinement** is easy |
| Must pre-render PDFs to raster          | Can open PDF directly with `|option:DPI=300` |

## Prep

✅ **PNGs already rendered** at 300 DPI to `docs/hand-created/layers/*.png`. You can use those directly, OR open the PDFs directly with a DPI open-option (slightly smoother, but either works).

## In QGIS, once

1. **Install the plugin.** Plugins → Manage and Install Plugins → search "Georef Extension" → Install.
2. **Bump GDAL PDF resolution** (only matters if opening PDFs directly, not PNGs):
   Settings → Options → System → Environment → tick "Use custom variables" → add
   `GDAL_PDF_DPI = 300`. Restart QGIS.

## Per-map workflow

### 1. Open the Georeferencer
**Layer → Georeferencer…**

### 2. Load the image
- **Option A (use our pre-rendered PNG):** Open Raster → pick `docs/hand-created/layers/221_Eastern_District_ReportingAreas.png`.
- **Option B (open the PDF directly):** Open Raster → pick `docs/closedwaters/221_Eastern_District_ReportingAreas.pdf`. To override DPI per-file, edit the **Datasource** field in the Create Virtual Raster dialog later and append `|option:DPI=300`, then press Refresh.

### 3. Set target CRS
- Georeferencer window → **Settings → Transformation Settings…**
- **Target SRS:** `EPSG:3338` (NAD83 / Alaska Albers)
- The other transformation fields (Type, Resampling, Output file) are **ignored** by the extension — leave defaults or whatever.

### 4. Pick GCPs
Aim for **≥ 8 GCPs per map**, spread across the whole map frame (not clustered). Good targets against your basemaps (NOAA charts, OSM, Esri imagery):
- Cape / point tips
- Light markers
- River mouths
- Well-defined cove corners / bay heads
- Avoid PDF margins and avoid the "box arrow" callouts — pick the actual shoreline point the callout references, not the label.

As you add GCPs, the table at the bottom shows Residual (pixels) and Residual (ground units / meters if target CRS is EPSG:3338). **Delete and re-pick any GCP whose residual is a big outlier** — aim for all < 50 m on the ground.

### 5. Click **Create Virtual Raster** (the extension's button)
The Create Virtual Raster dialog opens:
- **Output File:** `docs/hand-created/layers/221_Eastern_District_ReportingAreas.vrt` (the default is usually next to the source; change path via the `…` button if needed)
- **NoData Value:** leave blank (or 255 if you want the white margins transparent)
- **Create Alpha Channel:** tick **ON** (transparent margins look nicer over basemaps)
- **Load in QGIS when done:** tick **ON** for the first run.
- **Target SRS:** `EPSG:3338`
- **Cutline SRS / Enter Cutline WKT:** leave blank (skip clipping on first pass; you can crop later).

Press **OK**. The `.vrt` is written and loaded in QGIS. GDAL picks the transform automatically:
- 3 GCPs → affine
- 4–5 → polynomial 2
- 6+ → polynomial 3 (which is what you want)

### 6. Iterate
In the main QGIS canvas, overlay your new `.vrt` at ~40% opacity on top of NOAA charts / Esri imagery / the districts layer. Pan along the coastline and find drift.

To improve:
- Keep the Georeferencer window open (do not close it — the GCPs persist).
- Untick **Load in QGIS when done** in the Create Virtual Raster dialog (so it won't add a duplicate layer).
- Add / move / delete GCPs in the GCP table.
- Press **Create Virtual Raster** again — the existing layer refreshes in place.

Repeat until the PDF's coastline overlays the real coastline within ~1–2 pixels at zoom 13.

### 7. Save the Georeferencer session
Georeferencer window → **File → Save GCP Points As…** → save the `.points` file next to the VRT. This lets you reopen and keep editing GCPs in a future session.

## Which PDF maps to which district

| PDF / PNG stem | District | Features covered |
|---|---|---|
| `212-200_Copper_Bering_Districts_ReportingAreas` | Copper River + Bering River | Copper Flats, Bering River mouth, Cape Suckling / Kayak Island |
| `221_Eastern_District_ReportingAreas` | Eastern | Sheep Bay → Port Valdez (largest district) |
| `222_Northern_District_ReportingAreas` | Northern | Long/Granite/Cedar/Eaglek/Wells/Siwash/Jonah/Schoppe |
| `223_Coghill_District_ReportingAreas` | Coghill | Esther, Coghill, Barry, Harrison, Bettles, Pigot |
| `224_Northwestern_District_ReportingAreas` | Northwestern | Blackstone, Passage Canal, Cochrane, Long Bay Culross, Port Nellie Juan |
| `225_Eshamy_District_ReportingAreas` | Eshamy | Eshamy Bay, Gumboot |
| `226_Southwestern_District_Reporting_Areas` | Southwestern | Dangerous Passage, Jackpot, Whale, Bainbridge, Mummy, Snug |
| `227_Montague_District_ReportingAreas` | Montague | Zaikof, Rocky, Stockdale, Port Chalmers, Hanning, MacLeod, Green Island |
| `228_Southeastern_District_ReportingAreas` | Southeastern | Hinchinbrook, Orca Inlet, Canoe Passage, Windy Bay |
| `229_Unakwik_District_ReportingAreas` | Unakwik | Miners Bay + Unakwik Inlet |

Expect ~10–15 min per map with the iterative workflow. ~2 hours total.
