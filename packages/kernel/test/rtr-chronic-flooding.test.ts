/** Attachment-event and retained-controller probes for RTR #32, Chronic Flooding. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  playerOf,
  putTriggersOnStack,
  resolveTop,
  scenario,
  tapObject,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST, ISLAND } from './cards';
import { handOidOf, oidOf } from './helpers';

const CHRONIC_FLOODING = parseCard({
  kind: 'enchantment',
  id: 'rtr-32-chronic-flooding-kernel',
  name: 'Chronic Flooding',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 32 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: { enchant: 'land', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedLandBecomesTapped',
      effects: [{ kind: 'millCards', count: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

function deck(prefix: string): readonly Card[] {
  return Array.from({ length: 6 }, (_, index) => creature(`${prefix} ${String(index)}`, 1, 1));
}

function board(): {
  readonly state: GameState;
  readonly aura: ObjectId;
  readonly host: ObjectId;
  readonly other: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: FOREST, controller: 1 },
      { card: ISLAND, controller: 1 },
    ],
    hands: [[CHRONIC_FLOODING], []],
    libraries: [deck('Flooding caster'), deck('Flooding land controller')],
  }).state;
  const aura = handOidOf(start, 0, CHRONIC_FLOODING.name);
  const host = oidOf(start, FOREST.name);
  const other = oidOf(start, ISLAND.name);
  return {
    state: moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host }).state,
    aura,
    host,
    other,
  };
}

describe('Chronic Flooding in the kernel', () => {
  it('fires only for a real tap of the currently enchanted land', () => {
    const ready = board();
    const unrelated = tapObject(beginTrace(ready.state), ready.other);
    expect(collectTriggers(unrelated, 0)).toEqual([]);

    const tapped = tapObject(beginTrace(ready.state), ready.host);
    const fired = collectTriggers(tapped, 0);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      sourceOid: ready.aura,
      condition: 'enchantedLandBecomesTapped',
      triggeringPlayer: 1,
    });

    const alreadyTapped = tapObject(tapped, ready.host);
    expect(collectTriggers(alreadyTapped, tapped.events.length)).toEqual([]);
  });

  it('retains the land controller and resolves after the Aura leaves', () => {
    const ready = board();
    const tapped = tapObject(beginTrace(ready.state), ready.host);
    const fired = collectTriggers(tapped, 0);
    const stacked = putTriggersOnStack(tapped, fired);
    const changedController: GameState = {
      ...stacked.state,
      objects: {
        ...stacked.state.objects,
        [ready.host]: { ...stacked.state.objects[ready.host]!, controller: 0 },
      },
    };
    const departed = moveObject({ ...stacked, state: changedController }, ready.aura, 'graveyard');
    const beforeZero = playerOf(departed.state, 0).library.length;
    const beforeOne = playerOf(departed.state, 1).library.length;
    const done = resolveTop(departed);

    expect(playerOf(done.state, 0).library).toHaveLength(beforeZero);
    expect(playerOf(done.state, 1).library).toHaveLength(beforeOne - 3);
  });

  it('ignores an Aura that was detached before the land tapped', () => {
    const ready = board();
    const { attachedTo: _attachedTo, ...auraWithoutAttachment } = ready.state.objects[ready.aura]!;
    const detached: GameState = {
      ...ready.state,
      objects: {
        ...ready.state.objects,
        [ready.aura]: auraWithoutAttachment,
      },
    };
    expect(collectTriggers(tapObject(beginTrace(detached), ready.host), 0)).toEqual([]);
  });
});
