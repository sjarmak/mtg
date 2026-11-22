# Starter Commander Decks (SCD) printed Commander precon format

Registered, browse-only printed format, and the first _constructed_ one: a list
of fixed decks rather than a booster recipe. The five decks are the ones Forge
ships under `tools/forge/dist/res/quest/commanderprecons/` with `Set=SCD`,
imported by the shared precon importer and sealed by the same catalog builder
the Limited formats use. No SCD-specific source file exists anywhere in the
workspace; the Commander plan is `mtg-bc2.154.6.5` and this directory is its
second step (`mtg-bc2.154.6.5.5`).

## Product and identity

Five 1v1 Commander precons (`rules: { variant: commander, startingLife: 40 }`),
each one commander over ninety-nine cards, every card an exact SCD printing:

| deck                   | commander                  |
| ---------------------- | -------------------------- |
| `chaos-incarnate`      | Kardur, Doomscourge        |
| `draconic-destruction` | Atarka, World Render       |
| `first-flight`         | Isperia, Supreme Judge     |
| `grave-danger`         | Gisa and Geralf            |
| `token-triumph`        | Emmara, Soul of the Accord |

The catalog holds the 352 exact Scryfall printings of the set, mapped to 337
distinct Forge scripts. A deck line names a card, not a printing, so the
builder resolves it to the **first** printing of that name in catalog order
and merges repeated lines into one slot (Plains has four SCD printings and
every deck's Plains is `scd-printed-v1:0333`). `build-evidence.json` binds the
format hash, the catalog hash, the recipe hash, the source pin hash and the
Forge archive hash, and carries `status: catalog-only-not-play-admitted`.

Current identity:

| artifact                                   | sha256                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`                     | `b8a9738a0ee68be1e7c49e336aaeed068364e40a27edb00b13cdc936c14e0478` |
| catalog SCD `contentSha256`                | `be47a0caa4d133d2bb924b2a77cf0699ff1dd1cf64f607e717e3c7b3f2cc7763` |
| recipe (`onboarding-format-v1.json`)       | `a2f8925dd0c0c89c4a7d77652f87f3b98f91701be3159d8c7dd1e5d6b8477cbe` |
| source pin (`scd-printed-sources-v1.json`) | `c1694b761d3b0ffd3440be2ba14ea5514cb5cccf9f4c4dbd5ed13b325bbc36d6` |
| Forge script archive                       | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |

## Rebuilding

The source pin is `data/cache/scd-20260915-source-pin/` (MTGJSON and the
Scryfall snapshot fetched 2026-09-15; the raw snapshots are not vendored).
Each tool refuses an existing output path, so bump the version segment of every
`out/scd/...` path on a rebuild.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets SCD --out <new-source-directory>
npx tsx packages/data/tools/import-forge-precons.ts --precons tools/forge/dist/res/quest/commanderprecons --set SCD --id scd --name "Starter Commander Decks 2022" --out out/scd/recipe-v1.json
npx tsx packages/data/tools/build-printed-format.ts --config out/scd/recipe-v1.json --sources data/cache/scd-20260915-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/scd/build-v1
cp out/scd/build-v1/scd-printed-catalog-v1.json out/scd/build-v1/scd-constructed-format-v1.json out/scd/build-v1/build-evidence.json packages/data/data/scd/
cp out/scd/build-v1/recipe.json packages/data/data/scd/onboarding-format-v1.json
cp data/cache/scd-20260915-source-pin/sources.json packages/data/data/scd/scd-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/scd-20260915-source-pin --catalog packages/data/data/scd/scd-printed-catalog-v1.json > packages/data/data/scd/scd-display-metadata-v1.json
```

`packages/data/test/scd-printed-format.test.ts` binds the installed artifacts
to the evidence and re-derives every deck from the shipped `.dck` files, so a
Forge bump that changes a precon fails there rather than in a game.

## Token printings

`scd-token-printings-v1.json` holds the 25 token printings (the Starter Commander token sheet): each row
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
npx tsx packages/data/tools/fetch-token-printings.ts --sets TSCD --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Closure and coverage

`packages/data/test/forge-syntax-closure.test.ts` pins SCD at **337 of 337**
scripts closed by the shared review table
(`packages/data/data/forge-syntax-review-v1.json`). It stood at 306 of 337
until `mtg-bc2.154.6.5.7.1` reviewed the 30 tokens that had held 31 scripts
open, over 40 card occurrences. Four of them ask a player something and are
mapped: `Amass` (6 cards) and `Populate` choose which Army or which creature
token through `chooseSingleEntityForEffect`, the same battlefield card choice
`ChooseCard` is mapped to, so both carry `zone-card-selection`; `Encore` (2)
is an activated ability from the graveyard with a cost, mapped `optional-costs`
like `Embalm`, `Eternalize` and `Unearth`; `Announce` registers a variable the
engine asks for through `announceRequirements`, which the bridge routes to
`chooseNumber`, so it carries `mana-x`; and `ChoosePlayer` asks
`chooseSingleEntityForEffect` over players, a named non-card choice like
`ChooseColor` and `GenericChoice`, so it carries `naming-text-numbers` (the one
SCD occurrence, Wildfire Devils, sets `Random$ True` and the engine picks). The
other 25 are non-choice: trigger modes and filters (`AttackerUnblockedOnce`,
`LifeGained`, `Attacked`, `AttackedTarget`, `ValidAttackingPlayer`,
`ValidDefenders`), target restrictions on a choice `ValidTgts` already carries
(`TargetsForEachPlayer`, `TargetUnique`, `TargetsAtRandom`), static-ability
selectors (`AddStaticAbility`, `AffectedDefined`, `GainsAbilitiesOfDefined`),
effect parameters that name rather than ask (`Goad`, `NewController`,
`TargetControls`, `ShareLandType`, `RestrictValid`, `TriggersWhenSpent`,
`ShowCards`, `CopyCard`, `Random`, `TriggerAmount`, `RememberDrawn`,
`ClearChosenPlayer`) and the AI-only hint `UnlessAI`. Each entry's evidence
names the script line and the Forge effect, trigger or static class (read with
`javap` from the installed jar) or the bridge method it was checked against.
Which cards those scripts are, and therefore which decks a Commander table may
be handed, is what the availability derivation (`mtg-bc2.154.6.2`) reads off
this closure plus the contracts; until it lands nothing here says a deck is
playable.

## Play admission

`play-admission-v10/` was a verified full-card and match admission for all 352
printings (337 exact scripts), rebuilt 2026-09-19 against Forge 2.0.14 for the
Phyrexian-mana structural rule (`mtg-t5ma0`): the bridge's Phyrexian-mana
allowlist of four reviewed cards was replaced with a structural check on the
cost itself, changing the bridge digest without touching the adapter. v10
re-admits the same 337 scripts and the same four match probes as v9 (built the
same day, under the opening-hand bridge, re-admitting v8's scripts and probes,
which re-admitted v7's, v7 v6's) under the new bridge, and verified by
`verifyPrintedFormatPlayAdmission`, the same function the Limited formats'
admissions pass through. Its chain still reuses the Innistrad controller
contract bundle
(`out/validation-pilot/printed-controller-contracts-protocol2-v6`, see
`packages/data/data/isd/README.md`) and the two Starter Commander scenario
witnesses (`packages/forge-export/test/observed-scd-contract-witness.integration.test.ts`):
a local Murder at forty life destroying the only legal creature, and Foreboding
Ruins entering untapped after its controller reveals a Mountain, the five
shadow lands' entry payment admitted as a scoped optional hand reveal
(`isScopedHandRevealCost`).
To re-bind it to a new bridge or adapter (v10 ran these steps; the probe
configs are generated from the installed admission, so `out/scd/probes/` is not
needed), run from the repo root with `out/validation-pilot/printed-controller-contracts-protocol2-v6`
present. `printed-admission-rebind-configs.mjs` must run before the installed
directory is replaced:

```sh
node packages/data/tools/printed-admission-rebind-configs.mjs scd out/rebind/scd
npx tsx packages/data/tools/inventory-printed-decisions.ts --catalog packages/data/data/scd/scd-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --token-scripts tools/forge/dist/res/tokenscripts --output out/rebind/scd/decision-inventory/inventory.json
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/rebind/scd/scenario.json --out out/rebind/scd/scenario-probes --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualification-bundle.ts --evidence out/rebind/scd/scenario-probes --inventory out/rebind/scd/decision-inventory/inventory.json --out out/rebind/scd/script-qualifications
npx tsx packages/ui/tools/printed-probe-cli.ts --config out/rebind/scd/match.json --out out/rebind/scd/match-probes --timeout-ms 600000
npx tsx packages/data/tools/build-script-qualified-admission.ts --format packages/data/data/scd/scd-constructed-format-v1.json --catalog packages/data/data/scd/scd-printed-catalog-v1.json --qualifications out/rebind/scd/script-qualifications --match-probes out/rebind/scd/match-probes --out packages/data/data/scd/play-admission-v12
```

`play-admission-v11/` re-binds v10 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `scd`.

`play-admission-v12/` re-binds v11 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v13`.

`play-admission-v13/` re-binds v12 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v14`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v14/` re-binds v13 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v15` (`mtg-ziwde`).

The two `printed-probe-cli.ts` runs boot Forge and take the host Forge lock themselves,
so they queue behind any other Forge-required run on the machine and need no `flock`
or `MTG_TEST_WORKERS` prefix.

The qualification bundle reports `qualified: 337, residual: 0`. The match run
is the four whole-game probes
(`packages/forge-export/test/observed-scd-*.integration.test.ts`, sharing
`test/support/printed-match-probes.ts` with the fixture in
`test/support/scd-match-fixture.ts`), each opening a Commander table: the
fixture states `rules.commander` and a commander per seat, and the probe
support forwards both to the bridge's open request.

The command zone has two scenario probes of its own,
`emmara-local-command-zone-return-v1` and `emmara-local-command-zone-decline-v1`
(`packages/forge-export/test/observed-scd-command-zone-scenario.integration.test.ts`).
A scenario seat's `command` list is dealt as Forge's `command=<name>|IsCommander`,
which registers the commander and its commander effect. The probes cast Emmara,
Soul of the Accord from the command zone, pay the commander tax on the recast
(`Pay for Emmara, Soul of the Accord: {2}{W}{G}`), and give both answers to the
zone-change choice. Their receipts ship in the admission's `probes/` beside the
contract witnesses; no coverage obligation consumes them, since the commander
rules belong to the format rather than to any one script. The commanders'
ordinary casts are qualified through the contracts like every other printing.

Forge asks CR 903.9a as the rule states it, a state-based action: the card is
already in the graveyard or exile when its owner is asked, so the board shows
it there while the question is pending. The bridge surfaces that question as a
`confirm-replacement` naming the commander (`Put Emmara, Soul of the Accord into
the command zone` / `Leave Emmara, Soul of the Accord in the graveyard`), the
kind CR 903.9b's hand-or-library replacement already arrives as.
`packages/forge-export/test/observed-scd-commander-witness.integration.test.ts`
witnesses the same contracts in whole games, including the engine seat casting
its own general and commander damage.

The play board draws the zone (`packages/ui/src/board/CommandZone.ts`): a
panel on the right-hand side of the seat's battlefield holding the commander,
a button while the engine offers its cast and inert otherwise, with a ledger
under it reading the engine's own cast count (`SeatView.commanderCasts`, the
bridge's `getCommanderCast`) and the next cast's cost with the tax folded in.
The count is read rather than kept, so a commander that returns to the zone
after dying reads the tax it owes without the surface having watched it leave.
`packages/ui/tools/live-journey.ts` checks the panel before and after the cast.

`packages/data/test/scd-printed-format.test.ts` re-verifies the installed
admission on every run. After a rebuild, point the registry entry and that test
at the new directory and delete the old one; two admissions for one format are
not kept.

`play-admission-v15/` re-binds v14 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v16/`.

`play-admission-v16/` re-binds v15 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v17/`.

`play-admission-v33/` replaces v32 (deleted) for the Commander bridge fixes (#211, #209, #208), with
bridge `0aaf7b8e...` and adapter `aab3ecba...`. Unlike a plain re-bind it adds the
two command-zone scenario probes above to `probes/`, so it was built by the recipe with those two
appended to the generated scenario config rather than by `printed-admission-rebind-all.mjs` (whose
drift check refuses a new probe). Cards, decisions and match probes are unchanged, at 337 qualified
scripts and 0 residual. The next re-bind reads all four probes from this directory's `probes/`.

## Registration

`packages/data/data/printed-formats-v1.json` carries the `scd` entry with
`formatFile: scd-constructed-format-v1.json`, browse available, draft and
sealed unavailable (there is no pack), play supported through
`admissionDirectory: play-admission-v16`. The launcher
(`packages/ui/tools/play.ts`) stages it beside the Limited formats through
`stage-printed-formats.ts`, which branches on the format's `kind` and checks a
constructed bundle through `packages/ui/src/lab/printed-constructed-format.ts`
(catalog checksums, every deck slot a printing the catalog carries). The index
row carries `kind: constructed`, and the set picker skips it until the precon
page (`mtg-bc2.154.6.5.6`, Commander 3) exists to open a deck from it.

Card art is not staged: the catalog carries each printing's Scryfall image
URIs, the same as every Limited format.
