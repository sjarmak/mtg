# Reusable Forge validation scenarios

The pilot tracked by `mtg-596p.13` replaces repeated full-game setup with exact starting positions exercised through the application's actual Forge bridge. It does not change format admission or any running preview.

## What is reusable

`packages/forge-export/src/observed/scenario-state.ts` defines a strict, bounded initial state: two seats, life, active seat, starting phase, and ordered card names in hand, library, battlefield and graveyard. The bridge reuses Forge's native `GameState` loader, then verifies the loaded zones, life, active player and phase before exposing the first decision. Duplicate card names still receive distinct object identities.

`installedForgeScenarioBackend(state, options)` is a verification-only constructor imported directly from `src/observed/installed.ts`, not the package entrypoint. Normal matches cannot pass scenario state through `SessionSpec` or `installedForgeBackend`. A scenario backend has a distinct `-verification-scenario` identity; its JSON fixture is written with mode `0600` inside its owned runtime and removed on shutdown. Forge remains an external JVM, using the installed card scripts.

Each interaction family owns one executable scenario and a small table of subjects. Adding another matching card means adding fixture data, not another game-driving implementation. A genuinely different interaction requires another contract and assertions.

| Scenario | Subjects | Evidence |
| --- | --- | --- |
| Local exert, accept and decline | Ahn-Crop Crasher, Glorybringer, Gust Walker | Offered choice, invalid move rejection without advancing submission count, exact source/target identity, payoff, temporary effect expiration, skipped and recovered untap |
| Fixed-cost cycling | Censor, Sweltering Suns, Desert of the Indomitable, Miscalculation | Actual activation, discard as cost before resolution, mana payment, exactly one specified draw |
| Native exert opportunity | Same three exert subjects | Native bot chooses the attack and exert; local seat only passes/responds; payoff and skipped/recovered untap; opponent hand stays hidden |

The exert callback now checks the exact `OptionalAttackCost` structure instead of card names: one unsuppressed ability belonging to the source, `Card.Self`, `Exert<1/CARDNAME>`, a defined trigger and no unrecognized parameters. Payment retains the exact zero-mana/source-exert cost checks. Other callbacks and outer card/format admission gates remain in force.

## Run the pilot

The installed tests deliberately fail when Forge is required but unavailable. A default suite skips them and therefore does **not** prove these interactions.

```bash
MTG_REQUIRE_FORGE_BRIDGE=1 MTG_TEST_WORKERS=1 npx vitest run --project unit \
  packages/forge-export/test/bridge-scenario.integration.test.ts \
  packages/forge-export/test/bridge-exert-contract.integration.test.ts \
  packages/forge-export/test/bridge-cycling-contract.integration.test.ts \
  packages/forge-export/test/bridge-exert-bot-scenario.integration.test.ts \
  --reporter=default --reporter=json \
  --outputFile=out/validation-pilot/installed-contracts.json
```

Each family compiles the bridge once and reuses those classes across isolated JVM sessions. Cases remain serial by default in this command to bound contention. The JSON output is a local test report, not an admission receipt. Explicit reporters replace the repository's custom load reporters for this focused run; ordinary nonzero test exits remain failures.

For the launch boundary and schema without Forge:

```bash
MTG_TEST_WORKERS=1 npx vitest run --project unit \
  packages/forge-export/test/bridge-scenario.test.ts \
  packages/forge-export/test/installed-backend-lifecycle.test.ts \
  packages/forge-export/test/bridge-glorybringer.test.ts
```

## Measurements and limits

On September 12, 2026, the initial ten local exert/cycling cases passed in 37.96 seconds for the combined test invocation. The native three-case run with favorable combat opportunities passed in 22.25 seconds. The final combined run passed all 14 installed cases in 91.50 seconds, retained at `out/validation-pilot/installed-contracts.json`. These are observed test-run durations, including compilation and startup, not estimates of format completion or a controlled comparison with the old process. The full repository suite encountered repeated load-classified timeouts and was interrupted; it is not a green gate.

The native tests deliberately do not force engine-seat actions. A first fixture used two double-strike blockers and failed to elicit exert from the ground creatures. A favorable board with supporting attackers and ordinary blockers elicited all three native interactions. Retained local reports distinguish these outcomes (`out/validation-pilot/native-exert.json` and `native-exert-cats.json`). This demonstrates why opportunity coverage and strategic judgment must stay separate from rules execution; it is not evidence that the bot handles every board well.

Name-only state setup bypasses ordinary drawing/casting/entry history and does not prove physical printing identity, product collation, mana feasibility, an entire card's clauses, cross-mechanic composition or an entire format. The pilot supports only fresh untapped battlefield cards, the four named zones and two starting phases. It is not a general saved-game loader. Cases fail on unexpected decisions, missing outcomes and bounded step exhaustion; there is no fallback that calls an unreached interaction covered.

## Binding scenarios to copied runtime inputs

The exert, cycling and native exert tests now use `test/support/snapshot-backend.ts`'s `snapshotForgeScenarioBackend`. With `MTG_FORGE_TEST_SNAPSHOT` set, it verifies the copied runtime, imports the copied adapter and uses the copied compiled bridge. Invalid state, a missing manifest, changed runtime bytes, a missing scenario constructor or a caller-supplied bridge override fails without falling back to the workspace. Without a snapshot, the same tests keep their ordinary installed-Forge path.

