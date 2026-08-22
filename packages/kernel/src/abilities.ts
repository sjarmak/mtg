/**
 * The static-ability compiler: a printed CR 113 ability becomes kernel data.
 *
 * A static ability compiles to `ContinuousEffect`s and to nothing else. There is
 * no static-ability subsystem, no second evaluator and no parallel path — the
 * CR 613 layer walk, the 613.8 dependency ordering and the timestamp rules in
 * `layers.ts` / `dependency.ts` resolve these records exactly as they resolve a
 * pump, which is the whole reason this slice is small.
 *
 * ## Why the effects are registered rather than derived
 *
 * `computeAll` (`layers.ts`) could read `state.battlefield` and derive a lord's
 * effect on every walk, which would make appearance and disappearance automatic.
 * It was rejected on the hot path: `powerOf`, `toughnessOf`, `hasKeyword`,
 * `isCreatureObject` and `controllerOf` each short-circuit on
 * `state.continuous.length === 0`, and that check is what keeps a game with no
 * continuous effect from walking the board thousands of times per turn.
 * Derivation would replace an array-length test with a battlefield scan at every
 * one of those calls, and CR 613.7 timestamps would still need somewhere to live.
 *
 * ## Control changes, and why the filter carries no baked-in `PlayerId`
 *
 * A first version of this file baked `controllerOf(state, oid)` into
 * `ObjectFilter.controller` at registration time, which answered "you" as of
 * the moment the permanent entered and never again — a control-change effect
 * (layer 2) moving the source would leave the filter naming the old
 * controller forever, because nothing re-registered it. `ObjectFilter.controllerIsSource`
 * (`continuous.ts`) replaces that with a live lookup: `staticFilterFor` below
 * sets it instead of a fixed `controller`, and `characteristics.ts`'s
 * `affectedByEffect` resolves it against the source's *current* controller on
 * every layer walk, the same way it already resolves `enabledWhile` live. So
 * a lord whose control changes mid-game correctly starts buffing its new
 * controller's board, and `staticFilterFor`/`continuousEffectsFor`/
 * `staticEffectsFor` no longer take a `controller` parameter at all — there is
 * nothing left for a caller to bake in.
 */
import type {
  Ability,
  ActivatedAbility,
  Card,
  Condition,
  LayeredStaticModification,
  PermanentTally,
  StaticAbility,
} from '@mtg/dsl';
import { assertNever, isGrantableKeywordAbilityKind, isLayeredStaticModification } from '@mtg/dsl';
import type {
  AbilityChangeEffect,
  ContinuousEffect,
  ObjectFilter,
  PtCount,
  PtDefiningEffect,
  PtModEffect,
  PtScaledModEffect,
} from './continuous';
import { objectFilter, onlyObject } from './continuous';
import type { ObjectId } from './ids';
import { continuousEffectId } from './ids';
import type { GameState } from './state';

/** Which permanents a scope reaches, as the filter the layer walk evaluates. */
function staticFilterFor(ability: StaticAbility, source: ObjectId): ObjectFilter {
  const subtypes = ability.subtype === null ? null : [ability.subtype];
  switch (ability.scope) {
    case 'self':
      return onlyObject(source);
    case 'creaturesYouControl':
      return objectFilter({ cardTypes: ['creature'], controllerIsSource: true, subtypes });
    case 'otherCreaturesYouControl':
      return objectFilter({
        cardTypes: ['creature'],
        controllerIsSource: true,
        subtypes,
        excludeOids: [source],
      });
    default:
      return assertNever(ability.scope, 'staticFilterFor');
  }
}

/**
 * The bookkeeping every registered effect carries, minus what it does.
 *
 * The duration is narrowed to the two that end when the source leaves the
 * battlefield, because those are the only two anything registers from a printed
 * ability: a static ends when the permanent does, and an attachment ends with
 * the attachment or with the permanent, whichever comes first.
 */
export interface RegisteredEffectCommon {
  readonly id: string;
  readonly timestamp: number;
  readonly sourceOid: ObjectId;
  readonly duration: 'whileOnBattlefield' | 'whileAttached';
  readonly affects: ObjectFilter;
  /** CR 611.2c: `null` unless the printed ability carries `enabledWhile`. */
  readonly enabledWhile: Condition | null;
}

/**
 * One `StaticModification` as the continuous effect that resolves it.
 *
 * The one owner of "a stat bonus is layer 7c and a keyword grant is layer 6".
 * A static ability reaches it through `staticEffectFor` below and an equip
 * clause reaches it through `attachTo` (`attach.ts`), so a weapon and a lord
 * cannot land in different layers for saying the same thing.
 *
 * `LayeredStaticModification` rather than the full union, because the other
 * half of `StaticModification` is CR 614 rather than CR 613 and there is no
 * layer to put it in: a doubler compiles to a `ReplacementEffect` in
 * `static-replacements.ts` instead. Narrowing the parameter is what keeps that
 * a compile-time fact — `attachTo` passes an equip clause's modifications and
 * `AttachSchema` is typed to the same narrow union, so no call site can hand
 * this function something it would have to refuse at run time.
 */
