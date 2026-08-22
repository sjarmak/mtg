// @vitest-environment jsdom
/**
 * The replay board is the play board: what that means structurally, and where
 * the pixels behind it were read.
 *
 * The playtester, 2026-08-14, watching a replay (`mtg-ryix`): "I'd want the sizing to
 * match the play sizing view so you don't need to scroll around so much, and to
 * have the panel on the right be collapsible." The viewer rendered the same
 * `Board` the play route renders and rendered it in ordinary document flow — a
 * head, a transport, a caption, the board, and three panels in an `mtg-grid`
 * under it — so the board was as tall as its cards wanted and the game you were
 * watching was a page you scrolled.
 *
 * **jsdom performs no layout, so nothing in this file proves a pixel.**
 * `getBoundingClientRect` is all zeros here: there is no viewport, no box and no
 * card width. What jsdom does do is run the cascade and hold the rendered tree,
 * and every claim asserted below is one of those two — the mat's rules are
 * emitted under a scope this route is inside, the height chain between the shell
 * and the mat has no link pinned open at its content height, the three panels
 * are in the two slots `Board` offers rather than in a grid under it, and the
 * side panel's disclosure is a named button that survives the collapse.
 *
 * The pixels were read in chrome-headless-shell 151.0.7922.34 over
 * `tools/stage-replay.ts`'s log at **game 0, seq 120** (RW Aggro vs UB Control,
 * `lab/v1/RW-UB/1`), at 1440x900, 1280x800, 1024x768 and 810x1080. Page scroll
 * height went 2209 / 2451 / 2801 / 2984 to 900 / 800 / 768 / 1080 — the window
 * itself at all four — and both battlefields are whole at every one, where none
 * of them held either before. The viewer's own battlefield face went from a flat
 * 152.0px at every viewport to 99.2 / 80.0 / 68.0 / 48.0, against the play
 * route's 99.2 / 82.6 / 68.0 / 48.0 for the same four permanents a side: equal at
 * 1440x900 where both are the width `styles/board/hand.ts` states, 2.6px short at
 * 1280x800 where the spells row's own height cap trims it, and equal again at the
 * two small viewports, where both routes are on `styles/board/fit.ts`'s
 * `MIN_SLOT_WIDTH_REM` floor. The numbers are argued where the rules are, in
 * `styles/replay.ts`.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { SIDE_PANEL_LABEL } from '../../src/routes/play/rail-collapse';
import { TABLE } from '../../src/styles/board/geometry';
import { uiStyleSheet } from '../../src/styles/index';
import { routeScope } from '../../src/styles/tokens';
import { fixtureLog } from './support/log-fixture';

afterEach(cleanup);

const LOG = fixtureLog();

/** A frame with permanents, a hand a side and a decision on it. */
const SEQ = '120';

interface ElementLike {
  readonly matches: (selector: string) => boolean;
  readonly closest: (selector: string) => ElementLike | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => readonly ElementLike[];
}

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

function windowLike(): {
  readonly document: {
    readonly head: { innerHTML: string; appendChild: (node: unknown) => void };
    body: { innerHTML: string; readonly querySelector: (s: string) => ElementLike | null };
    readonly createElement: (tag: string) => { textContent: string };
  };
  readonly getComputedStyle: (element: unknown) => StyleLike;
} {
  const candidate = globalThis as {
    readonly document?: unknown;
    readonly getComputedStyle?: (element: unknown) => StyleLike;
  };
  if (typeof candidate.document !== 'object' || typeof candidate.getComputedStyle !== 'function') {
    throw new Error('this test needs a jsdom window');
  }
  return {
    document: candidate.document as ReturnType<typeof windowLike>['document'],
    getComputedStyle: candidate.getComputedStyle,
  };
}

/**
 * The viewer under the real sheet, and the same markup under a mode with no
 * table in it.
 *
 * `./fit.test.ts`'s neighbor one route over paints the same pair for the same
 * reason: every rule this file is about is scoped, and the second render is what
 * says so. The control is the Cards tab, which is the mode `test/play/fit.test.ts`
 * moved to when the replay viewer stopped being a route these rules avoid.
 */
