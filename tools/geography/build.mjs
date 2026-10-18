// Builds the static map assets in static/geo/ from public-domain sources:
//   - Natural Earth 1:10m vectors (land, minor islands, countries, admin-1, boundary lines)
//   - AWS Terrain Tiles ("terrarium" encoding) for elevation and bathymetry
//
// Usage: node build.mjs <data-dir>
//   <data-dir>/ne/<layer>/<layer>.shp must hold the unzipped Natural Earth layers.
//   Terrain tiles are downloaded on demand and cached under <data-dir>/tiles/.
//
// Everything is projected to Web Mercator so the elevation tiles line up with the vectors
// without resampling, and so the browser can project extra points with the same formula.

import fs from 'node:fs';
import path from 'node:path';
import * as shapefile from 'shapefile';
import { PNG } from 'pngjs';
import { contours } from 'd3-contour';
import polygonClipping from 'polygon-clipping';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(DATA, 'ne'))) {
  console.error('Usage: node build.mjs <data-dir containing ne/ shapefiles>');
  process.exit(1);
}
const OUT = path.join(ROOT, 'static', 'geo');
fs.mkdirSync(OUT, { recursive: true });

// ── Projection ────────────────────────────────────────────────────────────────
const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));

function makeProjection(bounds, width) {
  const kx = width / (bounds.east - bounds.west); // px per degree of longitude
  const k = kx / RAD; // px per radian
  const yTop = mercY(bounds.north);
  const height = Math.round((yTop - mercY(bounds.south)) * k);
  const project = ([lon, lat]) => [(lon - bounds.west) * kx, (yTop - mercY(lat)) * k];
  const invert = ([x, y]) => [bounds.west + x / kx, (2 * Math.atan(Math.exp(yTop - y / k)) - Math.PI / 2) / RAD];
  // Linear map from world-pixel coordinates at tile zoom z to SVG coordinates.
  const fromWorld = (z) => {
    const size = 256 * 2 ** z;
    return ([X, Y]) => [(X / size * 360 - 180 - bounds.west) * kx, (yTop - Math.PI * (1 - 2 * Y / size)) * k];
  };
  return { bounds, width, height, kx, k, yTop, project, invert, fromWorld };
}

const worldX = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z;
const worldY = (lat, z) => (1 - mercY(lat) / Math.PI) / 2 * 256 * 2 ** z;

// ── Geometry helpers ──────────────────────────────────────────────────────────
function clipRing(ring, box) {
  // Sutherland–Hodgman against an axis-aligned box [minX, minY, maxX, maxY].
  const edges = [
    (p) => p[0] >= box[0], (p) => p[0] <= box[2], (p) => p[1] >= box[1], (p) => p[1] <= box[3],
  ];
  const cut = [
    (a, b) => { const t = (box[0] - a[0]) / (b[0] - a[0]); return [box[0], a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (box[2] - a[0]) / (b[0] - a[0]); return [box[2], a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (box[1] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box[1]]; },
    (a, b) => { const t = (box[3] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box[3]]; },
  ];
  let output = ring;
  for (let e = 0; e < 4; e += 1) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[e](cur);
      const inPrev = edges[e](prev);
      if (inCur) {
        if (!inPrev) output.push(cut[e](prev, cur));
        output.push(cur);
      } else if (inPrev) output.push(cut[e](prev, cur));
    }
    if (!output.length) break;
  }
  return output;
}

function simplify(points, tolerance) {
  // Douglas–Peucker on an open polyline (rings are passed with their closing point).
  if (points.length <= 3) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = 0;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const dist = ex * ex + ey * ey;
      if (dist > maxDist) { maxDist = dist; index = i; }
    }
    if (maxDist > sq) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

const ringArea = (ring) => {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(area / 2);
};

const fmt = (n) => (Math.round(n * 10) / 10).toString();

// Rings in SVG space → path data. Drops rings smaller than minArea (px²).
function ringsToPath(rings, { tolerance = 0.4, minArea = 0.6, closed = true } = {}) {
  let d = '';
  for (const ring of rings) {
    if (ring.length < (closed ? 3 : 2)) continue;
    const pts = simplify(closed ? [...ring, ring[0]] : ring, tolerance);
    if (closed && (pts.length < 4 || ringArea(pts) < minArea)) continue;
    d += `M${pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}${closed ? 'Z' : ''}`;
  }
  return d;
}