/**
 * A DSL `PermanentTally` as the live `PtCount` the layer walk counts against.
 *
 * `effects.ts`'s `countMatching` makes the same translation for a one-shot
 * amount and cannot be shared, because the two differ in the one field that
 * matters: an amount is handed a resolved `PlayerId`, and a static has to
 * resolve "you" on every walk. So this sets `controllerIsSource` and leaves
 * `controller` null, which `characteristics.ts`'s `affectedByEffect` reads as
 * "whoever controls the source right now".
 *
 * `landsWithSubtype`'s `'each'` is the one case with no side at all, and it is
 * spelled by leaving both fields open rather than by naming a player.
 *
 * A `PtCount` and not an `ObjectFilter`, since `countWithCounter` arrived: two
 * of the three tallies are a filter and nothing else, and the third is a filter
 * plus a question the characteristic map cannot answer. Returning the wider
 * shape puts that difference where the layer walk can see it instead of
 * flattening it into a filter field `matchesFilter` would ignore.
 */
function tallyCount(tally: PermanentTally): PtCount {
  switch (tally.kind) {
    case 'countMatching':
      return {
        kind: 'battlefield',
        filter: objectFilter({
          cardTypes: tally.filter.cardTypes ?? null,
          subtypes: tally.filter.subtypes ?? null,
          controllerIsSource: true,
        }),
      };
    case 'countWithCounter':
      // The narrowing that is not a characteristic travels beside the filter
      // rather than inside it: `matchesFilter` answers an `ObjectFilter` off
      // the characteristic map, and a counter is not on that map by design
      // (`continuous.ts`'s `BattlefieldWithCountersCount`).
      return {
        kind: 'battlefieldWithCounters',
        filter: objectFilter({
          cardTypes: tally.filter.cardTypes ?? null,
          subtypes: tally.filter.subtypes ?? null,
          controllerIsSource: true,
        }),
        counters: tally.counters,
      };
    case 'landsWithSubtype':
      return {
        kind: 'battlefield',
        filter: objectFilter({
          cardTypes: ['land'],
          subtypes: [tally.subtype],
          controllerIsSource: tally.whose !== 'each',
        }),
      };
    default:
      return assertNever(tally, 'tallyCount');
  }
}

export function effectForModification(
  modification: LayeredStaticModification,
  common: RegisteredEffectCommon,
): ContinuousEffect {
  switch (modification.kind) {
    case 'statBonus': {
      // CR 613.4c, layer 7c: modified without being set.
      const effect: PtModEffect = {
        ...common,
        kind: 'ptMod',
        layer: '7c',
        power: modification.power,
        toughness: modification.toughness,
      };
      return effect;
    }
    case 'grantKeyword': {
      // CR 613.1f, layer 6: an ability added. The modification names one thing
      // and `Characteristics` keeps two lists, so the split is decided here
      // rather than by the card — `keywords` is the flat evergreen nine,
      // `keywordAbilities` is the six whose rules consequences are wider, and
      // only the second is what the CR 704 destruction sweep reads. Both halves
      // are one record in one layer, because "have flying" and "have
      // indestructible" are the same CR 613.1f grant.
      const keyword = modification.keyword;
      const layerSix = {
        ...common,
        kind: 'abilityChange',
        layer: '6',
        removeKeywords: [],
        removeAll: false,
      } as const;
      const effect: AbilityChangeEffect = isGrantableKeywordAbilityKind(keyword)
        ? { ...layerSix, addKeywords: [], addKeywordAbilities: [{ kind: keyword }] }
        : { ...layerSix, addKeywords: [keyword], addKeywordAbilities: [] };
      return effect;
    }
    case 'statBonusPer': {
      // CR 613.4c, layer 7c, with the count left live: the filter carries
      // `controllerIsSource` rather than a resolved `PlayerId`, so a layer-2
      // control change moves whose Mountains the bonus reads. Baking the
      // controller in at registration time is the bug `ObjectFilter`'s own
      // docblock names.
      const effect: PtScaledModEffect = {
        ...common,
        kind: 'ptScaledMod',
        layer: '7c',
        power: modification.power,
        toughness: modification.toughness,
        countOf: tallyCount(modification.each),
      };
      return effect;
    }
    case 'definePt': {
      // CR 613.4a, layer 7a: a characteristic-defining P/T. The DSL's one
      // `PtCountSource` member names the graveyard count Tarmogoyf needs;
      // `vocabulary.ts`'s docblock is where a second member would be added.
      const effect: PtDefiningEffect = {
        ...common,
        kind: 'ptDefine',
        layer: '7a',
        countOf: { kind: 'graveyardCardTypes', whose: 'each' },
        powerOffset: modification.powerOffset,
        toughnessOffset: modification.toughnessOffset,
      };
      return effect;
    }
    default:
      return assertNever(modification, 'effectForModification');
  }
}

