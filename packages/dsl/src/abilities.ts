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
import type { ZodType } from 'zod';
import type { ManaCost } from './mana';
import { CounterKindSchema, type CounterKind } from './counters';
import {
  abilitiesOver,
  ActivationCostSchema,
  AttachSchema,
  FixedLoyaltyCostSchema,
  MechanicModelActivationCostSchema,
  LoyaltyCostSchema,
  ModelActivationCostSchema,
  ModelAttachSchema,
  ModelStaticModificationSchema,
  OptionalTriggerSchema,
  StaticScopeFilterSchema,
  StaticBundleModificationSchema,
  StaticModificationSchema as StaticModificationWithoutTriggeredAbilitySchema,
  staticModificationsWithTriggeredAbility,
  layeredStaticModificationsWithTriggeredAbility,
} from './ability-shape';
import { canonicalJson } from './canonical-json';
import { CardFilterSchema } from './card-filter';
import { mana, manaValue, ManaCostSchema } from './mana';
import { ModesSchema } from './modal';
import { ConditionSchema } from './condition';
import {
  effectChoosesTarget,
  CardEffectSchema,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
} from './effects';
import type { Effect } from './effects';
import type { Attach, LoyaltyCost } from './ability-shape';
import type { AbilityKind } from './vocabulary';
import {
  ABILITY_KINDS,
  BasicLandTypeSchema,
  COLORS,
  ColorSchema,
  EngineStaticScopeSchema,
  ModelTriggerConditionSchema,
  StaticGameRuleSchema,
  StaticPlayerRuleSchema,
  SUBTYPE_PATTERN,
  TriggerConditionSchema,
} from './vocabulary';

/** A nonempty, duplicate-free spell-color filter in canonical WUBRG order. */
const SpellColorsSchema = z
  .array(ColorSchema)
  .min(1)
  .max(COLORS.length)
  .refine((colors) => new Set(colors).size === colors.length, 'spellColors must not repeat a color')
  .refine(
    (colors) =>
      colors.every(
        (color, index) => index === 0 || COLORS.indexOf(colors[index - 1]!) < COLORS.indexOf(color),
      ),
    'spellColors must use WUBRG order',
  );

const CounterUnlessCostSchema = ManaCostSchema.refine(
  (cost) => !cost.hasX && manaValue(cost) > 0,
  'a counter toll must be a fixed, nonzero mana cost',
);

