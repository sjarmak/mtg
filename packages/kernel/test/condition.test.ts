/**
 * CR 611.2c: the `Condition` predicate, evaluated directly against a
 * `LayerContext` rather than through a cast card.
 *
 * `static-abilities.test.ts` proves a DSL card can *print* `enabledWhile` and
 * that the effect it registers is gated end to end; this file is the unit
 * layer underneath that: `conditionHolds` and `affectedByEffect` in isolation,
 * plus one CR 613.8 regression proving a condition's truth value is a real
 * same-layer dependency, not a check the dependency pass happens to miss.
 */
import { describe, expect, it } from 'vitest';
import type { Condition } from '@mtg/dsl';
import type { ContinuousEffect, GameState, LayerContext } from '@mtg/kernel';
import {
  affectedByEffect,
  characteristicsOf,
  conditionHolds,
  dependencyGraph,
  objectFilter,
  orderLayer,
  printedCharacteristics,
  scenario,
  setCounterCount,
  timestampOrder,
} from '@mtg/kernel';
import { artifact, creature } from './cards';
import { oidOf } from './helpers';
import { onlyObject, pump, retype, withContinuous, withCounters, withSubtype } from './continuous-helpers';

const MERFOLK_ONE = creature('Cond Merfolk One', 2, 2, { subtypes: ['Merfolk'] });
const MERFOLK_TWO = creature('Cond Merfolk Two', 2, 2, { subtypes: ['Merfolk'] });
const BEAR = creature('Cond Bear', 2, 2, { subtypes: ['Bear'] });
const OPPONENT_HUMAN = creature('Cond Opposing Human', 2, 2, { subtypes: ['Human'] });
const RELIC = artifact('Cond Relic');

function board(): GameState {
  return scenario({
    battlefield: [
      { card: MERFOLK_ONE, controller: 0 },
      { card: MERFOLK_TWO, controller: 0 },
      { card: BEAR, controller: 0 },
      { card: OPPONENT_HUMAN, controller: 1 },
    ],
  }).state;
}

/** `board()` plus a noncreature permanent, for the "creatures only" claim. */
function boardWithRelic(): GameState {
  return scenario({
    battlefield: [
      { card: MERFOLK_ONE, controller: 0 },
      { card: MERFOLK_TWO, controller: 0 },
      { card: BEAR, controller: 0 },
      { card: OPPONENT_HUMAN, controller: 1 },
      { card: RELIC, controller: 1 },
    ],
  }).state;
}

/** The layer's starting board: printed characteristics, nothing applied yet. */
function contextFor(state: GameState): LayerContext {
  return {
    state,
    battlefield: state.battlefield,
    map: new Map(
      state.battlefield.map((oid) => {
        const object = state.objects[oid];
        if (object === undefined) throw new Error(`missing object ${oid}`);
        return [oid, printedCharacteristics(object)];
      }),
    ),
  };
}

function idsOf(effects: readonly ContinuousEffect[]): readonly string[] {
  return effects.map((effect) => effect.id);
}

const TWO_MERFOLK: Condition = { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 2 };
const ANY_GLOOM: Condition = { kind: 'anyCreatureHasCounter', counter: 'gloom' };
const THEIR_THREE: Condition = { kind: 'opponentGraveyardAtLeast', atLeast: 3 };

/** `board()` with a stated number of cards in each seat's graveyard. */
function boardWithGraveyards(mine: number, theirs: number): GameState {
  return scenario({
    battlefield: [
      { card: MERFOLK_ONE, controller: 0 },
      { card: OPPONENT_HUMAN, controller: 1 },
    ],
    graveyards: [
      Array.from({ length: mine }, (_, index) => creature(`Cond Mine ${String(index)}`, 1, 1)),
      Array.from({ length: theirs }, (_, index) => creature(`Cond Theirs ${String(index)}`, 1, 1)),
    ],
  }).state;
}

describe('conditionHolds (CR 611.2c)', () => {
  it("holds when the source's controller controls at least the threshold", () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, TWO_MERFOLK, source)).toBe(true);
  });

  it('does not hold below the threshold', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, { ...TWO_MERFOLK, atLeast: 3 }, source)).toBe(false);
  });

  it("is asked from the perspective of the source's own controller, not a global count", () => {
    // Both Merfolk belong to player 0. Player 1's own source (the Human)
    // controls none, so the same condition fails from that perspective even
    // though two Merfolk exist on the board.
    const context = contextFor(board());
    const humanSource = oidOf(context.state, 'Cond Opposing Human');
    expect(conditionHolds(context, TWO_MERFOLK, humanSource)).toBe(false);
  });

  it('answers false rather than throwing for a source missing from the map', () => {
    const context = contextFor(board());
    expect(conditionHolds(context, TWO_MERFOLK, 'no-such-object')).toBe(false);
  });
});

