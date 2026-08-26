const state = { game: null, scenario: null, orders: [], filter: 'ALL', selectedUnit: null, pinnedMapItem: null, replayEvents: [], replayRun: 0, replayRunning: false };
const $ = (id) => document.getElementById(id);

const SIDE_META = {
  BLUE: {
    short: 'Coalition',
    title: 'BLUE · Joint Coalition',
    members: 'United States · Taiwan · Japan · regional partners',
    objective: 'Defend Taiwan and deny a sustainable PLA lodgment.',
  },
  RED: {
    short: 'PLA',
    title: 'RED · PLA Joint Force',
    members: 'People’s Liberation Army · Eastern Theater Command',
    objective: 'Invade, reinforce, and secure control of Taiwan.',
  },
};

const WEAPON_META = {
  BLUE: { jassm_er: ['JASSM-ER', 'land'], tomahawk: ['Tomahawk', 'land'], lrasm: ['LRASM', 'naval'], mst: ['Maritime Strike Tomahawk', 'naval'], harpoon: ['Harpoon', 'naval'] },
  RED: { tbm: ['Theater ballistic missile', 'land'], irbm: ['Intermediate-range ballistic missile', 'dual'], lacm: ['Land-attack cruise missile', 'land'], ascm: ['Anti-ship cruise missile', 'naval'] },
};
const AIR_WEAPONS = { BLUE: ['jassm_er', 'lrasm', 'harpoon'], RED: ['lacm', 'ascm'] };

const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const unitIsActive = (unit) => unit.strength == null || Number(unit.strength) > .05;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

async function load() {
  [state.scenario, state.game] = await Promise.all([api('/api/scenario'), api(`/api/state?observer=${$('side-select').value}`)]);
  render();
}

function render() {
  const game = state.game;
  renderSideBriefing();
  $('turn-value').textContent = `Turn ${game.turn} / ${game.max_turns}`;
  $('control-value').textContent = `${game.metrics.taiwan_control.toFixed(0)}%`;
  $('control-meter').style.width = `${game.metrics.taiwan_control}%`;
  $('lodgment-value').textContent = game.metrics.red_lodgment.toFixed(1);
  $('defense-value').textContent = game.metrics.taiwan_defense.toFixed(1);
  $('munition-value').textContent = `${game.munitions.BLUE.long_range.toFixed(0)} / ${game.munitions.RED.long_range.toFixed(0)}`;
  $('status-value').textContent = game.status;
  $('winner-value').textContent = game.winner ? `Outcome: ${SIDE_META[game.winner]?.title || game.winner}` : 'Occupation denied so far';
  $('seed-value').textContent = `Seed ${game.seed}`;
  renderMap(); renderGroundMap(); renderForm(); renderStockpile(); renderOrders(); renderFormations(); renderEvents(); updateReplayButton();
}

function renderSideBriefing() {
  const side = $('side-select').value;
  const opponent = side === 'BLUE' ? 'RED' : 'BLUE';
  const briefing = $('side-briefing');
  briefing.classList.toggle('commanding-blue', side === 'BLUE');
  briefing.classList.toggle('commanding-red', side === 'RED');
  $('command-roundel').textContent = side === 'BLUE' ? 'B' : 'R';
  $('command-title').textContent = SIDE_META[side].title;
  $('command-members').textContent = SIDE_META[side].members;
  $('command-objective').textContent = SIDE_META[side].objective;
  $('opponent-title').textContent = SIDE_META[opponent].title;
  $('opponent-objective').textContent = SIDE_META[opponent].objective;
}

function renderMap() {
  const svg = $('map');
  hideMapTooltip(true);
  const regions = state.game.regions;
  const drawn = new Set();
  let content = `<defs>
    <linearGradient id="ocean-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8dadd"/><stop offset=".5" stop-color="#b7cfd3"/><stop offset="1" stop-color="#9dbbc1"/></linearGradient>
    <radialGradient id="shelf-gradient" cx="0" cy=".5" r="1"><stop offset="0" stop-color="#eef1e8" stop-opacity=".72"/><stop offset=".45" stop-color="#cfdee0" stop-opacity=".46"/><stop offset="1" stop-color="#7fa9b2" stop-opacity="0"/></radialGradient>
    <linearGradient id="land-gradient" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#e1ddcf"/><stop offset=".58" stop-color="#d1cbb9"/><stop offset="1" stop-color="#bcb6a4"/></linearGradient>
    <pattern id="chart-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80M20 0V80M40 0V80M60 0V80M0 20H80M0 40H80M0 60H80" fill="none" stroke="#426972" stroke-opacity=".075" stroke-width=".7"/></pattern>
    <filter id="land-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.2" dy="2" stdDeviation="2.5" flood-color="#29464c" flood-opacity=".2"/></filter>
    <filter id="symbol-shadow" x="-70%" y="-70%" width="240%" height="240%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#102b33" flood-opacity=".32"/></filter>
    <radialGradient id="objective-glow"><stop offset="0" stop-color="#d19b3d" stop-opacity=".22"/><stop offset="1" stop-color="#d19b3d" stop-opacity="0"/></radialGradient>
  </defs>
  <rect class="ocean-field" x="420" y="20" width="800" height="610" fill="url(#ocean-gradient)"/>
  <path class="continental-shelf" d="M420 20H610c20 74 3 126-18 180-22 58-15 114-38 175-25 68-29 151-73 255H420Z" fill="url(#shelf-gradient)"/>
  <g class="ocean-contours">
    <path d="M602 20c27 90 11 158-15 224-25 65-11 121-40 192-22 53-24 123-53 194"/>
    <path d="M646 20c37 90 18 170-10 238-25 61-10 133-42 197-25 50-31 112-51 175"/>
    <path d="M824 20c70 58 111 123 137 200 25 74 70 130 147 166 46 22 83 56 112 99"/>
    <path d="M938 20c53 66 85 129 101 203 13 58 58 102 111 131"/>
  </g>
  <rect x="420" y="20" width="800" height="610" fill="url(#chart-grid)"/>
  <g class="map-geography" filter="url(#land-shadow)">
    <path class="map-land mainland" d="M420 20H548c2 22 16 43 12 67-3 20 8 38 2 58-8 25 1 42-11 65-9 18-4 39-15 61-12 23-5 48-18 74-12 25-7 54-20 83-13 28-14 62-28 92-14 32-25 70-42 110H420Z"/>
    <path class="map-land korea" d="M586 20c12 12 19 27 19 43l-7 21 7 17-13 20-12-12 4-26-9-20 8-23Z"/>
    <path class="map-land japan" d="M679 111l14-16 20-5 11 8-8 13-21 9Z"/>
    <path class="map-land japan" d="M716 92l19-15 35-10 40-5 28 7-16 10-36 7-32 15-25 5Z"/>
    <path class="map-land japan" d="M753 111l23-12 35-4 18 8-22 12-31 4Z"/>
    <path class="map-land japan" d="M832 43l18-12 21 6 5 14-17 13-21-5Z"/>
    <path class="map-land ryukyu" d="M714 143l8-5 7 6-8 6Zm-13 27 7-3 6 6-8 5Zm-10 27 7-2 5 6-8 4Zm-5 28 6-1 4 7-7 2Zm2 29 6 1 2 7-7-1Z"/>
    <path class="map-land taiwan" d="M720 294c8 7 13 21 12 37-1 21-9 43-17 55-8-10-11-27-9-45 2-21 6-38 14-47Z"/>
    <path class="map-land luzon" d="M747 448c10 5 19 18 20 33l-5 19 8 18-5 27-9 24-12-12 2-24-8-21 6-25-5-20Z"/>
    <path class="map-land philippines" d="M781 505l8 8-5 16-7-8Zm12 25 7 7-4 14-7-8Zm-11 33 8 7-3 17-8-9Zm21 22 9 8-4 18-10-10Z"/>
    <path class="map-land guam" d="M1078 345l6 9-3 17-6-10Z"/>
    <g class="terrain-relief"><path d="M447 42c38 42 48 90 39 140-8 44 10 83-8 132-14 37-13 78-29 122"/><path d="M466 34c35 54 39 99 31 145-8 49 8 88-10 137"/><path d="M720 305c-1 22-2 46-5 66"/><path d="M752 462c-1 28 2 58 0 86"/></g>
  </g>
  ${renderGeographicLabels(regions)}
  <g class="graticule-labels"><text x="432" y="44">30°N</text><text x="432" y="244">25°N</text><text x="432" y="444">20°N</text><text x="612" y="622">120°E</text><text x="812" y="622">125°E</text><text x="1012" y="622">130°E</text></g>
  <circle class="objective-glow" cx="720" cy="339" r="70" fill="url(#objective-glow)"/>
  <circle class="objective-ring outer" cx="720" cy="339" r="47"/><circle class="objective-ring" cx="720" cy="339" r="39"/>
  <text class="objective-label" x="720" y="401">TAIWAN OBJECTIVE</text>`;

  Object.entries(regions).forEach(([id, region]) => region.adjacent.forEach((other) => {
    const key = [id, other].sort().join(':');
    if (!drawn.has(key) && regions[other]) {
      drawn.add(key); content += `<line class="region-edge" x1="${region.x}" y1="${region.y}" x2="${regions[other].x}" y2="${regions[other].y}"/>`;
    }
  }));

  Object.entries(regions).forEach(([id, region]) => {
    const units = Object.values(state.game.units).filter((unit) => unit.region === id && unitIsActive(unit));
    const bases = Object.values(state.game.bases).filter((base) => base.region === id);
    const rx = id === 'taiwan' ? 40 : 53;
    const ry = id === 'taiwan' ? 49 : 35;
    const label = regionLabelPosition(id, region, ry);
    content += `<ellipse class="region-zone ${id}" cx="${region.x}" cy="${region.y}" rx="${rx}" ry="${ry}"/><text class="region-label" x="${label.x}" y="${label.y}">${escapeMarkup(region.name)}</text><text class="region-count" x="${label.x}" y="${label.y + 10}">${units.length} FORMATION${units.length === 1 ? '' : 'S'} · ${bases.length} BASE${bases.length === 1 ? '' : 'S'}</text>`;
    const items = [...units.map((unit) => ({ type: 'unit', data: unit })), ...bases.map((base) => ({ type: 'base', data: base }))];
    const offsets = symbolOffsets(items.length, id);
    items.forEach((item, index) => {
      const x = region.x + offsets[index].x;
      const y = region.y + offsets[index].y;
      content += item.type === 'unit' ? formationSymbol(item.data, x, y) : baseSymbol(item.data, x, y);
    });
  });
  svg.innerHTML = content + '<g id="event-overlay" class="replay-overlay side-neutral" aria-hidden="true"></g>';
  attachMapInteractions(svg);
}