export {
  ActivationCostSchema,
  FixedLoyaltyCostSchema,
  LoyaltyCostSchema,
  AttachSchema,
  ATTACH_MODIFICATION_LIMITS,
  EQUIPMENT_SUBTYPE,
  ModelActivationCostSchema,
  ModelAttachSchema,
  OptionalTriggerSchema,
  SacrificeOtherSchema,
  SacrificeMatchingSchema,
  TapMatchingSchema,
  StaticScopeFilterSchema,
  abilitiesOver,
  AttachModificationSchema,
  AttackAdmissionSchema,
  CombatModificationSchema,
  DamagePreventionModificationSchema,
  StaticBundleModificationSchema,
} from './ability-shape';
export { RemoveCounterCostSchema } from './ability-shape';
export type {
  ActivationCost,
  ActivationCostInput,
  LoyaltyCost,
  Attach,
  ModelAttach,
  RemoveCounterCost,
  SacrificeOther,
  SacrificeMatching,
  TapMatching,
  StaticScopeFilter,
  AttachModification,
  AttackAdmission,
  CombatModification,
  DamagePreventionModification,
  StaticBundleModification,
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
 * It also raises only the engine-facing trigger list to three effects. Disciple
 * of Bolas resolves a sacrifice, life gain, and draw in order; the model unions
 * keep their two-effect bound, so this exact reference capability does not
 * widen the generator's output space.
 *
 * The fifth argument carries three hand-authored static fields.
 * `enabledWhile` is CR 611.2c's conditional continuous effect. A
 * `printedSubjectReference` preserves modern Oracle's "this creature" source
 * wording when a self static would ordinarily print the card name, while
 * `printedSourceReference` preserves "this card" for a replacement acting
 * from hand. All three belong to this union alone — no token in The Hidden
 * Kingdom prints them,
 * and a field added to the schema the model is shown renames every recorded
 * fixture (`packages/llm/src/schema.ts` hashes the answer schema), so the
 * generator's five unions below all leave them unfilled.
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
function objectAbilitiesOver<M extends ZodType>(staticModification: M) {
  return abilitiesOver(
    CardEffectSchema,
    ActivationCostSchema,
    {
      attach: AttachSchema.optional(),
      loyaltyCost: LoyaltyCostSchema.optional(),
      regenerateSelf: z.literal(true).optional(),
      activateOnlyWhileAttacking: z.literal(true).optional(),
      /** Engine-only CR 602.1b timing restriction shared by scavenge and future abilities. */
      activateOnlyAsSorcery: z.literal(true).optional(),
      /** Printed reminder for a targeted mana-producing activation that uses the stack. */
      activateOnlyAsInstantReminder: z.literal(true).optional(),
      /** Engine-only per-source activation limit. */
      activateOnlyOnceEachTurn: z.literal(true).optional(),
      activationZone: z.literal('graveyard').optional(),
      /** Hand-authored modern Oracle source reference for a permanent activation. */
      printedSourceReference: z
        .enum([
          'thisCard',
          'thisCreature',
          'thisArtifact',
          'thisEnchantment',
          'thisLand',
          'cardNameBeforeComma',
        ])
        .optional(),
      effects: z.array(CardEffectSchema).max(3),
      /** Engine-only CR 700.2 choice for an activated or loyalty ability. */
      modes: ModesSchema.optional(),
      /** Engine-only CR 118.8 toll on the one spell this activation counters. */
      counterTargetSpellUnless: z.strictObject({ cost: CounterUnlessCostSchema }).optional(),
      /** Izzet Staticaster's atomic target-relative same-name damage bundle. */
      damageTargetAndCreaturesWithSameName: z.literal(true).optional(),
      /** Vraska's source-incarnation retaliation lasting until its controller's next turn. */
      retaliateForCombatDamageUntilYourNextTurn: z.literal(true).optional(),
      /** Jace, Architect of Thought's three closed loyalty-resolution profiles. */
      jaceArchitectProfile: z.enum(['attackDebuff', 'piles', 'searchAndCast']).optional(),
    },
    {
      optional: OptionalTriggerSchema,
      interveningIf: ConditionSchema.optional(),
      targetChooser: z.literal('triggeringPlayer').optional(),
      spellColors: SpellColorsSchema.optional(),
      /** Engine-only structural refinement for a cast spell with at least two colors. */
      spellIsMulticolored: z.literal(true).optional(),
      /** Tablet of the Guilds' closed source-choice/cast-color intersection. */
      spellSharesChosenColors: z.literal(true).optional(),
      /** Engine-only widening of source combat damage to all source damage dealt to a player. */
      includesNoncombatDamage: z.literal(true).optional(),
      /**
       * Ash Zealot's hand-authored cast-event bundle: watch every player, but
       * only when the physical spell moved from a graveyard to the stack, and
       * retain that caster. One flag keeps scope, origin, and referent atomic.
       */
      castFromGraveyardByAnyPlayer: z.literal(true).optional(),
      /**
       * Utvara Hellkite's atomic hand-authored refinement of the attack event
       * family. The validator binds it to selfAttacks and one token payload;
       * the kernel substitutes a controller/subtype scan for reflexivity.
       */
      attackingCreatureSubtype: z.string().regex(SUBTYPE_PATTERN).optional(),
      /** Basic land type read from the permanent-entry event. */
      landSubtype: BasicLandTypeSchema.optional(),
      /**
       * Engine-only refinement of each-player upkeep: fire only when the active
       * player controls this creature Aura's live host, and retain that player.
       */
      triggeringPlayerIsEnchantedCreatureController: z.literal(true).optional(),
      /**
       * Righteous Authority's atomic hand-authored trigger refinement. The
       * containing ability retains the enchanted creature controller and must
       * draw that player exactly one card at their draw step; model schemas do
       * not receive this field.
       */
      enchantedControllerDrawStepAdditionalDraw: z.literal(true).optional(),
      /** Engine-only opponent-only refinement of each-player upkeep. */
      triggeringPlayerIsOpponent: z.literal(true).optional(),
      /** Engine-only CR 603.4 maximum over the retained upkeep player's hand. */
      triggeringPlayerHandAtMost: z.int().min(0).optional(),
      /** Desecration Demon's closed opponent-choice and conditional source update. */
      opponentMaySacrificeCreatureThenTapAndCounterSelf: z.literal(true).optional(),
      /** CR 113.6: an explicit exception to the battlefield ability default. */
      triggerZone: z.literal('graveyard').optional(),
      /**
       * Source-faithful modern Oracle reference for a creature, artifact, enchantment,
       * or Aura trigger whose ordinary template names its source. This changes
       * presentation only; the condition remains the kernel's semantic
       * authority.
       *
       * Hand-authored only. The model-facing unions below do not receive this
       * extra field, so source transcription cannot become a design lever.
       */
      printedSourceReference: z
        .enum(['thisCreature', 'thisArtifact', 'thisEnchantment', 'thisAura', 'cardNameBeforeComma'])
        .optional(),
      effects: z.array(CardEffectSchema).max(3),
      counterTriggeringSpellOrAbilityUnless: z
        .strictObject({
          cost: ManaCostSchema,
        })
        .optional(),
      /**
       * Transguild Promenade's atomic hand-authored entry toll. The validator
       * binds this to selfEnters plus one sacrificeSelf instruction; keeping
       * the payer and payload together prevents either from becoming a general
       * trigger-design dimension.
       */
      sacrificeSelfUnlessControllerPays: z
        .strictObject({
          cost: ManaCostSchema,
        })
        .optional(),
      /** Soul Tithe's atomic Aura-host dynamic toll; never model-visible. */
      sacrificeEnchantedPermanentUnlessControllerPaysManaValue: z.literal(true).optional(),
      /** Faerie Impostor's atomic hand-authored return-or-sacrifice entry cost. */
      returnAnotherCreatureOrSacrificeSelf: z.literal(true).optional(),
      /** Hand-authored payment that gates one optional trigger's payload. */
      optionalControllerPayment: z
        .strictObject({
          cost: ManaCostSchema,
        })
        .optional(),
      /** Azor's Elocutors' atomic upkeep placement and post-placement victory check. */
      putCounterThenWinAtThreshold: z
        .strictObject({ counter: CounterKindSchema, atLeast: z.int().min(1) })
        .optional(),
      /** Azor's Elocutors' atomic any-source controller-damage counter removal. */
      controllerDamageRemovesSourceCounter: z.strictObject({ counter: CounterKindSchema }).optional(),
      /**
       * Grave Betrayal's complete opponent-death delayed-return instruction.
       *
       * `controlledCreatureDies` is the internal death-event carrier; this
       * bundle reverses the source-relative controller filter and owns the
       * exact graveyard incarnation, future timing, controller, counter, and
       * additive characteristics together. It is absent from every model
       * ability schema.
       */
      opponentCreatureDiesReturnAtNextEndStep: z
        .strictObject({
          control: z.literal('you'),
          counter: z.literal('plusOnePlusOne'),
          count: z.literal(1),
          alsoBecomes: z.strictObject({
            colors: z.tuple([z.literal('B')]),
            subtypes: z.tuple([z.literal('Zombie')]),
          }),
        })
        .optional(),
      /** Search the City's inseparable linked top-five and matching-play profiles. */
      searchTheCityProfile: z.enum(['exileTopFive', 'matchingNameCompletion']).optional(),
      /** Guild Feud's targeted, ordered two-library creature contest. */
      guildFeudContest: z.literal(true).optional(),
    },
    {
      enabledWhile: ConditionSchema.nullable().optional(),
      /** Static-only temporal gate that does not widen the general condition union. */
      activeDuring: z.literal('turnsOtherThanYours').optional(),
      filter: StaticScopeFilterSchema.optional(),
      /** Engine-only source-faithful presentation for a self static on a creature. */
      printedSubjectReference: z.enum(['thisCreature', 'cardNameBeforeComma']).optional(),
      /** Hand-authored modern Oracle source reference for an in-hand replacement. */
      printedSourceReference: z.literal('thisCard').optional(),
    },
    staticModification,
    TriggerConditionSchema,
    EngineStaticScopeSchema,
  );
}

const ObjectAbilityWithoutTriggeredGrantSchema = objectAbilitiesOver(
  StaticModificationWithoutTriggeredAbilitySchema,
);

/**
 * A typed triggered ability that an engine-only Aura may grant to its host.
 *
 * Keep the color filter's condition dependency at the schema boundary as well
 * as in whole-card validation. Ability consumers such as Forge accept this
 * schema directly and must never receive a parsed filter they would ignore.
 */
export const TriggeredAbilitySchema = ObjectAbilityWithoutTriggeredGrantSchema.options[1].superRefine(
  (ability, ctx) => {
    if (ability.spellColors !== undefined && ability.condition !== 'youCastSpell') {
      ctx.addIssue({
        code: 'custom',
        path: ['spellColors'],
        message: 'spellColors is legal only on youCastSpell',
      });
    }
    if (ability.spellIsMulticolored === true && ability.condition !== 'youCastSpell') {
      ctx.addIssue({
        code: 'custom',
        path: ['spellIsMulticolored'],
        message: 'spellIsMulticolored is legal only on youCastSpell',
      });
    }
    if (ability.spellSharesChosenColors === true && ability.condition !== 'youCastSpell') {
      ctx.addIssue({
        code: 'custom',
        path: ['spellSharesChosenColors'],
        message: 'spellSharesChosenColors is legal only on youCastSpell',
      });
    }
    if (
      ability.spellSharesChosenColors === true &&
      (ability.spellColors !== undefined || ability.spellIsMulticolored === true)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['spellSharesChosenColors'],
        message: 'spellSharesChosenColors is a complete cast-event refinement',
      });
    }
    if (ability.spellColors !== undefined && ability.spellIsMulticolored === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['spellIsMulticolored'],
        message: 'spellIsMulticolored and spellColors are competing cast-event refinements',
      });
    }
    if (ability.castFromGraveyardByAnyPlayer === true && ability.condition !== 'youCastSpell') {
      ctx.addIssue({
        code: 'custom',
        path: ['castFromGraveyardByAnyPlayer'],
        message: 'castFromGraveyardByAnyPlayer is legal only on youCastSpell',
      });
    }
    if (ability.attackingCreatureSubtype !== undefined && ability.condition !== 'selfAttacks') {
      ctx.addIssue({
        code: 'custom',
        path: ['attackingCreatureSubtype'],
        message: 'attackingCreatureSubtype is legal only on selfAttacks',
      });
    }
    if (
      ability.castFromGraveyardByAnyPlayer === true &&
      (ability.spellColors !== undefined || ability.spellIsMulticolored === true)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['castFromGraveyardByAnyPlayer'],
        message: 'castFromGraveyardByAnyPlayer is a complete cast-event refinement',
      });
    }
    if (ability.putCounterThenWinAtThreshold !== undefined) {
      const effect = ability.effects[0];
      if (
        ability.condition !== 'beginningOfYourUpkeep' ||
        ability.effects.length !== 1 ||
        effect?.kind !== 'putCounters' ||
        effect.counter !== ability.putCounterThenWinAtThreshold.counter ||
        effect.count !== 1 ||
        effect.target.kind !== 'selfPermanent'
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['putCounterThenWinAtThreshold'],
          message:
            'putCounterThenWinAtThreshold requires beginningOfYourUpkeep and one matching source-counter placement',
        });
      }
    }
    if (ability.controllerDamageRemovesSourceCounter !== undefined) {
      if (ability.condition !== 'selfIsDealtDamage' || ability.effects.length !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['controllerDamageRemovesSourceCounter'],
          message:
            'controllerDamageRemovesSourceCounter requires the selfIsDealtDamage carrier and no independent effects',
        });
      }
    }
    if (
      ability.opponentCreatureDiesReturnAtNextEndStep !== undefined &&
      (ability.condition !== 'controlledCreatureDies' || ability.effects.length !== 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['opponentCreatureDiesReturnAtNextEndStep'],
        message:
          'opponentCreatureDiesReturnAtNextEndStep requires the controlledCreatureDies event carrier and no independent effects',
      });
    }
    if (
      ability.putCounterThenWinAtThreshold !== undefined &&
      ability.controllerDamageRemovesSourceCounter !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['controllerDamageRemovesSourceCounter'],
        message: 'the two counter-race clauses require separate trigger-stack entries',
      });
    }
  },
);

