# ADR-0005: A draft rating carries its provenance

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-20 |
| **Bead** | `mtg-1j00i` (decision `dec-h80y`) |
| **Resolves** | Whether a card's draft-time power-level number is ours or the world's, and what happens for the sets the world has never seen. |
| **Extends** | ADR-0003, which settled the *scale* of the one number Draftmancer's file format has room for. This settles where that number comes from once there is more than one possible source. |
| **Inputs** | `packages/draft-export/src/rating.ts`, `packages/ui/src/lab/printed-draft-ratings.ts`, `packages/forge-export/src/draft-rankings.ts`, `packages/metrics/src/calibration.ts`, `packages/sim/src/log/schema.ts`, `packages/deckbuild/src/evaluate.ts` |

---

## 1. Context

the playtester asked on 2026-09-20 whether our sets carry limited card ratings, said she wants them
toggleable while drafting so she can choose between cards by general power level "from play data",
and asked whether public draft data exists for us to derive real ones.

Four facts shaped the answer, and each was verified rather than assumed. The fourth was found a
few hours after the first three, and it changed the shape of the ladder rather than adding a
footnote to it.

**We already emit a rating, and it is not play data.** ADR-0003 maps `evaluateCard`'s score onto
Draftmancer's 0-5 band, min-max fitted per set. That ADR is explicit that the result is ordinal
within one set and that a 4.0 in one set does not mean a 4.0 in another, "because the only ground
truth we have is one evaluator's ordering". It is a design tool's opinion about cards nobody has
played.

**Human play data exists publicly, for almost none of our sets.** 17lands publishes raw draft and
game logs under CC BY 4.0. Probed 2026-09-20: HTTP 200 for 21 modern Arena sets plus Khans of
Tarkir; `draft_data_public.KTK.PremierDraft.csv.gz` is 48,775,200 bytes. 17lands observes MTG
Arena and nothing else, so of our eighteen reference sets it covers exactly one. The other
seventeen predate Arena. Their pre-computed per-card summary endpoint serves no statistics to a
scripted client, so the numbers must be computed from the raw logs. (A 403 on that bucket cannot
distinguish a removed object from a renamed one, so "one of eighteen" is a statement about what is
available today, not about what ever existed.)

**A generated set can never have external play data.** Nobody outside this machine has drafted The
flagship set. This is permanent, not a gap waiting to be filled.

**A third source already ships, and it covers the sets 17lands cannot.** Found 2026-09-20, after
the first version of this ADR was written. `packages/ui/src/lab/printed-draft-ratings.ts` stages a
`printed-draft-ratings` artifact per printed format: a 0-5 `quality` per physical card, under a
`source` block naming `forge-limited-rankings` and its version. The numbers come from Forge's
`DraftRankCache`, read through a separately executed GPL companion JVM
(`packages/forge-export/bridge/ForgeDraftRankings.java`), so the license boundary holds. Fifteen of
the eighteen staged printed formats carry one today; `akh-hou`, `m15` and `scd` do not. These are
community pick-order rankings, which is human judgment at scale rather than measured play, so they
are a third kind of quantity and not a second copy of either of the other two.

## 2. Decision

**A rating is a number plus the source that produced it, and a bare number is not a valid rating.**
The best available source wins, chosen per set:

1. **Measured human play where it exists.** 17lands. Today Khans of Tarkir alone. Any reference set
   added later that Arena drafted inherits this rung at no design cost.
2. **Human judgment at scale where that exists.** Forge's Limited rankings, already staged for
   fifteen printed formats. Thousands of drafters' pick orders are weaker evidence than a measured
   win rate and stronger evidence than our design tool's score over cards it never saw played, so
   this rung sits between the two. It covers the printed sets rung 1 cannot reach, which is most of
   our reference sets.
3. **Our own numbers everywhere else**, which is every generated set, permanently. Within this rung
   the evaluator's rank is what ships first because it already exists, and win-rate-when-drawn from
   the seeded simulations replaces it once the data supports it, because that one is measured rather
   than judged.

the playtester's ruling named rung 1 and rung 3 and is silent on rung 2, because neither of us knew the
Forge artifact was there when she ruled. Rung 2 is this seat's call under her stated principle,
prefer human data where it exists, and it is one edit to reverse if she reads the ordering
differently.

**Any surface showing a rating must show which source it came from.** This is the load-bearing half.
The request was specifically for power level from play data. An `evaluateCard` score is not play
data, a community pick order is not either, and the three are not even the same kind of quantity:
ours is ordinal within one set, a Forge rank is an ordinal pick order over a printed set, a win rate
is an absolute proportion comparable across sets. Displaying them unlabeled side by side would
answer a question nobody asked.

