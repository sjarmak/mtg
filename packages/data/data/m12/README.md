# Magic 2012 (M12) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.7`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no M12-specific
source file exists in the workspace and the Node adapter has never been edited
(the adapter hash below is the one every onboarded set carries), but the bridge
has: `play-admission-v2` re-binds `play-admission-v1` to the Phyrexian-mana
structural rule added to `ForgeBridge.java` (`mtg-t5ma0`), and `play-admission-v3` re-binds v2 to the six Kaladesh edits (`mtg-j4ucd.19`).

## Product and identity

Eight-seat draft is M12, M12, M12; sealed is six M12 boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 249
exact Scryfall printings of the set, mapped to 234 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `772349d7a29e9ab94b10d67a5cba8b47189f5fa334b848997485c9ae0d0f7f01` |
| catalog M12 `contentSha256`          | `6f6a635a7d9795fd2dda5c6964f5cd3e13b0c549a8b2fd13cc88a0cf87dbcf95` |
| source pin (`sources.json`)          | `e89db0588c94705ff99646f597edbd4c9332d142db2a3f00c46125be97108c4a` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `c344ae15e825bf217887dbba0fa3893b69db1cf15e634de387aaddf5756e9232` |
| display metadata file                | `19c358fd2d3caffdb87e398304377d15e13b2affa3ca58b7738cabe114229737` |

## Rebuilding

The source pin is `data/cache/m12-20260919-source-pin/` (the MTGJSON and
Scryfall snapshot fetched 2026-09-19). The writers emit prettier-formatted
JSON, so the copies below need no formatting pass. Each tool refuses an
existing output, so bump the version segment of every `out/m12/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets M12 --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/m12/onboarding-format-v1.json --sources data/cache/m12-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/m12/build-v2
cp out/m12/build-v2/m12-printed-catalog-v1.json out/m12/build-v2/m12-limited-format-v1.json out/m12/build-v2/build-evidence.json packages/data/data/m12/
cp out/m12/build-v2/sources.json packages/data/data/m12/m12-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/m12-20260919-source-pin --catalog packages/data/data/m12/m12-printed-catalog-v1.json > packages/data/data/m12/m12-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/m12/m12-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Every one of the 249 card printings has `art.status: available` (a Scryfall
`art_crop`); where several Scryfall printings of a card exist, the oldest by
set release order is chosen (`packages/printed-card/src/set-release-order.ts`,
`mtg-j4ucd.2`). The set's scripts create seven tokens and all seven are bound in
`m12-token-printings-v1.json`, each to the oldest Scryfall printing that states
the same token, so the art does not always come from M12's own token set:

| token (Forge name) | printing | note                                                  |
| ------------------ | -------- | ----------------------------------------------------- |
| Saproling Token    | T10E 5   | oldest 1/1 green Saproling across every token set     |
| Beast Token        | TLRW 7   | oldest 3/3 green Beast across every token set         |
| Bird Token         | TM11 2   | oldest 3/3 white flying Bird across every token set   |
| Wurm Token         | TM12 6   | 6/6 green Wurm, M12's own token sheet                 |
| Pentavite Token    | TM12 7   | 1/1 colorless flying Pentavite, M12's own token sheet |
| Soldier Token      | TUGL 90  | oldest 1/1 white Soldier, a silver-border token       |
| Zombie Token       | TUGL 91  | oldest 2/2 black Zombie, a silver-border token        |

No token is left unbound, so none draws the pending frame.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins M12 at 234 of 234 scripts closed by the
shared review table; 17 review entries were added for it
(`forge-syntax-review-v1.json`, 770 -> 787 entries): Bloodthirst (an
ETB-counters replacement conditioned on damage dealt), CantTarget, SkipPhase,
MultiplyCounter, Fireball's DivideEvenly and TargetedObjects, Doubling Chant's
ImprintChosen, QuasiLibrarySearch and Searched, and eight other tokens, all
`non-choice`: none of them asks a PlayerController for a decision the mapped
families do not already cover. Because the table is shared across every printed
set, this also raised closure counts for other editions that use these tokens.
Qualification: 234 qualified, residual 0.

`play-admission-v1/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, witnesses in
`observed-m12-contract-witness.integration.test.ts` (Doom Blade as the local
seat's targeted removal, Runeclaw Bear as the engine seat's vanilla attacker)
and four match probes over `test/support/m12-match-fixture.ts` (Forest plus
Avacyn's Pilgrim; no M12 card is in the audited slice). The engine-starts seed
is `m12-local-pregame-v4`: `-v1` and `-v3` did not hand the engine the starting
choice, `-v2` and `-v4` did.

`play-admission-v2` re-binds v1 to the same bridge digest every set touched by
`mtg-t5ma0` now carries; the adapter, the format, the catalog, the qualified
script count (234) and the residual (0) are unchanged, and the same
`observed-m12-contract-witness.integration.test.ts` and
`test/support/m12-match-fixture.ts` sources produced the receipts. Re-bind with
the six-step recipe in `packages/data/data/isd/README.md`. `m12-printed-format.test.ts` re-verifies the admission. The
registry entry is in `printed-formats-v1.json`.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `m12`.

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
