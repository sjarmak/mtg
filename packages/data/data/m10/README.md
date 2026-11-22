# Magic 2010 printed format

## Product and identity

This standalone Magic 2010 format is built from the complete pinned MTGJSON
and Scryfall sources. The catalog contains all 249 official positions and
resolves to 234 distinct Forge scripts. Draft uses three `m10-draft` packs;
sealed uses six. Basic lands are removed from opened packs.

The source manifest hash is
`f351cd3f71f2560792922614d2002b69e92295a997c042d274a20f95c3d95cb9`.
It pins MTGJSON 5.3.0+20260929 and the matching 249-printing Scryfall snapshot.
The catalog content hash is
`2b44eeabb387d8671c5f9400ae677b7c2ac46414ad6329cdb840332dd704212f`,
the Limited format hash is
`93ffd91aa8f11b8191fc92575db926c67df3b8b1fc16dc06ca3be2d7cc0c48c5`,
and `build-evidence.json` binds both to the Forge 2.0.14 script archive hash
`5264d718bb87c209cb6367c492378fde070e499824bad009251c0a2d783e0173`.

## Mechanics bridge check

The set uses the existing core bridge surface: ordinary activated, triggered
and static abilities; Auras and Equipment; planeswalkers; regeneration;
protection; landwalk; and evergreen combat keywords. The inventory introduced
no new controller decision family. Three syntax tokens were classified against
existing contracts: `RevealTitle` and `ConditionActivationLimit` are
non-choice metadata, while `ReplaceSplitDamage` is deterministic after the
source and target choices already exposed by the bridge.

## Qualification and play admission

`play-admission-v2/` admits all 249 physical printings and all 234 scripts with
no residual. Two reusable scenario-contract witnesses and all four match probes
passed against real Forge. The catalog-coverage sweep opened and finished all
22 directed sealed games, placing all 234 distinct catalog scripts into decks;
it observed 136 card names, offered actions from 62, and selected actions from
60 under the ten-turn and 600-decision bounds.

Eight generated token scripts are bound to the oldest matching official
printing with available art: Avatar, Beast, Wolf, Insect, Gargoyle, Soldier,
Zombie and Goblin. `m10-token-printings-v1.json` records the exact physical
printing selected for each surface.

## Constructed pilot decks

`m10-constructed-format-v1.json` ships the Blue-Black Control, Black-Red
Sacrifice, Red-Green Ramp and Green-White Creatures decks. Each passed
structural validation and completed a full game against the Forge bot.
White-Blue Flyers passed structural validation but remains unshipped because
its Forge game failed after 170 decisions with an offered-move mismatch.

Build or rebuild one archetype with the selected account home's `.claude`
directory and an explicit model ceiling:

```sh
CLAUDE_CONFIG_DIR=<claude-config> npx tsx packages/decklab/src/cli.ts --printed-format m10 --archetype 'Blue-Black Control' --colors U,B --prompt 'Trade removal and counterspells for opposing threats, then pull ahead with card draw and evasive finishers.' --lands 37 --max-usd 20 --output out/m10-constructed/blue-black-control.json
```

After every archetype artifact exists, assemble the candidate, run the serial
Forge proof, and emit only completed decks:

```sh
npx tsx packages/data/tools/build-printed-constructed.ts --format m10 --artifacts out/m10-constructed --candidate --out out/m10-constructed/candidate.json
MTG_TEST_WORKERS=1 npx tsx packages/ui/tools/verify-printed-constructed.ts --format m10 --candidate out/m10-constructed/candidate.json --out out/m10-constructed/forge-receipt.json
npx tsx packages/data/tools/build-printed-constructed.ts --format m10 --artifacts out/m10-constructed --receipt out/m10-constructed/forge-receipt.json --out packages/data/data/m10/m10-constructed-format-v1.json
```
