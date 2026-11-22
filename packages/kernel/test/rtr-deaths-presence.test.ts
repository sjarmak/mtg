/** Departure LKI and controller-relative death triggers for RTR Death's Presence. */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { beginTrace, collectTriggers, moveObject, pendingDecision, scenario, settle } from '@mtg/kernel';
import { artifact, creature, enchantment } from './cards';
import { apply, oidOf } from './helpers';

const DEATHS_PRESENCE = enchantment("Death's Presence", { generic: 5, G: 1 }, [
  {
    kind: 'triggered',
    condition: 'controlledCreatureDies',
    effects: [
      {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: { kind: 'triggeringCreaturePower' },
        target: { kind: 'targetCreatureYouControl' },
      },
    ],
  },
]);

const VICTIM = creature('Departing Centaur', 3, 3);
const FRIEND = creature('Surviving Saproling', 1, 1);
const ENEMY = creature('Enemy Watchwolf', 3, 3);

function passUntilQuiet(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority' || current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error("Death's Presence stack did not become quiet");
}

function death(card = VICTIM, controller: 0 | 1 = 0): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: DEATHS_PRESENCE, controller: 0 },
      { card, controller },
      { card: FRIEND, controller: 0 },
      { card: ENEMY, controller: 1 },
    ],
  });
  const victim = oidOf(start.state, card.name);
  const moved = moveObject(beginTrace(start.state), victim, 'graveyard');
  return { state: settle(moved).state, events: [...start.events, ...moved.events] };
}

function triggerEntry(state: GameState): ObjectId {
  const entry = state.stack.find((candidate) => candidate.ability !== null);
  if (entry === undefined) throw new Error('no triggered ability on the stack');
  return entry.oid;
}

function aimAtFriend(fired: ReduceResult): ReduceResult {
  const friend = oidOf(fired.state, FRIEND.name);
  return apply(fired, {
    type: 'chooseTriggerTargets',
    player: 0,
    oid: triggerEntry(fired.state),
    targets: [{ kind: 'permanent', oid: friend }],
  });
}

describe("RTR #121 Death's Presence", () => {
  it('retains departing power and only offers a surviving creature you control', () => {
    const fired = death();
    const decision = pendingDecision(fired.state);
    if (decision?.kind !== 'triggerTargets') throw new Error("Death's Presence did not ask for a target");

    expect(
      decision.options.map((option) => (option.type === 'chooseTriggerTargets' ? option.targets[0] : null)),
    ).toEqual([{ kind: 'permanent', oid: oidOf(fired.state, FRIEND.name) }]);

    const friend = oidOf(fired.state, FRIEND.name);
    const aimed = aimAtFriend(fired);
    const done = passUntilQuiet(aimed);
    expect(done.state.objects[friend]?.counters.plusOnePlusOne).toBe(3);
  });

  it('does not fire for an opposing creature or a noncreature departure', () => {
    expect(death(VICTIM, 1).state.stack).toHaveLength(0);
    expect(death(artifact('Departing Relic', { generic: 2 }), 0).state.stack).toHaveLength(0);
  });

  it('fires for zero departing power without treating it as absent', () => {
    const fired = death(creature('Departing Zero', 0, 2));
    const friend = oidOf(fired.state, FRIEND.name);
    const done = passUntilQuiet(aimAtFriend(fired));
    expect(done.state.objects[friend]?.counters.plusOnePlusOne ?? 0).toBe(0);
  });

  it('retains negative layered power without treating it as absent', () => {
    const withering = enchantment('Withering Field', {}, [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: -2, toughness: 0 },
      },
    ]);
    const start = scenario({
      battlefield: [
        { card: DEATHS_PRESENCE, controller: 0 },
        { card: withering, controller: 0 },
        { card: creature('Departing Negative', 1, 2), controller: 0 },
        { card: FRIEND, controller: 0 },
      ],
    });
    const victim = oidOf(start.state, 'Departing Negative');
    const fired = settle(moveObject(beginTrace(start.state), victim, 'graveyard'));
    expect(collectTriggers(fired, 0)[0]?.triggeringCreaturePower).toBe(-1);
    expect(pendingDecision(fired.state)?.kind).toBe('triggerTargets');
  });

  it('uses last-known controller rather than card owner', () => {
    const start = scenario({
      battlefield: [
        { card: DEATHS_PRESENCE, controller: 0 },
        { card: VICTIM, controller: 0 },
        { card: FRIEND, controller: 0 },
      ],
    });
    const victim = oidOf(start.state, VICTIM.name);
    const object = start.state.objects[victim];
    if (object === undefined) throw new Error('missing controlled victim');
    const controlledState: GameState = {
      ...start.state,
      objects: { ...start.state.objects, [victim]: { ...object, owner: 1 } },
    };
    const moved = moveObject(beginTrace(controlledState), victim, 'graveyard');
    const fired = settle(moved);
    expect(pendingDecision(fired.state)?.kind).toBe('triggerTargets');
  });

  it('creates one trigger with distinct retained power for each death in one scan', () => {
    const larger = creature('Departing Rhino', 5, 5);
    const start = scenario({
      battlefield: [
        { card: DEATHS_PRESENCE, controller: 0 },
        { card: VICTIM, controller: 0 },
        { card: larger, controller: 0 },
        { card: FRIEND, controller: 0 },
      ],
    });
    const first = moveObject(beginTrace(start.state), oidOf(start.state, VICTIM.name), 'graveyard');
    const second = moveObject(first, oidOf(first.state, larger.name), 'graveyard');
    expect(
      collectTriggers(second, 0)
        .filter((trigger) => trigger.condition === 'controlledCreatureDies')
        .map((trigger) => trigger.triggeringCreaturePower),
    ).toEqual([3, 5]);
  });

  it('still resolves after its source leaves and does not follow a blinked target', () => {
    const fired = death();
    const friend = oidOf(fired.state, FRIEND.name);
    const aimed = aimAtFriend(fired);
    const source = oidOf(aimed.state, DEATHS_PRESENCE.name);
    const sourceGone = moveObject(beginTrace(aimed.state), source, 'graveyard');
    const friendGone = moveObject(sourceGone, friend, 'graveyard');
    const friendReturned = moveObject(friendGone, friend, 'battlefield');
    const done = passUntilQuiet({
      state: friendReturned.state,
      events: [...aimed.events, ...friendReturned.events],
    });

    expect(done.state.objects[friend]?.counters.plusOnePlusOne ?? 0).toBe(0);
  });
});
