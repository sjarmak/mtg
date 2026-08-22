/**
 * The CR 613 layer walk: derived characteristics for the whole battlefield.
 *
 * ## Attribution
 *
 * The architecture — recompute every permanent from printed values upward
 * through a fixed layer order, resolving intra-layer order by timestamp plus a
 * dependency pass, and never write a modified characteristic back onto the
 * object — is a *design* ported from Argentum (MIT,
 * <https://github.com/wingedsheep/argentum-engine>),
 * `docs/continuous-effect-dependency-system.md`. No code was copied.
 *
 * ## Why the whole battlefield at once
 *
 * The previous implementation derived one object's P/T from the effects naming
 * it. That shape cannot express CR 613.8: whether an effect applies to a
 * permanent can depend on what another effect did to a *different* permanent (a
 * characteristic-defining ability counting Zombies), and whether it applies at
 * all can depend on what another did to this one (that other effect made it a
 * Zombie). Dependency is a property of the board, so the board is the unit of
 * computation.
 *
 * That cost is paid once per state. `deriveLayers` memoizes on the `GameState`
 * object in a `WeakMap`, which is sound precisely because state is immutable:
 * one state object has exactly one answer forever, and a state nobody holds is
 * collected along with its entry. With no continuous effects — every turn of a
 * game that casts no pump — the pass is a map of printed values and nothing
 * else.
 *
 * ## What counters contribute, and where
 *
 * Counters live on the object rather than in `state.continuous`, so their two
 * layers read `GameObject.counters` instead of an effect list. Which layer each
 * half reaches is decided by `@mtg/dsl`'s `COUNTER_DECLARATIONS` and applied
 * here:
 *
 *  - the `statBonus` half is **layer 7d** (`applyCounterStatLayer`), in its
 *    proper place in `LAYER_ORDER`, after 7c and before the 7e switch, which is
 *    what makes "switch P/T then add a +1/+1 counter" come out at +1/+1 on the
 *    *switched* values;
 *  - the `grantKeyword` half is **layer 6** (`applyCounterKeywordLayer`), and
 *    it applies *first within that layer*, ahead of the layer-6 continuous
 *    effects. CR 613.1f orders a layer by timestamp and the kernel does not
 *    stamp counters, so the tie is broken toward the rule that matters: an
 *    "loses all abilities" effect must be able to take a keyword counter's
 *    grant away, and it cannot if the counter applies last.
 *
 * Neither function names a counter kind. Both walk the declarations, so a part
 * added to `counters.ts` reaches its layers with no edit here.
 */
import type { CardKind, GrantableKeyword, Keyword, KeywordAbility } from '@mtg/dsl';
import { isGrantableKeywordAbilityKind, printedCardTypes } from '@mtg/dsl';
import type { CharacteristicMap, Characteristics, LayerContext } from './characteristics';
import {
  affectedByEffect,
  applyEffect,
  applyIntrinsicPowerToughness,
  evaluateOffBattlefieldPowerToughness,
  isCreatureCharacteristics,
  printedCharacteristics,
} from './characteristics';
import type { ContinuousEffect, Layer } from './continuous';
import { counterKeywords, counterStatDelta, LAYER_ORDER } from './continuous';
import { orderLayer } from './dependency';
import type { ObjectId, PlayerId } from './ids';
import type { GameObject, GameState } from './state';

/**
 * Deliberately not `zones.getObject`: the layer walk sits *below* zone
 * movement, and `zones.ts` has to be able to ask the pipeline in `replacement.ts`
 * — which asks this module who controls a permanent — what an entering
 * permanent's event became. Reading the object record directly keeps that a
 * one-directional dependency instead of a cycle.
 */
function objectAt(state: GameState, oid: ObjectId): GameObject {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`unknown game object: ${oid}`);
  return object;
}

export { LAYER_ORDER };
export type { CharacteristicMap, Characteristics, LayerContext, Layer };
export {
  affectedByEffect,
  conditionHolds,
  isCreatureCharacteristics,
  matchesFilter,
  printedCharacteristics,
  selectMatching,
} from './characteristics';

