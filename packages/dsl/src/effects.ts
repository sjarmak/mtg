/**
 * Spell-effect primitives: a discriminated union over the pinned effect
 * vocabulary, each carrying its own typed parameters.
 *
 * Numeric parameters are integers at the schema level but deliberately
 * unbounded in sign/magnitude: range sanity (damage > 0, counts >= 1) lives in
 * the structural validators so bad generated numbers surface as coded,
 * actionable violations rather than raw parse failures.
 */
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  abilitiesOver,
  ActivationCostSchema,
  OptionalTriggerSchema,
  StaticModificationSchema,
  staticModificationsWithTriggeredAbility,
} from './ability-shape';
import {
  AmountSchema,
  ChosenXSchema,
  ComputedAmountSchema,
  PumpAmountSchema,
  SharedAmountSchema,
} from './amount';
import { CounterKindSchema, ModelCounterKindSchema } from './counters';
import { CardFilterSchema } from './card-filter';
import { CharacteristicPowerToughnessSchema } from './characteristic-values';
import { ManaCostSchema } from './mana';
import {
  CARD_ID_PATTERN,
  COLORS,
  ColorSchema,
  EFFECT_KINDS,
  EffectScopeSchema,
  GrantableKeywordSchema,
  KeywordSchema,
  ManaColorSchema,
  PlayerScopeSchema,
} from './vocabulary';
import {
  isReferentTarget,
  isMultipleTargetSpec,
  isSourceAttachmentTarget,
  isSourceBodyOnlyTarget,
  ModelTargetSpecSchema,
  referentSourceSpace,
  TargetFilterSchema,
  TargetSpecSchema,
  type TargetSpec,
  targetKindNamesACreature,
  targetKindNamesAPlayer,
  targetKindNamesAPlayerOrPlaneswalker,
} from './targets';

/**
 * The generatable vocabulary, in two halves around the one primitive that
 * carries a token.
 *
 * One list, three unions. The halves are separate functions rather than one
 * because `createToken` has to sit at a fixed position in the middle: the JSON
 * Schema `@mtg/setgen` shows the model is an ordered `anyOf`, and a member that
 * moves is a different schema, which renames every recorded fixture keyed to it.
 * Re-listing the other nine members for the token-borne union would be the
 * other way to get there, and a second copy of the vocabulary is the thing this
 * file exists to not have.
 */
/**
 * The `scope` field, offered to the engine's union and withheld from the
 * model's.
 *
 * Four of the generatable primitives are sweepers with one word changed —
 * "destroy target creature" and "destroy all creatures target player controls"
 * are one verb over two group sizes — and `exileTarget` and `putCounters`
 * already settled that this is a widening of the primitive rather than four new
 * kinds, because a `destroyAll` would be a second row in `EFFECT_EXECUTION`, in
 * `EFFECT_PRICING`, in `EFFECT_RULES`, in the Forge map and in the coverage
 * instrument, every one of them saying "destroy, but the group is bigger".
 *
 * It is passed in rather than written inline for the reason the whole
 * model/engine split exists: a fixture key hashes the answer schema
 * (`packages/llm/src/schema.ts`), so a field appearing on `ModelEffectSchema`
 * renames every recorded run. The engine's unions pass `SWEEP_FIELD` and the
 * three model-facing unions pass `NO_SWEEP`, which is the empty object, so the
 * JSON Schema the generator is shown is byte-identical to the one it was shown
 * before this field existed. Teaching the generator to *print* a sweeper is a
 * setgen slice with that re-record behind it, exactly where `putCounters` sits.
 *
 * `scopeFilter` is the second half of the pair and arrives with the untargeted
 * scopes (`mtg-9u18`). A scope that names a *player* names its objects in the
 * same breath — `creaturesThatPlayerControls` says creatures — but a scope that
 * names a region of the board cannot, because the nine sweepers M11 and M13
 * print name four different card types between them: creatures (Day of
 * Judgment), enchantments (Back to Nature), everything but lands (Planar
 * Cleansing), and attacking creatures (Rain of Blades). So the space is the
 * scope's to say and the bodies are the filter's, and `checkEffectScope`
 * refuses either one printed without the other.
 *
 * It reuses `TargetFilterSchema` rather than declaring a sweep-shaped twin, for
 * `spellFilter`'s reason one field down and for a stronger one: the group a
 * sweep reaches and the group a removal spell can aim at have to be the same
 * bodies, and `@mtg/kernel`'s `satisfiesTargetFilter` is the single matcher
 * both ask. A second filter vocabulary would be a second opinion about which
 * creature is a white one.
 */
const NO_SWEEP = {};
const SWEEP_FIELD = {
  scope: EffectScopeSchema.optional(),
  scopeFilter: TargetFilterSchema.optional(),
};

/**
 * Which players an untargeted sweep reaches, offered to the engine's union and
 * withheld from the model's.
 *
 * Its own field rather than a seventh `EffectScope`, because every reader of
 * that vocabulary asks it which zone and which bodies and "each player" answers
 * neither. A separate field also keeps the two orthogonal where they have to be
 * orthogonal: this one says *whom* at the table and `scope` says *what* on the
 * battlefield. Most carriers use only one. Damage may carry both because one
 * source can deal one simultaneous batch to permanents and players.
 *
 * Withheld from the model for `scope`'s reason at the same seam: a fixture key
 * hashes the answer schema (`packages/llm/src/schema.ts`), so a field appearing
 * on `ModelEffectSchema` renames every recorded run.
 */
const NO_PLAYER_SWEEP = {};
const PLAYER_SWEEP_FIELD = { players: PlayerScopeSchema.optional() };

/**
 * The keyword a pump hands to the one body it already named: "target creature
 * gets +2/+2 **and gains flying** until end of turn" (`mtg-oc3f`).
 *
 * ## What was missing was a binder, not a verb
 *
 * `grantKeywordUntilEndOfTurn` exists and says, correctly, that two grants on
 * one spell are two effects. Two effects are also two *targets*: `@mtg/kernel`'s
 * `targetChoicesForEffects` enumerates one slot per effect, `Action.targets` is
 * parallel to the effect list, and CR 608.2b rechecks each slot on its own. So
 * a pump and a grant written side by side print "Target creature gets +2/+0
 * until end of turn. Target creature gains trample until end of turn." — two
 * creatures, two independent choices, a real printed template and a different
 * card. `TargetSpecSchema`'s own docblock says the same thing from the other
 * end: "target creature and target creature" is already expressible as two
 * effects. Mighty Leap and Thunder Strike need the opposite of that, and no
 * amount of vocabulary reaches it, because what they need is one slot.
 *
 * ## A field rather than a kind
 *
 * `putCounters`' `scope` settled this shape of question: a `pumpAndGrant` kind
 * would be a second row in `EFFECT_EXECUTION`, in `EFFECT_PRICING`, in
 * `EFFECT_RULES`, in the Forge map and in the coverage instrument, every one of
 * them saying "pump, but with a keyword on it". Forge already agrees at the far
 * end — its `Pump` API takes `NumAtt`, `NumDef` and `KW` on one line, so the
 * rider exports as one script line and the two-effect spelling exports as two.
 *
 * ## Withheld from the generator, and from `EffectSchema` besides
 *
 * `SWEEP_FIELD`'s reason applies unchanged: a fixture key hashes the answer
 * schema (`packages/llm/src/schema.ts`), so a field on `ModelEffectSchema`
 * renames every recorded run. This one is withheld one union further out, from
 * `EffectSchema` as well, and the reason is `grantKeywordUntilEndOfTurn`'s
 * pricing argument rather than the prompt's bytes: `EffectSchema` is the
 * *priced* vocabulary, a keyword is not a magnitude — what trample is worth
 * depends on the body it lands on — and `EFFECT_PRICING` reads the pump's two
 * numbers and has no row for the rider. A priced union carrying an unpriced
 * field would be a card the color pie scores as if the keyword were free.
 *
 * ## One card, one spelling
 *
 * `checkParams` still refuses a +0/+0 pump with the rider on it, so "gains
 * flying until end of turn" keeps exactly one encoding and it is
 * `grantKeywordUntilEndOfTurn`. It also refuses the rider beside a `scope`, and
 * the reason moved when that kind grew a scope of its own (`mtg-nhyv.15`): the
 * refusal used to say a mass grant was a capability nothing had, and now it
 * says a mass grant has exactly one spelling and this is not it. Overrun is a
 * scoped pump and a scoped grant written side by side — two effects, one group
 * word each, neither of them choosing a target — so the rider buys nothing
 * there that it buys on a targeted trick, where the whole point is that one
 * chosen creature gets both halves. `KEYWORD_ABILITY_KINDS` stay unreachable
 * here for the same reason they are unreachable there: `KeywordSchema`'s nine
 * are what layer 6 carries.
 */
const NO_PUMP_KEYWORD = {};
const PUMP_KEYWORD_FIELD = {
  keyword: KeywordSchema.optional(),
  /** Chorus of Might leads with the shared duration. Text only; semantics are unchanged. */
  printedDurationFirst: z.literal(true).optional(),
};

/**
 * The rider that makes tapping cost the opponent a turn instead of a blocker.
 *
 * A permanent tapped by a spell untaps on its controller's next untap step, so
 * an unmodified `tapPermanent` buys one attack against one creature and nothing
 * else. Every playable tapper Magic prints says the other half out loud — Frost
 * Breath, Sleep and Dungeon Geists all read "it doesn't untap during its
 * controller's next untap step" — and the DSL had no word for it, which is why
 * the flagship set's two blue tappers are a one-mana instant that scored 0.05
 * and a two-mana one that scored 0.40 against a blue median near 1.15, and why
 * both still reached a preconstructed deck: they are the only tap effects in the
 * color, so the deck that wants to tap has nothing else to play.
 *
 * A rider on the existing primitive rather than a `tapDown` kind of its own, for
 * `scope`'s reason at the same field: a second kind would be a second row in
 * `EFFECT_EXECUTION`, in `EFFECT_PRICING`, in `EFFECT_RULES`, in the Forge map
 * and in the coverage instrument, each of them saying "tap, but it sticks".
 *
 * `z.literal(true)` rather than a boolean, because `false` and absent would be
 * two spellings of one state. It is optional and engine-only for the same
 * reason `scope` is: a fixture key hashes the model's answer schema, so the
 * generator learning to print this is a setgen slice with a re-record behind
 * it (`mtg-h9gl`).
 */
const NO_STASIS = {};
const STASIS_FIELD = { doesNotUntap: z.literal(true).optional() };

/**
 * Which spell on the stack a counter may name, offered to the engine's union
 * and withheld from the model's.
 *
 * `counterSpell` is the one primitive that carries no `TargetSpec`, because a
 * spell on the stack is outside the pinned targeting vocabulary — so the
 * narrowing Essence Scatter, Negate and Flashfreeze need has nowhere else to
 * live. It reuses `TargetFilterSchema` rather than declaring a stack-shaped
 * twin: a card type and a color mean the same thing on the stack as on the
 * battlefield, and `checkSpellFilter` is where the two dimensions that do not
 * carry over (a combat role, and a land, which is never a spell under CR 305.9)
 * are refused.
 *
 * Threaded in rather than written inline, for `scope`'s reason at the same
 * seam: a fixture key hashes the answer schema (`packages/llm/src/schema.ts`),
 * so a field appearing on `ModelEffectSchema` renames every recorded run. The
 * engine's unions pass `SPELL_FILTER_FIELD` and the model's passes nothing, so
 * the JSON Schema the generator is shown is byte-identical to the one it was
 * shown before this field existed.
 */
const NO_SPELL_FILTER = {};
const SPELL_FILTER_FIELD = { spellFilter: TargetFilterSchema.optional() };

/**
 * A fixed CR 118.8 toll attached to one hand-authored counter instruction.
 *
 * This is deliberately wider than `SPELL_FILTER_FIELD` only in the full card
 * unions. The model union still passes `NO_SPELL_FILTER`, so teaching the
 * reference vocabulary to represent Mana Leak and Izzet Charm does not teach
 * the generator a new output shape.
 */
const COUNTER_FIELDS = {
  ...SPELL_FILTER_FIELD,
  /** A fixed toll, or the X the counterspell's caster announced. Hand-authored only. */
  unlessCost: z.union([ManaCostSchema, z.strictObject({ kind: z.literal('chosenX') })]).optional(),
  /** CR 701.5a destination replacement used by Syncopate. Hand-authored only. */
  destination: z.literal('exile').optional(),
  /**
   * A second instruction that reads the targeted creature spell before the
   * counter attempt, then has this source damage that spell's controller.
   * Hand-authored only: stack-object referents are outside the model target
   * vocabulary, and `counterSpell` deliberately owns that target seam.
   */
  dealDamageToControllerEqualToSpellPower: z.literal(true).optional(),
};

/** Hand-authored CR 615 exception carried only by the full effect unions. */
const NO_DAMAGE_PREVENTION_RULE = {};
const DAMAGE_PREVENTION_RULE_FIELD = { preventable: z.literal(false).optional() };

/** Hand-authored division instructions carried only by the full effect unions. */
export const DamageDivisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('each') }),
  z.strictObject({ kind: z.literal('evenlyRoundedDown') }),
  z.strictObject({ kind: z.literal('asYouChoose') }),
]);
const NO_DAMAGE_DIVISION = {};
const DAMAGE_DIVISION_FIELD = { division: DamageDivisionSchema.optional() };

const NO_DAMAGE_RIDERS = {};
const DAMAGE_RIDER_FIELDS = {
  additionalScopeFilter: TargetFilterSchema.optional(),
  scopeAmount: AmountSchema.optional(),
  tapScopeGroup: z.literal(true).optional(),
  /** Hand-authored, resolution-linked death replacement; never model-facing. */
  exileDamagedCreatureIfItWouldDieThisTurn: z.literal(true).optional(),
  /** Hand-authored cohort members become the damage sources and hit their own controllers. */
  eachScopedPermanentDealsToItsController: z.literal(true).optional(),
  /** Hand-authored routing whose player branch is opponent-only; any planeswalker remains legal. */
  opponentPlayerOrPlaneswalkerOnly: z.literal(true).optional(),
};

const NO_REFERENT_EXCLUSION = {};
/** Hand-authored “other” relationship carried only by the full card-effect union. */
const REFERENT_EXCLUSION_FIELD = { excludeReferent: z.literal(true).optional() };
const NO_GAIN_LIFE_AMOUNT_SOURCE = {};
/** Hand-authored live amount source for Search Warrant's linked life gain. */
const GAIN_LIFE_AMOUNT_SOURCE_FIELD = {
  amountFrom: z.literal('thatPlayersHandSize').optional(),
};
const NO_MILL_PRESENTATION = {};
/** Hand-authored current Oracle may name a computed mill count as X or retain mill's one-card reminder. */
const MILL_PRESENTATION_FIELD = {
  printedVariable: z.literal('X').optional(),
  printedOneCardReminder: z.literal(true).optional(),
};
const NO_DESTROY_CONTROLLER_LIBRARY_FOLLOWUP = {};
/** Hand-authored retained-controller rider used only by Destroy the Evidence. */
const DESTROY_CONTROLLER_LIBRARY_FOLLOWUP_FIELD = {
  controllerLibraryFollowup: z.literal('revealUntilLandToGraveyard').optional(),
};

function effectsBeforeTokens<
  T extends ZodType,
  A extends ZodType,
  M extends ZodType,
  S extends Record<string, ZodType> = typeof NO_SWEEP,
  C extends Record<string, ZodType> = typeof NO_SPELL_FILTER,
  P extends Record<string, ZodType> = typeof NO_PLAYER_SWEEP,
  N extends Record<string, ZodType> = typeof NO_DAMAGE_PREVENTION_RULE,
  R extends Record<string, ZodType> = typeof NO_PUMP_KEYWORD,
  V extends Record<string, ZodType> = typeof NO_DAMAGE_DIVISION,
  W extends Record<string, ZodType> = typeof NO_DAMAGE_RIDERS,
  X extends Record<string, ZodType> = typeof NO_REFERENT_EXCLUSION,
  G extends Record<string, ZodType> = typeof NO_GAIN_LIFE_AMOUNT_SOURCE,
  H extends Record<string, ZodType> = typeof NO_DESTROY_CONTROLLER_LIBRARY_FOLLOWUP,
>(
  target: T,
  amount: A,
  pumpMagnitude: M,
  sweep: S = NO_SWEEP as S,
  counter: C = NO_SPELL_FILTER as C,
  playerSweep: P = NO_PLAYER_SWEEP as P,
  damagePrevention: N = NO_DAMAGE_PREVENTION_RULE as N,
  pumpKeyword: R = NO_PUMP_KEYWORD as R,
  division: V = NO_DAMAGE_DIVISION as V,
  damageRiders: W = NO_DAMAGE_RIDERS as W,
  referentExclusion: X = NO_REFERENT_EXCLUSION as X,
  gainLifeAmountSource: G = NO_GAIN_LIFE_AMOUNT_SOURCE as G,
  destroyControllerLibraryFollowup: H = NO_DESTROY_CONTROLLER_LIBRARY_FOLLOWUP as H,
) {
  return [
    z.strictObject({
      kind: z.literal('dealDamage'),
      amount,
      target,
      ...sweep,
      ...playerSweep,
      ...damagePrevention,
      ...division,
      ...damageRiders,
    }),
    z.strictObject({
      kind: z.literal('destroyPermanent'),
      target,
      ...sweep,
      ...destroyControllerLibraryFollowup,
    }),
    z.strictObject({
      kind: z.literal('pumpUntilEndOfTurn'),
      power: pumpMagnitude,
      toughness: pumpMagnitude,
      target,
      ...sweep,
      ...pumpKeyword,
      ...referentExclusion,
    }),
    z.strictObject({ kind: z.literal('drawCards'), count: amount, target, ...playerSweep }),
    z.strictObject({ kind: z.literal('gainLife'), amount, target, ...gainLifeAmountSource }),
    // Countering targets a spell on the stack, which is outside the pinned
    // targeting vocabulary, so this primitive carries no TargetSpec at all.
    z.strictObject({ kind: z.literal('counterSpell'), ...counter }),
  ] as const;
}

function effectsAfterTokens<
  T extends ZodType,
  A extends ZodType,
  S extends Record<string, ZodType> = typeof NO_SWEEP,
  D extends Record<string, ZodType> = typeof NO_STASIS,
  P extends Record<string, ZodType> = typeof NO_MILL_PRESENTATION,
>(
  target: T,
  amount: A,
  sweep: S = NO_SWEEP as S,
  stasis: D = NO_STASIS as D,
  millPresentation: P = NO_MILL_PRESENTATION as P,
) {
  return [
    z.strictObject({ kind: z.literal('tapPermanent'), target, ...sweep, ...stasis }),
    z.strictObject({ kind: z.literal('returnToHand'), target }),
    z.strictObject({ kind: z.literal('millCards'), count: amount, target, ...millPresentation }),
  ] as const;
}

/**
 * Place counters of a declared kind on the target.
 *
 * The counter's meaning is not repeated here: `counter` names a kind and
 * `counters.ts` declares what that kind does, so a card that places a part says
 * which part and nothing about first strike.
 *
 * It is deliberately outside the generatable halves, which makes it the first
 * primitive the engine can run and the generator cannot print. Two reasons, and
 * both are about not asking a model a question nobody has answered: no role in
 * `@mtg/setgen` names a counter kind, and `@mtg/design-data`'s color-pie row
 * for it is inferred from the pump row rather than sourced, so a generated card
 * placing a part counter would be priced against a classification nobody
 * checked. Teaching the generator is a setgen slice of its own, and because a
 * fixture key hashes the answer schema, that slice re-records every recorded
 * run — which is exactly why it is not this one.
 *
 * `scope` is the same optional field `exileTargetEffect` carries below, and it
 * turns the same primitive into a sweeper: unscoped it names one permanent,
 * scoped it names the *player* whose creatures it reaches and the creatures are
 * not targets at all (CR 115.1). That is what the flagship set's gloom wants —
 * "put a gloom counter on each creature target opponent controls" — and it is a
 * widening of this primitive rather than a `putCountersOnEach` kind of its own,
 * because a second kind would be a second row in `EFFECT_EXECUTION`, in
 * `EFFECT_PRICING`, in `EFFECT_RULES`, in the Forge map and in the coverage
 * instrument, every one of them saying "counters, but the group is bigger".
 * `exileTarget` already put that argument to the identical shape and answered it
 * this way, and the answer has held for a sweep and a single removal spell out
 * of one row since.
 *
 * Only the two battlefield scopes are legal here, and `checkEffectScope`
 * (`validate/effects.ts`) is where that is stated rather than the schema: a
 * counter lives on a permanent, and a card in a hand or a graveyard carries none
 * for the same CR 611.2c reason `zone-filter.ts` gives — off the battlefield
 * there is no "currently" for a counter to be part of. A coded violation names
 * the mistake; a narrower schema would only fail to parse.
 *
 * It takes `SWEEP_FIELD` whole rather than the `scope` half alone, which it
 * carried until `mtg-hfex`. The second half is what an untargeted scope needs:
 * `permanentsYouControl` names a region of the board and not which permanents
 * in it, so "put a +1/+1 counter on each artifact creature you control" is a
 * scope plus a filter exactly as "destroy all enchantments" is, and
 * `checkSpaceScope` refuses either one printed without the other. Spreading the
 * pair is what keeps this primitive's sweeping half spelled the way the other
 * four sweepers spell theirs.
 *
 * `recipientCondition` is the one live, hand-authored recipient predicate. It
 * is checked at resolution after the retained Equipment host is resolved;
 * `checkEffectParams` confines it to that unscoped shape. `putCounters` itself
 * remains absent from `ModelEffectSchema`, so the generator boundary stays
 * unchanged.
 */
