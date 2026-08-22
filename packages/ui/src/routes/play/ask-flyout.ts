/**
 * What a shut ask column does when the game has something to say to this seat.
 *
 * # The complaint, and what was actually true
 *
 * The playtester, 2026-08-20, after playing: "I want to not have to expand the panel
 * to be able to click through the actions, or if that doesnt work well then at
 * least get an alert." She named combat and spells being cast, and then the
 * worst case on the route: "for example it'll say something of mine is destroyed
 * and I'll need to open the panel and click continue."
 *
 * The premise held. `../../styles/board/rail.ts` gives `[data-ask='shut']` a
 * 5rem column and hides `.mtg-board__pods > .mtg-panel` in it, and all four
 * things `./PlayView.ts` can put in that slot — the beat, the prompt, the wait
 * and the result — are `.mtg-panel`. So a shut column could pass priority and do
 * nothing else: every target, every blocker assignment, every trigger ordering,
 * every mana payment and every Continue on a halted game was behind a press on
 * the disclosure. Her example is the sharpest form of it, because a beat has
 * exactly one move in it: the game stops, says why in a panel that is not drawn,
 * and offers the one acknowledgment in that same undrawn panel.
 *
 * # The shape
 *
 * A flyout anchored to the strip and drawn over the board's left region, holding
 * **whichever panel the open column would have drawn**. It is deliberately
 * content-blind: it takes a `ReactNode` and never asks what is in it, so the
 * property this file is really about — *a shut column is never a state in which
 * the game has something to say to this seat and no way to say it* — holds for
 * whatever occupies that slot next. `mtg-gt4q` then replaced part of the beat
 * panel with the motion itself and cost this file four lines: the beat that
 * plays on the board reaches the seat without a column at all, so it is a slot
 * kind that draws no flyout and no alert, and the guarantee is met by the
 * board's own control rather than by this box.
 *
 * Over the board rather than inside the column, and that is what makes it free.
 * The column is shut because the board wants the width (`mtg-e0i` is open on the
 * number and `../../styles/board/rail.ts` argues both `PLAY_ASK_REM` and
 * `ASK_PERCENT` at length), so a wider column is the one answer that is ruled
 * out. A flyout costs the board nothing while nothing is being asked, and while
 * something is, it is free to be wider than 11rem — which is also why the
 * three-line move labels in her screenshot come out as one line: `.mtg-choices`
 * is `repeat(auto-fit, minmax(min(11rem, 100%), 1fr))`, so the same panel in a
 * wider box lays its moves out in columns instead of stacking them.
 *
 * # It is pressed open, and that is the second reading of the same ask
 *
 * It used to open itself, on the argument that a flyout needing a press only
 * moved the press. She played it and said the opposite, 2026-08-20: "the waiting
 * 2 moves should be clickable to expand the available options not always be
 * expanded", and then "or whatever the options are that you need to click
 * through". The first reading was wrong about which press she minded. Opening
 * the column was the press she minded; a panel that appears over the board every
 * time the kernel asks anything is not a press at all, it is a menu that is
 * always up, and the board is the thing being played.
 *
 * So the alert is the control. Shut, the strip says what is owed in two words
 * and that sentence is a button; pressed, it draws the panel over the board;
 * pressed again, it puts it away. The property this file exists for is
 * unchanged, because it was never that the panel is *drawn* — it is that a shut
 * column is never a state in which the game has something to say to this seat
 * and no way to say it. One press away is a way.
 *
 * # One ask opens itself, and it is the one with no board behind it
 *
 * The playtester, 2026-08-22, playing sideways on a phone: "If the only option is
 * keep or mulligan you shouldn't need to click into 'waiting' it should just
 * show you a keep or mulligan button option immediately." The opening hand is
 * the one decision the paragraph above does not cover, and it comes apart from
 * the rest on both halves of that argument.
 *
 * **There is no board to put a menu over.** Both battlefields are empty, nothing
 * has been cast, and this box is drawn over the board's left region, which at
 * that moment holds two empty pods. The objection to a panel that is always up
 * is that the board is the thing being played; at the opening hand there is
 * nothing under the box to play.
 *
 * **And there is no other way in.** Every other ask leaves something pressable
 * on the table — a card to cast, a creature to stage, a blocker to assign, the
 * fixed pass on the strip — so a shut column is a column a player can act
 * around. `./prompt.ts`'s `oidsOf` hands `mulligan` and an unbottomed `keepHand`
 * no objects at all, and `./pass.ts`'s button is drawn disabled, because the
 * opening hand is not a priority window and the kernel enumerates no pass in
 * one. It is also the first decision of every game, before
 * anyone has learned that `Waiting / 2 moves` is a button. The whole table is a
 * hand of seven and a word.
 *
 * It is a decision kind and not a size rule. "Two options" would fire on a
 * priority window with two legal moves, which is the live board she said not to
 * cover, so the caller says which decision this is (`./PlayView.ts`) and this
 * file says what that costs. Nothing else changes: the alert still toggles it,
 * Escape still puts it away, and being open is still scoped to the ask, so the
 * first priority after the hand is kept arrives shut like every other.
 *
 * # And a halt opens itself for a finger, which is the same argument again
 *
 * The playtester, 2026-08-22, from the same phone: "There should be an easy way to
 * continue passing priority since pressing space isn't an option on mobile
 * easily." Ordinary priority was already one press — `./pass.ts`'s button is
 * fixed on the strip at a touch target's size and enabled whenever the kernel
 * enumerated a pass. The halt is where that stops being true, and it fails both
 * halves of the always-up objection exactly the way the opening hand does.
 *
 * **There is no menu to put over the board.** A halt has one move in it. What
 * this box draws is a sentence saying what happened and a Continue, and the
 * board under it is stopped, which is what a halt is.
 *
 * **And there is no other way in.** `./PlayView.ts` gives a halt no `passAt` —
 * a pause is not a priority window and the kernel enumerates nothing in one — so
 * the fixed button is drawn disabled and every card on the table is inert. The
 * one press in the state was in this box, and the strip's own two words told a
 * player to reach it with a key.
 *
 * On a fine pointer that advice is true: `./pass-key.ts` binds the space key and
 * continues a beat with it, so the panel is a second way in and does not need to
 * be drawn. So this is the one stance on this route that reads the input rather
 * than the state, and `./pointer.ts` says why the question is the pointer and
 * not the width. `askAlertText` and the strip's two words move with it: a seat
 * that cannot press space is told the name of the control that is now in front
 * of it instead.
 *
 * # What closes it
 *
 * **The alert again, and Escape.** A pointer press outside is the other
 * dismissal `./dismiss.ts` offers and it is wrong here: the board is live while
 * the flyout is up. Aiming a spell, staging an attacker and assigning a blocker
 * are all presses on cards outside this box, and each of them is answered *by*
 * the box — the cast panel's Back, the declaration's roster and its Clear all
 * live in it — so a press on the board that closed it would take the panel away
 * at the exact moment the player started using it. `./dismiss.ts` takes an
 * `outside` flag for this, rather than this file growing a second copy of the
 * same document listener.
 *
 * **Being open is scoped to the ask it was opened for**, so it never survives
 * into the next one and a player is never answering a question with the panel
 * from the last. The key is `session.decisions` and `session.events.length`
 * together, which is one refinement on the rule `./pass-key.ts` scopes its note
 * by: the counter alone does not move across a beat, because a beat is a pause
 * and not a decision (`@mtg/kernel`'s `GameSession.beat` says so outright), so
 * two beats in a row would have shared a key and the second would have opened
 * itself off the first one's press. The event log moves for both. Comparing the
 * pair clears the state without an effect and without a timer.
 *
 * **A halt closes like anything else**, which is the one rule this reversal
 * simplifies. It was undismissible while it opened itself, because dismissing
 * the only way to continue a stopped game left nothing on screen to continue it
 * with. The alert is now always that way, in every slot, so the narrowing has
 * nothing left to protect.
 *
 * # The alert stands on its own
 *
 * It was her stated fallback — "or if that doesnt work well then at least get an
 * alert" — and it has to work when the flyout is not on screen, which is exactly
 * when a player has dismissed one and the game is still waiting. It is on the
 * strip, so it survives the collapse the way the disclosure does, and it is a
 * button, so it is also the way back to a flyout that was dismissed.
 *
 * **It distinguishes the two things a shut column can be told.** A halt is the
 * game stopped and going nowhere until one press; a priority window with fifteen
 * legal moves is a set to choose from. A count is the right answer to the second
 * and a wrong answer to the first, so `askAlertText` says one of two sentences
 * rather than one sentence with a number in it.
 *
 * **The count is the enumeration's**, `prompt.choices.length`, and not the
 * number of buttons the list draws. `passPriority` left that list on 2026-08-20
 * (`./rail.ts`'s `UNLISTED`) for a fixed home in `./priority.ts`'s foot, which is
 * on the strip in this state, so a shut column showing `13 legal moves` is
 * showing thirteen controls: twelve in the flyout and the pass under them. A
 * count of the list would have understated what is legal, which is the kernel's
 * word and not a panel's.
 *
 * # Why the announcement is a fifth `role="status"` and not a fold
 *
 * `../PhaseBar.ts`'s `PHASE_BAR_STATUS_LABEL` records the rule: two lanes once
 * collided by each adding an unnamed region, and three unnamed channels are one
 * channel. There are four named ones on this table — `Stop changes`, `Newest log
 * entry`, `Priority changes` and `Pass shortcut` — and this is a fifth.
 *
 * It is not `PRIORITY_STATUS_LABEL`. That region reports a *position* and is in
 * the document in both width states and at every decision, priority or not; this
 * one reports that the answer has moved off the column and where it went, fires
 * only while the column is shut, and has to fire on a halt, which is not a
 * priority at all and which that region says nothing about. Folding them would
 * make the alert arrive whenever the position commentary next did, which is the
 * same objection `./priority.ts` already made when it split `Pass shortcut` out
 * of `Priority changes`. It is silent in the open column, so the four-region
 * table on the table a player usually gets is unchanged.
 *
 * # No `lib: dom`
 *
 * The workspace tsconfig has none (`../../app/mount.ts` writes out why), so
 * nothing here touches a DOM type. The one host fact this needs is inside
 * `./dismiss.ts`, declared structurally and runtime-checked there.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useDismissable } from './dismiss';

/** The accessible name of the box the panel is drawn in. */
export const ASK_FLYOUT_LABEL = 'Current ask';

