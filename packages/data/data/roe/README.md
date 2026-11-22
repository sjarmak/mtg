# Rise of the Eldrazi (ROE) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.6`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no ROE-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited (both hashes below match the ones MBS and every other
onboarded set already carry), so no re-bind is needed.

## Product and identity

Eight-seat draft is ROE, ROE, ROE; sealed is six ROE boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 248
exact Scryfall printings of the set, mapped to 233 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `ada5581e31a3f227ac237343b7d0ab7db6aed423814644f6567a548a57e14bdc` |
| catalog ROE `contentSha256`          | `b20fb6532481136a90d16538e7259d23bae07a3bc2787b8851a4aa45465a7140` |
| source pin (`sources.json`)          | `d07665b4e6f69984d60a6b0ee656eb04fea7e01261c230bf1316ff44f0877dad` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `e9c904d317f0115a1595381ed7a43f1174a5888ceb9c6afaa199b6f2a5aebb25` |
| display metadata file                | `13af77aa3291e24dbdc201827dc41c446c9984ece266f3608a1a9e672643a4d7` |

## Rebuilding

The source pin is `data/cache/roe-20260919-source-pin/` (the MTGJSON and
Scryfall snapshot fetched 2026-09-19). The writers emit prettier-formatted
JSON, so the copies below need no formatting pass. Each tool refuses an
existing output, so bump the version segment of every `out/roe/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets ROE --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/roe/onboarding-format-v1.json --sources data/cache/roe-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/roe/build-v2
cp out/roe/build-v2/roe-printed-catalog-v1.json out/roe/build-v2/roe-limited-format-v1.json out/roe/build-v2/build-evidence.json packages/data/data/roe/
cp out/roe/build-v2/sources.json packages/data/data/roe/roe-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/roe-20260919-source-pin --catalog packages/data/data/roe/roe-printed-catalog-v1.json > packages/data/data/roe/roe-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/roe/roe-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Every one of the 248 card printings has `art.status: available` (a Scryfall
`art_crop`); where several Scryfall printings of a card exist, the oldest by
set release order is chosen (`packages/printed-card/src/set-release-order.ts`,
`mtg-j4ucd.2`). The set's scripts create eight tokens; seven are bound in
`roe-token-printings-v1.json`, each to the oldest Scryfall printing that states
the same token, so the art does not always come from ROE's own token set:

| token (Forge name)  | printing | note                                                      |
| ------------------- | -------- | --------------------------------------------------------- |
| Dragon Token        | T10E     | oldest 5/5 flying red Dragon token across every token set |
| Ooze Token          | TALA     | oldest \*/\* green Ooze token across every token set      |
| Elemental Token     | TROE     | \*/\* red Elemental token, ROE's own token sheet          |
| Hellion Token       | TROE     | 4/4 red Hellion token, ROE's own token sheet              |
| Kor Soldier Token   | TZEN     | oldest 1/1 white Kor Soldier token across every token set |
| Eldrazi Spawn Token | TROE 1a  | 0/1 colorless, "Sacrifice this creature: Add {C}."        |
| Elephant Token      | TDDD T3  | 3/3 green vanilla, a Duel Deck token                      |

Eldrazi Spawn and Elephant are the two whose Scryfall printings carry a
collector number with letters in it (`1a`/`1b`/`1c`, `T3`). `mtg-bhv1i` taught
`bindTokenPrintings` to take those: a plain integer keeps the position and
`physicalId` every installed file was written with, and a lettered number takes
its first digit run as its position and its own lowercased text as the id
segment (`troe-token:1a:<scryfall id>`, `tddd-token:t3:<scryfall id>`). Only the
oldest printing per token is kept, so the three Eldrazi Spawn arts on TROE's
sheet bind as one, `1a`.

**Unbound: Tuktuk the Returned.** It does have a same-named Scryfall printing
(TROE 5), but its facts don't match the Forge script's, the same "matches the
name, not the facts" failure MBS's unbound Phyrexian Zombie Token hit.
`fetch-token-printings.ts --catalog` reproduces that exclusion, so it is not an
artifact of how the file was originally fetched. Binding it to a
facts-mismatched printing would fail the type check in
`token-printings.test.ts`. `roe-printed-format.test.ts` pins that one name.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins ROE at 233 of 233 scripts closed by the
shared review table; 25 review entries were added for it
(`forge-syntax-review-v1.json`, 745 -> 770 entries, commit `d971e105b`): Rebound
(the upkeep "you may cast" is the OptionalDecider trigger confirmation and the
cast without paying its mana cost is an optional cost, so it maps to both
`optional-costs` and `replacement-trigger-choices`, the same shape as Miracle),
CardChoices/ChoiceAmount (choose-any-number effects) map to `targets`, and the
other 22 (Umbra armor, CantSacrifice, MinMaxBlocker, annihilator's
zone-card-selection dependency, and others) are `non-choice`. Because the table
is shared across every printed set, this also raised closure counts for every
other already-onboarded edition. Qualification: 233 qualified, residual 0.

`play-admission-v2/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, witnesses in
`observed-roe-contract-witness.integration.test.ts` (Flame Slash as the local
seat's unconditional removal, Glory Seeker as the engine seat's vanilla
attacker) and four match probes over
`test/support/roe-match-fixture.ts` (Forest plus Avacyn's Pilgrim; no ROE card
is in the audited slice). `roe-printed-format.test.ts` re-verifies it. The
registry entry is in `printed-formats-v1.json`.

