/**
 * The token discipline, enforced.
 *
 * Three properties, each of which has failed in a real codebase before: a raw
 * color literal smuggled into a component, a token referenced but never
 * declared, and a dark palette that quietly drifts behind the light one.
 *
 * A palette scoped to one route can fail all three the same way, so the second
 * half of this file holds every registered scope to the same rules and adds the
 * one only a scope can break: a token that exists nowhere but inside it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOARD_SURFACE_TOKEN,
  COLOR_IDENTITIES,
  DARK_TOKENS,
  LIGHT_TOKENS,
  MAT_DARK_TOKENS,
  MAT_LIGHT_TOKENS,
  MAT_TOKEN_CSS,
  ROUTE_SCOPE_ATTRIBUTE,
  SUB_SCOPE_ATTRIBUTE,
  SCALE_TOKENS,
  SCOPED_PALETTES,
  SCOPED_TOKEN_CSS,
  TOKEN_CSS,
  nativeDeclarations,
  routeScope,
  scopedPalette,
  subScope,
  viewScope,
  viewportScheme,
} from '../src/styles/tokens';
import { uiStyleSheet } from '../src/styles/index';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

function declaredIn(block: string): ReadonlySet<string> {
  return new Set([...block.matchAll(/(--mtg-[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''));
}

const FILES = sourceFiles(SRC_DIR);

const DECLARED: ReadonlySet<string> = new Set([
  ...declaredIn(LIGHT_TOKENS),
  ...declaredIn(DARK_TOKENS),
  ...declaredIn(SCALE_TOKENS),
  ...declaredIn(MAT_LIGHT_TOKENS),
  ...declaredIn(MAT_DARK_TOKENS),
]);

describe('design tokens', () => {
  it('finds the whole source tree', () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  it('has no raw color literal anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const [index, line] of text.split('\n').entries()) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\b(?:rgba?|hsla?)\(/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Only names written out in full. A rule built by interpolation —
   * `var(--mtg-frame-${identity})` — has no token to check until the string is
   * assembled, which is what the next test is for.
   */
  it('declares every token a source file names outright', () => {
    const missing = new Set<string>();
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/var\((--mtg-[a-z0-9-]+)[),]/g)) {
        const token = match[1] ?? '';
        if (!DECLARED.has(token)) missing.add(`${token} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  /**
   * The same property over the sheet that actually ships, which is where a
   * generated rule's token finally has a name. Source text alone would let
   * `--mtg-frame-${identity}` past for an identity with no palette.
   */
  it('declares every token the assembled sheet references', () => {
    const missing = new Set<string>();
    for (const match of uiStyleSheet().matchAll(/var\((--mtg-[a-z0-9-]+)[),]/g)) {
      const token = match[1] ?? '';
      if (!DECLARED.has(token)) missing.add(token);
    }
    expect([...missing]).toEqual([]);
  });

  it('keeps light and dark declaring exactly the same palette', () => {
    const light = [...declaredIn(LIGHT_TOKENS)].sort();
    const dark = [...declaredIn(DARK_TOKENS)].sort();
    expect(dark).toEqual(light);
    expect(light.length).toBeGreaterThan(30);
  });

  /**
   * Six, and it was four until the card's interior stopped being neutral paper:
   * a face draws its ground from `--mtg-frame-<id>`, its bars and rules box from
   * `-panel`, its art window from `-well` and every keyline from `-edge`. A
   * palette that declared five would leave one surface of one identity resolving
   * to nothing, which paints an unstyled box rather than failing.
   */
  it('declares six tokens for every color identity, in both themes', () => {
    for (const identity of COLOR_IDENTITIES) {
      for (const block of [LIGHT_TOKENS, DARK_TOKENS]) {
        const declared = declaredIn(block);
        expect(declared.has(`--mtg-color-${identity}`)).toBe(true);
        expect(declared.has(`--mtg-color-${identity}-on`)).toBe(true);
        expect(declared.has(`--mtg-frame-${identity}`)).toBe(true);
        expect(declared.has(`--mtg-frame-${identity}-panel`)).toBe(true);
        expect(declared.has(`--mtg-frame-${identity}-well`)).toBe(true);
        expect(declared.has(`--mtg-frame-${identity}-edge`)).toBe(true);
      }
    }
  });

  it('resolves a theme for every viewer preference', () => {
    expect(TOKEN_CSS).toContain(':root {');
    expect(TOKEN_CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(TOKEN_CSS).toContain(":root:not([data-theme='light'])");
    expect(TOKEN_CSS).toContain(":root[data-theme='dark']");
  });

  it('ships the tokens ahead of the rules that use them', () => {
    const sheet = uiStyleSheet();
    expect(sheet.indexOf('--mtg-surface-page:')).toBeLessThan(sheet.indexOf('.mtg-card'));
    expect(sheet).toContain('.mtg-art__pending-label');
  });
});

/**
 * A scope is held to the two properties `:root` is held to — light and dark
 * declare exactly the same names, and every name is one the document already
 * has a value for — plus the one failure only a scope can produce: a token
 * declared *only* inside the scope leaves every other route resolving it to
 * nothing, which paints an invisible or unstyled element rather than failing.
 */
function paletteFaults(name: string, light: string, dark: string): readonly string[] {
  const faults: string[] = [];
  const inLight = declaredIn(light);
  const inDark = declaredIn(dark);
  if (inLight.size === 0) faults.push(`${name}: declares no token at all`);
  for (const token of [...inLight].sort()) {
    if (!inDark.has(token)) faults.push(`${name}: ${token} is light-only`);
  }
  for (const token of [...inDark].sort()) {
    if (!inLight.has(token)) faults.push(`${name}: ${token} is dark-only`);
  }
  for (const token of [...new Set([...inLight, ...inDark])].sort()) {
    if (!DECLARED.has(token)) faults.push(`${name}: ${token} has no value at :root`);
  }
  return faults;
}

/**
 * A coherent scope and its two ways of going wrong, written here rather than
 * registered. Every registered scope now carries the same paper palette, which
 * is a palette that cannot drift from itself and cannot invent a name, so the
 * two faults below would have nothing to bite on if they were only ever asked
 * of the registry.
 */
const FIXTURE_LIGHT = `
  --mtg-surface-page: oklch(0.960 0.008 85);
  --mtg-ink: oklch(0.22 0.014 60);
`;
const FIXTURE_DARK = `
  --mtg-surface-page: oklch(0.170 0.010 265);
  --mtg-ink: oklch(0.950 0.006 265);
`;
const DRIFTED_DARK = `
  --mtg-surface-page: oklch(0.170 0.010 265);
`;
const INVENTED_LIGHT = `
  --mtg-table-felt: oklch(0.960 0.008 85);
`;
const INVENTED_DARK = `
  --mtg-table-felt: oklch(0.170 0.010 265);
`;

describe('the scope a sheet keys on', () => {
  // The shell stamps the mode and the section as two attributes, and a sheet
  // about one section keys on both: a mode's scope alone reaches every section
  // of it, which is how a mat fitted for Replay would fit the explorer too.
  // The section half sits inside `:where()` so the pair weighs one attribute,
  // the same as a mode alone; the fitted-board `:is()` list in
  // styles/board/geometry.ts takes its widest argument's weight, and a heavier
  // list outweighed the unscoped overrides written to tie with it.
  it('names the mode, the section, and the pair as one selector', () => {
    expect(routeScope('play')).toBe(`[${ROUTE_SCOPE_ATTRIBUTE}='play']`);
    expect(subScope('replay')).toBe(`[${SUB_SCOPE_ATTRIBUTE}='replay']`);
    expect(viewScope('analysis', 'replay')).toBe(`${routeScope('analysis')}:where(${subScope('replay')})`);
  });
});

describe('scoped palettes', () => {
  it('resolves a theme for every viewer preference, the way :root does', () => {
    const css = scopedPalette(routeScope('play'), FIXTURE_LIGHT, FIXTURE_DARK);
    expect(css).toContain(`[${ROUTE_SCOPE_ATTRIBUTE}='play'] {`);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(`:root:not([data-theme='light']) [${ROUTE_SCOPE_ATTRIBUTE}='play'] {`);
    expect(css).toContain(`:root[data-theme='dark'] [${ROUTE_SCOPE_ATTRIBUTE}='play'] {`);
  });

  it('holds every registered scope to the same rule as :root', () => {
    const faults = [...SCOPED_PALETTES].flatMap(([mode, palette]) =>
      paletteFaults(mode, palette.light, palette.dark),
    );
    expect(faults).toEqual([]);
  });

  it('catches a scope whose two palettes have drifted apart', () => {
    expect(paletteFaults('fixture', FIXTURE_LIGHT, FIXTURE_DARK)).toEqual([]);
    expect(paletteFaults('drifted', FIXTURE_LIGHT, DRIFTED_DARK)).toEqual([
      'drifted: --mtg-ink is light-only',
    ]);
    expect(paletteFaults('blank', '', '')).toEqual(['blank: declares no token at all']);
  });

  it('catches a scope declaring a token only in its dark half', () => {
    // The one branch of paletteFaults that had no fixture, while its three
    // siblings all did (`mtg-bc2.108`).
    expect(paletteFaults('dark-only', DRIFTED_DARK, FIXTURE_DARK)).toEqual([
      'dark-only: --mtg-ink is dark-only',
    ]);
  });

  it('catches a scope inventing a token the document has no value for', () => {
    expect(paletteFaults('invented', INVENTED_LIGHT, INVENTED_DARK)).toEqual([
      'invented: --mtg-table-felt has no value at :root',
    ]);
  });

  /**
   * Order matters for the root rule each scope carries, not for the palette.
   *
   * The palette lands on the shell `div` and `:root` lands on `html`, so they
   * are declarations on different elements and never compete: the div's own
   * value beats the inherited one at any order (`mtg-bc2.108`, disproved in a
   * real engine). What does compete is `viewportScheme`'s `:root:has(SCOPE)`,
   * which ties with `TOKEN_CSS`'s own root guards and wins on order alone.
   *
   * Outside `TOKEN_CSS` for an unrelated reason:
   * `packages/card-render/src/palette.ts` embeds it verbatim in every
   * standalone SVG, where there is no shell and no route to scope on.
   */
  it('ships the scopes after the document palette and outside it', () => {
    const sheet = uiStyleSheet();
    expect(sheet.startsWith(`${TOKEN_CSS}\n${SCOPED_TOKEN_CSS}`)).toBe(true);
    expect(TOKEN_CSS).not.toContain(ROUTE_SCOPE_ATTRIBUTE);
    // Pinned against a `startsWith` that would degenerate to `TOKEN_CSS + '\n'`
    // if `SCOPED_PALETTES` were ever empty: the scoped block is real text, and
    // the root rule whose order is load-bearing is in it and lands after the
    // guards it beats.
    expect(SCOPED_TOKEN_CSS.length).toBeGreaterThan(0);
    expect(sheet.indexOf(':root:has(')).toBeGreaterThan(sheet.indexOf(":root:not([data-theme='light'])"));
  });
});

/**
 * The playmat's surfaces are the one part of the palette a card file must not
 * carry, and that is the whole reason they are declared in their own block
 * rather than in `LIGHT_TOKENS` beside everything else: `@mtg/card-render`
 * embeds `TOKEN_CSS` verbatim into every standalone SVG, so a name added there
 * changes the bytes of every printed face. The half of that claim about the
 * printed face is asserted where the printed face is, in
 * `packages/card-render/test/parity.test.ts`; this is the half about the block.
 */
describe('the playmat surfaces', () => {
  const MAT_TOKENS = [...declaredIn(MAT_LIGHT_TOKENS)].sort();

  it('declares a mat, its weave, its wells, its edge, its two bands and its shadow', () => {
    expect(MAT_TOKENS).toEqual([
      '--mtg-mat',
      '--mtg-mat-band-far',
      '--mtg-mat-band-far-edge',
      '--mtg-mat-band-far-ink',
      '--mtg-mat-band-far-lit',
      '--mtg-mat-band-near',
      '--mtg-mat-band-near-edge',
      '--mtg-mat-band-near-ink',
      '--mtg-mat-band-near-lit',
      '--mtg-mat-edge',
      '--mtg-mat-seam',
      '--mtg-mat-weave',
      '--mtg-mat-well',
      '--mtg-shadow-table',
    ]);
  });

  it('holds the block to the same rule as :root', () => {
    expect(paletteFaults('mat', MAT_LIGHT_TOKENS, MAT_DARK_TOKENS)).toEqual([]);
  });

  it('resolves a theme for every viewer preference, the way :root does', () => {
    expect(MAT_TOKEN_CSS).toContain(':root {');
    expect(MAT_TOKEN_CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(MAT_TOKEN_CSS).toContain(":root:not([data-theme='light'])");
    expect(MAT_TOKEN_CSS).toContain(":root[data-theme='dark']");
  });

  it('names every one of them so the rule can be asked of a name', () => {
    // `BOARD_SURFACE_TOKEN` is how another package checks the boundary without
    // knowing where this block lives, so a surface named outside the pattern
    // would be one nothing downstream can see.
    for (const token of MAT_TOKENS) {
      expect(BOARD_SURFACE_TOKEN.test(token), `${token} is outside the naming rule`).toBe(true);
    }
  });

  it('stays out of the block a rendered card file carries, wherever it is declared', () => {
    // Swept over everything the document declares rather than over this block,
    // so moving one of these into `LIGHT_TOKENS` fails here instead of quietly
    // leaving the sweep.
    const board = [...DECLARED].filter((token) => BOARD_SURFACE_TOKEN.test(token));
    expect(board.sort()).toEqual(MAT_TOKENS);
    for (const token of board) expect(TOKEN_CSS, `${token} reached TOKEN_CSS`).not.toContain(token);
  });

  it('reaches the page, so the board resolves every one of them', () => {
    const sheet = uiStyleSheet();
    for (const token of MAT_TOKENS) {
      expect(sheet, `${token} is never declared`).toContain(`${token}:`);
      expect(sheet, `${token} is declared and never used`).toContain(`var(${token})`);
    }
  });
});

/**
 * `color-scheme` is the one declaration in these blocks that is not a custom
 * property, and every check in this file was built from `--mtg-*` names, so it
 * was the one declaration nothing asked about. Flipping `LIGHT_TOKENS`'
 * `color-scheme: light` to `dark` ships every paper route with dark scrollbars
 * and dark native controls, and all 490 tests in this package stayed green
 * through it.
 *
 * Reading the expected value back out of the same declaration would check
 * nothing. What makes `light` the right answer is the palette's own colors — a
 * block that paints its page lighter than its ink is a light block, whatever it
 * says about itself — so that is what the declaration is measured against, and a
 * palette narrowed past either of those two names fails rather than passes.
 */

/** The lightness of a token's declared OKLCH value, which is its first number. */
function lightnessOf(block: string, token: string): number {
  const found = new RegExp(`${token}:\\s*oklch\\(\\s*([0-9.]+)`).exec(block);
  if (found === null) throw new Error(`${token} is not declared as an oklch value here`);
  return Number(found[1] ?? '');
}

/** Which scheme a palette is, read off the page it paints and the ink on it. */
function schemeOf(block: string): string {
  return lightnessOf(block, '--mtg-surface-page') > lightnessOf(block, '--mtg-ink') ? 'light' : 'dark';
}

/** The declared value of one property, custom or not. */
function declaredValue(block: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]*);`).exec(block);
  if (found === null) throw new Error(`${property} is declared nowhere in this block`);
  return (found[1] ?? '').trim();
}

/** A palette that paints in the dark and tells the browser otherwise. */
const LYING_LIGHT = `
  color-scheme: light;
  --mtg-surface-page: oklch(0.192 0.010 265);
  --mtg-ink: oklch(0.938 0.006 265);
`;

describe('the scheme a palette tells the browser it is', () => {
  it('is derived from the palette rather than from what it calls itself', () => {
    expect(schemeOf(LIGHT_TOKENS)).toBe('light');
    expect(schemeOf(DARK_TOKENS)).toBe('dark');
    expect(declaredValue(LYING_LIGHT, 'color-scheme')).toBe('light');
    expect(schemeOf(LYING_LIGHT)).toBe('dark');
  });

  it('matches the palette, at the document and in every registered scope', () => {
    const blocks: readonly (readonly [string, string])[] = [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
      ...[...SCOPED_PALETTES].flatMap(([mode, palette]) => [
        [`${mode} light`, palette.light] as const,
        [`${mode} dark`, palette.dark] as const,
      ]),
    ];
    expect(blocks.length).toBeGreaterThan(2);
    const faults = blocks
      .filter(([, block]) => declaredValue(block, 'color-scheme') !== schemeOf(block))
      .map(
        ([name, block]) => `${name}: says ${declaredValue(block, 'color-scheme')}, paints ${schemeOf(block)}`,
      );
    expect(faults).toEqual([]);
  });
});

/**
 * The half of a scope that cannot live on the shell.
 *
 * Custom properties reach a route by inheriting down from the scope, so the
 * shell is far enough in for all of them. The viewport is not inside the shell:
 * its scrollbar is drawn from the `color-scheme` on the root element, one level
 * above every scope, which is why a paper route that scrolled had a near-black
 * bar down its right edge however many scopes were registered.
 */
describe('what a scope hands the root', () => {
  it('is every declaration in its palette that is not a custom property', () => {
    expect(nativeDeclarations(LIGHT_TOKENS).trim()).toBe('color-scheme: light;');
    expect(nativeDeclarations(DARK_TOKENS).trim()).toBe('color-scheme: dark;');
    // A block of nothing but custom properties has nothing for the root: the
    // mat's surfaces reach the table by inheriting, like every other token.
    expect(nativeDeclarations(MAT_LIGHT_TOKENS)).toBe('');
  });

  it('does not read a comment in the palette as a declaration', () => {
    // A palette says why a value is what it is, and a sentence with a colon in
    // it used to reach the root as a rule. The QR pair carries such a comment.
    const commented = `
  color-scheme: light;
  /* Why this pair does not follow the theme: a scanner wants a light field. */
  --mtg-qr-field: oklch(1 0 0);
`;
    expect(nativeDeclarations(commented).trim()).toBe('color-scheme: light;');
  });

  it('resolves a theme for every viewer preference, the way :root does', () => {
    const css = viewportScheme(routeScope('play'), '\n  color-scheme: light;', '\n  color-scheme: dark;');
    expect(css).toContain(`:root:has([${ROUTE_SCOPE_ATTRIBUTE}='play']) {`);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(`:root:not([data-theme='light']):has([${ROUTE_SCOPE_ATTRIBUTE}='play']) {`);
    expect(css).toContain(`:root[data-theme='dark']:has([${ROUTE_SCOPE_ATTRIBUTE}='play']) {`);
  });

  it('reaches the sheet for every registered scope, in the words of its palette', () => {
    const faults: string[] = [];
    for (const [mode, palette] of SCOPED_PALETTES) {
      const rules: readonly (readonly [string, string])[] = [
        [`:root:has(${routeScope(mode)})`, nativeDeclarations(palette.light)],
        [`:root:not([data-theme='light']):has(${routeScope(mode)})`, nativeDeclarations(palette.dark)],
        [`:root[data-theme='dark']:has(${routeScope(mode)})`, nativeDeclarations(palette.dark)],
      ];
      for (const [selector, declarations] of rules) {
        if (declarations === '') faults.push(`${mode}: ${selector} would tell the viewport nothing`);
        else if (!SCOPED_TOKEN_CSS.includes(`${selector} {${declarations}}`)) {
          faults.push(`${mode}: ${selector} is not in the sheet`);
        }
      }
    }
    expect(faults).toEqual([]);
  });
});
