/**
 * The turn indicator, and the auto-pass settings a phase bar has no room for.
 *
 * The playtester, 2026-08-13 (`mtg-6ce`): "I would rather have the stops be settable
 * in the same place where in the upper left the current turn and phase is so you
 * can click it to expand and alternately set and remove stops and collapsing it
 * just shows the current turn and phase." That is still the arrangement — one
 * control with two states, the badge collapsed and the panel expanded, anchored
 * under the badge and drawn over the board — and `mtg-bz2.1` moved the stops
 * themselves out of it. The two `role="group"` rows of eleven `aria-pressed`
 * step toggles are gone; `PhaseBar.ts` draws them as one row on the strip, where
 * they are readable without opening anything.
 *
 * **What is left here is what a bar cannot carry.** Full control is a switch
 * over the whole stop set rather than a state of any node; "Only my stops" says
 * whether the set is authoritative or only additive; a yield is a run of passes
 * to a named boundary and belongs to no step at all. Each is a sentence about
 * the settings, and a bar is a row of nodes.
 *
 * **A stop says where to offer the player their plays, which is why the hint
 * says so out loud.** Since `mtg-hmy` a stop does not fire at a priority the
 * kernel enumerated nothing but the pass and the mana abilities at — a prompt
 * there is a page to dismiss rather than a decision to make, and the default
 * stops were spending about half of every game's questions on them. A player who
 * ticks a node and then sees no prompt at it has to be able to read why on this
 * panel; full control is the switch that asks everywhere regardless.
 *
 * **Every control here says which priorities to ask about, never which play to
 * make.** No button on this panel can cast, attack or block, which is what lets
 * it sit over the board without competing with the enumeration: the buttons in
 * the rail are the game, and these are the interface to it. The one thing they
 * do take is the pass — "do not ask me here" and "pass here" are the same
 * sentence — and the kernel writes every one of those into the game's own record
 * as the choice it is.
 *
 * The panel also prints the mark legend, because the bar's four shapes are
 * shapes: they carry their meaning as words in each node's accessible name, and
 * a sighted player who has never been told what a filled diamond means needs
 * somewhere on this surface that says so.
 *
 * Whether it is open is view state and lives in this component, deliberately. It
 * is not in the session, so it is not in the recorded choice log and not in the
 * seed, and two runs of one game can be folded differently without diverging by
 * a byte.
 *
 * **Four ways out, because `mtg-5jl` found that two of them were unreachable.**
 * The panel is drawn over the mat it describes, and in a browser on 2026-08-13
 * it spent thirty clicks covering the opponent's life total and zone counts. The
 * badge has always been a toggle and Escape has always been caught — but the
 * badge reads as a status label, and the Escape handler was on this element,
 * which the ring leaves the moment the player clicks the board. So the panel now
 * carries a labeled close control the eye can find, and `dismiss.ts` binds
 * Escape and the outside press on the document, where neither depends on what
 * holds the focus ring. Every exit but the outside press hands the ring back to
 * the badge, which is the control the panel came out of and the one place a
 * player can predict finding it.
 */
