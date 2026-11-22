/** Faerie Impostor's exact, hand-authored return-or-sacrifice entry bundle. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  CardSchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '../src/index';

const RETURN_OR_SACRIFICE = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
  returnAnotherCreatureOrSacrificeSelf: true,
} as const;

const IMPOSTOR = parseCard({
  kind: 'creature',
  id: 'rtr-39-faerie-impostor',
  name: 'Faerie Impostor',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 39 },
  manaCost: { U: 1 },
  colors: ['U'],
  subtypes: ['Faerie', 'Rogue'],
  power: 2,
  toughness: 1,
  keywords: ['flying'],
  abilities: [RETURN_OR_SACRIFICE],
});

describe("Faerie Impostor's entry bundle", () => {
  it('is exact engine vocabulary and remains outside the model schema', () => {
    expect(AbilitySchema.safeParse(RETURN_OR_SACRIFICE).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(RETURN_OR_SACRIFICE).success).toBe(false);
    expect(validateCard(IMPOSTOR)).toEqual([]);
    expect(renderOracleText(IMPOSTOR)).toBe(
      "Flying\nWhen this creature enters, sacrifice it unless you return another creature you control to its owner's hand.",
    );
  });

  it('refuses every decomposition outside the source-attested creature envelope', () => {
    const cases = [
      { ...RETURN_OR_SACRIFICE, condition: 'selfDies' },
      { ...RETURN_OR_SACRIFICE, effects: [] },
      { ...RETURN_OR_SACRIFICE, optional: true },
      { ...RETURN_OR_SACRIFICE, targetChooser: 'triggeringPlayer' },
      {
        ...RETURN_OR_SACRIFICE,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ];
    for (const ability of cases) {
      const card = CardSchema.parse({ ...IMPOSTOR, abilities: [ability] });
      expect(validateCard(card).map((entry) => entry.code)).toContain(
        'RETURN_ANOTHER_CREATURE_OR_SACRIFICE_INVALID',
      );
    }

    const artifact = CardSchema.parse({
      kind: 'artifact',
      id: 'tst-false-impostor',
      name: 'False Impostor',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: {},
      abilities: [RETURN_OR_SACRIFICE],
    });
    expect(validateCard(artifact).map((entry) => entry.code)).toContain(
      'RETURN_ANOTHER_CREATURE_OR_SACRIFICE_INVALID',
    );
  });
});
