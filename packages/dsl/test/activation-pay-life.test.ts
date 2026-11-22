/** A life payment in an ordinary hand-authored activation cost. */
import { describe, expect, it } from 'vitest';
import {
  ActivationCostSchema,
  MechanicModelActivationCostSchema,
  ModelActivationCostSchema,
} from '../src/ability-shape';
import { parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

function ledger(cost: unknown): CardInput {
  return {
    kind: 'artifact',
    id: 'tst-blood-ledger',
    name: 'Blood Ledger',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 4 },
    abilities: [
      {
        kind: 'activated',
        cost,
        effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
      },
    ],
  } as CardInput;
}

describe('life paid as an activation cost', () => {
  it('accepts a positive integer as a bounded cost and refuses non-payments', () => {
    expect(ActivationCostSchema.parse({ mana: {}, payLife: 1 })).toEqual({
      mana: expect.objectContaining({ generic: 0 }),
      tapSelf: false,
      sacrificeSelf: false,
      payLife: 1,
    });
    expect(safeParseCard(ledger({ mana: {}, payLife: 1 })).ok).toBe(true);

    for (const payLife of [0, -1, 1.5]) {
      expect(ActivationCostSchema.safeParse({ mana: {}, payLife }).success, String(payLife)).toBe(false);
    }
  });

  it('prints the payment after mana and the tap symbol', () => {
    expect(
      renderOracleText(
        parseCard(
          ledger({
            mana: { generic: 1 },
            tapSelf: true,
            payLife: 1,
          }),
        ),
      ),
    ).toBe('{1}, {T}, Pay 1 life: You gain 4 life.');
  });

  it('keeps life payment outside both generator-facing cost schemas', () => {
    const cost = { mana: { generic: 1 }, tapSelf: true, payLife: 1 };
    expect(ModelActivationCostSchema.safeParse(cost).success).toBe(false);
    expect(MechanicModelActivationCostSchema.safeParse(cost).success).toBe(false);
  });

  it('refuses it on a mana ability until that immediate-payment path supports it', () => {
    const result = safeParseCard({
      ...ledger({ mana: {}, tapSelf: true, payLife: 1 }),
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, payLife: 1 },
          effects: [{ kind: 'addMana', produces: ['B'], amount: 1 }],
        },
      ],
    } as CardInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('pay-life mana ability unexpectedly parsed');
    expect(result.violations.map((violation) => violation.code)).toContain('MANA_ABILITY_INVALID');
  });
});
