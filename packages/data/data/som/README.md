# Scars of Mirrodin (SOM) printed Limited format

Registered, play-supported printed format, and the pilot of the
`make-set-playable` skill (`mtg-j4ucd.1`) for the 19-set batch. Everything here
was built by the shared printed-format tools; no Scars-specific source file
exists in the workspace and the bridge was not edited.

## Product and identity

Eight-seat draft is SOM, SOM, SOM; sealed is six SOM boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 249
exact Scryfall printings of the set, mapped to 234 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `17afe767dd600e25fbb4301894cb760c726e38522c7897cfc531fd78f4db09a0` |
| catalog SOM `contentSha256`          | `93c88c20cd37ac8c7a5fd7719542fec90ad7bd07ef29572e1c75a577f8e272d3` |
| source pin (`sources.json`)          | `7975fc773ac3de2071f5d00e0617965bf907d554502b9115b7e344230b0a194d` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |

## Rebuilding

The source pin is `data/cache/som-20260918-source-pin/` (MTGJSON
5.3.0+20260917 and the Scryfall snapshot fetched 2026-09-18). The writers emit prettier-formatted JSON (`mtg-j4ucd.23`), so the copies below
need no formatting pass. Each tool refuses
an existing output, so bump the version segment of every `out/som/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets SOM --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/som/onboarding-format-v1.json --sources data/cache/som-20260918-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/som/build-v2
cp out/som/build-v2/som-printed-catalog-v1.json out/som/build-v2/som-limited-format-v1.json out/som/build-v2/build-evidence.json packages/data/data/som/
cp out/som/build-v2/sources.json packages/data/data/som/som-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/som-20260918-source-pin --catalog packages/data/data/som/som-printed-catalog-v1.json > packages/data/data/som/som-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --sets TSOM --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

The play admission is re-bound to a new bridge or adapter with the six-step
recipe in `packages/data/data/isd/README.md` (Play admission), run with format
id `som` and output `play-admission-v7`.

## Art

Every one of the 249 printings has `art.status: available` (a Scryfall
`art_crop`). Where several Scryfall printings of a card exist, the oldest by
set release order is chosen (`packages/printed-card/src/set-release-order.ts`,
`mtg-j4ucd.2`). Of the nine token names the set's scripts create (Cat, Soldier,
Goblin, Insect, Wolf, Golem, Myr, and the two Phyrexian Wurm tokens), seven are
bound to TSOM token printings in `som-token-printings-v1.json`. The two Wurm
tokens (deathtouch, lifelink) are not bound and show the labeled pending frame.
The oldest printings exist (TSOM 8 and 9, 2010-10-01, no earlier or older
printing of either), but Scryfall names them "Wurm" with type "Wurm" while
Forge's two scripts are both `Phyrexian Wurm Token`, type `Phyrexian Wurm`, so
the binder's name and type match refuses them. Binding them would not draw
art either: the two scripts share name, colors and P/T, and the play surface
sees no keywords, so it cannot pick between them (the DKA Vampire case).
`mtg-j4ucd.22` records this; Poison Counter is not a token creature layout and
is not bound.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins SOM at 234 of 234 scripts closed by the
shared review table; 26 review entries were added for SOM
(`forge-syntax-review-v1.json`). Twenty-four are `non-choice` from reading the
script lines, two are `mapped` (ChooseSource to zone-card-selection; the
optional-untap keyword to replacement-trigger-choices) after checking the
Forge call site. Qualification: 234 qualified, residual 0.

`play-admission-v3/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, witnesses in
`observed-som-contract-witness.integration.test.ts` and four match probes over
`test/support/som-match-fixture.ts` (Forest x30 plus Avacyn's Pilgrim x30;
Copper Myr is outside the audited slice). `som-printed-format.test.ts`
re-verifies it. The registry entry is in `printed-formats-v1.json`.
The browser journey passed: `npm run verify:live -- --url http://127.0.0.1:<port> --only som`.

`play-admission-v4/` was a verified full-card and match admission for the same
234 scripts, rebuilt 2026-09-19 against Forge 2.0.14 for the Phyrexian-mana
structural rule (`mtg-t5ma0`): the bridge's Phyrexian-mana allowlist of four
reviewed cards was replaced with a structural check on the cost itself,
changing the bridge digest without touching the adapter. v4 re-admits the
same 234 scripts and the same four match probes as v3 under the new bridge;
the qualification bundle reported `qualified: 234, residual: 0`. Built with
the six-step recipe in `packages/data/data/isd/README.md` (Play admission).

`play-admission-v5/` re-binds v4 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `som`.

`play-admission-v6/` re-binds v5 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v7`.

`play-admission-v7/` re-binds v6 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v8`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v8/` re-binds v7 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v9` (`mtg-ziwde`).

`play-admission-v9/` re-binds v8 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v10/`.

`play-admission-v10/` re-binds v9 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v11/`.
