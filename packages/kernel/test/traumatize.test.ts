/** Traumatize through public targeting, casting, and native mill resolution. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard, validateCards } from '@mtg/dsl';
import type { PlayerId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, playerOf, scenario, targetChoicesFor } from '@mtg/kernel';
import { creature, ISLAND, lands } from './cards';
import { apply, handOidOf } from './helpers';

const TRAUMATIZE: Card = parseCard({
  kind: 'sorcery',
  id: 'm11-077',
  name: 'Traumatize',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 77 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  effects: [
    {
      kind: 'millCards',
      count: { kind: 'halfTargetLibraryRoundedDown' },
      target: { kind: 'targetPlayer' },
    },
  ],
} as unknown as CardInput);

function library(owner: PlayerId, count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) =>
    creature(`Seat ${String(owner)} Library ${String(index + 1)}`, 1, 1),
  );
}

function board(casterCards: number, opponentCards: number): ReduceResult {
  return scenario({
    battlefield: lands(ISLAND, 5).map((card) => ({ card, controller: 0 as const })),
    hands: [[TRAUMATIZE], []],
    libraries: [library(0, casterCards), library(1, opponentCards)],
  });
}

function castAndResolve(start: ReduceResult, target: PlayerId): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, TRAUMATIZE.name),
    targets: [{ kind: 'player', player: target }],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

describe('Traumatize resolution', () => {
  it('offers either player and mills floor of the chosen library size', () => {
    const start = board(8, 7);
    expect(validateCards([TRAUMATIZE])).toEqual([]);
    expect(targetChoicesFor(start.state, TRAUMATIZE, 0)).toEqual([
      [
        { kind: 'player', player: 0 },
        { kind: 'player', player: 1 },
      ],
    ]);

    const done = castAndResolve(start, 1);
    expect(playerOf(done.state, 1).library).toHaveLength(4);
    expect(playerOf(done.state, 1).graveyard).toHaveLength(3);
    expect(playerOf(done.state, 0).library).toHaveLength(8);
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)).toMatchObject({ player: 1 });
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)?.oids).toHaveLength(3);
  });

  it('uses the same target-relative calculation for an even self-library', () => {
    const done = castAndResolve(board(8, 7), 0);
    expect(playerOf(done.state, 0).library).toHaveLength(4);
    expect(playerOf(done.state, 0).graveyard).toHaveLength(5);
    expect(playerOf(done.state, 1).library).toHaveLength(7);
  });
});
