// @vitest-environment jsdom
/**
 * The stack, as an object list a player reads rather than a fact they infer.
 *
 * `mtg-bz2.4`'s first half. The zone existed before this bead and drew the right
 * picture for a sighted player by the wrong means: the entries were handed over
 * bottom-first and `column-reverse` flipped them, so a screen reader read the
 * stack in the order it does *not* resolve in. Order is in the markup now, and
 * the two assertions that pin it are that the first entry in the document is the
 * one marked as the top, and that each entry says where it sits in the
 * resolution order.
 *
 * ## Measured in a browser, because jsdom lays nothing out
 *
 * "The top entry is drawn first" is a claim about paint, and no test in this file
 * can make it: jsdom has no layout, so a sheet that reversed the row would leave
 * every assertion here green. `../../tools/priority-stack.ts` writes the real
 * page and `window.mtgPriorityStack()` reads it; driven in chrome-headless-shell
 * 151.0.7922.47 over CDP at three viewports, on a position with two objects on
 * the stack, it read the stack as the rail's first block at 96.8px at every
 * width with its two entries at 142.8 and 222.5.
 *
 * **That column is gone.** `mtg-rgc.7` moved the stack out of the rail and onto
 * the seam between the two seats, where it is a row rather than a column and is
 * drawn over the mat rather than in a block. Where it sits, what it may cover
 * and what it costs the board are `./stack-seam.browser.test.ts`'s, measured
 * over the three viewports and both crowdings; what is left here is the markup
 * that sheet is applied to.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { GameSession, GameState } from '@mtg/kernel';
import { humanSeat, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { RESOLVES_NEXT, STACK_NOTE, StackZone, WAITING } from '../../src/board/StackZone';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

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

const GOLEM: Card = parseCard({
  kind: 'creature',
  id: 'xmp-ironclad-golem',
  name: 'Ironclad Golem',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 101 },
  manaCost: { generic: 3 },
  power: 3,
  toughness: 3,
});

/**
 * The board with `pushes` spells cast onto the stack by the viewer.
 *
 * Cast through `reduce` rather than stated, for `scenario`'s own reason: a
 * fabricated stack is a position the kernel could not have reached, and the
 * whole point here is that the surface draws what the kernel actually holds.
 */
function stackedState(pushes: number): GameState {
  let state = scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: GOLEM, controller: 1 },
    ],
    hands: [[BOLT, BOLT], []],
  }).state;
  for (let pushed = 0; pushed < pushes; pushed += 1) {
    const cast = legalActions(state).find((action) => action.type === 'castSpell');
    if (cast === undefined) throw new Error('the fixture ran out of castable spells');
    state = reduce(state, cast).state;
  }
  return state;
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

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** The package has no `lib: dom`, so an attribute is reached through a shape. */
interface ElementLike {
  getAttribute(name: string): string | null;
}

describe('the stack zone', () => {
  it('lists the object that resolves next first, and numbers the rest', () => {
    render(
      h(StackZone, {
        entries: [
          { key: 'bottom', card: BOLT, controller: 'You' },
          { key: 'top', card: GOLEM, controller: 'Bot' },
        ],
      }),
    );
    const zone = screen.getByLabelText('Stack');
    const items = within(zone).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // `entries[0]` is the bottom of the stack, matching the kernel's array, and
    // the component reverses it: the first row is the one that resolves next.
    expect(textOf(items[0])).toContain(GOLEM.name);
    expect(textOf(items[0])).toContain('1.');
    expect(textOf(items[0])).toContain(RESOLVES_NEXT);
    expect(textOf(items[1])).toContain(BOLT.name);
    expect(textOf(items[1])).toContain('2.');
    expect(textOf(items[1])).toContain(WAITING);
  });

  it('carries the rule it enforces as its description, not as printed chrome', () => {
    // The words moved off the face when the block became a 32px strip: a
    // standing rule would have taken about a third of the row from the objects
    // it is drawing. They are still said, as the group's description, which is
    // what a `title` beside an `aria-label` becomes.
    render(h(StackZone, { entries: [{ key: 'a', card: BOLT, controller: 'You' }] }));
    const strip = screen.getByLabelText('Stack') as unknown as ElementLike;
    expect(strip.getAttribute('title')).toBe(STACK_NOTE);
    expect(textOf(strip)).not.toContain(STACK_NOTE);
  });

  it('draws nothing at all when the stack is empty', () => {
    // The whole of `mtg-rgc.7`'s first lever. An empty stack is the state of the
    // table at nearly every decision in a game, and this used to be a floored
    // rail block that spent 52px saying "stack is empty". Over the board there
    // is nothing worth saying: the board says it by having no strip on it.
    const { container } = render(h(StackZone, { entries: [] }));
    expect(screen.queryByLabelText('Stack')).toBeNull();
    expect((container as unknown as { readonly childElementCount: number }).childElementCount).toBe(0);
  });

  it('names an ability on the stack as one, since it has no cost of its own', () => {
    render(h(StackZone, { entries: [{ key: 'ab', card: GOLEM, controller: 'You', ability: true }] }));
    const row = within(screen.getByLabelText('Stack')).getAllByRole('listitem')[0];
    expect(textOf(row)).toContain('ability');
  });
});

