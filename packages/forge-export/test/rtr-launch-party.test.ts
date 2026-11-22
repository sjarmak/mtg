import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const LAUNCH_PARTY = parseCard({
  kind: 'instant',
  id: 'rtr-69-launch-party-forge',
  name: 'Launch Party',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 69 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'loseLife', amount: 2, target: { kind: 'thatCreaturesController' } },
  ],
} as unknown as CardInput);

describe('RTR #69 Launch Party Forge export', () => {
  it('matches the current upstream sacrifice cost and linked controller subability', () => {
    expect(mustTranspile(LAUNCH_PARTY)).toBe(
      [
        'Name:Launch Party',
        'ManaCost:3 B',
        'Types:Instant',
        'A:SP$ Destroy | Cost$ 3 B Sac<1/Creature> | ValidTgts$ Creature | SubAbility$ DBEffect1 | SpellDescription$ Destroy target creature. Its controller loses 2 life.',
        'SVar:DBEffect1:DB$ LoseLife | Defined$ TargetedController | LifeAmount$ 2',
        'Oracle:As an additional cost to cast this spell, sacrifice a creature.\\nDestroy target creature. Its controller loses 2 life.',
        '',
      ].join('\n'),
    );
  });
});
