/** Armory Guard reuses the engine-only live condition without widening model output. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  modification: { kind: 'grantKeyword' as const, keyword: 'vigilance' as const },
  enabledWhile: { kind: 'controlsSubtype' as const, subtype: 'Gate', atLeast: 1 },
  printedSubjectReference: 'thisCreature' as const,
};

describe("Armory Guard's Gate condition", () => {
  it('parses and renders the source Oracle exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-2-armory-guard',
      name: 'Armory Guard',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 2 },
      manaCost: { generic: 3, W: 1 },
      colors: ['W'],
      subtypes: ['Giant', 'Soldier'],
      power: 2,
      toughness: 5,
      abilities: [ABILITY],
    });

    expect(renderOracleText(card)).toBe('This creature has vigilance as long as you control a Gate.');
  });

  it('keeps the condition and source-reference spelling outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });
});
