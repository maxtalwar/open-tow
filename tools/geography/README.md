# Map geography build

Dev-only tool that turns public map data into the static assets in `static/geo/`. The app itself has no runtime dependencies; you only need this when changing `data/geography/*.json` or the map styling inputs.

## Inputs

- `data/geography/theater.json`: map bounds, operational-area polygons, unit anchor points, base locations, labels.
- `data/geography/taiwan.json`: map bounds, ground areas (as lists of counties), the mountain threshold, places, ports, peaks, labels.
- Natural Earth 1:10m shapefiles, unzipped into `<data-dir>/ne/<layer>/<layer>.shp`:
  `ne_10m_land`, `ne_10m_minor_islands`, `ne_10m_admin_0_countries`, `ne_10m_admin_0_boundary_lines_land`, `ne_10m_admin_1_states_provinces`
  (download from `https://naciscdn.org/naturalearth/10m/{physical|cultural}/<layer>.zip`).
- AWS Terrain Tiles are downloaded on first run and cached in `<data-dir>/tiles/`.

## Run

```bash
cd tools/geography
npm install
node build.mjs /path/to/data-dir
```

## Outputs

- `static/geo/theater.json`, `static/geo/taiwan.json`: projected (Web Mercator) SVG path data, label and anchor positions.
- `static/geo/theater-relief.png`, `static/geo/taiwan-relief.png`: hillshade layers aligned to the same projection.
