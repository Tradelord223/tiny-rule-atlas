import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WIDTH, SEEDS, BOUNDARIES, seedRow, runExperiment, packRows, rowsToCSV,
  initialWithCount, runTraffic, trafficFundamentalDiagram,
} from '../assets/lab-core.mjs';

const sum = values => values.reduce((total, value) => total + value, 0);
const asStrings = rows => rows.map(row => Array.from(row).join(''));

// Independent scalar reference: no production seed, update, or packing helpers.
function scalarRows(rule, initial, steps, boundary) {
  const rows = [Array.from(initial)];
  const width = initial.length;
  for (let generation = 0; generation < steps; generation += 1) {
    const before = rows.at(-1);
    rows.push(before.map((center, x) => {
      const left = x > 0 ? before[x - 1] : boundary === 'wrap' ? before.at(-1) : 0;
      const right = x < width - 1 ? before[x + 1] : boundary === 'wrap' ? before[0] : 0;
      return Math.floor(rule / (2 ** (left * 4 + center * 2 + right))) % 2;
    }));
  }
  return rows;
}

test('all 4,096 canonical trajectories, metrics, and cycles match the Python corpus', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  assert.equal(WIDTH, 128);
  assert.deepEqual(SEEDS, catalog.seeds);
  assert.deepEqual(BOUNDARIES, catalog.boundaries);
  assert.equal(catalog.experiments.length, 256 * 8 * 2);
  const coverage = new Set();
  for (const entry of catalog.experiments) {
    const result = runExperiment(entry);
    const hash = createHash('sha256').update(packRows(result.rows)).digest('hex');
    assert.equal(hash, entry.trajectory_sha256, `${entry.id}: trajectory`);
    assert.equal(result.rows.length, 129, entry.id);
    assert.ok(result.rows.every(row => row instanceof Uint8Array && row.length === WIDTH), entry.id);
    assert.deepEqual(result.cycle, entry.cycle, `${entry.id}: cycle`);
    for (const [name, value] of Object.entries(result.metrics)) {
      assert.equal(value, entry.metrics[name], `${entry.id}: ${name}`);
    }
    assert.equal(Object.keys(result.metrics).length, 6);
    coverage.add(`${entry.rule}-${entry.seed}-${entry.boundary}`);
  }
  for (let rule = 0; rule < 256; rule += 1) {
    for (const seed of SEEDS) {
      for (const boundary of BOUNDARIES) assert.ok(coverage.has(`${rule}-${seed}-${boundary}`));
    }
  }
});

test('named seeds preserve canonical positions and the recorded xorshift32 sequence', () => {
  const positions = row => Array.from(row.keys()).filter(x => row[x] === 1);
  assert.deepEqual(positions(seedRow('single')), [64]);
  assert.deepEqual(positions(seedRow('pair')), [63, 64]);
  assert.deepEqual(positions(seedRow('block')), [60, 61, 62, 63, 64, 65, 66, 67]);
  assert.equal(seedRow('block', 8).join(''), '11111111');
  assert.equal(seedRow('alternating', 9).join(''), '101010101');
  assert.equal(seedRow('period3', 9).join(''), '100100100');
  const states = [0xf89b3e70, 0x75fb4a9a, 0x89a89d0e, 0xdb2b114a,
    0x9943b4ab, 0x1502cb40, 0xc13743d5, 0x00f31913];
  for (const [seed, threshold] of [['sparse', 32], ['balanced', 128], ['dense', 224]]) {
    assert.deepEqual(Array.from(seedRow(seed, 8)), states.map(state => Number((state & 255) < threshold)));
    assert.deepEqual(seedRow(seed, 256).slice(0, 128), seedRow(seed));
    assert.notEqual(seedRow(seed), seedRow(seed));
  }
  const sparse = seedRow('sparse');
  const balanced = seedRow('balanced');
  const dense = seedRow('dense');
  assert.ok(sparse.every((cell, x) => cell <= balanced[x] && balanced[x] <= dense[x]));
});

