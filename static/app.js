const state = { game: null, scenario: null, orders: [], filter: 'ALL' };
const $ = (id) => document.getElementById(id);

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
  $('turn-value').textContent = `Turn ${game.turn} / ${game.max_turns}`;
  $('control-value').textContent = `${game.metrics.taiwan_control.toFixed(0)}%`;
  $('control-meter').style.width = `${game.metrics.taiwan_control}%`;
  $('lodgment-value').textContent = game.metrics.red_lodgment.toFixed(1);
  $('defense-value').textContent = game.metrics.taiwan_defense.toFixed(1);
  $('munition-value').textContent = `${game.munitions.BLUE.long_range.toFixed(0)} / ${game.munitions.RED.long_range.toFixed(0)}`;
  $('status-value').textContent = game.status;
  $('winner-value').textContent = game.winner ? `Outcome: ${game.winner}` : 'Occupation denied so far';
  $('seed-value').textContent = `Seed ${game.seed}`;
  renderMap(); renderForm(); renderOrders(); renderFormations(); renderEvents();
}

function renderMap() {
  const svg = $('map');
  const regions = state.game.regions;
  const drawn = new Set();
  let content = '<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".18"/></filter></defs>';
  Object.entries(regions).forEach(([id, region]) => region.adjacent.forEach((other) => {
    const key = [id, other].sort().join(':');
    if (!drawn.has(key) && regions[other]) {
      drawn.add(key); content += `<line class="region-edge" x1="${region.x}" y1="${region.y}" x2="${regions[other].x}" y2="${regions[other].y}"/>`;
    }
  }));
  Object.entries(regions).forEach(([id, region]) => {
    const count = Object.values(state.game.units).filter((unit) => unit.region === id && Number(unit.strength || 0) > .05).length;
    const blue = Object.values(state.game.units).filter((unit) => unit.region === id && unit.side === 'BLUE' && Number(unit.strength || 0) > .05).length;
    const red = count - blue;
    content += `<g filter="url(#shadow)"><circle class="region-node ${id}" cx="${region.x}" cy="${region.y}" r="45"/><text class="region-label" x="${region.x}" y="${region.y - 5}">${region.name}</text><text class="region-label" x="${region.x}" y="${region.y + 11}" style="font-weight:400;font-size:9px">${count} formations</text></g>`;
    if (blue) content += marker(region.x - 22, region.y + 33, blue, 'blue');
    if (red) content += marker(region.x + 22, region.y + 33, red, 'red');
  });
  svg.innerHTML = content;
}

function marker(x, y, count, side) { return `<circle class="unit-marker ${side}" cx="${x}" cy="${y}" r="13"/><text class="unit-count" x="${x}" y="${y + 3}">${count}</text>`; }

function ownUnits(domain, kind) {
  const side = $('side-select').value;
  return Object.values(state.game.units).filter((unit) => unit.side === side && Number(unit.strength || 0) > .05 && (!domain || unit.domain === domain) && (!kind || unit.kind === kind));
}

function optionList(items, value = 'id', label = 'name') { return items.map((item) => `<option value="${item[value]}">${item[label]}</option>`).join(''); }
function selectField(label, id, options) { return `<label>${label}<select id="${id}">${options}</select></label>`; }
function numberField(label, id, value, min, max, step = 1) { return `<label>${label}<input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`; }

function renderForm() {
  if (!state.game) return;
  const type = $('action-type').value;
  const side = $('side-select').value;
  const regions = Object.entries(state.game.regions).map(([id, data]) => ({ id, name: data.name }));
  let html = '';
  if (type === 'missile_strike') {
    const targets = [...Object.values(state.game.bases), ...Object.values(state.game.units)].filter((item) => item.side !== side && Number(item.strength ?? 1) > .05);
    html = selectField('Target', 'field-target', optionList(targets)) + numberField('Missiles', 'field-amount', 10, 1, 100);
  } else if (type === 'air_mission') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('air'))) + selectField('Mission', 'field-mission', '<option value="cap">Air superiority / CAP</option><option value="strike_base">Strike air base</option><option value="maritime_strike">Maritime strike</option><option value="ground_support">Ground support</option><option value="reserve">Reserve</option>') + selectField('Target region', 'field-target', optionList(regions));
  } else if (type === 'rebase') {
    const bases = Object.values(state.game.bases).filter((base) => base.side === side);
    html = selectField('Formation', 'field-unit', optionList(ownUnits('air'))) + selectField('Destination base', 'field-base', optionList(bases));
  } else if (type === 'naval_move') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('naval'))) + selectField('Destination', 'field-target', optionList(regions));
  } else if (type === 'submarine_patrol') {
    html = selectField('Formation', 'field-unit', optionList(ownUnits('submarine'))) + selectField('Patrol area', 'field-target', optionList(regions));
  } else if (type === 'amphibious_lift') {
    html = selectField('Amphibious group', 'field-unit', optionList(ownUnits('naval', 'amphibious'))) + numberField('Lift points', 'field-amount', 5, .5, 30, .5);
  } else if (type === 'ground_attack') {
    html = numberField('Intensity', 'field-intensity', .5, .25, 1, .25);
  }
  $('dynamic-fields').innerHTML = html;
}

