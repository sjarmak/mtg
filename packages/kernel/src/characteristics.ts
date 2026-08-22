/**
 * Derived characteristics and the application of one continuous effect to them.
 *
 * ## Attribution
 *
 * The rule that a modified characteristic is *never* written back onto the
 * object — every read recomputes from the printed card upward — is a *design*
 * ported from Argentum (MIT, <https://github.com/wingedsheep/argentum-engine>),
 * `docs/continuous-effect-dependency-system.md`, cross-checked against XMage
 * (MIT, <https://github.com/magefree/mage>),
 * `Mage/src/main/java/mage/abilities/effects/ContinuousEffects.java`. No code
 * was copied from either.
 *
 * This module is deliberately the *bottom* of the layer stack: it knows how to
 * apply a single effect to a single permanent and nothing about ordering. That
 * is what lets `dependency.ts` (CR 613.8) and `layers.ts` (the layer walk) both
 * use it without importing each other.
 */
import type {
  CardKind,
  CharacteristicPowerToughness,
  Color,
  Condition,
  Keyword,
  KeywordAbility,
  Supertype,
} from '@mtg/dsl';
import { assertNever, printedCardTypes } from '@mtg/dsl';
import type {
  AbilityChangeEffect,
  ColorChangeEffect,
  ContinuousEffect,
  CopyEffect,
  ObjectFilter,
  PtCount,
  PtDefiningEffect,
  PtModEffect,
  PtScaledModEffect,
  PtSetEffect,
  TextChangeEffect,
  TypeChangeEffect,
} from './continuous';
import { counterCount } from './continuous';
import { opponentOf } from './ids';
import type { ObjectId, PlayerId } from './ids';
import type { GameObject, GameState } from './state';
import { graveyardMembers } from './zone-members';

