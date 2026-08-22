/**
 * Spell-slot roles: the published skeleton's role vocabulary compiled down to
 * the slice's effect primitives.
 *
 * The skeleton profile names roles the way Wizards names them ("removalExile",
 * "auraOverwrite"). The generator's half of the DSL has no mana abilities and
 * no fight a spell can print — so several canon roles cannot be printed as
 * written. Each such role carries an explicit `substitution` note that the
 * generator copies into its report: the set says out loud where the slice's
 * expressiveness bent the skeleton, instead of silently printing something else.
 *
 * This table is mechanical transformation, not judgment: it says which effect
 * primitives a slot may use. Which one to use, with what numbers and targets, is
 * the model's decision (ZFC).
 *
 * # What decides which tier prints a role
 *
 * Nothing in this file, and nothing in it could. A `RoleProfile` carries a card
 * kind, an effect vocabulary and sometimes a cost window; it carries no rarity,
 * because the published profile names spell slots at common and at no other
 * tier. `skeleton-lite.ts` copies that one list onto uncommon and rare — its own
 * INFERRED derivation note says so — and `cycleRoles` fills a group by walking
 * the list from the head. Which tiers reach a role is therefore its *position*
 * in its color's list measured against the spell slots that tier was allocated,
 * not a property of the role.
 *
 * Over every set size the derivation accepts, five roles sit past the longest
 * group under common and so are default-reachable at common alone:
 * `removalArtifactEnchantment`, `modalSpell`, `removalOvercosted`,
 * `burnSixForFive` and `dig`, which is the tail of each color's list.
 * `stated-spell-roles.test.ts` holds that measurement rather than this sentence.
 *
 * Default-reachable is not reachable. A brief's `spellRoles` seats any role at
 * any tier (`stated-roles.ts`), and two of those five tails are printed at rare
 * that way today. `mtg-7u5l` was filed against this file on the belief that
 * `removalOvercosted` could not structurally be a rare; it can, and it is.
 *
 * The silence about rarity is deliberate rather than an omission, and the card
 * store says why. Across the 45 paper expansion and core sets released since
 * 2018, an instant or sorcery at mana value 4 or more whose whole printed line
 * is one unconditional destroy or exile appears 11 times at common, once at
 * uncommon, and never at rare or mythic; the six expensive single-target answers
 * that are rare all print a second clause. So the plain card is a common and the
 * tier is what changes it, which makes "what does this role become at rare" a
 * design question the brief and the model answer. A ceiling written here would
 * take it from both.
 *
 * # The substitution notes, audited
 *
 * Fifteen of the sixteen notes below opened "DSL v0", and the DSL has moved on.
 * `mtg-vl7k` read every one of them against the current `Effect` union and the
 * current vocabulary. The finding is below; the thing that keeps it from going
 * stale again is `test/substitution-notes.test.ts` rather than this paragraph,
 * because a paragraph is what went stale the first time.
 *
 * ## Eight gaps are still real and their notes say so accurately
 *
 * No attack or block condition a filled slot can reach — `TargetFilter.combat`
 * says attacking, blocking or either since `mtg-6y4g`, and it is hand-authored
 * only, which is the missing half `removalSmallConditional` has below:
 * `ModelTargetSpec` is `{ kind }` and carries no filter, so the slot still
 * prints unconditional removal (`removalCombatConditional`).
 * `TargetRestriction`, which the note blames, never carried a combat predicate
 * and still does not. No protection and no hexproof in `KEYWORDS`
 * (`protectiveInstant`). No life payment anywhere: not in `ActivationCost`, not
 * in `UnlessClause`, which prices only mana, and `LIMITS.life` starts at 1
 * (`cardDrawAtCost`). No
 * exile-and-play-this-turn (`cardDrawImpulsive`). No card-printable mana
 * ability — `producesMana` is a field on a land, not an effect a spell can
 * name (`manaAcceleration`).
 *
 * `discard` was on that list until `mtg-avg2`, and it left it the way
 * `manaAcceleration` did rather than the way `libraryTopBottom` did:
 * `discardCards` and `chooseDiscard` are real primitives the kernel runs, and
 * both are in `UNPRICED_EFFECT_KINDS`, so `RoleProfile.effectKinds` cannot name
 * either and the slot still mills. The note's corrected text says that, and the
 * correction was free for the reason the paragraph on blast radius below gives:
 * no recorded fixture holds it.
 *
 * And fight, which is the pair the bead behind this audit led with. There is
 * now a `fight` primitive, and `fight` and `bite` still collapse to
 * `pumpUntilEndOfTurn` anyway, for a reason that outlasts the vocabulary: the
 * primitive reads the power of *the body it is printed on*, so it is legal only
 * on a creature's own `selfEnters` trigger, and both of these roles are
 * instants. A spell has no body to fight with. `bite` has a second gap on top
 * of that one — the primitive deals damage in both directions (CR 701.12a) and
 * nothing prints one-sided damage from a creature's power.
 *
 * The generator could not reach it in any case: `fight` is in
 * `UNPRICED_EFFECT_KINDS`, and `RoleProfile.effectKinds` is typed
 * `readonly EffectKind[]`, so naming it here would not compile. That is
 * deliberate rather than pending — the same containment
 * `removalArtifactEnchantment` records — and it is what keeps a hand-authored
 * primitive out of a generated slot.
 *
 * ## One gap closed and is fixed here
 *
 * `libraryTopBottom` printed `millCards` and now prints `scry`, because
 * `mtg-q5yg` promoted the primitive. It is the only closed gap this change
 * could pay off, and the reason is measured rather than argued: see below.
 *
 * ## Seven notes are wrong, and only two of them could be corrected for free
 *
 * The other five were left standing, and the reason is a cost rather than a
 * preference. `prompts.ts`'s `slotSection` prints `substitution` verbatim into
 * the fill prompt, and `packages/llm/src/schema.ts`'s `fixtureKey()`
 * sha256-hashes the prompt: changing one of these strings by a character
 * orphans every recorded fixture whose batch held that role, and getting them
 * back is a paid live run. Counted over `fixtures/llm*` by searching for each
 * note's own text, the blast radius is 12 files for `removalSmallConditional`,
 * 10 for `removalExpensive`, 5 each for `removalExile` and
 * `artifactDestructionModal`, and 4 for `auraOverwrite`. One of the five has
 * since been corrected by paying that cost a different way; the section below
 * on `removalExpensive` is what it cost.
 *
 * What each of those five is actually wrong about, since the note cannot say it:
 *
 * - `removalExile` — the exile zone arrived with `exileTarget` and the
 *   generator can reach it, through the per-batch `ZoneReachingModelEffect`
 *   tier. `exileRemoval` below is the role a brief states to get one.
 * - `auraOverwrite` — `mtg-fv5s` added the Aura shape and five Aura roles, so
 *   this table can seat an Aura, just not through this role. A brief that wants
 *   one states `auraPacify` or a sibling.
 * - `removalSmallConditional` — `TargetRestriction.maxPower` is exactly the
 *   condition the note says does not exist. What is missing is the generator's
 *   half: `ModelTargetSpec` is `{ kind }` and carries no restriction.
 * - `artifactDestructionModal` — `targetArtifactOrEnchantment` is a real target
 *   kind. Same missing half as above, and the same as
 *   `removalArtifactEnchantment` below.
 * - `removalExpensive` — flatly false. `triggerChoosesTargets` in
 *   `@mtg/dsl`'s `abilities.ts` exists and a triggered ability does choose its
 *   targets. This is the one the section two below went back and corrected.
 *
 * ## Why two of the seven could be corrected and the rest could not
 *
 * `removalArtifactEnchantment` and `modalSpell` appear in two recorded files
 * each, and all four belong to the orphaned 249-card flagship set run that no
 * test replays. The two runs that do replay are Tideglass Reach
 * (`recorded-set.test.ts`) and Hearthglass Vigil
 * (`recorded-abilities.test.ts`), and neither brief seats either role: both sit
 * at the tail of their color's list, and neither set is large enough to reach
 * it. That is why these two were free and the five above were not.
 * `libraryTopBottom` and `discard` appear in
 * no recorded file at all. So four of the sixteen notes are free to edit, that
 * change edited the three of them that were inaccurate, and the guard test
 * derives that same set rather than trusting this sentence.
 *
 * ## `removalExpensive`, corrected by re-keying rather than by re-recording
 *
 * `mtg-lr0z` went back for the one of the five that was not merely wrong about
 * *what* was missing but wrong that anything was. The note said a trigger
 * cannot choose its targets; an artifact whose `selfEnters` trigger destroys
 * target creature parses, validates clean and renders, and
 * `triggerChoosesTargets` answers `true` on it. So the sentence being printed
 * into every prompt holding a colorless spell slot named an engine limit the
 * engine does not have.
 *
 * The corrected note names the limit that is real, and it is the generator's
 * rather than the engine's, twice over: `RoleProfile.cardKind` has no
 * `'artifact'` arm, so no role in this table can declare itself one; and a
 * permanent cannot carry a spell's effect list at all — `checkEffects` refuses
 * it with `EFFECT_ILLEGAL_ON_CARD_TYPE`, "a permanent's effects are printed
 * inside its abilities" — so `effectKinds`, which is what this role states, is
 * a spell's field. The slot still substitutes, and the substitution is still
 * worth printing; only its stated reason was false.
 *
 * The ten recordings were re-keyed rather than re-recorded, by
 * `tools/rekey-fixtures.ts`, which is the tool that had been done by hand twice
 * before and committed neither time. What that costs is written on the tool and
 * in `test/recorded-set.test.ts`'s header: the response in each of those ten
 * files was produced under the old sentence, so the recording answers a
 * question one sentence different from the one now being asked. The
 * alternative was regenerating a committed set eight other packages test
 * against, which is the same trade the two earlier re-keys took.
 *
 * What it deliberately did **not** do is change what the slot prints. Whether
 * the colorless removal slot should now be an artifact that destroys a creature
 * as it arrives is a design question, and answering it costs a paid generation
 * run.
 *
 * Their corrected text names the half that is still true, which is the
 * generator's rather than the engine's: `targetArtifactOrEnchantment` sits in
 * `handAuthoredTargets` rather than `generatableTargets` because
 * `MODEL_TARGET_KINDS` is the frozen four, and `modes` is a real `Card` field
 * that no fill answer schema offers. The flagship's three answers to its own
 * artifacts and enchantments are authored cards rather than filled slots for
 * exactly the first reason (`mtg-xhm0`).
 */
