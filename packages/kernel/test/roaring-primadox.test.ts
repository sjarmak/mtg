/** Roaring Primadox through its mandatory resolution-time battlefield choice. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  controllerOf,
  moveObject,
  objectFilter,
  pendingDecision,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  type Action,
  type ContinuousEffect,
  type GameState,
  type ObjectId,
  type Trace,
} from '@mtg/kernel';
import { artifact, creature } from './cards';
import { oidOf } from './helpers';

const PRIMADOX = parseCard({
  kind: 'creature',
  id: 'm13-188-roaring-primadox-kernel',
  name: 'Roaring Primadox',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 188 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  subtypes: ['Beast'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        {
          kind: 'chooseFromBattlefield',
          filter: { cardTypes: ['creature'] },
          destination: 'hand',
        },
      ],
    },
  ],
} as unknown as CardInput);

const FRIEND_A = creature('Primadox Friend A', 2, 2);
const FRIEND_B = creature('Primadox Friend B', 3, 3);
const ENEMY = creature('Primadox Enemy', 4, 4);
const RELIC = artifact('Primadox Relic');
const TOKEN = creature('Primadox Token', 1, 1);

function upkeepTrigger(state: GameState): Trace {
  const event = {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'upkeep',
    active: 0,
  } as const;
  const triggers = collectTriggers({ state, events: [event], eventStates: [state] }, 0);
  return putTriggersOnStack(beginTrace(state), triggers);
}

function control(state: GameState, oid: ObjectId, player: 0 | 1): GameState {
  const timestamp = state.nextId;
  const effect: ContinuousEffect = {
    id: `continuous:${String(timestamp)}`,
    kind: 'control',
    layer: '2',
    affects: objectFilter({ oids: [oid] }),
    controller: player,
    duration: 'endOfTurn',
    timestamp,
    sourceOid: oid,
    enabledWhile: null,
  };
  return { ...state, nextId: timestamp + 1, continuous: [...state.continuous, effect] };
}

function choose(paused: Trace, oid: ObjectId): Trace {
  const decision = pendingDecision(paused.state);
  if (decision?.kind !== 'battlefieldChoice') throw new Error('Primadox did not ask for a permanent');
  const action = decision.options.find(
    (candidate): candidate is Extract<Action, { type: 'chooseFromBattlefield' }> =>
      candidate.type === 'chooseFromBattlefield' && candidate.chosen === oid,
  );
  if (action === undefined) throw new Error(`Primadox did not offer ${oid}`);
  return reduce(paused.state, action);
}

describe('Roaring Primadox in the kernel', () => {
  it('offers exactly the resolving controller creatures, with no decline or target', () => {
    const start = scenario({
      battlefield: [
        { card: PRIMADOX, controller: 0 },
        { card: FRIEND_A, controller: 0 },
        { card: RELIC, controller: 0 },
        { card: ENEMY, controller: 1 },
      ],
    });
    const primadox = oidOf(start.state, PRIMADOX.name);
    const friend = oidOf(start.state, FRIEND_A.name);
    const paused = resolveTop(upkeepTrigger(start.state));
    const decision = pendingDecision(paused.state);

    expect(decision?.kind).toBe('battlefieldChoice');
    if (decision?.kind !== 'battlefieldChoice') throw new Error('Primadox did not ask for a permanent');
    expect(decision.player).toBe(0);
    expect(decision.permanents).toEqual([primadox, friend]);
    expect(decision.options).toEqual([
      { type: 'chooseFromBattlefield', player: 0, chosen: primadox },
      { type: 'chooseFromBattlefield', player: 0, chosen: friend },
    ]);
  });

  it('keeps the trigger controller after source control changes and reads that board at resolution', () => {
    const start = scenario({
      battlefield: [
        { card: PRIMADOX, controller: 0 },
        { card: FRIEND_A, controller: 0 },
        { card: FRIEND_B, controller: 0 },
      ],
    });
    const primadox = oidOf(start.state, PRIMADOX.name);
    const friendA = oidOf(start.state, FRIEND_A.name);
    const friendB = oidOf(start.state, FRIEND_B.name);
    const stacked = upkeepTrigger(start.state);
    const changed = control(stacked.state, primadox, 1);
    expect(controllerOf(changed, primadox)).toBe(1);

    const paused = resolveTop(beginTrace(changed));
    const decision = pendingDecision(paused.state);
    expect(decision?.kind).toBe('battlefieldChoice');
    if (decision?.kind !== 'battlefieldChoice')
      throw new Error('Primadox did not ask its trigger controller');
    expect(decision.player).toBe(0);
    expect(decision.permanents).toEqual([friendA, friendB]);
  });

  it('resolves after source departure and skips an impossible instruction', () => {
    const withFriend = scenario({
      battlefield: [
        { card: PRIMADOX, controller: 0 },
        { card: FRIEND_A, controller: 0 },
        { card: FRIEND_B, controller: 0 },
      ],
    });
    const source = oidOf(withFriend.state, PRIMADOX.name);
    const friend = oidOf(withFriend.state, FRIEND_A.name);
    const departed = moveObject(upkeepTrigger(withFriend.state), source, 'graveyard');
    const paused = resolveTop(departed);
    expect(pendingDecision(paused.state)?.kind).toBe('battlefieldChoice');
    expect(choose(paused, friend).state.objects[friend]?.zone).toBe('hand');

    const alone = scenario({ battlefield: [{ card: PRIMADOX, controller: 0 }] });
    const loneSource = oidOf(alone.state, PRIMADOX.name);
    const gone = moveObject(upkeepTrigger(alone.state), loneSource, 'graveyard');
    const done = resolveTop(gone);
    expect(pendingDecision(done.state)?.kind).not.toBe('battlefieldChoice');
    expect(done.state.stack).toEqual([]);
  });

  it("returns a controlled card to its owner's hand, not its controller's", () => {
    const start = scenario({
      battlefield: [
        { card: PRIMADOX, controller: 0 },
        { card: FRIEND_A, controller: 0 },
        { card: FRIEND_B, controller: 1 },
      ],
    });
    const primadox = oidOf(start.state, PRIMADOX.name);
    const ownedByOne = oidOf(start.state, FRIEND_B.name);
    const controlled = control(start.state, ownedByOne, 0);
    const done = choose(resolveTop(upkeepTrigger(controlled)), ownedByOne);

    expect(done.state.players[0].hand).not.toContain(ownedByOne);
    expect(done.state.players[1].hand).toContain(ownedByOne);
    expect(done.state.objects[ownedByOne]?.zone).toBe('hand');
    expect(done.state.objects[primadox]?.zone).toBe('battlefield');
  });

  it('lets a token be chosen, then lets the ordinary token state-based action remove it', () => {
    const start = scenario({
      battlefield: [
        { card: PRIMADOX, controller: 0 },
        { card: TOKEN, controller: 0, token: true },
      ],
    });
    const token = oidOf(start.state, TOKEN.name);
    const done = choose(resolveTop(upkeepTrigger(start.state)), token);

    expect(done.state.players[0].hand).not.toContain(token);
    expect(done.state.objects[token]?.zone).toBe('exile');
  });
});
