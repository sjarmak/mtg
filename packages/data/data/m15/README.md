# Magic 2015 (M15) printed Limited format

Registered, play-supported printed format, built entirely by the shared
printed-format tools; no M15-specific source file exists anywhere in the
workspace. The repo-local `make-set-playable` skill describes the process
this directory is the worked example of; Innistrad's
`packages/data/data/isd/README.md` is the fuller worked example this one
follows.

## Product and identity

M15 drafts as a single-set format, eight-seat draft M15/M15/M15 and six-booster
sealed, mirroring M12's recipe (`onboarding-format-v1.json`). Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 284
exact Scryfall printings of the set, mapped to 269 distinct Forge scripts.
`build-evidence.json` binds the format hash, the catalog hash, the source pin
hash and the Forge archive hash.

Current identity:

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `127811a57e811c4a6064b4f185c3c38e35ec5124889734a393ac8416d5d74cba` |
| catalog M15 `contentSha256`          | `93f568b56f99d400b97f2720cb61c5895ab429f8fb9cbd4474baae5139cf92e0` |
| source pin (`sources.json`)          | `814d999aed2feacad2b1b3e9748edf72fb60fbabcab75a9ae15bb8306c0fa914` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |

## Rebuilding

The source pin is `data/cache/m15-20260919-source-pin/` (MTGJSON 5.3.0+20260919
and the Scryfall snapshot fetched 2026-09-19; the raw snapshots are not
vendored). Each tool refuses an existing output directory, so bump the version
segment of every `out/m15/...` path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets M15 --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/m15/onboarding-format-v1.json --sources data/cache/m15-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/m15/build-v2
cp out/m15/build-v2/m15-printed-catalog-v1.json out/m15/build-v2/m15-limited-format-v1.json out/m15/build-v2/build-evidence.json packages/data/data/m15/
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/m15-20260919-source-pin --catalog packages/data/data/m15/m15-printed-catalog-v1.json > packages/data/data/m15/m15-display-metadata-v1.json
```

## Token printings

`m15-token-printings-v1.json` holds the 12 token printings M15 creates: each
row is one Scryfall token printing bound to the Forge token script whose facts
(name, colors, power and toughness, types) it matches, so the board draws a
token from the set's own token art rather than the labeled pending frame.
Every token M15's scripts create is bound; none is left to the pending frame.
Rebuild it with a new output path; the tool refuses an existing one:

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --sets TM15 --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins M15 at 254 of 254 cards
closed by the shared review table (`packages/data/data/forge-syntax-review-v1.json`);
24 tokens were added to that table for this set (811 -> 835 entries) and
`packages/data/data/forge-effect-controller-calls-v1.json` regenerated
alongside it (68 -> 75 modes). `packages/data/test/m15-printed-format.test.ts`
rebuilds the decision inventory and the complete coverage plan in-process and
proves every one of the 269 scripts' decision families is covered by the
reusable controller contracts. Every obligation in the coverage plan carries
`claims: []` — M15 needs no card-specific scenario evidence beyond the
structural "one local, one engine" minimum the probe runner requires, because
the reusable `printed-controller-contracts-protocol2-v6` bundle already covers
every family the set uses, Convoke's `mana-x` and `zone-card-selection`
included.

The same plan on disk, for the probe runner:

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/m15/m15-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/m15/decision-inventory-v2/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/m15/m15-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/m15/coverage-plan-prior-v1.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/m15/decision-inventory-v2/inventory.json --prior out/m15/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v6/manifest.json --output out/m15/complete-coverage-plan-v1/coverage-plan.json
```

## Scenario and match witnesses

`packages/forge-export/test/observed-m15-contract-witness.integration.test.ts`
carries the two `scope: "scenario"` witnesses the probe config
(`out/m15/probes/m15-scenario-probes-v1-config.json`) names, and only those
two — a local Flesh to Dust caster destroying the only legal creature, and
Forge attacking with Runeclaw Bear while the local seat only answers its own
decisions. M12's local-controller pattern card, Doom Blade, is not in M15's
catalog; Flesh to Dust (`{3}{B}{B}`, `Destroy target creature. It can't be
regenerated.`) is the structurally identical substitute (single unconditional
destroy, no sub-abilities, no conditional targeting).

M15's own Convoke card, Chord of Calling, is witnessed separately in
`observed-m15-convoke.integration.test.ts` (partial payment by tapping two
creatures, partial by mana, X announced, search resolves) as extra real-match
gameplay evidence, not as a qualification probe. That test uses
`installedForgeBackend` with a real 60-card deck; it cannot itself serve as a
`scope: "scenario"` probe (see "Friction fixed" below) and it does not need
to, because the coverage plan already shows Convoke's decision families are
fully covered by the reusable contract bundle with no card-specific claim.

The match config covers starting-player, mulligan, priority and the local
pregame over Forest and the shared `AUDITED_FORGE_CARD_NAMES` card Avacyn's
Pilgrim (`packages/forge-export/test/observed-m15-*.integration.test.ts`,
sharing `test/support/printed-match-probes.ts` with the fixture in
`test/support/m15-match-fixture.ts`). The portable `engineStarts` seed is
`m15-local-pregame-v4` (`-v1` through `-v3` failed with the engine seat losing
the toss); `localToss` (`1514`) was portable as-is.

