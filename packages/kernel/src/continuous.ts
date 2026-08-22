/**
 * Continuous effects: the data model for CR 613.
 *
 * ## Attribution
 *
 * The shape of this union — one record per layer, a declarative "what does this
 * apply to" selector evaluated against derived characteristics rather than a
 * closure, and a monotonic timestamp on every record — is a *design* ported
 * from two MIT-licensed engines. No code was copied from either.
 *
 *  - Argentum (MIT, <https://github.com/wingedsheep/argentum-engine>),
 *    `docs/continuous-effect-dependency-system.md`: the layered continuous-effect
 *    store and the dependency-ordering pass it describes.
 *  - XMage (MIT, <https://github.com/magefree/mage>),
 *    `Mage/src/main/java/mage/abilities/effects/ContinuousEffects.java`: the
 *    idea of asking each effect which objects it applies to *at application
 *    time* rather than binding a target set when the effect is created.
 *
 * ## Why the selector is data and not a function
 *
 * `GameState` has to survive `structuredClone` (the fork benchmark's control),
 * JSON canonicalization (`stateFingerprint`), and eventually a worker boundary.
 * A closure in the state breaks all three, so "which objects does this apply
 * to" is an `ObjectFilter` record that `layers.ts` evaluates against the
 * characteristics computed so far. That indirection is also what makes CR
 * 613.8 dependency ordering computable: the same filter evaluated before and
 * after another effect can produce a different set, which is the definition of
 * a dependency.
 */
import type { CardKind, Color, Condition, CounterKind, Keyword, KeywordAbility, Supertype } from '@mtg/dsl';
import { COUNTER_KINDS, counterGrantedKeywords, counterStatBonus } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';

/** Fixed CR 613 application order. Never reorder; only fill in. */
export const LAYER_ORDER = ['1', '2', '3', '4', '5', '6', '7a', '7b', '7c', '7d', '7e'] as const;

export type Layer = (typeof LAYER_ORDER)[number];

/**
 * Layer 7d is P/T from counters, which live on the object rather than in the
 * continuous-effect list, so no effect record ever carries it.
 */
export type EffectLayer = Exclude<Layer, '7d'>;

/**
 * How long an effect stays in `state.continuous`.
 *
 * `'whileOnBattlefield'` is what a printed static ability registers: it names
 * the removal condition rather than the ability kind, and it is not spelled
 * `'permanent'` because that word already means a card type three lines away.
 * `cleanupTurnEffects` filters on `'endOfTurn'` and is unaffected; `moveObject`
 * owns the other half, dropping these when their source leaves the battlefield.
 *
 * `'whileAttached'` is the narrower version of the same condition, and it is a
 * member rather than a convention because an Equipment can print a static
 * ability beside its equip clause: both records name the weapon as their
 * source, and only one of them ends when the attachment does. `unattach`
 * (`attach.ts`) filters on this word, `effectsRegisteredBy` treats it as a
 * `'whileOnBattlefield'` for the purpose of leaving the battlefield, and
 * nothing else in the kernel reads a duration.
 *
 * `'whileSubjectRemains'` ends on a zone change too, and the object it watches
 * is the other one: the three words above all key on the *source*, and this one
 * keys on the permanents `affects.oids` names. Rise from the Grave is the shape
 * that needs it — the source is a sorcery that finished resolving, and the
 * subject is the creature it put onto the battlefield. Printed Magic gives that
 * grant no duration at all, because CR 400.7 makes the creature a new object
 * the moment it leaves and a new object is not what the effect was applied to.
 * This kernel keeps an object's id across a zone change, so "no duration" would
 * read as "and again the next time this card comes back", which is a different
 * card. `effectsPinnedTo` is the sweep and `moveObject` runs it, one line under
 * the `effectsRegisteredBy` sweep it mirrors.
 */
export type EffectDuration =
  'endOfTurn' | 'permanent' | 'whileOnBattlefield' | 'whileAttached' | 'whileSubjectRemains';

