# Jev as the judgment behind the bots (`mtg-h76gz`)

Status: **partial measurement.** The free tier rate-limited the probe after 5 successful calls, so the
recommendations below rest on 4 scored draft picks, code reading and arithmetic. No gameplay call was made.
Per the bead, the probe stopped when the limit hit rather than upgrading anything.

## What was measured

Probe count: **7 logical calls of the 300-call cap** (1 smoke test, 4 draft picks, 2 rate-limited: the fifth draft
pick, and one retry of the smoke test about 2 minutes later). Each rate-limited call was three SDK attempts, so at
most 11 requests reached the gateway. Inputs and raw answers are in `out/jev-probe/calls.jsonl` (gitignored);
`gen-picks.ts`, `jev.mjs` and `draft.mjs` beside it regenerate the inputs. `out/` belongs to the worktree, so the four
scored answers are reproduced in the appendix. The key was read from omni-experiments' `.env` at run time and appears
in no file, commit or bead (checked by searching the worktree, the branch's diff and the three beads for it).

The rate limit, as recorded. The smoke test ran at 15:17:32 UTC and the four picks at 15:17:41.5 to 15:17:42.7, about
0.4 s apart. The fifth pick, immediately after, failed with `GatewayRateLimitError: Free tier requests on this model are
rate-limited`, and so did the retry at 15:19:28. The error carries no quota, window or retry-after. So what is known is
that a back-to-back burst trips it within 5 calls; whether a paced run (one call every few seconds) would clear it is
**untested**. That matters to the follow-up below: "the free tier cannot carry ~1,000 calls" is not established.

Method. `gen-picks.ts` seats an 8-seat pod on the flagship set fixture, every seat playing the Draftmancer
`SimpleBot` mirror (`rating + 0.35 x on-color picked`), and records seat 0's pack and pool at every pick (78
decisions across 2 pods). Each probe call gave Jev the pool so far and one `choice` question whose options are the
pack's cards, each with a one-line criterion (name, cost, type, rarity, colors, oracle text). Each line also carries a
stray empty `[]` (the script read a card field that does not exist); it is the same on every option and every call.

Baseline named: the current bot's pick. **This checkout holds no human pick data** (the calibration campaign's
human evidence, `packages/metrics/src/legacy-cube-calibration/human-evidence.ts`, is for printed cubes, not this set),
so "agreement with the bot" measures disagreement, not error.

