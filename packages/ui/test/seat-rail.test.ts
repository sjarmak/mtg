// @vitest-environment jsdom
/**
 * The seat rail and the opponent tiles: props in, markup out.
 *
 * `mtg-bc2.154.6.5.4`. Three claims. The rail is one row per player carrying life,
 * poison and a commander damage chip per dealer, and the tone of a chip is the
 * commander's own figure (CR 903.10a is per commander, so two partners at ten
 * apiece are not lethal). A dash is not a zero. And a board handed no `pod` is a
 * duel, byte for byte: no rail, no tiles, no attribute a two-player sheet could
 * have to know about.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Board } from '../src/board/Board';
import type { BoardSide } from '../src/board/Board';
import { COMMANDER_DAMAGE_LETHAL, POISON_LETHAL, SeatRail } from '../src/board/SeatRail';
import type { SeatRailEntry } from '../src/board/SeatRail';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import {
  BOARD_CSS,
  TILE_COMMANDER_REM,
  TILE_CROWDED_SLOT_REM,
  TILE_SLOT_REM,
} from '../src/styles/board/index';
import { playedSlot } from '../src/styles/board/geometry';

afterEach(cleanup);

/** The workspace tsconfig has no `lib: dom`; this is the slice of an element the test reads. */
interface Node {
  readonly className: string;
  readonly textContent: string | null;
  readonly tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): Node | null;
  querySelectorAll(selector: string): { readonly [index: number]: Node; readonly length: number };
}

const asNode = (container: unknown): Node => container as Node;
const all = (root: Node, selector: string): Node[] => {
  const found = root.querySelectorAll(selector);
  return Array.from({ length: found.length }, (_, at) => found[at]!);
};
const press = (node: Node): Parameters<typeof fireEvent.click>[0] =>
  node as unknown as Parameters<typeof fireEvent.click>[0];

function entry(seat: number, extra: Partial<SeatRailEntry> = {}): SeatRailEntry {
  return {
    seat,
    name: ['Ana', 'Bo', 'Cy', 'Di'][seat] ?? `Seat ${String(seat)}`,
    you: seat === 0,
    life: 40,
    poison: null,
    damage: [],
    ...extra,
  };
}

