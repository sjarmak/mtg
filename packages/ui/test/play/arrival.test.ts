// @vitest-environment jsdom
/**
 * The opponent's play arrives instead of appearing.
 *
 * `mtg-81a` is the playtester's own ask, and it is a small one: "a little bit of
 * transition when things happen in the game from the opponent so it does not
 * just instantly appear." What ships is one CSS animation on one class of
 * object, and this file holds the four things that make it that rather than an
 * animation system.
 *
 * **What it is.** A permanent entering the far seat's battlefield fades up while
 * dropping into its slot, for `ARRIVAL_MS`.
 *
 * **What fires it.** An element entering the document, not a diff and not a
 * marking pass. So the half of this file that is not about the sheet is about
 * React's reconciliation, which is the mechanism: a permanent already on the
 * table has to keep its DOM node across every re-render, or a tap, a counter or
 * a combat mark would replay the arrival on a card that has been there for five
 * turns. jsdom is the right place to ask that — it is a question about which
 * nodes exist, not about how they look.
 *
 * **What it may not be.** It may not reach the hand (a bot game reveals the
 * opponent's hand, so that rule would animate seven cards a draw step), it may
 * not reach your own seat, and it may not animate anything that changes a layout
 * box — `styles/board/slot.ts` pairs `aspect-ratio` with `min-height: 0` to make
 * every board face one height, and an arrival that animated a length would
 * reintroduce the uneven-row bug that pair closes.
 *
 * **What a player who asked for less motion sees.** The card, in place, on the
 * first frame.
 *
 * jsdom runs no animation and lays nothing out, so what it cannot answer is
 * whether the movement reads, how long the browser actually runs it, and whether
 * the row is still one height while a card is in flight.
 * `packages/ui/tools/arrival-panel.ts` is that measurement.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Battlefield } from '../../src/board/Battlefield';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { ARRIVAL_MS, ARRIVAL_RISE_REM } from '../../src/styles/board/arrival';
import { BOARD_CSS } from '../../src/styles/board';

afterEach(cleanup);

/** What these tests need of a rendered node; the workspace tsconfig has no `lib: dom`. */
interface NodeLike {
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => { readonly length: number };
}

function asNode(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.querySelectorAll !== 'function'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as NodeLike;
}

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

function equipment(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'artifact');
  if (card === undefined) throw new Error('the DSL example set has no artifact');
  return card;
}

function permanent(key: string, card: DslCard = creature()): BoardPermanent {
  return { key, card };
}

/** The card element of the permanent with this key, or a failure naming it. */
function faceOf(root: NodeLike, key: string): NodeLike {
  const found = root.querySelector(`.mtg-slot[data-permanent-key='${key}'] > .mtg-card`);
  if (found === null) throw new Error(`nothing rendered for the permanent keyed ${key}`);
  return found;
}

/** The one rule in the shipped sheet whose selector list contains this selector. */
function rulesNaming(fragment: string): readonly string[] {
  return [...BOARD_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => (match[1] ?? '').includes(fragment))
    .map((match) => (match[2] ?? '').trim());
}

/**
 * Every `@supports not (anchor-scope: …)` block in the shipped sheet, body and
 * all.
 *
 * The closing brace is matched at the start of a line because the block holds
 * whole rules, whose own braces are indented — `styles/index.ts` emits the
 * sheet, so that shape is the sheet's rather than a guess about formatting.
 */
