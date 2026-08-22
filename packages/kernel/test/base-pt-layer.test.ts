/**
 * `setBasePtUntilEndOfTurn`: CR 613.4b, layer 7b, for one turn.
 *
 * The single-effect case is the least interesting thing in this file. A DSL
 * effect that turned a 5/5 into a 1/1 could be spelled as a layer-7c `-4/-4`
 * and pass any test that only ever looks at one creature with one effect on
 * it, so the claims here are all about what happens when a *second* effect
 * touches the same creature:
 *
 *  1. The record the compiler writes is a `ptSet` in layer 7b, not a `ptMod`.
 *  2. A set and a pump on one creature read the same board whichever order
 *     they resolved in, because CR 613.4 applies them by layer rather than by
 *     timestamp. This is the assertion the bead is about.
 *  3. A +1/+1 counter (layer 7d) survives the set, and applies after it.
 *  4. A `statBonusPer` static (layer 7c) survives the set, and applies after
 *     it.
 *  5. It is gone next turn.
 *
 * And one refutation, which is the reason this file is worth its length: every
 * board above is measured a second time against the record a wrong compiler
 * arm would have written -- a `ptMod` carrying the same two numbers -- and the
 * two disagree. A layer claim with no such measurement is an assertion.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  eventsOfType,
  onlyObject,
  pendingDecision,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { artifact, creature, instant, MOUNTAIN } from './cards';
import { pump, withContinuous, withCounters } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

/** Diminish (M11), in the DSL: the one card this effect kind was built for. */
const SHRINK: Card = instant('Test Shrink', [
  { kind: 'setBasePtUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
]);

/** Giant Growth's shape at +2/+2: the layer-7c half of every claim below. */
const GROWTH: Card = instant('Test Growth', [
  { kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } },
]);

/** "Creatures you control get +1/+1 for each Mountain you control." */
const RACK_STATIC: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  modification: {
    kind: 'statBonusPer',
    power: 1,
    toughness: 1,
    each: { kind: 'landsWithSubtype', subtype: 'Mountain', whose: 'you' },
  },
};

