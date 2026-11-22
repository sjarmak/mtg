/** Source-attested Forge parity for M13 Omniscience. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Omniscience Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm13-63-omniscience-forge',
      name: 'Omniscience',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 63 },
      manaCost: { generic: 7, U: 3 },
      colors: ['U'],
      abilities: [
        {
          kind: 'staticPlayerRule',
          players: 'controller',
          rule: 'castSpellsFromHandWithoutPayingManaCost',
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Omniscience',
        'ManaCost:7 U U U',
        'Types:Enchantment',
        'S:Mode$ Continuous | Affected$ Card.nonLand+YouOwn | MayPlay$ True | MayPlayWithoutManaCost$ True | AffectedZone$ Hand | Description$ You may cast spells from your hand without paying their mana costs.',
        'Oracle:You may cast spells from your hand without paying their mana costs.',
        '',
      ].join('\n'),
    );
  });
});
