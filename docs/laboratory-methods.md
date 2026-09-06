# Laboratory methods

The laboratory extends Tiny Rule Atlas with finite, deterministic experiments
computed in the browser. It supports controlled comparisons, one-bit
perturbations, custom initial rows, generation-level measurements, and a
minimal Rule 184 traffic experiment. The [field guide](../field-guide.html)
provides six investigations and a 45-minute lesson.

These simulations are generated computational data. They are not measurements
of nature, new scientific discoveries, or calibrated real-world predictions.
The shell and road images are AI-generated editorial illustrations. They are
not collected specimens, field data, or outputs from these cellular automata.

## Relationship to the stored atlas

The canonical corpus remains **256 rules × 8 seeds × 2 boundaries = 4,096
parameter combinations**, each at width 128 and 128 updates. Its format and
measurements are specified by the [data contract](data-contract.md) and
[methodology](methodology.md). Each stored trajectory includes generation
zero, making 129 rows.

Laboratory runs are computed when requested; they do not rewrite or add files
to that corpus. The browser controls expose widths **64, 128, and 256** and
durations **128, 256, 512, and 1,024 updates**. Therefore a 1,024-update run has
1,025 rows. The two comparison panels use a shared width and duration but
allow independent rules, named/custom seeds, boundaries, and displayed views.

The dependency-free core in [`assets/lab-core.mjs`](../assets/lab-core.mjs)
also accepts every integer width from 8 through 256 and every integer duration
from 1 through 1,024. This permits carefully bounded extensions, including
non-power-of-two domains. At the canonical width and duration, equivalent
rules, named seeds, and boundaries must reproduce the stored cell histories.

## Local update and boundaries

Cell indices are `0` through `W-1`, left to right. Generation zero is the
initial row. To compute one synchronous update, form the neighborhood index

```text
n = 4 × left + 2 × center + right
next = (rule >> n) & 1
```

