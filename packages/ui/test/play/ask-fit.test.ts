/**
 * The move label's fit ladder, as arithmetic.
 *
 * `src/styles/ask-fit.ts` is a pure function of a string precisely so it can be
 * held to cases here: jsdom lays nothing out, so a fit that asked the DOM for a
 * box would be a fit no unit test could see. What the browser decides — which
 * band the button is in — is pinned in `ask-fit.browser.test.ts` instead, and
 * the two halves meet at the band values these cases name.
 */
import { describe, expect, it } from 'vitest';
import {
  ASK_BAND_ALWAYS,
  ASK_BANDS,
  ASK_FIT_STEPS,
  askFitAttribute,
  askFitAttributes,
  askFitBands,
  askFitScale,
  longestWord,
} from '../../src/styles/ask-fit';

describe('the ladder is a ladder', () => {
  it('descends from full size to a floor no smaller than nine pixels', () => {
    expect(ASK_FIT_STEPS[0]).toBe(1);
    for (let step = 1; step < ASK_FIT_STEPS.length; step += 1) {
      expect(askFitScale(step), `step ${String(step)} does not shrink`).toBeLessThan(askFitScale(step - 1));
    }
    // 0.8125rem is --mtg-text-sm, so this is the px a reader actually gets at
    // the bottom rung. Text that keeps shrinking stops being text.
    const floorPx = 0.8125 * 16 * askFitScale(ASK_FIT_STEPS.length - 1);
    expect(floorPx).toBeGreaterThanOrEqual(9);
  });

  it('refuses a rung it does not have rather than writing an undefined scale', () => {
    expect(() => askFitScale(ASK_FIT_STEPS.length)).toThrow(/no step/);
    expect(() => askFitAttribute(0)).toThrow(/no band attribute/);
    expect(() => askFitAttribute(ASK_FIT_STEPS.length)).toThrow(/no band attribute/);
  });

  it('keeps the bands ascending, so a narrower band is always a later rule', () => {
    for (let at = 1; at < ASK_BANDS.length; at += 1) {
      expect(ASK_BANDS[at], `band ${String(at)}`).toBeGreaterThan(ASK_BANDS[at - 1] ?? 0);
    }
  });
});

describe('the demand is the longest word, not the label', () => {
  it('breaks on whitespace and on dashes, and not on an apostrophe', () => {
    expect(longestWord('Play Mountain')).toBe('Mountain');
    expect(longestWord("Bot's Drake")).toBe("Bot's");
    expect(longestWord('a well-fed creature')).toBe('creature');
    expect(longestWord('')).toBe('');
  });

  it('is blind to how many short words follow it', () => {
    // The same rungs at the same bands: wrapping places the rest of the label,
    // and only a word wider than the box forces the break the ladder exists to
    // postpone. A rule keyed on total length would shrink this one twice.
    expect(askFitBands('Mountain')).toEqual(askFitBands('Tap Mountain for one red'));
  });
});

describe('a band is published only where a rule could fire', () => {
  it('leaves a short label off the ladder entirely', () => {
    // Three characters want under 24px, and no ask column ever leaves the label
    // that little, so every rung is unreachable and none is published.
    expect(askFitAttributes('you')).toEqual({});
    expect(askFitBands('you')).toEqual([null, null, null, null]);
  });

  it('descends band by band as the rungs deepen', () => {
    const bands = askFitBands('Cast Emberflow Raider');
    expect(bands.length).toBe(ASK_FIT_STEPS.length - 1);
    const numbers = bands.map((band) => (band === null ? 0 : Number(band)));
    for (let at = 1; at < numbers.length; at += 1) {
      expect(numbers[at], `rung ${String(at + 1)} is not below rung ${String(at)}`).toBeLessThan(
        numbers[at - 1] ?? 0,
      );
    }
  });

  it('names the attribute the stylesheet keys on', () => {
    const attributes = askFitAttributes('Cast Emberflow Raider');
    expect(attributes[askFitAttribute(1)]).toBe('4.25');
    expect(attributes[askFitAttribute(4)]).toBe('3.25');
  });

  it('puts a word past the widest band on every rung unconditionally', () => {
    // Forty characters want 301px, which is wider than any column this file
    // models, so there is no width at which the rung does not apply.
    const bands = askFitBands('x'.repeat(40));
    expect(bands.every((band) => band === ASK_BAND_ALWAYS)).toBe(true);
  });
});
