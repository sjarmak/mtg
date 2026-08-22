/**
 * CR 113 abilities printed on a permanent.
 *
 * The shape of an ability — its three kinds, its activation cost, its static
 * modification — is `ability-shape.ts`, which is generic over the effect union
 * it is handed and which explains why that split exists. This file is the one
 * application of it that a card uses: `AbilitySchema` is the three kinds over
 * the *full* effect vocabulary. The other application is a token's ability
 * list, which drops `createToken` (`effects.ts`).
 *
 * `ModelAbilitySchema` is the third application, and it arrived with the
 * consumer that needed it (`mtg-bc2.132.3`): the same three kinds over
 * `ModelEffectSchema`, the effect vocabulary `@mtg/setgen` puts in front of the
 * model. Two unions out of one factory, exactly as `effects.ts` builds two out
 * of one list of primitives.
 */
import { z } from 'zod';
import {
  abilitiesOver,
  ActivationCostSchema,
  AttachSchema,
  MechanicModelActivationCostSchema,
  LoyaltyCostSchema,
  ModelActivationCostSchema,
  ModelAttachSchema,
  ModelStaticModificationSchema,
  OptionalTriggerSchema,
  StaticModificationSchema,
} from './ability-shape';
import { canonicalJson } from './canonical-json';
import { mana } from './mana';
import { ConditionSchema } from './condition';
import {
  effectChoosesTarget,
  CardEffectSchema,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
} from './effects';
import type { Attach } from './ability-shape';
import type { AbilityKind } from './vocabulary';
import { ABILITY_KINDS, ModelTriggerConditionSchema } from './vocabulary';

export {
  ActivationCostSchema,
  LoyaltyCostSchema,
  AttachSchema,
  ATTACH_MODIFICATION_LIMITS,
  EQUIPMENT_SUBTYPE,
  ModelActivationCostSchema,
  ModelAttachSchema,
  OptionalTriggerSchema,
  SacrificeOtherSchema,
  StaticModificationSchema,
  abilitiesOver,
  LayeredStaticModificationSchema,
  AttachModificationSchema,
  CombatModificationSchema,
} from './ability-shape';
export type {
  ActivationCost,
  ActivationCostInput,
  LoyaltyCost,
  Attach,
  ModelAttach,
  SacrificeOther,
  StaticModification,
  StaticModificationOf,
  LayeredStaticModification,
  AttachModification,
  CombatModification,
} from './ability-shape';

/**
 * The engine's ability union: the three kinds over the full effect vocabulary,
 * and the one union that carries CR 702.6b's equip clause.
 *
 * The third argument is the activated member's extra fields, and it says two
 * things at once. `attach` is the clause itself. `effects` is the floor that
 * clause needs: an ability that attaches prints no effect, so the shared
 * minimum of one is dropped here rather than for everybody — the generator's
 * union and a token's keep it, and an activated ability with neither an
 * attachment nor an effect is refused by `checkActivatedAbility` as
 * `ABILITY_WITHOUT_EFFECT`, with a path a repair loop can act on rather than an
 * opaque parse failure.
 *
 * The field stays required rather than defaulting to `[]`, so an equip ability
 * writes `effects: []` and says out loud that the clause replaces the list.
 * That is also the only spelling TypeScript resolves: a `.default()` on an
 * array of the effect union collapses the union's *input* type to `undefined`,
 * which turns every hand-written card fixture in the workspace red.
 *
 * The fourth argument is CR 603.3b's "you may", which belongs to this union and
 * to a token's; `ability-shape.ts` argues why the generator's two go without it.
 *
 * The fifth argument is CR 611.2c's conditional continuous effect: a static
 * whose modification applies only "as long as" its `Condition` holds. It
 * belongs to this union alone — no token in the flagship set prints one, and
 * a field added to the schema the model is shown renames every recorded
 * fixture (`packages/llm/src/schema.ts` hashes the answer schema), so the
 * generator's five unions below all leave it unfilled.
 *
 * `.optional()` rather than `.nullable().default(null)`, for the `effects`
 * field's own reason above: a default fills the key back in on the *output*
 * type, which makes it required TypeScript-side and turns every hand-written
 * `StaticAbility` literal in the workspace — `@mtg/deckbuild`'s evaluator,
 * `oracle.ts`, `token.ts`, `@mtg/forge-export`'s script writers, and every
 * fixture in `abilityFromModel`'s own containment proof — red for a field
 * that was never in scope to touch. An absent key and an explicit `null` both
 * mean unconditional; `abilities.ts` (kernel) normalizes with `?? null` at
 * its one read site rather than asking every producer to write the key.
 */
