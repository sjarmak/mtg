# Theros (THS) printed Limited format

Registered, play-supported printed format, onboarded under the generalized
bridge the same way as Innistrad (`packages/data/data/isd/README.md` is the
worked example this directory follows). Everything here was built by the
shared printed-format tools; no Theros-specific source file exists anywhere in
the workspace. The repo-local `make-set-playable` skill describes the process.

## Product and identity

Eight-seat draft is THS, THS, THS; sealed is six THS boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 249
exact Scryfall printings of the set, mapped to 234 distinct Forge scripts.
`build-evidence.json` binds the format hash, the catalog hash, the source pin
hash and the Forge archive hash.

Current identity:

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `97708a951338fa9d65f805a061a6b103a092e47085e9bdd1e9e16bb98f55443d` |
| catalog THS `contentSha256`          | `0b5518a3ac6050318d7efb96cf6c13d907f9ed6d0c08674505cc0054af09a82d` |
| source pin (`sources.json`)          | `9816ef0c20eb23a3bae177154a818400599ff12a8aed2e046faa2a63c0af0149` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |

## New mechanics: Bestow and Monstrosity

Both were checked against the bead's stop condition (`mtg-j4ucd.13`) before
qualification proceeded, and neither needed new bridge or contract work.

**Bestow** (`K:Bestow:<cost>`) is Forge's native alternate-cast-cost keyword.
Casting a bestow creature offers two `priority` options for the same card
("Hopeful Eidolon - Creature 1/1" and "Bestow {3}{W} (...)"); choosing bestow
makes it an Aura spell that needs a `target-selection` decision for the
enchant target. Both decisions are already-covered surfaces: the script's own
decision-family scan classifies Hopeful Eidolon as `['priority',
'optional-costs', 'combat']` (the same `optional-costs` family Flashback,
Cycling and Overload use; the aura's enchant target is resolved inside the
Bestow keyword's own parser rather than a scripted `ValidTgts$` line, so it
never surfaces as a separate `targets`-family script obligation). Witnessed on
real Forge: the Aura remains on the caster's own battlefield entry (not the
enchanted permanent's controller's), with `typeLine: "Enchantment - Aura"`,
and the enchanted creature's power/toughness reflect the static +1/+1 bestow
buff.

**Monstrosity** (`A:AB$ PutCounter | Cost$ 6 G | Monstrosity$ N`) is a plain
activated ability, structurally identical to already-witnessed activation
patterns (Innistrad's Deranged Assistant): a `priority` decision to activate,
then `mana-payment`. Nessian Asp's script classifies as `['priority',
'zone-card-selection', 'combat', 'replacement-trigger-choices',
'naming-text-numbers']`, all reusable-contract families already exercised
elsewhere. Witnessed on real Forge: activating for `{6}{G}` moves a 4/5 base
creature to 8/9 (four +1/+1 counters).

## Rebuilding

The source pin is `data/cache/ths-20260919-source-pin/`. Each tool refuses an
existing output directory, so bump the version segment of every `out/ths/...`
path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets THS --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/ths/onboarding-format-v1.json --sources data/cache/ths-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/ths/build-v2
cp out/ths/build-v2/ths-printed-catalog-v1.json out/ths/build-v2/ths-limited-format-v1.json out/ths/build-v2/build-evidence.json packages/data/data/ths/
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/ths-20260919-source-pin --catalog packages/data/data/ths/ths-printed-catalog-v1.json > packages/data/data/ths/ths-display-metadata-v1.json
```

## Token printings

`ths-token-printings-v1.json` binds each Theros token printing to the Forge
token script whose facts (name, colors, power and toughness, types) it
matches, so the board draws a token the engine created from the set's own
token art rather than the labeled pending frame. The registry entry names it
as `tokenPrintingsFile`, the launcher stages it beside the catalogs, and
`packages/data/test/token-printings.test.ts` re-derives every binding from the
installed Forge token scripts. Rebuild it with a new output path; the tool
refuses an existing one:

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --sets TTHS --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins THS at 234 of 234
scripts closed by the shared review table
(`packages/data/data/forge-syntax-review-v1.json`).
`packages/data/test/ths-printed-format.test.ts` rebuilds the decision
inventory and the complete coverage plan in-process and proves every script's
decision families are covered by the reusable controller contracts (priority,
targets, combat, optional-costs, replacement-trigger-choices,
zone-card-selection, modes, mana-x, naming-text-numbers, ordering, piles-votes
and cost-card-selection).

