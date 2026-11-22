import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Destructive Force', () => {
  /** Source: Card-Forge/forge current `forge-gui/res/cardsfolder/d/destructive_force.txt`. */
  it('writes Forge per-player sacrifice and chained damage grammar exactly', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-133',
      name: 'Destructive Force',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 133 },
      manaCost: { generic: 5, R: 2 },
      colors: ['R'],
      effects: [
        {
          kind: 'sacrificePermanent',
          count: 5,
          filter: { cardTypes: ['land'] },
          players: 'eachPlayer',
          target: { kind: 'noTarget' },
        },
        {
          kind: 'dealDamage',
          amount: 5,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Destructive Force',
        'ManaCost:5 R R',
        'Types:Sorcery',
        'A:SP$ Sacrifice | Defined$ Player | SacValid$ Land | Amount$ 5 | SubAbility$ DBEffect1 | SpellDescription$ Each player sacrifices five lands of their choice. CARDNAME deals 5 damage to each creature.',
        'SVar:DBEffect1:DB$ DamageAll | ValidCards$ Creature | NumDmg$ 5',
        'DeckHas:Ability$Sacrifice',
        'Oracle:Each player sacrifices five lands of their choice. Destructive Force deals 5 damage to each creature.',
        '',
      ].join('\n'),
    );
  });
});
