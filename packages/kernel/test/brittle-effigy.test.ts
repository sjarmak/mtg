/** Brittle Effigy's source-exile cost before its targeted ability resolves. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  playerOf,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

const EFFIGY = parseCard({
  kind: 'artifact',
  id: 'test-brittle-effigy',
  name: 'Brittle Effigy',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 202 },
  manaCost: { generic: 1 },
  colors: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 4 }, tapSelf: true, exileSelf: true },
      effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
    },
  ],
});

const TARGET_NAME = 'Bear';

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> => action.type === 'activateAbility',
  );
}

function resolve(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the Brittle Effigy ability did not leave the stack');
}

function opened(): { readonly start: ReduceResult; readonly source: string; readonly victim: string } {
  const start = scenario({
    battlefield: [
      { card: EFFIGY, controller: 0 },
      { card: creature(TARGET_NAME, 6, 6), controller: 1 },
      ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    ],
  });
  return {
    start,
    source: oidOf(start.state, EFFIGY.name),
    victim: oidOf(start.state, TARGET_NAME),
  };
}

describe('Brittle Effigy activation', () => {
  it('is offered only to its controller while untapped and able to pay', () => {
    const { start, source } = opened();
    expect(activations(start.state).some((action) => action.oid === source)).toBe(true);

    const tapped = scenario({
      battlefield: [
        { card: EFFIGY, controller: 0, tapped: true },
        { card: creature(TARGET_NAME, 2, 2), controller: 1 },
        ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      ],
    });
    expect(activations(tapped.state)).toEqual([]);

    const poor = scenario({
      battlefield: [
        { card: EFFIGY, controller: 0 },
        { card: creature(TARGET_NAME, 2, 2), controller: 1 },
        ...Array.from({ length: 3 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      ],
    });
    expect(activations(poor.state)).toEqual([]);

    const opponentPriority = scenario({
      active: 1,
      battlefield: [
        { card: EFFIGY, controller: 0 },
        { card: creature(TARGET_NAME, 2, 2), controller: 1 },
        ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 1 as const })),
      ],
    });
    expect(activations(opponentPriority.state)).toEqual([]);
  });

  it('pays mana, taps, and exiles the source before putting the ability on the stack', () => {
    const { start, source, victim } = opened();
    const option = activations(start.state).find((action) => action.oid === source);
    expect(option).toBeDefined();
    if (option === undefined) return;
    expect(validateAction(start.state, option)).toBeNull();

    const activated = apply(start, option);
    expect(activated.state.exile).toContain(source);
    expect(activated.state.battlefield).not.toContain(source);
    expect(activated.state.stack[0]?.ability).toEqual({ sourceOid: source, index: 0 });
    expect(activated.state.stack[0]?.targets).toEqual([{ kind: 'permanent', oid: victim }]);
    const tapped = activated.events.findIndex((event) => event.type === 'permanentTapped');
    const exiled = activated.events.findIndex(
      (event) =>
        event.type === 'zoneChanged' &&
        event.oid === source &&
        event.from === 'battlefield' &&
        event.to === 'exile',
    );
    expect(tapped).toBeGreaterThanOrEqual(0);
    expect(exiled).toBeGreaterThan(tapped);
  });

  it('exiles the target while its source remains in exile', () => {
    const { start, source, victim } = opened();
    const option = activations(start.state).find((action) => action.oid === source);
    expect(option).toBeDefined();
    if (option === undefined) return;

    const resolved = resolve(apply(start, option));
    expect(resolved.state.exile).toEqual(expect.arrayContaining([source, victim]));
    expect(eventsOfType(resolved.events, 'effectSkipped')).toEqual([]);
  });

  it('rechecks the creature target independently after the source has paid itself', () => {
    const { start, source, victim } = opened();
    const option = activations(start.state).find((action) => action.oid === source);
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    const moved = moveObject(beginTrace(activated.state), victim, 'hand');
    const resolved = resolve({
      state: moved.state,
      events: [...activated.events, ...moved.events],
    });
    expect(resolved.state.exile).toContain(source);
    expect(playerOf(resolved.state, 1).hand).toContain(victim);
    expect(resolved.state.exile).not.toContain(victim);
  });
});
