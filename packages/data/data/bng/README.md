# Born of the Gods (BNG) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.14`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no BNG-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited (the bridge and adapter hashes below are the ones the other
installed admissions already carry, so this build needed no re-bind).

## Product and identity

Born of the Gods was drafted as three packs of itself: eight seats, rounds
`[bng-draft, bng-draft, bng-draft]`, sealed is six `bng-draft` boosters, basic
lands removed from the packs (`basicLandPolicy: remove`). Theros is not a
format of this directory; it is registered on its own as `ths`. Its catalog is
here only because MTGJSON's Born of the Gods draft booster lists
`sourceSetCodes: [BNG, THS]`: its basic-land sheet is Theros's own basics, and
the builder resolves every basic id through a catalog. With `sourceCodes: [BNG]`
the build fails with `missing source or duplicate source: THS`, so the recipe
names both codes, has one product, and ships the THS catalog as a dependency
exactly as `gtc/` ships Return to Ravnica's. The catalogs are BNG (165 printings, 165 scripts) and THS
(249 printings, 234 scripts; THS prints some of its basic lands more than
once, and those printings share one script per land), 414 printings and 399
scripts in all. The cost of the dependency is that qualification covers THS's
scripts too.

This directory's THS catalog was rebuilt from BNG's pin rather than read from
`ths/`, and it stays a copy on purpose (`make-set-playable` says why): its
`contentSha256` is `f5c36578...` against `0b5518a3...` in `ths/`, while all 249
cards are field-for-field identical and only the source provenance differs.
`jou/` carries a third copy (`fac9b57d...`) and a second BNG catalog
(`68c366f3...` against `fab9bfa8...` here).

| artifact                    | sha256                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `6da213397e2ddb88bf9e980e3d075020bd2f5be99b2d05cba0a468c6871ad8ab` |
| catalog BNG `contentSha256` | `fab9bfa843fc533ef7b53ebe8d002c6af11646da80509189ca2efe54f0d261eb` |
| catalog THS `contentSha256` | `f5c3657836d8912c232e46fc83966fd6f4559e5d6aeaed7a5922097b20776e71` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `72a4105dfc0aff80ef4bf2181702db041494e83900cad62b59696535c89015fa` |
| display metadata file       | `bb43491b7506c25157c7a8462d152fc1629585ee7813d89f4a38df1b82d100ff` |

## Rebuilding

The source pin is `data/cache/bng-ths-20260920-source-pin/` (the MTGJSON and
Scryfall snapshots for BNG and THS). The writers emit prettier-formatted JSON,
so the copies below need no formatting pass. Each tool refuses an existing
output, so bump the version segment of every `out/bng/...` path. Every tool
that takes catalogs wants one `--catalog` flag per file.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets BNG,THS --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/bng/onboarding-format-v1.json --sources data/cache/bng-ths-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/bng/build-v2
cp out/bng/build-v2/bng-printed-catalog-v1.json out/bng/build-v2/ths-printed-catalog-v1.json out/bng/build-v2/bng-limited-format-v1.json out/bng/build-v2/build-evidence.json packages/data/data/bng/
cp out/bng/build-v2/sources.json packages/data/data/bng/bng-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/bng-ths-20260920-source-pin --catalog packages/data/data/bng/bng-printed-catalog-v1.json --catalog packages/data/data/bng/ths-printed-catalog-v1.json > packages/data/data/bng/bng-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/bng/bng-printed-catalog-v1.json --catalog packages/data/data/bng/ths-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Card art is each printing's Scryfall `art_crop`, preferring the oldest
printing where a card name appears in both catalogs. The set's scripts create
19 tokens and all 19 are bound in `bng-token-printings-v1.json`, each to the
oldest Scryfall token printing that states the same token, so the art does not
always come from BNG's or THS's own token sheet:

| token (Forge name) | printing | note              |
| ------------------- | -------- | ------------------ |
| Cat Soldier Token   | TBNG 1   | 1/1 W Cat Soldier  |
| Soldier Token       | TBNG 1   | 1/1 W Soldier      |
| Bird Token          | TBNG 2   | 2/2 U Bird         |
| Kraken Token        | TBNG 9   | 9/9 U Kraken       |
| Zombie Token        | TBNG 2   | 2/2 B Zombie       |
| Elemental Token     | TBNG 3   | 3/1 R Elemental    |
| Centaur Token       | TBNG 3   | 3/3 G Centaur      |
| Gold Token          | TBNG —   | colorless Gold     |
| Wolf Token          | TLRW 2   | 2/2 G Wolf         |
| Cleric Token        | TTHS 2   | 2/1 W Cleric       |
| Bird Token          | TTHS 2   | 2/2 U Bird         |
| Elemental Token     | TTHS 1   | 1/0 U Elemental    |
| Harpy Token         | TTHS 1   | 1/1 B Harpy        |
| Soldier Token       | TTHS 1   | 1/1 R Soldier      |
| Boar Token          | TTHS 2   | 2/2 G Boar         |
| Satyr Token         | TTHS 2   | 2/2 RG Satyr       |
| Golem Token         | TTHS 3   | 3/3 colorless Golem|
| Soldier Token       | TUGL 1   | 1/1 W Soldier      |
| Bird Token          | TZEN 1   | 1/1 W Bird         |

No token is left unbound. Two names repeat across the catalogs, and both fail
closed rather than resolving to one printing: a white 1/1 Soldier appears as
both TBNG and TUGL, and a blue 2/2 Bird appears as both TBNG and TTHS. Each
pair shares its colors and power/toughness across two different token oracle
ids, so `printingFor` in `packages/ui/src/routes/play/backend-position.ts`
cannot disambiguate by color or by age within one oracle id and draws the
labeled pending frame instead of guessing between them. `bng-printed-format.test.ts`
pins both pairs by name, and neither art is missing: the token is bound, only
the live surface's selection between the two printings is unresolved. No
emblem or other non-token-script surface is excluded from this set; BNG and
THS mint no emblems.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins BNG at 165 of 165 scripts closed and THS
at 234 of 234. Nineteen review entries were added for this build
(`forge-syntax-review-v1.json`): `Bestow` is mapped to optional-costs, `Tribute`
and `Exchange` to replacement-trigger-choices, `MultiplePiles` to
zone-card-selection; `Untaps`, `ControlSpell` and the remaining plain-text
protection and bookkeeping parameters are `non-choice`. The decision inventory
(`decision-inventory-v2`) reports no unknown syntax and no missing generated
dependency; the complete coverage plan has all 399 scripts `complete`;
qualification is 399 qualified, residual 0.

The two scenario witnesses are Hero's Downfall (local, unconditional targeted
removal, three Swamps) and Swordwise Centaur (engine, attack), and four match
probes over `bng-match-fixture.ts` (Forest and Avacyn's Pilgrim). Every seed
worked on the first attempt: `bng-local-pregame-v1` for the match fixture,
`bng-heros-downfall-local-contract-v1` and `bng-swordwise-centaur-engine-contract-v1`
for the two scenario witnesses.

`bng-printed-format.test.ts` re-verifies the admission, and the registry entry
is in `printed-formats-v1.json`. `play-admission-v1` was built directly against
the bridge digest already installed (`53d03a0c...`, the structural
Phyrexian-mana cost rule), so no re-bind step or second admission version was
needed.

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `bng`.

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
