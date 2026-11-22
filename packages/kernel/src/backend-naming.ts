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
import { spellCardByOid } from './stack-spell';
import { copiableCardOf } from './state';
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
 * Abilities and copied spells on the stack have no `GameObject` behind them.
 * A copied spell still has a card through its stack entry; an ability has only
 * its id, which is a documented shape rather than a fault.
 */
export function nameOf(state: GameState, oid: ObjectId): string {
  const pendingFace = state.pendingFreeCast?.oid === oid ? state.pendingFreeCast.card : undefined;
  const object = state.objects[oid];
  return (
    pendingFace?.name ??
    (object === undefined ? undefined : copiableCardOf(object).name) ??
    spellCardByOid(state, oid)?.name ??
    String(oid)
  );
}
