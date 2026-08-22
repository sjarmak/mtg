/**
 * The slot-fill output contract.
 *
 * The model emits a structured card body in the DSL's own types — never English
 * that something downstream has to parse. Everything the allocator already
 * decided (rarity, color pool, keywords, collector number, card id) is stamped
 * on afterwards and deliberately absent here: the model designs, the pipeline
 * bookkeeps.
 *
 * `ModelEffectSchema`, `ModelAbilitySchema` and `ModelManaCostSchema` come from
 * `@mtg/dsl`, so the JSON Schema the provider shows the model is the engine's
 * own contract rather than a copy of it. That is the co-design invariant,
 * expressed as a type.
 *
 * `ModelEffectSchema` is `EffectSchema` minus `target.distinct`, the one
 * targeting constraint the prompt does not yet explain (`mtg-bc2.79` built it;
 * `mtg-bc2.80` teaches it). The generator's output space is therefore a strict
 * subset of the enforceable space, which is the safe direction: every card the
 * model can propose is a card the kernel can run. Offering a field the prompt
 * never mentions is the unsafe direction — the model would fill it by guessing,
 * and the first evidence would be a live run that costs money. Deleting the
 * distinction is one import away once the prompt teaches it.
 *
 * ## Why there are five batch schemas
 *
 * `abilities` is the same argument taken one step further, and it is taken per
 * *batch* rather than once for the package. A fixture key is
 * `hash(system, prompt, schema)`, so a field added to the one schema every call
 * uses renames every recorded fixture whether or not the brief wanted the field.
 * The prompt already avoids that: `requiredLines` prints its two lines only on a
 * slot the brief reserved, so a brief that requires nothing builds the bytes it
 * always did. `fillSchemaFor` gives the answer schema the same property. A batch
 * holding no slot the allocator gave an ability kind is shown
 * `FillBatchSchema`, byte-identical to what it was shown before this change; a
 * batch holding one is shown the wider schema, and is also the only batch whose
 * prompt explains what an ability is.
 *
 * The third tier is CR 702.6b's equip clause, and it exists because the cost of
 * folding it into the second was measured rather than guessed: adding `attach`
 * to `ModelAbilitySchema` strands `fixtures/llm-hearthglass/` on its first
 * batch, and getting that back is a live run of a brief with no weapon in it. So
 * a batch holding a slot the brief marked as equipment is shown
 * `FillBatchWithEquipSchema`; a batch holding an ordinary ability slot is shown
 * `FillBatchWithAbilitiesSchema`, unchanged; a batch holding neither is shown
 * `FillBatchSchema`, unchanged. Two tiers of recorded fixtures replay for free.
 *
 * The fourth tier is the flagship set's own two mechanics, which widen the
 * same two members together: a part token that prints Fuse, and an activation
 * cost that eats a named subtype. The fifth is that tier and the equip clause at
 * once, and it is a combination rather than a fourth idea — the weapons and the
 * Chests are both colorless artifacts, so one batch holds both, and a batch is
 * shown one schema. Four tiers of recorded fixtures replay for free.
 *
 * ## The three tiers that add a card type rather than a field
 *
 * `mtg-fv5s` taught the generator two card kinds it never had — an enchantment
 * and a planeswalker — and that is a *member* of the union rather than a field
 * on an existing one. So the same rule applies one level up: a batch holding no
 * enchantment and no walker slot is shown the union it was always shown, and a
 * batch holding one is shown that union with two members appended.
 *
 * Three of them rather than five, and the count is proved rather than assumed.
 * `batchSlots` keys a batch on `(rarity, color)`, and `briefSchema` refuses the
 * enchantment and walker roles in the colorless pool, so the two new members can
 * only ever land in a colored batch. Every weapon is an artifact (CR 301.5) and
 * artifact slots exist only in the colorless pool, so `batchWantsEquip` and
 * `batchWantsSpellPermanents` cannot both be true of one batch —
 * `fillSchemaFor` says that out loud rather than leaving it implied, because a
 * combination nobody built is a combination nobody tested. The other three
 * combinations are all reachable: an Aura slot alone, an Aura or anthem slot
 * beside an ability slot, and either beside a colored creature the brief
 * reserved for one of the set's mechanics.
 *
 * ## The six tiers that widen what a spell may say
 *
 * `mtg-q5yg` priced three effect primitives the generator could not reach —
 * `exileTarget`, `scry`, `returnFromGraveyard` — and the same rule applies a
 * third time, one level down. A spell's `effects` array is typed by
 * `ModelEffectSchema`, and appending three members to *that* would move the
 * `<effect_vocabulary>` bytes of every ability-bearing batch as well
 * (`abilityEffectKinds` reads `MODEL_EFFECT_KINDS`), which is all 172 recorded
 * fixtures at once. So the widening is a second union,
 * `ZoneReachingModelEffectSchema`, and the tiers below are the batches allowed
 * to see it.
 *
 * Six rather than eight, and the two absences are the same structural fact
 * twice. `briefSchema` refuses the three zone-reaching roles in the colorless
 * pool for the reason it refuses the enchantment roles there — the three
 * primitives are colored effects on the 2021 pie, and a colorless card that
 * exiles a creature is the color-pie break the pie table exists to name — so a
 * zone-reaching slot is always a colored slot, and `batchWantsEquip` can never
 * be true of a batch holding one. `fillSchemaFor` throws on the pair rather
 * than resolving it, exactly as it does for the equip-and-permanents pair.
 */
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  AttachingMechanicModelAbilitySchema,
  AttachingModelAbilitySchema,
  LoyaltyModelAbilitySchema,
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  ModelAuraSchema,
  MODEL_EFFECT_KINDS,
  ModelEffectSchema,
  ModelManaCostSchema,
  SUBTYPE_PATTERN,
  ZONE_REACHING_MODEL_EFFECT_KINDS,
  ZoneReachingModelEffectSchema,
} from '@mtg/dsl';
import type { AttachingMechanicModelAbility, EffectKind } from '@mtg/dsl';
import type { Slot } from './slot';

