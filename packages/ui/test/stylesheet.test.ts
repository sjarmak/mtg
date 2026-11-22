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
 * **It also reaches the sibling package** (`mtg-bc2.91`).
 * `@mtg/card-render`'s `palette.ts` assembles a sheet that `render.ts` embeds
 * through `svg.ts`'s `styleEl()`, which wraps CSS in CDATA and deliberately does
 * not escape it — the same primitive, so the same exposure, and it imports from
 * `@mtg/ui` so the anatomy numbers are one import away. `svg.ts`'s `num()` is
 * not the guard for this: it rounds to three decimals, which is right for an SVG
 * coordinate and wrong for a CSS token, so the two stay separate on purpose.
 * The check lives here rather than in `@mtg/card-render` because the rule is one
 * rule, and a second copy of it is a second thing to keep in step. It reads that
 * file rather than importing it, so no package arrow is created either way.
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
import { cssBlock, cssNumber, cssSelector } from '../src/styles/number';
import { uiStyleSheet } from '../src/styles/index';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** `@mtg/card-render`'s sheet, read as a path so no import arrow is drawn. */
const CARD_RENDER_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'card-render', 'src');

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

/**
 * The sheets in `@mtg/card-render`: a `styles/` directory or a `styles.ts` if
 * one ever appears, and `palette.ts`, which is the one that exists today. Named
 * by the same rule as the walk above plus that one file, so a sheet split out of
 * it later is covered without anyone remembering to come back.
 */