test('all rules and both boundaries agree with independent updates at non-byte-aligned width', () => {
  const initial = [1, 0, 0, 1, 0, 1, 1, 0, 0];
  for (let rule = 0; rule < 256; rule += 1) {
    for (const boundary of BOUNDARIES) {
      const result = runExperiment({ rule, seed: 'custom', initial, width: 9, steps: 19, boundary });
      assert.deepEqual(result.rows.map(row => Array.from(row)), scalarRows(rule, initial, 19, boundary),
        `rule ${rule}, ${boundary}`);
    }
  }
  assert.deepEqual(asStrings(runExperiment({ rule: 90, width: 9, steps: 3, boundary: 'fixed' }).rows),
    ['000010000', '000101000', '001000100', '010101010']);
  assert.deepEqual(asStrings(runExperiment({ rule: 30, width: 9, steps: 3, boundary: 'fixed' }).rows),
    ['000010000', '000111000', '001100100', '011011110']);
});

test('the selected perturbation toggles exactly one initial cell, with independent damage rows', () => {
  const initial = new Uint8Array([1, 0, 0, 1, 0, 1, 1, 0, 0]);
  const saved = initial.slice();
  const perturbed = Array.from(initial);
  perturbed[0] ^= 1;
  for (const boundary of BOUNDARIES) {
    const result = runExperiment({ rule: 30, seed: 'custom', initial, width: 9, steps: 21,
      perturbIndex: 0, boundary });
    const first = scalarRows(30, initial, 21, boundary);
    const second = scalarRows(30, perturbed, 21, boundary);
    assert.deepEqual(result.perturbed_rows.map(row => Array.from(row)), second);
    assert.equal(sum(result.difference_rows[0]), 1);
    assert.equal(result.difference_rows[0][0], 1);
    for (let generation = 0; generation < first.length; generation += 1) {
      const difference = first[generation].map((cell, x) => Number(cell !== second[generation][x]));
      assert.deepEqual(Array.from(result.difference_rows[generation]), difference);
      assert.equal(result.series.damage[generation], sum(difference) / 9);
      assert.equal(result.series.density[generation], sum(first[generation]) / 9);
      const changes = generation === 0 ? 0
        : sum(first[generation].map((cell, x) => Number(cell !== first[generation - 1][x])));
      assert.equal(result.series.activity[generation], changes / 9);
    }
    assert.deepEqual(initial, saved);
    result.rows[0][0] ^= 1;
    assert.deepEqual(initial, saved);
  }
});

test('metric denominators include generation zero only where defined and round ties like Python', () => {
  const identity = runExperiment({ rule: 204, steps: 3 });
  assert.deepEqual(identity.series.activity, [0, 0, 0, 0]);
  assert.deepEqual(identity.series.damage, [1 / 128, 1 / 128, 1 / 128, 1 / 128]);
  assert.equal(identity.metrics.mean_damage, 1 / 128);
  assert.equal(identity.metrics.activity, 0);
  const zero = runExperiment({ rule: 0, steps: 4 });
  assert.equal(zero.metrics.activity, 0.00195312); // 1/512 is a ties-to-even case.
  assert.equal(zero.metrics.final_damage, 0);
  assert.equal(runExperiment({ rule: 0, steps: 3 }).metrics.mean_damage, 0.00195312);
  const threeCells = new Uint8Array(128);
  threeCells.fill(1, 0, 3);
  const three = runExperiment({ rule: 0, seed: 'custom', initial: threeCells, steps: 3 });
  assert.equal(three.metrics.density, 0.00585938); // 3/512 rounds to the other even neighbor.
  const empty = runExperiment({ rule: 0, seed: 'custom', initial: new Uint8Array(128), steps: 3 });
  assert.equal(empty.metrics.entropy_bits, 0);
  const full = runExperiment({ rule: 255, seed: 'custom', initial: new Uint8Array(128).fill(1), steps: 3 });
  assert.equal(full.metrics.entropy_bits, 0);
});

