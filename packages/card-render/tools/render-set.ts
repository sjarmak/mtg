/**
 * Renders a whole set file to SVGs on disk and prints the fit report.
 *
 * Usage:
 *   npx tsx packages/card-render/tools/render-set.ts <set.json> <out-dir> [art.json]
 *                                                    [--theme light|dark|auto] [--bleed [mm]]
 *
 * Exits non-zero when any card failed to fit, so it works as a gate as well as
 * a way to eyeball a set. The companion `check-overflow.py` re-measures the
 * emitted files against a real installed font, which is the check this script
 * cannot do — it shares a metrics table with the renderer it is checking.
 *
 * The theme defaults to `light` here and to `auto` in the renderer, and the
 * difference is the point. `auto` leaves the choice to whatever opens the file,
 * which is right for a card inlined into a page that already has a theme, and
 * wrong for a directory of standalone files whose next stop is a printer: a
 * viewer set to dark prints a set of near-black cards on ink that costs money.
 * `--theme auto` is still there for anyone who wants the file to follow along.
 *
 * `--symbols original` is the publish flag. This tool draws a card's brace
 * tokens with the referenced symbol set by default, which is right for looking
 * at a card on this machine and wrong for a file that leaves it: `original`
 * swaps every symbol for the lab's own drawing, so the emitted file references
 * no third-party artwork and names no other host. `@mtg/ui`'s `card/symbols.ts`
 * carries the licensing argument behind the sets.
 *
 * `--symbols local` is accepted because it is a set the registry states, and it
 * is not useful here: it addresses each symbol relative to the page serving it,
 * which is the lab's own origin and not a directory of SVGs on their way to a
 * printer. The two useful values for a file are `scryfall` and `original`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCards } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { SYMBOL_SETS } from '@mtg/ui';
import type { SymbolSet } from '@mtg/ui';
import { artRegistry, DEFAULT_BLEED_MM, formatFitReport, parseArtManifest, renderSet } from '../src/index';
import type { ArtResolver, CardTheme } from '../src/index';

const THEMES: readonly CardTheme[] = ['auto', 'light', 'dark'];

/** What the tool was asked to render; `null` when the arguments do not say. */
export interface RenderSetArgs {
  readonly setPath: string;
  readonly outDir: string;
  readonly artPath: string | undefined;
  readonly theme: CardTheme;
  /**
   * Bleed in millimeters. Zero here rather than `DEFAULT_BLEED_MM`, because
   * most runs of this tool are somebody looking at a set, and a card-sized file
   * is what they want. `--bleed` with no value takes the standard 3 mm.
   */
  readonly bleedMm: number;
  /** `undefined` leaves the renderer's own default; see the module docblock. */
  readonly symbols: SymbolSet | undefined;
}

function isTheme(value: string): value is CardTheme {
  return (THEMES as readonly string[]).includes(value);
}

function isSymbolSet(value: string): value is SymbolSet {
  return (SYMBOL_SETS as readonly string[]).includes(value);
}

/**
 * Splits the flags out of the argument list and leaves the positionals where
 * they were, so a flag can be written before, between or after them.
 */
export function parseRenderSetArgs(argv: readonly string[]): RenderSetArgs | string {
  const positional: string[] = [];
  let theme: CardTheme = 'light';
  let bleedMm = 0;
  let symbols: SymbolSet | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--symbols') {
      const value = argv[index + 1];
      if (value === undefined) return `--symbols needs a value: ${SYMBOL_SETS.join(' or ')}`;
      if (!isSymbolSet(value)) return `--symbols ${value}: expected ${SYMBOL_SETS.join(' or ')}`;
      symbols = value;
      index += 1;
      continue;
    }
    if (argument === '--theme') {
      const value = argv[index + 1];
      if (value === undefined) return '--theme needs a value: light, dark or auto';
      if (!isTheme(value)) return `--theme ${value}: expected light, dark or auto`;
      theme = value;
      index += 1;
      continue;
    }
    if (argument === '--bleed') {
      const value = argv[index + 1];
      const millimeters = value === undefined ? Number.NaN : Number(value);
      // A bare `--bleed` means the standard bleed. A dash-prefixed token is the
      // next flag rather than this one's argument — unless it parses as a
      // number, because `--bleed -2` is a mistake worth reporting and not a
      // reason to quietly take the default and file `-2` away as a path.
      if (value === undefined || (value.startsWith('-') && !Number.isFinite(millimeters))) {
        bleedMm = DEFAULT_BLEED_MM;
        continue;
      }
      if (!Number.isFinite(millimeters) || millimeters < 0) {
        return `--bleed ${value}: expected a non-negative number of millimeters`;
      }
      bleedMm = millimeters;
      index += 1;
      continue;
    }
    positional.push(argument);
  }
  const [setPath, outDir, artPath] = positional;
  if (setPath === undefined || outDir === undefined) return 'usage';
  return { setPath, outDir, artPath, theme, bleedMm, symbols };
}

function readCards(path: string): readonly Card[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('cards' in parsed)) {
    throw new Error(`${path}: not a set file (no "cards" array)`);
  }
  const cards: unknown = (parsed as { cards: unknown }).cards;
  if (!Array.isArray(cards)) {
    throw new Error(`${path}: "cards" is ${typeof cards}, not an array`);
  }
  return parseCards(cards);
}

export function main(argv: readonly string[]): number {
  const parsed = parseRenderSetArgs(argv);
  if (typeof parsed === 'string') {
    const detail = parsed === 'usage' ? '' : `${parsed}\n`;
    process.stderr.write(
      `${detail}usage: render-set.ts <set.json> <out-dir> [art.json] [--theme light|dark|auto] ` +
        `[--bleed [mm]] [--symbols scryfall|original]\n`,
    );
    return 2;
  }
  const { setPath, outDir, artPath, theme, bleedMm, symbols } = parsed;
  const cards = readCards(setPath);
  const art: ArtResolver | undefined =
    artPath === undefined
      ? undefined
      : artRegistry(parseArtManifest(JSON.parse(readFileSync(artPath, 'utf8'))));

  const result = renderSet(cards, {
    theme,
    bleedMm,
    ...(art === undefined ? {} : { art }),
    ...(symbols === undefined ? {} : { symbols }),
  });
  mkdirSync(outDir, { recursive: true });
  for (const render of result.renders) {
    writeFileSync(join(outDir, `${render.cardId}.svg`), render.svg, 'utf8');
  }
  writeFileSync(join(outDir, 'fit-report.json'), `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${formatFitReport(result.report)}\n`);
  process.stdout.write(`wrote ${result.renders.length} files to ${outDir}\n`);
  return result.report.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
