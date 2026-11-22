import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parsePrintedLimitedFormat, serializedPrintedLimitedFormatContent } from '../src/index';

const hash = 'a'.repeat(64);
const source = (code: string) => ({
  code,
  catalogFormat: `printed-${code}`,
  catalogSha256: hash,
  mtgjson: { url: `https://mtgjson.com/api/v5/${code}.json`, sha256: hash, version: '5.3.0+20260911' },
});
const product = (code: string) => ({
  id: `${code}-draft`,
  setCode: code,
  sourceSetCodes: [code, 'MP2'],
  collation: {
    sheets: [{ name: 'common', weights: { [`printed-${code}:0001:card`]: 1 }, foil: false }],
    boosters: [{ contents: { common: 1 }, weight: 1 }],
  },
});
const format = {
  schemaVersion: 1,
  kind: 'printed-limited-format',
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  sources: ['AKH', 'HOU', 'MP2'].map(source),
  products: ['AKH', 'HOU'].map(product),
  draft: { seats: 8, rounds: ['HOU-draft', 'HOU-draft', 'AKH-draft'], botPolicy: 'printed-limited-v1' },
  sealed: { boosters: ['HOU-draft', 'HOU-draft', 'HOU-draft', 'HOU-draft', 'AKH-draft', 'AKH-draft'] },
  basicLandPolicy: 'remove',
  contentSha256: hash,
};

describe('printed Limited format artifact', () => {
  it('binds round order, sealed product counts, exact sources, collation and bot policy', () => {
    const parsed = parsePrintedLimitedFormat(format);
    expect(parsed.draft.rounds).toEqual(['HOU-draft', 'HOU-draft', 'AKH-draft']);
    const serialized = serializedPrintedLimitedFormatContent(parsed);
    expect(serialized).not.toContain('contentSha256');
    for (const key of ['sources', 'products', 'draft', 'sealed', 'basicLandPolicy', 'botPolicy']) {
      expect(serialized).toContain(`"${key}"`);
    }
    expect(
      serializedPrintedLimitedFormatContent({
        ...parsed,
        draft: { ...parsed.draft, rounds: [...parsed.draft.rounds].reverse() },
      }),
    ).not.toBe(serialized);
  });

  it.each([
    ['unknown round product', { draft: { ...format.draft, rounds: ['absent'] } }],
    ['unknown sealed product', { sealed: { boosters: ['absent'] } }],
    ['missing MP2 source', { sources: format.sources.slice(0, 2) }],
    ['duplicate source', { sources: [...format.sources, format.sources[0]] }],
    ['duplicate catalog identity', { sources: format.sources.map((s) => ({ ...s, catalogFormat: 'same' })) }],
    ['duplicate product', { products: [...format.products, format.products[0]] }],
    ['unknown product set', { products: [product('UNK')] }],
    ['missing primary source', { products: format.products.map((p) => ({ ...p, sourceSetCodes: ['MP2'] })) }],
    ['empty source list', { products: format.products.map((p) => ({ ...p, sourceSetCodes: [] })) }],
    [
      'duplicate product source',
      { products: format.products.map((p) => ({ ...p, sourceSetCodes: [p.setCode, p.setCode] })) },
    ],
    [
      'unsafe weight',
      {
        products: [
          {
            ...product('HOU'),
            collation: {
              ...product('HOU').collation,
              boosters: [{ contents: { common: 1 }, weight: Infinity }],
            },
          },
        ],
      },
    ],
    ['missing checksum', { contentSha256: '' }],
    ['unrecognized policy', { basicLandPolicy: 'silently-drop-unsupported' }],
  ])('rejects %s', (_name, patch) => {
    expect(() => parsePrintedLimitedFormat({ ...format, ...patch })).toThrow(ZodError);
  });
});
