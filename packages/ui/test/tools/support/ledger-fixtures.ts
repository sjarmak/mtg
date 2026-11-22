/**
 * Ledger fixtures for the evidence scanner's tests: one well-formed artifact
 * per family, shaped after the real files under `out/` on the machine that
 * produced them, and a file system in memory that satisfies the scanner's
 * `LedgerIo` seam so no test opens a real ledger.
 *
 * The trial row is built on the same episode the bot-evidence package's own
 * test uses, with its config hash computed rather than typed, because the
 * scanner runs that schema's refinements and a row that failed them would be
 * counted as unreadable rather than as a trial.
 */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { LedgerEntry, LedgerIo, LedgerStat } from '../../../tools/scan-ledgers';

export const SHA = 'a'.repeat(64);

export function campaignReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'legacy-cube-bot-calibration/v1',
    options: {
      seed: 'campaign-1',
      split: 'tuning',
      pods: 2,
      gamesPerOrder: 2,
      opponents: 3,
      policies: ['pin:reanimator', 'pin:tempo'],
      out: 'out/legacy-cube-bot-final-20260910',
      timeoutMs: 60000,
      planOnly: false,
    },
    games: [
      { id: 'g1', outcome: 'win', eligible: true },
      { id: 'g2', outcome: 'loss', eligible: true },
      { id: 'g3', outcome: 'timeout', eligible: false },
    ],
    ...overrides,
  };
}

export function stagePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'isd-limited-draft-holdout-v10',
    split: 'holdout',
    stage: 'draft',
    engine: 'native',
    subjects: [{ id: 'isd', formatSha256: SHA, cardsSha256: SHA }],
    policies: { baseline: { policyId: 'greedy/v0' }, candidate: { policyId: 'learned/v3' } },
    schedule: [
      { subjectId: 'isd', unitId: 'u1', seed: 's1' },
      { subjectId: 'isd', unitId: 'u2', seed: 's2' },
      { subjectId: 'isd', unitId: 'u3', seed: 's3' },
    ],
    ...overrides,
  };
}

export function botStrengthPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'bot-strength-campaign-plan/v1',
    id: 'general-forge-action-coverage-tuning-v1',
    split: 'tuning',
    formats: [{ id: 'akh-hou' }, { id: 'legacy-cube-2021-08' }],
    policies: { baseline: { policyId: 'forge/default' }, candidate: { policyId: 'forge/tuned-v1' } },
    schedule: [
      { formatId: 'akh-hou', unitId: 'u1' },
      { formatId: 'akh-hou', unitId: 'u2' },
      { formatId: 'legacy-cube-2021-08', unitId: 'u3' },
    ],
    ...overrides,
  };
}

export function comparison(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'stage-strength-comparison/v1',
    completion: {
      baseline: { attempted: 3, completed: 3, failures: 0, rate: 1 },
      candidate: { attempted: 3, completed: 2, failures: 1, rate: 0.67 },
    },
    promotion: { status: 'retain-baseline', reasons: ['interval spans zero'] },
    strength: {
      independentUnits: 2,
      status: 'inconclusive',
      interval95: [-0.4, 0.2],
      meanPairedDifference: -0.1,
      bySegment: [{ dimension: 'format', id: 'isd', independentUnits: 2 }],
      byOpponent: [],
    },
    ...overrides,
  };
}

export function botStrengthComparison(): Record<string, unknown> {
  return comparison({
    version: 'bot-strength-comparison/v1',
    strength: {
      independentUnits: 3,
      status: 'inconclusive',
      byFormat: [
        { id: 'akh-hou', independentUnits: 2 },
        { id: 'legacy-cube-2021-08', independentUnits: 1 },
      ],
      byOpponent: [],
    },
  });
}

export function decision(): Record<string, unknown> {
  return {
    version: 'legacy-cube-tuning-decision/v1',
    decision: 'retain-baseline',
    rationale: ['not enough units'],
    evidence: 'out/legacy-cube-stage-tuning-v1/draft/comparison.json',
    limitation: 'model-built decks only',
  };
}

export function observedSweep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'printed-observed-sweep',
    qualification: 'unproven',
    admission: 'forge-observed',
    policy: 'forge/default',
    formatId: 'akh-hou',
    catalogs: [
      { code: 'AKH', catalogFormat: 'mtgjson', catalogSha256: SHA },
      { code: 'HOU', catalogFormat: 'mtgjson', catalogSha256: SHA },
    ],
    mode: 'draft',
    seeds: [1, 2, 3],
    sessions: [
      { seed: 1, status: 'finished' },
      { seed: 2, status: 'submit-failed', error: 'deck rejected' },
      { seed: 3, status: 'finished' },
    ],
    ...overrides,
  };
}

export function qualityCollection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'legacy-cube-quality-collection/v1',
    campaign: 'legacy-cube-live-quality-tuning-v1',
    summary: { reviews: 12 },
    quality: {
      version: 'legacy-cube-quality-gate/v1',
      status: 'retain-baseline',
      origin: 'model',
      independentHumanEvidence: false,
      adoptionEligible: false,
    },
    ...overrides,
  };
}

