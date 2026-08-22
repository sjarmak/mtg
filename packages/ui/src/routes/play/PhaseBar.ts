/**
 * The step bar: the whole turn structure under the viewer's own battlefield,
 * with a stop row per player on every node that can hold one.
 *
 * **Where it is drawn is `mtg-rgc.6` and it is not this file's decision.** The
 * bar was a row on the strip above the table until that bead moved it into the
 * near band, between the battlefield and the hand, where Magic Online draws it;
 * `board/Board.ts` places it, `toolbar.ts` composes it, and nothing in here
 * changed, because a bar that had to know which container it was in would be a
 * component with an opinion about its own layout.
 *
 * **And `mtg-rgc.13` gave it the turn.** Magic Online writes `Turn 18: BswizzM…`
 * at the left-hand end of this bar; ours wrote it at the head of the ask column
 * two columns over, so the turn and the step it is in were one fact drawn in two
 * places. It arrives as the `head` slot rather than as text, because what
 * belongs there is the head of the auto-pass disclosure and `toolbar.ts` is the
 * file that decides whether this caller may have one.
 *
 * The playtester, 2026-08-13 (`mtg-bz2.1`): "The phase bar is particularly important.
 * I would make it something like: UNTAP → UPKEEP → DRAW → MAIN 1 → BEGIN COMBAT
 * → ATTACK → BLOCK → DAMAGE → END COMBAT → MAIN 2 → END → CLEANUP. Each relevant
 * node should have three conceptual states … Clicking the phase toggles whether
 * the client pauses there." Under the epic's own principle: do not make the UI
 * infer intent — Magic Online is useful for serious Magic because it exposes the
 * turn structure, and holding up a counterspell means putting a stop on the
 * opponent's upkeep, beginning of combat or end step *before* anything happens.
 *
 * **It replaces two rows of toggles behind a disclosure.** The stops were
 * eleven `aria-pressed` buttons for your turn and eleven more for the
 * opponent's, in a panel that had to be opened before either row could be read.
 * A bar is one row of eleven, always on screen, showing where the game is and
 * what it will stop for in the same glance. `TurnStops.ts` keeps what does not
 * fit on a bar: full control, the stop set's authority, and the two yields.
 *
 * **Thirteen nodes from `STEPS`, eleven of them controls, and not one list is
 * written here.** The kernel enumerates the turn structure once and derives the
 * stoppable steps from it by subtraction (`STOPPABLE_STEPS` is `STEPS` minus
 * untap and cleanup, which are the two `enterStep` never grants priority in). A
 * hand-written twelve-entry bar would be a third list, free to drift from both.
 * So the bar walks `STEPS` and asks `STOPPABLE_STEPS` whether each one is a
 * control: untap and cleanup are drawn as plain markers, because the game really
 * does pass through them and a bar that could not say where the game is would be
 * lying, and a *pressable* untap would be a control that does nothing whichever
 * way it is set — which `autopass.ts` calls worse than omitting it.
 *
 * **First-strike damage is drawn, and it is drawn as a control.** It is the
 * thirteenth step, real and conditionally entered (`combat.ts`'s
 * `combatNeedsFirstStrikeStep`), and it is the one step the playtester's twelve-node
 * list has no node for. Hiding it would put a step the kernel can stop at
 * outside the only surface that sets stops; drawing it as a marker would say it
 * cannot be stopped at, which is false. So it is a node like any other, marked
 * `data-conditional` for the eye and carrying the condition in its accessible
 * name for everyone else.
 *
 * ## What `mtg-rgc.2` changed: three kinds of mark, in three places
 *
 * The bar drew one glyph per node and cycled it through four shapes, so whose
 * turn a stop belonged to was a matter of telling a filled circle from a filled
 * diamond from a diamond with a filled center. Magic Online does not encode it
 * in the shape: it draws **two rows of triangles**, the opponent's above the
 * step name and yours below it, and whose stop it is comes from which row the
 * mark is in. Every node here is therefore a three-line stack — their row, the
 * name, your row — and the four-state cycle survives untouched as the *press*
 * while stopping being the *reading*. `stops.ts` holds the marks and the mapping.
 *
 * The third mark is the combat beat, and it is the one this bar could not say
 * before. A beat pauses the game to show you something and asks nothing
 * (`@mtg/kernel`'s `beats.ts`); it is not a stop, it is not settable by pressing
 * the node, and it belongs to neither player. So it takes neither row: it is the
 * pause glyph on the name line. Three kinds of mark, three fixed positions,
 * three shapes, and not one of them a fifth state of the cycle — which was the
 * thing `mtg-0sn`'s lane said it would rather have than the dotted underline it
 * shipped.
 *
 * ## And the control at the end of the bar
 *
 * `mtg-885`: the beats were configured at deal time and nothing on screen could
 * change them, so a player who had watched forty combats had no instrument short
 * of yielding a whole turn. The end of the bar is where Magic Online puts its
 * one bar-wide control, and the pause is the one setting on this strip that is
 * about the bar rather than about a step. It is a plain two-state toggle and it
 * carries `aria-pressed`, which a node cannot: two states is exactly what that
 * attribute means. It writes `BeatSet` and never touches `StopSet` — the bead
 * asks for that in those words, and the two mechanisms would break each other if
 * merged.
 *
 * ## A tri-state node is not a toggle button, so it does not claim to be one
 *
 * `aria-pressed` has two states and a third, `mixed`, that means partially
 * pressed — none of which is "stopped on the opponent's turn". There is no ARIA
 * role for a control that cycles through four unrelated states, and the pattern
 * that works in its absence is a plain button whose accessible *name* carries
 * the current state as a word, plus a polite live region that says what the
 * press did. Both are here: the name is `<step>, <state>`, and one `role=status`
 * under the bar holds the last change. The marks are `aria-hidden` throughout —
 * a shape is not an accessible name, and a triangle is a shape.
 *
 * The visible label is the short word and the accessible name begins with it,
 * which is WCAG 2.5.3: a name that dropped the visible text would leave a voice
 * user saying "click main 1" at a control not called that. Where the header's
 * own wording for a step differs from the short one, the name carries both. A
 * name is never truncated: the *drawn* word is clipped with an ellipsis under
 * width pressure and the DOM text behind it stays whole, so what a screen reader
 * and a voice control get does not depend on the window's width.
 */
import { createElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { AutoPassSettings, BeatSet, Step, TurnSide } from '@mtg/kernel';
import { DEFAULT_BEATS, NO_BEATS, PHASE_OF, STEPS, STOPPABLE_STEPS, stepShowsBeat } from '@mtg/kernel';
import { stepAbbreviation, stepLabel } from './prompt';
import {
  BEAT_MARK,
  cycleStop,
  STOP_ROW_MARKS,
  STOP_ROWS,
  STOP_STATE_SIDES,
  STOP_STATE_WORDS,
  stopStateOf,
} from './stops';
import type { StopState } from './stops';

export interface PhaseBarProps {
  /**
   * The turn and whose it is, at the left-hand end of the bar (`mtg-rgc.13`).
   *
   * A slot rather than a `turnText` string, because what goes in it is a
   * disclosure for a caller that can act on the settings and a plain badge for
   * one that cannot, and that is `toolbar.ts`'s decision to make — the same file
   * that decides whether this bar is drawn at all. Absent draws nothing, which
   * is what a bar composed by anything but that file gets.
   */
  readonly head?: ReactNode;
  readonly settings: AutoPassSettings;
  readonly onChange: (next: AutoPassSettings) => void;
  /** Where the game is right now, so the node it is in is marked as current. */
  readonly step: Step;
  /**
   * Which moments the game pauses at, so the bar can mark the ones that are
   * steps.
   *
   * Half of `mtg-0sn` was filed against this bar: it drew DAMAGE with the hollow
   * "no stop" mark while the game was silently resolving a whole combat there,
   * which is the interface making a false statement about itself. A pause is not
   * a stop and takes neither stop row — it is the third mark, on the name line.
   * Defaults to what the play route actually runs with.
   *
   * A watched beat that belongs to no step marks no node, which `stepShowsBeat`
   * decides and `@mtg/kernel`'s `BEAT_STEPS` states. A death is that beat: it
   * can land in any of the thirteen, so marking all thirteen would promise a
   * pause at twelve places the game usually runs straight through — the same
   * false statement in the other direction.
   */
  readonly beats?: BeatSet | undefined;
  /**
   * How to change them, or absent for a caller that does not own them.
   *
   * The same rule `toolbar.ts` applies to the bar itself: a control nobody is
   * listening to is a screen lying about what it controls. `@mtg/netplay`
   * deliberately sets no beats at all — one player's pause is the other player's
   * wait — so a remote seat passes nothing here and gets no toggle rather than a
   * dead one.
   */
  readonly onBeats?: ((next: BeatSet) => void) | undefined;
}

/** The accessible name of the bar, which is how every test finds it. */
export const PHASE_BAR_LABEL = 'Phases and stops';

/**
 * The announcement region's own name.
 *
 * Named rather than anonymous because this is not the only `role="status"` on
 * the played table: `../../log/GameLog.ts` runs a second one carrying the newest
 * log line. Two unnamed status regions give a screen reader two announcement
 * channels it cannot tell apart, and they landed in the same week from two
 * lanes that could not see each other. A name is what makes "the stops said
 * something" distinguishable from "the log said something".
 */
export const PHASE_BAR_STATUS_LABEL = 'Stop changes';

/**
 * The beat toggle's accessible name, and the word it draws.
 *
 * The name contains the visible label (WCAG 2.5.3) and adds the noun the label
 * has no room for. "Watch" alone at the end of a thirteen-node bar is about as
 * much as the width allows; the name says what is being watched.
 *
 * It used to say "Watch combat", and `mtg-302` made that false rather than
 * merely terse: the fourth beat is a death, which happens wherever it happens.
 * A control whose name names three of the four things it switches is the same
 * class of fault as a bar that drew DAMAGE as pausing nowhere.
 */
export const WATCH_BEATS_LABEL = 'Watch combat and deaths';
export const WATCH_BEATS_TEXT = 'Watch';

/** What the live region says when the beats are switched, as a whole sentence. */
export function beatAnnouncement(watching: boolean): string {
  return watching
    ? 'Beats on: the game pauses to show each attack, block, damage step and death.'
    : 'Beats off: combat and deaths resolve without pausing.';
}

/**
 * What the one step that is not always entered says about itself.
 *
 * In the name rather than a `title`, which is unreachable from a keyboard and
 * unread by most screen readers, and rather than `aria-description`, which is
 * still not carried by enough of them to be the only place a fact lives.
 */
const CONDITIONAL_NOTE = 'only entered when first or double strike is in combat';

/** Is this step one the kernel ever grants priority in? */
function isStoppable(step: Step): boolean {
  return STOPPABLE_STEPS.includes(step);
}

/**
 * A step a turn passes through only sometimes.
 *
 * One step qualifies and the kernel has no enumeration of them to derive this
 * from — `combatNeedsFirstStrikeStep` answers it about a *position*, not about
 * the turn structure — so it is written once, here, and read by the name and by
 * the mark. Everything else on the bar is entered every turn of every game.
 */
function isConditional(step: Step): boolean {
  return step === 'firstStrikeDamage';
}

/**
 * The step, in the short word and in the header's word when those differ.
 *
 * "Upkeep" and "upkeep" are one word twice, and a name that said both would
 * stutter; "Main 1" and "main phase" are two names for one step, and a name that
 * dropped either would leave somebody unable to connect the sentence the board
 * just printed to the node that sets a stop in it.
 */
function stepName(step: Step): string {
  const short = stepAbbreviation(step);
  const long = stepLabel(step);
  return long.toLowerCase().includes(short.toLowerCase()) ? short : `${short}, ${long}`;
}

/**
 * What a node that the game pauses in adds to its own name.
 *
 * A sentence rather than a state word, because it is not one of the four the
 * cycle moves between: pressing this node changes the stop and leaves the pause
 * exactly where it was. Reading "no stop, pauses to show combat" is the true
 * description of the damage node under the default settings, and reading "no
 * stop" alone was the false one the bead caught.
 */
const BEAT_NOTE = 'pauses to show combat';

/** A node's whole accessible name: which step, what it is set to, and any condition. */
export function nodeName(step: Step, state: StopState, beats: BeatSet = DEFAULT_BEATS): string {
  const named = isConditional(step) ? `${stepName(step)} (${CONDITIONAL_NOTE})` : stepName(step);
  const set = `${named}, ${STOP_STATE_WORDS[state]}`;
  return stepShowsBeat(step, beats) ? `${set}, ${BEAT_NOTE}` : set;
}

/** What the live region says after a press, as a whole sentence. */
function stopAnnouncement(step: Step, state: StopState): string {
  return `${stepAbbreviation(step)}: ${STOP_STATE_WORDS[state]}.`;
}

/**
 * One row's mark, or nothing at all on a step no stop can be set at.
 *
 * The row is an attribute rather than a class suffix so the sheet, the tests and
 * a browser measurement all key on the same word the kernel calls that side of
 * the table. `data-set` carries the bit, because the shape and the color are
 * both paint and neither is readable from a `getAttribute`.
 */
function rowMark(row: TurnSide, state: StopState, stoppable: boolean): ReactElement | null {
  if (!stoppable) return null;
  const set = STOP_STATE_SIDES[state].includes(row);
  const marks = STOP_ROW_MARKS[row];
  return createElement(
    'span',
    {
      key: row,
      className: 'mtg-phasebar__pip',
      'data-row': row,
      'data-set': set,
      'aria-hidden': true,
    },
    set ? marks.set : marks.unset,
  );
}

function node(props: PhaseBarProps, step: Step, announce: (text: string) => void): ReactElement {
  const state = stopStateOf(props.settings, step);
  const stoppable = isStoppable(step);
  const beats = props.beats ?? DEFAULT_BEATS;
  const beating = stepShowsBeat(step, beats);
  const shared = {
    key: step,
    className: 'mtg-phasebar__node',
    'data-step': step,
    'data-phase': PHASE_OF[step],
    'data-stop': state,
    'data-stoppable': stoppable,
    'data-conditional': isConditional(step),
    'data-beat': beating,
    ...(step === props.step ? { 'aria-current': 'step' as const } : {}),
  };
  const body = [
    // Top to bottom: the opponent's row, the name line, the player's own row.
    // `STOP_ROWS` states that order once, where the reason for it is written.
    rowMark(STOP_ROWS[0], state, stoppable),
    createElement(
      'span',
      { key: 'name', className: 'mtg-phasebar__name' },
      // The pause rides beside the word rather than inside it, so the clipping
      // that shortens "Begin combat" cannot eat the mark that says the game
      // stops there.
      beating
        ? createElement(
            'span',
            { key: 'beat', className: 'mtg-phasebar__beat', 'aria-hidden': true },
            BEAT_MARK,
          )
        : null,
      createElement('span', { key: 'text', className: 'mtg-phasebar__text' }, stepAbbreviation(step)),
    ),
    rowMark(STOP_ROWS[1], state, stoppable),
  ];
  if (!stoppable) {
    // A marker rather than a button, and it keeps its text: the game passes
    // through untap and cleanup, so the bar has to be able to say it is there.
    // No `aria-label` on it — ARIA forbids naming a generic element, and its own
    // text is already the word the board header uses for the step.
    return createElement('span', shared, ...body);
  }
  return createElement(
    'button',
    {
      ...shared,
      type: 'button',
      'aria-label': nodeName(step, state, beats),
      onClick: () => {
        const next = cycleStop(props.settings, step);
        props.onChange(next);
        announce(stopAnnouncement(step, stopStateOf(next, step)));
      },
    },
    ...body,
  );
}

/**
 * The beats toggle, at the end of the bar (`mtg-885`).
 *
 * On means every moment; off means none. Not a per-moment control, and that is
 * a decision rather than a shortcut: the bead's own sentence is about a player
 * who has watched forty combats and wants speed, and a checkbox per moment for
 * moments that always arrive together would be three ways to end up watching two
 * thirds of a combat. `BeatSet` still holds them one by one, so a finer control
 * is a change to this function and to nothing under it — and a death, which is
 * the one that is not part of a combat, is the first beat a finer control would
 * plausibly separate.
 */
function beatsToggle(
  beats: BeatSet,
  onBeats: (next: BeatSet) => void,
  announce: (text: string) => void,
): ReactElement {
  const watching = beats.size > 0;
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-phasebar__beats',
      'aria-label': WATCH_BEATS_LABEL,
      'aria-pressed': watching,
      onClick: () => {
        onBeats(watching ? NO_BEATS : DEFAULT_BEATS);
        announce(beatAnnouncement(!watching));
      },
    },
    createElement('span', { className: 'mtg-phasebar__beats-mark', 'aria-hidden': true }, BEAT_MARK),
    createElement('span', { className: 'mtg-phasebar__beats-text' }, WATCH_BEATS_TEXT),
  );
}