/**
 * A declarative "which permanents" predicate.
 *
 * Every field is `T[] | null` rather than optional: `null` means "don't care",
 * which keeps the record free of `undefined` so it canonicalizes and clones
 * cleanly. A list field matches when the object has *any* of the listed values,
 * except `keywords` and `allCardTypes`, which require *all* of them — that asymmetry is what
 * "creatures with flying and vigilance" needs and what "creatures that are
 * green or white" needs, and both are common. The two `exclude` lists are the
 * mirror: an object matches when it has *none* of the listed values.
 */
export interface ObjectFilter {
  readonly oids: readonly ObjectId[] | null;
  /**
   * Permanents this effect skips even when the rest of the filter matches.
   *
   * "Other creatures you control" needs exclusion and `oids` only includes. The
   * alternative — a positive effect over the group plus a negative one over the
   * source — was rejected because it would report two effects in
   * `effectsApplyingTo` and in the layer-7c order where the card has one.
   */
  readonly excludeOids: readonly ObjectId[] | null;
  readonly cardTypes: readonly CardKind[] | null;
  /**
   * Card types an object must have *all* of, which is the other question
   * `cardTypes` one field up cannot ask.
   *
   * "Each artifact creature you control" (Steel Overseer) names one object that
   * is both things; "destroy target artifact or land" (Demolish) names either
   * of two. `cardTypes` is read with `any of` and answers the second, so the
   * first needs its own list read with `every` — exactly the asymmetry
   * `keywords` already carries below, and for the same reason: printed Magic
   * writes both and the two sentences reach different bodies.
   *
   * A second field rather than a mode on the first, because both are live at
   * once on the same board and a card already written against the union must
   * keep meaning what it prints (`mtg-nhyv.2`).
   */
  readonly allCardTypes: readonly CardKind[] | null;
  /**
   * Card types this filter refuses, which is not the same question as leaving
   * `cardTypes` open.
   *
   * "Target noncreature permanent" (Bramblecrush) has no positive list at all,
   * and expressing it as a positive list of the other five card types would be
   * a card that stops meaning what it says the day a sixth card type is added.
   * The exclusions are checked with `none of`, mirroring `excludeOids` one
   * field up, and the two exclusion fields are the only ones a DSL
   * `TargetFilter` reaches beyond the positive ones (`mtg-6y4g`).
   */
  readonly excludeCardTypes: readonly CardKind[] | null;
  readonly subtypes: readonly string[] | null;
  readonly supertypes: readonly Supertype[] | null;
  readonly colors: readonly Color[] | null;
  /**
   * Colors this filter refuses, for `excludeCardTypes`' reason one field up and
   * with a printed card behind it: Doom Blade reads "destroy target nonblack
   * creature", and the positive spelling of that is a four-color list that also
   * silently admits a colorless creature or refuses one depending on which way
   * it was written. "Not black" is one word on the card and one word here.
   */
  readonly excludeColors: readonly Color[] | null;
  readonly keywords: readonly Keyword[] | null;
  readonly controller: PlayerId | null;
  /**
   * `true` when `controller` should be resolved live, at application time, to
   * whoever currently controls the effect's own source — rather than the fixed
   * `PlayerId` `controller` otherwise names.
   *
   * A lord's "creatures you control" means the caster's board on the turn the
   * lord was printed and the *current* controller's board after a control-
   * change effect (layer 2) moves the lord itself. Baking a `PlayerId` in at
   * registration time answers the first question and gets the second one wrong
   * forever, because nothing re-derives it when layer 2 changes who "you" is.
   * `characteristics.ts`'s `affectedByEffect` is the one reader: when this is
   * `true` it looks up the source's live controller and ignores `controller`
   * entirely (which stays `null` on a filter built this way, so the two fields
   * are never both meaningful at once).
   */
  readonly controllerIsSource: boolean;
}

