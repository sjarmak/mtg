/** Exact authored DSL shapes for evenly divided and allocated damage. */
import { describe, expect, it } from 'vitest';
import type { CardInput, EffectInput, TargetSpec } from '../src/index';
import {
  CardSchema,
  EffectSchema,
  ModelEffectSchema,
  ModelTargetSpecSchema,
  parseCard,
  renderOracleText,
  TargetSpecSchema,
  validateCard,
} from '../src/index';

const FIREBALL_INPUT = {
  kind: 'sorcery',
  id: 'm11-138-fireball',
  name: 'Fireball',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 138 },
  manaCost: { R: 1, hasX: true },
  colors: ['R'],
  targetCostIncrease: { genericPerTargetBeyondFirst: 1 },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'anyTarget', anyNumber: true },
      division: { kind: 'evenlyRoundedDown' },
    },
  ],
} as unknown as CardInput;

const INFERNO_TITAN_INPUT = {
  kind: 'creature',
  id: 'm11-146-inferno-titan',
  name: 'Inferno Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 146 },
  manaCost: { generic: 4, R: 2 },
  colors: ['R'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          target: { kind: 'anyTarget', count: 3, minimum: 1 },
          division: { kind: 'asYouChoose' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { R: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 0,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
} as unknown as CardInput;

describe('divided-damage DSL', () => {
  it('prints Fireball exactly while keeping its authored rules outside the model schema', () => {
    const card = parseCard(FIREBALL_INPUT);
    const effect = card.effects[0];
    if (effect?.kind !== 'dealDamage') throw new Error('Fireball lost its damage effect');

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'This spell costs {1} more to cast for each target beyond the first.\n' +
        'Fireball deals X damage divided evenly, rounded down, among any number of targets.',
    );
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse(effect.target).success).toBe(false);
  });

  it('prints both exact Inferno Titan abilities and admits plural targets only on triggers', () => {
    const card = parseCard(INFERNO_TITAN_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Whenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.\n' +
        '{R}: This creature gets +1/+0 until end of turn.',
    );
  });

  it('keeps division, a target minimum, and target-count cost authored-only', () => {
    const divided = (FIREBALL_INPUT as { readonly effects: readonly unknown[] }).effects[0];
    const target = (divided as { readonly target: unknown }).target;

    expect(EffectSchema.safeParse(divided).success).toBe(true);
    expect(TargetSpecSchema.safeParse(target).success).toBe(true);
    expect(ModelEffectSchema.safeParse(divided).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse(target).success).toBe(false);
    expect(CardSchema.safeParse(FIREBALL_INPUT).success).toBe(true);
  });

  it('rejects division without plural targets and invalid allocation totals', () => {
    const ordinary = {
      kind: 'dealDamage',
      amount: 3,
      target: { kind: 'anyTarget' },
      division: { kind: 'asYouChoose' },
    } as unknown as EffectInput;
    const variableAllocation = {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'anyTarget', count: 3, minimum: 1 },
      division: { kind: 'asYouChoose' },
    } as unknown as EffectInput;
    const impossibleMinimum = {
      kind: 'dealDamage',
      amount: 2,
      target: { kind: 'anyTarget', count: 3, minimum: 3 },
      division: { kind: 'asYouChoose' },
    } as unknown as EffectInput;

    for (const effect of [ordinary, variableAllocation, impossibleMinimum]) {
      const record = CardSchema.parse({
        ...FIREBALL_INPUT,
        effects: [effect],
      });
      expect(validateCard(record).map((entry) => entry.code)).toContain('INVALID_DAMAGE_DIVISION');
    }
  });

  it('rejects contradictory or out-of-range plural cardinality', () => {
    const badTargets: readonly TargetSpec[] = [
      { kind: 'anyTarget', count: 3, minimum: 4 } as unknown as TargetSpec,
      { kind: 'anyTarget', anyNumber: true, minimum: 1 } as unknown as TargetSpec,
      { kind: 'anyTarget', count: 3, minimum: 0 } as unknown as TargetSpec,
    ];

    for (const target of badTargets) {
      const result = TargetSpecSchema.safeParse(target);
      if (!result.success) continue;
      const record = CardSchema.parse({
        ...INFERNO_TITAN_INPUT,
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [{ kind: 'dealDamage', amount: 3, target, division: { kind: 'asYouChoose' } }],
          },
        ],
      });
      expect(validateCard(record).map((entry) => entry.code)).toContain('ILLEGAL_TARGET_COUNT');
    }
  });
});