/** Full engine static vocabulary; the generator continues to use its frozen two-member union. */
export const StaticModificationSchema = staticModificationsWithTriggeredAbility(TriggeredAbilitySchema);
export const LayeredStaticModificationSchema =
  layeredStaticModificationsWithTriggeredAbility(TriggeredAbilitySchema);

const ObjectAbilitySchema = objectAbilitiesOver(StaticModificationSchema);

/** The engine's existing activated arm, named for hand-authored nested grants. */
export const ActivatedAbilitySchema = ObjectAbilitySchema.options[2].superRefine((ability, ctx) => {
  if (ability.counterTargetSpellUnless === undefined) return;
  const effects = ability.modes === undefined ? ability.effects : [];
  if (effects.length !== 1 || effects[0]?.kind !== 'counterSpell') {
    ctx.addIssue({
      code: 'custom',
      path: ['counterTargetSpellUnless'],
      message: 'counterTargetSpellUnless requires exactly one nonmodal counterSpell effect',
    });
  }
});

/**
 * A live static rule whose affected subject is a player rather than an object.
 *
 * `abilitiesOver`'s static member deliberately owns an object `scope`; putting
 * "each opponent" into that enum would also expose it to the generator and
 * make layer modifications such as +1/+1 parse against a player. This fourth
 * executable shape keeps the ontology explicit and keeps the model union
 * byte-for-byte on the original three shapes.
 */
