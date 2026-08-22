/**
 * What a permanent is called in a sentence about a move.
 *
 * # Two legal moves must not read the same
 *
 * `mtg-cee`. A target used to be its card's name and nothing else, so a board
 * with one Emberflow Raider a side offered two casts of Lightning Lash whose
 * visible text and accessible name were both `Cast Lightning Lash → Emberflow
 * Raider`. They submit different indices; one burns the opponent's creature and
 * one burns yours. A player picking the wrong one has been told nothing, and a
 * screen-reader user hears the same string twice.
 *
 * The kernel has never had this problem — it separates them by `ObjectId` — so
 * the whole fix is in how a phrase is built. Two rungs, in this order:
 *
 *  1. **A target is said as its controller's**: `your Emberflow Raider`,
 *     `Bot's Emberflow Raider`. Always, not only on a collision, so the phrase
 *     is a fact about the object rather than about what else happens to be in
 *     the list beside it — a move does not change its name because another move
 *     appeared. Whose a creature is is also the decision itself in a targeting
 *     slot, which is why it is worth the four characters everywhere.
 *  2. **A same-named permanent under the same controller carries what tells it
 *     from its twin**, because the possessive cannot separate those two:
 *     `your Emberflow Raider (2/2 · tapped)`. Only when a twin is on the board
 *     and only when the two twins differ, so the qualifier appears exactly where
 *     it is doing work.
 *
 * Two twins that differ in nothing read alike, and that is the true statement
 * about them: nothing on the table separates them, so the choice between them is
 * genuinely free. `distinguishingLine` is the whole of what "differ" means here.
 *
 * **That was written about the board and it was false about the stack**
 * (`mtg-njrp`). Two copies of one creature, an equip on the stack aimed at one,
 * and every property this file inspected said the two were interchangeable —
 * while killing the aimed-at one fizzled the equip and killing the other one did
 * not. The choice was not free; the fact that decided it was a *relationship*
 * rather than a property, and no amount of naming can draw a relationship. So
 * the board draws it (`../../board/Battlefield.ts` and `../../board/
 * StackZone.ts` wear the two ends of one reticle) and `distinguishingLine` gained
 * the third rung below, which says in words what that mark says in paint. The
 * mark had to come first: the qualifier is only allowed to say what a player can
 * already see, which before the mark it could not.
 *
 * # Why the possessive comes from `../../seat.ts`
 *
 * The word is `your` for the seat the reader is sitting in and `<label>'s` for
 * everyone else, and *which seat that is, is a fact about the label* — the
 * hot-seat launcher names both seats outright, so no flag can be trusted to say
 * it. `../../seat.ts` is the one copy of that rule and of the four other words
 * that follow from it. A second copy here is how `mtg-1ih` happened (`rail.ts`
 * printed `You is attacking with 4 creatures.` for a year), so there is one copy
 * and this file calls it.
 */
import type { GameState, ObjectId, Target } from '@mtg/kernel';
import { attachmentOf, powerOf, toughnessOf } from '@mtg/kernel';
import { seatMention, seatPossessive, seatPossessiveLeading } from '../../seat';
import { artCopies } from './art-copies';
import type { SeatNames } from './position';

/** A permanent's printed name, with nothing said about whose it is. */
export function nameOf(state: GameState, oid: ObjectId): string {
  return state.objects[oid]?.card.name ?? `object ${String(oid)}`;
}

/** The names of the permanents attached to this one (CR 701.3a), in board order. */
export function attachmentNames(state: GameState, host: ObjectId): readonly string[] {
  return state.battlefield
    .filter((oid) => attachmentOf(state, oid) === host)
    .map((oid) => nameOf(state, oid));
}

/**
 * Where in the resolution order each object aimed at this permanent sits, 1
 * first.
 *
 * The kernel's stack is bottom-first, so the last entry is the one that resolves
 * next and is 1. Derived here rather than passed in, for the reason every other
 * clause of the line is derived here: a caller that had to supply it could
 * supply a different numbering from the one on screen, and the number is the
 * whole of the pairing.
 */
