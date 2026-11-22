# Zendikar

Zendikar (`ZEN`) is installed as a single-set printed format for browse, draft,
sealed and Forge play. The catalog contains all 269 English physical printings
from the set and binds 234 distinct Forge card scripts.

## Pinned sources and build

The import pins MTGJSON `5.3.0+20260929` and the English Scryfall printing
search fetched on 2026-09-29. `zen-printed-sources-v1.json` is the source
ledger; `build-evidence.json` binds it to the catalog and Limited product.

| Subject | SHA-256 |
| --- | --- |
| Limited format content | `5ae93d39d406257f0f4e0321af0e5f14df1810c98b8586baa9a70b1513ca097c` |
| Source ledger | `6799a8c589e274ebdb349484da52a1efdd631bd8dcdacdd87a125f6e5976c0d0` |
| Forge card-script archive | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| ZEN catalog content | `caacc45fc6280ca35ff61e5c8caed0fff6ab438969fd3999ee4bc4bf431da02f` |

The Limited product uses three ZEN boosters for draft and six for sealed.

## Card and token art

Every catalog printing has Scryfall art. `zen-display-metadata-v1.json` binds
rarity and source provenance for the gallery and play surfaces.

`zen-token-printings-v1.json` resolves all eleven token names created by ZEN
scripts to the oldest matching physical token printing available from
Scryfall. Nine use the ZEN token sheet; Angel uses `TCON`, and Wolf uses
`TLRW`. All eleven have art, so none falls back to a pending frame.

## Mechanics and qualification

The qualification covers every one of the 234 root scripts with reusable
controller contracts and has no residual scripts. Real Forge witnesses cover
local target selection and removal through Hideous End, engine combat through
Cliff Threader, and the four match seams: starting player, mulligan, pregame
and priority.

The catalog exercises Zendikar's Landfall, Kicker, Allies, Traps, Quests and
Equipment. Kor Skyfisher's mandatory return and Living Tsunami's optional
upkeep land return are exact reviewed bridge routes. Rebound is not present in
ZEN; it first appears later in the block. ZEN also predates double-faced cards,
so the catalog has no DFC layout to admit.

## Constructed pilot decks

`zen-constructed-format-v1.json` contains one decklab-built deck for each
declared archetype. Every list is exactly 60 cards, passes the decklab power
floor, contains only admitted ZEN printings and is retained only after
completing a serial game against the Forge bot.

| Archetype | Result | Forge proof |
| --- | --- | --- |
| Kor Armory | Shipped | Completed, 205 decisions |
| Pumped Up | Shipped | Completed, 181 decisions |
| Rise of the Vampires | Shipped | Completed, 272 decisions |
| The Adventurers | Shipped | Completed, 107 decisions |
| Unstable Terrain | Shipped | Completed, 79 decisions |

Build or rebuild one archetype with an explicit model ceiling. `<claude-config>`
is the selected account home's `.claude` directory, resolved fresh at dispatch
time:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format zen --archetype 'Kor Armory' --colors W --prompt 'Equip a wide Kor battlefield, use Armament Master to amplify every equipped creature, and finish with an aerial attack.' --lands 32 --max-usd 20 --output out/zen-constructed/kor-armory.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof, then emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format zen --artifacts out/zen-constructed --candidate --out out/zen-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format zen --candidate out/zen-constructed/candidate.json --out out/zen-constructed/forge-receipt-v2.json
npx tsx packages/data/tools/build-printed-constructed.ts --format zen --artifacts out/zen-constructed --receipt out/zen-constructed/forge-receipt-v2.json --out packages/data/data/zen/zen-constructed-format-v1.json
```

## Play admission and activation

The installed admission binds the catalog, Limited product, controller
contracts, observed adapter, compiled Forge bridge and real probe evidence by
content digest. Any bridge or observed-adapter edit requires rebinding every
registered printed format with
`packages/data/tools/printed-admission-rebind-all.mjs`.

The registry exposes ZEN beside the other printed formats. The live journey
reads that registry and proves gallery art, sealed construction, a Forge match
to a land drop, table close and reload, an eight-seat draft with a mid-draft
reload, and a match using the drafted deck.
