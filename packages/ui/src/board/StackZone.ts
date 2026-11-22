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
import type { CardArt } from '../card/ArtSlot';
import { cardColorIdentity } from '../card/identity';
import { markNode } from './Mark';

export interface StackItem {
  readonly key: string;
  readonly card: DslCard;
  /** Exact presentation attached to a mapped printed spell. */
  readonly art?: CardArt | null;
  /** Display name of the controller, not a seat index. */
  readonly controller: string;
  /** Already-resolved description of the chosen targets, e.g. "Bear token". */
  readonly targetLabel?: string;
  /**
   * The chosen mode's own sentence, when the object on the stack is modal
   * (CR 700.2).
   *
   * A field rather than a prefix on `targetLabel`, which is where it used to
   * ride (`mtg-sujc`, and `mtg-7si0` before it, whose lane could not reach this
   * type). They are two facts: the mode says *which spell this is* out of the
   * ones the card offers, and the target says what that spell is pointed at, and
   * a modal spell with a target was printing both as one string. Two fields let
   * the row lay them out separately, shorten them separately, and hand a screen
   * reader two sentences instead of a run-on.
   *
   * The text is `renderEffectList` over exactly the effects the chosen mode
   * resolves, which is the renderer a card's oracle paragraph is built from, so
   * nothing narrower is needed on the DSL side.
   */
  readonly modeLabel?: string;
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
  /**
   * The entries a spell being aimed may be attached to, and the press that
   * attaches one (`mtg-bz2.16`).
   *
   * One object rather than a set beside a handler, for `../board/SeatPod.ts`'s
   * reason: a lit entry with no press and a press with nothing lit are both
   * states nobody wants and neither can be written. Absent — which is every
   * moment no counterspell is being aimed, and every replay frame — leaves the
   * strip exactly what it was.
   *
   * The keys are the strip's own, so nothing here converts an object id;
   * `../routes/play/targeting.ts` does that conversion once, where the candidate
   * list is read.
   */
  readonly aim?: { readonly answers: ReadonlySet<string>; readonly onAim: (key: string) => void };
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
function entryNode(
  entry: StackItem,
  order: number,
  onResolve: (() => void) | null,
  aim: StackZoneProps['aim'],
): ReactElement {
  // A counterspell being aimed can name this object (`mtg-bz2.16`). The entry
  // itself becomes the control rather than growing a button beside the Resolve
  // one, because the strip spends width and never height: a second control on
  // every legal entry is the one change that would make a stack four deep stop
  // fitting on its row. It is `role: 'button'` on the `li` rather than a real
  // `button` element for the same width reason — a nested button would need its
  // own box — and it takes the tab order for as long as the slot is open, which
  // is the only moment there is a move on this row at all.
  const aimable = aim !== undefined && aim.answers.has(entry.key);
  const cost = isCastable(entry.card) ? formatManaCost(entry.card.manaCost) : '';
  const what = entry.ability === true ? 'ability' : cost;
  const aimed = entry.onBoard === true ? [targetMark(order)] : [];
  const meta: readonly ReactNode[] = [
    entry.controller,
    what,
    ...aimed,
    // What it is aimed at is the one part of this sentence whose length is a
    // card name rather than a word this file wrote, so it is the part the strip
    // shortens when the row runs out of room, and it says so in its class.
    // `styles/board/stack.ts` holds every other part at its natural width; a row
    // that shrank them all evenly reported the controller as `Oppo…` and the
    // mana cost as `{1}…` to save a name nobody had finished reading either.
    // The chosen mode, ahead of the target, because it says which spell this is
    // and the target says where that spell points: read the other way round the
    // row names a destination before it has named the thing going there. It
    // shrinks the way the target does and for the same reason — both are card-
    // authored text rather than a word this file wrote — which is also what it
    // did when the two were one string.
    entry.modeLabel === undefined
      ? ''
      : createElement('span', { key: 'mode', className: 'mtg-stack__mode' }, entry.modeLabel),
    entry.targetLabel === undefined
      ? ''
      : createElement('span', { key: 'target', className: 'mtg-stack__target' }, entry.targetLabel),
    // The closing word, in a class of its own so a table can drop it: on a
    // strip with no room it is the part that says the least, because the top
    // entry is already the one wearing the accent and the only one with a
    // Resolve button beside it.
    createElement(
      'span',
      { key: 'state', className: 'mtg-stack__state' },
      order === 1 ? RESOLVES_NEXT : WAITING,
    ),
  ].filter((part) => part !== '');
  return createElement(
    'li',
    {
      key: entry.key,
      className: 'mtg-stack__entry',
      'data-top': order === 1,
      'data-order': order,
      // Pressable, so the object can be read (`mtg-mis1`). The key is the one
      // every readable card on this table writes, and the play surface's single
      // delegated focus handler turns a press on it into the full face in the
      // rail's Info section (`../routes/play/inspect.ts`). Nothing is threaded
      // through this component: the entry says which object it is and stops.
      //
      // `tabIndex: -1` rather than a button, which is the pattern
      // `./CardSlot.ts` already uses for a face with no legal move: a
      // press focuses it on either input model, and the tab order stays what it
      // was, because the moves on this strip are the Resolve control and the ask
      // column, and neither of them is this.
      'data-permanent-key': entry.key,
      tabIndex: aimable ? 0 : -1,
      ...(aimable && aim !== undefined
        ? {
            role: 'button',
            'data-aimable': true,
            onClick: (): void => {
              aim.onAim(entry.key);
            },
            // Enter and Space, because `role: 'button'` promises both and a
            // pressable row that answers neither is worse than an unpressable
            // one: it reads as a control to everything that inspects the tree
            // and is one to nothing that uses it.
            onKeyDown: (event: { key: string; preventDefault: () => void }): void => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              aim.onAim(entry.key);
            },
          }
        : {}),
    },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-stack__name mtg-stack__inspect',
        'data-inspect-card': true,
        'aria-label': `View full card for ${entry.card.name}`,
        title: 'View full card',
      },
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
  const aim = props.aim;
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
      ...props.entries.map((entry, index) => entryNode(entry, top - index, onResolve, aim)).reverse(),
    ),
  );
}
