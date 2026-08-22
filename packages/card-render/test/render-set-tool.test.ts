/**
 * The set-to-disk tool's one decision of its own: which theme the files pin.
 *
 * `renderCardSvg` defaults to `auto` and should, because a card inlined into a
 * page belongs to that page's theme. A directory of standalone files is going
 * to a printer, and there `auto` means the viewer's setting decides — a set
 * rendered on a machine in dark mode prints as near-black cards. So the tool
 * pins `light` unless told otherwise, and this file is what says so.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BLEED_MM } from '@mtg/card-render';
import { main, parseRenderSetArgs } from '../tools/render-set';
import { stressCards } from './fixtures/cards';

/** The root `<svg …>` tag alone, which is where the theme is pinned. */
function rootTag(svg: string): string {
  const found = /<svg[^>]*>/.exec(svg);
  if (found === null) throw new Error('no root element');
  return found[0];
}

/** A set file and an output directory, both under the system temp directory. */
function workspace(): { readonly setPath: string; readonly outDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-render-set-'));
  const setPath = join(dir, 'set.json');
  writeFileSync(setPath, JSON.stringify({ cards: stressCards() }), 'utf8');
  return { setPath, outDir: join(dir, 'out') };
}

describe('the arguments', () => {
  it('pins light when the caller says nothing, because the files are for printing', () => {
    const parsed = parseRenderSetArgs(['set.json', 'out']);
    expect(parsed).toEqual({
      setPath: 'set.json',
      outDir: 'out',
      artPath: undefined,
      theme: 'light',
      bleedMm: 0,
    });
  });

  it('still lets a caller ask for the viewer to decide', () => {
    const parsed = parseRenderSetArgs(['set.json', 'out', '--theme', 'auto']);
    expect(typeof parsed === 'string' ? parsed : parsed.theme).toBe('auto');
  });

  it('takes the flag before the positionals as readily as after them', () => {
    const before = parseRenderSetArgs(['--theme', 'dark', 'set.json', 'out', 'art.json']);
    const after = parseRenderSetArgs(['set.json', 'out', 'art.json', '--theme', 'dark']);
    expect(before).toEqual(after);
    expect(before).toEqual({
      setPath: 'set.json',
      outDir: 'out',
      artPath: 'art.json',
      theme: 'dark',
      bleedMm: 0,
    });
  });

  it('takes the standard bleed from a bare --bleed and a stated one from a value', () => {
    const bare = parseRenderSetArgs(['set.json', 'out', '--bleed']);
    expect(typeof bare === 'string' ? bare : bare.bleedMm).toBe(DEFAULT_BLEED_MM);
    const stated = parseRenderSetArgs(['set.json', 'out', '--bleed', '5']);
    expect(typeof stated === 'string' ? stated : stated.bleedMm).toBe(5);
  });

  it('does not eat the next flag as the bleed value', () => {
    const parsed = parseRenderSetArgs(['set.json', 'out', '--bleed', '--theme', 'dark']);
    expect(parsed).toEqual({
      setPath: 'set.json',
      outDir: 'out',
      artPath: undefined,
      theme: 'dark',
      bleedMm: DEFAULT_BLEED_MM,
    });
  });

  it('refuses a bleed that is not a non-negative number', () => {
    expect(parseRenderSetArgs(['set.json', 'out', '--bleed', 'wide'])).toBe(
      '--bleed wide: expected a non-negative number of millimeters',
    );
    expect(parseRenderSetArgs(['set.json', 'out', '--bleed', '-2'])).toBe(
      '--bleed -2: expected a non-negative number of millimeters',
    );
  });

  it('names the mistake rather than rendering a set in some other theme', () => {
    expect(parseRenderSetArgs(['set.json', 'out', '--theme', 'sepia'])).toBe(
      '--theme sepia: expected light, dark or auto',
    );
    expect(parseRenderSetArgs(['set.json', 'out', '--theme'])).toBe(
      '--theme needs a value: light, dark or auto',
    );
  });

  it('is missing until both a set and a destination are named', () => {
    expect(parseRenderSetArgs(['set.json'])).toBe('usage');
  });
});

describe('the emitted files', () => {
  it('carry the pinned theme on the root element', () => {
    const { setPath, outDir } = workspace();
    expect(main([setPath, outDir])).toBe(0);
    const svg = readFileSync(join(outDir, `${stressCards()[0]?.id ?? ''}.svg`), 'utf8');
    expect(rootTag(svg)).toContain('data-theme="light"');
  });

  it('carry no theme at all when the caller asked for auto', () => {
    const { setPath, outDir } = workspace();
    expect(main([setPath, outDir, '--theme', 'auto'])).toBe(0);
    const svg = readFileSync(join(outDir, `${stressCards()[0]?.id ?? ''}.svg`), 'utf8');
    expect(rootTag(svg)).not.toContain('data-theme');
  });
});