/** Matches every permanent on the battlefield. */
export const ANY_PERMANENT: ObjectFilter = {
  oids: null,
  excludeOids: null,
  cardTypes: null,
  allCardTypes: null,
  excludeCardTypes: null,
  subtypes: null,
  supertypes: null,
  colors: null,
  excludeColors: null,
  keywords: null,
  controller: null,
  controllerIsSource: false,
};

/** An `ObjectFilter` with the unmentioned fields left as "don't care". */
export function objectFilter(patch: Partial<ObjectFilter>): ObjectFilter {
  return { ...ANY_PERMANENT, ...patch };
}

/** The filter a single-target effect (`pumpUntilEndOfTurn`) uses. */
export function onlyObject(oid: ObjectId): ObjectFilter {
  return objectFilter({ oids: [oid] });
}

/**
 * Effects pinned to one permanent, dropped when that permanent leaves.
 *
 * `effectsRegisteredBy`'s mirror across the two fields that differ: it matches
 * `sourceOid` and the two source-lifetime durations, this matches `affects.oids`
 * and the subject-lifetime one. Both are read by `moveObject` and by nothing
 * else, because a zone change is the only event either lifetime ends on.
 *
 * The match is on the *whole* of `affects.oids` being this one object, not on
 * membership, and the strictness is the honest half. CR 609.2 froze the
 * membership of a group when the effect started, so a grant written over two
 * creatures ends for the one that died and keeps running for the one that did
 * not — which is a narrowing of the record, not a removal of it, and this sweep
 * removes. Nothing in this kernel constructs a multi-subject pinned grant, so
 * the case does not arise; a card that needs one has to teach `moveObject` to
 * rewrite `affects.oids` rather than widen this predicate.
 */
export function effectsPinnedTo(
  effects: readonly ContinuousEffect[],
  subject: ObjectId,
): readonly ContinuousEffect[] {
  return effects.filter(
    (effect) =>
      effect.duration === 'whileSubjectRemains' &&
      effect.affects.oids !== null &&
      effect.affects.oids.length === 1 &&
      effect.affects.oids[0] === subject,
  );
}

interface EffectCommon {
  readonly id: string;
  readonly timestamp: number;
  readonly sourceOid: ObjectId;
  readonly duration: EffectDuration;
  readonly affects: ObjectFilter;
  /**
   * CR 611.2c: `null` for an unconditional effect, which is every effect
   * written before this field existed and every effect in this file's ten
   * kernel-level test builders (`continuous-helpers.ts` defaults it to
   * `null`). A non-null condition gates whether the effect applies *at all* —
   * `characteristics.ts`'s `affectedByEffect` is the one place that reads it,
   * so `applyEffect`, the CR 613 layer walk and the CR 613.8 dependency pass
   * all see the same disabled-or-not answer for the same reason `affects`
   * itself has one reader.
   */
  readonly enabledWhile: Condition | null;
}

/** Layer 1 (CR 613.1a): the object's copiable values become another's. */
export interface CopyEffect extends EffectCommon {
  readonly kind: 'copy';
  readonly layer: '1';
  readonly copyOf: ObjectId;
}

/** Layer 2 (CR 613.1b): control change. */
export interface ControlEffect extends EffectCommon {
  readonly kind: 'control';
  readonly layer: '2';
  readonly controller: PlayerId;
}

/**
 * Layer 3 (CR 613.1c): text change. The slice's text-changing vocabulary is
 * subtype substitution, which is what the real cards in this layer
 * (Sleight of Mind, Mind Bend) do to a permanent's printed type line.
 */
export interface TextChangeEffect extends EffectCommon {
  readonly kind: 'textChange';
  readonly layer: '3';
  readonly fromSubtype: string;
  readonly toSubtype: string;
}

