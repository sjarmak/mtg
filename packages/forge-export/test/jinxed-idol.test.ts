/** Source-attested Forge parity for M11 Jinxed Idol. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'artifact',
  id: 'm11-208-jinxed-idol-forge',
  name: 'Jinxed Idol',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 208 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
      effects: [
        {
          kind: 'targetPlayerGainsControlOfSelfPermanent',
          target: { kind: 'targetOpponent' },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('Jinxed Idol Forge export', () => {
  it('emits source-attested effect clauses without temporary control', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        'Name:Jinxed Idol',
        'ManaCost:2',
        'Types:Artifact',
        'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of your upkeep, CARDNAME deals 2 damage to you.',
        'SVar:Trig1Effect1:DB$ DealDamage | Defined$ You | NumDmg$ 2',
        'A:AB$ GainControl | Cost$ Sac<1/Creature> | Defined$ Self | ValidTgts$ Opponent | SpellDescription$ Target opponent gains control of CARDNAME.',
        'Oracle:At the beginning of your upkeep, this artifact deals 2 damage to you.\\nSacrifice a creature: Target opponent gains control of this artifact.',
        '',
      ].join('\n'),
    );
  });
});