/**
 * `mtg-jp23`: `anyCreatureHasCounter` reads raw `GameObject.counters` off
 * `context.state` directly (bypassing `context.map`'s derived characteristics,
 * for the reason `characteristics.ts`'s `conditionHolds` docblock argues: a
 * counter's own stat bonus is applied in layer 7d, so reading the derived map
 * back would make this condition circular with the layer it can gate). Every
 * `board()` creature starts with no counters, so `withCounters` (the same
 * helper `continuous-helpers.ts` documents as "puts counters on a permanent
 * directly, the way a resolved effect would") is both how a counter appears
 * and, via `setCounterCount` back to zero, how one leaves.
 */
/**
 * `mtg-nhyv.28`: the first condition that reads a zone rather than the
 * battlefield. The counting is trivial and the *seat* is the whole claim, so
 * every run below stocks the two graveyards unequally: a board where both hold
 * the same number cannot tell a kernel counting the opponent's from one
 * counting the source controller's, or from one counting both.
 */
describe('conditionHolds (CR 611.2c): opponentGraveyardAtLeast', () => {
  it('holds once the opposing graveyard reaches the floor', () => {
    const context = contextFor(boardWithGraveyards(0, 3));
    expect(conditionHolds(context, THEIR_THREE, oidOf(context.state, 'Cond Merfolk One'))).toBe(true);
  });

  it('does not hold one card short of it', () => {
    const context = contextFor(boardWithGraveyards(0, 2));
    expect(conditionHolds(context, THEIR_THREE, oidOf(context.state, 'Cond Merfolk One'))).toBe(false);
  });

  it('counts the other seat graveyard rather than the source controller own', () => {
    // Six cards in the asking player's own graveyard and none in the
    // opponent's: a kernel reading the wrong seat, or reading both, says true.
    const context = contextFor(boardWithGraveyards(6, 0));
    expect(conditionHolds(context, THEIR_THREE, oidOf(context.state, 'Cond Merfolk One'))).toBe(false);
  });

  it('is asked from the perspective of whoever controls the source', () => {
    const context = contextFor(boardWithGraveyards(6, 0));
    // The same board and the same condition, asked from the other seat's
    // permanent: what was that player's own graveyard is now the opponent's.
    expect(conditionHolds(context, THEIR_THREE, oidOf(context.state, 'Cond Opposing Human'))).toBe(true);
  });

  it('answers false rather than throwing for a source missing from the map', () => {
    const context = contextFor(boardWithGraveyards(0, 6));
    expect(conditionHolds(context, THEIR_THREE, 'no-such-object')).toBe(false);
  });
});

describe('conditionHolds (CR 611.2c): anyCreatureHasCounter', () => {
  it('does not hold when no creature carries the counter', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, ANY_GLOOM, source)).toBe(false);
  });

  it('holds once any creature carries the counter, regardless of controller', () => {
    const state = board();
    const opponentHuman = oidOf(state, 'Cond Opposing Human');
    const withGloom = withCounters(state, opponentHuman, 'gloom', 1);
    const context = contextFor(withGloom);
    // Asked from player 0's own source, not the counter-carrier's controller:
    // the scope is the whole battlefield, unlike controlsSubtype's per-source one.
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, ANY_GLOOM, source)).toBe(true);
  });

  it('stops holding once the counter leaves', () => {
    const state = board();
    const opponentHuman = oidOf(state, 'Cond Opposing Human');
    const withGloom = withCounters(state, opponentHuman, 'gloom', 1);
    const object = withGloom.objects[opponentHuman];
    if (object === undefined) throw new Error('missing object');
    const gloomGone: GameState = {
      ...withGloom,
      objects: {
        ...withGloom.objects,
        [opponentHuman]: { ...object, counters: setCounterCount(object.counters, 'gloom', 0) },
      },
    };
    const context = contextFor(gloomGone);
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, ANY_GLOOM, source)).toBe(false);
  });

  it('ignores a counter on a noncreature permanent', () => {
    const state = boardWithRelic();
    const relic = oidOf(state, 'Cond Relic');
    const withGloom = withCounters(state, relic, 'gloom', 1);
    const context = contextFor(withGloom);
    const source = oidOf(context.state, 'Cond Merfolk One');
    expect(conditionHolds(context, ANY_GLOOM, source)).toBe(false);
  });
});

describe('affectedByEffect: enabledWhile gates a continuous effect (CR 611.2c)', () => {
  it('behaves exactly like selectMatching when enabledWhile is null', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    const effect = pump(objectFilter({ cardTypes: ['creature'] }), 1, 1, { source });
    expect(affectedByEffect(context, effect).length).toBe(4);
  });

  it('matches nobody when its condition does not hold, like an empty filter', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    const effect = pump(objectFilter({ cardTypes: ['creature'] }), 1, 1, {
      source,
      enabledWhile: { ...TWO_MERFOLK, atLeast: 5 },
    });
    expect(affectedByEffect(context, effect)).toEqual([]);
  });

  it('matches its filter once the condition holds', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    const effect = pump(withSubtype('Merfolk'), 1, 1, { source, enabledWhile: TWO_MERFOLK });
    const affected = affectedByEffect(context, effect);
    expect(affected).toContain(oidOf(context.state, 'Cond Merfolk One'));
    expect(affected).toContain(oidOf(context.state, 'Cond Merfolk Two'));
    expect(affected.length).toBe(2);
  });
});

