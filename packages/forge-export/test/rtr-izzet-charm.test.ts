import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const IZZET_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-172-izzet-charm-forge',
  name: 'Izzet Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 172 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'counterSpell',
          spellFilter: { excludeCardTypes: ['creature'] },
          unlessCost: { generic: 2 },
        },
      ],
    },
    { effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }] },
    {
      effects: [
        { kind: 'drawCards', count: 2, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 2, target: { kind: 'noTarget' } },
      ],
    },
  ],
} as unknown as CardInput);

describe('RTR #172 Izzet Charm Forge export', () => {
  it('exports the installed Forge Charm choices and mode-local toll exactly', () => {
    expect(mustTranspile(IZZET_CHARM)).toBe(
      [
        'Name:Izzet Charm',
        'ManaCost:U R',
        'Types:Instant',
        'A:SP$ Charm | Choices$ Mode1,Mode2,Mode3',
        'SVar:Mode1:DB$ Counter | TargetType$ Spell | ValidTgts$ Card.nonCreature | TgtPrompt$ Select target noncreature spell | UnlessCost$ 2 | SpellDescription$ Counter target noncreature spell unless its controller pays {2}.',
        'SVar:Mode2:DB$ DealDamage | ValidTgts$ Creature | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to target creature.',
        'SVar:Mode3:DB$ Draw | Defined$ You | NumCards$ 2 | SubAbility$ Mode3Effect1 | SpellDescription$ Draw two cards, then discard two cards.',
        'SVar:Mode3Effect1:DB$ Discard | Defined$ You | NumCards$ 2 | Mode$ TgtChoose',
        'Oracle:Choose one —\\n• Counter target noncreature spell unless its controller pays {2}.\\n• Izzet Charm deals 2 damage to target creature.\\n• Draw two cards, then discard two cards.',
        '',
      ].join('\n'),
    );
  });
});