import type { AbilityKind, Color, EffectKind, ModelAuraModificationKind } from '@mtg/dsl';
import { isPricedEffectKind, MODEL_EFFECT_KINDS } from '@mtg/dsl';
import { classify, PLAY_BOOSTER_2024 } from '@mtg/design-data';

export interface ManaValueRange {
  readonly min: number;
  readonly max: number;
}

export interface RoleProfile {
  /**
   * What the role prints. The two spell types are the original pair and still
   * the bulk of the table; the two permanent types arrived with `mtg-fv5s` and
   * are reachable only from a brief's `spellRoles`, because the published
   * skeleton's own slot lists name none of them.
   */
  readonly cardKind: 'instant' | 'sorcery' | 'enchantment' | 'planeswalker';
  /**
   * Effect primitives this role may use, before color-pie filtering.
   *
   * Empty on a role whose card prints no effect list at all: an Aura says what
   * it says in its clause, and a blanket enchantment says it in a static
   * ability. `coloredSpellSlots` reads the empty list as "do not ask the pie",
   * because `allowedEffectKinds` throws on an empty result and an empty input
   * would reach that throw with nothing wrong.
   *
   * On the walker role the list is neither a spell's effects nor nothing: it is
   * the vocabulary its loyalty abilities draw from, which is what
   * `<effect_vocabulary>` is built out of. `checkEffectKinds` reads a card's own
   * effects and a planeswalker has none, so on that role the list shapes the
   * prompt and the pie check does the reading back.
   */
  readonly effectKinds: readonly EffectKind[];
  /** Mana-value window when the role itself implies one (e.g. "burn 6 for 5"). */
  readonly manaValue?: ManaValueRange;
  /**
   * The modifications an Aura printed here may put on the creature it enchants.
   * Present exactly on the Aura roles; its presence is what makes the slot an
   * Aura slot rather than a blanket enchantment one.
   */
  readonly auraModifications?: readonly ModelAuraModificationKind[];
  /**
   * CR 113 ability kinds a permanent printed here must carry.
   *
   * Present exactly on the two permanent roles that say what they do in an
   * ability rather than in a clause or an effect list, and absent everywhere
   * else — an instant carries no ability, and the ability kinds an ordinary
   * permanent slot carries are `reserveAbilitySlots`' to hand out per brief
   * mechanic, not this table's to state per role.
   */
  readonly abilityKinds?: readonly AbilityKind[];
  /**
   * Present when the slice cannot print the canon role as written, saying what
   * is missing and what the slot prints instead.
   *
   * Printed verbatim into the fill prompt by `slotSection`, which is why the
   * text is a sentence about the generator rather than a note to a reader, and
   * why correcting one is a fixture cost rather than an edit. The header's audit
   * is the standing record of which of these are true; the guard in
   * `test/substitution-notes.test.ts` is what fails when one stops being.
   */
  readonly substitution?: string;
}