function renderGeographicLabels(regions) {
  const labels = [
    { text: 'CHINA', x: 460, y: 238 },
    { text: 'JAPAN', x: 787, y: 52, region: 'japan' },
    { text: 'TAIWAN', x: 738, y: 366, region: 'taiwan' },
    { text: 'PHILIPPINES', x: 785, y: 606 },
    { text: 'GUAM', x: 1090, y: 367, region: 'guam' },
    { text: 'WESTERN PACIFIC', x: 955, y: 171, region: 'western_pacific', className: 'water-label' },
    { text: 'TAIWAN STRAIT', x: 621, y: 352, region: 'taiwan_strait', className: 'water-label minor' },
  ];
  const visible = labels.filter((label) => !label.region || !regions[label.region]);
  return `<g class="geo-labels">${visible.map((label) => `<text${label.className ? ` class="${label.className}"` : ''} x="${label.x}" y="${label.y}">${escapeMarkup(label.text)}</text>`).join('')}</g>`;
}

function regionLabelPosition(id, region, ry) {
  const positions = {
    japan: { x: 800, y: 43 },
    ryukyus: { x: 715, y: 112 },
    east_china_sea: { x: 610, y: 141 },
    fujian_coast: { x: 532, y: 218 },
    taiwan_strait: { x: 575, y: 386 },
    taiwan: { x: 755, y: 281 },
    philippine_sea: { x: 875, y: 267 },
    bashi_channel: { x: 692, y: 424 },
    western_pacific: { x: 1000, y: 176 },
    south_china_sea: { x: 552, y: 459 },
    luzon: { x: 760, y: 465 },
    guam: { x: 1080, y: 311 },
  };
  return positions[id] || { x: region.x, y: region.y - ry - 8 };
}

function symbolOffsets(count, regionId) {
  if (!count) return [];
  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const spacingX = regionId === 'taiwan' ? 22 : 26;
  const spacingY = 23;
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns - (columns - 1) / 2) * spacingX,
    y: (Math.floor(index / columns) - (rows - 1) / 2) * spacingY + 3,
  }));
}

function formationCode(unit) {
  const codes = { fighter_5g: '5G', fighter_45g: '4.5', fighter_4g: '4G', bomber: 'BMR', maritime_patrol: 'MPA', carrier: 'CV', surface: 'SAG', amphibious: 'ARG', nuclear_submarine: 'SSN', diesel_submarine: 'SSK', submarine_contact: 'SUB?' };
  return codes[unit.kind] || unit.domain.slice(0, 3).toUpperCase();
}

function formationGlyph(kind) {
  if (kind.startsWith('fighter')) return '<path d="M-12 3-4-2 0-13 4-2 12 3 5 6 2 12h-4l-3-6Z"/>';
  if (kind === 'bomber') return '<path d="M-13 4-5-2-2-12h4L5-2l8 6-2 4-9-2-1 7h-2l-1-7-9 2Z"/>';
  if (kind === 'maritime_patrol') return '<path d="M-14 3-5-2-2-11h4L5-2l9 5-2 4-10-2-1 7h-2l-1-7-10 2Z"/><circle cx="0" cy="0" r="3"/>';
  if (kind === 'carrier') return '<path d="M-14 4h28l-5 8H-9Z"/><path d="M-11 0h22M-6-4H8L4 0" fill="none"/>';
  if (kind === 'surface') return '<path d="M-14 3h28l-5 9H-9Z"/><path d="M-5 3v-7h10v7M0-4v-4" fill="none"/>';
  if (kind === 'amphibious') return '<path d="M-14 3h28l-5 8H-9Z"/><path d="M-7-1 0-9 7-1M0-9V5M-11 14h22" fill="none"/>';
  if (kind.includes('submarine')) return '<path d="M-14 7c3-10 25-10 28 0Z"/><path d="M0-2v-7h6M-10 11h20" fill="none"/>';
  return '<circle r="8" fill="none"/><path d="M-8 0H8M0-8V8" fill="none"/>';
}

