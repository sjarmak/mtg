/**
 * Card records: a discriminated union on card type, designed for exhaustive
 * `switch` narrowing with a `never` default.
 *
 * Two schema-shape decisions are load-bearing and deliberate:
 *
 * 1. `power`/`toughness` are declared optional on the shared base and
 *    *required* on the creature variant. Legal cards therefore narrow to
 *    `number` on creatures, while illegal input (stats on an instant) still
 *    parses and surfaces as `CREATURE_STATS_ON_NONCREATURE` instead of being
 *    silently stripped.
 * 2. `keywords`/`effects` exist on every variant so per-card-type legality is
 *    a coded structural violation, not an opaque parse error.
 *
 * `oracleText` is an optional *cache* of `renderOracleText(card)`. The
 * structured data is always the source of truth; when the field is present the
 * validators require it to match the renderer exactly.
 */
import { z } from 'zod';
import { ChosenXSchema } from './amount';
import { AbilitySchema, ActivatedAbilitySchema, TriggeredAbilitySchema } from './abilities';
import {
  AuraStaticModificationSchema,
  CantAttackModificationSchema,
  CantBeBlockedModificationSchema,
  CantBlockModificationSchema,
  SacrificeMatchingSchema,
  StatBonusPerModificationSchema,
} from './ability-shape';
import {
  BasicLandTypeSchema,
  CARD_ID_PATTERN,
  ColorSchema,
  COLORS,
  FLAVOR_TEXT_MAX_LENGTH,
  KeywordSchema,
  ManaColorSchema,
  RaritySchema,
  SET_CODE_PATTERN,
  SupertypeSchema,
} from './vocabulary';
import { manaValue, ManaCostSchema } from './mana';
import { CardEffectSchema } from './effects';
import { CounterKindSchema } from './counters';
import { ModesSchema } from './modal';
import { MayChooserSchema } from './may';
import { UnlessClauseSchema } from './unless';
import { CostReductionSchema } from './cost-reduction';
import { CharacteristicPowerToughnessSchema } from './characteristic-values';
import { canonicalJson } from './canonical-json';
import { KeywordAbilitySchema } from './keyword-ability';
import { OverloadProfileSchema } from './overload';
export { KeywordAbilitySchema, ProtectionQualitySchema } from './keyword-ability';
export type { KeywordAbility, ProtectionQuality } from './keyword-ability';

export const SetRefSchema = z.strictObject({
  code: z.string().regex(SET_CODE_PATTERN, 'set code must be 3-5 uppercase alphanumerics'),
  collectorNumber: z.int(),
});

export type SetRef = z.infer<typeof SetRefSchema>;

/** Hand-authored engine capacity; generator-facing schemas set their own lower budget. */
export const MAX_CARD_ABILITIES = 4;

/**
 * A source-relative restriction on choosing this permanent as a target.
 *
 * This is not a keyword ability. Gaea's Revenge prints a static rule whose
 * answer depends on the current color of the spell or ability source, from
 * either controller. Keeping it as its own characteristic prevents the rule
 * from acquiring hexproof's opponent-only exception or Protection's damage,
 * blocking, and attachment consequences.
 */
export const TargetingRestrictionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sourceLacksColor'), color: ColorSchema }),
]);

export type TargetingRestriction = z.infer<typeof TargetingRestrictionSchema>;

/**
 * A rule that changes deck legality rather than any game state.
 *
 * It is card-level data instead of an `Ability`: no stack, turn, zone or
 * battlefield event can execute "A deck can have any number ...". The deck
 * builder is the reader and the Oracle renderer is the human-facing proof that
 * the clause was not dropped. Optionality keeps every existing card's parsed
 * shape and fingerprint byte-stable.
 */
export const DeckConstructionRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('anyNumberOfThisCard') }),
]);
export type DeckConstructionRule = z.infer<typeof DeckConstructionRuleSchema>;

/**
 * A card action available during the pregame procedure because this card is in
 * its owner's opening hand.
 *
 * Card-level data rather than an `Ability`: it is used before the first turn,
 * while the card is in hand, and never goes on the stack. The one member is the
 * shared Leyline rule. Keeping it as a discriminated union makes later opening-
 * hand actions (reveal, exile, or conditional actions such as Gemstone
 * Caverns) additive without turning this member into a bag of nullable fields.
 * The independently declared set-generator card schemas expose no matching
 * field, so this remains hand-authored engine vocabulary.
 */
export const OpeningHandActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('beginOnBattlefield') }),
]);
export type CardOpeningHandAction = z.infer<typeof OpeningHandActionSchema>;

const permanentOpeningHandShape = {
  openingHandAction: OpeningHandActionSchema.optional(),
};

/**
 * The one hand-authored alternative-cost shape the native kernel can pay.
 *
 * CR 118.9 changes only the spell's mana payment; these two non-mana parts are
 * paid together while the spell is cast. `SacrificeMatchingSchema` is the same
 * current-characteristic predicate used by activated and additional costs, so
 * "black creature" has one typed meaning across all three call sites. The
 * independently declared model card schemas have no corresponding field.
 */
export const SpellAlternativeCostSchema = z.strictObject({
  payLife: z.int().min(1),
  sacrificeMatching: SacrificeMatchingSchema.extend({ count: z.int().min(1).max(4) }),
});

export type SpellAlternativeCost = z.infer<typeof SpellAlternativeCostSchema>;

/** A spell-level prohibition evaluated against the casting player's own turns. */
export const CastingRestrictionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prohibitedPlayerTurns'),
    turns: z
      .array(z.int().min(1).max(20))
      .min(1)
      .max(6)
      .refine((turns) => turns.every((turn, index) => index === 0 || turn > (turns[index - 1] ?? 0)), {
        message: 'prohibited player turns must be strictly increasing',
      }),
  }),
]);