/**
 * What a loyalty ability may resolve: every primitive the generator can answer
 * with, minus the one a walker can never use.
 *
 * Derived rather than typed out, so a primitive added to `ModelEffectSchema`
 * reaches a walker's menu by construction. `counterSpell` is the exclusion and
 * CR 606.3 is the reason: a loyalty ability activates only at sorcery speed, so
 * one that countered a spell would be waiting for a window it can never have.
 * The pie filter in `allowedEffectKinds` narrows the rest per color, which is
 * how a white walker ends up making tokens and gaining life while a red one
 * deals damage, without this table deciding it.
 */
const LOYALTY_EFFECT_KINDS: readonly EffectKind[] = MODEL_EFFECT_KINDS.filter(isPricedEffectKind).filter(
  (kind) => kind !== 'counterSpell',
);

/**
 * Every spell role the shipped skeleton profile uses, color slots only.
 *
 * Most colorless slots are absent on purpose: the profile's gear roles name
 * nothing this table could give them, so a missing entry means "print an
 * artifact with an empty effect list". That is a statement about effects and no
 * longer a statement about the card — the DSL prints abilities now, and
 * `reserveAbilitySlots` and `fillTextlessPermanents` in `allocate.ts` hand such
 * a permanent one rather than leaving it blank. `removalExpensive` is the one
 * colorless role with an entry here.
 */
