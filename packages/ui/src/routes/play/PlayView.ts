/**
 * The playable table: the shell that composes it, and nothing else.
 *
 * Presentational on purpose: it takes a session and a callback and owns no game
 * state, exactly as `Board` does. Whoever holds the session decides what a click
 * means, which is what lets the same view serve a live game, a resumed
 * recording, and a test that drives it without a browser. The one thing it owns
 * is which card's menu is open, and that lives in `selection.ts`.
 *
 * **This file used to be all of it, and that is what `mtg-bz2` phase 0 changed.**
 * Nine of that epic's fourteen lanes wanted to edit these 574 lines, so they
 * could not run at once. The composition is now four seams, each the file the
 * lane that wants it would open:
 *
 *  - `rail.ts` — the legal-move list, and the contract that keeps it alive.
 *  - `table.ts` — the board with the viewer's own cards wired for clicking.
 *  - `toolbar.ts` — the turn indicator, the phase bar and the dealer's controls.
 *  - `selection.ts` — the interaction state: what is selected, what is open.
 *
 * with `pass.ts`, `picker.ts` and `choice-button.ts` under them. Nothing moved
 * except where the code sits: the rendered tree, the class names and the
 * accessible names are what they were, which is what
 * `test/play/play.test.ts` — a whole game clicked from opening hand to
 * result — asserts by passing unmodified.
 *
 * The interaction model those files share is still the enumeration. Rather than
 * making the player assemble an action out of clicks and then telling them it
 * was illegal, every legal move is already on screen, because the kernel
 * enumerated it. A rail press, a card click, the fixed pass and the space key
 * are four ways into one list, and a game played through any of them records the
 * same choice log.
 *
 * **A staged cast is the fifth and it is still one list** (`mtg-bz2.3`). Casting
 * from the table asks for targets and then for the payment before anything is
 * submitted, but each stage narrows the kernel's own enumeration rather than
 * building an action beside it, so the last press dispatches an index like every
 * other press here. `chooseAction` (`@mtg/kernel`'s `session.ts`) is still the
 * door for a move that is genuinely constructed — a click-built block
 * declaration is one — and this lane did not need it.
 */
import { createElement, Fragment, useCallback, useMemo } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react';
import type {
  AutoPassSettings,
  BeatSet,
  Choice,
  Beat,
  PlayerId,
  SessionView,
  YieldBoundary,
} from '@mtg/kernel';
import { holdsOwnTopOfStack, passIndex } from '@mtg/kernel';
import { GameLog } from '../../log/GameLog';
import { useBoardMotion } from '../../motion';
import type { LogNames } from '../../log/narrate';
import { castPlansFor } from './cast';
import type { CastPlan } from './cast';
import { attackControls, blockControls, useAttackStaging } from './combat';
import { askToggle, useAskCollapse } from './ask-collapse';
import { beatOnBoard, beatShowsMotion } from './beat-motion';
import { askAlert, askFlyout, useAskFlyout } from './ask-flyout';
import type { AskSlot } from './ask-flyout';
import { asClosest, asFocusable } from './focus';
import { ownedName } from './naming';
import { usePassKey } from './pass-key';
import { useCoarsePointer } from './pointer';
import { boardPosition, nameOf } from './position';
import type { PositionArt, SeatNames } from './position';
import { priorityFoot } from './priority';
import { railToggle, useRailCollapse } from './rail-collapse';
import {
  buildPrompt,
  choicesByObject,
  describeStep,
  describeTurn,
  playableFromHand,
  stepLabel,
} from './prompt';
import type { PlayChoice } from './prompt';
import { beatPanel, promptPanel, resultPanel, waitingPanel } from './rail';
import { useTableSelection } from './selection';
import { playTable } from './table';
import { playDetails, playToolbar, stepBar } from './toolbar';