function formationFrame(side) {
  return side === 'BLUE'
    ? '<rect class="symbol-frame" x="-20" y="-16" width="40" height="32" rx="4"/>'
    : '<path class="symbol-frame" d="M0-21 24 0 0 21-24 0Z"/>';
}

function baseGlyph() {
  return '<path class="base-frame" d="M-15 13h30M-11 13V-3h22v16M-6-3v-8H6v8"/>';
}

function navalBaseGlyph() {
  return '<path class="base-frame" d="M-15 11h30M-10 6h20l-4 6H-6Z M0 6V-10M-6-4H6"/>';
}

function formationSymbol(unit, x, y) {
  const side = unit.side.toLowerCase();
  const strength = unit.strength == null ? 'unknown strength' : `${Number(unit.strength).toFixed(1)} strength`;
  const selected = state.selectedUnit === unit.id ? ' selected' : '';
  const frame = formationFrame(unit.side);
  return `<g class="map-unit side-${side}${selected}" data-map-kind="unit" data-map-id="${escapeMarkup(unit.id)}" transform="translate(${x} ${y}) scale(.56)" tabindex="0" role="button" aria-label="${escapeMarkup(unit.name)}, ${SIDE_META[unit.side].title}, ${strength}. Hover or press Enter for details." aria-describedby="map-tooltip" filter="url(#symbol-shadow)"><circle class="symbol-hit" r="29"/>${frame}<g class="symbol-glyph">${formationGlyph(unit.kind)}</g><text class="map-unit-code" y="29">${formationCode(unit)}</text></g>`;
}

function baseSymbol(base, x, y) {
  const side = base.side.toLowerCase();
  const selected = state.pinnedMapItem?.kind === 'base' && state.pinnedMapItem.id === base.id ? ' selected' : '';
  const naval = base.kind === 'naval_base';
  return `<g class="map-base side-${side}${selected}" data-map-kind="base" data-map-id="${escapeMarkup(base.id)}" transform="translate(${x} ${y}) scale(.56)" tabindex="0" role="button" aria-label="${escapeMarkup(base.name)}, ${SIDE_META[base.side].title} ${naval ? 'naval base' : 'airbase'}. Hover or press Enter for details." aria-describedby="map-tooltip" filter="url(#symbol-shadow)"><circle class="symbol-hit" r="29"/>${naval ? navalBaseGlyph() : baseGlyph()}<text class="map-unit-code" y="28">${naval ? 'NB' : 'AB'}</text></g>`;
}

function legendType(kind, label, code) {
  const glyph = kind === 'air_base' ? baseGlyph() : `<g class="symbol-glyph">${formationGlyph(kind)}</g>`;
  return `<span class="key-item key-type"><svg viewBox="-18 -18 36 36" aria-hidden="true">${glyph}</svg><span class="key-copy">${label}<small>${code}</small></span></span>`;
}

function renderSymbolKey() {
  $('symbol-key').innerHTML = `
    <span class="symbol-key-title">MAP SYMBOLS</span>
    <span class="key-section">SIDE FRAME</span>
    <span class="key-item key-side side-blue"><svg viewBox="-28 -24 56 48" aria-hidden="true">${formationFrame('BLUE')}</svg><span class="key-copy">Coalition<small>BLUE rectangle</small></span></span>
    <span class="key-item key-side side-red"><svg viewBox="-28 -24 56 48" aria-hidden="true">${formationFrame('RED')}</svg><span class="key-copy">PLA<small>RED diamond</small></span></span>
    <span class="key-section key-section-types">FORMATION TYPE</span>
    ${legendType('fighter_5g', 'Fighter wing', '5G · 4.5 · 4G')}
    ${legendType('bomber', 'Bomber wing', 'BMR')}
    ${legendType('maritime_patrol', 'Maritime patrol', 'MPA')}
    ${legendType('surface', 'Surface group', 'SAG')}
    ${legendType('carrier', 'Carrier group', 'CV')}
    ${legendType('nuclear_submarine', 'Submarine', 'SSN · SSK')}
    ${legendType('amphibious', 'Amphibious group', 'ARG')}
    ${legendType('air_base', 'Air base', 'AB')}
    <span class="key-item key-type"><svg viewBox="-18 -18 36 36" aria-hidden="true">${navalBaseGlyph()}</svg><span class="key-copy">Naval base<small>NB</small></span></span>`;
}

function miniFormationIcon(unit) {
  return `<svg class="formation-icon side-${unit.side.toLowerCase()}" viewBox="-18 -18 36 36" aria-hidden="true"><g class="symbol-glyph">${formationGlyph(unit.kind)}</g></svg>`;
}

function ownUnits(domain, kind) {
  const side = $('side-select').value;
  return Object.values(state.game.units).filter((unit) => unit.side === side && Number(unit.strength || 0) > .05 && (!domain || unit.domain === domain) && (!kind || unit.kind === kind));
}

function renderStockpile() {
  const side = $('side-select').value;
  const inventory = state.game.munitions[side];
  $('weapon-stockpile').innerHTML = `<span>AVAILABLE MAGAZINES</span><div>${Object.entries(WEAPON_META[side]).map(([id, meta]) => `<small><b>${escapeMarkup(meta[0])}</b>${Number(inventory[id] || 0).toFixed(0)}</small>`).join('')}</div>`;
}

const TAIWAN_ISLAND_PATH = 'M304 34C342 59 370 107 386 164C402 223 404 286 393 348C382 412 354 480 319 542C295 584 269 614 249 606C226 596 211 558 204 515C195 453 190 390 190 322C190 258 195 201 211 153C229 98 263 55 304 34Z';
const GROUND_ZONE_LAYOUT = {
  north_beach: { title: 'NORTH COAST', path: 'M122 35H307L300 122L260 153L200 157L149 132Z', labelX: 226, labelY: 92, unitX: 226, unitY: 133 },
  taipei: { title: 'TAIPEI', path: 'M307 35H430V170L330 185L300 122Z', labelX: 327, labelY: 91, unitX: 326, unitY: 133 },
  west_beach: { title: 'CENTRAL WEST', path: 'M149 132L200 157L260 153L289 239L260 282L159 286L124 235Z', labelX: 214, labelY: 202, unitX: 214, unitY: 248 },
  taichung: { title: 'TAICHUNG', path: 'M159 286L260 282L300 341L280 402L170 407L130 350Z', labelX: 218, labelY: 318, unitX: 218, unitY: 362 },
  central_mountains: { title: 'CENTRAL RANGE', path: 'M260 153L330 185L341 305L320 432L280 402L300 341L289 239Z', labelX: 304, labelY: 246, unitX: 304, unitY: 315 },
  hualien: { title: 'HUALIEN', path: 'M330 185L430 170L441 330L341 351L341 305Z', labelX: 358, labelY: 207, unitX: 356, unitY: 266 },
  east_coast: { title: 'EAST COAST', path: 'M341 305L441 330L430 502L320 538L280 466L320 432Z', labelX: 355, labelY: 397, unitX: 354, unitY: 458 },
  south_beach: { title: 'SOUTHWEST', path: 'M130 350L170 407L236 466L210 537L134 532L104 450Z', labelX: 204, labelY: 456, unitX: 205, unitY: 506 },
  kaohsiung: { title: 'KAOHSIUNG', path: 'M236 466L280 466L320 538L301 650H169L134 532L210 537Z', labelX: 254, labelY: 535, unitX: 254, unitY: 580 },
};

