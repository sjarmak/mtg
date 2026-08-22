/**
 * The stack, as a list of objects rather than a thing to infer from the log.
 *
 * `entries[0]` is the bottom of the stack, matching the kernel's array, and the
 * component reverses it so the first item in the DOM is the one that resolves
 * next. That used to be `column-reverse` in the sheet, which put the right thing
 * at the top of the box for a sighted player and left a screen reader reading
 * the stack bottom-first — the exact opposite of the order it resolves in, on
 * the one surface whose whole job is saying what happens next. Order lives in
 * the markup now and the sheet draws it in the order it is given.
 *
 * Each entry says four things, because each is a question the log answers only
 * by being read backwards: where it is in the resolution order, what it is, whose
 * it is, and what it is aimed at. The head says the rule that governs all of them
 * — the top resolves when both players pass — so the stack is where the rule is
 * written as well as where its state is drawn (`mtg-bz2.4`).
 *
 * # What it is aimed at is drawn as well as said (`mtg-njrp`)
 *
 * "What it is aimed at" was a phrase and nothing else, and a phrase cannot
 * separate two permanents that are called the same thing: two copies of one
 * creature, an equip aimed at one of them, and the same target line under both.
 * Killing the targeted one fizzles the equip and killing the other one does not,
 * so the entry's target line was describing a decision it could not resolve.
 *
 * So the entry carries a **reticle with its own resolution number**, and
 * `../board/Battlefield.ts` puts the same reticle with the same number on the
 * permanent. The number is counted here and nowhere else, because it is this
 * list's own position. It is drawn only when the projection reports a target
 * that is on the battlefield (`StackItem.onBoard`), since a mark pairing with
 * nothing would be worse than none.
 *
 * # The top entry is a control now (`mtg-atq`)
 *
 * The playtester, 2026-08-14: "for cards where I need to 'let it resolve' it should
 * show it go 'onto the stack' and the option to 'resolve' should be clickable
 * there not something I need to scroll down to in a left panel." The move was
 * only ever reachable as a line in the ask column's `Turn` group, which is at the
 * bottom of a list that runs to sixteen options at a busy priority (`mtg-euc`),
 * and the thing it is about is drawn three inches away in this box.
 *
 * **A second door to one index, never a second list.** `onResolve` submits
 * `passIndex(decision)` — the same integer the ask column's own entry submits and
 * the same one the fixed pass and the space key take. That is the rule
 * `../routes/play/rail.ts`'s contract states and `mtg-bz2.14` states for gestures:
 * direct manipulation is added *beside* the enumeration, never instead of it. The
 * move is still in `LEGAL_MOVES_LABEL`, still exactly once, and this button sits
 * outside that group exactly as `../routes/play/pass.ts`'s fixed one already does.
 *
 * Only the top entry carries it, because only the top entry resolves. An entry
 * underneath is waiting, and a button on it would be offering a move that does
 * not exist.
 *
 * **It works for an object with no card.** An activated ability on the stack is
 * an object without a card (CR 113.7a), and `../routes/play/position.ts` draws it
 * as the permanent it was printed on — so the entry is built the same way either
 * way and the control hangs off the entry rather than off the card.
 *
 * # It is a strip on the seam now, and it draws nothing when the stack is empty
 *
 * `mtg-rgc.7`. This was a `Zone` in the side rail, and a zone in that rail is a
 * block whether or not it holds anything: `../styles/board/rail.ts` floors every
 * rail block at 3.25rem so a squeezed one still reads as a place, so an empty
 * stack — which is the state of nearly every decision in a game — cost 52px of
 * the one column the log is trying to grow in. Measured over the whole matrix
 * before the move: the rail was 710.2 / 742.2 / 842.2px at 1024x768 / 1280x800 /
 * 1440x900 and the empty stack's block took 52 of it at every one.
 *
 * So it is drawn where a stack sits on a real table, which is between the two
 * players: `./CombatZone.ts`'s seam, out of flow, over the mat. Empty renders
 * `null` rather than an empty box, because a strip that says "stack is empty"
 * over the middle of the board is worse than nothing — the board already says
 * that by having no strip on it.
 *
 * **The strip is one row and it never grows.** Entries lay out left to right in
 * resolution order, each shrinking with an ellipsis on its own name, so a stack
 * ten deep is the same height as a stack one deep and the board under it never
 * moves. That is the whole of the "what happens when there is no room" rule:
 * width is the axis it spends, exactly as the combat band beside it spends
 * width, and the ask column still enumerates every legal move including this one.
 *
 * Where it sits and what guarantees it covers nothing is
 * `../styles/board/stack.ts`, which carries the measurement.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { formatManaCost, isCastable } from '@mtg/dsl';
import { cardColorIdentity } from '../card/identity';
import { markNode } from './Mark';

export interface StackItem {
  readonly key: string;
  readonly card: DslCard;
  /** Display name of the controller, not a seat index. */
  readonly controller: string;
  /** Already-resolved description of the chosen targets, e.g. "Bear token". */
  readonly targetLabel?: string;
  /**
   * At least one of those targets is a permanent on the battlefield, so the
   * board is drawing the other half of this entry's mark
   * (`./Battlefield.ts`, `targetedMarks`).
   *
   * A flag rather than the number, because the number is this list's own
   * position and `StackZone` already counts it; a projection that passed one in
   * would be a second derivation of one fact, and the two would disagree the
   * first time an entry resolved. False is the honest state for three different
   * entries and the reticle is drawn for none of them: one aimed at a player,
   * one aimed at another spell on the stack, and one whose targeted permanent
   * has since left the battlefield — a mark pointing at a card nobody can find
   * is worse than no mark, and the entry's own target line still names what it
   * was aimed at.
   */
  readonly onBoard?: boolean;
  /**
   * An activated ability rather than the card itself (CR 113.7a). The card is
   * then the permanent the ability was printed on, which is the only thing
   * about the entry a player can be shown: an ability on the stack has no card
   * of its own. It also decides what the meta line says, because the source's
   * mana cost is not what the activation was paid with, and printing it there
   * would be the one number on the row that is wrong.
   */
  readonly ability?: boolean;
}

