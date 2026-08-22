// @vitest-environment jsdom
/**
 * The side panel opens and shuts, and what it may not take with it.
 *
 * The playtester, 2026-08-14: "I want the side panel to be expandable and collapsible
 * so we can regain more of the gameboard space" (`mtg-crw`). The panel is the
 * right-hand rail, which since `mtg-rgc.7` is the game log and nothing else.
 *
 * Both columns' unanswered default is at the foot of this file, the ask column's
 * beside the rail's, because the two conditions are only legible against each
 * other.
 *
 * # What this file can and cannot say
 *
 * jsdom lays nothing out, so nothing here is about pixels. What it holds is the
 * mechanism: which attribute the mat carries, which rules the shipped sheet
 * states about that attribute, that the control is reachable in both states and
 * correctly named, that the state is a preference rather than a move, and that a
 * collapse can never take the legal-move list or the stack with it. The reclaim
 * itself is `src/styles/board/rail.ts`'s, measured in chrome-headless-shell
 * 151.0.7922.47 against the flagship set.
 *
 * # The two rules a collapse must not break
 *
 * `src/routes/play/rail.ts`'s contract is about the *ask* column and survives by
 * construction — the move list has been in the pod column since `mtg-rgc.4` and
 * this panel is the other one — but "by construction" is exactly the kind of
 * claim that stops being true quietly, so it is asserted rather than argued.
 *
 * And the stack. It is a control surface since `mtg-atq`, not a readout, so a
 * shut panel that hid it would hide a move. That used to be bought by forcing
 * the panel open whenever the stack held anything, at the price of the board's
 * width for the length of every spell. `mtg-rgc.7` bought it structurally
 * instead: the stack is drawn on the seam between the two seats, so a shut panel
 * cannot take it because it was never in the panel. The assertion below is the
 * same assertion — a non-empty stack, the panel shut, the resolve control still
 * on the page — and it now holds for a reason that cannot lapse.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState } from '@mtg/kernel';
import { humanSeat, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import {
  ASK_PANEL_LABEL,
  LEGAL_MOVES_LABEL,
  PlayView,
  SIDE_PANEL_KEY,
  SIDE_PANEL_LABEL,
} from '../../src/routes/play/PlayView';
import { STACK_NOTE } from '../../src/board/StackZone';
import type { SeatNames } from '../../src/routes/play/position';
import {
  CRAMPED_TABLE_QUERY,
  NARROW_TABLE_QUERY,
  SHORT_VIEWPORT_QUERY,
} from '../../src/styles/board/geometry';
import { PLAY_RAIL_REM, RAIL_WIDTH_VAR } from '../../src/styles/board/rail';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { uiStyleSheet } from '../../src/styles/index';
import { clearPreferences } from '../support/preferences';

afterEach(() => {
  cleanup();
  // The preference outlives a render on purpose, so it has to be cleared
  // between tests or the second one reads the first one's answer.
  clearPreferences();
  vi.unstubAllGlobals();
});

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

const BOLT: Card = parseCard({
  kind: 'instant',
  id: 'xmp-shock-arrow',
  name: 'Shock Arrow',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 100 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

function openState(): GameState {
  return scenario({
    battlefield: Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[BOLT, BOLT], []],
  }).state;
}

/** The same position with one bolt on the stack, which is what holds it open. */
function stackedState(): GameState {
  const state = openState();
  const cast = legalActions(state).find((action) => action.type === 'castSpell');
  if (cast === undefined) throw new Error('the fixture has nothing to cast');
  return reduce(state, cast).state;
}

function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

interface NodeLike {
  getAttribute(name: string): string | null;
  closest(selector: string): NodeLike | null;
  querySelector(selector: string): NodeLike | null;
  querySelectorAll(selector: string): ArrayLike<NodeLike>;
  readonly firstElementChild: NodeLike | null;
  readonly textContent: string | null;
}

/**
 * The document, and the two things this file asks of it.
 *
 * Structural rather than `lib: dom`, which the workspace tsconfig deliberately
 * does not have (`src/app/mount.ts` records why adding it collides with
 * `@types/node`). Every other jsdom test here reaches the page through
 * `@testing-library`; these two questions — what is under `body`, and what a
 * bare letter does when a text field has the focus — have no query for them.
 */
interface PageLike {
  readonly body: NodeLike;
  createElement(tag: string): NodeLike;
}

function page(): PageLike {
  const host = globalThis as { readonly document?: unknown };
  if (typeof host.document !== 'object' || host.document === null) throw new Error('no document');
  return host.document as unknown as PageLike;
}

