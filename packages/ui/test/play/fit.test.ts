// @vitest-environment jsdom
/**
 * The play route is a screen, not a page.
 *
 * The build stacked the opponent's board, the stack, your board, the hand rail
 * and the command bar down the page with nothing bounded by the viewport, so at
 * ordinary window heights the last two fell below the fold. Every legal move is
 * a button in that command bar, which made it an interface that could not be
 * used without scrolling on every priority.
 *
 * Bounding it was not enough, and this file grew the second half for the reason
 * (`mtg-bc2.128`). Bounded, the column still had to be *paid* out of, and the
 * mat would not pay: `ZONE` floors a well at 4.5rem and a status line is as tall
 * as its life total, so under a budget the mat kept its height, the column
 * overflowed, and every pixel of the shortfall came out of the one sibling that
 * would yield — the command bar. Measured in chromium at 1280x800, the only
 * legal move's button had 0 of its 37 pixels inside the panel and
 * `elementFromPoint` at its center returned the shell. The table you could not
 * play on was the one that fit.
 *
 * What this file can and cannot say. jsdom performs no layout: it has no
 * viewport, computes no box, and will never tell anyone whether the table fits
 * in 800 pixels or how tall a card came out. What it does do is run the cascade,
 * and every part of the fix is a cascade fact — the route is bounded by the
 * viewport, no link in the chain between the shell and the mat is pinned open at
 * its content height, the mat is compressible so the bar never pays for it, the
 * bar is unshrinkable and floored and capped, the two seats take different
 * shares, each well scrolls inside itself, and the card silhouette is still
 * 63:88. Those are asserted here. The pixel outcome at a given window size is
 * not, and nothing below has the layout to claim it.
 *
 * **That much is no longer the whole story, and the next paragraph is
 * `mtg-bc2.130`'s.** A browser project exists now (`npx vitest run --project
 * browser`), and `./page-overlap.browser.test.ts` and
 * `./command-rail.browser.test.ts` measure real Chrome layout for this same
 * route. This file's own header used to say no test in this checkout could
 * claim a pixel outcome at all; that sentence was true when it was written and
 * is not any more, which is worth correcting here rather than leaving the next
 * reader to trust a claim nobody re-checked.
 *
 * **Four constants, verified in that browser project rather than argued about
 * (2026-08-16).** `COMMAND_BAR_SHARE`, one of the four `mtg-bc2.130` names, no
 * longer exists under that name in `packages/ui/src`, so it needs no gate.
 * `styles/board/fit.ts`'s `MIN_SLOT_REM` (5) and `styles/views.ts`'s
 * `COMMAND_ROW_FLOOR_REM` (5) are guarded, at the far end of their range rather
 * than at the bead's own literal values. Moved to the values the bead names
 * (`MIN_SLOT_REM` to 7, `COMMAND_ROW_FLOOR_REM` to 0.1), all 11 browser tests
 * stay green, because neither floor binds in this checkout at that value:
 * `MIN_SLOT_REM` is overridden to `min-height: 0` on the battlefield slot
 * (`styles/board/hand.ts:418`), and `COMMAND_ROW_FLOOR_REM`'s body is already
 * `flex: 1`-filled well past its floor at the shortest supported window. Moved
 * further (`MIN_SLOT_REM` to 16, `COMMAND_ROW_FLOOR_REM` to 26),
 * `./page-overlap.browser.test.ts` fails both times: a declare-blockers
 * position clips "Wandering Herald 1" 56.5px into `.mtg-combat__strip` at the
 * first, and clips a blocker row, "Ridgeline Guard 4", 5.8px into
 * `.mtg-panel.mtg-prompt` at the second. That is the property each floor
 * exists for — nothing on the table gets clipped — asserted by an existing,
 * already-committed check rather than a new one built for this bead.
 *
 * `styles/card.ts`'s `SMALL_FACE_MAX_REM` (7) and `styles/board/rail.ts`'s
 * `RAIL_BLOCK_MIN_REM` (3.25 — the bead's fourth constant in substance if not
 * in name, since `COMMAND_BAR_SHARE` is gone) are not guarded, and could not be
 * made to fail against any state this checkout can build. `SMALL_FACE_MAX_REM`
 * gates a container query that changes what a small face *draws* — it drops a
 * row of text rather than moving one, so the geometric instruments in this
 * suite (overlap, clip, hit-test, `scrollWidth`) have no opinion on it by
 * construction; verified at 0.1 and 40 across every fixture in
 * `./page-overlap.browser.test.ts` and `./command-rail.browser.test.ts`, all
 * green both directions. `RAIL_BLOCK_MIN_REM` floors a rail zone against the
 * flex-squeeze that used to let one zone's head paint over the zone below it;
 * `styles/board/rail.ts:222-225` pairs that floor with `overflow-y: auto` on
 * `.mtg-board__rail` in the same fix, and the scroll is what makes the squeeze
 * unreachable regardless of content — verified at 0.1 and 12 across the same
 * fixtures, and again at 0.1 against a scenario built for this check alone,
 * with 45 dead creatures in each graveyard: every rail zone still measured
 * exactly 52px, the floor itself, because a closed `ZoneBrowser`
 * (`../../src/board/ZoneBrowser.ts`) draws one line regardless of how many
 * cards it counts. A gate on either constant would have to assert what a face
 * draws or what a scroller could be scrolled to, which is a different subject
 * from what this file or the browser project measures; building one that
 * cannot fail against any reachable state would be worse than the gap it
 * claimed to close.
 *
 * Every assertion that can be is made twice: once on the play route and once on
 * the same markup under another mode. The rules are scoped, so the second render
 * is what says so — a rule that escaped onto a route with no board would fail
 * here rather than being noticed later on a tall page.
 *
 * **The control used to be the replay viewer, and `mtg-ryix` moved it.** These
 * rules are emitted under `styles/board/geometry.ts`'s `TABLE` now, which is the
 * play route *and* the replay viewer: the replay board is the same `Board` and it
 * was being drawn in ordinary document flow, 1038.7px tall at every viewport, so
 * a game you were watching was a page you scrolled. The control is the Cards tab,
 * which draws no table at all — it has to be a route these rules genuinely do not
 * reach, or the second render stops saying anything.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { EXAMPLE_CARDS, EXAMPLE_SET } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import {
  DEFAULT_AUTO_PASS,
  humanSeat,
  isCreatureObject,
  pendingDecision,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { CARD_TRIM_MM } from '../../src/card/anatomy';
import { Shell } from '../../src/app/Shell';
import { TABLE } from '../../src/styles/board/geometry';
import { PLAY_RAIL_REM } from '../../src/styles/board/rail';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { PlayView } from '../../src/routes/play/PlayView';
import { SealedGame } from '../../src/routes/play/SealedGame';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

/** And the button that gets a sealed build to the table it is drawn on. */
const PLAY_LABEL = 'Play this deck';

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  innerHTML: string;
  readonly parentElement: ElementLike | null;
  readonly matches: (selector: string) => boolean;
  readonly getAttribute: (name: string) => string | null;
  readonly closest: (selector: string) => ElementLike | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<ElementLike> & Iterable<ElementLike>;
  readonly appendChild: (child: ElementLike) => void;
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
 * workspace tsconfig has no `lib: dom`. `test/board.test.ts` and
 * `test/card.test.ts` each declare their own shape for the same reason; this one
 * needs the parent chain and a node list, which neither of those does.
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
 * The same table, drawn twice: once as the route it is, once under the mode the
 * replay viewer runs in. Nothing about the markup differs, so every difference
 * measured below belongs to the route scope and to nothing else.
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

