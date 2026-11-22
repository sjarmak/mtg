/**
 * One staged evidence snapshot for the reader's and the panel's tests: a
 * record of each strength, one refusal and one file over the byte budget, so a
 * test can state what it is about by naming a constant rather than building
 * the shape again.
 */
import { EVIDENCE_SNAPSHOT_VERSION } from '../../../src/routes/analysis/evidence-record';
import type { EvidenceRecord, EvidenceSnapshot } from '../../../src/routes/analysis/evidence-record';

export const GAMES_RECORD: EvidenceRecord = {
  family: 'stage-strength',
  path: 'out/isd-limited-draft-holdout-v10',
  version: 'stage-strength-campaign-plan/v1',
  subject: { kind: 'format', id: 'isd', code: null },
  matchup: 'learned/v3 vs greedy/v0',
  produced: '2026-09-12T08:00:00.000Z',
  evidence: {
    strength: 'games',
    trials: { attempted: 3, completed: 2 },
    arms: { baseline: { attempted: 3, completed: 3 }, candidate: { attempted: 3, completed: 2 } },
    source: 'comparison',
    episode: { id: 'game-u1-baseline', stage: 'gameplay', runtime: 'native', formatId: 'isd' },
    status: 'retain-baseline',
  },
};

export const STATISTICS_RECORD: EvidenceRecord = {
  family: 'printed-observed-sweep',
  path: 'out/validation-pilot/akh-hou-observed-sweep-1',
  version: 'printed-observed-sweep/1',
  subject: { kind: 'format', id: 'akh-hou', code: 'AKH+HOU' },
  matchup: null,
  produced: null,
  evidence: {
    strength: 'statistics',
    summary: { sessions: 3, qualification: 'unproven', live: false, note: null },
  },
};

export const JUDGMENT_RECORD: EvidenceRecord = {
  family: 'legacy-cube-quality',
  path: 'out/legacy-cube-live-quality-tuning-v1',
  version: 'legacy-cube-quality-collection/v1',
  subject: { kind: 'cube', id: 'legacy-cube-2021-08', code: null },
  matchup: 'candidate against current advisor, gate retain-baseline',
  produced: '2026-09-10T12:00:00.000Z',
  evidence: {
    strength: 'judgment',
    origin: 'model',
    independentHumanEvidence: false,
    adoptionEligible: null,
  },
};

export const RECORDED_GAMES_RECORD: EvidenceRecord = {
  family: 'recorded-games',
  path: 'data/gameplay/index.jsonl',
  version: 'mtg-ui/gameplay-record/1',
  subject: { kind: 'set', id: 'XMP', code: 'XMP' },
  matchup: 'Gloom (kernel-bot) vs The Sky Islands (human)',
  produced: '2026-09-15T10:00:00.000Z',
  evidence: {
    strength: 'games',
    trials: { attempted: 2, completed: 1 },
    arms: null,
    source: 'gameplay-index',
    episode: null,
    status: null,
  },
};

export function evidenceSnapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    formatVersion: EVIDENCE_SNAPSHOT_VERSION,
    scannedAt: '2026-09-16T12:00:00.000Z',
    outRoot: '/repo/out',
    gameplayRoot: '/repo/data/gameplay',
    records: [GAMES_RECORD, STATISTICS_RECORD, JUDGMENT_RECORD, RECORDED_GAMES_RECORD],
    skipped: [{ path: 'out/legacy-cube-bot-plan-20260910', why: 'has no report.json' }],
    truncated: [{ path: 'out/native-gameplay-tuning-v3', bytes: 2_147_483_648, budget: 536_870_912 }],
    scanned: [{ path: 'out/isd-limited-draft-holdout-v10', size: 4096, mtimeMs: 1_000 }],
    ...overrides,
  };
}