test('cycle detection reports only exact repeated full states within the chosen horizon', () => {
  assert.deepEqual(runExperiment({ rule: 204, steps: 1 }).cycle,
    { start: 0, period: 1, detected_at: 1 });
  assert.equal(runExperiment({ rule: 51, steps: 1 }).cycle, null);
  assert.deepEqual(runExperiment({ rule: 51, steps: 2 }).cycle,
    { start: 0, period: 2, detected_at: 2 });
  assert.equal(runExperiment({ rule: 0, steps: 1 }).cycle, null);
  assert.deepEqual(runExperiment({ rule: 0, steps: 2 }).cycle,
    { start: 1, period: 1, detected_at: 2 });
  assert.equal(runExperiment({ rule: 170, width: 8, steps: 7 }).cycle, null);
  assert.deepEqual(runExperiment({ rule: 170, width: 8, steps: 8 }).cycle,
    { start: 0, period: 8, detected_at: 8 });
  const repeated = runExperiment({ rule: 204, width: 256, steps: 1024 });
  assert.equal(repeated.rows.length, 1025);
  assert.notEqual(repeated.rows[0], repeated.rows[1]);
  repeated.rows[1][128] = 0;
  assert.equal(repeated.rows[0][128], 1);
  assert.equal(repeated.rows[2][128], 1);
  assert.equal(repeated.perturbed_rows[0][128], 0);
});

test('packing preserves MSB-first order and padding independently on every row', () => {
  assert.equal(Buffer.from(packRows([[1, 0, 1, 0, 1, 0, 1, 0]])).toString('hex'), 'aa');
  assert.equal(Buffer.from(packRows([[0, 0, 1, 0, 0], [1, 0, 0, 0, 1]])).toString('hex'), '2088');
  const nine = [[1, 0, 0, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 0, 1, 0]];
  assert.equal(Buffer.from(packRows(nine)).toString('hex'), '80804100');
  assert.equal(Buffer.from(packRows([seedRow('single')])).toString('hex'),
    '00000000000000008000000000000000');
  assert.throws(() => packRows([]), /nonempty/);
  assert.throws(() => packRows([[0, 1], [0]]), /exactly 2/);
  assert.throws(() => packRows([[0, 2]]), /0 or 1/);
});

test('CSV exports every aligned generation with a stable numeric schema', () => {
  const result = runExperiment({ rule: 0, width: 8, steps: 2 });
  assert.equal(rowsToCSV(result), 'generation,density,activity,damage\n'
    + '0,0.12500000,0.00000000,0.12500000\n'
    + '1,0.00000000,0.12500000,0.00000000\n'
    + '2,0.00000000,0.00000000,0.00000000\n');
  assert.throws(() => rowsToCSV({}), /runExperiment/);
  assert.throws(() => rowsToCSV({ ...result, series: { ...result.series, damage: [] } }), /align/);
});

test('invalid simulation inputs fail before computation', () => {
  for (const rule of [-1, 256, 1.5, true, NaN, '30', undefined]) {
    assert.throws(() => runExperiment({ rule }), /rule/);
  }
  for (const width of [0, 7, 257, 8.5, true, NaN, '128']) {
    assert.throws(() => runExperiment({ rule: 30, width }), /width/);
    assert.throws(() => seedRow('single', width), /width/);
  }
  for (const steps of [0, -1, 1025, 1.5, true, NaN, '128']) {
    assert.throws(() => runExperiment({ rule: 30, steps }), /steps/);
  }
  assert.throws(() => runExperiment(), /rule/);
  assert.throws(() => runExperiment({ rule: 30, boundary: 'mirror' }), /boundary/);
  assert.throws(() => runExperiment({ rule: 30, seed: 'unknown' }), /seed/);
  assert.throws(() => seedRow('custom'), /seed/);
  assert.throws(() => runExperiment({ rule: 30, seed: 'custom' }), /requires an initial/);
  for (const initial of [[], '00000000', new Uint8Array(7), Array(8).fill(2),
    Array(8).fill(true), new DataView(new ArrayBuffer(8))]) {
    assert.throws(() => runExperiment({ rule: 30, width: 8, initial }), /initial/);
  }
  for (const perturbIndex of [-1, 8, 1.5, true, NaN, '4']) {
    assert.throws(() => runExperiment({ rule: 30, width: 8, perturbIndex }), /perturbIndex/);
  }
  const custom = new Uint8Array(8);
  custom[0] = 1;
  assert.deepEqual(runExperiment({ rule: 204, width: 8, initial: custom }).rows[0], custom);
  assert.deepEqual(runExperiment({ rule: 204, width: 8, seed: 'custom', initial: custom }).rows[0], custom);
});

