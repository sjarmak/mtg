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
} from './ability-shape';
import { AmountSchema, ComputedAmountSchema, PumpAmountSchema } from './amount';
import { CounterKindSchema } from './counters';
import { ManaCostSchema } from './mana';
import {
  CardKindSchema,
  ColorSchema,
  EFFECT_KINDS,
  EffectScopeSchema,
  GrantableKeywordSchema,
  KeywordSchema,
  ManaColorSchema,
  PlayerScopeSchema,
  SupertypeSchema,
} from './vocabulary';
import {
  isReferentTarget,
  isSourceBodyOnlyTarget,
  ModelTargetSpecSchema,
  referentSourceSpace,
  targetCountOf,
  TargetFilterSchema,
  TargetSpecSchema,
  targetKindNamesACreature,
  targetKindNamesAPlayer,
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
 * orthogonal: this one says *whom*, `scope` says *what*, and the one primitive
 * that carries this carries no `scope` at all.
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
const PUMP_KEYWORD_FIELD = { keyword: KeywordSchema.optional() };

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

function effectsBeforeTokens<
  T extends ZodType,
  A extends ZodType,
  M extends ZodType,
  S extends Record<string, ZodType> = typeof NO_SWEEP,
  C extends Record<string, ZodType> = typeof NO_SPELL_FILTER,
  P extends Record<string, ZodType> = typeof NO_PLAYER_SWEEP,
  R extends Record<string, ZodType> = typeof NO_PUMP_KEYWORD,
>(
  target: T,
  amount: A,
  pumpMagnitude: M,
  sweep: S = NO_SWEEP as S,
  counter: C = NO_SPELL_FILTER as C,
  playerSweep: P = NO_PLAYER_SWEEP as P,
  pumpKeyword: R = NO_PUMP_KEYWORD as R,
) {
  return [
    z.strictObject({ kind: z.literal('dealDamage'), amount, target, ...sweep }),
    z.strictObject({ kind: z.literal('destroyPermanent'), target, ...sweep }),
    z.strictObject({
      kind: z.literal('pumpUntilEndOfTurn'),
      power: pumpMagnitude,
      toughness: pumpMagnitude,
      target,
      ...sweep,
      ...pumpKeyword,
    }),
    z.strictObject({ kind: z.literal('drawCards'), count: amount, target, ...playerSweep }),
    z.strictObject({ kind: z.literal('gainLife'), amount, target }),
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
>(target: T, amount: A, sweep: S = NO_SWEEP as S, stasis: D = NO_STASIS as D) {
  return [
    z.strictObject({ kind: z.literal('tapPermanent'), target, ...sweep, ...stasis }),
    z.strictObject({ kind: z.literal('returnToHand'), target }),
    z.strictObject({ kind: z.literal('millCards'), count: amount, target }),
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
 */
function putCountersEffect<T extends ZodType, A extends ZodType>(target: T, amount: A) {
  return z.strictObject({
    kind: z.literal('putCounters'),
    counter: CounterKindSchema,
    count: amount,
    ...SWEEP_FIELD,
    target,
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
 * **Whose graveyard.** The targeted player's, read off the same `EffectScope`
 * machinery `exileTarget` reads its group off. So the card says whose, out loud,
 * in the one slot it targets.
 *
 * **What comes back.** Creature cards. `EFFECT_SCOPES` already carries
 * `creatureCardsInPlayerGraveyard` — it was added for a scoped exile and reads
 * printed values through `zone-filter.ts` for CR 611.2c's reason — so this
 * primitive needed no new way to say which cards, and stating a narrower filter
 * would be a vocabulary nothing in the set exercises.
 *
 * **Where to, and under whose control.** The battlefield, under each card's
 * *owner's* control. That is Animate Dead's zone with Raise Dead's ownership,
 * and it is the pair the flavor asks for: the moon raises the dead, and it does
 * not care whose they were. It is also the pair the kernel already performs —
 * `moveObject` sets a returning object's controller from its owner, so nothing
 * here needs a control-change mechanism the rest of the DSL has no word for.
 * The printed text says "under their owner's control" rather than leaving it to
 * Magic's default, which for a return-to-battlefield effect is the *caster*.
 *
 * **Whether it targets.** The player, and only the player (CR 115.1). Choosing
 * *which* card comes back is a player decision mid-resolution, which in this
 * kernel means the interruptible runner `scry` uses; and no target kind names a
 * card in a graveyard, so a targeted single reanimation would need a widening of
 * `Target` itself. A scope needs neither, and mass reanimation is the beat the
 * set is actually asking for.
 *
 * `scope` is required rather than optional, unlike `exileTarget`'s. An unscoped
 * exile still means something — exile the permanent you named — and an unscoped
 * return has nothing to name at all, because the space it draws from is a zone
 * no `TargetSpec` reaches.
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
    scope: EffectScopeSchema,
    destination: ReturnDestinationSchema.optional(),
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
 */
function exileTargetEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('exileTarget'), scope: EffectScopeSchema.optional(), target });
}

/**
 * The same primitive with `scope` taken away, which is the whole of what the
 * generator may answer with.
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
 * One target, like every other effect here, and that is the whole reason the
 * template is "it fights target creature you don't control" rather than Prey
 * Upon's "target creature you control fights target creature you don't
 * control". `targetChoicesForEffects` returns one target-space slot per effect;
 * a two-target primitive would reshape that return type through kernel legal-
 * action, resolution, the bots and the UI. The source is the other fighter, and
 * the trigger is what puts a body under it.
 *
 * There is no model half. `putCountersEffect` is the standing precedent for a
 * primitive that is expressible by hand and unreachable from the generator, and
 * this one is further out still: `fight` is in `UNPRICED_EFFECT_KINDS`, so
 * `RoleProfile.effectKinds` cannot name it either.
 */
function fightEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('fight'), target });
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
  });
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
 * Whose graveyard an `exileGraveyard` empties.
 *
 * A three-member enum rather than a `TargetSpec`, and the reason is that the
 * third member has no target to name. "Exile all graveyards" (Rest in Peace)
 * reaches both players and targets nobody, so a target spec would need a kind
 * meaning "everyone" — a widening of `TARGET_KINDS` that every other effect in
 * the vocabulary would then have to be told to refuse.
 *
 * Untargeted also costs nothing here that a target would buy. CR 115.1's point
 * is that a target can be made illegal in response; a player never can, no
 * printed card protects a graveyard, and in a two-player game `'opponent'`
 * names exactly the seat `targetOpponent` would have. So the enum says what the
 * card says and the kernel resolves it against the effect's own controller, the
 * way `cardsInGraveyard`'s `whose` already does one file over.
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
 * different, worse card wearing the same name.
 */
function exileGraveyardEffect() {
  return z.strictObject({ kind: z.literal('exileGraveyard'), whose: GraveyardOwnerSchema });
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
export const SEARCH_DESTINATIONS = ['hand', 'battlefield', 'battlefieldTapped'] as const;
export const SearchDestinationSchema = z.enum(SEARCH_DESTINATIONS);
export type SearchDestination = z.infer<typeof SearchDestinationSchema>;

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
 * `colors` is the field that was added the day a card did ask.
 * `chooseFromGraveyard` reads this same filter, and Revive (M13 187) is
 * "return target *green* card from your graveyard to your hand" — a clause with
 * no type in it at all, so a type-only filter renders it as "a card" and hands
 * the choosing seat their whole graveyard. `PrintedFilter` already carried
 * `colors`, so nothing in the kernel had to learn a new predicate; the DSL was
 * simply narrower than the selector underneath it. It widens no fixture key,
 * because no model-facing union reaches a `CardFilter` — `searchLibrary` and
 * `chooseFromGraveyard` are both hand-authored-only.
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
export const CardFilterSchema = z.strictObject({
  cardTypes: z.array(CardKindSchema).min(1).optional(),
  excludeCardTypes: z.array(CardKindSchema).min(1).optional(),
  subtypes: z.array(z.string().min(1)).min(1).optional(),
  supertypes: z.array(SupertypeSchema).min(1).optional(),
  colors: z.array(ColorSchema).min(1).optional(),
  names: z.array(z.string().min(1)).min(1).optional(),
  maxManaValue: z.number().int().min(0).max(16).optional(),
});
export type CardFilter = z.infer<typeof CardFilterSchema>;

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
 * **Optional by construction, not by a field.** CR 701.19b says a search may
 * find nothing even when a legal card is there, so the kernel enumerates a
 * "found nothing" option beside every match and there is no `optional` flag to
 * get wrong. A card that reads "search your library for a Forest" and one that
 * reads "you may search" are the same effect; the difference lives in whether a
 * player would decline, which is a policy and not a rule.
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
  });
}