/**
 * The longest name the model may return, and therefore the longest name a brief
 * may require: a required card the fill schema could never carry is a brief the
 * generator can never satisfy, and that belongs at the boundary, not in a run.
 */
export const CARD_NAME_MAX_LENGTH = 40;

const nameField = z.string().min(1).max(CARD_NAME_MAX_LENGTH);
const subtypesField = z.array(z.string().min(1).max(20)).max(2).default([]);
/** One sentence on the design intent; kept for the report, never printed on the card. */
const designNoteField = z.string().min(1).max(200);

/**
 * Two is `Card.abilities`' own cap, not a second budget: a third printed line is
 * a rules box rather than a schema (`packages/card-render`). Defaulted rather
 * than required, because a batch is one schema over several slots and only some
 * of them were allocated an ability; which slot must carry one is the prompt's
 * job to say and `checkSlotConformance`'s to check.
 */
const abilitiesField = z.array(ModelAbilitySchema).max(2).default([]);

/**
 * `ManaCostSchema` minus `hasX`, `@mtg/dsl`'s own model-facing narrowing.
 * `mtg-bc2.152.6` gave the engine's cost schema an `{X}` component, and
 * reusing the wider schema here would rename every recorded fixture in
 * `fixtures/llm/` for a field the generator does not yet offer the model —
 * the prompt teaches nothing about X, so a model that saw the field would be
 * guessing, exactly the failure mode the file's own docblock argues against
 * for `target.distinct`. `buildCardInput` hands the result straight to
 * `CardSchema`, whose default resolves the omitted field to `hasX: false`, so
 * a card built from a model answer is indistinguishable from one built before
 * this field existed.
 */
const creatureShape = {
  slotId: z.string().min(1),
  kind: z.literal('creature'),
  name: nameField,
  subtypes: subtypesField,
  manaCost: ModelManaCostSchema,
  power: z.int(),
  toughness: z.int(),
  designNote: designNoteField,
};

/**
 * Field order is not cosmetic here. `toJsonSchema` emits `required` in property
 * order and `fixtureKey` hashes that array, so moving `kind` renames every
 * recorded fixture for a change that says nothing.
 */
function spellShape<K extends 'instant' | 'sorcery'>(kind: K) {
  return {
    slotId: z.string().min(1),
    kind: z.literal(kind),
    name: nameField,
    manaCost: ModelManaCostSchema,
    effects: z.array(ModelEffectSchema).min(1).max(2),
    designNote: designNoteField,
  };
}

const artifactShape = {
  slotId: z.string().min(1),
  kind: z.literal('artifact'),
  name: nameField,
  subtypes: subtypesField,
  manaCost: ModelManaCostSchema,
  designNote: designNoteField,
};

export const FilledCreatureSchema = z.object(creatureShape);
export const FilledInstantSchema = z.object(spellShape('instant'));
export const FilledSorcerySchema = z.object(spellShape('sorcery'));
export const FilledArtifactSchema = z.object(artifactShape);

/**
 * The same spell with the wider effect vocabulary, and nothing else changed.
 *
 * The override rather than a second literal shape, because the two must differ
 * in exactly one property and a copy is a second place for `designNote`'s cap
 * to drift. Object spread keeps `effects` at the position `spellShape` gave it,
 * which matters: `toJsonSchema` emits `required` in property order and
 * `fixtureKey` hashes that array, so a tier whose fields are the same fields in
 * a different order is a different address for the same question.
 */
