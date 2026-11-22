import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf, playCombat } from './helpers';

const RINGLEADER = parseCard({
  kind: 'creature',
  id: 'rtr-186-rakdos-ringleader-kernel',
  name: 'Rakdos Ringleader',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 186 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Skeleton', 'Warrior'],
  keywords: ['firstStrike'],
  power: 3,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'triggeringPlayer' }, random: true }],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1 } },
      regenerateSelf: true,
      printedSourceReference: 'thisCreature',
      effects: [],
    },
  ],
});

const HELD = [
  creature('Ringleader Held One', 1, 1),
  creature('Ringleader Held Two', 2, 2),
  creature('Ringleader Held Three', 3, 3),
];

function setup(seed: string, hand = HELD, blocker = false): ReduceResult {
  return scenario({
    seed,
    active: 0,
    step: 'declareAttackers',
    battlefield: [
      { card: RINGLEADER, controller: 0 },
      ...(blocker ? [{ card: creature('Ringleader Wall', 0, 4), controller: 1 as const }] : []),
    ],
    hands: [[], hand],
  });
}

function combat(seed: string, hand = HELD, blocked = false): ReduceResult {
  const start = setup(seed, hand, blocked);
  const attacker = oidOf(start.state, RINGLEADER.name);
  const blocks = blocked ? [{ blocker: oidOf(start.state, 'Ringleader Wall'), attacker }] : [];
  return playCombat(start, { attackers: [attacker], blocks });
}

describe('RTR #186 Rakdos Ringleader', () => {
  it('deals first-strike combat damage and makes only that player discard randomly', () => {
    const done = combat('ringleader/random');
    expect(done.state.players.map((player) => player.life)).toEqual([20, 17]);
    expect(done.state.players[1].hand).toHaveLength(2);
    expect(done.state.players[1].graveyard).toHaveLength(1);
    expect(eventsOfType(done.events, 'handRevealed')).toEqual([]);
    expect(eventsOfType(done.events, 'abilityTriggered')).toHaveLength(1);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('is seed-replayable, handles an empty hand, and does not trigger through a blocker', () => {
    const first = combat('ringleader/replay');
    const second = combat('ringleader/replay');
    expect(first.state.players[1].graveyard).toEqual(second.state.players[1].graveyard);
    expect(combat('ringleader/empty', []).state.players[1].graveyard).toEqual([]);
    const blocked = combat('ringleader/blocked', HELD, true);
    expect(blocked.state.players[1].hand).toHaveLength(HELD.length);
    expect(eventsOfType(blocked.events, 'abilityTriggered')).toEqual([]);
  });
});