const CounterRecipientConditionSchema = z.strictObject({
  kind: z.literal('hasColor'),
  color: ColorSchema,
});

function putCountersEffect<T extends ZodType, A extends ZodType>(target: T, amount: A) {
  return z.strictObject({
    kind: z.literal('putCounters'),
    counter: CounterKindSchema,
    count: amount,
    ...SWEEP_FIELD,
    target,
  });
}

/** Hand-authored counter extensions; never model-facing. */
function handAuthoredPutCountersEffect<T extends ZodType, A extends ZodType>(target: T, amount: A) {
  return z.strictObject({
    kind: z.literal('putCounters'),
    counter: CounterKindSchema,
    count: amount,
    ...SWEEP_FIELD,
    target,
    recipientCondition: CounterRecipientConditionSchema.optional(),
    keyword: KeywordSchema.optional(),
    /** Hand-authored delayed placement; the model-facing counter effect omits it. */
    timing: z.literal('nextEndStep').optional(),
  });
}

/**
 * Return every creature card from a graveyard to the battlefield (CR 400.7).
 *
 * The DSL's first return-from-graveyard primitive of any kind, and The Hidden
 * Kingdom is why: its Blood Moon is a named, recurring beat across the set, and
 * in the source material the Blood Moon revives what has fallen. Every card that
 * named it printed something else, because the vocabulary had no word for the
 * one thing the moon does.
 *
 * ## Four decisions, and what settled each
 *
 * **Whose graveyard.** The scope supplies the answer. The original
 * `creatureCardsInPlayerGraveyard` reads one targeted player;
 * `creatureCardsInAllGraveyards` reads the stable seat-order union and targets
 * nobody. Keeping both in the subject table means neither execution nor
 * rendering guesses from the effect kind.
 *
 * **What comes back.** Creature cards. `EFFECT_SCOPES` already carries
 * `creatureCardsInPlayerGraveyard` — it was added for a scoped exile and reads
 * printed values through `zone-filter.ts` for CR 611.2c's reason — so this
 * primitive needed no new way to say which cards, and stating a narrower filter
 * would be a vocabulary nothing in the set exercises.
 *
 * **Where to, and under whose control.** Absent fields mean the battlefield
 * under each card's owner's control, preserving every card written before the
 * widening. `destination: 'hand'` is mass Raise Dead. `control: 'you'` is the
 * independent battlefield clause for an effect that reanimates opponents'
 * cards under its resolving controller while ownership stays unchanged; the
 * validator refuses it beside the hand destination, where control has no
 * meaning.
 *
 * **Whether it targets.** The subject answers this too. A one-player graveyard
 * scope targets that player and not the cards (CR 115.1); an all-graveyards
 * scope uses `noTarget`. Neither form asks which card comes back because the
 * whole scoped cohort moves during one resolution. With no scope, the target
 * must name one card in a graveyard and the same primitive becomes a targeted
 * reanimation. Those two
 * group sizes share the zone move, destination, and control rule; keeping them
 * in one row avoids a second effect kind whose implementation differs only by
 * whether it receives one oid or a scope-derived list.
 */
/**
 * Where the returned cards land, when the card says anywhere but the
 * battlefield.
 *
 * Optional, and absent means `'battlefield'`. That asymmetry is deliberate and
 * it is the reverse of `LibraryPositionSchema`'s: this primitive already exists
 * and already means reanimation, so a required field would rewrite every card
 * printed against it and every recorded fixture that carries one, to say the
 * thing they already said. `'hand'` is the widening — mass Raise Dead — and it
 * is the arm that has to be stated.
 *
 * It stays off `modelReturnFromGraveyardEffect` for the reason `scope` is a
 * literal there: a field the prompt does not teach is a field the model fills in
 * by guessing, and the first evidence would be a live run that costs money.
 */
export const RETURN_DESTINATIONS = ['battlefield', 'hand'] as const;
export const ReturnDestinationSchema = z.enum(RETURN_DESTINATIONS);
export type ReturnDestination = z.infer<typeof ReturnDestinationSchema>;

function returnFromGraveyardEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('returnFromGraveyard'),
    scope: EffectScopeSchema.optional(),
    /** Faith's Reward's exact owner-relative cohort; deliberately hand-authored only. */
    fromBattlefieldThisTurn: z.literal(true).optional(),
    destination: ReturnDestinationSchema.optional(),
    control: GraveyardChoiceControlSchema.optional(),
    alsoBecomes: GraveyardArrivalGrantSchema.optional(),
    target,
  });
}

/**
 * Exile the target (CR 701.20).
 *
 * `destroyPermanent` with one word changed, and the word is the whole card.
 * Exile is the removal that does not feed a graveyard, so it is the only clean
 * answer to a set whose economy is built on dying being good: The Hidden
 * Kingdom's Monsters leave a body or a part when they die, and a spell that
 * destroys one pays that economy on the way past. The kernel gets this almost
 * free — `moveObject` is the single zone-movement primitive and its switches
 * are already total over `ZoneId` — and gets two consequences right without
 * being asked, because `selfDies` is derived from a battlefield-to-graveyard
 * move alone and exile is in the ceased-tokens sweep's skip list.
 *
 * It sits in `UNPRICED_EFFECT_KINDS` rather than beside the generatable halves,
 * and unlike `putCounters` the objection is not that no role wants it:
 * `@mtg/setgen`'s white `removalExile` role has been printing a destroy spell
 * in an exile slot for as long as the set has existed. The objection is that
 * admitting it costs a sourced color-pie row and a prompt line that re-records
 * every fixture, which is a generation run's decision and not a kernel one.
 *
 * The hand-authored shape also carries the shared scope/filter pair. Targeted
 * player scopes name their own creature-card group and take no filter; a board
 * region such as Mass Polymorph's permanents-you-control scope needs the filter
 * to say which permanents move. The validator holds those halves together.
 */
function exileTargetEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('exileTarget'),
    scope: EffectScopeSchema.optional(),
    scopeFilter: TargetFilterSchema.optional(),
    target,
    /** Retain the exact exiled incarnation on this source incarnation. */
    linkToSource: z.literal(true).optional(),
    /**
     * Detention Sphere's atomic target-plus-name-cohort exile.
     *
     * The excluded name lives inside the effect-specific bundle rather than
     * widening every target filter with a negative name predicate. Card-level
     * validation admits it only with the matching optional enters trigger and
     * plural source-linked return.
     */
    sameNameCohort: z.strictObject({ excludedName: z.string().min(1) }).optional(),
    /**
     * Angel of Serenity's closed mixed-zone plural selector. The exact card
     * bundle validator pins the target, trigger, link, and departure reader;
     * the model-facing exile schema never sees this field.
     */
    creatureBattlefieldOrGraveyard: z.literal(true).optional(),
    /**
     * Create one delayed return for the exact exile incarnation this effect
     * moved. The literal fields are the one native schedule currently proven:
     * the next end step, tapped, under owner control. Keeping the rider off
     * `modelExileTargetEffect` makes it hand-authored without changing the
     * generator's recorded answer schema.
     */
    returnAtNextEndStep: z.strictObject({ tapped: z.literal(true), under: z.literal('owner') }).optional(),
  });
}

/**
 * The same primitive with `scope` and `scopeFilter` taken away, which is the
 * whole of what the generator may answer with.
 *
 * Omitted rather than offered-and-discouraged, for `target.distinct`'s reason
 * one file over: a field the prompt does not teach is a field the model fills in
 * by guessing, and the first evidence would be a live run that costs money. The
 * omission also settles a rule the validator would otherwise have to catch on
 * the way back — `UNSCOPED_MAY_NAME_A_PLAYER` reads false here, so an unscoped
 * exile that named a player would resolve into nothing, and a scope the model
 * cannot state is a player it cannot name.
 *
 * `MODEL_TARGET_KINDS` does the rest. It is the frozen four, so the only kind
 * this member can carry that `EFFECT_RULES` calls generatable is
 * `targetCreature`; `targetArtifactOrEnchantment` stays a hand-authored target
 * because the model has no word for it.
 */
function modelExileTargetEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('exileTarget'), target });
}

/**
 * CR 701.12: two creatures each deal damage equal to their power to the other.
 *
 * No `amount`, because the amount *is* the source's power, read through the
 * layers at resolution — a fight on a creature that grew after the trigger went
 * on the stack deals the larger number, and a field would be a second, staler
 * copy of a value the board already holds. No `scope`, because a scoped fight
 * is not a card anybody prints and `overEffectScope` would have to read a power
 * per member of the group.
 *
 * The source-body form has one target and reads the trigger's source as the
 * other fighter. The Prey Upon form is an ordered pair with exactly the two
 * selectors that card family prints; the kernel's plural-target side channel
 * carries the pair without widening the ordinary one-slot target contract.
 *
 * There is no model half. `putCountersEffect` is the standing precedent for a
 * primitive that is expressible by hand and unreachable from the generator, and
 * this one is further out still: `fight` is in `UNPRICED_EFFECT_KINDS`, so
 * `RoleProfile.effectKinds` cannot name it either.
 */
function fightEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('fight'),
    fighter: z.strictObject({ kind: z.literal('targetCreatureYouControl') }).optional(),
    target,
  });
}

/** Xathrid Gorgon's one permanent effect bundle, hand-authored and unpriced. */
function petrifyCreatureEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('petrifyCreature'), target });
}

/**
 * Mass reanimation, with the one scope it was ever allowed to have written in.
 *
 * `SCOPES_LEGAL_ON` gives this primitive exactly one legal scope and says why —
 * the effect is defined as a move *out of* a graveyard, so a scope naming any
 * other zone names cards the effect does not reach. A field with one legal value
 * is a field the model can only get wrong, so it is a literal here rather than
 * the enum, and the prompt's range line states it in the same breath. That is
 * the same reasoning `FilledAuraSchema` uses to keep `subtypes` off an Aura.
 *
 * Required rather than defaulted: a default would drop `scope` out of the JSON
 * Schema's `required` array and leave the model free to omit a word the printed
 * card is about.
 */
function modelReturnFromGraveyardEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('returnFromGraveyard'),
    scope: z.literal('creatureCardsInPlayerGraveyard'),
    target,
  });
}

/**
 * CR 701.16a: show the cards in a player's hand, briefly.
 *
 * Revealing is an *action*, not a lasting property, and that sentence is the
 * whole design. The kernel adds no state for it: one event carrying the card
 * ids, `seatEvent` passes it through unredacted, and the game moves on. A
 * `revealed` flag on an object would be a rules concept the CR does not have, a
 * new per-seat projection rule, and a hand component that can show a subset
 * instead of a count.
 *
 * It carries a target rather than a scope because it reaches a *player*, not a
 * set of objects. What comes next usually is a scoped `exileTarget` over the
 * same hand, which is why the two arrived together.
 */
function revealHandEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('revealHand'), target });
}

/**
 * CR 701.16a after the rules, rather than a player, select one card at random.
 *
 * A separate primitive from `revealHand` keeps the two actions canonical:
 * whole-hand reveal consumes no randomness, while this one advances the
 * replayable RNG exactly when a nonempty hand supplies a card. Its only legal
 * target is an event-retained player, enforced by the effect rule table.
 */
function revealRandomCardFromHandEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('revealRandomCardFromHand'), target });
}

/** Reveal and conditionally play one random card from the retained hand. */
function playRandomHandCardWithoutPayingManaCostEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('playRandomHandCardWithoutPayingManaCost'), target });
}

/**
 * Largest scry value this source-bound primitive admits.
 *
 * The M11/M13 identities need one through four. Keeping that bound in the
 * schema makes the resulting decision space finite by construction: scry four
 * has `(4 + 1) * 4! = 120` ordered partitions, safely below the kernel's 512
 * option ceiling. A larger value arrives with its own interaction design rather
 * than silently truncating legal orders.
 */
export const MAX_SCRY_COUNT = 4;

function scryEffect() {
  return z.strictObject({ kind: z.literal('scry'), count: z.int().min(1).max(MAX_SCRY_COUNT) });
}

/** Hand-authored, bounded questions over the top of the controller's library. */
function reorderTopLibraryEffect() {
  return z.strictObject({ kind: z.literal('reorderTopLibrary'), count: z.literal(5) });
}

function selectFromTopLibraryEffect() {
  return z.strictObject({
    kind: z.literal('selectFromTopLibrary'),
    count: z.union([z.literal(3), z.literal(5)]),
    filter: CardFilterSchema,
    optional: z.literal(true),
    reveal: z.literal(true),
    destination: z.literal('hand'),
    rest: z.enum(['bottom', 'graveyard']),
    /** Atomic hand-authored profile; validation binds every neighboring field. */
    grislySalvageProfile: z.literal(true).optional(),
    revealAll: z.literal(true).optional(),
  });
}

function separateTopLibraryIntoPilesEffect() {
  return z.strictObject({ kind: z.literal('separateTopLibraryIntoPiles'), count: z.literal(5) });
}

/**
 * Largest number of mana one `addMana` adds, and the largest number of colors
 * it offers to choose between.
 *
 * Six is `LandCardSchema.producesMana`'s own ceiling, read here rather than
 * invented: a mana ability that offers a choice is the same list a five-color
 * land prints, plus colorless, and two ceilings for one idea is how they drift.
 * As a quantity it is a curve decision rather than a technical bound — three
 * is a ritual, six is a Black Lotus and a half — and a set that wants more
 * arrives with the design conversation rather than a wider constant.
 */
export const MAX_MANA_PRODUCED = 6;

/**
 * CR 605's mana ability, and the ritual that is spelled the same way.
 *
 * Before this the engine had exactly one mana source: a land's `producesMana`,
 * tapped for exactly one mana. That is not a core set. Llanowar Elves is a
 * creature that taps for mana, a Sol Ring taps for two, a dual mana ability
 * offers a choice, and Dark Ritual is a spell that adds three at once — four
 * cards, and the vocabulary could print none of them.
 *
 * ## `produces` is a choice, never a sum
 *
 * The field is a *list of colors this may be*, exactly as `producesMana` is on
 * a land, and `amount` is how many of the one chosen color arrive. `['W','U']`
 * is "Add {W} or {U}", not "Add {W}{U}". That is the single decision this
 * schema makes, and it is what keeps the effect out of the open-ended
 * mana-string parser it would otherwise be: there is no shape here that can
 * say `{2}{G}{G}`, so there is nothing to parse, nothing to canonicalize, and
 * no way to print a cost-shaped string into a production slot.
 *
 * Magic does print mana abilities that add two different colors at once, and
 * this cannot express them. That is a deliberate floor rather than an
 * oversight: a sum needs a second quantity per color, which is a mana *cost*
 * shape on the production side, and the four cards a core set actually needs
 * are all one color at a time.
 *
 * ## Who chooses, and when
 *
 * Nobody, at resolution. A choice of colors is legal only on an activated
 * ability, where the choice rides on the activation itself — the kernel's
 * `activateManaAbility` action already carries a `color`, which is how a dual
 * land has always worked — so the effect that resolves has already been
 * narrowed to one color and the resolution runner never pauses. A spell prints
 * exactly one color for the same reason from the other side: a resolving spell
 * has nobody to ask, and `PendingScry` is this engine's only pause mechanism
 * and is not being given a second shape for this. `validate/mana-ability.ts`
 * states that rule and the four others that go with it.
 */
function addManaEffect() {
  return z.strictObject({
    kind: z.literal('addMana'),
    produces: z.array(ManaColorSchema).min(1).max(MAX_MANA_PRODUCED),
    amount: AmountSchema,
    /** Engine-only CR 106.3 distribution bundle; validation fixes its current count and colors. */
    distribution: z.literal('anyCombinationOfColors').optional(),
  });
}

/** A persistent emblem granting one reusable tap-for-mana ability by live type. */
export const EmblemManaGrantSchema = z.strictObject({
  filter: z.strictObject({
    cardTypes: z.tuple([z.literal('land')]),
    subtypes: z.tuple([z.string().min(1)]),
  }),
  produces: z.tuple([ManaColorSchema]),
  amount: z.int().min(1).max(MAX_MANA_PRODUCED),
});

export const EmblemSpecSchema = z.strictObject({
  name: z.string().min(1).max(128),
  grantsManaAbility: EmblemManaGrantSchema,
});

export type EmblemSpec = z.infer<typeof EmblemSpecSchema>;

function createEmblemEffect() {
  return z.strictObject({ kind: z.literal('createEmblem'), emblem: EmblemSpecSchema });
}

/**
 * Shuffle your library (CR 701.22).
 *
 * No target and no player field, so it is always the controller's own library.
 * Magic prints "shuffle target player's library" on nothing anybody wants, and
 * a field with one value a card ever states is a field the validator has to
 * defend rather than a word the card says.
 *
 * It is a standalone kind even though `searchLibrary` ends with one, and the
 * duplication is the point: a search's shuffle is CR 701.19c's mandatory clean-
 * up of a zone the searcher just read, which a card cannot decline, and this is
 * a card that shuffles on purpose. Folding the second into the first would make
 * "shuffle your library" unprintable except as a search that finds nothing.
 */
function shuffleLibraryEffect() {
  return z.strictObject({ kind: z.literal('shuffleLibrary') });
}

/**
 * Largest reveal this primitive admits, and the reason it has a bound at all.
 *
 * Unlike `MAX_SCRY_COUNT`, nothing here enumerates a decision space — a reveal
 * asks nobody anything (`revealHandEffect`'s docblock argues that at length for
 * the other zone). The bound is about the *log*: every revealed id goes into one
 * event, `seatEvent` passes it through unredacted to both seats, and the replay
 * schema stores it. Five is the largest number a core-set card reveals off the
 * top, and a card wanting more arrives with the interaction that reads them.
 */
export const MAX_REVEAL_COUNT = 5;

/**
 * CR 701.16a again, one zone over: show the top cards of your library.
 *
 * The same "revealing is an action, not a lasting property" design
 * `revealHandEffect` settled, and it inherits every consequence — one event
 * carrying the ids, no `revealed` flag on an object, no new projection rule.
 * What differs is the license: a card in a library is concealed from *both*
 * seats including its owner (`kernel/src/visibility.ts` says why), so this is
 * the one effect in the vocabulary that shows a player something about their
 * own deck, and `publiclyIdentified` has to name it or the reveal is drawn as
 * face-down cards.
 *
 * No target, for `shuffleLibraryEffect`'s reason: the cards revealed off an
 * opponent's library are a different card ("target opponent reveals the top
 * card of their library") and one no set here has asked to print.
 */
function revealTopCardsEffect() {
  return z.strictObject({
    kind: z.literal('revealTopCards'),
    count: z.int().min(1).max(MAX_REVEAL_COUNT),
  });
}

/**
 * Reveal the top card of your library and put that exact card into your hand.
 *
 * One primitive holds the hidden-zone read and its consumer together for the
 * same reason `revealUntilCreatureCards` does below. A bare reveal followed by
 * a generic move would need a target kind for a concealed library card or an
 * authored object id, and either would turn a resolution-local fact into
 * lasting card data. This effect asks no question and always moves at most one
 * card, so an empty library is the ordinary no-op rather than a failed draw.
 */
function revealTopCardToHandEffect() {
  return z.strictObject({ kind: z.literal('revealTopCardToHand') });
}

/**
 * Reveal the shortest top prefix containing `count` creature cards, put every
 * creature card in that prefix onto the battlefield, then shuffle the rest.
 *
 * One primitive holds the reveal and its consumers together. Splitting it into
 * a bare reveal followed by a move would require a lasting "revealed" flag or
 * a global register for the second effect to read, neither of which exists in
 * Magic. The count remains an `Amount`, so the library operation composes with
 * a preceding resolution tally without learning which effect produced it.
 */
