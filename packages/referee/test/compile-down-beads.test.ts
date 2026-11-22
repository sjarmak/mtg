/**
 * The backlog against the tracker, and the one verdict that can be wrong.
 *
 * Filing is arithmetic: a capped decision kind with no open bead is a bead to
 * file. Closing is not, because an empty backlog entry for a kind has two
 * causes that look identical from the entries alone — the cap is gone, or the
 * run never reached a decision of that kind. Only the first is a bead to close.
 * The tests that matter here are the ones that hold those two apart, and the
 * one that keeps a bead this tool did not file out of its reach entirely.
 */
import { describe, expect, it } from 'vitest';
import type { RulingRecord, TrackedBead } from '@mtg/referee';
import { compileDownDecision, compileDownTitle, diffCompileDownBacklog } from '@mtg/referee';
import {
  commandFor,
  formatDiff,
  parseRulingRecords,
  parseTrackedBeads,
  readToolArgs,
} from '../tools/compile-down-beads';

function record(overrides: Partial<RulingRecord> = {}): RulingRecord {
  return {
    decision: 'priority',
    player: 0,
    optionCount: 4,
    enumerationComplete: true,
    source: 'model',
    chosenIndex: 0,
    rationale: 'because',
    rejection: null,
    costUsd: 0.002,
    costSource: 'estimated',
    latencyMs: 1200,
    provider: 'fixture',
    model: 'stub',
    attempts: 1,
    ...overrides,
  };
}

const capped = (decision: RulingRecord['decision']): RulingRecord =>
  record({ decision, enumerationComplete: false, optionCount: 512 });

const bead = (id: string, decision: RulingRecord['decision']): TrackedBead => ({
  id,
  title: compileDownTitle(decision),
});

const ARGS = { parent: null, priority: '2' } as const;

describe('recognizing a compile-down bead by its title', () => {
  it('round-trips the title it files', () => {
    expect(compileDownDecision(compileDownTitle('declareBlockers'))).toBe('declareBlockers');
  });

  it('says nothing about a bead somebody else titled', () => {
    expect(compileDownDecision('Compile down the layer engine')).toBeNull();
    expect(compileDownDecision('Compile down: enumerate declare blockers without a cap')).toBeNull();
    expect(compileDownDecision('Compile down: enumerate  without a cap')).toBeNull();
  });
});

describe('diffing the backlog against the tracker', () => {
  it('files a capped kind the tracker has never heard of', () => {
    const [action, ...rest] = diffCompileDownBacklog([capped('declareBlockers')], []);
    expect(rest).toEqual([]);
    expect(action?.verdict).toBe('file');
    expect(action?.decision).toBe('declareBlockers');
    expect(action?.entry?.optionCount).toBe(512);
  });

  it('proposes nothing for a capped kind a bead is already open on', () => {
    const actions = diffCompileDownBacklog([capped('declareBlockers')], [bead('mtg-1', 'declareBlockers')]);
    expect(actions.map((one) => one.verdict)).toEqual(['tracked']);
    expect(commandFor(actions[0]!, ARGS)).toBeNull();
  });

  it('names both beads and proposes nothing when two claim one kind', () => {
    const actions = diffCompileDownBacklog(
      [capped('declareBlockers')],
      [bead('mtg-1', 'declareBlockers'), bead('mtg-2', 'declareBlockers')],
    );
    expect(actions.map((one) => one.verdict)).toEqual(['duplicate']);
    expect(actions[0]?.beads.map((one) => one.id)).toEqual(['mtg-1', 'mtg-2']);
    expect(commandFor(actions[0]!, ARGS)).toBeNull();
  });

  it('closes a bead whose kind this run ruled on with every enumeration complete', () => {
    const actions = diffCompileDownBacklog(
      [record({ decision: 'declareBlockers' }), record({ decision: 'declareBlockers' })],
      [bead('mtg-1', 'declareBlockers')],
    );
    expect(actions.map((one) => one.verdict)).toEqual(['close']);
    expect(commandFor(actions[0]!, ARGS)).toContain('bd close mtg-1');
  });

  it('refuses to close a bead whose kind this run never reached', () => {
    // The difference between "the cap is gone" and "nobody looked": the run
    // ruled only on priority, so it has no evidence about declareBlockers at
    // all and must not retire the bead that tracks it.
    const actions = diffCompileDownBacklog(
      [record({ decision: 'priority' })],
      [bead('mtg-1', 'declareBlockers')],
    );
    expect(actions.map((one) => one.verdict)).toEqual(['unobserved']);
    expect(commandFor(actions[0]!, ARGS)).toBeNull();
  });

  it('keeps a bead open when any ruling of its kind was still capped', () => {
    const actions = diffCompileDownBacklog(
      [record({ decision: 'declareBlockers' }), capped('declareBlockers')],
      [bead('mtg-1', 'declareBlockers')],
    );
    expect(actions.map((one) => one.verdict)).toEqual(['tracked']);
  });

  it('never proposes anything about a bead it did not file', () => {
    const foreign: TrackedBead = { id: 'mtg-9', title: 'Enumerate declareBlockers constructively' };
    expect(diffCompileDownBacklog([record({ decision: 'declareBlockers' })], [foreign])).toEqual([]);
  });

  it('says nothing at all on a clean run against an empty tracker', () => {
    expect(diffCompileDownBacklog([record()], [])).toEqual([]);
  });
});

