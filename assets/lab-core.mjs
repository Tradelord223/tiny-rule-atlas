/**
 * Tiny Rule Atlas laboratory: deterministic, dependency-free simulation.
 *
 * Cell zero is the left edge. Elementary-rule neighborhoods are encoded as
 * 4 * left + 2 * center + right. A run includes generation zero, so `steps`
 * updates produce `steps + 1` rows. Inputs are copied, never mutated.
 */

export const WIDTH = 128;
export const SEEDS = Object.freeze([
  'single', 'pair', 'block', 'alternating', 'period3', 'sparse', 'balanced', 'dense',
]);
export const BOUNDARIES = Object.freeze(['fixed', 'wrap']);

const DEFAULT_RANDOM_SEED = 0x00c0ffee;
const ROUND_SCALE = 100000000n;
const roundView = new DataView(new ArrayBuffer(8));

function integerInRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
}

function validateWidth(width) {
  integerInRange(width, 'width', 8, 256);
}

function validateSteps(steps) {
  integerInRange(steps, 'steps', 1, 1024);
}

function binaryRow(initial, width, name = 'initial') {
  const isSequence = Array.isArray(initial)
    || (ArrayBuffer.isView(initial) && !(initial instanceof DataView));
  if (!isSequence || initial.length !== width) {
    throw new TypeError(`${name} must contain exactly ${width} binary cells`);
  }
  for (const cell of initial) {
    if (cell !== 0 && cell !== 1) {
      throw new TypeError(`${name} must contain only numeric 0 or 1 cells`);
    }
  }
  return new Uint8Array(initial);
}

function xorshift32(state) {
  state = (state ^ (state << 13)) >>> 0;
  state = (state ^ (state >>> 17)) >>> 0;
  return (state ^ (state << 5)) >>> 0;
}

/** Reproduce atlas.py's eight canonical seeds at any supported width. */
export function seedRow(seed, width = WIDTH) {
  validateWidth(width);
  if (!SEEDS.includes(seed)) {
    throw new RangeError(`seed must be one of ${SEEDS.join(', ')}`);
  }
  const cells = new Uint8Array(width);
  const center = Math.floor(width / 2);
  if (seed === 'single') cells[center] = 1;
  else if (seed === 'pair') cells.fill(1, center - 1, center + 1);
  else if (seed === 'block') cells.fill(1, center - 4, center + 4);
  else if (seed === 'alternating' || seed === 'period3') {
    const period = seed === 'alternating' ? 2 : 3;
    for (let x = 0; x < width; x += period) cells[x] = 1;
  } else {
    const threshold = { sparse: 32, balanced: 128, dense: 224 }[seed];
    let state = DEFAULT_RANDOM_SEED;
    for (let x = 0; x < width; x += 1) {
      state = xorshift32(state);
      cells[x] = Number((state & 255) < threshold);
    }
  }
  return cells;
}

// Round the actual binary64 value to eight decimal places, ties to even, as
// Python's round(value, 8) does. Math.round(value * 1e8) uses different ties
// and can lose information when multiplication itself rounds near a tie.
function round8(value) {
  if (value === 0) return 0;
  roundView.setFloat64(0, value, false);
  const high = roundView.getUint32(0, false);
  const low = roundView.getUint32(4, false);
  const exponent = (high >>> 20) & 0x7ff;
  let significand = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  if (exponent !== 0) significand |= 1n << 52n;
  const shift = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  let numerator = significand * ROUND_SCALE;
  const denominator = shift < 0 ? 1n << BigInt(-shift) : 1n;
  if (shift >= 0) numerator <<= BigInt(shift);
  let rounded = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator
      || (twiceRemainder === denominator && rounded % 2n === 1n)) {
    rounded += 1n;
  }
  return Number(rounded) / Number(ROUND_SCALE);
}

function updateRow(rule, before, wrap) {
  const width = before.length;
  const after = new Uint8Array(width);
  after[0] = (rule >>> (4 * (wrap ? before[width - 1] : 0)
    + 2 * before[0] + before[1])) & 1;
  for (let x = 1; x < width - 1; x += 1) {
    after[x] = (rule >>> (4 * before[x - 1] + 2 * before[x] + before[x + 1])) & 1;
  }
  after[width - 1] = (rule >>> (4 * before[width - 2]
    + 2 * before[width - 1] + (wrap ? before[0] : 0))) & 1;
  return after;
}

