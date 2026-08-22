/**
 * The one decision a "you may" spell (CR 601.2c) owes: take it or leave it,
 * asked of whichever player the card names, as the spell resolves.
 *
 * `trigger-choice.ts` makes the argument this file reuses without
 * modification: an ability that owes its "you may" is simply the optional
 * trigger on top of the stack, derived rather than stored, because the
 * printed line and the top-of-stack position are the whole of the question.
 * A "you may" *spell* is the same derivation one gate wider — the printed
 * line is `card.may` instead of an ability's own `OptionalTrigger`, and who
 * is asked is `mayChooser(card.may, entry.controller)` instead of always the
 * controller (`mtg-bc2.152.4`). Nothing here is stored on `StackEntry`
 * beyond `mode`, which the modal mechanism already needs for an unrelated
 * reason (`@mtg/dsl`'s `effectsFor`).
 */
import type { Card, MayChooser } from '@mtg/dsl';
import type { PlayerId } from './ids';
import { opponentOf } from './ids';
import type { GameState, StackEntry } from './state';
import { tryObject } from './zones';

/** A "you may" spell on top of the stack, and who its question is addressed to. */
export interface SpellOnStack {
  readonly entry: StackEntry;
  readonly card: Card;
  readonly chooser: PlayerId;
}

/**
 * Resolves a card's printed chooser to a seat. `'you'` is the spell's own
 * controller; `'opponent'` is the other one — this is a two-player kernel
 * (`opponentOf` takes only a player id, `ids.ts`), so "the opponent" needs no
 * target-selection machinery, only the controller's own id.
 */
export function mayChooser(may: MayChooser, controller: PlayerId): PlayerId {
  return may === 'you' ? controller : opponentOf(controller);
}

/**
 * The "you may" spell on top of the stack, or `null` when the top owes no
 * such answer — either because it is not a spell (an ability, whose "you
 * may" is `trigger-choice.ts`'s question, not this one), or because its card
 * prints no `may` at all.
 *
 * Whether that spell has *already fizzled* (CR 608.2b, checked before a "you
 * may" is ever asked — see `stack.ts`'s `resolveTop`) is deliberately not
 * this function's concern, the same way `optionalTriggerOnTop` leaves fizzle
 * to its own caller: this only says who is on top and what they printed, and
 * is read both by the code deciding whether to pause and by `pendingDecision`
 * reading back a pause already in effect.
 *
 * The card comes off `entry.copiedSpell` before the object table, the way
 * `resolveTop` reads it: a copied spell (CR 707.10) is a stack entry with no
 * object at all, so a `getObject` here throws on a copy of a "you may" spell
 * rather than asking its question. A copy prints what the original printed,
 * `may` included.
 */
export function spellAwaitingMay(state: GameState): SpellOnStack | null {
  const entry = state.stack[state.stack.length - 1];
  if (entry === undefined || entry.ability !== null) return null;
  const card = entry.copiedSpell?.card ?? tryObject(state, entry.oid)?.card;
  if (card === undefined || card.may === undefined) return null;
  return { entry, card, chooser: mayChooser(card.may, entry.controller) };
}
