/**
 * A counter placement that chooses nobody and reads a region of the board.
 *
 * `mtg-hfex` widened `putCounters` so "{T}: Put a +1/+1 counter on each artifact
 * you control" is writable (Steel Overseer, M11 214): a `noTarget` slot beside
 * the `permanentsYouControl` scope and the `scopeFilter` that says which bodies
 * in that region. The DSL half of that is asserted in
 * `packages/dsl/test/board-wide-counters.test.ts`; what is asserted here is that
 * the kernel *plays* it — the ability is offered, paid for, resolves, and the
 * counters land on exactly the permanents the region and the filter name.
 *
 * The filter is the half that had to be tested by playing rather than by
 * reading. `putCounters` carried `scope` without `scopeFilter`, so the schema
 * dropped the filter silently and the executor was passed `undefined` in its
 * place; a sweep asserted only on its beneficiaries would have passed on that
 * kernel, because "each artifact you control" and "each permanent you control"
 * agree about every artifact. **The land is the assertion that fails on the old
 * behavior**, and the opponent's artifact creature is the one that fails if the
 * region word is ignored too.
 *
 * **The printed line is here now** (`mtg-nhyv.2`). `cardTypes` is a union —
 * `matchesFilter` reads it with `anyOf` — so "each artifact you control" was as
 * near as this vocabulary came, and Copper Idol, a noncreature artifact, took a
 * counter the printed card would never give it. `allCardTypes` is the
 * conjunctive field, read with `every`, and Steel Overseer's own sentence is the
 * third sweep below: the same board, the same region, and Copper Idol left out
 * of it. The union sweep stays beside it as the control, because the two fields
 * ask opposite questions of the same dimension and a board where they agreed
 * would prove nothing.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import {
  eventsOfType,
  getObject,
  legalActions,
  opponentOf,
  pendingDecision,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { artifact, creature, FOREST } from './cards';
import { apply, oidOf } from './helpers';

/** The union reading: "each artifact you control", one word off the printing. */
const SWEEP: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['artifact'] },
      target: { kind: 'noTarget' },
    },
  ],
};

/** Steel Overseer's line exactly: one body that is both things at once. */
const ARTIFACT_CREATURE_SWEEP: AbilityInput = {
  ...SWEEP,
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { allCardTypes: ['artifact', 'creature'] },
      target: { kind: 'noTarget' },
    },
  ],
};

/** The same sweep narrowed to creatures, as the control on the filter. */
const CREATURE_SWEEP: AbilityInput = {
  ...SWEEP,
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
};

function overseer(ability: AbilityInput): Card {
  return creature('Forge Overseer', 1, 1, { cost: { generic: 2 }, artifact: true, abilities: [ability] });
}

const IRON_SENTINEL: Card = creature('Iron Sentinel', 2, 2, { cost: { generic: 3 }, artifact: true });
const COPPER_IDOL: Card = artifact('Copper Idol', { generic: 2 });
const MARSH_BEAR: Card = creature('Marsh Bear', 2, 2, { cost: { generic: 1, G: 1 } });
const ENEMY_AUTOMATON: Card = creature('Enemy Automaton', 3, 3, { cost: { generic: 4 }, artifact: true });

/**
 * One artifact creature, one bare artifact, one creature that is neither, one
 * land, and an artifact creature across the table. Every clause of the region
 * and the filter has a body that answers it and a body that does not.
 */
function board(ability: AbilityInput): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: overseer(ability), controller: 0 },
      { card: IRON_SENTINEL, controller: 0 },
      { card: COPPER_IDOL, controller: 0 },
      { card: MARSH_BEAR, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: ENEMY_AUTOMATON, controller: 1 },
    ],
    active: 0,
    turn: 4,
  });
  return { state: start.state, events: [...start.events] };
}

/** Activates the sweep and lets it resolve, through public actions only. */
function sweep(ability: AbilityInput): ReduceResult {
  const start = board(ability);
  const source = oidOf(start.state, 'Forge Overseer');
  const activated = apply(start, {
    type: 'activateAbility',
    player: 0,
    oid: source,
    abilityIndex: 0,
    targets: [null],
    sacrifices: [],
  });
  let current = activated;
  for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') break;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function countersOn(state: GameState, name: string): number {
  return getObject(state, oidOf(state, name)).counters.plusOnePlusOne;
}

function counterRecipients(current: ReduceResult): readonly ObjectId[] {
  return eventsOfType(current.events, 'countersChanged').map((event) => event.oid);
}

