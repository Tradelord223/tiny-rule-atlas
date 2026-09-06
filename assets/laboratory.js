import {
  SEEDS,
  BOUNDARIES,
  seedRow,
  runExperiment,
  rowsToCSV,
  runTraffic,
  trafficFundamentalDiagram,
} from './lab-core.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SLOT_IDS = ['a', 'b'];
const WIDTHS = [64, 128, 256];
const WINDOWS = [128, 256, 512, 1024];
const VIEWS = ['primary', 'perturbed', 'difference'];
const TRAFFIC_WIDTH = 128;
const TRAFFIC_STEPS = 256;
const DEFAULT_RANDOM_SEED = 0x00c0ffee;
const COLORS = {
  live: [197, 233, 107],
  difference: [241, 177, 127],
  empty: [14, 28, 20],
};
const PRESETS = {
  edges: {
    note: 'Rule 90, identical beginnings, different edges. Look beyond generation 64, when the growing pattern can reach a boundary.',
    a: { rule: 90, seed: 'single', boundary: 'wrap', view: 'primary' },
    b: { rule: 90, seed: 'single', boundary: 'fixed', view: 'primary' },
  },
  entropy: {
    note: 'Rule 204 copies each cell unchanged. Both starts can have high occupancy entropy, yet neither evolves. A balanced image is not evidence of complex dynamics.',
    a: { rule: 204, seed: 'alternating', boundary: 'wrap', view: 'primary' },
    b: { rule: 204, seed: 'balanced', boundary: 'wrap', view: 'primary' },
  },
  perturbation: {
    note: 'Both experiments use the same balanced starting row under Rule 30. A shows the primary trajectory; B highlights only the cells changed by toggling one initial cell. Switch views to inspect either run.',
    a: { rule: 30, seed: 'balanced', boundary: 'wrap', view: 'primary' },
    b: { rule: 30, seed: 'balanced', boundary: 'wrap', view: 'difference' },
  },
  contexts: {
    note: 'Rule 110 with a single cell and a balanced random start. Compare what persists and what collides. These finite experiments do not demonstrate universal computation.',
    a: { rule: 110, seed: 'single', boundary: 'wrap', view: 'primary' },
    b: { rule: 110, seed: 'balanced', boundary: 'wrap', view: 'primary' },
  },
};

function defaultState() {
  return {
    width: 128,
    steps: 256,
    generation: 0,
    preset: 'edges',
    a: { ...PRESETS.edges.a, initial: null },
    b: { ...PRESETS.edges.b, initial: null },
    trafficCount: 64,
    trafficSeed: DEFAULT_RANDOM_SEED,
    trafficGeneration: 0,
  };
}

let state = defaultState();
const results = { a: null, b: null };
const cards = {};
const plotScales = {};
// An unapplied text draft belongs to the editor, not to the rendered run.
// Layout redraws and queued <details> toggle events must never replace it.
const initialDrafts = { a: false, b: false };
let trafficResult = null;
let fundamental = [];
let playing = false;
let playTimer = null;
let resizeTimer = null;
let trafficTimer = null;
let desiredSection = null;
let ready = false;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