export interface StackZoneProps {
  readonly label?: string;
  readonly entries: readonly StackItem[];
  /**
   * Takes the pass that lets the top of the stack resolve, or absent when the
   * kernel enumerated no pass in this decision.
   *
   * Absent draws no button rather than a disabled one, which is the opposite of
   * what `../routes/play/pass.ts` does and is right for the opposite reason: that
   * button's whole promise is a fixed place, so it has to stay put and say no,
   * and this one is an affordance *on an object* — a stack entry with a dead
   * control on it would be claiming the object is where a move lives when it is
   * not. A replay frame passes nothing and gets the box it always had.
   */
  readonly onResolve?: (() => void) | undefined;
}

/**
 * What the control on the top entry says.
 *
 * The same words the ask column's own entry for this move carries
 * (`../routes/play/prompt.ts`'s `labelOf` writes `Let it resolve` for a
 * `passPriority` over a non-empty stack), because they are the same move and a
 * player who learns one phrase should not have to learn a second. It is
 * deliberately not `PASS_LABEL`: the fixed button says `Pass` whatever the stack
 * holds, and half of what makes that home fixed is that its word never changes.
 */
export const RESOLVE_LABEL = 'Let it resolve';

/** What the top entry says about itself, and how every test finds it. */
export const RESOLVES_NEXT = 'resolves next';

/** What everything under the top says: it is waiting for the object above it. */
export const WAITING = 'waiting';

/**
 * The rule, carried by the strip that enforces it.
 *
 * It used to be printed in the zone's head, on the argument that "why has this
 * not happened yet" is the question a stack area exists to pre-empt. The strip
 * on the seam has no head and 32px of height to spend, and eight words of
 * standing rule would have taken about a third of its width away from the thing
 * it is actually drawing. So the words are still said — as the group's
 * description, which is what a `title` beside an `aria-label` becomes — and the
 * pixels go to the objects. A player with a pointer reads it on hover; a screen
 * reader reads it after the name on entering the group; nobody reads it eight
 * times a turn.
 *
 * It is deliberately not folded into the name. "Stack" is what a reader
 * navigates by and what every test on this route finds the group with, and a
 * name that grew a clause would have made the one stable handle on this surface
 * a sentence.
 */
export const STACK_NOTE = 'top resolves when both pass';