export const StaticPlayerRuleAbilitySchema = z
  .strictObject({
    kind: z.literal('staticPlayerRule'),
    players: z.enum(['eachOpponent', 'controller', 'eachPlayer']),
    rule: StaticPlayerRuleSchema,
    /** Optional only for castSpellsAsThoughFlash; validators reject it elsewhere. */
    spellFilter: CardFilterSchema.refine(
      (filter) => Object.values(filter).some((value) => value !== undefined),
      'spellFilter must name at least one printed characteristic',
    ).optional(),
    /** Printed only on source cards whose filtered-flash line carries this reminder. */
    flashTimingReminder: z.literal(true).optional(),
  })
  .superRefine((ability, ctx) => {
    if (ability.spellFilter !== undefined && ability.rule !== 'castSpellsAsThoughFlash') {
      ctx.addIssue({
        code: 'custom',
        path: ['spellFilter'],
        message: 'spellFilter is legal only on castSpellsAsThoughFlash',
      });
    }
    if (ability.flashTimingReminder === true && ability.rule !== 'castSpellsAsThoughFlash') {
      ctx.addIssue({
        code: 'custom',
        path: ['flashTimingReminder'],
        message: 'flashTimingReminder is legal only on castSpellsAsThoughFlash',
      });
    }
  });

/** A live rule over game results rather than an object or player action. */
export const StaticGameRuleAbilitySchema = z.strictObject({
  kind: z.literal('staticGameRule'),
  rule: StaticGameRuleSchema,
});

/** One subject and condition shared by fixed modifications in different layers. */
export const StaticBundleAbilitySchema = z.strictObject({
  kind: z.literal('staticBundle'),
  scope: z.literal('otherCreaturesYouControl'),
  subtype: z.string().optional(),
  includeSelf: z.literal(true).optional(),
  enabledWhile: ConditionSchema,
  modifications: z.array(StaticBundleModificationSchema).min(2).max(3),
});

/**
 * A live prohibition over activated abilities rather than a characteristic.
 *
 * Pithing Needle supplies the complete closed rule: the containing permanent
 * retains one card name as it enters, sources with that current name cannot
 * activate non-mana abilities, and mana abilities remain outside the rule.
 * Keeping those parameters atomic avoids exposing independent name scopes,
 * activation classes, and exemptions to the model-facing ability grammar.
 */
export const StaticActivationRuleAbilitySchema = z.strictObject({
  kind: z.literal('staticActivationRule'),
  rule: z.literal('chosenNameNonManaAbilitiesCantActivate'),
});

export const STATE_TRIGGER_CONDITIONS = ['controllerControlsNoPermanentWithCounter'] as const;

/** A CR 603.8 trigger that watches current state instead of a game event. */
export const StateTriggerConditionSchema = z.strictObject({
  kind: z.literal(STATE_TRIGGER_CONDITIONS[0]),
  counter: CounterKindSchema,
});

/** Engine-only state trigger; model-facing ability schemas remain unchanged. */
export const StateTriggeredAbilitySchema = z.strictObject({
  kind: z.literal('stateTriggered'),
  condition: StateTriggerConditionSchema,
  effects: z.array(CardEffectSchema).min(1).max(2),
});

export const AbilitySchema = z.discriminatedUnion('kind', [
  ObjectAbilitySchema.options[0],
  TriggeredAbilitySchema,
  ActivatedAbilitySchema,
  StaticPlayerRuleAbilitySchema,
  StaticGameRuleAbilitySchema,
  StateTriggeredAbilitySchema,
  StaticBundleAbilitySchema,
  StaticActivationRuleAbilitySchema,
]);

export type Ability = z.infer<typeof AbilitySchema>;
export type AbilityInput = z.input<typeof AbilitySchema>;

/** Narrows to the ability variant carrying a given kind. */
export type AbilityOf<K extends AbilityKind> = Extract<Ability, { kind: K }>;
export type StaticAbility = AbilityOf<'static'>;
export type TriggeredAbility = AbilityOf<'triggered'>;
export type ActivatedAbility = AbilityOf<'activated'>;
export type StaticPlayerRuleAbility = AbilityOf<'staticPlayerRule'>;
export type StaticGameRuleAbility = AbilityOf<'staticGameRule'>;
export type StateTriggeredAbility = AbilityOf<'stateTriggered'>;
export type StaticBundleAbility = AbilityOf<'staticBundle'>;
export type StaticActivationRuleAbility = AbilityOf<'staticActivationRule'>;
export type StateTriggerCondition = z.infer<typeof StateTriggerConditionSchema>;
export type StaticModification = StaticAbility['modification'];

/** Grave Betrayal's one closed opponent-death delayed-return capability. */
export type OpponentCreatureDiesReturnAbility = TriggeredAbility & {
  readonly condition: 'controlledCreatureDies';
  readonly effects: readonly [];
  readonly opponentCreatureDiesReturnAtNextEndStep: {
    readonly control: 'you';
    readonly counter: 'plusOnePlusOne';
    readonly count: 1;
    readonly alsoBecomes: { readonly colors: readonly ['B']; readonly subtypes: readonly ['Zombie'] };
  };
};

export function isOpponentCreatureDiesReturnAbility(
  ability: Ability,
): ability is OpponentCreatureDiesReturnAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'controlledCreatureDies' &&
    ability.effects.length === 0 &&
    ability.opponentCreatureDiesReturnAtNextEndStep !== undefined
  );
}

/** Search the City's source-linked top-five entry instruction. */
export type SourceLinkedTopFiveExileAbility = TriggeredAbility & {
  readonly condition: 'selfEnters';
  readonly effects: readonly [];
  readonly searchTheCityProfile: 'exileTopFive';
};

/** Search the City's optional same-name return and mandatory completion tail. */
export type SourceLinkedMatchingPlayCompletionAbility = TriggeredAbility & {
  readonly condition: 'youCastSpell';
  readonly optional: true;
  readonly effects: readonly [];
  readonly searchTheCityProfile: 'matchingNameCompletion';
};

export function isSourceLinkedTopFiveExileAbility(
  ability: Ability,
): ability is SourceLinkedTopFiveExileAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfEnters' &&
    ability.effects.length === 0 &&
    ability.optional !== true &&
    ability.searchTheCityProfile === 'exileTopFive'
  );
}

export function isSourceLinkedMatchingPlayCompletionAbility(
  ability: Ability,
): ability is SourceLinkedMatchingPlayCompletionAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'youCastSpell' &&
    ability.effects.length === 0 &&
    ability.optional === true &&
    ability.searchTheCityProfile === 'matchingNameCompletion'
  );
}

