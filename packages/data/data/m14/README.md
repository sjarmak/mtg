# Magic 2014 (M14) printed Limited format

Registered, play-supported printed format, onboarded through the
`make-set-playable` skill (`mtg-j4ucd.12`) as one of the 19 sets of the batch.
Everything here was built by the shared printed-format tools; no M14-specific
source file exists in the workspace and neither `ForgeBridge.java` nor the Node
adapter was edited (both hashes below match the ones every other onboarded set
carries), so no re-bind is needed. If the bridge lane (`mtg-t5ma0`) lands
after this, the admission must be rebuilt against it (`admission.json` binds
the bridge hash).

## Product and identity

Eight-seat draft is M14, M14, M14; sealed is six M14 boosters. Basic lands are
removed from the packs (`basicLandPolicy: remove`). The catalog holds the 249
exact Scryfall printings of the set, mapped to 234 distinct Forge scripts. The
source pin's `draft` booster is the fifteen-card pack (ten commons, three
uncommons, one rare or mythic, one basic, one foil in nine packs of forty).

| artifact                             | sha256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`               | `03397e96c8e61136e5bbe07b1784a15d1d09c359cbdf5eb3c1af20be7e5b78d1` |
| catalog M14 `contentSha256`          | `2a0afe149013233e35f6639d8f42c873fd5fa0f1564888c60c5a39154ea7283d` |
| source pin (`sources.json`)          | `25139336d3a6b3bb495b89bfef8c87f792eea19168128bc052845ebc98629287` |
| Forge script archive                 | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| compiled bridge (`ForgeBridge.java`) | `702a7926b74257f89a7dae619b89b6d1ff105371d1349c0e5536165b5d9b49d6` |
| adapter (`installed.ts` bundle)      | `e5f289d1949e24d94d0323d78a60d420376f9aa4c27719d363f2f16f0fcdc81d` |
| token printings file                 | `0a10c428d39de43a3abf056d825944d96e8efe3a9636c65d5fb321fb95e54158` |
| display metadata file                | `b561f26756c4ab6b76e2a58c6da9258412efb64aabae50d9e59d005c606b99eb` |

## Rebuilding

The source pin is `data/cache/m14-20260919-source-pin/` (the MTGJSON and
Scryfall snapshot fetched 2026-09-19). The writers emit prettier-formatted
JSON, so the copies below need no formatting pass. Each tool refuses an
existing output, so bump the version segment of every `out/m14/...` path.

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets M14 --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/m14/onboarding-format-v1.json --sources data/cache/m14-20260919-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out out/m14/build-v2
cp out/m14/build-v2/m14-printed-catalog-v1.json out/m14/build-v2/m14-limited-format-v1.json out/m14/build-v2/build-evidence.json packages/data/data/m14/
cp out/m14/build-v2/sources.json packages/data/data/m14/m14-printed-sources-v1.json
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/m14-20260919-source-pin --catalog packages/data/data/m14/m14-printed-catalog-v1.json > packages/data/data/m14/m14-display-metadata-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/m14/m14-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-file>
```

## Art

Every one of the 249 card printings has `art.status: available` (a Scryfall
`art_crop`); where several Scryfall printings of a card exist, the oldest by
set release order is chosen (`packages/printed-card/src/set-release-order.ts`,
`mtg-j4ucd.2`). The set's scripts create ten tokens and all ten are bound in
`m14-token-printings-v1.json`, each to the oldest Scryfall printing that states
the same token, so the art does not always come from M14's own token set:

| token (Forge name) | printing | note                                                 |
| ------------------ | -------- | ---------------------------------------------------- |
| Saproling Token    | T10E 5   | oldest 1/1 green Saproling across every token set    |
| Angel Token        | TCON 1   | oldest 4/4 white flying Angel across every token set |
| Goat Token         | TEVE 1   | oldest 0/1 white Goat across every token set         |
| Beast Token        | TLRW 7   | oldest 3/3 green Beast across every token set        |
| Wolf Token         | TLRW 10  | oldest 2/2 green Wolf across every token set         |
| Sliver Token       | TM14 1   | 1/1 colorless Sliver, M14's own token sheet          |
| Dragon Token       | TM14 6   | 2/2 red flying firebreathing Dragon, M14's own sheet |
| Elemental Token    | TSHM 4   | oldest 1/1 red Elemental across every token set      |
| Cat Token          | TSOM 1   | oldest 2/2 white Cat across every token set          |
| Zombie Token       | TUGL 91  | oldest 2/2 black Zombie, a silver-border token       |

No token is left unbound, so none draws the pending frame. The ten names are
distinct, so no two tokens share a Forge name and the play surface can tell
them all apart (the Dark Ascension Vampires and Scars of Mirrodin Wurms of
`mtg-oin1f` have no counterpart here). `m14-printed-format.test.ts` pins that
every token a script creates is bound and that ten are created.

