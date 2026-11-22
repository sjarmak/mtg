/** Opponent-relative death retention and delayed return for RTR Grave Betrayal. */
import { describe, expect, it } from 'vitest';
import type { GameState, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  characteristicsOf,
  collectTriggers,
  emit,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  settle,
  withState,
} from '@mtg/kernel';
import { replacement, withReplacements } from './continuous-helpers';
import { artifact, creature, enchantment } from './cards';
import { oidOf } from './helpers';

const GRAVE_BETRAYAL = enchantment('Grave Betrayal', { generic: 5, B: 2 }, [
  {
    kind: 'triggered',
    condition: 'controlledCreatureDies',
    effects: [],
    opponentCreatureDiesReturnAtNextEndStep: {
      control: 'you',
      counter: 'plusOnePlusOne',
      count: 1,
      alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
    },
  },
]);

const VICTIM = creature('Selesnya Centaur', 3, 3, {
  cost: { generic: 2, G: 1 },
  subtypes: ['Centaur'],
});

function death(options: { readonly controller?: 0 | 1; readonly token?: boolean } = {}): {
  readonly current: ReduceResult;
  readonly source: string;
  readonly victim: string;
} {
  const start = scenario({
    active: 0,
    turn: 7,
    step: 'precombatMain',
    battlefield: [
      { card: GRAVE_BETRAYAL, controller: 0 },
      { card: VICTIM, controller: options.controller ?? 1, token: options.token ?? false },
    ],
  });
  const source = oidOf(start.state, GRAVE_BETRAYAL.name);
  const victim = oidOf(start.state, VICTIM.name);
  const moved = moveObject(beginTrace(start.state), victim, 'graveyard');
  return { current: { state: settle(moved).state, events: moved.events }, source, victim };
}

function resolveOriginalTrigger(current: ReduceResult): ReduceResult {
  const entry = current.state.stack.at(-1);
  if (entry?.ability === null || entry === undefined) throw new Error('Grave Betrayal trigger missing');
  const resolved = resolveTop(beginTrace(current.state));
  return { state: resolved.state, events: [...current.events, ...resolved.events] };
}

function beginEndStep(state: GameState, turn = state.turn.number): ReturnType<typeof beginTrace> {
  const atEnd = withState(beginTrace(state), {
    ...state,
    turn: { ...state.turn, number: turn, step: 'end', active: state.turn.active },
  });
  return emit(atEnd, { type: 'stepBegan', turn, step: 'end', active: state.turn.active });
}

function fireAndResolveDelayed(state: GameState, turn = state.turn.number): ReturnType<typeof beginTrace> {
  const began = beginEndStep(state, turn);
  return resolveTop(putTriggersOnStack(began, collectTriggers(began, 0)));
}

