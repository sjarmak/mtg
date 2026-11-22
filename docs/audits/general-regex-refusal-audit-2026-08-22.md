# General semantic regex-refusal audit — 2026-08-22

## Scope and method

This is the one-time re-audit required by `mtg-rdgx`. The input was every M11/M13
identity that the pre-audit general semantic artifact refused with at least one
label assigned by `BUCKET_RULES` in `@mtg/dsl-coverage`'s `general-semantics.ts`:
101 identities and 106 collector positions. Each identity was reconsidered
against the current DSL, validator, target enumerator, reducer, and continuous
rules rather than accepted or rejected from its regex label.

A card was promoted only when `parseCard` accepted an exact translation and a
card-specific kernel probe demonstrated both the printed outcome and a hostile
outcome the card must not affect. `REGEX_BUCKET_PROMOTIONS` in
`reference-general-semantics.test.ts` pins the complete
promotion set. The refreshed artifact is the durable source of the resulting
disposition, translation, assertions, and checksums; this report records why each
original candidate moved or stayed.

The audit promoted 16 identities and 18 collector positions. The general ledger
moved from 193 exact identities / 247 exact positions to 209 / 265. Eighty-five
identities remain refused for a concrete current capability gap.

## Promoted identities

| Identity           | Positions | Exact capability exercised                                        |
| ------------------ | --------: | ----------------------------------------------------------------- |
| Arbor Elf          |         1 | Tapped source, Forest-filtered permanent target, and untap        |
| Arctic Aven        |         1 | Controlled-subtype condition and temporary self lifelink          |
| Battleflight Eagle |         1 | Entry target, stat bonus, and temporary flying rider              |
| Bloodhunter Bat    |         1 | Entry target-player life loss plus controller life gain           |
| Chandra's Outrage  |         1 | Creature target followed by that creature's controller            |
| Chronomaton        |         1 | Mana-and-tap activation putting a counter on its source permanent |
| Elvish Archdruid   |         2 | Other-Elf lord plus mana counted from controlled Elves            |
| Flinthoof Boar     |         1 | Controlled-subtype condition and temporary self haste             |
| Kindled Fury       |         1 | Targeted stat bonus with a temporary first-strike rider           |
| Krenko, Mob Boss   |         1 | Token count computed from controlled Goblins                      |
| Merfolk Sovereign  |         1 | Other-Merfolk lord plus subtype-filtered unblockable target       |
| Prized Elephant    |         1 | Controlled-subtype condition and temporary self trample           |
| Serpent's Gift     |         1 | Temporary targeted deathtouch                                     |
| Sign in Blood      |         2 | Player target reused by draw and life-loss effects                |
| Silklash Spider    |         1 | Announced X damage over all flying creatures                      |
| Stabbing Pain      |         1 | Creature target reused by stat reduction and tap effects          |

## Refused identities after re-audit

