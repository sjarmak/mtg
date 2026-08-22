/**
 * The one decision an "unless its controller pays {2}" spell owes: pay the
 * toll and stop it, or let it happen (CR 118.8, printed as a clause on the
 * spell — `@mtg/dsl`'s `unless.ts`).
 *
 * `may-choice.ts`'s derivation, aimed at the other side of the table. A "you
 * may" spell asks a player the card *names*; this one asks a player the card
 * *points at*, so the seat is read off the entry's chosen target rather than
 * off `card.may`. Nothing is stored on `StackEntry` for either: the printed
 * clause plus the top-of-stack position plus the targets already there are the
 * whole of the question, and a field holding the payer would be a second copy
 * of a fact the targets already carry.
 *
 * ## Why an unaffordable toll is not a question
 *
 * A player who cannot pay is not asked. Every other pause in this kernel hands
 * back a list of things the asked player may legally do, and a pause whose only
 * option is "decline" hands back a decision nobody can influence: it costs a
 * round trip through the agent, appears in the replay log as a choice, and
 * cannot come out any way but one. `spellAwaitingUnless` therefore returns
 * `null` when `canPay` is false and the spell resolves as though the clause
 * were not printed, which is also what happens at a table.
 *
 * That is checked against the *pool plus untapped sources*, which is `canPay`'s
 * whole job (`mana.ts`), so a player holding two untapped Forests is asked
 * about a {2} and a player holding none is not.
 */
import type { Card, UnlessClause } from '@mtg/dsl';
import type { PlayerId } from './ids';
import { canPay } from './mana';
import type { GameState, StackEntry } from './state';
import { getObject, tryObject } from './zones';

/** A tolled spell on top of the stack, and the seat being charged. */
export interface TolledSpellOnStack {
  readonly entry: StackEntry;
  readonly card: Card;
  readonly clause: UnlessClause;
  readonly payer: PlayerId;
}

/**
 * The seat an `UnlessPayer` word names, read off what the spell targets, or
 * `null` when the entry's targets cannot answer it.
 *
 * `checkUnless` has already refused every card whose printed target kind makes
 * the word unreadable, so `null` here means a *game-time* absence rather than
 * an authoring mistake: a spell resolving with no target left, or one whose
 * target has changed zones since it was chosen. Both cases end in the spell
 * fizzling under CR 608.2b, which `resolveTop` checks before it ever reaches
 * the toll, so `null` reads "there is no toll to charge" rather than "throw".
 */
export function unlessPayer(state: GameState, entry: StackEntry, clause: UnlessClause): PlayerId | null {
  const target = entry.targets[0];
  if (target === undefined || target === null) return null;
  if (clause.payer === 'targetPlayer') return target.kind === 'player' ? target.player : null;
  if (target.kind !== 'permanent') return null;
  return getObject(state, target.oid).controller;
}

/**
 * The tolled spell on top of the stack, or `null` when the top owes no such
 * answer — it is an ability, its card prints no clause, its target no longer
 * names a payer, or the payer cannot afford the toll.
 *
 * `spellAwaitingMay`'s contract, including what it leaves out: whether the
 * spell has already fizzled is the caller's question (`stack.ts` checks CR
 * 608.2b first), and this only says who is on top and what they are being
 * charged. Read both by the code deciding whether to pause and by
 * `pendingDecision` reading a pause already in effect, which is why it must
 * stay a pure function of the state.
 *
 * Unlike `spellAwaitingMay` it reaches the card the way `resolveTop` does, past
 * `entry.copiedSpell` and through `tryObject` rather than `getObject`. A copied
 * spell (CR 707.10) is a stack entry with no object in the table at all, and
 * `resolveTop` calls this on every spell it resolves rather than only on ones
 * already known to print a clause, so a `getObject` here throws on the first
 * copy any game makes. A copy carries the original's printed text, toll
 * included, which is the other half of why the entry's own card is the right
 * one to read.
 */
export function spellAwaitingUnless(state: GameState): TolledSpellOnStack | null {
  const entry = state.stack[state.stack.length - 1];
  if (entry === undefined || entry.ability !== null) return null;
  const card = entry.copiedSpell?.card ?? tryObject(state, entry.oid)?.card;
  if (card === undefined) return null;
  const clause = card.unless;
  if (clause === undefined) return null;
  const payer = unlessPayer(state, entry, clause);
  if (payer === null) return null;
  if (!canPay(state, payer, clause.cost)) return null;
  return { entry, card, clause, payer };
}