export const AbilitySchema = abilitiesOver(
  CardEffectSchema,
  ActivationCostSchema,
  {
    attach: AttachSchema.optional(),
    loyaltyCost: LoyaltyCostSchema.optional(),
    regenerateSelf: z.literal(true).optional(),
    effects: z.array(CardEffectSchema).max(2),
  },
  { optional: OptionalTriggerSchema },
  { enabledWhile: ConditionSchema.nullable().optional() },
  StaticModificationSchema,
);

export type Ability = z.infer<typeof AbilitySchema>;
export type AbilityInput = z.input<typeof AbilitySchema>;

/** Narrows to the ability variant carrying a given kind. */
export type AbilityOf<K extends AbilityKind> = Extract<Ability, { kind: K }>;
export type StaticAbility = AbilityOf<'static'>;
export type TriggeredAbility = AbilityOf<'triggered'>;
export type ActivatedAbility = AbilityOf<'activated'>;

/** The one canonical structured spelling of CR 702.83 exalted. */
export type ExaltedAbility = TriggeredAbility & {
  readonly condition: 'controlledCreatureAttacksAlone';
  readonly effects: readonly [
    Extract<TriggeredAbility['effects'][number], { kind: 'pumpUntilEndOfTurn' }> & {
      readonly power: 1;
      readonly toughness: 1;
      readonly target: { readonly kind: 'triggeringCreature' };
    },
  ];
};

/** Builds one independent exalted instance for a hand-authored card. */
export function exaltedAbility(): ExaltedAbility {
  return {
    kind: 'triggered',
    condition: 'controlledCreatureAttacksAlone',
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 1,
        target: { kind: 'triggeringCreature' },
      },
    ],
  };
}

/** True only for the exact current-rules exalted envelope. */
export function isExaltedAbility(ability: Ability): ability is ExaltedAbility {
  if (ability.kind !== 'triggered' || ability.condition !== 'controlledCreatureAttacksAlone') {
    return false;
  }
  if (ability.optional === true || ability.effects.length !== 1) return false;
  const effect = ability.effects[0];
  return (
    effect?.kind === 'pumpUntilEndOfTurn' &&
    effect.power === 1 &&
    effect.toughness === 1 &&
    effect.target.kind === 'triggeringCreature' &&
    effect.target.distinct !== true
  );
}

/**
 * the flagship set's Flurry rush, CR 702-shaped but an ability word rather
 * than a keyword: `Flurry rush N` is one triggered ability with a fixed
 * envelope, and the printed word is a label on that envelope rather than a
 * grant a layer applies.
 *
 * Exalted is the precedent and the shape is deliberately the same one
 * (`ExaltedAbility` above): a canonical structured spelling, a builder that is
 * the only way a hand-authored card gets one, and a recognizer the renderer
 * calls so the printed line is the word instead of the sentence. The single
 * difference is the rank — exalted has no number and this does — so the
 * recognizer returns the rank rather than a boolean, and `null` is "this is not
 * Flurry rush" rather than a rank of zero. A rank of zero would be a printable
 * `Flurry rush 0`, which deals no damage and is a card nobody wrote; the
 * builder refuses it for the same reason `checkAbilities` refuses a free
 * repeatable ability.
 *
 * The damage is `dealDamage` at a literal amount rather than a computed one,
 * because the rank is printed on the card and a computed amount would make the
 * printed word ambiguous — the reminder text has to be able to say the number.
 */
export type FlurryRushAbility = TriggeredAbility & {
  readonly condition: 'selfBlocksOrIsBlockedByGreaterPower';
  readonly effects: readonly [
    Extract<TriggeredAbility['effects'][number], { kind: 'dealDamage' }> & {
      readonly amount: number;
      readonly target: { readonly kind: 'triggeringCreature' };
    },
  ];
};

