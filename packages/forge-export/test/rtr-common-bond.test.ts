import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const COMMON_BOND = parseCard({
  kind: 'instant',
  id: 'rtr-151-common-bond-forge',
  name: 'Common Bond',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 151 },
  manaCost: { generic: 1, G: 1, W: 1 },
  colors: ['G', 'W'],
  printedEffectParagraphBreaks: [1],
  effects: [
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
  ],
} as unknown as CardInput);

describe('RTR #151 Common Bond Forge export', () => {
  it('matches the current upstream pair of independently targeted counter abilities', () => {
    expect(mustTranspile(COMMON_BOND)).toBe(
      [
        'Name:Common Bond',
        'ManaCost:1 W G',
        'Types:Instant',
        'A:SP$ PutCounter | ValidTgts$ Creature | CounterType$ P1P1 | CounterNum$ 1 | SubAbility$ DBEffect1 | SpellDescription$ Put a +1/+1 counter on target creature. Put a +1/+1 counter on target creature.',
        'SVar:DBEffect1:DB$ PutCounter | ValidTgts$ Creature | CounterType$ P1P1 | CounterNum$ 1',
        'Oracle:Put a +1/+1 counter on target creature.\\nPut a +1/+1 counter on target creature.',
        '',
      ].join('\n'),
    );
  });
});
