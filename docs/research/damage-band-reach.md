# Damage rows are not damage reach

Measured 2026-08-21 (`mtg-9mxv`), against this worktree at `d93924dc` (`lane/w45-damage`, based on
`main`). Every count below came from a run of `packages/setgen/tools/removal-census.ts` over the
committed flagship set fixture (371 cards) and a freshly emitted `npm run reference:reduced` pair
(Magic 2011 reduced to 162 positions, Magic 2013 reduced to 145). Nothing is estimated and nothing
is carried over from another report.

**Verdict: real over-supply, but roughly a third the size the row count implies, and concentrated
in a mechanism the row count cannot distinguish from a burn spell.** The census's own headline —
"damage rows: flagship 38, M11 5, M13 4" — still holds exactly. But two-thirds of that gap is an
artifact of two things the row count cannot see: the flagship pool is 2.3–2.6x larger than either
reduced core set, and 58% of the flagship's damage rows are printed on a repeatable combat trigger
rather than a one-shot spell. Normalizing for pool size and weighting each row by how much of its
_own_ pool's creature curve it can actually kill shrinks the disparity from 7.6–9.5x (raw rows) to
roughly 2.6–3.5x (reach-weighted density) — still an over-supply, not a wash. The 42% that is a
single named combat-trigger mechanic is a different complaint with a different fix, argued in §4.

---

## 1. The headline, re-measured

```
damage                                            38                       5                       4
```

Unchanged from the census `mtg-9mxv` quotes. Confirmed against today's committed
`flagship-set-253` fixture (371 cards, 208 creatures) and today's freshly generated reduced
M11 (162 cards, 77 creatures) and M13 (145 cards, 60 creatures).

The first thing the row count hides: the pools are not the same size. Row density (damage rows per
card printed) is **10.24%** for the flagship, **3.09%** for M11, **2.76%** for M13 — a **3.3–3.7x**
gap, not the 7.6–9.5x the raw counts suggest. Two-thirds of the "38 vs 5" story is pool size before
a single card is read for what it actually kills.

## 2. What the census could not show, and what changed

`removalCensus`'s `RemovalRow` carried `bucket`, `targetClass`, `sweep` and `conditions`, and
deduplicated a card's effects by that tuple — enough to tell a destroy from a bounce, but nothing
that distinguished a 1-damage ping from a 5-damage burn spell inside the `damage` bucket. Two rows
with the same bucket, target class and no conditions were the same row whether they killed a
1-toughness creature or a 9-toughness one.

`packages/setgen/tools/removal-census.ts` now carries, per damage row:

- **`amount`** — the literal damage number, or `'dynamic'` when the card names a computed `Amount`
  (an X spell, a count off the board) rather than a printed integer.
- **`repeatable`** — true when the damage is printed on an activated or triggered ability rather
  than a one-shot spell, because the same source can fire every time its condition recurs.

And `RemovalCensus` now carries the pool's own creature **toughness distribution**
(`toughnessDistribution`), so a damage amount can be checked against the curve of creatures it
would actually face — never a fixed reference curve, always the pool it was measured on.
`shareOfCreaturesAtOrBelow` returns the share of a pool's own creatures a literal amount kills
outright, and is `undefined` for a dynamic amount or an empty creature pool rather than a division
by zero wearing a percentage sign. The formatted report gained a `-- damage against creatures,
banded by amount --` section (row count and reach share per band, plus a repeatable/one-shot
split) and a per-card damage listing sorted by amount then mana value, so the amount x mana-value
x rarity cross-tab in §3 is read straight off the tool rather than assembled by hand.

`packages/setgen/test/removal-census.test.ts` gained nine tests against a six-card hand-written
pool (two creatures at toughness 1 and 4, a one-shot burn spell, a repeatable combat pinger, an
X-damage spell) — never the private flagship fixture. They pin: the toughness distribution reads
right, the share calculation is correct and refuses a zero-creature pool and a dynamic amount, the
band boundaries (1–4 literal, 5+, dynamic) are right including the off-by-one at exactly 5, a
damage row carries `amount` and `repeatable` and no other bucket does, the census carries the pool's
own creature count and toughness map, and the formatted report prints the reach percentage and the
repeatable/one-shot split correctly.

## 3. The band table: amount x mana value x rarity

