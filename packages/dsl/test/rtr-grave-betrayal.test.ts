/** Exact authored DSL and containment contract for RTR Grave Betrayal. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  TRIGGER_CONDITIONS,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

const RETURN_AT_NEXT_END_STEP = {
  control: 'you',
  counter: 'plusOnePlusOne',
  count: 1,
  alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
} as const;

export const GRAVE_BETRAYAL_INPUT = {
  kind: 'enchantment',
  id: 'rtr-067-grave-betrayal',
  name: 'Grave Betrayal',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 67 },
  manaCost: { generic: 5, B: 2 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureDies',
      effects: [],
      opponentCreatureDiesReturnAtNextEndStep: RETURN_AT_NEXT_END_STEP,
    },
  ],
} as const;

describe('RTR #67 Grave Betrayal authoring', () => {
  it('strictly parses and renders current Oracle text in printed order', () => {
    expect(renderOracleText(parseCard(GRAVE_BETRAYAL_INPUT as unknown as CardInput))).toBe(
      "Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.",
    );
  });

  it('keeps the whole retained-death bundle outside the generator vocabulary', () => {
    expect(TRIGGER_CONDITIONS).not.toContain('opponentCreatureDies');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('opponentCreatureDies');
    expect(ALL_EFFECT_KINDS).not.toContain('returnTriggeringCreatureAtNextEndStep');
    expect(ModelAbilitySchema.safeParse(GRAVE_BETRAYAL_INPUT.abilities[0]).success).toBe(false);
  });

  it('refuses the delayed return outside its opponent-creature death envelope', () => {
    const malformed = structuredClone(GRAVE_BETRAYAL_INPUT) as unknown as CardInput;
    const ability = malformed.abilities?.[0];
    if (ability?.kind !== 'triggered') throw new Error('Grave Betrayal trigger disappeared');
    ability.condition = 'selfEnters';
    const parsed = safeParseCard(malformed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('malformed Grave Betrayal unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({
        code: 'SCHEMA_INVALID',
        path: 'abilities[0].opponentCreatureDiesReturnAtNextEndStep',
      }),
    );
  });
});
