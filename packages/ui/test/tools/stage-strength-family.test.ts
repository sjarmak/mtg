/**
 * The paired-campaign reader in `../../tools/stage-strength-family.ts`: one
 * record per subject from the plan and comparison, a partial per subject when
 * the comparison is missing, and the trial tally that finishes those partials
 * from a stream.
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import {
  emptyTally,
  readStageStrengthDir,
  recordsFromTally,
  tallyTrial,
  TrialRowSchema,
} from '../../tools/stage-strength-family';
import type { TrialRow, TrialTally } from '../../tools/stage-strength-family';
import {
  botStrengthComparison,
  botStrengthPlan,
  comparison,
  decision,
  stagePlan,
  trialRow,
} from './support/ledger-fixtures';

const CONTEXT = { path: 'out/isd-limited-draft-holdout-v10', modified: '2026-09-12T08:00:00.000Z' };

function parseRow(shape: Parameters<typeof trialRow>[0]): TrialRow {
  return TrialRowSchema.parse(trialRow(shape));
}

describe('a campaign with its comparison', () => {
  it('is one games record per subject, with arms when the campaign had one subject', () => {
    const read = readStageStrengthDir(CONTEXT, {
      plan: stagePlan(),
      comparison: comparison(),
      decision: null,
    });
    if (read.kind !== 'records') throw new Error(read.kind === 'skip' ? read.why : read.kind);
    expect(read.records).toHaveLength(1);
    const [record] = read.records;
    expect(record?.family).toBe('stage-strength');
    expect(record?.version).toBe('stage-strength-campaign-plan/v1');
    expect(record?.subject).toEqual({ kind: 'format', id: 'isd', code: null });
    expect(record?.matchup).toBe('learned/v3 vs greedy/v0');
    expect(record?.produced).toBe(CONTEXT.modified);
    expect(record?.evidence).toEqual({
      strength: 'games',
      trials: { attempted: 3, completed: 2 },
      arms: { baseline: { attempted: 3, completed: 3 }, candidate: { attempted: 3, completed: 2 } },
      source: 'comparison',
      episode: null,
      status: 'retain-baseline',
    });
  });

  it('appends the decision when the directory holds one', () => {
    const read = readStageStrengthDir(CONTEXT, {
      plan: stagePlan(),
      comparison: comparison(),
      decision: decision(),
    });
    if (read.kind !== 'records') throw new Error('expected records');
    const evidence = read.records[0]?.evidence;
    if (evidence?.strength !== 'games') throw new Error('expected games evidence');
    expect(evidence.status).toBe('retain-baseline, decided retain-baseline');
  });

  it('splits a two-format bot-strength campaign into two records and drops the arms', () => {
    const read = readStageStrengthDir(CONTEXT, {
      plan: botStrengthPlan(),
      comparison: botStrengthComparison(),
      decision: null,
    });
    if (read.kind !== 'records') throw new Error('expected records');
    expect(read.records.map((record) => record.subject)).toEqual([
      { kind: 'format', id: 'akh-hou', code: null },
      { kind: 'cube', id: LEGACY_CUBE_FORMAT, code: null },
    ]);
    expect(read.records.map((record) => record.family)).toEqual(['bot-strength', 'bot-strength']);
    const [first, second] = read.records;
    if (first?.evidence.strength !== 'games' || second?.evidence.strength !== 'games')
      throw new Error('games');
    expect(first.evidence.trials).toEqual({ attempted: 2, completed: 2 });
    expect(second.evidence.trials).toEqual({ attempted: 1, completed: 1 });
    expect(first.evidence.arms).toBeNull();
  });

  it('refuses when the comparison states no units for one of the subjects', () => {
    const read = readStageStrengthDir(CONTEXT, {
      plan: botStrengthPlan(),
      comparison: comparison({ version: 'bot-strength-comparison/v1' }),
      decision: null,
    });
    expect(read).toEqual({
      kind: 'skip',
      path: CONTEXT.path,
      why: 'comparison.json states no independent units for akh-hou',
    });
  });

  it('refuses a plan with no subject, a bad comparison and a bad decision, each by file', () => {
    const noSubject = readStageStrengthDir(CONTEXT, {
      plan: botStrengthPlan({ formats: [] }),
      comparison: null,
      decision: null,
    });
    expect(noSubject.kind === 'skip' && noSubject.why).toMatch(/^plan\.json names no subject/);
    const badComparison = readStageStrengthDir(CONTEXT, {
      plan: stagePlan(),
      comparison: { version: 'x' },
      decision: null,
    });
    expect(badComparison.kind === 'skip' && badComparison.why).toMatch(/^comparison\.json /);
    const badDecision = readStageStrengthDir(CONTEXT, {
      plan: stagePlan(),
      comparison: comparison(),
      decision: {},
    });
    expect(badDecision.kind === 'skip' && badDecision.why).toMatch(/^decision\.json /);
    const badPlan = readStageStrengthDir(CONTEXT, {
      plan: stagePlan({ policies: {} }),
      comparison: null,
      decision: null,
    });
    expect(badPlan.kind === 'skip' && badPlan.why).toMatch(/^plan\.json .*policies/);
  });
});

describe('a campaign without its comparison', () => {
  it('asks for the trials, with one partial per subject counting the schedule', () => {
    const read = readStageStrengthDir(CONTEXT, { plan: stagePlan(), comparison: null, decision: null });
    if (read.kind !== 'needs-trials') throw new Error('expected needs-trials');
    expect(read.partials).toHaveLength(1);
    const evidence = read.partials[0]?.evidence;
    expect(evidence).toEqual({
      strength: 'games',
      trials: { attempted: 3, completed: 0 },
      arms: null,
      source: 'trials-stream',
      episode: null,
      status: null,
    });
  });

  it('finishes the partials from the tally: a unit counts when both arms finished', () => {
    const read = readStageStrengthDir(CONTEXT, { plan: stagePlan(), comparison: null, decision: null });
    if (read.kind !== 'needs-trials') throw new Error('expected needs-trials');
    const tallies = new Map<string, TrialTally>();
    tallyTrial(tallies, parseRow({ unitId: 'u1', arm: 'baseline' }));
    tallyTrial(tallies, parseRow({ unitId: 'u1', arm: 'candidate' }));
    tallyTrial(tallies, parseRow({ unitId: 'u2', arm: 'baseline' }));
    tallyTrial(tallies, parseRow({ unitId: 'u2', arm: 'candidate', completed: false }));
    tallyTrial(tallies, parseRow({ unitId: 'u9', arm: 'baseline', formatId: 'other' }));
    const [record] = recordsFromTally(read.partials, tallies);
    if (record?.evidence.strength !== 'games') throw new Error('expected games evidence');
    expect(record.evidence.trials).toEqual({ attempted: 3, completed: 1 });
    expect(record.evidence.arms).toEqual({
      baseline: { attempted: 2, completed: 2 },
      candidate: { attempted: 2, completed: 1 },
    });
    expect(record.evidence.episode).toEqual({
      id: 'game-u1-baseline',
      stage: 'gameplay',
      runtime: 'native',
      formatId: 'isd',
    });
    expect(tallies.get('other')?.units.size).toBe(1);
  });

  it('leaves a subject the stream never mentioned at zero', () => {
    const read = readStageStrengthDir(CONTEXT, { plan: stagePlan(), comparison: null, decision: null });
    if (read.kind !== 'needs-trials') throw new Error('expected needs-trials');
    const [record] = recordsFromTally(read.partials, new Map());
    expect(record?.evidence).toEqual(read.partials[0]?.evidence);
    expect(emptyTally().units.size).toBe(0);
  });
});

describe('the trial row schema', () => {
  it('runs the episode refinements, so a row with a wrong config hash is unreadable', () => {
    const row = trialRow({ unitId: 'u1', arm: 'baseline' });
    const episode = (row['episode'] as { episode: { behavior: { configSha256: string } } }).episode;
    episode.behavior.configSha256 = 'b'.repeat(64);
    const parsed = TrialRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues[0]?.path.join('.')).toBe('episode.episode.behavior.configSha256');
  });

  it('accepts the fixture row and reads its arm and unit', () => {
    const parsed = parseRow({ unitId: 'u4', arm: 'candidate' });
    expect(parsed.arm).toBe('candidate');
    expect(parsed.unitId).toBe('u4');
    expect(parsed.episode.outcome.status).toBe('completed');
  });
});