function fraction(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function binaryString(row) {
  return Array.from(row).join('');
}

function integer(value, min, max, label) {
  if (String(value).trim() === '' || !Number.isInteger(Number(value))
      || Number(value) < min || Number(value) > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return Number(value);
}

function readLocation() {
  const next = defaultState();
  const raw = location.hash.slice(1);
  desiredSection = raw === 'traffic' || raw === 'comparison' ? raw : null;
  const parameters = new URLSearchParams(raw.includes('=') ? raw : location.search.slice(1));
  if (!parameters.size) return next;
  const preset = parameters.get('preset');
  if (Object.hasOwn(PRESETS, preset)) {
    next.preset = preset;
    for (const id of SLOT_IDS) Object.assign(next[id], PRESETS[preset][id]);
  } else {
    next.preset = null;
  }
  const numberOr = (key, fallback, min, max) => {
    const value = parameters.get(key);
    return value !== null && /^\d+$/.test(value) && Number(value) >= min
      && Number(value) <= max ? Number(value) : fallback;
  };
  const width = numberOr('width', next.width, 64, 256);
  const steps = numberOr('steps', next.steps, 128, 1024);
  next.width = WIDTHS.includes(width) ? width : next.width;
  next.steps = WINDOWS.includes(steps) ? steps : next.steps;
  next.generation = numberOr('generation', 0, 0, next.steps);
  for (const id of SLOT_IDS) {
    next[id].rule = numberOr(`${id}Rule`, next[id].rule, 0, 255);
    for (const [key, allowed] of [['seed', SEEDS], ['boundary', BOUNDARIES], ['view', VIEWS]]) {
      const hashKey = `${id}${key[0].toUpperCase()}${key.slice(1)}`;
      if (allowed.includes(parameters.get(hashKey))) next[id][key] = parameters.get(hashKey);
    }
    const initial = parameters.get(`${id}Initial`);
    if (initial !== null && initial.length === next.width && /^[01]+$/.test(initial)) {
      next[id].initial = Uint8Array.from(initial, Number);
    }
  }
  next.trafficCount = numberOr('trafficCount', 64, 0, TRAFFIC_WIDTH);
  next.trafficSeed = numberOr('trafficSeed', DEFAULT_RANDOM_SEED, 0, 0xffffffff);
  next.trafficGeneration = numberOr('trafficGeneration', 0, 0, TRAFFIC_STEPS);
  if (['traffic', 'comparison'].includes(parameters.get('section'))) {
    desiredSection = parameters.get('section');
  }
  return next;
}

function sessionFragment() {
  const parameters = new URLSearchParams({
    v: '1',
    width: String(state.width),
    steps: String(state.steps),
    generation: String(state.generation),
  });
  if (state.preset) parameters.set('preset', state.preset);
  for (const id of SLOT_IDS) {
    const slot = state[id];
    parameters.set(`${id}Rule`, String(slot.rule));
    parameters.set(`${id}Seed`, slot.seed);
    parameters.set(`${id}Boundary`, slot.boundary);
    parameters.set(`${id}View`, slot.view);
    if (slot.initial) parameters.set(`${id}Initial`, binaryString(slot.initial));
  }
  parameters.set('trafficCount', String(state.trafficCount));
  parameters.set('trafficSeed', String(state.trafficSeed));
  parameters.set('trafficGeneration', String(state.trafficGeneration));
  return `#${parameters}`;
}

function updateLocation() {
  history.replaceState(null, '', `${location.pathname}${location.search}${sessionFragment()}`);
}

function setStatus(message, error = false) {
  $('#lab-status').textContent = message;
  $('#lab-status').classList.toggle('is-error', error);
}

function buildCards() {
  for (const id of SLOT_IDS) {
    const fragment = $('#experiment-template').content.cloneNode(true);
    const card = $('.experiment-card', fragment);
    card.dataset.slot = id;
    card.id = `experiment-${id}`;
    $('.slot-letter', card).textContent = id.toUpperCase();
    $('.experiment-heading h3', card).textContent = `Experiment ${id.toUpperCase()}`;
    for (const field of $$('[data-input]', card)) {
      const key = field.dataset.input;
      field.id = `${id}-${key}`;
      const label = $(`[data-for="${key}"]`, card);
      label.htmlFor = field.id;
      label.textContent = `${label.textContent} ${key === 'initial' ? '' : `· ${id.toUpperCase()}`}`.trim();
    }
    $('.slot-trajectory', card).id = `${id}-trajectory`;
    $('.seed-canvas', card).id = `${id}-initial-row`;
    $('.inspected-row', card).id = `${id}-inspected-row`;
    cards[id] = card;
    $('#experiment-slots').append(fragment);
    for (const key of ['rule', 'seed', 'boundary']) {
      $(`#${id}-${key}`).addEventListener('change', () => {
        if (key === 'seed') {
          state[id].initial = null;
          initialDrafts[id] = false;
        }
        state.preset = null;
        recomputeFromControls();
      });
    }
    $(`#${id}-view`).addEventListener('change', (event) => {
      state[id].view = event.target.value;
      state.preset = null;
      syncPresetButtons();
      renderSlot(id);
      updateInspection();
      updateLocation();
    });
    $('[data-action="apply-initial"]', card).addEventListener('click', () => applyInitialField(id));
    $(`#${id}-initial`).addEventListener('input', () => {
      initialDrafts[id] = true;
      $('.custom-indicator', card).textContent = 'UNAPPLIED DRAFT';
      $('.seed-state', card).textContent = 'Unapplied draft. Choose Apply row to update the experiment.';
    });
    $(`#${id}-initial`).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyInitialField(id);
      }
    });
    $('[data-action="toggle-center"]', card).addEventListener('click', () => toggleInitialCell(id, Math.floor(state.width / 2)));
    $('[data-action="reset-seed"]', card).addEventListener('click', () => {
      state[id].initial = null;
      initialDrafts[id] = false;
      state.preset = null;
      runComparison();
      $('.seed-state', card).textContent = 'Restored the named starting state.';
    });
    $('.seed-canvas', card).addEventListener('click', (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const index = Math.min(state.width - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * state.width)));
      toggleInitialCell(id, index);
    });
    $('.seed-editor', card).addEventListener('toggle', () => renderInitialEditor(id));
  }
}

function syncPresetButtons() {
  $$('[data-preset]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset));
  });
  $('#investigation-note').textContent = state.preset
    ? PRESETS[state.preset].note
    : 'Your comparison. Change one parameter at a time to make its effect easier to identify. Each perturbation always toggles the central cell of that experiment’s initial row.';
}

function syncControls() {
  $('#lab-width').value = String(state.width);
  $('#lab-steps').value = String(state.steps);
  for (const id of SLOT_IDS) {
    for (const key of ['rule', 'seed', 'boundary', 'view']) {
      $(`#${id}-${key}`).value = String(state[id][key]);
    }
    $('.slot-boundary-help', cards[id]).textContent = state[id].boundary === 'wrap'
      ? 'The right edge connects to the left: a finite ring.'
      : 'Outside neighbors are always zero; the edge cells still update.';
  }
  syncPresetButtons();
}

function initialFor(id) {
  return state[id].initial ? state[id].initial.slice() : seedRow(state[id].seed, state.width);
}

function parseInitialField(id) {
  const raw = $(`#${id}-initial`).value.trim();
  const row = new Uint8Array(state.width);
  if (raw) {
    for (const token of raw.split(',')) {
      const trimmed = token.trim();
      if (!/^\d+$/.test(trimmed)) throw new Error('Use comma-separated whole cell indices, such as 4, 5, 12.');
      const index = integer(trimmed, 0, state.width - 1, 'Each live cell index');
      row[index] = 1;
    }
  }
  return row;
}

