# Methodology

Tiny Rule Atlas is a generated computational dataset. Its records are finite,
deterministic simulations, not measurements of nature or independent research
discoveries. The [data contract](data-contract.md) specifies the exact format.

## What is exhaustive

An elementary cellular automaton has binary cells on a line. Every cell updates
simultaneously from its left neighbor, itself, and its right neighbor. The eight
possible neighborhoods each have two possible outputs, giving `2^8 = 256` rules.
We use Wolfram's numbering convention: for neighborhood `left, center, right`,
read bit `4*left + 2*center + right` of the rule number. Thus the outputs for
`111, 110, 101, 100, 011, 010, 001, 000` are the rule's eight binary digits from
most to least significant. [Wolfram, *A New Kind of Science*, p. 53](https://www.wolframscience.com/nks/p53--more-cellular-automata/)

The atlas exhausts **256 rules × 8 named seeds × 2 boundary conditions = 4,096
parameter combinations** at width 128 and duration 128 updates. It does not
exhaust the `2^128` possible starting rows, other widths, longer durations,
other boundaries, or infinite lattices. Different parameter combinations can
produce identical trajectories. The eight seeds are selected probes; they
are not a representative statistical sample of all initial conditions.

## Initial conditions and boundaries

Cell indices run from 0 at the left to 127 at the right. Generation zero is the
initial row. After 128 synchronous updates, each record contains **129 rows**.

| Seed | Initial live cells |
| --- | --- |
| `single` | Cell 64 |
| `pair` | Cells 63 and 64 |
| `block` | Cells 60 through 67, inclusive |
| `alternating` | Even indices; 64 live cells |
| `period3` | Indices divisible by 3; 43 live cells |
| `sparse` | Pseudorandom byte below 32; 23 live cells |
| `balanced` | Same byte below 128; 66 live cells |
| `dense` | Same byte below 224; 112 live cells |

For each pseudorandom seed, restart xorshift32 at `0x00C0FFEE`. For each cell,
apply XOR with shifts left 13, right 17, then left 5, masking to unsigned 32 bits
after each operation. Use the resulting low byte. The thresholds correspond
to nominal fractions 1/8, 1/2, and 7/8; these names do not promise exact
occupancies. Because all three use the same stream, their live sets are nested:
`sparse ⊆ balanced ⊆ dense`. They are deliberately correlated, not three
independent random draws. Evolution itself uses no randomness.

With `fixed`, neighbors outside the stored row always have value zero. The two
edge cells still update normally; they are not pinned to zero. This is not
generally equivalent to cropping an evolving infinite lattice that started
with zero cells outside the image. With `wrap`, cells 0 and 127 are neighbors,
making a ring. Boundary effects are part of the experiment. A radius-one rule
can transmit influence by at most one cell per update, so 128 updates on a
128-cell row should not be read as an unaffected window into infinite space.

For the paired perturbation run, toggle cell 64 of the initial row and evolve
with the same rule and boundary. This changes exactly one bit, possibly
removing rather than adding a live cell. Its fraction of differing cells at
generation zero is `1/128`. The stored trajectory is the original run; damage
metrics also require the regenerated perturbation run.

## Reading the measurements

Let `x[t,i]` be a stored cell and `y[t,i]` its paired perturbed cell. Define
`d[t] = count(x[t,i] != y[t,i]) / 128`.

| Field | Definition and interpretation |
| --- | --- |
| `density` | Live cells divided by `129*128`, including the initial row. It summarizes occupancy over this window. |
| `final_density` | Live cells at generation 128 divided by 128. |
| `activity` | Changed cells divided by `128*128` across the 128 transitions. It measures temporal change, not spatial disorder. |
| `entropy_bits` | `-p*log2(p) - (1-p)*log2(1-p)`, where `p=density` and zero terms contribute zero. This is binary occupancy entropy. |
| `compression_ratio` | Bytes returned by `zlib.compress(packed_rows, level=9)` divided by 2,064 raw bytes. Smaller means this compressor found more redundancy in this serialization. |
| `mean_damage` | The arithmetic mean of `d[0]` through `d[128]`, including the initial perturbation. |
| `final_damage` | `d[128]`; a snapshot that can hide earlier growth and recovery. |

Occupancy entropy ignores ordering: an unchanging alternating row has entropy
one despite zero activity and a very short description. It is neither an
entropy rate nor a measurement of algorithmic complexity. Compression is also
a descriptive heuristic: byte packing, row order, headers, and the compressor
affect the result, and a ratio can exceed one. Damage here samples one location
and one finite window; it is not a Lyapunov exponent, an average over all
perturbations, or proof of chaos. Metrics are rounded to eight decimal places.

`cycle` reports the first exactly repeated full row: `start` is its earlier
generation, `detected_at` its repeated generation, and their difference is the
`period`. Determinism guarantees that the sequence then repeats under this
fixed rule and boundary. Spatially shifted lookalikes are not exact repeats.
`null` means no repeat appeared through generation 128. Every fixed finite
system here eventually cycles because it has only `2^128` states; this short
search does not determine all its attractors or their basins. Neither these
metrics nor these cycles establish a universal behavioral classification.

## Reproducing and inspecting records

Each row is packed into 16 bytes with the leftmost cell in the most significant
bit. Concatenating all 129 rows yields 2,064 bytes. `trajectory_sha256` hashes
those bytes, excluding JSON formatting, metrics, and the perturbation trace.
Hex strings make the complete trajectory inspectable without an image decoder.

From the repository root, recalculate a case summary or verify the complete
stored corpus without writing files:

```sh
python3 atlas.py inspect --rule 90 --seed single --boundary wrap
python3 atlas.py verify
```

To rebuild the records and catalog, run `python3 scripts/build_dataset.py`.
The Python API `atlas.generate_case(rule, seed, boundary)` returns a complete
record, including its hexadecimal rows. More commands are in the
[README](../README.md).

Exact regeneration of JSON requires the matching Python/zlib environment,
recorded separately in `data/provenance.json`: the compression ratio can differ
across compressor versions even when every cell agrees. The packed rows and
their SHA-256 are independent of compression. When comparing environments,
distinguish a compression-only difference from a changed trajectory.

For scientific comparisons, hold rule, seed, duration, width, and boundary
explicit. Follow an interesting finite result with longer runs, other widths,
additional seeds, or a mathematical argument before extending its claim.
