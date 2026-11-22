/** Referee framing for Mystifying Maze's combat activation. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import { opponentOf, reduce, scenario } from '@mtg/kernel';
import { frameDecision, renderFrame } from '@mtg/referee';
import { viewFor } from './positions';

const MAZE = parseCard({
  kind: 'land',
  id: 'referee-m11-226',
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
  id: 'referee-maze-attacker',
  name: 'Frame Attacker',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 226 },
  manaCost: { generic: 3 },
  colors: [],
  power: 3,
  toughness: 3,
});

describe('Mystifying Maze referee frame', () => {
  it('shows the printed delayed-return clause and the one legal attacking target', () => {
    let state = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: MAZE, controller: 1 },
        ...Array.from({ length: 4 }, () => ({
          card: basicLand('Plains', 'REF', 227),
          controller: 1 as const,
        })),
      ],
    }).state;
    const attacker = state.battlefield.find((oid) => state.objects[oid]?.card.name === ATTACKER.name);
    if (attacker === undefined) throw new Error('frame attacker vanished');
    state = reduce(state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: opponentOf(0) }],
    }).state;
    state = reduce(state, { type: 'passPriority', player: 0 }).state;

    const text = renderFrame(frameDecision(viewFor(state), { maxOptions: 128 }));
    expect(text).toContain(MAZE.name);
    expect(text).toContain(ATTACKER.name);
    expect(text).toContain('At the beginning of the next end step, return it to the battlefield tapped');
    expect(text).not.toContain('Maze Nonattacker');
  });
});