/** Layer 4 (CR 613.1d): card types, subtypes and supertypes. */
export interface TypeChangeEffect extends EffectCommon {
  readonly kind: 'typeChange';
  readonly layer: '4';
  readonly addTypes: readonly CardKind[];
  readonly removeTypes: readonly CardKind[];
  readonly addSubtypes: readonly string[];
  /** CR 205.1a: an effect that sets a type line usually wipes the old subtypes. */
  readonly removeAllSubtypes: boolean;
}

/** Layer 5 (CR 613.1e): color. `setColors` overrides; `addColors` unions. */
export interface ColorChangeEffect extends EffectCommon {
  readonly kind: 'colorChange';
  readonly layer: '5';
  readonly setColors: readonly Color[] | null;
  readonly addColors: readonly Color[];
}

/** Layer 6 (CR 613.1f): abilities added or removed. */
export interface AbilityChangeEffect extends EffectCommon {
  readonly kind: 'abilityChange';
  readonly layer: '6';
  readonly addKeywords: readonly Keyword[];
  readonly removeKeywords: readonly Keyword[];
  /**
   * The other half of layer 6: keyword *abilities* granted.
   *
   * A list of `KeywordAbility` records rather than the `addLandwalk?:
   * BasicLandType[]` this used to be. That field existed because an Aura could
   * grant basic landwalk and nothing else could grant any of the six; once a
   * printed static can grant indestructible (`mtg-nhyv.74`) the narrow field
   * would have needed a sibling, and two fields for one CR 613.1f concept is
   * two places for a reader to forget one. Landwalk still rides here — it is
   * the one member that carries a payload, and a record holds it where an enum
   * could not.
   *
   * Required rather than optional, unlike the field it replaces: every layer-6
   * record in this kernel is built by one of five call sites, all of which now
   * say which half they are filling, and an absent list would let a sixth
   * silently grant nothing.
   */
  readonly addKeywordAbilities: readonly KeywordAbility[];
  /** "Loses all abilities" — applied before `addKeywords` of the same effect. */
  readonly removeAll: boolean;
}

/** Layer 7a's count reads the battlefield: a filtered permanent tally (a star/star Zombie lord). */
export interface BattlefieldCount {
  readonly kind: 'battlefield';
  readonly filter: ObjectFilter;
}

/**
 * Layer 7a's count reads a graveyard instead: the *distinct* card types among
 * the cards there (CR 613.4a's own example, Tarmogoyf).
 *
 * A distinct-value count is a different shape of arithmetic from
 * `BattlefieldCount`'s tally — "how many creature, instant and sorcery cards
 * are here" is 1 for a graveyard of three Lightning Bolts and 3 for a
 * graveyard of one Bolt, one Bear and one Divination — so it is its own union
 * member rather than a filter `characteristics.ts` could reuse
 * `selectMatching`'s counting logic for. `whose` is `'each'` for the printed
 * card's "all graveyards"; a single `PlayerId` is here for the CDA shapes CR
 * 613.4a allows and this slice does not yet construct.
 */
export interface GraveyardCardTypesCount {
  readonly kind: 'graveyardCardTypes';
  readonly whose: PlayerId | 'each';
}

/**
 * Layer 7a's count reads the battlefield and then reads the *counters* on what
 * it found — "the number of creatures you control with a … counter on them",
 * `@mtg/dsl`'s `countWithCounter`. Which counters is data the card carries and
 * not a name this file knows, the way no kind is named anywhere in the layer
 * walk (`counters.test.ts` asserts it of the walk's two files).
 *
 * Its own member rather than an optional field on `BattlefieldCount`, and its
 * own field rather than an axis on `ObjectFilter`, for two reasons that point
 * the same way. An `ObjectFilter` is answered by `matchesFilter`, which is a
 * pure function of `Characteristics`, and counters are deliberately not
 * characteristics — layer 7d derives P/T *from* them, so a filter that asked
 * the characteristic map for a counter would be asking the output for its own
 * input. And `BattlefieldCount` is what `ptDefine` counts with too, where a
 * counter narrowing has no card asking for it and would be a field the CDA arm
 * carries and never reads.
 *
 * So the shape says outright that it is answered in two pieces against two
 * sources: `filter` against the characteristic map, `counters` against
 * `state.objects`, exactly as `conditionHolds`'s `anyCreatureHasCounter` arm
 * already does. A permanent carrying two of the named counters is counted once
 * — this is a tally of permanents, not of counters — and the list is read as
 * "any of", never "all of".
 */