function paint(): { readonly replay: ElementLike; readonly control: ElementLike } {
  const { document } = windowLike();
  const view = (mode: 'replay' | 'cards'): string =>
    renderToStaticMarkup(
      h(Shell, {
        mode,
        onSelectMode: () => undefined,
        children: h(ReplayViewer, {
          state: { status: 'ready', log: LOG },
          route: { mode: 'replay', params: { seq: SEQ } },
          onSetParams: () => undefined,
        }),
      }),
    );
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = uiStyleSheet();
  document.head.appendChild(style);
  document.body.innerHTML = `${view('replay')}${view('cards')}`;
  const replay = document.body.querySelector("[data-mtg-mode='replay']");
  const control = document.body.querySelector("[data-mtg-mode='cards']");
  if (replay === null || control === null) throw new Error('a shell did not render');
  return { replay, control };
}

function one(root: ElementLike, selector: string): ElementLike {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`nothing matched ${selector}`);
  return found;
}

function computed(element: ElementLike, property: string): string {
  return windowLike().getComputedStyle(element).getPropertyValue(property);
}

/**
 * The two DOM reads this file needs on what testing-library hands back, cast
 * structurally: the workspace tsconfig has no `lib: dom` (`src/mount.ts` records
 * why), so neither `getAttribute` nor `closest` is typed on an element here.
 */
function asElement(node: unknown): ElementLike {
  return node as ElementLike;
}

/**
 * The viewer on its own, for the assertions that are about the tree.
 *
 * The body is cleared first because `paint()` writes two whole shells into it
 * and testing-library's own cleanup does not own that markup — a `screen` query
 * after a paint would otherwise find one control twice and refuse to choose.
 *
 * And the stored preference with it. Whether the side panel is shut outlives a
 * reload on purpose (`routes/play/rail-collapse.ts`), and one jsdom window is
 * shared by every test in a file, so a test that shuts the panel would otherwise
 * hand the next one a board that starts shut.
 */
function mount(): void {
  const store = (globalThis as { readonly localStorage?: { clear(): void } }).localStorage;
  store?.clear();
  windowLike().document.body.innerHTML = '';
  render(
    h(ReplayViewer, {
      state: { status: 'ready', log: LOG },
      route: { mode: 'replay', params: { seq: SEQ } },
      onSetParams: () => undefined,
    }),
  );
}

describe('the mat is scoped to the routes that draw a table', () => {
  it('names the play route and the replay viewer, and nothing else', () => {
    // The scope is a list because two routes draw a whole table now, and it is
    // an `:is()` rather than two emissions of every rule so that the specificity
    // downstream is what a bare route scope always was.
    expect(TABLE).toContain(routeScope('play'));
    expect(TABLE).toContain(routeScope('replay'));
    for (const mode of ['deck', 'analysis', 'cards'] as const) {
      expect(TABLE, `${mode} draws no table and must not be in the mat's scope`).not.toContain(
        routeScope(mode),
      );
    }
    // Emitted once, under that one scope, rather than copied per route: the
    // sheet carries the mat's grid exactly once.
    const declarations = uiStyleSheet().match(/\.mtg-board \{[^}]*grid-template-columns:\s*var\(--ask-w\)/g);
    expect(declarations?.length, 'the mat states its fitted tracks in more than one place').toBe(1);
  });

  it('bounds the replay shell by the viewport and leaves the other routes alone', () => {
    const { replay, control } = paint();
    expect(computed(replay, 'height')).toBe('100dvh');
    expect(computed(control, 'height')).toBe('auto');
  });

  it('leaves no link between the shell and the mat pinned open at its content height', () => {
    // The chain `styles/views.ts` argues: a single flex item without
    // `min-height: 0` takes its content's height and the page grows again.
    const { replay } = paint();
    for (const selector of ['.mtg-shell__main', '.mtg-replay', '.mtg-replay__table', '.mtg-board']) {
      // cssstyle gives back `0px` for some of these and `0` for others; what the
      // check is about is that none of them is `auto`, which is the value that
      // pins a flex item open at its content height.
      expect(['0', '0px'], `${selector} is pinned open`).toContain(
        computed(one(replay, selector), 'min-height'),
      );
    }
    expect(computed(one(replay, '.mtg-replay__table'), 'flex-grow')).toBe('1');
  });

  it('spends no height on the strips above the mat', () => {
    const { replay } = paint();
    for (const selector of ['.mtg-toolbar', '.mtg-page-head']) {
      expect(computed(one(replay, `.mtg-replay > ${selector}`), 'flex-grow')).toBe('0');
      expect(computed(one(replay, `.mtg-replay > ${selector}`), 'flex-shrink')).toBe('0');
    }
  });

  it('gives the far lane the near lane own shape, because both hands are face up', () => {
    // The played table draws the opponent's hand as face-down chips in a fixed
    // track beside their board, and that rule is `PLAY`-scoped for this reason:
    // a replay draws five real cards there (`routes/replay/frame.ts`).
    const { replay } = paint();
    const far = one(replay, ".mtg-board__side[data-seat='opponent']");
    expect(computed(far, 'display')).toBe('flex');
    expect(computed(far, 'flex-direction')).toBe('column');
  });
});