function zoneReachingSpellShape<K extends 'instant' | 'sorcery'>(kind: K) {
  return {
    ...spellShape(kind),
    effects: z.array(ZoneReachingModelEffectSchema).min(1).max(2),
  };
}

export const FilledInstantWithZoneReachSchema = z.object(zoneReachingSpellShape('instant'));
export const FilledSorceryWithZoneReachSchema = z.object(zoneReachingSpellShape('sorcery'));

/** The same two permanents, plus the printed abilities their slots asked for. */
export const FilledCreatureWithAbilitiesSchema = z.object({ ...creatureShape, abilities: abilitiesField });
export const FilledArtifactWithAbilitiesSchema = z.object({ ...artifactShape, abilities: abilitiesField });

export const FilledCardSchema = z.discriminatedUnion('kind', [
  FilledCreatureSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactSchema,
]);

export const FilledCardWithAbilitiesSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithAbilitiesSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithAbilitiesSchema,
]);

/**
 * The abilities an artifact in a batch holding a weapon may print.
 *
 * Two is still `Card.abilities`' cap and still not a second budget, and a weapon
 * spends both halves of one clause on one entry: `attach` states what being
 * equipped is worth and the same entry's cost states what equipping costs, which
 * is why the renderer prints Magic's two lines from one ability.
 */
const attachingAbilitiesField = z.array(AttachingModelAbilitySchema).max(2).default([]);

/**
 * The artifact member widened by the equip clause, and the only member that is.
 *
 * The creature member is deliberately left on the narrower union in this tier.
 * An Equipment is an artifact (CR 301.5), a creature that is also an Equipment
 * cannot equip anything (CR 301.5c), and `checkEquipAbility` refuses a card
 * whose type line and printed clause disagree — so a creature offered the field
 * could only fill it with a card the validator would send straight back. A field
 * the answer can never legally use is the same mistake as a field the prompt
 * never explains, pointed the other way.
 */
export const FilledArtifactWithEquipSchema = z.object({
  ...artifactShape,
  abilities: attachingAbilitiesField,
});

export const FilledCardWithEquipSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithAbilitiesSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithEquipSchema,
]);

/**
 * The two permanents again, widened by the set's own mechanics.
 *
 * `MechanicModelAbilitySchema` carries both halves at once: an activation cost
 * that may eat a named subtype, and a `createToken` whose token may print Fuse.
 * Both members get it, because either permanent can be either card — a Monster
 * that drops a part is a creature and a Chest that yields one is an artifact —
 * and a batch is one schema over the slot that asked and the slots beside it.
 *
 * The spell members are deliberately not widened. Every way this set puts a part
 * into play is a permanent's printed ability (decision 8: Monsters drop them,
 * Chests hold them), and a sorcery that made one would need the wider effect
 * union in the one place the tiers can least afford it: `spellShape` is shared
 * with the two frozen tiers, so widening it there means either a fourth copy of
 * the shape or a change to bytes that must not move.
 */
const mechanicAbilitiesField = z.array(MechanicModelAbilitySchema).max(2).default([]);

export const FilledCreatureWithMechanicsSchema = z.object({
  ...creatureShape,
  abilities: mechanicAbilitiesField,
});
export const FilledArtifactWithMechanicsSchema = z.object({
  ...artifactShape,
  abilities: mechanicAbilitiesField,
});

/**
 * The artifact member of the widest tier: the set's mechanics and CR 702.6b's
 * equip clause on one card shape.
 *
 * It exists because the colorless artifact pool is where the weapons and the
 * Chests both live, so a batch holding one of each is a batch that needs both
 * fields. The creature member below is the mechanics one unchanged, for the
 * reason `FilledArtifactWithEquipSchema` gives: a creature that is also an
 * Equipment cannot equip anything (CR 301.5c), so a creature offered `attach`
 * could only fill it with a card `checkEquipAbility` would send back.
 */
export const FilledArtifactWithEquipAndMechanicsSchema = z.object({
  ...artifactShape,
  abilities: z.array(AttachingMechanicModelAbilitySchema).max(2).default([]),
});

export const FilledCardWithMechanicsSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithMechanicsSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithMechanicsSchema,
]);

export const FilledCardWithEquipAndMechanicsSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithMechanicsSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithEquipAndMechanicsSchema,
]);

