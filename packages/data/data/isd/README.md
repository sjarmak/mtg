# Innistrad (ISD) printed Limited format

Registered, play-supported printed format, and the first set onboarded under the
generalized bridge rather than a per-format admission path. Everything here was
built by the shared printed-format tools; no Innistrad-specific source file
exists anywhere in the workspace. The repo-local `make-set-playable` skill
describes the process this directory is the worked example of.

## Product and identity

Eight-seat draft is ISD, ISD, ISD; sealed is six ISD boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`), the same Limited-simulation
boundary the AKH/HOU format states. The catalog holds the 264 exact Scryfall
printings of the set, mapped to 254 distinct Forge scripts (double-faced cards
share one script per face pair). `build-evidence.json` binds the format hash,
the catalog hash, the source pin hash and the Forge archive hash.

Current identity:

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `4d62858d8e1a1541af1eb82d3cdf1aa96e81f5c62742b3aa1d580f6239ddb258` |
| catalog ISD `contentSha256`          | `95fe8d23da0e04b7fe3fd67551560f8fad1c6e36f1cc33bd8fb881e74d04a4e0` |
| source pin (`sources.json`)          | `c2a0df430a873b29bd52451415a47d1a4e7475d1f3f46603a4b7668e42532f80` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |

## Multi-face card names

A printed catalog's `correctedName` is the name the Forge card database
registers, because the bridge resolves every deck entry through
`FModel.getMagicDb().getCommonCards().getCard(name)`. Forge joins the two faces
with `//` only for `AlternateMode:Split`; a transform, flip, adventure, modal
or meld script registers under its front face. Innistrad's twenty transform
cards were the first to hit this: the catalog builder used to join every layout
and Forge answered `content-unresolved` for "Screeching Bat // Stalking
Vampire". `forgeCardName` in `packages/data/src/printed-card/set-catalog.ts`
now reads the script's `AlternateMode:` line, and
`packages/data/test/printed-set-catalog.test.ts` pins Split, DoubleFaced and
Adventure. AKH/HOU carry only Split cards, so their catalogs did not change.

## Rebuilding

The source pin is `data/cache/isd-20260914-source-pin/` (MTGJSON
5.3.0+20260914 and the Scryfall snapshot fetched 2026-09-14; the raw snapshots
are not vendored). Each tool refuses an existing output directory, so bump the
version segment of every `out/isd/...` path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets ISD --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/isd/onboarding-format-v1.json --sources data/cache/isd-20260914-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/isd/build-v3
cp out/isd/build-v3/isd-printed-catalog-v1.json out/isd/build-v3/isd-limited-format-v1.json out/isd/build-v3/build-evidence.json packages/data/data/isd/
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/isd-20260914-source-pin --catalog packages/data/data/isd/isd-printed-catalog-v1.json > packages/data/data/isd/isd-display-metadata-v1.json
```

## Token printings

`isd-token-printings-v1.json` holds the 12 token printings (Innistrad's token sheet): each row
is one Scryfall token printing bound to the Forge token script whose facts
(name, colors, power and toughness, types) it matches, so the board draws a
token the engine created from the set's own token art rather than the labeled
pending frame. The registry entry names it as `tokenPrintingsFile`, the launcher
stages it beside the catalogs, and `packages/data/test/token-printings.test.ts`
re-derives every binding from the installed Forge token scripts. A token the
engine creates that no row witnesses still fails closed to the pending frame,
and the battlefield piles those by observed identity. Rebuild it with a new
output path; the tool refuses an existing one:

```sh
npx tsx packages/data/tools/fetch-token-printings.ts --sets TISD --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins ISD at 254 of 254 scripts
closed by the shared review table
(`packages/data/data/forge-syntax-review-v1.json`).
`packages/data/test/isd-printed-format.test.ts` rebuilds the decision inventory
and the complete coverage plan in-process and proves every script's decision
families are covered by the reusable controller contracts (priority, targets,
combat, optional-costs, replacement-trigger-choices, zone-card-selection, modes,
mana-x, naming-text-numbers, piles-votes, and cost-card-selection). The latter
contract is format-neutral and covers fixed-count graveyard exile payments.

The same plan on disk, for the probe runner:

```sh
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/isd/isd-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/isd/decision-inventory-v4/inventory.json
npx tsx packages/data/tools/build-printed-script-coverage-plan.ts --catalog packages/data/data/isd/isd-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --reviews <(echo '{"schemaVersion":1,"kind":"printed-script-coverage-plan","scripts":[]}') > out/isd/coverage-plan-prior-v4.json
npx tsx packages/data/tools/build-printed-complete-coverage-plan.ts --inventory out/isd/decision-inventory-v4/inventory.json --prior out/isd/coverage-plan-prior-v4.json --contracts out/validation-pilot/printed-controller-contracts-v12/manifest.json --output out/isd/complete-coverage-plan-v4/coverage-plan.json
```

The last command prints `{"scripts":254,"complete":254,"scriptsWithScenarioClaims":0}`.

## Play admission

