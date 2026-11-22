/** Installed Forge parity for RTR Search Warrant. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SEARCH_WARRANT = parseCard({
  kind: 'sorcery',
  id: 'rtr-193-search-warrant-forge',
  name: 'Search Warrant',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 193 },
  manaCost: { W: 1, U: 1 },
  colors: ['W', 'U'],
  effects: [
    { kind: 'revealHand', target: { kind: 'targetPlayer' } },
    {
      kind: 'gainLife',
      amount: 0,
      amountFrom: 'thatPlayersHandSize',
      target: { kind: 'noTarget' },
    },
  ],
});

describe('Search Warrant Forge export', () => {
  it('emits the installed targeted reveal and targeted-player hand count exactly', () => {
    expect(mustTranspile(SEARCH_WARRANT)).toBe(
      [
        'Name:Search Warrant',
        'ManaCost:W U',
        'Types:Sorcery',
        "A:SP$ RevealHand | ValidTgts$ Player | SubAbility$ DBGainLife | SpellDescription$ Target player reveals their hand. You gain life equal to the number of cards in that player's hand.",
        'SVar:DBGainLife:DB$ GainLife | Defined$ You | LifeAmount$ X',
        'SVar:X:Count$ValidHand Card.TargetedPlayerOwn',
        "Oracle:Target player reveals their hand. You gain life equal to the number of cards in that player's hand.",
        '',
      ].join('\n'),
    );
  });
});
