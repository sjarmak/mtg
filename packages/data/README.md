# @mtg/data

Local card-data store for the lab: streaming ingest of Scryfall bulk data and
MTGJSON vocabulary into better-sqlite3.

## Usage

```bash
# Download + ingest oracle cards and rulings (default kinds)
npx tsx packages/data/src/cli.ts ingest

# MTGJSON CardTypes/Keywords/EnumValues
npx tsx packages/data/src/cli.ts vocab

npx tsx packages/data/src/cli.ts stats
npx tsx packages/data/src/cli.ts find "Lightning Bolt" --exact
npx tsx packages/data/src/cli.ts colors UR --mode subset --limit 20

# `card` and `rulings` take an oracle id or a name; a name that matches several
# cards lists their oracle ids and exits non-zero instead of guessing.
npx tsx packages/data/src/cli.ts card "Lightning Bolt"
npx tsx packages/data/src/cli.ts rulings 4457ed35-7c10-48c8-9776-456485fdf070
npx tsx packages/data/src/cli.ts check-vocab flying firstStrike
```

## Reference-set corpus

The committed `data/reference-sets-v1.json` is a normalized printing-level
snapshot of M11, M13, M15, M20, ORI, ISD, RTR, RAV, ROE, SOM, KTK, and MH2.
It preserves every card-face record, collector number and rarity, identifies
tokens/promos/alternate treatments/ancillary cards separately from the base
set, and carries MTGJSON's weighted Draft Booster sheets. It deliberately omits
images, prices, purchase links, flavor text, and translations.

Regenerate it in one operation:

```bash
npm run reference:import
```

The command downloads one complete MTGJSON set document per code into the
gitignored `data/cache/` directory, verifies the pinned SHA-256 and MTGJSON
build/date before parsing, then atomically writes the normalized artifact. A
corrupt cached source is rejected instead of silently replaced. Updating the
snapshot requires changing the source manifest and its expected populations in
the same revision; ordinary runs never follow a moving upstream document.

Library consumers use `loadReferenceCorpus()`. The checked schema exposes base
set size as collector positions and card count as printing-face records, since
a double-faced card occupies one collector position but has two MTGJSON records.

## Official 2021 MTGO Legacy Cube

`data/legacy-cube-2021-v1.json` freezes the 600 ordered rows in Wizards'
Full Cardlist as retrieved on 2026-09-03. The page exposes 2021-08-19 only as
its "Last Updated" date and no separate publication date; the artifact records
that limitation rather than silently strengthening the claim. The source
spelling remains in `sourceRows`; the reviewed `Sulfuric Vortext` to `Sulfuric
Vortex` correction is recorded separately and is applied only when resolving
identities.

The normalized checksum is over the pre-implementation contract of one
`name<TAB>color<LF>` row per card, in source order. Its format label is
`name-tab-color-lf-v1`; positions and corrections are deliberately outside
those bytes.

The Full Cardlist is membership authority. It disagrees with both the Changes
table and Forge's bundled August 2021 cube on Oko/Lonis and Sublime
Archangel/Palace Jailer. The Full Cardlist and Changes table agree on Prismatic
Vista replacing Prismatic Lens, while Forge retains the Lens. All three pairs
are structured records in the artifact rather than undocumented choices.

The flagless verifier reads only tracked state:

```bash
npx tsx packages/data/tools/verify-legacy-cube.ts
```

Every mutable or machine-local input is explicit. A full local audit is:

```bash
npx tsx packages/data/tools/verify-legacy-cube.ts \
  --snapshot /path/to/legacy-cube-cardlist.html \
  --store data/store/mtg.sqlite \
  --store-bulk data/cache/oracle_cards-20260809090238.jsonl.gz \
  --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip \
  --forge-cube 'tools/forge/dist/res/cube/MTGO Legacy Cube 2021-08.dck'
```

Use `--fetch` instead of `--snapshot` only for an intentional live comparison.
The verifier never contacts the network without that flag.

`data/legacy-cube-2021-card-catalog-v1.json` is the portable presentation
artifact built from that authority. It holds exactly one physical id per source
position, the pinned Oracle and representative Scryfall ids, complete multiface
facts, explicit art availability, and each Forge script path and byte hash.
Its schema lives in browser-safe `@mtg/printed-card`; neither that package nor a
browser reader imports this package or `better-sqlite3`.

Emission has no default output and no network path:

```bash
npx tsx packages/data/tools/build-legacy-cube-catalog.ts \
  --store data/store/mtg.sqlite \
  --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip \
  --out /path/to/legacy-cube-2021-card-catalog-v1.json
```

The emitter verifies the pinned store and Forge archive before writing. The
committed artifact is separately pinned by its raw and content checksums.

