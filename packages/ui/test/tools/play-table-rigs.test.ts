/**
 * The four measuring rigs that render the play table still write their pages.
 *
 * `mtg-uvey`. `../../src/routes/play/table.ts`'s `playTable` reads as a builder
 * and is a component body: it calls `useKeptRing`. Four tools called it at
 * module scope, and when that hook arrived at `6a046473` all four began throwing
 * `Cannot read properties of null (reading 'useRef')` before writing a byte.
 * Nothing noticed for as long as nobody needed a measurement, and the way that
 * surfaced was a bead asking for a number a dead rig could not produce.
 *
 * Typecheck cannot see it -- calling a component as a function is a legal call
 * -- and no unit test reaches it, because each of these tools does its work at
 * import and would write files into the repo if a test imported it. So the gate
 * is the process boundary the tools already have: run each one at a temporary
 * output directory and require the pages it advertises.
 *
 * The pages are named rather than counted, because a rig that silently stopped
 * writing its second page is the same class of failure as one that stopped
 * writing at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const TEMP = mkdtempSync(join(tmpdir(), 'mtg-play-table-rigs-'));

afterAll(() => {
  rmSync(TEMP, { recursive: true, force: true });
});

interface Rig {
  readonly tool: string;
  readonly pages: readonly string[];
}

const RIGS: readonly Rig[] = [
  { tool: 'touch-targets', pages: ['touch-targets-table.html', 'touch-targets-menu.html'] },
  { tool: 'cast-panel', pages: ['cast-targets.html', 'cast-payment.html'] },
  { tool: 'step-bar', pages: ['step-bar.html'] },
  { tool: 'turn-stops-panel', pages: ['turn-stops.html'] },
];

describe('the rigs that render the play table outside an app', () => {
  for (const rig of RIGS) {
    it(`${rig.tool} writes ${String(rig.pages.length)} page(s)`, () => {
      const out = join(TEMP, rig.tool);
      execFileSync('npx', ['tsx', join('packages', 'ui', 'tools', `${rig.tool}.ts`), out], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      for (const page of rig.pages) {
        expect(existsSync(join(out, page)), `${rig.tool} wrote no ${page}`).toBe(true);
      }
    }, 120_000);
  }
});
