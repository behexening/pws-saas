# Hand-digitizing the Permanent Closed Waters in QGIS

This folder holds every tool, layer, and instruction you'll need to hand-draw
all 95 permanent closures from 5 AAC 24.350 in QGIS with **survey-grade**
accuracy.

Final output: `docs/hand-created/layers/permanent_closed_waters_hand.geojson`,
which will drop in as a replacement for the rule-based
`data/permanent_closed_waters.geojson`.

---

## Folder layout

```
docs/hand-created/
├── README.md                         ← start here
├── tools/
│   ├── dump_aac_coords.py            ← regenerates the AAC snap-target point layer
│   ├── create_closure_skeleton.py    ← regenerates the empty editable closure layer
│   ├── pyqgis_project_setup.py       ← run inside QGIS once; loads everything at the right opacity + snapping
│   ├── georeference_pdfs.md          ← step-by-step for georeferencing the ADF&G PDFs
│   └── diff_vs_pipeline.py           ← after you finish a district, compare against rule-based output
└── layers/
    ├── aac_coords.geojson            ← 300+ regulation points; use as snap targets
    ├── closures_skeleton.geojson     ← 95 rows with attributes pre-filled, empty geoms
    └── permanent_closed_waters_hand.geojson  ← YOU create this by editing the skeleton
```

---

## One-time setup

1. ✅ **Done.** `layers/aac_coords.geojson` (261 snap points) and
   `layers/closures_skeleton.geojson` (95 rows) are already generated.
   If you ever edit `data/closed_waters_source.json`, rerun:
   ```bash
   python3 docs/hand-created/tools/dump_aac_coords.py
   python3 docs/hand-created/tools/create_closure_skeleton.py
   ```

2. ✅ **PDFs rendered.** All 10 ADF&G PDFs are now in `layers/*.png` at 300 DPI.
   You still need to **georeference each PNG (or the source PDF directly)
   inside QGIS using the Georef Extension plugin** — follow
   [tools/georeference_pdfs.md](tools/georeference_pdfs.md). Target residuals
   < 50 m. Save outputs to `layers/{same_stem}.vrt` (the plugin's
   `Create Virtual Raster` button).

3. **YOU:** Open QGIS → Python Console → run
   [tools/pyqgis_project_setup.py](tools/pyqgis_project_setup.py).
   This loads NOAA charts, Esri imagery, OSM, districts, hand-drawn bboxes,
   rule-based closures, AAC reference points, and the editable skeleton.
   CRS is forced to EPSG:3338 (Alaska Albers — meter units) and snapping is
   configured for topological editing.

4. **YOU:** Save the QGIS project (e.g. `docs/hand-created/pws_closures.qgz`).
   After this, you just open the project each session.

---

## The digitizing workflow (per closure)

1. **Open `data/closed_waters_source.json` side-by-side** in your editor.
   Also keep `docs/closedwaters/5AAC24.350` open — the verbatim regulation.

2. In QGIS:
   - Toggle **only the relevant PDF raster ON** for the district you're working on (opacity ~40%).
   - Toggle the `AAC reference coords` layer ON — you'll snap to these.
   - Select the row in `Closures (EDITABLE)` whose `id` matches the closure
     you're about to draw. Note: the skeleton row has a placeholder point; **you
     will delete it** and replace with a polygon.

3. **Read the AAC text for that closure.** Three common patterns:

   **(a) Line-across-the-mouth closure** (majority). E.g. *24.350(3)(G) Port
   Gravina: "All waters of Port Gravina north of a line from 60°46.3′N, 146°15.0′W
   to 60°46.3′N, 145°50.0′W."*
   - Click the vertex at AAC point #1 (snap locks onto the yellow AAC coord).
   - Click vertex #2 (snap again).
   - Continue around the bay by snapping to the coastline layer (press `V` to
     auto-follow vertices).
   - Close the polygon. Done.

   **(b) Custom polygon closure** (a few — Cape Suckling/Kayak, some Copper
   Flats). E.g. *24.350(2)(B) specifies 7 vertices explicitly.*
   - Use **Edit → Advanced Digitizing → Feature as coordinates** or just click
     each AAC snap point in order. Don't snap to coastline here — the regulation
     defines the whole ring.

   **(c) Stream-buffer closure** (Copper Flats, Unakwik northern, Montague
   Strait). E.g. *1000-yard buffer from a list of anadromous streams.*
   - These are **not** to be hand-drawn. Leave the skeleton row alone; the rule-
     based pipeline handles them via AWC points. Mark `status='skip_handled_by_pipeline'`
     in the attribute table.

4. **After each feature:** set `status='done'` in the attribute table and
   save edits (Ctrl+S).

5. **After each district:** run Processing → Check Geometries on
   `Closures (EDITABLE)`. Fix any invalid rings. Then run the diff script:
   ```bash
   python3 docs/hand-created/tools/diff_vs_pipeline.py
   ```
   Review `docs/hand-created/diff_report.md` — IoU below 0.8 deserves a second look.

---

## Accuracy checks (run before promoting to production)

1. **Every AAC coord touches a polygon vertex within 1 m.**
   In QGIS: Processing → "Distance to nearest hub" with AAC coords as input
   and the hand layer as hubs. Any distance > 1 m = a missed snap.

2. **No closure crosses land.**
   Processing → "Clip" the hand layer by a coastline/water polygon (use
   PWS_Districts_2024 as a proxy since districts are marine). The clipped
   output should equal the input within 1–2 m² total.

3. **No closure extends outside its district.**
   Processing → "Intersects" against PWS_Districts_2024. Any closure whose
   `district` attribute doesn't match its parent district polygon is a bug.

4. **No overlap between closures** (unless the regulation explicitly nests
   them — e.g. Orca Inlet subdivisions).
   Processing → "Overlap analysis."

---

## Promoting to production

When you're done and all accuracy checks pass:

```bash
cp docs/hand-created/layers/permanent_closed_waters_hand.geojson \
   data/permanent_closed_waters.geojson

cp data/permanent_closed_waters.geojson \
   public/static/permanent_closed_waters.geojson

git add data/permanent_closed_waters.geojson \
        public/static/permanent_closed_waters.geojson \
        docs/hand-created/
git commit -m "Replace rule-based closures with hand-digitized closures (5 AAC 24.350)"
```

The review page at `/closed_waters_review.html` will pick up the new file
automatically.

---

## Realistic time budget

| Phase                                            | Time |
|--------------------------------------------------|------|
| Export 10 PDFs to PNG                            | 5 min |
| Georeference 10 PDFs with ≥8 GCPs each           | 1.5 h |
| QGIS project setup (`pyqgis_project_setup.py`)   | 5 min |
| Digitize 95 closures (avg 7 min each)            | 11 h |
| Accuracy checks + fixes                          | 1–2 h |
| **Total**                                         | **~14 h** |

Do it in ~2-hour sessions, one district per session. The first district feels
slow; by the third you'll have the rhythm.