function applyInitialField(id) {
  try {
    const row = parseInitialField(id);
    state[id].initial = row;
    initialDrafts[id] = false;
    state.preset = null;
    runComparison();
    $('.seed-state', cards[id]).textContent = `Custom row applied: ${row.reduce((sum, bit) => sum + bit, 0)} live cells.`;
  } catch (error) {
    $('.seed-state', cards[id]).textContent = error.message;
    $(`#${id}-initial`).focus();
  }
}

function toggleInitialCell(id, index) {
  try {
    const row = initialDrafts[id] ? parseInitialField(id) : initialFor(id);
    row[index] ^= 1;
    state[id].initial = row;
    initialDrafts[id] = false;
    state.preset = null;
    runComparison();
    $('.seed-state', cards[id]).textContent = `Cell ${index} is now ${row[index] ? 'live' : 'empty'}. The custom row is included in the session link.`;
  } catch (error) {
    $('.seed-state', cards[id]).textContent = error.message;
    $(`#${id}-initial`).focus();
  }
}

function recomputeFromControls() {
  try {
    const width = Number($('#lab-width').value);
    const steps = Number($('#lab-steps').value);
    if (!WIDTHS.includes(width) || !WINDOWS.includes(steps)) throw new Error('Choose one of the available world sizes and observation windows.');
    const nextSlots = {};
    for (const id of SLOT_IDS) {
      const rule = integer($(`#${id}-rule`).value, 0, 255, `Rule ${id.toUpperCase()}`);
      const seed = $(`#${id}-seed`).value;
      const boundary = $(`#${id}-boundary`).value;
      if (!SEEDS.includes(seed) || !BOUNDARIES.includes(boundary)) throw new Error('Choose a listed starting state and boundary.');
      let initial = state[id].initial;
      if (initial && width !== state.width) {
        const resized = new Uint8Array(width);
        resized.set(initial.subarray(0, width));
        initial = resized;
      }
      nextSlots[id] = { ...state[id], rule, seed, boundary, initial };
    }
    const resizedCustom = width !== state.width && SLOT_IDS.some((id) => state[id].initial);
    Object.assign(state, nextSlots, { width, steps });
    state.generation = Math.min(state.generation, steps);
    runComparison();
    if (resizedCustom) setStatus('Computed both worlds. Custom rows keep their leftmost cells; wider worlds add empty cells on the right.');
  } catch (error) {
    setStatus(`${error.message} The plots still show the last completed run.`, true);
  }
}

function runComparison() {
  pausePlayback();
  try {
    const computed = {};
    for (const id of SLOT_IDS) {
      computed[id] = runExperiment({
        rule: state[id].rule,
        seed: state[id].seed,
        boundary: state[id].boundary,
        width: state.width,
        steps: state.steps,
        initial: state[id].initial,
        perturbIndex: Math.floor(state.width / 2),
      });
    }
    Object.assign(results, computed);
    syncControls();
    for (const id of SLOT_IDS) renderSlot(id);
    buildDamageTable();
    updateInspection();
    updateLocation();
    setStatus(`Computed A and B · ${state.width} cells · ${state.steps.toLocaleString()} updates + the initial row · center perturbation at cell ${Math.floor(state.width / 2)}.`);
  } catch (error) {
    setStatus(`The experiment could not be computed: ${error.message}`, true);
    console.error('Laboratory calculation:', error);
  }
}

function selectedRows(id) {
  const key = { primary: 'rows', perturbed: 'perturbed_rows', difference: 'difference_rows' }[state[id].view];
  return results[id][key];
}

function pixelSource(rows, different = false) {
  const source = document.createElement('canvas');
  source.width = rows[0].length;
  source.height = rows.length;
  const context = source.getContext('2d', { alpha: false });
  const pixels = context.createImageData(source.width, source.height);
  const active = different ? COLORS.difference : COLORS.live;
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      const color = rows[y][x] ? active : COLORS.empty;
      const index = (y * source.width + x) * 4;
      pixels.data[index] = color[0];
      pixels.data[index + 1] = color[1];
      pixels.data[index + 2] = color[2];
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return source;
}

function drawHistory(canvas, rows, frame, different = false) {
  const width = rows[0].length;
  // Integer scaling keeps every simulated cell distinct, including long runs.
  // A scrollable history avoids silently dropping generations to fit a thumbnail.
  const cellSize = Math.max(1, Math.min(4, Math.floor(frame.clientWidth / width)));
  const pixelRatio = Math.max(1, Math.min(3, Math.ceil(devicePixelRatio || 1)));
  const physicalCell = cellSize * pixelRatio;
  canvas.width = width * physicalCell;
  canvas.height = rows.length * physicalCell;
  canvas.style.width = `${width * cellSize}px`;
  canvas.style.height = `${rows.length * cellSize}px`;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = false;
  const source = pixelSource(rows, different);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return cellSize;
}

function drawStrip(canvas, row, different = false) {
  const scale = 8;
  canvas.width = row.length * scale;
  canvas.height = 32;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = false;
  context.drawImage(pixelSource([row], different), 0, 0, canvas.width, canvas.height);
}