export type CastingRestriction = z.infer<typeof CastingRestrictionSchema>;

const castableCostShape = {
  alternativeCost: SpellAlternativeCostSchema.optional(),
  /** Hand-authored engine vocabulary; independently declared model cards cannot emit it. */
  castingRestriction: CastingRestrictionSchema.optional(),
  /**
   * Source-faithful face presentation for the uncommon cards that print the
   * payment gloss above their rules text. The symbol and colors are derived
   * from the structured cost; no authored prose can disagree with the cost.
   * Independently declared model card schemas expose no matching field.
   */
  printedHybridManaReminder: z.literal(true).optional(),
};

const baseShape = {
  id: z.string().regex(CARD_ID_PATTERN, 'card id must be a lowercase slug'),
  name: z.string().min(1).max(80),
  rarity: RaritySchema,
  set: SetRefSchema,
  colors: z.array(ColorSchema).default([]),
  supertypes: z.array(SupertypeSchema).default([]),
  subtypes: z.array(z.string()).default([]),
  keywords: z.array(KeywordSchema).default([]),
  keywordAbilities: z.array(KeywordAbilitySchema).max(6).optional(),
  /**
   * Source-faithful grouping and order for printed keyword lines.
   *
   * The rules meaning remains in `keywords` and `keywordAbilities`; this
   * optional view may only rearrange those exact entries. Generated cards omit
   * it and retain the canonical renderer order. Exact reference translations
   * use it when Oracle groups two vocabularies on one line or chooses a
   * card-specific order such as "Reach, trample".
   */
  keywordLineGroups: z
    .array(
      z
        .array(z.union([KeywordSchema, KeywordAbilitySchema]))
        .min(1)
        .max(6),
    )
    .min(1)
    .max(6)
    .optional(),
  /**
   * Static targeting rules carried as copiable characteristics. The generator
   * schemas have no corresponding field; exact reference cards author them by
   * hand. An array admits independently printed restrictions without making a
   * later second rule a schema migration.
   */
  targetingRestrictions: z.array(TargetingRestrictionSchema).max(COLORS.length).optional(),
  effects: z.array(CardEffectSchema).default([]),
  /**
   * CR 700.2's "Choose one —" family: a modal spell's effects, one list per
   * mode, printed in place of the fixed `effects` list above. `checkEffects`
   * refuses a card that carries both, and refuses `modes` on anything that
   * is not a spell for the same reason it refuses `effects` there. See
   * `modal.ts` for the bound and why this lives beside `effects` rather than
   * inside the `Effect` union.
   */
  modes: ModesSchema.optional(),
  /**
   * CR 601.2c's "you may" clause: whether the spell's own `effects` (or, on a
   * modal spell, the chosen mode's) resolve at all is a yes/no asked of the
   * named player as the spell resolves, before any of them apply. `checkEffects`
   * refuses this on anything that is not a spell, and refuses it alongside
   * `modes` on the same card, for the reasons `may.ts` gives at length.
   */
  may: MayChooserSchema.optional(),
  /**
   * CR 118.8's alternative cost printed as a clause: the player the spell is
   * aimed at is offered a price to stop it, and pays or does not as the spell
   * resolves. `checkEffects` refuses it on anything that is not a spell,
   * alongside `modes` or `may`, on a spell printing more than one effect, and
   * on a payer word the card's own target kind cannot be read off. `unless.ts`
   * gives each of those bounds and why the payer is a word rather than a
   * player.
   */
  unless: UnlessClauseSchema.optional(),
  /**
   * CR 113 abilities printed on the card. Legal only on permanents that stay on
   * the battlefield; `checkAbilities` enforces that per card kind, the way
   * `checkEffects` enforces the spell-only rule for `effects`.
   * `MAX_CARD_ABILITIES` is the hand-authored engine envelope; model-facing
   * schemas remain narrower where their set-design budget calls for it.
   */
  abilities: z.array(AbilitySchema).max(MAX_CARD_ABILITIES).default([]),
  /**
   * CR 601.2f: while this permanent is on the battlefield, spells of the
   * named class cost less for its controller to cast. `null` is an ordinary
   * card, the same convention `ObjectFilter` (`@mtg/kernel`) uses: present
   * and nullable rather than optional, so a card record stays free of
   * `undefined` and canonicalizes and clones cleanly. Legal only on the
   * permanents `checkCostReduction` allows — the same restriction
   * `checkPlacement` states for `abilities`, for the same reason.
   */
  costReduction: CostReductionSchema.nullable().default(null),
  deckConstruction: DeckConstructionRuleSchema.optional(),
  /**
   * CR 101.2 / 701.5: an attempt to counter this object while it is a spell
   * does nothing.
   *
   * Card-level data rather than an effect, because it changes what another
   * spell or ability may do to this one on the stack; it is never something
   * this card performs as it resolves. Optionality preserves every existing
   * card fingerprint. The independently declared model card schemas expose no
   * corresponding field, so this remains hand-authored without a generator
   * guard that could drift.
   */
  cannotBeCountered: z.literal(true).optional(),
  oracleText: z.string().optional(),
  /**
   * The card's flavor text: prose, set in italics at the foot of the text box,
   * printed on the cards that have room left for it.
   *
   * **Optional, and its absence is an ordinary card rather than a finding.**
   * Every set committed to this repository predates the field and none of them
   * carries it; `checkFlavorText` has nothing to say about a card without one,
   * and `@mtg/ui`'s `textBoxBlocks` simply omits the block.
   *
   * It is not part of `renderOracleText` and never will be, for the reason
   * `reminder.ts` gives at length about reminder text: the oracle string is what
   * the New World Order gate counts, what Forge transpiles and what `oracleText`
   * is validated against, and flavor text is none of those. It is also outside
   * the card's fingerprint, because two cards whose rules are identical are the
   * same card design however differently they are flavored.
   */
  flavorText: z.string().min(1).max(FLAVOR_TEXT_MAX_LENGTH).optional(),
  power: z.int().optional(),
  toughness: z.int().optional(),
  characteristicPowerToughness: CharacteristicPowerToughnessSchema.optional(),
};