All neighborhoods use the old row. Updating cells in place, one after another,
would define a different process. The outputs for neighborhoods `111` through
`000` are the eight binary digits of the rule, from most to least significant.
This is [Wolfram's numbering convention](https://www.wolframscience.com/nks/p53--more-cellular-automata/).

- `wrap`: indices are taken modulo `W`; the first and last cells are neighbors.
- `fixed`: neighbors outside the row are always zero. The edge cells themselves
  still update. This is not generally the same as cropping an evolving
  infinite lattice that began with zeros outside the crop.

A radius-one update can transmit influence at most one cell per update. The
width, boundary, and observation window are part of each experiment. A
finite-window image should not be treated as an unaffected view of an
infinite system after boundary influence can reach it.

## Initial conditions

Let `c = floor(W/2)`. The named seeds scale as follows:

| Seed | Initial live cells |
| --- | --- |
| `single` | `c` |
| `pair` | `c-1`, `c` |
| `block` | `c-4` through `c+3`, inclusive |
| `alternating` | Every even index |
| `period3` | Every index divisible by 3 |
| `sparse` | A reproducible pseudorandom byte is less than 32 |
| `balanced` | The same byte is less than 128 |
| `dense` | The same byte is less than 224 |

For each pseudorandom named seed, restart xorshift32 at `0x00C0FFEE`
(12648430). For each cell, apply XOR with shifts left 13, unsigned right 17,
and left 5, taking the unsigned 32-bit result after each operation. The low
byte determines occupancy. These thresholds describe nominal fractions, not
exact live-cell counts. At width 128, sparse, balanced, and dense contain 23,
66, and 112 live cells, respectively. Because they use the same stream and
different thresholds, their live-cell sets are nested and deliberately
correlated. They are not three independent random samples.

For a custom seed, the laboratory's cell editor supplies the exact binary
initial row. Its leftmost bit is cell zero. A reproducible record must retain
that row, not just the label `custom`. In the core API, `initial` must be an
array or typed array containing exactly `width` numeric zeros and ones. A
supplied `initial` takes precedence over the named `seed`; `seed: 'custom'`
without an initial row is invalid. The core copies inputs rather than
mutating the caller's row.

## Paired perturbation and views

For each panel, copy its original initial row and toggle exactly one cell.
The browser uses the center index `floor(W/2)`. This may remove a live cell
rather than add one. Evolve the two initial rows using the same rule, boundary,
width, and number of updates.

The core API also accepts an explicit `perturbIndex` from `0` through `W-1`.
If using it outside the browser controls, record that index with the result.
Different perturbation locations are different experiments.

| View | Displayed row at generation `g` |
| --- | --- |
| Original / primary | Original trajectory `x[g]` |
| Perturbed | Paired trajectory `y[g]` |
| Difference | Cellwise XOR: 1 exactly where `x[g,i] != y[g,i]` |

The difference view compares each panel with its own perturbed copy. It does
not subtract panel A from panel B. A changed display view does not alter the
simulation or redefine the panel's baseline measurements.

## Measurements and conventions

Let `W` be width, `S` the number of updates, and `N = S+1` the number of rows.
With `x` the original history and `y` its perturbed history:

```text
density[g] = sum_i x[g,i] / W
activity[g] = count_i(x[g,i] != x[g-1,i]) / W      for g = 1..S
activity[0] = 0                                  a display/export convention
damage[g] = count_i(x[g,i] != y[g,i]) / W         for g = 0..S

overall density = sum_g sum_i x[g,i] / (W × N)
overall activity = sum_(g=1..S) activity[g] / S
mean damage = sum_(g=0..S) damage[g] / N
final density = density[S]
final damage = damage[S]
```

Thus the mean damage includes the initial difference `1/W`, while overall
activity excludes the conventional zero entry at generation zero. Averaging
all `S+1` CSV activity values would use the wrong denominator for overall
activity. Final damage can hide differences that grew and later disappeared.

Occupancy entropy is computed from overall density `p`:

```text
H(p) = −p log2(p) − (1−p) log2(1−p)
```

Zero terms contribute zero. This is binary occupancy entropy, from 0 to 1 bit;
it ignores the spatial and temporal ordering of cells. It is not an entropy
rate or a measurement of algorithmic complexity. A frozen alternating row
under Rule 204 has `H=1` and activity zero.

The returned summary metrics are rounded to eight decimal places, using
round-to-nearest with ties to even. In-memory generation series retain their
binary64 fractions; series CSV values are rounded to eight decimal places.
For the browser's power-of-two widths, per-generation density, activity, and
damage have exact binary representations. Summary averages need not.

The laboratory does not compute a zlib compression ratio. That measurement is
available for the stored atlas and depends on the compressor, version, and
serialization. It must not be silently replaced with a browser compressor or
a visual impression of complexity.

### Exact recurrence

The core searches for the first exactly repeated full original row. It returns
`cycle: null` when no such repeat appears through generation `S`, or:

```text
cycle = { start, period, detected_at }
period = detected_at − start
```

Under a fixed deterministic update and boundary, repetition of the complete
state guarantees the subsequent cycle. Shifted lookalikes do not count as
exact repeats. With at most `2^W` possible states, every fixed finite system
eventually cycles; a short run does not determine every attractor or basin.
Neither recurrence nor its absence in this window establishes computational
universality or chaos.

## Rule 184 traffic experiment

The traffic panel fixes **Rule 184, width 128, 256 synchronous updates, and
periodic boundaries**. A live cell is one car occupying one site. A car moves
one site right if that site was empty in the previous row; otherwise it stays.
The next row can equivalently be written

```text
next = (left AND NOT center) OR (center AND right)
```

This interpretation follows from the
[Rule 184 lookup table](https://atlas.wolfram.com/01/01/184/01_01_1_184.html).
It conserves the exact car count on a ring. Applying fixed-zero boundaries to
Rule 184 instead permits right-side outflow without left-side inflow, so the
periodic conservation statement does not apply.

### Exact occupancy and deterministic placement

The count control selects any integer `K` from 0 through 128. Occupancy is
exactly `rho = K/128`. To construct the initial row, fill the first `K` cells
with ones and the rest with zeros, then apply a Fisher–Yates shuffle from the
last index down to index one.

The shuffle uses xorshift32 with the same 13/17/5 shifts. At index `i`, draw
an unsigned 32-bit value below

```text
limit = 2^32 − (2^32 mod (i+1))
```

Reject values at or above that limit; use the accepted value modulo `i+1` as
the swap index. This rejection avoids the unequal bucket sizes of an
unconditional remainder operation. The default random seed is `0x00C0FFEE`
(12648430). A supplied zero seed maps to `0x6D2B79F5`, because zero is an
absorbing state of xorshift32. All evolution after initialization is
deterministic. The pseudorandom generator is a reproducibility device, not a
cryptographic randomness claim.

Using one shuffle seed with different counts applies the same permutation to
the occupied prefix, so those initial live-cell sets are nested. The 129-count
flow diagram uses one default-seed run per achievable density, not an ensemble
of independent stochastic replicates. Rearranging the selected traffic run
changes its transient while preserving its count; it does not turn the
comparison diagram into an average over shuffles.

### Flow and its time window

For update `g`, from row `g-1` to row `g`, count every live cell whose right
neighbor is empty, including the neighbor across the ring seam:

```text
flow[g] = count_i(x[g-1,i] = 1 and x[g-1,(i+1) mod W] = 0) / W
flow[0] = 0

mean_flow = sum_(g=1..S) flow[g] / S
L = min(128, S)
late_flow = sum_(g=S−L+1..S) flow[g] / L
```

The zero entry at generation zero is a placeholder, not a completed update,
and is excluded from both averages. For the page's 256-update run, late flow
averages **updates 129 through 256**. It uses 128 transitions, from row 128
through row 256. This is different from averaging 129 row-associated values.

Flow is **car moves per road cell per update**, not the fraction of cars that
move. At nonzero occupancy, the fraction of cars moving is `flow/rho`.
The maximum speed is one model cell per update. These quantities have no
calibrated conversion to vehicles per hour, meters, or seconds.

For this deterministic periodic rule, the asymptotic flow–density relation is

```text
q_infinity(rho) = min(rho, 1−rho)
```

This follows from the long-run speed in Equation (3) and the flow definition
`q = rho × v` in Figure 2 of
[Fukś and Boccara, *Generalized Deterministic Traffic Rules* (1997), pp. 2–3](https://arxiv.org/pdf/adap-org/9705003).

At low occupancy, freely moving cars limit throughput. At high occupancy,
empty cells moving left through the cars limit it. The theoretical reference
is not a fitted curve. A finite late-window value should be compared with
that asymptotic expectation; its time window remains part of the result.

The field guide's default-shuffle examples were reproduced at 128 cells and
256 updates:

| Cars | Density | Observed late flow | Asymptotic reference | Count conserved |
| --- | --- | --- | --- | --- |
| 32 | 0.25 | 0.25 | 0.25 | Every stored row |
| 64 | 0.50 | 0.50 | 0.50 | Every stored row |
| 96 | 0.75 | 0.25 | 0.25 | Every stored row |

The classical
[Nagel–Schreckenberg model (1992)](https://web2.qatar.cmu.edu/~gdicaro/15382/additional/NagelSchr-model.pdf)
includes multiple velocity states and probabilistic slowing, and compares
simulated traffic with observations. Rule 184 is its deterministic,
maximum-speed-one limiting case. This site implements that minimal limiting
case, not the full stochastic freeway model. It omits road calibration,
driver heterogeneity, lane changes, reaction times, and inflow/outflow in the
dedicated ring experiment. Its practical role is to teach conservation,
exclusion, transients, and the need for explicit units.

## Export scope

- **Session link:** reconstructs the two panel configurations, exact custom
  rows, selected views, timeline position, and traffic parameters. It is a
  configuration link; the receiving browser recomputes the histories.
- **Session JSON:** preserves session configuration, exact initial rows, view
  and timeline state, metrics, generation series, and recurrence results for
  both panels. Original, perturbed, and difference histories are complete
  binary row strings. It also includes the traffic history, flow series,
  late-window result, and full 129-point flow–density sweep. Use it when
  retaining all cells matters.
- **Series CSV:** exports the selected A or B panel's `generation`, `density`,
  `activity`, and `damage`, including generation zero. It contains measurements,
  not cell histories. Retain the session link or JSON alongside it for full
  reproduction.
- **Plot PNG:** illustrates all `S+1` rows of the selected A or B view at the
  chosen integer cell scale, regardless of the inspected generation. It is a
  visual export; it does not contain every configuration field or replace a
  numerical record.
- **Flow–density CSV:** exports one observed late-flow value and theoretical
  reference for each of the 129 achievable car counts, using the standard
  sweep configuration. It is not a record of every traffic cell or an ensemble
  uncertainty estimate.

The core helper `packRows(rows)` stores leftmost cells in the most significant
bits and zero-pads the low bits of each row's final byte. Each row uses
`ceil(W/8)` bytes. At width 128, this agrees with the stored-atlas trajectory
packing; at other widths, include the width when interpreting or hashing the
bytes. A PNG's file bytes are not the packed trajectory bytes.

## Reproduce a browser experiment with Node.js

From the repository root, use a Node.js version that supports ECMAScript
modules. This example recalculates the Rule 204 control without a server:

```sh
node --input-type=module <<'JS'
import { runExperiment, rowsToCSV } from './assets/lab-core.mjs';

const run = runExperiment({
  rule: 204,
  seed: 'alternating',
  boundary: 'wrap',
  width: 128,
  steps: 128,
});

console.log(run.metrics);
console.log(run.cycle);
console.log(rowsToCSV(run).split('\n').slice(0, 4).join('\n'));
JS
```

Expected summary: density and final density `0.5`, activity `0`, occupancy
entropy `1`, mean and final damage `0.0078125`; cycle starts at generation 0,
has period 1, and is detected at generation 1.

### Non-power-of-two extension

The browser's three width presets are all powers of two. For Rule 90, that
choice is mathematically special: XOR is addition over the two-element field,
so after `2^k` steps the update is the XOR of seed copies shifted `2^k` cells
left and right. For a power-of-two ring of width `W`, those shifts coincide at
step `W/2` and cancel. This is an algebraic consequence of the update and
periodic boundary, not evidence that all finite rings empty.

Change the size family explicitly:

```sh
node --input-type=module <<'JS'
import { runExperiment } from './assets/lab-core.mjs';

for (const width of [64, 127, 128, 129, 256]) {
  const run = runExperiment({
    rule: 90, seed: 'single', boundary: 'wrap', width, steps: 256,
  });
  const empty = run.rows.findIndex(row => row.every(cell => cell === 0));
  console.log({
    width,
    firstEmptyGeneration: empty === -1 ? null : empty,
    cycle: run.cycle,
  });
}
JS
```

In this 256-update check, widths 64, 128, and 256 first become empty at
generations 32, 64, and 128. Widths 127 and 129 do not become empty in the
window; both report a repeat at generation 128 of generation 1, with period
127. These are precisely specified finite experiments, not a classification
of all possible seeds and sizes.

### Reproduce the traffic counts

```sh
node --input-type=module <<'JS'
import { runTraffic } from './assets/lab-core.mjs';

for (const count of [32, 64, 96]) {
  const run = runTraffic({ count, width: 128, steps: 256, randomSeed: 12648430 });
  const conserved = run.rows.every(row =>
    row.reduce((total, cell) => total + cell, 0) === count);
  console.log({ count, conserved, lateFlow: run.late_flow,
    theoreticalFlow: run.theoretical_flow });
}
JS
```

## Interpreting the other investigations

- **Rule 30:** the difference between a finite trajectory and one central-bit
  perturbation is not a Lyapunov exponent or a proof of chaos. For the single
  seed specifically, removing its only live cell produces an empty comparison
  trajectory, so damage equals original density. See the original
  [Rule 30 example](https://www.wolframscience.com/nks/p27--how-do-simple-programs-behave/).
- **Rule 110:** [Cook's 2004 universality proof](https://content.wolfram.com/sites/13/2023/02/15-1-1.pdf)
  depends on constructed encodings and appropriately arranged initial
  material on an infinite row. Ordinary finite browser seeds do not reproduce
  that proof or test universality. Tracking a moving visual structure is a
  useful observation, but it does not identify its computational role.
- **Shell pigmentation:** the
  [Boettiger–Ermentrout–Oster paper (2009)](https://pmc.ncbi.nlm.nih.gov/articles/PMC2672551/)
  develops a neurosecretory model with biological assumptions and comparisons
  to shell patterns, growth, and disruptions. This laboratory does not
  implement that model. Similar-looking marks may motivate a hypothesis but
  do not establish a shared mechanism. The editorial shell image supplies no
  empirical observations for fitting or validation.

## Minimum replication record

Keep the rule, exact initial condition, boundary, width, update count,
perturbation index, measured generation or averaging window, and metric
definition together. For traffic, also retain the car count and shuffle seed.
Name which variable changed between runs, and retain a numerical export when
cell-level reproduction matters.

A useful conclusion separates an observed finite result from a mathematical
consequence and from an external empirical claim. Follow an interesting
picture with a comparison that could challenge your explanation.