Successful opens record the exact normalized starting state and its SHA-256, seed, turn bound, format and ordered seat controllers in the existing snapshot usage journal. Failed opens do not count as executions, and a journal-write failure closes the opened session. This is execution provenance, not a rules-outcome assertion: the scenario's test still has to pass. The ordinary whole-game probe validator deliberately rejects these scenario rows, so the new setup seam cannot silently produce whole-card receipts.

The focused launch/report tests initially passed 40 assertions, with 94.49% line and 86.2% branch coverage on the shared snapshot helper. The installed cycling fallback passes all four cases. The first copied-runtime exert run passed all nine assertions but its coordinator rejected incorrectly specified parameterized assertion names; that retained run is not a successful receipt-producing run. A corrected run at `out/validation-pilot/snapshot-exert-scope` passed all nine assertions and reached the intended scenario-scope rejection: no ordinary probe receipts were written.

## Source-bound scenario receipts

The existing probe CLI now accepts explicit `scope: "scenario"` definitions. A suite cannot mix these with ordinary card/match claims. It still compiles and snapshots once, runs the exact selected assertion population, remeasures runtime and test sources after execution, and writes evidence only after every check succeeds.

```bash
npx tsx packages/ui/tools/printed-probe-cli.ts \
  --config packages/ui/data/akh-hou-exert-scenarios-v1.json \
  --out out/validation-pilot/exert-scenario-receipts-v1 \
  --timeout-ms 300000
```

The output directory must not already exist. The recorded September 12 run at that path exited zero with nine passed assertions and six receipts: local/native evidence for each of the three exert subjects. The two test files took 30.85 and 20.67 seconds inside the invocation; these exclude coordinator setup and are not a whole-format throughput claim.

`printed-scenario-probe-receipt` is a separate artifact kind in `@mtg/printed-card`. It binds the measured runtime, exact source script path/hash checked against the copied archive, portable test/support source paths and hashes, ordered source seat/controller, each scenario state hash/seed/turn bound, and retained report/journal byte hashes. Matching catalog reprints share a script binding; receipts do not name physical printing IDs or certify catalog legality. The ordinary play receipt schema refuses this artifact kind.

The usage journal records Vitest's actual expanded title, ancestor title array and task ID. Matching uses the exact file and structured titles, not replacements between the live name's ` > ` separators and the JSON report's spaces. The report's flattened label must agree with its structured identity; duplicates, omitted cases, foreign runtime, wrong source controller, absent source card and changed state hashes fail. Each current assertion must open exactly one scenario session; multi-session assertions need a future explicit case model, not silent aggregation.

Thirty-four receipt schema/assembler/matcher tests pass with 100% line and 96.96% branch coverage. An independent review also ran the snapshot and ordinary receipt regressions. This is a trusted-local producer, not a cryptographic attestation service: outcome assertions still require reviewed tests, and hashes do not make self-authored evidence authoritative.

The installed CLI integration passed both outer tests with no skips, independently rerunning all nine scenario assertions and checking the six persisted receipt schemas plus report/journal digests (`out/validation-pilot/scenario-run-integration.json`). The full repository run remains non-green: at two workers it hit the existing Cube quality-pipeline timeout, then was explicitly interrupted after diagnosis. Repeated canonical reconstruction is tracked by `mtg-eloo.1`; no test clock was increased.

## Consuming retained evidence

`packages/ui/tools/printed-scenario-verify.ts` now checks retained receipts against independently supplied reviewed probe definitions, current source/catalog bindings and measured runtime identity. It reconstructs the expected scoped claims from the actual report and journal bytes using the same strict checks as issuance, then compares every field and the exact receipt population. Changed runtime, script, test source, claim, case context or retained bytes fails. Rewriting a checksum cannot bless a failed report or a false source-controller observation.

The retained-file reader requests only fixed report/journal names and probe filenames derived from schema-checked reviewed IDs. It never follows paths supplied by a receipt. Its caller owns evidence-root confinement and must obtain expectations independently, not copy them from the submitted artifact. This remains trusted-local evidence, not a signed external attestation. Recorded report/journal test paths still use the producing workspace; relocation of retained execution reports is not yet supported by this API.

The existing producer now reads its saved files through this consumer before reporting success. The installed integration first failed specifically because that call was absent, then passed both tests with no skips after wiring it in: `out/validation-pilot/scenario-consumer-integration.json`. This executed nine real Forge cases and verified six persisted receipts. The 48 schema/matcher/receipt tests pass; the consumer has 100% line, branch and function coverage, and the three producer/matcher/consumer modules together have 100% line and 96.55% branch coverage. Qualification is still `unproven`.

Full AKH/HOU draft, sealed and play support remains the goal of record, `mtg-f0m8i`. These receipts do not complete that goal or `mtg-596p.14`: exact-script composition, generated-object dependencies, residual clause coverage, admission integration and broad bot opportunity sweeps remain required. Runtime archive/resource hashes and the whole shared support tree currently invalidate conservatively; targeted invalidation has not been implemented. No format admission or live preview changes are made by these tests.

The durable continuation is `mtg-596p.14` (source-bound contract receipts, exact-script reuse and invalidation) and `mtg-596p.15` (broad through-bridge bot sweeps and opportunity/callback coverage). Existing admission work remains `mtg-596p.3`. Reusing capability evidence must preserve uncovered clauses and composition obligations; a shared mechanic label is never enough to qualify a card.
