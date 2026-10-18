const state = {
  side: 'BLUE', game: null, scenario: null, geo: { theater: null, ground: null },
  orders: [], action: 'missile_strike', filter: 'ALL', tab: 'orders', map: 'theater',
  selected: null, pinned: null, peakMunitions: null,
  replayEvents: [], replayRun: 0, replayRunning: false,
};
const $ = (id) => document.getElementById(id);

const SIDE_META = {
  BLUE: { short: 'Coalition', title: 'Coalition (BLUE)', members: 'United States · Taiwan · Japan', objective: 'Deny a sustainable PLA lodgment on Taiwan.' },
  RED: { short: 'PLA', title: 'PLA (RED)', members: 'Eastern Theater Command', objective: 'Invade, reinforce, and secure control of Taiwan.' },
};

const WEAPON_META = {
  BLUE: { jassm_er: ['JASSM-ER', 'land'], tomahawk: ['Tomahawk', 'land'], lrasm: ['LRASM', 'naval'], mst: ['Maritime Strike Tomahawk', 'naval'], harpoon: ['Harpoon', 'naval'] },
  RED: { tbm: ['Theater ballistic missile', 'land'], irbm: ['Intermediate-range ballistic missile', 'dual'], lacm: ['Land-attack cruise missile', 'land'], ascm: ['Anti-ship cruise missile', 'naval'] },
};
const AIR_WEAPONS = { BLUE: ['jassm_er', 'lrasm', 'harpoon'], RED: ['lacm', 'ascm'] };

const ACTIONS = [
  { id: 'missile_strike', label: 'Missile strike', group: 'Fires' },
  { id: 'air_mission', label: 'Air mission', group: 'Air' },
  { id: 'rebase', label: 'Rebase aircraft', group: 'Air' },
  { id: 'naval_move', label: 'Move surface group', group: 'Maritime' },
  { id: 'naval_mission', label: 'Surface-group mission', group: 'Maritime' },
  { id: 'submarine_mission', label: 'Submarine mission', group: 'Maritime' },
  { id: 'amphibious_lift', label: 'Amphibious lift', group: 'Ground' },
  { id: 'ground_order', label: 'Ground formation order', group: 'Ground' },
  { id: 'ground_attack', label: 'Force-wide ground attack', group: 'Ground' },
];
const actionLabel = (id) => ACTIONS.find((action) => action.id === id)?.label || humanize(id);

const KIND_LABEL = {
  fighter_5g: '5th-gen fighters', fighter_45g: '4.5-gen fighters', fighter_4g: '4th-gen fighters', bomber: 'Bombers', maritime_patrol: 'Maritime patrol',
  carrier: 'Carrier strike group', surface: 'Surface action group', amphibious: 'Amphibious group', nuclear_submarine: 'Nuclear submarines', diesel_submarine: 'Diesel submarines', submarine_contact: 'Submarine contact',
  infantry: 'Infantry brigade', mechanized: 'Mechanized brigade', armor: 'Armored brigade', artillery: 'Artillery brigade', airborne: 'Airborne brigade', engineer: 'Engineer brigade',
};