// GeoJSON geometry (lon/lat) → list of projected rings, clipped to the map box.
function geometryRings(geometry, proj, pad = 2) {
  if (!geometry) return [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const box = [proj.bounds.west - pad, proj.bounds.south - pad, proj.bounds.east + pad, proj.bounds.north + pad];
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const clipped = clipRing(ring.map((p) => [p[0], Math.max(-85, Math.min(85, p[1]))]), box);
      if (clipped.length >= 3) rings.push(clipped.map(proj.project));
    }
  }
  return rings;
}

function lineStrings(geometry) {
  if (!geometry) return [];
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
}

async function readLayer(name, filter = () => true) {
  const file = path.join(DATA, 'ne', name, `${name}.shp`);
  const source = await shapefile.open(file, undefined, { encoding: 'utf-8' });
  const features = [];
  for (;;) {
    const result = await source.read();
    if (result.done) break;
    if (filter(result.value.properties || {}, result.value)) features.push(result.value);
  }
  return features;
}

const intersectsBounds = (feature, b, pad = 3) => {
  const box = feature.bbox;
  if (!box) return true;
  return !(box[2] < b.west - pad || box[0] > b.east + pad || box[3] < b.south - pad || box[1] > b.north + pad);
};

// ── Elevation tiles ───────────────────────────────────────────────────────────
async function fetchTile(z, x, y) {
  const dir = path.join(DATA, 'tiles', String(z), String(x));
  const file = path.join(dir, `${y}.png`);
  if (!fs.existsSync(file)) {
    const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
    if (!response.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${response.status}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return PNG.sync.read(fs.readFileSync(file));
}

async function loadDem(bounds, z) {
  const x0 = Math.floor(worldX(bounds.west, z) / 256);
  const x1 = Math.floor(worldX(bounds.east, z) / 256);
  const y0 = Math.floor(worldY(bounds.north, z) / 256);
  const y1 = Math.floor(worldY(bounds.south, z) / 256);
  const width = (x1 - x0 + 1) * 256;
  const height = (y1 - y0 + 1) * 256;
  const values = new Float32Array(width * height);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      const png = await fetchTile(z, tx, ty);
      for (let py = 0; py < 256; py += 1) {
        for (let px = 0; px < 256; px += 1) {
          const i = (py * 256 + px) * 4;
          const elevation = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          values[((ty - y0) * 256 + py) * width + (tx - x0) * 256 + px] = elevation;
        }
      }
    }
  }
  return { z, width, height, originX: x0 * 256, originY: y0 * 256, values };
}

function downsample(dem, factor) {
  if (factor === 1) return { ...dem, factor: 1 };
  const width = Math.floor(dem.width / factor);
  const height = Math.floor(dem.height / factor);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) for (let dx = 0; dx < factor; dx += 1) sum += dem.values[(y * factor + dy) * dem.width + x * factor + dx];
      values[y * width + x] = sum / (factor * factor);
    }
  }
  return { ...dem, width, height, values, factor };
}

function boxBlur(values, width, height, radius) {
  const tmp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0; let n = 0;
      for (let d = -radius; d <= radius; d += 1) { const xx = x + d; if (xx >= 0 && xx < width) { sum += values[y * width + xx]; n += 1; } }
      tmp[y * width + x] = sum / n;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0; let n = 0;
      for (let d = -radius; d <= radius; d += 1) { const yy = y + d; if (yy >= 0 && yy < height) { sum += tmp[yy * width + x]; n += 1; } }
      out[y * width + x] = sum / n;
    }
  }
  return out;
}

// Grid cell (col,row) of a (possibly downsampled) DEM → SVG coordinates.
const gridToSvg = (dem, proj) => {
  const toSvg = proj.fromWorld(dem.z);
  const f = dem.factor || 1;
  return ([cx, cy]) => toSvg([dem.originX + cx * f, dem.originY + cy * f]);
};

function contourLayers(dem, proj, thresholds, transform = (v) => v, opts = {}) {
  const values = Float64Array.from(dem.values, transform);
  const generator = contours().size([dem.width, dem.height]).thresholds(thresholds).smooth(true);
  const map = gridToSvg(dem, proj);
  return generator(values).map((layer) => {
    const rings = layer.coordinates.flatMap((polygon) => polygon.map((ring) => ring.map(map)));
    return { value: layer.value, d: ringsToPath(rings, opts) };
  });
}

