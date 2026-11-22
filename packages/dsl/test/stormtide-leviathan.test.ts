/** Stormtide Leviathan's global layer and combat restrictions at the strict DSL boundary. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  staticModificationIdentity,
} from '@mtg/dsl';

const ADD_ISLANDS = {
  kind: 'static' as const,
  scope: 'allLands' as const,
  subtype: null,
  modification: { kind: 'addSubtype' as const, subtype: 'Island' as const },
};

const RESTRICT_ATTACKS = {
  kind: 'static' as const,
  scope: 'allCreatures' as const,
  subtype: null,
  modification: {
    kind: 'cantAttackWithoutAnyOf' as const,
    anyOf: [
      { kind: 'keyword' as const, keyword: 'flying' as const },
      { kind: 'landwalk' as const, landType: 'Island' as const },
    ],
  },
};

const STORMTIDE_LEVIATHAN = {
  kind: 'creature' as const,
  id: 'm11-074-stormtide-leviathan-dsl',
  name: 'Stormtide Leviathan',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 74 },
  colors: ['U'] as const,
  manaCost: { generic: 5, U: 3 },
  power: 8,
  toughness: 8,
  subtypes: ['Leviathan'],
  keywordAbilities: [{ kind: 'landwalk' as const, landType: 'Island' as const }],
  abilities: [ADD_ISLANDS, RESTRICT_ATTACKS],
};

describe('Stormtide Leviathan authoring', () => {
  it('parses and renders the exact current Oracle text', () => {
    expect(AbilitySchema.safeParse(ADD_ISLANDS).success).toBe(true);
    expect(AbilitySchema.safeParse(RESTRICT_ATTACKS).success).toBe(true);
    expect(renderOracleText(parseCard(STORMTIDE_LEVIATHAN))).toBe(
      'Islandwalk\n' +
        'All lands are Islands in addition to their other types.\n' +
        "Creatures without flying or islandwalk can't attack.",
    );
  });

  it('keeps global scopes and both modifications outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(ADD_ISLANDS).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(RESTRICT_ATTACKS).success).toBe(false);
  });

  it('exports one exhaustive identity for both global modifications', () => {
    expect(staticModificationIdentity(ADD_ISLANDS.modification)).toBe('addSubtype:Island');
    expect(staticModificationIdentity(RESTRICT_ATTACKS.modification)).toBe(
      'cantAttackWithoutAnyOf:[{"keyword":"flying","kind":"keyword"},{"kind":"landwalk","landType":"Island"}]',
    );
  });

  it('rejects malformed global pairings and invented permissions', () => {
    expect(() =>
      parseCard({
        ...STORMTIDE_LEVIATHAN,
        abilities: [{ ...ADD_ISLANDS, scope: 'allCreatures' }],
      }),
    ).toThrow(/addSubtype|allLands/i);
    expect(() =>
      parseCard({
        ...STORMTIDE_LEVIATHAN,
        abilities: [{ ...RESTRICT_ATTACKS, scope: 'allLands' }],
      }),
    ).toThrow(/cantAttackWithoutAnyOf|allCreatures/i);
    expect(
      AbilitySchema.safeParse({
        ...RESTRICT_ATTACKS,
        modification: {
          kind: 'cantAttackWithoutAnyOf',
          anyOf: [{ kind: 'landwalk' }],
        },
      }).success,
    ).toBe(false);
  });
});
