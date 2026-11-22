/**
 * The walk over `out/` and `data/gameplay/` that turns ledgers into an
 * evidence snapshot, behind an io seam so a test can hand it a file system in
 * memory and never touch a real ledger.
 *
 * Which directories are evidence is an allow-list of named roots, one regex
 * per path segment, and nothing outside it is opened: `out/` holds screenshots,
 * art, scratch sets and a worktree archive beside the ledgers, and a walk that
 * opened every directory would read gigabytes to learn what a name already
 * says. A root whose metadata file is missing is a refusal naming the file,
 * because a directory that was planned and never played is a fact worth one
 * line rather than silence.
 *
 * Cost is bounded twice. Metadata files are read whole (they are kilobytes);
 * a `trials.jsonl` is streamed, only when its `comparison.json` is absent, and
 * only while the run's byte budget holds, since three of those files are 65,
 * 521 and 850 MB on this machine. A file over what is left of the budget is
 * recorded under `truncated` with the flag that lifts it, and a file the last
 * run already streamed is reused from the previous snapshot when its size and
 * modification time still match, so a second `npm run play` pays for nothing
 * it paid for before. Only the streamed reads carry a fingerprint; a metadata
 * read is cheaper than comparing one.
 *
 * Nothing here throws on a bad ledger. Every reader answers with records or a
 * refusal, an unreadable file is a refusal, and the one exception a stream can
 * raise mid-file (an io error) becomes a refusal naming it. The families'
 * readers are `./ledger-families.ts`, `./stage-strength-family.ts` and
 * `./recorded-games-family.ts`; the writer that calls this is
 * `./stage-evidence.ts`.
 */
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { EVIDENCE_SNAPSHOT_VERSION } from '../src/routes/analysis/evidence-record';
import type { EvidenceRecord, EvidenceSnapshot } from '../src/routes/analysis/evidence-record';
import { GAMEPLAY_INDEX_FILENAME } from './data-path';
import {
  issueSentence,
  readCampaignReport,
  readDeckReviewManifest,
  readObservedSweep,
  readQualityCollection,
  skip,
} from './ledger-families';
import type { FamilyRead, ReadContext } from './ledger-families';
import { readRecordedGames } from './recorded-games-family';
import { readStageStrengthDir, recordsFromTally, tallyTrial, TrialRowSchema } from './stage-strength-family';
import type { TrialRow, TrialTally } from './stage-strength-family';

/** Bytes of `trials.jsonl` one scan will stream: half a gigabyte, which is one of the three big files. */
export const SCAN_BUDGET_BYTES = 512 * 1024 * 1024;

export interface LedgerEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}
export interface LedgerStat {
  readonly size: number;
  readonly mtimeMs: number;
}

/** The file system, as far as the scan reads it. */
export interface LedgerIo {
  /** The entries of a directory, or null when it is not one that can be listed. */
  readdir(dir: string): readonly LedgerEntry[] | null;
  /** Size and modification time, or null when the path does not exist. */
  stat(path: string): LedgerStat | null;
  /** A whole file as text, or null when it cannot be read. */
  readText(path: string): string | null;
  /** A file line by line; may reject mid-stream on an io error. */
  lines(path: string): AsyncIterable<string>;
}

export const REAL_LEDGER_IO: LedgerIo = {
  readdir(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return null;
    }
  },
  stat(path) {
    try {
      const stat = statSync(path);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  },
  readText(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  lines(path) {
    return createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  },
};

export type FamilyReader =
  'campaign-report' | 'stage-strength' | 'observed-sweep' | 'quality-collection' | 'deck-review';

export interface FamilyRoot {
  readonly reads: FamilyReader;
  /** One regex per path segment under `out/`; a two-segment root is a directory of campaigns. */
  readonly segments: readonly [RegExp] | readonly [RegExp, RegExp];
}

export const EVIDENCE_FAMILY_ROOTS: readonly FamilyRoot[] = [
  { reads: 'campaign-report', segments: [/^legacy-cube-bot-[a-z0-9-]+-\d{8}$/] },
  { reads: 'stage-strength', segments: [/^isd-[a-z0-9-]+-holdout-v\d+$/] },
  { reads: 'stage-strength', segments: [/^legacy-cube-stage-tuning-v\d+$/, /^(builder|draft)$/] },
  { reads: 'stage-strength', segments: [/^bot-strength$/, /^[a-z0-9][a-z0-9-]*$/] },
  { reads: 'observed-sweep', segments: [/^validation-pilot$/, /^[a-z0-9-]+-observed-sweep-[a-z0-9-]+$/] },
  { reads: 'quality-collection', segments: [/^legacy-cube-live-quality-[a-z0-9-]+$/] },
  { reads: 'deck-review', segments: [/^legacy-cube-deck-review-pilot-[a-z0-9-]+$/] },
];

const METADATA_FILE: Readonly<Record<Exclude<FamilyReader, 'stage-strength'>, string>> = {
  'campaign-report': 'report.json',
  'observed-sweep': 'report.json',
  'quality-collection': 'collected/report.json',
  'deck-review': 'manifest.json',
};

const SINGLE_FILE_READERS: Readonly<
  Record<Exclude<FamilyReader, 'stage-strength'>, (context: ReadContext, json: unknown) => FamilyRead>
> = {
  'campaign-report': readCampaignReport,
  'observed-sweep': readObservedSweep,
  'quality-collection': readQualityCollection,
  'deck-review': readDeckReviewManifest,
};

export interface ScanRoots {
  readonly outRoot: string;
  readonly gameplayDir: string;
}

export interface ScanOptions {
  readonly budgetBytes: number;
  readonly now: () => Date;
}

interface Candidate {
  readonly rel: string;
  readonly reads: FamilyReader;
}

type Loaded =
  | { readonly kind: 'ok'; readonly json: unknown; readonly stat: LedgerStat }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly why: string };

