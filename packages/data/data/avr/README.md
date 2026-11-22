# Avacyn Restored (AVR) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.9`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no AVR-specific
source file exists in the workspace and the Node adapter has never been edited
(the adapter hash below is the one every onboarded set carries), but the bridge
has: `play-admission-v2` re-binds `play-admission-v1` to the Phyrexian-mana
structural rule added to `ForgeBridge.java` (`mtg-t5ma0`), and `play-admission-v3` re-binds v2 to the six Kaladesh edits (`mtg-j4ucd.19`). No shared
tool changed.

## Product and identity

A single-set format: 244 printings, 234 distinct Forge scripts (the ten extra
printings are the basic lands' repeated art). Eight-seat draft is three `avr-draft`
rounds, sealed is six `avr-draft` boosters, and basic lands are removed from the
packs (`basicLandPolicy: remove`).

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `07a0c2a598d84e6ab910f55e4bed8e555cae40343513e5030976e5006c045829` |
| catalog AVR `contentSha256` | `5949fea49a6113030b16a6c1e8cd055bfe79a044f58fa8bb3ea2d383d72d6525` |
| source pin (`sources.json`) | `8d640f3d5a7443227a0673f20c1cb9caa0f639b8022b96a055ada43a15858389` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `0f72ba0f3d067409a8658a0505ea3dd3eae4da847c8990a2c504db6aed495b1e` |
| display metadata file       | `c0d658eaada8c9d892cc3ce84b74d54b484cb3ccf71f6994f7285c8cdd0ae929` |

## Rebuilding

The source pin is `data/cache/avr-20260919-source-pin/`. `data/cache` is a
symlink into the main checkout, so a fetched pin lands there, not in the worktree.
Each tool refuses an existing output, so bump the version segment of every
`out/avr/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets AVR --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/avr/onboarding-format-v1.json --sources data/cache/avr-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/avr/build-v2
cp out/avr/build-v2/avr-printed-catalog-v1.json out/avr/build-v2/avr-limited-format-v1.json out/avr/build-v2/build-evidence.json packages/data/data/avr/
cp out/avr/build-v2/sources.json packages/data/data/avr/avr-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/avr-20260919-source-pin --catalog packages/data/data/avr/avr-printed-catalog-v1.json > packages/data/data/avr/avr-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/avr/avr-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Every one of the 244 card printings has `art.status: available` (a Scryfall
`art_crop`). Each of the seven tokens the scripts create is bound in
`avr-token-printings-v1.json` to the oldest Scryfall token printing that states
the same token (`order=released`, ascending):

| token (Forge name) | printing | note             |
| ------------------ | -------- | ---------------- |
| Spirit Token       | TAVR     | 1/1 blue Spirit  |
| Human Token        | TAVR     | 1/1 red Human    |
| Angel Token        | TCON     | 4/4 white Angel  |
| Human Token        | TDKA     | 1/1 white Human  |
| Demon Token        | TISD     | 5/5 black Demon  |
| Spirit Token       | TSHM     | 1/1 white Spirit |
| Zombie Token       | TUGL     | 2/2 black Zombie |

No token is left unbound. The two repeated names (Spirit, Human) differ in color,
so `printingFor` in `packages/ui/src/routes/play/backend-position.ts` tells them
apart; `avr-printed-format.test.ts` pins that. The token file also holds Scryfall
rows that are not tokens any script creates (TAVR's Tamiyo emblem, TDKA's Sorin
emblem, two checklists); no script references them.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins AVR at 234 of 234 scripts closed. Sixteen
review entries were added (`forge-syntax-review-v1.json`, 778 -> 795 entries,
counting the whole table), among them `Soulbond` mapped to `zone-card-selection`
and `CantPayLife`, `LifeLost` and `StoreSVar` as non-choice. Two of those tokens
are trigger or static modes rather than effects, so their
`forge-effect-controller-calls-v1.json` rows went into `modes`, not `effects`
(202 effects, 66 modes). Qualification is 234 qualified, residual 0.

**Soulbond needs no new contract.** Forge expands `K:Soulbond` into two
ChangesZone triggers whose `Bond` effect calls
`PlayerController.chooseSingleEntityForEffect`, the `zone-card-selection` family.
On the observed backend it surfaces as an `entity-selection` decision listing the
legal unpaired creatures plus "Choose none". The scenario witness
`silverblade-paladin-local-soulbond-v1` opens that decision on the local seat and
answers it. **Witness limit:** the projected view carries no pairing flag, so the
witness proves the offer and the answer are accepted, not that the pair is
recorded; the bonus (double strike, lifelink) is not observable through the view.

`play-admission-v1/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, two scenario
witnesses in `observed-avr-contract-witness.integration.test.ts` (Silverblade
Paladin's Soulbond on the local seat, Scrapskin Drake attacking as the engine
seat) and four match-probe test files over `test/support/avr-match-fixture.ts`.
The starting-player seed is `avr-local-pregame-v3`: under `-v2` and `-v1` the
probe "AVR engine-controlled starting choice reaches its first turn without a
local starting move" failed at its first assertion (the first decision was not a
seat-0 mulligan), meaning the seed did not hand the engine seat the starting
choice. That is a property of the seed, not of the bridge.

`play-admission-v2` re-binds v1 to the same bridge digest every set touched by
`mtg-t5ma0` now carries; the adapter, the format, the catalog, the qualified
script count (234) and the residual (0) are unchanged, and the same
`observed-avr-contract-witness.integration.test.ts` and
`test/support/avr-match-fixture.ts` sources produced the receipts. Re-bind with
the six-step recipe in `packages/data/data/isd/README.md`.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `avr`.

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

`avr-printed-format.test.ts` re-verifies the admission, and the registry entry is
in `printed-formats-v1.json`. `npm run verify:live -- --only avr` passes all six
steps (gallery, sealed, match, close and reload, eight-seat draft, drafted-deck
match).

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