export interface PlayViewProps {
  /**
   * The position, the log, and what is being asked.
   *
   * `SessionView` rather than `GameSession` (`@mtg/kernel`'s `session.ts`), and
   * the narrowing is what lets a networked seat render through this component
   * unchanged. A `GameSession` carries a bot's `decide` function and an undo
   * commitment; neither crosses a wire and neither is read here, so requiring
   * them would have meant a remote client fabricating two fields to satisfy a
   * type. A live session is still assignable, so no caller changed.
   */
  readonly session: SessionView;
  readonly viewer: PlayerId;
  readonly names: SeatNames;
  /**
   * Given what the press submits: an index into the pending decision's options,
   * or a declaration the enumeration was capped before it reached (`declare.ts`).
   */
  readonly onChoose: (choice: Choice) => void;
  readonly onNewGame?: (() => void) | undefined;
  /**
   * Who the table is waiting on, when it is not this viewer and the game is not
   * over.
   *
   * Only a networked seat ever passes it. On one screen the session never stops
   * anywhere but in front of the person holding the device, so "nothing is
   * pending" means the game ended; across a wire it usually means the opponent
   * is thinking, and a rail that said "Game over" to a player waiting for their
   * turn would be the surface lying about the most basic thing it knows.
   */
  readonly awaitingName?: string | null;
  /**
   * The combat moment the game is paused on, and the way out of it.
   *
   * Two props rather than a field on `session`, and for the reason that type
   * exists at all: a `SessionView` is what crosses a wire, and a beat never
   * does. The pause is local pacing — `@mtg/kernel`'s `SessionOptions` calls it
   * session-wide and deliberately withholds it from `@mtg/netplay`, since one
   * player's beat would be the other player's wait — so putting it on the view
   * would oblige every remote seat to fabricate a null.
   */
  readonly beat?: Beat | null | undefined;
  readonly onContinue?: (() => void) | undefined;
  /**
   * Which combat moments pause the game, and how to change them (`mtg-885`).
   *
   * The setting the two props above are the consequence of, drawn as a toggle at
   * the end of the step bar. Passed through rather than held, like every other
   * setting on this view: a caller with no `onBeats` gets no toggle, which is
   * how `@mtg/netplay` gets a step bar without a control that would pause one
   * player and leave the other one waiting.
   */
  readonly beats?: BeatSet | undefined;
  readonly onBeats?: ((next: BeatSet) => void) | undefined;
  /**
   * Controls belonging to whatever dealt the game, drawn at the end of this
   * view's own strip rather than on a second row above it. `toolbar.ts` records
   * what a second row costs.
   */
  readonly toolbar?: ReactNode;
  /** Resolves each card's illustration; absent draws the pending frame. */
  readonly artFor?: PositionArt;
  /**
   * The auto-pass settings and the two ways to act on them. All three are needed
   * before the turn indicator becomes a disclosure; `toolbar.ts` says why.
   */
  readonly autoPass?: AutoPassSettings | undefined;
  readonly onAutoPass?: ((next: AutoPassSettings) => void) | undefined;
  readonly onYield?: ((boundary: YieldBoundary) => void) | undefined;
}

// Re-exported from the shell so a caller has one import for the surface, and
// because these three accessible names are how every test on this route finds
// anything. `rail.ts` holds the contract that `LEGAL_MOVES_LABEL` names.
export { CONTINUE_LABEL, LEGAL_MOVES_LABEL, ONLY_PASS_NOTE } from './rail';
export { ASK_ALERT_STATUS_LABEL, ASK_FLYOUT_LABEL, askAlertText } from './ask-flyout';
export { BEAT_MOTION_STATUS_LABEL, beatShowsMotion } from './beat-motion';
export type { AskSlot } from './ask-flyout';
export { PASS_LABEL } from './pass';
export { HELD_OVER_YOUR_OWN, PASS_KEY_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_STATUS_LABEL } from './priority';
export { SIDE_PANEL_KEY, SIDE_PANEL_LABEL } from './rail-collapse';
export { ASK_PANEL_LABEL } from './ask-collapse';
export { pickerLabel } from './picker';
export { CAST_BACK_LABEL, castCancelLabel, castLabel } from './cast-panel';
export { DECLARE_BACK_LABEL, DECLARE_CLEAR_LABEL } from './declare-panel';