function aimedAtOrders(state: GameState, oid: ObjectId): readonly number[] {
  const orders: number[] = [];
  state.stack.forEach((entry, index) => {
    const aimed = entry.targets.some(
      (target) => target !== null && target.kind === 'permanent' && target.oid === oid,
    );
    if (aimed) orders.push(state.stack.length - index);
  });
  return orders.sort((one, other) => one - other);
}

/**
 * What tells two same-named permanents apart on a board (CR 704.5j).
 *
 * Only what is visible on the table and only what can differ: what on the stack
 * is aimed at it, how the body currently stands, whether it is tapped, what has
 * been marked on it, and what is attached to it. Two copies that differ in none
 * of those read alike here, which is the true statement about them — the choice
 * is then genuinely free.
 *
 * What is aimed at it comes first because it is the one clause that can decide
 * the move being labeled: `Cast Lightning Lash → your Emberflow Raider` twice over is two
 * buttons with different consequences and one sentence between them, which is
 * `mtg-cee` again through a property this function did not used to inspect. The
 * number is the object's place in the resolution order, which is the number the
 * stack row prints on its entry and the number the reticle on the card carries,
 * so the button, the badge and the stack row are one vocabulary. It is not a
 * legality judgment and must not become one: whether the equip still has a legal
 * target is the kernel's to answer at resolution, and this says only what is
 * aimed where.
 *
 * Attachments are on the list rather than left to the size to imply, because
 * `StaticModification` has two arms and only one of them moves a number: a
 * weapon whose whole clause is `grantKeyword` leaves the creature holding it at
 * exactly its printed power and toughness, so a line built from the size alone
 * would call an equipped creature and a bare one interchangeable while the board
 * draws the pair side by side. The face already shows the attachment
 * (`../../board/Battlefield.ts`), so naming it here says what the player can
 * already see rather than revealing anything.
 */
