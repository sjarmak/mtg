/**
 * Stages the evidence snapshot the Analysis tab's `evidence` section reads:
 * `packages/ui/public/analysis-evidence.json`, one file, written whole or not
 * at all.
 *
 * `npm run play` calls `stageEvidence` beside the other staging steps and
 * prints `describeEvidence`'s line; this file is also runnable on its own,
 * which is how a reader lifts the byte budget for one of the big trials files
 * (`--budget <bytes>`) without replaying the whole launcher. There is no npm
 * script, proxy or server route for it: the page reads a static file from its
 * own origin, the way it reads `analysis.json`, and a browser that finds no
 * file names both commands that write one.
 *
 * The write is a temporary file renamed into place, so a page reloading while
 * the scan runs sees the old snapshot or the new one and never half of either;
 * `./stage-calibration-command.ts` does the same for the same reason. With
 * nothing to say (no ledger, no recorded game, no refusal) the file is removed
 * rather than written empty, which is the `writeRunLog` rule in
 * `./stage-run-log.ts`: an absent file is the page's own "nothing staged"
 * state, and an empty one would be a second spelling of it.
 *
 * The previous snapshot is read first, if there is one this build can parse,
 * so `./scan-ledgers.ts` can reuse a trials file it already streamed. One it
 * cannot parse is simply not reused; a stale format is not an error here, it is
 * the reason the scan is running.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvidenceSnapshot } from '../src/routes/analysis/evidence-record';
import type { EvidenceSnapshot } from '../src/routes/analysis/evidence-record';
import { resolveOutDir } from './out-path';
import { REAL_LEDGER_IO, SCAN_BUDGET_BYTES, scanLedgers } from './scan-ledgers';
import type { LedgerIo } from './scan-ledgers';

export const EVIDENCE_FILENAME = 'analysis-evidence.json';

export interface StagedEvidence {
  /** The file written, or null when there was nothing to stage and any old file was removed. */
  readonly written: string | null;
  readonly records: number;
  readonly skipped: number;
  readonly truncated: number;
  /** Trials files whose records came from the previous snapshot rather than a stream. */
  readonly reused: number;
}

export interface StageEvidenceOptions {
  readonly budgetBytes?: number;
  readonly now?: () => Date;
}

function previousSnapshot(target: string): EvidenceSnapshot | null {
  let text: string;
  try {
    text = readFileSync(target, 'utf8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const read = readEvidenceSnapshot(json, target);
  return read.ok ? read.snapshot : null;
}

function countReused(previous: EvidenceSnapshot | null, snapshot: EvidenceSnapshot): number {
  if (previous === null) return 0;
  return snapshot.scanned.filter((entry) =>
    previous.scanned.some(
      (seen) => seen.path === entry.path && seen.size === entry.size && seen.mtimeMs === entry.mtimeMs,
    ),
  ).length;
}

/** Scans the two roots and writes the snapshot under `publicDir`, or removes it when there is nothing to say. */
export async function stageEvidence(
  outRoot: string,
  gameplayDir: string,
  publicDir: string,
  options: StageEvidenceOptions = {},
  io: LedgerIo = REAL_LEDGER_IO,
): Promise<StagedEvidence> {
  const target = join(publicDir, EVIDENCE_FILENAME);
  const previous = previousSnapshot(target);
  const snapshot = await scanLedgers(
    { outRoot, gameplayDir },
    previous,
    { budgetBytes: options.budgetBytes ?? SCAN_BUDGET_BYTES, now: options.now ?? (() => new Date()) },
    io,
  );
  const counts = {
    records: snapshot.records.length,
    skipped: snapshot.skipped.length,
    truncated: snapshot.truncated.length,
    reused: countReused(previous, snapshot),
  };
  if (counts.records === 0 && counts.skipped === 0 && counts.truncated === 0) {
    rmSync(target, { force: true });
    return { written: null, ...counts };
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, target);
  return { written: target, ...counts };
}

/** Removes a staged snapshot, for a launcher that stages a different page. */
export function clearStagedEvidence(publicDir: string): void {
  rmSync(join(publicDir, EVIDENCE_FILENAME), { force: true });
}

/** The one stdout line `npm run play` prints for this step. */
export function describeEvidence(staged: StagedEvidence): string {
  if (staged.written === null) {
    return 'Evidence: no ledger under out/ and no recorded game under data/gameplay/, so the Analysis tab says nothing is staged.';
  }
  const notes = [
    staged.reused === 0 ? null : `${String(staged.reused)} reused from the last scan`,
    staged.skipped === 0 ? null : `${String(staged.skipped)} not read`,
    staged.truncated === 0 ? null : `${String(staged.truncated)} over the byte budget`,
  ].filter((note): note is string => note !== null);
  const tail = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
  return `Evidence: ${String(staged.records)} record${staged.records === 1 ? '' : 's'} staged at ${staged.written}${tail}.`;
}

export interface EvidenceArgs {
  readonly budgetBytes: number;
  readonly outRoot: string;
}

/** `--budget <bytes>` and `--out <dir>`; anything else is a refusal naming the flag. */
export function readEvidenceArgs(argv: readonly string[], repoRoot: string): EvidenceArgs {
  let budgetBytes = SCAN_BUDGET_BYTES;
  let outRoot = join(repoRoot, 'out');
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--budget') {
      const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
        throw new Error(`--budget takes a whole number of bytes, not ${value ?? 'nothing'}`);
      }
      budgetBytes = parsed;
      index += 1;
    } else if (flag === '--out') {
      if (value === undefined) throw new Error('--out takes a directory');
      outRoot = resolveOutDir(value, repoRoot);
      index += 1;
    } else {
      throw new Error(`unknown flag ${flag ?? ''}; this tool takes --budget <bytes> and --out <dir>`);
    }
  }
  return { budgetBytes, outRoot };
}

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

async function main(): Promise<void> {
  const args = readEvidenceArgs(process.argv.slice(2), REPO_ROOT);
  const staged = await stageEvidence(
    args.outRoot,
    join(REPO_ROOT, 'data', 'gameplay'),
    join(UI_ROOT, 'public'),
    {
      budgetBytes: args.budgetBytes,
    },
  );
  process.stdout.write(`${describeEvidence(staged)}\n`);
}

// Run only when this file is the process entrypoint, for the reason `./play.ts`
// gives: a test that imports one function from here must not run the scan.
const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`stage-evidence: ${message}\n`);
    process.exit(1);
  });
}
