// @vitest-environment jsdom
/**
 * Two columns, two jobs: the ask on the left, the history on the right.
 *
 * `mtg-rgc.4`. Magic Online's left rail carries the current ask in plain language
 * between the two player pods and its right rail is Chat and Game Log and nothing
 * else. Ours stacked the priority prompt, the stack, the log and both graveyards
 * into one right column, and under a crowded board the parts competed: measured
 * over an 89-line log, opening it painted three of those lines at 1440x900 and
 * two at 1280x800 and 1024x768, and the move list gave up 149px the moment a
 * player opened it.
 *
 * **What this file can and cannot say.** jsdom performs no layout — no viewport,
 * no boxes, `getBoundingClientRect` all zeros — so it cannot say that the prompt
 * is legible in the pod gap or that the log gained lines.
 * `packages/ui/tools/rail-split.ts` is where that is said, in
 * chrome-headless-shell at the three viewports, and its numbers are quoted in the
 * docblocks the rules sit under. What is asserted here is everything the split
 * *is* that survives having no layout: which column each panel renders into, that
 * a board given no prompt draws none, that the mat states the two widths in the
 * order the columns sit in, and that moving four panels across the table
 * duplicated nothing and orphaned nothing in the accessible tree.
 *
 * The last one is why this file exists rather than an extra `describe` in
 * `fit.test.ts`. Moving a panel between two columns is the change most likely to
 * leave a second copy of a live region behind or to strand one whose text nobody
 * updates, and a failure that names that rule is worth more than a click-through
 * going red.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS, humanSeat, scenario } from '@mtg/kernel';
import { Board } from '../../src/board/Board';
import type { BoardSide } from '../../src/board/Board';
import { GAME_LOG_LABEL, GAME_LOG_STATUS_LABEL } from '../../src/log/GameLog';
import { dealMirrorGame } from '../../src/routes/play/deal';
import {
  CONTINUE_LABEL,
  LEGAL_MOVES_LABEL,
  PASS_KEY_STATUS_LABEL,
  PRIORITY_STATUS_LABEL,
  PlayView,
} from '../../src/routes/play/PlayView';
import { WAITING_LABEL } from '../../src/routes/play/rail';
import { PLAY_ASK_REM, PLAY_RAIL_REM } from '../../src/styles/board';
import { TABLE } from '../../src/styles/board/geometry';
import { ASK_PERCENT, RAIL_WIDTH_VAR } from '../../src/styles/board/rail';
import { POD_WIDTH_REM } from '../../src/styles/board/status';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const NAMES = ['You', 'Bot'] as const;

interface ElementLike {
  innerHTML: string;
  readonly matches: (selector: string) => boolean;
  readonly getAttribute: (name: string) => string | null;
  readonly closest: (selector: string) => ElementLike | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike> & Iterable<ElementLike>;
}

interface DocumentLike {
  readonly body: ElementLike;
  readonly createElement: (tag: string) => ElementLike;
}

/**
 * The document, reached structurally rather than through global types, because
 * the workspace tsconfig has no `lib: dom`. `fit.test.ts` and `board.test.ts`
 * each declare their own shape for the same reason; this one needs `closest` and
 * a node list and nothing else.
 */
function documentLike(): DocumentLike {
  const candidate = (globalThis as { document?: DocumentLike }).document;
  if (candidate === undefined) throw new Error('this test needs a jsdom document');
  return candidate;
}

function host(markup: string): ElementLike {
  const document = documentLike();
  const node = document.createElement('div');
  node.innerHTML = markup;
  return node;
}