function revealUntilCreatureCardsEffect() {
  return z.strictObject({
    kind: z.literal('revealUntilCreatureCards'),
    count: AmountSchema,
  });
}

/**
 * Which end of the library a tuck puts the card on.
 *
 * Two members and both are printed regularly — the top is Condemn's answer and
 * the bottom is Time Ebb's — so this is a required field rather than a default.
 * A default would make the milder half the one a card gets by saying nothing,
 * and the difference between them is most of what the card costs.
 */
export const LIBRARY_POSITIONS = ['top', 'bottom'] as const;
export const LibraryPositionSchema = z.enum(LIBRARY_POSITIONS);
export type LibraryPosition = z.infer<typeof LibraryPositionSchema>;

/**
 * `returnToHand` with a further destination: put the target on top of, or on
 * the bottom of, its owner's library.
 *
 * *Its owner's*, never the caster's, and that is CR 701.19a rather than a
 * choice this schema makes — a card only ever goes to the library it came from.
 * The kernel reads the owner off the object, so there is no field for it here
 * and no way for a card to state otherwise.
 *
 * It targets a permanent rather than naming a card in a hidden zone, which is
 * what keeps it out of `searchLibrary`'s territory: the whole difficulty of
 * "put a card from your hand on top of your library" is that no `TargetKind`
 * names a card in a hand, and answering it needs the interruptible runner. A
 * tuck needs neither, which is why it is a plain `EFFECT_EXECUTION` row.
 */
function putOnLibraryEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('putOnLibrary'),
    position: LibraryPositionSchema,
    target,
  });
}

/**
 * Put the resolving permanent ability's exact source and one target on top of
 * their owners' libraries, then shuffle each library that actually received
 * an object.
 *
 * This is intentionally atomic. Two `putOnLibrary` effects followed by the
 * controller-only `shuffleLibrary` cannot name a target's owner, and a generic
 * player field would ask authors to restate ownership the objects already
 * carry. It is hand-authored only and therefore cannot widen the generator's
 * model schema.
 */
function putSourceAndTargetOnOwnersLibrariesThenShuffleEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('putSourceAndTargetOnOwnersLibrariesThenShuffle'),
    target,
  });
}

/**
 * Whose graveyard a legacy untargeted `exileGraveyard` empties.
 *
 * A three-member enum rather than a `TargetSpec`, and the reason is that the
 * third member has no target to name. "Exile all graveyards" (Rest in Peace)
 * reaches both players and targets nobody, so a target spec would need a kind
 * meaning "everyone" — a widening of `TARGET_KINDS` that every other effect in
 * the vocabulary would then have to be told to refuse.
 *
 * These owner words remain distinct from the hand-authored target-player form:
 * CR 115.1 lets player hexproof remove Tormod's Crypt's chosen target before
 * resolution, while Bojuka Bog's fixed opponent and an each-player sweep never
 * target. Keeping both forms preserves that rules difference without inventing
 * a plural target kind.
 */
export const GRAVEYARD_OWNERS = ['you', 'opponent', 'each'] as const;
export const GraveyardOwnerSchema = z.enum(GRAVEYARD_OWNERS);
export type GraveyardOwner = z.infer<typeof GraveyardOwnerSchema>;

/**
 * CR 701.20 over a whole graveyard: every card in it, not only the creatures.
 *
 * Deliberately not a fourth `EffectScope` on `exileTarget`. A scope names a set
 * of objects the effect then applies to one at a time, and every scope in
 * `EFFECT_SCOPES` narrows by card type; this one narrows by nothing, which is
 * the entire card. Bojuka Bog and Tormod's Crypt are answers to a graveyard
 * *strategy*, and a version that left the noncreature cards behind would be a
 * different, worse card wearing the same name. Exactly one of `whose` and
 * `target` is present: the former preserves fixed-owner sweeps, while the latter
 * is restricted to hand-authored target-player effects.
 */
function exileGraveyardEffect<T extends ZodType>(target: T) {
  return z
    .strictObject({
      kind: z.literal('exileGraveyard'),
      whose: GraveyardOwnerSchema.optional(),
      target: target.optional(),
    })
    .refine(
      (effect) => (effect.whose === undefined) !== (effect.target === undefined),
      'exileGraveyard requires exactly one of whose or target',
    );
}

/**
 * Haunting Echoes' linked graveyard exile and same-name library search.
 *
 * One effect rather than `exileGraveyard` followed by `searchLibrary`, because
 * the second filter is not printed data: it is derived from the cards the
 * first move actually put into exile and exists only for this resolution. A
 * general remembered-name register would expose an intermediate value other
 * effects could read after its rules lifetime, while two independent effects
 * could not express the link at all.
 *
 * The target is real (CR 115.1a), like `exileGraveyard`'s hand-authored target
 * form rather than its fixed owner form. Haunting Echoes may name either
 * player, and CR 608.2b must be able to take the whole operation when that
 * target is illegal. `validate/effects.ts` narrows the hand-authored slot to
 * `targetPlayer`; accepting `targetOpponent` would print a smaller choice than
 * the card has.
 *
 * The hidden-zone choice remains in the kernel's interruptible search runner.
 * Current CR 701.23b permits the searching player to find zero, some, or all
 * matching cards even though the instruction says “all,” so a synchronous
 * mass move would be observably wrong.
 */
function exileNonbasicGraveyardAndMatchingLibraryEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('exileNonbasicGraveyardAndMatchingLibrary'),
    target,
  });
}

/**
 * Conundrum Sphinx's one-resolution name choices and linked top-card result.
 *
 * The name is runtime input rather than schema data: CR 201.4 permits any
 * Oracle card name, including one outside the format, so a card list here would
 * either leak hidden deck construction or narrow the printed choice. One
 * composite keeps the choices tied to the reveals that consume them and gives
 * no unrelated effect a resolution-local name register to read.
 */
function eachPlayerNamesCardThenRevealsTopEffect() {
  return z.strictObject({ kind: z.literal('eachPlayerNamesCardThenRevealsTop') });
}

/**
 * Slaughter Games' resolution-local name and fixed three-zone operation.
 *
 * The target, nonland restriction, searched zones, exile destination, and
 * shuffle are one capability. Exposing any of them as independent fields
 * would create combinations no source card attests and widen hand-authored
 * effects without widening what the kernel can safely execute.
 */
function nameNonlandCardAndExileMatchingOpponentZonesEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('nameNonlandCardAndExileMatchingOpponentZones'),
    target,
  });
}

/**
 * Where a `searchLibrary` puts what it finds.
 *
 * Three members, all printed: Rampant Growth puts a land onto the battlefield,
 * Borderland Ranger puts one in a hand, Farseek puts one onto the battlefield
 * tapped. A graveyard destination is absent because a tutor that mills what it
 * finds is a different effect (`millCards` already exists and does not need a
 * filter), and the stack is not a destination a search may name at all
 * (CR 701.19b).
 *
 * **`battlefieldTapped` is a third member rather than a sibling `tapped`
 * flag**, and the argument is `GRAVEYARD_CHOICE_DESTINATIONS`' one direction
 * over. Tapped-ness is a property of *arriving on the battlefield* — CR 614
 * modifies the entry event and there is no other event to modify — so a flag
 * beside the enum would make `{ destination: 'hand', tapped: true }` a shape
 * that parses, validates, renders as a sentence and means nothing, and every
 * reader of the effect would then carry the rule that says which pairs are
 * real. The enum makes the pair unrepresentable instead, for the cost of one
 * string, and the tapped-ness is read back in exactly one place
 * (`searchDestinationZone` in `kernel/src/scry.ts`) rather than at each of
 * them.
 *
 * It is also the reason this is not `entersTapped` on the *filter*: the filter
 * says which cards a search may take, and Farseek's tapped clause applies to
 * the land it took regardless of which land that was.
 */
const ZONE_CHANGE_SEARCH_DESTINATIONS = ['hand', 'battlefield', 'battlefieldTapped', 'exile'] as const;

/**
 * `libraryTop` is a direct destination rather than a zone change: its searched
 * card stays in the library while the rest is shuffled, then becomes the first
 * object in library order. It is therefore excluded from `oneAndRest` below,
 * whose two arms move found cards into zones after one shared search.
 */
export const SEARCH_DESTINATIONS = [...ZONE_CHANGE_SEARCH_DESTINATIONS, 'libraryTop'] as const;
export const SearchDestinationSchema = z.enum(SEARCH_DESTINATIONS);
export type SearchDestination = z.infer<typeof SearchDestinationSchema>;

/**
 * Exile reached by a search and remembered by the permanent whose ability
 * performed it.
 *
 * This is not an ordinary `SearchDestination`. A card in a hand or on a
 * battlefield has arrived and the search is finished with it; this card also
 * leaves a relation behind, because a later ability on the same source can say
 * "the exiled card". Keeping that relation in the discriminant makes an
 * unlinked exile impossible to author accidentally and keeps one-and-rest
 * searches from assigning a source link to only half of their result.
 */
export const SOURCE_LINKED_EXILE_DESTINATION = 'sourceLinkedExile' as const;
export const SourceLinkedExileDestinationSchema = z.literal(SOURCE_LINKED_EXILE_DESTINATION);
export type SourceLinkedExileDestination = z.infer<typeof SourceLinkedExileDestinationSchema>;

/**
 * Put one of the cards found into `one` and every other card found into
 * `rest`, with the searching player choosing which card is the one.
 *
 * This is a destination plan rather than two `searchLibrary` effects. Cultivate
 * searches once, reveals the whole found group once, assigns the two zones,
 * and shuffles once. Two effects would expose two independent fail-to-find
 * choices and shuffle between them, which is observably a different card.
 *
 * The plan generalizes the real distinction without making selection order
 * carry hidden meaning: the kernel first finishes the unordered search, then
 * asks which found card receives `one`. Applying destinations in selection or
 * library order would let library order decide a game choice the card gives to
 * its controller.
 */
export const OneAndRestSearchDestinationSchema = z.strictObject({
  kind: z.literal('oneAndRest'),
  one: z.enum(ZONE_CHANGE_SEARCH_DESTINATIONS),
  rest: z.enum(ZONE_CHANGE_SEARCH_DESTINATIONS),
});

export type OneAndRestSearchDestination = z.infer<typeof OneAndRestSearchDestinationSchema>;

/**
 * Jarad's Orders' atomic split of one searched creature into hand and the
 * other into the graveyard.
 *
 * This is a capability bundle rather than a `graveyard` member added to
 * `SearchDestination`. A general member would also authorize a tutor whose
 * only destination is a graveyard, and every one-and-rest pairing with that
 * zone, although the reviewed source proves exactly one profile: a revealed
 * two-card search whose controller assigns one result to hand and sends the
 * remainder to the graveyard. The literal `one` arm keeps the existing
 * destination question's interface; the rest is carried by the discriminant
 * itself, so `graveyard` never becomes a generally authorable destination.
 */
export const OneToHandRestToGraveyardSearchDestinationSchema = z.strictObject({
  kind: z.literal('oneToHandRestToGraveyard'),
  one: z.literal('hand'),
});

export type OneToHandRestToGraveyardSearchDestination = z.infer<
  typeof OneToHandRestToGraveyardSearchDestinationSchema
> & {
  /** Type-only common interface; the discriminant carries this fixed destination. */
  readonly rest?: never;
};

/** The existing single destination or the one-and-rest split a card prints. */
export const SearchDestinationPlanSchema = z.union([
  SearchDestinationSchema,
  OneAndRestSearchDestinationSchema,
  OneToHandRestToGraveyardSearchDestinationSchema,
  SourceLinkedExileDestinationSchema,
]);

export type SearchDestinationPlan =
  | SearchDestination
  | OneAndRestSearchDestination
  | OneToHandRestToGraveyardSearchDestination
  | SourceLinkedExileDestination;

/**
 * Which cards a search may find, in printed characteristics only.
 *
 * A separate shape from `CountFilterSchema`, which it otherwise resembles, for
 * the argument `kernel/src/zone-filter.ts` makes at length about `ObjectFilter`
 * and `PrintedFilter`: the two answer different questions. A `CountFilter`
 * describes permanents on the battlefield, where a layer walk decides what a
 * card's types are; this describes cards in a library, where CR 611.2c leaves
 * nothing but what is printed. Sharing one shape would let a filter written for
 * one be handed to the other and typecheck while meaning something neither
 * promised.
 *
 * `supertypes` is the field that is here and not there, and it is the reason
 * this could not have been a widening: "search your library for a basic land
 * card" is the most-printed search in Magic and the word `basic` is a supertype.
 * Keywords are absent for `CountFilterSchema`'s stated reason — no card has
 * asked, and `PrintedFilter` has room the day one does.
 *
 * `colors` serves the same printed-card predicate for a library search or a
 * genuinely non-targeted graveyard choice. Printed graveyard targets use
 * `TargetFilter` instead, because their card is selected before resolution and
 * rechecked under CR 608.2b. No model-facing union reaches a `CardFilter` —
 * `searchLibrary` and `chooseFromGraveyard` are both hand-authored-only.
 *
 * `maxManaValue` is the field that is not a list, and the shape difference is
 * the point. The four above are "any of these", which is why they concatenate
 * into a noun phrase; this is a *bound*, printed as a trailing clause ("a
 * creature card with mana value 3 or less") and never as an adjective. It
 * arrived for the printed Vessari's `-2` ("...with mana value 4 or less from your
 * graveyard"), and the M11/M13 ledger wants it independently — a bounded
 * graveyard return is one of the most-printed shapes in the two sets.
 *
 * It bounds from above only. "Mana value 3 or greater" and "mana value exactly
 * 3" are both printed clauses and neither is here, because a range would be two
 * more fields serving no card in this world; a floor is a widening the day one
 * asks, and `PrintedFilter` is where it would land.
 *
 * The ceiling of 16 is not a claim about the format. It is roughly twice the
 * top of any curve this generator builds, so the bound never refuses a card
 * somebody meant; what it refuses is `mana value 99 or less`, a clause that
 * reads as a restriction and constrains nothing.
 *
 * `names` is the third shape: not an adjective and not a bound, but an
 * identity. "Cards named Squadron Hawk" is the printed clause, and no
 * combination of type, subtype and color says it — a name is the one
 * characteristic a card does not share with its neighbors by construction. It
 * is a list for the same reason the other lists are, "any of these", and Gem of
 * Becoming's "a Mountain card, an Island card, and a Swamp card" is *not* what
 * it says: that clause is a conjunction of three separate finds and belongs to
 * a search that carries three filters, not to a filter that carries three
 * names.
 *
 * Matching is on the printed name exactly, because that is what CR 201.2 makes
 * it: a name is a string compared as a string, and the two cards a player would
 * call "the same card" are the same card when their names match character for
 * character.
 *
 * `excludeCardTypes` is the fourth shape and the only one that subtracts.
 * Duress (M11 96, M13 90) is the clause that asked: "you choose a noncreature,
 * nonland card from it" names its set by what it refuses, and no combination of
 * the fields above says it — `cardTypes` is read with `anyOf`, so the four
 * remaining types spelled positively would be a filter that has to be rewritten
 * every time `CardKind` gains a member, and would say something different from
 * the printed sentence the day one does.
 *
 * It is `TargetFilterSchema.excludeCardTypes` copied deliberately to the
 * letter: same name, same `CardKindSchema`, same `.min(1)`, same
 * absent-means-unconstrained convention, and the same reading — a card matching
 * *any* listed type is refused, which is what "noncreature, nonland" means. The
 * two filters stay two shapes for the reason `zone-filter.ts` argues at length
 * (one describes permanents a layer walk has finished with, the other describes
 * cards where CR 611.2c leaves nothing but what is printed), but a reader who
 * has learned the negation on a target should not have to learn it again here,
 * and `filterAdjectives` already prints `non${kind}` for that field so the
 * English comes across too.
 *
 * `excludeColors` is *not* here beside it, which is the asymmetry with the
 * target filter worth stating. Doom Blade is the card that put the color
 * negation on `TargetFilter` and it points at the battlefield; no clause
 * reaching a library, a graveyard or a revealed hand in this population names a
 * color it refuses. The day one does, this is where it lands and
 * `PrintedFilter` already carries the predicate.
 *
 * `allCardTypes` is absent for a stronger reason than "no card has asked": a
 * conjunction of card types describes one object that is several things at once
 * (an artifact creature), and every clause in this population that reaches a
 * hidden zone names a class rather than an intersection. It is also the field
 * whose absence keeps the contradiction check next door small — there is one
 * wanted list to compare against one excluded list rather than two.
 *
 * Every field is optional and absent means "no constraint", so `{}` is a legal
 * filter and finds anything. That is a real card (Demonic Tutor), not a
 * degenerate case to defend against.
 */
export { CardFilterSchema } from './card-filter';
export type { CardFilter } from './card-filter';

/**
 * CR 701.19: look through your library for a card matching a filter, take it,
 * and shuffle.
 *
 * **This is the second effect in the engine that suspends a resolution**, and
 * it reuses the first one's machinery rather than growing its own. `scry` stops
 * `applyResolutionEffects` mid-list, banks the effects that have not run yet
 * plus everything resolution-local (the chosen X, the object headed for a
 * graveyard, the exile count, the deferred triggers) into `GameState`, and
 * resumes from that record when the answer arrives. A search does exactly that
 * with a different pending record, because the alternative — resolving the
 * choice eagerly with a heuristic — would put card-quality judgment in the
 * kernel, and the alternative to *that* — a callback — would make a game state
 * hold a closure and stop being serializable, which is the whole determinism
 * story.
 *
 * **Failure is derived, not a field.** CR 701.19b permits failing to find when
 * the search states a card quality, and a count above one renders as "up to",
 * so either shape gets a "found nothing" answer. An unrestricted one-card
 * search states no quality and must find a card from a nonempty library. The
 * filter and count already determine which rule applies, so an `optional` flag
 * would be a second answer that could disagree with the printed effect.
 *
 * No target and no player field, for `shuffleLibraryEffect`'s reason: it is
 * always the controller's own library. Searching an opponent's library is a
 * different card and a different concealment argument.
 *
 * ## `count`, and why it is an `Amount`
 *
 * Absent means one, which is what every search written before this printed and
 * what keeps the whole recorded corpus parsing byte-for-byte — `amount.ts`'s
 * own argument for why a bare integer is still an `Amount`, applied to the
 * field's presence rather than to its shape.
 *
 * It is the shared `Amount` union and not an integer, because the two cards
 * that want a count want different kinds of one. Ranger's Path takes two, a
 * numeral; M13's mass-ramp sorcery takes "X basic land cards, where X is the
 * number of lands you control", which is `countMatching` and is already
 * spelled. A second
 * variable idiom invented here would have been a second thing for
 * `evaluateAmount` to know about and a second phrase for `computedPhrase` to
 * print, in exchange for a field that says the same word twice.
 *
 * The literal arm is bounded for `MAX_SCRY_COUNT`'s reason and the computed arm
 * is not, because the bound is about the *decision space* and the two arms
 * spend it differently: a search is answered one card at a time against the
 * cards after the last one taken, so a count of four over a sixty-card library
 * is four bounded questions rather than one enumeration, and a computed count is
 * clamped by the library it is searching. See `MAX_SEARCH_COUNT`.
 *
 * ## `reveal`
 *
 * CR 701.16a, and it is a flag rather than a separate `revealCard` primitive
 * because the cards it must reveal are the cards this search just took, which
 * nothing outside the paused resolution can name. Sylvan Ranger reveals what it
 * found; Rampant Growth does not; Diabolic Tutor cannot, because a revealed
 * tutor is a different card. Absent means no reveal, so every search written
 * before this keeps the concealment it had.
 *
 * The reveal is what a search does *before* the cards leave the library, which
 * is why the kernel emits it against the library and not against the
 * destination: "reveal it, put it into your hand" is two actions in printed
 * order, and a reveal emitted after the move would name cards the opponent can
 * already see in a hand they cannot.
 */
/**
 * Largest literal count a `searchLibrary` admits.
 *
 * `MAX_SCRY_COUNT`'s bound at a different arithmetic. A scry's decision space is
 * the ordered partitions of its window and grows as `(n + 1) * n!`, so four is
 * where 512 options runs out. A search's is not enumerated whole: the kernel
 * asks "which card next" against the cards after the last one taken, so the
 * space is linear in the library per question and a count of ten would be legal
 * arithmetic. The bound is here for the other reason a bound exists — nothing in
 * M11 or M13 searches for more than three (Squadron Hawk), so a literal above
 * that is a typo rather than a card, and a typo that costs a player ten prompts
 * should not parse.
 *
 * The computed arm carries no bound because it has no numeral to check: "X basic
 * land cards, where X is the number of lands you control" is bounded by the
 * board, and the kernel clamps it to the cards the filter actually matches.
 */