/**
 * An Aura, in a batch where nothing may print an ability.
 *
 * `aura` is required here rather than optional, and that is the whole content of
 * this member: an enchantment with no clause and no ability is a card with no
 * printed word, and this tier is shown to exactly the batches whose prompt
 * carries no `<ability_vocabulary>` for it to use instead. So the one shape the
 * model can legally return is the one the schema asks for, and a repair round
 * spent explaining that is a repair round saved.
 *
 * No `subtypes` field on any enchantment member. CR 205.3h and
 * `checkSubtypes` between them leave exactly one legal answer — an Aura carries
 * the Aura subtype and nothing else, a blanket enchantment carries none — so
 * `buildCardInput` stamps it from the clause the model did return. A field with
 * one legal value is a field the model can only get wrong.
 */
export const FilledAuraSchema = z.object({
  slotId: z.string().min(1),
  kind: z.literal('enchantment'),
  name: nameField,
  manaCost: ModelManaCostSchema,
  aura: ModelAuraSchema,
  designNote: designNoteField,
});

/**
 * The enchantment member in a batch that may also print abilities: an Aura, or
 * the blanket enchantment whose whole text is a static ability.
 *
 * Both shapes are one member because both are `kind: 'enchantment'` and a
 * discriminated union takes one member per discriminant value. Which of the two
 * a given slot must return is the slot line's job to say
 * (`enchantmentLines`) and `checkAuraModifications`' to read back: a slot with
 * an aura-modification list prints the clause, and a slot with an ability kind
 * prints the ability.
 *
 * Parameterized by the ability union for the same reason the creature and
 * artifact members are — a batch that was widened by the set's own mechanics
 * widens every member that carries abilities, because any of them could be the
 * card the brief reserved.
 */
function enchantmentShape<A extends z.ZodType>(abilities: A) {
  return {
    slotId: z.string().min(1),
    kind: z.literal('enchantment'),
    name: nameField,
    manaCost: ModelManaCostSchema,
    aura: ModelAuraSchema.optional(),
    abilities,
    designNote: designNoteField,
  };
}

export const FilledEnchantmentWithAbilitiesSchema = z.object(enchantmentShape(abilitiesField));
export const FilledEnchantmentWithMechanicsSchema = z.object(enchantmentShape(mechanicAbilitiesField));

/**
 * A planeswalker, and the one member that is the same in all three tiers.
 *
 * `loyaltyAbilities` rather than `abilities`, and the different name is doing
 * work: a loyalty ability is a different shape from every other ability the
 * generator can answer with (`LoyaltyModelAbilitySchema` in `@mtg/dsl` argues
 * why at length), so `filledAbilities` correctly reports that a walker carries
 * none of the kind it returns, and `buildCardInput` reaches the walker's through
 * `loyaltyAbilityFromModel` instead. Sharing the field name would have made both
 * of those quietly wrong.
 *
 * Two to three abilities: `checkAbilities` caps a walker at three, and a walker
 * with one is a permanent with a single activated ability that happens to have
 * loyalty on it. The floor is what makes it a planeswalker.
 *
 * `startingLoyalty` is bounded to 2-5 rather than the DSL's 1-20. The wider
 * range is what a hand-authored card may state; this is what the tier prints,
 * and both ends were measured against paper: a walker that starts at 1 dies to
 * the first attacker before its controller uses it twice, and one that starts
 * above 5 cannot be answered by a Limited board at all.
 *
 * `subtype` is singular and required, because a planeswalker's subtype is its
 * character name (CR 205.3j) and the model is the one naming the card. One word,
 * capitalized, checked against the DSL's own `SUBTYPE_PATTERN` here so a
 * malformed answer is a schema retry rather than an `INVALID_SUBTYPE` violation
 * a whole assembly pass later.
 */
/**
 * The bounds the prompt states out loud and the schema holds the model to.
 *
 * Two constants rather than four literals, because the prompt says these numbers
 * in a sentence and the schema enforces them in a shape, and a card refused for
 * a bound the prompt never mentioned costs a regeneration round for no design
 * reason. `AURA_MODIFICATION_LIMITS` is the same device one package over.
 */
export const LOYALTY_ABILITY_LIMITS = { min: 2, max: 3 } as const;
export const STARTING_LOYALTY_LIMITS = { min: 2, max: 5 } as const;

export const FilledPlaneswalkerSchema = z.object({
  slotId: z.string().min(1),
  kind: z.literal('planeswalker'),
  name: nameField,
  subtype: z.string().min(1).max(20).regex(SUBTYPE_PATTERN),
  manaCost: ModelManaCostSchema,
  startingLoyalty: z.int().min(STARTING_LOYALTY_LIMITS.min).max(STARTING_LOYALTY_LIMITS.max),
  loyaltyAbilities: z
    .array(LoyaltyModelAbilitySchema)
    .min(LOYALTY_ABILITY_LIMITS.min)
    .max(LOYALTY_ABILITY_LIMITS.max),
  designNote: designNoteField,
});

