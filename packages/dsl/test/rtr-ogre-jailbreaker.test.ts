/** Ogre Jailbreaker reuses a hand-authored live combat permission without widening model output. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  modification: { kind: 'canAttackAsThoughNoDefender' as const },
  enabledWhile: { kind: 'controlsSubtype' as const, subtype: 'Gate', atLeast: 1 },
  printedSubjectReference: 'thisCreature' as const,
};

describe("Ogre Jailbreaker's Gate permission", () => {
  it('parses and renders the current source Oracle exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-72-ogre-jailbreaker',
      name: 'Ogre Jailbreaker',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 72 },
      manaCost: { generic: 3, B: 1 },
      colors: ['B'],
      subtypes: ['Ogre', 'Rogue'],
      keywordAbilities: [{ kind: 'defender' }],
      power: 4,
      toughness: 4,
      abilities: [ABILITY],
    });

    expect(renderOracleText(card)).toBe(
      "Defender\nThis creature can attack as though it didn't have defender as long as you control a Gate.",
    );
  });

  it('keeps the conditional defender exception outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });
});