/**
 * `null` for a static whose modification is a replacement rather than a layer:
 * it registers in `state.replacements` (`static-replacements.ts`) and has
 * nothing to contribute to the layer walk, so a `ContinuousEffect` here would
 * be an empty record the walk would still have to sort and apply.
 */
function staticEffectFor(ability: StaticAbility, common: RegisteredEffectCommon): ContinuousEffect | null {
  const modification = ability.modification;
  if (!isLayeredStaticModification(modification)) return null;
  return effectForModification(modification, common);
}

/**
 * The continuous effect one printed ability registers on entry, or `null` for
 * an ability that registers none.
 *
 * Two of the three kinds are the `null`, for the same reason. Neither a
 * triggered nor an activated ability is a continuous effect, and neither holds
 * state between uses: each is read off the printed card at the moment it is
 * used — when its condition is met (`triggers.ts`), or when a player pays for
 * it (`reduce.ts`) — so there is nothing to register on entry and nothing to
 * expire on the way out.
 */
function continuousEffectsFor(ability: Ability, source: ObjectId, counter: number): ContinuousEffect | null {
  switch (ability.kind) {
    case 'static':
      return staticEffectFor(ability, {
        id: continuousEffectId(counter),
        // CR 613.7: the timestamp is the moment the permanent entered, which is
        // what `nextId` is at registration time.
        timestamp: counter,
        sourceOid: source,
        duration: 'whileOnBattlefield',
        affects: staticFilterFor(ability, source),
        // `enabledWhile` is optional on `StaticAbility` (`@mtg/dsl` `abilities.ts`
        // explains why); an absent key means the same thing an explicit `null`
        // does, so this is the one place that normalizes it before it reaches a
        // `ContinuousEffect`, where the field is required.
        enabledWhile: ability.enabledWhile ?? null,
      });
    case 'triggered':
    case 'activated':
      return null;
    default:
      return assertNever(ability, 'continuousEffectsFor');
  }
}

export interface StaticRegistration {
  readonly effects: readonly ContinuousEffect[];
  /** The state's id counter after minting one id per registered effect. */
  readonly nextId: number;
}

/**
 * Every continuous effect a card's printed abilities register when it enters
 * the battlefield, plus the counter the caller must write back.
 *
 * The one caller that matters is `moveObject`, which is the single choke point
 * for a zone change; `scenario()` calls it too, because a position the builder
 * states must be a position the kernel could have reached (`scenario.ts`).
 */
export function staticEffectsFor(card: Card, source: ObjectId, nextId: number): StaticRegistration {
  if (card.abilities.length === 0) return { effects: [], nextId };
  const effects: ContinuousEffect[] = [];
  let counter = nextId;
  for (const ability of card.abilities) {
    const effect = continuousEffectsFor(ability, source, counter);
    if (effect === null) continue;
    effects.push(effect);
    counter += 1;
  }
  return { effects, nextId: counter };
}

/** Effects a permanent registered on entry, dropped when it leaves. */
export function effectsRegisteredBy(
  effects: readonly ContinuousEffect[],
  source: ObjectId,
): readonly ContinuousEffect[] {
  return effects.filter(
    (effect) =>
      effect.sourceOid === source &&
      (effect.duration === 'whileOnBattlefield' || effect.duration === 'whileAttached'),
  );
}

/**
 * Adds one battlefield permanent's static effects to a state.
 *
 * One owner rather than two call sites doing it themselves: `moveObject` is the
 * choke point every real zone change goes through, and `scenario()` writes
 * battlefield objects directly, so both must register the same records or a
 * scenario-built lord does nothing in exactly the tests written to prove
 * statics work. No controller lookup here any more — `staticFilterFor` sets
 * `controllerIsSource` instead of a fixed `PlayerId`, and `affectedByEffect`
 * resolves it live, so a scope's filter is correct however many times control
 * changes after this runs.
 */
export function registerStatics(state: GameState, oid: ObjectId): GameState {
  const object = state.objects[oid];
  if (object === undefined) return state;
  const registration = staticEffectsFor(object.card, oid, state.nextId);
  if (registration.effects.length === 0) return state;
  return {
    ...state,
    continuous: [...state.continuous, ...registration.effects],
    nextId: registration.nextId,
  };
}

/**
 * The printed ability at an index, or `undefined` when the index names none.
 *
 * A total lookup rather than an indexed read with a cast: the index arrives in
 * an `activateAbility` action, which is agent input, and `validateAction` has
 * to be able to say "there is no ability there" rather than crash on it. The
 * source may also have left the battlefield since the action was enumerated,
 * which is why the object lookup is the tolerant one.
 */
export function abilityAt(state: GameState, oid: ObjectId, index: number): Ability | undefined {
  const object = state.objects[oid];
  if (object === undefined) return undefined;
  return object.card.abilities[index];
}

/** The same lookup narrowed to the one kind a player can pay for (CR 602). */
export function activatedAbilityAt(
  state: GameState,
  oid: ObjectId,
  index: number,
): ActivatedAbility | undefined {
  const ability = abilityAt(state, oid, index);
  return ability?.kind === 'activated' ? ability : undefined;
}
