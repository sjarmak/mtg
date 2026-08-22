/**
 * The set brief: what a human asks for, validated at the boundary.
 *
 * "Desired mechanics" are the input the whole lab is organized around, so they
 * are structured rather than prose: a mechanic names the pinned vocabulary it
 * uses (keywords, effect kinds) and the colors it lives in. That structure is
 * what lets the allocator bias the skeleton toward the request *before* any
 * model call, and what lets the validators assert afterwards that the mechanic
 * actually made it into the set at common (prior-art set-design section 11,
 * failure mode 8: "theme absent at common").
 *
 * Mechanic count is capped at 3-6 per Nuts & Bolts #18.
 */
import { z } from 'zod';
import type { Color } from '@mtg/dsl';
import {
  AbilityKindSchema,
  CardSchema,
  ColorSchema,
  CounterKindSchema,
  EffectKindSchema,
  KeywordSchema,
  ModelTriggerConditionSchema,
  PERMANENT_CARD_KINDS,
  RaritySchema,
  SET_CODE_PATTERN,
  SUBTYPE_PATTERN,
} from '@mtg/dsl';
import {
  ColorPieSubjectSchema,
  DEFAULT_SLICE_TARGET_SIZE,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import { CARD_NAME_MAX_LENGTH } from './filled';
import {
  isPlaneswalkerRole,
  isSpellPermanentRole,
  isSpellRole,
  isZoneReachingRole,
  SPELL_ROLE_NAMES,
} from './roles';

export const DesiredMechanicSchema = z.object({
  /** Short label used in prompts, reports and mechanic-coverage checks. */
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(300),
  /** Slice keywords this mechanic is expressed with; may be empty. */
  keywords: z.array(KeywordSchema).max(4).default([]),
  /** Slice effect kinds this mechanic is expressed with; may be empty. */
  effectKinds: z.array(EffectKindSchema).max(4).default([]),
  /**
   * CR 113 ability kinds this mechanic is expressed with; may be empty.
   *
   * The third vocabulary a mechanic may name, and the one that makes a mechanic
   * more than a re-labeling of the nine evergreen keywords (`mtg-bc2.132.3`).
   * Naming a kind here is what makes the allocator reserve permanent slots for
   * it, what puts the ability schema in front of the model for those slots, and
   * what `checkMechanicCoverage` reads the finished set back against.
   *
   * `AbilityKindSchema`, not a copy of it: the DSL's own tuple is the whole
   * vocabulary, so a brief cannot ask for a shape `abilitiesOver` has no member
   * for. Which effects the ability then uses is `effectKinds`' business and the
   * model's, exactly as it is for a spell.
   */
  abilityKinds: z.array(AbilityKindSchema).max(3).default([]),
  /**
   * CR 603 conditions this mechanic's triggers watch for; may be empty.
   *
   * The fourth vocabulary, and it exists because it was the one design axis the
   * brief could only hint at. Every other axis a brief cares about is stated,
   * reserved, printed on the slot line and read back: keywords, effect kinds,
   * ability kinds, a required card's name, its equipment, its part counter, its
   * sacrifice subtype. A trigger's *condition* was none of those. A brief said
   * `abilityKinds: ["triggered"]` and the condition was then whatever the model
   * inferred from the mechanic's prose, which is a judgment made on evidence
   * nobody stated.
   *
   * That is `mtg-itf`: the flagship set's two mechanics both describe a
   * permanent dying, so fifteen of its twenty-one triggered slots are told to
   * print a mechanic about dying and duly do, and the six that name no mechanic
   * follow the set's prevailing flavor. `selfEnters` was never absent from the
   * DSL, the model's schema or the fill prompt's own condition list - it was
   * unaskable. Naming it here is how a brief asks.
   *
   * Empty is the default and the state of every brief in this tree, which is
   * what keeps the prompt bytes - and so every recorded fixture key - exactly
   * where they were.
   */
  triggerConditions: z.array(ModelTriggerConditionSchema).max(3).default([]),
  /** Colors the mechanic lives in. Empty means "any color". */
  colors: z.array(ColorSchema).max(5).default([]),
});

export type DesiredMechanic = z.infer<typeof DesiredMechanicSchema>;

/**
 * The pools a required card may ask for: the five colors, or the colorless one.
 *
 * `@mtg/dsl`'s `ColorSchema` has five members and no colorless, because a card's
 * colors are the colored pips in its cost and a colorless card has none. A
 * *slot* pool is a different thing: the allocator builds five colored pools plus
 * a colorless one, and `Slot.color` is `Color | null` for exactly that reason.
 * So the pool a required card asks for is setgen's own input vocabulary rather
 * than the DSL's color list, and `'colorless'` is the word for `null`.
 *
 * Without it the one category the flagship list most needs to pin is the one it
 * cannot express: the set design document, decision 5 ends "Marquee
 * gear is colorless", and the marquee gear is Moonblade, Vantan Shield,
 * Scimitar of the Dunes, Boulder Breaker, Ancient Blade, the Savage Direhorn Bow.
 */
export const RequiredPoolSchema = z.union([ColorSchema, z.literal('colorless')]);

export type RequiredPool = z.infer<typeof RequiredPoolSchema>;

/** The slot pool a stated required-card pool names: `null` is the colorless one. */
export function slotPoolFor(pool: RequiredPool): Color | null {
  return pool === 'colorless' ? null : pool;
}

/**
 * One line, and the reason is structural rather than tidy.
 *
 * A required card's words are printed into the fill prompt as lines of the
 * reserved slot's block, one for the name and one for the direction, and the
 * block is read back line by line. Free text carrying a line break stops
 * describing the card and starts writing prompt structure: a direction can end
 * its line and open a `name: exactly "..."` of its own, and what the slot is
 * told to print is then whichever line came last. The boundary is where that is
 * cheap to refuse, and refusing it is a structural check, not a judgment about
 * the words.
 */
const SINGLE_LINE = /^[^\r\n]*$/;
const SINGLE_LINE_MESSAGE = 'must be one line: it is printed as one line of the reserved slot prompt';

/**
 * Card kinds the allocator seats and every `FilledCardSchema` member can emit.
 *
 * This is intentionally frozen at the generator boundary rather than imported
 * from the engine's live `CardKindSchema`: the engine can grow hand-authored
 * kinds without silently making a brief commission a card no fill call can
 * return. Widen this tuple only with the allocator and every fill union.
 *
 * `enchantment` and `planeswalker` arrived that way in `mtg-fv5s`, together with
 * the roles that seat them and the three fill tiers that can return them. `land`
 * is still absent and is the standing example of why the tuple is frozen: the
 * DSL has had `LandCardSchema` for a long time and no fill union has a member
 * for one, so a brief that could require a land would commission a card every
 * run fails to deliver.
 */
const GENERATOR_CARD_KINDS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
] as const;
const GeneratorCardKindSchema = z.enum(GENERATOR_CARD_KINDS);