`data/legacy-cube-2021-forge-decisions-v1.json` is the separate execution
attestation. It carries all 600 positions in official order, each exact Forge
script path and SHA-256, a closed inventory of every line kind, ability API,
parameter key, keyword, and contextual semantic marker in those scripts, and
the pinned 109-method public abstract `PlayerController` surface from Forge
2.0.14. The separately hashed
`data/legacy-cube-forge-syntax-review-v1.json` gives every current token an
affirmative disposition and evidence. Card families are the union of those
review rows; absence is unknown, never implicitly non-choice. Every controller
callback is likewise mapped or marked non-decision/out-of-format.

`data/forge-syntax-review-v1.json` is the shared table every printed set reads,
and its 164 `ability-api` entries are audited against the reviewed jar's
bytecode (`mtg-b02zw`). `data/forge-effect-controller-calls-v1.json` lists the
`PlayerController` callbacks each effect class calls, with its nested classes and
effect-package superclasses; the 63 tokens that name no `ApiType` (trigger,
replacement and static-ability modes) are read from the class of the same name
where Forge has one. `data/forge-controller-method-families-v1.json` translates
each callback to its decision families, taking the Legacy Cube ledger's reviewed
rows by method name and reviewing the four concrete methods the ledger does not
list. `forge-effect-families.test.ts` fails when an entry's families miss one its
callbacks raise. The calls are direct only: a callback reached through a helper
in `GameAction`, `Player` or `CostPayment` is not listed, so an entry's families
are a floor the calls must fit inside and never an equality. Regenerate with
`npx tsx packages/data/tools/forge-effect-controller-calls.ts --jar <jar> --write`
and prove the committed file matches the jar with `--check`.

The artifact distinguishes card families from universal match families.
`mulligan` and `starting-player` are supported universal match families after
`mtg-bc2.151.11`: the local seat submits backend-issued choices for play/draw,
keep/take, and each exact London-mulligan bottom-card subset. The card family
`pregame-actions` is supported after `mtg-n76vw`: the local seat is offered
Forge's opening-hand abilities (New Phyrexia's Chancellors) as a subset with a
floor of zero, and `chooseSaToActivateFromOpeningHand` is owned by the wire
rather than inherited from the AI. Companion stays refused except the exact
reviewed Yorion and Obosh scripts. A contextual
`zone-card-choice` marker also distinguishes an exact `ChangeZone` ability that
must form a card product from automatic movement of already-defined or targeted
cards. That parameter-sensitive rule found 36 previously hidden choice
surfaces, including Entomb, Show and Tell, and Dermotaxi; no individual global
token was widened.

Fifty-eight official positions use the `priority-only-v1` capability profile.
Another 34 use `mandatory-singleton-nonstack-target-v1`: direct spells and
activated abilities whose target cardinality is exactly one. That profile owns
target choice and pre-cost cancellation through backend-issued move IDs, keeps
same-name objects distinct by Forge identity, and applies Forge's must-target
restriction before offering a candidate. Trigger, aura, equip, stack, optional,
multi, divided, retarget, delegated-targeting, and nested zone-choice paths stay
outside it. In particular, equal coarse family tuples do not promote Relic of
Progenitus or Karn Liberated, whose scripts target first and then ask a hidden
zone-card question.

Three more positions use `singleton-library-zone-card-v1`: Entomb, Farseek,
and Rampant Growth. The bridge offers Forge's exact filtered `CardCollection`
as stable object-identified moves. Entomb's mandatory search has no decline;
the two restricted land searches retain Forge's legal fail-to-find move. Forge
also supplies an automatic delayed-reveal descriptor for the searched library;
the profile accepts only that exact one-zone descriptor, not delayed-reveal or
multi-card decisions in general.

Four counterspells use `singleton-stack-target-v1`: Negate, Remand, Remove
Soul, and Counterspell. The bridge offers only one exact Card from exactly the
Stack, keeps duplicate-name spells distinct by Forge identity, and preserves
pre-cost cancellation. Remand's Draw subability is accepted only because it
does not add another target; non-card, multi-zone, nested-target, triggered,
delegated, multi, divided, and retarget shapes remain outside the profile.

Eighty-seven positions use `ordinary-combat-v1`. It owns complete attacker and
blocker declarations, combatant ordering, and ordinary damage assignment while
refusing attack or block costs, exert, enlist, and alternative assignment.
`ordinary-mana-payment-v1` is composed into every safe profile: the local seat
chooses exact source identity and produced color one activation at a time.
Payment involving X, Phyrexian or snow symbols, alternative/additional costs,
special payment keywords, restricted mana, or unfamiliar mana-source costs
remains outside the profile.