test('count seeds are deterministic, exact, and support the full unsigned seed range', () => {
  for (const width of [8, 9, 128, 256]) {
    for (let count = 0; count <= width; count += 1) {
      const row = initialWithCount(count, width);
      assert.equal(row.length, width);
      assert.equal(sum(row), count);
      assert.ok(row.every(cell => cell === 0 || cell === 1));
      assert.deepEqual(row, initialWithCount(count, width));
    }
  }
  assert.notDeepEqual(initialWithCount(64, 128, 1), initialWithCount(64, 128, 2));
  assert.deepEqual(initialWithCount(64, 128, 0), initialWithCount(64, 128, 0));
  assert.equal(sum(initialWithCount(64, 128, 0xffffffff)), 64);
  for (const count of [-1, 129, 0.5, true, NaN, '64']) {
    assert.throws(() => initialWithCount(count), /count/);
  }
  for (const randomSeed of [-1, 0x100000000, 1.5, true, NaN, '1']) {
    assert.throws(() => initialWithCount(64, 128, randomSeed), /randomSeed/);
  }
});

test('Rule 184 conserves cars and flow measures the update into each generation', () => {
  for (const count of [0, 1, 31, 64, 97, 127, 128]) {
    const result = runTraffic({ count });
    assert.equal(result.rows.length, 257);
    assert.equal(result.flow.length, 257);
    assert.equal(result.flow[0], 0);
    assert.equal(result.car_count, count);
    assert.equal(result.density, count / 128);
    assert.equal(result.theoretical_flow, Math.min(count / 128, 1 - count / 128));
    assert.ok(result.rows.every(row => sum(row) === count));
    for (let generation = 1; generation <= result.steps; generation += 1) {
      const before = result.rows[generation - 1];
      let moving = 0;
      const expected = new Uint8Array(128);
      for (let x = 0; x < 128; x += 1) {
        if (!before[x]) continue;
        const destination = (x + 1) % 128;
        if (!before[destination]) {
          moving += 1;
          expected[destination] = 1;
        } else expected[x] = 1;
      }
      assert.deepEqual(result.rows[generation], expected);
      assert.equal(result.flow[generation], moving / 128);
    }
    assert.equal(result.mean_flow, sum(result.flow.slice(1)) / 256);
    assert.equal(result.late_flow, sum(result.flow.slice(-128)) / 128);
  }
  const short = runTraffic({ width: 9, count: 4, steps: 7, randomSeed: 0 });
  assert.equal(short.mean_flow, sum(short.flow.slice(1)) / 7);
  assert.equal(short.late_flow, short.mean_flow);
  for (const args of [{ count: -1 }, { width: 7 }, { steps: 0 }, { randomSeed: -1 }]) {
    assert.throws(() => runTraffic(args));
  }
});

test('the full traffic fundamental diagram agrees with asymptotic flow after a 128-step burn-in', () => {
  const diagram = trafficFundamentalDiagram();
  assert.equal(diagram.length, 129);
  for (const [count, point] of diagram.entries()) {
    assert.deepEqual(Object.keys(point), ['count', 'density', 'observed_flow', 'theoretical_flow']);
    assert.equal(point.count, count);
    assert.equal(point.density, count / 128);
    assert.equal(point.theoretical_flow, Math.min(count / 128, 1 - count / 128));
    assert.equal(point.observed_flow, point.theoretical_flow, `count ${count}`);
  }
  assert.equal(diagram[64].observed_flow, 0.5);
  assert.equal(trafficFundamentalDiagram({ width: 9, steps: 16 }).length, 10);
  assert.throws(() => trafficFundamentalDiagram({ width: 257 }), /width/);
  assert.throws(() => trafficFundamentalDiagram({ steps: 0 }), /steps/);
});
