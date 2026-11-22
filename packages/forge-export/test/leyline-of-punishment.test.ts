/** Source-attested Forge parity for M11 Leyline of Punishment. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Leyline of Punishment Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-148-leyline-of-punishment-forge',
      name: 'Leyline of Punishment',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 148 },
      manaCost: { generic: 2, R: 2 },
      colors: ['R'],
      openingHandAction: { kind: 'beginOnBattlefield' },
      abilities: [
        { kind: 'staticGameRule', rule: 'playersCantGainLife' },
        { kind: 'staticGameRule', rule: 'damageCantBePrevented' },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Leyline of Punishment',
        'ManaCost:2 R R',
        'Types:Enchantment',
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
        "S:Mode$ CantGainLife | ValidPlayer$ Player | Description$ Players can't gain life.",
        "S:Mode$ CantPreventDamage | Description$ Damage can't be prevented.",
        'SVar:NonStackingEffect:True',
        "Oracle:If Leyline of Punishment is in your opening hand, you may begin the game with it on the battlefield.\\nPlayers can't gain life.\\nDamage can't be prevented.",
        '',
      ].join('\n'),
    );
  });
});
