# Ravnica: City of Guilds printed format

## Product and identity

This is the standalone Ravnica: City of Guilds Limited format. Its exact catalog
contains 306 physical printings and 291 distinct Forge scripts. Draft uses three
`rav-draft` packs; sealed uses six. Basic lands are removed from opened packs.

The source pin is `data/cache/rav-20260929-source-pin/`. It pins MTGJSON
5.3.0+20260929 and the matching 306-printing Scryfall snapshot.

| artifact                    | sha256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Limited format              | `0ccf6684dd2efca7bcbfaa03a4a686b51e79ba56df82cc676f7972e0a2e79fe0` |
| RAV catalog                 | `2f32c49619ad7fab74e161ceb856dfe150e322b2339e47f0ba2f8fc5e3be3aed` |
| source pin                  | `48f53d121d4bab70c40990dcc167699299001b36b4ade12e88df461ccfc4c304` |
| Forge script archive        | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| token printings             | `71e1968f0d0d8fb5c109b146a7d0481c0458beb8432ce3bf0a922a0e6af76ecf` |
| display metadata            | `13cf8512beb00096fcab8944c9266d0f04322c2a6f8cd8ab54c8bfb3715be276` |
| compiled bridge admission   | `e2e21687f14bb9e155e65beaf002f00dd28ef0776b97ff1eb032b2aed95cce7a` |
| installed adapter admission | `e55001d143954b208bcfe6341fdca78bc651a92e3392541a1f486efb30fb648a` |

## Rebuilding

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets RAV --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/rav/onboarding-format-v1.json --sources data/cache/rav-20260929-source-pin --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out <new-build-directory>
npx tsx packages/data/tools/printed-display-metadata.ts --sources data/cache/rav-20260929-source-pin --catalog packages/data/data/rav/rav-printed-catalog-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/rav/rav-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-token-file>
```

## Art and tokens

All 306 cards carry available Scryfall art. The eight token scripts created by
the set are bound to the oldest matching printings, and every token has art.

| Forge name      | printing |
| --------------- | -------- |
| Saproling Token | T10E 5   |
| Horror Token    | TC21 8   |
| Faerie Token    | TELD 5   |
| Knight Token    | TRTR 2   |
| Centaur Token   | TRTR 7   |
| Voja            | TRVR 19  |
| Spirit Token    | TSHM 2   |
| Goblin Token    | TUGL 92  |

## Closure and admission

The shared Forge review table closes all 291 scripts with no unknown root
syntax, dependency syntax, or generated dependency. RAV added 17 reviewed
tokens, including Dredge, Transmute, Radiance, Chorus of the Conclave's
additional-cost keyword, Master Warcraft's attacker declaration control, and
Tunnel Vision's deterministic search-placement parameters.

`play-admission-v4/` qualifies all 291 scripts and admits all 306 physical
printings with zero residual. Real Forge witnessed Last Gasp on the local
controller path and Sell-Sword Brute on the engine controller path. Four match
probes separately cover engine starting-player, mulligan and priority behavior,
plus the local starting-player, mulligan and priority path. The engine-start seed
is `m15-local-pregame-v4`. The admission binds the RAV interaction bridge while
preserving the format, catalog, adapter, qualified-script count, residual and
probe payloads.

## Mechanics and catalog sweep

The standalone RAV catalog contains Convoke, Radiance, Transmute, Dredge and
hybrid mana. Each is inside the admitted script closure and has an explicit
real-Forge runtime witness in
`packages/forge-export/test/observed-rav-mechanics.integration.test.ts`:

- Convoke pays for Gather Courage by tapping Elves of Deep Shadow, then resolves
  the +2/+2 effect. The catalog sweep independently exercised two Convoke payment
  callbacks.
- Radiance resolves Cleansing Beam against one green creature, destroys the
  other green creature and preserves a non-green creature.
- Transmute pays Brainspoil's `{1}{B}{B}` activation, moves Brainspoil to the
  graveyard and finds the mana-value-five Belltower Sphinx.
- Dredge applies Stinkweed Imp's replacement during Compulsive Research, mills
  five cards and returns Stinkweed Imp from the graveyard to hand.
- Hybrid mana pays both of Boros Guildmage's `{R/W}` pips from red sources and
  resolves the permanent.

Replicate, Bloodthirst and Haunt have zero RAV cards and first appear in
Guildpact, so they are outside this single-set format and its pinned catalog.

`catalog-coverage-sweep-v1/report.json` records the bounded runtime evidence.
All 291 distinct scripts were placed in both a pool and a deck across 24 games;
24 games opened and finished, 164 card names were observed, 61 offered actions
and 54 selected actions. The sweep also discovered Torpid Moloch's three-land
sacrifice and Boros Garrison's mandatory land return; both now have exact bridge
routes and installed-Forge witnesses. The sweep is discovery evidence rather
than admission proof and did not force every card's action to be offered.

## Constructed pilot decks

`rav-constructed-format-v1.json` ships the Boros Tempo, Golgari Graveyard and
Selesnya Tokens decks. Every shipped list is exactly 60 cards, passes the
decklab power floor, contains only admitted RAV printings and completed a
serial game against the Forge bot.

| Archetype | Result | Forge proof |
| --- | --- | --- |
| Boros Tempo | Shipped | Completed, 132 decisions |
| Dimir Control | Failed | Unreviewed mandatory Dimir Aqueduct land-return choice after 39 decisions |
| Golgari Graveyard | Shipped | Completed, 212 decisions |
| Selesnya Tokens | Shipped | Completed, 215 decisions |

Build or rebuild one archetype with the selected account home's `.claude`
directory and an explicit model ceiling. The name, colors and prompt must match
the corresponding entry in `archetypes-v1.json` exactly:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format rav --archetype 'Boros Tempo' --colors W,R --prompt 'Build a disciplined creature curve, grant haste to maintain pressure, and use first strike to control combat.' --lands 32 --max-usd 20 --output out/rav-constructed/boros-tempo.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof and emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format rav --artifacts out/rav-constructed --candidate --out out/rav-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format rav --candidate out/rav-constructed/candidate.json --out out/rav-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format rav --artifacts out/rav-constructed --receipt out/rav-constructed/forge-receipt.json --out packages/data/data/rav/rav-constructed-format-v1.json
```