/**
 * The one CR 614.1c entry replacement any permanent may print on itself.
 *
 * It is not land-shaped and never was. Counted over the 38,623-card store,
 * "enters (the battlefield) tapped" is a self-replacement on 592 lands, 61
 * noncreature artifacts and 54 creatures, and the artifacts are the reason it
 * matters here: a turn of tempo is what pays for a two-mana rock (Coldsteel
 * Heart, the Diamonds, Guardian Idol), so a set that cannot print the clause
 * cannot price the rock. The field lived on `LandCardSchema` alone until
 * `mtg-hgmz`; the kernel's replacement machinery never asked which card kind
 * produced the modification, so the schema was the whole of the limit.
 *
 * Enchantments do not carry it, and the reason is a count rather than a
 * symmetry: zero of the 38,623 print it on themselves. The four
 * enchantment-typed cards whose text contains the phrase are two modal
 * Aura // Land fronts whose *land* back enters tapped, and two (Ashling's
 * Prerogative, Echoing Assault) whose text is about some other permanent
 * entering tapped — a static replacement over other objects, which is
 * `replacement-effects.ts`'s job and not this field's. Planeswalkers print it
 * zero times as well.
 */
const EntersTappedSchema = z.strictObject({ kind: z.literal('entersTapped') });
const PayLifeOrEntersTappedSchema = z.strictObject({
  kind: z.literal('payLifeOrEntersTapped'),
  life: z.int().min(1).max(20),
});
const OpponentsLifeLostThisTurnSchema = z.strictObject({
  kind: z.literal('opponentsLifeLostThisTurn'),
});
const EntersWithCountersSchema = z.strictObject({
  kind: z.literal('entersWithCounters'),
  counter: z.enum(['plusOnePlusOne', 'minusOneMinusOne', 'charge']),
  count: z.union([z.int().min(1).max(20), ChosenXSchema, OpponentsLifeLostThisTurnSchema]),
});
const EntersAsCopyOfCreatureSchema = z.strictObject({
  kind: z.literal('entersAsCopyOfCreature'),
});
const PutCounterOnControlledPermanentSchema = z.strictObject({
  kind: z.literal('putCounterOnControlledPermanent'),
  permanentType: z.enum(['artifact', 'creature', 'enchantment', 'land', 'planeswalker']),
  counter: CounterKindSchema,
  count: z.int().min(1).max(20),
});

/**
 * One complete copiable form selected before a creature enters.
 *
 * These are additions to the printed creature rather than replacements for an
 * open-ended bag of characteristics: every mode sets base P/T, while the only
 * optional deltas are printed creature subtypes and keywords. That is enough
 * for the measured Primal Clay family without admitting arbitrary card data or
 * a free-text mode whose kernel meaning could drift from its printed face.
 */
function uniqueEntries(values: readonly unknown[]): boolean {
  return new Set(values.map(canonicalJson)).size === values.length;
}

export const EntryCharacteristicModeSchema = z.strictObject({
  power: z.int().min(-20).max(20),
  toughness: z.int().min(-20).max(20),
  addSubtypes: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(6)
    .refine(uniqueEntries, 'entry characteristic subtypes must be unique')
    .optional(),
  addKeywords: z
    .array(KeywordSchema)
    .min(1)
    .max(6)
    .refine(uniqueEntries, 'entry characteristic keywords must be unique')
    .optional(),
  addKeywordAbilities: z
    .array(KeywordAbilitySchema)
    .min(1)
    .max(6)
    .refine(uniqueEntries, 'entry characteristic keyword abilities must be unique')
    .optional(),
});

function entryCharacteristicModeIdentity(mode: z.infer<typeof EntryCharacteristicModeSchema>): string {
  return canonicalJson({
    power: mode.power,
    toughness: mode.toughness,
    addSubtypes: [...(mode.addSubtypes ?? [])].sort(),
    addKeywords: [...(mode.addKeywords ?? [])].sort(),
    addKeywordAbilities: [...(mode.addKeywordAbilities ?? [])].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    ),
  });
}

const EntersAsCharacteristicChoiceSchema = z.strictObject({
  kind: z.literal('entersAsCharacteristicChoice'),
  modes: z
    .array(EntryCharacteristicModeSchema)
    .min(2)
    .max(6)
    .refine(
      (modes) => new Set(modes.map(entryCharacteristicModeIdentity)).size === modes.length,
      'entry characteristic modes must be distinct',
    ),
});

export const SharedPermanentEntryReplacementSchema = z.discriminatedUnion('kind', [
  EntersTappedSchema,
  EntersWithCountersSchema,
  EntersAsCopyOfCreatureSchema,
  PutCounterOnControlledPermanentSchema,
]);

export const PermanentEntryReplacementSchema = z.discriminatedUnion('kind', [
  EntersTappedSchema,
  EntersWithCountersSchema,
  EntersAsCopyOfCreatureSchema,
  PutCounterOnControlledPermanentSchema,
  EntersAsCharacteristicChoiceSchema,
  z.strictObject({ kind: z.literal('choosePlayer') }),
]);