export const ROLE_PROFILES: Readonly<Record<string, RoleProfile>> = {
  // White
  removalCombatConditional: {
    cardKind: 'instant',
    effectKinds: ['destroyPermanent', 'tapPermanent'],
    substitution: 'DSL v0 has no attack/block conditions; the slot prints unconditional removal or a tap.',
  },
  removalExile: {
    cardKind: 'sorcery',
    effectKinds: ['destroyPermanent'],
    substitution: 'DSL v0 has no exile zone; the slot prints destruction instead.',
  },
  combatTrick: { cardKind: 'instant', effectKinds: ['pumpUntilEndOfTurn'] },
  removalArtifactEnchantment: {
    cardKind: 'instant',
    effectKinds: ['tapPermanent'],
    substitution:
      'The generator cannot aim a spell at an artifact or enchantment; the target kind exists but is hand-authored only, so the slot prints a tempo answer (tap) instead.',
  },
  // Blue
  protectiveInstant: {
    cardKind: 'instant',
    effectKinds: ['returnToHand'],
    substitution: 'DSL v0 has no protection or hexproof; the slot saves a creature by bouncing it.',
  },
  counterspell: { cardKind: 'instant', effectKinds: ['counterSpell'] },
  cantrip: { cardKind: 'instant', effectKinds: ['drawCards'], manaValue: { min: 1, max: 2 } },
  drawTwoOrThree: { cardKind: 'sorcery', effectKinds: ['drawCards'], manaValue: { min: 3, max: 4 } },
  auraOverwrite: {
    cardKind: 'sorcery',
    effectKinds: ['tapPermanent', 'returnToHand'],
    substitution: 'DSL v0 has no auras; the slot prints a one-shot tempo effect instead.',
  },
  // The one canon role whose substitution note could be paid off in place, and
  // `mtg-vl7k` paid it. `scry` is what "library top/bottom" names, `mtg-q5yg`
  // promoted the primitive, and the note claiming the DSL had no library
  // manipulation had been false ever since. It is corrected here rather than
  // stood in for by a new role name because it is the only noted role no
  // recorded fixture holds: the audit in the header measured the corpora
  // directly, and this role appears in zero prompts under `fixtures/llm*`, so
  // the sentence that stopped every other correction does not apply to it.
  //
  // Both kinds rather than `scry` alone, for `scryCantrip`'s measured reason:
  // `@mtg/deckbuild` prices `scry` at 0.0, so a card whose whole text is "scry
  // 2" is cut from every deck built out of the set. The two roles do overlap
  // now, and they are reached differently — this one sits in the published
  // skeleton's blue common list and is seated by position, `scryCantrip` is
  // stated by a brief and carries the 1-2 cost window Opt and Preordain are
  // printed at. Whether one of them should absorb the other is a design call
  // and `mtg-vl7k` did not make it.
  libraryTopBottom: {
    cardKind: 'instant',
    effectKinds: ['scry', 'drawCards'],
  },
  modalSpell: {
    cardKind: 'instant',
    effectKinds: ['drawCards', 'returnToHand', 'tapPermanent'],
    substitution:
      'The generator cannot emit modes; the DSL prints them but no fill schema offers the field, so the slot prints one of the modal role’s effects.',
  },
  // Black
  removalSmallConditional: {
    cardKind: 'instant',
    effectKinds: ['destroyPermanent'],
    substitution: 'DSL v0 has no power/toughness conditions on removal; the slot prints it unconditional.',
  },
  cardDrawAtCost: {
    cardKind: 'sorcery',
    effectKinds: ['drawCards'],
    substitution: 'DSL v0 has no life payment; the drawback is priced into the mana cost instead.',
  },
  discard: {
    cardKind: 'sorcery',
    effectKinds: ['millCards'],
    substitution:
      'the discard primitives are hand-authored only; the slot attacks the library instead of the hand.',
  },
  removalUnconditional: { cardKind: 'sorcery', effectKinds: ['destroyPermanent'] },
  removalOvercosted: {
    cardKind: 'instant',
    effectKinds: ['destroyPermanent'],
    manaValue: { min: 4, max: 5 },
  },
  // Red
  burnTwo: { cardKind: 'instant', effectKinds: ['dealDamage'], manaValue: { min: 1, max: 2 } },
  cardDrawImpulsive: {
    cardKind: 'sorcery',
    effectKinds: ['drawCards'],
    substitution:
      'DSL v0 has no exile-and-play-this-turn; the slot prints plain draw, a tertiary red effect.',
  },
  artifactDestructionModal: {
    cardKind: 'instant',
    effectKinds: ['dealDamage'],
    substitution: 'DSL v0 cannot target artifacts; the modal answer collapses to direct damage.',
  },
  burnFour: { cardKind: 'sorcery', effectKinds: ['dealDamage'], manaValue: { min: 3, max: 4 } },
  burnSixForFive: { cardKind: 'sorcery', effectKinds: ['dealDamage'], manaValue: { min: 5, max: 5 } },
  // Green
  fight: {
    cardKind: 'instant',
    effectKinds: ['pumpUntilEndOfTurn'],
    substitution: 'DSL v0 has no fight; the slot prints the pump half of the trick.',
  },
  bite: {
    cardKind: 'instant',
    effectKinds: ['pumpUntilEndOfTurn'],
    substitution: 'DSL v0 has no one-sided fight; the slot prints a pump trick instead.',
  },
  combatTrickPump: { cardKind: 'instant', effectKinds: ['pumpUntilEndOfTurn'] },
  manaAcceleration: {
    cardKind: 'sorcery',
    effectKinds: ['createToken'],
    substitution: 'DSL v0 has no mana abilities; the ramp slot prints a body instead.',
  },
  dig: { cardKind: 'sorcery', effectKinds: ['drawCards'] },
  // Colorless
  removalExpensive: {
    cardKind: 'sorcery',
    effectKinds: ['destroyPermanent'],
    manaValue: { min: 4, max: 5 },
    substitution:
      'The generator has no artifact role: a permanent prints its effects inside an ability and this slot states an effect list, so the colourless removal slot cannot be an artifact that destroys a creature as it arrives; it prints an expensive colourless sorcery instead.',
  },
  // Enchantments and planeswalkers (mtg-fv5s). None of these appears in the
  // published skeleton's slot lists, so none is default-reachable: a brief
  // states one in `spellRoles` or the set prints none. Colored pools only, and
  // `briefSchema` refuses them in the colorless pool for a mechanical reason -
  // `colorlessPermanentSlots` reads "no effect kinds" as "print a vanilla
  // artifact", so an Aura role seated there would silently come back an artifact.
  //
  // Six Aura roles rather than one, because an Aura's whole design is its
  // clause and a single role would print the same clause in five colors. Each
  // names a different pair of modifications, so the set's Auras differ by what
  // they do rather than by their numbers - the same argument `<equip>` makes at
  // the bomb tier about four weapons that are one weapon.
  auraPacify: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['cantAttack', 'cantBlock'],
    manaValue: { min: 1, max: 3 },
  },
  auraEvasion: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['cantBeBlocked', 'grantKeyword'],
    manaValue: { min: 1, max: 3 },
  },
  auraWeaken: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['statBonus'],
    manaValue: { min: 1, max: 3 },
  },
  auraFury: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['statBonus', 'grantKeyword'],
    manaValue: { min: 1, max: 3 },
  },
  auraGrowth: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['statBonus', 'grantLandwalk'],
    manaValue: { min: 2, max: 4 },
  },
  // The one Aura role that answers a creature by taking it. It names one
  // modification where every sibling names two, and that is the design rather
  // than an omission: `gainControl` already does what a whole card does, and a
  // clause beside it would be a second card riding along on the strongest
  // effect in the vocabulary.
  //
  // Four to six mana, read off the printed cards - Mind Control is five and
  // Confiscate is six, against Pacifism at two. A control Aura is a bomb in
  // Limited and the mana value is the only thing holding it to the top of the
  // curve, because `auraControlMultiple` prices the clause at two removal
  // spells and nothing about the card gets cheaper than that.
  auraDominate: {
    cardKind: 'enchantment',
    effectKinds: [],
    auraModifications: ['gainControl'],
    manaValue: { min: 4, max: 6 },
  },
  // The enchantment that enchants nothing: it sits on the battlefield and
  // changes every creature its controller has. `static` is the whole role -
  // a `group` scope with a stat bonus or a granted keyword is an anthem, and an
  // anthem is what makes a 3/3 for three worth playing, which is the ask this
  // role exists to answer.
  anthem: {
    cardKind: 'enchantment',
    effectKinds: [],
    abilityKinds: ['static'],
    manaValue: { min: 2, max: 4 },
  },
  // A walker's mana window is the paper one: below three it outruns the removal
  // a Limited deck has, and above five it is a card nobody casts before the game
  // is decided. The ability count is `checkAbilities`' (at most three on a
  // walker) and the loyalty numbers are the model's inside `LoyaltyCostSchema`.
  planeswalker: {
    cardKind: 'planeswalker',
    effectKinds: LOYALTY_EFFECT_KINDS,
    abilityKinds: ['activated'],
    manaValue: { min: 3, max: 5 },
  },
  // The three roles `mtg-q5yg` added, one per primitive it promoted. Like the
  // enchantment and walker roles above, none appears in the published
  // skeleton's slot lists, so a brief states one or the set prints none.
  //
  // They are new roles rather than corrections to the three canon roles whose
  // substitution notes these primitives make obsolete (`removalExile`,
  // `libraryTopBottom`, and the reanimation the black list has never had). The
  // reason is the one the header gives at length: a substitution note is
  // printed verbatim into the fill prompt and hashed into every fixture key of
  // every batch that held the role, so correcting `removalExile` in place costs
  // 5 recorded fixtures and a paid run to get them back. A new name costs
  // nothing, because no recorded batch ever saw it.
  //
  // `libraryTopBottom` was the exception and `mtg-vl7k` took it: no recorded
  // file holds that role, so its note was deleted and the slot now prints the
  // `scry` this role stands in for. `scryCantrip` stays, because the two are
  // reached differently — one by position in the published blue common list,
  // one by a brief stating it — and because collapsing them is a design call
  // rather than a correction.
  //
  // Each also answers a specific note in the design feedback these roles were
  // read out of, and the notes disagree with each other, which is why the
  // windows below are as tight as they are.
  exileRemoval: {
    cardKind: 'sorcery',
    effectKinds: ['exileTarget'],
    // Exile is strictly stronger than destroy and the feedback's standing
    // complaint is that this set's removal is already too strong, so the role
    // buys the upgrade back in mana and in speed: a sorcery, and never the
    // two-mana answer that makes a creature deck unplayable. `removalExpensive`
    // is the same argument one primitive weaker and sits at 4-5.
    manaValue: { min: 3, max: 5 },
  },
  scryCantrip: {
    cardKind: 'instant',
    // Both kinds rather than `scry` alone, and the pairing is load-bearing in
    // two directions. Design: a card whose whole text is "scry 2" is a card
    // nobody drafts, and Opt and Preordain are the shapes this role is named
    // after. Measurement: `@mtg/deckbuild`'s `EFFECT_PRICING` prices scry at
    // zero, because what a look at the top of the library is worth depends on
    // the deck under it and on the draws after it, neither of which a
    // single-card evaluator holds. So a scry-only card would score its mana
    // cost against nothing and be cut from every deck built out of the set,
    // and the slot would have spent a common on a card the format never sees.
    //
    // Both primitives are in `BATTLEFIELD_INERT_EFFECTS`, so a brief that states
    // this role fifteen times does not get fifteen cantrips: the archetype pass
    // converts every slot past the color's blank budget into a body and says so
    // in a note per slot. Measured on the test brief at 250 cards, white and
    // green keep one each and blue keeps none, because blue's own common list
    // already spends its allowance on `counterspell`, `cantrip` and `dig`. That
    // is the guard working rather than the role failing — a cantrip really does
    // leave the board where it found it — but it means the way to print several
    // is to state the role in several colors, not several times in one.
    effectKinds: ['drawCards', 'scry'],
    manaValue: { min: 1, max: 2 },
  },
  massReanimation: {
    cardKind: 'sorcery',
    effectKinds: ['returnFromGraveyard'],
    // The primitive has no single-card form — its only scope is a whole
    // graveyard — so this role is a top-end sorcery or it is a mistake. The
    // window is where a paper mass reanimation sits, and the reason is the
    // same one that puts it there: a game reaches five or six mana with
    // graveyards worth emptying, and reaches three with nothing in them.
    //
    // Blue is the one color that cannot state it: the color-pie row makes
    // reanimation white and black primary, red and green secondary, and blue
    // off-pie, so `allowedEffectKinds` throws on a blue slot rather than
    // printing a card the pie check would fail on the way back.
    manaValue: { min: 5, max: 6 },
  },
};

