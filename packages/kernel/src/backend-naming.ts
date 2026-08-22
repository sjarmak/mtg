/**
 * The two strings the neutral projection needs off a card, and nowhere else to
 * put them.
 *
 * `backend.ts` is an adapter and should read as one, so the two places it has to
 * turn a card into words live here rather than inline. Both are deliberately
 * thin: a type line the way `@mtg/dsl` already assembles one, and an object's
 * name with a stated answer for an object that is not there.
 */
import type { Card } from '@mtg/dsl';
import { typeLineParts } from '@mtg/dsl';
import type { ObjectId } from './ids';
import type { GameState } from './state';

/** `Legendary Artifact Creature — Golem`, joined the way a card prints it. */
export function typeLineOf(card: Card): string {
  const parts = typeLineParts(card);
  const front = [...parts.supertypes, ...parts.types].join(' ');
  return parts.subtypes.length === 0 ? front : `${front} — ${parts.subtypes.join(' ')}`;
}

/**
 * What an object is called, or what to say when there is no object.
 *
 * An ability on the stack has an `ab<n>` id and no `GameObject` behind it, which
 * is a documented shape rather than a fault, so the miss is answered rather than
 * thrown on.
 */
export function nameOf(state: GameState, oid: ObjectId): string {
  return state.objects[oid]?.card.name ?? String(oid);
}