describe('RTR #67 Grave Betrayal', () => {
  it('returns the exact opposing card next end step with control, counter, color, and subtype additions', () => {
    const run = death();
    expect(run.current.state.objects[run.victim]?.zone).toBe('graveyard');
    expect(run.current.state.stack).toHaveLength(1);

    const scheduled = resolveOriginalTrigger(run.current);
    expect(scheduled.state.objects[run.victim]?.zone).toBe('graveyard');
    expect(scheduled.state.delayedZoneChanges).toHaveLength(1);

    const returned = fireAndResolveDelayed(scheduled.state);
    const object = returned.state.objects[run.victim];
    expect(object).toMatchObject({ zone: 'battlefield', owner: 1, controller: 0, token: false });
    expect(object?.counters.plusOnePlusOne).toBe(1);
    expect(characteristicsOf(returned.state, run.victim).colors).toEqual(['G', 'B']);
    expect(characteristicsOf(returned.state, run.victim).subtypes).toEqual(['Centaur', 'Zombie']);
    expect(returned.state.delayedZoneChanges).toBeUndefined();
  });

  it('uses last-known control and ignores a controlled death or a noncreature departure', () => {
    expect(death({ controller: 0 }).current.state.stack).toHaveLength(0);

    const start = scenario({
      battlefield: [
        { card: GRAVE_BETRAYAL, controller: 0 },
        { card: artifact('Departing Relic', { generic: 2 }), controller: 1 },
      ],
    });
    const relic = oidOf(start.state, 'Departing Relic');
    expect(settle(moveObject(beginTrace(start.state), relic, 'graveyard')).state.stack).toHaveLength(0);
  });

  it('captures the trigger controller even if its source leaves or changes control', () => {
    const run = death();
    const source = run.current.state.objects[run.source];
    if (source === undefined) throw new Error('Grave Betrayal source missing');
    const changed: GameState = {
      ...run.current.state,
      objects: { ...run.current.state.objects, [run.source]: { ...source, controller: 1 } },
    };
    const scheduled = resolveOriginalTrigger({ ...run.current, state: changed });
    const sourceGone = moveObject(beginTrace(scheduled.state), run.source, 'graveyard');
    const returned = fireAndResolveDelayed(sourceGone.state);
    expect(returned.state.objects[run.victim]?.controller).toBe(0);
  });

  it('does not return a different graveyard incarnation of the same physical card', () => {
    const run = death();
    const scheduled = resolveOriginalTrigger(run.current);
    const left = moveObject(beginTrace(scheduled.state), run.victim, 'hand');
    const returnedToGraveyard = moveObject(left, run.victim, 'graveyard');
    const delayed = fireAndResolveDelayed(returnedToGraveyard.state);
    expect(delayed.state.objects[run.victim]?.zone).toBe('graveyard');
  });

  it('waits for the following turn when the death trigger resolves during an end step', () => {
    const run = death();
    const duringEnd = {
      ...run.current,
      state: { ...run.current.state, turn: { ...run.current.state.turn, step: 'end' as const } },
    };
    const scheduled = resolveOriginalTrigger(duringEnd);
    expect(collectTriggers(beginEndStep(scheduled.state), 0)).toEqual([]);
    const nextEnd = beginEndStep(scheduled.state, scheduled.state.turn.number + 1);
    expect(collectTriggers(nextEnd, 0)).toHaveLength(1);
  });

  it('runs the delayed return through replacements before applying arrival riders', () => {
    const run = death();
    const scheduled = resolveOriginalTrigger(run.current);
    const returnToHandInstead = replacement(
      { kind: 'zoneChange', owner: 1, from: 'graveyard', destination: 'battlefield', cardOnly: true },
      { kind: 'moveToZone', destination: 'hand' },
      { id: 'grave-betrayal-return-to-hand' },
    );
    const returned = fireAndResolveDelayed(withReplacements(scheduled.state, [returnToHandInstead]));
    expect(returned.state.objects[run.victim]).toMatchObject({ zone: 'hand', owner: 1, token: false });
    expect(returned.state.objects[run.victim]?.counters.plusOnePlusOne ?? 0).toBe(0);
    expect(characteristicsOf(returned.state, run.victim).colors).toEqual(['G']);
    expect(characteristicsOf(returned.state, run.victim).subtypes).toEqual(['Centaur']);
  });

  it('does not schedule a token or a death replaced with exile', () => {
    const tokenRun = death({ token: true });
    expect(resolveOriginalTrigger(tokenRun.current).state.delayedZoneChanges).toBeUndefined();

    const start = scenario({
      battlefield: [
        { card: GRAVE_BETRAYAL, controller: 0 },
        { card: VICTIM, controller: 1 },
      ],
    });
    const victim = oidOf(start.state, VICTIM.name);
    const exileInstead = replacement(
      { kind: 'zoneChange', owner: 1, from: 'battlefield', destination: 'graveyard', cardOnly: true },
      { kind: 'moveToZone', destination: 'exile' },
      { id: 'grave-betrayal-exile-instead' },
    );
    const moved = moveObject(beginTrace(withReplacements(start.state, [exileInstead])), victim, 'graveyard');
    expect(settle(moved).state.stack).toHaveLength(0);
  });
});