export const CreatureCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  ...castableCostShape,
  kind: z.literal('creature'),
  manaCost: ManaCostSchema,
  /** Artifact creatures fill the colorless slot of a generated set. */
  artifact: z.boolean().default(false),
  power: z.int(),
  toughness: z.int(),
  /**
   * Rakdos's closed turn-life-loss casting bundle: the same opposing loss
   * unlocks this card and reduces creature spells its controller casts.
   * Kept atomic and absent from every independently declared model schema.
   */
  opponentsLifeLostThisTurnCasting: z.literal(true).optional(),
  /**
   * Palisade Giant's closed CR 614 contract. Its one validated static marker
   * supplies layer-6 ability presence/loss while this field keeps the player,
   * other-permanent scope, exclusion, and self destination atomic and outside
   * every generator-visible ability tuple.
   */
  redirectControllerAndOtherPermanentsDamageToSelf: z.literal(true).optional(),
  entryReplacement: PermanentEntryReplacementSchema.optional(),
});

/**
 * A non-mana payment made while an instant or sorcery is cast.
 *
 * The measured members are a current-characteristic permanent sacrifice and a
 * single card discarded from the caster's hand. They live on spell cards
 * rather than in `ManaCostSchema`: mana value and colored pips do not change
 * when a spell has another payment, while casting legality and stack state do.
 * The union keeps the two payments mutually exclusive until a printed card
 * proves they need to compose. The independently declared set-generator
 * schemas have no corresponding field, so both remain hand-authored engine
 * vocabulary.
 */
export const SpellAdditionalCostSchema = z.union([
  z.strictObject({
    sacrificeMatching: SacrificeMatchingSchema.extend({ count: z.int().min(1).max(4) }),
  }),
  z.strictObject({ discard: z.literal(1) }),
]);

export type SpellAdditionalCost = z.infer<typeof SpellAdditionalCostSchema>;

/** A generic casting-cost increase derived from the finalized target choice. */
export const TargetCostIncreaseSchema = z.strictObject({
  genericPerTargetBeyondFirst: z.int().min(1).max(20),
});

/** Hand-authored source presentation: effect indexes that begin a new printed paragraph. */
const PrintedEffectParagraphBreaksSchema = z
  .array(z.int().min(1))
  .max(2)
  .refine((breaks) => breaks.every((value, index) => index === 0 || value > breaks[index - 1]!), {
    message: 'printed effect paragraph breaks must be strictly increasing',
  });

export const InstantCardSchema = z.strictObject({
  ...baseShape,
  ...castableCostShape,
  kind: z.literal('instant'),
  manaCost: ManaCostSchema,
  additionalCost: SpellAdditionalCostSchema.optional(),
  targetCostIncrease: TargetCostIncreaseSchema.optional(),
  /** Hand-authored alternate price plus structured replacement effects. */
  overload: OverloadProfileSchema.optional(),
  /** Presentation only; independently declared model cards cannot emit it. */
  printedEffectParagraphBreaks: PrintedEffectParagraphBreaksSchema.optional(),
});

export const SorceryCardSchema = z.strictObject({
  ...baseShape,
  ...castableCostShape,
  kind: z.literal('sorcery'),
  manaCost: ManaCostSchema,
  additionalCost: SpellAdditionalCostSchema.optional(),
  targetCostIncrease: TargetCostIncreaseSchema.optional(),
  /** Hand-authored alternate price plus structured replacement effects. */
  overload: OverloadProfileSchema.optional(),
  /** Presentation only; independently declared model cards cannot emit it. */
  printedEffectParagraphBreaks: PrintedEffectParagraphBreaksSchema.optional(),
});

/**
 * Noncreature artifact permanent. It may carry all three printed ability kinds.
 * What it still cannot carry is a spell's effect list: a permanent's effects
 * are printed inside its abilities, which is what `checkEffects` says when it
 * refuses one.
 * Artifact *creatures* are `kind: 'creature'` with `artifact: true`.
 */
export const ArtifactCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  ...castableCostShape,
  kind: z.literal('artifact'),
  manaCost: ManaCostSchema,
  entryReplacement: z
    .discriminatedUnion('kind', [
      ...SharedPermanentEntryReplacementSchema.options,
      z.strictObject({ kind: z.literal('chooseTwoColors') }),
      z.strictObject({ kind: z.literal('chooseCardName') }),
    ])
    .optional(),
});

/**
 * Combat rules an attached Aura may impose on its enchanted creature.
 *
 * Reuses `ability-shape.ts`'s three leaf schemas rather than a second literal
 * of each: `mtg-t3ik` gave a plain static the same three restrictions, on any
 * source rather than only an attached one, and a card that can say "can't
 * attack" both ways must say it identically or the oracle renderer and the
 * validator's identity function would have to know two shapes mean one rule.
 *
 * Three, and it stays three. The combat statics added since — the two
 * requirements, `blockOnlyCreaturesWithKeyword`, and `cantBeBlockedBySubtype`
 * (`mtg-nhyv.57`) — are hand-authored only, and this union is not a private
 * one: `ModelAuraModificationSchema` is built from it, and a fixture key here is
 * `sha256(system, prompt, schema)`, so widening it re-addresses 172 recorded
 * model calls that cost money to make. A member no card in this checkout prints
 * as an Aura is not worth that, and adding one later is a schema widening that
 * pays the same price whenever it is actually wanted.
 */
export const AuraCombatModificationSchema = z.discriminatedUnion('kind', [
  CantAttackModificationSchema,
  CantBlockModificationSchema,
  CantBeBlockedModificationSchema,
]);