function renderAt(state: GameState, onChoose: (choice: Choice) => void = () => undefined): void {
  render(h(PlayView, { session: sessionAt(state), viewer: 0, names: NAMES, onChoose }));
}

function toggle(): NodeLike {
  return screen.getByRole('button', { name: SIDE_PANEL_LABEL }) as unknown as NodeLike;
}

function mat(): NodeLike {
  const found = page().body.querySelector('.mtg-board');
  if (found === null) throw new Error('no mat on the page');
  return found;
}

describe('the control', () => {
  it('collapses the ask column while keeping both life totals and priority available', () => {
    renderAt(openState());
    const ask = screen.getByRole('button', { name: ASK_PANEL_LABEL });
    expect(mat().getAttribute('data-ask')).toBe('open');
    expect(screen.getAllByTitle('life total')).toHaveLength(2);
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Priority' })).toBeTruthy();

    fireEvent.click(ask);
    expect(mat().getAttribute('data-ask')).toBe('shut');
    expect(screen.getAllByTitle('life total')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Priority' })).toBeTruthy();
  });

  it('is named for what it discloses, in both states, and carries the state in aria-expanded', () => {
    // A disclosure's name says what it opens and `aria-expanded` says which way
    // it is pointing. A name like "Collapse side panel" would be a lie half the
    // time, and a name that changed would make the control a different control.
    renderAt(openState());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle() as unknown as Element);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe(SIDE_PANEL_LABEL);
  });

  it('is the rail own first child, so a shut panel still holds the way out of itself', () => {
    // Inside the rail rather than in the toolbar, and first, which is what makes
    // the shut state a strip rather than a vanished column — and what lets the
    // disclosure be followed without `aria-controls`, since the thing it opens
    // is the next thing in the document.
    renderAt(openState());
    const rail = mat().querySelector('.mtg-board__rail');
    if (rail === null) throw new Error('the board drew no rail');
    expect(rail.firstElementChild?.getAttribute('class')).toBe('mtg-rail__head');
    expect(toggle().closest('.mtg-board__rail')).not.toBeNull();
  });

  it('answers the shortcut, and refuses it from inside something being typed in', () => {
    renderAt(openState());
    fireEvent.keyDown(page().body as unknown as Element, { key: SIDE_PANEL_KEY });
    expect(mat().getAttribute('data-rail')).toBe('shut');
    fireEvent.keyDown(page().body as unknown as Element, { key: SIDE_PANEL_KEY });
    expect(mat().getAttribute('data-rail')).toBe('open');
    // A bare letter belongs to whatever is being typed in first.
    const field = page().createElement('input');
    (page().body as unknown as { appendChild(node: unknown): void }).appendChild(field);
    fireEvent.keyDown(field as unknown as Element, { key: SIDE_PANEL_KEY });
    expect(mat().getAttribute('data-rail')).toBe('open');
    // And a modified press belongs to the browser.
    fireEvent.keyDown(page().body as unknown as Element, { key: SIDE_PANEL_KEY, ctrlKey: true });
    expect(mat().getAttribute('data-rail')).toBe('open');
  });
});

describe('the state', () => {
  it('is written on the mat, because what changes is a grid track', () => {
    renderAt(openState());
    // Always written, false included, so a sheet can select either state and a
    // test can tell "open" from "this component never said".
    expect(mat().getAttribute('data-rail')).toBe('open');
    fireEvent.click(toggle() as unknown as Element);
    expect(mat().getAttribute('data-rail')).toBe('shut');
  });

  it('is not a game choice, and never reaches the choice log', () => {
    // The played surface's whole record is a seed and a list of indices, so a
    // panel that submitted one would make two replays of one game disagree.
    // `PlayView` is presentational, so the whole of what it could spend is this
    // callback.
    const onChoose = vi.fn();
    renderAt(openState(), onChoose);
    fireEvent.click(toggle() as unknown as Element);
    fireEvent.keyDown(page().body as unknown as Element, { key: SIDE_PANEL_KEY });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('survives a re-render, and a reload', () => {
    renderAt(openState());
    fireEvent.click(toggle() as unknown as Element);
    expect(mat().getAttribute('data-rail')).toBe('shut');
    // A re-render at a different position is what every kernel decision causes,
    // so a state that did not survive one would survive nothing.
    cleanup();
    renderAt(stackedState());
    // Still shut, with a spell on the stack. Nothing overrides the preference
    // any more: the stack that used to force this column open is on the board.
    expect(mat().getAttribute('data-rail')).toBe('shut');
    cleanup();
    // A reload is a fresh mount reading the store, which is what this is.
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('shut');
  });
});

describe('what the sheet does with it', () => {
  it('narrows game details without hiding life totals or the priority foot', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toContain(".mtg-board[data-ask='shut'] { --ask-w: 5rem; }");
    expect(sheet).toContain(".mtg-board[data-ask='shut'] .mtg-board__pods > .mtg-panel");
    expect(sheet).not.toContain(".mtg-board[data-ask='shut'] .mtg-priority { display: none; }");
    expect(sheet).not.toContain(".mtg-board[data-ask='shut'] .mtg-pod__life { display: none; }");
  });

  it('re-declares the rail width at one touch target, and the mat reads it', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toContain(`${RAIL_WIDTH_VAR}: ${String(PLAY_RAIL_REM)}rem;`);
    expect(sheet).toContain(`[data-rail='shut'] { ${RAIL_WIDTH_VAR}: ${String(TOUCH_TARGET_PX)}px; }`);
    // The strip is exactly the width of the one control in it, which is why the
    // number comes from `styles/touch.ts` rather than from a rem that happens to
    // match: a floor and a strip that could drift apart while both look right is
    // the defect this couples away.
    expect(sheet).toContain(`grid-template-columns:`);
    expect(sheet).toMatch(/minmax\(0, 1fr\)\s*var\(--rail-w\)/);
  });

  it('hides every block but the disclosure, by not drawing them at all', () => {
    // `display: none` rather than a zero width, because a hidden panel has to
    // leave the tab order and the accessible tree with the pixels. It is also
    // why the blocks stay mounted: a graveyard browser or a log the player had
    // open is still open when the panel comes back.
    expect(uiStyleSheet()).toContain(
      ".mtg-board[data-rail='shut'] .mtg-board__rail > *:not(.mtg-rail__head) { display: none; }",
    );
  });
});

