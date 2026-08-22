/**
 * Which copy of its card each object is, so five Swamps are five pictures.
 *
 * A set prints several illustrations for a basic land, and the art pipeline's manifest
 * now carries all of them. Choosing between them is the whole design problem,
 * and it has three requirements that rule out the obvious answers:
 *
 * - **Stable for the life of the object.** A Swamp that changes picture when it
 *   taps, or when React re-renders, is a bug. So the choice cannot be made at
 *   render time out of anything that moves — not the object's position in
 *   `state.battlefield`, which shifts every time a permanent leaves, and not a
 *   counter kept in a component, which resets.
 * - **Deterministic.** `Math.random()` would make the replay viewer paint a
 *   different board than the game it is replaying. Everything else in this repo
 *   that picks draws from a seeded stream; this picks from nothing at all.
 * - **Spread.** Five Swamps drawn from three arts should show all three.
 *
 * What satisfies all three is the object's own creation order. Object ids are
 * `o<n>` from the state's monotonic counter (`@mtg/kernel`'s `ids.ts`), never
 * reused and never renumbered, and `state.objects` is append-only — a permanent
 * that dies moves zone and keeps its entry. So "how many objects of this card
 * were created before this one" is a number fixed at the moment the object came
 * into existence and true for the rest of the game, and it is a *dense* number
 * rather than a hash: the copies of one card in one deck get 0, 1, 2, 3 …, which
 * the round-robin in `pickVariant` turns into every illustration in turn.
 *
 * "Copy" here is the ordinary English word, not CR 707. A copy effect produces a
 * new object with its own id and therefore its own place in this order, which is
 * the right answer: a token copy of a Swamp is another Swamp on the table and
 * should not be the same picture as the one it copied.
 */
import type { GameState, ObjectId } from '@mtg/kernel';

/**
 * The trailing counter in an object id, which is its creation order.
 *
 * Ids are built by `objectId`/`abilityObjectId` as a prefix and a number from
 * one counter, so the digits are the only part that orders them. An id with no
 * digits sorts last and ties break on the id itself, which keeps this a total
 * order over anything at all rather than a crash on a shape it did not expect.
 */
function creationOrder(oid: ObjectId): number {
  const digits = /(\d+)$/.exec(oid);
  return digits?.[1] === undefined ? Number.MAX_SAFE_INTEGER : Number(digits[1]);
}

/** One object as this file needs to see it: an id and the card it is of. */
export interface ArtCopyObject {
  readonly oid: ObjectId;
  readonly cardId: string;
}

/**
 * Every object's copy number, keyed by object id, over any object table.
 *
 * Built once per projection rather than asked per permanent: the answer for one
 * object depends on every other object of the same card, so a per-permanent
 * lookup would rescan the table once per tile.
 *
 * **Two callers, one function, and that is the point of the seam.** The played
 * table passes `GameState.objects`; the replay viewer passes the object table
 * its log records (`../replay/frame.ts`), which is the same table written down.
 * A second derivation would be a second chance to number the copies differently
 * from the game that was played, and a replay that paints a board its game did
 * not paint is exactly the bug `mtg-6hrz` asks about.
 */
export function copyNumbers(objects: Iterable<ArtCopyObject>): ReadonlyMap<ObjectId, number> {
  const byCard = new Map<string, ObjectId[]>();
  for (const object of objects) {
    const found = byCard.get(object.cardId);
    if (found === undefined) byCard.set(object.cardId, [object.oid]);
    else found.push(object.oid);
  }
  const copies = new Map<ObjectId, number>();
  for (const oids of byCard.values()) {
    const ordered = [...oids].sort((a, b) => creationOrder(a) - creationOrder(b) || (a < b ? -1 : 1));
    ordered.forEach((oid, index) => copies.set(oid, index));
  }
  return copies;
}

/** The live table's object table, read through `copyNumbers`. */
export function artCopies(state: GameState): ReadonlyMap<ObjectId, number> {
  return copyNumbers(
    Object.values(state.objects).map((object) => ({ oid: object.oid, cardId: object.card.id })),
  );
}
