import { describe, expect, it } from 'vitest';
import {
  CardTypesFileSchema,
  EnumValuesFileSchema,
  InvalidInputError,
  KeywordsFileSchema,
  buildVocabulary,
  closeStore,
  enumValuesFor,
  isKnownCardType,
  isKnownKeyword,
  isKnownSubtype,
  isKnownSupertype,
  loadVocabulary,
  normalizeVocabTerm,
  saveVocabularyFiles,
  unknownKeywords,
  vocabularyStatus,
  type VocabularyFiles,
} from '@mtg/data';
import { FIXTURES, memoryStore, readFixtureJson } from './helpers';

/**
 * The slice vocabulary pinned in `@mtg/dsl`. Repeated as literals rather than
 * imported: `@mtg/data` must not depend on `@mtg/dsl`, precisely so the DSL can
 * later depend on this vocabulary module without creating a cycle.
 */
const SLICE_KEYWORDS = [
  'flying',
  'vigilance',
  'haste',
  'trample',
  'deathtouch',
  'lifelink',
  'menace',
  'reach',
  'firstStrike',
] as const;

function loadFixtureFiles(): VocabularyFiles {
  return {
    cardTypes: CardTypesFileSchema.parse(readFixtureJson(FIXTURES.cardTypes)),
    keywords: KeywordsFileSchema.parse(readFixtureJson(FIXTURES.keywords)),
    enumValues: EnumValuesFileSchema.parse(readFixtureJson(FIXTURES.enumValues)),
  };
}

describe('MTGJSON vocabulary', () => {
  it('validates the three files at the boundary', () => {
    const files = loadFixtureFiles();
    expect(files.cardTypes.meta.version).toMatch(/^5\./);
    expect(files.keywords.data.keywordAbilities.length).toBeGreaterThan(100);
    expect(Object.keys(files.enumValues.data)).toContain('card');
  });

  it('rejects a vocabulary file with the wrong shape', () => {
    expect(() => KeywordsFileSchema.parse({ meta: { date: 'x', version: '5' }, data: {} })).toThrow();
    expect(() => CardTypesFileSchema.parse({ data: { creature: { subTypes: [] } } })).toThrow();
  });

  it('derives a queryable vocabulary from the raw files', () => {
    const vocabulary = buildVocabulary(loadFixtureFiles());

    expect(vocabulary.version).toBe('5.3.0+20260809');
    expect(vocabulary.builtDate).toBe('2026-08-09');
    expect(vocabulary.cardTypes).toContain('creature');
    expect(vocabulary.allSupertypes).toContain('Legendary');
    expect(vocabulary.subtypesByCardType['creature']).toContain('Angel');
    expect(vocabulary.keywordAbilities).toContain('Flying');

    // Sorted and deduped, so downstream diffs are stable.
    expect([...vocabulary.keywordAbilities]).toEqual([...vocabulary.keywordAbilities].sort());
    expect(new Set(vocabulary.allSubtypes).size).toBe(vocabulary.allSubtypes.length);
  });

  it('normalizes terms so camelCase and printed forms compare equal', () => {
    expect(normalizeVocabTerm('firstStrike')).toBe('firststrike');
    expect(normalizeVocabTerm('First strike')).toBe('firststrike');
    expect(normalizeVocabTerm('Double Strike')).toBe('doublestrike');
  });

  it('answers membership questions about types, subtypes and keywords', () => {
    const vocabulary = buildVocabulary(loadFixtureFiles());

    expect(isKnownCardType(vocabulary, 'Creature')).toBe(true);
    expect(isKnownCardType(vocabulary, 'Planeswalker')).toBe(false); // trimmed from the fixture
    expect(isKnownSupertype(vocabulary, 'legendary')).toBe(true);
    expect(isKnownSupertype(vocabulary, 'ancient')).toBe(false);
    expect(isKnownSubtype(vocabulary, 'Angel', 'creature')).toBe(true);
    expect(isKnownSubtype(vocabulary, 'Aura', 'creature')).toBe(false);
    expect(isKnownKeyword(vocabulary, 'Trample')).toBe(true);
    expect(isKnownKeyword(vocabulary, 'Sparkle')).toBe(false);
  });

  it('recognizes every keyword in the pinned slice vocabulary', () => {
    const vocabulary = buildVocabulary(loadFixtureFiles());
    expect(unknownKeywords(vocabulary, SLICE_KEYWORDS)).toEqual([]);
    expect(unknownKeywords(vocabulary, ['flying', 'wibble'])).toEqual(['wibble']);
  });

  it('exposes per-field enum values', () => {
    const vocabulary = buildVocabulary(loadFixtureFiles());
    expect(enumValuesFor(vocabulary, 'card', 'rarity')).toContain('mythic');
    expect(enumValuesFor(vocabulary, 'card', 'colors')).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(enumValuesFor(vocabulary, 'card', 'nonesuch')).toEqual([]);
    expect(enumValuesFor(vocabulary, 'nonesuch', 'rarity')).toEqual([]);
  });

  it('round-trips through the store and is idempotent', () => {
    const store = memoryStore();
    expect(loadVocabulary(store)).toBeNull();

    const files = loadFixtureFiles();
    const first = saveVocabularyFiles(store, files);
    expect(first.map((result) => result.kind)).toEqual(['CardTypes', 'Keywords', 'EnumValues']);

    saveVocabularyFiles(store, files);
    expect(vocabularyStatus(store)).toHaveLength(3);

    const loaded = loadVocabulary(store);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe('5.3.0+20260809');
    expect(unknownKeywords(loaded!, SLICE_KEYWORDS)).toEqual([]);

    closeStore(store);
  });

  it('refuses to rebuild from a corrupted stored vocabulary', () => {
    const store = memoryStore();
    saveVocabularyFiles(store, loadFixtureFiles());
    store.db.prepare(`UPDATE vocabulary SET raw_json = ? WHERE kind = 'Keywords'`).run('{"meta":{}}');

    expect(() => loadVocabulary(store)).toThrow(InvalidInputError);
    closeStore(store);
  });
});
