/** Exact hand-authored vocabulary and printed text for M11 Jace's Erasure. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const YOU_DRAW_CARD = 'youDrawCard' as TriggerCondition;
const ERASURE_TRIGGER = {
  kind: 'triggered',
  condition: YOU_DRAW_CARD,
  optional: true,
  effects: [{ kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } }],
};

function input(): CardInput {
  return {
    kind: 'enchantment',
    id: 'm11-059-jaces-erasure',
    name: "Jace's Erasure",
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 59 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    abilities: [ERASURE_TRIGGER],
  } as unknown as CardInput;
}

describe("Jace's Erasure DSL", () => {
  it('keeps the generator trigger vocabulary frozen', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect(TRIGGER_CONDITIONS).toContain(YOU_DRAW_CARD);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(YOU_DRAW_CARD);
  });

  it('is hand-authorable but outside the model schema', () => {
    expect(AbilitySchema.safeParse(ERASURE_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ERASURE_TRIGGER).success).toBe(false);
  });

  it('owns its printed condition and exact Oracle sentence', () => {
    expect(TRIGGER_PRINT_TEMPLATES[YOU_DRAW_CARD]).toBe('Whenever you draw a card,');
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Whenever you draw a card, you may have target player mill a card.');
  });
});
