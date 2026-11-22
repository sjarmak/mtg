/** Native execution evidence for Public Execution's retained controller cohort. */
import { describe, expect, it } from 'vitest';
import type { Action, ReduceResult } from '@mtg/kernel';
import { legalActions, pendingDecision, powerOf, scenario } from '@mtg/kernel';
import { parseCard } from '@mtg/dsl';
import { creature, instant, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const PUBLIC_EXECUTION = parseCard({
  kind: 'instant',
  id: 'm13-public-execution',
  name: 'Public Execution',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 105 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B'],
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreatureOpponentControls' } },
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: 0,
      scope: 'creaturesThatPlayerControls',
      excludeReferent: true,
      target: { kind: 'thatCreaturesController' },
    },
  ],
});

const RESPONSE = instant(
  'Public Execution Response',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { B: 1 },
);
const VICTIM = creature('Public Execution Victim', 3, 3);
const INDESTRUCTIBLE_VICTIM = creature('Public Execution Survivor', 3, 3, {
  keywordAbilities: [{ kind: 'indestructible' }],
});
const COHORT = creature('Public Execution Cohort', 4, 4);
const ALLY = creature('Public Execution Ally', 5, 5);

type Cast = Extract<Action, { type: 'castSpell' }>;

function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Public Execution did not leave the stack');
}

function board(victim = VICTIM): ReduceResult {
  return scenario({
    active: 0,
    hands: [[PUBLIC_EXECUTION, RESPONSE], []],
    battlefield: [
      { card: victim, controller: 1 },
      { card: COHORT, controller: 1 },
      { card: ALLY, controller: 0 },
      ...Array.from({ length: 6 }, () => ({ card: SWAMP, controller: 0 as const })),
      { card: SWAMP, controller: 0 },
    ],
  });
}

function casts(start: ReduceResult, player: 0 | 1, name: string): readonly Cast[] {
  const oid = handOidOf(start.state, player, name);
  return legalActions(start.state).filter(
    (action): action is Cast => action.type === 'castSpell' && action.oid === oid,
  );
}

function aimedAt(start: ReduceResult, player: 0 | 1, name: string, target: string): Cast {
  const oid = oidOf(start.state, target);
  const chosen = casts(start, player, name).find(
    (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === oid,
  );
  if (chosen === undefined) throw new Error(`${name} did not offer ${target}`);
  return chosen;
}

describe('Public Execution', () => {
  it('offers only creatures controlled by an opponent', () => {
    const start = board();
    const targets = casts(start, 0, PUBLIC_EXECUTION.name).flatMap((action) => {
      const target = action.targets[0];
      return target?.kind === 'permanent' ? [target.oid] : [];
    });
    expect(targets).toEqual([oidOf(start.state, VICTIM.name), oidOf(start.state, COHORT.name)]);
    expect(targets).not.toContain(oidOf(start.state, ALLY.name));
  });

  it('destroys the target and shrinks only its controller other creatures', () => {
    const start = board();
    const victim = oidOf(start.state, VICTIM.name);
    const cohort = oidOf(start.state, COHORT.name);
    const ally = oidOf(start.state, ALLY.name);
    const resolved = settle(apply(start, aimedAt(start, 0, PUBLIC_EXECUTION.name, VICTIM.name)));

    expect(resolved.state.objects[victim]?.zone).toBe('graveyard');
    expect(powerOf(resolved.state, cohort)).toBe(2);
    expect(powerOf(resolved.state, ally)).toBe(5);
  });

  it('excludes the chosen creature when destruction cannot move it', () => {
    const start = board(INDESTRUCTIBLE_VICTIM);
    const victim = oidOf(start.state, INDESTRUCTIBLE_VICTIM.name);
    const cohort = oidOf(start.state, COHORT.name);
    const resolved = settle(
      apply(start, aimedAt(start, 0, PUBLIC_EXECUTION.name, INDESTRUCTIBLE_VICTIM.name)),
    );

    expect(resolved.state.objects[victim]?.zone).toBe('battlefield');
    expect(powerOf(resolved.state, victim)).toBe(3);
    expect(powerOf(resolved.state, cohort)).toBe(2);
  });

  it('fizzles the whole spell when the chosen creature leaves first', () => {
    const start = board();
    const cohort = oidOf(start.state, COHORT.name);
    const execution = apply(start, aimedAt(start, 0, PUBLIC_EXECUTION.name, VICTIM.name));
    const response = aimedAt(execution, 0, RESPONSE.name, VICTIM.name);
    const resolved = settle(apply(execution, response));

    expect(powerOf(resolved.state, cohort)).toBe(4);
    expect(resolved.events.filter((event) => event.type === 'spellFizzled')).toHaveLength(1);
  });
});
