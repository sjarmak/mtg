/**
 * The basic lands a set is played with, enumerated once.
 *
 * A generated set need not print Plains through Forest, and the flagship set's
 * 75-card build does not: `@mtg/deckbuild`'s mana base mints them at build time
 * from the pool's dominant set code. They are real cards in a real game — five
 * of them are on the battlefield for most of it — but they are in no card list,
 * so every pass that walks a set's cards misses them. The art pipeline was one
 * of those, and the result was a lab where Swamp drew the pending frame and the
 * governance check reported the set clean. Same shape as the token blind spot,
 * one class over.
 *
 * The card itself is not built here: `basicLand` is the one place that record is
 * built (`examples.ts`), and this file is the one place the set-code derivation
 * lives. Both the mana base and the art pipeline read it, which is the whole
 * point — a basic's id has to be the same string in both, or the manifest key is
 * right in one place and wrong in the other.
 */
import type { Card } from './card';
import { basicLand } from './examples';
import { BASIC_LAND_TYPES } from './vocabulary';

/** Set code for synthesized basics when the list carries no cards at all. */
export const FALLBACK_SET_CODE = 'BAS';

/**
 * The set code a list of cards belongs to: the most common one, ties broken
 * alphabetically, so the answer does not depend on the order they arrived in.
 *
 * Read from whatever list the caller has. A deck's pool is a subset of one
 * generated set, and every subset of a single-code set answers the same, which
 * is what lets the art pipeline derive an id from the whole set that the deck
 * builder derives again from a pool.
 */
export function dominantSetCode(cards: readonly Card[]): string {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.set.code, (counts.get(card.set.code) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? FALLBACK_SET_CODE;
}

/**
 * All five basics for a set, in `BASIC_LAND_TYPES` order.
 *
 * A set that prints its own basic gets that printing back rather than a second
 * one built alongside it; anything else would hand the art pipeline two surfaces
 * for one card. Collector numbers on the synthesized ones follow the same order
 * and carry no meaning beyond keeping the record well-formed.
 */
export function setBasics(cards: readonly Card[]): readonly Card[] {
  const setCode = dominantSetCode(cards);
  return BASIC_LAND_TYPES.map((type, index) => {
    const printed = cards.find((card) => card.kind === 'land' && card.basicLandType === type);
    return printed ?? basicLand(type, setCode, index + 1);
  });
}
