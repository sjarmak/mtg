/** The exact cards, tokens, and synthesized basics the browser can paint. */
import { parseCard, setBasics, setTokens } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { ResolvedSet } from './resolve-set';

/** The printed ids ordinary manifest discovery has always ranked against. */
export function printedCardIdsOf(set: ResolvedSet): readonly string[] {
  const document = JSON.parse(set.json) as { readonly cards?: unknown };
  if (!Array.isArray(document.cards)) return [];
  return document.cards.flatMap((card: unknown) =>
    typeof card === 'object' && card !== null && 'id' in card && typeof card.id === 'string' ? [card.id] : [],
  );
}

/**
 * The three-letter code the set names itself by, or `null` when it names none.
 *
 * The identity every *other* artifact keys to: a precon file states it, a
 * statistics log writes it on every game row. Read off the raw JSON like the
 * ids above, because `parseCard` says nothing about the document around them.
 */
export function setCodeOf(set: ResolvedSet): string | null {
  const document = JSON.parse(set.json) as { readonly set?: unknown };
  const named = document.set;
  if (typeof named !== 'object' || named === null || !('code' in named)) return null;
  const { code } = named as { readonly code?: unknown };
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/** Every printed card of the set, parsed. */
export function cardsOf(set: ResolvedSet): readonly Card[] {
  const document = JSON.parse(set.json) as { readonly cards?: unknown };
  if (!Array.isArray(document.cards)) return [];
  return document.cards.map((card) => parseCard(card));
}

export function surfaceIdsOf(set: ResolvedSet): readonly string[] {
  const cards = cardsOf(set);
  const printed = new Set(cards.map((card) => card.id));
  const tokens = setTokens(cards).map((token) => token.card.id);
  const basics = setBasics(cards)
    .filter((card) => !printed.has(card.id))
    .map((card) => card.id);
  return [...cards.map((card) => card.id), ...tokens, ...basics];
}