import { createElement, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { AutoPassSettings, YieldBoundary } from '@mtg/kernel';
import { withFullControl, withPassUnstopped } from '@mtg/kernel';
import { useDismissable } from './dismiss';
import { asContainer, asFocusable } from './focus';
import type { ContainerNode, FocusableNode } from './focus';
import { MARK_LEGEND } from './stops';

export interface TurnStopsProps {
  /**
   * The turn and whose it is, and nothing else: `describeTurn`'s `Turn 7: You`.
   *
   * It used to be `describeStep`'s whole sentence, step included, and
   * `mtg-rgc.2` took the step out of it. Magic Online's own label is
   * `Turn 18: BswizzM…` for a reason that is now true here too: the bar beside
   * this badge names all thirteen steps and boxes the one the game is in, so a
   * step word in the badge is the same fact drawn twice, in the widest thing on
   * the strip, on the axis the bar is short of. The step is still in this
   * control's accessible name, through `detail`.
   */
  readonly label: string;
  /**
   * The rest of the spoken name — the step, in the board header's own words.
   *
   * Split from `label` rather than folded into it because they answer to
   * different constraints: the visible half is clipped to fit a strip, and the
   * spoken half must not be. WCAG 2.5.3 is satisfied by `label` leading the
   * name, which it does.
   */
  readonly detail: string;
  readonly settings: AutoPassSettings;
  readonly onChange: (next: AutoPassSettings) => void;
  /** Absent, or false, when no priority is pending and a yield would do nothing. */
  readonly canYield: boolean;
  readonly onYield: (boundary: YieldBoundary) => void;
}

/** The accessible name of the panel the indicator expands into. */
export const TURN_STOPS_LABEL = 'Auto-pass';

/**
 * The control that makes the stop set subtract as well as add.
 *
 * Pressed, a priority no stop names is passed for you however many plays are
 * legal in it, which is what a player who has set two nodes on the bar means by
 * setting two nodes. Released, the set can only add questions and every other
 * priority is asked about — the conservative mode, and the one whose recordings
 * match a full-control player's exactly.
 *
 * A button beside full control rather than a third state of it, because the two
 * answer different questions and a player changes them at different times: full
 * control is reached for mid-game and this is set once and lived with.
 */
export const ONLY_STOPS_LABEL = 'Only my stops';

/** The accessible name of the legend that says what the bar's marks mean. */
export const STOP_LEGEND_LABEL = 'What the phase bar marks mean';

/**
 * The close control's name, which contains the word it draws.
 *
 * A visible `Close` and a spoken name that says what is being closed, the same
 * prefixing the badge takes below: a control whose accessible name does not
 * contain its visible label is one a speech user cannot ask for by what they can
 * see.
 */
export const TURN_STOPS_CLOSE_LABEL = 'Close auto-pass settings';

/**
 * What `aria-controls` points at.
 *
 * One id rather than a generated one because one table is drawn at a time: the
 * handoff card replaces the whole view when the seat being asked changes, and a
 * finished game draws no second indicator.
 */
const PANEL_ID = 'mtg-turn-stops';

const YIELDS: readonly { readonly boundary: YieldBoundary; readonly label: string }[] = [
  { boundary: 'endOfTurn', label: 'Yield to end of turn' },
  { boundary: 'yourNextTurn', label: 'Yield to next own turn' },
];

/**
 * Every mark on the bar and what it means, in the node's own top-to-bottom
 * order.
 *
 * `mtg-rgc.2` turned four glyphs in one slot into two rows of triangles plus a
 * pause mark, so this legend is a picture of a node rather than a list of a
 * control's positions: where a mark sits is now half of what it says, and the
 * words here say the position out loud. `stops.ts` writes the table; this draws
 * it, so the legend cannot come to describe a bar that is not on screen.
 *
 * A named list rather than a paragraph, so the pairings are structure a screen
 * reader can walk rather than punctuation it has to parse. A list is what
 * carries a name here: ARIA allows one on `ul` and forbids one on a generic
 * element, which is what a `dl` is in several mappings. The mark is
 * `aria-hidden` in each row for the reason it is hidden on the bar: the words
 * beside it are the whole of what it says.
 */
function legend(): ReactElement {
  return createElement(
    'ul',
    { className: 'mtg-turnstops__legend', 'aria-label': STOP_LEGEND_LABEL },
    ...MARK_LEGEND.map((entry) =>
      createElement(
        'li',
        { key: entry.key, className: 'mtg-turnstops__legend-row', 'data-mark': entry.key },
        createElement('span', { className: 'mtg-turnstops__legend-mark', 'aria-hidden': true }, entry.mark),
        entry.meaning,
      ),
    ),
  );
}

/**
 * The expanded panel, exported so a browser can measure it.
 *
 * Whether it is open is React state that nothing outside this component can
 * set, and what the panel covers is a geometric claim jsdom cannot check because
 * jsdom performs no layout. `../../../tools/turn-stops-panel.ts` renders the
 * shipped toolbar, drops *this* function's markup into it and reads the boxes,
 * which is the same substitution `tools/cast-panel.ts` makes to measure a panel
 * it cannot click open. The alternative was a tool that wrote the panel's markup
 * itself, and a second opinion about what this panel is made of is worth less
 * than an export.
 */
export function turnStopsPanel(props: TurnStopsProps, onClose: () => void): ReactElement {
  const { settings } = props;
  const fullControl = !settings.enabled;
  return createElement(
    'div',
    {
      id: PANEL_ID,
      className: 'mtg-turnstops__panel',
      role: 'group',
      'aria-label': TURN_STOPS_LABEL,
    },
    // First, and drawn at the top right, because a control that dismisses the
    // thing you are looking at is looked for before the thing is read.
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-turnstops__close',
        'aria-label': TURN_STOPS_CLOSE_LABEL,
        onClick: onClose,
      },
      'Close',
    ),
    createElement(
      'div',
      { className: 'mtg-turnstops__row' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'aria-pressed': fullControl,
          onClick: () => {
            props.onChange(withFullControl(settings, !fullControl));
          },
        },
        'Full control',
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'aria-pressed': settings.passUnstopped,
          onClick: () => {
            props.onChange(withPassUnstopped(settings, !settings.passUnstopped));
          },
        },
        ONLY_STOPS_LABEL,
      ),
      ...YIELDS.map((yielded) =>
        createElement(
          'button',
          {
            key: yielded.boundary,
            type: 'button',
            className: 'mtg-btn',
            disabled: !props.canYield,
            onClick: () => {
              props.onYield(yielded.boundary);
            },
          },
          yielded.label,
        ),
      ),
    ),
    createElement(
      'p',
      { className: 'mtg-turnstops__hint' },
      'Space or Enter takes the pass, and continues a combat pause. Press a phase on the bar to cycle its stop. A stop asks only where you have a play to make; full control asks everywhere. Only my stops passes everything the bar does not name. A yield stops early for anything the other seat casts that you could answer. Watch combat, at the end of the bar, is the pause itself: it asks nothing and records nothing, so it is not a stop and no step holds it.',
    ),
    legend(),
  );
}

