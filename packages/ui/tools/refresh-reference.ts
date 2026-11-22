/**
 * Rebuilds the reduced reference sets before the launcher stages them.
 *
 * `out/reference` is whatever the last `npm run reference:reduced` left there,
 * and what that command produces moves whenever the audited checkpoint corpus
 * grows. The build staged on 2026-08-24 was emitted on 2026-08-21 and held 162
 * of M11's 249 collector positions; the same command that morning produced 167.
 * The audited corpus has since covered all of M11, M13 and RTR, so those three now
 * emit complete builds, labeled as such (`reduced: false`).
 * Nothing on the page distinguishes a set that is missing five playable cards
 * from a set that never had them, so the staleness is invisible exactly where
 * it matters.
 *
 * The emitter is safe to run on every launch: it resolves no LLM provider,
 * reads only committed inputs, touches no network, and finishes in about 2.6
 * seconds. So the launcher runs it rather than trusting the directory.
 *
 * It is spawned rather than imported. `@mtg/dsl-coverage` is private under the
 * export tier manifest and `@mtg/ui` may not depend on it; a subprocess is the
 * boundary that keeps the public tree buildable.
 *
 * Every way it can fail is tolerated and reported: no research package (which
 * is every public export), a non-zero exit, a missing `tsx`. In each case the
 * sets already on disk are staged and the launcher says so, because refusing to
 * open a game over a reference build is worse than opening a slightly old one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The emitter, relative to the repository root. */
export const REFERENCE_TOOL = join('packages', 'dsl-coverage', 'tools', 'reference-reduced.ts');

/** Where the launcher's `referenceSetCandidates` looks, relative to the repository root. */
export const REFERENCE_OUT = join('out', 'reference');

/** What one run of the emitter did, as the launcher reports it. */
export type ReferenceRefresh =
  { readonly ran: true; readonly kept: readonly string[] } | { readonly ran: false; readonly reason: string };

/** The filesystem and the subprocess, injected so the test needs neither. */
export interface RefreshHost {
  readonly exists: (path: string) => boolean;
  readonly run: (command: string, argv: readonly string[]) => { ok: boolean; stdout: string };
}

const NODE_HOST: RefreshHost = {
  exists: existsSync,
  run: (command, argv) => {
    try {
      const stdout = execFileSync(command, [...argv], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, stdout };
    } catch (cause: unknown) {
      const shape = cause as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: shape.stderr ?? shape.stdout ?? shape.message ?? String(cause) };
    }
  },
};

/**
 * The emitter's own report, kept verbatim.
 *
 * It prints one line per set naming the positions it kept and the ones it
 * refused. Reducing that to a count here would be a second derivation of a
 * number the tool already states, so the lines are carried through and only
 * the counts are lifted for the launcher's one-line note.
 */
function keptLines(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Z0-9]+: kept \d+ of \d+ collector positions/.test(line));
}

/** Re-emits the reduced reference sets into `<repoRoot>/out/reference`. */
export function refreshReferenceSets(repoRoot: string, host: RefreshHost = NODE_HOST): ReferenceRefresh {
  const tool = join(repoRoot, REFERENCE_TOOL);
  if (!host.exists(tool)) {
    return { ran: false, reason: 'the reduced-reference emitter is not in this checkout' };
  }
  const out = join(repoRoot, REFERENCE_OUT);
  const result = host.run('npx', ['tsx', tool, '--out', out, '--all']);
  if (!result.ok) {
    return { ran: false, reason: result.stdout.trim().split('\n').slice(-1)[0] ?? 'the emitter failed' };
  }
  return { ran: true, kept: keptLines(result.stdout) };
}

/** One line for the launcher's stdout, in the voice of its other staging notes. */
export function describeReferenceRefresh(refresh: ReferenceRefresh): string {
  if (!refresh.ran) return `Reference sets: kept what is on disk (${refresh.reason}).`;
  if (refresh.kept.length === 0) return 'Reference sets: rebuilt, and the emitter named none.';
  const counts = refresh.kept.map((line) => {
    const match = /^([A-Z0-9]+): kept (\d+) of (\d+)/.exec(line);
    return match === null ? line : `${match[1]} ${match[2]}/${match[3]}`;
  });
  return `Reference sets: rebuilt ${counts.join(', ')} playable positions.`;
}