/** Builds one independent `Flurry rush N` instance for a hand-authored card. */
export function flurryRushAbility(rank: number): FlurryRushAbility {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`flurry rush rank must be a positive integer, not ${rank}`);
  }
  return {
    kind: 'triggered',
    condition: 'selfBlocksOrIsBlockedByGreaterPower',
    effects: [
      {
        kind: 'dealDamage',
        amount: rank,
        target: { kind: 'triggeringCreature' },
      },
    ],
  };
}

/**
 * The rank this ability prints as `Flurry rush N`, or `null` when the ability is
 * not the exact envelope.
 *
 * A trigger on the same condition that does something else is a legal
 * hand-authored ability and prints its sentence in full — the condition is not
 * reserved the way `controlledCreatureAttacksAlone` is, because the two halves
 * of one block are a genuinely reusable event and exalted's lone attacker is
 * not. What is reserved is the *word*: only this envelope earns it.
 */
export function flurryRushRank(ability: Ability): number | null {
  if (ability.kind !== 'triggered' || ability.condition !== 'selfBlocksOrIsBlockedByGreaterPower') {
    return null;
  }
  if (ability.optional === true || ability.effects.length !== 1) return null;
  const effect = ability.effects[0];
  if (effect?.kind !== 'dealDamage') return null;
  if (typeof effect.amount !== 'number' || !Number.isInteger(effect.amount) || effect.amount < 1) {
    return null;
  }
  if (effect.target.kind !== 'triggeringCreature' || effect.target.distinct === true) return null;
  return effect.amount;
}

/**
 * the flagship set's Gloom, the second ability word on the same footing as
 * Flurry rush above and built the same way: `Gloom N` is one triggered ability
 * with a fixed envelope, and the printed word is a label on that envelope.
 *
 * The shape is real Magic's Toxic (CR 702.180), with two substitutions the set
 * makes deliberately. Toxic hands poison counters to a *player*; gloom counters
 * go on the *creature* that took the damage, because a gloom counter is a
 * -1/-1 counter with an identity of its own (`COUNTER_DECLARATIONS`) and the
 * set's black removal reads it - "destroy target creature with a gloom counter
 * on it" is a card that needs bodies to be marked, and combat is the marker.
 * So the trigger is `selfDealsCombatDamageToCreature`, whose retained referent
 * is exactly the creature that was hit, and the effect aims at it rather than
 * at a target anybody chooses.
 *
 * Not wither, which is the other reading of "it deals its damage in gloom
 * counters" and a different mechanic: wither *replaces* the damage, so a 3/3
 * with wither deals no damage at all and leaves three counters. That is a
 * replacement effect (CR 614), and `packages/kernel/src/replacement.ts` says
 * plainly that the DSL cannot emit one yet. This ability is additive - the
 * damage happens and the counters land on top of it - which is Toxic's own
 * arithmetic and is expressible today with no engine change.
 *
 * The rank is a literal `count` for the reason Flurry rush's amount is a
 * literal: the number is printed on the card and the reminder text has to be
 * able to say it. A rank of zero is refused by the builder, because `Gloom 0`
 * is a printable line that does nothing.
 */
export type GloomAbility = TriggeredAbility & {
  readonly condition: 'selfDealsCombatDamageToCreature';
  readonly effects: readonly [
    Extract<TriggeredAbility['effects'][number], { kind: 'putCounters' }> & {
      readonly counter: 'gloom';
      readonly count: number;
      readonly target: { readonly kind: 'triggeringCreature' };
    },
  ];
};

/** Builds one independent `Gloom N` instance for a hand-authored card. */
export function gloomAbility(rank: number): GloomAbility {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`gloom rank must be a positive integer, not ${rank}`);
  }
  return {
    kind: 'triggered',
    condition: 'selfDealsCombatDamageToCreature',
    effects: [
      {
        kind: 'putCounters',
        counter: 'gloom',
        count: rank,
        target: { kind: 'triggeringCreature' },
      },
    ],
  };
}

