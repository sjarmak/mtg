/** Source-attested Forge spelling for a life-paid activation. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('activation life-payment Forge parity', () => {
  it('writes PayLife after mana and the tap symbol', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm13-220-pay-life',
      name: 'Blood Ledger',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 220 },
      colors: [],
      manaCost: { generic: 4 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, tapSelf: true, payLife: 1 },
          effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'A:AB$ GainLife | Cost$ 1 T PayLife<1> | Defined$ You | LifeAmount$ 4 | SpellDescription$ You gain 4 life.',
    );
  });
});