Eight positions use the composite
`ordinary-combat-and-mandatory-singleton-nonstack-target-v1` profile. A closed
complement review covers all 38 cards with the same coarse
priority-plus-targets-plus-combat signature: trigger, optional, multi, divided,
attachment, retarget, delegated, nested, stack, multizone, and choice-cost
shapes stay refused, while a real Arbor Elf session proves exact target and
combat decisions coexist. Fourteen more positions use
`ordinary-combat-and-mandatory-singleton-trigger-target-v1`. Their mandatory
triggered abilities are ordered and put on the stack through the bridge before
the existing singleton target MoveIds select an exact battlefield, graveyard,
or player target. Optional triggers, trigger costs, modes, multi-target shapes,
and replacement choices remain outside the profile. Real Forge probes cover
duplicate trigger-source ordering, duplicate-name target identity, stale and
invented move rejection, and subsequent combat. Three enchantments use the
same controller seam through the separate
`mandatory-singleton-trigger-target-v1` profile: Journey to Nowhere, Banishing
Light, and Oblivion Ring. The complete remaining priority-plus-targets cohort
keeps other Auras, other Equipment, optional or multiple targets, hidden-zone
follow-up, and restart-game effects outside. A real Journey session selects one
exact creature among duplicate-name candidates and proves the chosen object
leaves the battlefield. Paladin Class has a separate
`paladin-class-installed-trigger-target-v1` profile: its exact level costs and
three effects are closed as one position-pinned script shape. A real session
pays both level abilities at sorcery speed, selects one exact attacker, observes
the counted +1/+1 bonus, and proves double strike through combat damage. No
other Class or installed ability is admitted by that profile.

The ten shocklands use the position-pinned
`shockland-pay-two-life-entry-replacement-v1` profile. Their installed scripts
must contain the exact self-entry replacement, `PayLife<2>` cost, local payer,
and self-tap fallback. The bridge exposes only the pay-two-life and decline
MoveIds for this callback; a real Forge session proves the paid land enters
untapped, the declined land enters tapped, life changes only for the paid
choice, and invented or stale moves are refused. Sweltering Suns, Everflowing
Chalice, and every other optional-cost callback remain outside this profile.

Grafted Wargear and Lightning Greaves use the position-pinned
`mandatory-singleton-equip-target-v1` profile. Both installed scripts must be
zero-cost Equipment with no explicit target block beyond Forge's Equip keyword;
their exact static and triggered surfaces are closed independently. The shared
target callback admits only legal local battlefield creatures for those two
source names. A real session proves duplicate-name identity, shroud exclusion,
zero-cost reattachment, the Wargear stat bonus, and its mandatory unattached
sacrifice. Sword of Fire and Ice, auto-attach Equipment, Auras, and every other
attachment shape remain outside this profile.

Control Magic uses the separate position-pinned
`mandatory-singleton-aura-target-v1` profile. Its installed script must remain
an exact `Enchant:Creature` Aura with one implicit cast-time battlefield target
and only its continuous control effect. The bridge exposes backend-issued
candidate identities and cancellation through the existing singleton target
seam. A real Forge session cancels and recasts it among duplicate-name
creatures, proves exact control transfer, and destroys the Aura to prove control
returns. Other Auras, triggered attachment, optional or multiple attachment
targets, and ordering-sensitive destinations remain outside this profile.

Faith's Fetters uses the separate position-pinned
`mandatory-singleton-fetters-aura-target-v1` profile. Its installed script is
closed over the permanent Aura target, four-life entry trigger, attack and
block prohibitions, non-mana activation prohibition, and mana-ability
exception. Two focused real Forge sessions prove exact duplicate-name target
identity, cancellation and stale-move refusal, both creature combat
prohibitions, the activation boundary, life gain, and restoration after the
Aura leaves. The bridge's priority enumerator applies Forge's explicit
activated-ability restriction check, so prohibited actions never reach the UI.
No other permanent-target Aura is admitted by this profile.

Fall from Favor is separately position-pinned under
`mandatory-singleton-fall-aura-target-v1`. Its exact installed script is the
only admitted creature Aura with the tap-then-become-monarch entry chain and
the enchanted-controller monarch condition on its untap prevention. The real
Forge probe proves the monarch draw, a missed untap without the crown, combat
damage transferring the crown, and the next untap succeeding. Forge 2.0.14's
full-simulation copier cannot map the command-zone monarch rule card, so only
a session containing this exact card uses Forge's hybrid AI; other sessions
retain full simulation. No other Aura or monarch card inherits that fallback.

Baneslayer Angel is position-pinned under
`ordinary-combat-baneslayer-protection-v1`. The profile closes over its exact
five keywords, including protection from Demons and from Dragons rather than a
general protection or named-type facility. Real Forge sessions prove flying,
first-strike damage, lifelink, that ready Demon and Dragon creatures cannot
block it, and that Massacre Wurm's nonprotected effect still changes its power
and toughness. Brightling, Serra's Emissary, Iona, Shield of Emeria, and
Phyrexian Revoker remain explicitly excluded from the profile.

Chart a Course is position-pinned under
`draw-two-conditional-singleton-discard-v1`. Its exact installed script draws
two before conditionally reaching the one wire-owned local-hand discard
callback, and its attacked-this-turn condition remains Forge-owned. Real Forge
sessions prove exact same-name object selection when no attack occurred and no
discard decision after an attack. Every other target-chosen Discard script,
opponent hand, other count, payment, trigger, activation, and zone route remains
explicitly excluded.