export interface BattlefieldWithCountersCount {
  readonly kind: 'battlefieldWithCounters';
  readonly filter: ObjectFilter;
  readonly counters: readonly CounterKind[];
}

/** What a CDA's P/T reads a live count from. `characteristics.ts`'s `applyPtDefine` resolves every arm. */
export type PtCount = BattlefieldCount | GraveyardCardTypesCount | BattlefieldWithCountersCount;

/**
 * Layer 7a (CR 613.4a): a characteristic-defining ability that sets P/T from a
 * live count (a star/star creature whose stats equal the number of Zombies you
 * control, or Tarmogoyf's card-type count over every graveyard).
 *
 * CDAs are singled out in CR 613.8a: a CDA never depends on a non-CDA and vice
 * versa, which `dependency.ts` enforces.
 */
export interface PtDefiningEffect extends EffectCommon {
  readonly kind: 'ptDefine';
  readonly layer: '7a';
  readonly countOf: PtCount;
  readonly powerOffset: number;
  readonly toughnessOffset: number;
}

/** Layer 7b (CR 613.4b): P/T set to specific values. */
export interface PtSetEffect extends EffectCommon {
  readonly kind: 'ptSet';
  readonly layer: '7b';
  readonly power: number;
  readonly toughness: number;
}

/** Layer 7c (CR 613.4c): P/T modified without being set. The DSL's pump. */
export interface PtModEffect extends EffectCommon {
  readonly kind: 'ptMod';
  readonly layer: '7c';
  readonly power: number;
  readonly toughness: number;
}

/**
 * Layer 7c (CR 613.4c) with a live count: P/T modified by a *rate* times a
 * battlefield tally, re-read on every walk.
 *
 * `PtModEffect`'s two fixed numbers cannot express Earth Servant's "+0/+1 for
 * each Mountain you control", and giving that effect an optional `countOf`
 * would have made every existing layer-7c record a possible live count — the
 * reader would have to check a field to learn whether the numbers it is
 * holding are a total or a rate. A separate kind answers that from the
 * discriminant, which is the same argument `@mtg/dsl`'s `amount.ts` header
 * makes one layer up about the DSL records these compile from.
 *
 * Not a CDA. `isCharacteristicDefining` stays `ptDefine`-only, because CR
 * 613.4a is about a *defining* value and this modifies one that layer 7b may
 * already have set — which is exactly why it sits in 7c beside the pump rather
 * than in 7a beside Tarmogoyf, even though both read a count.
 */
export interface PtScaledModEffect extends EffectCommon {
  readonly kind: 'ptScaledMod';
  readonly layer: '7c';
  /** The per-unit bonus. Multiplied by `countOf`, never used on its own. */
  readonly power: number;
  readonly toughness: number;
  readonly countOf: PtCount;
}

/** Layer 7e (CR 613.4e): P/T switched. */
export interface PtSwitchEffect extends EffectCommon {
  readonly kind: 'ptSwitch';
  readonly layer: '7e';
}

export type ContinuousEffect =
  | CopyEffect
  | ControlEffect
  | TextChangeEffect
  | TypeChangeEffect
  | ColorChangeEffect
  | AbilityChangeEffect
  | PtDefiningEffect
  | PtSetEffect
  | PtModEffect
  | PtScaledModEffect
  | PtSwitchEffect;

/** CR 613.8a treats characteristic-defining abilities as their own class. */
export function isCharacteristicDefining(effect: ContinuousEffect): boolean {
  return effect.kind === 'ptDefine';
}