`play-admission-v3/` was a verified full-card and match admission for the same
233 scripts, rebuilt 2026-09-19 against Forge 2.0.14 for the Phyrexian-mana
structural rule (`mtg-t5ma0`): the bridge's Phyrexian-mana allowlist of four
reviewed cards was replaced with a structural check on the cost itself,
changing the bridge digest without touching the adapter. v3 re-admits the
same 233 scripts and the same four match probes as v2 under the new bridge;
the qualification bundle reported `qualified: 233, residual: 0`. Built with
the six-step recipe in `packages/data/data/isd/README.md` (Play admission).

`play-admission-v4/` re-binds v3 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `roe`.

`play-admission-v5/` re-binds v4 (deleted) to the pod board's observed adapter
(`mtg-bc2.154.6.5.4.1`), which names the defender an attack is sent at: `PlayDefender` in
`packages/engine/src/play.ts`, read out of the move id by `forgeAttackDefender` in
`packages/forge-export/src/observed/backend.ts`. Both files are inside the adapter bundle every
printed admission pins, so the adapter digest changes (`b5c63fa8...` to `e5f289d1...`); the bridge,
the format, the catalog and the contracts do not, and the re-bound admission holds the same cards
and the same probe ids, differing only in the adapter it binds and the digests of the freshly
captured evidence. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v6`.

`play-admission-v6/` re-binds v5 (deleted) to the Emancipation Angel and Copter bridge fixes
(`e215264e8`, `ac338d39f`), on top of the Convoke fix admitting plain Convoke structurally
(`mtg-uz0mz`): `ForgeBridge.java` admits Emancipation Angel's bounce and names the refused
zone-choice shape, and folds Smuggler's Copter's Crew route into the Kaladesh Vehicle table. The
compiled bridge digest changes (`eb94daf2...`); the adapter (`e5f289d1...`), the format, the catalog
and the contracts do not. Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v7`. This generation's rebind was left undone by mtg-4qga9's
closing workflow and completed here (`mtg-6qgu5`).

`play-admission-v7/` re-binds v6 (deleted) to the projected-keyword, soulbond-pairing and
player-counter changes (`mtg-pt9dp`, `mtg-in4k9`, `mtg-oin1f`, `mtg-vzxqq`):
`packages/engine/src/projection.ts` projects a permanent's current keywords and a soulbond pair's
badge on `ObjectView`, a same-named token printing is told apart by the keywords the token carries,
and a player's counters such as Energy are projected under the player's name;
`packages/forge-export/bridge/ForgeBridge.java` and `packages/forge-export/src/observed/protocol.ts`
carry the matching wire shape. Both the bridge and the adapter digests change (bridge `da5bcd66...`,
adapter `94b68b36...`); the format, the catalog and the contracts do not. Re-bound for every
registered format at once with `packages/data/tools/printed-admission-rebind-all.mjs`, which runs
the six-step recipe in `packages/data/data/isd/README.md` (Play admission); to re-bind after a
further adapter or bridge change, use output `play-admission-v8` (`mtg-ziwde`).

`play-admission-v8/` re-binds v7 (deleted) to the Improvise bridge fix
(`f18400713`, `ae3bb289e`): `ForgeBridge.java` distinguishes Improvise from Convoke and lets
reviewed artifact payments cover generic mana without choosing colors. The compiled bridge digest
changes (`d4880305...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); the next rebind is
`play-admission-v9/`.

`play-admission-v9/` re-binds v8 (deleted) to the reviewed split-mana bridge fix
(`285b00486`, `mtg-uz0mz.1.1`, `mtg-tho5a9`): the exact Coalition Relic route now also covers
Altar of the Lost, Cascading Cataracts, Molten Slagheap, Plasm Capture and Axebane Guardian, and Market
Festival, returning the color split the local seat chose for each produced mana. The compiled bridge digest
changes
(`ac89d54f...`); the adapter (`94b68b36...`), the format, the catalogs and the contracts do not.
Re-bound for every registered format at once with
`packages/data/tools/printed-admission-rebind-all.mjs`, which runs the six-step recipe in
`packages/data/data/isd/README.md` (Play admission); to re-bind after a further adapter or bridge
change, use output `play-admission-v10/`.