/** `count` permanents that pile with nothing, so each is its own place on the row. */
function permanents(count: number): BoardSide['battlefield']['permanents'] {
  const card = EXAMPLE_CARDS.find((one) => one.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return Array.from({ length: count }, (_, at) => ({
    key: `p${String(at)}`,
    card,
    pileId: `pile-${String(at)}`,
  }));
}

function side(name: string, places = 0): BoardSide {
  return {
    status: { name, life: 40, handCount: 7, libraryCount: 80, graveyardCount: 0 },
    battlefield: { label: `${name} battlefield`, permanents: permanents(places) },
    hand: { label: `${name} hand`, cards: [] },
  };
}

describe('the seat rail', () => {
  it('is one row per player, marks the viewer, and names its region', () => {
    const { container } = render(h(SeatRail, { seats: [entry(0), entry(1), entry(2), entry(3)] }));
    const root = asNode(container);
    expect(root.querySelector('.mtg-seat-rail')?.getAttribute('aria-label')).toBe('Players');
    expect(root.querySelector('.mtg-seat-rail')?.getAttribute('data-seats')).toBe('4');
    expect(all(root, '.mtg-seat-rail__item').map((row) => row.getAttribute('data-you'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(root.querySelector('[data-you="true"] .mtg-seat-rail__you')?.textContent).toBe('you');
  });

  it('draws a dash for poison nobody reported and the count when somebody did', () => {
    const { container } = render(
      h(SeatRail, { seats: [entry(0, { poison: null }), entry(1, { poison: 0 }), entry(2, { poison: 8 })] }),
    );
    const poison = all(asNode(container), '.mtg-seat-rail__poison');
    expect(poison.map((one) => one.getAttribute('data-amount'))).toEqual(['unreported', '0', '8']);
    expect(poison.map((one) => one.querySelector('.mtg-seat-rail__poison-amount')?.textContent)).toEqual([
      '—',
      '0',
      '8',
    ]);
    // 8 of 10 is past two-thirds, so the row warns; ten loses.
    expect(poison.map((one) => one.getAttribute('data-tone'))).toEqual(['none', 'none', 'warn']);
    const { container: lost } = render(h(SeatRail, { seats: [entry(0, { poison: POISON_LETHAL })] }));
    expect(asNode(lost).querySelector('.mtg-seat-rail__poison')?.getAttribute('data-tone')).toBe('lethal');
  });

  it('draws a chip per dealer, quiet at zero, warning from two-thirds and lethal at twenty-one', () => {
    const damage = [
      { dealer: 1, name: 'Bo', amount: 0 },
      { dealer: 2, name: 'Cy', amount: 14 },
      { dealer: 3, name: 'Di', amount: COMMANDER_DAMAGE_LETHAL },
    ];
    const { container } = render(h(SeatRail, { seats: [entry(0, { damage })] }));
    const chips = all(asNode(container), '.mtg-seat-rail__damage');
    expect(chips.map((chip) => chip.getAttribute('data-dealer'))).toEqual(['1', '2', '3']);
    expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual(['none', 'warn', 'lethal']);
    expect(chips.map((chip) => chip.querySelector('.mtg-seat-rail__damage-amount')?.textContent)).toEqual([
      '0',
      '14',
      '21',
    ]);
    expect(chips[1]?.getAttribute('title')).toContain('lethal at 21 from one commander');
  });

  it('reads the tone off the largest single commander, not the dealer’s total', () => {
    // Two partners have dealt ten apiece: twenty from one dealer, and safe from both.
    const partners = { dealer: 3, name: 'Di', amount: 20, peak: 10 };
    const lone = { dealer: 2, name: 'Cy', amount: 20, peak: 20 };
    const { container } = render(h(SeatRail, { seats: [entry(0, { damage: [lone, partners] })] }));
    const chips = all(asNode(container), '.mtg-seat-rail__damage');
    expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual(['warn', 'none']);
  });

  it('turns a low life total to the low tone, at five as the pod does', () => {
    const { container } = render(h(SeatRail, { seats: [entry(0, { life: 5 }), entry(1, { life: 6 })] }));
    expect(all(asNode(container), '.mtg-seat-rail__life').map((one) => one.getAttribute('data-low'))).toEqual(
      ['true', 'false'],
    );
  });

  it('is a button only where a spell can be aimed, and pressing it aims', () => {
    const onAim = vi.fn<() => void>();
    const { container } = render(h(SeatRail, { seats: [entry(0), entry(1, { aim: { onAim } })] }));
    const seats = all(asNode(container), '.mtg-seat-rail__seat');
    expect(seats.map((one) => one.tagName)).toEqual(['DIV', 'BUTTON']);
    expect(seats[0]?.hasAttribute('data-aimable')).toBe(false);
    fireEvent.click(press(seats[1]!));
    expect(onAim).toHaveBeenCalledTimes(1);
  });

  it('marks the seat being attacked and the seat whose turn it is', () => {
    const { container } = render(
      h(SeatRail, { seats: [entry(0, { active: true }), entry(1), entry(2, { attacked: true })] }),
    );
    const items = all(asNode(container), '.mtg-seat-rail__item');
    expect(items.map((one) => one.getAttribute('data-active'))).toEqual(['true', 'false', 'false']);
    expect(items.map((one) => one.getAttribute('data-attacked'))).toEqual(['false', 'false', 'true']);
  });
});

describe('the board at a pod', () => {
  const pod = {
    rail: { seats: [entry(0), entry(1), entry(2), entry(3)] },
    opponentSeat: 2,
    opponentAt: 1,
    others: [
      { seat: 1, side: side('Bo') },
      { seat: 3, side: side('Di') },
    ],
  };

  it('draws the rail for the opponents’ pods and a tile per opponent in the order they sit', () => {
    const { container } = render(
      h(Board, { you: side('Ana'), opponent: side('Cy'), stack: { entries: [] }, pod }),
    );
    const root = asNode(container);
    expect(root.querySelector('.mtg-board')?.getAttribute('data-pod')).toBe('4');
    expect(root.querySelector('.mtg-board__pods .mtg-seat-rail')).not.toBeNull();
    // The viewer keeps their own pod; the opponents' are the rail's.
    expect(all(root, ".mtg-board__pods .mtg-pod[data-seat='opponent']").length).toBe(0);
    expect(
      all(root, '.mtg-board__opponents .mtg-pod-tile').map((tile) => tile.getAttribute('data-seat-index')),
    ).toEqual(['1', '2', '3']);
    expect(all(root, '.mtg-pod-tile').map((tile) => tile.getAttribute('data-primary'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(root.querySelector('.mtg-board__opponents')?.getAttribute('data-opponents')).toBe('3');
  });

  it('gives each tile a one-line head with life and the two counts, and a labeled group', () => {
    const { container } = render(
      h(Board, { you: side('Ana'), opponent: side('Cy'), stack: { entries: [] }, pod }),
    );
    const tile = asNode(container).querySelector(".mtg-pod-tile[data-seat-index='1']");
    expect(tile?.getAttribute('aria-label')).toBe('Bo, opponent');
    expect(tile?.querySelector('.mtg-pod-tile__life')?.textContent).toBe('40');
    expect(all(tile!, '.mtg-pod-tile__count-value').map((one) => one.textContent)).toEqual(['7', '80']);
  });

  it('keeps a tile off the lane’s crowded-row contract, so one crowded opponent does not shrink the viewer’s hand', () => {
    const crowded = {
      ...pod,
      others: [
        { seat: 1, side: side('Bo', 9) },
        { seat: 3, side: side('Di', 3) },
      ],
    };
    const { container } = render(
      h(Board, { you: side('Ana'), opponent: side('Cy', 1), stack: { entries: [] }, pod: crowded }),
    );
    const root = asNode(container);
    // Nine places is the lane's threshold; the tile says it in its own attribute.
    expect(all(root, '.mtg-board__spells[data-crowded]')).toHaveLength(0);
    expect(
      all(root, '.mtg-pod-tile .mtg-board__spells').map((row) => row.getAttribute('data-tile-crowded')),
    ).toEqual(['true', null, null]);
  });

  it('leaves a duel’s crowded row exactly as it was', () => {
    const { container } = render(
      h(Board, { you: side('Ana', 9), opponent: side('Bo', 2), stack: { entries: [] } }),
    );
    const rows = all(asNode(container), '.mtg-board__spells');
    // The opponent's lane is first in the document, the viewer's second.
    expect(rows.map((row) => row.getAttribute('data-crowded'))).toEqual([null, 'true']);
    expect(all(asNode(container), '[data-tile-crowded]')).toHaveLength(0);
  });

  it('draws exactly the duel it always drew when handed no pod', () => {
    const { container } = render(
      h(Board, { you: side('Ana'), opponent: side('Bo'), stack: { entries: [] } }),
    );
    const root = asNode(container);
    expect(root.querySelector('.mtg-board')?.hasAttribute('data-pod')).toBe(false);
    expect(root.querySelector('.mtg-seat-rail')).toBeNull();
    expect(root.querySelector('.mtg-pod-tile')).toBeNull();
    expect(root.querySelector('.mtg-board__opponents')).toBeNull();
    expect(root.querySelector(".mtg-board__pods .mtg-pod[data-seat='opponent']")).not.toBeNull();
    expect(root.querySelector(".mtg-board__lanes > .mtg-board__side[data-seat='opponent']")).not.toBeNull();
  });
});

describe('the pod sheet', () => {
  it('is registered with the board sheets and puts a tile’s command zone above its board, not beside it', () => {
    expect(BOARD_CSS).toContain('.mtg-seat-rail__item');
    expect(BOARD_CSS).toContain('.mtg-board__opponents');
    expect(BOARD_CSS).toContain(".mtg-combat__target[aria-checked='true']");
    expect(BOARD_CSS).toContain(
      `.mtg-pod-tile .mtg-board__side[data-side-panel='true'] {\n  grid-template-columns: minmax(0, 1fr);`,
    );
    // The single column follows the sheet that makes the side a two-column grid, which is the order it needs to win in.
    expect(BOARD_CSS.indexOf('.mtg-pod-tile .mtg-board__side')).toBeGreaterThan(
      BOARD_CSS.indexOf(".mtg-board__side[data-side-panel='true'] {\n  display: grid;"),
    );
  });

  it('states a tile’s permanent sizes on both axes, smaller when the tile is crowded', () => {
    expect(TILE_CROWDED_SLOT_REM).toBeLessThan(TILE_SLOT_REM);
    expect(TILE_COMMANDER_REM).toBeLessThan(TILE_SLOT_REM);
    expect(BOARD_CSS).toContain(`--tile-slot: ${String(TILE_SLOT_REM)}rem;`);
    expect(BOARD_CSS).toContain(
      `.mtg-board__spells[data-tile-crowded='true'] { --tile-slot: ${String(TILE_CROWDED_SLOT_REM)}rem; }`,
    );
    // Height and width both, or an automatic width asks the card for one and settles at 72px.
    const tileSlot = `${playedSlot('.mtg-board[data-pod] .mtg-pod-tile .mtg-board__spells')}[data-slot='play']`;
    expect(BOARD_CSS).toContain(`${tileSlot} {`);
    expect(BOARD_CSS.slice(BOARD_CSS.indexOf(`${tileSlot} {`))).toMatch(
      /^:is\([^}]+height: var\(--tile-slot\); width: calc\(var\(--tile-slot\) \* [\d.]+\);/,
    );
  });

  it('is read by nothing that a duel draws', () => {
    // Every selector the sheet adds is under a class only the pod arm writes.
    const podSheet = BOARD_CSS.slice(BOARD_CSS.indexOf('.mtg-seat-rail { min-width: 0; }'));
    const selectors = podSheet.match(/^[^\s@/*][^{}]*(?=\{)/gm) ?? [];
    for (const selector of selectors) {
      expect(selector, selector).toMatch(
        /mtg-seat-rail|mtg-pod-tile|mtg-board__opponents|mtg-combat__target|mtg-combat__controls:has/,
      );
    }
  });
});