/**
 * The half of the target mark this entry carries: the same reticle the
 * permanent it is aimed at wears, and the same number.
 *
 * Drawn beside the target line rather than in place of it. The line says *what*
 * the entry is aimed at and the mark says *which one on the table that is*,
 * which are different facts the moment the board holds two permanents the line
 * cannot separate — which is the whole of `mtg-njrp`. The number is this entry's
 * own place in the resolution order, counted once, here.
 */
function targetMark(order: number): ReactElement {
  return markNode({
    key: `targeted-${String(order)}`,
    // The label and no `title`, because `./Mark.ts` prefers the title when both
    // are given and this badge has one sentence to say. It is the mirror of the
    // sentence on the card — each end says the number and where the other end
    // is — so a screen reader that meets either one is told how to find the
    // other.
    label: `Aimed at the permanent marked ${String(order)} on the battlefield`,
    tone: 'neutral',
    glyph: 'reticle',
    badge: String(order),
  });
}

/** `order` counts from the top: 1 is the object that resolves next. */
function entryNode(entry: StackItem, order: number, onResolve: (() => void) | null): ReactElement {
  const cost = isCastable(entry.card) ? formatManaCost(entry.card.manaCost) : '';
  const what = entry.ability === true ? 'ability' : cost;
  const aimed = entry.onBoard === true ? [targetMark(order)] : [];
  const meta: readonly ReactNode[] = [
    entry.controller,
    what,
    ...aimed,
    entry.targetLabel ?? '',
    order === 1 ? RESOLVES_NEXT : WAITING,
  ].filter((part) => part !== '');
  return createElement(
    'li',
    {
      key: entry.key,
      className: 'mtg-stack__entry',
      'data-top': order === 1,
      'data-order': order,
    },
    createElement(
      'span',
      { className: 'mtg-stack__name' },
      // The number is real text rather than paint. A styled `ol` loses its list
      // semantics in some engines, and the position of an object in the
      // resolution order is the one fact on this row that nothing else carries.
      createElement('span', { className: 'mtg-stack__order' }, `${String(order)}.`),
      createElement('span', {
        className: 'mtg-swatch',
        'data-identity': cardColorIdentity(entry.card),
        'aria-hidden': true,
      }),
      ` ${entry.card.name}`,
    ),
    createElement(
      'span',
      { className: 'mtg-stack__meta' },
      // The mark is already an element with its own key and its own role, so it
      // goes in as itself rather than wrapped in a `span` — a badge inside a
      // plain generic is the thing `./Mark.ts` argues an accessibility tree
      // drops.
      ...meta.map((part, index) =>
        typeof part === 'string' ? createElement('span', { key: `${index}` }, part) : part,
      ),
    ),
    order === 1 && onResolve !== null
      ? createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn mtg-stack__resolve',
            'data-variant': 'primary',
            onClick: onResolve,
          },
          RESOLVE_LABEL,
        )
      : null,
  );
}

/**
 * Objects waiting to resolve, or nothing at all.
 *
 * `null` on an empty stack is the load-bearing half of `mtg-rgc.7`: this is the
 * state the table is in for most of a game, and the strip is out of flow, so an
 * empty stack now costs the board no pixels on either axis rather than a floored
 * rail block.
 *
 * The count is drawn beside the entries rather than in a head, because the strip
 * is one row: it is the one fact the row itself cannot show when the entries
 * have shrunk to their ellipses.
 */
export function StackZone(props: StackZoneProps): ReactElement | null {
  const label = props.label ?? 'Stack';
  const top = props.entries.length;
  if (top === 0) return null;
  const onResolve = props.onResolve ?? null;
  return createElement(
    'div',
    {
      className: 'mtg-stack-seam',
      role: 'group',
      // The name is what the group is; the rule is what it does. `title` beside
      // an `aria-label` is read as the description rather than the name, which
      // keeps "Stack" the thing a reader navigates by. `STACK_NOTE` says why the
      // rule stopped being printed chrome.
      'aria-label': label,
      title: STACK_NOTE,
    },
    createElement('span', { key: 'count', className: 'mtg-stack-seam__count' }, `${label} ${String(top)}`),
    createElement(
      'ol',
      { key: 'stack', className: 'mtg-stack' },
      ...props.entries.map((entry, index) => entryNode(entry, top - index, onResolve)).reverse(),
    ),
  );
}
