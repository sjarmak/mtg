# Magic 2013 printed format

## Product and identity

This standalone Magic 2013 format was built from the complete pinned MTGJSON
and Scryfall sources. The exact catalog contains all 249 official positions and
resolves to 234 distinct Forge scripts. Draft uses three `m13-draft` packs;
sealed uses six. Basic lands are removed from opened packs.

The source pin is `data/cache/m13-20260927-mtg-5s3inm6-source-pin/`. It pins
MTGJSON 5.3.0+20260927 and the matching 249-printing Scryfall snapshot. The
catalog hash is `8c1e9e7c...`, the Limited format hash is `ebf34c05...`, and
`build-evidence.json` binds the complete hashes to the source manifest and
Forge 2.0.14 archive.

## Limited archetypes

The recorded lanes are White-Blue Flyers, White-Black Exalted, Blue-Black
Control, Red-Green Aggro, and Red-White Tokens. Their plans follow the
contemporary [Face to Face Games M13 Limited overview](https://magic.facetofacegames.com/limited-experience-m13/)
and the [MTG Salvation sealed discussion](https://www.mtgsalvation.com/forums/the-game/limited-sealed-draft/limited-archives/131423-m13-sealed-tips).
`archetypes-v1.json` names an exact catalog signpost for every lane.

## Play admission and constructed decks

`play-admission-v2/` admits all 249 physical printings and all 234 scripts with
no residual. The reusable scenario contracts and all four match probes passed
against real Forge. Ten token printings are bound and have art. Liliana of the
Dark Realms' emblem is not a token creature and is intentionally absent from
the token-printing document.

`m13-constructed-format-v1.json` contains the White-Blue Flyers, White-Black
Exalted, Blue-Black Control, Red-Green Aggro and Red-White Tokens decks that
passed structural validation and a complete game against the Forge bot.
