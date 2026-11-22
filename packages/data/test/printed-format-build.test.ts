import { describe, expect, it } from 'vitest';
import {
  serializedPrintedConstructedFormatContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import {
  buildPrintedConstructedFormat,
  buildPrintedFormat,
  buildPrintedLimitedFormat,
  PrintedFormatRecipeSchema,
} from '../src/printed-card/format-build';
import { buildFixture, digest, forge, recipe, script } from './printed-format-build-fixture';

describe('generic offline printed format assembly', () => {
  it('preserves exact printing catalogs, source hashes and round-aware recipes without admission', () => {
    const { pin } = buildFixture();
    const result = buildPrintedLimitedFormat(recipe, pin, forge);
    expect(result.catalogs.map((c) => c.cards.length)).toEqual([1, 1, 1]);
    expect(result.catalogs.every((c) => c.source.provenanceSha256 === pin.sha256)).toBe(true);
    expect(result.format.draft).toEqual(recipe.draft);
    expect(result.format.sealed).toEqual(recipe.sealed);
    expect(result.format.contentSha256).toBe(digest(serializedPrintedLimitedFormatContent(result.format)));
    expect(result.status).toBe('catalog-only-not-play-admitted');
    expect(result.catalogs[0]?.cards[0]?.forgeScriptSha256).toBe(digest(script));
  });

  it('builds another set and explicit land policy with the same implementation', () => {
    const { pin } = buildFixture(['M11']);
    const second = {
      ...recipe,
      id: 'm11',
      name: 'Magic 2011',
      sourceCodes: ['M11'],
      products: [{ id: 'm11-draft', setCode: 'M11', boosterKey: 'draft' }],
      draft: { ...recipe.draft, rounds: ['m11-draft', 'm11-draft', 'm11-draft'] },
      sealed: { boosters: Array<string>(6).fill('m11-draft') },
      basicLandPolicy: 'keep',
    };
    const result = buildPrintedLimitedFormat(second, pin, forge);
    expect(result.format.id).toBe('m11');
    expect(result.format.basicLandPolicy).toBe('keep');
    expect(result.format.products[0]?.collation.sheets[0]?.weights).toEqual({
      [result.catalogs[0]!.cards[0]!.physicalId]: 1,
    });
  });

  it('normalizes snapshot ordering using the explicit recipe, not acquisition order', () => {
    const { pin } = buildFixture();
    expect(buildPrintedFormat(recipe, { ...pin, sources: [...pin.sources].reverse() }, forge)).toEqual(
      buildPrintedFormat(recipe, pin, forge),
    );
  });

  it.each([
    { sourceCodes: ['AKH', 'HOU'] },
    { sourceCodes: ['AKH', 'HOU', 'MP2', 'M11'] },
    { sourceCodes: ['AKH', 'AKH'] },
    { id: '../outside' },
    { extra: true },
    { basicLandPolicy: undefined },
    { products: [...recipe.products, recipe.products[0]] },
    { products: [{ id: 'missing', setCode: 'M11', boosterKey: 'draft' }] },
    { draft: { ...recipe.draft, rounds: ['missing'] } },
  ])('rejects malformed recipes and source drift: %j', (change) => {
    expect(() => buildPrintedFormat({ ...recipe, ...change }, buildFixture().pin, forge)).toThrow();
  });

  it('reports missing publisher products instead of inventing a booster', () => {
    expect(() =>
      buildPrintedFormat(
        { ...recipe, products: recipe.products.map((p) => ({ ...p, boosterKey: 'absent' })) },
        buildFixture().pin,
        forge,
      ),
    ).toThrow(/missing booster/);
  });

  it('refuses missing scripts and bad printing identity through the existing catalog gate', () => {
    expect(() => buildPrintedFormat(recipe, buildFixture().pin, { ...forge, scriptFor: () => null })).toThrow(
      /missing Forge script/,
    );
  });

  it('requires unique source and product names before IO', () => {
    expect(PrintedFormatRecipeSchema.safeParse({ ...recipe, sourceCodes: ['AKH', 'AKH'] }).success).toBe(
      false,
    );
  });
});

const constructed = {
  schemaVersion: 1,
  kind: 'constructed',
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  sourceCodes: ['AKH', 'HOU'],
  rules: { variant: 'commander', startingLife: 40 },
  decks: [
    {
      id: 'bolt-deck',
      name: 'Bolt Deck',
      commanders: [{ name: 'Lightning Bolt', setCode: 'AKH' }],
      cards: [
        { name: 'Lightning Bolt', setCode: 'HOU', count: 40 },
        { name: 'Lightning Bolt', setCode: 'HOU', count: 59 },
      ],
    },
  ],
};

describe('constructed printed format assembly', () => {
  it('resolves every deck line to a catalog printing over the same catalogs, and merges lines naming one printing', () => {
    const { pin } = buildFixture(['AKH', 'HOU']);
    const result = buildPrintedConstructedFormat(constructed, pin, forge);
    expect(result.catalogs.map((c) => c.format)).toEqual(['akh-printed-v1', 'hou-printed-v1']);
    expect(result.format.kind).toBe('printed-constructed-format');
    expect(result.format.rules).toEqual({ variant: 'commander', startingLife: 40 });
    expect(result.format.decks).toEqual([
      {
        id: 'bolt-deck',
        name: 'Bolt Deck',
        commanders: [
          { physicalId: result.catalogs[0]!.cards[0]!.physicalId, name: 'Lightning Bolt', count: 1 },
        ],
        cards: [{ physicalId: result.catalogs[1]!.cards[0]!.physicalId, name: 'Lightning Bolt', count: 99 }],
      },
    ]);
    expect(result.format.contentSha256).toBe(
      digest(serializedPrintedConstructedFormatContent(result.format)),
    );
    expect(result.status).toBe('catalog-only-not-play-admitted');
    expect(buildPrintedFormat(constructed, pin, forge)).toEqual(result);
  });

  it('looks a line with no set code up across the recipe sources in order', () => {
    const { pin } = buildFixture(['AKH', 'HOU']);
    const result = buildPrintedConstructedFormat(
      {
        ...constructed,
        decks: [
          {
            ...constructed.decks[0],
            commanders: [{ name: 'Lightning Bolt', setCode: 'HOU' }],
            cards: [{ name: 'Lightning Bolt', count: 99 }],
          },
        ],
      },
      pin,
      forge,
    );
    expect(result.format.decks[0]!.cards[0]!.physicalId).toBe(result.catalogs[0]!.cards[0]!.physicalId);
  });

  it('refuses a deck line no pinned printing answers to, naming the deck and the set', () => {
    const { pin } = buildFixture(['AKH', 'HOU']);
    expect(() =>
      buildPrintedConstructedFormat(
        {
          ...constructed,
          decks: [{ ...constructed.decks[0], cards: [{ name: 'Sol Ring', setCode: 'HOU', count: 1 }] }],
        },
        pin,
        forge,
      ),
    ).toThrow(/deck bolt-deck: no HOU printing of "Sol Ring"/);
  });

  it.each([
    { sourceCodes: ['AKH'] },
    { decks: [{ ...constructed.decks[0], cards: [{ name: 'Lightning Bolt', setCode: 'M11', count: 1 }] }] },
    { decks: [constructed.decks[0], constructed.decks[0]] },
    { decks: [{ ...constructed.decks[0], commanders: [] }] },
    { rules: { variant: 'standard', startingLife: 20 } },
    { products: [] },
    { kind: 'limited' },
  ])('refuses a malformed constructed recipe: %j', (change) => {
    expect(() =>
      buildPrintedFormat({ ...constructed, ...change }, buildFixture(['AKH', 'HOU']).pin, forge),
    ).toThrow();
  });

  it('keeps a booster recipe out of the constructed builder and the reverse', () => {
    const { pin } = buildFixture();
    expect(() => buildPrintedConstructedFormat(recipe, pin, forge)).toThrow();
    expect(() => buildPrintedLimitedFormat(constructed, buildFixture(['AKH', 'HOU']).pin, forge)).toThrow();
  });
});