function renderRuleDiagram(id) {
  const rule = state[id].rule;
  const diagram = $('.slot-rule-diagram', cards[id]);
  const fragment = document.createDocumentFragment();
  for (let neighborhood = 7; neighborhood >= 0; neighborhood -= 1) {
    const bits = neighborhood.toString(2).padStart(3, '0');
    const output = (rule >>> neighborhood) & 1;
    const item = document.createElement('div');
    item.className = 'lab-neighborhood';
    item.setAttribute('role', 'img');
    item.setAttribute('aria-label', `${bits.split('').join(', ')} becomes ${output}`);
    item.title = `${bits} → ${output}`;
    const upper = document.createElement('span');
    for (const bit of bits) {
      const cell = document.createElement('i');
      cell.className = bit === '1' ? 'on' : '';
      upper.append(cell);
    }
    const lower = document.createElement('i');
    lower.className = output ? 'on' : '';
    item.append(upper, lower);
    fragment.append(item);
  }
  diagram.replaceChildren(fragment);
  $('.rule-bits', cards[id]).textContent = rule.toString(2).padStart(8, '0');
}

function renderInitialEditor(id) {
  const row = initialFor(id);
  const card = cards[id];
  drawStrip($('.seed-canvas', card), row);
  if (!initialDrafts[id]) {
    $(`#${id}-initial`).value = Array.from(row, (bit, index) => bit ? index : null).filter((index) => index !== null).join(', ');
  }
  $('.custom-indicator', card).textContent = initialDrafts[id]
    ? 'UNAPPLIED DRAFT' : state[id].initial ? 'CUSTOM' : '';
  $(`[data-for="initial"]`, card).textContent = `Live cell indices · 0 through ${state.width - 1}`;
  $('.seed-canvas', card).setAttribute('aria-label', `Experiment ${id.toUpperCase()} initial row: ${row.reduce((sum, bit) => sum + bit, 0)} live cells of ${state.width}. Edit using the live cell indices field below.`);
}

function renderSlot(id) {
  if (!results[id]) return;
  const card = cards[id];
  const slot = state[id];
  const result = results[id];
  const rows = selectedRows(id);
  const isDifference = slot.view === 'difference';
  renderRuleDiagram(id);
  renderInitialEditor(id);
  const canvas = $('.slot-trajectory', card);
  plotScales[id] = drawHistory(canvas, rows, $('.slot-plot-frame', card), isDifference);
  canvas.setAttribute('aria-label', `Experiment ${id.toUpperCase()}, Rule ${slot.rule}, ${slot.initial ? 'custom starting row' : slot.seed}, ${slot.boundary} boundary. ${slot.view} trajectory: ${state.width} cells across, generations 0 through ${state.steps} down. ${isDifference ? 'Orange marks disagreement; dark marks agreement.' : 'Lime marks live cells; dark marks empty cells.'}`);
  $('.slot-plot-id', card).textContent = `R${String(slot.rule).padStart(3, '0')} / ${slot.initial ? 'CUSTOM' : slot.seed.toUpperCase()} / ${slot.boundary.toUpperCase()}`;
  $('.legend-active', card).style.backgroundColor = isDifference ? 'var(--lab-orange)' : 'var(--green)';
  $('.active-label', card).textContent = isDifference ? 'Different · XOR 1' : 'Live cell · 1';
  $('.empty-label', card).textContent = isDifference ? 'Same · XOR 0' : 'Empty cell · 0';
  for (const key of ['density', 'activity', 'mean_damage', 'entropy_bits']) {
    const element = $(`[data-metric="${key}"]`, card);
    const suffix = document.createElement('small');
    const entropy = key === 'entropy_bits';
    suffix.textContent = entropy ? 'bits' : '%';
    const value = entropy ? result.metrics[key].toFixed(3) : (result.metrics[key] * 100).toFixed(1);
    element.replaceChildren(document.createTextNode(value), suffix);
  }
  const cycle = $('.slot-cycle p', card);
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  if (result.cycle) {
    title.textContent = result.cycle.period === 1 ? 'Exact fixed point detected' : `Exact cycle · period ${result.cycle.period}`;
    detail.textContent = `Primary state ${result.cycle.start} repeats at generation ${result.cycle.detected_at}.`;
  } else {
    title.textContent = 'No cycle observed in the primary run';
    detail.textContent = `No complete state repeats within ${state.steps} updates. A later cycle is still possible.`;
  }
  cycle.replaceChildren(title, detail);
}

