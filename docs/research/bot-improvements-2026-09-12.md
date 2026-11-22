# Bot improvements following the capability audit

The first implementation addresses printed Limited picks and construction together, plus two weak native gameplay decisions. It does not replace Forge's gameplay AI or introduce a learned evaluator.

## Behavior delivered

New AKH/HOU drafts use a versioned deck-value policy over the observed picked pool. Authored profiles cover all 550 printing entries in the pinned AKH, HOU, and MP2 catalogs. Picks consider card quality, color commitment, curve, interaction, synergy, and mana support. The same evaluation supplies deck suggestions and bot opponent construction. Basic-land suggestions use the current edited spell requirements.

Construction considers mono-color and two-color starting plans, 16–18 total lands, and bounded card swaps. Drafted lands count inside the land target. Physical card identities remain intact through construction, editing, restoration, and opponent selection. Unsupported formats retain their existing builder. Existing draft saves without an explicit policy retain the legacy policy; unknown policy identifiers fail explicitly.

Native greedy gameplay now chooses which scry cards to keep and in what order, and selects useful legal tutor targets. Choices consider lands already held, missing spell colors, flooding, and existing card values. Tests cover both seats, multiple revealed cards, optional tutor failure, and invariance under changes to hidden opponent cards or unrevealed library cards. These improvements apply to the native simulator; Forge gameplay is separate.

## Identical-pool diagnostic

Five pinned AKH/HOU sealed pools were built by both `suggestLimitedDeck` and `suggestPrintedDeck`. Inputs were seeds `diag-1` through `diag-5`, format fingerprint `d3bd903394881af34ee7ee3b976422646796d822c0ed7bcbcbe56089c0999c2e`. No pool was selected or discarded based on its result.

| Seed | Legacy spell colors | New spell colors | Legacy modeled support | New modeled support | New nonbasic lands |
| --- | --- | --- | ---: | ---: | ---: |
| diag-1 | WUBRG | UG | 0.600 | 0.778 | 1 |
| diag-2 | WUBRG | WB | 0.537 | 0.782 | 2 |
| diag-3 | WUBRG | WG | 0.504 | 0.788 | 2 |
| diag-4 | WUBRG | WB | 0.517 | 0.845 | 3 |
| diag-5 | WUBRG | WR | 0.599 | 0.806 | 0 |

All ten decks were legal 40-card decks with unique owned physical copies. Both policies had zero spells with exactly zero modeled support. Repeating `diag-1` produced identical new construction output.

“Modeled support” is the mean of the evaluator's land-drop and colored-source marginal products over selected spells. It is an approximate internal diagnostic, not an empirical cast-on-curve rate. The evaluator optimizes related quantities, so higher support is not independent evidence of strength. The clear observed change is color coherence, with legal construction preserved.

## Validation and limits

Focused coverage: 29 tests passed; 98.9% statements, 93.56% branches, and 96.15% functions across the new Limited evaluator, native library-choice policy, and printed deck wrapper. The mathematical tests include an exhaustive four-card draw oracle. Separate replay, UI, opponent-wiring, and compatibility tests exercise the integration. Repository and browser gate results follow below.

The profile judgments and weights are authored and uncalibrated. The model does not implement exact joint castability, tapped-land sequencing, ramp sequencing, combat evaluation, comprehensive splashes, or sideboarding. See `packages/draft-export/src/limited-evaluation/README.md` for provenance, tag conventions, cost overrides, and policy-version rules.

Two follow-ups preserve the next steps from the audit:

- `mtg-q0fqa`: frozen, held-out, paired evaluation separating drafting from construction, with completion rates, uncertainty and independent review. Printed gameplay qualification is a prerequisite for match-strength evidence.
- `mtg-cqcwm`: enforce the native player-observation boundary before learned feature extraction. Existing learned-evaluator work `mtg-bw8z` now depends on it. The new library policy avoids hidden information, but the wider `AgentView` contract still exposes full state.

During broader validation, small pre-existing Forge diagnostic errors were repaired: a nonexistent `ObservedDecision` type import became `PendingDecision`, and loose null comparisons became equivalent explicit null/undefined checks. The diagnostic-driver test passed after the repair.

Real Chrome verification passed for the complete 42-pick draft across reload and for the sealed pool editor. The draft browser case completed in 11.8 seconds and the sealed case in 5.4 seconds during the full run. Repository lint and formatting of the changed bot files passed.

The public-export boundary also required refreshing its generated printed-word and test-name registries. The existing store-backed tool recognized Gravedigger and Alaric Wu as printed names; the test census added reviewed printed names and generic fixture names. A Forge test title was reworded to avoid an unrelated private-name prefix collision. No printed-card profile was renamed or exempted wholesale from scanning.

The main format-health gate passed all 60 checks across three subjects and 30,105 games. Existing balance bands and drift limits were retained. This establishes that the native policy change passes the existing balance contract; it is not a head-to-head strength estimate. Typecheck passed after the coverage-plan test narrowed its scenario obligation before accessing scenario-only fields.

The full mixed-checkout run completed with 2,269 passing files, 23 failing files, and 181 skipped files (17,278 passing tests). It also reported five worker reporting-channel timeouts. That run is not a clean repository-wide receipt: heavy load caused timeouts, and concurrent Forge/schema work changed files during execution. Failed files were rerun against a separate frozen checkout snapshot; those results are documented below without reclassifying the original full run as green.

Four existing Forge guard tests were updated for the already-added Authority, Hope Tender, and Nimble Obstructionist routes. Independent review checked the actual Java boundaries and reran all eight assertions; the same eight passed in the main checkout. These repairs do not change Forge behavior.

The frozen-checkout rerun passed the reference translation/seed/milestone, Cube quality bundle/run/pair, block enumeration, answer-schema, public boundary, and printed coverage files that failed in the combined run. The existing full Cube quality pipeline repeated its 120-second timeout under reported load of 68.7 on 16 cores. Its reconstruction cost is already tracked in `mtg-eloo.1`; no timeout was raised. Whole-tree validation remains tracked in `mtg-eloo`.

The nested balance gate wiring also passed all five checks in the frozen checkout. A contended UI batch passed 38 of 45 tests, with five test-budget timeouts and two assertions still seeing loading states. Both loading assertions passed when isolated (Legacy Cube catalog loading and the printed-format root picker). These failures do not erase the earlier passing printed draft/sealed browser receipts, but they prevent claiming an entirely clean final repository gate.

The two-test DSL calibration probe passed in the frozen checkout with its unchanged budget. It took 569 seconds under reported peak load of 68.7 on 16 cores.

The final isolated printed draft file passed all four tests, including completing all 42 picks, suggesting a legal deck, and restoring it. That complete journey took 3.49 seconds under its unchanged five-second test budget. Subsequent serial reruns also passed the complete Legacy Cube route and printed-picker files.

Final failed-file disposition: 22 of the original 23 failing files now have passing reruns, including all 45 tests in the five UI files. Four Forge files required the reviewed assertion repairs described above. The remaining failing file is the existing full Cube quality pipeline (`mtg-eloo.1`). The original full-suite result remains red; subset reruns are not a clean whole-tree receipt. No commits, pushes, deployments, provider calls, or test-timeout increases were made.
