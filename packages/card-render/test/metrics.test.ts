import { describe, expect, it } from 'vitest';
import {
  BOLD_WIDTH_FACTOR,
  CENTERED_BASELINE,
  DEFAULT_WIDTH_SAFETY,
  FALLBACK_ADVANCE,
  GLYPH_ASCENT,
  GLYPH_DESCENT,
  METRIC_CHARS,
  METRIC_EM,
  METRIC_SOURCES,
  advanceOf,
  charAdvance,
  fitFontSize,
  measureText,
} from '@mtg/card-render';

describe('the advance-width table', () => {
  it('covers every printable ASCII character', () => {
    for (let code = 0x20; code <= 0x7e; code += 1) {
      expect(METRIC_CHARS).toContain(String.fromCodePoint(code));
    }
  });

  it('covers the punctuation the DSL renderers emit', () => {
    // `renderTypeLine` prints an em dash; generated names carry curly quotes.
    for (const char of ['—', '’', '“', '”', '…']) {
      expect(METRIC_CHARS).toContain(char);
    }
  });

  it('names the faces it was measured from', () => {
    expect(METRIC_SOURCES).toEqual(['DejaVu Serif', 'Liberation Serif']);
  });

  it('charges an uncovered character the widest advance in the table', () => {
    expect(charAdvance('漢')).toBe(FALLBACK_ADVANCE);
    for (const char of METRIC_CHARS) {
      expect(charAdvance(char)).toBeLessThanOrEqual(FALLBACK_ADVANCE);
    }
  });

  it('gives every covered character a positive advance', () => {
    for (const char of METRIC_CHARS) expect(charAdvance(char)).toBeGreaterThan(0);
  });

  it('measures a space as narrower than a capital M', () => {
    expect(charAdvance(' ')).toBeLessThan(charAdvance('M'));
    expect(charAdvance('i')).toBeLessThan(charAdvance('m'));
  });
});

describe('measureText', () => {
  it('is linear in font size', () => {
    const at10 = measureText('Tideglass Reach', { fontSize: 10 });
    const at30 = measureText('Tideglass Reach', { fontSize: 30 });
    expect(at30).toBeCloseTo(at10 * 3, 6);
  });

  it('is additive over concatenation', () => {
    const whole = measureText('Reefclan Harpooner', { fontSize: 20 });
    const left = measureText('Reefclan ', { fontSize: 20 });
    const right = measureText('Harpooner', { fontSize: 20 });
    expect(whole).toBeCloseTo(left + right, 6);
  });

  it('applies the safety allowance over the raw table', () => {
    const raw = (advanceOf('Island') / METRIC_EM) * 20;
    expect(measureText('Island', { fontSize: 20 })).toBeCloseTo(raw * DEFAULT_WIDTH_SAFETY, 6);
    expect(measureText('Island', { fontSize: 20, widthSafety: 1 })).toBeCloseTo(raw, 6);
  });

  it('charges bold runs more than regular ones', () => {
    const regular = measureText('Colossus', { fontSize: 20 });
    const bold = measureText('Colossus', { fontSize: 20, boldFactor: BOLD_WIDTH_FACTOR });
    expect(bold).toBeCloseTo(regular * BOLD_WIDTH_FACTOR, 6);
    expect(BOLD_WIDTH_FACTOR).toBeGreaterThanOrEqual(1.333);
  });

  it('measures the empty string as zero', () => {
    expect(measureText('', { fontSize: 40 })).toBe(0);
  });
});

describe('fitFontSize', () => {
  it('returns the cap when the text already fits', () => {
    expect(fitFontSize('ab', 1000, { maxSize: 30, minSize: 10 })).toBe(30);
  });

  it('snaps down to the step grid, never up', () => {
    const width = measureText('Saltshrine Acolyte', { fontSize: 17.3 });
    const size = fitFontSize('Saltshrine Acolyte', width, { maxSize: 40, minSize: 5, step: 0.5 });
    expect(size).not.toBeNull();
    expect(size).toBeLessThanOrEqual(17.3);
    expect(measureText('Saltshrine Acolyte', { fontSize: size ?? 0 })).toBeLessThanOrEqual(width);
  });

  it('returns null rather than a size below the floor', () => {
    expect(fitFontSize('a very long card name indeed', 10, { maxSize: 30, minSize: 8 })).toBeNull();
  });
});

describe('vertical metrics', () => {
  it('centers a single line symmetrically about a box center', () => {
    // Ink runs from center - (A - C)·s to center + (D + C)·s; those are equal.
    expect(GLYPH_ASCENT - CENTERED_BASELINE).toBeCloseTo(GLYPH_DESCENT + CENTERED_BASELINE, 10);
  });

  it('claims more ink than the reference faces actually use', () => {
    // DejaVu Serif's tallest lowercase reaches 0.76 em, its descenders 0.24 em.
    expect(GLYPH_ASCENT).toBeGreaterThan(0.76);
    expect(GLYPH_DESCENT).toBeGreaterThan(0.24);
  });
});
