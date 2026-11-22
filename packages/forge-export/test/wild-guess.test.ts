/** Source-attested Forge parity for M13 Wild Guess. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const WILD_GUESS = parseCard({
  kind: 'sorcery',
  id: 'm13-157-wild-guess-forge',
  name: 'Wild Guess',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 157 },
  colors: ['R'],
  manaCost: { R: 2 },
  additionalCost: { discard: 1 },
  effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
} as unknown as CardInput);

describe('Wild Guess Forge export', () => {
  it('matches the official spell discard-cost protocol', () => {
    expect(mustTranspile(WILD_GUESS)).toBe(
      [
        'Name:Wild Guess',
        'ManaCost:R R',
        'Types:Sorcery',
        'A:SP$ Draw | Cost$ R R Discard<1/Card/card> | CostDesc$ As an additional cost to cast this spell, discard a card. | Defined$ You | NumCards$ 2 | SpellDescription$ Draw two cards.',
        'Oracle:As an additional cost to cast this spell, discard a card.\\nDraw two cards.',
        '',
      ].join('\n'),
    );
  });
});