function groundUnitCode(unit) {
  const codes = { infantry: 'INF', mechanized: 'MECH', armor: 'ARM', artillery: 'ARTY', airborne: 'ABN', engineer: 'ENG' };
  return codes[unit.kind] || unit.kind.slice(0, 4).toUpperCase();
}

function groundFormationGlyph(kind) {
  if (kind === 'infantry') return '<path d="M-10-7 10 7M10-7-10 7"/>';
  if (kind === 'mechanized') return '<path d="M-10-7 10 7M10-7-10 7"/><ellipse cx="0" cy="0" rx="13" ry="8"/>';
  if (kind === 'armor') return '<ellipse cx="0" cy="0" rx="13" ry="8"/><path d="M-8 0H8"/>';
  if (kind === 'artillery') return '<circle cx="0" cy="0" r="3.2"/><path d="M0-11V11M-11 0H11"/>';
  if (kind === 'airborne') return '<path d="M-12 6Q-6-7 0 5Q6-7 12 6M0 5V12M-7 9H7"/>';
  if (kind === 'engineer') return '<path d="M-12 8H12M-9 8V-7M9 8V-7M-9-2H9M-5-2V5M0-2V5M5-2V5"/>';
  return '<circle r="9"/><path d="M-7 0H7M0-7V7"/>';
}

function groundSymbolOffsets(count) {
  if (!count) return [];
  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns - (columns - 1) / 2) * 34,
    y: (Math.floor(index / columns) - (rows - 1) / 2) * 32,
  }));
}

function groundFormationSymbol(unit, x, y) {
  const side = unit.side.toLowerCase();
  const scale = .64;
  const detail = `${unit.name}, ${SIDE_META[unit.side].title}, ${Number(unit.strength).toFixed(1)} strength, ${(Number(unit.supply) * 100).toFixed(0)} percent supply`;
  return `<g class="map-unit ground-map-unit side-${side}" transform="translate(${x} ${y}) scale(${scale})" tabindex="0" role="img" aria-label="${escapeMarkup(detail)}" filter="url(#ground-symbol-shadow)"><title>${escapeMarkup(detail)}</title><circle class="symbol-hit" r="29"/>${formationFrame(unit.side)}<g class="symbol-glyph">${groundFormationGlyph(unit.kind)}</g><text class="map-unit-code" y="29">${groundUnitCode(unit)}</text></g>`;
}

function renderGroundMap() {
  const svg = $('ground-map');
  if (!svg || !state.game.ground_hexes) return;
  const groundUnits = Object.values(state.game.ground_units || {});
  let content = `<defs>
    <linearGradient id="ground-ocean" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bfd7da"/><stop offset=".55" stop-color="#97bdc3"/><stop offset="1" stop-color="#719da7"/></linearGradient>
    <linearGradient id="ground-land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9d7bd"/><stop offset=".5" stop-color="#bfc7a8"/><stop offset="1" stop-color="#9ba990"/></linearGradient>
    <linearGradient id="ridge-fill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#75856c" stop-opacity="0"/><stop offset=".5" stop-color="#697962" stop-opacity=".42"/><stop offset="1" stop-color="#536b5f" stop-opacity=".1"/></linearGradient>
    <pattern id="ground-grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0V52" fill="none" stroke="#315b63" stroke-opacity=".10" stroke-width=".8"/><path d="M13 0V52M26 0V52M39 0V52M0 13H52M0 26H52M0 39H52" fill="none" stroke="#315b63" stroke-opacity=".035" stroke-width=".5"/></pattern>
    <clipPath id="taiwan-clip"><path d="${TAIWAN_ISLAND_PATH}"/></clipPath>
    <filter id="island-shadow" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="3" dy="6" stdDeviation="7" flood-color="#173d45" flood-opacity=".38"/></filter>
    <filter id="ground-symbol-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#102a31" flood-opacity=".5"/></filter>
  </defs>
  <rect class="ground-ocean" width="520" height="640" fill="url(#ground-ocean)"/>
  <rect width="520" height="640" fill="url(#ground-grid)"/>
  <g class="ground-bathymetry">
    <path d="M140-10C163 86 151 171 135 252C119 334 120 443 151 650"/>
    <path d="M107-10C132 93 113 190 101 276C91 359 96 468 126 650"/>
    <path d="M425-10C453 95 448 190 461 276C471 350 466 489 432 650"/>
    <path d="M463-10C489 112 480 220 492 320C499 407 487 516 465 650"/>
  </g>
  <g class="ground-map-caption"><text x="24" y="36">TAIWAN</text><text x="24" y="54">GROUND OPERATIONS</text><path d="M24 65H116"/></g>
  <g class="ground-sea-labels"><text x="74" y="324" transform="rotate(-90 74 324)">TAIWAN STRAIT</text><text x="474" y="330" transform="rotate(90 474 330)">PHILIPPINE SEA</text></g>
  <g class="ground-coordinates"><text x="7" y="116">25°N</text><text x="7" y="324">24°N</text><text x="7" y="532">23°N</text><text x="160" y="629">120°E</text><text x="362" y="629">121°E</text></g>
  <path class="ground-island" d="${TAIWAN_ISLAND_PATH}" fill="url(#ground-land)" filter="url(#island-shadow)"/>
  <g clip-path="url(#taiwan-clip)">`;
  let deployedSymbols = '';
  Object.entries(state.game.ground_hexes).forEach(([id, hex]) => {
    const layout = GROUND_ZONE_LAYOUT[id];
    if (!layout) return;
    const controller = String(hex.controller || 'NONE').toLowerCase();
    content += `<g class="ground-zone control-${controller}" data-ground-zone="${escapeMarkup(id)}"><path class="ground-zone-shape" d="${layout.path}"/></g>`;
  });
  content += `<path class="ground-ridge-fill" d="M274 82C318 145 317 220 329 282C343 348 327 424 298 501L258 562C267 467 248 403 259 331C270 260 255 187 274 82Z"/>
    <g class="ground-relief"><path d="M286 79C308 144 304 209 320 274C336 340 318 410 292 487C280 521 267 550 251 578"/><path d="M268 115C291 175 282 235 296 298C309 360 296 423 270 493"/><path d="M321 169C341 222 340 281 352 337C363 392 345 445 320 494"/><path d="M232 186C247 223 241 260 249 296M228 329C237 371 235 410 249 449"/></g>
    <g class="ground-rivers"><path d="M286 170C260 186 245 207 218 222"/><path d="M296 302C270 316 250 335 214 348"/><path d="M295 444C270 458 244 476 211 496"/></g>
  </g>
  <path class="ground-coast" d="${TAIWAN_ISLAND_PATH}"/>
  <g class="ground-islets"><path d="M151 360l10-8 8 9-6 12-11-2Z"/><path d="M163 382l8-5 6 7-4 10-9-2Z"/><path d="M423 384l7-5 6 9-7 9-7-5Z"/><path d="M397 532l8-4 6 8-5 10-8-3Z"/></g>`;

  Object.entries(state.game.ground_hexes).forEach(([id, hex]) => {
    const layout = GROUND_ZONE_LAYOUT[id];
    if (!layout) return;
    const feature = hex.beach ? `BEACH · CD ${Number(hex.coastal_defense || 0).toFixed(1)}` : hex.port ? 'PORT / LOGISTICS' : String(hex.terrain || '').replaceAll('/', ' / ').toUpperCase();
    content += `<g class="ground-zone-copy" data-ground-zone-label="${escapeMarkup(id)}"><text class="ground-zone-label" x="${layout.labelX}" y="${layout.labelY}">${escapeMarkup(layout.title)}</text><text class="ground-zone-terrain" x="${layout.labelX}" y="${layout.labelY + 13}">${escapeMarkup(feature)}</text></g>`;
    const here = groundUnits.filter((unit) => unit.strength > .05 && unit.hex_id === id);
    const offsets = groundSymbolOffsets(here.length);
    here.forEach((unit, index) => {
      deployedSymbols += groundFormationSymbol(unit, layout.unitX + offsets[index].x, layout.unitY + offsets[index].y);
    });
  });

  content += deployedSymbols;
  content += `<g class="ground-scale" transform="translate(26 582)"><text x="0" y="-12">APPROX. SCALE</text><path d="M0 0H88M0-5V5M44-5V5M88-5V5"/><text x="0" y="17">0</text><text x="40" y="17">30</text><text x="81" y="17">60 KM</text></g>
  <g class="ground-orientation" transform="translate(476 66)"><path d="M0 24V-18M0-18l-6 12M0-18l6 12"/><text x="0" y="-27">N</text></g>`;
  svg.innerHTML = content;

  const activeRed = groundUnits.filter((unit) => unit.side === 'RED' && unit.strength > .05);
  const reserves = groundUnits.filter((unit) => unit.side === 'RED' && unit.reserve_strength > .05);
  $('ground-summary').innerHTML = `<div><span>PLA SUPPLY ASHORE</span><strong>${activeRed.length ? `${(Number(state.game.metrics.red_ground_supply || 0) * 100).toFixed(0)}%` : 'No lodgment'}</strong></div><div><span>AVAILABLE PLA RESERVES</span><strong>${reserves.length} formations</strong></div>`;
  $('ground-roster').innerHTML = groundUnits.filter((unit) => unit.strength > .05 || unit.reserve_strength > .05).map((unit) => {
    const deployed = unit.strength > .05;
    const location = deployed ? state.game.ground_hexes[unit.hex_id]?.name : 'Awaiting lift';
    return `<article class="ground-card side-${unit.side.toLowerCase()} ${deployed ? '' : 'reserve'}"><header><b>${escapeMarkup(unit.name)}</b><span>${groundUnitCode(unit)}</span></header><small>${escapeMarkup(location)} · ${deployed ? `${Number(unit.strength).toFixed(1)} strength · ${(Number(unit.supply) * 100).toFixed(0)}% supply` : `${Number(unit.reserve_strength).toFixed(1)} reserve strength · ${Number(unit.lift_cost).toFixed(1)}k tons/strength`}</small></article>`;
  }).join('');
}

