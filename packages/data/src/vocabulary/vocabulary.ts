/**
 * The TS vocabulary module.
 *
 * This is the artifact `@mtg/dsl` can consume later to check its pinned slice
 * vocabulary against real Magic: legal card types, subtypes, supertypes,
 * keyword abilities/actions and per-field enum values, derived from MTGJSON.
 *
 * Intentionally free of `@mtg/dsl` imports and of any IO — a pure value plus
 * pure predicates — so the dependency can point dsl → data with no cycle. The
 * DSL-facing entry point is `unknownKeywords`, which takes the caller's keyword
 * list rather than reaching into another package for it.
 */
import type { CardTypesFile, EnumValuesFile, KeywordsFile, VocabularyKind } from './schemas';

export interface MtgVocabulary {
  /** MTGJSON build version, e.g. `5.3.0+20260809`. */
  readonly version: string;
  readonly builtDate: string;
  readonly versionsByKind: Readonly<Record<VocabularyKind, string>>;
  /** Lowercase card types, e.g. `creature`, `artifact`, `battle`. */
  readonly cardTypes: readonly string[];
  readonly subtypesByCardType: Readonly<Record<string, readonly string[]>>;
  readonly supertypesByCardType: Readonly<Record<string, readonly string[]>>;
  readonly allSubtypes: readonly string[];
  readonly allSupertypes: readonly string[];
  readonly abilityWords: readonly string[];
  readonly keywordAbilities: readonly string[];
  readonly keywordActions: readonly string[];
  /** `enumValues.card.rarity`, `enumValues.set.type`, … straight from MTGJSON. */
  readonly enumValues: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

export interface VocabularyFiles {
  readonly cardTypes: CardTypesFile;
  readonly keywords: KeywordsFile;
  readonly enumValues: EnumValuesFile;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildVocabulary(files: VocabularyFiles): MtgVocabulary {
  const subtypesByCardType: Record<string, readonly string[]> = {};
  const supertypesByCardType: Record<string, readonly string[]> = {};
  const allSubtypes: string[] = [];
  const allSupertypes: string[] = [];

  for (const [cardType, entry] of Object.entries(files.cardTypes.data)) {
    subtypesByCardType[cardType] = sortedUnique(entry.subTypes);
    supertypesByCardType[cardType] = sortedUnique(entry.superTypes);
    allSubtypes.push(...entry.subTypes);
    allSupertypes.push(...entry.superTypes);
  }

  return {
    version: files.cardTypes.meta.version,
    builtDate: files.cardTypes.meta.date,
    versionsByKind: {
      CardTypes: files.cardTypes.meta.version,
      Keywords: files.keywords.meta.version,
      EnumValues: files.enumValues.meta.version,
    },
    cardTypes: sortedUnique(Object.keys(files.cardTypes.data)),
    subtypesByCardType,
    supertypesByCardType,
    allSubtypes: sortedUnique(allSubtypes),
    allSupertypes: sortedUnique(allSupertypes),
    abilityWords: sortedUnique(files.keywords.data.abilityWords),
    keywordAbilities: sortedUnique(files.keywords.data.keywordAbilities),
    keywordActions: sortedUnique(files.keywords.data.keywordActions),
    enumValues: files.enumValues.data,
  };
}

/**
 * Folds a vocabulary term to a comparison key: lowercase, non-alphanumerics
 * dropped. Makes the DSL's camelCase (`firstStrike`) and MTGJSON's printed form
 * (`First strike`) compare equal, which is the whole point of the cross-check.
 */
export function normalizeVocabTerm(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keySet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeVocabTerm));
}

export function isKnownCardType(vocabulary: MtgVocabulary, cardType: string): boolean {
  return keySet(vocabulary.cardTypes).has(normalizeVocabTerm(cardType));
}

export function isKnownSupertype(vocabulary: MtgVocabulary, supertype: string): boolean {
  return keySet(vocabulary.allSupertypes).has(normalizeVocabTerm(supertype));
}

/** Restricts to one card type's subtype list when `cardType` is supplied. */
export function isKnownSubtype(vocabulary: MtgVocabulary, subtype: string, cardType?: string): boolean {
  const pool =
    cardType === undefined
      ? vocabulary.allSubtypes
      : (vocabulary.subtypesByCardType[cardType.toLowerCase()] ?? []);
  return keySet(pool).has(normalizeVocabTerm(subtype));
}

export function isKnownKeyword(vocabulary: MtgVocabulary, keyword: string): boolean {
  const pool = keySet([
    ...vocabulary.keywordAbilities,
    ...vocabulary.keywordActions,
    ...vocabulary.abilityWords,
  ]);
  return pool.has(normalizeVocabTerm(keyword));
}

/**
 * Returns the members of `keywords` that MTGJSON does not recognize.
 *
 * Feeding this the DSL's pinned `KEYWORDS` tuple is the intended use: an empty
 * result is evidence the slice vocabulary is real Magic vocabulary, and any
 * member that comes back is either a typo or a deliberately invented mechanic.
 */
export function unknownKeywords(vocabulary: MtgVocabulary, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => !isKnownKeyword(vocabulary, keyword));
}

/** `enumValuesFor(v, 'card', 'rarity')` → `['bonus','common',…]`. */
export function enumValuesFor(vocabulary: MtgVocabulary, model: string, field: string): readonly string[] {
  return vocabulary.enumValues[model]?.[field] ?? [];
}