/** Guild Feud's one targeted upkeep trigger and its closed contest payload. */
export type GuildFeudAbility = TriggeredAbility & {
  readonly condition: 'beginningOfYourUpkeep';
  readonly effects: readonly [];
  readonly guildFeudContest: true;
};

export function isGuildFeudAbility(ability: Ability): ability is GuildFeudAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'beginningOfYourUpkeep' &&
    ability.optional !== true &&
    ability.effects.length === 0 &&
    ability.guildFeudContest === true
  );
}
export type StaticModificationOf<K extends StaticModification['kind']> = Extract<
  StaticModification,
  { kind: K }
>;
export type LayeredStaticModification = z.infer<typeof LayeredStaticModificationSchema>;

/** The exact reflexive loot template whose optional choice governs both instructions. */
export function isOptionalDrawThenDiscardAbility(ability: TriggeredAbility): boolean {
  if (ability.optional !== true || ability.effects.length !== 2) return false;
  return (
    canonicalJson(ability.effects[0]) === '{"count":1,"kind":"drawCards","target":{"kind":"noTarget"}}' &&
    canonicalJson(ability.effects[1]) === '{"count":1,"kind":"discardCards","target":{"kind":"noTarget"}}'
  );
}

/** The exact reflexive rummage template whose discard must succeed before its draw. */
export function isOptionalDiscardThenDrawAbility(ability: TriggeredAbility): boolean {
  if (ability.optional !== true || ability.effects.length !== 2) return false;
  return (
    canonicalJson(ability.effects[0]) === '{"count":1,"kind":"discardCards","target":{"kind":"noTarget"}}' &&
    canonicalJson(ability.effects[1]) === '{"count":1,"kind":"drawCards","target":{"kind":"noTarget"}}'
  );
}

export type PutCounterThenWinAtThresholdAbility = TriggeredAbility & {
  readonly putCounterThenWinAtThreshold: { readonly counter: CounterKind; readonly atLeast: number };
};

export function isPutCounterThenWinAtThresholdAbility(
  ability: Ability,
): ability is PutCounterThenWinAtThresholdAbility {
  return ability.kind === 'triggered' && ability.putCounterThenWinAtThreshold !== undefined;
}

export type ControllerDamageRemovesSourceCounterAbility = TriggeredAbility & {
  readonly controllerDamageRemovesSourceCounter: { readonly counter: CounterKind };
};

export function isControllerDamageRemovesSourceCounterAbility(
  ability: Ability,
): ability is ControllerDamageRemovesSourceCounterAbility {
  return ability.kind === 'triggered' && ability.controllerDamageRemovesSourceCounter !== undefined;
}

/** The effect list selected when an activated ability was announced. */
export function effectsForActivatedAbility(
  ability: ActivatedAbility,
  mode: number | null,
): readonly Effect[] {
  if (ability.modes === undefined) return ability.effects;
  if (mode === null) throw new Error('effectsForActivatedAbility: a modal ability requires a chosen mode');
  const chosen = ability.modes[mode];
  if (chosen === undefined) {
    throw new Error(
      `effectsForActivatedAbility: mode ${String(mode)} is out of range for a ${String(ability.modes.length)}-mode ability`,
    );
  }
  return chosen.effects;
}

/** Frost Titan's retained-stack-object counter clause, narrowed for readers. */
export type CounterTriggeringSpellOrAbilityAbility = TriggeredAbility & {
  readonly condition: 'selfBecomesTargetByOpponent';
  readonly counterTriggeringSpellOrAbilityUnless: {
    readonly cost: ManaCost;
  };
};
export { isVariableLoyaltyCost, loyaltyCostChange } from './ability-shape';

/** True only for the exact retained-stack-object counter envelope. */
export function isCounterTriggeringSpellOrAbilityAbility(
  ability: Ability,
): ability is CounterTriggeringSpellOrAbilityAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfBecomesTargetByOpponent' &&
    ability.counterTriggeringSpellOrAbilityUnless !== undefined
  );
}

/** A self-entry trigger whose controller may pay to keep its source. */
export type SacrificeSelfUnlessControllerPaysAbility = TriggeredAbility & {
  readonly condition: 'selfEnters';
  readonly printedSourceReference: 'thisCreature';
  readonly effects: readonly [Extract<Effect, { kind: 'sacrificeSelf' }>];
  readonly sacrificeSelfUnlessControllerPays: { readonly cost: ManaCost };
};

/** Soul Tithe's attachment-relative dynamic upkeep toll. */
export type SacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility = TriggeredAbility & {
  readonly condition: 'beginningOfEachPlayersUpkeep';
  readonly triggeringPlayerIsEnchantedCreatureController: true;
  readonly sacrificeEnchantedPermanentUnlessControllerPaysManaValue: true;
  readonly effects: readonly [];
};

export function isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility(
  ability: Ability,
): ability is SacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'beginningOfEachPlayersUpkeep' &&
    ability.triggeringPlayerIsEnchantedCreatureController === true &&
    ability.sacrificeEnchantedPermanentUnlessControllerPaysManaValue === true &&
    ability.effects.length === 0
  );
}

/** Chronic Flooding's closed, attachment-relative land-tap payload. */
export type EnchantedLandBecomesTappedMillAbility = TriggeredAbility & {
  readonly condition: 'enchantedLandBecomesTapped';
  readonly effects: readonly [Extract<Effect, { kind: 'millCards' }>];
};

export function isEnchantedLandBecomesTappedMillAbility(
  ability: Ability,
): ability is EnchantedLandBecomesTappedMillAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'enchantedLandBecomesTapped' &&
    ability.effects.length === 1 &&
    effect?.kind === 'millCards' &&
    effect.count === 3 &&
    effect.target.kind === 'triggeringPlayer'
  );
}

/** Necropolis Regent's closed retained creature-and-damage payload. */
export type ControlledCreatureCombatDamageCountersAbility = TriggeredAbility & {
  readonly condition: 'controlledCreatureDealsCombatDamageToPlayer';
  readonly effects: readonly [Extract<Effect, { kind: 'putCounters' }>];
};

