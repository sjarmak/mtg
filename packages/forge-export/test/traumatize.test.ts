import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Traumatize', () => {
  /**
   * Source: Card-Forge/forge current `forge-gui/res/cardsfolder/t/traumatize.txt`.
   */
  it('writes Forge target-library HalfDown grammar exactly', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-077',
      name: 'Traumatize',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 77 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      effects: [
        {
          kind: 'millCards',
          count: { kind: 'halfTargetLibraryRoundedDown' },
          target: { kind: 'targetPlayer' },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Traumatize',
        'ManaCost:3 U U',
        'Types:Sorcery',
        'A:SP$ Mill | ValidTgts$ Player | NumCards$ X | SpellDescription$ Target player mills half their library, rounded down.',
        'SVar:X:TargetedPlayer$CardsInLibrary/HalfDown',
        'Oracle:Target player mills half their library, rounded down.',
        '',
      ].join('\n'),
    );
  });
});
