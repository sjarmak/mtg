/** Mystifying Maze's exile and exact next-end-step delayed return. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  emit,
  legalActions,
  moveObject,
  opponentOf,
  pendingDecision,
  putTriggersOnStack,
  resolveTop,
  scenario,
  stateFingerprint,
  withState,
} from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { replacement, withReplacements } from './continuous-helpers';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const MAZE = parseCard({
  kind: 'land',
  id: 'm11-226',
  name: 'Mystifying Maze',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 226 },
  colors: [],
  producesMana: ['C'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 4 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCreatureOpponentControls',
            filter: { combat: 'attacking' },
          },
          returnAtNextEndStep: { tapped: true, under: 'owner' },
        },
      ],
    },
  ],
});

const ATTACKER = creature('Maze Attacker', 3, 3);
const NONATTACKER = creature('Maze Nonattacker', 2, 2);
const MIRROR_LAND = parseCard({
  kind: 'land',
  id: 'test-mirror-land',
  name: 'Mirror Land',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  colors: [],
  producesMana: ['C'],
});

function activations(
  state: GameState,
  maze: string,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === maze,
  );
}

function combatPosition(token = false): {
  readonly current: ReduceResult;
  readonly maze: string;
  readonly attacker: string;
  readonly nonattacker: string;
} {
  let current = scenario({
    active: 0,
    turn: 6,
    step: 'declareAttackers',
    battlefield: [
      { card: ATTACKER, controller: 0, token },
      { card: NONATTACKER, controller: 0 },
      { card: MAZE, controller: 1 },
      ...Array.from({ length: 4 }, () => ({
        card: basicLand('Plains', 'TST', 1),
        controller: 1 as const,
      })),
    ],
  });
  const maze = oidOf(current.state, MAZE.name);
  const attacker = oidOf(current.state, ATTACKER.name);
  const nonattacker = oidOf(current.state, NONATTACKER.name);
  current = apply(current, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: attacker, defender: opponentOf(0) }],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return { current, maze, attacker, nonattacker };
}

function activate(position: ReturnType<typeof combatPosition>): ReduceResult {
  const option = activations(position.current.state, position.maze)[0];
  if (option === undefined) throw new Error('Mystifying Maze activation was not offered');
  return apply(position.current, option);
}

function resolveAbility(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 8 && walked.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('Maze ability did not resolve through priority');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  return walked;
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
  const stacked = putTriggersOnStack(began, collectTriggers(began, 0));
  return resolveTop(stacked);
}

describe('Mystifying Maze', () => {
  it('keeps its mana ability and offers {4}, {T} only for an opposing attacker', () => {
    const position = combatPosition();
    expect(
      legalActions(position.current.state).some(
        (action) =>
          action.type === 'activateManaAbility' && action.oid === position.maze && action.color === 'C',
      ),
    ).toBe(true);
    expect(activations(position.current.state, position.maze).map((action) => action.targets)).toEqual([
      [{ kind: 'permanent', oid: position.attacker }],
    ]);
    expect(
      activations(position.current.state, position.maze).flatMap((action) => action.targets),
    ).not.toContainEqual({ kind: 'permanent', oid: position.nonattacker });
  });

  it('returns the exact exiled card tapped under its owner even after the source leaves', () => {
    const position = combatPosition();
    const resolved = resolveAbility(activate(position));
    expect(resolved.state.objects[position.attacker]?.zone).toBe('exile');
    expect(resolved.state.combat.attacks).toEqual([]);
    expect(resolved.state.delayedZoneChanges).toHaveLength(1);
    expect(resolved.events.some((event) => event.type === 'delayedZoneChangeScheduled')).toBe(true);

    const sourceGone = moveObject(beginTrace(resolved.state), position.maze, 'graveyard');
    const returned = fireAndResolveDelayed(sourceGone.state);
    const object = returned.state.objects[position.attacker];
    expect(object?.zone).toBe('battlefield');
    expect(object?.controller).toBe(object?.owner);
    expect(object?.tapped).toBe(true);
    expect(returned.state.delayedZoneChanges).toBeUndefined();
  });

  it('keeps the delayed trigger controller fixed when control of the source changes', () => {
    const position = combatPosition();
    const resolved = resolveAbility(activate(position));
    const source = resolved.state.objects[position.maze];
    if (source === undefined) throw new Error('Maze source vanished');
    const changed = {
      ...resolved.state,
      objects: { ...resolved.state.objects, [position.maze]: { ...source, controller: 0 as const } },
    };
    const began = beginEndStep(changed);
    const stacked = putTriggersOnStack(began, collectTriggers(began, 0));
    expect(stacked.state.stack.at(-1)?.controller).toBe(1);
  });

  it('does not exile or schedule when the target stops being opponent controlled', () => {
    const position = combatPosition();
    const activated = activate(position);
    const target = activated.state.objects[position.attacker];
    if (target === undefined) throw new Error('attacker vanished before the response');
    const changed = withState(beginTrace(activated.state), {
      ...activated.state,
      objects: {
        ...activated.state.objects,
        [position.attacker]: { ...target, controller: 1 },
      },
    });
    const resolved = resolveAbility({
      state: changed.state,
      events: [...activated.events, ...changed.events],
    });
    expect(resolved.state.objects[position.attacker]?.zone).toBe('battlefield');
    expect(resolved.state.delayedZoneChanges).toBeUndefined();
  });

  it('waits for the following turn when created after this turn end step began', () => {
    const position = combatPosition();
    const activated = activate(position);
    const duringEnd = {
      ...activated,
      state: {
        ...activated.state,
        turn: { ...activated.state.turn, step: 'end' as const },
      },
    };
    const resolved = resolveAbility(duringEnd);
    const thisEnd = beginEndStep(resolved.state);
    expect(collectTriggers(thisEnd, 0)).toEqual([]);
    const nextEnd = beginEndStep(resolved.state, resolved.state.turn.number + 1);
    expect(collectTriggers(nextEnd, 0)).toHaveLength(1);
  });

  it('does not return a token or a card that left exile and became a new incarnation', () => {
    const tokenPosition = combatPosition(true);
    const tokenResolved = resolveAbility(activate(tokenPosition));
    const tokenReturn = fireAndResolveDelayed(tokenResolved.state);
    expect(tokenReturn.state.objects[tokenPosition.attacker]?.zone).toBe('exile');

    const cardPosition = combatPosition();
    const cardResolved = resolveAbility(activate(cardPosition));
    const left = moveObject(beginTrace(cardResolved.state), cardPosition.attacker, 'hand');
    const reexiled = moveObject(left, cardPosition.attacker, 'exile');
    const cardReturn = fireAndResolveDelayed(reexiled.state);
    expect(cardReturn.state.objects[cardPosition.attacker]?.zone).toBe('exile');
  });

  it('schedules only a successful exile and runs a return through zone-change replacements', () => {
    const redirectedPosition = combatPosition();
    const redirectedActivation = activate(redirectedPosition);
    const exileRedirect = replacement(
      {
        kind: 'zoneChange',
        owner: 0,
        from: 'battlefield',
        destination: 'exile',
        cardOnly: true,
      },
      { kind: 'moveToZone', destination: 'graveyard' },
      { id: 'maze-exile-redirect' },
    );
    const redirected = resolveAbility({
      ...redirectedActivation,
      state: withReplacements(redirectedActivation.state, [exileRedirect]),
    });
    expect(redirected.state.objects[redirectedPosition.attacker]?.zone).toBe('graveyard');
    expect(redirected.state.delayedZoneChanges).toBeUndefined();

    const returnPosition = combatPosition();
    const exiled = resolveAbility(activate(returnPosition));
    const returnRedirect = replacement(
      {
        kind: 'zoneChange',
        owner: 0,
        from: 'exile',
        destination: 'battlefield',
        cardOnly: true,
      },
      { kind: 'moveToZone', destination: 'hand' },
      { id: 'maze-return-redirect' },
    );
    const returned = fireAndResolveDelayed(withReplacements(exiled.state, [returnRedirect]));
    expect(returned.state.objects[returnPosition.attacker]?.zone).toBe('hand');
  });

  it('orders simultaneous records in APNAP order and consumes a countered record', () => {
    const firstPosition = combatPosition();
    const firstResolved = resolveAbility(activate(firstPosition));
    const first = firstResolved.state.delayedZoneChanges?.[0];
    if (first === undefined) throw new Error('first delayed record was not scheduled');
    const second = { ...first, id: first.id + 1, controller: 0 as const };
    const state = {
      ...firstResolved.state,
      nextId: Math.max(firstResolved.state.nextId, second.id + 1),
      delayedZoneChanges: [second, first],
    };
    const began = beginEndStep(state);
    const fired = collectTriggers(began, 0);
    expect(fired.map((trigger) => trigger.controller)).toEqual([0, 1]);

    const soleBegan = beginEndStep(firstResolved.state);
    const oneStacked = putTriggersOnStack(soleBegan, collectTriggers(soleBegan, 0));
    expect(oneStacked.state.delayedZoneChanges).toBeUndefined();
    const delayedOid = oneStacked.state.stack.at(-1)?.oid;
    if (delayedOid === undefined) throw new Error('delayed trigger was not put on the stack');
    const countered = counterStackEntry(oneStacked, delayedOid, 'test-counter');
    expect(countered.state.stack).toHaveLength(0);
    expect(countered.state.objects[firstPosition.attacker]?.zone).toBe('exile');
    const later = beginEndStep(countered.state, countered.state.turn.number + 1);
    expect(collectTriggers(later, 0)).toEqual([]);
  });

  it('replays scheduling byte-for-byte from the same state and action sequence', () => {
    const position = combatPosition();
    const activated = activate(position);
    const first = resolveAbility(activated);
    const second = resolveAbility(activated);
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });

  it('retains copied source values rather than depending on the printed source card', () => {
    let current = scenario({
      active: 0,
      turn: 6,
      step: 'declareAttackers',
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: MIRROR_LAND, controller: 1 },
        ...Array.from({ length: 4 }, () => ({
          card: basicLand('Plains', 'TST', 3),
          controller: 1 as const,
        })),
      ],
    });
    const source = oidOf(current.state, MIRROR_LAND.name);
    const attacker = oidOf(current.state, ATTACKER.name);
    const printed = current.state.objects[source];
    if (printed === undefined) throw new Error('copy source vanished');
    current = {
      ...current,
      state: {
        ...current.state,
        objects: { ...current.state.objects, [source]: { ...printed, copiableCard: MAZE } },
      },
    };
    current = apply(current, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: opponentOf(0) }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    const option = activations(current.state, source)[0];
    if (option === undefined) throw new Error('copied Maze activation was not offered');
    const resolved = resolveAbility(apply(current, option));
    expect(resolved.state.delayedZoneChanges?.[0]).toMatchObject({
      sourceOid: source,
      sourceCard: { name: MAZE.name },
    });
  });
});