// Shadow-only hillshade rendered as a transparent PNG aligned to the SVG canvas.
function hillshadePng(dem, proj, file, { scale = 1, zFactor = 1.6, strength = 0.62, landOnly = true } = {}) {
  const f = dem.factor || 1;
  const metersPerWorldPx = 40075016.686 / (256 * 2 ** dem.z);
  const shade = new Float32Array(dem.width * dem.height);
  const az = 315 * RAD;
  const alt = 45 * RAD;
  for (let y = 1; y < dem.height - 1; y += 1) {
    const worldYc = dem.originY + y * f;
    const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * worldYc / (256 * 2 ** dem.z)))) - Math.PI / 2);
    const cell = metersPerWorldPx * f * Math.cos(lat);
    for (let x = 1; x < dem.width - 1; x += 1) {
      const v = (dx, dy) => Math.max(0, dem.values[(y + dy) * dem.width + x + dx]);
      const dzdx = ((v(1, -1) + 2 * v(1, 0) + v(1, 1)) - (v(-1, -1) + 2 * v(-1, 0) + v(-1, 1))) / (8 * cell);
      const dzdy = ((v(-1, 1) + 2 * v(0, 1) + v(1, 1)) - (v(-1, -1) + 2 * v(0, -1) + v(1, -1))) / (8 * cell);
      const slope = Math.atan(zFactor * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      shade[y * dem.width + x] = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
    }
  }
  const flat = Math.sin(alt);
  const outW = Math.round(proj.width * scale);
  const outH = Math.round(proj.height * scale);
  const png = new PNG({ width: outW, height: outH });
  const size = 256 * 2 ** dem.z;
  for (let oy = 0; oy < outH; oy += 1) {
    const [, lat] = proj.invert([0, oy / scale]);
    const gy = (worldY(lat, dem.z) - dem.originY) / f;
    for (let ox = 0; ox < outW; ox += 1) {
      const [lon] = proj.invert([ox / scale, 0]);
      const gx = ((lon + 180) / 360 * size - dem.originX) / f;
      const ix = Math.round(gx);
      const iy = Math.round(gy);
      const i = (oy * outW + ox) * 4;
      png.data[i] = 38; png.data[i + 1] = 40; png.data[i + 2] = 44; png.data[i + 3] = 0;
      if (ix < 1 || iy < 1 || ix >= dem.width - 1 || iy >= dem.height - 1) continue;
      const elevation = dem.values[iy * dem.width + ix];
      if (landOnly && elevation <= 0) continue;
      const s = shade[iy * dem.width + ix];
      png.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (flat - s) * strength * 1.6)));
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
  return { width: outW, height: outH };
}

// Ring list (SVG space) → polygon-clipping MultiPolygon in lon/lat.
const svgRingsToGeo = (rings, proj) => rings.map((ring) => [[...ring, ring[0]].map(proj.invert)]);

function geoPolysToPath(multi, proj, opts) {
  const rings = multi.flatMap((polygon) => polygon.map((ring) => ring.map(proj.project)));
  return ringsToPath(rings, opts);
}

function largestPolygon(multi) {
  let best = null;
  let bestArea = 0;
  for (const polygon of multi) {
    const area = ringArea(polygon[0]);
    if (area > bestArea) { bestArea = area; best = polygon; }
  }
  return best ? [best] : [];
}