/**
 * The rank this ability prints as `Gloom N`, or `null` when the ability is not
 * the exact envelope.
 *
 * `selfDealsCombatDamageToCreature` is a shared condition and stays one: the
 * set's white-green legend grows himself off it, and a trigger on it that puts
 * a different counter, or puts one somewhere a player chose, prints its
 * sentence in full. What the word is reserved for is this envelope - gloom
 * counters, on the creature the damage was dealt to, mandatory.
 */
export function gloomRank(ability: Ability): number | null {
  if (ability.kind !== 'triggered' || ability.condition !== 'selfDealsCombatDamageToCreature') {
    return null;
  }
  if (ability.optional === true || ability.effects.length !== 1) return null;
  const effect = ability.effects[0];
  if (effect?.kind !== 'putCounters' || effect.counter !== 'gloom') return null;
  if (typeof effect.count !== 'number' || !Number.isInteger(effect.count) || effect.count < 1) {
    return null;
  }
  if (effect.target.kind !== 'triggeringCreature' || effect.target.distinct === true) return null;
  return effect.count;
}

/**
 * The ability shape the set generator may answer with: the same three kinds,
 * over the narrower effect vocabulary.
 *
 * A strict subset of `Ability` in both directions that matter. Every
 * `ModelAbility` is an `Ability`, which is what `ModelAbilityIsAbility` below
 * proves at compile time and what keeps the generator's output space inside the
 * engine's enforceable space. And the containment is strict rather than equal:
 * `putCounters` is an `Effect` and not a `ModelEffect`, so an ability that
 * places a counter is expressible by hand and unreachable from the generator,
 * which is `effects.ts`'s decision and not a second one taken here.
 *
 * The cost narrows for the same reason, and this one *is* a decision taken
 * here. `sacrificeOther` names a subtype, and a cost naming a subtype is only
 * payable on a board that has one — a Chest costing two Keys in a set whose
 * Monsters drop none is a card that never activates. Which subtypes a set
 * supplies is a question about the whole set rather than about one slot, and
 * `@mtg/setgen` fills slots one at a time. So the field is expressible by hand,
 * reachable by a designer, and unreachable from the generator until something
 * asks the set-wide question.
 *
 * `mtg-bc2.152.6` narrows the activation cost a second way, for a different
 * reason: `mana.hasX` prices a caster-chosen X, no design note here asks a
 * model to fill in, and offering it would rename every recorded ability
 * fixture for a field the prompt never explains — `filled.ts`'s
 * `ModelManaCostSchema` argument, applied to this cost too
 * (`ModelActivationCostSchema` in `ability-shape.ts`). Unlike `sacrificeOther`,
 * which is optional on the engine's side and simply absent here, `hasX` is
 * `.default()`-backed and therefore *required* on `Ability`'s inferred type,
 * so its absence is not free: `abilityFromModel` is where it is filled back
 * in, and `ModelAbilityIsAbility` is written against the type that function
 * actually receives rather than against `Ability` unmodified.
 */
export const ModelAbilitySchema = abilitiesOver(
  ModelEffectSchema,
  ModelActivationCostSchema,
  {},
  {},
  {},
  ModelStaticModificationSchema,
  ModelTriggerConditionSchema,
);

export type ModelAbility = z.infer<typeof ModelAbilitySchema>;
export type ModelAbilityInput = z.input<typeof ModelAbilitySchema>;
export type ModelAbilityKind = ModelAbility['kind'];

/**
 * `Ability`, with its `activated` member's `cost.mana.hasX` loosened to
 * absent — the one field `abilityFromModel` fills rather than passes through
 * unchanged. Derived from `ActivatedAbility` itself rather than restated, so a
 * field added to `ManaCostSchema` or `ActivationCostSchema` tomorrow changes
 * this type automatically and `ModelAbilityIsAbility` keeps checking against
 * whatever `Ability` currently means.
 */
type ActivatedAbilityForModel = Omit<ActivatedAbility, 'cost'> & {
  cost: Omit<ActivatedAbility['cost'], 'mana'> & {
    mana: Omit<ActivatedAbility['cost']['mana'], 'hasX'>;
  };
};