Make this a type-level fact, not a convention. `CardRating` carries a plain `rating: number` today,
so nothing stops a consumer averaging an evaluator score with a human win rate. A discriminated
source makes that fail to typecheck instead of failing quietly.

## 3. Why not one source for everything

**Not the evaluator alone.** It is the only option available today at zero cost, and it cannot
answer the question that was asked. Calling our own judgment "play data" on the tin is the specific
failure this ADR exists to prevent.

**Not 17lands alone.** It covers one of our sets and can never cover a generated one, which is the
set family this project exists to build. A rule that only works for Khans of Tarkir is not a rule.

**Not our simulations alone.** They work everywhere, including generated sets, and they measure real
games. But they measure *our bots*, which are not good players, so where a human baseline exists it
is better evidence. Preferring it where it exists costs nothing.

**Not Forge's rankings alone.** They cover fifteen printed formats and no generated set, for the
same reason 17lands cannot: nobody has drafted a set that did not exist. They are also a pick order
rather than a measurement, so a set that has both a Forge rank and a 17lands win rate should show
the win rate. Khans of Tarkir is that set today, which is why the ordering between rungs 1 and 2 is
not academic.

The ladder is not a compromise between the four. It is the observation that the sets have
genuinely different evidence available, and that pretending otherwise means either discarding real
human data or inventing it.

## 4. Consequences

- `CardRating` gains a source discriminant and every consumer narrows. Work: `mtg-1j00i.1`.
- `toCustomCards` still flattens to the one 0-5 number Draftmancer's format has a field for, and
  their `SimpleBot` still needs it. That flattening is where provenance is deliberately dropped, and
  it should say so at the point it happens.
- Ingesting 17lands becomes real work rather than a declared contract.
  `packages/metrics/src/calibration.ts` has held the join contract and the required attribution
  string since it was written, and deliberately downloads nothing. Work: `mtg-1j00i.2`.
- Our sim log mirrors 17lands' **replay** dataset, not their **game** dataset. The per-card
  `deck_` / `drawn_` / `opening_hand_` columns that win-rate-when-drawn is computed from are not
  emitted, so rung 3's better half is a schema change and a rerun, not a query. Work: `mtg-1j00i.3`.
- The rungs must be computed under 17lands' own column names, which is the whole reason
  `packages/sim/src/log/schema.ts` adopted their vocabulary. Comparability across the rungs is the
  payoff.
- Rung 2 needs no ingest work: the artifact already carries its source and version, and
  `printedDraftRatingsPolicy` already stamps a policy string from it. What it needs is for the
  printed and generated lanes to resolve a rating through one ladder rather than two unrelated
  paths, since today `printed-draft-ratings.ts` and `@mtg/draft-export`'s `rating.ts` do not know
  about each other.
- Three staged printed formats carry no Forge ranking at all (`akh-hou`, `m15`, `scd`), so the
  ladder has to fall through cleanly rather than assume rung 2 is present wherever a printed format
  is.

## 5. What this does not decide

**How the toggle behaves.** Not *where*: the surface exists. `#/play/draft` is a human draft pick
loop — `runHumanDraft` in `@mtg/draft-export` deals the packs, `packages/ui/src/routes/draft/`
draws them across 1,454 lines, a tap selects and a button commits, and `DraftGame.ts` hands the
finished 45-card pool to the deck builder and the played table. No rating is drawn on any of it
today, which is the gap the playtester's request names. What is undecided is the interaction: where on
the pack a number sits, whether the toggle is remembered per browser the way `mtg.feedback.enabled`
is, and what the card shows in the ordinary case where the set's only source is rung 3.

> **Correction, 2026-09-20, same day.** The first version of this section said no draft surface
> existed, and so did the finding on `dec-h80y` and what I reported to the playtester. The check behind
> it was `UI_MODES`, which lists four top-level modes and has never listed Draft, because Draft is
> a *section* under Play (`UI_SUBS.play`), wired through `PlayRoute` with its own chooser, its own
> bot column and its own LAN seat callback. Reading a mode list to answer a question about surfaces
> was the error. The ladder above is unaffected: what changed is that every rung has somewhere
> to be displayed now rather than after a scope call.

**Whether the evaluator's rank survives rung 3.** It ships first because it exists. Whether it is
retired once simulated win rates land, or kept as a second labeled source, is deferred until there
is something to compare.

**Cross-set comparability of our own numbers.** ADR-0003's limit stands: the evaluator's rating is
ordinal within one set. A win rate is not, which is one more reason the source has to travel with
the number.
