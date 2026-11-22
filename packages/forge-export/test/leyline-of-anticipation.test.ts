/** Source-attested Forge parity for M11 Leyline of Anticipation. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Leyline of Anticipation Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-61-leyline-of-anticipation-forge',
      name: 'Leyline of Anticipation',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 61 },
      manaCost: { generic: 2, U: 2 },
      colors: ['U'],
      openingHandAction: { kind: 'beginOnBattlefield' },
      abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'castSpellsAsThoughFlash' }],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Leyline of Anticipation',
        'ManaCost:2 U U',
        'Types:Enchantment',
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
        'S:Mode$ CastWithFlash | ValidCard$ Card | ValidSA$ Spell | Caster$ You | Description$ You may cast spells as though they had flash.',
        'SVar:NonStackingEffect:True',
        'Oracle:If Leyline of Anticipation is in your opening hand, you may begin the game with it on the battlefield.\\nYou may cast spells as though they had flash.',
        '',
      ].join('\n'),
    );
  });
});
