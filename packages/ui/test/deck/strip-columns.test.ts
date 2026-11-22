// @vitest-environment jsdom
/**
 * The gestures on a strip, counted rather than inferred from what they changed.
 *
 * `../../src/routes/deck/StripColumns.ts` is drawn by three panes and the moves
 * behind its two accelerators differ in each of them, so what the component
 * itself promises is about *calls*: one gesture is one call, and a pane that
 * passes no accelerator has none of them wired at all.
 *
 * That is worth its own file because the promise is invisible from any screen
 * that uses it. Selection is idempotent everywhere it is wired — the second
 * click of a double click re-selects the strip that is already selected — so a
 * builder test asserting the deck's card count cannot tell a guarded click from
 * an unguarded one. It can be told apart here, by counting.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StripColumns } from '../../src/routes/deck/StripColumns';
import type { Group } from '../../src/routes/deck/grouping';
import type { Strip, StripFacts } from '../../src/routes/deck/strips';

afterEach(cleanup);

interface Member {
  readonly id: string;
  readonly name: string;
  readonly copies: number;
}

const TWO: Member = { id: 'a', name: 'Anthem', copies: 2 };

const GROUPS: readonly Group<Member>[] = [
  {
    key: 'mv:2',
    label: 'Mana value 2',
    manaValue: 2,
    symbol: '2',
    cards: 2,
    members: [TWO],
  },
];

function facts(member: Member): StripFacts {
  return { key: member.id, name: member.name, manaCost: '{1}{W}', colorIdentity: 'W', copies: member.copies };
}

/** The strips, in the order they are drawn: copy 1 covered, copy 2 uncovered. */
function strips(): readonly HTMLElement[] {
  return screen.getAllByRole('button');
}

function mount(wired: {
  readonly onSelect: (strip: Strip<Member>) => void;
  readonly onActivate?: (strip: Strip<Member>) => void;
  readonly onMenu?: (strip: Strip<Member>) => void;
  readonly onHover?: (strip: Strip<Member>, hovered: boolean) => void;
}): void {
  render(
    h(StripColumns<Member>, {
      groups: GROUPS,
      factsOf: facts,
      label: 'Cards',
      ...wired,
    }),
  );
}

describe('a strip under a double click', () => {
  it('selects once and acts once, rather than selecting twice and then acting', () => {
    const selected: string[] = [];
    const activated: string[] = [];
    mount({
      onSelect: (strip) => selected.push(strip.key),
      onActivate: (strip) => activated.push(strip.key),
    });
    const strip = strips()[0];
    if (strip === undefined) throw new Error('the column drew no strips');

    // The sequence a browser delivers, which is the measurement
    // `../../src/card/Card.ts` recorded: two clicks and then the double.
    fireEvent.click(strip, { detail: 1 });
    fireEvent.click(strip, { detail: 2 });
    fireEvent.doubleClick(strip);

    expect(selected).toEqual(['a#1']);
    expect(activated).toEqual(['a#1']);
  });

  it('keeps two deliberate clicks as two selections on a pane with no move', () => {
    const selected: string[] = [];
    mount({ onSelect: (strip) => selected.push(strip.key) });
    const strip = strips()[0];
    if (strip === undefined) throw new Error('the column drew no strips');
    fireEvent.click(strip, { detail: 1 });
    fireEvent.click(strip, { detail: 2 });
    expect(selected).toEqual(['a#1', 'a#1']);
  });
});