/** How many creatures on the table are not the size their card prints. */
function alteredCount(state: GameState): number {
  return state.battlefield.filter((oid) => {
    const object = state.objects[oid];
    if (object === undefined || !isCreatureObject(state, oid)) return false;
    const card = object.card;
    if (card.kind !== 'creature') return false;
    return powerOf(state, oid) !== card.power || toughnessOf(state, oid) !== card.toughness;
  }).length;
}

/**
 * A position where `count` creatures are a different size from the one printed
 * on them, which is exactly `count` derived marks on the two battlefields.
 *
 * The counter is placed on the object rather than dealt by a spell because
 * `scenario` has no counters knob and driving a real `pumpUntilEndOfTurn`
 * through mana, a cast and a resolution would put four kernel steps between this
 * test and the layout question it asks. A +1/+1 counter is a state the kernel
 * reaches, and `powerOf` reads it the same way it reads a continuous effect.
 */
function sessionWithAltered(count: number): GameSession {
  const creatures = EXAMPLE_CARDS.filter((card) => card.kind === 'creature');
  const permanents = Array.from({ length: Math.max(count, 4) }, (_unused, index) => {
    const card = creatures[index % creatures.length];
    if (card === undefined) throw new Error('the example set has no creatures');
    return card;
  });
  const built = scenario({
    seed: 'test/fit/notes',
    battlefield: permanents.map((card, index) => ({
      card,
      controller: (index % 2) as PlayerId,
      summoningSick: false,
    })),
    hands: [EXAMPLE_CARDS.slice(0, 3), EXAMPLE_CARDS.slice(0, 3)],
    active: 0,
    turn: 4,
  });
  const objects = { ...built.state.objects };
  let placed = 0;
  for (const oid of built.state.battlefield) {
    if (placed >= count) break;
    const object = objects[oid];
    if (object === undefined || object.card.kind !== 'creature') continue;
    objects[oid] = { ...object, counters: { plusOnePlusOne: 2, minusOneMinusOne: 0 } };
    placed += 1;
  }
  const state: GameState = { ...built.state, objects };
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    // No choice has been recorded, so nothing has committed and nothing is
    // undoable. `@mtg/kernel`'s `undo.ts` carries what closes a boundary.
    beat: null,
    committed: null,
  };
}

/**
 * That position, painted on the play route, with the sheet attached.
 *
 * The auto-pass settings are handed in because the panel is only drawn for a
 * caller that owns them, and the rail-block assertions below count what is in
 * the rail. Without them the run measured three blocks while its own comment
 * named four.
 */
/**
 * WCAG 2.5.8's interactive target, which every board face is one of and no fit
 * rule may take a slot under. Doubling as the ceiling an *empty* place has to
 * stay below, because a marker for a place is not a target: it carries no
 * button, is `aria-hidden`, and the whole of `mtg-ej5` is that it used to be
 * bigger than the permanents.
 */