/**
 * Layer 2 (CR 613.1b): the Aura's controller controls the enchanted creature.
 *
 * Mind Control's whole clause, and it is an Aura modification rather than an
 * effect for the reason the rest of this union is: an Aura's clause lasts
 * exactly as long as the attachment, and a `gainControl` effect on the spell
 * would be a duration this DSL has no word for. Written as a kind with no
 * fields because there is only one answer to "who" - CR 613.1b's control-change
 * effects name a player, and an Aura's is always the player who controls the
 * Aura, which the kernel reads off the permanent rather than off the card.
 *
 * The kernel needed nothing for this: layer 2 has been implemented since the
 * layer walk landed (`ControlEffect` in `continuous.ts`, applied in
 * `characteristics.ts`, read by `controllerOf`), and every control-sensitive
 * question in the engine already goes through that one function. What was
 * missing was a card that could say it.
 */
export const AuraControlModificationSchema = z.strictObject({ kind: z.literal('gainControl') });

/** One basic-landwalk ability granted only to this Aura's enchanted creature. */
export const AuraLandwalkModificationSchema = z.strictObject({
  kind: z.literal('grantLandwalk'),
  landType: BasicLandTypeSchema,
});

/**
 * CR 302.6's exception, printed as an Aura clause: the enchanted creature does
 * not untap during its controller's untap step (Claustrophobia, Bitter Chill,
 * Sinking Feeling).
 *
 * ## Why this is not the `doesNotUntap` the DSL already had
 *
 * `tapPermanent` carries a `doesNotUntap` rider and it is a different rule
 * wearing the same words. That one is one-shot — it writes `skipsNextUntap` on
 * the object, the untap step spends it, and the permanent stands up on the turn
 * after ("its controller's *next* untap step"). This one holds for as long as
 * the Aura is attached and is spent by nothing, so a creature under it never
 * untaps at all. Two mechanisms, and the untap step reads both: the flag is
 * state on the permanent, this is a printed line on another permanent that
 * happens to be attached to it.
 *
 * ## Why it is a member of its own rather than a `CombatModification`
 *
 * `AuraCombatModificationSchema` reuses `ability-shape.ts`'s three restriction
 * leaves because an Aura's "can't attack" and a creature's own "can't attack"
 * are the identical rule read by the identical machine — CR 508/509 declaration
 * legality. Nothing about untapping goes through that machine. A tapped
 * creature is already ineligible to attack or block by the rules the kernel
 * already runs, so routing this through combat legality would state the
 * consequence and lose the cause: the creature also cannot pay a tap cost, and
 * it cannot be untapped by the turn-based action, which is CR 703's business
 * and not CR 508's.
 *
 * ## Why no layer, and therefore no `ContinuousEffect`
 *
 * CR 613 changes characteristics, and whether a permanent untaps is not one. So
 * this modification registers nothing in the layer walk and is read live from
 * the attachment relation instead (`hasAuraModification`, the same query
 * `combat.ts` already uses for the three restrictions), which is also what makes
 * it fall off for free when CR 704.5m puts the Aura in the graveyard.
 */
export const AuraUntapModificationSchema = z.strictObject({ kind: z.literal('doesNotUntap') });

/** The enchanted creature's activated abilities cannot be activated. */
export const AuraActivationLockModificationSchema = z.strictObject({
  kind: z.literal('cantActivateAbilities'),
});

/** A layer-6 triggered ability granted to the enchanted creature. */
export const AuraTriggeredAbilityGrantSchema = z.strictObject({
  kind: z.literal('grantTriggeredAbility'),
  ability: TriggeredAbilitySchema,
});

/** A layer-6 activated ability granted to the enchanted permanent. */
export const AuraActivatedAbilityGrantSchema = z.strictObject({
  kind: z.literal('grantActivatedAbility'),
  ability: ActivatedAbilitySchema,
});

export const AURA_MODIFICATION_LIMITS = { min: 1, max: 2 } as const;

/** Hand-authored Auras may carry a third restriction or use only abilities. */
const ENGINE_AURA_MODIFICATION_LIMITS = { min: 0, max: 3 } as const;

/**
 * The Aura clause, over whichever modification union is wanted.
 *
 * Written once because the two below must differ in exactly one place — which
 * modifications they admit — and a second literal of `enchant` and the length
 * bounds would be a second thing to keep in step.
 */
function auraClause<E extends z.ZodType, M extends z.ZodType>(
  enchant: E,
  modification: M,
  limits: { min: number; max: number },
) {
  return z.strictObject({
    enchant,
    modifications: z.array(modification).min(limits.min).max(limits.max),
  });
}

/**
 * The Aura vocabulary `@mtg/setgen` commissions in, and the bytes a recorded
 * fixture is addressed by.
 *
 * Deliberately not derived from `AuraModificationSchema`, and the split is the
 * one `ModelAttachSchema` and `ModelEffectSchema` already make: a fixture key is
 * `sha256(system, prompt, schema)`, so widening the union the generator answers
 * in re-addresses 172 recorded model calls that cost money to make
 * (`packages/setgen/test/answer-schema-freeze.test.ts` pins the digests). An
 * engine member added tomorrow must therefore leave these bytes alone, and it
 * can only do that if the model's list is its own statement rather than a view
 * of the engine's.
 *
 * That containment is also the one the project's load-bearing invariant asks
 * for, pointing the direction that fails safely: everything here parses as an
 * `AuraModification`, and not everything an Aura may print is here.
 */
