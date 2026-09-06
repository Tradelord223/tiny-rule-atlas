const WIDTH = 128;
const STEPS = 128;
const PAGE_SIZE = 24;
const SEEDS = ['single', 'pair', 'block', 'alternating', 'period3', 'sparse', 'balanced', 'dense'];
const BOUNDARIES = ['fixed', 'wrap'];
const NAMES = { single: 'Single cell', pair: 'Adjacent pair', block: 'Eight-cell block', alternating: 'Alternating', period3: 'Every third cell', sparse: 'Sparse random', balanced: 'Balanced random', dense: 'Dense random' };
const DESCRIPTIONS = {
  single: 'One live cell at the center of an empty world.',
  pair: 'Two adjacent live cells, at positions 63 and 64.',
  block: 'Eight live cells at the center, positions 60–67.',
  alternating: 'Every even-indexed cell begins alive.',
  period3: 'Every third cell begins alive, starting at cell zero.',
  sparse: 'Fixed xorshift32 sequence; a cell is live if its low byte is below 32.',
  balanced: 'Fixed xorshift32 sequence; a cell is live if its low byte is below 128.',
  dense: 'Fixed xorshift32 sequence; a cell is live if its low byte is below 224.'
};
const $ = (selector) => document.querySelector(selector);
const state = { rule: 30, seed: 'single', boundary: 'wrap' };
let experiments = [];
let byId = new Map();
let catalogReady = false;
let page = 0;
let filtered = [];
let request = null;
let revision = 0;
let sliderTimer = null;
let shareTimer = null;

function seedRow(seed) {
  if (!SEEDS.includes(seed)) throw new RangeError('Unknown starting state');
  const row = new Uint8Array(WIDTH);
  if (seed === 'single') row[64] = 1;
  else if (seed === 'pair') { row[63] = 1; row[64] = 1; }
  else if (seed === 'block') row.fill(1, 60, 68);
  else if (seed === 'alternating' || seed === 'period3') {
    const period = seed === 'alternating' ? 2 : 3;
    for (let x = 0; x < WIDTH; x++) row[x] = Number(x % period === 0);
  } else {
    const threshold = { sparse: 32, balanced: 128, dense: 224 }[seed];
    let random = 0x00C0FFEE;
    for (let x = 0; x < WIDTH; x++) {
      random = (random ^ (random << 13)) >>> 0;
      random = (random ^ (random >>> 17)) >>> 0;
      random = (random ^ (random << 5)) >>> 0;
      row[x] = Number((random & 255) < threshold);
    }
  }
  return row;
}

function simulate(rule, seed, boundary) {
  if (!Number.isInteger(rule) || rule < 0 || rule > 255 || !BOUNDARIES.includes(boundary)) throw new RangeError('Invalid experiment parameters');
  const rows = [seedRow(seed)];
  const wrap = boundary === 'wrap';
  for (let step = 0; step < STEPS; step++) {
    const previous = rows[step];
    const row = new Uint8Array(WIDTH);
    for (let x = 0; x < WIDTH; x++) {
      const left = x > 0 ? previous[x - 1] : wrap ? previous[WIDTH - 1] : 0;
      const right = x < WIDTH - 1 ? previous[x + 1] : wrap ? previous[0] : 0;
      row[x] = (rule >>> (4 * left + 2 * previous[x] + right)) & 1;
    }
    rows.push(row);
  }
  return rows;
}

function decodeRowsHex(hexRows) {
  if (!Array.isArray(hexRows) || hexRows.length !== STEPS + 1 || hexRows.some((row) => !/^[0-9a-f]{32}$/.test(row))) throw new Error('The stored trajectory has an unsupported format.');
  return hexRows.map((hex) => {
    const row = new Uint8Array(WIDTH);
    for (let nibble = 0; nibble < hex.length; nibble++) {
      const value = Number.parseInt(hex[nibble], 16);
      for (let bit = 0; bit < 4; bit++) row[nibble * 4 + bit] = (value >>> (3 - bit)) & 1;
    }
    return row;
  });
}