export function PhaseBar(props: PhaseBarProps): ReactElement {
  /*
   * What the last press did, for a screen reader.
   *
   * View state, and deliberately: it is not in the session, so it is not in the
   * recorded choice log and not in the seed, and two runs of one game can have
   * been narrated differently without diverging by a byte. It is empty until a
   * node is pressed, because a live region that has something in it on first
   * render announces the interface rather than a change to it. A stop set
   * changed from anywhere else — full control, a fresh game — leaves the last
   * sentence standing rather than narrating a press nobody made.
   */
  const [announced, setAnnounced] = useState('');
  const { onBeats } = props;
  return createElement(
    'div',
    { className: 'mtg-phasebar', role: 'group', 'aria-label': PHASE_BAR_LABEL },
    // The turn, at the left-hand end, where Magic Online writes it. It is
    // `flex: none` in the sheet for the reason the toggle at the other end is:
    // the thirteen steps are the part that gives under width pressure, and a
    // turn label clipped to an ellipsis would be a fact nobody can read.
    props.head ?? null,
    // The steps are their own element rather than direct children of the group,
    // because they are the part that has to give under width pressure and the
    // toggle beside them is the part that must not: thirteen equal columns that
    // clip their own words, and one control that keeps its size.
    createElement(
      'div',
      { className: 'mtg-phasebar__steps' },
      ...STEPS.map((step) => node(props, step, setAnnounced)),
    ),
    onBeats === undefined ? null : beatsToggle(props.beats ?? DEFAULT_BEATS, onBeats, setAnnounced),
    createElement(
      'p',
      { className: 'mtg-phasebar__status', role: 'status', 'aria-label': PHASE_BAR_STATUS_LABEL },
      announced,
    ),
  );
}
