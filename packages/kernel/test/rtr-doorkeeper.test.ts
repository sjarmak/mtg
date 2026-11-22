/** Doorkeeper counts live defender abilities when its mill activation resolves. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  onlyObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  type Action,
  type GameState,
  type PlayerId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, ISLAND } from './cards';
import { abilities, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const DOORKEEPER = parseCard({
  kind: 'creature',
  id: 'rtr-37-doorkeeper-kernel',
  name: 'Doorkeeper',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 37 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  subtypes: ['Homunculus'],
  power: 0,
  toughness: 4,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'millCards',
          count: {
            kind: 'countMatching',
            filter: { cardTypes: ['creature'], keywordAbilities: ['defender'] },
          },
          target: { kind: 'targetPlayer' },
          printedVariable: 'X',
        },
      ],
    },
  ],
});

const ALLIED_DEFENDER = creature('Doorkeeper Allied Defender', 1, 5, {
  keywordAbilities: [{ kind: 'defender' }],
});
const ALLIED_CREATURE = creature('Doorkeeper Allied Creature', 2, 2);
const OPPOSING_DEFENDER = creature('Doorkeeper Opposing Defender', 1, 5, {
  keywordAbilities: [{ kind: 'defender' }],
});

function library(seat: PlayerId): readonly Card[] {
  return Array.from({ length: 8 }, (_, index) =>
    creature(`Doorkeeper seat ${String(seat)} card ${String(index + 1)}`, 1, 1),
  );
}

function opening(controller: PlayerId = 0): ReduceResult {
  return scenario({
    active: controller,
    battlefield: [
      { card: DOORKEEPER, controller },
      { card: ALLIED_DEFENDER, controller },
      { card: ALLIED_CREATURE, controller },
      { card: OPPOSING_DEFENDER, controller: controller === 0 ? 1 : 0 },
      ...Array.from({ length: 3 }, () => ({ card: ISLAND, controller })),
    ],
    libraries: [library(0), library(1)],
  });
}

function activation(
  state: GameState,
  source: string,
  target: PlayerId,
): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' &&
      candidate.oid === source &&
      candidate.targets[0]?.kind === 'player' &&
      candidate.targets[0].player === target,
  );
  if (action === undefined) throw new Error('Doorkeeper activation was not offered');
  return action;
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('Doorkeeper lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

describe('Doorkeeper defender-counted mill', () => {
  it('counts itself and allied defenders, but not allied creatures or opposing defenders', () => {
    let current = opening();
    const source = oidOf(current.state, DOORKEEPER.name);

    current = apply(current, activation(current.state, source, 1));
    expect(current.state.objects[source]?.tapped).toBe(true);
    current = resolveTop(current);

    expect(playerOf(current.state, 1).library).toHaveLength(6);
    expect(playerOf(current.state, 1).graveyard).toHaveLength(2);
  });

  it('reads the live board at resolution and targets either player under stolen control', () => {
    let current = opening(1);
    const source = oidOf(current.state, DOORKEEPER.name);
    const alliedDefender = oidOf(current.state, ALLIED_DEFENDER.name);

    current = apply(current, activation(current.state, source, 1));
    current = moveObject(beginTrace(current.state), alliedDefender, 'graveyard');
    current = resolveTop(current);

    expect(playerOf(current.state, 1).library).toHaveLength(7);
    expect(playerOf(current.state, 1).graveyard).toHaveLength(2);
    expect(playerOf(current.state, 0).library).toHaveLength(8);
  });

  it('counts defender gained after activation from the live derived characteristics', () => {
    let current = opening();
    const source = oidOf(current.state, DOORKEEPER.name);
    const newDefender = oidOf(current.state, ALLIED_CREATURE.name);

    current = apply(current, activation(current.state, source, 1));
    current = {
      ...current,
      state: withContinuous(current.state, [
        abilities(onlyObject(newDefender), { addKeywordAbilities: [{ kind: 'defender' }] }),
      ]),
    };
    current = resolveTop(current);

    expect(playerOf(current.state, 1).library).toHaveLength(5);
    expect(playerOf(current.state, 1).graveyard).toHaveLength(3);
  });

  it('mills zero when the source and every allied defender leave before resolution', () => {
    let current = opening();
    const source = oidOf(current.state, DOORKEEPER.name);
    const alliedDefender = oidOf(current.state, ALLIED_DEFENDER.name);

    current = apply(current, activation(current.state, source, 1));
    current = moveObject(beginTrace(current.state), alliedDefender, 'graveyard');
    current = moveObject(beginTrace(current.state), source, 'graveyard');
    current = resolveTop(current);

    expect(playerOf(current.state, 1).library).toHaveLength(8);
    expect(playerOf(current.state, 1).graveyard).toHaveLength(0);
  });
});
