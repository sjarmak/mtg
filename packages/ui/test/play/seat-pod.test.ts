// @vitest-environment jsdom
/**
 * A seat is a pod in a column of its own, not a strip over its board.
 *
 * `mtg-rgc.1`. Magic Online puts both players' vitals in one column on the far
 * left — the opponent's pod at the top, yours at the bottom — so the pair is one
 * vertical scan that never crosses the board, and neither seat spends a row of
 * the table's scarce axis on a header. Ours printed the same facts as a
 * horizontal strip above each battlefield.
 *
 * What this file can and cannot say is the division `./fit.test.ts` already
 * draws. jsdom lays nothing out: `getBoundingClientRect` is all zeros, so no
 * assertion here can claim the pod fits, that the wells grew, or that nothing
 * overlaps. It runs the cascade and it reads the tree, so what it asserts is
 * that the pods are in a column outside the lanes, that the lanes hold no vitals
 * block at all any more, that the column is one fixed track at both ends of the
 * mat, and that a pod prints what a player needs. The pixels are
 * `packages/ui/tools/seat-pod.ts` in chrome-headless-shell, and the numbers it
 * returned are in `../../src/styles/board/status.ts` beside the width they
 * argue for.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { PIP_GLYPHS } from '../../src/card/anatomy';
import { Board } from '../../src/board/Board';
import { SeatPod } from '../../src/board/SeatPod';
import type { BoardSide } from '../../src/board/Board';
import { Shell } from '../../src/app/Shell';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { uiStyleSheet } from '../../src/styles/index';
import { POD_WIDTH_REM } from '../../src/styles/board/status';

afterEach(cleanup);

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  innerHTML: string;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike> & Iterable<ElementLike>;
  readonly appendChild: (child: ElementLike) => void;
  readonly getAttribute: (name: string) => string | null;
  readonly previousElementSibling: ElementLike | null;
  textContent: string;
}

interface DocumentLike {
  readonly head: ElementLike;
  readonly body: ElementLike;
  readonly createElement: (tag: string) => ElementLike;
}

interface WindowLike {
  readonly document: DocumentLike;
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/**
 * The window, reached structurally rather than through global types, because the
 * workspace tsconfig has no `lib: dom`. Every sheet-reading test in this
 * directory declares its own shape for the same reason.
 */
function windowLike(): WindowLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  return { document, getComputedStyle: candidate.getComputedStyle };
}

/**
 * The played table under the real sheet, and the same markup under another mode.
 * Every rule the pod column adds is scoped or not scoped to the route, and the
 * second render is what says which — `./fit.test.ts` paints the same pair for
 * the same reason, and records why the control is the Cards tab rather than the
 * replay viewer since `mtg-ryix`.
 */
function paint(): { readonly play: ElementLike; readonly control: ElementLike } {
  const { document } = windowLike();
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const table = (mode: 'play' | 'cards'): string =>
    renderToStaticMarkup(
      h(Shell, {
        mode,
        onSelectMode: () => undefined,
        children: h(PlayRoute, { config: game.config }),
      }),
    );
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = uiStyleSheet();
  document.head.appendChild(style);
  document.body.innerHTML = `${table('play')}${table('cards')}`;
  const play = document.body.querySelector("[data-mtg-mode='play']");
  const control = document.body.querySelector("[data-mtg-mode='cards']");
  if (play === null || control === null) throw new Error('a shell did not render');
  return { play, control };
}

function computed(element: ElementLike, property: string): string {
  return windowLike().getComputedStyle(element).getPropertyValue(property).trim();
}

function one(root: ElementLike, selector: string): ElementLike {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`nothing under the shell matched ${selector}`);
  return found;
}

/** A seat with everything a pod can print, so a test can take one fact away. */
function seatSide(name: string): BoardSide {
  return {
    status: { name, life: 20, handCount: 5, libraryCount: 30, graveyardCount: 2 },
    battlefield: { label: `${name} battlefield`, permanents: [] },
  };
}

describe('SeatPod', () => {
  it('prints the life total, the name and the zone counts it is given', () => {
    render(h(SeatPod, { name: 'Bot', life: 18, handCount: 5, libraryCount: 30, graveyardCount: 2 }));
    expect(screen.getByLabelText("Bot's status")).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('Bot')).toBeTruthy();
    expect(screen.getByText('library')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('hand')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('shows an em dash for a count the view cannot know rather than a zero', () => {
    render(h(SeatPod, { name: 'Bot', life: 20, handCount: 4, libraryCount: null, graveyardCount: null }));
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.getByText('4')).toBeTruthy();
  });

  /**
   * The pod counts the two zones nobody can look through and stops. A graveyard
   * is a pile you open, and `../../src/board/ZoneBrowser.ts` prints its depth on
   * the strip you click to open it, so a chip here would be the same number in
   * two places — the argument `../../src/styles/board/fit.ts` made when it took
   * the zone heads off the lanes and left the rail's alone.
   */
  it('counts the library and the hand, and leaves the graveyard to its browser', () => {
    const { document } = windowLike();
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      h(SeatPod, { name: 'You', life: 20, handCount: 5, libraryCount: 30, graveyardCount: 2 }),
    );
    const labels = [...host.querySelectorAll('.mtg-pod__chip-label')];
    expect(labels.map((label) => label.textContent)).toEqual(['library', 'hand']);
  });

  it('marks a low life total and the active seat, and names who holds priority', () => {
    const markup = renderToStaticMarkup(
      h(SeatPod, {
        name: 'You',
        life: 3,
        handCount: 1,
        libraryCount: 30,
        graveyardCount: 2,
        active: true,
        priority: true,
      }),
    );
    expect(markup).toContain('data-low="true"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('Active');
    expect(markup).toContain('Priority');
  });

  /**
   * Through `PlayerStatus`'s own renderer rather than a second copy of it. A
   * floating `{U}` drawn one way in the strip and another in the pod is
   * `mtg-bc2.45.5` one layer down, and the way to not have that argument twice is
   * to not have the function twice.
   */
  it('draws the floating pool as the shared symbols rather than spelling them', () => {
    const markup = renderToStaticMarkup(
      h(SeatPod, {
        name: 'You',
        life: 20,
        handCount: 7,
        libraryCount: 33,
        graveyardCount: 0,
        mana: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 },
      }),
    );
    expect(markup).toContain('class="mtg-pip__glyph"');
    expect(markup).toContain(`d="${PIP_GLYPHS.w.fill}"`);
    expect(markup).toContain(`d="${PIP_GLYPHS.c.fill}"`);
    expect(markup).not.toMatch(/>[WUBRGC]</);
  });
});