const MIN_SLOT_TARGET_PX = 24;

/**
 * A play slot with a permanent in it, which `paint()` cannot give: it deals a
 * fresh game, so every slot on both battlefields is an empty place.
 *
 * Repaints the document, so anything read off `paint()` has to be read before
 * this is called.
 */
function occupiedPlaySlot(): ElementLike {
  return one(paintAltered(0), ".mtg-slot[data-slot='play']:not([data-empty='true'])");
}

function paintAltered(count: number): ElementLike {
  const { document } = windowLike();
  const session = sessionWithAltered(count);
  if (alteredCount(session.state) !== count) {
    throw new Error('the fixture did not alter the sizes it was asked to');
  }
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = uiStyleSheet();
  document.head.appendChild(style);
  document.body.innerHTML = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const play = document.body.querySelector("[data-mtg-mode='play']");
  if (play === null) throw new Error('a shell did not render');
  return play;
}

function computed(element: ElementLike, property: string): string {
  return windowLike().getComputedStyle(element).getPropertyValue(property).trim();
}

/** The one element matching `selector` inside `root`, or a named failure. */
function one(root: ElementLike, selector: string): ElementLike {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`nothing under the shell matched ${selector}`);
  return found;
}

function all(root: ElementLike, selector: string): readonly ElementLike[] {
  const found = [...root.querySelectorAll(selector)];
  if (found.length === 0) throw new Error(`nothing under the shell matched ${selector}`);
  return found;
}

/** Every element from `from` up to and including `to`, innermost first. */
function chainUp(from: ElementLike, to: ElementLike): readonly ElementLike[] {
  const links: ElementLike[] = [];
  let cursor: ElementLike | null = from;
  while (cursor !== null) {
    links.push(cursor);
    if (cursor === to) return links;
    cursor = cursor.parentElement;
  }
  throw new Error('the two elements are not on one ancestor chain');
}

describe('the play route is bounded by the viewport', () => {
  it('gives the shell a viewport height, and gives no other route one', () => {
    const { play, control } = paint();
    expect(computed(play, 'height')).toMatch(/^100d?vh$/);
    expect(computed(control, 'height')).toBe('auto');
  });

  it('lets the content region scroll rather than growing the page', () => {
    const { play, control } = paint();
    const main = one(play, '.mtg-shell__main');
    expect(computed(main, 'overflow')).toBe('auto');
    expect(computed(main, 'display')).toBe('flex');
    expect(computed(main, 'flex-direction')).toBe('column');
    expect(computed(one(control, '.mtg-shell__main'), 'overflow')).not.toBe('auto');
  });

  /**
   * The one that catches the next regression rather than this one. A flex item's
   * automatic minimum size is its content, so a single link in the column that
   * does not say otherwise pins the whole thing open at the height of whatever
   * is inside it and the page grows again. Walked over the rendered ancestor
   * chain rather than over a list of class names, so an unclassed wrapper
   * introduced between the shell and the mat tomorrow fails here.
   */
  it('leaves no link between the shell and the mat pinned open at its contents', () => {
    const { play } = paint();
    const main = one(play, '.mtg-shell__main');
    const chain = chainUp(one(play, '.mtg-board'), main);
    expect(chain.length).toBeGreaterThan(4);
    const pinned = chain.filter((link) => computed(link, 'min-height') !== '0px');
    expect(pinned.map((link) => computed(link, 'min-height'))).toEqual([]);
  });
});