/**
 * The announcement region's own name. See `../PhaseBar.ts`'s
 * `PHASE_BAR_STATUS_LABEL` for why every one of these is named, and the docblock
 * above for why this is a fifth channel rather than a fold into the fourth.
 */
export const ASK_ALERT_STATUS_LABEL = 'Ask alert';

/**
 * What the strip has to say, in the two kinds it can be.
 *
 * `halt` is the game stopped with one press to make, drawn as a panel: a combat
 * beat, and any beat at all for a player who asked for reduced motion.
 * `decision` is the kernel asking, with the enumeration's own size. `report` is the finished game and its
 * result, which is not a move and has no key, but is still something this seat
 * has to be able to read and to start a new game from.
 *
 * `idle` is the one panel deliberately left in the column: a networked opponent
 * is deciding and `./rail.ts`'s `waitingPanel` names them. Nothing is owed by
 * this seat, so there is nothing to reach, and an alert saying the game was
 * waiting on this seat would be false — which is the one thing an alert may
 * never be. A shut column showing nothing while another seat thinks is the
 * behavior the route already had and is not the defect this file is about.
 *
 * `board` is what `mtg-gt4q` put in that slot: a pause reported as movement on
 * the table, with its acknowledgment drawn on the table too
 * (`./beat-motion.ts`). It is a fifth kind rather than a reuse of `idle`
 * because the two agree on what this file does and disagree on why. `idle` is
 * *nothing is owed by this seat*; `board` is *something is owed and it is
 * already reachable*, at every column width, which is the property this file
 * exists to guarantee rather than an exception to it. Folding them would have
 * left the fold to be undone by whichever bead next wanted to know which one it
 * was looking at, and `askAlert` would have been one edit away from telling a
 * player to open a column that has nothing in it.
 */