/**
 * A card the set must contain, named by the human.
 *
 * The name is the whole of the requirement, and everything else is optional on
 * purpose: a designer names cards long before deciding what any of them does
 * (the set design document, decision 1, "the list leads"). Stating a
 * pool, a card kind, a rarity or a mana value narrows which slot the card is
 * reserved in; stating none of them means any slot will do. What the card *is*,
 * its body, its effects, the reason it costs what it costs, is the model's
 * judgment and is never inferred here from the name.
 */

export const RequiredCardSchema = z
  .object({
    /** Printed exactly as written; the finished set is checked against it. */
    name: z
      .string()
      .min(1)
      .max(CARD_NAME_MAX_LENGTH)
      .regex(SINGLE_LINE, `a required card name ${SINGLE_LINE_MESSAGE}`),
    /** Reserve a slot in this pool. Omitted means any pool, colorless included. */
    color: RequiredPoolSchema.optional(),
    /** Reserve a slot of this kind. Omitted means any kind. */
    cardKind: GeneratorCardKindSchema.optional(),
    /**
     * Reserve a slot at this rarity. Omitted means any rarity.
     *
     * The vocabulary is `@mtg/dsl`'s `RARITIES`, which is wider than the tiers
     * the generator allocates: the skeleton builds commons and uncommons, so a
     * card stating `rare` is refused by name until `mtg-bc2.26.4` gives the
     * generator that tier. That is deliberate. The list is written before the
     * generator can build it, and a designer who cannot write down the rarity
     * she means has to keep it somewhere the code will never check.
     *
     * Mythic is `mtg-bc2.26.8` and needs two words added, neither of them here:
     * one in `RARITIES`, which is what a brief may say, and one in
     * `SLICE_RARITIES`, which is what the skeleton allocates and what
     * `required-demand.ts` settles per tier. This schema names no rarity at all,
     * so it takes the first the day it lands.
     */
    rarity: RaritySchema.optional(),
    /**
     * Reserve a slot whose cost window covers this mana value; the reservation
     * then narrows that window onto it, so the printed card costs it exactly.
     * Omitted means any cost.
     *
     * A number rather than a window, because the sentence the list is written in
     * is "Moonblade is a mythic four-drop". The slot already carries a
     * window - the skeleton's curve bucket - and the pin is the point inside it,
     * so two windows never have to be intersected and no card can satisfy the
     * brief while missing the number the brief stated.
     *
     * No ceiling: the DSL puts none on a mana cost, and a value the skeleton's
     * curve never allocated is refused by name with the card in the message,
     * which says more than a bound guessed at this boundary would.
     */
    manaValue: z.int().min(0).optional(),
    /** One line of direction, handed to the model with the name. */
    flavorDirection: z
      .string()
      .min(1)
      .max(200)
      .regex(SINGLE_LINE, `a required card flavor direction ${SINGLE_LINE_MESSAGE}`)
      .optional(),
    /**
     * This card is Equipment: it carries the `Equipment` subtype and prints CR
     * 702.6b's equip clause.
     *
     * The one place a brief says anything about what a card *does*, and it is
     * not an exception to the rule above it — it is structural rather than
     * design. Which cards are the weapons is the list, and the list leads
     * (the set design document, decision 1); what a weapon costs to
     * equip and what being equipped is worth are the model's judgment, exactly
     * as a creature's body is. So this is a flag and never a number, and the
     * generator offers the clause without filling any part of it.
     *
     * It exists as a flag rather than being inferred from the name or the flavor
     * direction because inferring it would be the generator reading English for
     * meaning, which is the one thing this package does not do. Decision 12
     * bounds it: attachment is for the named weapons, roughly eight cards, so
     * the brief naming them one at a time is the whole support structure the set
     * gets.
     *
     * Setting it does three things, all of them mechanical. The reserved slot is
     * allocated `activated`, so the batch is shown an ability schema and told
     * what an ability is. The batch is shown the third fill schema, the only one
     * whose artifact member carries the `attach` field. And the prompt gains the
     * equip section, which is the only place the model is told the clause
     * exists.
     */
    equipment: z.boolean().default(false),
    /**
     * Whether this card is a unique named thing, and so prints `legendary`.
     *
     * Declared here rather than asked of the model, because it is not a design
     * judgment the model is better placed to make: the brief already names this
     * card by name, and whether that name is one individual or a kind of
     * creature is a fact about the source the brief is drawn from.
     *
     * It reaches the card through `assemble.ts`, which stamped `supertypes: []`
     * on every generated card unconditionally — so before this field the
     * generator could not emit a legendary card at all, and a set built out of
     * named legends printed none. `packages/kernel/src/sba.ts` enforces the
     * legend rule (CR 704.5j), which was unreachable from any generated set.
     *
     * Deliberately not in `requiredLines`: the prompt never mentions it, so a
     * fixture key is unchanged and every recorded run keeps replaying.
     */
    legendary: z.boolean().default(false),
    /**
     * This card puts a part into play: a token whose only ability is Fuse,
     * placing the counter kind named here.
     *
     * The counter is the brief's to name rather than the model's, and that is
     * the same line `equipment` draws one field up. Which parts a set has is
     * decision 8 of the set design document — a Silver Direhorn leaves
     * a Trophy Horn — and a counter kind is not free text: `COUNTER_DECLARATIONS`
     * says what carrying one does, in layers the kernel already resolves, so a
     * counter the table has never heard of is a card that means nothing. What
     * stays the model's is everything a part costs and is called: the Fuse mana
     * cost, the token's name, its colors and its subtypes.
     *
     * How the part arrives depends on what else the card states. A card that
     * names only this drops its part when it dies, which is the Monster half of
     * the mechanic; a card that also names `sacrificeSubtype` is a Chest, and
     * yields its part when it opens. `required.ts` allocates the ability kind
     * from that pair and nothing infers it from the name.
     */
    partCounter: CounterKindSchema.optional(),
    /**
     * This card's activated ability is paid for by sacrificing permanents of
     * this subtype: a Chest opens by eating Keys.
     *
     * `ActivationCost.sacrificeOther` exists and the kernel pays it, and the
     * generator could not reach it for one stated reason — a cost naming a
     * subtype is only payable on a board that supplies one, and which subtypes a
     * set supplies is a question about the whole set while this package fills
     * slots one at a time. This field is the answer rather than a way around it.
     * The brief is the only document that is about the whole set, so the brief
     * is where the subtype is named; `checkSacrificeSupply` then fails a set
     * whose cards create no such permanent, so the answer is checked rather than
     * asserted, and a Chest in a set whose Monsters drop no Keys is a finding
     * rather than a card that never activates.
     *
     * How many is the model's, because how many is the price. The subtype is
     * not, for the reason above.
     */
    sacrificeSubtype: z
      .string()
      .regex(SUBTYPE_PATTERN, 'a required card sacrifice subtype must be a legal DSL subtype')
      .optional(),
    /**
     * This card puts permanents of this subtype into play: a small Monster
     * drops Keys.
     *
     * The other half of `sacrificeSubtype`, and it is a separate field rather
     * than something inferred because it is a separate card. Without it the
     * set-wide check has nothing to converge on: `checkSacrificeSupply` would
     * fail a set whose Chests eat a permanent nothing creates, blame the Chest,
     * and regenerating the Chest would not produce a Key. Naming the supplier
     * puts the blame on the slot that can fix it and makes the economy the
     * brief's statement rather than a hope about what the model happens to
     * print.
     *
     * The subtype is the brief's for the same reason the sacrifice's is. What
     * the token is called, how many arrive and what else the card does are the
     * model's.
     */
    suppliesSubtype: z
      .string()
      .regex(SUBTYPE_PATTERN, 'a required card supplied subtype must be a legal DSL subtype')
      .optional(),
  })
  .refine((card) => card.name.trim().length > 0, {
    message: 'a required card name must not be blank',
  })
  .refine((card) => !card.legendary || (card.cardKind !== 'instant' && card.cardKind !== 'sorcery'), {
    message:
      'a required card marked legendary must not be an instant or sorcery here: the legend rule (CR 704.5j) is a state-based action over permanents, so a legendary spell would print a supertype nothing in this kernel acts on',
  })
  .refine((card) => !card.equipment || card.cardKind === 'artifact', {
    message:
      'a required card marked equipment must state cardKind "artifact": CR 301.5 an Equipment is an artifact, and checkEquipAbility refuses a card whose type line disagrees with its printed clause',
  })
  .refine(
    (card) =>
      card.partCounter === undefined ||
      (card.cardKind !== undefined && PERMANENT_CARD_KINDS.includes(card.cardKind)),
    {
      message:
        'a required card that drops a part must state a permanent cardKind: a part arrives from a printed ability, and only a permanent carries one',
    },
  )
  .refine(
    (card) =>
      card.sacrificeSubtype === undefined ||
      (card.cardKind !== undefined && PERMANENT_CARD_KINDS.includes(card.cardKind)),
    {
      message:
        'a required card that sacrifices a named subtype must state a permanent cardKind: the cost belongs to an activated ability, and only a permanent carries one',
    },
  )
  .refine(
    (card) =>
      card.suppliesSubtype === undefined ||
      (card.cardKind !== undefined && PERMANENT_CARD_KINDS.includes(card.cardKind)),
    {
      message:
        'a required card that supplies a named subtype must state a permanent cardKind: the token arrives from a printed ability, and only a permanent carries one',
    },
  )
  .refine((card) => !(card.equipment && card.sacrificeSubtype !== undefined), {
    message:
      'a required card cannot be both a weapon and a card that eats a named subtype: an equip ability prints no effect, so it has nothing to spend the sacrifice on',
  });