export function distinguishingLine(state: GameState, oid: ObjectId): string | null {
  const object = state.objects[oid];
  if (object === undefined) return null;
  const parts: string[] = [];
  const aimed = aimedAtOrders(state, oid);
  if (aimed.length > 0) parts.push(`targeted by ${aimed.map(String).join(', ')}`);
  if (object.card.kind === 'creature') {
    parts.push(`${String(powerOf(state, oid))}/${String(toughnessOf(state, oid))}`);
  }
  if (object.tapped) parts.push('tapped');
  if (object.damage > 0) parts.push(`${String(object.damage)} damage marked`);
  const holding = attachmentNames(state, oid);
  if (holding.length > 0) parts.push(`holding ${holding.join(', ')}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * True when the board holds another permanent this one's controller and name
 * cannot be told from, and the two stand differently.
 *
 * Scoped to the battlefield because that is where a duplicate is a decision: the
 * two copies are both on the table, both targetable, and differ in damage or
 * counters or what they are holding. Both halves are load-bearing. Without a
 * twin the qualifier is noise on a permanent nothing can be confused with;
 * without a difference it is a line that repeats itself under both buttons and
 * separates nothing.
 */
function hasDifferingTwin(state: GameState, oid: ObjectId, line: string | null): boolean {
  if (line === null) return false;
  const object = state.objects[oid];
  if (object === undefined) return false;
  let differs = false;
  for (const other of state.battlefield) {
    if (other === oid) continue;
    const twin = state.objects[other];
    if (twin === undefined) continue;
    if (twin.controller !== object.controller || twin.card.name !== object.card.name) continue;
    if (distinguishingLine(state, other) !== line) differs = true;
  }
  return differs;
}

/**
 * A permanent named in a move's sentence, without saying whose it is.
 *
 * For the slots where the controller is not in question and printing it would be
 * a word per name for nothing: an activation's source and an attack's list are
 * both the asked seat's own permanents, every time. The twin qualifier still
 * applies, because two of *your* Emberflow Raiders are exactly the case the
 * possessive cannot reach.
 */
export function permanentName(state: GameState, oid: ObjectId): string {
  const name = nameOf(state, oid);
  const line = distinguishingLine(state, oid);
  return hasDifferingTwin(state, oid, line) ? `${name} (${String(line)})` : name;
}

/**
 * A permanent named as one row of a roster (`declare.ts`), guaranteed to read
 * differently from every other row in `siblings` that names a different
 * object.
 *
 * `mtg-rf12`. `permanentName`'s twin qualifier is right for a target — two
 * copies that differ in nothing really are interchangeable, so the choice
 * between them is free and the shared phrase is the true statement about it.
 * A roster row is not that choice: each row is a button over one specific
 * creature, and pressing the row that reads `Brigand Camp Forager, not
 * blocking` has to mean one Brigand, not "either one, whichever this button
 * happens to be." Two rows a keyboard player cannot tell apart are two
 * identical buttons with no way to know which creature each holds, even
 * though the choice between the creatures themselves was never free — the
 * two blocks are different declarations.
 *
 * So a roster row disambiguates even where a target legitimately would not:
 * `permanentName` still supplies whatever the board itself shows, and only
 * when two rows would still read alike after that does this reach for the
 * one fact every object carries independent of the board, its own creation
 * order — `art-copies.ts`'s `artCopies`, the same numbering that already
 * decides which illustration a permanent draws, because a second numbering
 * here would be a second chance to count the same copies differently from
 * the one the art pipeline already counts them by.
 */
export function rosterName(state: GameState, oid: ObjectId, siblings: readonly ObjectId[]): string {
  const base = permanentName(state, oid);
  const collides = siblings.some((other) => other !== oid && permanentName(state, other) === base);
  if (!collides) return base;
  const copy = artCopies(state).get(oid);
  return copy === undefined ? base : `${base} (copy ${String(copy + 1)})`;
}

/**
 * A permanent named in a slot where whose it is decides the move.
 *
 * The possessive is here and not on `permanentName` because a target's
 * controller is the choice — burn theirs or burn your own — while a source's
 * controller is never in question. A rail that said `your` on every activation
 * of every permanent would be spending a word per button on a fact no move on
 * the list disagrees about.
 */
export function targetName(state: GameState, names: SeatNames, oid: ObjectId): string {
  const object = state.objects[oid];
  if (object === undefined) return permanentName(state, oid);
  return `${seatPossessive(names[object.controller])} ${permanentName(state, oid)}`;
}

/**
 * The same permanent said as its controller's, with nothing said about how it
 * currently stands.
 *
 * What the game log points at (`mtg-h9s`): `targetName` without the twin
 * qualifier, because the qualifier is read off the board *now* and a log line is
 * about the turn it happened on. The two share the possessive step rather than
 * spelling it twice, which is the whole reason this sits beside `targetName`
 * instead of in `log/narrate.ts` — `LogNames.target` says why the log cannot
 * call either of them directly.
 */
export function ownedName(state: GameState, names: SeatNames, oid: ObjectId): string {
  const object = state.objects[oid];
  if (object === undefined) return nameOf(state, oid);
  return `${seatPossessive(names[object.controller])} ${nameOf(state, oid)}`;
}

/**
 * The same permanent opening a sentence, where only the pronoun takes a capital.
 *
 * `your Emberflow Raider was destroyed.` is a sentence that starts in lowercase,
 * and `Your Emberflow Raider` is not a second naming rule — `../../seat.ts`'s
 * `seatPossessiveLeading` is the one copy, exactly as `seatPossessive` is for
 * `ownedName`. A label keeps its own capital either way, so `Bot's` is `Bot's`
 * in both positions and only the pronoun moves.
 */
export function ownedNameLeading(state: GameState, names: SeatNames, oid: ObjectId): string {
  const object = state.objects[oid];
  if (object === undefined) return nameOf(state, oid);
  return `${seatPossessiveLeading(names[object.controller])} ${nameOf(state, oid)}`;
}

/** Describes a chosen target the way a prompt or a stack entry should read. */
export function describeTarget(state: GameState, names: SeatNames, target: Target): string {
  switch (target.kind) {
    case 'player':
      // The pronoun rather than the label, for the reason the possessive beside
      // it is lowercase: `Cast Lightning Lash → you` sits in the same slot as
      // `→ your Emberflow Raider`, and a capital there reads as a player called
      // You (`mtg-crv` is the same word in a sentence).
      return seatMention(names[target.player]);
    case 'permanent':
    case 'spell':
      return targetName(state, names, target.oid);
  }
}