export type AskSlot =
  | { readonly kind: 'halt' }
  | { readonly kind: 'decision'; readonly count: number }
  | { readonly kind: 'report' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'board' };

/**
 * Whether the column and its strip have nothing to carry for this slot.
 *
 * One predicate rather than a comparison against `'idle'` in four places, which
 * is what these four checks were before there was a second such kind. They have
 * to agree — an alert whose flyout draws nothing is a control that does nothing,
 * and a flyout with no alert to open it is unreachable — so they read one
 * function and a sixth kind states its answer here once.
 */
export function askIsQuiet(slot: AskSlot): slot is Extract<AskSlot, { readonly kind: 'idle' | 'board' }> {
  return slot.kind === 'idle' || slot.kind === 'board';
}

/**
 * The full sentence, for the button's name and for the announcement.
 *
 * A halt names what answers it, and that is the one thing on this strip that is
 * not the same on both inputs: `./pass-key.ts` binds the space key and continues
 * a beat with it, and a phone has no space key. `./pointer.ts` reads which seat
 * this is and says why the question is the pointer rather than the width. The
 * default is the keyboard sentence, which is what every caller that has no
 * pointer to report should get.
 */
export function askAlertText(slot: AskSlot, coarse = false): string | null {
  if (askIsQuiet(slot)) return null;
  if (slot.kind === 'halt')
    return coarse
      ? 'The game is paused and moves on when this seat answers. Continue answers it.'
      : 'The game is paused and moves on when this seat answers. The space key answers it.';
  if (slot.kind === 'report') return 'The game is over. The result and a new game are here.';
  const moves = slot.count === 1 ? '1 legal move' : `${String(slot.count)} legal moves`;
  return `The game is waiting on this seat. ${moves}.`;
}