interface Accumulator {
  readonly records: EvidenceRecord[];
  readonly skipped: { path: string; why: string }[];
  readonly truncated: { path: string; bytes: number; budget: number }[];
  readonly scanned: { path: string; size: number; mtimeMs: number }[];
  spent: number;
}

function sortedDirs(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  return entries.filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every directory under `out/` a root names, in a stable order. */
export function ledgerCandidates(outRoot: string, io: LedgerIo): readonly Candidate[] {
  const top = io.readdir(outRoot);
  if (top === null) return [];
  const found: Candidate[] = [];
  for (const entry of sortedDirs(top)) {
    for (const root of EVIDENCE_FAMILY_ROOTS) {
      const [first, second] = root.segments;
      if (!first.test(entry.name)) continue;
      if (second === undefined) {
        found.push({ rel: entry.name, reads: root.reads });
        continue;
      }
      for (const child of sortedDirs(io.readdir(join(outRoot, entry.name)) ?? [])) {
        if (second.test(child.name)) found.push({ rel: `${entry.name}/${child.name}`, reads: root.reads });
      }
    }
  }
  return found;
}

function loadJson(io: LedgerIo, path: string): Loaded {
  const stat = io.stat(path);
  if (stat === null) return { kind: 'absent' };
  const text = io.readText(path);
  if (text === null) return { kind: 'unreadable', why: 'could not be read' };
  try {
    return { kind: 'ok', json: JSON.parse(text), stat };
  } catch (cause: unknown) {
    return {
      kind: 'unreadable',
      why: `is not JSON (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
}

function modifiedAt(stat: LedgerStat): string {
  return new Date(stat.mtimeMs).toISOString();
}

function readSingleFile(
  label: string,
  dir: string,
  reads: Exclude<FamilyReader, 'stage-strength'>,
  io: LedgerIo,
): FamilyRead {
  const file = METADATA_FILE[reads];
  const loaded = loadJson(io, join(dir, file));
  if (loaded.kind === 'absent') return skip(label, `has no ${file}`);
  if (loaded.kind === 'unreadable') return skip(label, `${file} ${loaded.why}`);
  return SINGLE_FILE_READERS[reads]({ path: label, modified: modifiedAt(loaded.stat) }, loaded.json);
}

function take(acc: Accumulator, read: FamilyRead): void {
  if (read.kind === 'records') acc.records.push(...read.records);
  else acc.skipped.push({ path: read.path, why: read.why });
}

/** The previous run's records for a path, when it streamed the same bytes. */
function reusable(
  previous: EvidenceSnapshot | null,
  label: string,
  stat: LedgerStat,
): readonly EvidenceRecord[] | null {
  if (previous === null) return null;
  const seen = previous.scanned.find((entry) => entry.path === label);
  if (seen === undefined || seen.size !== stat.size || seen.mtimeMs !== stat.mtimeMs) return null;
  const records = previous.records.filter((record) => record.path === label);
  return records.length === 0 ? null : records;
}

interface StreamOutcome {
  readonly tallies: Map<string, TrialTally>;
  readonly unreadable: number;
  readonly firstUnreadable: string | null;
}

function parseTrialLine(line: string): { ok: true; row: TrialRow } | { ok: false; why: string } {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, why: 'is not JSON' };
  }
  const row = TrialRowSchema.safeParse(json);
  return row.success ? { ok: true, row: row.data } : { ok: false, why: issueSentence(row.error) };
}

async function streamTrials(lines: AsyncIterable<string>): Promise<StreamOutcome> {
  const tallies = new Map<string, TrialTally>();
  let unreadable = 0;
  let firstUnreadable: string | null = null;
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === '') continue;
    const parsed = parseTrialLine(line);
    if (!parsed.ok) {
      unreadable += 1;
      firstUnreadable ??= `line ${String(lineNumber)} ${parsed.why}`;
      continue;
    }
    tallyTrial(tallies, parsed.row);
  }
  return { tallies, unreadable, firstUnreadable };
}

async function scanCampaignDir(
  label: string,
  dir: string,
  io: LedgerIo,
  acc: Accumulator,
  options: ScanOptions,
  previous: EvidenceSnapshot | null,
): Promise<void> {
  const plan = loadJson(io, join(dir, 'plan.json'));
  if (plan.kind === 'absent') return take(acc, skip(label, 'has no plan.json'));
  if (plan.kind === 'unreadable') return take(acc, skip(label, `plan.json ${plan.why}`));
  const comparison = loadJson(io, join(dir, 'comparison.json'));
  if (comparison.kind === 'unreadable') return take(acc, skip(label, `comparison.json ${comparison.why}`));
  const decision = loadJson(io, join(dir, 'decision.json'));
  if (decision.kind === 'unreadable') return take(acc, skip(label, `decision.json ${decision.why}`));
  const read = readStageStrengthDir(
    { path: label, modified: modifiedAt(comparison.kind === 'ok' ? comparison.stat : plan.stat) },
    {
      plan: plan.json,
      comparison: comparison.kind === 'ok' ? comparison.json : null,
      decision: decision.kind === 'ok' ? decision.json : null,
    },
  );
  if (read.kind !== 'needs-trials') return take(acc, read);
  const trialsPath = join(dir, 'trials.jsonl');
  const trials = io.stat(trialsPath);
  if (trials === null)
    return take(
      acc,
      skip(label, 'has neither comparison.json nor trials.jsonl, so nothing in it was played'),
    );
  const fingerprint = {
    size: trials.size + plan.stat.size,
    mtimeMs: Math.max(trials.mtimeMs, plan.stat.mtimeMs),
  };
  const reused = reusable(previous, label, fingerprint);
  if (reused !== null) {
    acc.records.push(...reused);
    acc.scanned.push({ path: label, ...fingerprint });
    return;
  }
  if (acc.spent + trials.size > options.budgetBytes) {
    acc.truncated.push({ path: label, bytes: trials.size, budget: options.budgetBytes });
    return;
  }
  acc.spent += trials.size;
  let outcome: StreamOutcome;
  try {
    outcome = await streamTrials(io.lines(trialsPath));
  } catch (cause: unknown) {
    return take(
      acc,
      skip(
        label,
        `trials.jsonl could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
  acc.records.push(...recordsFromTally(read.partials, outcome.tallies));
  acc.scanned.push({ path: label, ...fingerprint });
  if (outcome.firstUnreadable !== null) {
    acc.skipped.push({
      path: `${label}/trials.jsonl`,
      why: `${outcome.firstUnreadable}; ${String(outcome.unreadable)} such rows are not counted`,
    });
  }
}

/** The label a gameplay index carries: its last two directories and its name, `data/gameplay/index.jsonl`. */
export function gameplayIndexLabel(gameplayDir: string): string {
  return `${basename(dirname(gameplayDir))}/${basename(gameplayDir)}/${GAMEPLAY_INDEX_FILENAME}`;
}

async function scanGameplay(gameplayDir: string, io: LedgerIo, acc: Accumulator): Promise<void> {
  const path = join(gameplayDir, GAMEPLAY_INDEX_FILENAME);
  if (io.stat(path) === null) return;
  const label = gameplayIndexLabel(gameplayDir);
  try {
    const read = await readRecordedGames(label, io.lines(path));
    acc.records.push(...read.records);
    acc.skipped.push(...read.skipped);
  } catch (cause: unknown) {
    acc.skipped.push({
      path: label,
      why: `could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/**
 * Scans both roots into one snapshot. `previous` is the last snapshot on disk,
 * or null, and is consulted only to skip re-streaming a trials file whose
 * bytes have not changed.
 */
export async function scanLedgers(
  roots: ScanRoots,
  previous: EvidenceSnapshot | null,
  options: ScanOptions,
  io: LedgerIo = REAL_LEDGER_IO,
): Promise<EvidenceSnapshot> {
  const acc: Accumulator = { records: [], skipped: [], truncated: [], scanned: [], spent: 0 };
  const outName = basename(roots.outRoot);
  for (const candidate of ledgerCandidates(roots.outRoot, io)) {
    const label = `${outName}/${candidate.rel}`;
    const dir = join(roots.outRoot, candidate.rel);
    if (candidate.reads === 'stage-strength') {
      await scanCampaignDir(label, dir, io, acc, options, previous);
    } else {
      take(acc, readSingleFile(label, dir, candidate.reads, io));
    }
  }
  await scanGameplay(roots.gameplayDir, io, acc);
  return {
    formatVersion: EVIDENCE_SNAPSHOT_VERSION,
    scannedAt: options.now().toISOString(),
    outRoot: roots.outRoot,
    gameplayRoot: roots.gameplayDir,
    records: acc.records,
    skipped: acc.skipped,
    truncated: acc.truncated,
    scanned: acc.scanned,
  };
}