function draw(canvas, rows) {
  canvas.width = WIDTH;
  canvas.height = rows.length;
  const context = canvas.getContext('2d', { alpha: false });
  const pixels = context.createImageData(WIDTH, rows.length);
  const live = [197, 233, 107];
  const dead = [14, 28, 20];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4;
      const color = rows[y][x] ? live : dead;
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
}

function recordId(parameters = state) {
  return `r${String(parameters.rule).padStart(3, '0')}-${parameters.seed}-${parameters.boundary}`;
}

function fragment(parameters = state) {
  return `#rule=${parameters.rule}&seed=${parameters.seed}&boundary=${parameters.boundary}`;
}

function readHash() {
  if (!location.hash.includes('=')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const ruleValue = params.get('rule');
  const rule = ruleValue !== null && /^\d{1,3}$/.test(ruleValue) ? Number(ruleValue) : 30;
  return {
    rule: rule >= 0 && rule <= 255 ? rule : 30,
    seed: SEEDS.includes(params.get('seed')) ? params.get('seed') : 'single',
    boundary: BOUNDARIES.includes(params.get('boundary')) ? params.get('boundary') : 'wrap'
  };
}

function updateDiagram() {
  const diagram = $('#rule-diagram');
  const blocks = document.createDocumentFragment();
  for (let neighborhood = 7; neighborhood >= 0; neighborhood--) {
    const bits = neighborhood.toString(2).padStart(3, '0');
    const output = (state.rule >>> neighborhood) & 1;
    const block = document.createElement('div');
    block.className = 'neighborhood';
    block.setAttribute('role', 'img');
    block.setAttribute('aria-label', `${bits.split('').join(', ')} becomes ${output}`);
    block.title = `${bits} → ${output}`;
    const top = document.createElement('div');
    top.className = 'neighborhood-cells';
    for (const bit of bits) {
      const cell = document.createElement('i');
      cell.className = `bit-cell${bit === '1' ? ' on' : ''}`;
      top.append(cell);
    }
    const bottom = document.createElement('i');
    bottom.className = `bit-cell next-bit${output ? ' on' : ''}`;
    block.append(top, bottom);
    blocks.append(block);
  }
  diagram.replaceChildren(blocks);
  $('#rule-binary').textContent = state.rule.toString(2).padStart(8, '0');
}

function syncControls() {
  $('#rule-number').value = state.rule;
  $('#rule-range').value = state.rule;
  $('#seed').value = state.seed;
  document.querySelectorAll('input[name="boundary"]').forEach((input) => { input.checked = input.value === state.boundary; });
  $('#seed-description').textContent = DESCRIPTIONS[state.seed];
  $('#boundary-description').textContent = state.boundary === 'wrap' ? 'The right edge connects back to the left.' : 'Outside neighbors are always zero; edge cells still update.';
  $('#observation-id').textContent = `R${String(state.rule).padStart(3, '0')} / ${state.seed.toUpperCase()} / ${state.boundary.toUpperCase()}`;
  $('#previous-rule').disabled = state.rule === 0;
  $('#next-rule').disabled = state.rule === 255;
  $('#share-status').textContent = '';
  updateDiagram();
}

function clearMetrics() {
  document.querySelectorAll('[data-metric]').forEach((element) => {
    element.textContent = element.dataset.metric.startsWith('final_') ? 'Final row: —' : '—';
  });
  $('#cycle-title').textContent = 'Observing recurrence';
  $('#cycle-detail').textContent = 'Checking for an exact repeated state.';
}

function metricValue(key, value, unit) {
  const element = $(`[data-metric="${key}"]`);
  const suffix = document.createElement('small');
  suffix.textContent = unit;
  element.replaceChildren(document.createTextNode(value), suffix);
}

function showMetrics(record) {
  const metrics = record.metrics;
  for (const key of ['density', 'activity', 'mean_damage']) metricValue(key, (100 * metrics[key]).toFixed(1), '%');
  metricValue('entropy_bits', metrics.entropy_bits.toFixed(3), 'bits');
  metricValue('compression_ratio', metrics.compression_ratio.toFixed(3), '×');
  for (const key of ['final_density', 'final_damage']) $(`[data-metric="${key}"]`).textContent = `Final row: ${(100 * metrics[key]).toFixed(1)}%`;
  if (record.cycle) {
    $('#cycle-title').textContent = record.cycle.period === 1 ? 'Fixed point detected' : `Cycle detected · period ${record.cycle.period}`;
    $('#cycle-detail').textContent = `State at generation ${record.cycle.start} repeats at generation ${record.cycle.detected_at}.`;
  } else {
    $('#cycle-title').textContent = 'No cycle observed';
    $('#cycle-detail').textContent = 'No full state repeats within 128 updates. A later cycle is possible.';
  }
}

async function loadSelection() {
  if (!catalogReady) return;
  if (request) request.abort();
  request = new AbortController();
  const signal = request.signal;
  const currentRevision = ++revision;
  const id = recordId();
  const entry = byId.get(id);
  const plotState = $('#plot-state');
  plotState.hidden = false;
  plotState.classList.remove('error');
  plotState.textContent = 'Loading the observation…';
  $('#trajectory').removeAttribute('data-record-id');
  $('#trajectory').setAttribute('aria-busy', 'true');
  $('#record-link').hidden = true;
  clearMetrics();
  document.querySelectorAll('.specimen').forEach((card) => card.setAttribute('aria-current', String(card.dataset.id === id)));
  try {
    if (!entry) throw new Error('This parameter combination is missing from the catalog.');
    if (!/^data\/experiments\/r\d{3}\/r\d{3}-[a-z0-9]+-(fixed|wrap)\.json$/.test(entry.path)) throw new Error('The record path is unsupported.');
    const response = await fetch(entry.path, { signal });
    if (!response.ok) throw new Error(`The stored record could not be loaded (HTTP ${response.status}).`);
    const record = await response.json();
    if (currentRevision !== revision) return;
    if (record.schema_version !== 1 || record.id !== id || record.width !== WIDTH || record.steps !== STEPS) throw new Error('This stored record does not match the expected experiment.');
    const rows = decodeRowsHex(record.rows_hex);
    const metricKeys = ['density', 'final_density', 'activity', 'entropy_bits', 'compression_ratio', 'mean_damage', 'final_damage'];
    if (!record.metrics || metricKeys.some((key) => !Number.isFinite(record.metrics[key]))) throw new Error('This stored record is missing its measurements.');
    draw($('#trajectory'), rows);
    showMetrics(record);
    $('#trajectory').dataset.recordId = record.id;
    $('#trajectory').dataset.trajectorySha256 = record.trajectory_sha256;
    $('#trajectory').setAttribute('aria-label', `Rule ${record.rule}, ${NAMES[record.seed].toLowerCase()}, ${record.boundary} boundary. 128 cells across and 129 generations down. Live cells are lime green. ${record.cycle ? `Cycle period ${record.cycle.period} detected.` : 'No cycle observed within 128 updates.'}`);
    $('#trajectory').setAttribute('aria-busy', 'false');
    $('#plot-caption').textContent = 'Each row is one generation. Time moves down.';
    $('#record-link').href = entry.path;
    $('#record-link').hidden = false;
    plotState.hidden = true;
    document.title = `Rule ${state.rule} · ${NAMES[state.seed]} — Tiny Rule Atlas`;
  } catch (error) {
    if (error.name === 'AbortError' || currentRevision !== revision) return;
    plotState.textContent = `${error.message} Choose another observation or reload to try again.`;
    plotState.classList.add('error');
    $('#trajectory').setAttribute('aria-busy', 'false');
    $('#trajectory').setAttribute('aria-label', 'The selected observation could not be loaded.');
    $('#cycle-title').textContent = 'Observation unavailable';
    $('#cycle-detail').textContent = 'Measurements will appear when the stored record loads.';
  }
}

function select(parameters, { historyMode = 'replace', delay = false } = {}) {
  Object.assign(state, parameters);
  clearTimeout(sliderTimer);
  syncControls();
  const url = `${location.pathname}${location.search}${fragment()}`;
  if (historyMode === 'push') history.pushState(null, '', url);
  else if (historyMode === 'replace') history.replaceState(null, '', url);
  if (delay) {
    if (request) request.abort();
    revision++;
    $('#trajectory').removeAttribute('data-record-id');
    $('#plot-state').hidden = false;
    $('#plot-state').classList.remove('error');
    $('#plot-state').textContent = 'Loading the observation…';
    clearMetrics();
    sliderTimer = setTimeout(loadSelection, 80);
  } else loadSelection();
}

function filterCatalog() {
  if (!catalogReady) return;
  const query = $('#catalog-search').value.trim();
  const seed = $('#catalog-seed').value;
  const boundary = $('#catalog-boundary').value;
  const cycle = $('#catalog-cycle').value;
  const sort = $('#catalog-sort').value;
  const queryRule = /^\d{1,3}$/.test(query) ? Number(query) : -1;
  filtered = experiments.filter((entry) =>
    (!query || entry.rule === queryRule) &&
    (!seed || entry.seed === seed) &&
    (!boundary || entry.boundary === boundary) &&
    (!cycle || (cycle === 'detected' ? entry.cycle !== null : entry.cycle === null))
  );
  if (sort !== 'rule') {
    const key = { activity: 'activity', damage: 'mean_damage', entropy: 'entropy_bits' }[sort];
    filtered.sort((a, b) => b.metrics[key] - a.metrics[key] || a.rule - b.rule);
  }
  page = 0;
  renderCatalog();
}

function createSpecimen(entry) {
  const card = document.createElement('a');
  card.className = 'specimen';
  card.href = fragment(entry);
  card.dataset.id = entry.id;
  card.setAttribute('aria-current', String(entry.id === recordId()));
  card.setAttribute('aria-label', `Open rule ${entry.rule}, ${NAMES[entry.seed]}, ${entry.boundary} boundary, ${entry.cycle ? `cycle period ${entry.cycle.period}` : 'no cycle observed'}`);
  const frame = document.createElement('div');
  frame.className = 'specimen-image';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  draw(canvas, simulate(entry.rule, entry.seed, entry.boundary));
  frame.append(canvas);
  const title = document.createElement('div');
  title.className = 'specimen-title';
  const name = document.createElement('strong');
  name.textContent = `Rule ${String(entry.rule).padStart(3, '0')}`;
  const arrow = document.createElement('span');
  arrow.textContent = '↗';
  arrow.setAttribute('aria-hidden', 'true');
  title.append(name, arrow);
  const subtitle = document.createElement('div');
  subtitle.className = 'specimen-subtitle';
  const parameters = document.createElement('span');
  parameters.textContent = `${entry.seed} / ${entry.boundary}`;
  const behavior = document.createElement('span');
  if (entry.cycle) {
    const dot = document.createElement('i');
    dot.className = 'specimen-cycle';
    dot.setAttribute('aria-hidden', 'true');
    behavior.append(dot, document.createTextNode(`P${entry.cycle.period}`));
    behavior.title = `Exact cycle, period ${entry.cycle.period}`;
  } else {
    behavior.textContent = `${(entry.metrics.activity * 100).toFixed(0)}% active`;
  }
  subtitle.append(parameters, behavior);
  card.append(frame, title, subtitle);
  card.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select({ rule: entry.rule, seed: entry.seed, boundary: entry.boundary }, { historyMode: 'push' });
    $('#explorer').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    $('#explorer').focus({ preventScroll: true });
  });
  return card;
}

