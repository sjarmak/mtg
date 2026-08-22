/**
 * Kernel-level constructs for exercising CR 613/614 without the DSL.
 *
 * The DSL reaches two layers from a card: `pumpUntilEndOfTurn` and a static
 * ability's `statBonus` or `grantKeyword`. It emits no replacement effects at
 * all, so the rest of the layer walk and the whole replacement pipeline would
 * be untestable through cards. These builders write the same records the
 * kernel writes, since `state.continuous` and `state.replacements` are plain
 * data by design, so the tests drive the real engine rather than a parallel
 * one. When the DSL grows replacement abilities its compiler produces exactly
 * these shapes.
 */
import type { CardKind, Color, Condition, Keyword, KeywordAbility } from '@mtg/dsl';
import type {
  AbilityChangeEffect,
  ColorChangeEffect,
  ContinuousEffect,
  ControlEffect,
  CopyEffect,
  CounterKind,
  EffectDuration,
  GameState,
  ObjectFilter,
  ObjectId,
  PlayerId,
  PtCount,
  PtDefiningEffect,
  PtModEffect,
  PtSetEffect,
  PtSwitchEffect,
  ReplacementEffect,
  ReplacementModification,
  ReplacementTrigger,
  TextChangeEffect,
  TypeChangeEffect,
} from '@mtg/kernel';
import { addCounters, getObject, objectFilter, onlyObject } from '@mtg/kernel';

export interface EffectOptions {
  readonly id?: string | undefined;
  /** CR 613.7 timestamp. Defaults to the declaration order in a test. */
  readonly ts?: number | undefined;
  readonly source?: ObjectId | undefined;
  readonly duration?: EffectDuration | undefined;
  /** CR 611.2c. Defaults to unconditional, matching every builder before this field existed. */
  readonly enabledWhile?: Condition | null | undefined;
}

let sequence = 0;

function common(
  affects: ObjectFilter,
  options: EffectOptions,
): {
  id: string;
  timestamp: number;
  sourceOid: ObjectId;
  duration: EffectDuration;
  affects: ObjectFilter;
  enabledWhile: Condition | null;
} {
  sequence += 1;
  return {
    id: options.id ?? `ce${sequence}`,
    timestamp: options.ts ?? sequence,
    sourceOid: options.source ?? 'test-source',
    duration: options.duration ?? 'permanent',
    affects,
    enabledWhile: options.enabledWhile ?? null,
  };
}

/** Layer 1: the affected permanents become copies of `source`. */
export function copies(affects: ObjectFilter, source: ObjectId, options: EffectOptions = {}): CopyEffect {
  return { ...common(affects, options), kind: 'copy', layer: '1', copyOf: source };
}

/** Layer 2: control change. */
export function controlledBy(
  affects: ObjectFilter,
  controller: PlayerId,
  options: EffectOptions = {},
): ControlEffect {
  return { ...common(affects, options), kind: 'control', layer: '2', controller };
}

/** Layer 3: subtype substitution. */
export function rewriteSubtype(
  affects: ObjectFilter,
  fromSubtype: string,
  toSubtype: string,
  options: EffectOptions = {},
): TextChangeEffect {
  return { ...common(affects, options), kind: 'textChange', layer: '3', fromSubtype, toSubtype };
}

export interface TypeChange {
  readonly addTypes?: readonly CardKind[] | undefined;
  readonly removeTypes?: readonly CardKind[] | undefined;
  readonly addSubtypes?: readonly string[] | undefined;
  readonly removeAllSubtypes?: boolean | undefined;
}

/** Layer 4: card types, subtypes, supertypes. */
export function retype(
  affects: ObjectFilter,
  change: TypeChange,
  options: EffectOptions = {},
): TypeChangeEffect {
  return {
    ...common(affects, options),
    kind: 'typeChange',
    layer: '4',
    addTypes: change.addTypes ?? [],
    removeTypes: change.removeTypes ?? [],
    addSubtypes: change.addSubtypes ?? [],
    removeAllSubtypes: change.removeAllSubtypes ?? false,
  };
}

/** Layer 5: color. */
export function recolor(
  affects: ObjectFilter,
  setColors: readonly Color[] | null,
  addColors: readonly Color[] = [],
  options: EffectOptions = {},
): ColorChangeEffect {
  return { ...common(affects, options), kind: 'colorChange', layer: '5', setColors, addColors };
}

export interface AbilityChange {
  readonly add?: readonly Keyword[] | undefined;
  /** The keyword-ability half of layer 6 — landwalk, indestructible and the rest. */
  readonly addAbilities?: readonly KeywordAbility[] | undefined;
  readonly remove?: readonly Keyword[] | undefined;
  readonly removeAll?: boolean | undefined;
}