export const MAX_SEARCH_COUNT = 4;

/**
 * CR 701.22 over a whole graveyard: every card in it goes into its owner's
 * library, and the library is then shuffled.
 *
 * The reverse of `millCards` and not a widening of `shuffleLibrary`, which
 * shuffles a library that is already a library. What makes this one primitive
 * rather than two is CR 701.22b: the cards enter the library and the shuffle
 * happens as one action, so nothing may be put on top in between and no player
 * ever sees an ordered library that held them.
 *
 * There is no `whose` field, unlike `exileGraveyard` one row up, and the
 * asymmetry is the population's rather than a taste. Graveyard exile is printed
 * at every seat — Bojuka Bog at an opponent, Rest in Peace at everybody — while
 * a shuffle-back is printed at its own controller (Elixir of Immortality) or at
 * everybody at once as half of a much larger sentence (Time Reversal, which
 * also shuffles hands and exiles itself, so the field alone would not reach it).
 * A `whose` here would be an arm no card in this workspace can print, and every
 * reader of the union would carry it.
 *
 * `includeSelf` is Elixir's second half: "shuffle this artifact **and** your
 * graveyard into their owner's library" is one printed action, and without the
 * field it would have to be a second effect — which would put the card at three
 * effects against `AbilitySchema`'s cap of two, and would also be wrong, since a
 * separate `putOnLibrary` names a top or a bottom that the shuffle immediately
 * makes meaningless. `z.literal(true).optional()` for `regenerateSelf`'s reason:
 * absence is the only spelling of "the source stays where it is".
 */
function shuffleGraveyardIntoLibraryEffect() {
  return z.strictObject({
    kind: z.literal('shuffleGraveyardIntoLibrary'),
    includeSelf: z.literal(true).optional(),
    /** Psychic Spiral's current Oracle wording, distinct from Elixir's graveyard shorthand. */
    printedAllCardsFromYourGraveyard: z.literal(true).optional(),
  });
}

/**
 * Time Reversal's one atomic action over every player (CR 701.22).
 *
 * This is not a `whose` widening of `shuffleGraveyardIntoLibrary`: that
 * primitive moves one graveyard and may carry its permanent source, while
 * this one moves two zones for every seat and never carries the resolving
 * spell. The plural discriminant states the only reviewed scope without a
 * redundant field whose other values no card has exercised.
 */
function shuffleHandsAndGraveyardsIntoLibrariesEffect() {
  return z.strictObject({ kind: z.literal('shuffleHandsAndGraveyardsIntoLibraries') });
}

/** Worldfire's atomic pre-move cohort of every hand and graveyard card. */
function exileHandsAndGraveyardsEffect() {
  return z.strictObject({ kind: z.literal('exileHandsAndGraveyards') });
}

/**
 * A resolving spell changes its own normal destination to exile.
 *
 * Kept as an ordered effect rather than card metadata because Oracle text and
 * Forge both print it as the last instruction, after the other effects have
 * happened. Structural validation keeps it off permanent abilities.
 */
function exileThisSpellEffect() {
  return z.strictObject({ kind: z.literal('exileThisSpell') });
}

export const SearchFilterQuotaSchema = z.strictObject({
  filter: CardFilterSchema,
  count: z.int().min(1).max(MAX_SEARCH_COUNT),
});

export type SearchFilterQuota = z.infer<typeof SearchFilterQuotaSchema>;

function searchLibraryEffect() {
  return z
    .strictObject({
      kind: z.literal('searchLibrary'),
      filter: CardFilterSchema.optional(),
      filterQuotas: z.array(SearchFilterQuotaSchema).min(2).max(MAX_SEARCH_COUNT).optional(),
      destination: SearchDestinationPlanSchema,
      count: z.union([z.int().min(1).max(MAX_SEARCH_COUNT), ComputedAmountSchema]).optional(),
      reveal: z.boolean().optional(),
    })
    .refine(
      (effect) =>
        (effect.filter === undefined) !== (effect.filterQuotas === undefined) &&
        !(effect.filterQuotas !== undefined && effect.count !== undefined),
      'a library search needs exactly one of filter or filterQuotas, and only a homogeneous search names count',
    )
    .refine(
      (effect) =>
        effect.destination !== 'libraryTop' ||
        effect.filterQuotas === undefined ||
        effect.filterQuotas.reduce((total, quota) => total + quota.count, 0) === 1,
      'the library-top search destination places one chosen card on top; use a one-card search',
    );
}

/**
 * Move the cards this source permanently linked in exile.
 *
 * Forge's `ExiledWith` relation and XMage's
 * `ExileTargetForSourceEffect`/`ReturnFromExileForSourceEffect` are the two
 * independent prior-art implementations behind the shape. The link belongs
 * to one source incarnation rather than to a resolution, so an enters trigger
 * can write it and that incarnation's later departure trigger can read it.
 * Each destination is backed by an exact source-attested card.
 */
function moveSourceLinkedExileEffect() {
  return z.strictObject({
    kind: z.literal('moveSourceLinkedExile'),
    destination: z.enum(['hand', 'battlefieldUnderOwner']),
    /** Print and validate the all-card reader paired with a cohort writer. */
    plural: z.literal(true).optional(),
  });
}

/**
 * Where one card chosen out of a graveyard goes.
 *
 * Three members where `SEARCH_DESTINATIONS` has two, and the third is the
 * reason this is a separate enum rather than a reuse: exile is not a place a
 * search may send what it finds (a tutor that exiles its own find is Hoarding
 * Dragon and prints the exile as a second clause), but it is exactly where
 * Vile Rebirth and Tormod's Crypt send a card *out of* a graveyard, and a
 * graveyard is the one zone Magic routinely empties into exile. Sharing one
 * enum would have made `searchLibrary`'s type admit a destination CR 701.19b
 * forbids, in exchange for saving five lines.
 *
 * A hand destination is here and a library destination is not. Mwonvuli Beast
 * Tracker puts what it finds on top of a library, but that is a *search* and
 * `putOnLibrary` is the primitive for the other direction; nothing in M11 or
 * M13 puts a card from a graveyard onto a library, and a word no card
 * exercises is a word nobody has checked.
 */
export const GRAVEYARD_CHOICE_DESTINATIONS = ['hand', 'battlefield', 'exile'] as const;
export const GraveyardChoiceDestinationSchema = z.enum(GRAVEYARD_CHOICE_DESTINATIONS);
export type GraveyardChoiceDestination = z.infer<typeof GraveyardChoiceDestinationSchema>;

/**
 * Who controls the permanent a graveyard choice puts onto the battlefield.
 *
 * A second field rather than a fourth destination, because control and
 * ownership are different properties of the same object (CR 108.4, CR 110.2)
 * and the destination names a *zone*. `GRAVEYARD_CHOICE_DESTINATIONS` is
 * spelled in the kernel's own `ZoneId` words and `answerGraveyardChoice` hands
 * it straight to `moveObject`; a member meaning "the battlefield, but under
 * somebody else's control" would be the one destination that is not a zone,
 * and every reader of the enum would have to learn the exception.
 *
 * `'owner'` is the default and the absent value, which is what every card
 * written before this field said and still says: a card in a graveyard is in
 * its owner's graveyard, `moveObject` carries that owner onto the battlefield,
 * and for `whose: 'you'` the owner and the caster are the same seat anyway.
 * `'you'` is the clause that needs the distinction — Rise from the Grave's
 * "onto the battlefield under your control", reaching into a graveyard that
 * may not be yours. The permanent keeps its owner either way (CR 110.2a): the
 * card goes back to that player's graveyard when it dies, whoever was playing
 * with it.
 *
 * Only a battlefield destination may carry it. A card in a hand or in exile
 * has an owner and no controller, so `'you'` on either is a sentence about
 * nothing, and `checkGraveyardArrivalParams` refuses it rather than letting it
 * sit unread.
 */
export const GRAVEYARD_CHOICE_CONTROLLERS = ['owner', 'you'] as const;
export const GraveyardChoiceControlSchema = z.enum(GRAVEYARD_CHOICE_CONTROLLERS);
export type GraveyardChoiceControl = z.infer<typeof GraveyardChoiceControlSchema>;

/**
 * What the arriving permanent becomes *in addition to* what it already is.
 *
 * Rise from the Grave's second sentence: "That creature is a black Zombie in
 * addition to its other colors and types." The three words that matter are "in
 * addition to" — the creature keeps every printed color and subtype it had and
 * gains these, which is CR 613's layer 4 (`addSubtypes` with the printed line
 * left standing) and layer 5 (`addColors` rather than `setColors`). The kernel
 * has carried both shapes since `continuous.ts` was written; what was missing
 * was a card that could say them.
 *
 * A field on the choice rather than an effect of its own, because "that
 * creature" is the card this very effect just moved and no `TargetSpec` names
 * it. A second effect would have to refer back to the first one's answer, which
 * is a linkage this vocabulary does not have (`untapPermanent`'s row in
 * `validate/effects.ts` argues the same gap for "untap *it*"), and inventing it
 * for one card would put a dangling referent in every effect list.
 *
 * Colors and subtypes and nothing else. No M11 or M13 card in this family adds
 * a *card* type from a graveyard, and a word no card exercises is a word nobody
 * has checked; layer 4's `addTypes` is where one would land the day a card
 * says it. Both lists are optional and at least one has to be present, because
 * a grant that grants nothing is a sentence the face would print and the board
 * would not show.
 */
export const GraveyardArrivalGrantSchema = z.strictObject({
  colors: z.array(ColorSchema).min(1).optional(),
  subtypes: z.array(z.string().min(1)).min(1).optional(),
});
export type GraveyardArrivalGrant = z.infer<typeof GraveyardArrivalGrantSchema>;

/**
 * One card leaves a graveyard through a genuine resolution-time choice.
 *
 * `returnFromGraveyard` covers both targeted single-card movement and scoped
 * mass movement. This separate primitive is only for text that really tells a
 * player to choose during resolution. It must not encode printed "target card"
 * text: doing so removes the response window and makes the resolving object
 * silently substitute a different card after the intended one leaves.
 *
 * **It stops the resolution**, which is what keeps it unpriced and out of the
 * generator: `searchLibraryEffect`'s paragraph on the same point applies word
 * for word, and admitting it to the model would hand a batch a card whose cost
 * is a decision space rather than a number.
 *
 * **Optional by construction.** The kernel enumerates "take nothing" beside
 * every match. A mandatory targeted card therefore belongs on a graveyard-card
 * `TargetSpec`, never here. The graveyard is public (CR 400.2), so declining
 * reveals nothing the opponent could not already read off the table.
 *
 * `whose` reuses `exileGraveyard`'s fixed-owner enum: the graveyard is named
 * rather than targeted, and in a two-player game `'opponent'` names exactly the
 * other seat without creating a target.
 * The cards inside it are not targeted; callers must preserve that distinction
 * rather than treating this as shorthand for a target.
 *
 * `control` and `alsoBecomes` are the two clauses a reanimation prints beyond the
 * move itself, both optional and both argued at their own schemas above. They
 * are absent on every card written before them, which is why they are optional
 * rather than defaulted: an absent field serializes to nothing, so the
 * flagship's two battlefield returns and the six hand returns keep the bytes
 * they already have.
 */
function chooseFromGraveyardEffect() {
  return z.strictObject({
    kind: z.literal('chooseFromGraveyard'),
    whose: GraveyardOwnerSchema,
    filter: CardFilterSchema,
    destination: GraveyardChoiceDestinationSchema,
    control: GraveyardChoiceControlSchema.optional(),
    alsoBecomes: GraveyardArrivalGrantSchema.optional(),
  });
}

/**
 * Choose one permanent the resolving object's controller currently controls
 * and move it to its owner's hand.
 *
 * This is a resolution-time choice, not a target: the eligible set is read
 * when the effect resolves and no object is named while the spell or ability
 * goes on the stack. The controller is implicit because every source-attested
 * clause in this family says "you control"; an opponent-board arm would add an
 * interaction no card here exercises. `destination` has only the implemented
 * hand member so the typed record still says what the move does without
 * claiming an untested battlefield or graveyard variant.
 */
function chooseFromBattlefieldEffect() {
  return z.strictObject({
    kind: z.literal('chooseFromBattlefield'),
    filter: TargetFilterSchema,
    destination: z.literal('hand'),
  });
}

/** The two source-attested destinations for a card returning itself. */
export const RETURN_SOURCE_DESTINATIONS = ['hand', 'battlefieldTapped'] as const;
export const ReturnSourceDestinationSchema = z.enum(RETURN_SOURCE_DESTINATIONS);
export type ReturnSourceDestination = z.infer<typeof ReturnSourceDestinationSchema>;

/**
 * Move the exact card whose activated ability is resolving out of its owner's
 * graveyard. This is not a target or a mid-resolution choice: the source oid
 * is already on the stack entry, and another card with the same name is not a
 * legal substitute. `validate/abilities.ts` confines the effect to an ability
 * that explicitly activates from a graveyard.
 */
function returnSourceFromGraveyardEffect() {
  return z.strictObject({
    kind: z.literal('returnSourceFromGraveyard'),
    destination: ReturnSourceDestinationSchema,
  });
}

/** Return the exact source incarnation retained by a battlefield-to-graveyard trigger. */
function returnDepartedSourceToOwnerHandEffect() {
  return z.strictObject({ kind: z.literal('returnDepartedSourceToOwnerHand') });
}

/** Put the exact departed source incarnation on top of its owner's library. */
function putDepartedSourceOnTopOfOwnerLibraryEffect() {
  return z.strictObject({ kind: z.literal('putDepartedSourceOnTopOfOwnerLibrary') });
}

/** Shuffle the exact source incarnation retained when it entered a graveyard. */
function shuffleSourceIntoOwnerLibraryEffect() {
  return z.strictObject({ kind: z.literal('shuffleSourceIntoOwnerLibrary') });
}

/** Return this Aura source from its owner's graveyard attached to one target. */
function returnSourceAuraAttachedEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('returnSourceAuraAttached'), target });
}

/**
 * Largest number of cards one printed discard takes, whoever chooses them.
 *
 * `MAX_SCRY_COUNT`'s argument at the other pausing primitive, with a different
 * arithmetic behind the same conclusion. Nicol Bolas, Planeswalker prints
 * seven, the largest count in the pinned M11/M13 population. The set-selection
 * protocol asks one card at a time, so this bound is about what a card face may
 * print rather than about the size of a binomial choice space.
 *
 * A printed number larger than the hand is not out of range, it is CR 701.8a:
 * a player who cannot discard that many discards as many as they can. The
 * kernel bounds the pending count by the hand it is asked of, and this constant
 * bounds only what the card may say.
 */
export const MAX_DISCARD_COUNT = 7;

/**
 * CR 701.8: a player puts cards from their hand into their graveyard, choosing
 * which.
 *
 * **The choosing player is the hand's owner, and that is the whole difference
 * from `chooseDiscard` below.** Mind Rot is this one: the caster picks nobody's
 * cards, and the discarding player takes the decision. So the card ids are
 * never shown to anyone the rules do not already show them to, no reveal
 * happens, and the opponent learns what was discarded when it lands in a public
 * zone the way any discard is learned.
 *
 * It stops the resolution anyway, for the reason `searchLibraryEffect` gives:
 * which cards leave a hand is a judgment about a game position, and the two
 * alternatives to asking are a heuristic in the kernel or a callback on the
 * state. A random discard would be a third effect (CR 701.8b) and is not this
 * one; nothing in the M11/M13 identities prints it, and it would need its own
 * draw from the seeded generator rather than a decision.
 *
 * `count` is a plain integer rather than an `Amount`, which is where this
 * departs from `drawCards` and `millCards`. Those resolve their quantity while
 * applying and never have to say it again; a pause has to bank the number
 * across a `reduce` boundary, and the value a `chosenX` or a board count
 * resolves to at the pause is not necessarily the value it resolves to when the
 * answer arrives. Banking the resolved integer is the fix, and a schema that
 * cannot express the unresolved form is what makes the fix unnecessary.
 *
 * `players` is the third carrier of `PLAYER_SWEEP_FIELD`, after `drawCards`
 * (Temple Bell) and `loseLife` (Howling Banshee), and it arrives for Liliana's
 * Specter (M11 104): "each opponent discards a card". It is not
 * `targetOpponent` — `PLAYER_SCOPES`' docblock argues that at length, and
 * Ravenous Rats (M13 106) prints the targeted twin in the same corpus, so the
 * two spellings have to stay two cards. The sweep and the target slot exclude
 * each other in both directions here: `checkPlayerSweep` refuses a sweep
 * beside a live target, and this primitive's own row in `EFFECT_RULES` refuses
 * the bare `noTarget` slot without one, because a discard that names no hand
 * would read as the controller's own and no printed discard says that without
 * printing "you".
 *
 * Hand-authored only, by construction rather than by decision, exactly as
 * `loseLife` holds the same field: `discardCards` is absent from
 * `generatableEffects`, so this field cannot reach `ModelEffectSchema` and no
 * recorded LLM fixture key moves.
 */
function discardCardsEffect<T extends ZodType, P extends object>(target: T, playerSweep: P) {
  return z.strictObject({
    kind: z.literal('discardCards'),
    count: z.union([z.int().min(1).max(MAX_DISCARD_COUNT), z.literal('all')]),
    /** Rakdos's Return links the count to the X announced for the spell. */
    countFrom: z.literal('chosenX').optional(),
    target,
    /** CR 701.8b: the game chooses from the hand through its seeded RNG. */
    random: z.literal(true).optional(),
    ...playerSweep,
  });
}

/**
 * CR 701.16a then CR 701.8: a player reveals their hand, and their opponent
 * picks what goes.
 *
 * Coercion and Distress, and the clause `revealHandEffect` above says the
 * vocabulary had no way to print. Its docblock states the blocker exactly — a
 * rider to a reveal needs "a target kind that names a card in a hand, and no
 * `TargetKind` does" — and this does not add one. The chosen card is named by
 * an `Action` the choosing seat submits while the resolution is suspended, so
 * it is a decision and not a target: CR 115.1's rules about what may be
 * targeted, when legality is rechecked, and what happens when every target is
 * gone never come into it, and a card in a hidden zone never has to become
 * addressable from a `TargetSpec`.
 *
 * **The reveal is part of this effect rather than a separate step.** Printing
 * `revealHand` and then this would be two effects that can be separated —
 * anything between them could change the hand, and a chooser would be picking
 * from a list that is no longer what was shown. So the pause emits the reveal
 * and banks the same list it showed, and the answer is checked against that
 * list rather than against the hand as it stands.
 *
 * `target` names the player who discards, never the one who chooses: the
 * chooser is the effect's controller, which `ApplyContext` already carries and
 * no card has ever printed otherwise.
 *
 * **`filter` says which of the revealed cards may be named, and its absence is
 * Coercion rather than an oversight.** Duress prints the constrained half —
 * "you choose a noncreature, nonland card from it" — and without this field it
 * was authored as an unconstrained `chooseDiscard`, returned zero violations,
 * and shipped a card that could take a Mountain. That is the failure worth
 * naming precisely: a refusal is visible in the coverage census and a
 * silently-stronger card is not, so the vocabulary being narrower than the
 * printing is a better state than the vocabulary being wider.
 *
 * It is a `CardFilter` and not a `TargetFilter` for the reason the two shapes
 * exist at all: a card in a hand is not a permanent, nothing has applied a
 * layer to it, and CR 611.2c leaves it exactly what it printed. That also makes
 * this the third effect reading the same shape, which is the load-bearing part
 * — `asPrintedFilter` in `kernel/src/scry.ts` converts it once for all three,
 * so a field added here reaches a search, a graveyard choice and a hand choice
 * together rather than by somebody remembering.
 *
 * The filter narrows *the choice*, never the reveal. CR 701.16a shows the whole
 * hand and the printed sentence constrains only what may be chosen out of it,
 * which is why the kernel's pending record carries two lists rather than one
 * (`PendingHandDiscard` in `kernel/src/state.ts` argues that side).
 */
function chooseDiscardEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('chooseDiscard'),
    count: z.int().min(1).max(MAX_DISCARD_COUNT),
    target,
    filter: CardFilterSchema.optional(),
  });
}