/** One effect's turn in the walk: which permanents it actually caught. */
export interface EffectApplication {
  readonly effect: ContinuousEffect;
  readonly affected: readonly ObjectId[];
}

export interface LayerDerivation {
  readonly map: CharacteristicMap;
  /** Every effect that applied to at least one permanent, in application order. */
  readonly applications: readonly EffectApplication[];
}

/** Layer 7d (CR 613.4d): P/T from counters, read off the objects themselves. */
function applyCounterStatLayer(state: GameState, map: CharacteristicMap): CharacteristicMap {
  let next: Map<ObjectId, Characteristics> | null = null;
  for (const [oid, current] of map) {
    const delta = counterStatDelta(objectAt(state, oid).counters);
    if (delta.power === 0 && delta.toughness === 0) continue;
    next ??= new Map(map);
    next.set(oid, {
      ...current,
      power: current.power + delta.power,
      toughness: current.toughness + delta.toughness,
    });
  }
  return next ?? map;
}

/** Layer 6 (CR 613.1f): keywords granted by counters, read off the objects. */
function applyCounterKeywordLayer(state: GameState, map: CharacteristicMap): CharacteristicMap {
  let next: Map<ObjectId, Characteristics> | null = null;
  for (const [oid, current] of map) {
    const granted = counterKeywords(objectAt(state, oid).counters);
    const added = granted.filter((keyword) => !current.keywords.includes(keyword));
    if (added.length === 0) continue;
    next ??= new Map(map);
    next.set(oid, { ...current, keywords: [...current.keywords, ...added] });
  }
  return next ?? map;
}

function printedMap(state: GameState): CharacteristicMap {
  return new Map(state.battlefield.map((oid) => [oid, printedCharacteristics(objectAt(state, oid))]));
}

function computeAll(state: GameState): LayerDerivation {
  const battlefield = state.battlefield;
  let map: CharacteristicMap = printedMap(state);
  const hasIntrinsic = [...map.values()].some((current) => current.powerToughnessDefinition !== null);
  if (state.continuous.length === 0 && !hasIntrinsic) {
    return { map: applyCounterStatLayer(state, applyCounterKeywordLayer(state, map)), applications: [] };
  }

  const applications: EffectApplication[] = [];
  for (const layer of LAYER_ORDER) {
    if (layer === '7d') {
      map = applyCounterStatLayer(state, map);
      continue;
    }
    if (layer === '6') map = applyCounterKeywordLayer(state, map);
    if (layer === '7a') map = applyIntrinsicPowerToughness(state, battlefield, map);
    const inLayer = state.continuous.filter((effect) => effect.layer === layer);
    if (inLayer.length === 0) continue;
    for (const effect of orderLayer({ state, battlefield, map }, inLayer)) {
      const context: LayerContext = { state, battlefield, map };
      const affected = affectedByEffect(context, effect);
      if (affected.length > 0) applications.push({ effect, affected });
      map = applyEffect(context, effect);
    }
  }
  return { map, applications };
}

const CACHE = new WeakMap<GameState, LayerDerivation>();

/** The full layer walk for a state, memoized on the state object. */
export function deriveLayers(state: GameState): LayerDerivation {
  const cached = CACHE.get(state);
  if (cached !== undefined) return cached;
  const computed = computeAll(state);
  CACHE.set(state, computed);
  return computed;
}

export function derivedCharacteristics(state: GameState): CharacteristicMap {
  return deriveLayers(state).map;
}

/**
 * The object's current characteristics.
 *
 * Continuous effects apply to permanents on the battlefield (CR 611.2c), so
 * anything in another zone reports its printed values. That is also what makes
 * a pumped creature that leaves the battlefield lose the pump.
 */
