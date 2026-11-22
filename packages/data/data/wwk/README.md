# Worldwake / Zendikar

Worldwake (`WWK`) is installed as the historical WWK-ZEN-ZEN draft format for
browse, draft, sealed and Forge play. Its format-local catalogs contain all 145
English WWK physical printings and all 269 English ZEN physical printings,
binding 379 distinct Forge card scripts.

## Pinned sources and build

The import pins MTGJSON `5.3.0+20260930` and the English Scryfall printing
searches fetched on 2026-09-30. `wwk-printed-sources-v1.json` is the source
ledger; `build-evidence.json` binds it to both catalogs and the Limited product.

| Subject | SHA-256 |
| --- | --- |
| Limited format content | `87d0e8fe14c021df08b5381f1886930ce3d975b9f7c20f3658886c37cb9b9eb7` |
| Source ledger | `ab12f3660d514cdd1cb89434a92973a0a02baacfb7cec5d574784f1e1459903e` |
| Forge card-script archive | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| WWK catalog content | `2e12f15c19c867e5508b276f5565eaa734cd2ed93be9c2fd42542d8a44691eab` |
| ZEN catalog content | `a83df5125b9e8f026ed19876cfae14ac7089451fa07237b27d9c1f549942f37d` |

Draft uses one WWK booster followed by two ZEN boosters. Sealed uses two WWK
and four ZEN boosters. Basic lands are removed from each source booster, so
both products use fourteen-card packs. The staged ZEN catalog is deliberately
format-local: it is rebuilt from this recipe's pin and carries this format's
physical identifiers and provenance rather than referring to the standalone
ZEN installation.

## Card and token art

Every catalog printing has Scryfall art. `wwk-display-metadata-v1.json` binds
rarity and source provenance for the gallery and play surfaces.

`wwk-token-printings-v1.json` resolves all seventeen token scripts referenced
across WWK and ZEN to their oldest matching English physical token printings.
All seventeen have Scryfall art, including the Worldwake Soldier Ally, Plant
and Construct tokens, so none falls back to a pending frame.

## Mechanics and qualification

The qualification covers all 379 root scripts with reusable controller
contracts and has no residual scripts. Real Forge witnesses cover local target
selection and removal through Smother, engine combat through Cliff Threader,
and the four match seams: starting player, mulligan, pregame and priority.

Multikicker is witnessed through Worldwake's Everflowing Chalice with repeated
optional-cost selection. The remaining keyword surfaces are already exercised
by the staged ZEN catalog or shared Forge contracts. Named counters use the
existing counter projection; artifacts, Equipment, lands, Traps and the
planeswalker card type use the generic type and ability routes. The catalog
sweep also reached Mire's Toll's revealed-hand discard and Razor Boomerang's
unattach cost, which are pinned to their exact card and ability shapes in the
bridge.

The final catalog-coverage sweep opens sealed games with sixteen targeted
catalog printings per deck. Its original 32-seed run covered 377 unique
printings and exposed the two exact bridge gaps above; both affected seeds
finish after the fixes. The two other incomplete seeds were Forge process
timeouts rather than adapter refusals.

## Constructed pilot decks

`wwk-constructed-format-v1.json` ships four decklab-built decks from the
declared archetypes. Every shipped list is exactly 60 cards, passes the
decklab power floor, contains only admitted WWK and ZEN printings and completed
a serial game against the Forge bot.

| Archetype | Result | Forge proof |
| --- | --- | --- |
| White-Blue Fliers | Shipped | Completed, 223 decisions |
| Blue-Black Allies | Shipped | Completed, 193 decisions |
| Black-Red Aggro | Shipped | Completed, 189 decisions |
| Red-Green Landfall | Shipped | Completed, 152 decisions |
| Green-White Allies | Failed | Unreviewed `confirm-action` after 100 decisions |

Build or rebuild one archetype with the selected account home's `.claude`
directory and an explicit model ceiling. The name, colors and prompt must match
the corresponding entry in `archetypes-v1.json` exactly:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format wwk --archetype 'White-Blue Fliers' --colors W,U --prompt 'Build an evasive force, protect it with efficient interaction, and keep land creatures from stopping attacks with Horizon Drake.' --lands 36 --max-usd 20 --output out/wwk-constructed/white-blue-fliers.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof and emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format wwk --artifacts out/wwk-constructed --candidate --out out/wwk-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format wwk --candidate out/wwk-constructed/candidate.json --out out/wwk-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format wwk --artifacts out/wwk-constructed --receipt out/wwk-constructed/forge-receipt.json --out packages/data/data/wwk/wwk-constructed-format-v1.json
```

## Play admission and activation

The installed admission binds both catalogs, the Limited product, controller
contracts, observed adapter, compiled Forge bridge and real probe evidence by
content digest. It admits all 414 physical printings, all 379 scripts and four
match probes.

The registry exposes WWK beside the other printed formats. The live journey
reads that registry and proves gallery art, sealed construction, a Forge match
to a land drop, table close and reload, an eight-seat WWK-ZEN-ZEN draft with a
mid-draft reload, and a match using the drafted deck.