const RACK = artifact('Test Rack', { generic: 2 }, [RACK_STATIC]);

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function lands(count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

/** Casts an instant from player 0's hand and resolves it. */
function castAndResolve(start: ReduceResult, name: string, targets: readonly unknown[]): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: targets as never,
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

/** Idles forward, `grant-keyword-until-end-of-turn.test.ts`'s helper verbatim. */
function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${turn}`);
}

interface Board {
  readonly power: number;
  readonly toughness: number;
}

function statsOf(state: GameState, oid: ObjectId): Board {
  return { power: powerOf(state, oid), toughness: toughnessOf(state, oid) };
}

/**
 * A 5/5 on player 0's board with both spells in hand and enough Mountains to
 * cast them, plus whatever else the caller names.
 */
function giantAt(
  extra: readonly { card: Card; controller: 0 | 1 }[] = [],
  landCount = 2,
): { start: ReduceResult; giant: ObjectId } {
  const start = scenario({
    battlefield: [{ card: creature('Test Giant', 5, 5), controller: 0 }, ...extra, ...lands(landCount, 0)],
    hands: [[SHRINK, GROWTH], []],
  });
  return { start, giant: oidOf(start.state, 'Test Giant') };
}

/**
 * The board the wrong compiler arm would have produced: the same two numerals
 * written as a layer-7c modification instead of a layer-7b set, dropped
 * straight onto the state so no other part of the pipeline can quietly correct
 * it.
 */
function asIfModified(state: GameState, oid: ObjectId, power: number, toughness: number): GameState {
  return withContinuous(state, [pump(onlyObject(oid), power, toughness)]);
}

describe('the record the compiler writes', () => {
  it('is a ptSet in layer 7b, lasting until end of turn', () => {
    const { start, giant } = giantAt();

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);

    const written = done.state.continuous.filter((effect) => effect.kind === 'ptSet');
    expect(written).toHaveLength(1);
    expect(written[0]?.layer).toBe('7b');
    expect(written[0]?.duration).toBe('endOfTurn');
    expect(done.state.continuous.some((effect) => effect.kind === 'ptMod')).toBe(false);
    expect(statsOf(done.state, giant)).toEqual({ power: 1, toughness: 1 });
  });

  it('reports the set once, naming the layer, so the log can say what happened', () => {
    const { start, giant } = giantAt();

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);

    const added = eventsOfType(done.events, 'continuousEffectAdded');
    expect(added).toHaveLength(1);
    expect(added[0]?.targetOid).toBe(giant);
    expect(added[0]?.layer).toBe('7b');
    expect(added[0]?.power).toBe(1);
    expect(added[0]?.toughness).toBe(1);
  });

  /**
   * The refutation for the single-effect case, and the weakest of the three in
   * this file: `1/1` written as a delta is `+1/+1`, so the boards differ by
   * six points and any test at all would have caught it. The two below are the
   * ones that need the layer walk to tell them apart.
   */
  it('differs from the same numbers written as a layer-7c modification', () => {
    const { start, giant } = giantAt();

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);
    const wrong = asIfModified(start.state, giant, 1, 1);

    expect(statsOf(done.state, giant)).toEqual({ power: 1, toughness: 1 });
    expect(statsOf(wrong, giant)).toEqual({ power: 6, toughness: 6 });
  });
});

describe('a set and a pump on one creature', () => {
  /**
   * CR 613.4: layer 7b is applied before layer 7c whatever order the two
   * effects resolved in, so these two tests read the same board from two
   * different games. That equality is the whole bead.
   */
  it('reads 3/3 when the set resolved first', () => {
    const { start, giant } = giantAt();

    const shrunk = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);
    expect(statsOf(shrunk.state, giant)).toEqual({ power: 1, toughness: 1 });
    const pumped = castAndResolve(shrunk, 'Test Growth', [permanentNamed(shrunk.state, 'Test Giant')]);

    expect(statsOf(pumped.state, giant)).toEqual({ power: 3, toughness: 3 });
  });

  it('reads 3/3 when the pump resolved first', () => {
    const { start, giant } = giantAt();

    const pumped = castAndResolve(start, 'Test Growth', [permanentNamed(start.state, 'Test Giant')]);
    expect(statsOf(pumped.state, giant)).toEqual({ power: 7, toughness: 7 });
    const shrunk = castAndResolve(pumped, 'Test Shrink', [permanentNamed(pumped.state, 'Test Giant')]);

    expect(statsOf(shrunk.state, giant)).toEqual({ power: 3, toughness: 3 });
  });

  it('differs from the pump-plus-pump board the wrong arm would have produced', () => {
    const { start, giant } = giantAt();

    const shrunk = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);
    const pumped = castAndResolve(shrunk, 'Test Growth', [permanentNamed(shrunk.state, 'Test Giant')]);

    // The same game with the shrink written the wrong way: a 7c record on the
    // starting board, and then the real pump cast on top of it. Nothing sets
    // the base, so both modifications stack on the printed 5/5.
    const asDelta: ReduceResult = { state: asIfModified(start.state, giant, 1, 1), events: start.events };
    const wrong = castAndResolve(asDelta, 'Test Growth', [permanentNamed(asDelta.state, 'Test Giant')]);

    expect(statsOf(pumped.state, giant)).toEqual({ power: 3, toughness: 3 });
    expect(statsOf(wrong.state, giant)).toEqual({ power: 8, toughness: 8 });
  });
});

describe('what applies after the set', () => {
  /**
   * Layer 7d. A counter is not a modification the set overwrites -- it is
   * applied in its own later layer -- so a 5/5 wearing one is a 6/6 that
   * Diminish turns into a 2/2 rather than a 1/1.
   */
  it('a +1/+1 counter still counts, on top of the new base', () => {
    const { start, giant } = giantAt();
    const seeded: ReduceResult = {
      state: withCounters(start.state, giant, 'plusOnePlusOne', 1),
      events: start.events,
    };
    expect(statsOf(seeded.state, giant)).toEqual({ power: 6, toughness: 6 });

    const done = castAndResolve(seeded, 'Test Shrink', [permanentNamed(seeded.state, 'Test Giant')]);

    expect(statsOf(done.state, giant)).toEqual({ power: 2, toughness: 2 });
  });

  /**
   * Layer 7c, from a static rather than a resolved spell, and counting a board
   * rather than carrying a numeral. Three Mountains, so the rate is +3/+3 and
   * the arithmetic cannot be confused with the pump's +2/+2 above.
   */
  it('a statBonusPer static still counts, on top of the new base', () => {
    const { start, giant } = giantAt([{ card: RACK, controller: 0 }], 3);
    expect(statsOf(start.state, giant)).toEqual({ power: 8, toughness: 8 });

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);

    expect(statsOf(done.state, giant)).toEqual({ power: 4, toughness: 4 });
  });

  it('and the static board differs from the one the wrong arm would produce', () => {
    const { start, giant } = giantAt([{ card: RACK, controller: 0 }], 3);

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);
    const wrong = asIfModified(start.state, giant, 1, 1);

    expect(statsOf(done.state, giant)).toEqual({ power: 4, toughness: 4 });
    expect(statsOf(wrong, giant)).toEqual({ power: 9, toughness: 9 });
  });
});

describe('and the creature gets its printed stats back', () => {
  it('is a 5/5 again on the following turn', () => {
    const { start, giant } = giantAt();

    const done = castAndResolve(start, 'Test Shrink', [permanentNamed(start.state, 'Test Giant')]);
    expect(statsOf(done.state, giant)).toEqual({ power: 1, toughness: 1 });

    const later = passUntilTurn(done, done.state.turn.number + 1);

    expect(statsOf(later.state, giant)).toEqual({ power: 5, toughness: 5 });
    expect(later.state.continuous.some((effect) => effect.kind === 'ptSet')).toBe(false);
    expect(eventsOfType(later.events, 'continuousEffectsExpired').length).toBeGreaterThan(0);
  });
});
