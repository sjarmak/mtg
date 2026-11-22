/** Brittle Effigy's source-exile activation cost at the authoring boundary. */
import { describe, expect, it } from 'vitest';
import {
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';

const ABILITY = {
  kind: 'activated',
  cost: { mana: { generic: 4 }, tapSelf: true, exileSelf: true },
  effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
} as const;

const INPUT = {
  kind: 'artifact',
  id: 'm11-202',
  name: 'Brittle Effigy',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 202 },
  manaCost: { generic: 1 },
  colors: [],
  abilities: [ABILITY],
} as const;

describe('Brittle Effigy authoring', () => {
  it('prints mana, tap, and source exile as one activation cost', () => {
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('{4}, {T}, Exile Brittle Effigy: Exile target creature.');
  });

  it('keeps source exile outside both model-authored ability tiers', () => {
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
    expect(MechanicModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });

  it('refuses two competing ways for the source to pay itself', () => {
    const result = safeParseCard({
      ...INPUT,
      abilities: [
        {
          ...ABILITY,
          cost: { ...ABILITY.cost, sacrificeSelf: true },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'ABILITY_COST_INVALID',
        path: 'abilities[0].cost.exileSelf',
      }),
    ]);
  });
});