/**
 * The end-to-end claim `mtg-jp23` asked for: a static gated on
 * `anyCreatureHasCounter` turns on when the counter appears anywhere on the
 * battlefield and off again once it leaves — the same board, two states,
 * through the one function a real layer walk calls.
 */
describe('affectedByEffect: enabledWhile turns on and off with anyCreatureHasCounter (CR 611.2c)', () => {
  it('matches nobody before any creature carries the counter', () => {
    const context = contextFor(board());
    const source = oidOf(context.state, 'Cond Merfolk One');
    const effect = pump(objectFilter({ cardTypes: ['creature'] }), 1, 1, {
      source,
      enabledWhile: ANY_GLOOM,
    });
    expect(affectedByEffect(context, effect)).toEqual([]);
  });

  it('matches every creature once one carries the counter, and stops once it leaves', () => {
    const state = board();
    const opponentHuman = oidOf(state, 'Cond Opposing Human');
    const source = oidOf(state, 'Cond Merfolk One');
    const effect = pump(objectFilter({ cardTypes: ['creature'] }), 1, 1, {
      source,
      enabledWhile: ANY_GLOOM,
    });

    const withGloom = withCounters(state, opponentHuman, 'gloom', 1);
    expect(affectedByEffect(contextFor(withGloom), effect).length).toBe(4);

    const object = withGloom.objects[opponentHuman];
    if (object === undefined) throw new Error('missing object');
    const gloomGone: GameState = {
      ...withGloom,
      objects: {
        ...withGloom.objects,
        [opponentHuman]: { ...object, counters: setCounterCount(object.counters, 'gloom', 0) },
      },
    };
    expect(affectedByEffect(contextFor(gloomGone), effect)).toEqual([]);
  });
});

describe('CR 613.8: a condition another same-layer effect flips is a real dependency', () => {
  /**
   * A (timestamp 1, layer 4, conditional): the Bear also becomes a Construct,
   * but only as long as its controller controls 3+ Merfolk. Two real Merfolk plus
   * the Bear itself, once B makes it one too, clears that bar.
   * B (timestamp 2, layer 4): the Bear becomes a Merfolk.
   *
   * Applying B first is what turns A's condition true, so A depends on B and
   * B must go first even though its timestamp is later — the same shape as
   * `layers-dependency.test.ts`'s subtype-chaining case, except here what
   * changes is not the filter A matches but *whether A applies at all*.
   * Pure timestamp order (A, then B) would leave A evaluating against a board
   * that only has two Merfolk, so the Bear would end up a Merfolk but never a
   * Construct.
   */
  it('applies the subtype grant before the conditional effect it unlocks', () => {
    const state = board();
    const bear = oidOf(state, 'Cond Bear');
    const grantsConstructWhileThreeMerfolk = retype(
      onlyObject(bear),
      { addSubtypes: ['Construct'] },
      {
        id: 'A',
        ts: 1,
        source: bear,
        enabledWhile: { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 },
      },
    );
    const bearBecomesMerfolk = retype(onlyObject(bear), { addSubtypes: ['Merfolk'] }, { id: 'B', ts: 2 });

    const context = contextFor(state);
    expect(idsOf(timestampOrder([grantsConstructWhileThreeMerfolk, bearBecomesMerfolk]))).toEqual(['A', 'B']);

    const graph = dependencyGraph(context, [grantsConstructWhileThreeMerfolk, bearBecomesMerfolk]);
    expect(graph.get('A')).toEqual(['B']);
    expect(graph.get('B')).toEqual([]);
    expect(idsOf(orderLayer(context, [grantsConstructWhileThreeMerfolk, bearBecomesMerfolk]))).toEqual([
      'B',
      'A',
    ]);

    const withEffects = withContinuous(state, [grantsConstructWhileThreeMerfolk, bearBecomesMerfolk]);
    expect(characteristicsOf(withEffects, bear).subtypes).toEqual(['Bear', 'Merfolk', 'Construct']);
  });

  it('leaves the conditional effect inert without the subtype grant', () => {
    const state = board();
    const bear = oidOf(state, 'Cond Bear');
    const grantsConstructWhileThreeMerfolk = retype(
      onlyObject(bear),
      { addSubtypes: ['Construct'] },
      { id: 'A', source: bear, enabledWhile: { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 } },
    );
    const withEffect = withContinuous(state, [grantsConstructWhileThreeMerfolk]);
    expect(characteristicsOf(withEffect, bear).subtypes).toEqual(['Bear']);
  });
});