const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const unitIsActive = (unit) => unit.strength == null || Number(unit.strength) > .05;
const humanize = (value) => String(value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatNumber = (value, digits = 0) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—');
const pct = (value, max) => (Number(max) > 0 ? Math.max(0, Math.min(100, Number(value) / Number(max) * 100)) : 0);
const affiliation = (side) => (side === 'BLUE' ? 'friend' : 'hostile');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

async function load() {
  const [scenario, game, theater, ground] = await Promise.all([
    api('/api/scenario'), api(`/api/state?observer=${state.side}`), api('/geo/theater.json'), api('/geo/taiwan.json'),
  ]);
  Object.assign(state, { scenario, game });
  state.geo = { theater, ground };
  initMapViews();
  render();
}

function render() {
  trackPeakMunitions();
  renderAppbar();
  renderSituation();
  renderTheaterMap();
  renderGroundMap();
  renderCartouche();
  renderActionSelect();
  renderForm();
  renderStockpile();
  renderOrders();
  renderForces();
  renderEvents();
  updateReplayButton();
  $('seed-value').textContent = `Seed ${state.game.seed}`;
}

// ── App bar & situation ─────────────────────────────────────────────────────
function formatDays(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

function renderAppbar() {
  const { turn, max_turns: maxTurns, status } = state.game;
  const days = state.scenario?.turn_days || 3.5;
  $('turn-value').textContent = `Turn ${turn} of ${maxTurns}`;
  $('turn-days').textContent = `Days ${formatDays((turn - 1) * days)}–${formatDays(turn * days)}`;
  $('turn-track').innerHTML = Array.from({ length: maxTurns }, (_, index) => {
    const number = index + 1;
    const phase = number < turn || (status !== 'ACTIVE' && number <= turn) ? 'past' : number === turn && status === 'ACTIVE' ? 'now' : '';
    return `<i class="${phase}"></i>`;
  }).join('');
  document.body.dataset.side = state.side;
  document.querySelectorAll('#side-toggle [data-side]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.side === state.side)));
}

function renderSituation() {
  const { metrics, munitions, status, winner } = state.game;
  const control = Math.max(0, Math.min(100, Number(metrics.taiwan_control) || 0));
  const lodgment = Number(metrics.red_lodgment) || 0;
  const outcome = winner ? (winner === 'DRAW' ? 'Draw — contested lodgment' : `${SIDE_META[winner]?.short || winner} victory`) : 'In progress';
  $('situation').innerHTML = `
    <div class="sit-head"><h2>Situation · commanding ${escapeMarkup(SIDE_META[state.side].short)}</h2><span class="sit-status${status === 'ACTIVE' ? '' : ' done'}">${escapeMarkup(outcome)}</span></div>
    <div class="control-row"><span>PLA control of Taiwan</span><strong>${control.toFixed(0)}%</strong></div>
    <div class="control-scale" title="Engine victory rules: PLA wins at 80% control; at the final turn, under 50% is a Coalition win, otherwise a draw."><i style="width:${control}%"></i><b style="left:50%"><span>50 · draw</span></b><b style="left:80%"><span>80 · PLA win</span></b></div>
    <div class="sit-grid">
      <div><span>Taiwan defense</span><strong>${formatNumber(metrics.taiwan_defense, 1)}</strong></div>
      <div><span>PLA ashore</span><strong>${formatNumber(lodgment, 1)}</strong></div>
      <div><span>PLA supply ashore</span><strong>${lodgment > 0 ? `${(Number(metrics.red_ground_supply || 0) * 100).toFixed(0)}%` : '—'}</strong></div>
    </div>
    <p class="sit-note">Long-range munitions: Coalition ${formatNumber(munitions.BLUE.long_range)} · PLA ${formatNumber(munitions.RED.long_range)}</p>`;
}

function trackPeakMunitions() {
  if (!state.peakMunitions) state.peakMunitions = { BLUE: {}, RED: {} };
  ['BLUE', 'RED'].forEach((side) => Object.entries(state.game.munitions[side] || {}).forEach(([key, value]) => {
    state.peakMunitions[side][key] = Math.max(state.peakMunitions[side][key] || 0, Number(value) || 0);
  }));
}

// ── Military symbols (MIL-STD-2525-style frames) ────────────────────────────
// Frame geometry by battle dimension and affiliation, in symbol units (≈30 wide).
const FRAMES = {
  friend: {
    air: { d: 'M-15 9V-1A15 14 0 0 1 15 -1V9', box: [-11, -10, 11, 8], top: -15, bottom: 9 },
    sea: { d: 'M13 0A13 13 0 1 1 -13 0A13 13 0 1 1 13 0Z', box: [-9, -9, 9, 9], top: -13, bottom: 13 },
    sub: { d: 'M-15 -9V1A15 14 0 0 0 15 1V-9', box: [-11, -8, 11, 8], top: -9, bottom: 15 },
    land: { d: 'M-17 -11H17V11H-17Z', box: [-17, -11, 17, 11], top: -11, bottom: 11 },
    installation: { d: 'M-12 -8H12V8H-12Z', box: [-12, -8, 12, 8], top: -8, bottom: 8 },
  },
  hostile: {
    air: { d: 'M-15 9V-1L0 -16L15 -1V9', box: [-9, -7, 9, 8], top: -16, bottom: 9 },
    sea: { d: 'M0 -15L15 0L0 15L-15 0Z', box: [-8, -8, 8, 8], top: -15, bottom: 15 },
    sub: { d: 'M-15 -9V1L0 16L15 1V-9', box: [-9, -8, 9, 7], top: -9, bottom: 16 },
    land: { d: 'M0 -16L16 0L0 16L-16 0Z', box: [-8, -8, 8, 8], top: -16, bottom: 16 },
    installation: { d: 'M0 -12L12 0L0 12L-12 0Z', box: [-6, -6, 6, 6], top: -12, bottom: 12 },
  },
};

const PLANE = 'M0 -7.5V4.5M-8 -1.5L0 -4L8 -1.5M-3.2 4L0 3L3.2 4';
const ANCHOR = 'M0 -5.5V5M-3 -3.5H3M-5 1.5Q0 7.5 5 1.5';

function unitDimension(unit) {
  if (unit.hex_id !== undefined || unit.attack !== undefined) return 'land';
  if (unit.domain === 'air') return 'air';
  if (unit.domain === 'submarine') return 'sub';
  return 'sea';
}

function symbolIcon(kind, dimension, frame) {
  const [x0, y0, x1, y1] = frame.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const text = (value, y = 0, size) => `<text class="icon-text" x="0" y="${y}"${size ? ` style="font-size:${size}px"` : ''}>${value}</text>`;
  if (dimension === 'air') {
    const letter = { fighter_5g: 'F', fighter_45g: 'F', fighter_4g: 'F', bomber: 'B', maritime_patrol: 'P' }[kind] || '';
    return `<path class="icon" d="${PLANE}" transform="translate(0 ${y0 + 6.5}) scale(.82)"/>${letter ? text(letter, y1 - 3.2, 6.5) : ''}`;
  }
  if (dimension === 'sea') return text({ carrier: 'CV', surface: 'SAG', amphibious: 'AMPH' }[kind] || 'SUR', 0, kind === 'amphibious' ? 6.5 : 7.5);
  if (dimension === 'sub') return text({ nuclear_submarine: 'SSN', diesel_submarine: 'SSK', submarine_contact: '?' }[kind] || 'SUB', -1.5, kind === 'submarine_contact' ? 10 : 7);
  if (dimension === 'installation') return kind === 'naval_base' ? `<path class="icon" d="${ANCHOR}" transform="scale(.9)"/>` : `<path class="icon" d="${PLANE}" transform="scale(.72)"/>`;
  // Land unit icons drawn inside the frame's inscribed box.
  const cross = `M${x0} ${y0}L${x1} ${y1}M${x1} ${y0}L${x0} ${y1}`;
  const oval = `<ellipse class="icon" cx="0" cy="0" rx="${w * .3}" ry="${h * .27}"/>`;
  if (kind === 'infantry') return `<path class="icon" d="${cross}"/>`;
  if (kind === 'armor') return oval;
  if (kind === 'mechanized') return `<path class="icon" d="${cross}"/>${oval}`;
  if (kind === 'artillery') return '<circle class="icon-fill" r="2.6"/>';
  if (kind === 'airborne') return `<path class="icon" d="${cross}"/><path class="icon" d="M-5 ${y1 - 1.5}A5 3.5 0 0 1 5 ${y1 - 1.5}"/>`;
  if (kind === 'engineer') return `<path class="icon" d="M${x0 * .7} 3V-3H${x1 * .7}V3M0 -3V3"/>`;
  return '<circle class="icon" r="4"/>';
}

function strengthBar(unit, frame) {
  const max = Number(unit.max_strength);
  const known = unit.strength != null && Number.isFinite(Number(unit.strength)) && max > 0;
  const y = frame.bottom + 3;
  const width = 26;
  const fill = known ? `<rect class="str-fill" x="${-width / 2}" y="${y}" width="${(width * pct(unit.strength, max) / 100).toFixed(1)}" height="3"/>` : `<rect class="str-unknown" x="${-width / 2}" y="${y}" width="${width}" height="3"/>`;
  return `<rect class="str-track" x="${-width / 2}" y="${y}" width="${width}" height="3"/>${fill}`;
}

// Returns inner symbol markup (no positioning). opts: { echelon, strength }
function symbolMarkup(side, dimension, kind, unit = null, opts = {}) {
  const frame = FRAMES[affiliation(side)][dimension];
  const echelon = opts.echelon ? `<path class="echelon" d="M-3 ${frame.top - 8}L3 ${frame.top - 3}M3 ${frame.top - 8}L-3 ${frame.top - 3}"/>` : '';
  const installationBar = dimension === 'installation' ? `<rect class="icon-fill" x="-4.5" y="${frame.top - 3.5}" width="9" height="3.5"/>` : '';
  return `<path class="halo" d="${frame.d}"/><path class="frame" d="${frame.d}"/>${installationBar}${symbolIcon(kind, dimension, frame)}${echelon}${unit && opts.strength !== false ? strengthBar(unit, frame) : ''}`;
}

function miniSymbol(side, dimension, kind, unit = null, opts = {}) {
  return `<svg viewBox="-22 -20 44 40" aria-hidden="true"><g class="sym ${affiliation(side)}">${symbolMarkup(side, dimension, kind, unit, opts)}</g></svg>`;
}

// ── Map views (pan / zoom via viewBox) ──────────────────────────────────────
const views = {};

function initMapViews() {
  [['theater', $('map'), state.geo.theater], ['ground', $('ground-map'), state.geo.ground]].forEach(([key, svg, geo]) => {
    const { width, height } = geo.projection;
    views[key] = { svg, full: { x: 0, y: 0, w: width, h: height }, view: { x: 0, y: 0, w: width, h: height } };
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    attachPanZoom(key);
    svg.addEventListener('click', () => {
      state.pinned = null; state.selected = null;
      svg.querySelectorAll('.sym.selected').forEach((node) => node.classList.remove('selected'));
      hideTooltip();
      renderForces();
    });
  });
  views.theater.home = boxOf(state.geo.theater.projection, [111, 10.5], [149, 36.8]);
  views.ground.home = boxOf(state.geo.ground.projection, [118.9, 21.85], [122.75, 25.4]);
  fitView('theater', views.theater.home);
  fitView('ground', views.ground.home);
}

function boxOf(projection, [west, south], [east, north]) {
  const [x0, y0] = projectWith(projection, [west, north]);
  const [x1, y1] = projectWith(projection, [east, south]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const stageAspect = () => { const stage = $('map-stage'); return stage.clientWidth && stage.clientHeight ? stage.clientWidth / stage.clientHeight : 1.4; };

// Fit a content box into the viewport, matching the viewport's aspect ratio so nothing letterboxes.
function fitView(key, box) {
  const aspect = stageAspect();
  const view = views[key].view;
  if (box.w / box.h > aspect) { view.w = box.w; view.h = box.w / aspect; } else { view.h = box.h; view.w = box.h * aspect; }
  view.x = box.x + box.w / 2 - view.w / 2;
  view.y = box.y + box.h / 2 - view.h / 2;
  clampView(key);
  applyView(key);
}

function projectWith(p, [lon, lat]) {
  const mercY = (value) => Math.log(Math.tan(Math.PI / 4 + value * Math.PI / 360));
  const kx = p.width / (p.east - p.west);
  const k = kx * 180 / Math.PI;
  return [(lon - p.west) * kx, (mercY(p.north) - mercY(lat)) * k];
}

function applyView(key) {
  const { svg, view, full } = views[key];
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  // Symbols and labels keep a near-constant on-screen size; symbols grow slightly as you zoom in.
  const stage = $('map-stage');
  const pxPerUnit = (stage.clientWidth || 1000) / view.w;
  const zoom = full.w / view.w;
  const narrow = Math.min(1, Math.sqrt((stage.clientWidth || 1000) / 900));
  svg.style.setProperty('--sym', String((1.08 * narrow / pxPerUnit) * Math.pow(zoom, 0.18)));
  svg.style.setProperty('--k', String(1 / pxPerUnit));
  svg.classList.toggle('zoomed', pxPerUnit > 1.25);
  svg.classList.toggle('zoomed-far', pxPerUnit > 2.4);
  if (key === state.map) renderScalebar();
}

function clampView(key) {
  const { view, full } = views[key];
  const aspect = stageAspect();
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  view.w = Math.max(full.w / 10, Math.min(Math.max(full.w, full.h * aspect) * 1.05, view.w));
  view.h = view.w / aspect;
  view.x = cx - view.w / 2;
  view.y = cy - view.h / 2;
  const slackX = Math.max(0, view.w - full.w) / 2 + view.w * .25;
  const slackY = Math.max(0, view.h - full.h) / 2 + view.h * .25;
  view.x = Math.max(full.x - slackX, Math.min(full.w - view.w + slackX, view.x));
  view.y = Math.max(full.y - slackY, Math.min(full.h - view.h + slackY, view.y));
}

function zoomTo(key, cx, cy, factor) {
  const { view } = views[key];
  const w = view.w / factor;
  const h = view.h / factor;
  view.x = cx - (cx - view.x) * (w / view.w);
  view.y = cy - (cy - view.y) * (h / view.h);
  view.w = w; view.h = h;
  clampView(key);
  applyView(key);
}

function centerOn(key, x, y, minZoom = 1.6) {
  const { view, full } = views[key];
  if (full.w / view.w < minZoom) { view.w = full.w / minZoom; view.h = full.h / minZoom; }
  view.x = x - view.w / 2;
  view.y = y - view.h / 2;
  clampView(key);
  applyView(key);
}

function svgPoint(svg, clientX, clientY) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function attachPanZoom(key) {
  const { svg } = views[key];
  let drag = null;
  let lastDragEnd = 0;
  // Swallow the click that follows a pan so it doesn't clear the selection or pin an area.
  svg.addEventListener('click', (event) => { if (performance.now() - lastDragEnd < 80) event.stopPropagation(); }, { capture: true });
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = svgPoint(svg, event.clientX, event.clientY);
    zoomTo(key, point.x, point.y, event.deltaY < 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.sym')) return;
    drag = { start: svgPoint(svg, event.clientX, event.clientY), x: event.clientX, y: event.clientY, moved: false };
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    if (!drag.moved) { drag.moved = true; svg.setPointerCapture(event.pointerId); svg.classList.add('dragging'); hideTooltip(); }
    const now = svgPoint(svg, event.clientX, event.clientY);
    views[key].view.x -= now.x - drag.start.x;
    views[key].view.y -= now.y - drag.start.y;
    clampView(key);
    applyView(key);
  });
  const end = (event) => {
    if (drag?.moved) {
      svg.classList.remove('dragging');
      svg.releasePointerCapture?.(event.pointerId);
      lastDragEnd = performance.now();
    }
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function renderScalebar() {
  const geo = state.map === 'theater' ? state.geo.theater : state.geo.ground;
  const { svg, view } = views[state.map] || {};
  const bar = document.querySelector('#map-cartouche .scalebar');
  if (!svg || !bar || !svg.clientWidth) return;
  const scale = svg.clientWidth / view.w;
  const kmPerScreenPx = geo.kmPerPx / scale;
  const target = kmPerScreenPx * 110;
  const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((value) => value >= target * .6) || 2000;
  bar.innerHTML = `<i style="width:${(nice / kmPerScreenPx).toFixed(0)}px"></i><span>${nice} km</span>`;
}

// ── Shared map defs ─────────────────────────────────────────────────────────
const DEPTH_FILLS = { 50: '#d6e6ec', 100: '#cfe1e8', 200: '#c9dde5', 1000: '#bdd4de', 2000: '#b1cbd7', 4000: '#a5c2d0', 6000: '#98b8c8' };
const ELEVATION_FILLS = { 500: 'rgba(196,178,134,.16)', 1000: 'rgba(181,158,108,.2)', 2000: 'rgba(160,134,86,.22)', 3000: 'rgba(132,104,62,.26)' };

function mapDefs(id) {
  return `<defs>
    ${id === 'th'
    ? '<pattern id="th-contested" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V10" stroke="rgba(150,105,30,.28)" stroke-width="1.2"/></pattern>'
    : '<pattern id="gr-contested" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(183,134,42,.1)"/><path d="M0 0V7" stroke="rgba(160,112,30,.55)" stroke-width="2.2"/></pattern>'}
    <pattern id="${id}-unknown" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" fill="#fff"/><path d="M0 0V3" stroke="#1b1d1f" stroke-width="1"/></pattern>
    <clipPath id="${id}-frame"><rect width="${id === 'th' ? state.geo.theater.projection.width : state.geo.ground.projection.width}" height="${id === 'th' ? state.geo.theater.projection.height : state.geo.ground.projection.height}"/></clipPath>
  </defs>`;
}

function baseLayers(geo, id) {
  const { width, height } = geo.projection;
  const depths = geo.depths.map((layer) => `<path class="depth" d="${layer.d}" fill="${DEPTH_FILLS[layer.value] || '#a0bccb'}"/>`).join('');
  const graticuleLabels = geo.graticule.labels.map((label) => (label.axis === 'x'
    ? `<text class="graticule-label" x="${label.x + 3}" y="${height - 5}" style="font-size:calc(9px * var(--k, 1))">${label.text}</text>`
    : `<text class="graticule-label" x="4" y="${label.y - 3}" style="font-size:calc(9px * var(--k, 1))">${label.text}</text>`)).join('');
  return `<g clip-path="url(#${id}-frame)">
    <rect class="water" width="${width}" height="${height}"/>
    ${depths}
    <path class="graticule" d="${geo.graticule.d}"/>
    <path class="land" d="${geo.land}"/>
    ${geo.countries.CHN ? `<path class="land-cn" d="${geo.countries.CHN}"/>` : ''}
    ${(geo.elevations || []).map((layer) => `<path class="elevation" d="${layer.d}" fill="${ELEVATION_FILLS[layer.value] || 'transparent'}"/>`).join('')}
    <image class="relief" href="${geo.relief.href}" width="${width}" height="${height}" preserveAspectRatio="none"/>
    <path class="coast" d="${geo.land}"/>
    <path class="border" d="${geo.borders}"/>
    ${graticuleLabels}
  </g>`;
}

const scaled = (size) => `style="font-size:calc(${size}px * var(--k, 1))"`;

function labelLayer(geo) {
  const labels = geo.labels.map((label) => {
    const cls = `${label.kind === 'country' ? `country-label${label.small ? ' small' : ''}` : label.kind === 'water' ? 'water-label' : 'island-label'}${label.minor ? ' minor' : ''}`;
    const size = label.kind === 'country' ? (label.small ? 10 : 13) : label.kind === 'water' ? 11 : 9.5;
    const rotate = label.rotate ? ` transform="rotate(${label.rotate} ${label.at[0]} ${label.at[1]})"` : '';
    return `<text class="${cls}" x="${label.at[0]}" y="${label.at[1]}"${rotate} ${scaled(size)}>${escapeMarkup(label.text)}</text>`;
  }).join('');
  const places = geo.places.filter((place) => place.at[0] >= 0 && place.at[1] >= 0 && place.at[0] <= geo.projection.width && place.at[1] <= geo.projection.height).map((place) => `<g class="place" style="transform:translate(${place.at[0]}px,${place.at[1]}px) scale(var(--sym,1))"><circle class="place-dot${place.capital ? ' capital' : ' minor'}" r="${place.capital ? 2.8 : 2.2}"/><text class="place-label${place.capital ? '' : ' minor'}" x="5" y="3.5">${escapeMarkup(place.name)}</text></g>`).join('');
  return labels + places;
}

// Lay out n symbols in a compact grid, centered or stacked to one side of the origin (symbol units).
function gridOffsets(count, { columns = 3, dx = 36, dy = 40, origin = 'center' } = {}) {
  const cols = Math.min(columns, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = (col - (cols - 1) / 2) * dx;
    const cy = (row - (rows - 1) / 2) * dy;
    if (origin === 'right') return { x: 30 + col * dx, y: cy };
    if (origin === 'left') return { x: -30 - col * dx, y: cy };
    if (origin === 'below') return { x: cx, y: 36 + row * dy };
    if (origin === 'above') return { x: cx, y: -36 - row * dy };
    return { x: cx, y: cy };
  });
}

function unitSymbolAt(unit, offset, kind = 'unit') {
  const dimension = unitDimension(unit);
  const selected = state.selected?.id === unit.id ? ' selected' : '';
  const depleted = !unitIsActive(unit) ? ' depleted' : '';
  const strength = unit.strength == null ? 'strength unknown' : `${formatNumber(unit.strength, 1)} of ${formatNumber(unit.max_strength, 1)} strength`;
  return `<g class="sym ${affiliation(unit.side)}${selected}${depleted}" transform="translate(${offset.x} ${offset.y})" data-kind="${kind}" data-id="${escapeMarkup(unit.id)}" tabindex="0" role="button" aria-label="${escapeMarkup(unit.name)}, ${SIDE_META[unit.side].short}, ${strength}"><rect class="hit" x="-18" y="-18" width="36" height="40"/>${symbolMarkup(unit.side, dimension, unit.kind, unit, { echelon: dimension === 'land' })}</g>`;
}

const cluster = (x, y, inner) => `<g class="cluster" style="transform:translate(${x}px,${y}px) scale(var(--sym,1))">${inner}</g>`;

// ── Theater map ─────────────────────────────────────────────────────────────
function renderTheaterMap() {
  const geo = state.geo.theater;
  const game = state.game;
  const svg = $('map');
  const units = Object.values(game.units).filter(unitIsActive);
  const areaMarkup = Object.entries(geo.areas).map(([id, area]) => {
    const sides = new Set(units.filter((unit) => unit.region === id).map((unit) => unit.side));
    const held = sides.size === 2 ? 'held-both' : sides.has('BLUE') ? 'held-blue' : sides.has('RED') ? 'held-red' : '';
    return `<path class="area ${held}${id === 'taiwan' ? ' objective' : ''}" d="${area.d}" data-area="${id}" ${held === 'held-both' ? 'style="fill:url(#th-contested)"' : ''}/>`;
  }).join('');
  const areaLabels = Object.entries(geo.areas).map(([id, area]) => `<text class="area-label${id === 'taiwan' ? ' objective' : ''}" x="${area.label[0]}" y="${area.label[1]}"${area.rotate ? ` transform="rotate(${area.rotate} ${area.label[0]} ${area.label[1]})"` : ''} ${scaled(11.5)}>${escapeMarkup(game.regions[id]?.name || humanize(id))}</text>`).join('');

  // Bases with their based air formations stacked beside them; everything else at the area anchor.
  let symbols = '';
  const placedUnits = new Set();
  Object.entries(game.bases).forEach(([id, base]) => {
    const spot = geo.bases[id];
    if (!spot) return;
    const based = units.filter((unit) => unit.domain === 'air' && unit.base_id === id && unit.region === base.region);
    based.forEach((unit) => placedUnits.add(unit.id));
    const offsets = gridOffsets(based.length, { columns: 2, origin: spot.stack === 'left' ? 'left' : spot.stack === 'above' ? 'above' : spot.stack === 'below' ? 'below' : 'right' });
    const damaged = Number(base.damage || 0) > .005;
    const baseSym = `<g class="sym ${affiliation(base.side)}${state.selected?.id === id ? ' selected' : ''}" data-kind="base" data-id="${escapeMarkup(id)}" tabindex="0" role="button" aria-label="${escapeMarkup(base.name)}"><rect class="hit" x="-14" y="-16" width="28" height="30"/>${symbolMarkup(base.side, 'installation', base.kind)}</g>`;
    // Label on the side opposite the stacked formations.
    const labelPos = { left: 'x="13" y="4" style="text-anchor:start"', right: 'x="-13" y="4" style="text-anchor:end"', above: 'x="0" y="24" style="text-anchor:middle"', below: 'x="0" y="-16" style="text-anchor:middle"' }[spot.stack] || 'x="0" y="24"';
    const label = `<text class="base-label" ${labelPos}>${escapeMarkup(spot.label)}${damaged ? `<tspan class="damage-text" dx="4">−${(Number(base.damage) * 100).toFixed(0)}%</tspan>` : ''}</text>`;
    symbols += cluster(spot.at[0], spot.at[1], `<g transform="scale(.8)">${baseSym}</g>${label}${based.map((unit, index) => unitSymbolAt(unit, offsets[index])).join('')}`);
  });
  Object.entries(geo.areas).forEach(([id, area]) => {
    const here = units.filter((unit) => unit.region === id && !placedUnits.has(unit.id));
    if (!here.length) return;
    const offsets = gridOffsets(here.length, { columns: 3 });
    symbols += cluster(area.anchor[0], area.anchor[1], here.map((unit, index) => unitSymbolAt(unit, offsets[index])).join(''));
  });

  svg.innerHTML = `${mapDefs('th')}${baseLayers(geo, 'th')}
    <g class="areas">${areaMarkup}</g>
    <g class="labels">${labelLayer(geo)}${areaLabels}</g>
    <g class="symbols">${symbols}</g>
    <g id="event-overlay" class="replay-overlay side-neutral" aria-hidden="true"></g>`;
  attachSymbolInteractions(svg);
  attachAreaInteractions(svg, 'area', (id) => game.regions[id]?.adjacent || []);
  restorePinned();
}

// ── Taiwan ground map ───────────────────────────────────────────────────────
function renderGroundMap() {
  const geo = state.geo.ground;
  const game = state.game;
  const svg = $('ground-map');
  const groundUnits = Object.values(game.ground_units || {});
  const zones = Object.entries(geo.zones).filter(([id]) => game.ground_hexes?.[id]);
  const zoneFill = zones.map(([id, zone]) => {
    const controller = String(game.ground_hexes[id].controller || 'none').toLowerCase();
    return `<path class="zone control-${controller}" d="${zone.d}" ${controller === 'contested' ? 'style="fill:url(#gr-contested)"' : ''}/>`;
  }).join('');
  const zoneLines = zones.map(([, zone]) => `<path class="zone-line" d="${zone.d}"/>`).join('');
  const zoneHits = zones.map(([id, zone]) => `<path class="zone-hit" d="${zone.d}" data-zone="${id}"/>`).join('');
  const zoneLabels = zones.map(([id, zone]) => {
    const hex = game.ground_hexes[id];
    const feature = hex.beach ? `Beach · coastal def. ${formatNumber(hex.coastal_defense, 1)}` : hex.port ? 'Port' : humanize(String(hex.terrain || '').split('/')[0]);
    const align = zone.align ? ` style="text-anchor:${zone.align}"` : '';
    return `<g class="zone-callout" style="transform:translate(${zone.label[0]}px,${zone.label[1]}px) scale(var(--k,1))"><text class="zone-label"${align}>${escapeMarkup(hex.name)}</text><text class="zone-sub" y="12"${align}>${escapeMarkup(feature)}</text></g>`;
  }).join('');
  const peaks = geo.peaks.map((peak) => cluster(peak.at[0], peak.at[1], `<path class="peak" d="M0 -4L4 3H-4Z"/><text class="peak-label" x="6" y="3">${escapeMarkup(peak.name)} ${peak.elevation} m</text>`)).join('');
  const ports = geo.ports.map((port) => cluster(port.at[0], port.at[1], `<g><title>${escapeMarkup(port.name)}</title><circle r="5.5" fill="#fff" stroke="#1f3a5f" stroke-width="1"/><path class="port-icon" d="${ANCHOR}" transform="scale(.62)"/></g>`)).join('');

  let symbols = '';
  zones.forEach(([id, zone]) => {
    const here = groundUnits.filter((unit) => unit.strength > .05 && unit.hex_id === id);
    if (!here.length) return;
    const offsets = gridOffsets(here.length, { columns: 3, dx: 38, dy: 44 });
    symbols += cluster(zone.anchor[0], zone.anchor[1], here.map((unit, index) => unitSymbolAt(unit, offsets[index], 'ground')).join(''));
  });
  const reserves = groundUnits.filter((unit) => unit.side === 'RED' && unit.strength <= .05 && unit.reserve_strength > .05);
  if (reserves.length && geo.assembly) {
    const offsets = gridOffsets(reserves.length, { columns: 3, dx: 38, dy: 44 });
    const asReserve = (unit) => ({ ...unit, strength: unit.reserve_strength });
    symbols += cluster(geo.assembly.at[0], geo.assembly.at[1], `<text class="zone-label" x="0" y="${-Math.ceil(reserves.length / 3) * 22 - 26}">${escapeMarkup(geo.assembly.label)}</text><text class="zone-sub" x="0" y="${-Math.ceil(reserves.length / 3) * 22 - 14}">${reserves.length} formation${reserves.length === 1 ? '' : 's'} awaiting lift</text>${reserves.map((unit, index) => unitSymbolAt(asReserve(unit), offsets[index], 'ground')).join('')}`);
  }

  svg.innerHTML = `${mapDefs('gr')}${baseLayers(geo, 'gr')}
    <g clip-path="url(#gr-frame)">${zoneFill}<path class="county" d="${geo.counties}"/>${zoneLines}${zoneHits}</g>
    <g class="labels">${labelLayer(geo)}${zoneLabels}${peaks}${ports}</g>
    <g class="symbols">${symbols}</g>`;
  attachSymbolInteractions(svg);
  attachAreaInteractions(svg, 'zone', (id) => game.ground_hexes[id]?.adjacent || []);
  restorePinned();
}

// ── Cartouche & legend ──────────────────────────────────────────────────────
function renderCartouche() {
  const theater = state.map === 'theater';
  // SVG elements have no .hidden property, so toggle the attribute directly.
  $('map').toggleAttribute('hidden', !theater);
  $('ground-map').toggleAttribute('hidden', theater);
  document.querySelectorAll('#map-switch [data-map]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.map === state.map)));
  const supply = Number(state.game.metrics.red_ground_supply || 0);
  $('map-cartouche').classList.toggle('right', !theater);
  $('map-cartouche').innerHTML = theater
    ? `<h2>Western Pacific — operational map</h2><p>Operational areas (≈600 km) are schematic; dashed lines are area boundaries. Air formations are shown at their bases. Hover an area to see the areas linked to it.</p><div class="scalebar"></div>`
    : `<h2>Taiwan — ground operations</h2><p>Ground areas follow county boundaries; the Central Mountains area is terrain above 900 m. Formations move one linked area per turn.${Number(state.game.metrics.red_lodgment) > 0 ? ` PLA supply ashore ${(supply * 100).toFixed(0)}%.` : ''}</p><div class="scalebar"></div>`;
  renderLegend();
  renderScalebar();
}

function renderLegend() {
  const theater = state.map === 'theater';
  const open = $('map-legend').querySelector('details')?.open ?? false;
  const item = (svg, label) => `<span class="legend-item">${svg}${label}</span>`;
  const swatch = (style, label) => `<span class="legend-item"><i class="legend-swatch" style="${style}"></i>${label}</span>`;
  const demo = { max_strength: 1, strength: .6 };
  const body = theater ? `
    <h4>Frames (blue = coalition, red = PLA)</h4>
    ${item(miniSymbol('BLUE', 'air', 'fighter_5g', null), 'Air · F fighter, B bomber, P patrol')}
    ${item(miniSymbol('RED', 'air', 'bomber', null), 'Hostile air')}
    ${item(miniSymbol('BLUE', 'sea', 'carrier', null), 'Surface · CV, SAG, AMPH')}
    ${item(miniSymbol('RED', 'sea', 'amphibious', null), 'Hostile surface')}
    ${item(miniSymbol('BLUE', 'sub', 'nuclear_submarine', null), 'Subsurface · SSN, SSK')}
    ${item(miniSymbol('RED', 'sub', 'diesel_submarine', null), 'Hostile subsurface')}
    <h4>Installations & status</h4>
    ${item(miniSymbol('BLUE', 'installation', 'airbase'), 'Air base')}
    ${item(miniSymbol('BLUE', 'installation', 'naval_base'), 'Naval base')}
    ${item(miniSymbol('BLUE', 'sea', 'surface', demo), 'Bar = remaining strength')}
    ${swatch('border-color:#2f5262;border-style:dashed;background:transparent', 'Operational area')}`
    : `
    <h4>Ground formations (brigades)</h4>
    ${item(miniSymbol('BLUE', 'land', 'infantry', null, { echelon: true }), 'Infantry')}
    ${item(miniSymbol('BLUE', 'land', 'mechanized', null, { echelon: true }), 'Mechanized')}
    ${item(miniSymbol('BLUE', 'land', 'armor', null, { echelon: true }), 'Armor')}
    ${item(miniSymbol('BLUE', 'land', 'artillery', null, { echelon: true }), 'Artillery')}
    ${item(miniSymbol('RED', 'land', 'airborne', null, { echelon: true }), 'Airborne / marine')}
    ${item(miniSymbol('RED', 'land', 'engineer', null, { echelon: true }), 'Engineer')}
    <h4>Area control</h4>
    ${swatch('background:rgba(43,108,176,.16);border-color:#2b3a40', 'Taiwan')}
    ${swatch('background:rgba(179,58,46,.24);border-color:#2b3a40', 'PLA')}
    ${swatch('background:repeating-linear-gradient(45deg,rgba(160,112,30,.5) 0 2px,transparent 2px 5px);border-color:#2b3a40', 'Contested')}
    ${swatch('background:rgba(160,134,86,.22);border-color:transparent', 'Terrain above 1,000 m')}`;
  $('map-legend').innerHTML = `<details${open ? ' open' : ''}><summary>Legend</summary><div class="legend-grid">${body}</div></details>`;
}

// ── Interaction: symbols, areas, tooltips ───────────────────────────────────
function lookup(kind, id) {
  if (kind === 'base') return state.game.bases[id];
  if (kind === 'ground') return state.game.ground_units?.[id];
  if (kind === 'unit') return state.game.units[id];
  if (kind === 'area') return state.game.regions[id];
  if (kind === 'zone') return state.game.ground_hexes?.[id];
  return null;
}

function attachSymbolInteractions(svg) {
  svg.querySelectorAll('.sym[data-kind]').forEach((symbol) => {
    const { kind, id } = symbol.dataset;
    symbol.addEventListener('pointerenter', (event) => showTooltip(kind, id, event));
    symbol.addEventListener('pointermove', (event) => showTooltip(kind, id, event));
    symbol.addEventListener('pointerleave', restorePinned);
    symbol.addEventListener('focus', () => showTooltip(kind, id, null, symbol));
    symbol.addEventListener('blur', restorePinned);
    symbol.addEventListener('click', (event) => { event.stopPropagation(); select(kind, id, event); });
    symbol.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(kind, id, null, symbol); } });
  });
}

function attachAreaInteractions(svg, kind, linksOf) {
  const attr = kind === 'area' ? 'data-area' : 'data-zone';
  const nodes = [...svg.querySelectorAll(`[${attr}]`)];
  const byId = Object.fromEntries(nodes.map((node) => [node.getAttribute(attr), node]));
  nodes.forEach((node) => {
    const id = node.getAttribute(attr);
    node.addEventListener('pointerenter', () => linksOf(id).forEach((other) => byId[other]?.classList.add('linked')));
    node.addEventListener('pointerleave', () => nodes.forEach((other) => other.classList.remove('linked')));
    node.addEventListener('click', (event) => { event.stopPropagation(); select(kind, id, event); });
  });
}

function select(kind, id, event, node = null) {
  state.pinned = { kind, id };
  state.selected = { kind, id };
  const svg = state.map === 'theater' ? $('map') : $('ground-map');
  svg.querySelectorAll('.sym.selected').forEach((item) => item.classList.remove('selected'));
  svg.querySelector(`.sym[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
  showTooltip(kind, id, event, node, true);
  renderForces();
}

function tooltipMarkup(kind, item) {
  const rows = (pairs) => `<dl class="tooltip-rows">${pairs.filter(Boolean).map(([k, v]) => `<dt>${escapeMarkup(k)}</dt><dd>${escapeMarkup(v)}</dd>`).join('')}</dl>`;
  const header = (icon, type, name) => `<div class="tooltip-header">${icon}<div class="tooltip-title"><span>${escapeMarkup(type)}</span><strong>${escapeMarkup(name)}</strong></div><button class="tooltip-close" type="button" aria-label="Close details">×</button></div>`;
  const hint = '<div class="tooltip-hint">Click to pin · Esc to close</div>';
  if (kind === 'unit') {
    const known = item.strength != null;
    const target = state.game.regions[item.target]?.name || state.game.bases[item.target]?.name || item.target;
    const base = item.base_id ? state.game.bases[item.base_id]?.name : null;
    return header(miniSymbol(item.side, unitDimension(item), item.kind, null), `${SIDE_META[item.side].short} · ${KIND_LABEL[item.kind] || humanize(item.kind)}`, item.name)
      + rows([
        ['Location', `${state.game.regions[item.region]?.name || item.region}${base ? ` · ${base}` : ''}`],
        ['Strength', known ? `${formatNumber(item.strength, 1)} / ${formatNumber(item.max_strength, 1)}` : 'Unknown (not identified)'],
        ['Readiness', item.readiness != null ? `${(Number(item.readiness) * 100).toFixed(0)}%` : 'Unknown'],
        ['Mission', humanize(item.mission)],
        target && ['Target', target],
        item.kind === 'amphibious' && ['Lift', `${formatNumber(item.capacity, 1)} per turn`],
        item.counter_scale && ['Counter scale', item.counter_scale],
        item.contact_state && ['Contact', `${item.contact_state} · ${(Number(item.contact_confidence || 0) * 100).toFixed(0)}% confidence`],
        item.weapons && Object.keys(item.weapons).length && ['Magazines', Object.entries(item.weapons).map(([name, amount]) => `${humanize(name)} ${formatNumber(amount)}`).join(', ')],
      ])
      + (known ? `<div class="tooltip-bar"><i style="width:${pct(item.strength, item.max_strength)}%"></i></div>` : '') + hint;
  }
  if (kind === 'ground') {
    const hex = state.game.ground_hexes[item.hex_id];
    const deployed = item.strength > .05;
    return header(miniSymbol(item.side, 'land', item.kind, null, { echelon: true }), `${SIDE_META[item.side].short} · ${KIND_LABEL[item.kind] || humanize(item.kind)}`, item.name)
      + rows([
        ['Location', deployed ? (hex?.name || item.hex_id) : 'Awaiting amphibious lift'],
        ['Strength', deployed ? `${formatNumber(item.strength, 1)} / ${formatNumber(item.max_strength, 1)}` : `${formatNumber(item.reserve_strength, 1)} in reserve`],
        deployed && ['Supply', `${(Number(item.supply) * 100).toFixed(0)}%`],
        ['Mission', humanize(item.mission)],
        ['Attack / defense', `${formatNumber(item.attack, 2)} / ${formatNumber(item.defense, 2)}`],
        !deployed && ['Lift cost', `${formatNumber(item.lift_cost, 1)}k tons per strength`],
        item.target && ['Target', state.game.ground_hexes[item.target]?.name || item.target],
      ])
      + `<div class="tooltip-bar"><i style="width:${pct(deployed ? item.strength : item.reserve_strength, item.max_strength)}%"></i></div>` + hint;
  }
  if (kind === 'base') {
    const assigned = Object.values(state.game.units).filter((unit) => unit.base_id === item.id && unitIsActive(unit));
    const effectiveness = Math.max(0, 1 - Number(item.damage || 0));
    const latest = [...state.game.events].reverse().find((event) => event.data?.target === item.id && ['MISSILES', 'AIR', 'REPAIR'].includes(event.phase));
    return header(miniSymbol(item.side, 'installation', item.kind), `${SIDE_META[item.side].short} · ${item.kind === 'naval_base' ? 'Naval base' : 'Air base'}`, item.name)
      + rows([
        ['Area', state.game.regions[item.region]?.name || item.region],
        ['Operational', `${(effectiveness * 100).toFixed(0)}% (${(Number(item.damage || 0) * 100).toFixed(0)}% damage)`],
        ['Capacity', item.kind === 'naval_base' ? `${item.port_capacity || 0} groups` : `${assigned.length} / ${item.capacity} formations`],
        ['Defenses', `SAM ${formatNumber(item.sam, 1)} · hardening ${formatNumber(item.hardening, 1)}`],
        ['Hosting', assigned.length ? assigned.map((unit) => unit.name).join(', ') : 'None'],
        latest && ['Latest', latest.message],
      ])
      + `<div class="tooltip-bar"><i style="width:${effectiveness * 100}%"></i></div>` + hint;
  }
  if (kind === 'area') {
    const id = state.pinned?.id;
    const here = Object.values(state.game.units).filter((unit) => unit.region === id && unitIsActive(unit));
    return header('', `Operational area · ${humanize(item.terrain)}`, item.name)
      + rows([
        ['Formations', `${here.filter((unit) => unit.side === 'BLUE').length} coalition · ${here.filter((unit) => unit.side === 'RED').length} PLA`],
        ['ASW detection', `×${formatNumber(item.asw_detection, 2)}`],
        ['Linked areas', item.adjacent.map((other) => state.game.regions[other]?.name || other).join(', ')],
      ]) + hint;
  }
  if (kind === 'zone') {
    return header('', `Ground area · ${humanize(item.terrain)}`, item.name)
      + rows([
        ['Control', humanize(String(item.controller || 'none').toLowerCase())],
        item.beach && ['Beach', `Coastal defense ${formatNumber(item.coastal_defense, 1)}`],
        item.port && ['Port', 'Yes — usable for captured-port insertion'],
        ['Control value', formatNumber(item.control_value, 2)],
        ['Linked areas', item.adjacent.map((other) => state.game.ground_hexes[other]?.name || other).join(', ')],
      ]) + hint;
  }
  return '';
}

function showTooltip(kind, id, event, node = null, pinned = false) {
  if (!pinned && state.pinned && !(state.pinned.kind === kind && state.pinned.id === id) && event?.type === 'pointermove') return;
  const item = lookup(kind, id);
  if (!item) return;
  const tooltip = $('map-tooltip');
  tooltip.innerHTML = tooltipMarkup(kind, { ...item, id });
  tooltip.hidden = false;
  tooltip.classList.toggle('is-pinned', pinned || (state.pinned?.kind === kind && state.pinned?.id === id));
  const stage = $('map-stage').getBoundingClientRect();
  const anchor = (node || event?.target?.closest?.('.sym'))?.getBoundingClientRect();
  const x = Number.isFinite(event?.clientX) ? event.clientX : anchor ? anchor.right : stage.left + stage.width / 2;
  const y = Number.isFinite(event?.clientY) ? event.clientY : anchor ? anchor.top + anchor.height / 2 : stage.top + stage.height / 2;
  let left = x - stage.left + 16;
  if (left + tooltip.offsetWidth > stage.width - 10) left = x - stage.left - tooltip.offsetWidth - 16;
  const top = Math.max(10, Math.min(stage.height - tooltip.offsetHeight - 10, y - stage.top - tooltip.offsetHeight / 2));
  tooltip.style.left = `${Math.max(10, left)}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() { $('map-tooltip').hidden = true; }

function restorePinned() {
  if (!state.pinned) return hideTooltip();
  const svg = state.map === 'theater' ? $('map') : $('ground-map');
  const node = svg.querySelector(`.sym[data-kind="${state.pinned.kind}"][data-id="${CSS.escape(state.pinned.id)}"]`);
  const valid = ['area', 'zone'].includes(state.pinned.kind) ? (state.pinned.kind === 'area') === (state.map === 'theater') : Boolean(node);
  if (!valid) return hideTooltip();
  showTooltip(state.pinned.kind, state.pinned.id, null, node, true);
}

function switchMap(map) {
  if (state.map === map) return;
  state.map = map;
  state.pinned = null;
  hideTooltip();
  renderCartouche();
  clampView(map);
  applyView(map);
}

// Select a formation from the sidebar: switch to its map, center on it, and pin details.
function focusFormation(kind, id) {
  switchMap(kind === 'ground' ? 'ground' : 'theater');
  const svg = kind === 'ground' ? $('ground-map') : $('map');
  const node = svg.querySelector(`.sym[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
  const matrix = node?.getScreenCTM();
  if (matrix) {
    const box = node.getBBox();
    const screen = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix);
    const point = svgPoint(svg, screen.x, screen.y);
    centerOn(state.map, point.x, point.y);
  }
  requestAnimationFrame(() => select(kind, id, null, svg.querySelector(`.sym[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`)));
}

// ── Orders ──────────────────────────────────────────────────────────────────
function ownUnits(domain, kind) {
  return Object.values(state.game.units).filter((unit) => unit.side === state.side && Number(unit.strength || 0) > .05 && (!domain || unit.domain === domain) && (!kind || unit.kind === kind));
}
const ownGroundUnits = () => Object.values(state.game.ground_units || {}).filter((unit) => unit.side === state.side && unit.strength > .05);
const redReserves = () => Object.values(state.game.ground_units || {}).filter((unit) => unit.side === 'RED' && unit.reserve_strength > .05);

function actionAvailable(id) {
  const inventory = state.game.munitions[state.side] || {};
  if (id === 'missile_strike') return Object.keys(WEAPON_META[state.side]).some((weapon) => inventory[weapon] > 0);
  if (id === 'air_mission' || id === 'rebase') return ownUnits('air').length > 0;
  if (id === 'naval_move' || id === 'naval_mission') return ownUnits('naval').length > 0;
  if (id === 'submarine_mission') return ownUnits('submarine').length > 0;
  if (id === 'amphibious_lift') return state.side === 'RED' && ownUnits('naval', 'amphibious').length > 0 && redReserves().length > 0;
  return ownGroundUnits().length > 0;
}

function renderActionSelect() {
  if (!actionAvailable(state.action)) state.action = ACTIONS.find((action) => actionAvailable(action.id))?.id || state.action;
  const groups = [...new Set(ACTIONS.map((action) => action.group))];
  $('action-type').innerHTML = groups.map((group) => `<optgroup label="${group}">${ACTIONS.filter((action) => action.group === group).map((action) => {
    const available = actionAvailable(action.id);
    return `<option value="${action.id}"${available ? '' : ' disabled'}${action.id === state.action ? ' selected' : ''}>${action.label}${available ? '' : ' — none available'}</option>`;
  }).join('')}</optgroup>`).join('');
}

const currentAction = () => $('action-type').value || state.action;
function optionList(items, value = 'id', label = 'name') { return items.map((item) => `<option value="${escapeMarkup(item[value])}">${escapeMarkup(item[label])}</option>`).join(''); }
function selectField(label, id, options) { return `<label>${label}<select id="${id}">${options}</select></label>`; }
function numberField(label, id, value, min, max, step = 1) { return `<label>${label}<input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`; }
function weaponOptions(side, role = null, platform = 'any') {
  const inventory = state.game.munitions[side];
  return Object.entries(WEAPON_META[side]).filter(([id, meta]) => inventory[id] > 0 && (!role || meta[1] === role || meta[1] === 'dual') && (platform !== 'air' || AIR_WEAPONS[side].includes(id))).map(([id, meta]) => `<option value="${id}">${meta[0]} · ${inventory[id].toFixed(0)} available</option>`).join('');
}

function renderForm() {
  const type = currentAction();
  const side = state.side;
  const regions = Object.entries(state.game.regions).map(([id, data]) => ({ id, name: data.name }));
  let html = '';
  if (type === 'missile_strike') {
    const targets = [...Object.values(state.game.bases), ...Object.values(state.game.units).filter((unit) => unit.domain === 'naval')].filter((item) => item.side !== side && Number(item.strength ?? 1) > .05);
    html = selectField('Target (located bases and surface groups)', 'field-target', optionList(targets)) + selectField('Weapon', 'field-weapon', weaponOptions(side)) + numberField('Rounds', 'field-amount', 6, 1, 100);
  } else if (type === 'air_mission') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('air'))) + selectField('Mission', 'field-mission', '<option value="cap">Air superiority / CAP</option><option value="strike_base">Strike air base</option><option value="maritime_strike">Maritime strike</option><option value="ground_support">Ground support</option><option value="interdiction">Ground interdiction</option><option value="asw">ASW search</option><option value="reserve">Reserve</option>') + selectField('Target area', 'field-target', optionList(regions)) + selectField('Strike weapon', 'field-weapon', weaponOptions(side)) + numberField('Strike rounds', 'field-amount', 4, 1, 40);
  } else if (type === 'rebase') {
    const bases = Object.values(state.game.bases).filter((base) => base.side === side && base.kind !== 'naval_base');
    html = selectField('Formation', 'field-unit', optionList(ownUnits('air'))) + selectField('Destination base', 'field-base', optionList(bases));
  } else if (type === 'naval_move') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('naval'))) + selectField('Destination', 'field-target', optionList(regions));
  } else if (type === 'naval_mission') {
    html = selectField('Surface group', 'field-unit', optionList(ownUnits('naval'))) + selectField('Mission', 'field-mission', '<option value="air_defense">Air & missile defense</option><option value="surface_strike">Surface strike</option><option value="asw">ASW sweep</option><option value="escort">Escort</option><option value="reserve">Reserve</option>') + selectField('Mission area', 'field-target', optionList(regions));
  } else if (type === 'submarine_mission') {
    html = selectField('Submarine squadron', 'field-unit', optionList(ownUnits('submarine'))) + selectField('Mission', 'field-mission', '<option value="hunt_shipping">Hunt surface shipping</option><option value="hunt_submarines">Hunt submarines</option><option value="barrier">Undersea barrier</option><option value="rearm">Rearm at home port</option><option value="reserve">Remain covert / reserve</option>') + selectField('Patrol area', 'field-target', optionList(regions));
  } else if (type === 'amphibious_lift') {
    const beaches = Object.entries(state.game.ground_hexes || {}).filter(([, hex]) => hex.beach || hex.port).map(([id, hex]) => ({ id, name: hex.name }));
    html = selectField('Amphibious group', 'field-unit', optionList(ownUnits('naval', 'amphibious'))) + selectField('Ground formation', 'field-ground-unit', optionList(redReserves())) + selectField('Landing area', 'field-ground-target', optionList(beaches)) + selectField('Insertion method', 'field-insertion', '<option value="amphibious">Amphibious landing</option><option value="air_assault">Air assault</option><option value="airborne">Airborne</option><option value="captured_port">Captured port</option>') + numberField('Lift committed (thousand tons)', 'field-amount', 5, .5, 30, .5);
  } else if (type === 'ground_order') {
    const hexes = Object.entries(state.game.ground_hexes || {}).map(([id, hex]) => ({ id, name: hex.name }));
    html = selectField('Ground formation', 'field-unit', optionList(ownGroundUnits())) + selectField('Mission', 'field-mission', '<option value="defend">Defend current area</option><option value="attack">Attack / advance</option><option value="move">Move</option><option value="reserve">Reserve</option>') + selectField('Target area', 'field-target', optionList(hexes));
  } else if (type === 'ground_attack') {
    html = numberField('Intensity (0.25–1)', 'field-intensity', .5, .25, 1, .25);
  }
  $('dynamic-fields').innerHTML = html;

  if (type === 'missile_strike') {
    const refresh = () => { const weapon = $('field-weapon'); if (weapon) weapon.innerHTML = weaponOptions(side, state.game.bases[$('field-target')?.value] ? 'land' : 'naval'); };
    $('field-target')?.addEventListener('change', refresh);
    refresh();
  }
  if (type === 'air_mission') {
    const refresh = () => {
      const weapon = $('field-weapon');
      if (!weapon) return;
      const mission = $('field-mission')?.value;
      weapon.innerHTML = mission === 'strike_base' ? weaponOptions(side, 'land', 'air') : mission === 'maritime_strike' ? weaponOptions(side, 'naval', 'air') : '<option value="">Not used for this mission</option>';
    };
    $('field-mission')?.addEventListener('change', refresh);
    refresh();
  }
}

function buildOrder() {
  const type = currentAction();
  const value = (id) => $(id)?.value;
  if (type === 'missile_strike') return { type, target_id: value('field-target'), weapon: value('field-weapon'), amount: Number(value('field-amount')) };
  if (type === 'air_mission') {
    const order = { type, unit_id: value('field-unit'), mission: value('field-mission'), target: value('field-target') };
    if (['strike_base', 'maritime_strike'].includes(order.mission)) { order.weapon = value('field-weapon'); order.amount = Number(value('field-amount')); }
    return order;
  }
  if (type === 'rebase') return { type, unit_id: value('field-unit'), base_id: value('field-base') };
  if (type === 'naval_move') return { type, unit_id: value('field-unit'), target: value('field-target') };
  if (type === 'naval_mission' || type === 'submarine_mission') return { type, unit_id: value('field-unit'), mission: value('field-mission'), target: value('field-target') };
  if (type === 'amphibious_lift') return { type, unit_id: value('field-unit'), ground_unit_id: value('field-ground-unit'), target: value('field-ground-target'), insertion: value('field-insertion'), amount: Number(value('field-amount')) };
  if (type === 'ground_order') return { type, unit_id: value('field-unit'), mission: value('field-mission'), target: value('field-target') };
  return { type, intensity: Number(value('field-intensity')) };
}

function describeOrder(order) {
  const unit = state.game.units[order.unit_id]?.name || state.game.ground_units?.[order.unit_id]?.name || order.unit_id || '';
  const target = state.game.ground_hexes?.[order.target]?.name || state.game.regions[order.target]?.name || state.game.bases[order.target]?.name || state.game.units[order.target_id]?.name || state.game.bases[order.target_id]?.name || order.target || order.target_id || '';
  const ground = state.game.ground_units?.[order.ground_unit_id]?.name || '';
  const weapon = order.weapon ? WEAPON_META[state.side][order.weapon]?.[0] || order.weapon : '';
  const parts = [
    `${unit}${ground ? ` + ${ground}` : ''}${unit && target ? ' → ' : ''}${target}`,
    order.mission && humanize(order.mission),
    weapon && `${weapon}${order.amount ? ` × ${order.amount}` : ''}`,
    order.insertion && humanize(order.insertion),
    order.type === 'amphibious_lift' && order.amount && `${order.amount}k tons`,
    order.intensity && `intensity ${order.intensity}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

function renderOrders() {
  $('order-count').textContent = state.orders.length;
  $('orders-list').innerHTML = state.orders.length
    ? state.orders.map((order, index) => `<div class="order-item"><span class="seq">${index + 1}</span><div><strong>${escapeMarkup(actionLabel(order.type))}</strong><small>${escapeMarkup(describeOrder(order))}</small></div><button class="remove-order" data-index="${index}" aria-label="Remove order" type="button">×</button></div>`).join('')
    : '<div class="empty">No orders yet. Unordered formations keep their current mission.</div>';
  document.querySelectorAll('.remove-order').forEach((button) => { button.onclick = () => { state.orders.splice(Number(button.dataset.index), 1); renderOrders(); }; });
}

function renderStockpile() {
  const inventory = state.game.munitions[state.side];
  const peak = state.peakMunitions?.[state.side] || {};
  $('weapon-stockpile').innerHTML = `<h3>Magazines · ${escapeMarkup(SIDE_META[state.side].short)}</h3>${Object.entries(WEAPON_META[state.side]).map(([id, meta]) => {
    const count = Number(inventory[id] || 0);
    const max = Math.max(count, peak[id] || 0);
    return `<div class="stock-row"><span title="${escapeMarkup(meta[0])}">${escapeMarkup(meta[0])}</span><div class="stock-bar"><i style="width:${pct(count, max)}%"></i></div><em>${count.toFixed(0)}</em></div>`;
  }).join('')}`;
}

// ── Forces & log ────────────────────────────────────────────────────────────
function renderForces() {
  const game = state.game;
  const sides = state.filter === 'ALL' ? ['BLUE', 'RED'] : [state.filter];
  const row = (kind, unit, dimension, location, strength, max) => {
    const selected = state.selected?.kind === kind && state.selected.id === unit.id ? ' selected' : '';
    const known = strength != null && Number.isFinite(Number(strength));
    const depleted = known && Number(strength) <= .05 ? ' depleted' : '';
    return `<button type="button" class="formation${selected}${depleted}" data-kind="${kind}" data-id="${escapeMarkup(unit.id)}">${miniSymbol(unit.side, dimension, unit.kind, null, { echelon: dimension === 'land' })}<span><b>${escapeMarkup(unit.name)}</b><small>${escapeMarkup(location)}</small></span><span class="str">${known ? formatNumber(strength, 1) : '?'}<i><b style="width:${known ? pct(strength, max) : 0}%"></b></i></span></button>`;
  };
  const groups = [];
  sides.forEach((side) => {
    const units = Object.values(game.units).filter((unit) => unit.side === side);
    [['air', 'Air'], ['naval', 'Surface'], ['submarine', 'Subsurface']].forEach(([domain, label]) => {
      const list = units.filter((unit) => unit.domain === domain);
      if (list.length) groups.push(`<div class="force-group"><h3>${SIDE_META[side].short} · ${label}</h3>${list.map((unit) => row('unit', unit, unitDimension(unit), `${game.regions[unit.region]?.name || 'Unlocated'}${unit.base_id && game.bases[unit.base_id] ? ` · ${game.bases[unit.base_id].name}` : ''}`, unit.strength, unit.max_strength)).join('')}</div>`);
    });
    const ground = Object.values(game.ground_units || {}).filter((unit) => unit.side === side && (unit.strength > .05 || unit.reserve_strength > .05));
    if (ground.length) groups.push(`<div class="force-group"><h3>${SIDE_META[side].short} · Ground</h3>${ground.map((unit) => (unit.strength > .05
      ? row('ground', unit, 'land', game.ground_hexes[unit.hex_id]?.name || unit.hex_id, unit.strength, unit.max_strength)
      : row('ground', unit, 'land', 'Reserve · awaiting lift', unit.reserve_strength, unit.max_strength))).join('')}</div>`);
  });
  $('formations').innerHTML = groups.join('');
  $('formations').querySelectorAll('.formation').forEach((button) => button.addEventListener('click', () => focusFormation(button.dataset.kind, button.dataset.id)));
}

function replaySide(event) {
  const side = event.data?.side || (/^BLUE\b/.test(event.message) ? 'BLUE' : /^RED\b/.test(event.message) ? 'RED' : null);
  return side ? side.toLowerCase() : 'neutral';
}

function renderEvents() {
  const events = [...state.game.events].reverse();
  let lastTurn = null;
  $('event-log').innerHTML = events.length ? events.map((event) => {
    const header = event.turn !== lastTurn ? `<div class="log-turn">Turn ${escapeMarkup(event.turn)}</div>` : '';
    lastTurn = event.turn;
    return `${header}<div class="event side-${replaySide(event)}"><b>${escapeMarkup(humanize(event.phase))}</b><span>${escapeMarkup(event.message)}</span></div>`;
  }).join('') : '<div class="empty">No adjudication events yet. Resolve a turn to begin.</div>';
}

// ── Turn replay ─────────────────────────────────────────────────────────────
const replayDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function latestTurnEvents(events = []) {
  if (!events.length) return [];
  const turn = Math.max(...events.map((event) => Number(event.turn) || 0));
  return events.filter((event) => Number(event.turn) === turn);
}

function updateReplayButton() {
  if (!state.replayEvents.length && state.game?.events?.length) state.replayEvents = latestTurnEvents(state.game.events);
  const button = $('replay-turn');
  button.hidden = !state.replayEvents.length;
  button.disabled = state.replayRunning;
  button.textContent = state.replayEvents.length ? `Replay turn ${state.replayEvents[0].turn}` : 'Replay turn';
}

function setReplayEvents(events, autoplay = false) {
  stopTurnReplay();
  state.replayEvents = latestTurnEvents(events);
  updateReplayButton();
  if (autoplay && state.replayEvents.length) playTurnReplay();
}

function inferEventRegion(event) {
  const data = event.data || {};
  if (data.region && state.game.regions[data.region]) return data.region;
  if (data.to_region && state.game.regions[data.to_region]) return data.to_region;
  const target = state.game.bases[data.target] || state.game.units[data.target];
  if (target?.region) return target.region;
  const named = Object.entries(state.game.regions).find(([, region]) => event.message.includes(region.name));
  return named ? named[0] : 'taiwan';
}

function replayOverlayMarkup(event) {
  const data = event.data || {};
  const areas = state.geo.theater.areas;
  const base = state.game.bases[data.target] && state.geo.theater.bases[data.target];
  const point = base ? base.at : (areas[inferEventRegion(event)] || areas.taiwan).anchor;
  const from = data.from_region && areas[data.from_region]?.anchor;
  const to = data.to_region && areas[data.to_region]?.anchor;
  const mark = ([x, y]) => `<circle class="replay-impact" cx="${x}" cy="${y}" r="16"/><circle class="replay-core" cx="${x}" cy="${y}" r="5"/>`;
  if (from && to && data.from_region !== data.to_region) {
    const [x0, y0] = from;
    const [x1, y1] = to;
    const bend = `${(x0 + x1) / 2 - (y1 - y0) * .18} ${(y0 + y1) / 2 + (x1 - x0) * .18}`;
    return `<path class="replay-route" d="M${x0} ${y0}Q${bend} ${x1} ${y1}"/>${mark(to)}`;
  }
  return mark(point);
}

function renderReplayFrame(event, index, total) {
  const overlay = $('event-overlay');
  if (overlay) {
    overlay.setAttribute('class', `replay-overlay side-${replaySide(event)}`);
    overlay.innerHTML = replayOverlayMarkup(event);
  }
  $('replay-kicker').textContent = `Turn ${event.turn} · event ${index + 1} of ${total}`;
  $('replay-phase').textContent = humanize(event.phase);
  $('replay-message').textContent = event.message;
  $('replay-progress').innerHTML = Array.from({ length: total }, (_, step) => `<i class="${step <= index ? 'complete' : ''}"></i>`).join('');
}

async function playTurnReplay() {
  if (!state.replayEvents.length || state.replayRunning) return;
  state.replayRunning = true;
  const run = ++state.replayRun;
  switchMap('theater');
  $('turn-replay').hidden = false;
  hideTooltip();
  updateReplayButton();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let index = 0; index < state.replayEvents.length; index += 1) {
    if (run !== state.replayRun) return;
    renderReplayFrame(state.replayEvents[index], index, state.replayEvents.length);
    await replayDelay(reducedMotion ? 300 : 1100);
  }
  if (run !== state.replayRun) return;
  await replayDelay(400);
  if (run !== state.replayRun) return;
  stopTurnReplay();
}

function stopTurnReplay() {
  state.replayRun += 1;
  state.replayRunning = false;
  $('turn-replay').hidden = true;
  const overlay = $('event-overlay');
  if (overlay) overlay.innerHTML = '';
  updateReplayButton();
}

// ── Events ──────────────────────────────────────────────────────────────────
function showError(error) { $('error-box').textContent = error.message || String(error); $('error-box').hidden = false; setTab('orders'); }
function clearError() { $('error-box').hidden = true; }

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs [data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
}

async function advance(request, pickReplay = (events) => events) {
  clearError();
  try {
    const previousCount = state.game.events.length;
    state.game = await request();
    state.orders = [];
    render();
    setReplayEvents(pickReplay(state.game.events.slice(previousCount)), true);
  } catch (error) { showError(error); }
}

$('action-type').addEventListener('change', () => { state.action = $('action-type').value; renderForm(); });
$('side-toggle').addEventListener('click', async (event) => {
  const side = event.target.closest('[data-side]')?.dataset.side;
  if (!side || side === state.side) return;
  state.side = side; state.orders = []; state.pinned = null; state.selected = null; stopTurnReplay();
  try { state.game = await api(`/api/state?observer=${state.side}`); state.replayEvents = latestTurnEvents(state.game.events); render(); } catch (error) { showError(error); }
});
$('map-switch').addEventListener('click', (event) => { const map = event.target.closest('[data-map]')?.dataset.map; if (map) switchMap(map); });
document.querySelector('.zoom-controls').addEventListener('click', (event) => {
  const action = event.target.closest('[data-zoom]')?.dataset.zoom;
  if (!action) return;
  const { view, full } = views[state.map];
  if (action === 'reset') { fitView(state.map, views[state.map].home || full); return; }
  zoomTo(state.map, view.x + view.w / 2, view.y + view.h / 2, action === 'in' ? 1.4 : 1 / 1.4);
});
document.querySelectorAll('.tabs [data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
document.querySelectorAll('.chip[data-filter]').forEach((chip) => chip.addEventListener('click', () => { document.querySelectorAll('.chip[data-filter]').forEach((item) => item.classList.toggle('active', item === chip)); state.filter = chip.dataset.filter; renderForces(); }));
$('order-form').addEventListener('submit', (event) => {
  event.preventDefault();
  clearError();
  try {
    const order = buildOrder();
    if (!order.unit_id && ['air_mission', 'rebase', 'naval_move', 'naval_mission', 'submarine_mission', 'amphibious_lift', 'ground_order'].includes(order.type)) throw new Error('No eligible formation is available.');
    state.orders.push(order);
    renderOrders();
  } catch (error) { showError(error); }
});
$('clear-orders').addEventListener('click', () => { state.orders = []; renderOrders(); });
$('resolve-turn').addEventListener('click', () => advance(() => api('/api/turn', { method: 'POST', body: JSON.stringify({ side: state.side, orders: state.orders }) })));
$('agent-turn').addEventListener('click', () => advance(() => api('/api/agent-turn', { method: 'POST', body: '{}' })));
$('autoplay').addEventListener('click', () => advance(() => api('/api/autoplay', { method: 'POST', body: JSON.stringify({ turns: 20 }) }), latestTurnEvents));
$('new-game').addEventListener('click', async () => {
  const input = prompt('Random seed for reproducible adjudication:', '7');
  if (input === null) return;
  const seed = Number(input);
  if (!Number.isFinite(seed)) return;
  stopTurnReplay();
  try {
    state.game = await api('/api/new-game', { method: 'POST', body: JSON.stringify({ seed }) });
    Object.assign(state, { orders: [], replayEvents: [], peakMunitions: null, pinned: null, selected: null });
    render();
  } catch (error) { showError(error); }
});
$('replay-turn').addEventListener('click', playTurnReplay);
$('replay-skip').addEventListener('click', stopTurnReplay);
$('map-tooltip').addEventListener('click', (event) => {
  if (!event.target.closest('.tooltip-close')) return;
  state.pinned = null; state.selected = null;
  document.querySelectorAll('.sym.selected').forEach((node) => node.classList.remove('selected'));
  hideTooltip();
  renderForces();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('map-tooltip').hidden) return;
  state.pinned = null; state.selected = null;
  document.querySelectorAll('.sym.selected').forEach((node) => node.classList.remove('selected'));
  hideTooltip();
});
window.addEventListener('resize', () => Object.keys(views).forEach((key) => { clampView(key); applyView(key); }));

load().catch(showError);