function evolveRows(rule, initial, steps, boundary) {
  const rows = [initial.slice()];
  const seen = new Map([[initial.join(''), 0]]);
  let cycle = null;
  for (let generation = 1; generation <= steps; generation += 1) {
    const row = updateRow(rule, rows[generation - 1], boundary === 'wrap');
    rows.push(row);
    const key = row.join('');
    if (seen.has(key)) {
      const start = seen.get(key);
      const period = generation - start;
      cycle = { start, period, detected_at: generation };
      // A repeated full state makes the remaining finite trajectory exact.
      // Copy every row so editing an exposed row cannot alter another one.
      for (let next = generation + 1; next <= steps; next += 1) {
        rows.push(rows[start + (next - start) % period].slice());
      }
      break;
    }
    seen.set(key, generation);
  }
  return { rows, cycle };
}

/**
 * Run a baseline and a companion whose initial row differs at one cell.
 *
 * A supplied `initial` overrides the named seed. Use seed='custom' to label
 * hand-authored inputs; that label is accepted only with an initial row.
 * Metrics match the Python corpus, rounded to eight decimal places. Series
 * retain the unrounded fraction for each generation. Activity[0] is zero;
 * damage[0] includes the one-cell perturbation. A null cycle means only that
 * no repeated full baseline state appeared within the requested horizon.
 */
export function runExperiment({
  rule,
  seed = 'single',
  boundary = 'wrap',
  width = WIDTH,
  steps = 128,
  initial = null,
  perturbIndex = null,
} = {}) {
  integerInRange(rule, 'rule', 0, 255);
  validateWidth(width);
  validateSteps(steps);
  if (!BOUNDARIES.includes(boundary)) {
    throw new RangeError(`boundary must be one of ${BOUNDARIES.join(', ')}`);
  }
  if (!SEEDS.includes(seed) && seed !== 'custom') {
    throw new RangeError(`seed must be one of ${SEEDS.join(', ')}, custom`);
  }
  if (seed === 'custom' && initial === null) {
    throw new TypeError('seed custom requires an initial binary row');
  }
  const original = initial === null ? seedRow(seed, width) : binaryRow(initial, width);
  const changedIndex = perturbIndex === null ? Math.floor(width / 2) : perturbIndex;
  integerInRange(changedIndex, 'perturbIndex', 0, width - 1);
  const perturbed = original.slice();
  perturbed[changedIndex] ^= 1;

  const { rows, cycle } = evolveRows(rule, original, steps, boundary);
  const paired = evolveRows(rule, perturbed, steps, boundary).rows;
  const differences = [];
  const densitySeries = [];
  const activitySeries = [];
  const damageSeries = [];
  let totalLive = 0;
  let totalActivity = 0;
  let totalDamage = 0;
  for (let generation = 0; generation <= steps; generation += 1) {
    const row = rows[generation];
    const difference = new Uint8Array(width);
    let live = 0;
    let changes = 0;
    let damage = 0;
    for (let x = 0; x < width; x += 1) {
      live += row[x];
      if (generation > 0) changes += row[x] ^ rows[generation - 1][x];
      difference[x] = row[x] ^ paired[generation][x];
      damage += difference[x];
    }
    differences.push(difference);
    densitySeries.push(live / width);
    activitySeries.push(changes / width);
    damageSeries.push(damage / width);
    totalLive += live;
    totalActivity += changes;
    totalDamage += damage;
  }
  const density = totalLive / (width * rows.length);
  const entropy = density > 0 && density < 1
    ? -density * Math.log2(density) - (1 - density) * Math.log2(1 - density)
    : 0;
  return {
    rule,
    seed,
    boundary,
    width,
    steps,
    rows,
    perturbed_rows: paired,
    difference_rows: differences,
    metrics: {
      density: round8(density),
      final_density: round8(densitySeries[steps]),
      activity: round8(totalActivity / (width * steps)),
      entropy_bits: round8(entropy),
      mean_damage: round8(totalDamage / (width * rows.length)),
      final_damage: round8(damageSeries[steps]),
    },
    series: { density: densitySeries, activity: activitySeries, damage: damageSeries },
    cycle,
  };
}