export const ModelAuraModificationSchema = z.union([
  AuraStaticModificationSchema,
  AuraCombatModificationSchema,
  AuraLandwalkModificationSchema,
  AuraControlModificationSchema,
]);

/**
 * One exact property an Aura gives its enchanted creature. Static P/T and
 * keyword changes reuse the same CR 613 vocabulary as Equipment; combat
 * restrictions remain rules permissions and are read by combat legality; the
 * untap clause is read by the untap step and is neither.
 *
 * The static member is `AuraStaticModificationSchema` and not the engine's full
 * `StaticModificationSchema`, so `definePt` is unreachable here rather than
 * refused after parsing — `ability-shape.ts` argues why an Aura cannot carry a
 * characteristic-defining P/T at all.
 *
 * `statBonusPer` is the second engine-only member, beside the untap clause, and
 * it is here rather than inside `AuraStaticModificationSchema` for the reason
 * that schema's docblock gives about its own bytes: `ModelAuraModificationSchema`
 * is built from it and a fixture key is `sha256(system, prompt, schema)`, so a
 * member added there re-addresses every recorded Aura call. Armored Ascension
 * and Quag Sickness are what want it — "gets +1/+1 for each Plains you control"
 * is a rate charged against a board, which is exactly the class of card
 * `ability-shape.ts` keeps off every model tier, so the split falls out of the
 * rule already written rather than being made for these two cards.
 *
 * Unlike `definePt`, it is a *modification* rather than a definition (CR 613.4c,
 * layer 7c), so it says nothing about whose characteristics are being defined
 * and reaches another permanent the way `statBonus` beside it does.
 */
export const AuraModificationSchema = z.union([
  ModelAuraModificationSchema,
  AuraUntapModificationSchema,
  AuraActivationLockModificationSchema,
  StatBonusPerModificationSchema,
  AuraTriggeredAbilityGrantSchema,
  AuraActivatedAbilityGrantSchema,
]);

/** Which property of the enchanted creature one modification changes. */
export type AuraModificationKind = z.infer<typeof AuraModificationSchema>['kind'];

/** The subset of that a generated Aura may print. */
export type ModelAuraModificationKind = z.infer<typeof ModelAuraModificationSchema>['kind'];

/**
 * Every kind a *generated* Aura's modification may be, read off the four
 * schemas that make up the model union rather than typed out beside them.
 *
 * The device `MODEL_EFFECT_KINDS` and `MODEL_ABILITY_KINDS` use, and here for
 * the same reason: `@mtg/setgen` states which of these an Aura slot may print
 * and reads the printed card back against that statement, so a member added to
 * the model union tomorrow reaches the generator's vocabulary by construction
 * instead of by two lists agreeing. A member added to the *engine* union does
 * not reach it at all, which is the point of the split above.
 */
export const AURA_MODIFICATION_KINDS: readonly ModelAuraModificationKind[] = [
  ...AuraStaticModificationSchema.options.map((option) => option.shape.kind.value),
  ...AuraCombatModificationSchema.options.map((option) => option.shape.kind.value),
  AuraLandwalkModificationSchema.shape.kind.value,
  AuraControlModificationSchema.shape.kind.value,
];

/** The bounded Aura subset justified by the M11/M13 reference corpus. */
export const AuraSchema = auraClause(
  z.enum(['creature', 'artifactOrCreature', 'land', 'nonlandPermanent']),
  AuraModificationSchema,
  ENGINE_AURA_MODIFICATION_LIMITS,
).extend({
  /**
   * Righteous Authority's closed layer-7c capability: +1/+1 per card in the
   * enchanted creature controller's live hand. Hidden-zone counts are not
   * battlefield tallies, so this stays outside the model-facing Aura union.
   */
  enchantedControllerHandSizeBonus: z.literal(true).optional(),
  /**
   * Urban Burgeoning's turn-based-action permission for its enchanted land.
   *
   * This is an Aura clause rather than a characteristic modification: untap
   * steps do not use the stack or grant priority, and Forge represents it as
   * `Mode$ UntapOtherPlayer`. Keeping it beside `modifications` also leaves
   * that shared exhaustive union—and every generator-visible schema—unchanged.
   */
  untapsDuringEachOtherPlayersUntapStep: z.literal(true).optional(),
  /** Hand-authored Oracle ordering for Auras whose static clause precedes their abilities. */
  printedModificationsBeforeAbilities: z.literal(true).optional(),
});

/** That clause narrowed to what a fill batch may answer with. */
export const ModelAuraSchema = auraClause(
  z.literal('creature'),
  ModelAuraModificationSchema,
  AURA_MODIFICATION_LIMITS,
);

/** Mana Bloom's source-bound chosen-X charge-counter entry replacement. */
const EnchantmentEntryReplacementSchema = z.strictObject({
  kind: z.literal('entersWithCounters'),
  counter: z.literal('charge'),
  count: ChosenXSchema,
});

/**
 * Noncreature enchantment permanent. `aura` is absent for blanket
 * enchantments and present only when the spell targets and enters attached.
 */
export const EnchantmentCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  ...castableCostShape,
  kind: z.literal('enchantment'),
  manaCost: ManaCostSchema,
  aura: AuraSchema.optional(),
  entryReplacement: EnchantmentEntryReplacementSchema.optional(),
  /** Source-faithful presentation only; entry semantics remain in `entryReplacement`. */
  printedEntryReference: z.literal('thisEnchantment').optional(),
});

