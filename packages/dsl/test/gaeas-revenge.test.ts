/** Hand-authored source-relative targeting protection for M11 Gaea's Revenge. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const GAEAS_REVENGE_INPUT = {
  kind: 'creature',
  id: 'm11-174-gaeas-revenge',
  name: "Gaea's Revenge",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 174 },
  manaCost: { generic: 5, G: 2 },
  colors: ['G'],
  subtypes: ['Elemental'],
  power: 8,
  toughness: 5,
  keywords: ['haste'],
  cannotBeCountered: true,
  targetingRestrictions: [{ kind: 'sourceLacksColor', color: 'G' }],
} as const;

describe("Gaea's Revenge DSL", () => {
  it('parses and renders every current Oracle clause exactly', () => {
    const card = parseCard(GAEAS_REVENGE_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(card).toEqual(
      expect.objectContaining({
        cannotBeCountered: true,
        targetingRestrictions: [{ kind: 'sourceLacksColor', color: 'G' }],
      }),
    );
    expect(renderOracleText(card)).toBe(
      "This spell can't be countered.\nHaste\nThis creature can't be the target of nongreen spells or abilities from nongreen sources.",
    );
  });

  it('keeps a battlefield targeting restriction off instant and sorcery cards', () => {
    expect(() =>
      parseCard({
        kind: 'instant',
        id: 'illegal-targeting-restriction-spell',
        name: 'Illegal Targeting Restriction Spell',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { G: 1 },
        colors: ['G'],
        targetingRestrictions: [{ kind: 'sourceLacksColor', color: 'G' }],
      }),
    ).toThrow(/targeting restriction|permanent/u);
  });

  it('rejects duplicate source restrictions instead of printing the same rule twice', () => {
    expect(() =>
      parseCard({
        ...GAEAS_REVENGE_INPUT,
        id: 'illegal-duplicate-targeting-restriction',
        targetingRestrictions: [
          { kind: 'sourceLacksColor', color: 'G' },
          { kind: 'sourceLacksColor', color: 'G' },
        ],
      }),
    ).toThrow(/repeats|duplicate/u);
  });
});