describe('what a collapse may not take with it', () => {
  it('leaves the legal-move list exactly where it was', () => {
    // The rail contract (`src/routes/play/rail.ts`) is about the *ask* column and
    // this panel is the other one, so the two do not meet — asserted rather than
    // argued, because "they do not meet" is the kind of claim that stops being
    // true without anybody noticing.
    renderAt(openState());
    fireEvent.click(toggle() as unknown as Element);
    const moves = screen.getByRole('group', { name: LEGAL_MOVES_LABEL }) as unknown as NodeLike;
    expect(moves.closest('.mtg-board__pods')).not.toBeNull();
    expect(moves.closest('.mtg-board__rail')).toBeNull();
  });

  it('leaves the stack on the board, open or shut', () => {
    // The stack it cannot take, because the stack is not in it. Asserted by
    // where the strip is rather than by what the rail contains, so the claim
    // survives somebody adding a second block to the column.
    renderAt(stackedState());
    const before = screen.getByRole('group', { name: 'Stack' }) as unknown as NodeLike;
    expect(before.closest('.mtg-board__rail')).toBeNull();
    expect(before.closest('.mtg-board__lanes')).not.toBeNull();
    expect(before.textContent).toContain(BOLT.name);
    // The standing rule went from printed chrome to the group's description
    // when the block became a 32px strip; it still has to be reachable.
    expect(before.getAttribute('title')).toBe(STACK_NOTE);

    fireEvent.click(toggle() as unknown as Element);
    expect(mat().getAttribute('data-rail')).toBe('shut');
    const after = screen.getByRole('group', { name: 'Stack' }) as unknown as NodeLike;
    expect(after.closest('.mtg-board__rail')).toBeNull();
    expect(after.textContent).toContain(BOLT.name);
  });

  it('takes the press whatever the stack holds', () => {
    // The control was disabled with a note under it while a non-empty stack
    // pinned this column open. Nothing pins it now, so a disabled state here
    // would be a control refusing a press for a reason that has gone.
    renderAt(stackedState());
    expect(toggle().getAttribute('disabled')).toBeNull();
    expect(toggle().getAttribute('aria-describedby')).toBeNull();
    fireEvent.keyDown(page().body as unknown as Element, { key: SIDE_PANEL_KEY });
    expect(mat().getAttribute('data-rail')).toBe('shut');
  });
});

/**
 * The third state, and the viewport that answers for it (`mtg-l4w0`).
 *
 * A landscape phone is 390 CSS px tall with the browser chrome off it, and the
 * open column takes 272 of an 844px mat for a log. Nothing about that is a
 * preference — it is what a player who has never pressed anything is handed —
 * so the absence of a stored answer stopped meaning "open" and started meaning
 * "ask the table". A press still wins outright, in both directions, which is
 * what keeps `aria-expanded` truthful: a sheet that forced the column shut
 * behind the control's back would leave the disclosure claiming a state the
 * board is not in.
 *
 * jsdom's own `matchMedia` answers `false` to everything, so a cramped table is
 * reached by stubbing it — and the stub asserts the query it was asked, since a
 * hook that watched some other query would pass every behavioral check here
 * while doing nothing on a phone.
 */