/**
 * Bounded intrinsic CR 614 land-entry text supported exactly by the kernel.
 *
 * Its first member is `PermanentEntryReplacementSchema` itself rather than a
 * second literal of the same object, so "enters tapped" has one definition and
 * a land and a mana rock cannot drift into two encodings of one clause.
 *
 * The second member stays here, and stays land-only, on the same counted
 * ground the first one traveled on: all 80 printed cards reading "enters
 * tapped unless you control a <basic land type>" are lands, and the condition
 * `arrivalOf` evaluates for it asks `landsControlledBy` — a question about the
 * mana base that only a land has ever been printed asking about itself.
 */
export const LandEntryReplacementSchema = z.discriminatedUnion('kind', [
  EntersTappedSchema,
  EntersWithCountersSchema,
  PayLifeOrEntersTappedSchema,
  z.strictObject({
    kind: z.literal('entersTappedUnlessControlsLandSubtype'),
    landTypes: z.array(BasicLandTypeSchema).min(1).max(2),
  }),
]);

export const LandCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  kind: z.literal('land'),
  /** Present exactly on Basic lands; nonbasic land types live in `subtypes`. */
  basicLandType: BasicLandTypeSchema.optional(),
  producesMana: z.array(ManaColorSchema).max(6).default([]),
  entryReplacement: LandEntryReplacementSchema.optional(),
  /** Source-faithful presentation only; land entry semantics remain in `entryReplacement`. */
  printedEntryReference: z.literal('thisLand').optional(),
  /** Source-faithful presentation for lands whose intrinsic mana reminder precedes entry text. */
  printedManaAbilityFirst: z.literal(true).optional(),
});

/** A planeswalker permanent. Loyalty is source state, never power/toughness. */
export const PlaneswalkerCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  ...castableCostShape,
  kind: z.literal('planeswalker'),
  manaCost: ManaCostSchema,
  startingLoyalty: z.int(),
});

const transformedFacePhysicalFields = {
  id: true,
  rarity: true,
  set: true,
  manaCost: true,
  alternativeCost: true,
  castingRestriction: true,
  printedHybridManaReminder: true,
} as const;

/**
 * The rules-bearing face of a transforming double-faced card.
 *
 * Physical identity, rarity, set position, and mana cost belong to the whole
 * card and are supplied by the front when this face becomes a spell. The face
 * otherwise reuses the ordinary card schemas, so a transformed creature,
 * permanent, instant, or sorcery has exactly the abilities and validation
 * surface its single-faced counterpart has.
 */
export const TransformBackFaceSchema = z.discriminatedUnion('kind', [
  CreatureCardSchema.omit({
    ...transformedFacePhysicalFields,
    openingHandAction: true,
  }),
  InstantCardSchema.omit(transformedFacePhysicalFields),
  SorceryCardSchema.omit(transformedFacePhysicalFields),
  ArtifactCardSchema.omit({
    ...transformedFacePhysicalFields,
    openingHandAction: true,
  }),
  EnchantmentCardSchema.omit({
    ...transformedFacePhysicalFields,
    openingHandAction: true,
  }),
  PlaneswalkerCardSchema.omit({
    ...transformedFacePhysicalFields,
    openingHandAction: true,
  }),
]);

/** A Battle permanent. Its current defense lives in defense counters. */
export const BattleCardSchema = z.strictObject({
  ...baseShape,
  ...permanentOpeningHandShape,
  ...castableCostShape,
  kind: z.literal('battle'),
  manaCost: ManaCostSchema,
  defense: z.int().min(1).max(20),
  backFace: TransformBackFaceSchema.optional(),
});

export const CardSchema = z.discriminatedUnion('kind', [
  CreatureCardSchema,
  InstantCardSchema,
  SorceryCardSchema,
  ArtifactCardSchema,
  LandCardSchema,
  PlaneswalkerCardSchema,
  EnchantmentCardSchema,
  BattleCardSchema,
]);

export type Card = z.infer<typeof CardSchema>;
export type CardInput = z.input<typeof CardSchema>;

export type CreatureCard = z.infer<typeof CreatureCardSchema>;
export type InstantCard = z.infer<typeof InstantCardSchema>;
export type SorceryCard = z.infer<typeof SorceryCardSchema>;
export type ArtifactCard = z.infer<typeof ArtifactCardSchema>;
export type LandCard = z.infer<typeof LandCardSchema>;
export type EnchantmentCard = z.infer<typeof EnchantmentCardSchema>;
export type Aura = z.infer<typeof AuraSchema>;
export type AuraLandwalkModification = z.infer<typeof AuraLandwalkModificationSchema>;
export type AuraModification = z.infer<typeof AuraModificationSchema>;
export type LandEntryReplacement = z.infer<typeof LandEntryReplacementSchema>;
export type PermanentEntryReplacement = z.infer<typeof PermanentEntryReplacementSchema>;
export type EntryCharacteristicMode = z.infer<typeof EntryCharacteristicModeSchema>;
export type PlaneswalkerCard = z.infer<typeof PlaneswalkerCardSchema>;
export type BattleCard = z.infer<typeof BattleCardSchema>;
export type TransformBackFace = z.infer<typeof TransformBackFaceSchema>;

/** Materializes a DFC's active back face with the physical front's identity. */
export function transformedBackFaceOf(card: BattleCard): CastableCard | null {
  if (card.backFace === undefined) return null;
  return CardSchema.parse({
    ...card.backFace,
    id: card.id,
    rarity: card.rarity,
    set: card.set,
    manaCost: {},
  }) as CastableCard;
}

/** The pregame action printed by this permanent, if any. */
export function openingHandActionOf(card: Card): CardOpeningHandAction | undefined {
  switch (card.kind) {
    case 'creature':
    case 'artifact':
    case 'enchantment':
    case 'land':
    case 'planeswalker':
    case 'battle':
      return card.openingHandAction;
    case 'instant':
    case 'sorcery':
      return undefined;
  }
}