function optionList(items, value = 'id', label = 'name') { return items.map((item) => `<option value="${item[value]}">${item[label]}</option>`).join(''); }
function selectField(label, id, options) { return `<label>${label}<select id="${id}">${options}</select></label>`; }
function numberField(label, id, value, min, max, step = 1) { return `<label>${label}<input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`; }
function weaponOptions(side, role = null, platform = 'any') {
  const inventory = state.game.munitions[side];
  return Object.entries(WEAPON_META[side]).filter(([id, meta]) => inventory[id] > 0 && (!role || meta[1] === role || meta[1] === 'dual') && (platform !== 'air' || AIR_WEAPONS[side].includes(id))).map(([id, meta]) => `<option value="${id}">${meta[0]} · ${inventory[id].toFixed(0)} available</option>`).join('');
}

function renderForm() {
  if (!state.game) return;
  const type = $('action-type').value;
  const side = $('side-select').value;
  const regions = Object.entries(state.game.regions).map(([id, data]) => ({ id, name: data.name }));
  let html = '';
  if (type === 'missile_strike') {
    const targets = [...Object.values(state.game.bases), ...Object.values(state.game.units).filter((unit) => unit.domain === 'naval')].filter((item) => item.side !== side && Number(item.strength ?? 1) > .05);
    html = selectField('Located target (submarines excluded)', 'field-target', optionList(targets)) + selectField('Weapon', 'field-weapon', weaponOptions(side)) + numberField('Rounds allocated', 'field-amount', 6, 1, 100);
  } else if (type === 'air_mission') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('air'))) + selectField('Mission', 'field-mission', '<option value="cap">Air superiority / CAP</option><option value="strike_base">Strike air base</option><option value="maritime_strike">Maritime strike</option><option value="ground_support">Ground support</option><option value="interdiction">Ground interdiction</option><option value="asw">ASW search</option><option value="reserve">Reserve</option>') + selectField('Target operational area', 'field-target', optionList(regions)) + selectField('Strike weapon (strike missions only)', 'field-weapon', weaponOptions(side)) + numberField('Strike rounds', 'field-amount', 4, 1, 40);
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
    const reserves = Object.values(state.game.ground_units || {}).filter((unit) => unit.side === 'RED' && unit.reserve_strength > .05);
    const beaches = Object.entries(state.game.ground_hexes || {}).filter(([, hex]) => hex.beach || hex.port).map(([id, hex]) => ({ id, name: hex.name }));
    html = selectField('Amphibious group', 'field-unit', optionList(ownUnits('naval', 'amphibious'))) + selectField('Ground formation', 'field-ground-unit', optionList(reserves)) + selectField('Landing hex', 'field-ground-target', optionList(beaches)) + selectField('Insertion method', 'field-insertion', '<option value="amphibious">Amphibious landing</option><option value="air_assault">Air assault</option><option value="airborne">Airborne</option><option value="captured_port">Captured port</option>') + numberField('Lift committed (thousand tons)', 'field-amount', 5, .5, 30, .5);
  } else if (type === 'ground_order') {
    const formations = Object.values(state.game.ground_units || {}).filter((unit) => unit.side === side && unit.strength > .05);
    const hexes = Object.entries(state.game.ground_hexes || {}).map(([id, hex]) => ({ id, name: hex.name }));
    html = selectField('Ground formation', 'field-unit', optionList(formations)) + selectField('Mission', 'field-mission', '<option value="defend">Defend current hex</option><option value="attack">Attack / advance</option><option value="move">Move</option><option value="reserve">Reserve</option>') + selectField('Target 30 km hex', 'field-target', optionList(hexes));
  } else if (type === 'ground_attack') {
    html = numberField('Intensity', 'field-intensity', .5, .25, 1, .25);
  }
  $('dynamic-fields').innerHTML = html;

  if (type === 'missile_strike') {
    const targetSelect = $('field-target');
    const weaponSelect = $('field-weapon');
    const refreshWeapons = () => {
      const role = state.game.bases[targetSelect?.value] ? 'land' : 'naval';
      if (weaponSelect) weaponSelect.innerHTML = weaponOptions(side, role);
    };
    targetSelect?.addEventListener('change', refreshWeapons);
    refreshWeapons();
  }

  if (type === 'air_mission') {
    const missionSelect = $('field-mission');
    const weaponSelect = $('field-weapon');
    const refreshWeapons = () => {
      if (!weaponSelect) return;
      if (missionSelect?.value === 'strike_base') weaponSelect.innerHTML = weaponOptions(side, 'land', 'air');
      else if (missionSelect?.value === 'maritime_strike') weaponSelect.innerHTML = weaponOptions(side, 'naval', 'air');
      else weaponSelect.innerHTML = '<option value="">Not used for this mission</option>';
    };
    missionSelect?.addEventListener('change', refreshWeapons);
    refreshWeapons();
  }
}

