// @vitest-environment jsdom
/**
 * The draft ratings switch: on by default (`../../src/routes/draft/rating-switch.ts`
 * says why that differs from the feedback helper's off default), kept across
 * reloads, and a store that cannot keep it draws on rather than throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_RATINGS_ENABLED_KEY,
  readDraftRatingsEnabled,
  writeDraftRatingsEnabled,
} from '../../src/routes/draft/rating-switch';

interface StoreLike {
  clear(): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(): StoreLike {
  const found = (globalThis as { readonly localStorage?: StoreLike }).localStorage;
  if (found === undefined) throw new Error('this test needs a jsdom localStorage');
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  store().clear();
});

describe('draft ratings switch', () => {
  it('is on until somebody turns it off', () => {
    expect(readDraftRatingsEnabled()).toBe(true);
  });

  it('keeps the switch under its own key', () => {
    expect(writeDraftRatingsEnabled(false)).toBe(true);
    expect(store().getItem(DRAFT_RATINGS_ENABLED_KEY)).toBe('off');
    expect(readDraftRatingsEnabled()).toBe(false);
    writeDraftRatingsEnabled(true);
    expect(readDraftRatingsEnabled()).toBe(true);
  });

  it('reads anything but "off" as on', () => {
    store().setItem(DRAFT_RATINGS_ENABLED_KEY, 'nope');
    expect(readDraftRatingsEnabled()).toBe(true);
  });

  it('says so when there is no store to keep it in, and stays on', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writeDraftRatingsEnabled(false)).toBe(false);
    expect(readDraftRatingsEnabled()).toBe(true);
  });
});