export interface Characteristics {
  readonly name: string;
  readonly power: number;
  readonly toughness: number;
  readonly keywords: readonly Keyword[];
  readonly keywordAbilities: readonly KeywordAbility[];
  readonly colors: readonly Color[];
  readonly cardTypes: readonly CardKind[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly Supertype[];
  /** Layer 2's output. `GameObject.controller` is the last value written down. */
  readonly controller: PlayerId;
  /** A copiable intrinsic CDA, evaluated in layer 7a rather than stored as stats. */
  readonly powerToughnessDefinition: CharacteristicPowerToughness | null;
  /** Copiable printed starting loyalty; absent from nonplaneswalkers. */
  readonly startingLoyalty: number | null;
}

export type CharacteristicMap = ReadonlyMap<ObjectId, Characteristics>;

/**
 * What one effect sees when it applies: the state (layer 1 needs the copy
 * source's printed card) and the characteristics computed so far (every filter
 * and every count is evaluated against these, not against printed values).
 */
export interface LayerContext {
  readonly state: GameState;
  readonly battlefield: readonly ObjectId[];
  readonly map: CharacteristicMap;
}

export function printedCharacteristics(object: GameObject): Characteristics {
  const card = object.card;
  const isCreature = card.kind === 'creature';
  return {
    name: card.name,
    power: isCreature ? card.power : 0,
    toughness: isCreature ? card.toughness : 0,
    keywords: card.keywords,
    keywordAbilities: card.keywordAbilities ?? [],
    colors: card.colors,
    // Both types for an artifact creature, and the second one is a bug fix
    // rather than a widening (`mtg-6y4g`). `CreatureCardSchema` has carried an
    // `artifact` flag since artifact creatures started filling a generated
    // set's colorless slot, and `isArtifact` has always read it — but this
    // function reported `[card.kind]`, so a Manic Vandal could not name a
    // Juggernaut and every artifact filter in the layer system agreed with it.
    // CR 205.1a: a card's types are what its type line says, and "Artifact
    // Creature" says two.
    cardTypes: printedCardTypes(card),
    subtypes:
      card.kind === 'land' && card.basicLandType !== undefined
        ? [...card.subtypes, card.basicLandType]
        : card.subtypes,
    supertypes: card.supertypes,
    controller: object.controller,
    powerToughnessDefinition:
      isCreature && card.characteristicPowerToughness !== undefined
        ? card.characteristicPowerToughness
        : null,
    startingLoyalty: card.kind === 'planeswalker' ? card.startingLoyalty : null,
  };
}

export function isCreatureCharacteristics(current: Characteristics): boolean {
  return current.cardTypes.includes('creature');
}

function anyOf<T>(allowed: readonly T[] | null, present: readonly T[]): boolean {
  return allowed === null || allowed.some((value) => present.includes(value));
}

/**
 * The conjunctive read: every listed value must be present.
 *
 * `keywords` has always been checked this way inline; `allCardTypes` asks the
 * identical question of a second dimension, so the two share one helper rather
 * than one of them growing a second spelling of `every`.
 */
function allOf<T>(required: readonly T[] | null, present: readonly T[]): boolean {
  return required === null || required.every((value) => present.includes(value));
}

/** The mirror of `anyOf`: no listed value may be present. */
function noneOf<T>(refused: readonly T[] | null, present: readonly T[]): boolean {
  return refused === null || !refused.some((value) => present.includes(value));
}

/** Does a permanent with these characteristics match the filter right now? */
export function matchesFilter(filter: ObjectFilter, oid: ObjectId, current: Characteristics): boolean {
  if (filter.oids !== null && !filter.oids.includes(oid)) return false;
  if (filter.excludeOids !== null && filter.excludeOids.includes(oid)) return false;
  if (!anyOf(filter.cardTypes, current.cardTypes)) return false;
  if (!allOf(filter.allCardTypes, current.cardTypes)) return false;
  if (!noneOf(filter.excludeCardTypes, current.cardTypes)) return false;
  if (!anyOf(filter.subtypes, current.subtypes)) return false;
  if (!anyOf(filter.supertypes, current.supertypes)) return false;
  if (!anyOf(filter.colors, current.colors)) return false;
  if (!noneOf(filter.excludeColors, current.colors)) return false;
  if (!allOf(filter.keywords, current.keywords)) return false;
  if (filter.controller !== null && filter.controller !== current.controller) return false;
  return true;
}

/** Every permanent the filter currently matches, in battlefield order. */
export function selectMatching(
  battlefield: readonly ObjectId[],
  map: CharacteristicMap,
  filter: ObjectFilter,
): readonly ObjectId[] {
  return battlefield.filter((oid) => {
    const current = map.get(oid);
    return current !== undefined && matchesFilter(filter, oid, current);
  });
}

/**
 * Resolves `ObjectFilter.controllerIsSource` against live characteristics, so
 * `matchesFilter`/`selectMatching` only ever see a fixed `controller`.
 *
 * `null` means "matches nobody", returned instead of a filter when the
 * source itself is missing from the map — mirroring `conditionHolds`'s and
 * `affectedByEffect`'s own defensive-false convention. That is deliberately
 * different from falling through to `filter.controller`'s own `null` ("don't
 * care"): a lord whose source has left the battlefield should reach zero
 * permanents, not silently widen to every controller because the field it
 * would have written came back empty.
 */
function resolveFilter(
  context: LayerContext,
  filter: ObjectFilter,
  sourceOid: ObjectId,
): ObjectFilter | null {
  if (!filter.controllerIsSource) return filter;
  const source = context.map.get(sourceOid);
  if (source === undefined) return null;
  return { ...filter, controller: source.controller, controllerIsSource: false };
}

function union<T>(base: readonly T[], added: readonly T[]): readonly T[] {
  if (added.length === 0) return base;
  const result = [...base];
  for (const value of added) if (!result.includes(value)) result.push(value);
  return result;
}

function without<T>(base: readonly T[], removed: readonly T[]): readonly T[] {
  return removed.length === 0 ? base : base.filter((value) => !removed.includes(value));
}

function applyCopy(current: Characteristics, effect: CopyEffect, state: GameState): Characteristics {
  const source = state.objects[effect.copyOf];
  if (source === undefined) return current;
  // CR 613.1a / 707.2: a copy takes the copiable (printed) values. Control is
  // not copiable, so it survives from whatever layer 2 said.
  return { ...printedCharacteristics(source), controller: current.controller };
}

function applyTextChange(current: Characteristics, effect: TextChangeEffect): Characteristics {
  if (!current.subtypes.includes(effect.fromSubtype)) return current;
  return {
    ...current,
    subtypes: current.subtypes.map((subtype) =>
      subtype === effect.fromSubtype ? effect.toSubtype : subtype,
    ),
  };
}

function applyTypeChange(current: Characteristics, effect: TypeChangeEffect): Characteristics {
  const base = effect.removeAllSubtypes ? [] : current.subtypes;
  return {
    ...current,
    cardTypes: union(without(current.cardTypes, effect.removeTypes), effect.addTypes),
    subtypes: union(base, effect.addSubtypes),
  };
}

function applyColorChange(current: Characteristics, effect: ColorChangeEffect): Characteristics {
  return { ...current, colors: union(effect.setColors ?? current.colors, effect.addColors) };
}

/**
 * Whether two keyword abilities are the same grant, so a second copy can be
 * dropped rather than stacked.
 *
 * The payload is part of the identity and only for the two members that carry
 * one: Islandwalk and Forestwalk are different abilities, protection from red
 * and protection from Zombies are different abilities, and a second
 * indestructible is the same one twice. `hasKeywordAbility` asks only whether
 * *some* ability has a kind, so a duplicate changes no answer this kernel
 * gives; it is dropped because `keywordAbilitiesOf` is also what a renderer and
 * `combat.ts`'s landwalk walk read, and a list that grows a copy per layer walk
 * is a list nobody can compare.
 */
function sameKeywordAbility(left: KeywordAbility, right: KeywordAbility): boolean {
  switch (left.kind) {
    case 'landwalk':
      return right.kind === 'landwalk' && right.landType === left.landType;
    case 'protection':
      return (
        right.kind === 'protection' &&
        right.quality.kind === left.quality.kind &&
        (right.quality.kind === 'color' && left.quality.kind === 'color'
          ? right.quality.color === left.quality.color
          : right.quality.kind === 'subtype' &&
            left.quality.kind === 'subtype' &&
            right.quality.subtype === left.quality.subtype)
      );
    case 'defender':
    case 'hexproof':
    case 'indestructible':
    case 'doubleStrike':
      return right.kind === left.kind;
    default:
      return assertNever(left, 'sameKeywordAbility');
  }
}

function applyAbilityChange(current: Characteristics, effect: AbilityChangeEffect): Characteristics {
  // CR 613.1f: one effect that removes and grants does both, removal first.
  const base = effect.removeAll ? [] : without(current.keywords, effect.removeKeywords);
  const keywordAbilities = [...(effect.removeAll ? [] : current.keywordAbilities)];
  for (const granted of effect.addKeywordAbilities) {
    if (!keywordAbilities.some((ability) => sameKeywordAbility(ability, granted))) {
      keywordAbilities.push(granted);
    }
  }
  return {
    ...current,
    keywords: union(base, effect.addKeywords),
    keywordAbilities,
    powerToughnessDefinition: effect.removeAll ? null : current.powerToughnessDefinition,
  };
}

/** Applies intrinsic P/T definitions against the characteristics after layer 6. */
export function applyIntrinsicPowerToughness(
  state: GameState,
  battlefield: readonly ObjectId[],
  map: CharacteristicMap,
): CharacteristicMap {
  let next: Map<ObjectId, Characteristics> | null = null;
  for (const [oid, current] of map) {
    const definition = current.powerToughnessDefinition;
    if (definition === null) continue;
    let value: number;
    switch (definition.kind) {
      case 'creaturesYouControl':
        value = battlefield.filter((candidate) => {
          const found = map.get(candidate);
          return (
            found !== undefined && found.controller === current.controller && isCreatureCharacteristics(found)
          );
        }).length;
        break;
      case 'controllerLifeTotal':
        value = state.players[current.controller].life;
        break;
    }
    next ??= new Map(map);
    next.set(oid, { ...current, power: value, toughness: value });
  }
  return next ?? map;
}

/** Evaluates one CDA-bearing object outside the battlefield for its owner/controller. */
export function evaluateOffBattlefieldPowerToughness(
  state: GameState,
  object: GameObject,
  battlefield: CharacteristicMap,
): Characteristics {
  const printed = printedCharacteristics(object);
  const definition = printed.powerToughnessDefinition;
  if (definition === null) return printed;
  const player = object.zone === 'stack' ? object.controller : object.owner;
  const value =
    definition.kind === 'controllerLifeTotal'
      ? state.players[player].life
      : [...battlefield.values()].filter(
          (current) => current.controller === player && isCreatureCharacteristics(current),
        ).length;
  return { ...printed, power: value, toughness: value };
}

/**
 * The number of distinct card types among the printed cards in a graveyard
 * (or both) — CR 613.4a's own worked example, Tarmogoyf.
 *
 * A distinct-value count, not a tally: `graveyardMembers` can return several
 * ids of the same card type and they contribute one to `types.size`, the way
 * three instants in a graveyard are still "instant" once. `printedCharacteristics`
 * rather than a `CharacteristicMap` lookup, because a graveyard card has no
 * derived characteristics — `zone-filter.ts`'s own docblock says the same for
 * `selectPrinted` — so its type is exactly what is printed on it.
 */
function graveyardCardTypeCount(state: GameState, whose: PlayerId | 'each'): number {
  const types = new Set<CardKind>();
  for (const oid of graveyardMembers(state, whose)) {
    const object = state.objects[oid];
    if (object === undefined) continue;
    for (const cardType of printedCharacteristics(object).cardTypes) types.add(cardType);
  }
  return types.size;
}

/** Resolves a `PtCount` (either arm) against live state to the number a CDA's P/T reads. */
function ptCountValue(context: LayerContext, count: PtCount, sourceOid: ObjectId): number {
  switch (count.kind) {
    case 'battlefield': {
      const filter = resolveFilter(context, count.filter, sourceOid);
      return filter === null ? 0 : selectMatching(context.battlefield, context.map, filter).length;
    }
    case 'battlefieldWithCounters': {
      // Two pieces against two sources, which is the whole reason this arm is
      // not a filter field: the characteristics decide which permanents the
      // count is over, and `state.objects` decides which of those are carrying
      // one of the named counters. Reading the second question off the
      // characteristic map would be circular — layer 7d derives P/T from the
      // counters — so it is asked where `conditionHolds`'s
      // `anyCreatureHasCounter` arm asks it.
      const filter = resolveFilter(context, count.filter, sourceOid);
      if (filter === null) return 0;
      const matching = selectMatching(context.battlefield, context.map, filter);
      return matching.filter((oid) => {
        const object = context.state.objects[oid];
        if (object === undefined) return false;
        // `some`, so a permanent carrying two of the named kinds counts once.
        return count.counters.some((kind) => counterCount(object.counters, kind) > 0);
      }).length;
    }
    case 'graveyardCardTypes':
      return graveyardCardTypeCount(context.state, count.whose);
    default:
      return assertNever(count, 'ptCountValue');
  }
}

function applyPtDefine(
  current: Characteristics,
  effect: PtDefiningEffect,
  context: LayerContext,
): Characteristics {
  const count = ptCountValue(context, effect.countOf, effect.sourceOid);
  return {
    ...current,
    power: count + effect.powerOffset,
    toughness: count + effect.toughnessOffset,
  };
}

function applyPtSet(current: Characteristics, effect: PtSetEffect): Characteristics {
  return { ...current, power: effect.power, toughness: effect.toughness };
}

function applyPtMod(current: Characteristics, effect: PtModEffect): Characteristics {
  return {
    ...current,
    power: current.power + effect.power,
    toughness: current.toughness + effect.toughness,
  };
}

/** Applies one effect to one permanent that it has already been matched to. */
function applyPtScaledMod(
  current: Characteristics,
  effect: PtScaledModEffect,
  context: LayerContext,
): Characteristics {
  const count = ptCountValue(context, effect.countOf, effect.sourceOid);
  return {
    ...current,
    power: current.power + effect.power * count,
    toughness: current.toughness + effect.toughness * count,
  };
}

export function applyEffectTo(
  current: Characteristics,
  effect: ContinuousEffect,
  context: LayerContext,
): Characteristics {
  switch (effect.kind) {
    case 'copy':
      return applyCopy(current, effect, context.state);
    case 'control':
      return { ...current, controller: effect.controller };
    case 'textChange':
      return applyTextChange(current, effect);
    case 'typeChange':
      return applyTypeChange(current, effect);
    case 'colorChange':
      return applyColorChange(current, effect);
    case 'abilityChange':
      return applyAbilityChange(current, effect);
    case 'ptDefine':
      return applyPtDefine(current, effect, context);
    case 'ptSet':
      return applyPtSet(current, effect);
    case 'ptMod':
      return applyPtMod(current, effect);
    case 'ptScaledMod':
      return applyPtScaledMod(current, effect, context);
    case 'ptSwitch':
      return { ...current, power: current.toughness, toughness: current.power };
  }
}

/**
 * CR 611.2c: does this conditional continuous effect's predicate hold right
 * now?
 *
 * `controlsSubtype` is asked from the perspective of whoever controls the
 * effect's source, read live off `context.map` rather than a `PlayerId` baked
 * into the record — the same live lookup `resolveFilter` does for
 * `ObjectFilter.controllerIsSource` below, and for the same reason: a
 * control-change effect earlier in the same walk already moved the answer by
 * the time this runs. A source missing from the map — a defensive case only,
 * since a static's effect is always removed from `state.continuous` in the
 * same reduction that removes its source from the battlefield (`zones.ts`) —
 * answers "false" rather than throwing, matching `applyEffect`'s own
 * skip-not-throw convention for an unmatched permanent.
 *
 * `anyCreatureHasCounter` asks no perspective question at all — it is a
 * board-wide presence check (`condition.ts`'s `mtg-jp23` section) — and it
 * reads `context.state.objects` directly rather than `context.map`, for the
 * same reason `satisfiesTargetRestriction`'s `withCounter` arm
 * (`target-restrictions.ts`) reads `getObject` instead of the layer system:
 * a counter is stored on the object, and layer 7d derives power *from* it, so
 * asking the derived characteristics for the counter that produced them would
 * be circular. `context.map` still gates which battlefield objects count as
 * creatures, because card type is itself layer output (an effect earlier in
 * the walk may have turned a noncreature into one).
 *
 * Real `switch`/`assertNever` dispatch as of `mtg-jp23`: `Condition` gained a
 * second member whose fields (`counter`) do not overlap `controlsSubtype`'s
 * (`subtype`/`atLeast`), so `Condition['kind']` is now the literal union
 * `'controlsSubtype' | 'anyCreatureHasCounter'` and the standard
 * `switch`/`default`/`assertNever` idiom narrows for real. `condition.ts`
 * argues why a hand-maintained tripwire type is no longer the right
 * instrument for keeping this exhaustive.
 */
export function conditionHolds(context: LayerContext, condition: Condition, sourceOid: ObjectId): boolean {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const source = context.map.get(sourceOid);
      if (source === undefined) return false;
      let count = 0;
      for (const oid of context.battlefield) {
        const current = context.map.get(oid);
        if (current === undefined) continue;
        if (current.controller !== source.controller) continue;
        if (!current.subtypes.includes(condition.subtype)) continue;
        count += 1;
      }
      return count >= condition.atLeast;
    }
    case 'anyCreatureHasCounter': {
      for (const oid of context.battlefield) {
        const current = context.map.get(oid);
        if (current === undefined) continue;
        if (!current.cardTypes.includes('creature')) continue;
        const object = context.state.objects[oid];
        if (object === undefined) continue;
        if (counterCount(object.counters, condition.counter) > 0) return true;
      }
      return false;
    }
    case 'opponentGraveyardAtLeast': {
      // The one condition in this switch that reads no battlefield. A
      // graveyard has no derived characteristics for the layer walk to compute
      // (`zone-filter.ts` argues why), so the count comes straight off the zone
      // and needs the map only to learn whose seat is the opponent's — read
      // live, so a control-change effect moves the question with the permanent.
      const source = context.map.get(sourceOid);
      if (source === undefined) return false;
      return graveyardMembers(context.state, opponentOf(source.controller)).length >= condition.atLeast;
    }
    case 'lifeAtLeast': {
      // "You" is the source's current controller, read live off the map for the
      // reason `controlsSubtype` reads it there: a control-change effect moves
      // the question with the permanent.
      const source = context.map.get(sourceOid);
      if (source === undefined) return false;
      return context.state.players[source.controller].life >= condition.atLeast;
    }
    case 'noOpponentDealtDamageThisTurn': {
      // The one condition in this switch that reads history rather than a
      // census. `TurnState.damagedPlayers` is where the kernel keeps it and
      // `damage.ts` is what writes it; the seat is read live, as the other
      // opponent-scoped member's is. The polarity is negative because the
      // printed clause it serves is a restriction with an "unless" in it —
      // `condition.ts` argues that at length.
      const source = context.map.get(sourceOid);
      if (source === undefined) return false;
      return !context.state.turn.damagedPlayers.includes(opponentOf(source.controller));
    }
    default:
      return assertNever(condition, 'conditionHolds');
  }
}