describe('what the mat does with the height it is given', () => {
  /**
   * Each lane names itself, and the two now take equal shares of the column.
   *
   * **The unequal share is gone, and `mtg-rgc.5` is why.** Your lane held two
   * card rows and the opponent's held one, so yours grew twice as fast and the
   * three rows came out about equal. The hand is off the height axis entirely
   * now (`../../src/styles/board/hand.ts` sizes it from the width of its row, so
   * its zone claims no share at all), which leaves one card row in each lane —
   * and the double share then drew your battlefield half again as tall as the
   * opponent's, measured at 1440x900 with four permanents a side as 117.8
   * against 81.3. Equal lanes measure 108.5 against 108.5.
   *
   * A `key` could not carry the seat name — it never reaches the DOM — and
   * first-child would encode the answer in where the divider happens to sit.
   */
  it('names each seat, and gives the two lanes equal shares of the column', () => {
    const { play, control } = paint();
    const seats = all(play, '.mtg-board__side').map((side) => side.getAttribute('data-seat'));
    expect(seats).toEqual(['opponent', 'you']);
    const share = (root: ElementLike, seat: string): number =>
      Number(computed(one(root, `.mtg-board__side[data-seat='${seat}']`), 'flex-grow'));
    expect(share(play, 'you')).toBe(share(play, 'opponent'));
    expect(share(play, 'opponent')).toBeGreaterThan(0);
    for (const side of all(control, '.mtg-board__side')) {
      expect(computed(side, 'flex-grow')).toBe('0');
    }
  });

  /**
   * The lanes' zone heads print counts the status line above them already
   * prints — "your battlefield 4" over `hand 7 library 27 graveyard 2` — and
   * three of those bands is about 48px of the column, a sixth of a card row.
   * The rail's zones keep theirs, because nothing else says how deep a
   * graveyard is, and the `aria-label` carries the name either way so nothing
   * leaves the accessible tree.
   */
  it('drops the lanes zone heads and keeps the rail ones', () => {
    const { play, control } = paint();
    for (const head of all(play, '.mtg-board__side .mtg-zone__head')) {
      expect(computed(head, 'display')).toBe('none');
    }
    for (const zone of all(play, '.mtg-board__side .mtg-zone')) {
      expect(zone.getAttribute('aria-label')).not.toBeNull();
    }
    // What is left in the rail is the log, and its head is a `.mtg-browser__head`
    // rather than a `.mtg-zone__head` — it carries the disclosure and the density
    // buttons, so it was never the plain zone head this rule drops on the lanes.
    // Named as the head the remaining block actually draws, because a selector
    // that now matches nothing would pass this loop without asserting anything.
    const heads = all(play, '.mtg-board__rail .mtg-browser__head');
    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) {
      expect(computed(head, 'display')).not.toBe('none');
    }
    for (const head of all(control, '.mtg-board__side .mtg-zone__head')) {
      expect(computed(head, 'display')).not.toBe('none');
    }
  });

  /**
   * The one that names the bug rather than the fix. `ZONE` floors a well at
   * 4.5rem and `.mtg-status` is as tall as its life total; under a height budget
   * those floors made the mat incompressible, the column overflowed, and the
   * shrink landed on the command bar instead. On this route a well's floor is
   * zero and the well scrolls, which is the same bargain the hand rail already
   * made on the horizontal axis.
   *
   * The lanes, not every zone under `.mtg-board`. The rail's own blocks are
   * floored on purpose and "the rail pays its own way" below says why: they were
   * being squeezed under their own head and painting over each other. The rail
   * scrolls at that point rather than pushing the mat, so the mat is still what
   * gives.
   */
  it('lifts every floor on the mat lanes, so the mat pays for the budget and not the bar', () => {
    const { play, control } = paint();
    for (const zone of all(play, '.mtg-board__lanes .mtg-zone')) {
      expect(computed(zone, 'min-height')).toBe('0px');
    }
    // The status line was the other incompressible thing on this column, and
    // `mtg-rgc.1` took it off the column rather than shrinking it: the vitals
    // are a pod in a fixed column of their own now, so the lanes hold nothing
    // but wells. The pod's own floor is asserted in `./seat-pod.test.ts`.
    expect(play.querySelector('.mtg-board__lanes .mtg-status')).toBeNull();
    expect(play.querySelector('.mtg-board__lanes .mtg-pod')).toBeNull();
    for (const zone of all(control, '.mtg-board .mtg-zone')) {
      expect(computed(zone, 'min-height')).not.toBe('0px');
    }
  });

  it('gives the opponent battlefield the whole lane after removing its duplicate hand rail', () => {
    const { play, control } = paint();
    const opponent = one(play, ".mtg-board__side[data-seat='opponent']");
    expect(computed(opponent, 'display')).toBe('flex');
    expect(computed(opponent, 'grid-template-columns')).toBe('none');
    expect(opponent.querySelector(".mtg-zone[data-tone='rail']")).toBeNull();
    expect(computed(one(control, ".mtg-board__side[data-seat='opponent']"), 'display')).toBe('flex');
  });

  it('scrolls each well inside itself rather than growing it', () => {
    const { play, control } = paint();
    for (const body of all(play, '.mtg-zone__body')) {
      expect(computed(body, 'overflow')).toBe('auto');
      expect(computed(body, 'min-height')).toBe('0px');
    }
    for (const body of all(control, '.mtg-zone__body')) {
      expect(computed(body, 'overflow')).not.toBe('auto');
    }
  });

  /**
   * ADR-0002 pins the silhouette, not the size. The slot stops carrying a fixed
   * height so the budget can decide how big a card on the table is, and the
   * ratio it is drawn at has to come out of the same trim the printed face uses
   * or the two renderers have quietly disagreed about what a card is.
   *
   * Both slots are card-shaped while something is in them, and the battlefield's
   * goes square while a permanent in it is tapped: the width a rotated card
   * needs is reserved by the slot again, which `mtg-yi5` is (`../../src/styles/
   * board/slot.ts` carries the measurement, and `../board.test.ts` holds the
   * tapped half of the bargain). An *empty* slot is neither — it is a marker at
   * a stated size, so every selector here says which kind it means.
   */
  it('sizes a slot from the well while keeping the printed trim exactly', () => {
    const ratio = `${String(CARD_TRIM_MM.width)} / ${String(CARD_TRIM_MM.height)}`;
    const { play, control } = paint();
    const held = one(play, ".mtg-slot[data-slot='hand']:not([data-empty='true'])");
    expect(computed(held, 'aspect-ratio'), 'hand keeps the printed trim').toBe(ratio);
    expect(computed(held, 'height'), 'hand takes its height from the well').toBe('auto');
    expect(computed(one(play, '.mtg-slot > .mtg-card'), 'aspect-ratio')).toBe(ratio);
    expect(computed(one(control, ".mtg-slot[data-slot='hand']"), 'aspect-ratio')).toBe('auto');
    // A fresh game has an empty battlefield, so the occupied play slot has to be
    // painted from a stated position. Asserting the shape off an empty one is
    // what this test used to do, and an empty slot is a marker now.
    const permanent = occupiedPlaySlot();
    expect(computed(permanent, 'aspect-ratio'), 'play keeps the printed trim').toBe(ratio);
    // A permanent takes a bounded share of the row rather than all of it. The
    // width is at least the visible hand face and may grow beyond it, because
    // battlefield and combat state outrank held options during play. Leaving
    // height to the trim makes the slot the size of the face inside it and keeps
    // the corner marks on the card. `mtg-d6s` moved it to that axis; a share of
    // the *well* is a share of whatever height the lane was left, which is why
    // the two seats used to disagree about a card's size.
    expect(computed(permanent, 'height'), 'play states a height of its own').toBe('auto');
    expect(computed(permanent, 'width'), 'play takes no share of its row').toContain('--board-face');
  });

  it('draws no place on the battlefield that has nothing in it', () => {
    // `mtg-ej5` shrank an empty slot from a card-sized dashed rectangle to a
    // small marker. the playtester, 2026-08-14, took the rest: "not sure why there
    // are dashed line card boxes on the battlefield, no reason for them".
    //
    // The rail keeps its markers, and only the rail, because it is the one
    // surface where the *number of places* is a fact of the game — the kernel's
    // own opening hand size. A battlefield has no such number, so the four it
    // padded itself out to were a design choice about how still the lane sat,
    // and measured in chrome-headless-shell 151 at four viewports before they
    // were removed, they held no box on the mat up. `hand-scale.test.ts` holds
    // the marker's own geometry, on a position that actually has a short hand.
    const { play } = paint();
    expect([...play.querySelectorAll(".mtg-slot[data-slot='play'][data-empty='true']")]).toHaveLength(0);
    // And the rule that would draw one is narrowed to the hand rather than left
    // in the sheet waiting for a caller: a battlefield slot that somehow carried
    // the mark would otherwise still be painted as a dashed box.
    expect(uiStyleSheet()).toContain(".mtg-slot[data-slot='hand'][data-empty='true'] {");
    expect(uiStyleSheet()).not.toContain(".mtg-slot[data-slot][data-empty='true'] {");
  });

  /**
   * A permanent remains readable when the row is crowded. The spell row owns
   * horizontal scrolling, so its occupied slots keep their chosen width rather
   * than shrinking into illegible slivers.
   * `docs/research/prior-art-board-layout.md` finds this in three of the four
   * MTG clients — Forge binary-searches card width in [50, 300]px, XMage walks
   * down in 10px steps, Cockatrice divides the viewport by a fixed scene — and
   * finds a constant with a floor only in ours.
   *
   * The floor is WCAG 2.5.8's: every board face is a button, and no fit rule
   * may take an interactive target under 24 x 24 CSS px.
   */
  it('keeps crowded cards readable and lets their row scroll', () => {
    const { play, control } = paint();
    // The face is width-driven and the occupied slot does not yield that width.
    expect(computed(one(play, '.mtg-slot > .mtg-card'), 'width')).toBe('100%');
    expect(computed(one(control, ".mtg-slot[data-slot='hand']"), 'flex-shrink')).toBe('0');
    const slot = occupiedPlaySlot();
    expect(computed(slot, 'flex-shrink'), 'a crowded row still shrinks its slots').toBe('0');
    expect(computed(slot, 'flex-grow'), 'and never stretches one past the trim').toBe('0');
    const floor = Number(computed(slot, 'min-width').replace('px', ''));
    expect(floor).toBeGreaterThanOrEqual(MIN_SLOT_TARGET_PX);
  });
});

