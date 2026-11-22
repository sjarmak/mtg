# Magic 2011 printed format

## Product and identity

This standalone Magic 2011 format was built from the complete pinned MTGJSON
and Scryfall sources. The exact catalog contains all 249 official positions and
resolves to 234 distinct Forge scripts. Draft uses three `m11-draft` packs;
sealed uses six. Basic lands are removed from opened packs.

The source pin is `data/cache/m11-20260927-mtg-5s3inm6-source-pin/`. It pins
MTGJSON 5.3.0+20260927 and the matching 249-printing Scryfall snapshot. The
catalog hash is `ea0c6153...`, the Limited format hash is `81a3157c...`, and
`build-evidence.json` binds the complete hashes to the source manifest and
Forge 2.0.14 archive.

## Limited archetypes

The recorded lanes are White-Blue Flyers, Blue-Black Control, Black-Red
Sacrifice, Red-Green Ramp, and Green-White Creatures. The plans are grounded in
Craig Wescoe's contemporary two-part M11 analysis: [part one](https://articles.starcitygames.com/articles/the-wescoe-connection-comprehensive-m11-limited-archetype-analysis-part-1-of-2/)
and [part two](https://articles.starcitygames.com/articles/the-wescoe-connection-comprehensive-m11-limited-archetype-analysis-part-2-of-2/).
`archetypes-v1.json` names an exact catalog signpost for every lane.

## Play admission and constructed decks

`play-admission-v2/` admits all 249 physical printings and all 234 scripts with
no residual. The reusable scenario contracts and all four match probes passed
against real Forge. Six token printings are bound and have art.

`m11-constructed-format-v1.json` ships the legal 60-card Red-Green Ramp deck
rebuilt with the constructed power floor. Every card is in the catalog and the
installed admission, and its full-game Forge pilot completed. White-Blue
Flyers, Blue-Black Control, Black-Red Sacrifice and Green-White Creatures remain
unshipped because exact-plan rebuilds failed structural deck or mana checks
before the Forge sweep.
