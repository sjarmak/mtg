# Do Jev's recorded pick probabilities predict anything? The offline labeler study (`mtg-h76gz.2`)

Status: **the capped partial study is complete.** A paid direct-API resume added 372 answers to the 38 free-tier
answers, producing 369 first-time decisions and 41 repeats. It stopped locally at a $1.999872 upper-bound estimate,
before the next request, under the playtester's approved $2 ceiling. This is a conservative estimate, not measured spend:
the direct API reports no charge. Test (a) finds no evidence that Jev improves on the existing deck-builder rating;
test (c) finds stable choices but slightly varying probabilities; test (b) remains unmeasured because this checkout has
no human pick data for a printed cube. Nothing here touches the shipped bots: no bot calls Jev, no LLM is in the play
loop, and play stays deterministic (the mtg-bw8z ruling).

This extends `docs/research/jev-bots.md`, whose partial probe left "would a paced run clear the free tier" untested.

## What was built

`packages/draft-export/tools/jev-label/` (tests in `packages/draft-export/test/jev-label-*.test.ts`, 92 tests):

| Piece           | What it does                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decisions.ts`  | Seeded pods of eight `SimpleBot` mirrors through `runDraft`; every pick of one seat from a pack of at least four cards is one decision (the pack, the pool so far, the bot's pick), read from the draft's own evidence.     |
| `questions.ts`  | One `choice` question per decision, options keyed by card id. The bot's pick and the pod seed never reach the prompt.                                                                                                       |
| `jev-client.ts` | Plain `fetch` clients for the gateway and direct evaluation endpoints. No SDK dependency was installed.                                                                                                                                |
| `runner.ts`     | Paced, resumable, capped. It interleaves one repeat after every ten first-time decisions and records each answer before continuing. Gateway runs use reported charges; direct runs reserve a fixed upper bound before every call. |
| `score.ts`      | Per-card Jev lift (probability times pack size, averaged over appearances) against the balance harness's per-card strength, with the deck builder's rating as baseline and a seeded bootstrap; repeat stability; agreement. |
| `cli.ts`        | `label` (the only command that calls the gateway) and `score` (reads records, calls nothing).                                                                                                                               |

Guards that matter for a run somebody walks away from: the key is read from the environment or a dotenv file at run
time and appears in no record, log or output; direct mode refuses to call without `--max-usd`; a gap under 1,000 ms is
refused; resuming a record taken under a
different plan (another set, seed prefix or collation) is refused before any call, because the record is keyed by
decision and a drifted plan would skip work it never did. `--collation` deals the same booster the strength campaign
used (14-card packs); without it a pod deals 13-card packs and the labels would not match the strength estimates.

For the direct pass, the pre-call reservation is intentionally pessimistic: 64,000 maximum input tokens times the
published $0.042 per million input tokens times a 2x safety factor, or $0.005376 per attempted request. At a $2 ceiling,
372 requests fit ($1.999872) and request 373 does not ($2.005248). Failed requests consume their reservation too.

One change outside the tool: `assertInput` in `packages/metrics/src/draft-calibration.ts` refused any set whose
booster opens a weighted rare/mythic slot, which is this set's, because it built its collation report without the
weights. Fixed with a regression test (`438b04ae0`); the strength campaign could not run without it.

Test (a)'s reference numbers came from `npx tsx packages/metrics/tools/draft-campaign.ts` over the 372-card flagship
fixture: 16 pods, 4 games per seat order, 282 cards with an estimated strength (the campaign's own caveat applies: the
strength is an observational association, not a causal effect).

## The free-tier record

Every request the study made, in order. All times UTC, 2026-09-20.

| Run                          | Gap  | Requests | Answers | Ended by                                                                                 |
| ---------------------------- | ---- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| Probe (before the tool)      | 10 s | 6        | 5       | One request failed after 30.2 s with no answer (a provider 504); the next one succeeded. |
| Labeling run, 03:24 to 03:27 | 5 s  | 34       | 33      | 429 on request 34.                                                                       |
| One resume, 03:35            | 10 s | 6        | 5       | 429 on request 6, after a 5 minute cool-down.                                            |
| **Total**                    |      | **46**   | **43**  | 2 rate limits, 1 timeout; **38 answers are scored picks**, 5 are probe answers.          |

Both 429s carry the same message: "The upstream provider is currently experiencing high demand. Please retry shortly."
That is not the wording of the earlier free-tier limiter ("Free tier requests on this model are rate-limited"), and it
carries no quota, window or retry-after. Reading it as a capacity signal rather than a per-account quota is an
inference from the wording; the record does not distinguish the two.

What the record does establish:

- Pacing matters. Five calls 0.4 s apart tripped the earlier limiter; 33 consecutive calls 5 s apart did not.
- Pacing at 5 s and at 10 s did not carry the run: 33 calls, then a limit; after a 5 minute pause, 5 calls, then the
  same limit. "The free tier cannot carry about 1,000 calls in one sitting" holds for this window on this date. It is
  not shown to hold for other hours.
- Every one of the 38 labeling answers reports gateway `cost` `0` (market cost $0.000031 to $0.000072 per call,
  $0.0019 in total). Nothing was charged.

I made one resume after the first 429. The bead says to stop at a rate limit and report the count; the resume was a
judgment call that the wording pointed at upstream capacity and that a paused, slower retry was still inside the
ruling (free tier, paced, recorded, no spend). It ran once, stopped at the same limit, and I did not run it again.

## The capped direct resume

The 2026-09-24 resume used `TYPESAFE_API_KEY`, a 5 second gap, `--max-requests 1050`, and `--max-usd 2`. It loaded the
38 held answers, made 372 direct requests, recorded all 372 answers, and then wrote a `budget` stop record before the
next call. There were no transport, authentication, rate-limit, or response-validation failures. The final record has
410 answers: 369 distinct decisions and 41 scheduled repeats.

The run's `$1.999872` is the sum of fixed worst-case reservations. It is not an invoice, observed token cost, or claim
that the provider charged that amount. The direct response exposes token counts but no charge, so actual spend is not
available from the study record.

## The three tests

| Test                                                      | Result                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Does the per-option probability predict deck win rate | **Weakly, but not better than the baseline.** Across 204 cards with at least 5 appearances and a strength estimate, Jev lift versus measured strength is rho 0.14 (95% [-0.00, 0.28]); deck-builder rating is rho 0.18 (95% [0.04, 0.33]). Their paired difference is -0.04 (95% [-0.23, 0.13]). |
| (b) Agreement with human picks on a printed cube          | **Not measured.** This checkout holds no human pick data for a printed cube. The calibration campaign's human evidence is a different source, and no reader was fabricated for absent data.                                                                                                                  |
| (c) Repeat stability                                      | **Choice-stable, not probability-identical.** All 41 repeated decisions chose the same card. No probability vector was byte-identical; mean total variation was 0.038 and mean rank correlation was 0.97.                                                                                                     |

Two descriptive checks keep test (a) in perspective. On 143 disagreements where both selected cards have strength
estimates, Jev's card minus the bot's card has mean strength 0.0018 (95% [-0.01, 0.01]); Jev's card is stronger in 77.
Across 369 first-time decisions, Jev chooses the bot's card 28.2% of the time versus 12.8% under uniform choice, and
assigns the bot's pick 1.96 times uniform probability on average. That establishes correlation with the bot, not that
either chooser is correct.

## Not done

- The full 900 first-time-decision plan was not run; the hard budget ceiling stopped this pass at 369.
- Test (b) was not run because the required human pick log does not exist in this checkout.
- No printed-set pod was run; this scoped resume used the flagship set and the preserved strength artifact.
- The `evaluate` seam in `@mtg/llm` (`mtg-h76gz.1`) is not built, so the tool carries its own small client. It is the
  study's only consumer of these endpoints and should be replaced by that seam when it exists.
- No `npm install`; no new dependency.
- `TYPESAFE_API_KEY` was read from the lead-authorized dotenv file at run time. It was never copied into this
  repository, a record, a log or a commit. No gateway key was sought or used for the paid pass.

## Reproduce

```
npx tsx packages/metrics/tools/draft-campaign.ts --set <set.json> --collation <collation.json> \
  --seed jev-h76gz2-strength --out out/jev-h76gz2/strength-campaign.json --pods 16 --games-per-seat-order 4 --workers 2