function buildOrder() {
  const type = $('action-type').value;
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
  const names = { missile_strike: 'Missile strike', air_mission: 'Air mission', rebase: 'Rebase', naval_move: 'Naval movement', naval_mission: 'Surface mission', submarine_mission: 'Submarine mission', amphibious_lift: 'Amphibious lift', ground_order: 'Ground order', ground_attack: 'Ground operations' };
  const unit = state.game.units[order.unit_id]?.name || state.game.ground_units?.[order.unit_id]?.name || order.unit_id || '';
  const target = state.game.regions[order.target]?.name || state.game.bases[order.target]?.name || state.game.units[order.target_id]?.name || state.game.bases[order.target_id]?.name || order.target || order.target_id || '';
  const ground = state.game.ground_units?.[order.ground_unit_id]?.name || '';
  const groundTarget = state.game.ground_hexes?.[order.target]?.name || '';
  return `${unit}${ground ? ` + ${ground}` : ''}${unit && (target || groundTarget) ? ' → ' : ''}${groundTarget || target}${order.mission ? ` · ${order.mission}` : ''}${order.weapon ? ` · ${order.weapon}` : ''}${order.insertion ? ` · ${order.insertion}` : ''}${order.amount ? ` · ${order.amount}` : ''}${order.intensity ? ` · ${order.intensity}` : ''}`;
}

function renderOrders() {
  $('order-count').textContent = `${state.orders.length} queued`;
  $('orders-list').innerHTML = state.orders.length ? state.orders.map((order, index) => `<div class="order-item"><strong>${order.type.replaceAll('_', ' ')}</strong><br>${describeOrder(order)} <button class="remove-order" data-index="${index}" aria-label="Remove order">×</button></div>`).join('') : '<div class="empty">No orders queued.</div>';
  document.querySelectorAll('.remove-order').forEach((button) => button.onclick = () => { state.orders.splice(Number(button.dataset.index), 1); renderOrders(); });
}

function renderFormations() {
  const units = Object.values(state.game.units).filter((unit) => state.filter === 'ALL' || unit.side === state.filter);
  $('formations').innerHTML = units.map((unit) => {
    const strength = Number(unit.strength);
    const hidden = unit.strength == null || !Number.isFinite(strength);
    const pct = hidden ? 35 : Math.max(0, Math.min(100, strength / unit.max_strength * 100));
    const selected = state.selectedUnit === unit.id ? ' selected' : '';
    return `<article class="formation ${unit.side.toLowerCase()}${selected}" data-formation-id="${escapeMarkup(unit.id)}"><header><div class="formation-title">${miniFormationIcon(unit)}<h3>${escapeMarkup(unit.name)}</h3></div><span class="side ${unit.side}">${unit.side} · ${SIDE_META[unit.side].short}</span></header><p>${unit.kind.replaceAll('_', ' ')} · ${state.game.regions[unit.region]?.name}</p><div class="strength-line"><i style="width:${pct}%"></i></div><small>${hidden ? 'Strength unknown' : `${strength.toFixed(1)} / ${unit.max_strength.toFixed(1)}`} · readiness ${hidden ? 'unknown' : `${(unit.readiness * 100).toFixed(0)}%`}</small></article>`;
  }).join('');
}

function renderEvents() {
  const events = [...state.game.events].reverse();
  $('event-log').innerHTML = events.length ? events.map((event) => `<div class="event"><time>T${event.turn}</time><b>${escapeMarkup(event.phase)}</b><span>${escapeMarkup(event.message)}</span></div>`).join('') : '<div class="empty">No adjudication events yet.</div>';
}

function showError(error) { $('error-box').textContent = error.message || String(error); $('error-box').hidden = false; }
function clearError() { $('error-box').hidden = true; }

$('action-type').addEventListener('change', renderForm);
$('side-select').addEventListener('change', async () => { state.orders = []; stopTurnReplay(); state.game = await api(`/api/state?observer=${$('side-select').value}`); state.replayEvents = latestTurnEvents(state.game.events); render(); });
$('order-form').addEventListener('submit', (event) => { event.preventDefault(); clearError(); try { const order = buildOrder(); if (!order.unit_id && ['air_mission','rebase','naval_move','naval_mission','submarine_mission','amphibious_lift','ground_order'].includes(order.type)) throw new Error('No eligible formation is available.'); state.orders.push(order); renderOrders(); } catch (error) { showError(error); } });
$('clear-orders').addEventListener('click', () => { state.orders = []; renderOrders(); });
$('resolve-turn').addEventListener('click', async () => { clearError(); try { const previousCount = state.game.events.length; state.game = await api('/api/turn', { method: 'POST', body: JSON.stringify({ side: $('side-select').value, orders: state.orders }) }); state.orders = []; render(); setReplayEvents(state.game.events.slice(previousCount), true); } catch (error) { showError(error); } });
$('agent-turn').addEventListener('click', async () => { clearError(); try { const previousCount = state.game.events.length; state.game = await api('/api/agent-turn', { method: 'POST', body: '{}' }); state.orders = []; render(); setReplayEvents(state.game.events.slice(previousCount), true); } catch (error) { showError(error); } });
$('autoplay').addEventListener('click', async () => { clearError(); try { const previousCount = state.game.events.length; state.game = await api('/api/autoplay', { method: 'POST', body: JSON.stringify({ turns: 20 }) }); state.orders = []; render(); setReplayEvents(latestTurnEvents(state.game.events.slice(previousCount)), true); } catch (error) { showError(error); } });
$('new-game').addEventListener('click', async () => { const seed = Number(prompt('Random seed for reproducible adjudication:', '7')); if (!Number.isFinite(seed)) return; stopTurnReplay(); state.game = await api('/api/new-game', { method: 'POST', body: JSON.stringify({ seed }) }); state.orders = []; state.replayEvents = []; render(); });
$('replay-turn').addEventListener('click', playTurnReplay);
$('replay-skip').addEventListener('click', stopTurnReplay);
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); state.filter = tab.dataset.filter; renderFormations(); }));
$('map-tooltip').addEventListener('click', (event) => {
  if (event.target.closest('.tooltip-close')) {
    event.stopPropagation();
    state.pinnedMapItem = null;
    $('map').querySelectorAll('.map-base.selected').forEach((item) => item.classList.remove('selected'));
    hideMapTooltip();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('map-tooltip').hidden) {
    state.pinnedMapItem = null;
    $('map').querySelectorAll('.map-base.selected').forEach((item) => item.classList.remove('selected'));
    hideMapTooltip();
  }
});