describe('the board puts both seats in one column', () => {
  it('draws the pods outside the lanes, opponent first', () => {
    const { document } = windowLike();
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      h(Board, { opponent: seatSide('Bot'), you: seatSide('You'), stack: { entries: [] } }),
    );
    const pods = [...one(host, '.mtg-board__pods').querySelectorAll('.mtg-pod')];
    expect(pods.map((pod) => pod.getAttribute('data-seat'))).toEqual(['opponent', 'you']);
    expect(pods.map((pod) => pod.getAttribute('aria-label'))).toEqual(["Bot's status", 'your status']);
    expect(host.querySelector('.mtg-board__side .mtg-pod')).toBeNull();
    expect(host.querySelector('.mtg-board__side .mtg-status')).toBeNull();
  });

  /**
   * The depth of a graveyard is printed once, on the browser that opens it, and
   * a board that draws one still prints that number in exactly one place.
   *
   * Since `mtg-rgc.7` that browser is in this column, immediately under the seat
   * it belongs to, which is where `references/068-1083771671.png` draws it:
   * Magic Online hangs each player's zones off that player's own pod. Both piles
   * used to be stacked at the foot of the rail two columns over, so reading
   * whose graveyard you were looking at meant reading its label. Adjacency is
   * the whole point, so adjacency is what is asserted.
   */
  it('draws a graveyard under its own seat, and prints its depth only there', () => {
    const { document } = windowLike();
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      h(Board, {
        opponent: seatSide('Bot'),
        you: { ...seatSide('You'), graveyard: { label: 'Your graveyard', cards: [] } },
        stack: { entries: [] },
      }),
    );
    const pods = [...one(host, '.mtg-board__pods').querySelectorAll('.mtg-pod')];
    const chips = pods.map((pod) =>
      [...pod.querySelectorAll('.mtg-pod__chip-label')].map((c) => c.textContent),
    );
    expect(chips).toEqual([
      ['library', 'hand'],
      ['library', 'hand'],
    ]);
    const column = one(host, '.mtg-board__pods');
    expect(column.textContent).toContain('Your graveyard');
    expect(one(host, '.mtg-board__rail').textContent).not.toContain('Your graveyard');
    // Under the pod it belongs to rather than at the foot of the column, which
    // is what lets it need no seat name of its own to be read.
    const browser = one(column, '.mtg-browser');
    const above = browser.previousElementSibling;
    expect(above?.getAttribute('class')).toContain('mtg-pod');
    expect(above?.getAttribute('data-seat')).toBe('you');
  });
});

describe('the pod column is a fixed track on the mat', () => {
  it('gives the mat a pod track on the play route and on a page with no budget', () => {
    const { play, control } = paint();
    const track = `${String(POD_WIDTH_REM)}rem`;
    expect(computed(one(play, '.mtg-board'), 'grid-template-columns')).toContain('var(--ask-w)');
    expect(uiStyleSheet()).toContain(`--ask-w: clamp(${track}`);
    expect(computed(one(control, '.mtg-board'), 'grid-template-columns')).toContain(track);
    // The box and the track are one number, which is the property worth holding:
    // a pod sized independently of its column would leave a gutter or overhang
    // it. Off the play route the pod states that number itself, and jsdom
    // resolves it against the 16px root. On the play route the track is wider
    // than the pod — it carries the ask between the two seats since `mtg-rgc.4`
    // — so the pod takes the track instead of restating a width that is no
    // longer the column's.
    expect(computed(one(control, '.mtg-pod'), 'width')).toBe(`${String(POD_WIDTH_REM * 16)}px`);
    expect(computed(one(play, '.mtg-pod'), 'width')).toBe('auto');
    expect(computed(one(play, '.mtg-board__pods'), 'align-items')).toBe('stretch');
  });

  /**
   * The two ends of the column are the arrangement rather than a nicety: read
   * top to bottom, the opponent's pod sits over their board and yours sits under
   * yours, which is the orientation the rest of the mat already has.
   */
  it('holds the two pods apart at the ends of a column that does not stretch them', () => {
    const { play } = paint();
    const pods = one(play, '.mtg-board__pods');
    expect(computed(pods, 'flex-direction')).toBe('column');
    expect(computed(pods, 'justify-content')).toBe('space-between');
    expect(computed(one(play, '.mtg-pod'), 'flex-grow')).toBe('0');
    expect(computed(one(play, '.mtg-pod'), 'flex-shrink')).toBe('0');
  });

  /** And the strip is gone from the played table entirely, not merely hidden. */
  it('leaves no vitals strip on either lane', () => {
    const { play, control } = paint();
    expect(play.querySelector('.mtg-board__lanes .mtg-status')).toBeNull();
    expect(control.querySelector('.mtg-board__lanes .mtg-status')).toBeNull();
    expect(play.querySelector('.mtg-board__pods .mtg-pod')).not.toBeNull();
  });
});
