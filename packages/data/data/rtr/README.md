# Return to Ravnica printed format

## Product and identity

This is a standalone Return to Ravnica format, separate from the registered
Gatecrash and Dragon's Maze formats. Its exact catalog contains 274 physical
printings and 254 distinct Forge scripts. Draft uses three `rtr-draft` packs;
sealed uses six. Basic lands are removed from opened packs.

The source pin is `data/cache/rtr-20260927-mtg-5s3inm6-source-pin/`. It pins
MTGJSON 5.3.0+20260927 and the matching 274-printing Scryfall snapshot. The
catalog hash is `c1647345...`, the Limited format hash is `3cbb5eed...`, and
`build-evidence.json` binds the complete hashes to the source manifest and
Forge 2.0.14 archive.

## Limited archetypes

The five guild pairs are White-Blue Detain, Blue-Red Overload, Black-Red
Unleash, Black-Green Scavenge, and Green-White Populate. Their mechanics and
game plans follow Wizards' [Return to Ravnica mechanics overview](https://magic.wizards.com/en/news/feature/return-to-ravnica-mechanics)
and Mark Rosewater's [mechanics retrospective](https://magic.wizards.com/en/news/making-magic/price-progress-looking-mechanics-2012-11-26).
`archetypes-v1.json` names an exact catalog signpost for every pair.

## Play admission and constructed decks

`play-admission-v2/` admits all 274 physical printings and all 254 scripts with
no residual. The reusable scenario contracts and all four match probes passed
against real Forge. Twelve token printings are bound and have art.

`rtr-constructed-format-v1.json` ships one legal 60-card deck for each of the
five archetypes. Every card is in the catalog and the installed admission. The
final full-game Forge sweep completed all five decks with zero failures. The
first Black-Red list reached an unsupported confirm-action role; replacing its
unsafe card mix and rerunning the complete five-deck sweep produced the shipped
five-of-five receipt.