The same plan on disk, for the probe runner:

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/ths/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/ths/decision-inventory-v2/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/ths/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/ths/coverage-plan-prior-v1.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/ths/decision-inventory-v2/inventory.json --prior out/ths/coverage-plan-prior-v1.json --contracts out/validation-pilot/printed-controller-contracts-protocol2-v6/manifest.json --output out/ths/complete-coverage-plan-v1/coverage-plan.json
```

The last command prints `{"scripts":234,"complete":234,"scriptsWithScenarioClaims":0}`.

## Play admission

`play-admission-v2/` was a verified full-card and match admission for all 249
printings (234 exact scripts), built 2026-09-19 against Forge 2.0.14 and the
generalized bridge protocol 2. The commands that built it:

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ths/probes/ths-scenario-probes-v1-config.json --out out/ths/scenario-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/ths/scenario-probes-v1 --inventory out/ths/decision-inventory-v2/inventory.json --out out/ths/script-qualifications-v1
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/ths/probes/ths-match-probes-v1-config.json --out out/ths/match-probes-v1 --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/ths/ths-limited-format-v1.json --catalog packages/data/data/ths/ths-printed-catalog-v1.json --qualifications out/ths/script-qualifications-v1 --match-probes out/ths/match-probes-v1 --out packages/data/data/ths/play-admission-v1
```

The two `printed-probe-cli.ts` runs boot Forge and take the host Forge lock
themselves, so they queue behind any other Forge-required run on the machine
and need no `flock` or `MTG_TEST_WORKERS` prefix.

`play-admission-v2` re-binds v1 to the Phyrexian-mana bridge digest (`mtg-t5ma0`) every other set now carries; the adapter, format, catalog, qualified script count (234) and residual (0) are unchanged. It was built with the six-step recipe in `packages/data/data/isd/README.md`, from the receipts v1 carried, and v1 was deleted.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `ths`.

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

The scenario run carries three Theros witnesses
(`packages/forge-export/test/observed-ths-contract-witness.integration.test.ts`:
a local Hopeful Eidolon caster choosing bestow and enchanting the only legal
creature, a local Nessian Asp controller activating monstrosity, and Forge
attacking with Nessian Courser while the local seat only answers its own
decisions) against `out/validation-pilot/printed-controller-contracts-protocol2-v6`,
whose twelve contracts bind bridge source regions by checksum. Every one of
the 234 scripts' obligations is a reusable contract obligation, so the
qualification bundle reports `qualified: 234, residual: 0`. The match run is
the four whole-game probes on Forest x60 plus Plains x60
(`packages/forge-export/test/observed-ths-*.integration.test.ts`, sharing
`test/support/printed-match-probes.ts` with the fixture in
`test/support/ths-match-fixture.ts`; the fixture reuses Avacyn's Pilgrim, as
ISD and SOM do, since a set's own cards are usually outside
`AUDITED_FORGE_CARD_NAMES`). `match-local-pregame-v1` declares all three of
`starting-player`, `mulligan` and `priority` for the local controller, since
its three assertions (seat 0 and seat 1 starting choice, London mulligan) walk
the local seat to a legal priority decision each time; the three
engine-controller match families are proved by one probe each.

`packages/data/test/ths-printed-format.test.ts` re-verifies the installed
admission against the staged format and catalog on every run.

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

`packages/data/data/printed-formats-v1.json` carries the `ths` entry with
`play.status: supported` and `admissionDirectory: play-admission-v8`. The
launcher (`packages/ui/tools/play.ts`) reads every supported entry at boot and
`startBackendService` admits all of them behind one Forge identity.

Card art is not staged: the catalog carries each printing's Scryfall image
URIs and `packages/ui/src/card/printed-card-art.ts` renders the `art_crop`
straight from `cards.scryfall.io` in the browser. All 9 THS/TUGL tokens are
bound in `ths-token-printings-v1.json`; no token is left unbound.