export const FilledCardWithSpellPermanentsSchema = z.discriminatedUnion('kind', [
  FilledCreatureSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactSchema,
  FilledAuraSchema,
  FilledPlaneswalkerSchema,
]);

export const FilledCardWithAbilitiesAndSpellPermanentsSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithAbilitiesSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithAbilitiesSchema,
  FilledEnchantmentWithAbilitiesSchema,
  FilledPlaneswalkerSchema,
]);

export const FilledCardWithMechanicsAndSpellPermanentsSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithMechanicsSchema,
  FilledInstantSchema,
  FilledSorcerySchema,
  FilledArtifactWithMechanicsSchema,
  FilledEnchantmentWithMechanicsSchema,
  FilledPlaneswalkerSchema,
]);

/**
 * The six unions an opted-in batch is shown: each of the tiers above with its
 * two spell members swapped for the wider ones.
 *
 * Written out rather than derived from the tiers above by a mapping function,
 * for the reason the file's header gives about bytes. A `z.discriminatedUnion`
 * built by transforming another one would still hash to whatever the transform
 * produced, and the thing a reader needs to be able to check by eye is which
 * members a tier holds. Fourteen unions is the cost of that, and the freeze
 * test in `answer-schema-freeze.test.ts` is what makes the cost visible when it
 * next grows.
 */
export const FilledCardWithZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactSchema,
]);

export const FilledCardWithAbilitiesAndZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithAbilitiesSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactWithAbilitiesSchema,
]);

export const FilledCardWithMechanicsAndZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithMechanicsSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactWithMechanicsSchema,
]);

export const FilledCardWithSpellPermanentsAndZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactSchema,
  FilledAuraSchema,
  FilledPlaneswalkerSchema,
]);

export const FilledCardWithAbilitiesAndSpellPermanentsAndZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithAbilitiesSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactWithAbilitiesSchema,
  FilledEnchantmentWithAbilitiesSchema,
  FilledPlaneswalkerSchema,
]);

export const FilledCardWithMechanicsAndSpellPermanentsAndZoneReachSchema = z.discriminatedUnion('kind', [
  FilledCreatureWithMechanicsSchema,
  FilledInstantWithZoneReachSchema,
  FilledSorceryWithZoneReachSchema,
  FilledArtifactWithMechanicsSchema,
  FilledEnchantmentWithMechanicsSchema,
  FilledPlaneswalkerSchema,
]);

/**
 * What a fill call may return, from any of the fourteen schemas.
 *
 * A union rather than one shape with optional fields, because the shapes are
 * different JSON Schemas and the difference is the whole point: a consumer that
 * wants the abilities asks `filledAbilities`, and a consumer that reads
 * `filled.abilities` directly does not compile until it says which of them it is
 * holding.
 */
export type FilledCard =
  | z.infer<typeof FilledCardSchema>
  | z.infer<typeof FilledCardWithAbilitiesSchema>
  | z.infer<typeof FilledCardWithEquipSchema>
  | z.infer<typeof FilledCardWithMechanicsSchema>
  | z.infer<typeof FilledCardWithEquipAndMechanicsSchema>
  | z.infer<typeof FilledCardWithSpellPermanentsSchema>
  | z.infer<typeof FilledCardWithAbilitiesAndSpellPermanentsSchema>
  | z.infer<typeof FilledCardWithMechanicsAndSpellPermanentsSchema>
  | z.infer<typeof FilledCardWithZoneReachSchema>
  | z.infer<typeof FilledCardWithAbilitiesAndZoneReachSchema>
  | z.infer<typeof FilledCardWithMechanicsAndZoneReachSchema>
  | z.infer<typeof FilledCardWithSpellPermanentsAndZoneReachSchema>
  | z.infer<typeof FilledCardWithAbilitiesAndSpellPermanentsAndZoneReachSchema>
  | z.infer<typeof FilledCardWithMechanicsAndSpellPermanentsAndZoneReachSchema>;