/** Every card variant that carries a mana cost (everything except lands). */
export type CastableCard = Extract<Card, { manaCost: unknown }>;

export function isCreature(card: Card): card is CreatureCard {
  return card.kind === 'creature';
}

/** The P/T line printed on a creature card; CDA-backed values print as stars. */
export function printedPowerToughness(card: CreatureCard): string {
  return card.characteristicPowerToughness === undefined ? `${card.power}/${card.toughness}` : '*/*';
}

export function isLand(card: Card): card is LandCard {
  return card.kind === 'land';
}

/**
 * A Basic land (CR 205.4a), which two unrelated rules turn on: a set may print
 * one at several collector numbers without being a set with a duplicate card in
 * it, and a deck may play any number of them (CR 100.2a) where four is the limit
 * on everything else.
 *
 * `basicLandType` rather than the `basic` supertype, and the reason is the
 * uniqueness check's: that field is set on exactly the five Basic lands and on
 * nothing else, so it names the card class rather than a word on the type line.
 * The two callers were about to be two derivations of the same fact, which is
 * how a set-legality rule and a deck-legality rule come to disagree about what a
 * Swamp is.
 */
export function isBasicLand(card: Card): boolean {
  return card.kind === 'land' && card.basicLandType !== undefined;
}

/**
 * The entry replacement this card prints on itself, whatever kind it is.
 *
 * One derivation, because there were nearly two: the oracle renderer and
 * `arrivalOf` both have to know which clause a card prints, and the kernel's
 * copy read `card.kind === 'land' ? card.entryReplacement : undefined` while
 * the renderer's read the field inside its own land branch. A second card kind
 * carrying the field would have had to be added to both, and a card whose
 * printed face and whose kernel behavior disagree about entering tapped is the
 * worst shape this repository can ship. Widening the union of kinds that carry
 * the field is now an edit to `Card` alone.
 */
export function printedEntryReplacement(
  card: Card,
):
  | LandEntryReplacement
  | PermanentEntryReplacement
  | { readonly kind: 'chooseTwoColors' }
  | { readonly kind: 'chooseCardName' }
  | undefined {
  switch (card.kind) {
    case 'land':
    case 'artifact':
    case 'creature':
    case 'enchantment':
      return card.entryReplacement;
    case 'instant':
    case 'sorcery':
    case 'planeswalker':
    case 'battle':
      return undefined;
  }
}

export function isPlaneswalker(card: Card): card is PlaneswalkerCard {
  return card.kind === 'planeswalker';
}

export function isEnchantment(card: Card): card is EnchantmentCard {
  return card.kind === 'enchantment';
}

export function isAuraCard(card: Card): card is EnchantmentCard & { readonly aura: Aura } {
  return card.kind === 'enchantment' && card.aura !== undefined;
}

/**
 * The Aura clauses that compile to a CR 613 continuous effect, as opposed to the
 * combat permissions and the untap clause, which are read where they apply.
 *
 * Every consumer of an Aura's modifications branches on this predicate first —
 * the kernel's compiler (`attach.ts`), the oracle renderer, the deck evaluator
 * and the Forge transpiler — so a kind that belongs on this side and is left off
 * it is a card that parses, attaches and does nothing on all four.
 */
export function isStaticAuraModification(
  modification: AuraModification,
): modification is Extract<AuraModification, { kind: 'statBonus' | 'grantKeyword' | 'statBonusPer' }> {
  return (
    modification.kind === 'statBonus' ||
    modification.kind === 'grantKeyword' ||
    modification.kind === 'statBonusPer'
  );
}

/**
 * Whether the card is an artifact, by either route: the noncreature variant, or
 * a creature with the flag set. Not a type guard, because the two routes narrow
 * to different variants and the callers want the fact rather than the narrowing.
 *
 * One owner on purpose. Whether the card prints the word Artifact on its type
 * line (`typeLineParts`) and whether a renderer gives it an artifact treatment
 * (`frameTreatment` in `@mtg/ui`) are the same question, and a second copy of
 * this disjunction is how they would come to disagree.
 */
export function isArtifact(card: Card): boolean {
  return card.kind === 'artifact' || (card.kind === 'creature' && card.artifact);
}

/**
 * Every card type this card's type line prints (CR 205.1a), which is one for
 * all but the artifact creature.
 *
 * One owner, for the reason `isArtifact` has one — three readers had each
 * spelled the disjunction out: `printedCharacteristics` in `@mtg/kernel` built
 * `['creature', 'artifact']`, `hasCardType`'s no-layer short circuit special
 * cased the artifact kind, and CR 601.2f's cost reduction compared against
 * `card.kind` alone and so skipped every artifact creature spell (`mtg-0zhm`).
 * The third is what a fourth copy costs.
 */
export function printedCardTypes(card: Card): readonly Card['kind'][] {
  return card.kind === 'creature' && card.artifact ? ['creature', 'artifact'] : [card.kind];
}

export function isCastable(card: Card): card is CastableCard {
  return card.kind !== 'land';
}

/** Instants and sorceries: cards that leave the stack for the graveyard. */
export function isSpellCard(card: Card): card is InstantCard | SorceryCard {
  return card.kind === 'instant' || card.kind === 'sorcery';
}

/** Cards that resolve onto the battlefield. */
export function isPermanentCard(card: Card): boolean {
  return !isSpellCard(card);
}

/** Mana value of a card; lands are 0. */
export function cardManaValue(card: Card): number {
  if (!isCastable(card)) return 0;
  return manaValue(card.manaCost);
}