## Constructed pilot decks

`m14-constructed-format-v1.json` contains the White-Blue Flyers, Blue-Black
Control, Black-Red Sacrifice, Red-Green Creatures and Green-White Slivers decks
that passed structural validation and a complete game against the Forge bot.

Build or rebuild one archetype with an explicit model ceiling. `<claude-config>`
is the selected account home's `.claude` directory, resolved fresh at dispatch
time so capacity routing holds:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format m14 --archetype 'White-Blue Flyers' --colors W,U --prompt 'Build around Air Servant: Hold the ground with defensive creatures and interaction while a concentrated suite of flyers wins overhead.' --lands 36 --max-usd 20 --output out/m14-constructed/white-blue-flyers.json
```

M14 has no allied-color fixing, so its validated lists need enough basics to
meet both colors' on-curve source floors. After every archetype artifact exists,
assemble the candidate, run the serial Forge proof through the same table
builder and HTTP gateway as the Constructed page, then emit only completed
decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format m14 --artifacts out/m14-constructed --candidate --out out/m14-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format m14 --candidate out/m14-constructed/candidate.json --out out/m14-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format m14 --artifacts out/m14-constructed --receipt out/m14-constructed/forge-receipt.json --out packages/data/data/m14/m14-constructed-format-v1.json
```

## Closure, coverage, admission

`forge-syntax-closure.test.ts` pins M14 at 234 of 234 scripts closed by the
shared review table; 7 review entries were added for it
(`forge-syntax-review-v1.json`, 811 -> 818 entries): `Reveal` as an ability API
(Merfolk Spy's random reveal; `RevealEffect` calls `chooseCardsToRevealFromHand`
unless `Random$ True`, so it is mapped to zone-card-selection, and its row was
already in `forge-effect-controller-calls-v1.json`), `MinChoiceAmount` (Vastwood
Hydra, mapped to targets beside `ChoiceAmount`), and five `non-choice` tokens:
`AllowRepeats` (Chandra, Pyromaster), `ForgetDefined` (Elite Arcanist),
`ForgetOnCast` (Quicken), `RemoveTypes` (Haunted Plate Mail) and the
deck-construction keyword on Shadowborn Apostle. Because the table is shared
across every printed set, this also raised closure counts for other editions.
Qualification: 234 qualified, residual 0.

`play-admission-v2/` re-binds v1 (deleted) to the Phyrexian-mana bridge (`mtg-t5ma0`, bridge
digest `53d03a0c...`) that every set on main carried then; the adapter, format, catalog,
qualified script count (234) and residual (0) are unchanged. It was built with the
six-step recipe in `packages/data/data/isd/README.md` over the contract bundle
`out/validation-pilot/printed-controller-contracts-protocol2-v7`. v1 was built with the
contract bundle `out/validation-pilot/printed-controller-contracts-protocol2-v6`, witnesses in
`observed-m14-contract-witness.integration.test.ts` (Doom Blade as the local
seat's targeted removal, Coral Merfolk as both its target and the engine
seat's vanilla attacker) and four match probes over
`test/support/m14-match-fixture.ts` (Forest plus Avacyn's Pilgrim; no M14 card
is in the audited slice). The engine-starts seed is `m14-local-pregame-v3`:
`-v1`, `-v2` and `-v4` did not hand the engine the starting choice, `-v3` did.
`m14-printed-format.test.ts` re-verifies the admission. The registry entry is
in `printed-formats-v1.json`.

`play-admission-v3/` re-binds v2 (deleted) to the Kaladesh bridge (`mtg-j4ucd.19`), which
adds six reviewed shapes to `ForgeBridge.java`: Crew for any Vehicle, `{E}` (Energy) payments,
Fabricate, and the exact discard and search shapes of Cathartic Reunion, Verdant Crescendo and
Cloudstone Curio. The compiled bridge digest changes (`702a7926...`); the adapter, the format, the
catalog and the contracts do not. Re-bound with the six-step recipe in
`packages/data/data/isd/README.md` (Play admission), run with format id `m14`.

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

## Known gaps

The Slivers (Sentinel, Manaweft, Predatory and the rest) grant abilities to
every Sliver on the battlefield through static abilities; no new decision
family appeared in the inventory or the probes for them, so no contract gap was
found. The witnesses do not exercise a Sliver, Chandra, Pyromaster's copy-cast
(`Play` with `AllowRepeats`) or Vastwood Hydra's counter distribution: those
scripts are covered by the family contracts (`zone-card-selection`, `targets`,
`naming-text-numbers`), not by a card-level real-Forge witness.
