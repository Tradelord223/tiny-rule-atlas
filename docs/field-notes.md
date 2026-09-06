# Field notes

The appeal of this atlas is the distance between an eight-bit rule and the
patterns it can produce. Its less dramatic rules are useful, too: they make
the measurements understandable and expose how much a picture depends on its
seed and its edges. These notes distinguish consequences of a rule's truth
table, published results, and observations from this generated finite corpus.

## Start with controls

Rule 0 outputs zero for every neighborhood; rule 255 outputs one. Either
forgets the initial condition after one update. Rule 204 has binary code
`11001100`: reading the eight cases shows that its output is always the center
cell. Every row therefore remains exactly as it began, with either boundary.
These statements follow directly from the update table, without a statistical
classification.

Run **204 / alternating / wrap**. Every stored row has 64 live cells, occupancy
entropy is one bit, activity is zero, and the cycle starts at generation zero
with period one. The center perturbation persists unchanged, so both mean and
final damage are `1/128 = 0.0078125`. This is a compact counterexample to the
idea that high occupancy entropy means complicated evolution.

Run **0 / single / wrap**. The live cell disappears at generation one, and the
first repeated row is detected at generation two. Final damage is zero, but
mean damage is `1/(128*129)`, rounded to `0.00006056`, because generation zero
still contributes. Including that initial row is a deliberate convention.

## Rule 30: a small rule with irregular output

Rule 30 can be written `left XOR (center OR right)`. Wolfram's single-cell
example shows how such a small deterministic rule can produce an irregular
pattern. This motivates inspecting its trace rather than equating simple code
with simple output. It does not make a finite trace random, certify a random
number generator, or prove that a particular prediction is impossible.
[Wolfram, *A New Kind of Science*, p. 27](https://www.wolframscience.com/nks/p27--how-do-simple-programs-behave/)

Compare **30 / single** with **30 / balanced**, then change the boundary. Read
density alongside activity and the actual rows: one summary number cannot say
whether irregularity came from the initial row, the evolution, or edge effects.

## Rule 90: visible structure and a boundary surprise

Rule 90 takes the XOR of its two neighbors, ignoring the center. Its single-cell
evolution gives the familiar nested triangular pattern. The explicit XOR rule
makes this a good place to relate a picture to algebra.
[Wolfram, *A New Kind of Science*, p. 25](https://www.wolframscience.com/nks/p25--how-do-simple-programs-behave/)

In this corpus, **90 / single / wrap** is entirely zero at generation 64. Its
reported cycle starts at 64, with period one, detected at 65. **90 / single /
fixed** instead has one live cell at generation 64 and two at generation 128;
no full row repeats within the recorded window. The discrepancy is a property
of these finite experiments, not a contradiction of the infinite-lattice
picture. Width 128 is a power of two, so it is a particularly special ring for
an additive rule; it should not stand in for all widths.

## Rule 110: a picture is not a universality proof

Rule 110 supports interacting structures, and Cook proved that appropriately
constructed initial conditions can encode universal computation. The proof
uses an infinite row and carefully arranged backgrounds and signals. Eight
short, finite seeds do not reproduce that construction or test universality.
They provide accessible examples of the rule's local dynamics.
[Cook, “Universality in Elementary Cellular Automata,” 2004](https://www.complex-systems.com/abstracts/v15_i01_a01/)

Explore **110 / single** and **110 / balanced** as different starting contexts.
Repeated textures and moving boundaries are things to examine; recognizing a
shape by eye does not establish that it implements a particular computation.

## Rule 184: count what crosses an edge

Rule 184 has output `(left AND NOT center) OR (center AND right)`, equivalent
to Wolfram's algebraic expression. Interpreting a live cell as a particle, the
truth table says that each particle moves one cell right when that destination
is empty. This is a minimal traffic interpretation, not a calibrated road
model. [Wolfram Atlas, Rule 184 properties](https://atlas.wolfram.com/01/01/184/01_01_1_184.html)

This interpretation explains why the number of live cells is conserved on a
ring: movement changes positions without adding or removing particles. Under
the atlas's fixed-zero boundary, particles can leave at the right, with no
inflow at the left. For **184 / balanced / wrap**, every row retains the seed's
66 live cells. For **184 / balanced / fixed**, generation 128 has four. A
falling density here records outflow; it need not indicate the same mechanism
as a rule that destroys live cells everywhere.

The same reading habit applies throughout the atlas: inspect the seed, edges,
and time window before assigning a story to a metric. The [methodology](methodology.md)
defines what each measurement actually counts.