/**
 * The two short words the 5rem strip has room to print.
 *
 * The strip is one touch target wide, so the sentence above cannot be drawn in
 * it. These are drawn instead and marked `aria-hidden`, with the button carrying
 * the whole sentence as its name — the same bargain `./rail-collapse.ts`'s
 * disclosure makes with its chevron, and for the same reason: a name that
 * shrank with the column would leave a reader on an unlabeled control exactly
 * when it is one of two in the column.
 */
function alertWords(slot: AskSlot, coarse: boolean): readonly [eyebrow: string, detail: string] | null {
  if (askIsQuiet(slot)) return null;
  if (slot.kind === 'halt') return ['Paused', coarse ? 'Continue' : 'Press Space'];
  if (slot.kind === 'report') return ['Game over', 'Result'];
  return ['Waiting', slot.count === 1 ? '1 move' : `${String(slot.count)} moves`];
}

export interface AskFlyoutInput {
  /** The ask column's own state. Open draws none of this. */
  readonly collapsed: boolean;
  readonly slot: AskSlot;
  /** `session.decisions`, half of what being open is scoped to. */
  readonly decisions: number;
  /**
   * `session.events.length`, the other half. The docblock says why the counter
   * alone is not enough: it does not move across a beat, and two beats in a row
   * must not share a key.
   */
  readonly events: number;
  /**
   * Whether this ask arrives already drawn, rather than waiting for the press.
   *
   * True for the opening hand at every input, and for a halt on a coarse
   * pointer; the docblock argues why neither is the menu-always-up she objected
   * to, and why the second is a fact about the input rather than about the
   * state. It is a stance and not a command — a press still toggles it, and
   * Escape still puts it away, because what it sets is where the toggle starts
   * from rather than whether the box is on screen.
   */
  readonly opensItself: boolean;
}