describe('the move list is on the width axis', () => {
  /**
   * The change `mtg-bc2.137` is, asserted as the three cascade facts that make
   * it true rather than as a pixel outcome jsdom cannot see.
   *
   * The list is the only thing on this surface whose size depends on the game
   * state: a priority offers eight options and a declare-blockers prompt can
   * offer five hundred. Under the hand it was taking a varying share of the one
   * axis the cards are measured on, and `mtg-bc2.129`'s verifier measured what
   * that did over a 238-step game — an art window of 8.55px at a 31-option
   * decision. In the rail it takes width the mat was not using, and the
   * overflow scrolls inside the panel.
   */
  it('draws the move list inside the pod column, not under the mat', () => {
    const { play } = paint();
    const prompt = one(play, '.mtg-prompt');
    // In the pod column since `mtg-rgc.4`, between the two seats, and not in the
    // side rail it spent `mtg-bc2.137` in. Both are the width axis; which of the
    // two is the split this bead makes, and it is asserted from both ends so a
    // lane that put it back gets a named failure rather than a layout surprise.
    const pods = prompt.closest('.mtg-board__pods');
    if (pods === null) throw new Error('the move list is not in the pod column');
    expect(play.querySelector('.mtg-board__rail .mtg-prompt')).toBeNull();
    // The pod column is the mat's first grid track, so the list costs width.
    const board = one(play, '.mtg-board');
    expect(computed(board, 'display')).toBe('grid');
    expect(computed(board, 'grid-template-columns')).toMatch(/minmax\(0, 1fr\)\s+var\(--rail-w\)/);
    // And nothing under the mat competes with it for height any more.
    const table = one(play, '.mtg-play__table');
    expect([...table.querySelectorAll('.mtg-prompt')].length).toBe(1);
    expect(table.querySelector('.mtg-board .mtg-prompt')).not.toBeNull();
  });

  /**
   * The two pods stay at the two ends of that column and the ask takes the span
   * between them, which is the arrangement `references/068-1083771671.png` shows
   * and the span `mtg-rgc.1` reported leaving empty. Document order, because
   * jsdom paints nothing; the browser measurement is in
   * `src/styles/board/rail.ts`.
   */
  it('puts the ask between the two seats rather than above or below them', () => {
    const { play } = paint();
    const column = [...one(play, '.mtg-board__pods').querySelectorAll('.mtg-pod, .mtg-prompt')];
    expect(column.map((node) => (node.matches('.mtg-pod') ? node.getAttribute('data-seat') : 'ask'))).toEqual(
      ['opponent', 'ask', 'you'],
    );
  });

  /**
   * The two rules that keep a growing list inside its rail. Without the first
   * the list pushes the stack and the graveyards out of the rail and the mat
   * with them; without the second it can be squeezed to nothing, which is the
   * state `mtg-bc2.128` found at 1280x800 where the only legal move's button
   * had 0 of its 37 pixels inside the panel.
   */
  it('scrolls its moves inside itself, and floors its body at one whole option row', () => {
    const { play } = paint();
    const prompt = one(play, '.mtg-prompt');
    // Floored at a head and a row, which is the floor every rail block already
    // has: it shares a column with two pods now rather than with four blocks
    // that could all be squeezed, and a prompt shrunk under its own head is the
    // state `mtg-bc2.128` found at 1280x800.
    expect(computed(prompt, 'min-height')).not.toBe('0px');
    expect(computed(prompt, 'min-height')).not.toBe('auto');
    expect(computed(prompt, 'flex-grow'), 'the ask takes the span the pods do not need').toBe('1');
    expect(computed(prompt, 'overflow'), 'and clips rather than painting over a pod').toBe('hidden');
    const body = one(prompt, '.mtg-panel__body');
    expect(computed(body, 'overflow-y')).toBe('auto');
    const floor = computed(body, 'min-height');
    expect(floor).not.toBe('0px');
    expect(floor).not.toBe('auto');
    // The pods give way to nothing: they are the one block on the table whose
    // size has nothing to do with the game state.
    for (const pod of all(play, '.mtg-board__pods > .mtg-pod')) {
      expect(computed(pod, 'flex-grow')).toBe('0');
    }
    // And the rail's zones still give way to the log rather than the other way round.
    for (const zone of all(play, '.mtg-board__rail > .mtg-zone')) {
      expect(computed(zone, 'flex-grow')).toBe('0');
      expect(computed(zone, 'max-height')).not.toBe('none');
    }
  });

  /**
   * Checked here rather than against a second render: `.mtg-prompt` is the play
   * surface's own class and no other route draws one, so the rule needs no route
   * scope and a control render would only be measuring the same rules twice.
   */
  it('belongs to this surface alone, so its rules need no route scope', () => {
    expect(uiStyleSheet()).toContain('.mtg-prompt {');
    expect(/\[data-mtg-mode='[a-z]+'\] \.mtg-prompt\b/.test(uiStyleSheet())).toBe(false);
  });
});