/** Layer 6: abilities granted and removed. */
export function abilities(
  affects: ObjectFilter,
  change: AbilityChange,
  options: EffectOptions = {},
): AbilityChangeEffect {
  return {
    ...common(affects, options),
    kind: 'abilityChange',
    layer: '6',
    addKeywords: change.add ?? [],
    addKeywordAbilities: change.addAbilities ?? [],
    removeKeywords: change.remove ?? [],
    removeAll: change.removeAll ?? false,
  };
}

/** A `PtCount` reading the battlefield, e.g. "the number of Zombies you control". */
export function battlefieldCount(filter: ObjectFilter): PtCount {
  return { kind: 'battlefield', filter };
}

/** A `PtCount` reading a graveyard's distinct card types (CR 613.4a, Tarmogoyf). */
export function graveyardCardTypesCount(whose: PlayerId | 'each' = 'each'): PtCount {
  return { kind: 'graveyardCardTypes', whose };
}

/** Layer 7a: a characteristic-defining P/T equal to a live count. */
export function definePt(
  affects: ObjectFilter,
  countOf: PtCount,
  offsets: { readonly power?: number; readonly toughness?: number } = {},
  options: EffectOptions = {},
): PtDefiningEffect {
  return {
    ...common(affects, options),
    kind: 'ptDefine',
    layer: '7a',
    countOf,
    powerOffset: offsets.power ?? 0,
    toughnessOffset: offsets.toughness ?? 0,
  };
}

/** Layer 7b: P/T set to specific values. */
export function setPt(
  affects: ObjectFilter,
  power: number,
  toughness: number,
  options: EffectOptions = {},
): PtSetEffect {
  return { ...common(affects, options), kind: 'ptSet', layer: '7b', power, toughness };
}

/** Layer 7c: P/T modified, the DSL's `pumpUntilEndOfTurn`. */
export function pump(
  affects: ObjectFilter,
  power: number,
  toughness: number,
  options: EffectOptions = {},
): PtModEffect {
  return { ...common(affects, options), kind: 'ptMod', layer: '7c', power, toughness };
}

/** Layer 7e: P/T switched. */
export function switchPt(affects: ObjectFilter, options: EffectOptions = {}): PtSwitchEffect {
  return { ...common(affects, options), kind: 'ptSwitch', layer: '7e' };
}

export interface ReplacementOptions extends EffectOptions {
  readonly controller?: PlayerId | undefined;
  readonly self?: boolean | undefined;
}

export function replacement(
  trigger: ReplacementTrigger,
  modification: ReplacementModification,
  options: ReplacementOptions = {},
): ReplacementEffect {
  sequence += 1;
  return {
    id: options.id ?? `re${sequence}`,
    sourceOid: options.source ?? 'test-source',
    controller: options.controller ?? 0,
    timestamp: options.ts ?? sequence,
    duration: options.duration ?? 'permanent',
    selfReplacement: options.self ?? false,
    trigger,
    modification,
  };
}

/** "Damage dealt to this player" trigger. */
export function damageToPlayer(player: PlayerId): ReplacementTrigger {
  return { kind: 'damage', toPlayer: player, toPermanent: null, fromSource: null, combatOnly: false };
}

/** "Damage dealt to this permanent" trigger. */
export function damageToPermanent(oid: ObjectId): ReplacementTrigger {
  return { kind: 'damage', toPlayer: null, toPermanent: oid, fromSource: null, combatOnly: false };
}

export function withContinuous(state: GameState, effects: readonly ContinuousEffect[]): GameState {
  return { ...state, continuous: [...state.continuous, ...effects] };
}

export function withReplacements(state: GameState, effects: readonly ReplacementEffect[]): GameState {
  return { ...state, replacements: [...state.replacements, ...effects] };
}

/** Puts counters on a permanent directly, the way a resolved effect would. */
export function withCounters(state: GameState, oid: ObjectId, kind: CounterKind, count: number): GameState {
  const object = getObject(state, oid);
  return {
    ...state,
    objects: { ...state.objects, [oid]: { ...object, counters: addCounters(object.counters, kind, count) } },
  };
}

/** Shorthand for the common "everything with this subtype" filter. */
export function withSubtype(subtype: string): ObjectFilter {
  return objectFilter({ subtypes: [subtype] });
}

/** Shorthand for "every permanent that currently has all these keywords". */
export function withKeywords(...keywords: readonly Keyword[]): ObjectFilter {
  return objectFilter({ keywords: [...keywords] });
}

export { onlyObject };
