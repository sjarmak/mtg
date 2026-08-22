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
import { AbilitySchema } from './abilities';
import {
  AuraStaticModificationSchema,
  CantAttackModificationSchema,
  CantBeBlockedModificationSchema,
  CantBlockModificationSchema,
  StatBonusPerModificationSchema,
} from './ability-shape';
import {
  BasicLandTypeSchema,
  CARD_ID_PATTERN,
  ColorSchema,
  FLAVOR_TEXT_MAX_LENGTH,
  KeywordSchema,
  ManaColorSchema,
  RaritySchema,
  SET_CODE_PATTERN,
  SupertypeSchema,
} from './vocabulary';
import { ManaCostSchema } from './mana';
import { CardEffectSchema } from './effects';
import { ModesSchema } from './modal';
import { MayChooserSchema } from './may';
import { UnlessClauseSchema } from './unless';
import { CostReductionSchema } from './cost-reduction';
import { CharacteristicPowerToughnessSchema } from './characteristic-values';

export const SetRefSchema = z.strictObject({
  code: z.string().regex(SET_CODE_PATTERN, 'set code must be 3-5 uppercase alphanumerics'),
  collectorNumber: z.int(),
});

export type SetRef = z.infer<typeof SetRefSchema>;

/** The bounded qualities Protection may name in the M11/M13 execution slice. */
export const ProtectionQualitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('color'), color: ColorSchema }),
  z.strictObject({ kind: z.literal('subtype'), subtype: z.string() }),
]);

/**
 * Keyword abilities whose rules consequences are wider than layer-6's flat
 * evergreen vocabulary. They are engine-only card data: the set generator's
 * `KeywordSchema` and model answer schemas remain unchanged.
 */
export const KeywordAbilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('defender') }),
  z.strictObject({ kind: z.literal('landwalk'), landType: BasicLandTypeSchema }),
  z.strictObject({ kind: z.literal('hexproof') }),
  z.strictObject({ kind: z.literal('indestructible') }),
  z.strictObject({ kind: z.literal('protection'), quality: ProtectionQualitySchema }),
  z.strictObject({ kind: z.literal('doubleStrike') }),
]);

export type ProtectionQuality = z.infer<typeof ProtectionQualitySchema>;
export type KeywordAbility = z.infer<typeof KeywordAbilitySchema>;

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
   * `checkEffects` enforces the spell-only rule for `effects`. The cap of two is
   * a New World Order budget rather than a technical limit.
   */
  abilities: z.array(AbilitySchema).max(3).default([]),
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
export const PermanentEntryReplacementSchema = z.strictObject({ kind: z.literal('entersTapped') });

export const CreatureCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('creature'),
  manaCost: ManaCostSchema,
  /** Artifact creatures fill the colorless slot of a generated set. */
  artifact: z.boolean().default(false),
  power: z.int(),
  toughness: z.int(),
  entryReplacement: PermanentEntryReplacementSchema.optional(),
});

export const InstantCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('instant'),
  manaCost: ManaCostSchema,
});

export const SorceryCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('sorcery'),
  manaCost: ManaCostSchema,
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
  kind: z.literal('artifact'),
  manaCost: ManaCostSchema,
  entryReplacement: PermanentEntryReplacementSchema.optional(),
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

export const AURA_MODIFICATION_LIMITS = { min: 1, max: 2 } as const;

/**
 * The Aura clause, over whichever modification union is wanted.
 *
 * Written once because the two below must differ in exactly one place — which
 * modifications they admit — and a second literal of `enchant` and the length
 * bounds would be a second thing to keep in step.
 */
function auraClause<M extends z.ZodType>(modification: M) {
  return z.strictObject({
    enchant: z.literal('creature'),
    modifications: z.array(modification).min(AURA_MODIFICATION_LIMITS.min).max(AURA_MODIFICATION_LIMITS.max),
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
  StatBonusPerModificationSchema,
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
export const AuraSchema = auraClause(AuraModificationSchema);

/** That clause narrowed to what a fill batch may answer with. */
export const ModelAuraSchema = auraClause(ModelAuraModificationSchema);

/**
 * Noncreature enchantment permanent. `aura` is absent for blanket
 * enchantments and present only when the spell targets and enters attached.
 */
export const EnchantmentCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('enchantment'),
  manaCost: ManaCostSchema,
  aura: AuraSchema.optional(),
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
  PermanentEntryReplacementSchema,
  z.strictObject({
    kind: z.literal('entersTappedUnlessControlsLandSubtype'),
    landTypes: z.array(BasicLandTypeSchema).min(1).max(2),
  }),
]);

export const LandCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('land'),
  /** Present exactly on Basic lands; nonbasic land types live in `subtypes`. */
  basicLandType: BasicLandTypeSchema.optional(),
  producesMana: z.array(ManaColorSchema).max(6).default([]),
  entryReplacement: LandEntryReplacementSchema.optional(),
});

/** A planeswalker permanent. Loyalty is source state, never power/toughness. */
export const PlaneswalkerCardSchema = z.strictObject({
  ...baseShape,
  kind: z.literal('planeswalker'),
  manaCost: ManaCostSchema,
  startingLoyalty: z.int(),
});

export const CardSchema = z.discriminatedUnion('kind', [
  CreatureCardSchema,
  InstantCardSchema,
  SorceryCardSchema,
  ArtifactCardSchema,
  LandCardSchema,
  PlaneswalkerCardSchema,
  EnchantmentCardSchema,
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
export type PlaneswalkerCard = z.infer<typeof PlaneswalkerCardSchema>;

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
export function printedEntryReplacement(card: Card): LandEntryReplacement | undefined {
  switch (card.kind) {
    case 'land':
    case 'artifact':
    case 'creature':
      return card.entryReplacement;
    case 'instant':
    case 'sorcery':
    case 'enchantment':
    case 'planeswalker':
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
  const { manaCost } = card;
  return manaCost.generic + manaCost.W + manaCost.U + manaCost.B + manaCost.R + manaCost.G;
}
