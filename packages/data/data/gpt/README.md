# Guildpact printed Limited format

## Product and identity

This is the Guildpact release format with its original Ravnica block collation.
Eight-seat draft opens `GPT-RAV-RAV`; sealed opens two Guildpact boosters and
four Ravnica: City of Guilds boosters. Basic lands are removed from opened
packs. The existing standalone `rav` format remains separately registered and
unchanged.

The catalogs contain 167 GPT printings and 306 RAV printings, representing 456
distinct Forge scripts across 473 physical cards. The RAV catalog is a local,
provenance-bound copy so this format does not depend on the standalone RAV
directory.

| artifact                       | sha256                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| format `contentSha256`         | `dbc94b30eb979a46f3a686117918a07de3f48788a385e70ec39c28d09d25b9a3` |
| GPT catalog `contentSha256`    | `c814483c64a356b30bcf6d1d988dd0ffff2badb45033895a23dd4663484f5ac5` |
| RAV catalog `contentSha256`    | `def1de60dabbe5293fac93ebc2dd943f6f78387a37feb089e5a524fda5ce1394` |
| source pin                     | `c733061de3a3ed97d7519b619c935dca7aeb6d2bc948cb290dbb22bd0f1c0ae6` |
| Forge script archive           | `5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173` |
| token printings                | `d4d555fd20247e8346a303b50eabdcc6250cc6c7e455e8dc90d3cd95db1ce85d` |
| display metadata               | `faf3487ea24f85c995eb0e10ea4528e1014398c43cd2cb0036d3091ec587758d` |
| compiled bridge admission      | `5c78ef62a217691f6183a7354a91498a437c8aac33a5803dcb3edb2e887a3909` |
| installed adapter admission    | `e55001d143954b208bcfe6341fdca78bc651a92e3392541a1f486efb30fb648a` |

The source document pins MTGJSON `5.3.0+20260930` and matching Scryfall
snapshots fetched on 2026-10-01.

## Rebuilding

```sh
npx tsx packages/data/tools/fetch-printed-sources.ts --sets GPT,RAV --out <new-source-directory>
npx tsx packages/data/tools/build-printed-format.ts --config packages/data/data/gpt/onboarding-format-v1.json --sources <new-source-directory> --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-version 2.0.14 --out <new-build-directory>
npx tsx packages/data/tools/printed-display-metadata.ts --sources <new-source-directory> --catalog packages/data/data/gpt/gpt-printed-catalog-v1.json --catalog packages/data/data/gpt/rav-printed-catalog-v1.json
npx tsx packages/data/tools/fetch-token-printings.ts --catalog packages/data/data/gpt/gpt-printed-catalog-v1.json --catalog packages/data/data/gpt/rav-printed-catalog-v1.json --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 --out <new-token-file>
```

## Art and tokens

Every card uses its Scryfall art crop. Where several physical printings can
represent the same object, display metadata chooses the oldest printing. Eleven
of the thirteen token scripts created by the two catalogs have the oldest
matching Scryfall token art:

| Forge name      | printing |
| --------------- | -------- |
| Saproling Token | T10E 5   |
| Horror Token    | TC21 8   |
| Faerie Token    | TELD 5   |
| Wurm Token      | TM12 6   |
| Bat Token       | TMMA 5   |
| Knight Token    | TRTR 2   |
| Centaur Token   | TRTR 7   |
| Voja            | TRVR 19  |
| Spirit Token    | TSHM 2   |
| Pegasus Token   | TUGL 89  |
| Goblin Token    | TUGL 92  |

Scryfall has no matching physical printing for Forge's `Sand Token` or `Weird
Token`, so those two use the labeled pending frame. Rules play still uses the
real Forge token scripts.

## Closure and admission

The shared Forge review table closes all 456 scripts with no unknown root
syntax, dependency syntax or generated dependency. The reusable controller
contracts cover every decision family. `play-admission-v2/` qualifies all 456
scripts and admits all 473 physical printings with zero residual obligations.

Real Forge scenario receipts witness local Mortify targeting and engine
Bloodscale Prowler combat. Four match probes separately cover engine mulligan,
priority and starting-player control plus the combined local starting-player,
mulligan and priority path.

Replicate, Bloodthirst and Haunt have direct real-Forge witnesses. Targeted and
untargeted Replicate copies resolve through Gigadrowse and Train of Thought;
Bloodscale Prowler enters with its counter after damage; and Benediction of
Moons returns through Scorched Rusalka's Haunt trigger.

## Catalog sweep

`catalog-coverage-sweep-v1/report.json` records a bounded 32-game sealed sweep.
All 32 games opened, 31 finished, and 402 unique physical printings were placed
in both a pool and a deck. Seed 24 reached the external 300-second Forge timeout
while submitting its game and emitted no controller exception. The same seed
timed out when rerun alone; it remains an explicit discovery residual rather
than admission evidence. The sweep exposed four deterministic controller gaps
in other seeds, and their Leyline opening-hand action, Lore Broker discard,
bounce-land return and Three Dreams search routes all finish after the exact
bridge fixes.

## Constructed pilot decks

`gpt-constructed-format-v1.json` ships the Gruul Bloodthirst and Izzet
Replicate decks. Both lists are exactly 60 cards, pass the decklab power floor,
contain only admitted GPT and RAV printings and completed a serial game against
the Forge bot.

| Archetype | Result | Forge proof |
| --- | --- | --- |
| Gruul Bloodthirst | Shipped | Completed, 201 decisions |
| Izzet Replicate | Shipped | Completed, 557 decisions |
| Orzhov Haunt | Failed | Unreviewed mandatory Castigate hand-to-exile choice after 203 decisions |

Build or rebuild one archetype with the selected account home's `.claude`
directory and an explicit model ceiling. The name, colors and prompt must match
the corresponding entry in `archetypes-v1.json` exactly:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format gpt --archetype 'Gruul Bloodthirst' --colors R,G --prompt 'Deal combat damage early, then cast bloodthirst creatures with counters and use Gruul Guildmage to turn excess mana into pressure.' --lands 32 --max-usd 20 --output out/gpt-constructed/gruul-bloodthirst.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof and emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format gpt --artifacts out/gpt-constructed --candidate --out out/gpt-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format gpt --candidate out/gpt-constructed/candidate.json --out out/gpt-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format gpt --artifacts out/gpt-constructed --receipt out/gpt-constructed/forge-receipt.json --out packages/data/data/gpt/gpt-constructed-format-v1.json
```