describe('the three panels are in the two slots the board offers', () => {
  it('puts the decision in the ask column between the two pods', () => {
    mount();
    const decision = asElement(screen.getByLabelText('Decision'));
    expect(decision.closest('.mtg-board__pods'), 'the decision is not in the ask column').not.toBe(null);
    // And it wears the class the played table's move list wears, which is where
    // that column's compact head and internally scrolling body are declared.
    expect(decision.matches('.mtg-prompt')).toBe(true);
  });

  it('puts what happened and the turn index in the side rail', () => {
    mount();
    for (const label of ['What happened', 'Turns']) {
      const panel = asElement(screen.getByLabelText(label));
      expect(panel.closest('.mtg-board__rail'), `${label} is not in the rail`).not.toBe(null);
    }
  });

  it('hangs nothing under the board any more', () => {
    const { replay } = paint();
    expect(replay.querySelector('.mtg-grid'), 'a grid still hangs under the replay board').toBe(null);
    const table = one(replay, '.mtg-replay__table');
    expect(table.querySelectorAll('.mtg-board').length).toBe(1);
  });
});

describe('the side panel shuts and says so', () => {
  it('draws one disclosure, named, and expanded to start with', () => {
    mount();
    const toggle = asElement(screen.getByRole('button', { name: SIDE_PANEL_LABEL }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.closest('.mtg-rail__head')).not.toBe(null);
  });

  it('survives its own collapse, which is what makes the state reversible', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: SIDE_PANEL_LABEL }));
    const shut = asElement(screen.getByRole('button', { name: SIDE_PANEL_LABEL }));
    expect(shut.getAttribute('aria-expanded')).toBe('false');
    expect(shut.getAttribute('disabled')).toBe(null);
  });

  it('writes the state on the mat, in both directions', () => {
    mount();
    const mat = asElement(screen.getByLabelText('Decision')).closest('.mtg-board');
    if (mat === null) throw new Error('the decision panel is not on a mat');
    expect(mat.getAttribute('data-rail')).toBe('open');
    fireEvent.click(screen.getByRole('button', { name: SIDE_PANEL_LABEL }));
    expect(mat.getAttribute('data-rail')).toBe('shut');
    fireEvent.click(screen.getByRole('button', { name: SIDE_PANEL_LABEL }));
    expect(mat.getAttribute('data-rail')).toBe('open');
  });

  it('never lets a recorded frame hold the panel open', () => {
    // `useRailCollapse`'s hold is a non-empty stack, because a player who cannot
    // see what is about to resolve cannot decide whether to answer it. A watcher
    // answers nothing, and a hold read off the frame would reopen the column
    // mid-replay and resize every card on the board as you stepped. The control
    // is therefore never disabled, whatever the frame holds.
    mount();
    expect(asElement(screen.getByRole('button', { name: SIDE_PANEL_LABEL })).getAttribute('disabled')).toBe(
      null,
    );
    expect(screen.queryByText(/side panel stays open/)).toBe(null);
  });
});
