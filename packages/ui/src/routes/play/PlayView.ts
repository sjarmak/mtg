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
import { createElement, useCallback, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
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
import { PlayRail } from './PlayRail';
import { findInspected } from './inspect';
import { usePointing } from './pointing';
import { useBoardMotion } from '../../motion';
import type { LogNames } from '../../log/narrate';
import { castPlansFor } from './cast';
import type { CastPlan } from './cast';
import { attackControls, blockControls, useAttackStaging } from './combat';
import { beatOnBoard, beatShowsMotion } from './beat-motion';
import type { AskSlot } from './ask-flyout';
import { askOpensItself } from './ask-opens';
import { ownedName } from './naming';
import { usePassKey } from './pass-key';
import { useCoarsePointer } from './pointer';
import { boardPosition, nameOf } from './position';
import type { PositionArt, SeatNames } from './position';
import { landDropNote } from './land-drop';
import { priorityFoot } from './priority';
import { buildPrompt, choicesByObject, describeEnd, describeStep, describeTurn, stepLabel } from './prompt';
import type { PlayChoice } from './prompt';
import { beatPanel, promptPanel, resultPanel, waitingPanel } from './rail';
import { useTableSelection } from './selection';
import { stepBar } from './toolbar';
import { PlaySurface } from './PlaySurface';
import { usePace } from './pace-preference';
import type { TriggerYield } from './trigger-yields';
import { triggerYieldControl } from './trigger-yields';

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
  readonly status?: ReactNode | undefined;
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
  /**
   * The third yield: an optional trigger whose answer the player has settled
   * (`mtg-bz2.7`, `./trigger-yields.ts`).
   *
   * Two halves in two places, and both are optional together in the way every
   * other control on this view is: `onTriggerYield` puts the pair of controls on
   * an optional trigger's prompt, and `triggerYields` plus `onClearTriggerYield`
   * put the list of settled answers on the auto-pass panel. A caller with the
   * first and not the rest would offer a setting with no way back, so
   * `@mtg/netplay` and the replay frames pass none of them and draw neither.
   */
  readonly onTriggerYield?: ((yielded: TriggerYield) => void) | undefined;
  readonly triggerYields?: readonly TriggerYield[] | undefined;
  readonly onClearTriggerYield?: ((key: string) => void) | undefined;
  /**
   * The take-back and whether the kernel would move on it (`mtg-bz2.15`).
   *
   * Passed through rather than held, like every other control on this view: the
   * rewind belongs to whoever owns the session, which is `LiveGame.ts`. A caller
   * with no `onUndo` draws no control - `@mtg/netplay` owns no undo across a
   * wire, and a button that rewound one seat's client would be a board the two
   * players no longer share.
   */
  readonly canUndo?: boolean | undefined;
  readonly onUndo?: (() => void) | undefined;
}

// Re-exported from the shell so a caller has one import for the surface, and
// because these three accessible names are how every test on this route finds
// anything. `rail.ts` holds the contract that `LEGAL_MOVES_LABEL` names.
export { CONTINUE_LABEL, LEGAL_MOVES_LABEL, ONLY_PASS_NOTE } from './rail';
export { ASK_ALERT_STATUS_LABEL, ASK_FLYOUT_LABEL, askAlertText } from './ask-flyout';
export { BEAT_MOTION_STATUS_LABEL, beatShowsMotion } from './beat-motion';
export type { AskSlot } from './ask-flyout';
export { PASS_LABEL } from './pass';
export { UNDO_LABEL } from './undo';
export { HELD_OVER_YOUR_OWN, PASS_KEY_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_STATUS_LABEL } from './priority';
export { SIDE_PANEL_KEY, SIDE_PANEL_LABEL } from './rail-collapse';
export { ASK_PANEL_LABEL } from './ask-collapse';
export { pickerLabel } from './picker';
export { CAST_BACK_LABEL, castCancelLabel, castLabel } from './cast-panel';
export { DECLARE_BACK_LABEL, DECLARE_CLEAR_LABEL } from './declare-panel';
export { TRIGGER_YIELD_LABEL } from './rail';
export { clearTriggerYieldLabel, TRIGGER_YIELDS_LABEL, triggerYieldRowText } from './TurnStops';

