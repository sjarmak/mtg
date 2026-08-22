/**
 * The game log: the authoritative history of the game in progress.
 *
 * `mtg-bz2.12`. the playtester: "Every spell, ability, target, trigger, damage event,
 * life change, zone movement, and important choice should appear in a textual
 * event log. This is particularly important for an MTGO-like application."
 *
 * It reads `GameSession.events` and nothing else. Not a second derivation, not a
 * projection of board state, not a record this component writes as clicks come
 * in: the kernel is event-sourced and the log is that stream in English, which is
 * the epic's acceptance criterion. `./group.ts` turns the stream into turns and
 * steps, `./narrate.ts` writes each sentence (the same function the replay route
 * uses, so the two surfaces cannot disagree about what an event says), and
 * `./visibility.ts` decides which card names this seat is entitled to read.
 *
 * # What it takes from `routes/replay/EventPanel.ts` and what it does not
 *
 * The sentences, and only the sentences. `describeEvent` is shared and stays
 * shared, because two functions that can disagree about what an event *says* is
 * the one thing this repository's convention is actually protecting.
 *
 * The presentation is not shared, and three of its decisions are reversed here
 * rather than inherited:
 *
 *  - **It is grouped.** `EventPanel` renders one flat numbered list, which is
 *    right for what it draws: the events of a single replay step, usually under
 *    ten of them, with the transport supplying the turn and step around it. A
 *    live log has no transport and is the whole game at once.
 *  - **An empty step is not announced.** `EventPanel` says "this step changed
 *    nothing on the board", because a replay step that printed nothing would
 *    otherwise look like a broken transport. Here an empty step is thirteen lines
 *    of nothing per turn, so at `story` density the group is simply not drawn.
 *  - **It is a disclosure.** `EventPanel` is always open; it has a panel to
 *    itself. This is a fourth block on a 17rem rail that already holds the move
 *    list, the stack and two graveyards.
 *
 * # Closed is a strip, open is the history
 *
 * `../board/ZoneBrowser.ts`'s decision, taken again for the same reasons. The
 * rail is 17rem holding the move list, the stack and two graveyards on a screen
 * that already has to fit two boards and two hands (`../styles/board/rail.ts`),
 * and a docked five-hundred-line log would take that space from the cards. So the
 * closed state is one line naming the newest thing that happened, which is what
 * pays for newest-visible at all times and at one row of height, and the full
 * grouped history is one click away.
 *
 * # Where newest-visible is actually paid for, and why nothing jumps
 *
 * The open panel is a scroll container laid out `column-reverse` with a single
 * flex child. That is not a reordering — the list inside keeps chronological DOM
 * order, so reading order and screen-reader order are untouched — it is where the
 * scroll anchor sits. A `column-reverse` scroller is anchored at its *bottom*, so
 * a log opened mid-game opens on the newest line with no effect, no ref and no
 * `scrollTop` write, and appending to it leaves a reader who has scrolled up
 * exactly where they were. Measured at three viewports: the reader's anchor line
 * moves 0.1px under a 30-entry burst, and at rest the panel follows.
 * `../styles/board/log.ts` carries the numbers and the one declaration that had
 * to be *removed* to get them.
 *
 * The alternative was the usual one: an effect that measures `scrollHeight` and
 * writes `scrollTop` when the reader was already at the end. It behaves the same
 * when it works, costs a ref and a layout effect, and has a failure mode the CSS
 * does not — a mismeasure yanks the panel while somebody is reading it, which the
 * brief names as worse than a log that does not follow at all.
 *
 * Chronological rather than newest-first, which is where this parts company with
 * `../board/Graveyard.ts`'s sort contract, deliberately: `./group.ts` carries that
 * argument.
 *
 * # The log is not a live region, and that is the researched answer
 *
 * A burst here is twenty to forty entries at once: one click can resolve a spell,
 * kill two creatures, fire two death triggers and move both life totals. Three
 * findings decide the shape, and each rules out an option that looks right.
 *
 *  1. `aria-live="polite"` over the list queues every addition and reads them
 *     all, uninterruptible. WCAG's own Understanding text for SC 4.1.3 names the
 *     risk ("there is a risk of making an application too 'chatty' for a screen
 *     reader user"), and live announcements are flat text — the headings and list
 *     structure below are not conveyed in them at all.
 *  2. `role="log"` with `aria-live="off"` looks like the way to keep the log
 *     semantics without the noise, and it is not. ARIA defines `off` as "updates
 *     to the region should not be presented to the user *unless the user is
 *     currently focused on that region*", and this panel is focusable on purpose
 *     (see 3), so the suppression lifts at exactly the moment somebody is reading
 *     it. Worse, the Enable Project's log walkthrough reports NVDA with Firefox
 *     reading out the node *in its entirety* when something is appended to a
 *     `role="log"`, which at five hundred entries is not a log, it is a hostage
 *     situation. They recommend against the role outright.
 *  3. So the panel is a plain named `role="region"` with `tabindex="0"`, which is
 *     a requirement rather than a flourish: a scroll container that only a mouse
 *     can scroll fails SC 2.1.1, and once it takes focus it owes an accessible
 *     name. Inside it the turn and step titles are real headings and the entries
 *     are real list items, because browse mode is how a person reads five hundred
 *     of anything, and browse mode is the channel an announcement cannot use.
 *
 * What announces is a digest: one visually hidden `role="status"` (implicitly
 * polite and atomic) carrying the newest line and its entry number, replaced whole
 * on each update. One sentence per action, on a surface where nothing moves until
 * the player acts. The entry number is not decoration — an atomic status region
 * re-announces on a text *change*, and two identical draws in a row would
 * otherwise be one announcement. It is rendered whether the panel is open or shut,
 * because a live region has to be in the document before its text changes or the
 * change is silent, and `aria-live="polite"` is stated on it redundantly, which is
 * MDN's advice for VoiceOver on `role="status"`.
 */
