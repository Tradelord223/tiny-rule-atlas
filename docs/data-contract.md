# Dataset contract, version 1

The canonical experiment grid is all 256 elementary cellular automaton rules,
eight initial conditions, and two boundaries: 4,096 experiments.

- Rules: integers 0–255. Neighborhood index is `4 * left + 2 * center + right`;
  next cell is `(rule >> neighborhood) & 1`.
- Width: 128 cells. Steps: 128 updates. Store 129 rows including generation zero.
- Seeds, in order: `single`, `pair`, `block`, `alternating`, `period3`, `sparse`,
  `balanced`, `dense`.
- Single: cell 64. Pair: cells 63 and 64. Block: cells 60 through 67 inclusive.
  Alternating: `x % 2 == 0`. Period3: `x % 3 == 0`.
- Random seeds: start xorshift32 at `0x00C0FFEE`, update once per cell using
  shifts 13 left, 17 right, 5 left; mask to unsigned 32 bits after each XOR.
  The cell is live when the low byte is less than 32, 128, or 224 for sparse,
  balanced, or dense, respectively. These three seeds are deliberately nested.
- Boundaries: `fixed` uses zero-valued neighbors outside the lattice; `wrap`
  uses periodic boundaries. Fixed edge cells still update normally.
- Perturbation: toggle cell 64 of the seed, then simulate with the same rule
  and boundary. Damage is the fraction of differing cells between the two runs.

Each experiment is `data/experiments/rRRR/rRRR-SEED-BOUNDARY.json` with fields:

```
schema_version: 1
id: "r030-balanced-wrap"
rule: 30
seed: "balanced"
boundary: "wrap"
width: 128
steps: 128
rows_hex: [129 hexadecimal strings, 32 lower-case characters each]
trajectory_sha256: SHA-256 of all packed row bytes concatenated
metrics: {
  density: fraction of live cells across all 129 rows,
  final_density: fraction of live cells in row 128,
  activity: fraction of cells changing across the 128 row transitions,
  entropy_bits: binary Shannon entropy of the overall live/dead frequency,
  compression_ratio: len(zlib.compress(packed_rows, level=9)) / len(packed_rows),
  mean_damage: mean differing-cell fraction across all 129 paired rows,
  final_damage: differing-cell fraction at generation 128
}
cycle: null OR {start: first occurrence generation, period: integer,
                detected_at: repeated generation}
```

Floating-point metrics are rounded to eight decimal places. Binary entropy
measures occupancy balance, not algorithmic complexity. Compression depends
on zlib implementation/version and is a descriptive heuristic. A detected
cycle is exact for this finite deterministic system; no observed cycle within
128 steps says nothing about whether one exists later.

Rows are packed with the leftmost cell as the most significant bit. For
example cell zero alone is hexadecimal `80000000000000000000000000000000`.
JSON is UTF-8, sorted keys, two-space indentation, with a final newline.
No timestamps or machine-specific values enter the dataset files.

`data/catalog.json` contains `schema_version`, `width`, `steps`, `count`,
`seeds` (the ordered string IDs), `boundaries` (ordered `fixed`, `wrap`),
and `experiments`: entries with `id`, `rule`, `seed`, `boundary`, `metrics`,
`cycle`, `trajectory_sha256`, and `path` relative to the repository root.
Records are sorted by rule, seed order, then boundary order.

The browser reads this catalog and fetches a selected record. Hash fragments
use `#rule=30&seed=single&boundary=wrap`. Browser simulations for exploration
must agree exactly with the stored experiments.