/**
 * Compile-time proof that the model's union is a subset of the engine's,
 * modulo the one field `abilityFromModel` fills at the crossing.
 *
 * Every `ModelAbility` reaches `Ability` through `abilityFromModel` —
 * `assembleCard` hands nothing else to `CardSchema` — and TypeScript already
 * checks that function's body is total against its declared `Ability` return
 * type, so a change to `putCounters`-style containment (a kind or effect the
 * model can propose that the function cannot turn into a real `Ability`)
 * already fails to compile there. This alias checks the one thing that proof
 * does not: that nothing *else* has drifted between the two unions. A test
 * assigns `true` to this alias, which is the same device `exhaustive.ts` uses
 * for the vocabulary tuples; widening `ModelEffectSchema` past `EffectSchema`,
 * or a field added to one side of the cost and not the other, resolves it to
 * `never` and `npm run typecheck` stops.
 */
export type ModelAbilityIsAbility = ModelAbility extends
  Exclude<Ability, ActivatedAbility> | ActivatedAbilityForModel
  ? true
  : never;

/**
 * The model's union again, plus CR 702.6b's equip clause.
 *
 * ## Why this is a fourth union rather than a field on the third
 *
 * A fixture key is `hash(system, prompt, schema)`, so a field added to the
 * schema every fill call is shown renames every fixture already recorded,
 * whether or not the brief asked for the field — measured, not assumed: adding
 * `attach` to `ModelAbilitySchema` strands `packages/setgen/fixtures/
 * llm-hearthglass/` on the first batch, and getting it back is a live run.
 * `packages/setgen/src/filled.ts` already answers that with a schema chosen per
 * batch, and this is the union the third tier of that choice is built over. A
 * batch holding no weapon is shown the schema it was shown before and replays
 * for free.
 *
 * ## What the extra fields say
 *
 * The same two the engine's union says, for the same reasons `AbilitySchema`
 * gives: `attach` is the clause, and dropping the effect floor to zero is what
 * that clause needs, because an ability that attaches prints no effect. An
 * activated ability that arrives with neither is refused by
 * `checkActivatedAbility` as `ABILITY_WITHOUT_EFFECT`, which is a path the
 * repair loop can act on rather than a parse failure the model cannot read.
 *
 * The clause itself is `ModelAttachSchema` and not the engine's `AttachSchema`,
 * which is the one place the two tiers differ in shape rather than only in
 * vocabulary; `ability-shape.ts` argues why the model's stayed singular when the
 * engine's became a list.
 *
 * The cost stays `ModelActivationCostSchema`, so a weapon may not equip by
 * eating a Key. That is not an oversight: the reason `sacrificeOther` is outside
 * the model's space — which subtypes a set supplies is a question about the
 * whole set, and `@mtg/setgen` fills slots one at a time — is untouched by
 * anything equip needs.
 */
export const AttachingModelAbilitySchema = abilitiesOver(
  ModelEffectSchema,
  ModelActivationCostSchema,
  {
    attach: ModelAttachSchema.optional(),
    effects: z.array(ModelEffectSchema).max(2),
  },
  {},
  {},
  ModelStaticModificationSchema,
  ModelTriggerConditionSchema,
);

export type AttachingModelAbility = z.infer<typeof AttachingModelAbilitySchema>;
export type AttachingModelAbilityInput = z.input<typeof AttachingModelAbilitySchema>;

/**
 * The model's union again, with the two clauses the flagship set's own
 * mechanics need: a cost that eats a named subtype, and a token that may be a
 * part.
 *
 * ## Why the cost is the engine's own rather than a narrower one
 *
 * `ModelActivationCostSchema` omits `sacrificeOther` because a cost naming a
 * subtype is only payable on a board that supplies one, and which subtypes a
 * set supplies is a question about the whole set while `@mtg/setgen` fills slots
 * one at a time. The brief is what answers a question about the whole set, and
 * it now does: `RequiredCard.sacrificeSubtype` names the permanent this card
 * eats, `checkSacrificeSupply` fails a set whose cards create no such permanent,
 * and `checkSlotConformance` fails a card that ate something else. The argument
 * is answered rather than stepped around, so the field is offered here — to the
 * batches the brief pointed at, and to no others.
 *
 * That is the argument for `sacrificeOther`; it is not an argument for `{X}`
 * on the nested `mana`, which no brief here asks for either, so the cost is
 * `MechanicModelActivationCostSchema` — the engine's own cost with `mana`
 * narrowed the same way every other model tier's is — rather than
 * `ActivationCostSchema` unnarrowed.
 *
 * ## Why this is a fifth union rather than a field on an existing one
 *
 * The reason `AttachingModelAbilitySchema` is a fourth: a fixture key is
 * `hash(system, prompt, schema)`, so widening a schema every fill call is shown
 * renames every recorded fixture whether or not the brief wanted the field.
 * Every batch that asks for neither mechanic is shown exactly what it was shown
 * before.
 */