function buildOrder() {
  const type = $('action-type').value;
  const value = (id) => $(id)?.value;
  if (type === 'missile_strike') return { type, target_id: value('field-target'), amount: Number(value('field-amount')) };
  if (type === 'air_mission') return { type, unit_id: value('field-unit'), mission: value('field-mission'), target: value('field-target') };
  if (type === 'rebase') return { type, unit_id: value('field-unit'), base_id: value('field-base') };
  if (type === 'naval_move' || type === 'submarine_patrol') return { type, unit_id: value('field-unit'), target: value('field-target') };
  if (type === 'amphibious_lift') return { type, unit_id: value('field-unit'), amount: Number(value('field-amount')) };
  return { type, intensity: Number(value('field-intensity')) };
}

function describeOrder(order) {
  const names = { missile_strike: 'Missile strike', air_mission: 'Air mission', rebase: 'Rebase', naval_move: 'Naval movement', submarine_patrol: 'Submarine patrol', amphibious_lift: 'Amphibious lift', ground_attack: 'Ground operations' };
  const unit = state.game.units[order.unit_id]?.name || order.unit_id || '';
  const target = state.game.regions[order.target]?.name || state.game.bases[order.target]?.name || state.game.units[order.target_id]?.name || state.game.bases[order.target_id]?.name || order.target || order.target_id || '';
  return `${unit}${unit && target ? ' → ' : ''}${target}${order.mission ? ` · ${order.mission}` : ''}${order.amount ? ` · ${order.amount}` : ''}${order.intensity ? ` · ${order.intensity}` : ''}`;
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
    const hidden = !Number.isFinite(strength);
    const pct = hidden ? 35 : Math.max(0, Math.min(100, strength / unit.max_strength * 100));
    return `<article class="formation ${unit.side.toLowerCase()}"><header><h3>${unit.name}</h3><span class="side ${unit.side}">${unit.side}</span></header><p>${unit.kind.replaceAll('_', ' ')} · ${state.game.regions[unit.region]?.name}</p><div class="strength-line"><i style="width:${pct}%"></i></div><small>${hidden ? 'Strength unknown' : `${strength.toFixed(1)} / ${unit.max_strength.toFixed(1)}`} · readiness ${hidden ? 'unknown' : `${(unit.readiness * 100).toFixed(0)}%`}</small></article>`;
  }).join('');
}

function renderEvents() {
  const events = [...state.game.events].reverse();
  $('event-log').innerHTML = events.length ? events.map((event) => `<div class="event"><time>T${event.turn}</time><b>${event.phase}</b><span>${event.message}</span></div>`).join('') : '<div class="empty">No adjudication events yet.</div>';
}

function showError(error) { $('error-box').textContent = error.message || String(error); $('error-box').hidden = false; }
function clearError() { $('error-box').hidden = true; }

$('action-type').addEventListener('change', renderForm);
$('side-select').addEventListener('change', async () => { state.orders = []; state.game = await api(`/api/state?observer=${$('side-select').value}`); render(); });
$('order-form').addEventListener('submit', (event) => { event.preventDefault(); clearError(); try { const order = buildOrder(); if (!order.unit_id && ['air_mission','rebase','naval_move','submarine_patrol','amphibious_lift'].includes(order.type)) throw new Error('No eligible formation is available.'); state.orders.push(order); renderOrders(); } catch (error) { showError(error); } });
$('clear-orders').addEventListener('click', () => { state.orders = []; renderOrders(); });
$('resolve-turn').addEventListener('click', async () => { clearError(); try { state.game = await api('/api/turn', { method: 'POST', body: JSON.stringify({ side: $('side-select').value, orders: state.orders }) }); state.orders = []; render(); } catch (error) { showError(error); } });
$('agent-turn').addEventListener('click', async () => { clearError(); try { state.game = await api('/api/agent-turn', { method: 'POST', body: '{}' }); state.orders = []; render(); } catch (error) { showError(error); } });
$('autoplay').addEventListener('click', async () => { clearError(); try { state.game = await api('/api/autoplay', { method: 'POST', body: JSON.stringify({ turns: 20 }) }); state.orders = []; render(); } catch (error) { showError(error); } });
$('new-game').addEventListener('click', async () => { const seed = Number(prompt('Random seed for reproducible adjudication:', '7')); if (!Number.isFinite(seed)) return; state.game = await api('/api/new-game', { method: 'POST', body: JSON.stringify({ seed }) }); state.orders = []; render(); });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); state.filter = tab.dataset.filter; renderFormations(); }));

load().catch(showError);

