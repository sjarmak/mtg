import { describe, expect, it } from 'vitest';
import {
  GLYPH_ASCENT,
  GLYPH_DESCENT,
  candidateSizes,
  fitLine,
  fitParagraphs,
  measureText,
  wrapParagraph,
} from '@mtg/card-render';

const OPTIONS = { fontSize: 20, maxWidth: 300 };

describe('wrapParagraph', () => {
  it('keeps every line inside the width', () => {
    const text = 'Create eight 3/3 white and blue Merfolk Soldier Warrior creature tokens with flying.';
    for (const line of wrapParagraph(text, OPTIONS)) {
      expect(measureText(line, { fontSize: OPTIONS.fontSize })).toBeLessThanOrEqual(OPTIONS.maxWidth);
    }
  });

  it('preserves every word, in order', () => {
    const text = 'Target creature gets +3/+3 until end of turn.';
    expect(wrapParagraph(text, OPTIONS).join(' ')).toBe(text);
  });

  it('collapses runs of whitespace rather than emitting blank lines', () => {
    expect(wrapParagraph('Draw   a\tcard.', OPTIONS)).toEqual(['Draw a card.']);
  });

  it('returns one empty line for empty input instead of nothing', () => {
    expect(wrapParagraph('', OPTIONS)).toEqual(['']);
    expect(wrapParagraph('   ', OPTIONS)).toEqual(['']);
  });

  it('hard-breaks a word wider than the box instead of overflowing', () => {
    const word = 'M'.repeat(200);
    const lines = wrapParagraph(word, OPTIONS);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(word);
    for (const line of lines) {
      expect(measureText(line, { fontSize: OPTIONS.fontSize })).toBeLessThanOrEqual(OPTIONS.maxWidth);
    }
  });

  it('terminates on a box narrower than one character', () => {
    const lines = wrapParagraph('abc', { fontSize: 20, maxWidth: 0.1 });
    expect(lines).toEqual(['a', 'b', 'c']);
  });
});

describe('fitParagraphs', () => {
  const bounds = { maxWidth: 538, maxHeight: 204, maxSize: 29, minSize: 13 };

  it('uses the maximum size when the text is short', () => {
    const result = fitParagraphs(['Flying'], bounds);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.layout.fontSize).toBe(29);
  });

  it('shrinks rather than overflowing as the text grows', () => {
    const short = fitParagraphs(['Draw a card.'], bounds);
    const long = fitParagraphs(['Draw a card. '.repeat(30).trim()], bounds);
    expect(short.ok && long.ok).toBe(true);
    if (short.ok && long.ok) {
      expect(long.layout.fontSize).toBeLessThan(short.layout.fontSize);
      expect(long.layout.height).toBeLessThanOrEqual(bounds.maxHeight);
      expect(long.layout.width).toBeLessThanOrEqual(bounds.maxWidth);
    }
  });

  it('keeps every line and the whole block inside the box', () => {
    const result = fitParagraphs(
      ['Flying, vigilance, haste, trample', 'Draw two cards. You gain 5 life.'],
      bounds,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const line of result.layout.lines) expect(line.width).toBeLessThanOrEqual(bounds.maxWidth);
    expect(result.layout.height).toBeLessThanOrEqual(bounds.maxHeight);
  });

  it('leaves a gap between paragraphs', () => {
    const one = fitParagraphs(['Flying'], bounds);
    const two = fitParagraphs(['Flying', 'Haste'], bounds);
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) {
      expect(two.layout.height).toBeGreaterThan(one.layout.height + two.layout.lineHeight - 0.001);
    }
  });

  it('reports a height failure with the shortfall rather than clipping', () => {
    const result = fitParagraphs(['word '.repeat(400).trim()], bounds);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('height');
    expect(result.failure.overflow).toBeGreaterThan(0);
    expect(result.failure.minSize).toBe(13);
  });

  it('puts every line ink inside the block it reports', () => {
    const result = fitParagraphs(['Return target creature to its owner’s hand.'], bounds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { layout } = result;
    for (const line of layout.lines) {
      expect(line.baseline - layout.fontSize * GLYPH_ASCENT).toBeGreaterThanOrEqual(-1e-9);
      expect(line.baseline + layout.fontSize * GLYPH_DESCENT).toBeLessThanOrEqual(layout.height + 1e-9);
    }
  });

  it('refuses a line height tighter than the glyph extent', () => {
    expect(() => fitParagraphs(['x'], { ...bounds, lineHeight: 0.5 })).toThrow(/line height/);
  });
});

describe('fitLine', () => {
  it('finds the largest size that fits', () => {
    const result = fitLine('Saltshrine Acolyte', { maxWidth: 200, maxSize: 34, minSize: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.width).toBeLessThanOrEqual(200);
    const bigger = measureText('Saltshrine Acolyte', { fontSize: result.layout.fontSize + 0.5 });
    expect(bigger).toBeGreaterThan(200);
  });

  it('fails with the offending line named', () => {
    const result = fitLine('x'.repeat(400), { maxWidth: 100, maxSize: 34, minSize: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.line).toBe('x'.repeat(400));
    expect(result.failure.overflow).toBeGreaterThan(0);
  });
});

describe('candidateSizes', () => {
  it('descends on an exact grid without float drift', () => {
    expect(candidateSizes(3, 1, 0.5)).toEqual([3, 2.5, 2, 1.5, 1]);
  });

  it('is empty when the floor is above the ceiling', () => {
    expect(candidateSizes(5, 9, 0.5)).toEqual([]);
  });

  it('rejects a non-positive step instead of looping', () => {
    expect(() => candidateSizes(10, 1, 0)).toThrow(/step/);
  });
});
