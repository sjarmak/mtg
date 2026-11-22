/** Worldfire's exact table-wide reset and generator-containment boundary. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CardInput } from '../src/index';
import {
  canonicalJson,
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '../src/index';

const WORLDFIRE_EFFECTS = [
  {
    kind: 'exileTarget',
    scope: 'allPermanents',
    scopeFilter: {},
    target: { kind: 'noTarget' },
  },
  { kind: 'exileHandsAndGraveyards' },
  { kind: 'setLife', amount: 1, players: 'eachPlayer' },
] as const;

function worldfireInput(): CardInput {
  return {
    kind: 'sorcery',
    id: 'm13-158',
    name: 'Worldfire',
    rarity: 'mythic',
    set: { code: 'M13', collectorNumber: 158 },
    manaCost: { generic: 6, R: 3 },
    colors: ['R'],
    effects: [...WORLDFIRE_EFFECTS],
  } as unknown as CardInput;
}

describe('Worldfire', () => {
  it('parses, validates, and renders the exact current Oracle text', () => {
    const card = parseCard(worldfireInput());

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1.",
    );
  });

  it('types the atomic zone reset and player scope without widening generator output', () => {
    expect(CardEffectSchema.parse(WORLDFIRE_EFFECTS[1])).toEqual(WORLDFIRE_EFFECTS[1]);
    expect(CardEffectSchema.parse(WORLDFIRE_EFFECTS[2])).toEqual(WORLDFIRE_EFFECTS[2]);

    const modelSchema = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    expect(modelSchema).not.toContain('exileHandsAndGraveyards');
    expect(ModelEffectSchema.safeParse(WORLDFIRE_EFFECTS[1]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(WORLDFIRE_EFFECTS[2]).success).toBe(false);
  });
});
