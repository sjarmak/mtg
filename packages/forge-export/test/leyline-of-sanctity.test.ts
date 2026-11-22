/** Source-attested Forge parity for M11 Leyline of Sanctity. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Leyline of Sanctity Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-21-leyline-of-sanctity-forge',
      name: 'Leyline of Sanctity',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 21 },
      manaCost: { generic: 2, W: 2 },
      colors: ['W'],
      openingHandAction: { kind: 'beginOnBattlefield' },
      abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Leyline of Sanctity',
        'ManaCost:2 W W',
        'Types:Enchantment',
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
        "S:Mode$ Continuous | Affected$ You | AddKeyword$ Hexproof | Description$ You have hexproof. (You can't be the target of spells or abilities your opponents control.)",
        'SVar:NonStackingEffect:True',
        "Oracle:If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.\\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)",
        '',
      ].join('\n'),
    );
  });
});
