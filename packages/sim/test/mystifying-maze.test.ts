/** Greedy-bot policy reaches Mystifying Maze's delayed exile activation. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import { opponentOf, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { chooseActivation, DEFAULT_GREEDY_CONFIG } from '@mtg/sim';

const MAZE = parseCard({
  kind: 'land',
  id: 'sim-m11-226',
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
          target: { kind: 'targetCreatureOpponentControls', filter: { combat: 'attacking' } },
          returnAtNextEndStep: { tapped: true, under: 'owner' },
        },
      ],
    },
  ],
});

const ATTACKER = parseCard({
  kind: 'creature',
  id: 'sim-maze-attacker',
  name: 'Bot Maze Attacker',
  rarity: 'common',
  set: { code: 'SIM', collectorNumber: 226 },
  manaCost: { generic: 5 },
  colors: [],
  power: 5,
  toughness: 5,
});

describe('Mystifying Maze bot policy', () => {
  it('chooses the activation and aims it at the attacker', () => {
    let state = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: MAZE, controller: 1 },
        ...Array.from({ length: 4 }, () => ({
          card: basicLand('Plains', 'SIM', 227),
          controller: 1 as const,
        })),
      ],
    }).state;
    const attacker = state.battlefield.find((oid) => state.objects[oid]?.card.name === ATTACKER.name);
    if (attacker === undefined) throw new Error('bot attacker vanished');
    state = reduce(state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: opponentOf(0) }],
    }).state;
    state = reduce(state, { type: 'passPriority', player: 0 }).state;
    const decision = pendingDecision(state, 128);
    if (decision === null) throw new Error('defending bot received no decision');
    const action = chooseActivation(
      { state: observeState(state, 1, 'test/mystifying-maze.test.ts:66'), player: 1, decision },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(action).toMatchObject({
      type: 'activateAbility',
      targets: [{ kind: 'permanent', oid: attacker }],
    });
  });
});