function supportsBlocks(): readonly string[] {
  return [...BOARD_CSS.matchAll(/@supports not \(anchor-scope:[^)]*\) \{([\s\S]*?)\n\}/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('the arrival sheet', () => {
  /**
   * The keyframes, read as a set of property names. This is the layout guard in
   * its cheapest form: `opacity` and `translate` are both outside layout, so a
   * card can travel without its slot, its row or the seat below it moving a
   * pixel. Any property added here that is a length is the uneven-row bug
   * coming back, so the assertion is an equality rather than a "does not
   * contain" list of the ones thought of today.
   */
  it('animates only properties that cannot move a layout box', () => {
    const frames = /@keyframes mtg-arrive \{([\s\S]*?)\n\}/.exec(BOARD_CSS);
    expect(frames, 'the sheet declares no mtg-arrive keyframes').not.toBeNull();
    const body = frames?.[1] ?? '';
    const properties = new Set(
      [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1] ?? '').filter((name) => name !== ''),
    );
    expect([...properties].sort()).toEqual(['opacity', 'translate']);
    expect(body).toContain(`translate: 0 -${String(ARRIVAL_RISE_REM)}rem`);
  });

  it('runs for the stated duration, and the sheet is where that number comes from', () => {
    const declared = rulesNaming('.mtg-slot > .mtg-card').filter((body) => body.includes('mtg-arrive'));
    expect(declared).toHaveLength(1);
    expect(declared[0]).toContain(`mtg-arrive ${String(ARRIVAL_MS)}ms`);
  });

  /**
   * Scope, stated as three facts about the selector rather than as one. The far
   * seat, because that is the whole ask; the battlefield body, because the hand
   * is revealed in a bot game and would animate every draw; and no fill mode,
   * because a filled animation's values sit in the animation origin and would
   * outrank `styles/board/slot.ts`'s hover rule for the rest of the card's life.
   */
  it('reaches the far battlefield and nothing else', () => {
    const selectors = [...BOARD_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => (match[2] ?? '').includes('mtg-arrive'))
      .map((match) => (match[1] ?? '').trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain("[data-seat='opponent']");
      expect(selector).toContain("[data-layout='board']");
      expect(selector).not.toContain("[data-seat='you']");
      expect(selector).not.toContain("[data-tone='rail']");
    }
  });

  /**
   * The corner marks arrive with the card and do not animate their way there,
   * which is `mtg-swr1` and is the opposite of what this test used to assert.
   *
   * `styles/board/slot.ts` anchors the row to the card's own art window, and an
   * anchor rectangle is the anchor's box *after* its transforms, so the row is
   * already carried by every pixel the card moves. The copy of the keyframes it
   * used to be given on top of that spent the rise twice and put the badges back
   * on the name — measured in a browser, at 1440x900, 1280x800 and 1024x768, by
   * `./arrival-marks.browser.test.ts`, which is the rig that can see a transient
   * at all. What is checkable here is the shape that follows from it: the row's
   * own animation moves nothing, and the travel survives only where the badges
   * are positioned against the slot instead and would otherwise hang in the
   * finished position while the card fell in under them.
   */
  it('fades the corner marks in place, since the card is already carrying them', () => {
    const inPlace = /@keyframes mtg-arrive-in-place \{([\s\S]*?)\n\}/.exec(BOARD_CSS);
    expect(inPlace, 'the sheet declares no travel-free arrival').not.toBeNull();
    const properties = new Set(
      [...(inPlace?.[1] ?? '').matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1] ?? ''),
    );
    expect([...properties]).toEqual(['opacity']);

    const onTheRow = rulesNaming('.mtg-slot__marks').filter((body) => body.includes('mtg-arrive'));
    expect(onTheRow, 'the row is given one animation per branch').toHaveLength(2);
    const travel = onTheRow.filter((body) => !body.includes('mtg-arrive-in-place'));
    expect(travel, 'exactly one branch still moves the row').toHaveLength(1);
    expect(travel[0]).toContain(`mtg-arrive ${String(ARRIVAL_MS)}ms`);

    // And that one is the fallback's, which is the whole claim: the row moves
    // only where nothing else is moving it.
    const fallback = supportsBlocks().filter((block) => block.includes('mtg-arrive'));
    expect(fallback, 'the arrival declares one anchorless branch').toHaveLength(1);
    expect(fallback[0]).toContain('.mtg-slot__marks');
    expect(fallback[0]).toContain(travel[0] ?? '');
  });

  /**
   * Off, not merely fast. `styles/base.ts` already clamps every animation on the
   * page to 1ms under this query, and 1ms of an animation that starts at
   * `opacity: 0` is one frame of blank card — a flash, which is the thing a
   * player asking for less motion is asking not to get. `animation: none` is
   * the card simply being there, which is exactly the behavior this lane found.
   */
  it('turns the motion off under prefers-reduced-motion rather than shortening it', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(BOARD_CSS);
    expect(reduced, 'the board sheet declares no reduced-motion block').not.toBeNull();
    const body = reduced?.[1] ?? '';
    expect(body).toContain("[data-seat='opponent']");
    expect(body).toContain('animation: none');
    expect(body).not.toContain('mtg-arrive ');
  });
});