function searchLibraryEffect() {
  return z.strictObject({
    kind: z.literal('searchLibrary'),
    filter: CardFilterSchema,
    destination: SearchDestinationSchema,
    count: z.union([z.int().min(1).max(MAX_SEARCH_COUNT), ComputedAmountSchema]).optional(),
    reveal: z.boolean().optional(),
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
 * nothing, and `checkGraveyardChoiceParams` refuses it rather than letting it
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
 * One named card leaves a graveyard, chosen by a player rather than by a scope.
 *
 * `returnFromGraveyard` is the *mass* form and reaches its cards through an
 * `EffectScope`, which names a set and applies the effect to every member of
 * it: that is Living Death, and it is not Gravedigger. Every single-card
 * recursion M11 and M13 print is this other shape — Disentomb,
 * Call to Mind, Archaeomancer, Nature's Spiral, Revive, Gravedigger, Vile
 * Rebirth — and all seven say *one* card and leave the choosing to a player.
 * Neither half of that sentence is reachable by narrowing a scope.
 *
 * **It stops the resolution**, which is what keeps it unpriced and out of the
 * generator: `searchLibraryEffect`'s paragraph on the same point applies word
 * for word, and admitting it to the model would hand a batch a card whose cost
 * is a decision space rather than a number.
 *
 * **Optional by construction, for `searchLibraryEffect`'s reason and with one
 * difference worth stating.** The kernel enumerates "take nothing" beside every
 * match, so "you may return target creature card" and "return target creature
 * card" are the same effect here and no `optional` flag can be set wrong. The
 * difference from a search is that a graveyard is public (CR 400.2), so
 * declining reveals nothing the opponent could not already read off the table —
 * a search needs CR 701.19c's license to fail to find, and this does not.
 *
 * `whose` is `exileGraveyard`'s enum for `exileGraveyard`'s reason: the
 * graveyard is named rather than targeted, no printed card protects one, and in
 * a two-player game `'opponent'` names exactly the seat a target would have.
 * The cards inside it are not targeted either, which is a deliberate divergence
 * from the printed wording and is argued where the kind is declared
 * (`UNPRICED_EFFECT_KINDS`, `vocabulary.ts`).
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
 * Largest number of cards one printed discard takes, whoever chooses them.
 *
 * `MAX_SCRY_COUNT`'s argument at the other pausing primitive, with a different
 * arithmetic behind the same conclusion. The M11/M13 identities print one and
 * two (Duress and Distress take one, Mind Rot takes two); four leaves a rare
 * room without opening the question, because the space a discard enumerates is
 * `C(hand, count)` and the binomial peaks in the middle — seven cards choosing
 * four is 35, and seven choosing two is 21, both far inside the kernel's option
 * ceiling. Past that ceiling the set-selection protocol asks one card at a time
 * rather than truncating, so this bound is about what a card face should print
 * rather than about what the enumerator survives.
 *
 * A printed number larger than the hand is not out of range, it is CR 701.8a:
 * a player who cannot discard that many discards as many as they can. The
 * kernel bounds the pending count by the hand it is asked of, and this constant
 * bounds only what the card may say.
 */
export const MAX_DISCARD_COUNT = 4;

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
    count: z.int().min(1).max(MAX_DISCARD_COUNT),
    target,
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
  return z.strictObject({ kind: z.literal('loseLife'), amount, target, ...playerSweep });
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
 * No target: every card that prints this line says "your" or "each player's"
 * (Elderscale Wurm, Touch of the Eternal, Worldfire), never "target". So it
 * takes the controller, which `ApplyContext` already carries, and a widening
 * arrives with the card that needs it. "Each player's" is not that widening and
 * is not expressible here.
 *
 * `Amount` rather than an integer, for Touch of the Eternal: the number is
 * "the number of artifacts you control" as often as it is seven.
 */
function setLifeEffect<A extends ZodType>(amount: A) {
  return z.strictObject({ kind: z.literal('setLife'), amount });
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
 * CR 615.1, aimed rather than blanket: Dawn Charm's first mode, "prevent all
 * damage that would be dealt to target creature this turn."
 *
 * `preventCombatDamageEffect`'s own docblock argues every knob on a Fog away,
 * and none of that argument applies here — this is not a wider Fog, it is the
 * *other* printed shape CR 615 has, and the two primitives cover different
 * cards on purpose rather than one growing a field. Safe Passage's "you and
 * creatures you control" is still unreachable (`ReplacementTrigger` has no
 * word for a group of that shape) and a depleting amount is still Holy Day's
 * partial shield rather than this card's whole one, so neither knob is smuggled
 * in through the target. What changes is the *recipient*: one named creature
 * instead of every combat participant, and `combatOnly` dropped to `false`
 * rather than `true` — the printed line says "all damage", not "all combat
 * damage", so a burn spell aimed at the shielded creature is stopped exactly as
 * a blocker's would be. That is Dawn Charm's second-clause promise and the
 * reason the two primitives are not the same effect pointed differently: a
 * Fog cannot stop a bolt and this can, because the printed cards disagree about
 * that on purpose.
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
 * One keyword rather than a list, because that is what a printed card says.
 * Two grants on one spell are two effects, which the effect list already
 * supports and which `checkDuplicateModifications`' sibling rule does not
 * refuse — and a list here would be a second way to spell the same card.
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
    target,
    ...sweep,
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
 * "You" is the controller of the ability that resolved this, read live off the
 * imposing permanent rather than baked in as a `PlayerId`, so the requirement
 * still names the right seat after a control change. `vocabulary.ts` argues why
 * the defender is in the kind's name rather than a field, and why the two
 * sibling lines Courtly Provocateur prints are not here.
 */
function attacksYouThisTurnIfAbleEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('attacksYouThisTurnIfAble'), target });
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
 * No filter and no count, deliberately. Every printed edict in the yardstick
 * this bead measured against says "a creature" and nothing narrower, so a
 * `CardFilter` field would be vocabulary the acceptance criteria never asked
 * for and no card in this checkout would use; "sacrifice two creatures" or
 * "sacrifice a creature with power 2 or less" are real printed shapes and are
 * left for whichever card first needs one, the same YAGNI cut `unless.ts`
 * makes for its own cost.
 *
 * `target` is restricted to the two player kinds by `EFFECT_RULES` rather
 * than by this schema, exactly as `discardCardsEffect` is: `targetPlayer` and
 * `targetOpponent` are the two English subjects a printed edict ever names,
 * and `noTarget` plus a player sweep ("each opponent sacrifices a creature")
 * are a second card this one does not have to be.
 */
function sacrificePermanentEffect<T extends ZodType>(target: T) {
  return z.strictObject({ kind: z.literal('sacrificePermanent'), target });
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
 * What a token's own printed abilities may do: everything a card's ability may
 * do, except make another token.
 *
 * The exclusion is not taste. `createToken` carries a `TokenSpec`, a `TokenSpec`
 * carries abilities, and an ability carries effects, so allowing it would make
 * the schema infinitely deep and the Forge export unable to finish declaring a
 * card's tokens — `collectTokenFiles` walks the tokens a *card* declares, and a
 * token declared only by another token has nowhere in that walk to be found. No
 * card in the flagship set asks a part to make a part; a Chest that yields a
 * part is a printed artifact card, not a token.
 *
 * Everything else is shared with a card, including all three ability kinds. A
 * token is a permanent, `createToken` builds it a real `Card`, and the kernel
 * reads `GameObject.card.abilities` with no branch for tokens — so a narrower
 * ability *shape* here would be a vocabulary the engine would honor anyway,
 * which is the drift this package exists to prevent. The per-kind rules that do
 * differ are already per-card-kind rules and land for free: `checkAbilities`
 * refuses a `self` static on the artifact token's card exactly as it refuses one
 * on a printed artifact.
 *
 * That is why the token's ability union carries CR 603.3b's `optional` while
 * the generator's two do not: a part token's printed line is "When this dies,
 * you may put a +1/+1 counter on target creature", so the word has to be
 * expressible exactly where the mechanic lives.
 */
export const TokenEffectSchema = z.discriminatedUnion('kind', [
  ...effectsBeforeTokens(TargetSpecSchema, AmountSchema, AmountSchema, SWEEP_FIELD, SPELL_FILTER_FIELD),
  ...effectsAfterTokens(TargetSpecSchema, AmountSchema, SWEEP_FIELD, STASIS_FIELD),
  putCountersEffect(TargetSpecSchema, AmountSchema),
]);

export type TokenEffect = z.infer<typeof TokenEffectSchema>;

export const TokenAbilitySchema = abilitiesOver(
  TokenEffectSchema,
  ActivationCostSchema,
  {},
  {
    optional: OptionalTriggerSchema,
  },
  {},
  StaticModificationSchema,
);
export type TokenAbility = z.infer<typeof TokenAbilitySchema>;

/**
 * A token the engine may create (CR 111).
 *
 * ## Why power and toughness are optional
 *
 * A token with a power and a toughness is a creature token; a token without
 * them is an artifact token, and `tokenCard` is where that sentence turns into
 * a card type. the flagship set needs the second kind for its first mechanic:
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
export const TokenSpecSchema = z.strictObject({
  name: z.string().min(1).max(80),
  power: z.int().optional(),
  toughness: z.int().optional(),
  colors: z.array(ColorSchema).default([]),
  subtypes: z.array(z.string()).default([]),
  keywords: z.array(KeywordSchema).default([]),
  abilities: z.array(TokenAbilitySchema).max(2).optional(),
});

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
 * the set design document writes the mechanic out in full — "a part
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
    mana: ManaCostSchema,
    tapSelf: z.literal(false).default(false),
    sacrificeSelf: z.literal(true),
  }),
  effects: z
    .array(
      z.strictObject({
        kind: z.literal('putCounters'),
        counter: CounterKindSchema,
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
  R extends Record<string, ZodType> = typeof NO_PUMP_KEYWORD,
>(
  target: T,
  amount: A,
  token: K,
  pumpMagnitude: M,
  sweep: S = NO_SWEEP as S,
  stasis: D = NO_STASIS as D,
  counter: C = NO_SPELL_FILTER as C,
  playerSweep: P = NO_PLAYER_SWEEP as P,
  pumpKeyword: R = NO_PUMP_KEYWORD as R,
) {
  return [
    ...effectsBeforeTokens(target, amount, pumpMagnitude, sweep, counter, playerSweep, pumpKeyword),
    z.strictObject({ kind: z.literal('createToken'), count: amount, token }),
    ...effectsAfterTokens(target, amount, sweep, stasis),
  ] as const;
}

export const EffectSchema = z.discriminatedUnion('kind', [
  ...generatableEffects(
    TargetSpecSchema,
    AmountSchema,
    TokenSpecSchema,
    AmountSchema,
    SWEEP_FIELD,
    STASIS_FIELD,
    SPELL_FILTER_FIELD,
    PLAYER_SWEEP_FIELD,
  ),
  putCountersEffect(TargetSpecSchema, AmountSchema),
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
export const CardEffectSchema = z.discriminatedUnion('kind', [
  ...generatableEffects(
    TargetSpecSchema,
    AmountSchema,
    TokenSpecSchema,
    PumpAmountSchema,
    SWEEP_FIELD,
    STASIS_FIELD,
    SPELL_FILTER_FIELD,
    PLAYER_SWEEP_FIELD,
    PUMP_KEYWORD_FIELD,
  ),
  putCountersEffect(TargetSpecSchema, AmountSchema),
  exileTargetEffect(TargetSpecSchema),
  revealHandEffect(TargetSpecSchema),
  scryEffect(),
  returnFromGraveyardEffect(TargetSpecSchema),
  fightEffect(TargetSpecSchema),
  addManaEffect(),
  shuffleLibraryEffect(),
  revealTopCardsEffect(),
  putOnLibraryEffect(TargetSpecSchema),
  exileGraveyardEffect(),
  shuffleGraveyardIntoLibraryEffect(),
  searchLibraryEffect(),
  discardCardsEffect(TargetSpecSchema, PLAYER_SWEEP_FIELD),
  chooseDiscardEffect(TargetSpecSchema),
  loseLifeEffect(TargetSpecSchema, AmountSchema, PLAYER_SWEEP_FIELD),
  setLifeEffect(AmountSchema),
  preventCombatDamageEffect(),
  chooseFromGraveyardEffect(),
  preventAllDamageToTargetEffect(TargetSpecSchema),
  untapPermanentEffect(TargetSpecSchema),
  grantKeywordUntilEndOfTurnEffect(TargetSpecSchema, SWEEP_FIELD),
  cantBeBlockedThisTurnEffect(TargetSpecSchema),
  attacksYouThisTurnIfAbleEffect(TargetSpecSchema),
  sacrificeSelfEffect(TargetSpecSchema),
  sacrificePermanentEffect(TargetSpecSchema),
  setBasePtUntilEndOfTurnEffect(TargetSpecSchema),
]);

export const ModelEffectSchema = z.discriminatedUnion(
  'kind',
  generatableEffects(ModelTargetSpecSchema, z.int(), ModelTokenSpecSchema, z.int()),
);

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

/** Effects that carry a TargetSpec field (all but `counterSpell` and `createToken`). */
export type TargetedEffect = Extract<Effect, { target: unknown }>;

/** Runtime guard for the targeted subset; keeps validators free of casts. */
export function hasTarget(effect: Effect): effect is TargetedEffect {
  return 'target' in effect;
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
  if (effect.kind === 'counterSpell') return true;
  return (
    hasTarget(effect) &&
    effect.target.kind !== 'noTarget' &&
    effect.target.kind !== 'triggeringCreature' &&
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
  const namesTheSpace = space === 'creature' ? targetKindNamesACreature : targetKindNamesAPlayer;
  let found: number | null = null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = effects[earlier];
    if (candidate === undefined || !hasTarget(candidate)) continue;
    if (!effectChoosesTarget(candidate)) continue;
    if (targetCountOf(candidate.target) !== null) continue;
    if (!namesTheSpace(candidate.target.kind)) continue;
    if (found !== null) return null;
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
 * reason as `isAttackTriggerOnlyTarget`, one level up: that one names a target
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
 * One member, kept beside `SOURCE_BODY_EFFECT_KINDS` and `MANA_EFFECT_KINDS`
 * for the same reason: a count is meaningful only where the kernel already
 * knows how to fold N chosen objects into one effect application at
 * resolution, and today that is `tapPermanent` alone — `EFFECT_EXECUTION`
 * (`@mtg/kernel`) taps every surviving member of a `{kind:'multiple'}`
 * target, and no other effect's `apply` has an analogous fold. A count on
 * `destroyPermanent` or `bouncePermanent` would print a sentence the kernel
 * cannot run identically to how it reads, which is exactly the gap this
 * table exists to close before the validator lets a card ship with it.
 * Widening this list is a kernel change first, a table entry second, never
 * the other way around.
 */
export const TARGET_COUNT_EFFECT_KINDS: readonly AnyEffectKind[] = ['tapPermanent'];

/** True when this effect's target slot may carry a `count`. */
export function effectAllowsTargetCount(kind: AnyEffectKind): boolean {
  return TARGET_COUNT_EFFECT_KINDS.includes(kind);
}