export type FilledCardInput =
  | z.input<typeof FilledCardSchema>
  | z.input<typeof FilledCardWithAbilitiesSchema>
  | z.input<typeof FilledCardWithEquipSchema>
  | z.input<typeof FilledCardWithMechanicsSchema>
  | z.input<typeof FilledCardWithEquipAndMechanicsSchema>
  | z.input<typeof FilledCardWithSpellPermanentsSchema>
  | z.input<typeof FilledCardWithAbilitiesAndSpellPermanentsSchema>
  | z.input<typeof FilledCardWithMechanicsAndSpellPermanentsSchema>
  | z.input<typeof FilledCardWithZoneReachSchema>
  | z.input<typeof FilledCardWithAbilitiesAndZoneReachSchema>
  | z.input<typeof FilledCardWithMechanicsAndZoneReachSchema>
  | z.input<typeof FilledCardWithSpellPermanentsAndZoneReachSchema>
  | z.input<typeof FilledCardWithAbilitiesAndSpellPermanentsAndZoneReachSchema>
  | z.input<typeof FilledCardWithMechanicsAndSpellPermanentsAndZoneReachSchema>;

/**
 * A filled card's printed abilities; absent and empty are the same card.
 *
 * The return type is the widest of the five, which is the direction that stays
 * true: every narrower ability union is assignable to it, because each widening
 * either made a field optional or relaxed a floor. So a card from any tier reads
 * back through one function, and a caller handed a field it did not expect sees
 * a field rather than a cast. `AttachingModelAbilityIsMechanicAbility` in
 * `@mtg/dsl` proves the step this signature depends on.
 */
export function filledAbilities(filled: FilledCard): readonly AttachingMechanicModelAbility[] {
  return 'abilities' in filled ? filled.abilities : [];
}

export const FillBatchSchema = z.object({
  cards: z.array(FilledCardSchema).min(1).max(16),
});

export const FillBatchWithAbilitiesSchema = z.object({
  cards: z.array(FilledCardWithAbilitiesSchema).min(1).max(16),
});

export const FillBatchWithEquipSchema = z.object({
  cards: z.array(FilledCardWithEquipSchema).min(1).max(16),
});

export const FillBatchWithMechanicsSchema = z.object({
  cards: z.array(FilledCardWithMechanicsSchema).min(1).max(16),
});

export const FillBatchWithEquipAndMechanicsSchema = z.object({
  cards: z.array(FilledCardWithEquipAndMechanicsSchema).min(1).max(16),
});

export const FillBatchWithSpellPermanentsSchema = z.object({
  cards: z.array(FilledCardWithSpellPermanentsSchema).min(1).max(16),
});

export const FillBatchWithAbilitiesAndSpellPermanentsSchema = z.object({
  cards: z.array(FilledCardWithAbilitiesAndSpellPermanentsSchema).min(1).max(16),
});

export const FillBatchWithMechanicsAndSpellPermanentsSchema = z.object({
  cards: z.array(FilledCardWithMechanicsAndSpellPermanentsSchema).min(1).max(16),
});

export const FillBatchWithZoneReachSchema = z.object({
  cards: z.array(FilledCardWithZoneReachSchema).min(1).max(16),
});

export const FillBatchWithAbilitiesAndZoneReachSchema = z.object({
  cards: z.array(FilledCardWithAbilitiesAndZoneReachSchema).min(1).max(16),
});

export const FillBatchWithMechanicsAndZoneReachSchema = z.object({
  cards: z.array(FilledCardWithMechanicsAndZoneReachSchema).min(1).max(16),
});

export const FillBatchWithSpellPermanentsAndZoneReachSchema = z.object({
  cards: z.array(FilledCardWithSpellPermanentsAndZoneReachSchema).min(1).max(16),
});

export const FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema = z.object({
  cards: z.array(FilledCardWithAbilitiesAndSpellPermanentsAndZoneReachSchema).min(1).max(16),
});

export const FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema = z.object({
  cards: z.array(FilledCardWithMechanicsAndSpellPermanentsAndZoneReachSchema).min(1).max(16),
});

export type FillBatch =
  | z.infer<typeof FillBatchSchema>
  | z.infer<typeof FillBatchWithAbilitiesSchema>
  | z.infer<typeof FillBatchWithEquipSchema>
  | z.infer<typeof FillBatchWithMechanicsSchema>
  | z.infer<typeof FillBatchWithEquipAndMechanicsSchema>
  | z.infer<typeof FillBatchWithSpellPermanentsSchema>
  | z.infer<typeof FillBatchWithAbilitiesAndSpellPermanentsSchema>
  | z.infer<typeof FillBatchWithMechanicsAndSpellPermanentsSchema>
  | z.infer<typeof FillBatchWithZoneReachSchema>
  | z.infer<typeof FillBatchWithAbilitiesAndZoneReachSchema>
  | z.infer<typeof FillBatchWithMechanicsAndZoneReachSchema>
  | z.infer<typeof FillBatchWithSpellPermanentsAndZoneReachSchema>
  | z.infer<typeof FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema>
  | z.infer<typeof FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema>;