/** Roles whose card is a permanent the pool's spell slots print. */
export function isSpellPermanentRole(role: string): boolean {
  const kind = ROLE_PROFILES[role]?.cardKind;
  return kind === 'enchantment' || kind === 'planeswalker';
}

/**
 * True when the role's slot may print an effect only the wider model union
 * carries, which is the whole of what makes it a colored-pool role.
 *
 * Derived from the profile's own vocabulary rather than a list of three names,
 * so a fourth role that reaches a zone is classified by what it prints. The
 * subtraction is `filled.ts`'s `ZONE_REACHING_ONLY_EFFECT_KINDS` asked one
 * layer earlier: there it decides which schema a batch is shown, here it
 * decides which pool may state the role at all, and both have to agree or a
 * brief passes validation and then throws at fill time.
 */
export function isZoneReachingRole(role: string): boolean {
  const shown: readonly EffectKind[] = MODEL_EFFECT_KINDS;
  return (ROLE_PROFILES[role]?.effectKinds ?? []).some((kind) => !shown.includes(kind));
}

/**
 * The one role whose card is a planeswalker.
 *
 * Named rather than derived from a rarity field on the profile, because the
 * constraint it serves is the brief's rather than the allocator's: a walker is a
 * rare in every set this generator has a skeleton for, and `briefSchema` refuses
 * one stated at common or uncommon. The profile table says what a role prints;
 * where it may be printed is a policy about the tier, and it is written where
 * the tier is stated.
 */