| Identity                    | Positions | Concrete current blocker                                                                                                       |
| --------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Act of Treason              |         1 | Temporary control change and its linked untap/haste referent are not modeled.                                                  |
| Akroma's Memorial           |         1 | A static modification grants one keyword; this needs several keywords plus two protection abilities.                           |
| Ancient Hellkite            |         1 | Activated abilities cannot be restricted to “only while this source is attacking.”                                             |
| Angelic Arbiter             |         1 | Per-opponent attack/casting locks conditioned on prior turn actions are not modeled.                                           |
| Augur of Bolas              |         1 | Hidden-library look, typed selection, reveal, and ordered bottom placement are not modeled.                                    |
| Autumn's Veil               |         1 | Spell uncounterability and color/source-qualified target protection are not modeled.                                           |
| Awakener Druid              |         1 | A linked duration, land-to-creature type change, color change, and base stats are not modeled.                                 |
| Bloodcrazed Goblin          |         1 | Attack legality cannot depend on whether an opponent was dealt damage this turn.                                               |
| Bloodthrone Vampire         |         2 | An activated cost cannot sacrifice an arbitrary creature and bind the effect to the source.                                    |
| Captain of the Watch        |         1 | The exact card needs two distinct static modifications plus an entry trigger; creatures currently allow at most two abilities. |
| Captivating Vampire         |         1 | “Tap five Vampires” costs, control change, and additive subtype changes are not modeled.                                       |
| Chandra's Fury              |         1 | The controller referent must work for either a player or planeswalker target and scope a creature sweep.                       |
| Cleaver Riot                |         1 | Temporary keyword grants cannot sweep creatures you control, and double strike is not a keyword.                               |
| Clock of Omens              |         1 | Costs cannot select and tap two other artifacts.                                                                               |
| Clone                       |         2 | Copy-as-entry behavior and copied characteristics are not modeled.                                                             |
| Combust                     |         1 | Spell uncounterability, color-filtered creatures, and unpreventable damage are not modeled.                                    |
| Condemn                     |         1 | Attacking-creature targeting, library-bottom movement, and toughness-linked life gain are not modeled together.                |
| Conundrum Sphinx            |         1 | Simultaneous card-name choices and conditional top-library reveal/movement are not modeled.                                    |
| Courtly Provocateur         |         1 | Arbitrary-creature attack/block requirements and the block requirement effect are not modeled.                                 |
| Cultivate                   |         1 | Multi-card library search with different destination zones and shuffle is not modeled.                                         |
| Cyclops Gladiator           |         1 | Optional reciprocal damage linked to both creatures' live power is not modeled.                                                |
| Destructive Force           |         1 | Each player choosing five lands to sacrifice is not an available mass-choice effect.                                           |
| Disciple of Bolas           |         1 | A forced sacrifice of another creature and two effects linked to its power are not modeled.                                    |
| Door to Nothingness         |         1 | “Target player loses the game” is not an effect.                                                                               |
| Elderscale Wurm             |         1 | Life-total setting and the damage replacement floor at seven are not modeled.                                                  |
| Faith's Reward              |         1 | Graveyard selection by this-turn zone history and mass return are not modeled.                                                 |
| Fauna Shaman                |         1 | Typed discard cost and typed library search/reveal/shuffle are not modeled.                                                    |
| Firewing Phoenix            |         1 | An ability whose source is a card in the graveyard is not modeled.                                                             |
| Fling                       |         1 | Additional creature-sacrifice costs and damage linked to the sacrificed creature's power are not modeled.                      |
| Frost Titan                 |         1 | Opponent-targeted spell taxes and a delayed “doesn't untap next step” effect are not modeled.                                  |
| Gaea's Revenge              |         1 | Spell uncounterability and color-qualified target protection are not modeled.                                                  |
| Gem of Becoming             |         1 | Multi-subtype library search, reveal, hand movement, and shuffle are not modeled.                                              |
| Goblin Battle Jester        |         1 | Triggering on a spell's color is not a trigger condition.                                                                      |
| Hamletback Goliath          |         1 | Another-creature-entry triggers and counters linked to that entrant's power are not modeled.                                   |
| Harbor Bandit               |         1 | `cantBeBlockedThisTurn` can target a creature but cannot bind exactly to the source creature.                                  |
| Haunting Echoes             |         1 | Graveyard filtering followed by repeated name-linked library searches is not modeled.                                          |
| Hoarding Dragon             |         1 | Library search plus a card linked across exile and a later death trigger is not modeled.                                       |
| Hunters' Feast              |         1 | “Any number of target players” is not a target cardinality.                                                                    |
| Incite                      |         1 | Temporary color change is not modeled.                                                                                         |
| Index                       |         1 | Hidden-library look and arbitrary reordering are not modeled.                                                                  |
| Inferno Titan               |         1 | Damage division across one to three targets is not modeled.                                                                    |
| Jinxed Idol                 |         1 | Arbitrary-creature sacrifice costs and control transfer are not modeled.                                                       |
| Magma Phoenix               |         1 | A source-card graveyard activation is not modeled; its death sweep also spans creatures and players.                           |
| Mana Leak                   |         1 | Spell targets and resolution-time “unless its controller pays” choices are not modeled.                                        |
| Mark of Mutiny              |         1 | Temporary control change and linked untap/haste behavior are not modeled.                                                      |
| Mass Polymorph              |         1 | Mass exile followed by count-linked library revealing, battlefield entry, and shuffle is not modeled.                          |
| Master of the Pearl Trident |         1 | Islandwalk is not a keyword and one static modification cannot grant both stats and a keyword.                                 |
| Mindclaw Shaman             |         1 | Opponent-hand reveal/choice and casting that chosen card without paying are not modeled.                                       |
| Mogg Flunkies               |         1 | Attack and block legality cannot depend on whether another creature participates.                                              |
| Obstinate Baloth            |         1 | An opponent-caused discard replacement that changes the destination zone is not modeled.                                       |
| Odric, Master Tactician     |         1 | Group attack thresholds and controller-selected blocker assignment are not modeled.                                            |
| Palace Guard                |         1 | Blocking an arbitrary number of attackers is not a combat rule capability.                                                     |
| Phantom Beast               |         1 | “Becomes the target” is not a trigger condition.                                                                               |
| Predatory Rampage           |         1 | The spell needs both a friendly creature sweep and a forced-block sweep over opposing creatures.                               |
| Public Execution            |         1 | Destroy does not accept the restricted target kind, and a prior creature's controller cannot drive the scoped shrink effect.   |
| Quirion Dryad               |         1 | A multicolor-set spell-cast trigger condition is not modeled.                                                                  |
| Reassembling Skeleton       |         1 | An ability whose source is in a graveyard cannot return that source tapped.                                                    |
| Redirect                    |         2 | Spell targeting and choosing replacement targets for a stack object are not modeled.                                           |
| Relentless Rats             |         1 | Counts by a specific card name and deck-construction exceptions are not modeled.                                               |
| Reverberate                 |         2 | Copying a targeted stack object and optionally retargeting the copy are not modeled.                                           |
| Rewind                      |         1 | Spell targets/countering and choosing up to four land targets are not modeled.                                                 |
| Roaring Primadox            |         1 | Upkeep-time controller choice of a creature to return to hand is not modeled.                                                  |
| Serra Ascendant             |         1 | A life-total conditional cannot apply both a stat bonus and a keyword grant.                                                   |
| Serra Avenger               |         1 | Casting legality cannot depend on the controller's turn number.                                                                |
| Shimian Specter             |         1 | Hand reveal/choice followed by name-linked graveyard, hand, and library exile is not modeled.                                  |
| Silence                     |         1 | A turn-wide opponent casting prohibition is not modeled.                                                                       |
| Slumbering Dragon           |         1 | Counter-threshold combat legality and “a creature attacks you or your planeswalker” triggers are not modeled.                  |
| Spelltwine                  |         1 | Graveyard card targets, spell copies, free casting, and linked exile are not modeled.                                          |
| Sphinx of Uthuun            |         1 | Opponent-created piles and controller pile choice across hidden-library cards are not modeled.                                 |
| Switcheroo                  |         1 | Exchanging control of two distinct targeted creatures is not modeled.                                                          |
| Thragtusk                   |         1 | “Leaves the battlefield” is not a trigger condition.                                                                           |
| Thundermaw Hellkite         |         1 | Opponents' flying creatures are not a legal damage/tap scope, and scoped tap requires a target slot the card does not have.    |
| Timberpack Wolf             |         1 | Continuous counts by another object's exact card name are not modeled.                                                         |
| Time Reversal               |         1 | Mass hand/graveyard-to-library movement, shuffle, redraw, and self-exile are not modeled.                                      |
| Tormod's Crypt              |         1 | A player's graveyard is not a targetable zone object for mass exile.                                                           |
| Trading Post                |         1 | Typed discard, pay-life, arbitrary sacrifice, and graveyard-card targeting costs/effects are not modeled.                      |
| Triskelion                  |         1 | Removing a counter from the source is not an activated cost.                                                                   |
| Turn to Slag                |         1 | Attached Equipment traversal and destruction are not modeled.                                                                  |
| Vampire Nocturnus           |         1 | Revealed-top-library state, color condition, and combined self/other stat-plus-keyword grants are not modeled.                 |
| Veilborn Ghoul              |         1 | A land-subtype entry trigger cannot activate an ability of a source card in the graveyard.                                     |
| Void Stalker                |         1 | Moving two creatures to their owners' libraries and shuffling each affected library are not modeled.                           |
| War Falcon                  |         1 | Attack legality cannot depend on controlling either of two creature subtypes.                                                  |
| Wild Guess                  |         1 | Discarding a card as an additional spell cost is not modeled.                                                                  |
| Wit's End                   |         1 | “Discard the whole hand” is not an available computed discard count.                                                           |
| Worldfire                   |         1 | Cross-zone mass exile and setting every player's life total are not modeled.                                                   |
| Xathrid Gorgon              |         1 | Persistent counter-linked keyword/type/color changes and disabling activated abilities are not modeled.                        |

## Guard against recurrence

The regex rung remains a useful first-pass classifier for never-audited text. It
is not treated as proof of a live blocker. The promoted-name assertion now fails
if any of these 16 identities falls back to refused, while the normal exact-card
checks require exact translation, assertion binding for every source clause,
hostile negative evidence, artifact freshness, and census agreement.