import { createElement, useId, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { GameEvent, PlayerId } from '@mtg/kernel';
import { buildLog, summarizeLog } from './group';
import type { LogDensity, LogLine, LogStep, LogSummary, LogTurn } from './group';
import type { LogNames } from './narrate';

/** Nothing to draw, and the same reference every time, so the memo holds. */
const EMPTY_LOG: readonly LogTurn[] = [];

/** The accessible name of the log, on the panel and on the control that opens it. */
export const GAME_LOG_LABEL = 'Game log';

/**
 * The digest region's own name. See `../routes/play/PhaseBar.ts`'s
 * `PHASE_BAR_STATUS_LABEL`: the played table carries two `role="status"`
 * regions, so each says which one it is.
 */
export const GAME_LOG_STATUS_LABEL = 'Newest log entry';

/** The button that adds the engine's own bookkeeping to the list. */
export const EVERY_EVENT_LABEL = 'Every event';

/**
 * The three levels, named for the question a player is asking rather than for
 * the tier of the stream each one reaches.
 *
 * `mtg-zwk`. There were two, and the gap between them was 179 lines and 905 on a
 * finished game: a reader who wanted to see where their mana went had to take
 * every priority pass in the game with it. `./group.ts` argues where the two new
 * boundaries sit and why priority is a tier of its own.
 *
 * `Every event` keeps the name it had, because it still does what it said: it is
 * the setting under which the count closes against `session.events` and the log
 * can be held to being authoritative rather than edited.
 */
export const DENSITY_LABELS: Readonly<Record<LogDensity, string>> = {
  story: 'Story',
  detail: 'Detail',
  everything: EVERY_EVENT_LABEL,
};

/** The accessible name of the three-button level control. */
export const DENSITY_GROUP_LABEL = 'How much of the log to show';

const DENSITIES: readonly LogDensity[] = ['story', 'detail', 'everything'];

export interface GameLogProps {
  /** The kernel's stream, whole. `@mtg/kernel`'s `GameSession.events`. */
  readonly events: readonly GameEvent[];
  /** Unredacted names; what reaches a sentence is `./visibility.ts`'s answer. */
  readonly names: LogNames;
  /** The seat reading it, which with two people at one screen changes hands. */
  readonly viewer: PlayerId;
}

function lineNode(line: LogLine): ReactElement {
  return createElement(
    'li',
    { key: line.key, className: 'mtg-log__line', 'data-role': line.role },
    createElement('span', { className: 'mtg-log__num' }, String(line.index + 1)),
    createElement('span', { className: 'mtg-log__text' }, line.text),
  );
}

function stepNode(step: LogStep): ReactElement {
  return createElement(
    'li',
    { key: step.key, className: 'mtg-log__step' },
    createElement('h4', { className: 'mtg-log__step-title' }, step.title),
    step.lines.length === 0
      ? createElement('p', { className: 'mtg-zone__empty' }, 'nothing happened')
      : createElement('ol', { className: 'mtg-log__lines' }, ...step.lines.map(lineNode)),
  );
}

function turnNode(turn: LogTurn): ReactElement {
  return createElement(
    'li',
    { key: turn.key, className: 'mtg-log__turn' },
    createElement(
      'h3',
      { className: 'mtg-log__turn-title' },
      createElement('span', { className: 'mtg-log__turn-no' }, turn.title),
      turn.owner === null ? null : createElement('span', { className: 'mtg-log__turn-owner' }, turn.owner),
    ),
    createElement('ol', { className: 'mtg-log__steps' }, ...turn.steps.map(stepNode)),
  );
}

export function GameLog(props: GameLogProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [density, setDensity] = useState<LogDensity>('story');
  const panelId = useId();
  const { events, names, viewer } = props;

  // The shut strip's two facts, on every render, without narrating the stream:
  // `group.ts` carries what the tree cost when it was built here unconditionally.
  const summary = useMemo(
    (): LogSummary => summarizeLog({ events, names, viewer, density }),
    [events, names, viewer, density],
  );
  const turns = useMemo(
    (): readonly LogTurn[] => (open ? buildLog({ events, names, viewer, density }) : EMPTY_LOG),
    [open, events, names, viewer, density],
  );
  // The whole stream's size, so the button that reveals the bookkeeping can say
  // how much of it is currently out of the list rather than being a toggle whose
  // effect a reader has to discover by pressing it. Only while it is on screen.
  const everything = useMemo(
    (): number =>
      !open || density === 'everything'
        ? summary.count
        : summarizeLog({ events, names, viewer, density: 'everything' }).count,
    [open, density, summary.count, events, names, viewer],
  );

  const shown = summary.count;
  const newest = summary.newest;
  const hidden = everything - shown;

  const head: ReactNode = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-browser__head mtg-log__head',
      'aria-expanded': open,
      'aria-controls': panelId,
      'aria-label': `${GAME_LOG_LABEL}, ${shown === 1 ? '1 entry' : `${String(shown)} entries`}`,
      onClick: (): void => {
        setOpen(!open);
      },
    },
    createElement('span', { className: 'mtg-zone__label' }, GAME_LOG_LABEL),
    createElement('span', { className: 'mtg-zone__count' }, String(shown)),
    newest === null ? null : createElement('span', { className: 'mtg-browser__newest' }, newest.text),
  );

  return createElement(
    'section',
    {
      // Deliberately unnamed, unlike the zone browsers it borrows its head from:
      // the panel below is the named region, and a landmark inside a landmark of
      // the same name is one to step over twice.
      className: 'mtg-zone mtg-log',
      'data-tone': 'rail',
      'data-open': open,
    },
    head,
    open
      ? createElement(
          'div',
          {
            id: panelId,
            className: 'mtg-log__panel',
            // Named, focusable, and not live. The file docblock argues all three.
            role: 'region',
            'aria-label': GAME_LOG_LABEL,
            tabIndex: 0,
          },
          createElement('ol', { className: 'mtg-log__turns' }, ...turns.map(turnNode)),
        )
      : null,
    open
      ? createElement(
          'div',
          { className: 'mtg-log__foot' },
          createElement(
            'div',
            { className: 'mtg-log__levels', role: 'group', 'aria-label': DENSITY_GROUP_LABEL },
            ...DENSITIES.map((level) =>
              createElement(
                'button',
                {
                  key: level,
                  type: 'button',
                  className: 'mtg-btn mtg-log__density',
                  // Pressed rather than checked: three buttons where any one can
                  // be on is a toolbar of toggles, and a radio group would owe
                  // roving focus for a control that is three items wide.
                  'aria-pressed': density === level,
                  onClick: (): void => {
                    setDensity(level);
                  },
                },
                DENSITY_LABELS[level],
              ),
            ),
          ),
          createElement(
            'span',
            { className: 'mtg-log__hidden' },
            hidden === 0 ? 'nothing hidden' : `${String(hidden)} hidden`,
          ),
        )
      : null,
    // Always rendered: a live region has to exist before its text changes.
    createElement(
      'span',
      {
        className: 'mtg-sr-only',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': GAME_LOG_STATUS_LABEL,
      },
      newest === null ? '' : `Log entry ${String(newest.index + 1)}: ${newest.text}`,
    ),
  );
}