/**
 * Reveal one player's hand, let the resolving controller choose from a printed
 * subset, and keep that exact choice linked to one of the two operations that
 * consume it in M13.
 *
 * The choice is not a CR 115 target. It happens during resolution, after the
 * hand is revealed, so the candidate object belongs in the pending decision
 * rather than in `TargetSpec`. Keeping reveal, choice, and outcome in one
 * primitive also prevents an unrelated effect from observing a generic
 * remembered-card register after its rules lifetime.
 *
 * The outcome discriminant carries the rules difference rather than an
 * optional flag that could be paired with the wrong operation. Mindclaw's
 * outcome offers declining as one answer and retains the chosen object for the
 * existing free-cast pipeline. Shimian's mandatory outcome retains only the
 * printed name needed by its same-name cross-zone move.
 */
function chooseFromRevealedHandEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('chooseFromRevealedHand'),
    target,
    filter: CardFilterSchema,
    outcome: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('mayCastWithoutPayingManaCost') }),
      z.strictObject({ kind: z.literal('exileAllCardsWithSameNameThenShuffle') }),
    ]),
  });
}

/**
 * CR 118.2's other direction: life taken away by something that is not damage.
 *
 * Shaped exactly like `gainLife` — an `Amount` and a `TargetSpec` — because it
 * is the same sentence with the sign turned over, and the two are read side by
 * side on the cards that print both halves ("target player draws two cards and
 * loses 2 life").
 *
 * It is a separate primitive from `dealDamage` rather than a negative amount on
 * one, and the difference is a rule rather than a spelling: damage is
 * preventable (CR 615), redirectable, stopped by protection and marked on a
 * permanent until cleanup, and none of that is true of life loss. A card that
 * printed "loses 2 life" and ran as damage would be a strictly worse card than
 * the one it says it is, in a way a player finds out about only when a Fog is
 * up.
 *
 * `targetOpponent` prints "target opponent loses N" and nothing else. "Each
 * opponent loses N" is a different printed line with its own spelling one row
 * over, `players: 'eachOpponent'`, and this paragraph said the opposite until
 * `PLAYER_SCOPES` grew that member: it argued that a two-seat kernel makes the
 * one opponent the whole group, so the targeted slot could carry the untargeted
 * sentence. The seat count is true and the conclusion does not follow. CR 115.1
 * is the difference and it does not care how many seats there are — a target is
 * chosen on announcement, so hexproof answers it and CR 608.2b takes the whole
 * ability when the chosen seat stops being legal; a scope chooses nobody, so
 * neither happens. Liliana's Specter (M11 104) and Ravenous Rats (M13 106)
 * print the pair on one effect kind in one corpus, which is what makes the
 * substitution a card the kernel cannot run rather than a shorter way to say
 * the same thing.
 *
 * `players` is that scope, and it reaches either set of seats: "each player
 * loses N life" (Howling Banshee, M11 100) and "each opponent loses N life"
 * (Blood Tithe's first sentence, M13 79). It is `PLAYER_SWEEP_FIELD`, the same
 * field `drawCards` carries for Temple Bell, rather than a `targetPlayer` slot
 * pointed twice: a `targetOpponent` life loss beside a `noTarget` one picks out
 * the same two seats in a two-player game and is still a different card,
 * because the chosen half can be answered and taken away while the controller's
 * own half is left unresolved. The scope has no half to lose, and
 * `PLAYER_SCOPES`' docblock predicted a second sentence would want it before
 * this one arrived.
 *
 * Hand-authored only, and by construction rather than by decision: `loseLife`
 * is absent from `generatableEffects` altogether, so this field cannot reach
 * `ModelEffectSchema` and no recorded LLM fixture key moves. `UNPRICED_EFFECT_
 * KINDS` in `vocabulary.ts` already makes that argument for the whole
 * life-and-prevention block.
 */
function loseLifeEffect<T extends ZodType, A extends ZodType, P extends object>(
  target: T,
  amount: A,
  playerSweep: P,
) {
  return z.strictObject({
    kind: z.literal('loseLife'),
    amount,
    target,
    ...playerSweep,
    /** Havoc Festival's live retained-player quantity; hand-authored only. */
    amountFrom: z.literal('triggeringPlayerLifeHalfRoundedUp').optional(),
  });
}

/**
 * CR 118.5: a life total set to a number, which the rules resolve as gaining or
 * losing the difference rather than as an assignment.
 *
 * That is the whole of the primitive's semantics and the kernel implements it
 * literally — `life.ts` computes the difference and routes it through the same
 * `gainLife` a life-gain spell uses — so a life-gain trigger fires off
 * Elderscale Wurm and a life-gain doubler doubles what it gained, both of which
 * are what the printed cards do.
 *
 * No target: every card that prints this line says "your" or names a player
 * group (Elderscale Wurm, Touch of the Eternal, Worldfire), never "target".
 * Absence means the controller; `players` is the shared APNAP sweep vocabulary.
 *
 * `Amount` rather than an integer, for Touch of the Eternal: the number is
 * "the number of artifacts you control" as often as it is seven.
 */
function setLifeEffect<A extends ZodType>(amount: A) {
  return z.strictObject({
    kind: z.literal('setLife'),
    amount,
    players: PlayerScopeSchema.optional(),
  });
}

/** CR 104.3's instruction that one targeted player loses the game. */
function loseGameEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('loseGame'), target });
}

/** CR 104.2a: this effect's controller wins the game. */
function winGameEffect() {
  return z.strictObject({ kind: z.literal('winGame') });
}

/**
 * CR 615.1, in the one shape Magic has printed unchanged since Fog: prevent all
 * combat damage that would be dealt this turn.
 *
 * No parameters at all, which makes it the only member of this vocabulary with
 * nothing to state. Every knob a Fog could have carries a card the kernel
 * cannot run behind it: an amount would be a shield that depletes and the
 * kernel's `consume` deliberately never depletes an `'all'` one; a recipient
 * filter would be Safe Passage, and `ReplacementTrigger` has no word for "you
 * and creatures you control"; dropping the combat restriction would be Awe
 * Strike's whole-turn blanket, which is a different card and a much stronger
 * one.
 *
 * It resolves into `state.replacements` as an `endOfTurn` record, so the turn's
 * own cleanup expires it and nothing here has to (`packages/kernel/src/turn.ts`).
 */
function preventCombatDamageEffect() {
  return z.strictObject({ kind: z.literal('preventCombatDamage') });
}

/**
 * Druid's Deliverance's one-sided Fog: all combat damage to the resolving
 * effect's controller, and no damage to any other recipient.
 *
 * This is a sibling rather than a parameter on `preventCombatDamage`. The
 * blanket Fog has no recipient at all, while this printed sentence has one
 * fixed by the resolving controller and still targets nothing. Safe Passage's
 * live controller scope is wider in the other direction because it includes
 * creatures and noncombat damage. Keeping the three shapes separate prevents
 * an author from combining knobs into an effect no printed card or kernel path
 * has proved.
 */
function preventCombatDamageToYouEffect() {
  return z.strictObject({ kind: z.literal('preventCombatDamageToYou') });
}

/** CR 701.29: detain a chosen permanent incarnation until the controller's next turn. */
function detainPermanentEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('detainPermanent'), target });
}

/** The resolving ability's controller makes the legal block declaration this combat. */
function chooseBlockersThisCombatEffect() {
  return z.strictObject({ kind: z.literal('chooseBlockersThisCombat') });
}

/**
 * CR 615.1, aimed rather than blanket: Dawn Charm's first mode, "prevent all
 * damage that would be dealt to target creature this turn."
 *
 * `preventCombatDamageEffect`'s own docblock argues every knob on a Fog away,
 * and none of that argument applies here — this is not a wider Fog, it is the
 * *other* printed shape CR 615 has, and the two primitives cover different
 * cards on purpose rather than one growing a field. Safe Passage's "you and
 * creatures you control" is a separate untargeted sibling below, because its
 * live controller-defined group is not this effect's one chosen creature. A
 * depleting amount is still a partial shield rather than this card's whole one,
 * so that knob is not smuggled in through the target. What changes is the
 * *recipient*: one named creature instead of every combat participant, and
 * `combatOnly` dropped to `false` rather than `true` — the printed line says
 * "all damage", not "all combat damage", so a burn spell aimed at the shielded
 * creature is stopped exactly as a blocker's would be. That is Dawn Charm's
 * second-clause promise and the reason the two primitives are not the same
 * effect pointed differently: a Fog cannot stop a bolt and this can, because
 * the printed cards disagree about that on purpose.
 *
 * It resolves into `state.replacements` as an `endOfTurn` record naming the
 * target's own object id in `toPermanent`, which is the one field
 * `preventCombatDamageEffect` leaves at `null` — the turn's own cleanup expires
 * the record exactly as it expires the blanket one, and nothing here has to
 * remember the target once the shield outlives it: an object id that has left
 * the battlefield matches nothing in `triggerMatches`, so a creature that dies
 * mid-turn takes the shield down with it rather than leaving a record aimed at
 * nothing.
 *
 * Hand-authored only, and for `preventCombatDamageEffect`'s sharper reason
 * rather than its cost one: a targeted, uncapped damage prevention is card
 * advantage against exactly one removal spell or one combat step, and which
 * removal spell or which combat step is a fact about the game the model is
 * never shown. `UNPRICED_EFFECT_KINDS` in `vocabulary.ts` is where that
 * argument is made once for the whole life-and-prevention block; this member
 * joins it rather than restating it.
 */
function preventAllDamageToTargetEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('preventAllDamageToTarget'), target });
}

/**
 * Safe Passage's untargeted CR 615 scope: its controller and creatures that
 * player controls when damage would be dealt, for the rest of the turn.
 *
 * This is not a wider Fog: it prevents noncombat damage but only to one side.
 * It is also not `preventAllDamageToTarget` repeated over the current board:
 * the printed spell targets nothing, and a creature that changes controller
 * after resolution moves into or out of the protected group. The kernel keeps
 * that state-aware question on the replacement trigger rather than freezing
 * object ids into this serialized card value.
 */
function preventAllDamageToYouAndCreaturesYouControlEffect() {
  return z.strictObject({ kind: z.literal('preventAllDamageToYouAndCreaturesYouControl') });
}

/**
 * A depleting controller shield, optionally linked to Vengeful Archon's
 * retaliation target. The `noTarget` arm is Security Blockade's plain numeric
 * shield; the strict union keeps the linked and unlinked shapes distinct.
 */
function preventNextDamageToYouAndRetaliateEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('preventNextDamageToYouAndRetaliate'),
    amount: AmountSchema,
    target,
  });
}

/** Silence's turn-scoped rule for every opponent of the resolving controller. */
function cantCastSpellsThisTurnEffect() {
  return z.strictObject({
    kind: z.literal('cantCastSpellsThisTurn'),
    players: z.literal('eachOpponent'),
  });
}

/**
 * Autumn's Veil's one resolving effect and two turn-long rules.
 *
 * The list is ordered because Oracle and Forge preserve the printed color
 * order. It is unique because a repeated color names no additional rule and
 * would let two structurally different cards mean the same thing.
 */
function protectSpellsAndCreaturesFromSpellColorsThisTurnEffect() {
  return z.strictObject({
    kind: z.literal('protectSpellsAndCreaturesFromSpellColorsThisTurn'),
    colors: z
      .array(ColorSchema)
      .min(1)
      .max(COLORS.length)
      .refine((colors) => new Set(colors).size === colors.length, 'spell colors must be unique'),
  });
}

/**
 * CR 701.20a's action, and the counterpart `tapPermanent` has never had.
 *
 * ## Why a kind rather than a rider on the tap
 *
 * `doesNotUntap` is a rider because it is one adverb on one action: the
 * permanent still turns, it just stays turned, and `holdTapped` is `tapObject`
 * with a flag. This is not that. It is the opposite action — a different kernel
 * function (`untapObject`), a different printed verb, a different Forge
 * keyword, a different sign on every bot's evaluation — so a boolean here would
 * be a discriminant spelled as a parameter, and every consumer that reads it
 * would branch on it exactly as it branches on `kind`. A kind is what that
 * shape already is.
 *
 * ## Why `targetPermanent` is the space
 *
 * A tap in this vocabulary always names a creature, and its docblock proves it
 * from the scope tables. An untap does not: the printed lines are Voltaic Key's
 * "{1}, {T}: Untap target artifact", M13's "{T}: Untap target Forest", and
 * Mark of Mutiny's "Untap that creature" — two of the three are not creatures
 * at all. So the widest object space is the right one and `TargetSpec.filter`
 * is what cuts it down, which is `destroyPermanent`'s arrangement at the same
 * field and for the same reason: Craterize and Smelt differ only in which card
 * types they admit.
 *
 * A subtype is still out of reach — `TargetFilterSchema` narrows by card type
 * and color and nothing else — so "target Forest" lands as "target land" and
 * the Forest half is a `TargetFilter` lane rather than this one.
 *
 * ## What it deliberately does not do
 *
 * No `scope`. "Untap all creatures you control" is a printed line, but the
 * scope machinery reaches a group through the *player* it named, and every card
 * that wants this today names one permanent. A sweep arm nothing calls is a
 * second definition of the effect waiting to disagree with the first.
 *
 * And it does not clear a `doesNotUntap` hold. `untapObject` writes `tapped`
 * and leaves `skipsNextUntap` alone, which is the printed rule rather than an
 * omission: what Dungeon Geists takes is an untap *step*, and `untapStep` is
 * the one place that debt is spent. Untapping the creature in the middle of a
 * turn hands its controller the body back and settles nothing, which is what
 * two separate printed sentences that never mention each other should do.
 *
 * Hand-authored, and unpriced for a reason no research would settle: what an
 * untap is worth is entirely a fact about the board. Untapping a mana source is
 * a ritual, untapping a blocker is a Fog, untapping an untapped permanent is a
 * blank, and the model drafting a card is shown none of the three.
 */
function untapPermanentEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('untapPermanent'), target });
}

/** Destroy every currently attached permanent matching one live filter. */
function destroyAttachedPermanentsEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('destroyAttachedPermanents'),
    target,
    filter: TargetFilterSchema,
  });
}

/** Largest literal group untap currently required by the pinned corpus. */
export const MAX_UNTAP_PERMANENTS = 4;

/**
 * Choose up to `upTo` matching permanents, then untap the chosen group.
 *
 * Unlike `untapPermanent`, this instruction carries no `TargetSpec`: Rewind's
 * lands are chosen while the spell resolves and are not CR 115 targets. The
 * explicit filter keeps the primitive honest about which battlefield objects
 * it can offer, while the bounded count gives the kernel a finite sequential
 * choice without requiring it to enumerate every subset of a large board.
 *
 * Hand-authored only. The value of an untap depends on live board state, so the
 * generator is not shown this primitive any more than the targeted sibling.
 */
function untapPermanentsEffect() {
  return z.strictObject({
    kind: z.literal('untapPermanents'),
    upTo: z.int().min(1).max(MAX_UNTAP_PERMANENTS),
    filter: TargetFilterSchema,
  });
}

/**
 * Make one permanent miss its controller's next untap step without tapping it
 * now. The separation from `tapPermanent` is semantic, not cosmetic: Wall of
 * Frost marks the creature it blocked, and a vigilant attacker must remain
 * untapped until some later action taps it. The kernel consumes the resulting
 * debt at the named untap step whether or not it prevented an untap.
 *
 * Hand-authored only. This helper is appended only to `CardEffectSchema`, so
 * none of the model-facing unions or their recorded schema hashes move.
 */
function skipNextUntapEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('skipNextUntap'), target });
}

/**
 * A target spell on the stack receives a replacement target tuple as this
 * effect resolves. The spell itself is the effect's CR 115 target; the tuple
 * is a later player decision and therefore is not represented by TargetSpec.
 *
 * Hand-authored only. Target replacement is a board-sized decision space, so
 * neither this effect nor its optional stack filter belongs in the model's
 * fixed answer vocabulary.
 */
function changeSpellTargetsEffect() {
  return z.strictObject({ kind: z.literal('changeSpellTargets'), ...SPELL_FILTER_FIELD });
}

/**
 * Copy one target spell on the stack, retaining its copiable choices and
 * optionally replacing its targets. `spellFilter` supplies the instant-or-
 * sorcery restriction printed by Reverberate without creating a card-shaped
 * primitive.
 *
 * Hand-authored for the same decision-space reason as
 * `changeSpellTargetsEffect`.
 */
function copySpellEffect() {
  return z.strictObject({
    kind: z.literal('copySpell'),
    ...SPELL_FILTER_FIELD,
    /** Hand-authored CR 115 selector used by Nivix Guildmage. */
    spellSelection: z.literal('targetSpellYouControl').optional(),
  });
}

/**
 * Install Chandra's one-shot, turn-scoped trigger for the next instant or
 * sorcery the effect's controller casts. The later copy retains the cast
 * spell's copiable values and may choose new targets.
 *
 * Hand-authored only. Its value depends on a later spell and on timing the
 * activation, information an isolated generator effect slot cannot price.
 */
function copyNextInstantOrSorceryThisTurnEffect() {
  return z.strictObject({ kind: z.literal('copyNextInstantOrSorceryThisTurn') });
}

/**
 * Copy every card moved from a graveyard to exile earlier in this resolution,
 * then cast each copy without its mana cost if a complete legal declaration
 * exists. The copies are transient game objects; the exiled cards never move.
 *
 * Hand-authored only. It pauses on full cast declarations and therefore stays
 * outside every model-facing schema.
 */
function castCopiesOfCardsExiledThisResolutionWithoutPayingManaCostsEffect() {
  return z.strictObject({
    kind: z.literal('castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts'),
    /** Epic Experiment's atomic top-X originals, eligibility, and cleanup profile. */
    topXOriginalsProfile: z.literal(true).optional(),
  });
}

/**
 * CR 613.1b, layer 2, until cleanup: gain control of one chosen creature.
 *
 * This carries no untap or haste riders. Act of Treason composes those through
 * `untapPermanent` and `grantKeywordUntilEndOfTurn` with `thatCreature`
 * referents, which keeps each reusable rules action in one primitive and lets
 * other control spells choose the clauses they actually print.
 *
 * Hand-authored and absent from `ModelEffectSchema`; `vocabulary.ts` records
 * why the board-dependent exchange has no honest isolated generator price.
 */
function gainControlUntilEndOfTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('gainControlUntilEndOfTurn'), target });
}

/** CR 611.2a and layer 2: control one creature for this battlefield incarnation. */
function gainControlEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('gainControl'), target });
}

/**
 * CR 701.10: exchange the controllers of exactly two targeted creatures.
 *
 * The ordinary counted-target channel already represents the two choices and
 * independently rechecks them at resolution. The execution stays one effect,
 * because two sequential `gainControl` instructions would both give a
 * creature to the resolving object's controller and could not express the
 * all-or-nothing exchange rule.
 *
 * Hand-authored only. Which side benefits depends on the two live permanents,
 * so an isolated model effect slot cannot price it honestly.
 */
function exchangeControlEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('exchangeControl'),
    target,
    /** Atomic Conjured Currency profile: exchange the source with the one target. */
    exchangeSource: z.literal(true).optional(),
  });
}

/** CR 205.3 and layer 4: add one subtype for this battlefield incarnation. */
function addSubtypeEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('addSubtype'), subtype: z.string(), target });
}

/** A targeted player gains control of the permanent whose ability is resolving. */
function targetPlayerGainsControlOfSelfPermanentEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('targetPlayerGainsControlOfSelfPermanent'), target });
}

