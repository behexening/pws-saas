# Run this inside QGIS:  Plugins → Python Console → Open Script → run.
# It loads every reference layer at the right opacity and snapping style so
# you can start digitizing immediately.
#
# Assumes this repo is at the path in REPO_ROOT below — change it if different.

from qgis.core import (
    QgsProject, QgsVectorLayer, QgsRasterLayer, QgsSymbol, QgsSingleSymbolRenderer,
    QgsSnappingConfig, QgsTolerance, QgsLayerTreeGroup
)
from qgis.PyQt.QtGui import QColor
from pathlib import Path

REPO_ROOT = Path('/Users/olivernessel/Documents/pws-saas')  # ← edit if needed

proj = QgsProject.instance()
proj.clear()
proj.setCrs(proj.crs().fromEpsgId(3338))   # NAD83 / Alaska Albers

# --- Basemaps -----------------------------------------------------------------
def add_xyz(name, url, maxzoom=19):
    u = f'type=xyz&url={url.replace("&", "%26")}&zmax={maxzoom}'
    l = QgsRasterLayer(u, name, 'wms')
    if l.isValid(): proj.addMapLayer(l)
    return l

noaa_rnc = add_xyz('NOAA RNC charts', 'https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png', 17)
esri_img = add_xyz('Esri World Imagery', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 19)
osm      = add_xyz('OpenStreetMap', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19)

# --- Vector references --------------------------------------------------------
def add_vec(name, path, opacity=1.0, color='#30363d', width=0.8, fill=None):
    l = QgsVectorLayer(str(path), name, 'ogr')
    if not l.isValid():
        print(f'  skipped {name}: {path}'); return None
    sym = QgsSymbol.defaultSymbol(l.geometryType())
    sym.setColor(QColor(color))
    if fill is not None: sym.symbolLayer(0).setFillColor(QColor(fill))
    r = QgsSingleSymbolRenderer(sym)
    l.setRenderer(r); l.setOpacity(opacity)
    proj.addMapLayer(l)
    return l

# --- Georeferenced ADF&G PDFs (loaded if VRTs exist) -------------------------
# Produced by QGIS Georef Extension plugin (Create Virtual Raster → .vrt).
# See tools/georeference_pdfs.md. We group them so you can toggle by district.
pdf_group = proj.layerTreeRoot().insertGroup(0, 'ADF&G PDFs (georeferenced)')
for vrt in sorted((REPO_ROOT / 'docs/hand-created/layers').glob('*.vrt')):
    l = QgsRasterLayer(str(vrt), vrt.stem, 'gdal')
    if l.isValid():
        proj.addMapLayer(l, addToLegend=False)
        pdf_group.addLayer(l)
        l.setOpacity(0.4)
    else:
        print(f'  skipped VRT {vrt.name} (invalid)')

add_vec('PWS districts',       REPO_ROOT / 'data/PWS_Districts_2024/districts.shp',     opacity=0.35, color='#888888', fill='#00000000')
add_vec('Subdistricts',        REPO_ROOT / 'data/PWS_Subdistricts_2024/subdistricts.shp', opacity=0.25, color='#666666', fill='#00000000')
add_vec('Hand-drawn bboxes',   REPO_ROOT / 'data/pws_bboxes.geojson',                    opacity=0.6,  color='#58a6ff', fill='#00000000')
add_vec('Rule-based closures', REPO_ROOT / 'data/permanent_closed_waters.geojson',       opacity=0.35, color='#dc4c4c', fill='#dc4c4c33')
add_vec('AAC reference coords',REPO_ROOT / 'docs/hand-created/layers/aac_coords.geojson', opacity=1.0,  color='#ffd166', fill='#ffd166')

# --- Editable target layer ----------------------------------------------------
hand = REPO_ROOT / 'docs/hand-created/layers/closures_skeleton.geojson'
editable = add_vec('Closures (EDITABLE)', hand, opacity=0.75, color='#3fb950', fill='#3fb95033')
if editable is not None:
    editable.startEditing()   # open in edit mode immediately

# --- Snapping -----------------------------------------------------------------
cfg = proj.snappingConfig()
cfg.setEnabled(True)
cfg.setMode(QgsSnappingConfig.AllLayers)
cfg.setType(QgsSnappingConfig.VertexAndSegment)
cfg.setTolerance(8)
cfg.setUnits(QgsTolerance.Pixels)
cfg.setIntersectionSnapping(True)
proj.setSnappingConfig(cfg)
proj.setTopologicalEditing(True)
proj.setAvoidIntersectionsMode(QgsProject.AvoidIntersectionsLayers)

print('Project set up. Switch to the "Closures (EDITABLE)" layer and start digitizing.')
print('Tips:')
print('  - Select the row you are working on first, then delete its placeholder point and Add Feature.')
print('  - Press S to toggle snapping; V to follow vertices; Shift+Right-click to enter exact lon/lat.')
print('  - After each district, run Processing → Check Geometries.')
