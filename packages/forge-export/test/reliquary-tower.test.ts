/** Source-attested Forge parity for M13 Reliquary Tower. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Reliquary Tower Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'land',
      id: 'm13-227-reliquary-tower-forge',
      name: 'Reliquary Tower',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 227 },
      producesMana: ['C'],
      abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'noMaximumHandSize' }],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Reliquary Tower',
        'ManaCost:no cost',
        'Types:Land',
        'S:Mode$ Continuous | Affected$ You | SetMaxHandSize$ Unlimited | Description$ You have no maximum hand size.',
        'A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add {C}.',
        'Oracle:You have no maximum hand size.\\n{T}: Add {C}.',
        '',
      ].join('\n'),
    );
  });
});