Read directly off `removalCensus`'s per-row output, one line per damage row targeting a creature
(single-target and sweep together, matching the existing bucket-count convention).

**The flagship (371 cards, 208 creatures):**

| amount  | rows | rarity split         | mana values               | kills ≤ this much of the flagship's own creatures |
| ------- | ---- | -------------------- | ------------------------- | ------------------------------------------------- |
| 1       | 12   | 12 common            | 1,2,2,2,2,3,3,3,4,4,4,5   | 12.0%                                             |
| 2       | 13   | 5 common, 8 uncommon | 1,2,2,2,2,2,3,5,5,5,5,5,6 | 33.7%                                             |
| 3       | 6    | 5 common, 1 mythic   | 1,2,2,5,6,6               | 60.6%                                             |
| 4       | 6    | 4 common, 2 uncommon | 3,3,3,4,4,4               | 79.3%                                             |
| 5+      | 1    | 1 common             | 4                         | 90.4%                                             |
| dynamic | 0    | —                    | —                         | n/a                                               |

**M11 (162 cards, 77 creatures)** — the four literal rows are Hornet Sting (common, mv1, amount 1),
Prodigal Pyromancer (uncommon, mv3, amount 1, repeatable), Ember Hauler (uncommon, mv2, amount 2,
repeatable) and Lightning Bolt (common, mv1, amount 3); Corrupt (uncommon, mv6) is the one dynamic
row.

| amount  | rows | rarity split         | mana values | kills ≤ this much of M11's own creatures |
| ------- | ---- | -------------------- | ----------- | ---------------------------------------- |
| 1       | 2    | 1 common, 1 uncommon | 1, 3        | 27.3%                                    |
| 2       | 1    | 1 uncommon           | 2           | 58.4%                                    |
| 3       | 1    | 1 common             | 1           | 75.3%                                    |
| 4       | 0    | —                    | —           | 88.3%                                    |
| 5+      | 0    | —                    | —           | 94.8%                                    |
| dynamic | 1    | 1 uncommon           | 6           | n/a                                      |

**M13 (145 cards, 60 creatures)** — the four rows are Goblin Arsonist (common, mv1, amount 1,
repeatable), Staff of Nin (rare, mv6, amount 1, repeatable), Searing Spear (common, mv2, amount 3)
and Essence Drain (common, mv5, amount 3).

| amount  | rows | rarity split     | mana values | kills ≤ this much of M13's own creatures |
| ------- | ---- | ---------------- | ----------- | ---------------------------------------- |
| 1       | 2    | 1 common, 1 rare | 1, 6        | 35.0%                                    |
| 2       | 0    | —                | —           | 60.0%                                    |
| 3       | 2    | 2 common         | 2, 5        | 76.7%                                    |
| 4       | 0    | —                | —           | 91.7%                                    |
| 5+      | 0    | —                | —           | 95.0%                                    |
| dynamic | 0    | —                | —           | n/a                                      |

The flagship's own creature curve is toughness-heavier than either core set's: toughness 1–2 is
33.7% of the flagship's creatures against 58.4% of M11's and 60.0% of M13's. That is why a 2-damage
spell reaches a smaller share of the format in the flagship than the identically-shaped card would
reach in either core set — the creatures got tougher, not just more numerous.

## 4. Is 38 an over-supply, an artifact, or an over-supply of something else?

All three answers apply to a different slice of the number, which is the actual finding.

**It is not purely an artifact.** Weighting each damage row by the share of its own pool's
creatures it can kill (`Σ rows × reach share`, divided by pool size) gives a density comparable
across pools of different size and different toughness curves: **4.08%** for the flagship, **1.16%**
for M11, **1.54%** for M13 (M11's one dynamic row is excluded from the weighted sum since an X spell
has no single reach share; including it at any plausible reach only widens the gap). That is a
**2.6–3.5x** disparity — smaller than the 7.6–9.5x raw row count, but a real and substantial one,
not a rounding artifact of counting rows.