export function characteristicsOf(state: GameState, oid: ObjectId): Characteristics {
  const object = objectAt(state, oid);
  if (object.zone !== 'battlefield' && object.card.kind === 'creature') {
    return evaluateOffBattlefieldPowerToughness(state, object, derivedCharacteristics(state));
  }
  if (state.continuous.length === 0 && object.card.characteristicPowerToughness === undefined) {
    return withCounterContribution(object, printedCharacteristics(object));
  }
  return derivedCharacteristics(state).get(oid) ?? printedCharacteristics(object);
}

/** Intrinsic keyword abilities after copy and ability-removal effects. */
export function keywordAbilitiesOf(state: GameState, oid: ObjectId): readonly KeywordAbility[] {
  return characteristicsOf(state, oid).keywordAbilities;
}

export function hasKeywordAbility(state: GameState, oid: ObjectId, kind: KeywordAbility['kind']): boolean {
  return keywordAbilitiesOf(state, oid).some((ability) => ability.kind === kind);
}

/**
 * Layers 6 and 7d for one object, off the battlefield-free path.
 *
 * The same two contributions `applyCounterKeywordLayer` and
 * `applyCounterStatLayer` make in the full walk, applied to a single
 * permanent. Counters apply only on the battlefield (CR 611.2c is about
 * continuous effects, but a counter goes away with the object under CR 400.7),
 * so anything elsewhere reports printed values.
 */
function withCounterContribution(object: GameObject, printed: Characteristics): Characteristics {
  if (object.zone !== 'battlefield') return printed;
  const delta = counterStatDelta(object.counters);
  const added = counterKeywords(object.counters).filter((keyword) => !printed.keywords.includes(keyword));
  if (delta.power === 0 && delta.toughness === 0 && added.length === 0) return printed;
  return {
    ...printed,
    power: printed.power + delta.power,
    toughness: printed.toughness + delta.toughness,
    keywords: [...printed.keywords, ...added],
  };
}

/**
 * The accessors below are the kernel's hot path — combat, state-based actions
 * and legality checks call them thousands of times per game — so each one
 * short-circuits when `state.continuous` is empty, which is every state in a
 * game that casts no continuous effect. The short circuit answers the *same*
 * question the layer walk would, from the printed card plus layer 7d, without
 * allocating a characteristics record or a battlefield map. Anything nontrivial
 * falls through to the real walk.
 */
function noLayerEffects(state: GameState): boolean {
  return (
    state.continuous.length === 0 &&
    !state.battlefield.some(
      (oid) =>
        objectAt(state, oid).card.kind === 'creature' &&
        objectAt(state, oid).card.characteristicPowerToughness !== undefined,
    )
  );
}

/** Effects that currently apply to one object, in CR 613 application order. */
export function effectsApplyingTo(state: GameState, oid: ObjectId): readonly ContinuousEffect[] {
  return deriveLayers(state)
    .applications.filter((application) => application.affected.includes(oid))
    .map((application) => application.effect);
}

/** Counter contribution to P/T (layer 7d), zero off the battlefield. */
function counterDelta(
  state: GameState,
  oid: ObjectId,
): { readonly power: number; readonly toughness: number } {
  const object = objectAt(state, oid);
  if (object.zone !== 'battlefield') return ZERO_DELTA;
  return counterStatDelta(object.counters);
}

const ZERO_DELTA = { power: 0, toughness: 0 } as const;

export function powerOf(state: GameState, oid: ObjectId): number {
  if (noLayerEffects(state) && objectAt(state, oid).card.characteristicPowerToughness === undefined) {
    const card = objectAt(state, oid).card;
    return (card.kind === 'creature' ? card.power : 0) + counterDelta(state, oid).power;
  }
  return characteristicsOf(state, oid).power;
}

export function toughnessOf(state: GameState, oid: ObjectId): number {
  if (noLayerEffects(state) && objectAt(state, oid).card.characteristicPowerToughness === undefined) {
    const card = objectAt(state, oid).card;
    return (card.kind === 'creature' ? card.toughness : 0) + counterDelta(state, oid).toughness;
  }
  return characteristicsOf(state, oid).toughness;
}