export type RequiredCard = z.infer<typeof RequiredCardSchema>;
export type RequiredCardInput = z.input<typeof RequiredCardSchema>;

/**
 * The spell roles one tier of one pool prints, stated by the person writing the
 * set.
 *
 * # Why this is a brief field and not a profile inference
 *
 * A group's spell roles come from `cycleRoles(profile.spellSlots, spells)`,
 * which takes the *first* N names off the color's list. That list is a common
 * list — the published profile has no rare slot table at all, and
 * `skeleton-lite.ts` says so in its own INFERRED note — so a tier that prints
 * one spell prints whatever a common pool leads with. At 250 cards that handed
 * the rare tier a two-mana burn spell, a combat trick and three conditional
 * removal spells: the cheap staples, in the tier a set is allowed to print a
 * card that wins the game on its own at (`mtg-j3bp`).
 *
 * Ordering 27 role names by power is design judgment. Writing that order into
 * the profile would publish 27 ratings as though the article stated them, and
 * deriving it in code from a role's name or its mana value is the heuristic ZFC
 * delegates. So the judgment stays with the author, next to the theme and the
 * card list she already writes, and code keeps what code is for: validating the
 * names, cycling them over the slots the skeleton allocated, and saying in the
 * report what it did.
 *
 * # What a stated tier does and does not move
 *
 * It replaces the roles and nothing else. The group's card count, its creature
 * share, its curve, its keyword budget and the pool's rarity split are the
 * profile's, exactly as they were. The pass runs *before* archetype reservation,
 * required-card settlement and answer reservation, so a stated role is subject
 * to every rule those passes enforce rather than exempt from them — an
 * inert-only role still counts against the color's inert budget and can still be
 * converted to a body, and a required card can still buy the slot. A brief that
 * states nothing allocates byte for byte as it did before this field existed,
 * which every other brief and every recorded run depends on.
 *
 * # What makes a role rare-shaped, mechanically
 *
 * Four of the DSL's effect primitives carry no number at all — destroy, counter,
 * tap and bounce — which is why `separateParameterlessSlots` exists, and it
 * means a rare built on one of them can be more expensive than a common but
 * never bigger. Two more, draw and mill, are battlefield-inert and capped at one
 * card per color by `reserveArchetypes`, so a rare built on those is converted
 * to a creature before it is printed. What is left that a rare can be *larger*
 * at is damage, pump and tokens. That is a fact about this engine's enforceable
 * space, not a taste, and it is the reason a brief's rare list is short.
 */
