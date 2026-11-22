/** Installed Forge 2.0.14 parity for RTR #52. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-052-sphinx-of-the-chimes-forge',
  name: 'Sphinx of the Chimes',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 52 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Sphinx'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: {},
        discardMatching: { count: 2, filter: 'nonland', relation: 'sameName' },
      },
      effects: [{ kind: 'drawCards', count: 4, target: { kind: 'noTarget' } }],
    },
  ],
} as CardInput);

describe('RTR #52 Sphinx of the Chimes Forge export', () => {
  it('emits the installed pair constraint and exact cost description', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        'Name:Sphinx of the Chimes',
        'ManaCost:4 U U',
        'Types:Creature Sphinx',
        'PT:5/6',
        'K:Flying',
        'A:AB$ Draw | Cost$ Discard<2/Card.nonLand+WithSameName/nonland cards with the same name> | NumCards$ 4 | CostDesc$ Discard two nonland cards with the same name | SpellDescription$ Draw four cards.',
        'Oracle:Flying\\nDiscard two nonland cards with the same name: Draw four cards.',
        '',
      ].join('\n'),
    );
  });
});
