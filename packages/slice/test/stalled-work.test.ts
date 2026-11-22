/**
 * Each classification case is a branch state the CLI's `git`/`bd` calls could
 * have produced, and the one bucket (or none) it belongs in. The two that
 * matter most are the ones the naive ancestor-only check gets wrong: a branch
 * confirmed landed under another sha must not read as a stall, and a branch
 * tracing to no bead at all must not be dropped just because it is not a
 * confirmed finding either.
 *
 * The reader cases hold the other half: `bd show` exits 1 for a missing bead
 * and for an unreachable Dolt server alike, and only the first is an orphan.
 */
import { describe, expect, it } from 'vitest';
import {
  ancestorVerdict,
  branchToBeadId,
  classifyBranches,
  isClean,
  parseBeadShow,
  type BeadLookup,
  type BranchState,
  type CommandResult,
} from '../tools/stalled-work/stalled-work';

function state(over: Partial<BranchState> & { branch: string }): BranchState {
  return { isAncestor: false, recutMergeSha: null, ...over };
}

describe('branchToBeadId', () => {
  it('strips the work/ prefix and nothing else', () => {
    expect(branchToBeadId('work/mtg-76nd4')).toBe('mtg-76nd4');
    expect(branchToBeadId('work/mtg-bc2.154.6.5.4')).toBe('mtg-bc2.154.6.5.4');
  });
});

describe('classifyBranches', () => {
  it('says nothing about a branch that is already an ancestor of origin/main', () => {
    const result = classifyBranches([state({ branch: 'work/mtg-aaa', isAncestor: true })], () => null);
    expect(isClean(result)).toBe(true);
  });

  it('reports a closed bead whose branch carries unconfirmed content as a stall', () => {
    const beadOf = (id: string): BeadLookup | null => (id === 'mtg-bbb' ? { id, status: 'closed' } : null);
    const result = classifyBranches([state({ branch: 'work/mtg-bbb' })], beadOf);
    expect(result.unlanded).toEqual([{ branch: 'work/mtg-bbb', beadId: 'mtg-bbb' }]);
    expect(result.recutDuplicates).toHaveLength(0);
    expect(result.orphans).toHaveLength(0);
  });

  it('separates a recut duplicate from a stall instead of counting it as one', () => {
    const beadOf = (): BeadLookup | null => {
      throw new Error('a confirmed recut duplicate must not need a bead lookup at all');
    };
    const result = classifyBranches(
      [state({ branch: 'work/mtg-ccc', recutMergeSha: '1234567890abcdef1234567890abcdef12345678' })],
      beadOf,
    );
    expect(result.recutDuplicates).toEqual([
      { branch: 'work/mtg-ccc', mergeSha: '1234567890abcdef1234567890abcdef12345678' },
    ]);
    expect(result.unlanded).toHaveLength(0);
  });

  it('names a branch with no bead and no merge line as a question rather than dropping it', () => {
    const result = classifyBranches([state({ branch: 'work/mtg-i92lu-w2' })], () => null);
    expect(result.orphans).toEqual([{ branch: 'work/mtg-i92lu-w2' }]);
    expect(result.unlanded).toHaveLength(0);
    expect(result.recutDuplicates).toHaveLength(0);
  });

  it('does not report a branch whose bead is still open: that is expected in-flight work', () => {
    const beadOf = (id: string): BeadLookup | null => ({ id, status: 'open' });
    const result = classifyBranches([state({ branch: 'work/mtg-ddd' })], beadOf);
    expect(isClean(result)).toBe(true);
  });

  it('is clean only when every bucket is empty', () => {
    expect(isClean({ unlanded: [], recutDuplicates: [], orphans: [] })).toBe(true);
    expect(isClean({ unlanded: [{ branch: 'b', beadId: 'x' }], recutDuplicates: [], orphans: [] })).toBe(
      false,
    );
  });
});

function ran(over: Partial<CommandResult>): CommandResult {
  return { status: 0, stdout: '', stderr: '', ...over };
}

describe('ancestorVerdict', () => {
  it('reads exit 0 as an ancestor and exit 1 as not one', () => {
    expect(ancestorVerdict(ran({ status: 0 }))).toBe(true);
    expect(ancestorVerdict(ran({ status: 1 }))).toBe(false);
  });

  it('throws on any other exit instead of calling the branch unlanded', () => {
    expect(() =>
      ancestorVerdict(ran({ status: 128, stderr: 'fatal: Not a valid object name origin/main' })),
    ).toThrow(/exit 128.*origin\/main/);
    expect(() => ancestorVerdict(ran({ status: null }))).toThrow(/failed/);
  });
});

describe('parseBeadShow', () => {
  it('narrows a bead row to id and status', () => {
    const stdout = JSON.stringify([{ id: 'mtg-x', status: 'closed', title: 'ignored', dependencies: [] }]);
    expect(parseBeadShow(ran({ stdout }))).toEqual({ id: 'mtg-x', status: 'closed' });
  });

  it('answers null for a bead bd says does not exist', () => {
    const missing = ran({ status: 1, stderr: 'Issue mtg-i92lu-w2 not found\nHint: ...' });
    expect(parseBeadShow(missing)).toBeNull();
  });

  it('throws when bd itself is unreachable, which exits 1 just as a missing bead does', () => {
    const down = ran({
      status: 1,
      stderr: 'Error: failed to open database: Dolt server unreachable at 127.0.0.1:0',
    });
    expect(() => parseBeadShow(down)).toThrow(/Dolt server unreachable/);
  });

  it('throws on an answer that is not a bead row', () => {
    expect(() => parseBeadShow(ran({ stdout: '[]' }))).toThrow(/no bead/);
    expect(() => parseBeadShow(ran({ stdout: '[{"id":"mtg-x"}]' }))).toThrow(/did not answer with a bead/);
  });
});
