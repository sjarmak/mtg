# Dragon's Maze (DGM) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.11`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no DGM-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited (the adapter hash below is the one the other installed
admissions carry).

## Product and identity

Dragon's Maze is a Ravnica block finale, drafted as the block: eight seats,
rounds `[dgm-draft, gtc-draft, rtr-draft]`, one pack of each in that order.
Sealed is two boosters of each (`2/2/2`). Basic lands stay in the packs
(`basicLandPolicy: keep`), which is the one departure from the other registered
formats and has a reason: DGM's land slot deals Guildgates and Maze's End beside
basics, so removing the basics empties no slot and leaves a DGM pack at 15 cards
while Gatecrash and Return to Ravnica packs fall to 14. The printed draft
refuses rounds of unequal pack size (`printed draft requires equal-sized booster
configurations across rounds`), and with `remove` the multi-format gateway test
failed on exactly that. With `keep` every pack is 15. The recipe therefore names three source codes and
three products, and all three catalogs are registered together:

| catalog | printings | scripts |
| ------- | --------- | ------- |
| DGM     | 156       | 141     |
| GTC     | 249       | 249     |
| RTR     | 274       | 254     |

That is 679 printings and 649 scripts in all. RTR prints each of its five basic
lands five times and those 25 printings share five scripts.

Gatecrash is already registered as its own format, with Return to Ravnica as its
dependency catalog (`gtc/`). This directory nonetheless carries its own copies of the GTC and RTR catalogs instead of reading `gtc/`.
A catalog's `contentSha256` binds its provenance hash, and the provenance names
the source pin the catalog was built from, so the identical cards built from this
build's pin hash differently (GTC `515aaffb...` here against `bf7b418c...`
there). The registry also requires a catalog `file` to be a filename inside the
format's own directory. A shared file would mean either editing a set that is
already admitted or a format hash that depends on another directory, so the
copies are staged and rebuilt from this build's pin.

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| format `contentSha256`      | `4a201837bf67cf9245b9ec9fde6bca673ebc51ab80b574e38e455a4d210b4bad` |
| catalog DGM `contentSha256` | `edafb6d66d5329df195c8d3c2f71fed2487c94d6dbdfb8efbd0b6244fe759063` |
| catalog GTC `contentSha256` | `515aaffb14562be9f9fad0bb0a71686af871966f83258a0c343c028456deeccb` |
| catalog RTR `contentSha256` | `b26f72507bfb6b98db9e565a8af04769d04db8b4cdc327e3b037bd294958a845` |
| source pin (`sources.json`) | `130fd21596f5e3d22c83306f7729920c5eaf15efee8c9519e33c79c065d9bb3b` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| bridge (`bridgeSha256`)     | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`adapterSha256`)   | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file        | `ea8bb5ed79d3796618af68d0f12d6ae5caa08516a8e730d873823be9b8763fc9` |
| display metadata file       | `d629eb8b453398647a0ba71e611cde5f25b3bcd87db6fec0a647a2204085b595` |

## Rebuilding

The source pin is `data/cache/dgm-gtc-rtr-20260920-source-pin/` (the MTGJSON and
Scryfall snapshots for DGM, GTC and RTR fetched 2026-09-20). The writers emit
prettier-formatted JSON, so the copies below need no formatting pass. Each tool
refuses an existing output, so bump the version segment of every `out/dgm/...`
path. Every tool that takes catalogs wants one `--catalog` flag per file.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets DGM,GTC,RTR --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/dgm/onboarding-format-v1.json --sources data/cache/dgm-gtc-rtr-20260920-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/dgm/build-v2
cp out/dgm/build-v2/dgm-printed-catalog-v1.json out/dgm/build-v2/gtc-printed-catalog-v1.json out/dgm/build-v2/rtr-printed-catalog-v1.json out/dgm/build-v2/dgm-limited-format-v1.json out/dgm/build-v2/build-evidence.json packages/data/data/dgm/
cp out/dgm/build-v2/sources.json packages/data/data/dgm/dgm-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/dgm-gtc-rtr-20260920-source-pin --catalog packages/data/data/dgm/dgm-printed-catalog-v1.json --catalog packages/data/data/dgm/gtc-printed-catalog-v1.json --catalog packages/data/data/dgm/rtr-printed-catalog-v1.json > packages/data/data/dgm/dgm-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/dgm/dgm-printed-catalog-v1.json --catalog packages/data/data/dgm/gtc-printed-catalog-v1.json --catalog packages/data/data/dgm/rtr-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Card art is each printing's Scryfall `art_crop`, and where a name has more than one
printing the oldest is preferred. The three catalogs share no card name, so each
card has one printing to choose from. The set's scripts create 20 tokens and all 20
are bound in `dgm-token-printings-v1.json`, each to the oldest Scryfall token
printing that states the same token, so the art does not always come from a
Ravnica token sheet:

