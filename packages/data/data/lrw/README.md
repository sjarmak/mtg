# Lorwyn printed format

## Product and identity

This standalone Lorwyn format contains all 301 official LRW positions from the
pinned MTGJSON 5.3.0+20260929 and Scryfall snapshots. The catalog resolves to
286 distinct Forge scripts. Draft uses three `lrw-draft` packs and sealed uses
six; basic lands are removed from opened packs.

The source pin is `data/cache/lrw-20260929-worker3-source-pin/`. The Limited
format hash is
`0f3ac5264d0a3ca5d99f513e674a732713d49060045ec5987818176b232611be`, the
catalog hash is
`5563a5eb1e2b24a42f12ffc836cfbe2b483f4d9e757dcdaa1e8d40ca2d791657`, and
the source manifest hash is
`d3722e012ea73716d638c131db5ce57ae1db1c484baf99b03122d623747bfcfe`.
`build-evidence.json` binds those artifacts to Forge archive
`5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173`.

## Mechanics and art

The catalog includes Champion, Changeling, Clash, Evoke, Hideaway, Kindred,
the original five planeswalkers, and Lorwyn's tribal card types. Kinship and
hybrid mana do not occur in the official LRW positions. Every card carries its
original Lorwyn printing's Scryfall art, and all 11 token printings required by
the 12 generated-token references carry art from their oldest printing.

## Play admission

`play-admission-v3/` admits all 301 physical printings and all 286 scripts with
no residual. Qualification uses the reusable real-Forge scenario contracts and
all four match probes. The observed catalog sweep opens 30 coverage-directed
sealed games with a ten-turn, 600-decision bound.

## Constructed pilot decks

`lrw-constructed-format-v1.json` contains White-Blue Merfolk, Five-Color
Elementals and White-Black-Green Treefolk. Each deck passed structural
validation and completed a game against the Forge bot.

White-Green Kithkin and Black-Green Elves failed at an unreviewed
`ability-selection` action. Blue-Black Faeries failed at an unreviewed
`confirm-action` action. Black-Red Goblins and Red-White Giants failed at an
unreviewed `library-top-or-bottom` action. Those five decks remain excluded
from the constructed format.

Build each archetype artifact from `archetypes-v1.json` with an explicit model
ceiling and the account selected at dispatch time:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format lrw --archetype 'White-Blue Merfolk' --colors W,U --prompt 'Build around Summon the School: Use Merfolk tap and untap synergies to create a widening board, then turn repeated token production into inevitability.' --lands 32 --max-usd 20 --output out/lrw-constructed/white-blue-merfolk.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof through the Constructed page's table builder and HTTP gateway, then
emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format lrw --artifacts out/lrw-constructed --candidate --out out/lrw-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format lrw --candidate out/lrw-constructed/candidate.json --out out/lrw-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format lrw --artifacts out/lrw-constructed --receipt out/lrw-constructed/forge-receipt.json --out packages/data/data/lrw/lrw-constructed-format-v1.json
```