export function isPlaneswalkerRole(role: string): boolean {
  return ROLE_PROFILES[role]?.cardKind === 'planeswalker';
}

/**
 * The Aura modifications this role's slot may print, empty on every other role.
 *
 * A function rather than a field read, for the reason `allowedEffectKinds` is
 * one: the allocator asks a question about a role and gets an answer it can put
 * straight on a slot, and a role with no entry answers the same empty list a
 * role with no `auraModifications` does.
 */
export function roleAuraModifications(role: string): readonly ModelAuraModificationKind[] {
  return ROLE_PROFILES[role]?.auraModifications ?? [];
}

/** The ability kinds this role's slot must print, empty on every other role. */
export function roleAbilityKinds(role: string): readonly AbilityKind[] {
  return ROLE_PROFILES[role]?.abilityKinds ?? [];
}

/**
 * The colorless roles that print a permanent rather than a spell.
 *
 * `ROLE_PROFILES` is the effect table, and the published profile's colorless
 * slots deliberately fall outside it: `colorlessPermanentSlots` reads a missing
 * entry as "print an artifact with no effect list", which is how the gear slots
 * stay free of one. So the set of role names a brief may legally state is
 * wider than the table by exactly these, and they are read off the profile
 * document rather than typed out here — a profile that renames its artifact
 * slots renames what a brief may ask for, in one place.
 */