`play-admission-v18/` was a verified full-card and match admission for all 264
printings (254 exact scripts), rebuilt 2026-09-19 against Forge 2.0.14 for the
Phyrexian-mana structural rule (`mtg-t5ma0`): `ForgeBridge.java` admitted
Phyrexian-mana costs by a name allowlist of four reviewed cards, and the fix
replaced the allowlist with a structural check on the cost itself, changing
the bridge digest (`53d03a0c...`) without touching the adapter (`b5c63fa8...`,
unchanged since v17). v18 re-admits the same 254 scripts and the same four
match probes as v17 (which re-admitted v16 under the opening-hand bridge,
`mtg-g9od4`, and v16 re-admitted v15, and v15 v14) under the new bridge; no
format, catalog or contract content changed, and the controller contract
bundle did not need a rebuild, since its `engineRuntime` omits the adapter
digest. The commands, run from the installed v17 admission (the probe configs
are generated from the installed admission, so nothing under `out/isd/probes/`
is needed):

```sh
node packages/data/tools/printed-admission-rebind-configs.mjs isd out/rebind/isd
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/isd/isd-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/rebind/isd/decision-inventory/inventory.json
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/rebind/isd/scenario.json --out out/rebind/isd/scenario-probes --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/rebind/isd/scenario-probes --inventory out/rebind/isd/decision-inventory/inventory.json --out out/rebind/isd/script-qualifications
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/rebind/isd/match.json --out out/rebind/isd/match-probes --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/isd/isd-limited-format-v1.json --catalog packages/data/data/isd/isd-printed-catalog-v1.json --qualifications out/rebind/isd/script-qualifications --match-probes out/rebind/isd/match-probes --out packages/data/data/isd/play-admission-v18
```

`play-admission-v19/` re-binds v18 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `isd`.

`play-admission-v20/` re-binds v19 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v21`.

`play-admission-v21/` re-binds v20 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v22`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v22/` re-binds v21 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v23` (`mtg-ziwde`).

The two `printed-probe-cli.ts` runs boot Forge and take the host Forge lock themselves,
so they queue behind any other Forge-required run on the machine and need no `flock`
or `MTG_TEST_WORKERS` prefix.

That block is the re-bind exactly as v17 ran it, with the next admission number.
`printed-admission-rebind-configs.mjs` reads the installed admission's own probe
receipts and coverage plan, so run it before the installed directory is
replaced. `out/validation-pilot/printed-controller-contracts-protocol2-v7` must
exist in the checkout (`out/` is per checkout; copy it from one that has it).
scd, som and akh-hou re-bind with the same six steps over their own formats and
catalogs; this block is the one place they are written down.
`packages/data/tools/printed-admission-rebind-all.mjs` runs the six steps over every registered
format in one pass (`build <run directory>`, then `install <run directory>`) and refuses an
admission that differs from the installed one beyond its digests. The contract
bundle itself was built once, and only a change to a contract needs it again:

```sh
npx tsx packages/ui/tools/printed-probe-cli.ts --config packages/ui/data/akh-hou-exert-scenarios-v1.json --out out/validation-pilot/akh-hou-bootstrap-profiles-protocol2-v6 --timeout-ms 600000
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/tmp/akh-hou-controller-scenarios-protocol2-config.json --out out/validation-pilot/akh-hou-controller-scenarios-protocol2-v7 --timeout-ms 600000
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/tmp/isd-controller-scenarios-protocol2-v2-config.json --out out/isd/controller-scenarios-protocol2-v7 --timeout-ms 600000
npx tsx packages/data/tools/build-controller-contract-bundle.ts --config out/isd/probes/controller-contracts-protocol2-v6-config.json --out out/validation-pilot/printed-controller-contracts-protocol2-v7
```

The scenario run carries six Innistrad witnesses
(`packages/forge-export/test/observed-isd-contract-witness.integration.test.ts`:
a local Victim of Night targeting the only legal creature, Forge attacking
with Darkthicket Wolf, both controllers paying Stitched Drake's fixed graveyard
exile cost, Deranged Assistant milling as a decision-free payment, and
Civilized Scholar's loot resolving with a one-card hand, where Forge asks no
discard question and the bridge must not demand one) and uses
`out/validation-pilot/printed-controller-contracts-protocol2-v3`, whose twelve
contracts bind bridge source regions by checksum. The `-v2` chain was rebuilt
after the Scholar fix because a bridge change invalidates every receipt. Every one of the 254 scripts'
obligations is a reusable contract obligation, so the qualification bundle
reports `qualified: 254, residual: 0`. The match run is the four whole-game
probes on Forest x30 plus Avacyn's Pilgrim x30
(`packages/forge-export/test/observed-isd-*.integration.test.ts`, sharing
`test/support/printed-match-probes.ts` with the fixture in
`test/support/isd-match-fixture.ts`).

`packages/data/test/isd-printed-format.test.ts` re-verifies the installed
admission against the staged format and catalog on every run. After a rebuild,
point the registry entry and that test at the new admission directory and
delete the old one; two admissions for one format are not kept.

`play-admission-v23/` re-binds v22 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v24/`.

`play-admission-v24/` re-binds v23 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v25/`.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `isd` entry with
`play.status: supported` and `admissionDirectory: play-admission-v24`. The
launcher (`packages/ui/tools/play.ts`) reads every supported entry at boot and
`startBackendService` admits all of them behind one Forge identity, so
Innistrad and AKH/HOU are routed side by side.
`packages/ui/test/tools/installed-printed-admissions.integration.test.ts`
(gated by `MTG_REQUIRE_PRINTED_ADMISSIONS=1`) opens a sealed match on every
registered format through that one gateway.

Card art is not staged: the catalog carries each printing's Scryfall image
URIs and `packages/ui/src/card/printed-card-art.ts` renders the `art_crop`
straight from `cards.scryfall.io` in the browser.