/**
 * How many of each kind of counter a permanent carries.
 *
 * Which kinds exist, and what each one *does*, is `@mtg/dsl`'s
 * `COUNTER_DECLARATIONS` — this module holds the tally and nothing about
 * meaning. Two kinds are named as required fields because they are the two the
 * event stream reports (`countersChanged` carries both totals) and the two CR
 * 704.5q pairs off; every other kind is an optional field that is absent when
 * the count is zero, which is what keeps a state written before a kind existed
 * byte-identical after it.
 */
export interface Counters extends Readonly<Partial<Record<CounterKind, number>>> {
  readonly plusOnePlusOne: number;
  readonly minusOneMinusOne: number;
}

export const NO_COUNTERS: Counters = { plusOnePlusOne: 0, minusOneMinusOne: 0 };

/** How many counters of one kind a permanent carries; absent means none. */
export function counterCount(current: Counters, kind: CounterKind): number {
  return current[kind] ?? 0;
}

export function addCounters(current: Counters, kind: CounterKind, count: number): Counters {
  return { ...current, [kind]: counterCount(current, kind) + count };
}

/** Writes one counter tally, omitting optional zero-valued kinds. */
export function setCounterCount(current: Counters, kind: CounterKind, count: number): Counters {
  const next = Math.max(0, count);
  if (kind === 'plusOnePlusOne' || kind === 'minusOneMinusOne' || next !== 0) {
    return { ...current, [kind]: next };
  }
  const copy: Partial<Record<CounterKind, number>> = { ...current };
  delete copy[kind];
  return copy as Counters;
}

/**
 * CR 704.5q: +1/+1 and -1/-1 counters on the same permanent annihilate.
 *
 * Named kinds and not a sweep over the declarations on purpose: 704.5q is a
 * rule about that one pair, not a property counters have. A part counter and a
 * -1/-1 counter do not cancel, and a rule written over the table would say they
 * did the moment a part declared a negative stat bonus.
 */
export function annihilateCounters(current: Counters): Counters {
  const removed = Math.min(current.plusOnePlusOne, current.minusOneMinusOne);
  if (removed === 0) return current;
  return {
    ...current,
    plusOnePlusOne: current.plusOnePlusOne - removed,
    minusOneMinusOne: current.minusOneMinusOne - removed,
  };
}

export function hasCounters(current: Counters): boolean {
  return COUNTER_KINDS.some((kind) => counterCount(current, kind) !== 0);
}

/**
 * Layer 7d (CR 613.4d): the P/T change a permanent's counters add up to.
 *
 * Every kind's `statBonus` declaration, multiplied by how many are on the
 * permanent. `plusOnePlusOne` and `minusOneMinusOne` reach this sum the same
 * way a part does, so the old `plus - minus` subtraction is a consequence of the
 * table rather than a rule of its own.
 */
export function counterStatDelta(current: Counters): { readonly power: number; readonly toughness: number } {
  let power = 0;
  let toughness = 0;
  for (const kind of COUNTER_KINDS) {
    const count = counterCount(current, kind);
    if (count === 0) continue;
    const bonus = counterStatBonus(kind);
    power += bonus.power * count;
    toughness += bonus.toughness * count;
  }
  return { power, toughness };
}

/**
 * Layer 6 (CR 613.1f): the keywords a permanent's counters grant.
 *
 * A counter grants its keyword once however many are on the permanent, which is
 * why this unions rather than sums. Deliberately not layer 7d: the stat half of
 * the same declaration lands there, and a declaration that mixes the two
 * reaches both layers from one entry.
 */
export function counterKeywords(current: Counters): readonly Keyword[] {
  const granted: Keyword[] = [];
  for (const kind of COUNTER_KINDS) {
    if (counterCount(current, kind) === 0) continue;
    for (const keyword of counterGrantedKeywords(kind)) {
      if (!granted.includes(keyword)) granted.push(keyword);
    }
  }
  return granted;
}

export type { CounterKind };
