/** Intervening-if trigger creation and resolution for M13 Battle of Wits. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  eventsOfType,
  moveObject,
  onlyObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  stateFingerprint,
  type GameState,
  type PlayerId,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { controlledBy, copies, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { oidOf } from './helpers';

const BATTLE_OF_WITS = parseCard({
  kind: 'enchantment',
  id: 'm13-44-battle-of-wits-kernel',
  name: 'Battle of Wits',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 44 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      interveningIf: { kind: 'controllerLibraryAtLeast', atLeast: 200 },
      effects: [{ kind: 'winGame' }],
    },
  ],
});

const FILLER = creature('Battle Library Card', 1, 1);
const COPY_BODY = creature('Battle Copy Body', 1, 1);

function cards(count: number): readonly Card[] {
  return Array.from({ length: count }, () => FILLER);
}

function position(first: number, second: number, controller: PlayerId = 0): GameState {
  return scenario({
    battlefield: [{ card: BATTLE_OF_WITS, controller }],
    libraries: [cards(first), cards(second)],
  }).state;
}

function upkeepTriggers(state: GameState, active: PlayerId): ReturnType<typeof collectTriggers> {
  const event = {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'upkeep',
    active,
  } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function stackUpkeep(state: GameState, active: PlayerId): Trace {
  return putTriggersOnStack(beginTrace(state), upkeepTriggers(state, active));
}

describe('Battle of Wits in the kernel', () => {
  it('uses 200 as the inclusive trigger-creation boundary', () => {
    expect(upkeepTriggers(position(199, 1), 0)).toEqual([]);
    expect(upkeepTriggers(position(200, 1), 0)).toHaveLength(1);
  });

  it('checks the same boundary again as the trigger resolves', () => {
    const stacked = stackUpkeep(position(200, 1), 0);
    const top = stacked.state.players[0].library[0];
    if (top === undefined) throw new Error('Battle of Wits test library is empty');
    const thinned = moveObject(stacked, top, 'hand');
    const done = resolveTop(thinned);

    expect(done.state.players[0].library).toHaveLength(199);
    expect(done.state.result).toBeNull();
    expect(eventsOfType(done.events, 'gameEnded')).toEqual([]);
  });

  it('records the correct winner and loser for either controller seat', () => {
    const done = resolveTop(stackUpkeep(position(1, 200, 1), 1));

    expect(done.state.result).toEqual({
      winner: 1,
      loser: 0,
      reason: 'spellOrAbility',
      endedOnTurn: 2,
    });
    expect(eventsOfType(done.events, 'playerLost')).toEqual([
      { type: 'playerLost', player: 0, reason: 'spellOrAbility' },
    ]);
    expect(eventsOfType(done.events, 'gameEnded')).toEqual([
      { type: 'gameEnded', winner: 1, reason: 'spellOrAbility', turn: 2 },
    ]);
  });

  it('retains the trigger controller through a later control change and source departure', () => {
    const start = position(200, 199, 0);
    const source = oidOf(start, BATTLE_OF_WITS.name);
    const stacked = stackUpkeep(start, 0);
    const stolen = withContinuous(stacked.state, [controlledBy(onlyObject(source), 1)]);
    const removed = moveObject(beginTrace(stolen), source, 'graveyard');
    const done = resolveTop(removed);

    expect(done.state.result?.winner).toBe(0);
    expect(done.state.result?.loser).toBe(1);
  });

  it('derives copied abilities and uses the copy current controller at trigger creation', () => {
    const base = scenario({
      battlefield: [
        { card: BATTLE_OF_WITS, controller: 0 },
        { card: COPY_BODY, controller: 1 },
      ],
      libraries: [cards(199), cards(200)],
    }).state;
    const source = oidOf(base, BATTLE_OF_WITS.name);
    const copy = oidOf(base, COPY_BODY.name);
    const copied = withContinuous(base, [copies(onlyObject(copy), source)]);
    const fired = upkeepTriggers(copied, 1);

    expect(fired).toHaveLength(1);
    expect(fired[0]?.sourceOid).toBe(copy);
    expect(fired[0]?.controller).toBe(1);
    expect(resolveTop(putTriggersOnStack(beginTrace(copied), fired)).state.result?.winner).toBe(1);
  });

  it('replays deterministically from the same state', () => {
    const start = position(200, 1);
    const first = resolveTop(stackUpkeep(start, 0));
    const second = resolveTop(stackUpkeep(start, 0));

    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
    expect(first.events).toEqual(second.events);
  });
});