describe('a sweep that puts a counter on each permanent of a kind you control', () => {
  it('is offered as an activation that chooses nothing', () => {
    const start = board(SWEEP);
    const source = oidOf(start.state, 'Forge Overseer');
    const offered = legalActions(start.state).filter(
      (option) => option.type === 'activateAbility' && option.oid === source,
    );

    expect(offered).toEqual([
      { type: 'activateAbility', player: 0, oid: source, abilityIndex: 0, targets: [null], sacrifices: [] },
    ]);
  });

  it('lands a counter on every artifact its controller has and on nothing else', () => {
    const after = sweep(SWEEP);
    const state = after.state;

    expect(countersOn(state, 'Forge Overseer')).toBe(1);
    expect(countersOn(state, 'Iron Sentinel')).toBe(1);
    expect(countersOn(state, 'Copper Idol')).toBe(1);
    // The filter half: a land is a permanent this player controls, and the
    // sweep that ignored its filter put a counter on it.
    expect(countersOn(state, 'Forest')).toBe(0);
    expect(countersOn(state, 'Marsh Bear')).toBe(0);
    // The region half: an artifact creature the other player controls.
    expect(countersOn(state, 'Enemy Automaton')).toBe(0);
  });

  it('reports one counter change per permanent it reached', () => {
    const after = sweep(SWEEP);
    const state = after.state;

    expect(counterRecipients(after)).toEqual([
      oidOf(state, 'Forge Overseer'),
      oidOf(state, 'Iron Sentinel'),
      oidOf(state, 'Copper Idol'),
    ]);
  });

  /**
   * The printing, and the assertion that separates it from the union above:
   * Copper Idol is an artifact and is not a creature, so the conjunction leaves
   * it out where `cardTypes: ['artifact']` reached it. Marsh Bear is the mirror
   * on the other side — a creature that is not an artifact — and the enemy
   * artifact creature is the region half, unchanged.
   */
  it('reaches only the permanents that are every named type at once', () => {
    const after = sweep(ARTIFACT_CREATURE_SWEEP);
    const state = after.state;

    expect(countersOn(state, 'Forge Overseer')).toBe(1);
    expect(countersOn(state, 'Iron Sentinel')).toBe(1);
    expect(countersOn(state, 'Copper Idol')).toBe(0);
    expect(countersOn(state, 'Marsh Bear')).toBe(0);
    expect(countersOn(state, 'Forest')).toBe(0);
    expect(countersOn(state, 'Enemy Automaton')).toBe(0);
    expect(counterRecipients(after)).toEqual([oidOf(state, 'Forge Overseer'), oidOf(state, 'Iron Sentinel')]);
  });

  /**
   * The same board, the same region, one word of the filter changed: the
   * recipients move with it, which is what says the executor reads the filter
   * rather than the scope alone.
   */
  it('follows the filter to a different set of permanents on the same board', () => {
    const after = sweep(CREATURE_SWEEP);
    const state = after.state;

    expect(countersOn(state, 'Forge Overseer')).toBe(1);
    expect(countersOn(state, 'Iron Sentinel')).toBe(1);
    expect(countersOn(state, 'Marsh Bear')).toBe(1);
    expect(countersOn(state, 'Copper Idol')).toBe(0);
    expect(countersOn(state, 'Forest')).toBe(0);
    expect(countersOn(state, 'Enemy Automaton')).toBe(0);
  });
});

/**
 * `mtg-fz3s`: the attack trigger that shrinks a would-be blocker. The kind was
 * already derived and already narrowed by the kernel for `pumpUntilEndOfTurn`
 * (`packages/kernel/test/defending-player-target.test.ts`); what the widening
 * had to prove is that a counter placement reaches the same enumeration and
 * that the counter it places is the one the layers then read.
 */
describe('an attack trigger that puts a counter on a defending creature', () => {
  const REAPER: AbilityInput = {
    kind: 'triggered',
    condition: 'selfAttacks',
    effects: [
      {
        kind: 'putCounters',
        counter: 'minusOneMinusOne',
        count: 1,
        target: { kind: 'targetCreatureDefendingPlayerControls' },
      },
    ],
  };

  const REAPER_CARD: Card = creature('Gloom Reaper', 2, 2, {
    cost: { generic: 2, B: 1 },
    abilities: [REAPER],
  });
  const ALLY: Card = creature('Shieldbearer', 2, 2);
  const FIRST_ENEMY: Card = creature('Marsh Lurker', 3, 3);
  const SECOND_ENEMY: Card = creature('Bog Sentry', 1, 4);

  function attacked(): ReduceResult {
    const start = scenario({
      battlefield: [
        { card: REAPER_CARD, controller: 0 },
        { card: ALLY, controller: 0 },
        { card: FIRST_ENEMY, controller: 1 },
        { card: SECOND_ENEMY, controller: 1 },
      ],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    const active = start.state.turn.active;
    return apply(
      { state: start.state, events: [...start.events] },
      {
        type: 'declareAttackers',
        player: active,
        attackers: [{ oid: oidOf(start.state, 'Gloom Reaper'), defender: opponentOf(active) }],
      },
    );
  }

  function offeredTargets(state: GameState): readonly (Target | null)[] {
    const decision = pendingDecision(state);
    if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
    return decision.options.map((option) =>
      option.type === 'chooseTriggerTargets' ? (option.targets[0] ?? null) : null,
    );
  }

  it('offers the defending player creatures and none of the attacker own', () => {
    const state = attacked().state;

    expect(offeredTargets(state)).toEqual([
      { kind: 'permanent', oid: oidOf(state, 'Marsh Lurker') },
      { kind: 'permanent', oid: oidOf(state, 'Bog Sentry') },
    ]);
  });

  it('lands the counter on the creature it was aimed at, and the layers read it', () => {
    const declared = attacked();
    const victim = oidOf(declared.state, 'Marsh Lurker');
    const decision = pendingDecision(declared.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
    const option = decision.options.find(
      (entry) =>
        entry.type === 'chooseTriggerTargets' &&
        entry.targets[0]?.kind === 'permanent' &&
        entry.targets[0].oid === victim,
    );
    if (option === undefined) throw new Error('the victim was not offered');

    let current = apply(declared, option);
    for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
      const pending = pendingDecision(current.state);
      if (pending === null || pending.kind !== 'priority') break;
      current = apply(current, { type: 'passPriority', player: pending.player });
    }

    expect(getObject(current.state, victim).counters.minusOneMinusOne).toBe(1);
    expect(toughnessOf(current.state, victim)).toBe(2);
    expect(getObject(current.state, oidOf(current.state, 'Shieldbearer')).counters.minusOneMinusOne).toBe(0);
  });
});