describe('nothing shares the height axis with the mat', () => {
  /**
   * The finding this describe block exists for, and the reason it is written as
   * "nothing" rather than "the notes are in the rail". The move list moved to
   * the width axis and the altered-size notes did not: `.mtg-play__notes` stayed
   * `flex: none` under `.mtg-play`, a sibling of the table, and it drew one line
   * per creature whose current size was not its printed size with no cap on the
   * count. Measured in chromium at 1280x800 with six permanents a side, a
   * battlefield face went 117x164 at no notes and 65x91 at twelve. The panel is
   * gone entirely now. A game with no dealer-owned control holds only the
   * table; routine turn metadata lives in the collapsible ask column.
   *
   * A test naming the notes would pass again the next time a block is added
   * beside the table. This one counts what is on that column: the strip and the
   * table, and nothing else. jsdom lays nothing out, so it cannot see the pixel
   * consequence; what it can see is that no third child exists to have one.
   */
  it('leaves the table alone on its column, whatever the game state is', () => {
    for (const count of [0, 3, 12]) {
      const play = paintAltered(count);
      const column = one(play, '.mtg-play');
      const children = [...column.querySelectorAll(':scope > *')];
      expect(children.map((child) => child.getAttribute('class'))).toEqual(['mtg-play__table']);
    }
  });

  /**
   * The sizes panel is gone, and this is the assertion that it does not come
   * back. It listed one sentence per altered creature in the rail, and it was
   * written when the rail was the only place the derived pair appeared. It is
   * not any more: the face draws the current pair and the corner carries the
   * printed one struck through, named and in the accessibility tree. the playtester,
   * 2026-08-13, after playing the lab: "no need to have the 'sizes' on the right
   * hand side that's already clear from the board".
   */
  it('says a size is not the printed one on the card, not in a rail panel', () => {
    const play = paintAltered(3);
    expect(play.querySelector('.mtg-notes')).toBeNull();
    expect(play.querySelector('.mtg-play__notes')).toBeNull();
    expect([...play.querySelectorAll(".mtg-mark[data-mark='derived']")].length).toBe(3);
  });

  it('leaves no rules behind for a panel nothing draws', () => {
    expect(uiStyleSheet()).not.toContain('.mtg-notes');
  });
});