describe('a strip under inspection', () => {
  it('reports pointer and keyboard entry and exit without selecting the strip', () => {
    const selected: string[] = [];
    const inspected: string[] = [];
    mount({
      onSelect: (strip) => selected.push(strip.key),
      onHover: (strip, hovered) => inspected.push(`${strip.key}:${String(hovered)}`),
    });
    const strip = strips()[0];
    if (strip === undefined) throw new Error('the column drew no strips');

    fireEvent.mouseEnter(strip);
    fireEvent.mouseLeave(strip);
    fireEvent.focus(strip);
    fireEvent.blur(strip);

    expect(inspected).toEqual(['a#1:true', 'a#1:false', 'a#1:true', 'a#1:false']);
    expect(selected).toEqual([]);
  });

  /**
   * The anchor a floating preview places itself against: the strip's own
   * right edge, halfway down -- `stripEdge`'s arithmetic, computed off
   * whatever box the element reports. Zeroed out on the way out, since `at` is
   * only meaningful while `hovered` is `true` (the docblock on
   * `StripColumns.onHover` says as much).
   */
  it('hands the caller the strip’s own right edge, halfway down, and zeroes it on the way out', () => {
    const seen: { readonly hovered: boolean; readonly at: { readonly x: number; readonly y: number } }[] = [];
    mountWithHover((strip, hovered, at) => {
      void strip;
      seen.push({ hovered, at });
    });
    const strip = strips()[0];
    if (strip === undefined) throw new Error('the column drew no strips');
    (strip as unknown as { getBoundingClientRect: () => DOMRectLike }).getBoundingClientRect = () => ({
      right: 240,
      top: 80,
      height: 20,
    });

    fireEvent.mouseEnter(strip);
    fireEvent.mouseLeave(strip);
    fireEvent.focus(strip);
    fireEvent.blur(strip);

    expect(seen).toEqual([
      { hovered: true, at: { x: 240, y: 90 } },
      { hovered: false, at: { x: 0, y: 0 } },
      { hovered: true, at: { x: 240, y: 90 } },
      { hovered: false, at: { x: 0, y: 0 } },
    ]);
  });
});

interface DOMRectLike {
  readonly right: number;
  readonly top: number;
  readonly height: number;
}

/**
 * `mount` only wires `onSelect`/`onActivate`/`onMenu`/`onHover` in the shape the
 * two-argument gesture tests use; the anchor test needs the three-argument
 * form `StripColumns` actually declares.
 */
function mountWithHover(
  onHover: (strip: Strip<Member>, hovered: boolean, at: { x: number; y: number }) => void,
): void {
  render(
    h(StripColumns<Member>, {
      groups: GROUPS,
      factsOf: facts,
      label: 'Cards',
      onSelect: () => undefined,
      onHover,
    }),
  );
}

describe('a strip under the context gestures', () => {
  it('plays the reverse move on a right click and on the context key', () => {
    const menued: string[] = [];
    mount({ onSelect: () => undefined, onMenu: (strip) => menued.push(strip.key) });
    const strip = strips()[1];
    if (strip === undefined) throw new Error('the column drew fewer than two strips');
    fireEvent.contextMenu(strip);
    fireEvent.keyDown(strip, { key: 'ContextMenu' });
    fireEvent.keyDown(strip, { key: 'F10', shiftKey: true });
    // A key that is not the context key is the browser's, not this component's.
    fireEvent.keyDown(strip, { key: 'F10' });
    expect(menued).toEqual(['a#2', 'a#2', 'a#2']);
  });

  it('leaves the browser its own menu on a pane that has no reverse move', () => {
    mount({ onSelect: () => undefined });
    const strip = strips()[0];
    if (strip === undefined) throw new Error('the column drew no strips');
    // `fireEvent` reports whether anything called `preventDefault`, which is the
    // only observable difference between an unwired strip and one wired to a
    // handler that happens to do nothing.
    expect(fireEvent.contextMenu(strip)).toBe(true);
  });
});

/**
 * The workspace tsconfig has no `lib: dom`, so a rendered container carries none
 * of the query members and the narrowing happens at runtime, the way
 * `./constructed-builder.test.ts` does it for the same reason.
 */
interface QueryableLike {
  readonly querySelector: (selector: string) => unknown;
}

function asQueryable(value: unknown): QueryableLike {
  const candidate = value as Partial<QueryableLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.querySelector !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as QueryableLike;
}

describe('a compact region', () => {
  it('draws no picture at compact, whatever the pane hands it', () => {
    // mtg-mxkrk. The face slot is gone from the compact arm outright, so a pane
    // that still passes a `renderFace` -- an older call site, or a new one
    // written from the full-density pane beside it -- draws name bars anyway.
    // The guard is here rather than at a pane because it is the component's
    // promise: there is nowhere for a picture to go.
    const { container } = render(
      h(StripColumns<Member>, {
        groups: GROUPS,
        factsOf: facts,
        label: 'Cards',
        onSelect: () => undefined,
        renderFace: () => h('span', { 'data-test-face': 'true' }),
      }),
    );
    const region = asQueryable(container);
    expect(region.querySelector('[data-test-face]')).toBeNull();
    expect(region.querySelector('.mtg-strips__face')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
