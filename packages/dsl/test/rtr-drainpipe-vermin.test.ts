/** Exact hand-authored paid optional death trigger for RTR Drainpipe Vermin. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput } from '../src/index';
import { ModelAbilitySchema, renderOracleText, safeParseCard } from '../src/index';
import { parseCard } from '../src/parse';

const TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  printedSourceReference: 'thisCreature',
  optional: true,
  optionalControllerPayment: { cost: { B: 1 } },
  effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
};

function vermin(ability: AbilityInput = TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-066-drainpipe-vermin',
    name: 'Drainpipe Vermin',
    rarity: 'common',
    set: { code: 'RTR', collectorNumber: 66 },
    manaCost: { B: 1 },
    colors: ['B'],
    subtypes: ['Rat'],
    power: 1,
    toughness: 1,
    abilities: [ability],
  };
}

describe('Drainpipe Vermin DSL', () => {
  it('renders exact current Oracle and remains outside model output', () => {
    const card = parseCard(vermin());
    expect(ModelAbilitySchema.safeParse(TRIGGER).success).toBe(false);
    expect(renderOracleText(card)).toBe(
      'When this creature dies, you may pay {B}. If you do, target player discards a card.',
    );
  });

  it('refuses an independent payment field outside the exact optional one-effect envelope', () => {
    for (const ability of [
      { ...TRIGGER, optional: undefined },
      { ...TRIGGER, effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
    ] as AbilityInput[]) {
      const result = safeParseCard(vermin(ability));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('near-miss paid trigger parsed');
      expect(result.violations.map(({ code }) => code)).toContain('PAID_OPTIONAL_TRIGGER_INVALID');
    }
  });
});
