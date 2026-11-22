// @vitest-environment jsdom
/**
 * The feedback helper's switch: off by default, kept across reloads, and a
 * store that cannot keep it is reported rather than thrown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_ENABLED_KEY, readFeedbackEnabled, writeFeedbackEnabled } from '../../src/feedback/toggle';

interface StoreLike {
  clear(): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** jsdom's store, structurally; the workspace tsconfig has no `lib: dom`. */
function store(): StoreLike {
  const found = (globalThis as { readonly localStorage?: StoreLike }).localStorage;
  if (found === undefined) throw new Error('this test needs a jsdom localStorage');
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  store().clear();
});

describe('feedback toggle', () => {
  it('is off until somebody turns it on', () => {
    expect(readFeedbackEnabled()).toBe(false);
  });

  it('keeps the switch under its own key', () => {
    expect(writeFeedbackEnabled(true)).toBe(true);
    expect(store().getItem(FEEDBACK_ENABLED_KEY)).toBe('on');
    expect(readFeedbackEnabled()).toBe(true);
    writeFeedbackEnabled(false);
    expect(readFeedbackEnabled()).toBe(false);
  });

  it('reads anything but "on" as off', () => {
    store().setItem(FEEDBACK_ENABLED_KEY, 'yes');
    expect(readFeedbackEnabled()).toBe(false);
  });

  it('says so when there is no store to keep it in', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writeFeedbackEnabled(true)).toBe(false);
    expect(readFeedbackEnabled()).toBe(false);
  });
});
