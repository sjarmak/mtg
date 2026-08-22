import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { PreconDeck } from '@mtg/deckbuild';
import { dealPreconTable } from '@mtg/netplay';
import { twoDecks } from './decks';

function precon(name: string, cards: readonly Card[], basic: 'Mountain' | 'Forest'): PreconDeck {
  const spells = cards.filter((card) => card.kind !== 'land');
  const payoff = spells[0];
  if (payoff === undefined) throw new Error('test deck has no spell');
  return {
    id: name.toLowerCase(),
    name,
    plan: `Cast ${name}.`,
    payoff: payoff.id,
    deckSize: 40,
    spells: spells.map((card) => ({ id: card.id, count: 1 })),
    basics: basic === 'Mountain' ? { R: 17 } : { G: 17 },
  };
}

describe('dealing written decks to a network table', () => {
  it('puts the selected precon in each named seat', () => {
    const source = twoDecks();
    const set = [...source[0].cards, ...source[1].cards];
    const first = precon('Ember plan', source[0].cards, 'Mountain');
    const second = precon('Thorn plan', source[1].cards, 'Forest');
    const dealt = dealPreconTable({
      id: 'table-precon',
      set,
      decks: [first, second],
      seed: 'netplay/precon/v0',
      plan: [
        { name: 'One', token: 'one-token' },
        { name: 'Two', token: 'two-token' },
      ],
    });

    expect(dealt.decks.map((deck) => deck.name)).toEqual(['Ember plan', 'Thorn plan']);
    expect(dealt.decks.map((deck) => deck.cards.length)).toEqual([40, 40]);
    expect(dealt.spec.setup.seed).toBe('netplay/precon/v0');
    expect(dealt.spec.seating.map((seat) => seat.token)).toEqual(['one-token', 'two-token']);
  });
});