function updateInspection({ reveal = false } = {}) {
  $('#generation').max = String(state.steps);
  $('#generation').value = String(state.generation);
  $('#generation-output').value = String(state.generation);
  $('#generation-range').textContent = `${state.generation} / ${state.steps}`;
  $('#previous-generation').disabled = state.generation === 0;
  $('#next-generation').disabled = state.generation === state.steps;
  for (const id of SLOT_IDS) {
    if (!results[id]) continue;
    const card = cards[id];
    const row = selectedRows(id)[state.generation];
    const count = row.reduce((sum, bit) => sum + bit, 0);
    const isDifference = state[id].view === 'difference';
    const description = isDifference ? `${count} of ${state.width} cells differ` : `${count} of ${state.width} cells are live`;
    $('.inspected-row-label', card).textContent = `GEN ${String(state.generation).padStart(4, '0')} / ${state[id].view.toUpperCase()}`;
    drawStrip($('.inspected-row', card), row, isDifference);
    $('.inspected-row', card).setAttribute('aria-label', `Experiment ${id.toUpperCase()}, generation ${state.generation}: ${description}.`);
    $('.inspected-row-summary', card).textContent = `${description} · ${fraction(count / state.width)}.`;
    const top = state.generation * plotScales[id];
    $('.generation-marker', card).style.top = `${top}px`;
    if (reveal) {
      const frame = $('.slot-plot-frame', card);
      if (top < frame.scrollTop + 10 || top > frame.scrollTop + frame.clientHeight - 20) {
        frame.scrollTop = Math.max(0, top - frame.clientHeight / 2);
      }
    }
  }
  renderDamageChart();
  if (results.a && results.b) {
    const aDamage = results.a.series.damage[state.generation];
    const bDamage = results.b.series.damage[state.generation];
    const finalA = results.a.series.damage[state.steps];
    const finalB = results.b.series.damage[state.steps];
    $('#damage-summary').textContent = `At generation ${state.generation}, A differs in ${fraction(aDamage)} of cells and B in ${fraction(bDamage)}. At the final generation, the differences are ${fraction(finalA)} and ${fraction(finalB)}. The two curves describe separate within-experiment perturbations, not the difference between A and B.`;
  }
}

function setGeneration(value) {
  state.generation = Math.max(0, Math.min(state.steps, Math.round(value)));
  updateInspection({ reveal: true });
  if (!playing) updateLocation();
}

function pausePlayback() {
  playing = false;
  clearTimeout(playTimer);
  playTimer = null;
  $('#play-generations').setAttribute('aria-pressed', 'false');
  $('#play-generations').textContent = 'Play ▷';
}

function playNext() {
  if (!playing) return;
  if (state.generation >= state.steps) {
    pausePlayback();
    updateLocation();
    return;
  }
  setGeneration(state.generation + 1);
  playTimer = setTimeout(playNext, motionPreference.matches ? 550 : 130);
}

function togglePlayback() {
  if (playing) {
    pausePlayback();
    updateLocation();
    return;
  }
  if (state.generation === state.steps) setGeneration(0);
  playing = true;
  $('#play-generations').setAttribute('aria-pressed', 'true');
  $('#play-generations').textContent = 'Pause Ⅱ';
  playTimer = setTimeout(playNext, motionPreference.matches ? 550 : 130);
}

