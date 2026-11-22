import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { creature, lands, MOUNTAIN, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const SKULL_REND = parseCard({
  kind: 'sorcery',
  id: 'rtr-195-skull-rend-kernel',
  name: 'Skull Rend',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 195 },
  manaCost: { generic: 3, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    { kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' }, players: 'eachOpponent' },
    { kind: 'discardCards', count: 2, target: { kind: 'noTarget' }, players: 'eachOpponent', random: true },
  ],
});
const HELD = [
  creature('Skull Held One', 1, 1),
  creature('Skull Held Two', 1, 1),
  creature('Skull Held Three', 1, 1),
];

function run(seed: string, hand = HELD): ReduceResult {
  let current = scenario({
    seed,
    battlefield: [
      ...lands(SWAMP, 4).map((card) => ({ card, controller: 0 as const })),
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[SKULL_REND], hand],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, SKULL_REND.name),
    targets: [null, null],
  });
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority')
      throw new Error(`Skull Rend opened ${decision?.kind ?? 'no'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('RTR #195 Skull Rend', () => {
  it('damages only the opponent and discards two random cards without a choice or reveal', () => {
    const result = run('skull-rend-seed');
    expect(result.state.players.map((player) => player.life)).toEqual([20, 18]);
    expect(result.state.players[1].hand).toHaveLength(1);
    expect(result.state.players[1].graveyard).toHaveLength(2);
    expect(result.events.some((event) => event.type === 'handRevealed')).toBe(false);
  });

  it('is seed-replayable and discards every card from a short hand', () => {
    const first = run('same-seed');
    const second = run('same-seed');
    expect(first.state.players[1].graveyard).toEqual(second.state.players[1].graveyard);
    expect(run('short-hand', HELD.slice(0, 1)).state.players[1].hand).toEqual([]);
  });
});
