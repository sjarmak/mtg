import { describe, expect, it } from 'vitest';
import {
  parsePrintedConstructedFormat,
  parsePrintedFormat,
  serializedPrintedConstructedFormatContent,
  serializedPrintedFormatContent,
} from '../src/index';

const hash = 'a'.repeat(64);
const source = {
  code: 'SCD',
  catalogFormat: 'scd-printed-v1',
  catalogSha256: hash,
  mtgjson: { url: 'https://mtgjson.com/api/v5/SCD.json', sha256: hash, version: '5.3.0+20260915' },
};
const slot = (position: number, name: string, count = 1) => ({
  physicalId: `scd-printed-v1:${String(position).padStart(4, '0')}:${name.toLowerCase()}`,
  name,
  count,
});
const deck = {
  id: 'token-triumph',
  name: 'Token Triumph',
  commanders: [slot(1, 'Emmara, Soul of the Accord')],
  cards: [slot(2, 'Arcane Signet'), slot(3, 'Plains', 12)],
};
const format = {
  schemaVersion: 1,
  kind: 'printed-constructed-format',
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  sources: [source],
  rules: { variant: 'commander', startingLife: 40 },
  decks: [deck],
  contentSha256: hash,
};

describe('printed constructed format artifact', () => {
  it('binds decks, commanders, rules and exact sources into the hashed content', () => {
    const parsed = parsePrintedConstructedFormat(format);
    expect(parsed.decks[0]?.commanders[0]?.name).toBe('Emmara, Soul of the Accord');
    const serialized = serializedPrintedConstructedFormatContent(parsed);
    expect(serialized).not.toContain('contentSha256');
    for (const key of ['sources', 'rules', 'decks', 'startingLife', 'Arcane Signet']) {
      expect(serialized).toContain(key);
    }
    expect(serializedPrintedFormatContent(parsed)).toBe(serialized);
  });

  it('is told apart from a Limited format by kind alone', () => {
    expect(parsePrintedFormat(format).kind).toBe('printed-constructed-format');
    expect(() => parsePrintedFormat({ ...format, kind: 'printed-limited-format' })).toThrow();
  });

  it.each([
    { name: 'a second deck under the same id', change: { decks: [deck, deck] } },
    {
      name: 'a printing listed twice in one deck',
      change: { decks: [{ ...deck, cards: [...deck.cards, deck.cards[0]] }] },
    },
    {
      name: 'a printing from a catalog the format does not list',
      change: {
        decks: [{ ...deck, cards: [{ ...slot(9, 'Sol Ring'), physicalId: 'c20-printed-v1:0001:x' }] }],
      },
    },
    { name: 'a commander table with no commander', change: { decks: [{ ...deck, commanders: [] }] } },
    {
      name: 'a standard table naming a commander',
      change: { rules: { variant: 'standard', startingLife: 20 } },
    },
    {
      name: 'a commander at count two',
      change: { decks: [{ ...deck, commanders: [slot(1, 'Emmara, Soul of the Accord', 2)] }] },
    },
    { name: 'products, which a constructed format has none of', change: { products: [] } },
    { name: 'a zero-life table', change: { rules: { variant: 'commander', startingLife: 0 } } },
  ])('refuses $name', ({ change }) => {
    expect(() => parsePrintedConstructedFormat({ ...format, ...change })).toThrow();
  });

  it('accepts a standard table whose decks name no commander', () => {
    const standard = parsePrintedConstructedFormat({
      ...format,
      rules: { variant: 'standard', startingLife: 20 },
      decks: [{ ...deck, commanders: [] }],
    });
    expect(standard.rules).toEqual({ variant: 'standard', startingLife: 20 });
  });
});