export function isControlledCreatureCombatDamageCountersAbility(
  ability: Ability,
): ability is ControlledCreatureCombatDamageCountersAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'controlledCreatureDealsCombatDamageToPlayer' &&
    ability.effects.length === 1 &&
    effect?.kind === 'putCounters' &&
    effect.counter === 'plusOnePlusOne' &&
    typeof effect.count !== 'number' &&
    effect.count.kind === 'triggeringDamageAmount' &&
    effect.target.kind === 'triggeringCreature' &&
    effect.scope === undefined &&
    effect.timing === undefined &&
    effect.keyword === undefined &&
    effect.recipientCondition === undefined
  );
}

/** Conjured Currency's one optional source-and-target exchange trigger. */
export type ConjuredCurrencyAbility = TriggeredAbility & {
  readonly condition: 'beginningOfYourUpkeep';
  readonly optional: true;
  readonly effects: readonly [Extract<Effect, { kind: 'exchangeControl' }>];
};

export function isConjuredCurrencyAbility(ability: Ability): ability is ConjuredCurrencyAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'beginningOfYourUpkeep' &&
    ability.optional === true &&
    ability.effects.length === 1 &&
    effect?.kind === 'exchangeControl' &&
    effect.exchangeSource === true &&
    effect.target.kind === 'targetPermanentYouNeitherOwnNorControl' &&
    Object.keys(effect.target).length === 1
  );
}

/** Detention Sphere's optional target-and-name-cohort linked exile. */
export type SameNameCohortLinkedExileAbility = TriggeredAbility & {
  readonly condition: 'selfEnters';
  readonly optional: true;
  readonly printedSourceReference: 'thisEnchantment';
  readonly effects: readonly [Extract<Effect, { kind: 'exileTarget' }>];
};

export function isSameNameCohortLinkedExileAbility(
  ability: Ability,
): ability is SameNameCohortLinkedExileAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfEnters' &&
    ability.optional === true &&
    ability.printedSourceReference === 'thisEnchantment' &&
    ability.effects.length === 1 &&
    effect?.kind === 'exileTarget' &&
    effect.linkToSource === true &&
    effect.sameNameCohort !== undefined &&
    effect.target.kind === 'targetPermanent' &&
    effect.target.filter?.excludeCardTypes?.length === 1 &&
    effect.target.filter.excludeCardTypes[0] === 'land' &&
    Object.keys(effect.target).length === 2
  );
}

/** The plural source-departure reader paired with a same-name cohort writer. */
export type PluralSourceLinkedReturnAbility = TriggeredAbility & {
  readonly condition: 'selfLeavesBattlefield';
  readonly printedSourceReference: 'thisEnchantment';
  readonly effects: readonly [Extract<Effect, { kind: 'moveSourceLinkedExile' }>];
};

export function isPluralSourceLinkedReturnAbility(
  ability: Ability,
): ability is PluralSourceLinkedReturnAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfLeavesBattlefield' &&
    ability.optional !== true &&
    ability.printedSourceReference === 'thisEnchantment' &&
    ability.effects.length === 1 &&
    effect?.kind === 'moveSourceLinkedExile' &&
    effect.destination === 'battlefieldUnderOwner' &&
    effect.plural === true
  );
}

/** Angel of Serenity's atomic optional mixed-zone linked-exile writer. */
export type AngelOfSerenityExileAbility = TriggeredAbility & {
  readonly condition: 'selfEnters';
  readonly printedSourceReference: 'thisCreature';
  readonly optional: true;
  readonly effects: readonly [Extract<Effect, { kind: 'exileTarget' }>];
};

export function isAngelOfSerenityExileAbility(ability: Ability): ability is AngelOfSerenityExileAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfEnters' &&
    ability.printedSourceReference === 'thisCreature' &&
    ability.optional === true &&
    ability.effects.length === 1 &&
    effect?.kind === 'exileTarget' &&
    effect.creatureBattlefieldOrGraveyard === true
  );
}

/** Angel of Serenity's plural leaves-the-battlefield owner-hand reader. */
export function isAngelOfSerenityReturnAbility(ability: Ability): boolean {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfLeavesBattlefield' &&
    ability.printedSourceReference === 'thisCreature' &&
    ability.effects.length === 1 &&
    effect?.kind === 'moveSourceLinkedExile' &&
    effect.destination === 'hand' &&
    effect.plural === true
  );
}

/** One mandatory token trigger for each controlled attacker of one subtype. */
export type ControlledSubtypeAttacksTokenAbility = TriggeredAbility & {
  readonly condition: 'selfAttacks';
  readonly attackingCreatureSubtype: string;
  readonly effects: readonly [Extract<Effect, { kind: 'createToken' }>];
};

/** True only for the atomic controlled-subtype attack/token envelope. */
export function isControlledSubtypeAttacksTokenAbility(
  ability: Ability,
): ability is ControlledSubtypeAttacksTokenAbility {
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfAttacks' &&
    ability.attackingCreatureSubtype !== undefined &&
    ability.effects.length === 1 &&
    ability.effects[0]?.kind === 'createToken' &&
    ability.effects[0].count === 1
  );
}

/** True only for the exact controller-paid self-sacrifice envelope. */
export function isSacrificeSelfUnlessControllerPaysAbility(
  ability: Ability,
): ability is SacrificeSelfUnlessControllerPaysAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfEnters' &&
    ability.effects.length === 1 &&
    effect?.kind === 'sacrificeSelf' &&
    effect.target.kind === 'selfPermanent' &&
    ability.sacrificeSelfUnlessControllerPays !== undefined
  );
}

/** A self-entry trigger paid by returning another controlled creature. */
export type ReturnAnotherCreatureOrSacrificeSelfAbility = TriggeredAbility & {
  readonly condition: 'selfEnters';
  readonly effects: readonly [Extract<Effect, { kind: 'sacrificeSelf' }>];
  readonly returnAnotherCreatureOrSacrificeSelf: true;
};

