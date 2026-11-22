import { describe, expect, it } from 'vitest';
import { parseCard, printedEntryReplacement, renderOracleText, safeParseCard } from '@mtg/dsl';

const PRIMAL_CLAY_INPUT = {
  kind: 'creature',
  id: 'm13-primal-clay',
  name: 'Primal Clay',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 210 },
  manaCost: { generic: 4 },
  artifact: true,
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersAsCharacteristicChoice',
    modes: [
      { power: 3, toughness: 3 },
      { power: 2, toughness: 2, addKeywords: ['flying'] },
      { power: 1, toughness: 6, addSubtypes: ['Wall'], addKeywordAbilities: [{ kind: 'defender' }] },
    ],
  },
} as const;

describe('as-entry characteristic choices', () => {
  it('parses the bounded typed modes and prints Primal Clay exactly', () => {
    const card = parseCard(PRIMAL_CLAY_INPUT);

    expect(printedEntryReplacement(card)).toEqual(PRIMAL_CLAY_INPUT.entryReplacement);
    expect(renderOracleText(card)).toBe(
      "As this creature enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types. (A creature with defender can't attack.)",
    );
  });

  it('refuses a characteristic choice on a noncreature and malformed or hybrid modes', () => {
    const artifact = {
      ...PRIMAL_CLAY_INPUT,
      kind: 'artifact',
      id: 'tst-noncreature-mold',
      artifact: undefined,
      power: undefined,
      toughness: undefined,
    };
    expect(safeParseCard(artifact).ok).toBe(false);
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [{ power: 3, toughness: 3 }],
        },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [
            { power: 3, toughness: 3, removeKeywords: ['flying'] },
            { power: 1, toughness: 6 },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it('refuses mode packages that collapse to the same executable characteristics', () => {
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [
            { power: 2, toughness: 2, addKeywords: ['flying'] },
            { power: 2, toughness: 2, addKeywords: ['flying', 'flying'] },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [
            { power: 1, toughness: 6, addSubtypes: ['Wall', 'Shapeshifter'] },
            { power: 1, toughness: 6, addSubtypes: ['Shapeshifter', 'Wall'] },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [
            {
              power: 1,
              toughness: 6,
              addKeywordAbilities: [{ kind: 'defender' }, { kind: 'defender' }],
            },
            { power: 3, toughness: 3 },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PRIMAL_CLAY_INPUT,
        entryReplacement: {
          kind: 'entersAsCharacteristicChoice',
          modes: [
            { power: 3, toughness: 3 },
            { power: 3, toughness: 3, addSubtypes: ['Shapeshifter'] },
          ],
        },
      }).ok,
    ).toBe(false);
  });
});
