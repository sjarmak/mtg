/**
 * The seam between a finished draft and `@mtg/deckbuild`.
 *
 * `buildDeck` takes a pool of DSL cards and nothing else — that is the same
 * seam `openSealedPool` already produces, so carrying a drafted pool into the
 * deck builder is a converter and not a change to the builder. A sealed pool
 * and a drafted pool differ in how they were assembled and in nothing the
 * builder can see: 72 cards from six packs opened at once, or 36 taken one at a
 * time from packs that went around a table.
 *
 * A seat holds its picks rather than a pool, and the pool is derived here.
 * Keeping one record means the pick log and the pool cannot disagree about what
 * a seat drafted, and the derivation is the whole conversion: pick order is not
 * something `buildDeck` reads, because it scores every card in the pool.
 *
 * A drafted pool is thinner than a sealed one — three 12-card packs against
 * six — so a deck built from it is likelier to report `spellSlots` and
 * `curveSlot` shortfalls. That is the pool being honest about a small draft,
 * not the builder failing; callers that need a complete deck check
 * `result.complete` exactly as they do for sealed.
 */
import type { Card } from '@mtg/dsl';
import type { DraftResult, DraftSeat } from './draft';

/** One seat's drafted pool, in pick order. */
export function draftedPool(seat: DraftSeat): readonly Card[] {
  return seat.picks.map((pick) => pick.card);
}

/** Every seat's pool, in seat order. */
export function draftedPools(result: DraftResult): readonly (readonly Card[])[] {
  return result.seats.map(draftedPool);
}
