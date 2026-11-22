/** Installed Forge 2.0.14 parity for RTR #135 Slime Molding. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SLIME_MOLDING = parseCard({
  kind: 'sorcery',
  id: 'rtr-135-slime-molding-forge',
  name: 'Slime Molding',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 135 },
  manaCost: { G: 1, hasX: true },
  colors: ['G'],
  effects: [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Ooze',
        power: 0,
        toughness: 0,
        creationPowerToughness: { kind: 'chosenX' },
        colors: ['G'],
        subtypes: ['Ooze'],
        keywords: [],
      },
    },
  ],
} as CardInput);

describe('RTR #135 Slime Molding Forge export', () => {
  it('emits the installed chosen-X token API exactly', () => {
    expect(mustTranspile(SLIME_MOLDING)).toBe(
      [
        'Name:Slime Molding',
        'ManaCost:X G',
        'Types:Sorcery',
        'A:SP$ Token | TokenScript$ g_x_x_ooze | TokenOwner$ You | TokenPower$ X | TokenToughness$ X | SpellDescription$ Create an X/X green Ooze creature token.',
        'SVar:X:Count$xPaid',
        'DeckHas:Ability$Token',
        'Oracle:Create an X/X green Ooze creature token.',
        '',
      ].join('\n'),
    );
  });
});