/**
 * CR 613.1f, layer 6, for one turn: "Target creature gains flying until end of
 * turn."
 *
 * ## The gap it closes
 *
 * The DSL could already grant a keyword *forever* — `grantKeyword` is a
 * `StaticModification`, and a lord printing "other Merfolk creatures you control
 * have flying" registers a layer-6 record that lives as long as the lord does.
 * What it could not do is grant one for a turn, which is the shape almost every
 * printed keyword grant actually has. The whole combat-trick family was
 * therefore unprintable: no Giant Growth with trample, no "gains deathtouch",
 * no "gains haste" on a creature that just arrived. That absence is half of
 * what the set's first reviewer named, in his words — few interactive effects,
 * and a spell vocabulary that was destroy, +N/+N, bounce and tap.
 *
 * ## Why it is an effect kind rather than a duration on the modification
 *
 * A `StaticModification` is what a *printed ability* does, and it has no
 * duration field because a printed static ability's duration is decided by
 * where it is printed: `whileOnBattlefield` for a card's own line,
 * `whileAttached` for an equip clause. Adding `until end of turn` there would
 * be a duration on an object that has no resolution to be timed from. The
 * resolved-effect side is where a duration belongs, which is exactly the split
 * `statBonus` and `pumpUntilEndOfTurn` already are: the same layer, the same
 * arithmetic, two kinds, because one is printed and one resolves.
 *
 * ## What it reaches
 *
 * `GrantableKeywordSchema`: the nine evergreen `KEYWORDS` plus
 * `GRANTABLE_KEYWORD_ABILITY_KINDS`, which is the same enum the *printed*
 * static grant reads (`ability-shape.ts`'s `grantKeyword`). The two were
 * asymmetric until `mtg-nhyv.63`, and the asymmetry was an oversight rather
 * than a rule: `mtg-nhyv.74` widened the static so Knight Exemplar could hand
 * out indestructible, and left the one-shot on `KeywordSchema`, so "creatures
 * you control gain double strike until end of turn" stayed unprintable while
 * "creatures you control have double strike" did not. One sentence in two
 * durations should not reach two vocabularies.
 *
 * The widening costs no fixture. This kind is absent from `generatableEffects`
 * below, so it is in `CardEffectSchema` and in none of the four model-facing
 * unions built out of that function — a field on it cannot move an answer
 * schema's bytes, which `packages/setgen/test/answer-schema-freeze.test.ts`
 * holds. The keyword *abilities* that are not layer-6 flat names still land in
 * `Characteristics.keywordAbilities` rather than `keywords`; the kernel's arm
 * makes that split with `isGrantableKeywordAbilityKind`, the one reader
 * `abilities.ts` uses for the printed half.
 *
 * `keyword` remains the single-keyword spelling every existing card uses.
 * `additionalKeywords` is the conjunction printed by cards such as Ajani,
 * Caller of the Pride: one target gains several abilities under one duration.
 * It cannot be represented by several effects, because several effects create
 * several independent target slots. The additional list is hand-authored and
 * therefore does not widen any model-facing schema.
 *
 * ## The group, and why it arrived late
 *
 * `scope` is the same `SWEEP_FIELD` the pump beside it carries, and it turns
 * this primitive into the second half of Overwhelming Stampede (M11 189):
 * "creatures you control gain trample until end of turn". It was declined when
 * this kind landed, on the argument that reaching a group through the *player*
 * it named was a shape no card wanted — and that argument was about the wrong
 * half of the vocabulary. The scopes that existed then all read a targeted
 * player, and no printed mass grant names one; the ones `mtg-9u18` appended
 * name a region of the board and choose nobody (CR 115.1), which is exactly
 * what "creatures you control" is. So the shape the card needs became
 * expressible one field over, and this is the field.
 *
 * `SCOPES_LEGAL_ON` (`validate/effects.ts`) admits one of the six, and the
 * census is why: `permanentsYouControl` is Overwhelming Stampede, Overrun and
 * Cleaver Riot, and no printed keyword grant reaches the other side of the
 * board or a whole one. A scope no card asks for is a sweep arm nothing calls,
 * which is still where two definitions of an effect start to disagree.
 *
 * Hand-authored and unpriced, and the reason is `pumpUntilEndOfTurn`'s reason
 * inverted. That kind is priced because a number of points is a magnitude the
 * color pie has a row for. A keyword is not a magnitude: what trample is worth
 * depends on the body it lands on, deathtouch is worth almost nothing on a
 * creature nobody blocks and a removal spell on one everybody must, and the
 * model drafting a card is shown neither the body nor the board.
 */
function grantKeywordUntilEndOfTurnEffect<
  T extends ZodType,
  S extends Record<string, ZodType> = typeof NO_SWEEP,
>(target: T, sweep: S = NO_SWEEP as S) {
  return z.strictObject({
    kind: z.literal('grantKeywordUntilEndOfTurn'),
    keyword: GrantableKeywordSchema,
    additionalKeywords: z.array(GrantableKeywordSchema).min(1).optional(),
    /**
     * Gargoyle Sentinel's layer-6 exchange. Defender is deliberately the only
     * member until another parameterless keyword ability is requested by a
     * real card; payload-bearing landwalk and protection cannot fit this name.
     * The effect kind is hand-authored, so this never reaches ModelEffectSchema.
     */
    removeKeywordAbility: z.literal('defender').optional(),
    target,
    ...sweep,
  });
}

/** CR 701.15: create one destruction-replacement shield per retained permanent. */
function regeneratePermanentEffect<T extends ZodType, S extends Record<string, ZodType> = typeof NO_SWEEP>(
  target: T,
  sweep: S = NO_SWEEP as S,
) {
  return z.strictObject({ kind: z.literal('regeneratePermanent'), target, ...sweep });
}

/** Double one counter kind on the current incarnation of this ability's source. */
function doubleSourceCountersEffect() {
  return z.strictObject({
    kind: z.literal('doubleSourceCounters'),
    counter: CounterKindSchema,
  });
}

/**
 * CR 509.1b for one turn: "Target creature can't be blocked this turn."
 *
 * `grantKeywordUntilEndOfTurn`'s argument one function up, on a rule that is
 * not a layer. The printed restriction already exists as a `StaticModification`
 * (`cantBeBlocked`), and the reason this is a second kind rather than a
 * duration on that one is the same reason `pumpUntilEndOfTurn` sits beside
 * `statBonus`: a printed static's duration is decided by where it is printed,
 * and a resolved effect's is decided by the effect. What differs from the
 * keyword grant is only where the kernel keeps the answer — layer 6 has a
 * record for a granted keyword and CR 509's restrictions have no layer at all,
 * so the kernel holds these in `state.turnCombatRules` beside `replacements`,
 * which `vocabulary.ts` argues at length.
 *
 * No `scope`. Goblin Tunneler names one creature and so does every other
 * printed line of this shape in the population; a sweep arm nothing calls is a
 * second definition waiting to disagree with the first, the same restraint
 * `untapPermanentEffect` states above.
 */
function cantBeBlockedThisTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('cantBeBlockedThisTurn'), target });
}

/** CR 509.1b for one turn: the chosen creature cannot block. */
function cantBlockThisTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('cantBlockThisTurn'), target });
}

/**
 * CR 509.1c for one turn, over either one chosen creature or one board group.
 *
 * The scope is fixed at resolution by the kernel, exactly like a scoped pump:
 * Predatory Rampage constrains the opposing creatures present then, not bodies
 * that enter later. Both fields stay off every model-facing union.
 */
function blocksThisTurnIfAbleEffect<T extends ZodType, S extends Record<string, ZodType> = typeof NO_SWEEP>(
  target: T,
  sweep: S = NO_SWEEP as S,
) {
  return z.strictObject({ kind: z.literal('blocksThisTurnIfAble'), target, ...sweep });
}

/**
 * CR 508.1d for one turn, with the defender named: "Target creature attacks you
 * this turn if able."
 *
 * A requirement rather than a restriction, which is the half that makes it
 * interesting: CR 508.1 resolves the two together, and a creature that must
 * attack and also can't attack does not attack — the requirement never
 * overrides the restriction. The kernel gets that for free because
 * `eligibleAttackers` is what "able" means there and it is already filtered by
 * every restriction in the vocabulary, so this kind only ever removes the
 * hold-back answer and never adds an attack that some rule forbids.
 *
 * "You" is the controller of the ability that resolved this, fixed when the
 * effect resolves rather than re-read from the source later. `vocabulary.ts`
 * argues why the defender is in this kind's name; the defender-neutral sibling
 * is `attacksThisTurnIfAble` below.
 */
function attacksYouThisTurnIfAbleEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('attacksYouThisTurnIfAble'), target });
}

/** CR 613.1e: overwrite the target's colors until the turn ends. */
function setColorsUntilEndOfTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('setColorsUntilEndOfTurn'),
    colors: z.array(ColorSchema).min(1).max(5),
    target,
  });
}

/** CR 508.1d: require an attack this turn without constraining its defender. */
function attacksThisTurnIfAbleEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('attacksThisTurnIfAble'), target });
}

/**
 * CR 701.17: the ability's own source is sacrificed. "Sacrifice this creature."
 *
 * **Not the activation cost of the same name.** `ActivationCostSchema`
 * (`ability-shape.ts`) carries a `sacrificeSelf` boolean that is paid when the
 * ability is activated (CR 601.2h) and prints before the colon as `Sacrifice
 * <card name>`; `FuseAbilitySchema` below pins that same field to `true`. This
 * is a member of the effect union: it happens on resolution and prints as a
 * sentence. The two never meet — a cost is a field on `ActivationCost` and an
 * effect is a variant of `Effect`, and no function reads one as the other.
 *
 * It carries a target, and the target is the point. `selfCreature` and
 * `selfPermanent` are retained referents (CR 115.6a: an object referring to
 * itself is not targeting itself), and they are the only two kinds this row
 * admits, so the whole vocabulary of "which permanent" is "the one that printed
 * the line". Naming one of them is what lets `renderEffect` print "this
 * creature" on a creature and "this permanent" on anything else without
 * threading the card's kind through every caller, and what makes
 * `checkEffectTarget` refuse the effect on an instant for free: a spell on the
 * stack has no body to sacrifice.
 */
function sacrificeSelfEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('sacrificeSelf'), target });
}

/**
 * CR 701.17: a *named* player sacrifices a creature, and CR 601.2h's converse
 * choice — the affected player, not this card's caster, decides which one.
 * "Target player sacrifices a creature" (Diabolic Edict), the edict family
 * `mtg-4g77` exists for.
 *
 * `sacrificeSelf` two rows up is the source and only the source, chosen by
 * nobody; `sacrificeOther` (`ability-shape.ts`) is a cost the *activating*
 * player pays from their own board. Neither is this: the target is a player
 * rather than a permanent, and the permanent that leaves is the one *that*
 * player names, mid-resolution, from creatures nobody else's decision can
 * reach. That is the shape every removal effect this DSL prints so far lacks —
 * `mtg-4g77`'s whole premise — and it is why the kernel has to pause and ask
 * rather than resolve this effect the way `applyEffect`'s synchronous table
 * resolves every other one; `@mtg/kernel`'s `scry.ts` is where that pause
 * lives, the same interruptible-resolution runner `discardCards` already
 * stops at for the identical reason (CR 701.8's chooser is the hand's owner,
 * never the caster).
 *
 * `count`, `filter`, and `players` are the widening Destructive Force makes
 * real: five lands, chosen by every player. They stay optional so the original
 * edict has one canonical short form — omitted means one creature named by the
 * target slot — while an explicit filter is read against current battlefield
 * characteristics, the same `TargetFilter` every scoped permanent effect uses.
 * The whole primitive remains hand-authored only, so none of these fields
 * reaches `ModelEffectSchema` or changes a recorded generator fixture.
 *
 * `target` is restricted by `EFFECT_RULES`, exactly as `discardCardsEffect`
 * is: `targetPlayer` and `targetOpponent` are the targeted forms, while
 * `noTarget` is legal only beside `players`. That exclusion is structural
 * validation rather than a union of two objects so the effect keeps one
 * discriminant and every exhaustive consumer keeps one arm.
 */
function sacrificePermanentEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('sacrificePermanent'),
    count: z.int().optional(),
    filter: TargetFilterSchema.optional(),
    /** Excludes the resolving source from the sacrifice candidates ("another"). */
    excludeSource: z.literal(true).optional(),
    players: PlayerScopeSchema.optional(),
    target,
  });
}

/**
 * CR 613.4b: "Target creature has base power and toughness 1/1 until end of
 * turn." Diminish, and the one shape in the M11/M13 population that needs a
 * layer this DSL had no way to reach.
 *
 * Two plain integers rather than `AmountSchema`, and the restraint is the same
 * one `untapPermanentEffect` states: the printed line names two numerals, and a
 * base P/T that counts something ("base power and toughness equal to the number
 * of...") is a characteristic-defining shape the kernel keeps in layer 7a, not
 * this record. A computed field here would be a second spelling of a layer this
 * effect does not write.
 *
 * No `scope`. Mass Diminish is a sweep of this line and is also
 * `Duration$ UntilYourNextTurn`, so the sweep arm the field would add is not
 * the card that would use it; one target, one layer-7b record.
 */
function setBasePtUntilEndOfTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('setBasePtUntilEndOfTurn'),
    power: z.int(),
    toughness: z.int(),
    target,
  });
}

/**
 * Turn a targeted land into a creature while this ability's exact battlefield
 * source remains. The land and its existing subtypes are retained; colors are
 * set rather than added, matching "becomes green" rather than "is green in
 * addition to its other colors."
 */
function animateLandWhileSourceOnBattlefieldEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('animateLandWhileSourceOnBattlefield'),
    power: z.int(),
    toughness: z.int(),
    colors: z.array(ColorSchema).min(1).max(5),
    subtypes: z.array(z.string().min(1)).min(1),
    target,
  });
}

/** Turn the resolving activated ability's artifact source into a creature until cleanup. */
function animateSourceUntilEndOfTurnEffect<T extends ZodType>(target: T) {
  return z.strictObject({
    kind: z.literal('animateSourceUntilEndOfTurn'),
    power: z.int(),
    toughness: z.int(),
    colors: z.array(ColorSchema).min(1).max(5),
    subtypes: z.array(z.string().min(1)).min(1),
    keywords: z.array(KeywordSchema).max(9),
    /** Izzet Keyrune prints its duration clause first. This changes text only. */
    printedDurationFirst: z.literal(true).optional(),
    target,
  });
}

/**
 * A token the engine may create (CR 111).
 *
 * ## Why power and toughness are optional
 *
 * A token with a power and a toughness is a creature token; a token without
 * them is an artifact token, and `tokenCard` is where that sentence turns into
 * a card type. The flagship set needs the second kind for its first mechanic:
 * "a part token is an artifact whose only ability is Fuse", and a part with a
 * body would be a 0/0 the state-based actions bury the instant it arrives.
 *
 * This is `card.ts`'s own encoding rather than a new one. There, `power` and
 * `toughness` are optional on the shared base and required on the creature
 * variant, so an instant carrying stats parses and then surfaces as
 * `CREATURE_STATS_ON_NONCREATURE`. Here the same pair is optional and
 * `checkEffects` reads it the same way: stating one without the other is a
 * coded violation, not a silent 0.
 *
 * ## Why `identity` is separate from `name`
 *
 * A token's name is printed rules data, not a unique key. Mitotic Slime creates
 * both a 2/2 Ooze and a 1/1 Ooze; changing either printed name would change the
 * card. `identity` is the optional, nonprinted suffix `tokenCard` uses when the
 * name-derived default would collide. It is hand-authored only: the model's
 * token schema below does not offer the field, so existing generated cards and
 * fixture hashes do not move.
 *
 * ## Why `quoteAbilities` is nonprinted metadata
 *
 * Most creators name a token's body and let the token script carry its rules.
 * Mitotic Slime instead quotes the created token's dies ability in the creating
 * card's own sentence. `quoteAbilities` tells renderers and exporters to use
 * that printed form without changing what the token executes. Like `identity`,
 * it is absent from the model schema and cannot expand generated output.
 *
 * ## Why `abilities` is optional rather than defaulted
 *
 * Every other list on this record defaults to `[]` and is therefore required in
 * the parsed type. This one cannot be, because `ModelEffect` — the narrower
 * union `@mtg/setgen` puts in front of the model — must stay assignable to
 * `Effect`, and the model's token schema cannot grow a field without renaming
 * every recorded fixture keyed to it (`packages/llm/src/schema.ts` hashes the
 * answer schema). Teaching the generator to design a token's abilities is a
 * setgen slice with a re-record behind it.
 */
function tokenSpecSchema<T extends ZodType>(ability: T) {
  return z.strictObject({
    identity: z.string().regex(CARD_ID_PATTERN, 'token identity must be a lowercase slug').optional(),
    quoteAbilities: z.literal(true).optional(),
    name: z.string().min(1).max(80),
    power: z.int().optional(),
    toughness: z.int().optional(),
    /** A value fixed as the token is created, withheld from the model token schema. */
    creationPowerToughness: ChosenXSchema.optional(),
    /** Existing card CDA vocabulary, withheld from the independently declared model token schema. */
    characteristicPowerToughness: CharacteristicPowerToughnessSchema.optional(),
    colors: z.array(ColorSchema).default([]),
    subtypes: z.array(z.string()).default([]),
    keywords: z.array(KeywordSchema).default([]),
    /** Hand-authored source text may repeat one of the token's keywords as a reminder. */
    printedKeywordReminder: z.literal('vigilance').optional(),
    /** Hand-authored source text may introduce quoted token rules with "with". */
    inlineQuotedAbilities: z.literal(true).optional(),
    abilities: z.array(ability).max(2).optional(),
  });
}

/**
 * The terminal token tier. Its abilities have the same vocabulary the old
 * token schema exposed and cannot create another token.
 */
const LeafTokenEffectSchema = z.discriminatedUnion('kind', [
  ...effectsBeforeTokens(
    TargetSpecSchema,
    SharedAmountSchema,
    SharedAmountSchema,
    SWEEP_FIELD,
    SPELL_FILTER_FIELD,
  ),
  ...effectsAfterTokens(TargetSpecSchema, SharedAmountSchema, SWEEP_FIELD, STASIS_FIELD),
  putCountersEffect(TargetSpecSchema, SharedAmountSchema),
  loseGameEffect(TargetSpecSchema),
]);

const LeafTokenAbilityWithoutTriggeredGrantSchema = abilitiesOver(
  LeafTokenEffectSchema,
  ActivationCostSchema,
  {},
  { optional: OptionalTriggerSchema },
  {},
  StaticModificationSchema,
);

const LeafTokenStaticModificationSchema = staticModificationsWithTriggeredAbility(
  LeafTokenAbilityWithoutTriggeredGrantSchema.options[1],
);

const LeafTokenAbilitySchema = abilitiesOver(
  LeafTokenEffectSchema,
  ActivationCostSchema,
  {},
  { optional: OptionalTriggerSchema },
  {},
  LeafTokenStaticModificationSchema,
);

const LeafTokenSpecSchema = tokenSpecSchema(LeafTokenAbilitySchema);

/**
 * What a token's own printed abilities may do.
 *
 * One `createToken` tier is admitted for Mitotic Slime: a card can create a
 * token whose ability creates a leaf token. The leaf schema above excludes the
 * same member, making the input depth finite by construction. This is a data
 * boundary rather than a kernel limitation — tokens are real card objects and
 * execute the ordinary ability/effect paths — and it leaves the model-facing
 * schemas untouched.
 *
 * Everything else remains shared with the former token union, including all
 * three object ability kinds and CR 603.3b's optional trigger field.
 */
export const TokenEffectSchema = z.discriminatedUnion('kind', [
  ...effectsBeforeTokens(
    TargetSpecSchema,
    SharedAmountSchema,
    SharedAmountSchema,
    SWEEP_FIELD,
    SPELL_FILTER_FIELD,
  ),
  z.strictObject({
    kind: z.literal('createToken'),
    count: SharedAmountSchema,
    token: LeafTokenSpecSchema,
  }),
  ...effectsAfterTokens(TargetSpecSchema, SharedAmountSchema, SWEEP_FIELD, STASIS_FIELD),
  putCountersEffect(TargetSpecSchema, SharedAmountSchema),
  loseGameEffect(TargetSpecSchema),
]);

export type TokenEffect = z.infer<typeof TokenEffectSchema>;

const TokenAbilityWithoutTriggeredGrantSchema = abilitiesOver(
  TokenEffectSchema,
  ActivationCostSchema,
  {},
  { optional: OptionalTriggerSchema },
  {},
  StaticModificationSchema,
);

const TokenStaticModificationSchema = staticModificationsWithTriggeredAbility(
  TokenAbilityWithoutTriggeredGrantSchema.options[1],
);

export const TokenAbilitySchema = abilitiesOver(
  TokenEffectSchema,
  ActivationCostSchema,
  {},
  { optional: OptionalTriggerSchema },
  {},
  TokenStaticModificationSchema,
);
export type TokenAbility = z.infer<typeof TokenAbilitySchema>;

export const TokenSpecSchema = tokenSpecSchema(TokenAbilitySchema);

export type TokenSpec = z.infer<typeof TokenSpecSchema>;
export type TokenSpecInput = z.input<typeof TokenSpecSchema>;

/** A token that states a body, and so is a creature token. */
export type CreatureTokenSpec = TokenSpec & { readonly power: number; readonly toughness: number };

/**
 * Whether this token states a body. The one place the "stats mean creature"
 * rule is decided, so a renderer, the transpiler and the kernel cannot disagree
 * about which tokens have a P/T box.
 */
export function isCreatureTokenSpec(spec: TokenSpec): spec is CreatureTokenSpec {
  return spec.power !== undefined && spec.toughness !== undefined;
}

