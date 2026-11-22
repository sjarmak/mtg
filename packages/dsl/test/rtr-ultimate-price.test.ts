/** Exact hand-authored monocolored targeting for RTR Ultimate Price. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { ModelEffectSchema, renderOracleText, safeParseCard, TargetFilterSchema } from '../src/index';
import { parseCard } from '../src/parse';

const ULTIMATE_PRICE_INPUT = {
  kind: 'instant',
  id: 'rtr-82-ultimate-price',
  name: 'Ultimate Price',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 82 },
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { monocolored: true } },
    },
  ],
} as const;

describe('Ultimate Price DSL', () => {
  it('renders the exact current Oracle text outside model output', () => {
    const card = parseCard(ULTIMATE_PRICE_INPUT as unknown as CardInput);
    const effect = card.effects[0];

    expect(renderOracleText(card)).toBe('Destroy target monocolored creature.');
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('admits one canonical true-only monocolored predicate', () => {
    expect(TargetFilterSchema.parse({ monocolored: true })).toEqual({ monocolored: true });
    expect(TargetFilterSchema.safeParse({ monocolored: false }).success).toBe(false);

    const empty = safeParseCard({
      ...ULTIMATE_PRICE_INPUT,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetCreature', filter: {} },
        },
      ],
    } as unknown as CardInput);
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('empty Ultimate Price filter unexpectedly parsed');
    expect(empty.violations.map((violation) => violation.code)).toContain('ILLEGAL_TARGET_FILTER');
  });
});