describe('the stack on the played table', () => {
  it('holds a cast spell instead of resolving it, and says whose it is', () => {
    render(
      h(PlayView, {
        session: sessionAt(stackedState(1)),
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const zone = screen.getByLabelText('Stack');
    const rows = within(zone).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0])).toContain(BOLT.name);
    expect(textOf(rows[0])).toContain(NAMES[0]);
    expect(textOf(rows[0])).toContain(RESOLVES_NEXT);
  });

  it('grows with a second cast, and the newest object is the one on top', () => {
    render(
      h(PlayView, {
        session: sessionAt(stackedState(2)),
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const rows = within(screen.getByLabelText('Stack')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0])).toContain(RESOLVES_NEXT);
    expect(textOf(rows[1])).toContain(WAITING);
  });

  it('is on the seam between the seats, and the rail is the log alone', () => {
    // Document order only. Where the strip is *painted* and what it may cover
    // are `./stack-seam.browser.test.ts`'s, measured; what is asserted here is
    // the markup that sheet is applied to, because the placement rule is
    // `.mtg-board__divider[data-combat='false'] .mtg-stack-seam` and a strip
    // that left the divider would be positioned against the wrong element while
    // every browser assertion about free space still passed.
    const markup = renderToStaticMarkup(
      h(PlayView, {
        session: sessionAt(stackedState(1)),
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const lanes = markup.indexOf('mtg-board__lanes');
    const divider = markup.indexOf('mtg-board__divider', lanes);
    const stack = markup.indexOf('aria-label="Stack"', lanes);
    const rail = markup.indexOf('mtg-board__rail');
    expect(lanes).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(divider);
    // The rail is the last of the three columns in the markup, so anything at a
    // lower index than it is not in it, and the stack is.
    expect(rail).toBeGreaterThan(stack);
    // What is left in that column: the disclosure and the log, and neither the
    // move list (`mtg-rgc.4`) nor a graveyard (`mtg-rgc.7`).
    expect(markup.indexOf('mtg-log', rail)).toBeGreaterThan(-1);
    expect(markup.indexOf('mtg-prompt', rail)).toBe(-1);
    // The zone-browser root, spelled as the whole class list: the log reuses
    // `.mtg-browser__head` and would answer a looser search for it.
    const browser = 'class="mtg-zone mtg-browser"';
    expect(markup.indexOf(browser)).toBeGreaterThan(-1);
    expect(markup.indexOf(browser, rail)).toBe(-1);
  });

  it('draws its row in the order it was given, so the paint cannot flip it', () => {
    // The defect `mtg-bz2.4` fixed, stated as the declaration that would bring
    // it back. A reversed axis puts the top of the stack at the trailing edge
    // while the document reads it first. Both spellings are refused, because the
    // strip changed axis in `mtg-rgc.7` and the one that is no longer used is
    // the one nobody would notice returning.
    const sheet = uiStyleSheet();
    expect(sheet).toMatch(/\.mtg-stack \{[^}]*flex-direction: row;/);
    expect(sheet).not.toMatch(/\.mtg-stack \{[^}]*flex-direction: (row|column)-reverse;/);
  });
});
