/** A battlefield-filtered sacrifice cost, including its own source. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import {
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '../src/index';

function bloodthrone(cost: unknown): CardInput {
  return {
    kind: 'creature',
    id: 'tst-bloodthrone-vampire',
    name: 'Bloodthrone Vampire',
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 85 },
    colors: ['B'],
    manaCost: { generic: 1, B: 1 },
    subtypes: ['Vampire'],
    power: 1,
    toughness: 1,
    abilities: [
      {
        kind: 'activated',
        cost,
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 2,
            target: { kind: 'selfCreature' },
          },
        ],
      },
    ],
  } as CardInput;
}

function violations(cost: unknown): readonly (readonly [string, string])[] {
  const result = safeParseCard(bloodthrone(cost));
  return result.ok ? [] : result.violations.map((found) => [found.code, found.path]);
}

describe('a filtered permanent sacrifice activation cost', () => {
  it('prints Bloodthrone Vampire exactly', () => {
    expect(
      renderOracleText(
        parseCard(
          bloodthrone({
            mana: {},
            sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
          }),
        ),
      ),
    ).toBe('Sacrifice a creature: This creature gets +2/+2 until end of turn.');
  });

  it('refuses an empty filter and counts outside the bounded payment envelope', () => {
    expect(violations({ mana: {}, sacrificeMatching: { count: 1, filter: {} } })).toContainEqual([
      'ILLEGAL_TARGET_FILTER',
      'abilities[0].cost.sacrificeMatching.filter',
    ]);
    expect(
      violations({
        mana: {},
        sacrificeMatching: { count: 0, filter: { cardTypes: ['creature'] } },
      }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.sacrificeMatching.count']);
    expect(
      violations({
        mana: {},
        sacrificeMatching: { count: 5, filter: { cardTypes: ['creature'] } },
      }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.sacrificeMatching.count']);
  });

  it('refuses combining the inclusive filtered payment with either older sacrifice spelling', () => {
    expect(
      violations({
        mana: {},
        sacrificeSelf: true,
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
      }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.sacrificeMatching']);
    expect(
      violations({
        mana: {},
        sacrificeOther: { count: 1, subtype: 'Vampire' },
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
      }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.sacrificeMatching']);
  });

  it('keeps the hand-authored payment outside both generator-facing cost schemas', () => {
    const ability = {
      kind: 'activated' as const,
      cost: {
        mana: {},
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] as const } },
      },
      effects: [{ kind: 'scry' as const, count: 1 }],
    };
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    expect(MechanicModelAbilitySchema.safeParse(ability).success).toBe(false);
  });
});
