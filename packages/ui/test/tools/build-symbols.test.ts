/**
 * A built page paints the symbols it is built beside.
 *
 * `mtg-f1bl`. `vite.config.ts` compiles `__MTG_SYMBOL_SET__` from
 * `MTG_SYMBOL_SET`, and only `tools/play.ts` and `tools/lab.ts` ever set it. A
 * dev server is always started by one of those, so that held; a build was
 * `vite build` with no launcher in front of it, so it compiled in the empty
 * string, which `symbolSetFrom` reads as `original` — the lab's own drawings.
 * Every built artifact shipped that way, drawing its own pips beside a
 * `dist/symbols/` holding all 39 real files. Nothing said so: a launcher prints
 * the set it staged and a build printed nothing at all, so the page looked
 * finished and read wrong. Both frozen lab builds were affected, and it was
 * spotted by eye rather than by a gate.
 *
 * The launcher is the fix, because the launcher is where this decision already
 * lives. What the tests below hold is the seam rather than the staging, which
 * `stage-symbols.test.ts` already covers: the script has to go *through* a
 * launcher, and the launcher has to hand Vite the set it actually staged.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildEnv, viteBuildArgs } from '../../tools/build-args';

const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

describe('the build script', () => {
  it('goes through the launcher, because a bare vite build stages nothing', () => {
    const scripts = (
      JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(
      scripts['build'],
      "A bare `vite build` compiles in the lab's own drawn symbols however many real " +
        'ones are staged beside it, and says nothing. Point this at tools/build.ts.',
    ).not.toMatch(/^vite build/);
    expect(scripts['build']).toMatch(/tools\/build\.ts/);
  });
});

describe('what the launcher hands Vite', () => {
  it('names the set that was actually staged', () => {
    expect(buildEnv('local', '', {})['MTG_SYMBOL_SET']).toBe('local');
    expect(buildEnv('original', '', {})['MTG_SYMBOL_SET']).toBe('original');
  });

  it('names the set icons that were actually staged', () => {
    expect(buildEnv('local', 'M11,M13', {})['MTG_SET_ICONS']).toBe('M11,M13');
  });

  it('names no set icons when none were staged', () => {
    expect(buildEnv('local', '', {})['MTG_SET_ICONS']).toBe('');
  });

  it('overrides an inherited variable, so a stale export cannot outrank the staging run', () => {
    expect(
      buildEnv('original', 'M11', { MTG_SYMBOL_SET: 'local', MTG_SET_ICONS: 'ISD' })['MTG_SYMBOL_SET'],
    ).toBe('original');
    expect(
      buildEnv('original', 'M11', { MTG_SYMBOL_SET: 'local', MTG_SET_ICONS: 'ISD' })['MTG_SET_ICONS'],
    ).toBe('M11');
  });

  it('keeps the rest of the environment, which is how npx finds anything at all', () => {
    expect(buildEnv('local', '', { PATH: '/usr/bin' })['PATH']).toBe('/usr/bin');
  });

  it('forwards the flags it was given, so --outDir still reaches Vite', () => {
    expect(viteBuildArgs([])).toEqual(['vite', 'build']);
    expect(viteBuildArgs(['--outDir', 'out/frozen'])).toEqual(['vite', 'build', '--outDir', 'out/frozen']);
  });
});