export const MechanicModelAbilitySchema = abilitiesOver(
  PartBearingModelEffectSchema,
  MechanicModelActivationCostSchema,
  {},
  {},
  {},
  ModelStaticModificationSchema,
  ModelTriggerConditionSchema,
);

export type MechanicModelAbility = z.infer<typeof MechanicModelAbilitySchema>;

/**
 * The fifth union plus CR 702.6b's equip clause, for the batch that holds both a
 * weapon and one of the two mechanics.
 *
 * A sixth union exists because a batch is one schema and a colorless artifact
 * batch is where the weapons and the Chests both live. The alternative was to
 * put `attach` on the fifth, which would offer the clause to a batch whose
 * prompt never explains it — the exact mistake `filled.ts` is written to avoid,
 * pointed the other way.
 *
 * The clause is `ModelAttachSchema`, exactly as the fourth tier's is, and for
 * the same recorded-fixture reason: the widening to a list of modifications
 * stopped at the engine, so every tier the model answers with states one
 * modification in the field the model has always been shown.
 */
export const AttachingMechanicModelAbilitySchema = abilitiesOver(
  PartBearingModelEffectSchema,
  MechanicModelActivationCostSchema,
  {
    attach: ModelAttachSchema.optional(),
    effects: z.array(PartBearingModelEffectSchema).max(2),
  },
  {},
  {},
  ModelStaticModificationSchema,
  ModelTriggerConditionSchema,
);

export type AttachingMechanicModelAbility = z.infer<typeof AttachingMechanicModelAbilitySchema>;

/**
 * The alias that keeps `filledAbilities` honest: it reads a filled card's
 * abilities back as the widest tier whichever of the five the card came from,
 * and that is only true if every narrower union is assignable to this one. It
 * resolves to `never` the moment a tier gains something the widest cannot hold.
 */
export type AttachingModelAbilityIsMechanicAbility =
  AttachingModelAbility extends AttachingMechanicModelAbility ? true : never;

/**
 * CR 606.1's loyalty ability, as the generator may answer with one.
 *
 * ## Why this is a shape rather than a seventh tier of the ability union
 *
 * Every other model tier is `abilitiesOver(...)`: the three kinds, widened
 * somewhere. A planeswalker cannot print two of those three kinds at all —
 * `checkAbilities` refuses a static or a triggered ability on one, in this
 * bounded envelope — so a union of three offered to a walker slot would have
 * two arms whose only possible use is a card the validator sends straight back.
 * That is the mistake `filled.ts` argues against for a *field* the prompt never
 * explains, and it costs the same here: a repair round spent asking the model to
 * abandon a design the card type never permitted.
 *
 * What is left of the activated member once the walker's rules are applied is
 * this object, and the fields it drops are dropped because the rules leave
 * nothing to say:
 *
 *  - `cost` is gone. CR 606.2: a loyalty ability's cost *is* the signed loyalty
 *    change, and `checkActivatedAbility` refuses one that also charges mana,
 *    taps, or sacrifices. A cost field here could hold exactly one legal value,
 *    so it is filled at the crossing rather than asked for.
 *  - `attach` is gone. An Equipment is an artifact (CR 301.5), and a walker is
 *    not one.
 *  - `kind` is gone. It is the discriminator of a union this shape is not a
 *    member of, and every ability a walker may print is activated, so the field
 *    could hold one value and the only answer it admits that is not that value
 *    is a card the validator refuses. `loyaltyAbilityFromModel` stamps it, the
 *    way `@mtg/setgen` stamps an Aura's one legal subtype.
 *
 * `loyaltyCost` is required rather than optional, which is the same rule
 * `checkActivatedAbility` states from the other side: every activated ability on
 * a planeswalker states a signed loyalty cost. Required in the schema means the
 * model cannot omit it; the validator's message stays for a hand-authored card.
 *
 * The effects floor of one is the shared floor, kept: a loyalty ability that
 * costs the walker two counters and does nothing is not a design.
 */