export const TierSpellRolesSchema = z.object({
  /** The tier these roles are for; the skeleton builds three. */
  rarity: z.enum(SLICE_RARITIES),
  /** The pool these roles are for, in the same vocabulary a required card uses. */
  pool: RequiredPoolSchema,
  /**
   * The roles, cycled over however many spell slots the tier allocated. Stating
   * fewer than the tier holds repeats them; stating more truncates, and the
   * truncation is reported twice rather than swallowed - the allocator's note
   * names the roles that did not fit, and `checkStatedRoles` raises a
   * `STATED_ROLE_UNPRINTED` warning against the finished set for any stated role
   * it does not print, whichever pass ended up spending the slot.
   */
  roles: z
    .array(
      z.string().refine(isSpellRole, {
        error: (issue) =>
          `unknown spell role ${JSON.stringify(issue.input)}: the allocator can seat ${SPELL_ROLE_NAMES.join(', ')}`,
      }),
    )
    .min(1)
    .max(8),
  /**
   * Why this tier prints these roles, in one line, printed into the generation
   * report beside the allocation it caused.
   *
   * Required rather than optional. A list of role names with no argument is a
   * decision nobody can review and the next lane deletes it; the argument is the
   * part of this field that is worth keeping.
   */
  why: z
    .string()
    .min(1)
    .max(200)
    .regex(SINGLE_LINE, 'a stated spell-role reason must be one line: it is printed as one report line'),
});