describe('the commands a person approves', () => {
  it('files with a heredoc body, so the whole bead is in one pasteable command', () => {
    const [action] = diffCompileDownBacklog([capped('declareBlockers')], []);
    const command = commandFor(action!, ARGS) ?? '';
    expect(command).toContain("bd create 'Compile down: enumerate declareBlockers without a cap' -p 2");
    expect(command).toContain("--body-file - <<'BODY'");
    expect(command.trimEnd().endsWith('BODY')).toBe(true);
    expect(command).toContain('512');
  });

  it('carries the parent and priority the caller stated', () => {
    const [action] = diffCompileDownBacklog([capped('declareBlockers')], []);
    const command = commandFor(action!, { parent: 'mtg-bc2', priority: '1' }) ?? '';
    expect(command).toContain('-p 1 --parent mtg-bc2');
  });

  it('runs none of them: the report is text and the tracker is untouched', () => {
    const text = formatDiff(diffCompileDownBacklog([capped('declareBlockers')], []), ARGS);
    expect(text).toContain('1 command(s) to approve');
    expect(text).toContain('bd create');
  });

  it('says plainly when there is nothing to file and nothing to close', () => {
    expect(formatDiff([], ARGS)).toContain('nothing to file and nothing to close');
  });

  it('says so when every kind is tracked or unobserved, rather than printing an empty list', () => {
    const text = formatDiff(
      diffCompileDownBacklog([capped('declareBlockers')], [bead('mtg-1', 'declareBlockers')]),
      ARGS,
    );
    expect(text).toContain('tracked');
    expect(text).toContain('No command to run');
  });
});

describe('the inputs the tool has to be given', () => {
  it('refuses a run that names no records file', () => {
    expect(() => readToolArgs([])).toThrow(/--records is required/);
    expect(() => readToolArgs(['--records'])).toThrow(/--records is required/);
  });

  it('refuses a priority outside 0-4 and an argument it does not know', () => {
    expect(() => readToolArgs(['--records', 'r.json', '--priority', '9'])).toThrow(/--priority must be 0-4/);
    expect(() => readToolArgs(['--records', 'r.json', '--nope'])).toThrow(/unknown argument/);
  });

  it('defaults the tracker to bd itself and takes a file instead when told', () => {
    expect(readToolArgs(['--records', 'r.json']).beadsPath).toBeNull();
    expect(readToolArgs(['--records', 'r.json', '--beads', 'b.json']).beadsPath).toBe('b.json');
  });
});

describe('validating the two files at the boundary', () => {
  it('reads a run that wrote its rulings out with JSON.stringify', () => {
    const parsed = parseRulingRecords(JSON.parse(JSON.stringify([capped('declareBlockers')])) as unknown);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.enumerationComplete).toBe(false);
  });

  it('refuses a stringified boolean, which would read as a complete enumeration', () => {
    expect(() =>
      parseRulingRecords([{ decision: 'priority', enumerationComplete: 'false', optionCount: 2 }]),
    ).toThrow(/enumerationComplete/);
  });

  it('names the index of the record it refused', () => {
    expect(() => parseRulingRecords([record(), { decision: 'priority' }])).toThrow(/records\[1\]/);
    expect(() => parseRulingRecords({})).toThrow(/expected a JSON array/);
  });

  it('reads bd list --json, extra fields and all', () => {
    const parsed = parseTrackedBeads([
      { id: 'mtg-1', title: compileDownTitle('declareBlockers'), status: 'open', priority: 2 },
    ]);
    expect(parsed).toEqual([{ id: 'mtg-1', title: compileDownTitle('declareBlockers') }]);
  });

  it('refuses an issue with no id, which would print `bd close ` and close nothing', () => {
    expect(() => parseTrackedBeads([{ title: 'x' }])).toThrow(/beads\[0\]\.id/);
  });
});