function one(root: ElementLike, selector: string): ElementLike {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

/** A position at an ordinary priority, which is the prompt with a move list in it. */
function prioritySession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const opened = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

/** And a finished one, which is the same slot answering with a result instead. */
function endedSession(): GameSession {
  const built = scenario({
    seed: 'test/rail-split/over',
    battlefield: [],
    hands: [[], []],
    active: 0,
    turn: 3,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: { winner: 0 as PlayerId, loser: 1 as PlayerId, reason: 'lifeZero', endedOnTurn: 3 },
    beat: null,
    pending: null,
    choices: [],
    decisions: 12,
    committed: null,
  };
}

function view(session: GameSession, extra: Record<string, unknown> = {}): ElementLike {
  return host(
    renderToStaticMarkup(
      h(PlayView, { session, viewer: 0, names: NAMES, onChoose: () => undefined, ...extra }),
    ),
  );
}

describe('the ask is in the pod column and the history is in the rail', () => {
  it('renders the move list between the two seats, and nothing of it in the rail', () => {
    const painted = view(prioritySession());
    expect(one(painted, '.mtg-prompt').closest('.mtg-board__pods')).not.toBeNull();
    expect(painted.querySelector('.mtg-board__rail .mtg-prompt')).toBeNull();
    expect([...painted.querySelectorAll('.mtg-prompt')].length).toBe(1);
  });

  it('renders the log in the rail, and nothing of it in the pod column', () => {
    const painted = view(prioritySession());
    expect(one(painted, '.mtg-log').closest('.mtg-board__rail')).not.toBeNull();
    expect(painted.querySelector('.mtg-board__pods .mtg-log')).toBeNull();
  });

  /**
   * All four panels, not only the priority prompt. A beat, a result and a wait
   * are the same slot answering with something other than a list of moves, and a
   * surface that put three of them in one column and the fourth in the other
   * would be asking a player to look in two places for the answer to one
   * question. `src/routes/play/rail.ts` states that in prose at the file a lane
   * would open to change it.
   */
  it('puts the beat, the result and the wait in the same column the prompt is in', () => {
    const beat = view(prioritySession(), { beat: { kind: 'attackers' }, onContinue: () => undefined });
    expect(one(beat, '.mtg-prompt').closest('.mtg-board__pods')).not.toBeNull();
    expect(one(beat, '.mtg-prompt').innerHTML).toContain(CONTINUE_LABEL);

    const over = view(endedSession());
    expect(one(over, '.mtg-prompt').closest('.mtg-board__pods')).not.toBeNull();
    expect(one(over, '.mtg-prompt').innerHTML).toContain('Game over');

    const waiting = view(endedSession(), { awaitingName: 'Bot' });
    expect(one(waiting, '.mtg-prompt').closest('.mtg-board__pods')).not.toBeNull();
    expect(one(waiting, '.mtg-prompt').innerHTML).toContain(WAITING_LABEL);
  });

  /** The order down the column, which is the reference's arrangement. */
  it('draws the opponent, then the ask, then you', () => {
    const painted = view(prioritySession());
    const column = [...one(painted, '.mtg-board__pods').querySelectorAll('.mtg-pod, .mtg-prompt')];
    expect(column.map((node) => (node.matches('.mtg-pod') ? node.getAttribute('data-seat') : 'ask'))).toEqual(
      ['opponent', 'ask', 'you'],
    );
  });

  /**
   * A board given no prompt draws none. The replay frame is that board, and it
   * passed no rail either, so the slot has to be genuinely optional rather than
   * a container that is always emitted and usually empty.
   */
  it('leaves the pod column as it was for a board that passes no prompt', () => {
    const seat = (name: string): BoardSide => ({
      status: { name, life: 20, handCount: 3, libraryCount: 30, graveyardCount: 0 },
      battlefield: { label: `${name} battlefield`, permanents: [] },
    });
    const painted = host(
      renderToStaticMarkup(h(Board, { opponent: seat('Bot'), you: seat('You'), stack: { entries: [] } })),
    );
    const column = one(painted, '.mtg-board__pods');
    expect(column.querySelector('.mtg-prompt')).toBeNull();
    expect([...column.querySelectorAll('.mtg-pod')].length).toBe(2);
  });
});

describe('the two columns are two grid tracks with two stated widths', () => {
  /**
   * Asserted as the coupling rather than as pixels. The ask column is a clamp
   * because it has to bend on a narrow screen (`src/styles/board/rail.ts` carries
   * the measurement and the one board it costs), and what must not rot is that
   * its floor is the pod's own width and its cap is the ask width — a clamp whose
   * floor drifted below the pod would draw a pod narrower than the block it is.
   */
  it('states the ask column, the lanes and the rail in that order', () => {
    const sheet = uiStyleSheet();
    // The scope is read off the sheet's own constant rather than spelled here:
    // since `mtg-ryix` the mat is emitted under `TABLE`, which is the play route
    // and the replay viewer, and a literal prefix in this pattern would go red on
    // a change that moved neither the tracks nor their widths.
    const prefix = TABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tracks = new RegExp(
      `${prefix} \\.mtg-board \\{[^}]*--ask-w:\\s*clamp\\(([\\d.]+)rem, ([\\d.]+)%, ([\\d.]+)rem\\)[^}]*grid-template-columns:\\s*var\\(--ask-w\\)\\s*minmax\\(0, 1fr\\)\\s*var\\((--[a-z-]+)\\)`,
    ).exec(sheet);
    if (tracks === null) throw new Error('the played mat no longer states three tracks');
    expect(tracks[1]).toBe(String(POD_WIDTH_REM));
    expect(tracks[2]).toBe(String(ASK_PERCENT));
    expect(tracks[3]).toBe(String(PLAY_ASK_REM));
    // The third track is a property since `mtg-crw`, because the column collapses
    // and its width is a state rather than a constant. It is declared at the
    // open width on the same rule, so the track still resolves to the number
    // this file has always asserted.
    expect(tracks[4]).toBe(RAIL_WIDTH_VAR);
    expect(sheet).toContain(`${RAIL_WIDTH_VAR}: ${String(PLAY_RAIL_REM)}rem;`);
    // The ask column is wider than the pod that used to be alone in it, and
    // narrower than the rail it came out of. Both bounds are the point of the
    // number: below the first it is a squeezed pod, above the second it would be
    // cheaper to have left the prompt where it was.
    expect(PLAY_ASK_REM).toBeGreaterThan(POD_WIDTH_REM);
    expect(PLAY_ASK_REM).toBeLessThan(PLAY_RAIL_REM);
  });

  /**
   * The rail's open width did not move, and that is deliberate rather than
   * incidental: the log's three level buttons lay out at 230px in the 256px box a
   * 17rem rail gives them, so the 26px of slack `styles/board/log.ts` measured is
   * the whole budget for narrowing this column, and this lane spent none of it.
   *
   * What `mtg-crw` changed is that the width is now a state — shut, the column is
   * a strip — so the hover zoom hangs off the *property* rather than off a second
   * copy of the constant, and a zoom that still cleared 17rem would float over a
   * board with nothing under it. The priority row this test used to check with it
   * is gone: it was a band spanning the table and its pass is in the ask column
   * now (`src/routes/play/priority.ts`), so there is nothing left to hang.
   */
  it('hangs the hover zoom off the rail width, which is a property now', () => {
    const sheet = uiStyleSheet();
    const zoom = /\.mtg-zoom \{\s*inset-inline-end: calc\(var\((--[a-z-]+)\) \+ [^)]+\)/.exec(sheet)?.[1];
    expect(zoom).toBe(RAIL_WIDTH_VAR);
    // And nothing in the sheet still writes a fixed rail width into a rule that
    // has to follow the column, which is the failure this test exists to catch
    // one level up: a lane that added a third such rule from the constant would
    // be right until the panel shut.
    expect(sheet).not.toMatch(/margin-inline-end: calc\([\d.]+rem \+/);
  });
});

describe('moving four panels across the table left the accessible tree alone', () => {
  /**
   * `src/routes/play/priority.ts` names its live regions precisely so two lanes
   * cannot each add an unnamed one and end up with a single channel. Four named
   * `role="status"` regions live on this route and each has to appear exactly
   * once: a panel that moved column and left a copy behind would announce
   * everything twice, and one whose text nobody updates any more is worse,
   * because it is silent rather than wrong.
   */
  it('keeps one of each named announcement region, in one place', () => {
    render(h(PlayView, { session: prioritySession(), viewer: 0, names: NAMES, onChoose: vi.fn() }));
    for (const label of [PRIORITY_STATUS_LABEL, PASS_KEY_STATUS_LABEL, GAME_LOG_STATUS_LABEL]) {
      expect(screen.queryAllByRole('status', { name: label }).length, label).toBe(1);
    }
  });

  /**
   * The legal-move group survives the move, which is `rail-contract.test.ts`'s
   * whole subject; what is added here is *where* it survived to. It is the one
   * assertion in this file that couples the contract to a column, and it is worth
   * the coupling: the group is how a screen reader finds the set being chosen
   * from, and a group that ended up outside the panel it names would still pass
   * the contract.
   */
  it('keeps the legal moves inside the panel in the ask column', () => {
    render(h(PlayView, { session: prioritySession(), viewer: 0, names: NAMES, onChoose: vi.fn() }));
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL }) as unknown as ElementLike;
    expect(group.closest('.mtg-prompt')).not.toBeNull();
    expect(group.closest('.mtg-board__pods')).not.toBeNull();
  });

  /**
   * The log is still a disclosure and still in the rail, so opening it is still
   * the gesture `dismiss.ts` and `focus.ts` are about. The panel it opens is the
   * one region that grew here, and the check is that it opens into the rail
   * rather than anywhere the prompt used to be.
   */
  it('opens the log into the rail it now has to itself', () => {
    render(h(PlayView, { session: prioritySession(), viewer: 0, names: NAMES, onChoose: vi.fn() }));
    const toggle = screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL},`) });
    const disclosure = toggle as unknown as ElementLike;
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: GAME_LOG_LABEL }) as unknown as ElementLike;
    expect(panel.closest('.mtg-board__rail')).not.toBeNull();
    expect(panel.closest('.mtg-board__pods')).toBeNull();
  });
});

describe('the rail block rules follow the blocks that are left in it', () => {
  /**
   * The open log takes the column. Stated as the declarations rather than as a
   * height, because the height is a browser question and these are the cascade
   * facts behind it: `flex: 1 1 auto` on the block, no cap on the panel inside
   * it, and a disclosure above it that cannot be grown over.
   *
   * `mtg-rgc.7` emptied the rest of the column, so the sibling this is against is
   * no longer a floored graveyard — it is the disclosure, which is the way back
   * out of the collapsed state. That is the one thing in here that must not
   * shrink, and it is the reason the log grows by a flex factor rather than by
   * claiming the height outright.
   */
  it('lets an opened log take the column without growing over the way out of it', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toMatch(/\.mtg-board__rail > \.mtg-log\[data-open='true'\] \{[^}]*flex: 1 1 auto/);
    expect(sheet).toMatch(/\.mtg-board__rail > \.mtg-log > \.mtg-log__panel \{ max-height: none; \}/);
    // The generic block rule is still here and still binds the log while it is
    // shut, which is what keeps a closed disclosure the height of its own head.
    expect(sheet).toMatch(/\.mtg-board__rail > \.mtg-zone \{[^}]*max-height: 30%/);
    expect(sheet).toMatch(/\.mtg-rail__head \{[^}]*flex: none/);
  });
});

/**
 * `mtg-6i4`. A grid track minimum is a floor a grid item never shrinks below, so
 * a bare `11rem` minimum in a 127.7px column laid every group out at 176px and
 * hung the move labels 48.3px out over the board — measured in
 * chrome-headless-shell 151.0.7922.47 at 1024x768, 28 of 28 labels, and 15.1px
 * at 1280x800. jsdom lays nothing out, so what is asserted here is the
 * declaration that produced it: the minimum has to be bounded by the container
 * or the promise `styles/board/rail.ts` makes about this column cannot hold at
 * any width.
 */
describe('the move list is bounded by the column it is in', () => {
  it('caps the grid track minimum at the width of the container', () => {
    const sheet = uiStyleSheet();
    const tracks = /\.mtg-choices \{[^}]*grid-template-columns:\s*([^;]+);/.exec(sheet)?.[1];
    expect(tracks).toBe('repeat(auto-fit, minmax(min(11rem, 100%), 1fr))');
  });

  /**
   * The last resort under the track fix: a word with no break opportunity in it
   * is the one thing wrapping cannot place, and three card names produced
   * exactly that at 1024x768 once the labels stopped being 150px wide.
   */
  it('lets a label break inside a word it cannot otherwise fit', () => {
    expect(uiStyleSheet()).toMatch(/\.mtg-choice__label \{[^}]*overflow-wrap: break-word/);
  });
});

/**
 * `mtg-46g`. The ask holds 1,743 to 2,526px of moves in a 357 to 504px body, so
 * a player reads the top of the list and the rest is under the fold. Nothing
 * here can measure that — jsdom has no layout — so the assertions are the two
 * declarations that make the fold legible: the browser's own scrollbar, kept and
 * thinned, and a shadow on the cut edge that appears only while there is
 * something past it.
 */
describe('the ask says that its list continues', () => {
  it('draws a scroll shadow on each edge that has content past it', () => {
    const body = /\.mtg-prompt \.mtg-panel__body \{([^}]*)\}/.exec(uiStyleSheet())?.[1];
    if (body === undefined) throw new Error('the ask panel body no longer states its own rules');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('scrollbar-width: thin');
    // The cover pair scrolls with the content and the shadow pair does not,
    // which is the whole mechanism: a shadow only shows where a cover has slid
    // away from an edge.
    expect(body.match(/no-repeat local/g)).toHaveLength(2);
    expect(body.match(/no-repeat scroll/g)).toHaveLength(2);
    expect(body).toContain('--mtg-scroll-edge');
  });
});
