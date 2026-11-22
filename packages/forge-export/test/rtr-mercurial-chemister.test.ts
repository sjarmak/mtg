/** Source-attested Forge parity for RTR Mercurial Chemister. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CHEMISTER = parseCard({
  kind: 'creature',
  id: 'rtr-180-mercurial-chemister-forge',
  name: 'Mercurial Chemister',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 180 },
  colors: ['U', 'R'],
  manaCost: { generic: 3, U: 1, R: 1 },
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { U: 1 }, tapSelf: true },
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      printedSourceReference: 'thisCreature',
      cost: { mana: { R: 1 }, tapSelf: true, discard: 1 },
      effects: [
        { kind: 'dealDamage', amount: { kind: 'paidDiscardManaValue' }, target: { kind: 'targetCreature' } },
      ],
    },
  ],
} as CardInput);

describe('Mercurial Chemister Forge export', () => {
  it('matches the installed Discarded$CardManaCost protocol', () => {
    expect(mustTranspile(CHEMISTER)).toBe(
      [
        'Name:Mercurial Chemister',
        'ManaCost:3 U R',
        'Types:Creature Human Wizard',
        'PT:2/3',
        'A:AB$ Draw | Cost$ U T | NumCards$ 2 | SpellDescription$ Draw two cards.',
        "A:AB$ DealDamage | Cost$ R T Discard<1/Card> | ValidTgts$ Creature | NumDmg$ X | SpellDescription$ CARDNAME deals damage to target creature equal to the discarded card's mana value.",
        'SVar:X:Discarded$CardManaCost',
        "Oracle:{U}, {T}: Draw two cards.\\n{R}, {T}, Discard a card: This creature deals damage to target creature equal to the discarded card's mana value.",
        '',
      ].join('\n'),
    );
  });
});