The complete three-card Legacy Cube Level up cohort is position-pinned under
`ordinary-combat-reviewed-level-up-v2`. A closed whole-script predicate admits
only Student of Warfare, Joraga Treespeaker, and Hexdrinker at their reviewed
bytes. Installed Forge sessions prove Student's exact counter and combat bands,
Joraga's level-one 1/2 and granted two-green mana ability, and Hexdrinker's 4/4
and 6/6 tiers. New Level up scripts, Class levels, other costs or bands, counter
choices, added mechanics, and global optional-cost shapes remain unsupported.

Fiend Artisan is position-pinned with the earlier discard and fixed-source
sacrifice cards under `discard-or-reviewed-sacrifice-cost-v2`. Its complete
official script is the boundary: exactly one other creature is chosen through
Forge's own sacrifice legality filters, the source is excluded, cancellation
uses Forge's rollback, and the selected object's legality is checked again before payment.
An installed Forge session cancels once, then sacrifices one exact creature
while retaining another and fetches a creature within the announced mana-value
bound; the graveyard and battlefield prove the result. Different identities,
counts, types, descriptions, timing, search shapes, and additional mechanics
remain refused.

The four remaining positions whose sole refusal was a triggered target are
position-pinned under `stated-ordering-and-reviewed-trigger-target-v1`:
Outpost Siege, Klothys, God of Destiny, Tidehollow Sculler, and Showdown of the
Skalds. Installed Forge proves each selected object or player by board state:
Outpost damages the chosen opponent after an exact controlled creature leaves;
Klothys exiles the selected nonland graveyard card and reaches both life
branches; an exact hidden-hand object returns when the first Sculler leaves and
is offered to a second Sculler; and Showdown puts its chapter counter on the
selected creature after a cast. Other trigger targets, optional targets,
multiple targets, attachments, hidden-zone shapes, installed triggers,
mana-color choices, generated objects, and any script or cohort drift remain
refused.

Selfless Spirit is position-pinned under
`ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1`. Its exact
installed script fixes the sacrificed object to the source and grants only
creatures its controller controls indestructible until end of turn, so it
reaches no sacrifice-choice callback. A real Forge session proves the source
moves to the graveyard as the cost, another controlled creature survives a
destroy effect while protected, the same protection expires before a later
destroy effect, and ordinary flying combat remains executable. Arbitrary
sacrifice costs, affected sets, keywords, durations, targets, choices, and
additional effects remain unsupported.

Remorseful Cleric is position-pinned under
`ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1`.
Its exact installed script fixes the sacrificed object to the source, selects
one player through the existing singleton target transport, and moves every
card in only that player's graveyard to exile without an individual card
choice. A real Forge session proves the selected target, source cost, whole-set
move, untouched other graveyard, and ordinary flying combat. Partial or
count-limited graveyard selection, other targets, costs, zones, destinations,
callbacks, and additional effects remain unsupported.

Coldsteel Heart is position-pinned under
`coldsteel-heart-entry-color-chosen-mana-v1`. Its installed script is pinned
as a whole: exact Snow Artifact identity, tapped entry replacement, mandatory
one-of-five color choice, and a tap ability that produces only the chosen
color. The bridge owns Forge's `chooseColors` callback only when that exact
card offers exactly one choice from WUBRG. A real Forge session selects red,
observes tapped entry and a later untap, then spends that same Heart for the
red pip of Flame Rift from a deck with no other red source. Iona, Utopia
Sprawl, restricted color sets, colorless, multiple colors, and every other
name/text/type/number choice remain unsupported.

Extinction Event is position-pinned under
`extinction-event-odd-even-exile-v1`. Its exact six-line installed script owns
one mandatory `OddsOrEvens` binary choice and stores that value only on the
resolving source before Forge applies the whole-battlefield creature parity
filter. Installed sessions exercise both backend-issued choices over a
mana-value-zero Crab token and a one-mana creature: odd removes only the latter,
while even removes only the token. Other binary kinds, defaults, choosers,
filters, origins, destinations, and all wider number or naming choices remain
unsupported.

Vraska, Relic Seeker uses the separate
`ordinary-combat-target-and-pinned-generated-token-v1` profile. Its Pirate and
Treasure scripts are recursively resolved from an explicit Forge resource
root, byte-pinned, classified, and checked as an exact dependency graph. A real
session destroys the exact Pirate, observes the created Treasure identity, and
spends that same object for red mana. This does not admit other transitive
generated sources or make any-color mana an ordinary global source shape.

Birthing Pod is position-pinned under
`stated-ordering-and-reviewed-birthing-pod-v1`. Its complete installed script
composes printed and activated Phyrexian mana, a tap, one controlled creature
sacrifice, sacrificed mana value plus one, and a library-to-battlefield
creature search at sorcery speed. A real Forge session pays the activated
Phyrexian symbol with exactly two life, offers only the valid controlled
creature for sacrifice, and then offers only the exact qualifying library
creature. Invented and stale choices are rejected; the selected sacrifice is
in the graveyard, the selected result is on the battlefield, and Pod is
tapped. Other Phyrexian costs, sacrifices, derived values, searches,
identities, and compositions remain unsupported.

