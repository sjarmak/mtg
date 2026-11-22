import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const GOLGARI_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-164-golgari-charm-forge',
  name: 'Golgari Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 164 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['enchantment'] } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'regeneratePermanent',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('RTR #164 Golgari Charm Forge export', () => {
  it('exports the installed Forge Charm choices and scoped regeneration exactly', () => {
    expect(mustTranspile(GOLGARI_CHARM)).toBe(
      [
        'Name:Golgari Charm',
        'ManaCost:B G',
        'Types:Instant',
        'A:SP$ Charm | Choices$ Mode1,Mode2,Mode3',
        'SVar:Mode1:DB$ PumpAll | ValidCards$ Creature | NumAtt$ -1 | NumDef$ -1 | IsCurse$ True | SpellDescription$ All creatures get -1/-1 until end of turn.',
        'SVar:Mode2:DB$ Destroy | ValidTgts$ Enchantment | SpellDescription$ Destroy target enchantment.',
        'SVar:Mode3:DB$ Regenerate | Defined$ Valid Creature.YouCtrl | SpellDescription$ Regenerate each creature you control.',
        'Oracle:Choose one —\\n• All creatures get -1/-1 until end of turn.\\n• Destroy target enchantment.\\n• Regenerate each creature you control.',
        '',
      ].join('\n'),
    );
  });
});