export function PlayView(props: PlayViewProps): ReactElement {
  const { session, viewer, names, onChoose, onAutoPass, onYield } = props;
  const beat = props.beat ?? null;
  // Read once for the whole view: the strip's words for a halt and whether a
  // halt arrives drawn are the only two answers it changes, and both are below.
  const coarse = useCoarsePointer();
  const decision = session.pending;
  // `session.result`, not `decision === null`: a remote seat is also handed no
  // decision while its opponent is still deciding, and `awaitingName` is what
  // tells that apart from the game actually ending — this is the kernel's own
  // terminal-state field (`@mtg/kernel`'s `GameResult | null`) and never a
  // guess (`mtg-a1d6`).
  const gameOver = session.result !== null;
  const position = boardPosition(session.state, viewer, names, props.artFor ?? null);
  const prompt = decision === null ? null : buildPrompt(session.state, decision, names);

  // The pass, wherever the kernel put it in this enumeration, or null when this
  // decision has no pass in it — a blocker assignment, an ordering, a discard.
  // Read off the enumeration rather than assumed to be first, for the reason
  // every other index on this surface is.
  const passAt = decision === null ? null : passIndex(decision);
  const onPass = useCallback((): void => {
    if (passAt !== null) onChoose(passAt);
  }, [passAt, onChoose]);
  // Every state change the kernel just made, rendered as movement rather than
  // applied between two frames (`../../motion/plan.ts`). Empty under
  // `prefers-reduced-motion: reduce`, and the table is unchanged without it.
  //
  // Read before the panels are built rather than after, because a beat now asks
  // it two questions: whether there is any motion to be reported by (`reduced`)
  // and how to end the motion it is reported by (`cut`).
  const motion = useBoardMotion({ events: session.events, viewer });
  const { cut: cutMotion } = motion;
  /*
   * Whether this pause is being drawn as movement on the table instead of as a
   * panel in the ask column.
   *
   * Three conditions, and `beat-motion.ts` argues each: the game is paused at
   * all; the beat names permanents, so there is something on the board for the
   * acknowledgment to be offered during; and this viewer has not asked for
   * reduced motion, under which `../../motion/plan.ts` produces no cues and a
   * control over a still board would be a pause with no report in it.
   *
   * The reduced-motion arm is the one that has to be right, because it is the
   * arm nobody playing the surface will see. It falls back to exactly the panel
   * a combat beat gets — same sentence, same button, same column — rather than
   * to a degraded version of this.
   */
  const beatIsOnBoard = beat !== null && !motion.reduced && beatShowsMotion(beat);
  /*
   * The key spends whatever the position has to spend (`mtg-rgc.2`).
   *
   * Paused on a combat beat the kernel has asked nothing, so the pass is null
   * and the shortcut would have refused every press and printed a note about a
   * decision that is not on screen. The Continue is the same gesture at the same
   * moment, and the combat lane handed this over saying that button had no key
   * at all. The beat wins the binding while it is up, because it is the only
   * thing the surface is offering: a rail with a beat panel in it has no move
   * list and no pass button.
   */
  const onContinue = props.onContinue ?? null;
  /*
   * A press that ends the animation and then the pause, in that order.
   *
   * `mtg-gt4q`. The acknowledgment is offered *during* the motion now
   * (`beat-motion.ts`), so a player who presses it has said they are done
   * watching — finishing a chain of cues they dismissed is the interruption this
   * bead removes, in a slower form. `cut` rather than `reset`: it keeps the
   * snapshot of where every card is, so the commit this press produces is itself
   * animated (`../../motion/runner.ts` argues the one-field difference).
   *
   * The panel path takes the same function. A beat that fell back to a panel
   * (a combat beat, or any beat under reduced motion) has nothing in flight to
   * cut, `cut` on an idle runner is two empty loops, and one press means one
   * thing wherever it is drawn.
   *
   * Null when this caller passed no continue, because `pass-key.ts` reads a null
   * pass as "there is nothing to spend here" and prints its note about it. A
   * function that closed over a missing callback and did nothing would suppress
   * that note by looking like a binding.
   */
  const continuePress = useCallback((): void => {
    cutMotion();
    onContinue?.();
  }, [cutMotion, onContinue]);
  const onContinueNow = onContinue === null ? null : continuePress;
  const passKeyNote = usePassKey({
    pass: beat !== null ? onContinueNow : passAt === null ? null : onPass,
    decisions: session.decisions,
  });

  const playable = prompt === null ? new Set<string>() : playableFromHand(prompt);
  // Clicking is the same enumeration read from the other end. A key with no
  // entry here is a card with nothing to do, on either side of the table.
  const byObject: ReadonlyMap<string, readonly PlayChoice[]> =
    prompt === null ? new Map<string, readonly PlayChoice[]>() : choicesByObject(prompt);
  // Casting is the one move that is staged rather than submitted on the click
  // (`cast.ts`, `mtg-bz2.3`). The plans come off the same enumeration everything
  // else on this surface reads, so a card with a plan is a card the kernel is
  // already offering to let you cast.
  const castPlans = decision === null ? new Map<string, CastPlan>() : castPlansFor(session.state, decision);
  const selection = useTableSelection({
    decisions: session.decisions,
    byObject,
    castPlans,
    // The combat declarations are assembled rather than listed (`declare.ts`),
    // and assembling one needs the whole decision: `byObject` keys a choice by
    // each object it names without saying which side of the pairing that object
    // was on, and an assignment is exactly that pairing.
    decision,
    state: session.state,
    names,
    onChoose,
  });
  // Declaring an attack is the second staged move (`combat.ts`, `mtg-bz2.5`),
  // and the reason it is not in `useTableSelection` beside the staged cast is
  // that it is not about one card: a cast is aimed one target at a time and an
  // attack is a set built over the whole row. Both hold nothing the kernel can
  // see and both are dropped when the decision count moves.
  //
  // `selection.declaration` is handed straight through rather than reread from
  // `session`, because it is the one record of this decision (`mtg-5t05`):
  // `useAttackStaging` used to keep a second `useState` set beside it, and a
  // click on the board and a press in the roster disagreed about what was
  // staged because they wrote to different places.
  const staging = useAttackStaging(session, viewer, selection.declaration);

  /**
   * What the log calls the two seats and every object.
   *
   * Built from the live state, which is the whole point of `LogNames` being a
   * book rather than a lookup argument: the replay route answers the same
   * questions off a recorded object table, and neither surface has to know how
   * the other one does it. Unredacted on purpose — `log/visibility.ts` decides
   * per event what this seat may read, so that the rule lives in one place
   * instead of being spread across whoever happens to build a book.
   *
   * The two card answers are the two slots (`mtg-h9s`): a source keeps its
   * printed name and a target is said as its controller's, which is the rule
   * `naming.ts` already settled for the rail. The log used one answer for both
   * and so could not say which of two Gloom Hands an event was about while the
   * ask column, one column to its left, could.
   */
  const logNames = useMemo(
    (): LogNames => ({
      player: (id: PlayerId): string => names[id],
      card: (oid: string): string => nameOf(session.state, oid),
      target: (oid: string): string => ownedName(session.state, names, oid),
    }),
    [names, session.state],
  );

  /*
   * The side panel's open state (`mtg-crw`).
   *
   * Held here rather than in `selection.ts` because it is not interaction state:
   * `selection.ts` is what is selected and what is open *on the table*, and every
   * field in it is scoped to one decision. This outlives the game and the
   * reload. It is emphatically not a game choice — the record is a seed and a
   * list of indices, so a panel in `choices` or `GameState` would make two
   * replays of one game disagree — and it is not a `SessionOptions` field
   * either, because it changes nothing the kernel asks.
   */
  const rail = useRailCollapse();
  const ask = useAskCollapse();
  /*
   * The ask column's one panel, built once and then placed.
   *
   * The beat comes first because it is the only one of the four that is not
   * about a decision: paused, the game has neither asked anything nor finished,
   * so every branch below it would read the position as one of those two and say
   * something false about it.
   *
   * And before the beat, the beat that is not drawn here at all. A pause that
   * names permanents is reported by the board and answered on it
   * (`beat-motion.ts`, `mtg-gt4q`), so this slot is empty — not a panel that is
   * hidden, which would put a second Continue in the document for a reader and a
   * test to find.
   *
   * Built here rather than inline in the `prompt` slot because it now has two
   * possible homes and must never have both (`ask-flyout.ts`, `mtg-li0o`). Shut,
   * it is drawn in the flyout; open, in the column. Rendering it in both and
   * hiding one with CSS would put two `Legal moves` groups in the document, and
   * a screen reader and a test both read the document rather than the sheet.
   */
  const askPanel = beatIsOnBoard
    ? null
    : beat !== null
      ? beatPanel(beat, session.state, names, continuePress)
      : prompt === null
        ? (props.awaitingName ?? null) === null
          ? resultPanel(session, names, props.onNewGame)
          : waitingPanel(props.awaitingName ?? '', session.decisions)
        : promptPanel(prompt, onChoose, session.decisions, selection.declaration, selection.ordering);
  /*
   * And what the strip has to say about it, which is a different question from
   * which panel it is. `ask-flyout.ts`'s `AskSlot` says why these are the five:
   * a halt is one press, a decision is a set to choose from and gets the
   * enumeration's own count, a finished game is a result to read, a seat waiting
   * on somebody else is owed nothing and is told nothing, and a beat playing on
   * the board is owed something that is already reachable at every column width,
   * so the strip stays quiet rather than pointing at an empty column.
   */
  const askSlot: AskSlot = beatIsOnBoard
    ? { kind: 'board' }
    : beat !== null
      ? { kind: 'halt' }
      : prompt === null
        ? (props.awaitingName ?? null) === null
          ? { kind: 'report' }
          : { kind: 'idle' }
        : { kind: 'decision', count: prompt.choices.length };
  const flyout = useAskFlyout({
    collapsed: ask.collapsed,
    slot: askSlot,
    decisions: session.decisions,
    events: session.events.length,
    // The opening hand, and no other ask on this route, arrives already drawn.
    // The playtester, 2026-08-22: "If the only option is keep or mulligan you
    // shouldn't need to click into 'waiting' it should just show you a keep or
    // mulligan button option immediately." `ask-flyout.ts` argues why this one
    // is not the always-up menu she objected to three days earlier — there is no
    // board under the box yet, and every other ask leaves something on the table
    // to press while this one leaves nothing at all. The decision's kind is what
    // says so, rather than the size of its enumeration: a priority window with
    // two legal moves is two options over a live board.
    //
    // A halt does too, but only for a finger. the playtester, in the same message:
    // "There should be an easy way to continue passing priority since pressing
    // space isn't an option on mobile easily." A halt has one move in it,
    // `passAt` is null in one so the fixed pass is drawn disabled, and the board
    // under the box is stopped. On a fine pointer `usePassKey` above binds the
    // space key to exactly this Continue, so the panel is a second way in and
    // does not need drawing; `pointer.ts` says why the question is the input and
    // not the width, and `askAlert` below moves the strip's own words with it.
    opensItself: (coarse && askSlot.kind === 'halt') || (decision !== null && decision.kind === 'mulligan'),
  });
  const stepText = describeStep(session.state, names);

  /*
   * The turn structure, in the viewer's own band under their battlefield and
   * over their hand, which is where Magic Online draws it (`mtg-rgc.6`), with
   * the turn at its left-hand end, which is where Magic Online writes that
   * (`mtg-rgc.13`). `toolbar.ts` builds both halves, because the badge writes
   * the settings the nodes beside it write.
   *
   * Null once the game is over (`mtg-a1d6`): eleven of these thirteen nodes are
   * buttons that set a stop for a turn this session will never take another
   * action in, and `aria-current` on the step it ended in reads as "the game is
   * waiting here" rather than "the game stopped here". The result panel already
   * says where play stopped, in a sentence rather than a marked node.
   *
   * Built before the table rather than inside it, because game details below
   * draws the turn badge exactly when this is null and a view that asked twice
   * could answer differently the second time.
   */
  const steps = gameOver
    ? null
    : stepBar({
        step: session.state.turn.step,
        turnText: describeTurn(session.state, names),
        stepText,
        autoPass: props.autoPass,
        onAutoPass,
        canYield: passAt !== null,
        onYield,
        beats: props.beats,
        onBeats: props.onBeats,
      });

  const table = playTable({
    position,
    playable,
    byObject,
    selection,
    staging,
    // One slot, two declarations, and never both at once: the kernel asks for
    // attackers or for blockers, so `attackControls` is null through the whole
    // of a block and `blockControls` through the whole of an attack. Both draw
    // in the band rather than only in the rail, which is the asymmetry
    // `combat.ts` records — an attack confirmed two inches under the creature
    // that was staged and a block confirmed in a side column.
    combat: attackControls(staging, onChoose) ?? blockControls(selection.declaration, onChoose),
    askCollapsed: ask.collapsed,
    askHead: askToggle(ask),
    railCollapsed: rail.collapsed,
    railHead: railToggle(rail),
    // The move that lets the top of the stack resolve, on the object it is about
    // (`mtg-atq`). It is `passAt` — the same index the ask column's `Turn` entry
    // carries and the same one the fixed pass and the space key take — so the
    // enumeration stays the one authority and this is a third door to it. Null
    // whenever the kernel enumerated no pass, which draws no button rather than a
    // dead one; `../../board/StackZone.ts` says why that is the opposite choice
    // from the fixed pass and right for the opposite reason.
    onResolve: passAt === null ? null : onPass,
    // The two columns hold two different kinds of thing, which is the whole of
    // `mtg-rgc.4`: what is being asked goes in the pod column, between the two
    // seats, and what has already happened goes in the side rail. They shared
    // one column until this bead, and under a crowded board neither of them
    // could give way to the other — measured at 89 log lines, two of them
    // visible, at every viewport and both permanent counts.
    //
    // The panel that answers the current question, and under it the foot that
    // holds the fixed pass (`priority.ts`). The foot is `flex: none` and the
    // panel takes what is left, so a column that used to be a panel between two
    // pods is a panel and a button between two pods.
    //
    // Shut, the panel is not here at all — it is in the flyout below, and the
    // strip carries the alert in its place (`ask-flyout.ts`, `mtg-li0o`). The
    // foot is in both states, because the fixed pass is the one move that keeps
    // its home whatever the column's width (`pass.ts`).
    // What the shut column shows instead of the panel `styles/board/rail.ts`
    // stops drawing in it: the same panel, in a box over the board's left
    // region, wide enough that the moves come out in columns rather than in
    // three-line labels. Null in the open column, where the panel is in the
    // column and this would be a second copy of it.
    askFlyout: askFlyout(flyout.open, askSlot, askPanel),
    // The pause, drawn as the one control the motion needs rather than as a
    // panel the motion has to wait behind (`beat-motion.ts`, `mtg-gt4q`). Null
    // whenever the beat took the panel path, which is every combat beat and
    // every beat at all under `prefers-reduced-motion: reduce`.
    beat: beatIsOnBoard && beat !== null ? beatOnBoard(beat, session.state, names, continuePress) : null,
    prompt: createElement(
      Fragment,
      null,
      playDetails({ stepText, choicesMade: session.choices.length, stepsDrawn: steps !== null }),
      ask.collapsed ? null : askPanel,
      // The alert, on the strip and only on the strip. It is the fallback
      // The playtester named — "or if that doesnt work well then at least get an
      // alert" — and it is also the way back into a flyout that was dismissed,
      // so it draws whether or not the flyout is on screen. It is not a
      // `.mtg-panel`, which is what the shut-column rule hides, so it survives
      // the collapse the way the disclosure and the fixed pass do.
      ask.collapsed ? askAlert(askSlot, flyout.open, flyout.toggle, coarse) : null,
      // Null once the game is over (`mtg-a1d6`): the group says who holds
      // priority and offers the one button that spends it, and a finished game
      // has settled neither question — `passAt` is already null by then, since
      // the kernel has stopped enumerating anything, but the group and its two
      // live regions would still sit in the document naming a holder left over
      // from the turn the game ended on. `resultPanel`, two lines up, is what
      // this slot shows instead.
      gameOver
        ? null
        : priorityFoot({
            holder: session.state.turn.priority,
            names,
            stackDepth: session.state.stack.length,
            // The kernel's own predicate, so the sentence and the auto-pass rule
            // that keeps the window open cannot disagree about what the window is.
            overYourOwn: decision !== null && holdsOwnTopOfStack(session.state, decision),
            stepText: stepLabel(session.state.turn.step),
            passAt,
            onPass,
            keyNote: passKeyNote,
          }),
    ),
    // The turn structure and the turn, built above so game details can read
    // whether it exists.
    steps,
    // The history, in the rail rather than under the table for the reason the
    // move list was (`rail.ts`, `styles/board/rail.ts`): height on this route
    // belongs to the cards. `Board` puts the stack over it and the two
    // graveyards under it.
    rail: createElement(GameLog, { events: session.events, names: logNames, viewer }),
  });

  const toolbar = playToolbar(props.toolbar ?? null);

  return createElement(
    'div',
    {
      className: 'mtg-play',
      /*
       * The motion layer attaches here (`../../motion/`, `mtg-ncg`).
       *
       * This element rather than the board inside it, for two reasons that both
       * point the same way: it is the element that survives every re-render of
       * the table, so the snapshot the layer keeps of where each card was is
       * never invalidated by anything but a route change; and the plane a
       * traveling card is drawn on is `position: fixed`, so it has to hang off
       * an ancestor that declares no transform, no filter and no containment.
       *
       * The view stays presentational. The hook reads `session.events`, which
       * this component already has, holds nothing the kernel can see, and gives
       * back a ref: no prop of this view changed, no caller was touched, and a
       * server render attaches nothing at all.
       */
      ref: motion.ref,
      // Focusable without being in the tab order, because the handler below has
      // somewhere to put the ring. `styles/views.ts` takes the outline off it:
      // the ring arrives here programmatically, so nothing should be drawn as
      // though a player had tabbed to the table itself.
      tabIndex: -1,
      /*
       * A pointer press on a panel header hands the ring back to the table.
       *
       * `mtg-s9p`, measured in a browser on 2026-08-13: after clicking the "You
       * graveyard" header to read it, five consecutive Space presses left the
       * game exactly where it was. The graveyard, the log and the turn badge are
       * the three disclosures on this route, and all three are buttons, so the
       * click that opened one left `document.activeElement` on it. `pass-key.ts`
       * then refuses every press for the rest of the game, which is correct
       * there — the browser activates a focused button on both keys, so firing
       * as well would submit two things for one press — and wrong here, because
       * the ring was parked on a control nobody was using.
       *
       * The fix is the parking, not the refusal. A pointer press is the gesture
       * that leaves the ring somewhere the player is not looking, and a keyboard
       * one is the gesture that means it: a click synthesized from Enter or
       * Space carries `detail === 0`, and that press is a player who tabbed to
       * the header and wants to stay there to read what they opened. So the
       * keyboard keeps the ring, which is what the ARIA disclosure pattern asks
       * for, and the mouse gives it back.
       *
       * On the shell rather than on the three headers, and that is forced as
       * well as tidier: `../../log/GameLog.ts` is the log's own file and every
       * disclosure that route ever grows would need the same three lines. One
       * handler on the element they all sit inside is the same reasoning the
       * Escape handler below is written from.
       */
      onClick: (event: ReactMouseEvent<HTMLDivElement>): void => {
        if (event.detail === 0) return;
        const pressed = asClosest(event.target);
        if (pressed === null || pressed.closest('[aria-expanded]') === null) return;
        asFocusable(event.currentTarget)?.focus();
      },
      /*
       * Escape closes an open picker, caught here rather than on the panel.
       *
       * On the panel it worked only while the ring was inside the panel, and the
       * first key a keyboard reaches for after a menu opens is Shift+Tab, which
       * is also the way out the panel had before Escape was wired at all.
       * Measured in chromium at 1440x900, 1280x800 and 1024x768: Shift+Tab from
       * the first option lands on `button.mtg-card` in that card's own slot, the
       * picker is still open, and Escape from there left it open at all three.
       * The panel is a sibling of that face, not an ancestor of it, so nothing
       * bubbled to the handler.
       *
       * Every focusable thing on the table is inside this element, so the key
       * reaches the handler from any of them, and the same three viewports now
       * close the picker and put the ring back on `button.mtg-card` in the
       * card's slot. The bound is the shell around the table: six further
       * Shift+Tabs from the panel walk the ring onto `a.mtg-modes__item`, which
       * is outside this element, and Escape there leaves the picker open. A
       * document listener would cover that too and costs an effect, which is the
       * one thing the open picker's bookkeeping does without (`selection.ts`);
       * a second click on the card is the way back from out there.
       */
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Escape') return;
        // The open question of a combat declaration is the second thing Escape
        // closes, and it is closed first because it is the one drawn over the
        // cards: a player who opened it by pressing a creature is standing on
        // the board, and the panel's Back button is a column away from them.
        // Never both — a declaration is a decision with no picker in it.
        const declaration = selection.declaration;
        if (declaration !== null && declaration.stage.kind === 'target') {
          event.stopPropagation();
          declaration.back('board');
          return;
        }
        if (selection.openKey === null) return;
        event.stopPropagation();
        selection.dismiss();
      },
    },
    toolbar,
    // One child, and that is the change `mtg-crw` makes here. The priority band
    // used to be this element's second child — a horizontal row spanning the
    // table, `flex: none` on the column that carries the viewport's height down
    // to the mat, so it cost 36.9 CSS px of that column at every viewport
    // whatever the game was doing. The pass it held is in the ask column now
    // (`priority.ts`), where it costs the board nothing. `styles/views.ts` says
    // why the wrapper survives its own contents.
    createElement('div', { className: 'mtg-play__table' }, table),
  );
}