export type TierSpellRoles = z.infer<typeof TierSpellRolesSchema>;

/** Case-insensitive, whitespace-insensitive: the key two names collide on. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * One color's signature: the subjects this set decides that color does not
 * print.
 *
 * Policy, not code. The mechanical color pie in `@mtg/design-data` is the
 * default and rules every set; this is the narrower statement a *set* makes on
 * top of it — real Magic lets red draw cards, and a set may still decide that
 * red's card draw is nobody's. `validate/signature.ts` enforces it and decides
 * nothing.
 *
 * Only `absent` is stated, because absence is the only half a gate can check.
 * "Primary" and "secondary" are instructions for writing the set, and a set that
 * prints one fewer white lifegain common than it meant to is not a set anything
 * should refuse.
 */
export const ColorSignatureSchema = z.object({
  color: ColorSchema,
  /**
   * Keywords and effect kinds this color does not print in this set. The
   * subject vocabulary is the color pie's own, so a signature cannot name a
   * word the pie has no row for and quietly check nothing.
   */
  absent: z.array(ColorPieSubjectSchema).max(24).default([]),
});

export type ColorSignature = z.infer<typeof ColorSignatureSchema>;

export const SetBriefSchema = z
  .object({
    setCode: z.string().regex(SET_CODE_PATTERN, 'set code must be 3-5 uppercase alphanumerics'),
    setName: z.string().min(1).max(60),
    /** Flavor and world premise, handed to the model verbatim. */
    theme: z.string().min(1).max(600),
    mechanics: z.array(DesiredMechanicSchema).min(1).max(6),
    /** Free-form archetype intents, one line each, passed to the model. */
    archetypeNotes: z.array(z.string().min(1).max(200)).max(10).default([]),
    /**
     * Cards this set must contain, by name. Empty is the ordinary case: the
     * generator names every card itself unless the brief takes some of that
     * choice back.
     */
    requiredCards: z.array(RequiredCardSchema).default([]),
    /**
     * Finished cards the brief hands the pipeline, printed after the generated
     * ones. Empty is the ordinary case.
     *
     * A required card is a commission and this is a delivery. The distinction
     * exists because the generator's output space is deliberately *inside* the
     * engine's enforceable space and not equal to it, so there are cards the
     * kernel runs and the model may not write. Asking for one by name in
     * `requiredCards` gets a different card back. `authored.ts` has the whole
     * argument, including why these are appended rather than seated in a slot.
     *
     * The DSL's own card schema, not a copy: an authored card is a card, held
     * to the same legality the generated ones are held to, and nothing about it
     * is looser for having been typed by a human.
     *
     * The ceiling is a sanity guard and nothing more. It was written at 20 when
     * the flagship's list held four, and what actually limits the list is the
     * entry price: a card belongs here only because the generator cannot write
     * it, which is a claim about `ModelEffectSchema` and the recorded run's
     * answer tiers rather than about anybody's preference. The flagship has
     * four separate reasons to be over the original number (effect kinds
     * outside the model's union, targets outside it, the card kinds no tier
     * the 2026-08-14 run was shown could print, meaning Auras and
     * planeswalkers, and effect kinds that are legal only on a creature's own
     * body, which no role's shape can promise), so the bound moved to 30
     * rather than the list being trimmed to fit it. It stays a bound, because
     * a brief that authors a booster's worth of cards has stopped being a
     * brief.
     *
     * It moved again, to 32, for a fifth reason of the same kind rather than a
     * new one: `TargetRestriction`'s `withCounter` and `putCounters`' `scope`
     * are both outside `ModelEffectSchema` and `ModelTargetSpecSchema`, so a
     * card that reads a counter, or that puts one on each creature a named
     * player controls, is a card the generator has no way to write. The
     * flagship's gloom theme minted counters on six cards and printed nothing
     * that read one; the four cards that close that loop are all in this list
     * because none of them could be anywhere else.
     *
     * At 96 the entry price is no longer one claim but two, and the second is
     * weaker on purpose. The first 32 are here because the generator *cannot*
     * write them. The 60 after them are here because it *did not*: they answer
     * a review of the finished set, and a review answer lands one of two ways -
     * rewrite a generated card, or append a new one. The pass before this one
     * rewrote 61 cards, which is right when the card under review is the
     * problem. These sixty are effect families the set never had rather than
     * cards it got wrong - counter-magic, untaps, instant-speed keyword grants,
     * arrival-count payoffs, lifegain payoffs and graveyard recursion - and a
     * family with no card in it has no card to rewrite into it. Appending also
     * costs the run nothing, which is the same reason authored cards are
     * appended rather than seated at all.
     *
     * So the sentence this docblock used to end on - that a brief authoring a
     * booster's worth of cards has stopped being a brief - is retired rather
     * than quietly broken. What is true instead: this file describes one
     * generated run and carries every hand-written card the set has taken
     * since, and the bound exists so that list stays reviewable in one sitting.
     * `mtg-x6xi` records the cost of saying it this way, which is that one
     * field now has two reasons to change.
     *
     * 112 raises it once more on the second reason rather than a third one, and
     * the measurement is what makes the raise specific. Censusing every effect
     * in the 344-card set counted seven of the DSL's primitives on zero cards -
     * `exileGraveyard`, `millCards`, `putOnLibrary`, `preventAllDamageToTarget`,
     * `revealTopCards`, `setLife`, `shuffleLibrary` - and seven more on one or
     * two. That census is the measurable form of the review note this pass is
     * answering, which was that the set's spells are destroy, pump, bounce and
     * tap and little else. Ten cards land the families that carry a playable
     * card on their own, and the loudest of them is not a missing family but a
     * missing pair: ten cards in the set pick a card out of a graveyard and
     * nothing in the set put one there. The room left over is deliberate. A
     * family with no card in it still has no card to rewrite into, so the next
     * review answer will want the same appending this one did.
     *
     * 121 is that next answer, and it names two holes the effect census could
     * not see, because both are the absence of a card rather than of an effect.
     * The 352-card set printed thirteen artifacts, six of them Equipment, and
     * not one of them made mana: `addMana` was on two cards, a green creature
     * and a green instant, so a deck in this set ramps in one color or not at
     * all. It also printed three planeswalkers and no card anywhere in it that
     * so much as names one, so a permanent type the set prints is a permanent
     * type it cannot answer. Seven of the sixteen close the first hole - rocks
     * at common, uncommon and rare, two payoffs that make building around
     * artifacts a plan rather than a hope, and `Trisigil of Wisdom`, which the
     * set had been printing two thirds of a cycle without. The other nine close
     * the second and the rest of the review note, which asked for things a
     * player may do on an opponent's turn that are not destroy, pump, bounce or
     * tap: `statBonusPer`, `cantBeBlockedThisTurn` and `attacksYouThisTurnIfAble`
     * get their first card in this set, and `preventAllDamageToTarget` its
     * second.
     *
     * So this is the appending the paragraph above predicted, at about the size
     * it predicted. The bound moves to exactly where the list ends this time
     * instead of leaving room ahead of it, which is a deliberate reversal of
     * that paragraph's last decision: the room is what let this pass append
     * sixteen cards without anyone reading the argument for the previous
     * sixteen, and a raise that has to be typed is a raise that has to be
     * argued. The one after this should arrive the way this one did, with a
     * census and a named hole.
     *
     * 124 is that one, and its hole is the first no effect census could have
     * found, because it is the absence of a *condition* rather than of an
     * effect. `TargetFilter.combat` has been in the DSL, the kernel, the oracle
     * printer and the simulator's cast policy the whole time, and across all
     * 368 cards of the set it is printed zero times. So every removal spell in
     * this set answers every creature at every moment: nothing rewards holding
     * one up for the attack, nothing costs a player who taps out, and the
     * 3/3-for-three the review note asked to make playable trades against
     * exactly the card the 6/6 does. `docs/research/interaction-levers.md` is
     * the census and `mtg-85d4` carries it. Three commons close it - one exile,
     * one damage, one bounce - each priced about a mana under the unconditional
     * spell it narrows, and each pairing the combat filter with a power
     * restriction rather than standing on the filter alone. The white one
     * exiles rather than destroys because `colorSignatures` puts
     * `destroyPermanent` on white's absent list and this set tightened white's
     * removal onto exile long before these three; the signature gate caught the
     * first draft of it, which is that gate doing its job. The pairing with a
     * power restriction was insurance against a pricing gap `mtg-xiis` had
     * measured, that the evaluator read `effect.target.restriction` and never
     * `effect.target.filter`, so a filter-only card priced at full
     * unconditional value. That gap is closed: `targetNarrowingFactor` reads
     * both fields and takes the discount once when a target carries both, so
     * the third of these three stands on its filter alone and still prices
     * under the spell it narrows. The pairing is a design choice now rather
     * than a hedge.
     */
    authoredCards: z.array(CardSchema).max(124).default([]),
    /**
     * Spell roles this set states for a tier of a pool, instead of taking the
     * head of that color's common list. Empty is the ordinary case and allocates
     * exactly as it did before the field existed.
     *
     * Capped at one entry per tier per pool, which is what the uniqueness
     * refinement below enforces and what bounds the list at eighteen.
     */
    spellRoles: z
      .array(TierSpellRolesSchema)
      .max(SLICE_RARITIES.length * 6)
      .default([]),
    /**
     * Per-color signatures: what each color does not print in this set.
     *
     * Empty is the ordinary case and the state of every brief in this tree; an
     * empty list states nothing and the mechanical color pie remains the only
     * judge, exactly as it was before the field existed.
     */
    colorSignatures: z.array(ColorSignatureSchema).max(5).default([]),
    /** Same seed plus same brief gives the same allocation, forever. */
    seed: z.string().min(1).max(80),
    /**
     * Both bounds are the skeleton's: below the floor the uncommon pool cannot
     * give every color a card, and above the ceiling the derivation would be
     * extrapolating past the profile it apportions. Stating them here refuses a
     * size nothing could build at the field it was written in.
     */
    targetSize: z
      .int()
      .min(MIN_SLICE_TARGET_SIZE)
      .max(MAX_SLICE_TARGET_SIZE)
      .default(DEFAULT_SLICE_TARGET_SIZE),
    /**
     * How many cards may sit on a tertiary color-pie placement before the set
     * fails. Off-pie always fails; tertiary is budgeted (set-design section 10,
     * check 4). Defaults to 10% of the set, rounded up.
     */
    tertiaryBudget: z.int().min(0).optional(),
  })
  .refine((brief) => new Set(brief.mechanics.map((m) => m.name)).size === brief.mechanics.length, {
    message: 'mechanic names must be unique',
  })
  .refine(
    (brief) =>
      brief.mechanics.every((m) => m.keywords.length + m.effectKinds.length + m.abilityKinds.length > 0),
    {
      message:
        'every mechanic must name at least one keyword, effect kind or ability kind from the slice vocabulary',
    },
  )
  .refine(
    (brief) =>
      brief.mechanics.every((m) => m.triggerConditions.length === 0 || m.abilityKinds.includes('triggered')),
    {
      // A condition with no trigger to sit on reaches nothing: the allocator
      // hands it to a slot only alongside the ability kinds, and the prompt
      // prints it only on a slot whose ability line already says "triggered".
      // Refused at the boundary rather than dropped in silence, because a brief
      // that states a condition and gets none back is the failure this field
      // exists to end.
      message: 'a mechanic naming trigger conditions must also name "triggered" among its ability kinds',
    },
  )
  .superRefine((brief, ctx) => {
    const seen = new Map<string, string>();
    for (const card of brief.requiredCards) {
      const key = nameKey(card.name);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['requiredCards'],
          message: `required card named twice: "${card.name}" repeats "${earlier}"`,
        });
        continue;
      }
      seen.set(key, card.name);
    }
    // Two signatures for one color have no order between them, the same way
    // two spell-role statements for one tier do: refused where they are written.
    const colors = new Set<string>();
    for (const signature of brief.colorSignatures) {
      if (colors.has(signature.color)) {
        ctx.addIssue({
          code: 'custom',
          path: ['colorSignatures'],
          message: `color signature stated twice for ${signature.color}`,
        });
        continue;
      }
      colors.add(signature.color);
    }
    // Two statements about one tier of one pool have no order between them: the
    // pass would apply both and the last would win silently. Refused here so the
    // author sees the collision at the field she wrote it in.
    const tiers = new Set<string>();
    for (const stated of brief.spellRoles) {
      const key = `${stated.rarity}:${stated.pool}`;
      if (tiers.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spellRoles'],
          message: `spell roles stated twice for ${stated.rarity} ${stated.pool}`,
        });
        continue;
      }
      tiers.add(key);
      for (const role of stated.roles) {
        // `colorlessPermanentSlots` builds the colorless pool's permanents, and
        // it reads "this role names no effect kinds" as "print a vanilla
        // artifact". An Aura role names none either, so a walker or an Aura
        // seated in the colorless pool would come back an artifact with the
        // right name and the wrong card type, and nothing downstream would say
        // so - the slot's own conformance check is satisfied by an artifact.
        // Refused at the field it is written in.
        if (stated.pool === 'colorless' && isSpellPermanentRole(role)) {
          ctx.addIssue({
            code: 'custom',
            path: ['spellRoles'],
            message: `the ${role} role prints an enchantment or a planeswalker, which the colorless pool does not build: state it for a color`,
          });
          continue;
        }
        // The three zone-reaching roles are colored for a design reason rather
        // than a mechanical one, which is the difference between this refusal
        // and the one above it. Exile is white's on the 2021 pie and
        // reanimation is white's and black's; a colorless card that does either
        // is a card every deck plays, which is what the pie table exists to
        // stop. It is also what keeps `fillSchemaFor` at fourteen tiers rather
        // than twenty-eight: a role that cannot be colorless cannot share a
        // batch with a weapon.
        if (stated.pool === 'colorless' && isZoneReachingRole(role)) {
          ctx.addIssue({
            code: 'custom',
            path: ['spellRoles'],
            message: `the ${role} role prints an effect the color pie assigns to a color, and the colorless pool would print it on a card of no color: state it for a color`,
          });
          continue;
        }
        // A walker is a rare here for the reason it is a rare in paper: it is
        // the card a pack is opened for, and a common one would appear in every
        // deck of its color and decide every game it is drawn in. The tier is
        // policy rather than mechanics, so it is refused where the tier is
        // stated rather than inside the profile table.
        if (isPlaneswalkerRole(role) && stated.rarity !== 'rare') {
          ctx.addIssue({
            code: 'custom',
            path: ['spellRoles'],
            message: `the ${role} role is a rare: ${stated.rarity} ${stated.pool} cannot state it`,
          });
        }
      }
    }
    // An authored card is delivered and a required card is commissioned, so a
    // name in both lists is two cards asking to be the same card: the generator
    // would write one into a reserved slot and the brief would append the other
    // beside it. Refused here, where both lists are visible, rather than as a
    // duplicate-name finding after a run has been paid for.
    for (const card of brief.authoredCards) {
      const key = nameKey(card.name);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['authoredCards'],
          message: `"${card.name}" is both authored and required; a card is one or the other`,
        });
        continue;
      }
      seen.set(key, card.name);
    }
    for (const card of brief.authoredCards) {
      if (card.set.code !== brief.setCode) {
        ctx.addIssue({
          code: 'custom',
          path: ['authoredCards'],
          message: `the authored card "${card.name}" is printed in ${card.set.code}, not ${brief.setCode}`,
        });
      }
    }
    if (brief.requiredCards.length > brief.targetSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredCards'],
        message: `the brief requires ${brief.requiredCards.length} named cards, which a ${brief.targetSize}-card set has no room for`,
      });
    }
  });

export type SetBrief = z.infer<typeof SetBriefSchema>;
export type SetBriefInput = z.input<typeof SetBriefSchema>;

/** Validates a brief from any source (CLI, JSON file, test). Throws on invalid input. */
export function parseBrief(input: unknown): SetBrief {
  return SetBriefSchema.parse(input);
}

/** The tertiary color-pie allowance for a brief, defaulted from set size. */
export function tertiaryBudgetFor(brief: SetBrief): number {
  return brief.tertiaryBudget ?? Math.ceil(brief.targetSize * 0.1);
}
