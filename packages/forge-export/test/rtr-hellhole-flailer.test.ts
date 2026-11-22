/** Source-attested Forge parity for RTR's source-sacrifice activation. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const NAME = 'Hellhole Flailer';
const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-167-hellhole-flailer-forge',
  name: NAME,
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 167 },
  manaCost: { generic: 1, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Ogre', 'Warrior'],
  power: 3,
  toughness: 2,
  keywordAbilities: [{ kind: 'unleash' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, B: 1, R: 1 }, sacrificeSelf: true },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'paidSacrificePower' },
          target: { kind: 'targetPlayerOrPlaneswalker' },
        },
      ],
    },
  ],
} as CardInput);

describe('RTR source-sacrifice Forge export', () => {
  it('matches the official cost and sacrificed-card-power protocol', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        `Name:${NAME}`,
        'ManaCost:1 B R',
        'Types:Creature Ogre Warrior',
        'PT:3/2',
        'K:Unleash',
        'A:AB$ DealDamage | Cost$ 2 B R Sac<1/CARDNAME> | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select target player or planeswalker | NumDmg$ X | SpellDescription$ It deals damage equal to its power to target player or planeswalker.',
        'SVar:X:Sacrificed$CardPower',
        'Oracle:Unleash\\n{2}{B}{R}, Sacrifice this creature: It deals damage equal to its power to target player or planeswalker.',
        '',
      ].join('\n'),
    );
  });
});
