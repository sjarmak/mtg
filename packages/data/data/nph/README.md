# New Phyrexia (NPH) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.5`) as one of the 19 sets of the batch.

Eight-seat draft is NPH, NPH, NPH; sealed is six NPH boosters; basic lands are
removed from the packs. The catalog holds 175 exact Scryfall printings mapped to
170 Forge scripts.

## The pregame-actions contract

The five Chancellors (Annex, Dross, Forge, Spires, Tangle) carry
`K:MayEffectFromOpeningHand:RevealCard`, which Forge asks through
`chooseSaToActivateFromOpeningHand`. `mtg-n76vw` admitted that family in the
bridge but the reusable bundle had no contract for it, so this set built one:
`pregame-actions-v1`, bound to `chooseOpeningHandActions` and the
`chooseSaToActivateFromOpeningHand` override, with a local and an engine witness
in `observed-nph-pregame-contract-witness.integration.test.ts` (Chancellor of the
Dross from an `OPENING_HAND` scenario; the local seat is asked and its reveal
drains 3 at its first upkeep, the engine seat answers itself and the question is
never surfaced). The bundle is
`out/validation-pilot/printed-controller-contracts-protocol2-v7` (the twelve v6
contracts plus this one); its committed source is the entry in
`packages/data/data/printed-controller-contracts-v1.json`, and
`play-admission-v1/contracts/` carries the built receipts. With it the complete
coverage plan reports 170 of 170 scripts `complete`.

## Phyrexian mana

26 spells print a mono-color Phyrexian shard; none is hybrid, so every one is
inside the bridge's structural rule (`isReviewedPhyrexianManaCost`). No probe
casts one from this set's own cards: the rule was witnessed by `mtg-t5ma0`, and
the scenario witnesses here use Vapor Snag and Hovermyr.

## Identity

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `d56e3cd914f155a23f2a9d5262109e5b9013b664e4421869fd7f95a18613c930` |
| format file                 | `f3ee61fe5ade686fb1549d8bcabe349161114d9c7411ceee035c096e4a380bd8` |
| catalog file                | `002da070bc471d8971cfc9b2a2aaa99972c626312af4192777079631330e5dbc` |
| catalog NPH `contentSha256` | `826cb243cd5145b11045e098da63de89eae8d0e3a7c3920000e8431c8884f74b` |
| source pin (`sources.json`) | `9db4d8dee6f33c52d69066ab3fbd902e907d52bee940ca45fb14f167767f08be` |
| token printings file        | `301950df34e88a35ad2817e1593d188b03e61a3ce330cb9f2398c73856d70e06` |
| display metadata file       | `8bcf18a60fc4e6bde1de5e4bceb29f4e6f2f17e6f87c3789d2aae4b0d548643e` |

## Rebuilding

Source pin: `data/cache/nph-20260919-source-pin/` (fetched 2026-09-19). Each tool
refuses an existing output, so bump the version segment of `out/nph/...`.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets NPH --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/nph/onboarding-format-v1.json --sources data/cache/nph-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/nph/build-v2
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/nph-20260919-source-pin --catalog packages/data/data/nph/nph-printed-catalog-v1.json > packages/data/data/nph/nph-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/nph/nph-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Syntax review and tokens

The decision inventory left 20 syntax tokens unreviewed; each was read in the
scripts that use it and entered in `forge-syntax-review-v1.json` (all
non-choice except `MayEffectFromOpeningHand` -> pregame-actions,
`CantAttackUnless` -> optional-costs + combat, and
`AssignCombatDamageAsUnblocked` -> combat). The inventory is then clean
(`decision-inventory-v2`) and the closure test pins NPH at 170 of 170.

The set's scripts create six tokens, all bound in the token file, each to the
oldest Scryfall printing that states the same token: Phyrexian Golem (T2X2),
Phyrexian Myr (TCMM), Beast (TLRW), Phyrexian Germ (TMBS 1, printed as "Germ" and bound by a stated alias), Phyrexian Insect
(TONC), Phyrexian Goblin (TONE). No token is left unbound.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins NPH at 170 of 170 scripts closed. The
decision inventory (`out/nph/decision-inventory-v5`) reports no unknown syntax;
qualification: 170 qualified, residual 0.

`play-admission-v1/` was built with the v7 bundle and the witnesses in
`observed-nph-contract-witness.integration.test.ts` (Vapor Snag as the local
seat's target witness, Hovermyr as the engine seat's combat witness) and four
match probes over `test/support/nph-match-fixture.ts` (Forest x30 plus
Avacyn's Pilgrim x30; seed `nph-local-pregame-v2`, `-v1` did not hand the engine
the starting choice). Commands, after a fetch of the pin and build above:

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/nph/nph-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/nph/decision-inventory-v5/inventory.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/nph/decision-inventory-v5/inventory.json --prior out/nph/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v7/manifest.json --output out/nph/complete-coverage-plan-v4/coverage-plan.json
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/nph/probes/pregame-contract-scenarios-v1-config.json --out out/nph/pregame-contract-scenarios-v1 --timeout-ms 500000
npx tsx packages/data/tools/build-controller-contract-bundle.ts --config out/nph/probes/controller-contracts-protocol2-v7-config.json --out out/validation-pilot/printed-controller-contracts-protocol2-v7
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/nph/probes/nph-scenario-probes-v1-config.json --out out/nph/scenario-probes-v1 --timeout-ms 500000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/nph/scenario-probes-v1 --inventory out/nph/decision-inventory-v5/inventory.json --out out/nph/script-qualifications-v1
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/nph/probes/nph-match-probes-v1-config.json --out out/nph/match-probes-v1 --timeout-ms 500000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/nph/nph-limited-format-v1.json --catalog packages/data/data/nph/nph-printed-catalog-v1.json --qualifications out/nph/script-qualifications-v1 --match-probes out/nph/match-probes-v1 --out packages/data/data/nph/play-admission
```

`play-admission-v2/` re-admits the same 170 scripts and four match probes
under Kaladesh's six bridge edits (`mtg-j4ucd.19`): the Crew review path,
previously hardcoded to Smuggler's Copter's own name and threshold, is
parameterized by card name and crew threshold; `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion,
Verdant Crescendo and Cloudstone Curio were added. The compiled bridge digest
changes (`702a7926...`) without touching the adapter or any format, catalog or
contract content. v2 was rebuilt in place as each edit landed, so no
intermediate version exists. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), format id `nph`.

`play-admission-v3/` re-binds v2 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v4`.

`play-admission-v4/` re-binds v3 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v5`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v5/` re-binds v4 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v6` (`mtg-ziwde`).

`play-admission-v6/` re-binds v5 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v7/`.

`play-admission-v7/` re-binds v6 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v8/`.