Pia Nalaar, Pia and Kiran Nalaar, and Siege-Gang Commander are position-pinned
under `stated-ordering-and-reviewed-pia-siege-gang-v1`. Their complete
installed scripts compose exact entry-token populations with only their
printed activated abilities. Forge supplies the legal Artifact or Goblin
sacrifice candidates; the bridge accepts only a still-legal backend-issued
identity and preserves the game when the player cancels. Installed sessions
prove one and two exact Thopters, three exact Goblins, selected-object payment,
both two-damage routes, Pia's artifact-only +1/+0 and its end-of-turn expiry,
and Pia's no-block restriction and next-turn expiry. Invented and stale
identities are rejected. Other token scripts, sacrifices, filters, sources,
targets, amounts, durations, and compositions remain unsupported.

Recurring Nightmare is position-pinned under
`stated-ordering-and-reviewed-recurring-nightmare-v1`. Its complete installed
script composes one controlled-creature sacrifice, the fixed return of the
source to its owner's hand, and one local-graveyard creature target moved to
the battlefield at sorcery speed. A real Forge session offers only exact
backend-issued objects for both choices and rejects invented and stale ones.
The selected sacrifice reaches the graveyard, the selected target reaches the
battlefield with its original identity, the source reaches hand, and the stack
is empty. Other sacrifices, return costs, graveyard targets, identities,
effects, and compositions remain unsupported.

Ranger-Captain of Eos is position-pinned under
`stated-ordering-and-reviewed-ranger-captain-of-eos-v1`. Its complete
installed script composes an optional mana-value-one-or-less creature search
with the fixed sacrifice of its source. A real Forge session accepts and
declines the entry trigger, offers only the exact qualifying library object,
rejects invented and stale choices, and moves the selected object to hand. Its
separate activated route puts the exact Ranger-Captain in its owner's
graveyard, removes an opposing Lightning Bolt from legal spell actions for the
rest of that turn despite available red mana, restores the action on the next
turn, and observes exactly three damage. Other optional searches, sacrifice
costs, casting restrictions, identities, effects, and compositions remain
unsupported.

Forbid is position-pinned under
`stated-ordering-and-reviewed-forbid-v1`. Its complete installed script
composes a mandatory singleton spell target with optional discard-two
Buyback. A real Forge session counters an opposing Lightning Bolt without
damage and puts Forbid in the graveyard when Buyback is declined. The Buyback
route rejects invented and stale discard choices, proves cancellation restores
the exact Forbid to hand with the target still on the Stack, the graveyard
unchanged, and mana untapped, then discards two distinct exact hand objects on
a second cast and returns the exact resolving Forbid to hand. Other counters,
optional costs, discard costs, Buyback cards, targets, identities, effects,
and compositions remain unsupported.

Glen Elendra Archmage is position-pinned under
`stated-ordering-and-reviewed-glen-elendra-archmage-v1`. Its complete installed
script composes ordinary blue mana, the fixed sacrifice of its source, one
mandatory noncreature-spell Stack target, and Persist. A real Forge session
offers exactly the legal Lightning Bolt object and rejects invented and stale
choices. That exact spell is countered into its owner's graveyard without
resolving, and the exact sacrificed Archmage returns to the battlefield with
one counter. Other activated counters, Stack targets, sacrifice shapes,
Persist cards, identities, effects, and compositions remain unsupported.

Animate Dead is position-pinned under
`stated-ordering-and-reviewed-animate-dead-v1`. Its exact installed script
composes one mandatory creature-card target in a graveyard, reanimation under
the Aura controller's control, attachment, the continuous -1/-0 change, and
the delayed sacrifice when that Aura leaves. A real Forge session rejects
invented and stale target identities, proves target cancellation rolls back
the cast, reanimates the exact Entombed object as a 4/5, and sacrifices that
same object after Vindicate removes the Aura. Other Auras, attachment targets,
graveyard filters, control changes, cleanup triggers, identities, effects, and
compositions remain unsupported.

Heartless Act is position-pinned under
`stated-ordering-and-reviewed-heartless-act-v1`. Its exact installed script
offers the destroy and remove-counter modes in their printed order. A real
Forge session proves the destroy route offers only the counterless Wall of
Omens and excludes a Student of Warfare with a level counter; target
cancellation restores the spell, mana, and both objects before the second cast
destroys that exact Wall. A separate session builds the Student with three
level counters and one +1/+1 counter. The remove route offers the exact two
creatures, lets the seat select the level-counter type, exposes exactly the
zero-through-three removal range, removes two level counters, and leaves the
+1/+1 counter untouched after the seat stops at zero. Invented and stale mode,
target, counter-type, and number answers are rejected. Other Charms, destroy
filters, RemoveCounter effects, Any counter choices, UpTo amounts, targets,
identities, and compositions remain unsupported.

