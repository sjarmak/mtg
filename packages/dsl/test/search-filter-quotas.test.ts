/** Keyword-union and heterogeneous-quota library searches. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CardEffectSchema,
  EffectSchema,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  ZoneReachingModelEffectSchema,
} from '../src/effects';
import { parseCard } from '../src/parse';
import { renderOracleText } from '../src/oracle';
import { validateCard } from '../src/validate';

function oracleFor(effect: unknown): string {
  return renderOracleText(
    parseCard({
      kind: 'sorcery',
      id: 'tst-filter-quota-search',
      name: 'Search Pattern',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 1 },
      colors: [],
      effects: [effect],
    }),
  );
}

describe('a printed keyword union in a card filter', () => {
  const beastFilter = {
    cardTypes: ['creature'],
    keywords: ['deathtouch', 'hexproof', 'reach', 'trample'],
  } as const;

  it('accepts parameterless keywords from both printed keyword stores', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: beastFilter,
        destination: 'libraryTop',
        reveal: true,
      }).success,
    ).toBe(true);
  });

  it('prints Mwonvuli Beast Tracker’s search clause exactly', () => {
    expect(
      oracleFor({
        kind: 'searchLibrary',
        filter: beastFilter,
        destination: 'libraryTop',
        reveal: true,
      }),
    ).toBe(
      'Search your library for a creature card with deathtouch, hexproof, reach, or trample, reveal it, then shuffle and put that card on top.',
    );
  });

  it('refuses an empty keyword union and duplicate alternatives', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: { keywords: [] },
        destination: 'hand',
      }).success,
    ).toBe(false);
    expect(
      validateCard({
        kind: 'sorcery',
        id: 'tst-duplicate-keyword-search',
        name: 'Duplicate Search',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 2 },
        manaCost: {},
        colors: [],
        effects: [
          {
            kind: 'searchLibrary',
            filter: { keywords: ['reach', 'reach'] },
            destination: 'hand',
          },
        ],
      }).some((violation) => violation.message.includes('same value twice')),
    ).toBe(true);
  });
});

describe('heterogeneous per-filter search quotas', () => {
  const gemSearch = {
    kind: 'searchLibrary',
    filterQuotas: [
      { filter: { subtypes: ['Island'] }, count: 1 },
      { filter: { subtypes: ['Swamp'] }, count: 1 },
      { filter: { subtypes: ['Mountain'] }, count: 1 },
    ],
    destination: 'hand',
    reveal: true,
  } as const;

  it('prints Gem of Becoming’s search clause exactly', () => {
    expect(oracleFor(gemSearch)).toBe(
      'Search your library for an Island card, a Swamp card, and a Mountain card, reveal those cards, put them into your hand, then shuffle.',
    );
  });

  it('requires at least two nonempty quotas and no competing homogeneous plan', () => {
    expect(CardEffectSchema.safeParse(gemSearch).success).toBe(true);
    expect(CardEffectSchema.safeParse({ ...gemSearch, filter: {} }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...gemSearch, count: 3 }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...gemSearch, filterQuotas: [] }).success).toBe(false);
    expect(
      CardEffectSchema.safeParse({ ...gemSearch, filterQuotas: [{ filter: {}, count: 1 }] }).success,
    ).toBe(false);
    expect(
      CardEffectSchema.safeParse({
        ...gemSearch,
        filterQuotas: [
          { filter: { subtypes: ['Island'] }, count: 0 },
          { filter: {}, count: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a quota search whose multiple cards cannot all occupy the library top', () => {
    const invalidEffect = { ...gemSearch, destination: 'libraryTop' } as const;
    expect(CardEffectSchema.safeParse(invalidEffect).success).toBe(false);
    expect(
      validateCard({
        kind: 'sorcery',
        id: 'tst-quota-search-to-library-top',
        name: 'Gem Search',
        rarity: 'uncommon',
        set: { code: 'TST', collectorNumber: 3 },
        manaCost: { generic: 1 },
        colors: [],
        effects: [invalidEffect],
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_INVALID' })]));
  });
});

describe('the generator schema boundary', () => {
  it('keeps both hand-authored search dimensions out of every model-facing schema', () => {
    for (const schema of [
      EffectSchema,
      ModelEffectSchema,
      PartBearingModelEffectSchema,
      ZoneReachingModelEffectSchema,
    ] as const) {
      const json = JSON.stringify(z.toJSONSchema(schema as unknown as z.ZodType, { io: 'input' }));
      expect(json).not.toContain('searchLibrary');
      expect(json).not.toContain('filterQuotas');
    }
  });
});
