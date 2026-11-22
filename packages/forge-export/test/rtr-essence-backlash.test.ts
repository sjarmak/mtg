import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const ESSENCE_BACKLASH = parseCard({
  kind: 'instant',
  id: 'rtr-160-essence-backlash-forge',
  name: 'Essence Backlash',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 160 },
  manaCost: { generic: 2, U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [
    {
      kind: 'counterSpell',
      spellFilter: { cardTypes: ['creature'] },
      dealDamageToControllerEqualToSpellPower: true,
    },
  ],
});

describe('RTR #160 Essence Backlash Forge export', () => {
  it('matches the installed Forge script exactly', () => {
    expect(mustTranspile(ESSENCE_BACKLASH)).toBe(
      [
        'Name:Essence Backlash',
        'ManaCost:2 U R',
        'Types:Instant',
        "A:SP$ Counter | TargetType$ Spell | ValidTgts$ Card.Creature | TgtPrompt$ Select target creature spell | SubAbility$ DBEffect1 | SpellDescription$ Counter target creature spell. CARDNAME deals damage equal to that spell's power to its controller.",
        'SVar:DBEffect1:DB$ DealDamage | NumDmg$ Backlash | Defined$ TargetedController',
        'SVar:Backlash:Targeted$CardPower',
        "Oracle:Counter target creature spell. Essence Backlash deals damage equal to that spell's power to its controller.",
        '',
      ].join('\n'),
    );
  });
});
