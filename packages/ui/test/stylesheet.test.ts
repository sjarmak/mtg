/**
 * The numeric discipline of the generated stylesheets, enforced.
 *
 * `uiStyleSheet()` is handed to `createElement('style', …)` as text, so a
 * template placeholder in `styles/card.ts` is not a value inside a declaration —
 * it is characters in live CSS. Nothing hostile reaches those sites today, and
 * that is a property of what the anatomy constants happen to be rather than of
 * anything that checks them. These tests are the check.
 *
 * The scan covers stylesheet modules only: everything under `src/styles/`, at
 * any depth, plus any `styles.ts` elsewhere in the tree, which is what makes the
 * analysis route's sheet part of the same rule. Template literals outside those
 * files assemble SVG attributes and copy, where a number is not a CSS token and
 * the guard would say nothing.
 *
 * **At any depth is the part that had to be fixed rather than assumed**
 * (`mtg-bz2`). The walk keyed on the *parent* directory being named `styles`, so
 * splitting `styles/board.ts` into `styles/board/*.ts` would have taken twelve
 * sheets carrying nine interpolated anatomy numbers straight out of the scan
 * while the suite stayed green. A guard that stops covering a file the moment
 * somebody puts it in a folder is a guard that expires quietly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as anatomy from '../src/card/anatomy';
import { cssNumber } from '../src/styles/number';
import { uiStyleSheet } from '../src/styles/index';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function stylesheetSources(dir: string, insideStyles = false): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...stylesheetSources(path, insideStyles || entry.name === 'styles'));
    } else if (entry.name.endsWith('.ts') && (insideStyles || entry.name === 'styles.ts')) {
      found.push(path);
    }
  }
  return found;
}

/** A number, or a record of nothing but numbers — `ART_WINDOW` is the second kind. */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (typeof value !== 'object' || value === null) return false;
  const members = Object.values(value);
  return members.length > 0 && members.every((member) => typeof member === 'number');
}

/**
 * Read off the specification rather than listed here, so a constant added to
 * `anatomy.ts` tomorrow is covered without anyone remembering to come back.
 */
const NUMERIC_NAMES: readonly string[] = Object.entries(anatomy)
  .filter(([, value]) => isNumeric(value))
  .map(([name]) => name);

/**
 * Every `${…}` in a source file, matched by walking braces rather than by
 * regex: a placeholder can hold a nested template with placeholders of its own,
 * and `card.ts`'s identity rules do exactly that.
 */
function placeholders(text: string): readonly string[] {
  const found: string[] = [];
  for (let start = 0; start < text.length - 1; start += 1) {
    if (text[start] !== '$' || text[start + 1] !== '{') continue;
    let depth = 0;
    for (let end = start + 1; end < text.length; end += 1) {
      const char = text[end];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push(text.slice(start + 2, end));
          break;
        }
      }
    }
  }
  return found;
}

describe('cssNumber', () => {
  it('rejects every value that is not a finite number', () => {
    expect(() => cssNumber(Number.NaN)).toThrow(/finite/);
    expect(() => cssNumber(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => cssNumber(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
    // The parameter type keeps these out at compile time; the cast is how a
    // value laundered through a config read or a JSON parse would arrive.
    expect(() => cssNumber('9.5' as unknown as number)).toThrow(/finite/);
    expect(() => cssNumber(null as unknown as number)).toThrow(/finite/);
  });

  it('names the value it refused', () => {
    expect(() => cssNumber(Number.NaN)).toThrow(/NaN/);
    expect(() => cssNumber('9.5}; body { display: none' as unknown as number)).toThrow(/display: none/);
  });

  /**
   * The guard is a gate, not a formatter: `String` and nothing else. Rounding or
   * padding a value on its way through would be a silent visual change, and the
   * sheet is compared to these constants character for character by
   * `packages/card-render/test/parity.test.ts` and `board.test.ts`.
   */
  it('returns the text of the number and nothing else', () => {
    expect(cssNumber(9.5)).toBe('9.5');
    expect(cssNumber(63)).toBe('63');
    expect(cssNumber(0)).toBe('0');
    expect(cssNumber(-2.5)).toBe('-2.5');
    expect(cssNumber(1 / 3)).toBe('0.3333333333333333');
  });
});

describe('stylesheet interpolation', () => {
  const FILES = stylesheetSources(SRC_DIR);

  it('finds the stylesheet modules and the numbers they may interpolate', () => {
    expect(FILES.length).toBeGreaterThan(6);
    expect(FILES.some((file) => file.endsWith(join('routes', 'analysis', 'styles.ts')))).toBe(true);
    // A sheet one directory below `styles/`, which is where the board's twelve
    // surfaces live. Named rather than counted, so the walk cannot pass by
    // finding some other file.
    expect(FILES.some((file) => file.endsWith(join('styles', 'board', 'slot.ts')))).toBe(true);
    expect([...NUMERIC_NAMES].sort()).toEqual([
      'ART_WINDOW',
      'CARD_TRIM_MM',
      'COMPACT_FACE_WIDTH_REM',
      'FRAME_BAND_MM',
      'FULL_FACE_WIDTH_REM',
      'LOYALTY_BADGE_GUTTER',
      'LOYALTY_BADGE_PAD_PX',
      'LOYALTY_BADGE_SHARE',
      'LOYALTY_FIT_STEPS',
      'LOYALTY_SHIELD_FLAT',
      'LOYALTY_SHIELD_SHARE',
      'NAME_FIT_STEPS',
      'PIP_GLYPH_SCALE',
      'PIP_GLYPH_STROKE',
      'PIP_GLYPH_UNITS',
      'PLANESWALKER_ART_WINDOW',
      'RULES_FIT_STEPS',
      'TITLE_PIP_TO_TEXT',
    ]);
  });

  it('routes every interpolated anatomy number through the guard', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const expression of placeholders(readFileSync(file, 'utf8'))) {
        const numeric = NUMERIC_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(expression));
        if (numeric && !expression.startsWith('cssNumber(')) offenders.push(`${file}: \${${expression}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The shape of the attack the guard closes: a value carrying `}` closes its
   * rule early and everything after it is a selector block the author never
   * wrote. A sheet whose braces balance has had no rule closed for it.
   */
  it('emits a sheet whose braces balance', () => {
    const sheet = uiStyleSheet();
    const opened = sheet.split('{').length - 1;
    const closed = sheet.split('}').length - 1;
    expect(opened).toBe(closed);
    expect(opened).toBeGreaterThan(100);
  });
});