/** True when the allocator gave some slot in this batch an ability kind to print. */
export function batchWantsAbilities(slots: readonly Slot[]): boolean {
  return slots.some((slot) => slot.abilityKinds.length > 0);
}

/**
 * True when some slot in this batch is reserved for a weapon.
 *
 * Read off the reservation rather than off `abilityKinds`, because `activated`
 * is what a Chest and a weapon have in common and the clause is what they do
 * not: a batch holding one of each must be shown the equip schema, and a batch
 * holding only the Chest must not be, or the Chest's own fixtures move.
 */
export function batchWantsEquip(slots: readonly Slot[]): boolean {
  return slots.some((slot) => slot.requiredCard?.equipment === true);
}

/**
 * True when some slot in this batch was reserved for one of the set's own two
 * mechanics: a card that drops a part, or a card that eats a named subtype.
 *
 * One predicate over both, because both widen the same two members and a batch
 * holding one of each must be shown one schema. Read off the reservation for the
 * reason `batchWantsEquip` is: `activated` is what a Chest and a weapon have in
 * common and the clause is what they do not.
 */
export function batchWantsMechanics(slots: readonly Slot[]): boolean {
  return slots.some((slot) => {
    const required = slot.requiredCard;
    if (required === undefined) return false;
    return (
      required.partCounter !== undefined ||
      required.sacrificeSubtype !== undefined ||
      required.suppliesSubtype !== undefined
    );
  });
}

/**
 * True when some slot in this batch prints a permanent the colored pool's spell
 * slots hold: an enchantment or a planeswalker.
 *
 * Read off `cardKind` rather than off the reservation, and that is the one
 * predicate here that is not. `batchWantsEquip` and `batchWantsMechanics` ask
 * about a *field* on a card whose kind is already in the union, so only the
 * brief's reservation can distinguish a weapon from a Chest. This asks whether
 * the union has a member for the card at all, and the allocator answered that
 * when it seated the slot — a brief that states no enchantment or walker role
 * has no such slot, so every batch it builds is shown the schema it always was.
 */
export function batchWantsSpellPermanents(slots: readonly Slot[]): boolean {
  return slots.some((slot) => slot.cardKind === 'enchantment' || slot.cardKind === 'planeswalker');
}

/**
 * The three primitives a batch has to be opted in to say at all.
 *
 * Derived by subtracting the default vocabulary from the wider one, rather than
 * listed, so a fourth promotion lands here by being promoted. The subtraction is
 * also the assertion the tier split rests on: if a kind ever appeared in both,
 * every batch would already be able to say it and the wider tiers would be a
 * schema nobody needs.
 */
const ZONE_REACHING_ONLY_EFFECT_KINDS: ReadonlySet<EffectKind> = (() => {
  // Widened to the shared vocabulary before the subtraction, because the two
  // lists are typed by their own unions and `includes` on the narrower one
  // refuses the wider one's members - which is the compiler stating the very
  // thing being subtracted.
  const shown: readonly EffectKind[] = MODEL_EFFECT_KINDS;
  return new Set(ZONE_REACHING_MODEL_EFFECT_KINDS.filter((kind) => !shown.includes(kind)));
})();

/**
 * True when the allocator gave some slot in this batch an effect kind only the
 * wider union carries.
 *
 * Read off `effectKinds` for the reason `batchWantsSpellPermanents` is read off
 * `cardKind`: the question is whether the union has a member for what the slot
 * was told it may print, and the allocator answered that when it filtered the
 * role's vocabulary through the color pie. A brief that states none of the
 * three zone-reaching roles produces no such slot, so every batch it builds is
 * shown the schema it always was, and every recorded fixture replays.
 *
 * Abilities are deliberately not consulted. `abilityEffectKinds` builds an
 * ability's vocabulary out of `MODEL_EFFECT_KINDS`, so no ability can name one
 * of these kinds no matter which slot carries it, and a batch that wanted this
 * tier for an ability's sake would be a batch widened for a sentence it cannot
 * print.
 */
export function batchWantsZoneReach(slots: readonly Slot[]): boolean {
  return slots.some((slot) => slot.effectKinds.some((kind) => ZONE_REACHING_ONLY_EFFECT_KINDS.has(kind)));
}

/**
 * The wider arm of `fillSchemaFor`, in the same order and for the same reasons.
 *
 * A function rather than six more branches inside the caller: the two arms make
 * the identical three-way decision and writing it twice inline would put the
 * one difference between them — which family of tiers is returned — four levels
 * deep in a conditional, where a reader has to hold both arms at once to see
 * that they agree.
 */