function renderCatalog() {
  const count = filtered.length;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const start = page * PAGE_SIZE;
  const entries = filtered.slice(start, start + PAGE_SIZE);
  const cards = document.createDocumentFragment();
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'empty-catalog';
    empty.textContent = 'No observations match these filters. Try a different rule or reset the filters.';
    cards.append(empty);
  } else entries.forEach((entry) => cards.append(createSpecimen(entry)));
  $('#catalog-grid').replaceChildren(cards);
  $('#catalog-summary').textContent = count ? `${(start + 1).toLocaleString()}–${Math.min(start + PAGE_SIZE, count).toLocaleString()} of ${count.toLocaleString()} observations` : '0 matching observations';
  $('#catalog-page').textContent = `Page ${page + 1} of ${pages}`;
  $('#catalog-prev').disabled = page === 0;
  $('#catalog-next').disabled = page >= pages - 1;
}

async function loadCatalog() {
  try {
    const response = await fetch('data/catalog.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    if (catalog.schema_version !== 1 || catalog.width !== WIDTH || catalog.steps !== STEPS || !Array.isArray(catalog.experiments) || catalog.count !== catalog.experiments.length) throw new Error('Unsupported catalog format');
    experiments = catalog.experiments;
    byId = new Map(experiments.map((entry) => [entry.id, entry]));
    catalogReady = true;
    filterCatalog();
    await loadSelection();
  } catch (error) {
    $('#plot-state').textContent = 'The experiment dataset could not be loaded. Reload this page to try again. If you are opening a local copy, serve it over HTTP.';
    $('#plot-state').classList.add('error');
    $('#catalog-summary').textContent = 'The catalog is unavailable.';
    const message = document.createElement('p');
    message.className = 'empty-catalog';
    message.textContent = 'The catalog could not be loaded. Reload the page to try again.';
    $('#catalog-grid').replaceChildren(message);
    $('#cycle-title').textContent = 'Dataset unavailable';
    $('#cycle-detail').textContent = 'Measurements will appear when the dataset loads.';
    console.error('Tiny Rule Atlas:', error.message);
  }
}

$('#rule-number').addEventListener('change', (event) => {
  const value = event.target.value;
  const rule = value !== '' && Number.isFinite(Number(value)) ? Math.max(0, Math.min(255, Math.round(Number(value)))) : state.rule;
  select({ rule });
});
$('#rule-range').addEventListener('input', (event) => select({ rule: Number(event.target.value) }, { delay: true }));
$('#rule-range').addEventListener('change', () => { clearTimeout(sliderTimer); loadSelection(); });
$('#seed').addEventListener('change', (event) => select({ seed: event.target.value }));
document.querySelectorAll('input[name="boundary"]').forEach((input) => input.addEventListener('change', () => select({ boundary: input.value })));
$('#previous-rule').addEventListener('click', () => select({ rule: Math.max(0, state.rule - 1) }));
$('#next-rule').addEventListener('click', () => select({ rule: Math.min(255, state.rule + 1) }));
$('#surprise').addEventListener('click', () => {
  const next = (state.rule + 1 + Math.floor(Math.random() * 255)) % 256;
  select({ rule: next });
});
$('#copy-link').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = fragment();
  clearTimeout(shareTimer);
  try {
    await navigator.clipboard.writeText(url.href);
    $('#share-status').textContent = 'Observation link copied.';
    shareTimer = setTimeout(() => { $('#share-status').textContent = ''; }, 5000);
  } catch {
    // The canonical fragment is already in the address bar, including on HTTP hosts.
    history.replaceState(null, '', `${location.pathname}${location.search}${fragment()}`);
    $('#share-status').textContent = 'Copy the URL from your address bar to share this observation.';
  }
});
$('#catalog-filters').addEventListener('submit', (event) => event.preventDefault());
$('#catalog-search').addEventListener('input', filterCatalog);
document.querySelectorAll('#catalog-filters select').forEach((select) => select.addEventListener('change', filterCatalog));
$('#reset-filters').addEventListener('click', () => { $('#catalog-filters').reset(); filterCatalog(); });
$('#catalog-prev').addEventListener('click', () => { page--; renderCatalog(); });
$('#catalog-next').addEventListener('click', () => { page++; renderCatalog(); });
window.addEventListener('hashchange', () => { const parameters = readHash(); if (parameters) select(parameters, { historyMode: 'none' }); });
window.addEventListener('popstate', () => { const parameters = readHash(); if (parameters && recordId(parameters) !== recordId()) select(parameters, { historyMode: 'none' }); });

// Exposed pure helpers allow independent browser/data parity checks without a build tool.
window.TinyRuleAtlas = Object.freeze({ seedRow, simulate, decodeRowsHex });
const initial = readHash();
if (initial) Object.assign(state, initial);
syncControls();
loadCatalog();