/** A token's printed abilities; absent and empty are the same token. */
export function tokenAbilities(spec: TokenSpec): readonly TokenAbility[] {
  return spec.abilities ?? [];
}

/**
 * The token shape the set generator may answer with: the engine's, minus the
 * two widenings above.
 *
 * The generator prints creature tokens and nothing else, so `power` and
 * `toughness` stay required here, and `abilities` is absent for the reason the
 * whole model/engine split exists — the prompt says nothing about a token's
 * abilities, and offering a field the prompt never mentions is the unsafe
 * direction (`packages/setgen/src/filled.ts`).
 */
export const ModelTokenSpecSchema = z.strictObject({
  name: z.string().min(1).max(80),
  power: z.int(),
  toughness: z.int(),
  colors: z.array(ColorSchema).default([]),
  subtypes: z.array(z.string()).default([]),
  keywords: z.array(KeywordSchema).default([]),
});

/**
 * Fuse, as a schema: the one ability a part token prints.
 *
 * The set design document writes the mechanic out in full — "a part
 * token is an artifact whose only ability is `Fuse {cost}: Sacrifice this. Put a
 * <part> counter on target creature you control`" — and everything in that
 * sentence except the mana cost and which part it is, is the mechanic rather
 * than a design decision. So the shape is pinned and two fields are offered.
 *
 * That is the same division the equip clause takes (`ability-shape.ts`): CR
 * 702.6b decides that an equip ability prints no effect and targets a creature
 * you control, and the model decides what it costs and what holding it is worth.
 * Here the mechanic decides the sacrifice, the target and the effect, and the
 * model decides the cost and reads the counter kind off the prompt. Offering the
 * pinned halves as choices would be offering the model a chance to print
 * something that is not Fuse, and `checkSlotConformance` would send every such
 * card back.
 *
 * `tapSelf` is pinned off rather than left out, because it has to be present for
 * a `FuseAbility` to be an `ActivatedAbility` at all, and a part that taps to
 * fuse is a part that would then have to survive the sacrifice it is also
 * paying.
 */
export const FuseAbilitySchema = z.strictObject({
  kind: z.literal('activated'),
  cost: z.strictObject({
    // Fuse is model-facing through `PartTokenSpecSchema`. Keep the exact
    // pre-hybrid answer shape so adding an engine capability cannot silently
    // widen the generator's output space or invalidate recorded completions.
    mana: ManaCostSchema.omit({ hybrid: true }),
    tapSelf: z.literal(false).default(false),
    sacrificeSelf: z.literal(true),
  }),
  effects: z
    .array(
      z.strictObject({
        kind: z.literal('putCounters'),
        counter: ModelCounterKindSchema,
        count: z.int(),
        target: z.strictObject({ kind: z.literal('targetCreatureYouControl') }),
      }),
    )
    .min(1)
    .max(1),
});

export type FuseAbility = z.infer<typeof FuseAbilitySchema>;

/**
 * The token shape a batch designing a part is shown: `ModelTokenSpecSchema`
 * with a body that is optional and a Fuse clause that is not offered anywhere
 * else.
 *
 * One shape rather than a union of "part" and "creature token", because a batch
 * is one schema over several slots and the slot beside the part still wants an
 * ordinary 1/1. A union of the two would be an unlabeled `anyOf` the model
 * picks a branch of by guessing, and zod would parse a creature token through
 * the first branch and drop its abilities on the floor. Optional halves say the
 * same thing without the branch: a body and no clause is a creature token, a
 * clause and no body is a part, and `checkEffects` already codes a power stated
 * without a toughness as a violation rather than a silent zero.
 *
 * `abilities` caps at one because a part prints Fuse and nothing else (decision
 * 9), and it is optional rather than defaulted for the reason `TokenSpecSchema`
 * gives at the same field: absent and empty are the same token, and one token
 * must have one encoding.
 */
export const PartTokenSpecSchema = z.strictObject({
  name: z.string().min(1).max(80),
  power: z.int().optional(),
  toughness: z.int().optional(),
  colors: z.array(ColorSchema).default([]),
  subtypes: z.array(z.string()).default([]),
  keywords: z.array(KeywordSchema).default([]),
  abilities: z.array(FuseAbilitySchema).max(1).optional(),
});

export type PartTokenSpec = z.infer<typeof PartTokenSpecSchema>;

/**
 * Compile-time proof that a part token is a token the engine can create, in the
 * one direction that matters: `assembleCard` hands whatever the model returned
 * straight to `CardSchema`, so a `PartTokenSpec` the engine could not hold would
 * be a generated card the kernel cannot run.
 */
export type PartTokenSpecIsTokenSpec = PartTokenSpec extends TokenSpec ? true : never;

/**
 * The primitives the set generator may print, written once over whichever
 * targeting-spec and token-spec shapes are wanted.
 *
 * Two unions are built from this. `EffectSchema` is the engine's contract and
 * carries the full target and token specs. `ModelEffectSchema` carries the
 * target spec without `distinct` and the token spec without abilities, and is
 * what `@mtg/setgen` puts in front of the model, so the generator's output space
 * stays a subset of the enforceable one while the prompt still has nothing to
 * say about either. Collapsing the two back into one is the schema half of
 * teaching it (`mtg-bc2.80`).
 *
 * `pumpMagnitude` is a second amount parameter for one primitive's two fields,
 * and it is separate from `amount` because a P/T change is the one numeral slot
 * in this vocabulary that may carry a rate: `CardEffectSchema` passes
 * `PumpAmountSchema` so Mutilate's "-1/-1 for each Swamp you control" is
 * printable, and every other union passes what it passed before —
 * `AmountSchema` for the engine's contract and the token union, `z.int()` for
 * the three model-facing tiers. `RatePerSchema` (`amount.ts`) argues why the
 * rate is confined to this slot rather than admitted into `AmountSchema` and
 * refused everywhere else afterwards. Written as a parameter rather than as
 * another optional-field record like `pumpKeyword` because it *replaces* two
 * fields instead of adding one, and a record spread that silently overrode a
 * field declared eight lines above it would be a schema whose shape depends on
 * argument order.
 */
function generatableEffects<
  T extends ZodType,
  A extends ZodType,
  K extends ZodType,
  M extends ZodType,
  S extends Record<string, ZodType> = typeof NO_SWEEP,
  D extends Record<string, ZodType> = typeof NO_STASIS,
  C extends Record<string, ZodType> = typeof NO_SPELL_FILTER,
  P extends Record<string, ZodType> = typeof NO_PLAYER_SWEEP,
  N extends Record<string, ZodType> = typeof NO_DAMAGE_PREVENTION_RULE,
  R extends Record<string, ZodType> = typeof NO_PUMP_KEYWORD,
  V extends Record<string, ZodType> = typeof NO_DAMAGE_DIVISION,
  W extends Record<string, ZodType> = typeof NO_DAMAGE_RIDERS,
  X extends Record<string, ZodType> = typeof NO_REFERENT_EXCLUSION,
  Y extends Record<string, ZodType> = typeof NO_MILL_PRESENTATION,
  Z extends Record<string, ZodType> = typeof NO_GAIN_LIFE_AMOUNT_SOURCE,
  H extends Record<string, ZodType> = typeof NO_DESTROY_CONTROLLER_LIBRARY_FOLLOWUP,
>(
  target: T,
  amount: A,
  token: K,
  pumpMagnitude: M,
  sweep: S = NO_SWEEP as S,
  stasis: D = NO_STASIS as D,
  counter: C = NO_SPELL_FILTER as C,
  playerSweep: P = NO_PLAYER_SWEEP as P,
  damagePrevention: N = NO_DAMAGE_PREVENTION_RULE as N,
  pumpKeyword: R = NO_PUMP_KEYWORD as R,
  division: V = NO_DAMAGE_DIVISION as V,
  damageRiders: W = NO_DAMAGE_RIDERS as W,
  referentExclusion: X = NO_REFERENT_EXCLUSION as X,
  millPresentation: Y = NO_MILL_PRESENTATION as Y,
  gainLifeAmountSource: Z = NO_GAIN_LIFE_AMOUNT_SOURCE as Z,
  destroyControllerLibraryFollowup: H = NO_DESTROY_CONTROLLER_LIBRARY_FOLLOWUP as H,
) {
  return [
    ...effectsBeforeTokens(
      target,
      amount,
      pumpMagnitude,
      sweep,
      counter,
      playerSweep,
      damagePrevention,
      pumpKeyword,
      division,
      damageRiders,
      referentExclusion,
      gainLifeAmountSource,
      destroyControllerLibraryFollowup,
    ),
    z.strictObject({ kind: z.literal('createToken'), count: amount, token }),
    ...effectsAfterTokens(target, amount, sweep, stasis, millPresentation),
  ] as const;
}

export const EffectSchema = z.discriminatedUnion('kind', [
  ...generatableEffects(
    TargetSpecSchema,
    SharedAmountSchema,
    TokenSpecSchema,
    SharedAmountSchema,
    SWEEP_FIELD,
    STASIS_FIELD,
    SPELL_FILTER_FIELD,
    PLAYER_SWEEP_FIELD,
    DAMAGE_PREVENTION_RULE_FIELD,
    NO_PUMP_KEYWORD,
    DAMAGE_DIVISION_FIELD,
  ),
  putCountersEffect(TargetSpecSchema, SharedAmountSchema),
]);

/**
 * What a *card's own effect list* may print: `EffectSchema`'s vocabulary plus
 * the unpriced primitives.
 *
 * The fourth union out of the one list, and the reason it is a union rather
 * than a widening of `EffectSchema` is that `@mtg/setgen` reads
 * `EffectSchema.options` to decide how many effects a slot may ask for. That
 * derivation means the generatable vocabulary, and a member appearing in it
 * that no slot can offer would be a prompt built around a card the model cannot
 * answer.
 *
 * A printed ability carries this union too (`AbilitySchema`), for the reason
 * that file gives at the same field: a trigger's payload is the same
 * primitives a spell's is, and a second, narrower ability vocabulary would be a
 * rule about where an effect is printed rather than about what it does.
 */
function cardEffectOptions() {
  return [
    ...generatableEffects(
      TargetSpecSchema,
      AmountSchema,
      TokenSpecSchema,
      PumpAmountSchema,
      SWEEP_FIELD,
      STASIS_FIELD,
      COUNTER_FIELDS,
      PLAYER_SWEEP_FIELD,
      DAMAGE_PREVENTION_RULE_FIELD,
      PUMP_KEYWORD_FIELD,
      DAMAGE_DIVISION_FIELD,
      DAMAGE_RIDER_FIELDS,
      REFERENT_EXCLUSION_FIELD,
      MILL_PRESENTATION_FIELD,
      GAIN_LIFE_AMOUNT_SOURCE_FIELD,
      DESTROY_CONTROLLER_LIBRARY_FOLLOWUP_FIELD,
    ),
    handAuthoredPutCountersEffect(TargetSpecSchema, AmountSchema),
    exileTargetEffect(TargetSpecSchema),
    revealHandEffect(TargetSpecSchema),
    revealRandomCardFromHandEffect(TargetSpecSchema),
    playRandomHandCardWithoutPayingManaCostEffect(TargetSpecSchema),
    scryEffect(),
    z.strictObject({ kind: z.literal('populate') }),
    z.strictObject({ kind: z.literal('createTokenCopyOfSelf') }),
    reorderTopLibraryEffect(),
    selectFromTopLibraryEffect(),
    separateTopLibraryIntoPilesEffect(),
    returnFromGraveyardEffect(TargetSpecSchema),
    fightEffect(TargetSpecSchema),
    petrifyCreatureEffect(TargetSpecSchema),
    addManaEffect(),
    createEmblemEffect(),
    shuffleLibraryEffect(),
    revealTopCardsEffect(),
    putOnLibraryEffect(TargetSpecSchema),
    exileGraveyardEffect(TargetSpecSchema),
    shuffleGraveyardIntoLibraryEffect(),
    searchLibraryEffect(),
    discardCardsEffect(TargetSpecSchema, PLAYER_SWEEP_FIELD),
    chooseDiscardEffect(TargetSpecSchema),
    loseLifeEffect(TargetSpecSchema, AmountSchema, PLAYER_SWEEP_FIELD),
    setLifeEffect(AmountSchema),
    loseGameEffect(TargetSpecSchema),
    winGameEffect(),
    preventCombatDamageEffect(),
    preventCombatDamageToYouEffect(),
    detainPermanentEffect(TargetSpecSchema),
    chooseBlockersThisCombatEffect(),
    chooseFromGraveyardEffect(),
    preventAllDamageToTargetEffect(TargetSpecSchema),
    untapPermanentEffect(TargetSpecSchema),
    untapPermanentsEffect(),
    skipNextUntapEffect(TargetSpecSchema),
    grantKeywordUntilEndOfTurnEffect(TargetSpecSchema, SWEEP_FIELD),
    cantBeBlockedThisTurnEffect(TargetSpecSchema),
    cantBlockThisTurnEffect(TargetSpecSchema),
    blocksThisTurnIfAbleEffect(TargetSpecSchema, SWEEP_FIELD),
    attacksYouThisTurnIfAbleEffect(TargetSpecSchema),
    sacrificeSelfEffect(TargetSpecSchema),
    sacrificePermanentEffect(TargetSpecSchema),
    setBasePtUntilEndOfTurnEffect(TargetSpecSchema),
    animateLandWhileSourceOnBattlefieldEffect(TargetSpecSchema),
    animateSourceUntilEndOfTurnEffect(TargetSpecSchema),
    returnSourceFromGraveyardEffect(),
    returnDepartedSourceToOwnerHandEffect(),
    putDepartedSourceOnTopOfOwnerLibraryEffect(),
    shuffleSourceIntoOwnerLibraryEffect(),
    setColorsUntilEndOfTurnEffect(TargetSpecSchema),
    attacksThisTurnIfAbleEffect(TargetSpecSchema),
    shuffleHandsAndGraveyardsIntoLibrariesEffect(),
    exileThisSpellEffect(),
    moveSourceLinkedExileEffect(),
    exileNonbasicGraveyardAndMatchingLibraryEffect(TargetSpecSchema),
    eachPlayerNamesCardThenRevealsTopEffect(),
    nameNonlandCardAndExileMatchingOpponentZonesEffect(TargetSpecSchema),
    revealUntilCreatureCardsEffect(),
    gainControlUntilEndOfTurnEffect(TargetSpecSchema),
    gainControlEffect(TargetSpecSchema),
    addSubtypeEffect(TargetSpecSchema),
    targetPlayerGainsControlOfSelfPermanentEffect(TargetSpecSchema),
    preventAllDamageToYouAndCreaturesYouControlEffect(),
    cantCastSpellsThisTurnEffect(),
    protectSpellsAndCreaturesFromSpellColorsThisTurnEffect(),
    changeSpellTargetsEffect(),
    copySpellEffect(),
    copyNextInstantOrSorceryThisTurnEffect(),
    revealTopCardToHandEffect(),
    preventNextDamageToYouAndRetaliateEffect(TargetSpecSchema),
    returnSourceAuraAttachedEffect(TargetSpecSchema),
    regeneratePermanentEffect(TargetSpecSchema, SWEEP_FIELD),
    doubleSourceCountersEffect(),
    destroyAttachedPermanentsEffect(TargetSpecSchema),
    exchangeControlEffect(TargetSpecSchema),
    chooseFromBattlefieldEffect(),
    putSourceAndTargetOnOwnersLibrariesThenShuffleEffect(TargetSpecSchema),
    exileHandsAndGraveyardsEffect(),
    chooseFromRevealedHandEffect(TargetSpecSchema),
    castCopiesOfCardsExiledThisResolutionWithoutPayingManaCostsEffect(),
  ] as const;
}

/**
 * A coin result gates ordinary effects rather than creating a second effect
 * vocabulary. The nested union intentionally excludes `flipCoin` itself: one
 * random branch may contain the existing instruction language, while recursive
 * random trees wait for a printed card that needs them.
 */
// Build this tuple once. The coin-flip branch and the outer card-effect union
// deliberately share the same 92 option schemas; preserving that identity lets
// JSON Schema transports state those options once under `$defs` instead of
// serializing two nearly identical 24 KB unions.
const CARD_EFFECT_OPTIONS = cardEffectOptions();
const CoinFlipBranchEffectSchema = z.discriminatedUnion('kind', CARD_EFFECT_OPTIONS);

function flipCoinEffect() {
  return z.strictObject({
    kind: z.literal('flipCoin'),
    winEffects: z.array(CoinFlipBranchEffectSchema).min(1).max(2).optional(),
    loseEffects: z.array(CoinFlipBranchEffectSchema).min(1).max(2).optional(),
  });
}

export const CardEffectSchema = z.discriminatedUnion('kind', [...CARD_EFFECT_OPTIONS, flipCoinEffect()]);

export const ModelEffectSchema = z.discriminatedUnion(
  'kind',
  generatableEffects(ModelTargetSpecSchema, z.int(), ModelTokenSpecSchema, z.int()),
);

/**
 * The reviewed generator capability "grant one keyword to a creature you
 * control until end of turn".
 *
 * This is deliberately a complete effect schema rather than one more member in
 * either model vocabulary tuple. The engine has wider versions of both halves:
 * the effect can carry additional grants, remove defender, or address a group,
 * and the target kind is useful to other hand-authored effects. Generation has
 * reviewed only their intersection, so that intersection is the type exported
 * here. Consumers opt into this schema as one capability bundle.
 */
export const KeywordGrantToControlledCreatureModelEffectSchema = z.strictObject({
  kind: z.literal('grantKeywordUntilEndOfTurn'),
  keyword: GrantableKeywordSchema,
  target: z.strictObject({ kind: z.literal('targetCreatureYouControl') }),
});

export type KeywordGrantToControlledCreatureModelEffect = z.infer<
  typeof KeywordGrantToControlledCreatureModelEffectSchema
>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type KeywordGrantToControlledCreatureModelEffectIsEffect =
  KeywordGrantToControlledCreatureModelEffect extends Effect ? true : never;

/** The reviewed source-creature fight capability, including its sole target. */
export const FightOpposingCreatureModelEffectSchema = z.strictObject({
  kind: z.literal('fight'),
  target: z.strictObject({ kind: z.literal('targetCreatureYouDontControl') }),
});

export type FightOpposingCreatureModelEffect = z.infer<typeof FightOpposingCreatureModelEffectSchema>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type FightOpposingCreatureModelEffectIsEffect = FightOpposingCreatureModelEffect extends Effect
  ? true
  : never;

/** The reviewed creature-only, controller-only untap capability. */
export const UntapControlledCreatureModelEffectSchema = z.strictObject({
  kind: z.literal('untapPermanent'),
  target: z.strictObject({ kind: z.literal('targetCreatureYouControl') }),
});

export type UntapControlledCreatureModelEffect = z.infer<typeof UntapControlledCreatureModelEffectSchema>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type UntapControlledCreatureModelEffectIsEffect = UntapControlledCreatureModelEffect extends Effect
  ? true
  : never;

/** Color-neutral artifact/enchantment routing for the reviewed bounce effect. */
export const ReturnArtifactOrEnchantmentToHandModelEffectSchema = z.strictObject({
  kind: z.literal('returnToHand'),
  target: z.strictObject({ kind: z.literal('targetArtifactOrEnchantment') }),
});

export type ReturnArtifactOrEnchantmentToHandModelEffect = z.infer<
  typeof ReturnArtifactOrEnchantmentToHandModelEffectSchema
>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type ReturnArtifactOrEnchantmentToHandModelEffectIsEffect =
  ReturnArtifactOrEnchantmentToHandModelEffect extends Effect ? true : never;

/** The two reviewed graveyard-return filter families. */
const OwnGraveyardCardToHandModelFilterSchema = z.union([
  z.strictObject({
    cardTypes: z.tuple([z.literal('creature')]),
    maxManaValue: z.int().min(0).max(16).optional(),
  }),
  z.strictObject({
    cardTypes: z.tuple([z.literal('instant'), z.literal('sorcery')]),
    maxManaValue: z.int().min(0).max(16).optional(),
  }),
]);

/**
 * Select one reviewed card family from your own graveyard and move it to hand.
 * Battlefield destinations and opponent graveyards are separate capabilities.
 */
export const OwnGraveyardCardToHandModelEffectSchema = z.strictObject({
  kind: z.literal('chooseFromGraveyard'),
  whose: z.literal('you'),
  filter: OwnGraveyardCardToHandModelFilterSchema,
  destination: z.literal('hand'),
});