export interface AskFlyoutState {
  readonly open: boolean;
  /** The alert's press: draws the panel, or puts an open one away. */
  readonly toggle: () => void;
}

/**
 * What the player last said about this ask, and nothing about any other.
 *
 * A press has to be able to mean *shut* as well as *open*, which a bare "the key
 * this is open for" could not say: an ask that opens itself and is then
 * dismissed is not the same state as one nobody has touched, and both of them
 * have no key recorded. So the key is kept beside the answer rather than
 * standing in for it, and an entry from a previous ask is ignored rather than
 * cleared, which keeps this a state with no effect and no timer in it.
 */
interface AskStance {
  readonly key: string;
  readonly open: boolean;
}

export function useAskFlyout(input: AskFlyoutInput): AskFlyoutState {
  const { collapsed, slot, decisions, events, opensItself } = input;
  const asked = `${String(decisions)}:${String(events)}`;
  const [said, setSaid] = useState<AskStance | null>(null);
  const stance = said !== null && said.key === asked ? said.open : opensItself;
  const open = collapsed && !askIsQuiet(slot) && stance;
  const onDismiss = useCallback((): void => {
    // Recorded against this ask rather than erased, so dismissing one that opened
    // itself does not immediately reopen it.
    setSaid({ key: asked, open: false });
  }, [asked]);
  useDismissable({
    open,
    // Never an outside press; the docblock above says why the live board under
    // this box may not close it.
    outside: false,
    within: (): null => null,
    onDismiss,
  });
  const toggle = useCallback((): void => {
    setSaid((was) => ({ key: asked, open: !(was !== null && was.key === asked ? was.open : opensItself) }));
  }, [asked, opensItself]);
  return { open, toggle };
}

/**
 * The box, over the board's left region, holding the panel the column would have.
 *
 * A `region` with a name rather than a `dialog`: it is not modal and must not be,
 * because the board under it stays live — aiming, staging and blocking are all
 * presses outside this box that this box then answers. A dialog role would
 * promise a focus trap and a modal backdrop, and both are wrong here.
 */
export function askFlyout(open: boolean, slot: AskSlot, panel: ReactNode): ReactElement | null {
  if (!open || askIsQuiet(slot)) return null;
  return createElement(
    'div',
    {
      className: 'mtg-ask-flyout',
      'data-slot': slot.kind,
      role: 'region',
      'aria-label': ASK_FLYOUT_LABEL,
    },
    panel,
  );
}

/**
 * The alert on the strip: what is owed, and the way back to the flyout.
 *
 * Drawn whether or not the flyout is, and it is what opens one. `aria-expanded`
 * says which of those two it currently is, so the control is a disclosure by the
 * pattern's own definition even though its name is a sentence rather than a
 * noun.
 */
export function askAlert(
  slot: AskSlot,
  open: boolean,
  onToggle: () => void,
  coarse = false,
): ReactElement | null {
  const said = askAlertText(slot, coarse);
  const words = alertWords(slot, coarse);
  if (said === null || words === null) return null;
  const [eyebrow, detail] = words;
  return createElement(
    'div',
    { className: 'mtg-ask-alert', 'data-slot': slot.kind },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-ask-alert__button',
        'data-variant': 'primary',
        'aria-label': said,
        'aria-expanded': open,
        onClick: onToggle,
      },
      createElement('span', { className: 'mtg-ask-alert__eyebrow', 'aria-hidden': true }, eyebrow),
      createElement('span', { className: 'mtg-ask-alert__detail', 'aria-hidden': true }, detail),
    ),
    // Always in the document while the strip is drawn, for the reason
    // `./priority.ts`'s two regions are: a live region that arrives carrying its
    // own text has nothing to announce, because nothing about it changed.
    createElement(
      'span',
      {
        className: 'mtg-sr-only',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': ASK_ALERT_STATUS_LABEL,
      },
      said,
    ),
  );
}
