/**
 * No launcher may import another launcher.
 *
 * `tools/play.ts` calls `main()` at module scope, so importing it for one
 * constant starts the play launcher and Vite as a side effect of the import.
 * That is not hypothetical: `netplay.ts` imported `flagshipOnly` from it, and
 * running the netplay launcher started a second server nobody asked for
 * (`mtg-nkmo`). The fix moved `flagshipOnly` into `set-candidates.ts`, whose own
 * docblock says why it exists; this test is what keeps the shape from coming
 * back, since the failure looks like an extra tab rather than an error.
 *
 * The rule is stated as "no `tools/` file imports `./play`" rather than "no file
 * imports a module with side effects", because the second cannot be checked by
 * reading text and the first is exactly the mistake that was made.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOLS = new URL('../../tools/', import.meta.url).pathname;

function toolFiles(): readonly string[] {
  return readdirSync(TOOLS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(TOOLS, entry.name));
}

/** `import … from './play'`, `import './play'`, and the dynamic and require forms. */
const IMPORTS_PLAY = /(?:from|import|require)\s*\(?\s*['"]\.\/play(?:\.[jt]s)?['"]/;

describe('the tools directory', () => {
  it('has launchers to check', () => {
    const files = toolFiles();
    expect(files.length).toBeGreaterThan(1);
    expect(files.map((file) => basename(file))).toContain('play.ts');
    expect(files.map((file) => basename(file))).toContain('netplay.ts');
  });

  it('contains no file that imports ./play', () => {
    const offenders = toolFiles().filter((file) => {
      if (basename(file) === 'play.ts') return false;
      return IMPORTS_PLAY.test(readFileSync(file, 'utf8'));
    });
    expect(
      offenders.map((file) => basename(file)),
      'importing ./play runs its main() and starts Vite; put the shared value in set-candidates.ts',
    ).toEqual([]);
  });

  it('recognizes the import it is looking for', () => {
    // A positive control: the pattern must actually match the shape it forbids,
    // or an empty offender list would prove nothing.
    expect(IMPORTS_PLAY.test("import { flagshipOnly } from './play';")).toBe(true);
    expect(IMPORTS_PLAY.test("import './play.js';")).toBe(true);
    expect(IMPORTS_PLAY.test("const mod = await import('./play');")).toBe(true);
    expect(IMPORTS_PLAY.test("import { flagshipOnly } from './set-candidates';")).toBe(false);
    expect(IMPORTS_PLAY.test("import { resolveDeck } from './resolve-deck';")).toBe(false);
  });
});