/**
 * Every permanent one effect currently applies to: `affects` narrowed by
 * `enabledWhile`, so a disabled conditional effect behaves exactly like an
 * effect whose `affects` filter matches nobody.
 *
 * The one function `applyEffect`, `computeAll` (`layers.ts`) and `signatureOf`
 * (`dependency.ts`, CR 613.8) all call instead of `selectMatching` directly.
 * Before this existed, each of the three independently asked "what does
 * `effect.affects` match" and none of them knew about `enabledWhile`, which
 * would have left a disabled effect *applying* through `applyEffect` while
 * `computeAll`'s `applications` list — what `effectsApplyingTo` reports — and
 * the CR 613.8 dependency graph both still saw its unconditional filter. A
 * condition whose truth value another effect in the same layer flips is
 * exactly clause (b) of CR 613.8a ("would applying B change what A applies
 * to"), so folding the gate in here is what lets the dependency pass see it
 * as the dependency it is, rather than three call sites drifting out of
 * agreement about which permanents a card's own static currently reaches.
 */
export function affectedByEffect(context: LayerContext, effect: ContinuousEffect): readonly ObjectId[] {
  if (effect.enabledWhile !== null && !conditionHolds(context, effect.enabledWhile, effect.sourceOid)) {
    return [];
  }
  const filter = resolveFilter(context, effect.affects, effect.sourceOid);
  if (filter === null) return [];
  return selectMatching(context.battlefield, context.map, filter);
}

/** Applies one effect to every permanent it currently matches. */
export function applyEffect(context: LayerContext, effect: ContinuousEffect): CharacteristicMap {
  const affected = affectedByEffect(context, effect);
  if (affected.length === 0) return context.map;
  const next = new Map(context.map);
  for (const oid of affected) {
    const current = next.get(oid);
    if (current === undefined) continue;
    next.set(oid, applyEffectTo(current, effect, context));
  }
  return next;
}
