/** Triskelion's intrinsic counters and counter-removal activation cost. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '../src/index';

function triskelion(overrides: Partial<CardInput> = {}): CardInput {
  return {
    kind: 'creature',
    artifact: true,
    id: 'tst-triskelion',
    name: 'Triskelion',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 218 },
    colors: [],
    manaCost: { generic: 6 },
    power: 1,
    toughness: 1,
    entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 3 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, removeCounter: { counter: 'plusOnePlusOne', count: 1 } },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
    ],
    ...overrides,
  } as CardInput;
}

describe('counter-backed activation costs', () => {
  it('prints Triskelion exactly from two structured payments', () => {
    expect(renderOracleText(parseCard(triskelion()))).toBe(
      'Triskelion enters with three +1/+1 counters on it.\n' +
        'Remove a +1/+1 counter from Triskelion: Triskelion deals 1 damage to any target.',
    );
  });

  it('refuses a zero counter payment', () => {
    const input = triskelion();
    const ability = input.abilities?.[0];
    if (ability?.kind !== 'activated') throw new Error('fixture lost its activation');
    const result = safeParseCard({
      ...input,
      abilities: [
        {
          ...ability,
          cost: { ...ability.cost, removeCounter: { counter: 'plusOnePlusOne', count: 0 } },
        },
      ],
    });
    expect(result.ok ? [] : result.violations.map((found) => [found.code, found.path])).toContainEqual([
      'ABILITY_COST_INVALID',
      'abilities[0].cost.removeCounter.count',
    ]);
  });

  it('keeps the payment outside the generator-facing ability schema', () => {
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'activated',
        cost: { mana: {}, removeCounter: { counter: 'plusOnePlusOne', count: 1 } },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      }).success,
    ).toBe(false);
  });
});