// ── Shared vector layers ──────────────────────────────────────────────────────
async function vectorBase(proj, { tolerance, minArea }) {
  const b = proj.bounds;
  const land = await readLayer('ne_10m_land', (_, f) => intersectsBounds(f, b));
  const minor = await readLayer('ne_10m_minor_islands', (_, f) => intersectsBounds(f, b));
  const landRings = [...land, ...minor].flatMap((f) => geometryRings(f.geometry, proj));
  const countries = await readLayer('ne_10m_admin_0_countries', (p, f) => intersectsBounds(f, b) && ['CHN', 'TWN', 'JPN', 'PHL', 'KOR', 'PRK', 'VNM'].includes(p.ADM0_A3));
  const countryPaths = Object.fromEntries(countries.map((f) => [f.properties.ADM0_A3, ringsToPath(geometryRings(f.geometry, proj, 0.5), { tolerance: tolerance * 2, minArea: minArea * 4 })]));
  const borders = await readLayer('ne_10m_admin_0_boundary_lines_land', (_, f) => intersectsBounds(f, b));
  // Keep only the runs of each boundary line that fall inside the (padded) map box.
  const inside = ([lon, lat]) => lon >= b.west - 1 && lon <= b.east + 1 && lat >= b.south - 1 && lat <= b.north + 1;
  const borderPath = borders.flatMap((f) => lineStrings(f.geometry)).flatMap((line) => {
    const runs = [];
    let run = [];
    for (const point of line) {
      if (inside(point)) run.push(proj.project(point));
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    return runs;
  });
  return {
    land: ringsToPath(landRings, { tolerance, minArea }),
    countries: countryPaths,
    borders: ringsToPath(borderPath, { tolerance, closed: false }),
  };
}

function graticule(proj, step) {
  const b = proj.bounds;
  const lines = [];
  const labels = [];
  for (let lon = Math.ceil(b.west / step) * step; lon <= b.east; lon += step) {
    const [x] = proj.project([lon, b.north]);
    lines.push(`M${fmt(x)} 0V${proj.height}`);
    labels.push({ text: `${lon}°E`, x: Number(fmt(x)), axis: 'x' });
  }
  for (let lat = Math.ceil(b.south / step) * step; lat <= b.north; lat += step) {
    const [, y] = proj.project([b.west, lat]);
    lines.push(`M0 ${fmt(y)}H${proj.width}`);
    labels.push({ text: `${lat}°N`, y: Number(fmt(y)), axis: 'y' });
  }
  return { d: lines.join(''), labels };
}

const projectPoint = (proj, lonlat) => proj.project(lonlat).map((n) => Number(fmt(n)));

// ── Theater map ───────────────────────────────────────────────────────────────
async function buildTheater() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'geography', 'theater.json'), 'utf8'));
  const proj = makeProjection(spec.bounds, 1400);
  console.log(`theater ${proj.width}×${proj.height}`);
  const base = await vectorBase(proj, { tolerance: 0.45, minArea: 0.5 });
  const dem = await loadDem(spec.bounds, 6);
  const coarse = downsample(dem, 2);
  coarse.values = boxBlur(coarse.values, coarse.width, coarse.height, 1);
  const depths = contourLayers(coarse, proj, [200, 1000, 2000, 4000, 6000], (v) => -v, { tolerance: 1.1, minArea: 14 });
  const relief = hillshadePng(downsample(dem, 1), proj, path.join(OUT, 'theater-relief.png'), { scale: 1, zFactor: 2.2, strength: 0.55 });

  const areas = Object.fromEntries(Object.entries(spec.areas).map(([id, area]) => [id, {
    d: ringsToPath([area.polygon.map((p) => proj.project(p))], { tolerance: 0 }),
    label: projectPoint(proj, area.label),
    anchor: projectPoint(proj, area.anchor),
    ...(area.rotate ? { rotate: area.rotate } : {}),
  }]));
  const bases = Object.fromEntries(Object.entries(spec.bases).map(([id, base]) => [id, { ...base, at: projectPoint(proj, base.at) }]));
  const out = {
    source: 'Natural Earth 1:10m (public domain); AWS Terrain Tiles / Mapzen terrarium (SRTM, GMTED, ETOPO1). Built by tools/geography/build.mjs.',
    projection: { type: 'web-mercator', ...spec.bounds, width: proj.width, height: proj.height },
    ...base,
    depths,
    relief: { href: '/geo/theater-relief.png', ...relief },
    graticule: graticule(proj, 5),
    areas,
    bases,
    labels: spec.labels.map((label) => ({ ...label, at: projectPoint(proj, label.at) })),
    places: spec.places.map((place) => ({ ...place, at: projectPoint(proj, place.at) })),
    kmPerPx: (40075.016 * Math.cos(24 * RAD)) / (360 * proj.kx),
  };
  fs.writeFileSync(path.join(OUT, 'theater.json'), JSON.stringify(out));
  console.log('theater.json', Math.round(fs.statSync(path.join(OUT, 'theater.json')).size / 1024), 'KB');
}

