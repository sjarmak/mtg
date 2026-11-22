# Mirrodin Besieged (MBS) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.4`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no MBS-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited, so no re-bind is needed.

## Product and identity

Eight-seat draft is MBS, MBS, MBS; sealed is six MBS boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 155
exact Scryfall printings of the set (ten of them are the five basic lands, two
printings each), mapped to 150 distinct Forge scripts.

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `bc4efe372feee7509b56ff7bde6afb38ef55b6102b98014e07c957aeeeab2ed8` |
| catalog MBS `contentSha256`          | `d2c50838a04a14b260842f4dc2eac02a6bb1e70199278cf06ccd69d57a3131c0` |
| source pin (`sources.json`)          | `be3ad46332067cd2eb505cd8632b2d8dc227b3a39c05119537e2a02f35ed2ed6` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `fd5ee51af13f23d4b03055e78137591fbc6c44412502f4af50f3434792d76b71` |
| display metadata file                | `42b7ed4aec97f08b0a1f4069aeb0278f94ba6a7ada9cd03190a57d64714f0c82` |

## Rebuilding

The source pin is `data/cache/mbs-20260919-source-pin/` (MTGJSON
5.3.0+20260917 and the Scryfall snapshot fetched 2026-09-19). The writers emit
prettier-formatted JSON, so the copies below need no formatting pass. Each tool
refuses an existing output, so bump the version segment of every `out/mbs/...`
path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets MBS --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/mbs/onboarding-format-v1.json --sources data/cache/mbs-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/mbs/build-v2
cp out/mbs/build-v2/mbs-printed-catalog-v1.json out/mbs/build-v2/mbs-limited-format-v1.json out/mbs/build-v2/build-evidence.json packages/data/data/mbs/
cp out/mbs/build-v2/sources.json packages/data/data/mbs/mbs-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/mbs-20260919-source-pin --catalog packages/data/data/mbs/mbs-printed-catalog-v1.json > packages/data/data/mbs/mbs-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/mbs/mbs-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Every one of the 155 card printings has `art.status: available` (a Scryfall
`art_crop`). Where several Scryfall printings of a card exist, the oldest by set
release order is chosen (`packages/printed-card/src/set-release-order.ts`,
`mtg-j4ucd.2`). The set's scripts create nine tokens; eight are bound in
`mbs-token-printings-v1.json`, each to the oldest Scryfall token printing that
states the same token, so the art does not always come from MBS's own token set:

| token (Forge name)     | printing | note                                                                                                             |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Phyrexian Horror Token | TBRC     | Phyrexian Rebirth                                                                                                |
| Phyrexian Myr Token    | TCMM     | Myr Sire                                                                                                         |
| Golem Token            | TMBS     | Titan Forge                                                                                                      |
| Thopter Token          | TMBS     | Thopter Assembly                                                                                                 |
| Phyrexian Germ Token   | TMBS     | Living Weapon: Bonehoard, Flayer Husk, Mortarpod, Skinwing, Strandwalker; TMBS 1 "Germ", bound by a stated alias |
| Cat Token              | TSOM     | White Sun's Zenith                                                                                               |
| Myr Token              | TSOM     | Master's Call, Myr Turbine                                                                                       |
| Soldier Token          | TUGL     | Hero of Bladehold; a silver-border token, the oldest 1/1 white Soldier                                           |

**Unbound: Phyrexian Zombie Token** (2/2 black, created by Nested Ghoul,
script `b_2_2_phyrexian_zombie`). Forge names the token "Phyrexian Zombie Token"
with the type line `Creature Phyrexian Zombie`; Scryfall prints no token with
that name or type (TMBS has a plain "Zombie", `Token Creature — Zombie`), and a
binding has to match the script's name and facts, so the card shows the labeled
pending frame for its token. Binding TMBS's Zombie to the Forge name would
fail the type check in `token-printings.test.ts`, the same shape as
Wurmcoil Engine's two Wurms in the Legacy Cube sheet.
`mbs-printed-format.test.ts` pins that list.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins MBS at 150 of 150 scripts closed by the
shared review table; 11 review entries were added for it
(`forge-syntax-review-v1.json`), all `non-choice`, each citing the MBS script
lines that carry the token. They also close scripts in 214 other editions
(`forge-syntax-closure-v1.json` records the new counts; none went down).
Qualification: 150 qualified, residual 0.

`play-admission-v2/` was built with the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v6`, witnesses in
`observed-mbs-contract-witness.integration.test.ts` (Go for the Throat as the
local seat, Leonin Skyhunter as the engine seat) and four match probes over
`test/support/mbs-match-fixture.ts` (Forest x30 plus Avacyn's Pilgrim x30; no
MBS card is in the audited slice). `mbs-printed-format.test.ts` re-verifies it.
The registry entry is in `printed-formats-v1.json`.

`play-admission-v3/` was a verified full-card and match admission for the same
150 scripts, rebuilt 2026-09-19 against Forge 2.0.14 for the Phyrexian-mana
structural rule (`mtg-t5ma0`): the bridge's Phyrexian-mana allowlist of four
reviewed cards was replaced with a structural check on the cost itself,
changing the bridge digest without touching the adapter. v3 re-admits the
same 150 scripts and the same four match probes as v2 under the new bridge;
the qualification bundle reported `qualified: 150, residual: 0`. Built with
the six-step recipe in `packages/data/data/isd/README.md` (Play admission).

`play-admission-v4/` re-binds v3 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `mbs`.

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