function setupChart(canvas, { maxX, maxY, xTitle, yTitle, xLabel, yLabel }) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(240, bounds.width);
  const height = Math.max(180, bounds.height);
  const ratio = Math.min(3, devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const inset = { left: 48, right: 19, top: 25, bottom: 45 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const x = (value) => inset.left + value / maxX * plotWidth;
  const y = (value) => inset.top + (1 - value / maxY) * plotHeight;
  context.font = '11px Arial, Helvetica, sans-serif';
  for (let step = 0; step <= 4; step += 1) {
    const value = step * maxY / 4;
    const lineY = y(value);
    context.strokeStyle = '#d5d9cb';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(inset.left, lineY);
    context.lineTo(width - inset.right, lineY);
    context.stroke();
    context.fillStyle = '#4a5946';
    context.textAlign = 'right';
    context.fillText(yLabel(value), inset.left - 9, lineY + 4);
    context.textAlign = 'center';
    context.fillText(xLabel(step * maxX / 4), x(step * maxX / 4), height - 24);
  }
  context.fillStyle = '#35422f';
  context.textAlign = 'left';
  context.fillText(yTitle, inset.left, 12);
  context.textAlign = 'center';
  context.fillText(xTitle, inset.left + plotWidth / 2, height - 5);
  return { context, x, y, width, height, inset };
}

function plotLine(chart, points, color, dash = [], lineWidth = 2) {
  const { context, x, y } = chart;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  context.beginPath();
  points.forEach(([a, b], index) => {
    if (index === 0) context.moveTo(x(a), y(b));
    else context.lineTo(x(a), y(b));
  });
  context.stroke();
  context.setLineDash([]);
}

function renderDamageChart() {
  if (!results.a || !results.b) return;
  const chart = setupChart($('#damage-chart'), {
    maxX: state.steps,
    maxY: 1,
    xTitle: 'Generation',
    yTitle: 'Cells differing (%)',
    xLabel: (value) => String(value),
    yLabel: (value) => String(Math.round(value * 100)),
  });
  plotLine(chart, results.a.series.damage.map((value, index) => [index, value]), '#3c6527', [], 3);
  plotLine(chart, results.b.series.damage.map((value, index) => [index, value]), '#74527d', [5, 4], 2);
  const { context, x, y } = chart;
  context.strokeStyle = '#77806f';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x(state.generation), y(0));
  context.lineTo(x(state.generation), y(1));
  context.stroke();
  for (const id of SLOT_IDS) {
    context.fillStyle = id === 'a' ? '#3c6527' : '#74527d';
    context.beginPath();
    context.arc(x(state.generation), y(results[id].series.damage[state.generation]), 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

function buildDamageTable() {
  const fragment = document.createDocumentFragment();
  for (let generation = 0; generation <= state.steps; generation += 1) {
    const row = document.createElement('tr');
    const values = [generation, (results.a.series.damage[generation] * 100).toFixed(3), (results.b.series.damage[generation] * 100).toFixed(3)];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    fragment.append(row);
  }
  $('#damage-table').replaceChildren(fragment);
}

function renderTraffic({ recompute = true } = {}) {
  try {
    if (recompute || !trafficResult) {
      trafficResult = runTraffic({
        count: state.trafficCount,
        width: TRAFFIC_WIDTH,
        steps: TRAFFIC_STEPS,
        randomSeed: state.trafficSeed,
      });
    }
    $('#traffic-density').value = String(state.trafficCount);
    $('#traffic-car-count').value = String(state.trafficCount);
    $('#traffic-density-readout').textContent = `Density: ${trafficResult.density.toFixed(3)} cars per cell (${fraction(trafficResult.density)} occupied)`;
    $('#traffic-observed').textContent = trafficResult.late_flow.toFixed(3);
    $('#traffic-theoretical').textContent = trafficResult.theoretical_flow.toFixed(3);
    const conserved = trafficResult.rows.every((row) => row.reduce((sum, bit) => sum + bit, 0) === state.trafficCount);
    $('#traffic-conserved').textContent = conserved ? `${state.trafficCount} / ${state.trafficCount} ✓` : 'Conservation failed';
    drawHistory($('#traffic-history'), trafficResult.rows, $('.traffic-history-frame'));
    $('#traffic-history').setAttribute('aria-label', `Computed Rule 184 traffic history with exactly ${state.trafficCount} cars on 128 cells, generations 0 through 256. Time moves down and cars move right. Lime cells are cars; dark cells are empty road.`);
    if (state.trafficCount === 0) {
      $('#traffic-insight').textContent = 'An empty road has plenty of space and no traffic. With no cars to move, the flow is exactly zero.';
    } else if (state.trafficCount === TRAFFIC_WIDTH) {
      $('#traffic-insight').textContent = 'Every cell contains a car, so every destination is occupied. The ring is stationary and its flow is exactly zero.';
    } else if (state.trafficCount < TRAFFIC_WIDTH / 2) {
      $('#traffic-insight').textContent = 'Below half occupancy, cars are the limiting resource. Initial clusters can dissolve until cars have room to move on every update. Inspect the early rows to see the transient settle.';
    } else if (state.trafficCount === TRAFFIC_WIDTH / 2) {
      $('#traffic-insight').textContent = 'At half occupancy, an alternating car–space pattern allows all 64 cars to move together. The long-run flow reaches 0.5 car moves per road cell per update: the peak of this idealized model.';
    } else {
      $('#traffic-insight').textContent = 'Above half occupancy, vacant cells are the limiting resource. Follow the dark gaps: as cars move right into them, the gaps move left through the crowded ring. Adding cars now reduces the long-run flow.';
    }
    updateTrafficInspection();
    renderTrafficChart();
  } catch (error) {
    $('#traffic-insight').textContent = `The traffic run could not be computed: ${error.message}`;
    console.error('Traffic calculation:', error);
  }
}

function updateTrafficInspection() {
  if (!trafficResult) return;
  $('#traffic-generation').value = String(state.trafficGeneration);
  $('#traffic-generation-output').value = String(state.trafficGeneration);
  const row = trafficResult.rows[state.trafficGeneration];
  drawStrip($('#traffic-strip'), row);
  let canMove = 0;
  for (let index = 0; index < TRAFFIC_WIDTH; index += 1) {
    if (row[index] && !row[(index + 1) % TRAFFIC_WIDTH]) canMove += 1;
  }
  const observed = state.trafficGeneration === 0
    ? 'No update has occurred at generation 0.'
    : `Flow during the update into this row: ${trafficResult.flow[state.trafficGeneration].toFixed(3)}.`;
  $('#traffic-snapshot-description').textContent = `${state.trafficCount} cars; ${canMove} can move on the next update. ${observed} The strip’s right edge connects to its left.`;
  $('#traffic-strip').setAttribute('aria-label', `Traffic ring at generation ${state.trafficGeneration}: ${state.trafficCount} cars and ${TRAFFIC_WIDTH - state.trafficCount} empty cells. ${canMove} cars can move next.`);
}

function calculateFundamental() {
  fundamental = trafficFundamentalDiagram({ width: TRAFFIC_WIDTH, steps: TRAFFIC_STEPS });
  const fragment = document.createDocumentFragment();
  for (const sample of fundamental) {
    const row = document.createElement('tr');
    for (const value of [sample.count, sample.density.toFixed(6), sample.observed_flow.toFixed(6), sample.theoretical_flow.toFixed(6)]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    fragment.append(row);
  }
  $('#traffic-table').replaceChildren(fragment);
  renderTrafficChart();
}

function renderTrafficChart() {
  if (!fundamental.length || !trafficResult) return;
  const chart = setupChart($('#traffic-chart'), {
    maxX: 1,
    maxY: .5,
    xTitle: 'Density · cars per cell',
    yTitle: 'Flow · moves / cell / update',
    xLabel: (value) => value.toFixed(2),
    yLabel: (value) => value.toFixed(2),
  });
  plotLine(chart, fundamental.map((sample) => [sample.density, sample.observed_flow]), '#3c6527', [], 3.5);
  plotLine(chart, fundamental.map((sample) => [sample.density, sample.theoretical_flow]), '#74527d', [6, 5], 1.5);
  const { context, x, y } = chart;
  context.fillStyle = '#f5f3eb';
  context.strokeStyle = '#17231f';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x(trafficResult.density), y(trafficResult.late_flow), 5.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  const error = Math.max(...fundamental.map((sample) => Math.abs(sample.observed_flow - sample.theoretical_flow)));
  $('#traffic-chart-summary').textContent = `129 computed densities. Maximum observed–reference difference: ${error.toFixed(6)}. Selected ring: density ${trafficResult.density.toFixed(3)}, observed late flow ${trafficResult.late_flow.toFixed(3)}. The sweep uses one fixed shuffle seed for every count; the circle follows your selected arrangement. The reference is the long-run relation, while observations cover updates 129–256.`;
}

function makeSession() {
  const slots = {};
  for (const id of SLOT_IDS) {
    const result = results[id];
    if (!result) throw new Error('Compute both experiments before exporting.');
    slots[id] = {
      parameters: {
        rule: result.rule,
        seed: result.seed,
        boundary: result.boundary,
        width: result.width,
        steps: result.steps,
        custom_initial: Boolean(state[id].initial),
        initial_row: binaryString(result.rows[0]),
        perturb_index: Math.floor(result.width / 2),
      },
      selected_view: state[id].view,
      rows: result.rows.map(binaryString),
      perturbed_rows: result.perturbed_rows.map(binaryString),
      difference_rows: result.difference_rows.map(binaryString),
      metrics: { ...result.metrics },
      series: result.series,
      cycle: result.cycle,
    };
  }
  return {
    schema_version: 1,
    project: 'Tiny Rule Atlas / Laboratory',
    exported_at: new Date().toISOString(),
    session_url: `${location.origin}${location.pathname}${sessionFragment()}`,
    encoding: 'Each trajectory row is a binary string, leftmost cell first; row 0 is the initial state.',
    measurement_notes: {
      density: 'Fraction live; aggregate density averages all rows including generation 0.',
      activity: 'Fraction changing from previous row; aggregate excludes generation 0. series.activity[0] is 0 by convention.',
      damage: 'Fraction unequal to a run with the central initial cell toggled; aggregate includes generation 0.',
      entropy_bits: 'Binary Shannon entropy of aggregate live/dead balance; not algorithmic complexity.',
      traffic_flow: 'Car moves per road cell per update. flow[0] is 0 by convention; flow[g] describes the update into row g.',
    },
    inspected_generation: state.generation,
    experiments: slots,
    traffic: trafficResult ? {
      parameters: { rule: 184, boundary: 'wrap', width: TRAFFIC_WIDTH, steps: TRAFFIC_STEPS, count: state.trafficCount, randomSeed: state.trafficSeed },
      inspected_generation: state.trafficGeneration,
      initial_row: binaryString(trafficResult.rows[0]),
      rows: trafficResult.rows.map(binaryString),
      density: trafficResult.density,
      flow: trafficResult.flow,
      mean_flow: trafficResult.mean_flow,
      late_flow: trafficResult.late_flow,
      late_window: [129, 256],
      theoretical_flow: trafficResult.theoretical_flow,
      fundamental_diagram: fundamental,
      fundamental_random_seed: DEFAULT_RANDOM_SEED,
    } : null,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportFilename(id, extension) {
  return `tiny-rule-atlas-${id}-r${String(state[id].rule).padStart(3, '0')}-${state[id].initial ? 'custom' : state[id].seed}-${state[id].boundary}-${state.width}x${state.steps}.${extension}`;
}

async function exportPNG() {
  const button = $('#export-png');
  button.disabled = true;
  try {
    const id = $('#export-slot').value;
    if (!results[id]) throw new Error('Run a comparison first.');
    const scale = integer($('#export-scale').value, 1, 12, 'Pixel scale');
    const rows = selectedRows(id);
    const selectedView = state[id].view;
    const filename = exportFilename(id, 'png').replace('.png', `-${selectedView}.png`);
    const canvas = document.createElement('canvas');
    canvas.width = state.width * scale;
    canvas.height = rows.length * scale;
    if (canvas.width * canvas.height > 32000000) throw new Error('This export exceeds 32 million pixels. Choose an 8-pixel or 4-pixel cell size.');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser could not allocate the export canvas. Choose a smaller cell size.');
    context.imageSmoothingEnabled = false;
    context.drawImage(pixelSource(rows, selectedView === 'difference'), 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The PNG could not be encoded. Try a smaller cell size.')), 'image/png'));
    downloadBlob(blob, filename);
    $('#export-status').textContent = `PNG downloaded: experiment ${id.toUpperCase()}, ${selectedView} view, ${canvas.width} × ${canvas.height} pixels. Every cell is ${scale} × ${scale} pixels.`;
  } catch (error) {
    $('#export-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function copySessionLink() {
  updateLocation();
  try {
    await navigator.clipboard.writeText(location.href);
    $('#export-status').textContent = 'Session link copied, including both starting rows, views, the inspected generation, and the traffic arrangement.';
  } catch {
    $('#export-status').textContent = 'Your full session is in the address bar. Copy that URL to share it; this browser did not allow clipboard access.';
  }
}

function applyPreset(name) {
  if (!Object.hasOwn(PRESETS, name)) return;
  state.preset = name;
  state.width = 128;
  state.steps = 256;
  state.generation = 0;
  for (const id of SLOT_IDS) {
    state[id] = { ...PRESETS[name][id], initial: null };
    initialDrafts[id] = false;
  }
  runComparison();
}

function wireEvents() {
  $('#comparison-settings').addEventListener('submit', (event) => {
    event.preventDefault();
    recomputeFromControls();
  });
  for (const id of ['lab-width', 'lab-steps']) {
    $(`#${id}`).addEventListener('change', () => {
      state.preset = null;
      recomputeFromControls();
    });
  }
  $$('[data-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('#generation').addEventListener('input', (event) => {
    pausePlayback();
    setGeneration(Number(event.target.value));
  });
  $('#previous-generation').addEventListener('click', () => { pausePlayback(); setGeneration(state.generation - 1); });
  $('#next-generation').addEventListener('click', () => { pausePlayback(); setGeneration(state.generation + 1); });
  $('#play-generations').addEventListener('click', togglePlayback);
  $('#damage-chart').addEventListener('click', (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pausePlayback();
    setGeneration((event.clientX - bounds.left - 48) / (bounds.width - 67) * state.steps);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) { pausePlayback(); updateLocation(); }
  });
  motionPreference.addEventListener('change', () => {
    if (playing) { pausePlayback(); updateLocation(); }
  });
  $('#traffic-density').addEventListener('input', (event) => {
    state.trafficCount = Number(event.target.value);
    $('#traffic-car-count').value = String(state.trafficCount);
    clearTimeout(trafficTimer);
    trafficTimer = setTimeout(() => { renderTraffic(); updateLocation(); }, 80);
  });
  $('#traffic-density').addEventListener('change', () => {
    clearTimeout(trafficTimer);
    renderTraffic();
    updateLocation();
  });
  $$('[data-traffic-count]').forEach((button) => button.addEventListener('click', () => {
    state.trafficCount = Number(button.dataset.trafficCount);
    renderTraffic();
    updateLocation();
  }));
  $('#traffic-shuffle').addEventListener('click', () => {
    state.trafficSeed = (state.trafficSeed + 0x9e3779b9) >>> 0;
    renderTraffic();
    updateLocation();
  });
  $('#traffic-generation').addEventListener('input', (event) => {
    state.trafficGeneration = Number(event.target.value);
    updateTrafficInspection();
    const frame = $('.traffic-history-frame');
    const canvas = $('#traffic-history');
    const rowHeight = Number.parseFloat(canvas.style.height) / trafficResult.rows.length;
    frame.scrollTop = Math.max(0, state.trafficGeneration * rowHeight - frame.clientHeight / 2);
    updateLocation();
  });
  $('#export-png').addEventListener('click', exportPNG);
  $('#export-csv').addEventListener('click', () => {
    try {
      const id = $('#export-slot').value;
      downloadBlob(new Blob([rowsToCSV(results[id])], { type: 'text/csv;charset=utf-8' }), exportFilename(id, 'csv'));
      $('#export-status').textContent = `Experiment ${id.toUpperCase()} CSV downloaded: ${state.steps + 1} generations, with density, activity, and difference as fractions from 0 to 1.`;
    } catch (error) { $('#export-status').textContent = error.message; }
  });
  $('#export-json').addEventListener('click', () => {
    try {
      const session = makeSession();
      downloadBlob(new Blob([`${JSON.stringify(session, null, 2)}\n`], { type: 'application/json' }), 'tiny-rule-atlas-session.json');
      $('#export-status').textContent = 'Full session JSON downloaded, with exact binary rows, parameters, metrics, generation series, and traffic evidence.';
    } catch (error) { $('#export-status').textContent = error.message; }
  });
  $('#share-session').addEventListener('click', copySessionLink);
  $('#export-traffic').addEventListener('click', () => {
    if (!fundamental.length) return;
    const lines = ['car_count,density,observed_late_flow,theoretical_flow'];
    fundamental.forEach((sample) => lines.push([sample.count, sample.density.toFixed(8), sample.observed_flow.toFixed(8), sample.theoretical_flow.toFixed(8)].join(',')));
    downloadBlob(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }), 'tiny-rule-atlas-rule184-flow-density.csv');
    $('#traffic-export-status').textContent = 'Downloaded all 129 densities. Observed values average updates 129–256.';
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!ready) return;
      for (const id of SLOT_IDS) renderSlot(id);
      updateInspection();
      renderTraffic({ recompute: false });
    }, 150);
  });
  window.addEventListener('hashchange', () => {
    const fragment = location.hash.slice(1);
    if (!fragment.includes('=')) {
      // An in-page anchor is navigation, not a new experimental session.
      desiredSection = document.getElementById(fragment) ? fragment : null;
      updateLocation();
      scrollToRequestedSection();
      return;
    }
    state = readLocation();
    for (const id of SLOT_IDS) initialDrafts[id] = false;
    runComparison();
    renderTraffic();
    scrollToRequestedSection();
  });
}

function scrollToRequestedSection() {
  if (!desiredSection) return;
  const section = document.getElementById(desiredSection);
  desiredSection = null;
  requestAnimationFrame(() => {
    if (section) {
      window.scrollTo({
        top: window.scrollY + section.getBoundingClientRect().top,
        behavior: 'instant',
      });
    }
  });
}

try {
  state = readLocation();
  buildCards();
  wireEvents();
  runComparison();
  renderTraffic();
  calculateFundamental();
  ready = true;
  scrollToRequestedSection();
  window.TinyRuleLaboratory = Object.freeze({ snapshot: makeSession });
} catch (error) {
  setStatus(`The laboratory could not start: ${error.message}. Reload the page to try again.`, true);
  console.error('Laboratory startup:', error);
}
