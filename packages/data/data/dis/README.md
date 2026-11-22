# Dissension printed Limited format

## Product and identity

This is the complete Ravnica block Limited format. Eight-seat draft opens
`DIS-GPT-RAV`; sealed opens two boosters from each set. Basic lands remain in
packs, matching the source product definitions.

The local catalogs contain 180 DIS, 167 GPT and 306 RAV physical printings:
653 printings backed by 636 distinct Forge scripts. The copied block catalogs
are provenance-bound to this format and do not depend on the standalone RAV or
GPT directories.

| artifact | sha256 |
| --- | --- |
| format `contentSha256` | `a85d431f70af2280acd5e81ed1f6e3d4fe097d2fcfd790840c40215347bdb800` |
| DIS catalog `contentSha256` | `53b945b50fddb51b2d05203c7ad9ffeaf9ffa7c98da953655e491c240e0e59a4` |
| GPT catalog `contentSha256` | `071bdf7dcacab0b58fa2f5a2221d67a1e8789661a790ea74786bd554fd49a3b2` |
| RAV catalog `contentSha256` | `b539f35d7987fbbe523aebbba866f3a96033c8880798ee0022cf8d7528c7d775` |
| source pin | `a8955c186c594e264f28ec6e3e1dce4bafec364c58ed14ff93c7e346add12f92` |
| Forge script archive | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| token printings | `4d9f4f5d6224b37941bf1ec6fffe552bc35f1a3a5862de61704ea3b74f45ffa4` |
| display metadata | `9b9f45e0465ff6b1b7b96894b2d6e781ccb1c5afed42a3925ee8229e3b642964` |
| compiled bridge admission | `3e6154baa8b83d6888d1650c545e173da8e77a01ed11da125d7cb844fcabe4c0` |
| installed adapter admission | `e55001d143954b208bcfe6341fdca78bc651a92e3392541a1f486efb30fb648a` |

The source document pins MTGJSON `5.3.0+20261001` and matching Scryfall
snapshots fetched on 2026-10-01.

## Rebuilding

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets DIS,GPT,RAV --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/dis/onboarding-format-v1.json --sources <new-source-directory> --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out <new-build-directory>
npx tsx packages/data/tools/printed-display-metadata.ts --sources <new-source-directory> --catalog packages/data/data/dis/dis-printed-catalog-v1.json --catalog packages/data/data/dis/gpt-printed-catalog-v1.json --catalog packages/data/data/dis/rav-printed-catalog-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/dis/dis-printed-catalog-v1.json --catalog packages/data/data/dis/gpt-printed-catalog-v1.json --catalog packages/data/data/dis/rav-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-token-file>
```

## Art and tokens

All cards use their Scryfall art crops. Display metadata selects the oldest
physical printing where more than one printing can represent the same object.
Sixteen of the eighteen referenced token scripts have matching oldest token
art:

| Forge name | printing |
| --- | --- |
| Saproling Token | T10E 5 |
| Snake Token | TC15 21 |
| Horror Token | TC21 8 |
| Drake Token | TCMA 18 |
| Elemental Token | TCON 2 |
| Faerie Token | TELD 5 |
| Bird Token | TGK2 1 |
| Goblin Token | TGK2 6 |
| Wurm Token | TM12 6 |
| Bat Token | TMMA 5 |
| Knight Token | TRTR 2 |
| Centaur Token | TRTR 7 |
| Voja | TRVR 19 |
| Spirit Token | TSHM 2 |
| Pegasus Token | TUGL 89 |
| Goblin Token | TUGL 92 |

Scryfall has no matching physical printing for Forge's `Sand Token` or `Weird
Token`, so those use the labeled pending frame while rules play continues to
use the real Forge token scripts.

## Closure and admission

The shared syntax review closes all 636 scripts with no unknown root syntax,
dependency syntax or generated dependency. `play-admission-v1/` qualifies all
636 scripts and admits all 653 physical printings with zero residual
obligations.

Real Forge scenario receipts witness local Mortify targeting and engine
Bloodscale Prowler combat. Four match probes separately cover engine starting
player, mulligan and priority behavior plus the combined local starting-player,
mulligan and priority path.

Hellbent, Graft and Forecast have direct real-Forge witnesses. Demon's Jester
changes power and toughness with hand state; Simic Initiate transfers its
counter to Boros Recruit and then dies as a 0/0; and Steeling Stance reveals
from hand during upkeep before its forecast effect resolves. The bridge also
has exact runtime contracts for Rakdos Augermage's mutual revealed-hand discard
and Rix Maadi's each-player discard activation.

## Catalog sweep

`catalog-coverage-sweep-v1/report.json` records a bounded 32-game sealed sweep.
All 32 games opened and finished. The directed decks placed 402 unique physical
printings in pools and decks, observed 227 card names, offered actions for 90
card names and selected actions for 84. The sweep discovered the Forecast,
Rakdos Augermage and Rix Maadi bridge gaps; the installed report is the complete
rerun after their exact contracts were added.

## Constructed pilot decks

`dis-constructed-format-v1.json` ships eight decklab-built decks from the ten
declared block archetypes. Every shipped list is exactly 60 cards, passes the
decklab power floor, contains only admitted DIS, GPT and RAV printings and
completed a serial game against the Forge bot.

| Archetype | Result | Forge proof |
| --- | --- | --- |
| Azorius Forecast | Failed | Unreviewed mandatory Shrieking Grotesque discard choice after 50 decisions |
| Orzhov Haunt | Shipped | Completed, 98 decisions |
| Boros Tempo | Shipped | Completed, 207 decisions |
| Selesnya Tokens | Shipped | Completed, 148 decisions |
| Dimir Control | Shipped | Completed, 236 decisions |
| Izzet Replicate | Shipped | Completed, 280 decisions |
| Simic Graft | Shipped | Completed, 164 decisions |
| Rakdos Hellbent | Failed | Unreviewed mandatory Rakdos Carnarium land-return choice after 164 decisions |
| Golgari Graveyard | Shipped | Completed, 195 decisions |
| Gruul Bloodthirst | Shipped | Completed, 168 decisions |

Build or rebuild one archetype with the selected account home's `.claude`
directory and an explicit model ceiling. The name, colors and prompt must match
the corresponding entry in `archetypes-v1.json` exactly:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format dis --archetype 'Simic Graft' --colors U,G --prompt 'Build creatures carrying +1/+1 counters, move those counters to the threats that need them, and exploit graft triggers as the board grows.' --lands 32 --max-usd 20 --output out/dis-constructed/simic-graft.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof and emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format dis --artifacts out/dis-constructed --candidate --out out/dis-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format dis --candidate out/dis-constructed/candidate.json --out out/dis-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format dis --artifacts out/dis-constructed --receipt out/dis-constructed/forge-receipt.json --out packages/data/data/dis/dis-constructed-format-v1.json
```