renderSymbolKey();
load().catch(showError);
function humanize(value) {
  return String(value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'Unknown';
}

function tooltipIcon(kind, item) {
  const symbol = kind === 'base' ? (item.kind === 'naval_base' ? navalBaseGlyph() : baseGlyph()) : `<g class="symbol-glyph">${formationGlyph(item.kind)}</g>`;
  return `<svg class="tooltip-symbol side-${item.side.toLowerCase()}" viewBox="-23 -23 46 46" aria-hidden="true">${kind === 'unit' ? formationFrame(item.side) : ''}${symbol}</svg>`;
}

function tooltipStat(label, value, detail = '') {
  return `<div class="tooltip-stat"><span>${escapeMarkup(label)}</span><strong>${escapeMarkup(value)}</strong>${detail ? `<small>${escapeMarkup(detail)}</small>` : ''}</div>`;
}

function unitTooltip(unit) {
  const region = state.game.regions[unit.region]?.name || unit.region;
  const base = unit.base_id ? state.game.bases[unit.base_id] : null;
  const strengthKnown = unit.strength != null && Number.isFinite(Number(unit.strength));
  const readinessKnown = unit.readiness != null && Number.isFinite(Number(unit.readiness));
  const strengthPct = strengthKnown && Number(unit.max_strength) > 0 ? Math.max(0, Math.min(100, Number(unit.strength) / Number(unit.max_strength) * 100)) : 0;
  const target = state.game.regions[unit.target]?.name || state.game.bases[unit.target]?.name || unit.target;
  return `<div class="tooltip-accent side-${unit.side.toLowerCase()}"></div>
    <div class="tooltip-header">
      ${tooltipIcon('unit', unit)}
      <div class="tooltip-title"><span>${escapeMarkup(humanize(unit.domain))} formation · ${escapeMarkup(formationCode(unit))}</span><strong>${escapeMarkup(unit.name)}</strong><small>${escapeMarkup(SIDE_META[unit.side].title)}</small></div>
      <button class="tooltip-close" type="button" aria-label="Close pinned details">×</button>
    </div>
    <div class="tooltip-location"><span>LOC</span>${escapeMarkup(region)}${base ? ` · ${escapeMarkup(base.name)}` : ''}</div>
    <div class="tooltip-stats">
      ${tooltipStat('Strength', strengthKnown ? `${formatNumber(unit.strength, 1)} / ${formatNumber(unit.max_strength, 1)}` : 'Unknown', strengthKnown ? `${strengthPct.toFixed(0)}% combat power` : 'Contact not identified')}
      ${tooltipStat('Readiness', readinessKnown ? `${(Number(unit.readiness) * 100).toFixed(0)}%` : 'Unknown')}
      ${tooltipStat('Mission', humanize(unit.mission))}
    </div>
    <div class="tooltip-meter ${strengthKnown ? '' : 'unknown'}"><i style="width:${strengthKnown ? strengthPct : 35}%"></i></div>
    ${target ? `<div class="tooltip-footer"><span>TARGET</span>${escapeMarkup(target)}</div>` : ''}
    ${unit.kind === 'amphibious' ? `<div class="tooltip-footer"><span>LIFT</span>${formatNumber(unit.capacity, 1)} points per turn</div>` : ''}
    ${unit.counter_scale ? `<div class="tooltip-footer"><span>COUNTER SCALE</span>${escapeMarkup(unit.counter_scale)}</div>` : ''}
    ${unit.contact_state ? `<div class="tooltip-footer"><span>CONTACT</span>${escapeMarkup(unit.contact_state)} · ${(Number(unit.contact_confidence || 0) * 100).toFixed(0)}% confidence</div>` : ''}
    ${unit.weapons && Object.keys(unit.weapons).length ? `<div class="tooltip-footer"><span>MAGAZINES</span>${Object.entries(unit.weapons).map(([name, amount]) => `${escapeMarkup(humanize(name))} ${formatNumber(amount, 0)}`).join(' · ')}</div>` : ''}
    <div class="tooltip-hint">Click to pin · Esc to close</div>`;
}

function baseTooltip(base) {
  const region = state.game.regions[base.region]?.name || base.region;
  const assigned = Object.values(state.game.units).filter((unit) => unit.base_id === base.id && unitIsActive(unit));
  const effectiveness = Math.max(.1, 1 - Number(base.damage || 0));
  const latestUpdate = [...state.game.events].reverse().find((event) => event.data?.target === base.id && ['MISSILES', 'AIR', 'REPAIR'].includes(event.phase));
  return `<div class="tooltip-accent side-${base.side.toLowerCase()}"></div>
    <div class="tooltip-header">
      ${tooltipIcon('base', base)}
      <div class="tooltip-title"><span>${base.kind === 'naval_base' ? 'Naval base · NB' : 'Airbase · AB'}</span><strong>${escapeMarkup(base.name)}</strong><small>${escapeMarkup(SIDE_META[base.side].title)}</small></div>
      <button class="tooltip-close" type="button" aria-label="Close pinned details">×</button>
    </div>
    <div class="tooltip-location"><span>LOC</span>${escapeMarkup(region)}</div>
    <div class="tooltip-stats">
      ${tooltipStat('Operational', `${(effectiveness * 100).toFixed(0)}%`, `${(Number(base.damage || 0) * 100).toFixed(0)}% damage`)}
      ${tooltipStat('Capacity', base.kind === 'naval_base' ? `${base.port_capacity || 0} groups` : `${assigned.length} / ${base.capacity}`, base.kind === 'naval_base' ? 'port capacity' : 'formations assigned')}
      ${tooltipStat('Defense', `SAM ${formatNumber(base.sam, 1)}`, `hardening ${formatNumber(base.hardening, 1)}`)}
    </div>
    <div class="tooltip-meter"><i style="width:${effectiveness * 100}%"></i></div>
    <div class="tooltip-footer"><span>HOSTED</span>${assigned.length ? assigned.map((unit) => escapeMarkup(unit.name)).join(' · ') : 'No active formations assigned'}</div>
    ${latestUpdate ? `<div class="tooltip-footer"><span>LATEST</span>${escapeMarkup(latestUpdate.message)}</div>` : ''}
    <div class="tooltip-hint">Click to pin · Esc to close</div>`;
}

function mapItem(symbol) {
  const kind = symbol.dataset.mapKind;
  const id = symbol.dataset.mapId;
  const item = kind === 'base' ? state.game.bases[id] : state.game.units[id];
  return item ? { kind, id, item } : null;
}

function positionMapTooltip(symbol, event) {
  const stage = $('map-stage');
  const tooltip = $('map-tooltip');
  const stageRect = stage.getBoundingClientRect();
  const symbolRect = symbol.getBoundingClientRect();
  const pointerX = Number.isFinite(event?.clientX) ? event.clientX : symbolRect.right;
  const pointerY = Number.isFinite(event?.clientY) ? event.clientY : symbolRect.top + symbolRect.height / 2;
  const gap = 14;
  let left = pointerX - stageRect.left + gap;
  let top = pointerY - stageRect.top - tooltip.offsetHeight / 2;
  if (left + tooltip.offsetWidth > stageRect.width - 10) left = pointerX - stageRect.left - tooltip.offsetWidth - gap;
  left = Math.max(10, Math.min(stageRect.width - tooltip.offsetWidth - 10, left));
  top = Math.max(10, Math.min(stageRect.height - tooltip.offsetHeight - 10, top));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showMapTooltip(symbol, event, pinned = false) {
  const entry = mapItem(symbol);
  if (!entry) return;
  const tooltip = $('map-tooltip');
  tooltip.innerHTML = entry.kind === 'base' ? baseTooltip(entry.item) : unitTooltip(entry.item);
  tooltip.hidden = false;
  tooltip.classList.toggle('is-pinned', pinned);
  tooltip.dataset.kind = entry.kind;
  tooltip.dataset.id = entry.id;
  positionMapTooltip(symbol, event);
}

function hideMapTooltip(clearPin = false) {
  if (clearPin) state.pinnedMapItem = null;
  const tooltip = $('map-tooltip');
  if (!tooltip) return;
  tooltip.hidden = true;
  tooltip.classList.remove('is-pinned');
  delete tooltip.dataset.kind;
  delete tooltip.dataset.id;
}

function restorePinnedTooltip() {
  if (!state.pinnedMapItem) return hideMapTooltip();
  const selector = `[data-map-kind="${state.pinnedMapItem.kind}"][data-map-id="${CSS.escape(state.pinnedMapItem.id)}"]`;
  const symbol = $('map').querySelector(selector);
  if (symbol) showMapTooltip(symbol, null, true);
}

function selectMapItem(symbol, event) {
  const entry = mapItem(symbol);
  if (!entry) return;
  state.pinnedMapItem = { kind: entry.kind, id: entry.id };
  $('map').querySelectorAll('.map-unit.selected, .map-base.selected').forEach((item) => item.classList.remove('selected'));
  symbol.classList.add('selected');
  showMapTooltip(symbol, event, true);
  if (entry.kind === 'unit') {
    state.selectedUnit = entry.id;
    renderFormations();
    document.querySelector(`[data-formation-id="${CSS.escape(entry.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function attachMapInteractions(svg) {
  svg.querySelectorAll('[data-map-kind][data-map-id]').forEach((symbol) => {
    symbol.addEventListener('pointerenter', (event) => showMapTooltip(symbol, event));
    symbol.addEventListener('pointermove', (event) => showMapTooltip(symbol, event));
    symbol.addEventListener('pointerleave', restorePinnedTooltip);
    symbol.addEventListener('focus', () => showMapTooltip(symbol));
    symbol.addEventListener('blur', restorePinnedTooltip);
    symbol.addEventListener('click', (event) => { event.stopPropagation(); selectMapItem(symbol, event); });
    symbol.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectMapItem(symbol); }
    });
  });
  svg.addEventListener('click', () => {
    state.pinnedMapItem = null;
    svg.querySelectorAll('.map-base.selected').forEach((item) => item.classList.remove('selected'));
    hideMapTooltip();
  });
}

const replayDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function latestTurnEvents(events = []) {
  if (!events.length) return [];
  const turn = Math.max(...events.map((event) => Number(event.turn) || 0));
  return events.filter((event) => Number(event.turn) === turn);
}

function updateReplayButton() {
  if (!state.replayEvents.length && state.game?.events?.length) state.replayEvents = latestTurnEvents(state.game.events);
  const button = $('replay-turn');
  if (!button) return;
  button.hidden = !state.replayEvents.length;
  button.disabled = state.replayRunning;
  button.textContent = state.replayEvents.length ? `Replay turn ${state.replayEvents[0].turn}` : 'Replay latest turn';
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
  const namedRegion = Object.entries(state.game.regions).find(([, region]) => event.message.includes(region.name));
  if (namedRegion) return namedRegion[0];
  if (['GROUND', 'LIFT', 'ASSESSMENT', 'VICTORY'].includes(event.phase)) return 'taiwan';
  return 'taiwan';
}

function replaySide(event) {
  const side = event.data?.side || (/^BLUE\b/.test(event.message) ? 'BLUE' : /^RED\b/.test(event.message) ? 'RED' : null);
  return side ? side.toLowerCase() : 'neutral';
}

function replayOverlayMarkup(event) {
  const data = event.data || {};
  const regionId = inferEventRegion(event);
  const point = state.game.regions[regionId] || state.game.regions.taiwan;
  const from = data.from_region && state.game.regions[data.from_region];
  const to = data.to_region && state.game.regions[data.to_region];
  const label = escapeMarkup(humanize(event.phase).toUpperCase());
  if (from && to && data.from_region !== data.to_region) {
    return `<path class="replay-route" d="M${from.x} ${from.y} L${to.x} ${to.y}"/><circle class="replay-impact" cx="${to.x}" cy="${to.y}" r="12"/><circle class="replay-core" cx="${to.x}" cy="${to.y}" r="5"/><text class="replay-label" x="${to.x}" y="${to.y - 20}">${label}</text>`;
  }
  return `<circle class="replay-impact" cx="${point.x}" cy="${point.y}" r="12"/><circle class="replay-core" cx="${point.x}" cy="${point.y}" r="5"/><text class="replay-label" x="${point.x}" y="${point.y - 20}">${label}</text>`;
}

function renderReplayFrame(event, index, total) {
  const overlay = $('event-overlay');
  if (!overlay) return;
  overlay.setAttribute('class', `replay-overlay side-${replaySide(event)} phase-${event.phase.toLowerCase().replaceAll('_', '-')}`);
  overlay.innerHTML = replayOverlayMarkup(event);
  $('replay-kicker').textContent = `TURN ${event.turn} · EVENT ${index + 1} OF ${total}`;
  $('replay-phase').textContent = humanize(event.phase);
  $('replay-message').textContent = event.message;
  $('replay-progress').innerHTML = Array.from({ length: total }, (_, step) => `<i class="${step <= index ? 'complete' : ''}"></i>`).join('');
}

async function playTurnReplay() {
  if (!state.replayEvents.length || state.replayRunning) return;
  state.replayRunning = true;
  const run = ++state.replayRun;
  const replay = $('turn-replay');
  replay.hidden = false;
  hideMapTooltip();
  updateReplayButton();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let index = 0; index < state.replayEvents.length; index += 1) {
    if (run !== state.replayRun) return;
    renderReplayFrame(state.replayEvents[index], index, state.replayEvents.length);
    await replayDelay(reducedMotion ? 180 : 900);
  }
  if (run !== state.replayRun) return;
  await replayDelay(reducedMotion ? 80 : 450);
  if (run !== state.replayRun) return;
  state.replayRunning = false;
  replay.hidden = true;
  const overlay = $('event-overlay');
  if (overlay) overlay.innerHTML = '';
  updateReplayButton();
}

function stopTurnReplay() {
  state.replayRun += 1;
  state.replayRunning = false;
  const replay = $('turn-replay');
  if (replay) replay.hidden = true;
  const overlay = $('event-overlay');
  if (overlay) overlay.innerHTML = '';
  updateReplayButton();
}