Run with the CLI's actual contract:

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/m15/probes/m15-scenario-probes-v1-config.json --out out/m15/scenario-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/m15/scenario-probes-v1 --inventory out/m15/decision-inventory-v2/inventory.json --out out/m15/script-qualifications-v1
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/m15/probes/m15-match-probes-v1-config.json --out out/m15/match-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/m15/m15-limited-format-v1.json --catalog packages/data/data/m15/m15-printed-catalog-v1.json --qualifications out/m15/script-qualifications-v1 --match-probes out/m15/match-probes-v1 --out packages/data/data/m15/play-admission
```

The qualification bundle reports `qualified: 269, residual: 0`.

## Play admission

`play-admission-v2/` was a verified full-card and match admission for all 284
printings (269 exact scripts), built 2026-09-19 against Forge 2.0.14 and the
generalized bridge protocol 2 (`packages/forge-export/bridge/ForgeBridge.java`
accepts any printed format whose declared Forge game type is `Constructed`).
No `ForgeBridge.java` or adapter edit was made or needed for this set.
v2 re-binds v1 (built under the pre-`mtg-t5ma0` bridge, `a2f01d19...`) to the
Phyrexian-mana structural bridge (`53d03a0c...`); the format, catalog, adapter,
qualified script count (269) and residual (0) are unchanged. Re-bound with the
six-step recipe in `packages/data/data/isd/README.md`.
`packages/data/test/m15-printed-format.test.ts` re-verifies the installed
admission against the staged format and catalog on every run.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `m15`.

`play-admission-v4/` re-binds v3 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v5`.

`play-admission-v5/` re-binds v4 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v6`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v6/` re-binds v5 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v7` (`mtg-ziwde`).

`play-admission-v7/` re-binds v6 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v8/`.

`play-admission-v8/` re-binds v7 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v9/`.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `m15` entry with
`play.status: supported` and `admissionDirectory: play-admission`. The
launcher (`packages/ui/tools/play.ts`) reads every supported entry at boot and
`startBackendService` admits all of them behind one Forge identity, so M15
sits alongside the nine other registered sets, including sibling lanes
Gatecrash, Magic 2014 and Theros.

Card art is not staged: the catalog carries each printing's Scryfall image
URIs and `packages/ui/src/card/printed-card-art.ts` renders the `art_crop`
straight from `cards.scryfall.io` in the browser.

## Friction fixed (skill text corrections made in this branch)

- **`data/cache` and `out/validation-pilot` symlinks were missing** in this
  worktree even though `import-printed-set/SKILL.md` already documents the
  requirement ("A fresh worktree needs symlinks to the main checkout for
  `node_modules`, `data/store`, `data/cache`, `tools/forge/dist` and
  `out/validation-pilot`"). Not a skill-text gap — the instruction exists and
  is correct — but this worktree's own setup skipped it, so the first import
  command failed until the symlinks were created by hand. Worth a check at
  worktree creation time rather than at first failure.
- **A `scope: "scenario"` probe's test file must contain only the tests the
  probe config lists.** The probe CLI runs the whole file through vitest and
  checks the report's test population against the config exactly
  (`checkedProbeReport`, `packages/ui/tools/printed-probe-report.ts`); one
  extra passing `it()` in the same file fails the run with `Probe report test
population mismatch`. Fixed in `qualify-printed-set/SKILL.md`
  — extra gameplay evidence for a specific card goes in its own file (see
  `observed-m15-convoke.integration.test.ts` above).
- **A full-match test (`installedForgeBackend`) can never serve as a
  `scope: "scenario"` probe**, regardless of what it proves: only
  `snapshotForgeScenarioBackend`'s wrapped `open()` writes the
  `MTG_FORGE_TEST_SNAPSHOT_USAGE` journal row the scenario report validates
  against, so an `installedForgeBackend` test run through the probe CLI fails
  with `Scenario usage population mismatch` even when it passes standalone.
  Fixed in the same skill-text edit.
- **A scenario probe's card choice does not need to exercise a hard mechanic.**
  When a script's obligations carry `controllerContractId` and `claims: []`,
  that decision family is already fully covered by the reusable contract
  bundle with no card-specific receipt required — the "one local, one engine"
  scenario pair exists to exercise the coverage-report code path
  (`scenarioProbes.length > 0`), not to prove any one keyword. Also fixed in
  the same skill-text edit, to head off over-investing in a witness for a
  mechanic (Convoke, here) that the coverage plan already covers for free.
- **Process note, not a skill-text fix**: the bridge's Convoke allowlist
  (`ForgeBridge.java`'s `isReviewedConvokeAbility`) is fixed at five cards
  (Venerated Loxodon, Conclave Tribunal, Stoke the Flames, Chord of Calling,
  Hogaak Arisen Necropolis). M15 ships Chord of Calling, so this set is
  unaffected, but a future set whose only Convoke card falls outside that
  list would hit a real bridge gap for a full-match witness (not for
  coverage/qualification, which needs none).