Agadeem's Awakening is position-pinned under
`stated-ordering-and-reviewed-agadeems-awakening-v1`. Its exact installed
two-face script casts the front with an announced X and allows zero or more
controller-owned graveyard creature targets whose mana values are at most X
and pairwise distinct. A real Forge session proves cancellation rollback,
zero-, one-, and two-target resolutions, ownership and X filtering, distinct
mana-value enforcement, and rejection of invented and stale answers. Separate
installed sessions prove both of Agadeem, the Undercrypt's entry branches with
exact life and tapped-state deltas and use its black mana to cast a spell.
Other X reanimation, variable multiple targets, distinct-value restrictions,
optional pay-life replacements, modal faces, identities, effects, and
compositions remain unsupported.

Fact or Fiction is position-pinned under
`stated-ordering-and-reviewed-fact-or-fiction-v1`. Its exact installed script
reveals and remembers at most five library objects, asks the opposing seat to
partition those exact identities into disjoint exhaustive piles, then asks the
caster to choose one. A real two-local-seat Forge session proves cast-payment
cancellation rollback, the exact five-object opponent partition, caster-only
pile choice, rejection of invented and stale answers, and the chosen objects in
hand with every rejected object in the graveyard. Other reveal counts,
remembered sets, separators, choosers, destinations, identities, and TwoPiles
compositions remain unsupported.

Sword of Hearth and Home is position-pinned under
`stated-ordering-and-reviewed-sword-of-hearth-and-home-v1`. Its exact
installed script composes the printed Equip {2} route, +2/+2 and protection
from green and white, the optional combat-damage blink of a creature the Sword
controller owns, the optional basic-land search of that controller's real
library, the remembered return under that controller's control, and cleanup.
Installed Forge sessions prove Equip target cancellation rollback, reject
invented and stale target and library identities, exercise both decline and
exact blink/search branches, verify the protection colors against real
blockers, and observe the chosen creature and basic land on the battlefield.
Other Equipment, Swords, targets, searches, remembered moves, identities,
effects, and compositions remain unsupported.

Gideon Blackblade, Bloodline Keeper, and Garruk Wildspeaker are position-pinned
under `stated-ordering-and-reviewed-gideon-garruk-bloodline-v1`. Their exact
installed scripts compose bounded and optional targets, a closed keyword menu,
loyalty costs, token creation, SetState transformation, continuous local-only
effects, and ordinary mana and priority. Installed Forge sessions prove the
exact target, keyword, token, transform, prevention, untap, pump, expiry, and
exile outcomes and reject invented, stale, duplicate, and canceled choices at
their reviewed boundaries. Other planeswalkers, transforms, targets, tokens,
keywords, identities, effects, and compositions remain unsupported.

Emeria's Call and Turntimber Symbiosis are position-pinned under
`stated-ordering-and-reviewed-modal-land-spells-v1`. Their exact installed
scripts compose the spell face with the reviewed modal-land replacement route.
Installed Forge sessions prove Emeria's two Angel Warriors and the exact
non-Angel indestructibility duration, Turntimber's bounded library selection
and three-counter threshold, and both land faces' pay-three-life choice,
tapped state, life total, colored mana, cancellation, and hostile-choice
refusal. Other modal faces, replacement effects, Dig shapes, generated tokens,
identities, effects, and compositions remain unsupported.

Glasspool Mimic and Phyrexian Metamorph are position-pinned under
`stated-ordering-and-reviewed-optional-copy-replacement-v1`. Their exact
installed scripts compose the optional enter-as-copy replacement with
controller-only creature selection or the other-artifact-or-creature domain,
the printed added types, Glasspool Shore's tapped blue-mana land route, and
Metamorph's exact blue-or-two-life payment. Installed Forge sessions prove
both replacement outcomes, exact candidate domains and retained identities,
the modal land outcome, payment cancellation rollback, both Phyrexian payment
arms, and invented and stale choice refusal. Other copy replacements, domains,
types, modal faces, Phyrexian costs, identities, effects, and compositions
remain unsupported.

Delver of Secrets and Velomachus Lorehold are position-pinned under
`stated-ordering-and-reviewed-peek-and-reveal-v1`. Their exact scripts compose
optional top-card reveal and transformation or optional eligible top-seven
free casting with random-bottom placement. Installed Forge sessions prove
Delver's declined and accepted reveal branches, same-object 3/2 transform and
combat damage, and Velomachus's declined and accepted cast branches, exact
eligible object menu, no-mana free cast, target damage, and library-to-graveyard
movement. Invented and stale decisions are rejected. Other PeekAndReveal
amounts, filters, flags, state changes, destinations, identities, effects, and
compositions remain unsupported.