/**
 * The trigger, which is not in the sheet: an element entering the document.
 *
 * These four assertions are the whole reason no marking pass was written. A
 * `data-arrived` attribute set for one render would be cleared by the next
 * unrelated re-render and cancel the animation halfway through; node identity
 * has no such window, because React only builds a new element when the key is
 * new or the element type under it changed.
 */
describe('what React replaces when the board changes', () => {
  it('keeps every permanent already on the table, so only the new one arrives', () => {
    const before = [permanent('p1'), permanent('p2')];
    const view = render(h(Battlefield, { label: 'Battlefield', permanents: before }));
    const root = asNode(view.container);
    const first = faceOf(root, 'p1');
    const second = faceOf(root, 'p2');

    view.rerender(h(Battlefield, { label: 'Battlefield', permanents: [...before, permanent('p3')] }));
    expect(faceOf(root, 'p1')).toBe(first);
    expect(faceOf(root, 'p2')).toBe(second);
    expect(root.querySelectorAll(".mtg-slot[data-permanent-key='p3']").length).toBe(1);
  });

  it('keeps a permanent through a tap, a counter and a combat mark', () => {
    const view = render(h(Battlefield, { label: 'Battlefield', permanents: [permanent('p1')] }));
    const root = asNode(view.container);
    const face = faceOf(root, 'p1');
    view.rerender(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [{ ...permanent('p1'), tapped: true, counters: 2, attacking: true, damage: 1 }],
      }),
    );
    expect(faceOf(root, 'p1')).toBe(face);
  });

  it('keeps a permanent when an unrelated one leaves', () => {
    const view = render(
      h(Battlefield, { label: 'Battlefield', permanents: [permanent('p1'), permanent('p2')] }),
    );
    const root = asNode(view.container);
    const first = faceOf(root, 'p1');
    view.rerender(h(Battlefield, { label: 'Battlefield', permanents: [permanent('p1')] }));
    expect(faceOf(root, 'p1')).toBe(first);
  });

  /**
   * The one false positive, asserted rather than glossed. Equipping moves the
   * host inside the `.mtg-attach` tray (`src/board/Battlefield.ts`,
   * `attachedGroup`), which is a different element type under the same key, so
   * React builds a new node and the creature arrives a second time. An opponent
   * equipping something is an opponent doing something, so the motion is not
   * claiming an event that did not happen; it names the wrong one.
   * Fixing it means grouping every permanent in a tray whether or not it holds
   * anything, which changes the row's markup for every card on the table to
   * remove one spurious 240ms — filed rather than taken.
   */
  it('does replace the host when an attachment groups with it, so the host arrives again', () => {
    const host = permanent('p1');
    const weapon: BoardPermanent = { key: 'p2', card: equipment() };
    const view = render(h(Battlefield, { label: 'Battlefield', permanents: [host, weapon] }));
    const root = asNode(view.container);
    const face = faceOf(root, 'p1');
    view.rerender(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [host, { ...weapon, attachedTo: host.card.name, attachedToKey: 'p1' }],
      }),
    );
    expect(faceOf(root, 'p1')).not.toBe(face);
  });
});
