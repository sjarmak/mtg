/**
 * The play-booster-era set skeleton, loaded and validated from canon JSON.
 *
 * Accessors here answer the questions generators and validators actually ask
 * ("how many common slots does red get?", "what is the derived creature share
 * for green?") instead of making every caller re-walk the raw profile.
 */
import type { Color, Keyword } from '@mtg/dsl';
import { COLORS, KEYWORDS } from '@mtg/dsl';
import { midpoint } from './apportion';
import type { Citation, Source } from './citations';
import {
  citationForPath,
  danglingCitationKeys,
  uncitedNumericPaths,
  unknownCitationSources,
} from './citations';
import { loadCanon } from './load';
import type { CommonColorProfile, SkeletonData, SkeletonProfileDocument } from './skeleton-schema';
import { SkeletonProfileDocumentSchema } from './skeleton-schema';

export const PLAY_BOOSTER_2024: SkeletonProfileDocument = loadCanon(
  'skeleton-play-booster-2024.json',
  SkeletonProfileDocumentSchema,
);

/** The numbers, without the citation apparatus. */
export function skeletonData(doc: SkeletonProfileDocument = PLAY_BOOSTER_2024): SkeletonData {
  return doc.data;
}

export function skeletonSource(
  id: string,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): Source | undefined {
  return doc.sources[id];
}

/** The citation justifying a dotted data path, or its nearest cited ancestor. */
export function skeletonCitation(
  path: string,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): Citation | undefined {
  return citationForPath(doc.citations, path);
}

export interface CitationAudit {
  readonly uncitedNumbers: readonly string[];
  readonly danglingCitations: readonly string[];
  readonly unknownSources: readonly string[];
}

/** Everything wrong with the profile's provenance; empty arrays mean clean. */
export function auditSkeletonCitations(doc: SkeletonProfileDocument = PLAY_BOOSTER_2024): CitationAudit {
  return {
    uncitedNumbers: uncitedNumericPaths(doc.data, doc.citations),
    danglingCitations: danglingCitationKeys(doc.data, doc.citations),
    unknownSources: unknownCitationSources(doc.citations, doc.sources),
  };
}

/** Common slots a color owns: creature slots plus its listed spell slots. */
export function commonSlotsForColor(color: Color, doc: SkeletonProfileDocument = PLAY_BOOSTER_2024): number {
  const profile = doc.data.colors[color].common;
  return profile.creatures + profile.spellSlots.length;
}

/** Uncommon slots a color owns, ranges collapsed to their midpoints. */
export function uncommonSlotsForColor(
  color: Color,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): number {
  const profile = doc.data.colors[color].uncommon;
  return (
    midpoint(profile.creaturesMin, profile.creaturesMax) +
    midpoint(profile.noncreaturesMin, profile.noncreaturesMax)
  );
}

/**
 * Creature share computed from the published slot tables rather than the
 * article's stated percentage. For black, red and green the two disagree — see
 * the DISCREPANCY notes on `colors.*.common.creatureShare`. The slot tables win
 * because they are the numbers that sum to the article's own set size.
 */
export function derivedCommonCreatureShare(
  color: Color,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): number {
  const slots = commonSlotsForColor(color, doc);
  return slots === 0 ? 0 : doc.data.colors[color].common.creatures / slots;
}

export function derivedUncommonCreatureShare(
  color: Color,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): number {
  const slots = uncommonSlotsForColor(color, doc);
  const profile = doc.data.colors[color].uncommon;
  return slots === 0 ? 0 : midpoint(profile.creaturesMin, profile.creaturesMax) / slots;
}

/** Colored plus colorless common slots; should equal `setSize.common`. */
export function totalCommonSlots(doc: SkeletonProfileDocument = PLAY_BOOSTER_2024): number {
  const colored = COLORS.reduce((sum, color) => sum + commonSlotsForColor(color, doc), 0);
  const colorless = doc.data.colorless.common;
  return colored + colorless.creatures + colorless.spells;
}

export interface KeywordBudgetEntry {
  readonly keyword: Keyword;
  readonly count: number;
}

/**
 * A color's common keyword budget restricted to the pinned slice vocabulary,
 * in canonical keyword order. Keywords the slice engine cannot run (double
 * strike, ward, defender, flash) are dropped rather than silently remapped.
 */
export function pinnedKeywordBudget(
  color: Color,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): KeywordBudgetEntry[] {
  const budget: Readonly<Record<string, number>> = doc.data.colors[color].common.keywords;
  return KEYWORDS.flatMap((keyword) => {
    const count = budget[keyword];
    return count === undefined ? [] : [{ keyword, count }];
  });
}

/** Keyword budget entries dropped because the slice vocabulary lacks them. */
export function unpinnedKeywordNames(
  color: Color,
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): string[] {
  const pinned: ReadonlySet<string> = new Set<string>(KEYWORDS);
  return Object.keys(doc.data.colors[color].common.keywords).filter((name) => !pinned.has(name));
}

/** Share of the rare-or-mythic booster slot that resolves to each rarity. */
export function rareMythicShares(doc: SkeletonProfileDocument = PLAY_BOOSTER_2024): {
  rare: number;
  mythic: number;
} {
  const n = doc.data.booster.mythicOneInN;
  return { rare: (n - 1) / n, mythic: 1 / n };
}

/** As-fan of a theme: expected copies per booster, per the play-booster formula. */
export function asFan(
  counts: {
    readonly common?: number;
    readonly uncommon?: number;
    readonly rare?: number;
    readonly mythic?: number;
  },
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): number {
  const { setSize, booster } = doc.data;
  const shares = rareMythicShares(doc);
  const common = ((counts.common ?? 0) / setSize.common) * booster.common;
  const uncommon = ((counts.uncommon ?? 0) / setSize.uncommon) * booster.uncommon;
  const rare = ((counts.rare ?? 0) / setSize.rare) * booster.rareOrMythic * shares.rare;
  const mythic =
    setSize.mythic === 0 ? 0 : ((counts.mythic ?? 0) / setSize.mythic) * booster.rareOrMythic * shares.mythic;
  return common + uncommon + rare + mythic;
}

export type { CommonColorProfile };