export function hasKeyword(state: GameState, oid: ObjectId, keyword: Keyword): boolean {
  if (noLayerEffects(state)) {
    const object = objectAt(state, oid);
    if (object.card.keywords.includes(keyword)) return true;
    // Layer 6 from a counter. Without this the short circuit would answer a
    // different question from the walk it stands in for, which is the one thing
    // a short circuit may never do.
    return object.zone === 'battlefield' && counterKeywords(object.counters).includes(keyword);
  }
  return characteristicsOf(state, oid).keywords.includes(keyword);
}

/**
 * Whether a permanent already has what a `grantKeyword` modification names.
 *
 * One reader for the one question a grant's *value* depends on — granting a
 * keyword to a permanent that has it is worth nothing (`@mtg/sim`'s
 * `modificationValueOn`) — written here because the modification names one
 * thing and the characteristics keep two lists, so every caller would otherwise
 * repeat the same split `effectForModification` already makes.
 */
export function hasGrantableKeyword(state: GameState, oid: ObjectId, keyword: GrantableKeyword): boolean {
  return isGrantableKeywordAbilityKind(keyword)
    ? hasKeywordAbility(state, oid, keyword)
    : hasKeyword(state, oid, keyword);
}

export function isCreatureObject(state: GameState, oid: ObjectId): boolean {
  if (noLayerEffects(state)) return objectAt(state, oid).card.kind === 'creature';
  return isCreatureCharacteristics(characteristicsOf(state, oid));
}

/** Does the permanent currently have this card type (layer 4)? */
export function hasCardType(state: GameState, oid: ObjectId, kind: CardKind): boolean {
  if (noLayerEffects(state)) {
    // The short circuit has to answer the same question the walk does, and an
    // artifact creature is the one card that makes `card.kind` a worse answer
    // than `printedCharacteristics`: its type line reads "Artifact Creature"
    // and its discriminant reads `creature`. Both read `printedCardTypes`, so
    // this branch and the layer walk cannot disagree about a Juggernaut
    // (`mtg-6y4g`).
    return printedCardTypes(objectAt(state, oid).card).includes(kind);
  }
  return characteristicsOf(state, oid).cardTypes.includes(kind);
}

/** Copiable printed starting loyalty, not the counters currently carried. */
export function startingLoyaltyOf(state: GameState, oid: ObjectId): number | null {
  if (noLayerEffects(state)) {
    const card = objectAt(state, oid).card;
    return card.kind === 'planeswalker' ? card.startingLoyalty : null;
  }
  return characteristicsOf(state, oid).startingLoyalty;
}

/**
 * Does the permanent currently have this subtype (layers 3 and 4)?
 *
 * Read rather than printed, for the reason `hasCardType` is: a Key that a
 * text-changing effect turned into something else stops paying a cost that
 * names Keys, and an artifact a layer-4 effect made into one starts. The
 * short circuit answers the same question the walk does, because subtypes are
 * changed only by continuous effects — no counter contributes one — so a state
 * with no continuous effects has nothing but the printed line to report.
 */
export function hasSubtype(state: GameState, oid: ObjectId, subtype: string): boolean {
  if (noLayerEffects(state)) {
    const card = objectAt(state, oid).card;
    return (
      card.subtypes.includes(subtype) ||
      (card.kind === 'land' && card.basicLandType !== undefined && card.basicLandType === subtype)
    );
  }
  return characteristicsOf(state, oid).subtypes.includes(subtype);
}

/**
 * Who controls a permanent right now — layer 2's answer.
 *
 * Every control-sensitive read in the kernel goes through here rather than
 * `GameObject.controller`, so a control-change effect is one record in
 * `state.continuous` and not a sweep of the codebase.
 */
export function controllerOf(state: GameState, oid: ObjectId): PlayerId {
  if (noLayerEffects(state)) return objectAt(state, oid).controller;
  return characteristicsOf(state, oid).controller;
}

/** Permanents a player controls right now, battlefield order. */
export function controlledBy(state: GameState, player: PlayerId): readonly ObjectId[] {
  return state.battlefield.filter((oid) => controllerOf(state, oid) === player);
}
