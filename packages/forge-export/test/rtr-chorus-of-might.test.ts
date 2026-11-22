import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CREATURES_YOU_CONTROL = {
  kind: 'countMatching',
  filter: { cardTypes: ['creature'] },
} as const;

const CHORUS_OF_MIGHT = parseCard({
  kind: 'instant',
  id: 'rtr-119-chorus-of-might-forge',
  name: 'Chorus of Might',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 119 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      toughness: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      keyword: 'trample',
      printedDurationFirst: true,
      target: { kind: 'targetCreature' },
    },
  ],
} as unknown as CardInput);

describe('RTR #119 Chorus of Might Forge export', () => {
  it('matches the current upstream counted Pump action and source text', () => {
    expect(mustTranspile(CHORUS_OF_MIGHT)).toBe(
      [
        'Name:Chorus of Might',
        'ManaCost:3 G',
        'Types:Instant',
        'A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +Y | NumDef$ +Y | KW$ Trample | SpellDescription$ Until end of turn, target creature gets +1/+1 for each creature you control and gains trample.',
        'SVar:Y:Count$Valid Creature.YouCtrl',
        'Oracle:Until end of turn, target creature gets +1/+1 for each creature you control and gains trample.',
        '',
      ].join('\n'),
    );
  });
});