function zoneReachingSchemaFor(
  mechanics: boolean,
  permanents: boolean,
  abilities: boolean,
): ZodType<FillBatch> {
  if (permanents) {
    if (mechanics) return FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema;
    return abilities
      ? FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema
      : FillBatchWithSpellPermanentsAndZoneReachSchema;
  }
  if (mechanics) return FillBatchWithMechanicsAndZoneReachSchema;
  return abilities ? FillBatchWithAbilitiesAndZoneReachSchema : FillBatchWithZoneReachSchema;
}

/**
 * The answer schema this batch is shown, widest first.
 *
 * Every tier below the one a batch needs is byte-identical to what it was before
 * that tier existed, and therefore hashes to the fixture keys it always did.
 * That is the property the whole split is for, and it only holds because the
 * test is on the batch rather than on the package.
 *
 * Fourteen tiers rather than five, and the nine that are combinations are
 * combinations rather than new ideas: the weapons and the Chests are both
 * colorless artifacts, so they land in one batch, and a batch is shown one
 * schema. Folding `attach` into the mechanics tier instead would have offered
 * the clause to a Chest batch whose prompt never explains it, which is the
 * mistake this file is written to avoid pointed the other way.
 *
 * Fourteen and not twenty-eight because two of the four questions cannot both
 * be answered yes: a weapon is a colorless artifact and neither an enchantment
 * slot nor a zone-reaching one can be stated in the colorless pool, so the two
 * pairs below are thrown rather than tiered.
 *
 * The return type is `ZodType<FillBatch>` rather than the union of the eight
 * schema types, and that is load-bearing at the call site rather than tidiness
 * here. `provider.complete<T>` infers `T` from the schema it is handed, and from
 * a union of schema types it infers the one arm the others are assignable to.
 * That worked while every tier only *added* fields; the enchantment tiers break
 * it, because the base tier's enchantment requires an `aura` clause and the
 * ability tier's makes it optional, and under `exactOptionalPropertyTypes` an
 * optional property is not assignable to a required one. Naming the union that
 * every tier really does produce says the true thing once instead of leaving the
 * compiler to guess it eight times.
 */
export function fillSchemaFor(slots: readonly Slot[]): ZodType<FillBatch> {
  const equip = batchWantsEquip(slots);
  const mechanics = batchWantsMechanics(slots);
  const permanents = batchWantsSpellPermanents(slots);
  const zoneReach = batchWantsZoneReach(slots);
  // A batch cannot be both, and the reason is structural rather than a policy
  // this function is enforcing: a weapon is an artifact (CR 301.5), artifact
  // slots exist only in the colorless pool, `briefSchema` refuses the
  // enchantment and walker roles there, and `batchSlots` never mixes two pools.
  // Thrown rather than silently resolved to one of the two, because whichever
  // way it resolved would show a batch a schema missing a member some slot in it
  // needs, and the first evidence would be a live run that costs money.
  if (equip && permanents) {
    const ids = slots.map((slot) => slot.id).join(', ');
    throw new Error(
      `fillSchemaFor: batch [${ids}] holds both a weapon and an enchantment or planeswalker slot. ` +
        'An Equipment is an artifact and only the colorless pool prints artifacts, so no allocation ' +
        'should produce this batch; fix the allocator rather than adding a combined tier.',
    );
  }
  // The same structural impossibility one primitive down, and refused the same
  // way. `briefSchema` refuses the zone-reaching roles in the colorless pool,
  // artifact slots exist only there, and `batchSlots` never mixes two pools, so
  // no allocation puts a weapon and a zone-reaching spell in one batch.
  if (equip && zoneReach) {
    const ids = slots.map((slot) => slot.id).join(', ');
    throw new Error(
      `fillSchemaFor: batch [${ids}] holds both a weapon and a slot allowed exileTarget, scry or ` +
        'returnFromGraveyard. An Equipment is an artifact, only the colorless pool prints artifacts, ' +
        'and the colorless pool cannot state those roles; fix the allocator rather than adding a ' +
        'combined tier.',
    );
  }
  if (zoneReach) return zoneReachingSchemaFor(mechanics, permanents, batchWantsAbilities(slots));
  if (permanents) {
    if (mechanics) return FillBatchWithMechanicsAndSpellPermanentsSchema;
    return batchWantsAbilities(slots)
      ? FillBatchWithAbilitiesAndSpellPermanentsSchema
      : FillBatchWithSpellPermanentsSchema;
  }
  if (equip && mechanics) return FillBatchWithEquipAndMechanicsSchema;
  if (mechanics) return FillBatchWithMechanicsSchema;
  if (equip) return FillBatchWithEquipSchema;
  return batchWantsAbilities(slots) ? FillBatchWithAbilitiesSchema : FillBatchSchema;
}