| token (Forge name) | printing | note               |
| ------------------ | -------- | ------------------ |
| Saproling Token    | T10E 5   | 1/1 G Saproling    |
| Ooze Token         | TALA 8   | `*/*` G Ooze       |
| Angel Token        | TCON 1   | 4/4 W Angel        |
| Elemental Token    | TDGM 1   | `*/*` WG Elemental |
| Spirit Token       | TEVE 4   | 1/1 WB Spirit      |
| Frog Lizard Token  | TGTC 3   | 3/3 G Frog Lizard  |
| Cleric Token       | TGTC 4   | 1/1 WB Cleric      |
| Horror Token       | TGTC 5   | 1/1 UB Horror      |
| Soldier Token      | TGTC 6   | 1/1 WR Soldier     |
| Knight Token       | TRTR 2   | 2/2 W Knight       |
| Assassin Token     | TRTR 4   | 1/1 B Assassin     |
| Dragon Token       | TRTR 5   | 6/6 R Dragon       |
| Centaur Token      | TRTR 7   | 3/3 G Centaur      |
| Rhino Token        | TRTR 9   | 4/4 G Rhino        |
| Wurm Token         | TRTR 11  | 5/5 G Wurm         |
| Elemental Token    | TRTR 12  | 8/8 WG Elemental   |
| Rat Token          | TSHM 3   | 1/1 B Rat          |
| Soldier Token      | TUGL 90  | 1/1 W Soldier      |
| Goblin Token       | TUGL 92  | 1/1 R Goblin       |
| Bird Token         | TZEN 2   | 1/1 W Bird         |

Two names repeat. The Soldier pair differs in color (red-white and white), so
`printingFor` in `packages/ui/src/routes/play/backend-position.ts` tells them
apart. The Elemental pair does not: both are green-white, the two printings carry
different oracle ids, and that lookup settles same-named printings by color and
then by age within one oracle id, so an Elemental token draws the labeled pending
frame instead of either picture. Rules play is unaffected, since the object's
rules text and power and toughness come from the engine. Telling the pair apart
needs the object's power and toughness in `printingFor`, which is a change to
shared play-surface code and is left out of this build; `dgm-printed-format.test.ts`
pins the pair so a second same-colored duplicate cannot arrive unnoticed. No token
oracle id repeats under one name, so no `set-release-order.ts` entry is needed.

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins DGM at 141 of 141 scripts closed; GTC and RTR
were already pinned by Gatecrash. Fifteen review entries were added for this
build (`forge-syntax-review-v1.json`), each citing the script lines it was read
from, and two `Mode$` tokens (`AssignNoCombatDamage`, `Evolved`) were added to
`forge-effect-controller-calls-v1.json`. The decision inventory
(`decision-inventory-v2`) reports no unknown syntax and no missing generated
dependency; the complete coverage plan has all 649 scripts `complete`;
qualification is 649 qualified, residual 0. The plan was rebuilt against the
`printed-controller-contracts-protocol2-v7` bundle.

## Fuse

Fuse is the mechanic a bridge is least likely to express, because it lets a
split card be cast as both halves at once from hand, which is a third spell
ability on top of the two halves. Forge builds it as exactly that: the hand
priority decision for Alive // Well lists the two halves and a third ability
`Alive // Well: Fuse (You may cast one or both halves of this card from your
hand.)`. `observed-dgm-fuse-witness.integration.test.ts` casts the third
ability on real Forge with four Forests and a Plains, is charged the combined
cost `{3}{W}{G}` through the ordinary mana-payment decisions, and sees both halves
resolve: a Centaur token from Alive, then the life gain from Well counting it,
ending at 22 life. The inventory maps the `Fuse` keyword to the `priority` family,
which the reusable contracts already cover. This witness is not one of the
scenario probes, so it is evidence in the repository and not an input to the
admission.

The scenario witnesses that produced the admission's receipts are Putrefy (local,
targeted removal, two-color cost) and Bane Alley Blackguard (engine, attack), plus
four match probes over `dgm-match-fixture.ts` (Forest and Avacyn's Pilgrim). The
starting-player seed is `dgm-local-pregame-v8`; `-v1` through `-v7` each failed with
`expected { seat: +0, ...(4) } to match object { kind: 'mulligan', ... }`, the seed
not handing the engine seat the starting choice.

`dgm-printed-format.test.ts` re-verifies the admission, and the registry entry is
in `printed-formats-v1.json`.

`play-admission-v2/` re-binds v1 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `dgm`.

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