export const ARTIFACT_ROLES: readonly string[] = PLAY_BOOSTER_2024.data.colorless.common.spellSlots.filter(
  (role) => ROLE_PROFILES[role] === undefined,
);

/** Every role name the allocator can seat: the effect table plus the gear slots. */
export const SPELL_ROLE_NAMES: readonly string[] = [...Object.keys(ROLE_PROFILES), ...ARTIFACT_ROLES];

export function isSpellRole(role: string): boolean {
  return SPELL_ROLE_NAMES.includes(role);
}

export class UnknownRoleError extends Error {
  constructor(readonly role: string) {
    super(
      `spell role "${role}" has no profile in ROLE_PROFILES, so no effect primitive can be assigned. ` +
        'Add it to packages/setgen/src/roles.ts with an explicit substitution note.',
    );
    this.name = 'UnknownRoleError';
  }
}

export function roleProfile(role: string): RoleProfile {
  const profile = ROLE_PROFILES[role];
  if (profile === undefined) throw new UnknownRoleError(role);
  return profile;
}

/**
 * The effect primitives a slot may actually use: the role's list minus anything
 * the color pie rules off-pie for that color. Off-pie is a design error, so it
 * is removed by construction rather than generated and then rejected; tertiary
 * placements survive here and are budgeted at set level.
 */