describe('the rail pays its own way', () => {
  /**
   * The second finding, which is what the first fix's cost turned into. With the
   * list in the rail and every block floored at nothing, a 296-option
   * declare-blockers prompt squeezed the stack and both graveyards to a
   * `clientHeight` of 9 against 44px of content; `.mtg-zone` declared no
   * overflow, so their heads painted over the block beneath them, and
   * `overflow: hidden` on the rail cut the tail off. Measured at 1280x800: 8
   * pairs of text drawn over one another, 5 labels drawn outside the rail.
   *
   * Three cascade facts carry the fix and all three are here, because dropping
   * any one of them puts the ink back: floored, self-clipping, and a rail that
   * scrolls rather than hides.
   *
   * `mtg-rgc.7` emptied the column the finding was about — the stack went to the
   * seam and both graveyards went under their own pods — and kept the three
   * rules, because what they guard against is a variable-length thing taking its
   * cost out of a fitted column's own text, and the ask column now holds three
   * variable-length things. So the rules are asserted here on the one block left
   * in the rail and in `./ask-column.browser.test.ts` on the column they moved
   * to.
   */
  it('floors the block left in the rail and makes it clip its own content', () => {
    const play = paintAltered(12);
    // One selector and, since `mtg-rgc.7`, one match: the log. The auto-pass
    // controls used to need a second (`.mtg-stops`) and have moved into the turn
    // and phase indicator in the toolbar; the stack and the two graveyards left
    // in the other direction. The count is asserted rather than the class,
    // because a fourth block arriving here is the thing that would put the
    // finding back, and it would arrive under a selector this one already
    // matches.
    const blocks = all(play, '.mtg-board__rail > .mtg-zone');
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.getAttribute('class')).toContain('mtg-log');
    for (const block of blocks) {
      expect(computed(block, 'min-height'), 'a rail block can be shrunk to nothing').not.toBe('0px');
      expect(computed(block, 'overflow'), 'a rail block paints outside itself').toBe('hidden');
      expect(computed(block, 'max-height'), 'a rail block can push the others out').not.toBe('none');
    }
  });

  it('scrolls the rail rather than hiding what will not fit in it', () => {
    const { control } = paint();
    const play = paintAltered(12);
    expect(computed(one(play, '.mtg-board__rail'), 'overflow-y')).toBe('auto');
    expect(computed(one(control, '.mtg-board__rail'), 'overflow-y')).not.toBe('auto');
  });

  /**
   * The hover zoom is anchored to the bottom-right of the viewport, and this
   * commit put the move list in that corner: the panel covered 239 x 341px of
   * the rail and five choice buttons at 1280x800. It is `pointer-events: none`,
   * so the cost was visual, and it was the action surface it was covering.
   *
   * Asserted as the coupling rather than as a number, which is the part that can
   * rot: the offset has to carry the rail's own width, so widening the rail
   * without moving the zoom fails here rather than on a screenshot nobody takes.
   *
   * Since `mtg-crw` the coupling is a custom property rather than two copies of
   * one constant, because the rail's width is now a *state* — the column
   * collapses to a strip — and a zoom that cleared a column that had shut would
   * hang over the board with nothing under it. So the assertion is that both the
   * third grid track and the zoom's clearance name the same property, and that
   * something declares it: three readers of one value, not three copies.
   */
  it('anchors the hover zoom clear of the rail, from the rail own width', () => {
    const sheet = uiStyleSheet();
    // Three tracks since `mtg-rgc.1`: the ask column, the lanes, then the rail.
    // The first one is a clamp since `mtg-rgc.4` — it carries the move list now
    // and bends with the mat — and the rail is still the one the zoom has to
    // clear, so this reads the third.
    // The scope is the sheet's own `TABLE` since `mtg-ryix` rather than a literal
    // route, for the reason `../theme.test.ts` had to learn to split a selector
    // list on its own commas: what the mat is scoped to is stated in one place.
    const prefix = TABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mat = new RegExp(
      `${prefix} \\.mtg-board \\{[^}]*grid-template-columns:\\s*var\\(--ask-w\\)\\s*minmax\\(0, 1fr\\)\\s*var\\((--[a-z-]+)\\)`,
    );
    const railVar = mat.exec(sheet)?.[1];
    expect(railVar, 'the played mat no longer states a rail width').toBeDefined();
    const zoomOffset = /\.mtg-zoom \{\s*inset-inline-end: calc\(var\((--[a-z-]+)\) \+ [^)]+\)/.exec(
      sheet,
    )?.[1];
    expect(zoomOffset, 'the play route does not move the zoom off the rail').toBeDefined();
    expect(zoomOffset).toBe(railVar);
    // And the property is declared at the open width, so the value the two of
    // them read is a number and not a missing one.
    expect(sheet).toContain(`${String(railVar)}: ${String(PLAY_RAIL_REM)}rem;`);
  });
});