Koma, Cosmos Serpent, Retrofitter Foundry, and Treasure Map are position-pinned
under `stated-ordering-and-reviewed-generated-token-sacrifice-v1`. Their exact
scripts compose only their pinned generated-token roots with exact activated
cost vectors and effects. Installed Forge sessions prove Koma's upkeep Coils,
both modes, selected-Coil sacrifice, indestructible survival, and exact opposing
permanent tap; Foundry's Servo-to-Thopter-to-Construct chain; and Treasure Map's
three scries, same-object Treasure Cove transform, three Treasures, selected
Treasure sacrifice, and one-card draw. Invented and stale payments are rejected,
and cancellation preserves the source, selected candidate, mana, Stack, and
pending ability. Other token roots, amounts, sacrifice types, costs, modes,
targets, transforms, identities, effects, and compositions remain unsupported.

Mystic Confluence is position-pinned under
`stated-ordering-and-reviewed-repeatable-mode-v1`. Its exact installed script
repeats exactly three choices from Forge's currently legal subset of its three
ordered modes: counter a target spell unless its controller pays three, return
a target creature to its owner's hand, or draw a card. Installed Forge sessions
prove three draws, three exact creature returns, both counter-payment branches,
cancel rollback, and invented and stale choice refusal. Other repeat counts,
mode identities, filters, costs, payers, targets, and compositions remain
unsupported.

Stratus Dancer is position-pinned under
`stated-ordering-and-reviewed-trigger-target-v1`. Its exact installed script
composes Flying, `Megamorph:1 U`, one `TurnFaceUp` trigger, and one mandatory
singleton Counter target restricted to instant or sorcery spells on the Stack.
An installed Forge session casts the exact card face down, partially pays and
cancels its megamorph cost, proves mana and object rollback, retries payment,
rejects invented and stale target moves, counters the exact selected Lightning
Bolt without letting it resolve, and observes the same object face up as a 3/2
with exactly one +1/+1 counter. Other morph costs, trigger modes or zones,
target types or cardinalities, spell filters, identities, and compositions
remain unsupported.

Prismari Command is position-pinned under
`stated-ordering-and-reviewed-prismari-command-v1`. Its exact installed script
chooses exactly two distinct modes from the ordered damage, loot, Treasure, and
artifact-destruction list; the Treasure mode is coupled to the pinned
`c_a_treasure_sac` token script. An installed Forge session proves all four
mode outcomes across two resolved casts, target and discard identities, a
canceled cast's complete rollback, and invented and stale mode, target, and
discard refusal. Other Commands, mode counts or lists, targets, token scripts
or owners, effects, identities, and compositions remain unsupported.

Smuggler's Copter is position-pinned under
`stated-ordering-and-reviewed-smugglers-copter-v1`. Its exact installed script
composes Crew 1 with separate attack and block triggers whose optional
`Draw<1/You>` payment leads to one exact hand discard. Installed Forge sessions
prove canceled Crew payment restores the entire public position, accepted Crew
payment taps only exact legal local creatures with enough total power, and the
Vehicle becomes a 3/3 artifact creature until end of turn. They also prove the
attack-trigger decline changes neither hand nor library, while accepting the
block trigger draws exactly one card and discards the selected current hand
object. Invented and stale Crew, trigger, and discard choices are rejected.
Other Vehicles, Crew amounts or candidates, combat triggers, payments, discard
modes or counts, identities, effects, and compositions remain unsupported.

Huntmaster of the Fells is position-pinned under
`stated-ordering-and-reviewed-huntmaster-v1`. Its exact installed double-faced
script creates the pinned 2/2 green Wolf and gains two life on each front-face
entry, transforms the same battlefield object in both upkeep directions, and
routes Ravager of the Fells's two-damage trigger through one required opposing
player-or-planeswalker target followed by an optional creature controlled by
that first target. An installed Forge session proves two complete transform
cycles, both Wolf creations, four total life gained, two exact damage packets,
the explicit no-creature route, and invented and stale target refusal without
changing the pending board. Other Werewolf scripts, transform conditions,
generated objects, target relationships, damage values, identities, and
compositions remain unsupported.

The 590 admitted official positions share reviewed real-Forge evidence. Flame
Rift and the five basic lands remain bridge baselines outside the official 600.
The runtime allowlist is checked against the ledger's 590-name safe projection,
so neither side can widen alone. The other 10 official positions remain
explicitly refused until a typed, parameter-sensitive capability profile and
runtime evidence cover the whole card.

Build and verify without network access:

```bash
javap -classpath /path/to/forge-gui-desktop-2.0.14-jar-with-dependencies.jar \
  -public forge.game.player.PlayerController > /tmp/player-controller.txt

npx tsx packages/data/tools/build-legacy-cube-decision-ledger.ts \
  --forge-scripts /path/to/extracted/cardsfolder \
  --forge-token-scripts /path/to/forge/res/tokenscripts \
  --controller-javap /tmp/player-controller.txt \
  --choose-even-odd-class /path/to/ChooseEvenOddEffect.class \
  --choose-even-odd-source /path/to/ChooseEvenOddEffect.java \
  --bridge-source packages/forge-export/bridge/ForgeBridge.java \
  --out packages/data/data/legacy-cube-2021-forge-decisions-v1.json

npx tsx packages/data/tools/verify-legacy-cube-decisions.ts \
  --forge-scripts /path/to/cardsfolder.zip \
  --forge-token-scripts /path/to/forge/res/tokenscripts \
  --controller-javap /tmp/player-controller.txt \
  --choose-even-odd-class /path/to/ChooseEvenOddEffect.class \
  --choose-even-odd-source /path/to/ChooseEvenOddEffect.java \
  --bridge-source packages/forge-export/bridge/ForgeBridge.java
```

The hostile observed-backend signature probes are opt-in while the bridge lane
is separate: set `MTG_FORGE_OBSERVED_MODULE` to its `observed/backend.ts`. The
test invokes that real `supports` gate for one representative of each identical
high-risk family signature and checks the two completed baseline cards. A
pre-spawn refusal is containment evidence, not evidence that Forge executed the
card's mechanics.

## Static reference profiles

`data/reference-profiles-v1.json` is derived from that corpus with:

```bash
npm run reference:profiles
npm run reference:diff -- path/to/executable-set.json
```

Every rate and distribution names its exact population and count. Mechanic
as-fan instead names the expected physical cards in one weighted Draft Booster,
because unique collector positions are the wrong denominator for pack exposure.
M11 and M13 remain separate profiles. Their combined primary-core target uses
the intersection of explicit policy-tolerance bands where possible and a
configurable M13 precedence where the bands conflict. The tolerance-policy
version is separate from both corpus and profile versions; its bands are not
confidence intervals. M15, M20, and ORI remain secondary, every expansion stays
labeled, and MH2 is stress-only and absent from the primary aggregate.

These profiles are static censuses and warning proxies. They make no gameplay,
draft-pick, card-strength, archetype-viability, human-preference, or confidence
claim. Native simulation and human evidence must be stored as separate evidence
instead of overwriting the static artifact.

Default store `data/store/mtg.sqlite`, default download cache `data/cache/` —
both gitignored. `--db` and `--cache` override them.

## `--json`

`--json` is machine-readable on both outcomes, not just on success. A failing
run puts an envelope on stdout and still exits non-zero:

```json
{
  "error": {
    "name": "InvalidInputError",
    "message": "Invalid card reference: no card matches \"Jace, Wielder of Nonsense\" — try `find \"Jace, Wielder of Nonsense\"` to search"
  }
}
```

`name` is the class from `src/errors.ts` — `InvalidInputError`, `HttpError`,
`RemoteShapeError`, `DownloadIntegrityError`, `SchemaVersionError`, or `Error`
for anything a dependency threw — so a caller branches on the cause instead of
matching message text. No stack trace crosses the boundary. A dependency that
throws something that is not an `Error` at all reports as `NonError`, with the
value rendered into `message`.

Three rules a consumer can rely on:

- **The exit code is the authority, not the document shape.** 0 is success, 2 is
  an unknown command, 1 is every other failure. A structured error is still an
  error; do not infer success from parseable stdout.
- **stderr always carries the human line.** `--json` adds the stdout channel, it
  does not move the message off stderr. Progress during `ingest` is on stderr too,
  so stdout stays a single document.
- **One exception, by construction:** a broken stdout (`… | head -3` closing the
  pipe) exits 0 without an envelope, because there is nowhere to write one.

Re-running `ingest` is free when upstream has not rebuilt the file: change
detection is Scryfall's `bulk_data.updated_at`. Ctrl-C stops at the next batch
boundary and leaves a checkpoint; the next run resumes from it.

## Library

```ts
import { openStore, findCardsByColorIdentity, upsertLabCard } from '@mtg/data';
```

Tables: `oracle_card`, `printing`, `ruling` (each with the upstream record
verbatim in `raw_json` plus provenance columns), `ingest_run`, `ingest_reject`,
`vocabulary`. Generated cards use the same `oracle_card`/`printing` shape with
`source = 'lab'`, so queries do not care where a card came from.

`@mtg/data` deliberately does not depend on `@mtg/dsl`: the vocabulary module
(`buildVocabulary`, `unknownKeywords`, `isKnownSubtype`, …) is the artifact the
DSL can consume later for validation, and a dependency in this direction would
close the cycle.

## Sources and attribution

Card data from [Scryfall](https://scryfall.com), used under their API
guidelines: bulk-first, a pinned descriptive `User-Agent` and `Accept` header on
every request, rate limiting per their documented limits, no paywalling.
Vocabulary and reference-set data from [MTGJSON](https://mtgjson.com) (MIT).

Portions of the materials used are property of Wizards of the Coast. ©Wizards of
the Coast LLC. This lab is unofficial Fan Content permitted under the Fan
Content Policy. Not approved/endorsed by Wizards.

Full envelope: `docs/research/prior-art-data-sources.md` §1, §2, §6.