**It is partly an artifact of two things the row count hides.** Pool size accounts for roughly a
third of the raw gap by itself (row density 3.3–3.7x against the raw 7.6–9.5x). And within the
flagship's 38 rows, **22 (58%)** are printed on a repeatable activated or triggered ability rather
than a one-shot spell, against **2 of 5 (40%)** in M11 and **2 of 4 (50%)** in M13. Restricting to
one-shot spells only — the shape Lightning Bolt, Searing Spear and Murder actually are, cards that
occupy a deck slot and get used once — the flagship prints **16**, M11 **3**, M13 **2**; density
**4.31%** against **1.85%** and **1.38%**, a **2.3–3.1x** gap. That is close to the reach-weighted
figure, which means the one-shot-spell supply alone is already elevated at roughly the same
magnitude as the full reach-weighted reading — the repeatable layer is not hiding the whole story.

**It is also an over-supply of a specific, different thing.** Of the flagship's 12 amount-1 rows,
8 are printed by cards carrying one specific triggered condition — a combat-role trigger that fires
when the creature blocks or is blocked by a creature with greater power, and deals 1 damage as the
result. That single condition is carried by 12 cards in the flagship set: 8 deal 1 damage and
are the amount-1 rows counted here, 3 deal 2 damage and sit in the amount-2 band, and 1 pairs the
condition with a non-damage effect. The trigger therefore accounts for 11 of the 38 damage rows
outright, not 8. Neither reduced core set prints an equivalent — the closest thing either has is Prodigal Pyromancer's or Staff of Nin's one-off
activated ping, one card each. As a share of each pool's own creature count, repeatable
damage-dealing sources are **10.6%** of the flagship's creatures against **2.6%** of M11's and
**3.3%** of M13's — a **3.2–4.1x** gap on that axis specifically. This is not "too much removal";
it reads as a combat-trigger _keyword mechanic_ baked into a chunk of the creature base, distinct
from the instant/sorcery removal suite a limited player actually drafts around, and it is the
single largest concentrated contributor to the amount-1 band.

**The deciding number:** reach-weighted damage density is **4.08%** of the flagship's own card pool
against **1.16–1.54%** of the reduced core sets' — a genuine 2.6–3.5x over-supply, not an artifact.
But the row count's 7.6–9.5x overstates that by roughly 3x, and 11 of the 38 rows are one
repeatable combat-trigger mechanic that has no analog in either core set and functions nothing like
the burn spells the row count implicitly compares it to.

## 5. What the reading does not decide

This lane measured; it changed no card. If the reading above is acted on, three separate
findings would drive three separate fixes, and they should not be collapsed into one:

1. **One-shot creature-damage spell density is 2.3–3.1x the reduced core sets' even alone**
   (16/371 vs 3/162 and 2/145). If the format wants to match that ratio, the fix is fewer
   creature-damage-dealing instants and sorceries — a spell-slot cut, independent of anything
   below.
2. **The reach-weighted total (spells and triggers combined) is 2.6–3.5x.** If the format wants
   only this ratio addressed and no more, the fix is smaller than cutting every low-amount row: the
   higher-amount, higher-reach rows (the 6 rows at amount 4 and the 1 row at amount 5+, which
   between them kill 79–90% of the flagship's own creatures) already carry most of the actual
   killing power: 13 rows out of 38 account for 4.758 + 0.904 = 5.662 of the 15.119 total
   reach-weighted units, or 37% of the reach from 34% of the rows.
3. **The single combat-trigger condition carried by 12 cards (11 of them damage rows counted here,
   8 at amount 1 and 3 at amount 2) is a distinct format lever from removal-spell count.** If the concern is
   specifically "too many creatures with a built-in combat ping," the fix is a cut or a rework of
   that trigger's frequency across the card pool, not a cut to the burn-spell suite, and it would
   leave the one-shot-spell density (finding 1) untouched.

Which of these three (if any) is the right fix is a design decision, not a measurement one, and is
left for a filed bead rather than decided here.

---

## 6. Reproduction

```
npm run reference:reduced -- --out <dir>
npx tsx packages/setgen/tools/removal-census.ts <flagship set.json> <dir>/m11/set.json <dir>/m13/set.json
```

No paid call was made. The reduced M11/M13 sets used here were freshly generated in this worktree's
`out/` (gitignored, not committed) rather than read from a stale copy. The extension to
`removal-census.ts` (the `amount`/`repeatable` fields on `RemovalRow`, `toughnessDistribution`,
`shareOfCreaturesAtOrBelow`, `damageBandOf`, and the two new report sections) ships in the same
commit as this document and the tests in `packages/setgen/test/removal-census.test.ts` that pin it.