| Pick (pod/round/pick) | Pack | Jev's pick: p, position in the bot's order | Jev's p for the bot's pick (Jev's rank) |
| --------------------- | ---- | ------------------------------------------ | --------------------------------------- |
| 0/1/1                 | 13   | .27, 2nd                                   | .05 (7/13)                              |
| 0/1/2                 | 12   | .27, 2nd                                   | .03 (11/12)                             |
| 0/1/3                 | 11   | .25, 5th                                   | .04 (7/11)                              |
| 0/1/4                 | 10   | .27, 10th (last)                           | .16 (3/10)                              |

Card names are left out of this document on purpose (the public-boundary check fails on the flagship set's source
terms in tracked text); the names are in `out/jev-probe/calls.jsonl`.

What the four rows do and do not show (n = 4, so these are observations, not rates):

- Jev agreed with the bot on 0 of 4.
- Its distribution over a 10-13 card pack is flat: top probability 0.25-0.27, and `typesafe.confidence` 0.17-0.21. The
  canary's 96.6% accuracy was on answers at confidence >= 0.9; on an open pick from a set that exists in no training
  corpus, none of the four came near that gate. A confidence gate would have rejected all four.
- Per-option probabilities are returned, so an unchosen option does get a score. Whether that score tracks anything
  (win rate of the resulting deck, a human's pick) is **unmeasured**.
- Latency 380-418 ms; 879-1042 input tokens, 147-190 output tokens; gateway `marketCost` $0.000037-0.000044 per call
  (gateway `cost` was 0 on the free tier).
- Repeat stability was **not measured** (the repeat pass was never reached). The canary's 96% is the only figure, on a
  different task.

## Scale

Decisions per game are **367.5** (measured, `docs/research/prior-art-learned-evaluators.md` §7.1); the
balance sweep is 10,035 games, so about **3.7M decisions**. Using the measured 0.4 s and $0.00004 per call:

| Use                                         | Calls  | Serial latency            | Cost at market rate |
| ------------------------------------------- | ------ | ------------------------- | ------------------- |
| Balance sweep, every decision to Jev        | ~3.7M  | ~17 days                  | ~$150               |
| One game, lab opponent (half the decisions) | ~180   | ~72 s of waiting per game | ~$0.007             |
| One draft pod, 7 bot seats x 39 picks       | ~273   | ~1.8 min                  | ~$0.011             |
| Cube availability run, 25 drafts x 8 seats  | ~7,800 | ~52 min                   | ~$0.31              |

the flagship set's packs hold 13 cards, so a seat makes 3 x 13 = 39 picks (the probe's 78 decisions are 2 pods x 39).
A 15-card printed-cube pack makes it 45, which scales the two draft rows by 15/13. An availability run has no human
seat, so all 8 seats are bots.

None of these has been shown to fit the free tier. A back-to-back burst of 5 calls did not (see above); a paced run was
not tried.

## Recommendations per decision point

1. **Live draft pick by Jev (bots in a pod, the lab's draft opponent): do not build.** Disagreed on 4 of 4, confidence
   0.17-0.21, and it needs a vendor call per pick. Needs the playtester to relax "no LLM / nothing that requires a vendored
   API / deterministic" (mtg-bw8z, 2026-08-21), and four picks give no reason to ask.
2. **Live gameplay by Jev (sweep, lab opponent): do not build.** Same ruling problem, plus 17 days serial for the sweep
   and ~72 s of vendor waiting per lab game. Not probed.
3. **Jev as an offline labeler for draft picks, recorded and distilled: cleared, and the bounded measurement is
   the work.** Every answer is stored, nothing in a game calls a vendor, replay stays bit-exact. It is the
   only candidate that answers mtg-bw8z.2's missing label (a rating for an unchosen action). It is not yet earned: the
   label must be shown to predict something (draft-deck win rate under the balance harness, or agreement with human
   picks on a printed cube where human data exists). It needs ~1,000 calls at a rate the gateway admits. Whether the
   free tier can supply that is untested (a paced probe is the first step, and costs nothing); if it cannot, paying is
   the playtester's call.
4. **Jev as an offline labeler for gameplay actions: defer.** mtg-bw8z.2's own route (seeded exploring self-play with
   outcome regression) produces labels grounded in what the kernel actually did; a Jev label is a prior about a game
   state it must be shown as text. Revisit only if (3) succeeds.

Ruling status. (1) and (2) need it relaxed. (3) and (4) keep the two halves that concern a game: no LLM in the play loop,
and deterministic play, since the shipped artifact would be recorded labels or weights distilled from them. They do
**not** clearly keep the third half. mtg-bw8z states it as "NO LLM IN THE PLAY LOOP, AND NO VENDORED API ANYWHERE" and
expands it to "no hosted inference, no key, no per-call bill"; a labeling run is hosted inference with a key, even
though the bot that ships never calls it. Whether "anywhere" reaches a one-time data-labeling step is the playtester's reading
to make.

**She made it on 2026-09-19 (decision `dec-m7zo`): yes, a one-time offline labeling run may call Jev.** The
reading is that "no vendored API anywhere" governs what ships and what a game does, not a recorded data step
whose output is a file. Three conditions come with it and none of them is optional. Free tier only, paced
under its rate limit: if the paced probe does not clear, that is the finding, and paying is a separate
decision that is hers and has not been made. Every answer is recorded, including the per-option
probabilities rather than only the chosen pick, because predicting anything is what the study has to show.
And mtg-bw8z is otherwise untouched: no model in the play loop, no vendored API in anything that ships,
play stays deterministic, so (1) and (2) remain **do not build**. (4) stays deferred on its own merits
rather than on the ruling.

The probe this bead ran was authorized by the bead
itself and is not a precedent for a larger run. The ruling also leaves a local model on the GPU open for drafting
(mtg-bw8z: "explore only, not approved to build"); whether Jev's weights can be obtained and run locally was not
investigated, and if they can, that arm needs no relaxation.

## `@mtg/llm` fit

`LlmProvider.complete<T>` takes a prompt plus a Zod schema and returns a typed value, and `PROVIDER_NAMES` is a closed
list (`fixture | claude-cli | anthropic-api`). Jev's `evaluate` takes a state object plus typed questions and returns
per-option probabilities, not a schema-conforming completion. Forcing it through `complete` would discard the
probabilities, which are the only reason to use it. Recommendation: a second, narrow seam in `@mtg/llm`
(`evaluate(state, questions)` returning probabilities, with the same `BudgetGuard` and cost accounting), a `fixture`
arm for tests and CI, and a `jev` arm behind an explicit budget flag with no default, as `--backend fal` does.

## Follow-up beads

Filed under this bead, one per recommended build, and nothing else is recommended:

- `mtg-h76gz.1`: the `evaluate` seam in `@mtg/llm` with fixture and jev arms (the prerequisite for item 3). No game code
  calls it, so it does not touch the ruling.
- `mtg-h76gz.2`: the offline labeler study (item 3). The ruling above cleared it, so it is labeled `ready/agent`
  and the paced free-tier probe is the first and only step it may take unassisted. Any spend goes back to her.

## Not done

- No gameplay call, so nothing here compares Jev with the greedy bot's choice or with game outcomes; items 2 and 4 are
  argued from arithmetic and from mtg-bw8z.2.
- Repeat stability, deck win rate and agreement with human picks were not measured. n = 4 picks, all from pick 1 to 4 of
  round 1 of one pod.
- A paced probe of the free tier was not tried. The bead said to stop at the first rate limit, and the probe did.
- Whether Jev can run locally was not investigated.

## Appendix: the four scored answers

One JSON object per pick. `jevInBotOrder` is Jev's probability for each option in the order the bot ranks the pack, so
index 0 is the bot's pick and the largest entry is Jev's pick. That is enough to recompute the table without calling
Jev again: Jev's pick is the position of the maximum, and the bot's pick's rank is one plus the count of larger entries.
Options tied on the bot's score (pick 1 and pick 2, both below the top three) sit in an arbitrary order; nothing in the
table depends on it.

```json
{"pick":"0/1/1","jevInBotOrder":[0.05,0.27,0.26,0.07,0.02,0.06,0.06,0.12,0.01,0.01,0.02,0.01,0.04]}
{"pick":"0/1/2","jevInBotOrder":[0.03,0.27,0.05,0.12,0.04,0.04,0.05,0.07,0.02,0.04,0.14,0.13]}
{"pick":"0/1/3","jevInBotOrder":[0.04,0.09,0.04,0.09,0.25,0.13,0.03,0.07,0.21,0.02,0.03]}
{"pick":"0/1/4","jevInBotOrder":[0.16,0.05,0.08,0.2,0.08,0.01,0.04,0.08,0.03,0.27]}
```
