/** Installed-Forge parity for RTR Gobbling Ooze's source-excluding payment. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-126-gobbling-ooze-forge',
  name: 'Gobbling Ooze',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 126 },
  colors: ['G'],
  manaCost: { generic: 4, G: 1 },
  subtypes: ['Ooze'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: { G: 1 },
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
        },
      },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

describe('RTR Gobbling Ooze Forge export', () => {
  it('matches the installed source cost and PutCounter protocol', () => {
    const line = mustTranspile(CARD)
      .split('\n')
      .find((candidate) => candidate.startsWith('A:'));

    expect(line).toBe(
      'A:AB$ PutCounter | Cost$ G Sac<1/Creature.Other/another creature> | CounterType$ P1P1 | CounterNum$ 1 | SpellDescription$ Put a +1/+1 counter on CARDNAME.',
    );
  });
});