export function deckReviewManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'legacy-cube-deck-sample/v1',
    origin: 'simulation',
    split: 'tuning',
    seed: 'review-1',
    policy: 'pin:reanimator',
    weights: {},
    catalogSha256: SHA,
    runtimeSha256: SHA,
    builderVersion: 'two-color-package-preserving/v1',
    taskSha256: SHA,
    ...overrides,
  };
}

export interface TrialRowShape {
  readonly unitId: string;
  readonly arm: 'baseline' | 'candidate';
  readonly formatId?: string;
  readonly completed?: boolean;
  readonly id?: string;
}

/** One `trials.jsonl` row whose episode satisfies the bot-evidence refinements. */
export function trialRow(shape: TrialRowShape): Record<string, unknown> {
  const config = { depth: 1, evaluator: 'material/v1' };
  const id = shape.id ?? `game-${shape.unitId}-${shape.arm}`;
  return {
    unitId: shape.unitId,
    arm: shape.arm,
    cost: { wallMs: 10 },
    episode: {
      schemaVersion: 1,
      episode: {
        id,
        stage: 'gameplay',
        seed: `seed:${shape.unitId}`,
        runtime: { kind: 'native', version: 'kernel/v1', buildSha256: SHA },
        subject: { formatId: shape.formatId ?? 'isd', formatSha256: SHA, cardsSha256: SHA },
        features: { schemaId: 'agent-observation/v1', schemaSha256: SHA },
        behavior: {
          policyId: shape.arm === 'baseline' ? 'greedy/v0' : 'learned/v3',
          configSha256: botEvidenceSha256(config),
          config,
          modelSha256: null,
          dataSha256: null,
        },
        lineage: { gameId: id },
        splitGroup: { kind: 'game', id },
      },
      decisions: [],
      outcome:
        shape.completed === false
          ? { status: 'timeout', error: 'decision budget exhausted' }
          : { status: 'completed', value: { winner: 0 } },
    },
    outcomeEvidence: null,
    outcomeEvidenceSha256: SHA,
  };
}

/** The two decks the recorded-game fixture seats, for a test that swaps them. */
export const DECK_NAMES = { human: 'The Sky Islands', bot: 'Gloom' } as const;

/**
 * A row's set identity: the two join keys, with the hashes a real record always
 * carries beside them. Spelled through a helper because the schema is strict
 * (`../../../src/routes/replay/gameplay-record.ts`), so a test that states one
 * key states all five or the row is refused for the wrong reason.
 */
export function gameplaySet(keys: {
  readonly setCode: string | null;
  readonly formatId: string | null;
}): Record<string, unknown> {
  return {
    setCode: keys.setCode,
    setSha256: keys.setCode === null ? null : SHA,
    formatId: keys.formatId,
    formatSha256: keys.formatId === null ? null : SHA,
    cardsSha256: null,
  };
}

export function gameplayRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'game-0001',
    at: '2026-09-15T10:00:00.000Z',
    source: 'browser-kernel',
    format: 'sealed',
    set: gameplaySet({ setCode: 'XMP', formatId: null }),
    seats: [
      { kind: 'human', name: 'You', deck: { name: DECK_NAMES.human, size: 40, cards: [] } },
      { kind: 'kernel-bot', name: 'Bot', deck: { name: DECK_NAMES.bot, size: 40, cards: [] } },
    ],
    result: { winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 9 },
    measurement: { decisions: 24, turns: 9, eventBytes: 4096 },
    events: 'event-log',
    path: '20260915/game-0001.json',
    sha256: SHA,
    bytes: 4096,
    ...overrides,
  };
}

export function jsonl(rows: readonly unknown[]): string {
  return rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n';
}

export interface MemoryFile {
  readonly text: string;
  readonly mtimeMs?: number;
}

/** A file system in memory: a map from POSIX path to file, with the reads it saw. */
export interface MemoryIo extends LedgerIo {
  readonly listed: string[];
  readonly streamed: string[];
}

export function memoryIo(files: Readonly<Record<string, string | MemoryFile>>): MemoryIo {
  const entries = new Map<string, MemoryFile>();
  for (const [path, file] of Object.entries(files))
    entries.set(path, typeof file === 'string' ? { text: file } : file);
  const listed: string[] = [];
  const streamed: string[] = [];
  return {
    listed,
    streamed,
    readdir(dir: string): readonly LedgerEntry[] | null {
      listed.push(dir);
      const prefix = `${dir}/`;
      const names = new Map<string, boolean>();
      for (const path of entries.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length).split('/');
        const name = rest[0];
        if (name === undefined) continue;
        names.set(name, rest.length > 1 || names.get(name) === true);
      }
      if (names.size === 0) return null;
      return [...names.entries()].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    stat(path: string): LedgerStat | null {
      const file = entries.get(path);
      if (file === undefined) return null;
      return { size: Buffer.byteLength(file.text, 'utf8'), mtimeMs: file.mtimeMs ?? 1_000 };
    },
    readText(path: string): string | null {
      return entries.get(path)?.text ?? null;
    },
    async *lines(path: string): AsyncIterable<string> {
      streamed.push(path);
      const file = entries.get(path);
      if (file === undefined) throw new Error(`ENOENT: ${path}`);
      const parts = file.text.split('\n');
      if (parts[parts.length - 1] === '') parts.pop();
      for (const line of parts) yield line;
    },
  };
}