export function TurnStops(props: TurnStopsProps): ReactElement {
  const [open, setOpen] = useState(false);
  // The badge, caught while it is drawn, so every exit but the outside press can
  // hand the ring back to it. A ref rather than `focusedNode()` at opening time:
  // the panel is now dismissed from presses that never touched the badge, and
  // "wherever the ring happened to be" is not a place a player can predict.
  const badge = useRef<FocusableNode | null>(null);
  const root = useRef<ContainerNode | null>(null);

  function close(returnRing: boolean): void {
    setOpen(false);
    if (returnRing) badge.current?.focus();
  }

  useDismissable({
    open,
    within: (): ContainerNode | null => root.current,
    onDismiss: (via): void => {
      close(via === 'escape');
    },
  });

  return createElement(
    'div',
    {
      className: 'mtg-turnstops',
      'data-open': open,
      ref: (node: unknown): void => {
        root.current = asContainer(node);
      },
    },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-badge mtg-turnstops__head',
        'aria-expanded': open,
        'aria-controls': PANEL_ID,
        // The visible text leads the accessible name, which then adds the two
        // things the eye gets from somewhere else: the step, which the bar
        // beside this badge draws, and what the marker means — this badge opens
        // the stops. Prefixed rather than replaced, so the name still contains
        // the visible label even when the strip has clipped it to fit.
        'aria-label': `${props.label}, ${props.detail}, auto-pass settings`,
        ref: (node: unknown): void => {
          badge.current = asFocusable(node);
        },
        onClick: () => {
          setOpen(!open);
        },
      },
      // Wrapped so the clipping under width pressure lands on the words and not
      // on the disclosure marker, which the sheet draws as an `::after` on the
      // button itself.
      createElement('span', { className: 'mtg-turnstops__label' }, props.label),
    ),
    open
      ? turnStopsPanel(props, (): void => {
          close(true);
        })
      : null,
  );
}
