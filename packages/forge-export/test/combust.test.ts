/** Source-attested Forge parity for M11 Combust. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Combust Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'm11-130-combust-forge',
      name: 'Combust',
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 130 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      cannotBeCountered: true,
      effects: [
        {
          kind: 'dealDamage',
          amount: 5,
          target: { kind: 'targetCreature', filter: { colors: ['W', 'U'] } },
          preventable: false,
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Combust',
        'ManaCost:1 R',
        'Types:Instant',
        "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
        "A:SP$ DealDamage | ValidTgts$ Creature.White,Creature.Blue | NumDmg$ 5 | NoPrevention$ True | TgtPrompt$ Select target white or blue creature. | SpellDescription$ CARDNAME deals 5 damage to target white or blue creature. The damage can't be prevented.",
        "Oracle:This spell can't be countered.\\nCombust deals 5 damage to target white or blue creature. The damage can't be prevented.",
        '',
      ].join('\n'),
    );
  });
});
