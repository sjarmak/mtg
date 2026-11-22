/** Exact hand-authored vocabulary and Oracle text for RTR Havoc Festival. */
import {
  AbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const HALF_LIFE_TRIGGER = {
  kind: 'triggered' as const,
  condition: 'beginningOfEachPlayersUpkeep' as const,
  effects: [
    {
      kind: 'loseLife' as const,
      amount: 0,
      amountFrom: 'triggeringPlayerLifeHalfRoundedUp' as const,
      target: { kind: 'triggeringPlayer' as const },
    },
  ],
};

const HAVOC_FESTIVAL = parseCard({
  kind: 'enchantment',
  id: 'rtr-166-havoc-festival',
  name: 'Havoc Festival',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 166 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  abilities: [{ kind: 'staticGameRule', rule: 'playersCantGainLife' }, HALF_LIFE_TRIGGER],
});

function violationsFor(ability: unknown) {
  const result = safeParseCard({
    kind: 'enchantment',
    id: 'rtr-166-havoc-festival-hostile',
    name: 'Havoc Festival Hostile',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 166 },
    manaCost: { generic: 4, B: 1, R: 1 },
    colors: ['B', 'R'],
    abilities: [ability],
  });
  return result.ok ? validateCard(result.card) : result.violations;
}

describe('Havoc Festival in the DSL', () => {
  it('parses and renders the exact current Oracle text in printed order', () => {
    expect(validateCard(HAVOC_FESTIVAL)).toEqual([]);
    expect(renderOracleText(HAVOC_FESTIVAL)).toBe(
      "Players can't gain life.\nAt the beginning of each player's upkeep, that player loses half their life, rounded up.",
    );
  });

  it('keeps the live half-life bundle outside model output', () => {
    expect(AbilitySchema.safeParse(HALF_LIFE_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(HALF_LIFE_TRIGGER).success).toBe(false);
  });

  it('rejects every independently widened half-life shape', () => {
    const effect = HALF_LIFE_TRIGGER.effects[0];
    expect(violationsFor({ ...HALF_LIFE_TRIGGER, condition: 'beginningOfYourUpkeep' })).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].amountFrom',
      }),
    );
    expect(
      violationsFor({
        ...HALF_LIFE_TRIGGER,
        effects: [{ ...effect, target: { kind: 'targetPlayer' } }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].amountFrom',
      }),
    );
    expect(
      violationsFor({
        ...HALF_LIFE_TRIGGER,
        effects: [{ ...effect, amount: 1 }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[0].amount',
      }),
    );
    expect(
      violationsFor({
        ...HALF_LIFE_TRIGGER,
        effects: [{ ...effect, players: 'eachPlayer' }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].amountFrom',
      }),
    );
    expect(
      violationsFor({
        kind: 'activated',
        cost: { mana: {} },
        effects: [{ ...effect, target: { kind: 'targetPlayer' } }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].effects[0].amountFrom',
      }),
    );

    const spell = safeParseCard({
      kind: 'sorcery',
      id: 'rtr-166-havoc-festival-spell-hostile',
      name: 'Havoc Festival Spell Hostile',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 166 },
      manaCost: { B: 1 },
      colors: ['B'],
      effects: [{ ...effect, target: { kind: 'targetPlayer' } }],
    });
    expect(spell.ok ? validateCard(spell.card) : spell.violations).toContainEqual(
      expect.objectContaining({
        code: 'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path: 'effects[0].amountFrom',
      }),
    );
  });
});