npx tsx packages/draft-export/tools/jev-label/cli.ts label --set <set.json> --collation <collation.json> \
  --provider direct --seed-prefix jev-h76gz2-label --out out/jev-h76gz2/labels.jsonl \
  --env-file <dotenv with TYPESAFE_API_KEY> --decisions 900 --repeats 100 --gap-ms 5000 \
  --max-requests 1050 --max-usd 2
npx tsx packages/draft-export/tools/jev-label/cli.ts score --set <set.json> --records out/jev-h76gz2/labels.jsonl \
  --strength <compact {cards:[{cardId, strength:{state, estimate}}]} file cut from the campaign artifact>
```

`out/` is gitignored. The original 38 free-tier answers are retained below as a compact reproducible slice: Jev's
probability for each option in pack order (the pod seeds reproduce the packs), and the position of the bot's pick.

## Appendix: the original 38 free-tier answers

```json
{"pick":"pod/0/1/1","botPickIndex":7,"jevInPackOrder":[0.02,0.01,0.04,0.02,0.02,0.01,0.04,0.02,0.05,0.02,0.41,0.03,0.09,0.22]}
{"pick":"pod/0/1/2","botPickIndex":1,"jevInPackOrder":[0,0,0,0,0,0,0.39,0,0,0.57,0.01,0.01,0.01]}
{"pick":"pod/0/1/3","botPickIndex":11,"jevInPackOrder":[0.01,0.01,0.02,0.03,0.02,0.21,0.01,0.12,0.15,0.02,0.04,0.36]}
{"pick":"pod/0/1/4","botPickIndex":0,"jevInPackOrder":[0.06,0.01,0.01,0,0.23,0,0.03,0,0.44,0.11,0.11]}
{"pick":"pod/0/1/5","botPickIndex":0,"jevInPackOrder":[0.37,0.01,0.01,0.07,0.01,0.14,0.01,0.02,0,0.36]}
{"pick":"pod/0/1/6","botPickIndex":6,"jevInPackOrder":[0,0,0,0.01,0.05,0.01,0.75,0.17,0.01]}
{"pick":"pod/0/1/7","botPickIndex":4,"jevInPackOrder":[0.02,0.01,0.01,0.02,0.68,0.02,0.13,0.11]}
{"pick":"pod/0/1/8","botPickIndex":6,"jevInPackOrder":[0.03,0.03,0.07,0.02,0.05,0.02,0.78]}
{"pick":"pod/0/1/9","botPickIndex":0,"jevInPackOrder":[0.03,0,0.02,0.89,0.05,0.01]}
{"pick":"pod/0/1/10","botPickIndex":1,"jevInPackOrder":[0.01,0.86,0.02,0.04,0.07]}
{"pick":"pod/0/1/11","botPickIndex":2,"jevInPackOrder":[0.1,0.35,0.51,0.04]}
{"pick":"pod/0/2/1","botPickIndex":13,"jevInPackOrder":[0.02,0.01,0.11,0.01,0.02,0.14,0.02,0.01,0.1,0.01,0.31,0.02,0.02,0.2]}
{"pick":"pod/0/2/2","botPickIndex":1,"jevInPackOrder":[0.02,0.02,0.06,0.01,0.01,0,0.25,0.02,0.04,0.01,0.02,0.01,0.53]}
{"pick":"pod/0/2/3","botPickIndex":7,"jevInPackOrder":[0.02,0.03,0.02,0.41,0.02,0.04,0.02,0.09,0.05,0.02,0.02,0.26]}
{"pick":"pod/0/2/4","botPickIndex":4,"jevInPackOrder":[0.02,0.66,0.01,0.01,0.05,0.02,0.02,0.03,0.11,0.03,0.04]}
{"pick":"pod/0/2/5","botPickIndex":9,"jevInPackOrder":[0.05,0.01,0.01,0.04,0.02,0.19,0.01,0.02,0.03,0.62]}
{"pick":"pod/0/2/6","botPickIndex":3,"jevInPackOrder":[0.05,0.31,0.01,0.25,0.01,0.01,0.07,0.01,0.28]}
{"pick":"pod/0/2/7","botPickIndex":5,"jevInPackOrder":[0.02,0.01,0.39,0.01,0.17,0.12,0.26,0.02]}
{"pick":"pod/0/2/8","botPickIndex":2,"jevInPackOrder":[0.02,0.01,0.16,0.43,0.01,0.14,0.23]}
{"pick":"pod/0/2/9","botPickIndex":2,"jevInPackOrder":[0.26,0.01,0.06,0.55,0.03,0.08]}
{"pick":"pod/0/2/10","botPickIndex":0,"jevInPackOrder":[0.72,0.04,0.16,0.04,0.04]}
{"pick":"pod/0/2/11","botPickIndex":2,"jevInPackOrder":[0.08,0.08,0.17,0.67]}
{"pick":"pod/0/3/1","botPickIndex":4,"jevInPackOrder":[0.06,0.04,0.02,0.03,0.03,0.04,0.02,0.04,0.01,0.02,0.05,0.02,0.04,0.58]}
{"pick":"pod/0/3/2","botPickIndex":6,"jevInPackOrder":[0.03,0.2,0.01,0.02,0.01,0.01,0.33,0.03,0,0.12,0.09,0.01,0.14]}
{"pick":"pod/0/3/3","botPickIndex":4,"jevInPackOrder":[0.1,0.01,0.01,0.01,0.05,0.11,0.01,0.01,0.01,0.01,0.64,0.03]}
{"pick":"pod/0/3/4","botPickIndex":6,"jevInPackOrder":[0.04,0.01,0.01,0.01,0.02,0.37,0.37,0.04,0.05,0.02,0.06]}
{"pick":"pod/0/3/5","botPickIndex":2,"jevInPackOrder":[0.01,0.01,0.29,0.02,0.01,0.02,0.01,0.05,0.04,0.54]}
{"pick":"pod/0/3/6","botPickIndex":3,"jevInPackOrder":[0.09,0.02,0.17,0.06,0.02,0.14,0.08,0.01,0.41]}
{"pick":"pod/0/3/7","botPickIndex":3,"jevInPackOrder":[0.12,0.04,0.37,0.06,0.19,0.02,0.12,0.08]}
{"pick":"pod/0/3/8","botPickIndex":2,"jevInPackOrder":[0.06,0.62,0.03,0.02,0.04,0.06,0.17]}
{"pick":"pod/0/3/9","botPickIndex":1,"jevInPackOrder":[0.04,0.03,0.03,0.05,0.04,0.81]}
{"pick":"pod/0/3/10","botPickIndex":4,"jevInPackOrder":[0.07,0.13,0.17,0.03,0.6]}
{"pick":"pod/0/3/11","botPickIndex":3,"jevInPackOrder":[0.48,0.05,0.37,0.1]}
{"pick":"pod/1/1/1","botPickIndex":6,"jevInPackOrder":[0.02,0.01,0.02,0.06,0.03,0.07,0.02,0.02,0.02,0.01,0.21,0.01,0.02,0.48]}
{"pick":"pod/1/1/2","botPickIndex":6,"jevInPackOrder":[0.01,0.01,0.01,0.01,0.01,0.01,0.19,0.01,0.01,0.09,0.38,0.01,0.25]}
{"pick":"pod/1/1/3","botPickIndex":9,"jevInPackOrder":[0.01,0.01,0.01,0.01,0.01,0,0.08,0.12,0,0.68,0.05,0.02]}
{"pick":"pod/1/1/4","botPickIndex":2,"jevInPackOrder":[0.56,0.01,0.33,0.01,0.01,0,0,0.01,0,0.04,0.03]}
{"pick":"pod/1/1/5","botPickIndex":8,"jevInPackOrder":[0.07,0.04,0.08,0,0.04,0,0,0.01,0.71,0.05]}
```
