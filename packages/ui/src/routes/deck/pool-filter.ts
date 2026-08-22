/**
 * Narrowing a Constructed pool down to something a person can read.
 *
 * A sealed pool is 72 cards and needs no search. A Constructed pool is every
 * card the kernel can run — 368 for one set, and the whole point of the pool
 * document is that it grows as more sets become playable — so the pane has to
 * be narrowable from the first version rather than as a follow-up. Which set a
 * card comes from is therefore a *facet* here, listed beside color and text,
 * rather than the identity of the pool: "the Seraphine set" is one filter over the
 * playable cards, not a different screen.
 *
 * The search text is matched against a haystack built once per pool rather than
 * per keystroke. `renderOracleText` walks a card's whole effect tree, and doing
 * that for every card on every character typed is the difference between a pane
 * that keeps up and one that does not. `indexPool` is what a caller memoizes.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS, renderOracleText, renderTypeLine } from '@mtg/dsl';

/** A color to filter by, or colorless, which is what an artifact filters as. */
export type ColorFacet = Color | 'C';

export const COLOR_FACETS: readonly ColorFacet[] = [...COLORS, 'C'];

export const COLOR_FACET_NAMES: Readonly<Record<ColorFacet, string>> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

export interface PoolFilter {
  /** Matched against name, type line and rules text, case-insensitively. */
  readonly text: string;
  /** Empty means every color. Otherwise a card matching any one of them passes. */
  readonly colors: readonly ColorFacet[];
  /** Empty means every set. Otherwise a card printed in any one of them passes. */
  readonly sets: readonly string[];
}

/** No narrowing at all: the whole pool. */
export const WHOLE_POOL: PoolFilter = { text: '', colors: [], sets: [] };

export function isWholePool(filter: PoolFilter): boolean {
  return filter.text.trim() === '' && filter.colors.length === 0 && filter.sets.length === 0;
}

export interface PoolEntry {
  readonly card: Card;
  /** Lowercased name, type line and rules text, joined. Built once. */
  readonly haystack: string;
  readonly facets: readonly ColorFacet[];
}

/**
 * A card's color facets: its colors, or colorless when it has none.
 *
 * Colorless is derived rather than declared so a colorless card cannot be
 * both — a card with no colors is exactly the thing the colorless filter is
 * for, and one that has colors is never it.
 */
export function colorFacetsOf(card: Card): readonly ColorFacet[] {
  return card.colors.length === 0 ? ['C'] : card.colors;
}

export function indexPool(pool: readonly Card[]): readonly PoolEntry[] {
  return pool.map((card) => ({
    card,
    haystack: `${card.name}\n${renderTypeLine(card)}\n${renderOracleText(card)}`.toLowerCase(),
    facets: colorFacetsOf(card),
  }));
}

/** Every set code the pool draws on, in the order the pool first prints one. */
export function setCodesIn(pool: readonly Card[]): readonly string[] {
  const seen: string[] = [];
  for (const card of pool) {
    if (!seen.includes(card.set.code)) seen.push(card.set.code);
  }
  return seen;
}

/**
 * The entries a filter admits, in pool order.
 *
 * The three facets are ANDed and each facet's own values are ORed, which is
 * how every card search anybody has used works: two colors means either color,
 * a color and a word means both.
 */
export function filterPool(entries: readonly PoolEntry[], filter: PoolFilter): readonly PoolEntry[] {
  const needle = filter.text.trim().toLowerCase();
  return entries.filter((entry) => {
    if (needle !== '' && !entry.haystack.includes(needle)) return false;
    if (filter.colors.length > 0 && !filter.colors.some((facet) => entry.facets.includes(facet))) {
      return false;
    }
    if (filter.sets.length > 0 && !filter.sets.includes(entry.card.set.code)) return false;
    return true;
  });
}

function toggled<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function withText(filter: PoolFilter, text: string): PoolFilter {
  return { ...filter, text };
}

export function toggleColor(filter: PoolFilter, facet: ColorFacet): PoolFilter {
  return { ...filter, colors: toggled(filter.colors, facet) };
}

export function toggleSet(filter: PoolFilter, code: string): PoolFilter {
  return { ...filter, sets: toggled(filter.sets, code) };
}