export function allowedEffectKinds(role: string, color: Color): readonly EffectKind[] {
  const profile = roleProfile(role);
  const allowed = profile.effectKinds.filter((kind) => classify(kind, color).verdict !== 'fail');
  if (allowed.length === 0) {
    throw new Error(
      `role "${role}" has no on-pie effect primitive in ${color}: ` +
        `[${profile.effectKinds.join(', ')}] are all off-pie there. Fix the role table or the skeleton.`,
    );
  }
  return allowed;
}

/**
 * The effect primitives a *colorless* slot may print.
 *
 * The mechanical color pie is a color table, so it has nothing to say about a
 * colorless card: the skeleton role is the whole authority here. Roles with no
 * profile print nothing, which is how the vanilla artifact slots stay vanilla.
 */
export function colorlessEffectKinds(role: string): readonly EffectKind[] {
  return ROLE_PROFILES[role]?.effectKinds ?? [];
}

/** Substitution notes for the roles a set actually used, deduplicated and sorted. */
export function substitutionNotes(roles: readonly string[]): string[] {
  const notes = new Set<string>();
  for (const role of roles) {
    const profile = ROLE_PROFILES[role];
    if (profile?.substitution !== undefined) notes.add(`${role}: ${profile.substitution}`);
  }
  return [...notes].sort();
}