// ── Taiwan ground map ─────────────────────────────────────────────────────────
async function buildTaiwan() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'geography', 'taiwan.json'), 'utf8'));
  const proj = makeProjection(spec.bounds, 1400);
  console.log(`taiwan ${proj.width}×${proj.height}`);
  const base = await vectorBase(proj, { tolerance: 0.35, minArea: 0.4 });
  const dem = await loadDem(spec.bounds, 9);
  const half = downsample(dem, 2);
  const smooth = { ...half, values: boxBlur(half.values, half.width, half.height, 1) };
  const depths = contourLayers(smooth, proj, [50, 100, 200, 1000, 2000, 4000], (v) => -v, { tolerance: 0.6, minArea: 4 });
  const elevations = contourLayers(smooth, proj, [500, 1000, 2000, 3000], (v) => v, { tolerance: 0.6, minArea: 4 });
  const relief = hillshadePng(downsample(dem, 1), proj, path.join(OUT, 'taiwan-relief.png'), { scale: 1, zFactor: 1.2, strength: 0.62 });

  // Mountain interior: smoothed terrain above the threshold, largest connected body only.
  const mask = { ...half, values: boxBlur(half.values, half.width, half.height, 3) };
  const generator = contours().size([mask.width, mask.height]).thresholds([spec.mountain_threshold_m]).smooth(true);
  const toSvg = gridToSvg(mask, proj);
  const [maskLayer] = generator(Float64Array.from(mask.values));
  const maskGeo = largestPolygon(maskLayer.coordinates.map((polygon) => polygon.map((ring) => simplify(ring.map(toSvg), 0.8).map(proj.invert))));

  const counties = await readLayer('ne_10m_admin_1_states_provinces', (p) => p.adm0_a3 === 'TWN');
  const countyGeo = Object.fromEntries(counties.map((f) => {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return [f.properties.name.replace(/[\s\u0000]+$/, ''), polys];
  }));
  const zones = {};
  for (const [id, zone] of Object.entries(spec.zones)) {
    const missing = zone.counties.filter((name) => !countyGeo[name]);
    if (missing.length) throw new Error(`Unknown counties for ${id}: ${missing.join(', ')}`);
    const union = polygonClipping.union(...zone.counties.map((name) => countyGeo[name]));
    let shape = zone.mountain ? polygonClipping.intersection(union, maskGeo) : polygonClipping.difference(union, maskGeo);
    // Drop offshore islets (Green Island, Orchid Island, etc.) from the ground areas.
    shape = shape.filter((polygon) => ringArea(polygon[0].map(proj.project)) > 40);
    zones[id] = {
      d: geoPolysToPath(shape, proj, { tolerance: 0.5, minArea: 2 }),
      label: projectPoint(proj, zone.label),
      anchor: projectPoint(proj, zone.anchor),
      ...(zone.align ? { align: zone.align } : {}),
    };
  }
  const countyLines = ringsToPath(counties.flatMap((f) => geometryRings(f.geometry, proj)), { tolerance: 0.5, minArea: 1 });

  const out = {
    source: 'Natural Earth 1:10m (public domain); AWS Terrain Tiles / Mapzen terrarium (SRTM, GMTED, ETOPO1). Built by tools/geography/build.mjs.',
    projection: { type: 'web-mercator', ...spec.bounds, width: proj.width, height: proj.height },
    ...base,
    counties: countyLines,
    depths,
    elevations,
    relief: { href: '/geo/taiwan-relief.png', ...relief },
    graticule: graticule(proj, 1),
    zones,
    labels: spec.labels.map((label) => ({ ...label, at: projectPoint(proj, label.at) })),
    places: spec.places.map((place) => ({ ...place, at: projectPoint(proj, place.at) })),
    ports: spec.ports.map((port) => ({ ...port, at: projectPoint(proj, port.at) })),
    peaks: spec.peaks.map((peak) => ({ ...peak, at: projectPoint(proj, peak.at) })),
    assembly: { ...spec.assembly, at: projectPoint(proj, spec.assembly.at) },
    kmPerPx: (40075.016 * Math.cos(23.7 * RAD)) / (360 * proj.kx),
  };
  fs.writeFileSync(path.join(OUT, 'taiwan.json'), JSON.stringify(out));
  console.log('taiwan.json', Math.round(fs.statSync(path.join(OUT, 'taiwan.json')).size / 1024), 'KB');
}

await buildTheater();
await buildTaiwan();
