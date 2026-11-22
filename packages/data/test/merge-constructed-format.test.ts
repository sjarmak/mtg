import { describe, expect, it } from 'vitest';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import { mergePrintedConstructedFormats } from '../src/printed-card/merge-constructed-format';

const hash = 'a'.repeat(64);
const source = (code: string) => ({
  code,
  catalogFormat: `${code.toLowerCase()}-printed-v1`,
  catalogSha256: hash,
  mtgjson: { url: `https://mtgjson.com/api/v5/${code}.json`, sha256: hash, version: '5.3.0+20260915' },
});
const slot = (catalogFormat: string, position: number, name: string, count = 1) => ({
  physicalId: `${catalogFormat}:${String(position).padStart(4, '0')}:${name.toLowerCase()}`,
  name,
  count,
});
const scd = parsePrintedConstructedFormat({
  schemaVersion: 1,
  kind: 'printed-constructed-format',
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  sources: [source('SCD')],
  rules: { variant: 'commander', startingLife: 40 },
  decks: [
    {
      id: 'token-triumph',
      name: 'Token Triumph',
      commanders: [slot('scd-printed-v1', 1, 'Emmara, Soul of the Accord')],
      cards: [slot('scd-printed-v1', 2, 'Arcane Signet')],
    },
  ],
  contentSha256: hash,
});
const newWave = parsePrintedConstructedFormat({
  schemaVersion: 1,
  kind: 'printed-constructed-format',
  id: 'commander-precons',
  name: 'Commander Preconstructed Decks',
  sources: [source('C17')],
  rules: { variant: 'commander', startingLife: 40 },
  decks: [
    {
      id: 'draconic-domination',
      name: 'Draconic Domination',
      commanders: [slot('c17-printed-v1', 1, 'Scion of the Ur-Dragon')],
      cards: [slot('c17-printed-v1', 2, 'Sol Ring')],
    },
  ],
  contentSha256: hash,
});

describe('merging printed constructed formats', () => {
  it('unions sources and decks under a new id and name, and reseals the content hash', () => {
    const merged = mergePrintedConstructedFormats([scd, newWave], {
      id: 'commander-precons',
      name: 'Commander Preconstructed Decks',
    });
    expect(merged.id).toBe('commander-precons');
    expect(merged.name).toBe('Commander Preconstructed Decks');
    expect(merged.sources.map((entry) => entry.code)).toEqual(['SCD', 'C17']);
    expect(merged.decks.map((deck) => deck.id)).toEqual(['token-triumph', 'draconic-domination']);
    expect(merged.contentSha256).not.toBe(hash);
    expect(parsePrintedConstructedFormat(merged)).toEqual(merged);
  });

  it('refuses no formats to merge', () => {
    expect(() => mergePrintedConstructedFormats([], { id: 'x', name: 'x' })).toThrow(
      /No printed-constructed/,
    );
  });

  it('refuses two sides with different table rules', () => {
    const standard = parsePrintedConstructedFormat({
      ...newWave,
      rules: { variant: 'standard', startingLife: 20 },
      decks: [{ ...newWave.decks[0], commanders: [] }],
    });
    expect(() => mergePrintedConstructedFormats([scd, standard], { id: 'x', name: 'x' })).toThrow(
      /different table rules/,
    );
  });

  it('refuses a source code or deck id shared by more than one side', () => {
    expect(() => mergePrintedConstructedFormats([scd, scd], { id: 'x', name: 'x' })).toThrow();
  });
});