export type OwnGraveyardCardToHandModelEffect = z.infer<typeof OwnGraveyardCardToHandModelEffectSchema>;

/** Compile-time containment proof: every promoted answer is engine-runnable. */
export type OwnGraveyardCardToHandModelEffectIsEffect = OwnGraveyardCardToHandModelEffect extends Effect
  ? true
  : never;

/**
 * The same generatable vocabulary, over a token that may be a part.
 *
 * The third union out of the one list, and the only difference from
 * `ModelEffectSchema` is which token `createToken` carries. It is a separate
 * union rather than a widening of that one because a fixture key hashes the
 * answer schema: a batch designing no part is shown the union it was always
 * shown and replays for free (`packages/setgen/src/filled.ts` holds the whole
 * argument).
 */
export const PartBearingModelEffectSchema = z.discriminatedUnion(
  'kind',
  generatableEffects(ModelTargetSpecSchema, z.int(), PartTokenSpecSchema, z.int()),
);

/**
 * The generatable vocabulary plus the three primitives that reach a zone the
 * battlefield is not: the exile zone, a graveyard, the top of a library.
 *
 * The fifth union out of the one list, appended rather than folded in, and the
 * append is the entire device. A fixture key hashes the answer schema, so a
 * batch designing none of this is shown `ModelEffectSchema` and replays for
 * free; a batch holding a slot that names one of the three is shown this, and
 * only it pays. `packages/setgen/src/filled.ts` holds the argument at length and
 * `answer-schema-freeze.test.ts` holds the eight older tiers to it.
 *
 * Why these three and not the fourth: `revealHand` is a rider with nothing to
 * ride (`UNPRICED_EFFECT_KINDS` says why), so it stays where it was rather than
 * arriving as a spell whose whole text is a look.
 *
 * Two of the three are narrowed on the way in — `exileTarget` loses its scope
 * and `returnFromGraveyard` has its one legal scope written in as a literal — so
 * this union is still a strict subset of what a hand-authored card may print,
 * which is the direction that keeps every generated card runnable.
 */
export const ZoneReachingModelEffectSchema = z.discriminatedUnion('kind', [
  ...generatableEffects(ModelTargetSpecSchema, z.int(), ModelTokenSpecSchema, z.int()),
  modelExileTargetEffect(ModelTargetSpecSchema),
  scryEffect(),
  modelReturnFromGraveyardEffect(ModelTargetSpecSchema),
]);

export type ZoneReachingModelEffect = z.infer<typeof ZoneReachingModelEffectSchema>;

/** The same containment proof `PartBearingModelEffectIsEffect` carries. */
export type ZoneReachingModelEffectIsEffect = ZoneReachingModelEffect extends Effect ? true : never;

/**
 * Read off the wider union, so the three promoted kinds cannot drift from it.
 *
 * A separate constant rather than a widening of `MODEL_EFFECT_KINDS`, because
 * every reader of that one is asking "what may a batch be shown by default",
 * and the answer to that question did not change.
 */
export const ZONE_REACHING_MODEL_EFFECT_KINDS: readonly ZoneReachingModelEffect['kind'][] =
  ZoneReachingModelEffectSchema.options.map((option) => option.shape.kind.value);

export type PartBearingModelEffect = z.infer<typeof PartBearingModelEffectSchema>;

/** The same containment proof `PartTokenSpecIsTokenSpec` carries, one level up. */
export type PartBearingModelEffectIsEffect = PartBearingModelEffect extends Effect ? true : never;

export type Effect = z.infer<typeof CardEffectSchema>;

/** True when an effect writes this source incarnation's exact exile relation. */
export function isSourceLinkedExileWriter(effect: Effect): boolean {
  return (
    (effect.kind === 'searchLibrary' && effect.destination === 'sourceLinkedExile') ||
    (effect.kind === 'exileTarget' && effect.linkToSource === true)
  );
}

/** What the set generator is allowed to answer with: a subset of `Effect`. */
export type ModelEffect = z.infer<typeof ModelEffectSchema>;
export type ModelEffectKind = ModelEffect['kind'];

/** Read off the model's own schema, so the two cannot drift. */
export const MODEL_EFFECT_KINDS: readonly ModelEffectKind[] = ModelEffectSchema.options.map(
  (option) => option.shape.kind.value,
);

const PRICED_EFFECT_KINDS: ReadonlySet<string> = new Set(EFFECT_KINDS);

/**
 * True when the mechanical color pie has a row for this kind and the fill
 * prompt has a range line for it.
 *
 * The narrowing every reader of a *card's* effects needs once a set can hold a
 * hand-authored card. A slot's menu, a brief's mechanic and an archetype plan
 * are all written in the priced vocabulary, so a card printing an unpriced
 * primitive contributes nothing to any of them — which is a different sentence
 * from "the engine cannot run it", and this guard is where the two are kept
 * apart.
 */
export function isPricedEffectKind(kind: AnyEffectKind): kind is EffectKind {
  return PRICED_EFFECT_KINDS.has(kind);
}

/** Narrows an engine effect kind to one the generator may print. */
export function isModelEffectKind(kind: AnyEffectKind): kind is ModelEffectKind {
  return (MODEL_EFFECT_KINDS as readonly AnyEffectKind[]).includes(kind);
}
export type EffectInput = z.input<typeof CardEffectSchema>;

/**
 * A *priced* effect kind: one the color pie rules on and the fill prompt has a
 * range line for.
 *
 * Read off `EFFECT_KINDS` rather than off `Effect`, which is the one place the
 * two tuples' split is load-bearing rather than cosmetic. `@mtg/setgen`'s
 * `EFFECT_RANGES` and every slot vocabulary are `Record<EffectKind, …>`, and
 * they mean the generatable half — a slot that could name `exileTarget` would
 * be a slot the model cannot answer. `AnyEffectKind` is what a total switch
 * over the union needs.
 */
export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Every kind an `Effect` can carry, the two tuples together. */
export type AnyEffectKind = Effect['kind'];

/** Narrows to the effect variant carrying a given kind. */
export type EffectOf<K extends AnyEffectKind> = Extract<Effect, { kind: K }>;

/** Effects that carry a TargetSpec field. */
export type TargetedEffect =
  | Extract<Effect, { target: unknown }>
  | (Extract<Effect, { kind: 'exileGraveyard' }> & { readonly target: TargetSpec });

/** Effects whose target is a spell stack entry rather than a TargetSpec. */
export type SpellTargetEffect = Extract<
  Effect,
  { kind: 'counterSpell' | 'changeSpellTargets' | 'copySpell' }
>;

/** Runtime guard for the targeted subset; keeps validators free of casts. */
export function hasTarget(effect: Effect): effect is TargetedEffect {
  return 'target' in effect && effect.target !== undefined;
}

/** A fight whose two creatures are both CR 115 targets of the resolving object. */
export function isTargetedFight(
  effect: Effect,
): effect is EffectOf<'fight'> & { readonly fighter: { readonly kind: 'targetCreatureYouControl' } } {
  return effect.kind === 'fight' && effect.fighter !== undefined;
}

/** Runtime guard for the three primitives that choose a spell on the stack. */
export function isSpellTargetEffect(effect: Effect): effect is SpellTargetEffect {
  return (
    effect.kind === 'counterSpell' || effect.kind === 'changeSpellTargets' || effect.kind === 'copySpell'
  );
}

/**
 * True when resolving this effect requires a target to have been chosen for it.
 *
 * Two ways an effect chooses one, and a reader that knows only about the first
 * gets `counterSpell` wrong. Most primitives carry a `TargetSpec`, and
 * `noTarget` is the spelling of "chooses nobody". `counterSpell` carries no spec
 * at all — it names a spell on the stack, which is a space no `TargetSpec` can
 * describe — and always chooses one.
 *
 * Named here rather than open-coded because three callers ask it and all three
 * must agree: the validator deciding whether an ability may print the effect,
 * the kernel deciding whether a triggered ability owes a target choice when it
 * goes on the stack (CR 603.3d), and the kernel again deciding whether that
 * ability is removed for having no legal target.
 */
export function effectChoosesTarget(effect: Effect): boolean {
  if (isSpellTargetEffect(effect)) return true;
  return (
    hasTarget(effect) &&
    effect.target.kind !== 'noTarget' &&
    effect.target.kind !== 'triggeringCreature' &&
    effect.target.kind !== 'triggeringPlayer' &&
    effect.target.kind !== 'chosenPlayer' &&
    // The source-body kinds are the other retained referents
    // (packages/dsl/src/targets.ts), and they owe CR 603.3d nothing for the
    // same reason `triggeringCreature` three lines up does not: the ability's
    // own source is not a choice anybody makes as the ability goes on the
    // stack, so a triggered printing of one must never be asked for a target
    // or swept up by the "no legal target" removal pass — both of which key
    // off this function through `triggerChoosesTargets`. Asked of the list
    // rather than of one literal, so `selfPermanent` (`mtg-rji`) inherited
    // this the day it was appended instead of the day somebody remembered.
    !isSourceBodyOnlyTarget(effect.target.kind) &&
    // An Aura's live attachment is retained by the source and is no more a
    // CR 115 choice than the source body itself.
    !isSourceAttachmentTarget(effect.target.kind) &&
    // A back-reference (`REFERENT_TARGETS`) is the third retained referent and
    // owes CR 603.3d nothing for the third time: what it names was chosen by an
    // earlier slot of the same list, at the same moment, by the same player, so
    // asking for it again would be asking a second question about one choice —
    // and letting it through would make a trigger printing "tap that creature"
    // owe a target the enumeration has no space to draw from.
    !isReferentTarget(effect.target.kind)
  );
}

/**
 * The slot a back-reference points at: the one earlier effect in this list that
 * chose an object of the space the referent's phrase needs, or `null` when
 * there is no such slot or more than one.
 *
 * Derived rather than written into the card, which is the decision
 * `TARGET_KINDS`' `thatCreature` docblock argues at length. What it costs is
 * this function; what it buys is that a referent either has exactly one reading
 * or does not validate, instead of a hand-written index that can point at a
 * slot choosing nothing.
 *
 * "More than one earlier chooser" is `null` — refused — rather than
 * nearest-wins. English does read "that creature" as the nearest one, but a
 * card whose second and third effects both say "target creature" and whose
 * fourth says "that creature" is ambiguous *in print* as well, and no card in
 * M11 or M13 prints it; guessing a rule for a shape nobody prints is how the
 * text and the engine come to disagree quietly. `checkReferentTargets`
 * (`validate/effects.ts`) turns both `null` cases into a violation naming which
 * one happened, so the author is told rather than left to read this contract.
 *
 * A counted slot ("up to two target creatures") is not a candidate: it chooses
 * a set, and "that creature" names one body. Skipping it here is what keeps the
 * kernel from having to decide which member of the set the phrase meant.
 */
export function referentSourceIndex(effects: readonly Effect[], index: number): number | null {
  const effect = effects[index];
  if (effect === undefined || !hasTarget(effect)) return null;
  const space = referentSourceSpace(effect.target.kind);
  if (space === null) return null;
  const namesTheSpace =
    space === 'creature'
      ? targetKindNamesACreature
      : space === 'player'
        ? targetKindNamesAPlayer
        : targetKindNamesAPlayerOrPlaneswalker;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = effects[earlier];
    if (candidate === undefined || !hasTarget(candidate)) continue;
    if (!effectChoosesTarget(candidate)) continue;
    if (isMultipleTargetSpec(candidate.target)) continue;
    if (!namesTheSpace(candidate.target.kind)) continue;
    if (found !== null) return null;
    found = earlier;
  }
  return found;
}

/** Whether this instruction reads the toughness of an earlier creature target. */
export function effectUsesThatCreatureToughness(effect: Effect): boolean {
  return Object.values(effect).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'thatCreatureToughness',
  );
}

/** Whether this instruction reads the live hand of an earlier player target. */
export function effectUsesThatPlayersHandSize(effect: Effect): boolean {
  return effect.kind === 'gainLife' && effect.amountFrom === 'thatPlayersHandSize';
}

/** Whether this instruction reads the creature retained by its trigger event. */
export function effectUsesTriggeringCreaturePower(effect: Effect): boolean {
  return Object.values(effect).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'triggeringCreaturePower',
  );
}

/** Whether this instruction reads the toughness of the creature retained by its trigger event. */
export function effectUsesTriggeringCreatureToughness(effect: Effect): boolean {
  return Object.values(effect).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'triggeringCreatureToughness',
  );
}

/** Whether this instruction reads the card an earlier top-card move revealed. */
export function effectUsesRevealedCardManaValue(effect: Effect): boolean {
  return Object.values(effect).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'revealedCardManaValueThisResolution',
  );
}

/** Whether this instruction reads the LKI power of an earlier sacrificed permanent. */
export function effectUsesSacrificedPermanentPower(effect: Effect): boolean {
  return Object.values(effect).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'sacrificedPermanentPowerThisResolution',
  );
}

/** Whether this instruction reads the LKI power of the sole permanent paid as a cost. */
export function effectUsesPaidSacrificePower(effect: Effect): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== 'object' || value === null) return false;
    if ('kind' in value && (value as { readonly kind?: unknown }).kind === 'paidSacrificePower') {
      return true;
    }
    return Object.values(value).some(contains);
  };
  return contains(effect);
}

/** Whether this instruction reads the LKI toughness of the sole permanent paid as a cost. */
export function effectUsesPaidSacrificeToughness(effect: Effect): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== 'object' || value === null) return false;
    if ('kind' in value && (value as { readonly kind?: unknown }).kind === 'paidSacrificeToughness') {
      return true;
    }
    return Object.values(value).some(contains);
  };
  return contains(effect);
}

/** Whether this instruction reads the mana value of the sole card paid as a discard cost. */
export function effectUsesPaidDiscardManaValue(effect: Effect): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== 'object' || value === null) return false;
    if ('kind' in value && (value as { readonly kind?: unknown }).kind === 'paidDiscardManaValue') {
      return true;
    }
    return Object.values(value).some(contains);
  };
  return contains(effect);
}

/** The unique earlier top-card reveal-and-move instruction this amount reads. */
export function revealedCardAmountSourceIndex(effects: readonly Effect[], index: number): number | null {
  const effect = effects[index];
  if (effect === undefined || !effectUsesRevealedCardManaValue(effect)) return null;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    if (effects[earlier]?.kind !== 'revealTopCardToHand') continue;
    if (found !== null) return null;
    found = earlier;
  }
  return found;
}

/**
 * The unique earlier creature-target slot an amount on `effects[index]` reads.
 *
 * This is the amount-side twin of `referentSourceIndex`: both derive the
 * antecedent from the printed list rather than trusting an authored index, and
 * both return `null` for either zero or several candidates so validation and
 * resolution cannot choose different creatures.
 */
export function referentAmountSourceIndex(effects: readonly Effect[], index: number): number | null {
  const effect = effects[index];
  if (effect === undefined || !effectUsesThatCreatureToughness(effect)) return null;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = effects[earlier];
    if (candidate === undefined || !hasTarget(candidate)) continue;
    if (!effectChoosesTarget(candidate)) continue;
    if (isMultipleTargetSpec(candidate.target)) continue;
    if (!targetKindNamesACreature(candidate.target.kind)) continue;
    if (found !== null) return null;
    found = earlier;
  }
  return found;
}

/** The unique earlier single player-target slot a hand-size amount reads. */
export function playerReferentAmountSourceIndex(effects: readonly Effect[], index: number): number | null {
  const effect = effects[index];
  if (effect === undefined || !effectUsesThatPlayersHandSize(effect)) return null;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = effects[earlier];
    if (candidate === undefined || !hasTarget(candidate)) continue;
    if (!effectChoosesTarget(candidate)) continue;
    if (isMultipleTargetSpec(candidate.target)) continue;
    if (!targetKindNamesAPlayer(candidate.target.kind)) continue;
    if (found !== null) return null;
    found = earlier;
  }
  return found;
}

/** The unique earlier one-permanent sacrifice a resolution-local power reads. */
export function sacrificedPermanentAmountSourceIndex(
  effects: readonly Effect[],
  index: number,
): number | null {
  const effect = effects[index];
  if (effect === undefined || !effectUsesSacrificedPermanentPower(effect)) return null;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = effects[earlier];
    if (candidate?.kind !== 'sacrificePermanent') continue;
    if (found !== null || (candidate.count ?? 1) !== 1 || candidate.players !== undefined) return null;
    found = earlier;
  }
  return found;
}

/**
 * Effects that read the source's own body on the battlefield, so they are legal
 * on a triggered ability of a creature permanent and nowhere else.
 *
 * One member. A spell's `sourceOid` is the spell object on the stack, never a
 * creature on the battlefield, so a `fight` cast as an instant would resolve as
 * a silent no-op; a non-creature's power is 0, so a fight printed on an
 * enchantment would deal nothing and take nothing. Both are cards that print a
 * sentence and do not do it, which is the failure this vocabulary exists to
 * prevent, so the validator refuses them rather than leaving the kernel to
 * discover it at resolution.
 *
 * Exported because `@mtg/dsl-coverage` builds every effect three ways — on an
 * instant, inside a `selfEnters` trigger, and inside an activated ability — and
 * a corpus card the validator refuses lands as `invalidDsl`, which reads as
 * "the model was sloppy" rather than "the DSL is narrow". Same shape and same
 * reason as `isSourceAttackTarget`, one level up: that one names a target
 * kind, this one names an effect kind.
 */
export const SOURCE_BODY_EFFECT_KINDS: readonly AnyEffectKind[] = ['fight'];

/** True when the effect needs the source's own body on the battlefield. */
export function isSourceBodyEffect(kind: AnyEffectKind): boolean {
  return SOURCE_BODY_EFFECT_KINDS.includes(kind);
}

/**
 * Effects that produce mana, and therefore effects whose printed ability is a
 * mana ability rather than an ordinary one.
 *
 * One member, and the list exists for the same reason `SOURCE_BODY_EFFECT_KINDS`
 * does: several readers outside this package need to ask "is this the mana
 * one?" and none of them should do it by comparing against a string literal.
 * The kernel asks it to keep a mana ability off the stack (CR 605.3a) and to
 * enumerate it as `activateManaAbility` instead; `@mtg/dsl-coverage` asks it to
 * skip the kind when it builds every effect three ways, because the ability
 * shape it builds carries a `{1}, {T}` cost that a mana ability may not have;
 * `@mtg/sim` and `@mtg/deckbuild` ask it to price the effect at nothing as a
 * spell's payload.
 *
 * Kept beside `isSourceBodyEffect` deliberately. Both name the small set of
 * kinds that are legal in one printed position and refused everywhere else,
 * and a reader who finds one should find the other.
 */
export const MANA_EFFECT_KINDS: readonly AnyEffectKind[] = ['addMana'];

/** True when the effect adds mana, so its printed ability is a mana ability. */
export function isManaEffect(kind: AnyEffectKind): boolean {
  return MANA_EFFECT_KINDS.includes(kind);
}

/**
 * Effects whose target slot may carry `TargetSpec.count` ("up to N target
 * <kind>"), added for `mtg-kg44`.
 *
 * These members are kept beside `SOURCE_BODY_EFFECT_KINDS` and `MANA_EFFECT_KINDS`
 * for the same reason: a count is meaningful only where the kernel already
 * knows how to fold N chosen objects into one effect application at
 * resolution. `tapPermanent` applies to every surviving member of a
 * `{kind:'multiple'}` target, while `dealDamage` retains one allocation per
 * chosen target and applies the divided total. A count on
 * `destroyPermanent` or `bouncePermanent` would print a sentence the kernel
 * cannot run identically to how it reads, which is exactly the gap this
 * table exists to close before the validator lets a card ship with it.
 * Widening this list is a kernel change first, a table entry second, never
 * the other way around.
 */
export const TARGET_COUNT_EFFECT_KINDS: readonly AnyEffectKind[] = [
  'dealDamage',
  'tapPermanent',
  'exchangeControl',
  'detainPermanent',
  'exileTarget',
];

/** True when this effect's target slot may carry a `count`. */
export function effectAllowsTargetCount(kind: AnyEffectKind): boolean {
  return TARGET_COUNT_EFFECT_KINDS.includes(kind);
}

/** Effects with native resolution for an `anyNumber` target slot. */
export const ANY_NUMBER_TARGET_EFFECT_KINDS: readonly AnyEffectKind[] = [
  'dealDamage',
  'drawCards',
  'gainLife',
];

/** True when this effect may choose zero through every legal target in one slot. */
export function effectAllowsAnyNumberTargets(kind: AnyEffectKind): boolean {
  return ANY_NUMBER_TARGET_EFFECT_KINDS.includes(kind);
}