export const LoyaltyModelAbilitySchema = z.strictObject({
  loyaltyCost: LoyaltyCostSchema,
  effects: z.array(ModelEffectSchema).min(1).max(2),
});

export type LoyaltyModelAbility = z.infer<typeof LoyaltyModelAbilitySchema>;
export type LoyaltyModelAbilityInput = z.input<typeof LoyaltyModelAbilitySchema>;

/**
 * One loyalty ability the generator answered with, as the ability the engine
 * runs.
 *
 * `abilityFromModel` for the walker tier, and a second function rather than a
 * branch inside that one because the two take different shapes: this one's
 * parameter has no `cost` to spread forward, so the free cost is *stated* here
 * rather than passed through. The annotated return type is the containment
 * proof, exactly as it is there — a field added to `ActivationCostSchema` or to
 * the activated member stops this file compiling rather than shipping a walker
 * the kernel cannot pay for.
 *
 * The stated cost is the only cost CR 606.2 admits: no mana, no tap, no
 * sacrifice. `checkActivatedAbility` reads it back and would refuse anything
 * else, so this is the one value the omitted field could have held.
 */
export function loyaltyAbilityFromModel(ability: LoyaltyModelAbility): Ability {
  return {
    kind: 'activated',
    cost: { mana: mana(), tapSelf: false, sacrificeSelf: false },
    loyaltyCost: ability.loyaltyCost,
    effects: [...ability.effects],
  };
}

/**
 * One ability the generator answered with, as the ability the engine runs.
 *
 * This is what `ModelAbilityIsAbility` is for the narrowest tier: the proof that
 * a generated ability lands inside the engine's enforceable space. It is a
 * function rather than a type alias because two things the model's tiers and
 * the engine's are shaped differently need an actual value, not just a wider
 * type: the equip clause, where the model states one modification and the
 * engine holds a list, and `cost.mana.hasX`, absent from every model-facing
 * cost and required on the engine's. So containment is a total mapping
 * instead of an assignment, and the annotated return type is what fails to
 * compile if the mapping ever stops producing an `Ability`.
 *
 * It takes the widest of the model's five unions, so one crossing serves every
 * tier: the narrower four are assignable to this parameter, which is what
 * `AttachingModelAbilityIsMechanicAbility` proves for the one that is not
 * obviously so.
 *
 * Total by construction: every ability that is not an equip clause crosses
 * unchanged, and the one that is crosses with its single modification wrapped
 * into the list of one that `AttachSchema` requires. Nothing is widened here and
 * nothing is dropped, so a card assembled through this function says exactly
 * what the model said — with one exception, argued below.
 *
 * The one exception is `cost.mana.hasX`: `ability-shape.ts`'s model-facing cost
 * schemas all omit it, the same way `filled.ts`'s `ModelManaCostSchema` omits it
 * from a spell's own cost, so `rest.cost.mana` carries no such field to spread
 * forward. `false` is not a claim about the ability — no printed activation cost
 * a design note asks for here prices itself with a caster-chosen X — it is the
 * same fact `ManaCostSchema`'s own default states for every cost parsed before
 * the field existed, applied at the one seam a generated ability crosses into
 * the engine's contract.
 */
export function abilityFromModel(ability: AttachingMechanicModelAbility): Ability {
  if (ability.kind !== 'activated') return ability;
  // Destructured even when there is no clause, because the key carries the
  // model's type wherever it goes: under `exactOptionalPropertyTypes` an
  // `attach?: ModelAttach` is not an `attach?: Attach` even holding
  // `undefined`, so dropping the key is what says "this ability has no clause"
  // rather than "this ability has the wrong one".
  const { attach, ...rest } = ability;
  const cost = { ...rest.cost, mana: { ...rest.cost.mana, hasX: false } };
  if (attach === undefined) return { ...rest, cost };
  return { ...rest, cost, attach: { modifications: [attach.modification] } };
}