describe('the unanswered default', () => {
  /** A window that says yes to one query and no to the rest, and records both. */
  function viewportSaying(cramped: boolean): { readonly asked: string[] } {
    const asked: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      asked.push(query);
      return {
        matches: query === CRAMPED_TABLE_QUERY && cramped,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    });
    return { asked };
  }

  it('shuts the column on a table that cannot afford it, and asks the shared query', () => {
    const host = viewportSaying(true);
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('shut');
    expect(host.asked, 'the hook watched a query of its own').toContain(CRAMPED_TABLE_QUERY);
    // The control says what the board says. A pure-CSS force would not.
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves it open on a table that can', () => {
    viewportSaying(false);
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('open');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens it anyway once the player says so, and remembers that', () => {
    viewportSaying(true);
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('shut');
    fireEvent.click(toggle() as unknown as Element);
    expect(mat().getAttribute('data-rail')).toBe('open');
    // A reload on the same phone: the press outlives the viewport that
    // disagreed with it, which is the whole difference between the stored
    // answer and the absent one.
    cleanup();
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('open');
  });

  it('opens it where nothing can be asked at all', () => {
    // A server render and a test host without `matchMedia` both draw the layout
    // this surface has always drawn: an unanswerable viewport must not silently
    // lose the column.
    vi.stubGlobal('matchMedia', undefined);
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('open');
  });
});

/**
 * The same third state on the other column, and why the two answer differently.
 *
 * The playtester, 2026-08-19: "the expand and collapse bars on the left and right
 * also are taking up too much space on the screen and we should better optimize
 * it". The rail's answer above is `CRAMPED_TABLE_QUERY` — narrow *or* short —
 * and the ask column's is `SHORT_VIEWPORT_QUERY` alone. `src/routes/play/
 * ask-collapse.ts` argues the asymmetry; the test that pins it is the third one
 * here, because a merely narrow table shuts one column and not the other, and
 * nothing else in the suite would notice if that collapsed into one query.
 *
 * The viewport is modeled by its two dimensions rather than by string identity,
 * since `CRAMPED_TABLE_QUERY` is a comma list whose narrow arm can match while
 * its short arm does not — which is exactly the case being separated.
 */
describe('the unanswered default, on the ask column', () => {
  /** A window of a stated shape, answering either query the way a browser would. */
  function viewportThatIs(narrow: boolean, short: boolean): { readonly asked: string[] } {
    const asked: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      asked.push(query);
      const arms = query.split(', ');
      return {
        matches: arms.some(
          (arm) => (arm === NARROW_TABLE_QUERY && narrow) || (arm === SHORT_VIEWPORT_QUERY && short),
        ),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    });
    return { asked };
  }

  function askToggle(): NodeLike {
    return screen.getByRole('button', { name: ASK_PANEL_LABEL }) as unknown as NodeLike;
  }

  it('shuts the column on a table with no height, and asks the short query', () => {
    const host = viewportThatIs(false, true);
    renderAt(openState());
    expect(mat().getAttribute('data-ask')).toBe('shut');
    expect(host.asked, 'the hook watched a query of its own').toContain(SHORT_VIEWPORT_QUERY);
    expect(askToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves it open in portrait, where the ask is the first thing touched', () => {
    viewportThatIs(false, false);
    renderAt(openState());
    expect(mat().getAttribute('data-ask')).toBe('open');
    expect(askToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps it open on a table that is merely narrow, where the rail shuts', () => {
    // The asymmetry, asserted on one render so the two columns cannot be read
    // as agreeing by accident: a 900px-wide desktop window with room to spare
    // vertically is a table the log can leave and the ask cannot.
    viewportThatIs(true, false);
    renderAt(openState());
    expect(mat().getAttribute('data-rail')).toBe('shut');
    expect(mat().getAttribute('data-ask')).toBe('open');
  });

  it('shuts it anyway once the player says so, and remembers that', () => {
    viewportThatIs(false, false);
    renderAt(openState());
    expect(mat().getAttribute('data-ask')).toBe('open');
    fireEvent.click(askToggle() as unknown as Element);
    expect(mat().getAttribute('data-ask')).toBe('shut');
    cleanup();
    renderAt(openState());
    expect(mat().getAttribute('data-ask')).toBe('shut');
  });

  it('opens it where nothing can be asked at all', () => {
    vi.stubGlobal('matchMedia', undefined);
    renderAt(openState());
    expect(mat().getAttribute('data-ask')).toBe('open');
  });
});
