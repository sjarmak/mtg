/** Source-attested Forge parity for M11 Fling. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { mustTranspile } from './helpers';

const FLING = parseCard({
  kind: 'instant',
  id: 'm11-139-fling-forge',
  name: 'Fling',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 139 },
  colors: ['R'],
  manaCost: { generic: 1, R: 1 },
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'paidSacrificePower' },
      target: { kind: 'anyTarget' },
    },
  ],
} as unknown as CardInput);

describe('Fling Forge export', () => {
  it('matches the official sacrifice-cost and retained-power protocol', () => {
    expect(mustTranspile(FLING)).toBe(
      [
        'Name:Fling',
        'ManaCost:1 R',
        'Types:Instant',
        "A:SP$ DealDamage | Cost$ 1 R Sac<1/Creature> | ValidTgts$ Any | NumDmg$ X | SpellDescription$ CARDNAME deals damage equal to the sacrificed creature's power to any target.",
        'SVar:X:Sacrificed$CardPower',
        "Oracle:As an additional cost to cast this spell, sacrifice a creature.\\nFling deals damage equal to the sacrificed creature's power to any target.",
        '',
      ].join('\n'),
    );
  });

  it('refuses a sacrifice filter that has no single source-proven Forge spelling', () => {
    const unsupported = parseCard({
      ...FLING,
      id: 'm11-139-fling-unmapped-cost',
      additionalCost: {
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature'], colors: ['R', 'G'] },
        },
      },
    } as CardInput);

    const result = transpileCard(unsupported);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unsupported sacrifice filter unexpectedly transpiled');
    expect(result.rejections).toContainEqual(
      expect.objectContaining({
        code: 'UNMAPPED_SPELL_ADDITIONAL_COST_FILTER',
        cardId: unsupported.id,
        path: 'additionalCost.sacrificeMatching.filter',
      }),
    );
  });
});