/**
 * Read off the model's own schema, so the two cannot drift — the device
 * `MODEL_EFFECT_KINDS` uses, for the same reason. `@mtg/setgen` prints this list
 * into the fill prompt, so a kind the model is told about is a kind the schema
 * accepts, by construction rather than by two lists agreeing.
 */
export const MODEL_ABILITY_KINDS: readonly ModelAbilityKind[] = ModelAbilitySchema.options.map(
  (option) => option.shape.kind.value,
);

/** Narrows an engine ability kind to one the generator may print. */
export function isModelAbilityKind(kind: AbilityKind): kind is ModelAbilityKind {
  return (MODEL_ABILITY_KINDS as readonly AbilityKind[]).includes(kind);
}

/**
 * An activated ability that attaches its source (CR 702.6b), narrowed so the
 * clause is no longer optional.
 *
 * The guard is what every consumer uses instead of reading the field, so "this
 * is an equip ability" is one predicate rather than an `!== undefined` repeated
 * in the renderer, the validator, the enumeration and the reducer.
 */
export type AttachingAbility = ActivatedAbility & { readonly attach: Attach };

export function isAttachingAbility(ability: Ability): ability is AttachingAbility {
  return ability.kind === 'activated' && ability.attach !== undefined;
}

/** A paid activated ability that creates a one-use self-regeneration shield. */
export type RegenerationAbility = ActivatedAbility & { readonly regenerateSelf: true };

export function isRegenerationAbility(ability: Ability): ability is RegenerationAbility {
  return ability.kind === 'activated' && ability.regenerateSelf === true;
}

/** A loyalty ability, narrowed so the signed cost is present. */
export type LoyaltyAbility = ActivatedAbility & { readonly loyaltyCost: number };

export function isLoyaltyAbility(ability: Ability): ability is LoyaltyAbility {
  return ability.kind === 'activated' && ability.loyaltyCost !== undefined;
}

/**
 * A triggered ability whose controller is asked whether to carry it out (CR
 * 603.3b), narrowed so the field is no longer optional.
 *
 * The guard rather than the field, for the reason `isAttachingAbility` is a
 * guard: "this is a may trigger" is asked by the renderer, the validator, the
 * kernel's resolution stop and the bots, and four `=== true` comparisons are
 * four chances to write one of them as a truthiness test on `true | undefined`.
 */
export type OptionalTrigger = TriggeredAbility & { readonly optional: true };

export function isOptionalTrigger(ability: Ability): ability is OptionalTrigger {
  return ability.kind === 'triggered' && ability.optional === true;
}

/**
 * True when this trigger must choose targets as it is put on the stack (CR
 * 603.3d).
 *
 * The one owner of that question. The kernel asks it three times over — to
 * decide whether to stop for a decision, to decide whether the ability is
 * removed for having no legal target, and to decide whether an entry sitting on
 * the stack still owes an answer — and a second copy anywhere would be a way for
 * the stop and the removal to disagree about the same ability.
 */
export function triggerChoosesTargets(ability: TriggeredAbility): boolean {
  return ability.effects.some((effect) => effectChoosesTarget(effect));
}

/** Abilities whose payload is an effect list; a static ability has none. */
export type EffectBearingAbility = Extract<Ability, { effects: unknown }>;

/** Runtime guard for the effect-bearing subset; keeps callers free of casts. */
export function hasAbilityEffects(ability: Ability): ability is EffectBearingAbility {
  return 'effects' in ability;
}

/**
 * Canonical ability order: vocabulary order by kind, then the ability's own
 * canonical JSON. Used by the fingerprints, which must not distinguish two
 * cards that differ only in the order their abilities were authored.
 */
export function sortAbilities(abilities: readonly Ability[]): Ability[] {
  return [...abilities].sort((a, b) => {
    const byKind = ABILITY_KINDS.indexOf(a.kind) - ABILITY_KINDS.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    const left = canonicalJson(a);
    const right = canonicalJson(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