function cardRenderSheets(dir: string, insideStyles = false): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...cardRenderSheets(path, insideStyles || entry.name === 'styles'));
    } else if (
      entry.name.endsWith('.ts') &&
      (insideStyles || entry.name === 'styles.ts' || entry.name === 'palette.ts')
    ) {
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
 * The numbers a file makes a local name for, which the scan has to follow.
 *
 * `mtg-bc2.99` measured the hole: rewriting `styles/board.ts` as
 * `const SLOT_WIDTH = COMPACT_FACE_WIDTH_REM; … width: ${SLOT_WIDTH}rem` left
 * all six tests green, because the scan matched the constant's *name* inside
 * the placeholder and an alias does not carry it. Hoisting is house style here
 * — `card.ts` does it — so the next author following the style was one step
 * from a sink the guard could not see.
 *
 * A **bare** initializer only. `card.ts`'s
 * `const GLYPH_EXTENT = \`${cssNumber(PIP_GLYPH_SCALE * 100)}%\`` is a string
 * of CSS text whose own placeholder is already guarded, and calling that alias
 * numeric would demand `cssNumber(GLYPH_EXTENT)` at a site that interpolates a
 * percentage. So an alias counts when its initializer mentions a numeric name,
 * holds no quote or backtick, and does not route through the guard — which is
 * exactly the mutation above and exactly not the hoist beside it.
 */
function numericAliases(text: string, names: readonly string[]): readonly string[] {
  const found = new Set<string>();
  const mentions = (expression: string): boolean =>
    [...names, ...found].some((name) => new RegExp(`\\b${name}\\b`).test(expression));
  // Repeated to a fixed point: an alias of an alias is still an alias.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = found.size;
    for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*([^;]*);/g)) {
      const [, name, initializer] = match as unknown as [string, string, string];
      if (found.has(name) || /['"`]/u.test(initializer) || initializer.includes('cssNumber(')) continue;
      if (mentions(initializer)) found.add(name);
    }
    if (found.size === before) break;
  }
  return [...found];
}

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

describe('cssSelector and cssBlock', () => {
  /**
   * `mtg-bc2.109`: `scopedPalette` and `viewportScheme` interpolate a selector
   * and two declaration blocks into live CSS, which is the same primitive
   * `cssNumber` guards one shape up. The payload the bead names is a value
   * carrying `}`; the payload `mtg-bc2.99` names is one that closes what it
   * opens, which a brace count cannot see and this refusal does not need to.
   */
  it('takes the selectors the sheet actually builds', () => {
    expect(cssSelector("[data-mtg-mode='play']")).toBe("[data-mtg-mode='play']");
    expect(cssSelector(':root:not([data-theme="light"]) .mtg-shell > .mtg-card:hover')).toContain(
      '.mtg-card',
    );
  });

  it('refuses a selector that could open or close a rule, naming it', () => {
    expect(() => cssSelector("[data-mtg-mode='play'] { color: red } *")).toThrow(/cannot/);
    expect(() => cssSelector('')).toThrow(/expected a selector/);
    expect(() => cssSelector(null as unknown as string)).toThrow(/expected a selector/);
  });

  it('takes a block of declarations, comments included, because palettes carry them', () => {
    expect(cssBlock('\n  --mtg-ink: black;\n')).toContain('--mtg-ink');
    expect(cssBlock('/* paper */ --mtg-ink: black;')).toContain('paper');
  });

  it('refuses a block holding either brace, and an unterminated comment', () => {
    // The exact injection mtg-bc2.99 measured sailing past the brace-balance
    // test: it closes what it opens, so the sheet still balances.
    expect(() => cssBlock('9.5rem; } * { display: none !important; } .x { color: red')).toThrow(
      /may not open or close/,
    );
    expect(() => cssBlock('--mtg-ink: black; /* unclosed')).toThrow(/unterminated comment/);
    expect(() => cssBlock(9.5 as unknown as string)).toThrow(/expected a declaration block/);
  });
});

describe('stylesheet interpolation', () => {
  const FILES = [...stylesheetSources(SRC_DIR), ...cardRenderSheets(CARD_RENDER_SRC)];

  it('finds the stylesheet modules and the numbers they may interpolate', () => {
    expect(FILES.length).toBeGreaterThan(6);
    // The printed sheet, in the package next door. Named rather than counted for
    // the reason the board sheet below is: a walk that finds some other file has
    // not found this one.
    expect(FILES.some((file) => file.endsWith(join('card-render', 'src', 'palette.ts')))).toBe(true);
    expect(FILES.some((file) => file.endsWith(join('routes', 'analysis', 'styles.ts')))).toBe(true);
    // A sheet one directory below `styles/`, which is where the board's twelve
    // surfaces live. Named rather than counted, so the walk cannot pass by
    // finding some other file.
    expect(FILES.some((file) => file.endsWith(join('styles', 'board', 'slot.ts')))).toBe(true);
    // A superset rather than an equality (`mtg-bc2.99`). These names are the
    // canary: one of them leaving `anatomy.ts` under a rename, or losing its
    // `number` annotation, takes a guarded site out of the scan silently. A
    // name ARRIVING is the case the docblock above promises to cover for free,
    // and an equality made that promise false — it turned every new constant
    // into a red test in a file the author had no reason to open.
    expect([...NUMERIC_NAMES].sort()).toEqual(
      expect.arrayContaining([
        'ART_WINDOW',
        'CARD_EDGE_MM',
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
        'RULES_TEXT_REM',
        'RULES_TEXT_SHARE',
        'TITLE_PIP_TO_TEXT',
      ]),
    );
  });

  /** Every unguarded interpolation of an anatomy number, alias or not. */
  function unguarded(file: string, text: string): readonly string[] {
    const names = [...NUMERIC_NAMES, ...numericAliases(text, NUMERIC_NAMES)];
    return placeholders(text)
      .filter(
        (expression) =>
          names.some((name) => new RegExp(`\\b${name}\\b`).test(expression)) &&
          !expression.startsWith('cssNumber('),
      )
      .map((expression) => `${file}: \${${expression}}`);
  }

  it('routes every interpolated anatomy number through the guard', () => {
    expect(FILES.flatMap((file) => unguarded(file, readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('follows a local alias, which is how the guard was bypassed', () => {
    // mtg-bc2.99's mutation, verbatim in shape. It left all six tests green.
    const aliased = [
      'const SLOT_WIDTH = COMPACT_FACE_WIDTH_REM;',
      'const NESTED = SLOT_WIDTH;',
      'export const RULE = `.mtg-slot { width: ${NESTED}rem; }`;',
    ].join('\n');
    expect(unguarded('board.ts', aliased)).toEqual(['board.ts: ${NESTED}']);
  });

  it('leaves the hoisted CSS string alone, because its own placeholder is guarded', () => {
    // card.ts's shape. Calling this alias numeric would demand cssNumber() on a
    // percentage, which is a false red at a site that is already correct.
    const hoisted = [
      'const GLYPH_EXTENT = `${cssNumber(PIP_GLYPH_SCALE * 100)}%`;',
      'export const RULE = `.mtg-pip { width: ${GLYPH_EXTENT}; }`;',
    ].join('\n');
    expect(unguarded('card.ts', hoisted)).toEqual([]);
  });

  /**
   * A smoke check, and it is worth saying so rather than letting the name
   * imply more. `mtg-bc2.99` measured what it does not catch: the payload
   * `9.5rem; } * { display: none !important; } .x {` lands in live CSS and the
   * sheet still reports 248 opened against 248 closed. Any injection that
   * closes what it opens sails through a count, and a competent one does.
   *
   * The refusal that does catch it is `cssBlock` (`mtg-bc2.109`), tested
   * above, which never counts anything. What this still buys is the sheet
   * being assembled at all and being the size of a stylesheet, which is the
   * failure a broken join or an empty module produces.
   */
  it('emits an assembled sheet whose braces balance, which is a smoke check and not the guard', () => {
    const sheet = uiStyleSheet();
    const opened = sheet.split('{').length - 1;
    const closed = sheet.split('}').length - 1;
    expect(opened).toBe(closed);
    expect(opened).toBeGreaterThan(100);
  });
});
