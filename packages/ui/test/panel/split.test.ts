/**
 * Where a split may be put, and what a divider does when it is pushed.
 *
 * `mtg-rgc.19`. The arithmetic and the store only. Whether the layout honors a
 * share -- whether a pane dragged to a limit still has a card in it -- is
 * `./split.browser.test.ts`'s, because that is a question for a
 * browser and this is not.
 *
 * The handlers are exercised by calling them with the members they read, which
 * is the same shape `../../src/panel/SplitHandle.ts` declares its structural
 * interfaces for: no DOM, no React mounted, and a fake element that records what
 * was asked of it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SPLIT_LIMITS,
  SPLIT_STEP,
  SPLIT_UNSET,
  clampShare,
  nudged,
  readSplitShare,
  restoresDefault,
  shareIn,
  splitStoreKey,
  splitStyle,
  writeSplitShare,
} from '../../src/panel/split';
import { boxOf } from '../../src/panel/SplitHandle';

describe('where a divider may be put', () => {
  it('holds a share between the limits, at both ends', () => {
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(-4)).toBe(DEFAULT_SPLIT_LIMITS.min);
    expect(clampShare(9)).toBe(DEFAULT_SPLIT_LIMITS.max);
  });

  it('reads a pointer as a share of the box it is in', () => {
    expect(shareIn({ start: 100, extent: 800 }, 500)).toBe(0.5);
    expect(shareIn({ start: 100, extent: 800 }, 100)).toBe(0);
  });

  // A container mid-mount has no height, and the share of nothing is an
  // infinity that clamps to a limit — a divider that jumps to the top of the
  // screen the first time it is touched.
  it('refuses a box with no extent rather than dividing by it', () => {
    expect(shareIn({ start: 0, extent: 0 }, 40)).toBeNull();
    expect(shareIn({ start: 0, extent: -20 }, 40)).toBeNull();
  });
});

describe('the keys a divider answers to', () => {
  it('moves by a step, on either axis, and clamps at the limits', () => {
    expect(nudged(0.5, 'ArrowUp')).toBeCloseTo(0.5 - SPLIT_STEP, 10);
    expect(nudged(0.5, 'ArrowLeft')).toBeCloseTo(0.5 - SPLIT_STEP, 10);
    expect(nudged(0.5, 'ArrowDown')).toBeCloseTo(0.5 + SPLIT_STEP, 10);
    expect(nudged(0.5, 'ArrowRight')).toBeCloseTo(0.5 + SPLIT_STEP, 10);
    expect(nudged(DEFAULT_SPLIT_LIMITS.max, 'ArrowDown')).toBe(DEFAULT_SPLIT_LIMITS.max);
  });

  // The event has to reach the page for every key that is not one of ours:
  // Tab moves on, and a divider that swallowed it would be a focus trap.
  it('says nothing about a key it does not use', () => {
    expect(nudged(0.5, 'Tab')).toBeNull();
    expect(nudged(0.5, 'a')).toBeNull();
    expect(restoresDefault('Home')).toBe(true);
    expect(restoresDefault('End')).toBe(false);
  });
});

/** A store that answers, and remembers what it was told. */
function fakeStore(seed: Readonly<Record<string, string>> = {}): Map<string, string> {
  const kept = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => kept.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        kept.set(key, value);
      },
    },
  });
  return kept;
}

describe('what is kept between visits', () => {
  it('reads back what it wrote, under a namespaced key', () => {
    const kept = fakeStore();
    writeSplitShare('draft.pack', 0.42);
    expect(kept.get(splitStoreKey('draft.pack'))).toBe('0.4200');
    expect(readSplitShare('draft.pack')).toBeCloseTo(0.42, 4);
  });

  it('says nothing kept for an unset split, rather than a share of zero', () => {
    fakeStore();
    writeSplitShare('draft.pack', null);
    expect(readSplitShare('draft.pack')).toBeNull();
    expect(readSplitShare('never.dragged')).toBeNull();
  });

  // A store outlives the build that wrote it, so every reading is treated as a
  // claim rather than a fact: a hand-edited value, or one from a build that
  // kept something else under this key, draws the arrangement a first visit
  // draws.
  it('clamps a stored share and ignores one that is not a number', () => {
    fakeStore({
      [splitStoreKey('wild')]: '4',
      [splitStoreKey('junk')]: 'most of it',
      [splitStoreKey('empty')]: SPLIT_UNSET,
    });
    expect(readSplitShare('wild')).toBe(DEFAULT_SPLIT_LIMITS.max);
    expect(readSplitShare('junk')).toBeNull();
    expect(readSplitShare('empty')).toBeNull();
  });
});

describe('the property a container carries', () => {
  // Nothing at all until somebody drags something: an undragged surface renders
  // the markup it rendered before this feature existed.
  it('emits no style for a split nobody has moved', () => {
    expect(splitStyle('--split-a', null)).toBeUndefined();
  });

  it('emits a percentage for a container that enforces its own floors', () => {
    expect(splitStyle('--split-a', 0.375)).toEqual({ '--split-a': '37.50%' });
  });

  // A grid track sized to a percentage does not grow for the item in it, so the
  // floors go into the value rather than onto the panes.
  it('emits a clamped track for a container that does not', () => {
    expect(splitStyle('--split-a', 0.5, { first: '12rem', second: '10rem' })).toEqual({
      '--split-a': 'clamp(12rem, 50.00%, calc(100% - 10rem))',
    });
  });
});

describe('the box a divider divides', () => {
  const rect = { top: 60, left: 20, width: 900, height: 700 };
  const parent = { getBoundingClientRect: (): typeof rect => rect };
  const handle = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    parentElement: parent,
  };

  it('is the parent, on the axis the divider moves along', () => {
    expect(boxOf(handle, 'horizontal')).toEqual({ start: 60, extent: 700 });
    expect(boxOf(handle, 'vertical')).toEqual({ start: 20, extent: 900 });
  });

  it('is nothing for a handle with no parent to measure, or no pointer capture', () => {
    expect(boxOf({ ...handle, parentElement: null }, 'horizontal')).toBeNull();
    expect(boxOf({ getBoundingClientRect: (): typeof rect => rect }, 'horizontal')).toBeNull();
    expect(boxOf(null, 'horizontal')).toBeNull();
  });
});
