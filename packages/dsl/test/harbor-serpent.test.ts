/** Harbor Serpent's whole-battlefield threshold authoring. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  enabledWhile: {
    kind: 'battlefieldCountBelow' as const,
    filter: { subtypes: ['Island'] },
    fewerThan: 5,
  },
  modification: { kind: 'cantAttack' as const },
};

const HARBOR_SERPENT = {
  kind: 'creature' as const,
  id: 'tst-harbor-serpent',
  name: 'Harbor Serpent',
  rarity: 'common' as const,
  set: { code: 'M11', collectorNumber: 56 },
  colors: ['U'] as const,
  manaCost: { generic: 4, U: 2 },
  power: 5,
  toughness: 5,
  subtypes: ['Serpent'],
  keywordAbilities: [{ kind: 'landwalk' as const, landType: 'Island' as const }],
  abilities: [ABILITY],
};

describe('Harbor Serpent authoring', () => {
  it('prints the source threshold as an unless restriction', () => {
    expect(renderOracleText(parseCard(HARBOR_SERPENT))).toBe(
      "Islandwalk\nHarbor Serpent can't attack unless there are five or more Islands on the battlefield.",
    );
  });

  it('keeps the board-history condition outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });
});