/** True only for Faerie Impostor's atomic return-or-sacrifice envelope. */
export function isReturnAnotherCreatureOrSacrificeSelfAbility(
  ability: Ability,
): ability is ReturnAnotherCreatureOrSacrificeSelfAbility {
  const effect = ability.kind === 'triggered' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'triggered' &&
    ability.condition === 'selfEnters' &&
    ability.effects.length === 1 &&
    effect?.kind === 'sacrificeSelf' &&
    effect.target.kind === 'selfCreature' &&
    ability.returnAnotherCreatureOrSacrificeSelf === true
  );
}

/** An activated counter whose targeted spell's controller may pay a toll. */
export type CounterTargetSpellUnlessAbility = ActivatedAbility & {
  readonly effects: readonly [Extract<Effect, { kind: 'counterSpell' }>];
  readonly counterTargetSpellUnless: { readonly cost: ManaCost };
};

/** One targeted damage instruction widened only to creatures sharing its target's name. */
export type DamageTargetAndCreaturesWithSameNameAbility = ActivatedAbility & {
  readonly effects: readonly [Extract<Effect, { kind: 'dealDamage' }>];
  readonly damageTargetAndCreaturesWithSameName: true;
};

/** True only for Izzet Staticaster's atomic mapped-damage envelope. */
export function isDamageTargetAndCreaturesWithSameNameAbility(
  ability: Ability,
): ability is DamageTargetAndCreaturesWithSameNameAbility {
  const effect = ability.kind === 'activated' ? ability.effects[0] : undefined;
  return (
    ability.kind === 'activated' &&
    ability.modes === undefined &&
    ability.effects.length === 1 &&
    effect?.kind === 'dealDamage' &&
    effect.amount === 1 &&
    effect.target.kind === 'targetCreature' &&
    ability.damageTargetAndCreaturesWithSameName === true
  );
}

/** Vraska's closed loyalty ability that installs one source-linked retaliation rule. */
export type CombatDamageRetaliationAbility = ActivatedAbility & {
  readonly loyaltyCost: 1;
  readonly effects: readonly [];
  readonly retaliateForCombatDamageUntilYourNextTurn: true;
};

export function isCombatDamageRetaliationAbility(
  ability: Ability,
): ability is CombatDamageRetaliationAbility {
  return (
    ability.kind === 'activated' &&
    ability.loyaltyCost === 1 &&
    ability.effects.length === 0 &&
    ability.modes === undefined &&
    ability.retaliateForCombatDamageUntilYourNextTurn === true
  );
}

/** Jace, Architect of Thought's +1 delayed attack-trigger profile. */
export type JaceArchitectAttackDebuffAbility = ActivatedAbility & {
  readonly loyaltyCost: 1;
  readonly effects: readonly [];
  readonly jaceArchitectProfile: 'attackDebuff';
};

/** Jace, Architect of Thought's -2 reveal, partition, hand, and bottom profile. */
export type JaceArchitectPilesAbility = ActivatedAbility & {
  readonly loyaltyCost: -2;
  readonly effects: readonly [];
  readonly jaceArchitectProfile: 'piles';
};

/** Jace, Architect of Thought's -8 per-player search and free-cast profile. */
export type JaceArchitectSearchAndCastAbility = ActivatedAbility & {
  readonly loyaltyCost: -8;
  readonly effects: readonly [];
  readonly jaceArchitectProfile: 'searchAndCast';
};

export function isJaceArchitectAttackDebuffAbility(
  ability: Ability,
): ability is JaceArchitectAttackDebuffAbility {
  return (
    ability.kind === 'activated' &&
    ability.loyaltyCost === 1 &&
    ability.effects.length === 0 &&
    ability.modes === undefined &&
    ability.jaceArchitectProfile === 'attackDebuff'
  );
}

export function isJaceArchitectPilesAbility(ability: Ability): ability is JaceArchitectPilesAbility {
  return (
    ability.kind === 'activated' &&
    ability.loyaltyCost === -2 &&
    ability.effects.length === 0 &&
    ability.modes === undefined &&
    ability.jaceArchitectProfile === 'piles'
  );
}

export function isJaceArchitectSearchAndCastAbility(
  ability: Ability,
): ability is JaceArchitectSearchAndCastAbility {
  return (
    ability.kind === 'activated' &&
    ability.loyaltyCost === -8 &&
    ability.effects.length === 0 &&
    ability.modes === undefined &&
    ability.jaceArchitectProfile === 'searchAndCast'
  );
}

/** True for exactly one of Jace, Architect of Thought's three closed profiles. */
export function isJaceArchitectAbility(
  ability: Ability,
): ability is
  JaceArchitectAttackDebuffAbility | JaceArchitectPilesAbility | JaceArchitectSearchAndCastAbility {
  return (
    isJaceArchitectAttackDebuffAbility(ability) ||
    isJaceArchitectPilesAbility(ability) ||
    isJaceArchitectSearchAndCastAbility(ability)
  );
}

/** True only for the exact activated counter-toll envelope. */
export function isCounterTargetSpellUnlessAbility(
  ability: Ability,
): ability is CounterTargetSpellUnlessAbility {
  return (
    ability.kind === 'activated' &&
    ability.modes === undefined &&
    ability.effects.length === 1 &&
    ability.effects[0]?.kind === 'counterSpell' &&
    ability.counterTargetSpellUnless !== undefined
  );
}

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
 * CR 702.97 scavenge as executable primitives rather than a second resolution
 * path. The source zone, source-exile payment, sorcery timing, and targeted
 * counter effect are all fields the kernel already understands independently;
 * this type names the one exact envelope that earns the printed keyword.
 */
export type ScavengeAbility = ActivatedAbility & {
  readonly activationZone: 'graveyard';
  readonly activateOnlyAsSorcery: true;
  readonly cost: ActivatedAbility['cost'] & { readonly exileSelf: true };
  readonly effects: readonly [
    Extract<ActivatedAbility['effects'][number], { kind: 'putCounters' }> & {
      readonly counter: 'plusOnePlusOne';
      readonly count: number;
      readonly target: { readonly kind: 'targetCreature' };
    },
  ];
};