export function PlayView(props: PlayViewProps): ReactElement {
  const { session, viewer, names, onChoose, onAutoPass, onYield } = props;
  const beat = props.beat ?? null;
  // Read once for the whole view: the strip's words for a halt and whether a
  // halt arrives drawn are the only two answers it changes, and both are below.
  const coarse = useCoarsePointer();
  // Which card is being read (`mtg-aqxi.1`). One delegated focus handler on the
  // shell below, for the reason the Escape and click handlers are there: four
  // zones draw slots, and a prop threaded through all four is four chances for
  // one of them to be forgotten.
  // And which objects are being pointed at from the log (`./pointing.ts`,
  // `mtg-47o`). Held here rather than in the rail because the two ends are in
  // two different columns: the sentence that names the object is in the rail and
  // the object is on the board, and this is the one component that holds both.
  const pointing = usePointing();
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
  //
  // The pace is this view's own (`mtg-kwu`), unlike the beats above it: it is a
  // preference of the person watching rather than a setting of the game, so it
  // is read here instead of arriving as a prop, and every caller of this view
  // gets the control without knowing it exists. It reaches the motion layer,
  // which scales the plan and writes the attribute the board's sheets multiply
  // their own durations by, and it reaches nothing else.
  const pace = usePace();
  const motion = useBoardMotion({ events: session.events, viewer, pace: pace.pace });
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

  // Clicking is the same enumeration read from the other end. A key with no
  // entry here is a card with nothing to do, in either hand or on either side of
  // the table (`mtg-bz2.9`).
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
    coarse,
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
  /*
   * The pair of controls that settle this trigger's answer, or null everywhere
   * else (`./trigger-yields.ts`, `mtg-bz2.7`).
   *
   * Null at every decision that is not an optional trigger, and at every caller
   * that owns no session to keep the setting in; `./trigger-yields.ts` argues
   * why one predicate decides both whether the yield can be keyed and whether
   * it is offered.
   */
  const yieldControl = triggerYieldControl(session.state, decision, props.onTriggerYield);

  const askPanel = beatIsOnBoard
    ? null
    : beat !== null
      ? beatPanel(beat, session.state, names, continuePress)
      : prompt === null
        ? (props.awaitingName ?? null) === null
          ? resultPanel(session, names, props.onNewGame)
          : waitingPanel(props.awaitingName ?? '', session.decisions)
        : promptPanel(
            prompt,
            onChoose,
            session.decisions,
            selection.declaration,
            selection.ordering,
            yieldControl,
          );
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
        pace: pace.pace,
        onPace: pace.setPace,
        triggerYields: props.triggerYields,
        onClearTriggerYield: props.onClearTriggerYield,
      });

  const priority = gameOver
    ? null
    : priorityFoot({
        holder: session.state.turn.priority,
        names,
        stackDepth: session.state.stack.length,
        overYourOwn: decision !== null && holdsOwnTopOfStack(session.state, decision),
        stepText: stepLabel(session.state.turn.step),
        passAt,
        onPass,
        keyNote: passKeyNote,
        canYield: passAt !== null,
        onYield,
        canUndo: props.canUndo ?? false,
        onUndo: props.onUndo,
        landNote: landDropNote(prompt),
      });

  return createElement(PlaySurface, {
    seatName: names[viewer],
    slot: askSlot,
    panel: askPanel,
    priority,
    steps,
    stepText: gameOver ? describeEnd(session.state, names) : stepText,
    choicesMade: session.choices.length,
    decisions: session.decisions,
    events: session.events.length,
    opensItself: (coarse && askSlot.kind === 'halt') || askOpensItself(decision),
    ...(props.status === undefined ? {} : { status: props.status }),
    toolbar: props.toolbar,
    rootRef: motion.ref,
    inspect: (key): ReturnType<typeof findInspected> => findInspected(position, key),
    contextRail: (inspected, reveal): ReactNode =>
      createElement(PlayRail, {
        entries: position.stack.entries,
        events: session.events,
        names: logNames,
        viewer,
        inspected,
        reveal,
        onPoint: pointing.onPoint,
      }),
    table: {
      position,
      viewer,
      byObject,
      selection,
      pointed: pointing.keys,
      staging,
      combat: attackControls(staging, onChoose) ?? blockControls(selection.declaration, onChoose),
      onResolve: passAt === null ? null : onPass,
      beat: beatIsOnBoard && beat !== null ? beatOnBoard(beat, session.state, names, continuePress) : null,
    },
    onEscape: (): boolean => {
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
      // The open question of a combat declaration is the second thing Escape
      // closes, and it is closed first because it is the one drawn over the
      // cards: a player who opened it by pressing a creature is standing on
      // the board, and the panel's Back button is a column away from them.
      // Never both — a declaration is a decision with no picker in it.
      const declaration = selection.declaration;
      if (declaration !== null && declaration.stage.kind === 'target') {
        declaration.back('board');
        return true;
      }
      if (selection.openKey === null) return false;
      selection.dismiss();
      return true;
    },
  });
}