describe('setup controls stay off the played table', () => {
  /**
   * Whatever dealt the game brings its own controls, and they used to be a
   * second row above the table — a whole card's height on a screen that has to
   * hold two boards, two hands and every legal move at once. They join the strip
   * the table already draws instead.
   */
  it('removes the deckbuilding control when the table opens', () => {
    // Through `SealedGame` and a real click rather than by handing `LiveGame` a
    // toolbar of this test's own making. The first version of this test passed a
    // bare button, which is a shape no caller uses: the shipped caller wrapped
    // its button in a `.mtg-toolbar` of its own, `PlayView` put that inside the
    // strip it draws, and the table this test says has one strip had two.
    const { container } = render(h(SealedGame, { set: EXAMPLE_SET, seed: 'test/fit/strip' }));
    fireEvent.click(within(container).getByRole('button', { name: PLAY_LABEL }));
    // Through the structural shape declared above rather than through `Element`,
    // which the workspace tsconfig cannot name; `windowLike` says why.
    expect(within(container).queryByRole('button', { name: /Back to deckbuilding/u })).toBeNull();
    const root = container as unknown as ElementLike;
    // And with the control gone the strip goes with it, because `mtg-rgc.13`
    // left nothing else on it: the turn text this used to assert on in game
    // details now rides at the left-hand end of the bar under the battlefield,
    // so a sealed game at play time spends no row above the table at all.
    expect(root.querySelector('.mtg-toolbar'), 'an empty strip is still a row').toBeNull();
    expect(root.querySelector('.mtg-phasebar .mtg-turnstops__head')).not.toBeNull();
  });
});

describe('a face drawn smaller than it was designed for', () => {
  /**
   * A slot's face is whatever height the budget left, and below the width a
   * compact face was specified at, its three bars' own minimums add up to more
   * than the box: measured in chromium at 1280x800, the name, the type line and
   * the P/T printed on top of one another. The face asks its own container and
   * drops a type step rather than overflowing.
   *
   * Asserted as a declaration and not as an effect: jsdom evaluates no container
   * query, so `getComputedStyle` under this environment reports the unqueried
   * value however the rule is written. What a reverted rule loses here is the
   * text; what it loses in a browser is a legible hand, and that measurement is
   * in the commit message.
   */
  it('declares the smaller step against the face own container', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toContain('container-type: inline-size');
    // The block holding the bar rules, found by what is in it: there is more
    // than one container query on this sheet now, and the one that comes first
    // is the pending label's.
    const queries = [...sheet.matchAll(/@container \(max-width: [\d.]+rem\) \{([\s\S]*?)\n\}/g)];
    const query = queries.find(([, body]) => (body ?? '').includes('.mtg-card__bar'));
    expect(query, 'no container query carries the small face rules').toBeDefined();
    const rules = query?.[1] ?? '';
    // The bar's floor is the thing that overflowed, and the type line is what
    // spilled into the bar beneath it.
    expect(rules).toContain('.mtg-card__bar');
    expect(rules).toMatch(/\.mtg-card__bar \{[^}]*min-height: 0;/);
    // The type line's ellipsis is no longer this query's own rule: it holds at
    // every size now, because the full face needs the same one line to keep its
    // rules box a constant box (`../../src/card/anatomy.ts`, `typeFitStepOf`).
    // Asserted on the unqueried rule, which is what the small face inherits.
    expect(sheet).toMatch(/\.mtg-card__type \{[^}]*text-overflow: ellipsis;/);
  });

  /**
   * The pending frame's label stops being drawn before it reaches the corner
   * cost. Both stop scaling at their `clamp` floors, so under a certain face the
   * pips stay 8.8px tall while the window keeps shrinking and the label, which
   * is centered in the window rather than pinned to its foot, rises into them.
   * Measured in chromium over a row of identical permanents: clear at a face
   * 86.0px wide, 9 overlapping ink pairs at 75.5px, and the same break at the
   * same width at 1440x900 (clear at 83.2px, 11 pairs at 74.9px). Both viewports
   * break at a face *width*, which is why the rule is a container query.
   *
   * Asserted as a declaration for the reason above: jsdom evaluates no container
   * query. What is checkable and worth checking is that it is scoped to the
   * board face, so the gallery face and the hover zoom keep their label, and
   * that it hides the label rather than the whole pending frame, which would
   * take the hatch with it and leave a card that looked like it had art.
   */
  it('drops the pending label on a face too narrow to clear its corner cost', () => {
    const sheet = uiStyleSheet();
    const blocks = [...sheet.matchAll(/@container \(max-width: ([\d.]+)rem\) \{([\s\S]*?)\n\}/g)];
    const hiding = blocks.filter(([, , body]) => (body ?? '').includes('.mtg-art__pending-label'));
    expect(hiding.length, 'nothing hides the pending label at any width').toBe(1);
    const [, threshold, body] = hiding[0] ?? [];
    expect(Number(threshold)).toBeGreaterThan(0);
    expect(body).toMatch(/\.mtg-card\[data-size='board'\] \.mtg-art__pending-label \{ display: none; \}/);
    // The hatch stays: the window still says the art is pending, without words.
    expect(body).not.toContain(".mtg-art[data-art-state='pending']");
    expect(body).not.toMatch(/\.mtg-art \{/);
  });
});