/** Builds one canonical scavenge ability for a fixed-power creature card. */
export function scavengeAbility(cost: ManaCost, printedPower: number): ScavengeAbility {
  if (!Number.isInteger(printedPower) || printedPower < 1) {
    throw new RangeError(`scavenge power must be a positive integer, not ${String(printedPower)}`);
  }
  return {
    kind: 'activated',
    activationZone: 'graveyard',
    activateOnlyAsSorcery: true,
    cost: {
      mana: cost,
      tapSelf: false,
      sacrificeSelf: false,
      exileSelf: true,
    },
    effects: [
      {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: printedPower,
        target: { kind: 'targetCreature' },
      },
    ],
  };
}

/** True only for the canonical executable scavenge envelope. */
export function isScavengeAbility(ability: Ability): ability is ScavengeAbility {
  if (
    ability.kind !== 'activated' ||
    ability.activationZone !== 'graveyard' ||
    ability.activateOnlyAsSorcery !== true ||
    ability.cost.exileSelf !== true ||
    ability.cost.tapSelf ||
    ability.cost.payLife !== undefined ||
    ability.cost.sacrificeSelf ||
    ability.cost.sacrificeOther !== undefined ||
    ability.cost.sacrificeMatching !== undefined ||
    ability.cost.sacrificeLandSubtypePair !== undefined ||
    ability.cost.tapMatching !== undefined ||
    ability.cost.discard !== undefined ||
    ability.cost.discardFilter !== undefined ||
    ability.cost.discardMatching !== undefined ||
    ability.cost.removeCounter !== undefined ||
    ability.loyaltyCost !== undefined ||
    ability.attach !== undefined ||
    ability.regenerateSelf === true ||
    ability.activateOnlyWhileAttacking === true ||
    ability.modes !== undefined ||
    ability.effects.length !== 1
  ) {
    return false;
  }
  const effect = ability.effects[0];
  if (
    effect?.kind !== 'putCounters' ||
    effect.counter !== 'plusOnePlusOne' ||
    typeof effect.count !== 'number' ||
    !Number.isInteger(effect.count) ||
    effect.count < 1
  ) {
    return false;
  }
  return (
    canonicalJson(effect) ===
    canonicalJson({
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: effect.count,
      target: { kind: 'targetCreature' },
    })
  );
}

/**
 * The flagship set's Flurry rush, CR 702-shaped but an ability word rather
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
 * The flagship set's Gloom, the second ability word on the same footing as
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

/**
 * The reviewed generator capability for a creature entering under your
 * control and growing another creature you control.
 *
 * The trigger, effect, counter, and target are one contract. None is appended
 * to its global model tuple: exposing any of the four independently would also
 * expose combinations whose color-pie and play-pattern review has not happened.
 */
export const ControlledCreatureCounterOnEntryModelAbilitySchema = z.strictObject({
  kind: z.literal('triggered'),
  condition: z.literal('anotherControlledCreatureEnters'),
  effects: z
    .array(
      z.strictObject({
        kind: z.literal('putCounters'),
        counter: z.literal('plusOnePlusOne'),
        count: z.int(),
        target: z.strictObject({ kind: z.literal('targetCreatureYouControl') }),
      }),
    )
    .min(1)
    .max(1),
});

export type ControlledCreatureCounterOnEntryModelAbility = z.infer<
  typeof ControlledCreatureCounterOnEntryModelAbilitySchema
>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type ControlledCreatureCounterOnEntryModelAbilityIsAbility =
  ControlledCreatureCounterOnEntryModelAbility extends Ability ? true : never;

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
 * Any model-facing ability whose effects are already engine-contained.
 *
 * Capability schemas may narrow a trigger or effect without joining the global
 * model union. Their only crossing work is still the activated cost and attach
 * normalization below, so the seam is structural rather than tied to one
 * named answer-schema tier.
 */
type WithEngineContainedEffects<T> = T extends { effects: readonly unknown[] }
  ? Omit<T, 'effects'> & { readonly effects: readonly Effect[] }
  : T;

export type GeneratorModelAbility =
  WithEngineContainedEffects<AttachingMechanicModelAbility> | ControlledCreatureCounterOnEntryModelAbility;

type WithEngineContainedEffectInputs<T> = T extends { effects?: readonly unknown[] }
  ? Omit<T, 'effects'> & { readonly effects?: readonly Effect[] }
  : T;

export type GeneratorModelAbilityInput =
  | z.input<typeof AttachingMechanicModelAbilitySchema>
  | WithEngineContainedEffectInputs<z.input<typeof AttachingMechanicModelAbilitySchema>>
  | z.input<typeof ControlledCreatureCounterOnEntryModelAbilitySchema>;

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
  loyaltyCost: FixedLoyaltyCostSchema,
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
export function abilityFromModel(ability: GeneratorModelAbility): Ability {
  if (ability.kind === 'triggered') return { ...ability, effects: [...ability.effects] };
  if (ability.kind !== 'activated') return ability;
  // Destructured even when there is no clause, because the key carries the
  // model's type wherever it goes: under `exactOptionalPropertyTypes` an
  // `attach?: ModelAttach` is not an `attach?: Attach` even holding
  // `undefined`, so dropping the key is what says "this ability has no clause"
  // rather than "this ability has the wrong one".
  const { attach, ...rest } = ability;
  const cost = { ...rest.cost, mana: { ...rest.cost.mana, hasX: false } };
  const effects = [...rest.effects];
  if (attach === undefined) return { ...rest, effects, cost };
  return { ...rest, effects, cost, attach: { modifications: [attach.modification] } };
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

/** The three ability kinds a generator-facing brief or slot may request. */
export const ModelAbilityKindSchema = z.enum(MODEL_ABILITY_KINDS);

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
export type LoyaltyAbility = ActivatedAbility & {
  readonly loyaltyCost: LoyaltyCost;
};

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

/** A "you may pay" trigger whose controller pays only while resolving it. */
export type PaidOptionalTrigger = OptionalTrigger & {
  readonly optionalControllerPayment: { readonly cost: ManaCost };
};

export function isPaidOptionalTrigger(ability: Ability): ability is PaidOptionalTrigger {
  return isOptionalTrigger(ability) && ability.optionalControllerPayment !== undefined;
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
export function triggerChoosesTargets(ability: TriggeredAbility | StateTriggeredAbility): boolean {
  return (
    ('guildFeudContest' in ability && ability.guildFeudContest === true) ||
    ability.effects.some((effect) => effectChoosesTarget(effect))
  );
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