/** Concatenate row bytes, leftmost cell first; pad each row's low bits with 0. */
export function packRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('rows must be a nonempty array of binary rows');
  }
  const width = rows[0]?.length;
  if (!Number.isInteger(width) || width < 1 || width > 256) {
    throw new RangeError('row width must be an integer from 1 through 256');
  }
  const byteWidth = Math.ceil(width / 8);
  const packed = new Uint8Array(rows.length * byteWidth);
  for (let generation = 0; generation < rows.length; generation += 1) {
    const row = binaryRow(rows[generation], width, `rows[${generation}]`);
    for (let x = 0; x < width; x += 1) {
      packed[generation * byteWidth + Math.floor(x / 8)] |= row[x] << (7 - x % 8);
    }
  }
  return packed;
}

/** Export aligned generation measurements, including generation zero. */
export function rowsToCSV(result) {
  const series = result?.series;
  const rowCount = result?.rows?.length;
  if (!Number.isInteger(rowCount) || rowCount < 2 || !series) {
    throw new TypeError('result must be a runExperiment result with generation series');
  }
  for (const name of ['density', 'activity', 'damage']) {
    if (!Array.isArray(series[name]) || series[name].length !== rowCount
        || series[name].some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError(`series.${name} must align with every generation`);
    }
  }
  const lines = ['generation,density,activity,damage'];
  for (let generation = 0; generation < rowCount; generation += 1) {
    lines.push([generation, ...['density', 'activity', 'damage'].map(
      name => round8(series[name][generation]).toFixed(8),
    )].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Deterministically shuffle exactly `count` live cells using Fisher-Yates.
 * The xorshift32 stream uses rejection sampling for each bounded draw. A zero
 * randomSeed maps to 0x6d2b79f5 because zero is xorshift32's absorbing state.
 */
export function initialWithCount(count, width = WIDTH, randomSeed = DEFAULT_RANDOM_SEED) {
  validateWidth(width);
  integerInRange(count, 'count', 0, width);
  integerInRange(randomSeed, 'randomSeed', 0, 0xffffffff);
  const row = new Uint8Array(width);
  row.fill(1, 0, count);
  let state = randomSeed === 0 ? 0x6d2b79f5 : randomSeed;
  for (let x = width - 1; x > 0; x -= 1) {
    const choices = x + 1;
    const limit = 0x100000000 - (0x100000000 % choices);
    do { state = xorshift32(state); } while (state >= limit);
    const other = state % choices;
    [row[x], row[other]] = [row[other], row[x]];
  }
  return row;
}

/**
 * Rule 184 on a ring: a live cell is a car that moves one cell right if empty.
 * Flow is moving cars per road cell per update (not moving / total cars).
 * flow[g] measures the transition from rows[g-1] to rows[g]; flow[0] is zero.
 * mean_flow excludes row zero; late_flow uses the final min(128, steps) updates.
 * This idealized model has no reaction time, lane changes, or real road units.
 */
export function runTraffic({
  count = 64,
  width = WIDTH,
  steps = 256,
  randomSeed = DEFAULT_RANDOM_SEED,
} = {}) {
  validateSteps(steps);
  const initial = initialWithCount(count, width, randomSeed);
  const rows = evolveRows(184, initial, steps, 'wrap').rows;
  const density = count / width;
  const flow = [0];
  let totalFlow = 0;
  let lateFlow = 0;
  const lateCount = Math.min(128, steps);
  for (let generation = 1; generation <= steps; generation += 1) {
    const before = rows[generation - 1];
    let moving = 0;
    for (let x = 0; x < width; x += 1) {
      moving += before[x] === 1 && before[(x + 1) % width] === 0 ? 1 : 0;
    }
    const value = moving / width;
    flow.push(value);
    totalFlow += value;
    if (generation > steps - lateCount) lateFlow += value;
  }
  return {
    rows,
    density,
    flow,
    mean_flow: totalFlow / steps,
    late_flow: lateFlow / lateCount,
    car_count: count,
    width,
    steps,
    theoretical_flow: Math.min(density, 1 - density),
  };
}

/** Sweep every achievable count; observed flow is each run's late_flow. */
export function trafficFundamentalDiagram({ width = WIDTH, steps = 256 } = {}) {
  validateWidth(width);
  validateSteps(steps);
  const samples = [];
  for (let count = 0; count <= width; count += 1) {
    const result = runTraffic({ count, width, steps });
    samples.push({
      count,
      density: result.density,
      observed_flow: result.late_flow,
      theoretical_flow: result.theoretical_flow,
    });
  }
  return samples;
}
