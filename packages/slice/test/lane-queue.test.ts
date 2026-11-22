/**
 * The queue's job is to refuse, so the refusals are what this file holds.
 *
 * Three of them matter more than the ordering: a bead nobody triaged must not
 * disappear into a filtered list, two admission labels must not be silently
 * resolved to one, and a second pixel bead must not be handed out while one is
 * in flight. Each of those is a case where a queue that quietly did the
 * reasonable thing would be worse than one that stops.
 */
import { describe, expect, it } from 'vitest';
import { buildQueue, laneBlockBranch, nextUp, type QueueIssue } from '../tools/lane-queue/queue';

function issue(id: string, labels: readonly string[], over: Partial<QueueIssue> = {}): QueueIssue {
  return {
    id,
    title: `${id} title`,
    priority: 2,
    status: 'open',
    issueType: 'task',
    labels,
    parent: null,
    body: '',
    ...over,
  };
}

/** Nothing is on `origin/main`, which is the shape most of these cases want. */
function nothingLanded(): boolean {
  return false;
}

/** Nothing blocked, which is the shape most of these cases want. */
function allReady(_issues: readonly QueueIssue[]): ReadonlyMap<string, readonly string[]> {
  return new Map();
}

describe('what the queue admits', () => {
  it('queues a ready bead and leaves a decision off the ready list', () => {
    const issues = [
      issue('mtg-aaa', ['ui', 'ready/agent']),
      issue('mtg-bbb', ['ui', 'needs/the playtester']),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready.map((e) => e.issue.id)).toEqual(['mtg-aaa']);
    expect(queue.decisions.map((i) => i.id)).toEqual(['mtg-bbb']);
  });

  it('ignores a bead outside the lane entirely', () => {
    const issues = [issue('mtg-ccc', ['ready/agent'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready).toHaveLength(0);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('never queues an epic, whatever it is labeled', () => {
    const issues = [issue('mtg-ddd', ['ui', 'ready/agent'], { issueType: 'epic' })];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready).toHaveLength(0);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('never queues a plain task that still has an open child, and does not call it untriaged', () => {
    const issues = [
      issue('mtg-ddd', ['ui']),
      issue('mtg-ddd.1', ['ui', 'ready/agent'], { parent: 'mtg-ddd' }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready.map((e) => e.issue.id)).toEqual(['mtg-ddd.1']);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('reports an untriaged bead rather than dropping it', () => {
    const issues = [issue('mtg-eee', ['ui'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.untriaged.map((i) => i.id)).toEqual(['mtg-eee']);
    expect(queue.ready).toHaveLength(0);
  });

  it('refuses a bead carrying two admission labels instead of picking one', () => {
    const issues = [issue('mtg-fff', ['ui', 'ready/agent', 'needs/the playtester'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.conflicted.map((i) => i.id)).toEqual(['mtg-fff']);
    expect(queue.ready).toHaveLength(0);
    expect(queue.decisions).toHaveLength(0);
  });

  it('collects every blocked kind under one heading, since no session here moves any', () => {
    const issues = [
      issue('mtg-ggg', ['ui', 'blocked/device']),
      issue('mtg-hhh', ['ui', 'blocked/env'], { priority: 1 }),
      issue('mtg-iii', ['ui', 'blocked/lane'], {
        priority: 3,
        body: 'blocked on `work/mtg-other` at `abc1234`',
      }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    // Priority first and the kind not at all: the three are one section because
    // the reader's question is the same for all of them.
    expect(queue.blocked.map((i) => i.id)).toEqual(['mtg-hhh', 'mtg-ggg', 'mtg-iii']);
  });

  it('never hands out a bead another lane is about to rewrite', () => {
    // `mtg-isbc` is the case: its whole remaining scope is two edits to
    // `read-log.ts` and `log-schema.ts`, and an unintegrated commit on
    // `codex/rtr-overload-integrate` rewrites both. Two sessions claimed it,
    // read the same branch, and released it — which is the queue handing out a
    // bead nobody can take, twice, and the third session paying for it again.
    const issues = [
      issue('mtg-jjj', ['ui', 'blocked/lane'], {
        priority: 0,
        body: 'blocked on `work/mtg-other` at `abc1234`',
      }),
      issue('mtg-kkk', ['ui', 'ready/agent'], { priority: 3 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready.map((e) => e.issue.id)).toEqual(['mtg-kkk']);
    expect(nextUp(queue)?.issue.id).toBe('mtg-kkk');
    expect(queue.blocked.map((i) => i.id)).toEqual(['mtg-jjj']);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('refuses a lane block paired with a readiness claim, like any other pair', () => {
    const issues = [issue('mtg-lll', ['ui', 'ready/agent', 'blocked/lane'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.conflicted.map((i) => i.id)).toEqual(['mtg-lll']);
    expect(queue.ready).toHaveLength(0);
    expect(queue.blocked).toHaveLength(0);
  });
});

describe('laneBlockBranch reads either convention this lane has used', () => {
  it('reads the backtick-branch-at-backtick-sha convention', () => {
    expect(laneBlockBranch('naming `work/mtg-t5ma0` at `f67ff1cb5`')).toEqual({
      branch: 'work/mtg-t5ma0',
      commit: 'f67ff1cb5',
    });
  });

  it('reads the parenthetical branch-comma-head convention', () => {
    expect(laneBlockBranch('(branch work/mtg-t5ma0, head f67ff1cb5 at filing)')).toEqual({
      branch: 'work/mtg-t5ma0',
      commit: 'f67ff1cb5',
    });
  });

  it('finds nothing in prose that names no work/ branch', () => {
    expect(laneBlockBranch('both files carry uncommitted work from another lane')).toBeNull();
  });
});

describe('a blocked/lane label the queue can check against origin/main', () => {
  // mtg-gy05r: `mtg-in4k9` and `mtg-pt9dp` both named `work/mtg-t5ma0` at `f67ff1cb5`
  // after that branch had already landed, and the one-command check that would
  // have caught it passed, because nothing ran it.
  it('reports a stale block under its own heading, out of the blocked list, and never ready', () => {
    const issues = [
      issue('mtg-mmm', ['ui', 'blocked/lane'], {
        body: 'sequence it after the bridge lane (branch work/mtg-t5ma0, head f67ff1cb5 at filing) lands',
      }),
    ];
    const queue = buildQueue(issues, allReady(issues), (branch) => branch === 'work/mtg-t5ma0');
    expect(queue.staleLaneBlocks.map((i) => i.id)).toEqual(['mtg-mmm']);
    expect(queue.blocked).toHaveLength(0);
    expect(queue.ready).toHaveLength(0);
    expect(nextUp(queue)).toBeNull();
  });

  it('leaves a lane block naming an unlanded branch in the ordinary blocked list', () => {
    const issues = [
      issue('mtg-nnn', ['ui', 'blocked/lane'], {
        body: 'naming `work/mtg-t5ma0` at `f67ff1cb5`',
      }),
    ];
    const queue = buildQueue(issues, allReady(issues), nothingLanded);
    expect(queue.blocked.map((i) => i.id)).toEqual(['mtg-nnn']);
    expect(queue.staleLaneBlocks).toHaveLength(0);
    expect(queue.unresolvedLaneBlocks).toHaveLength(0);
  });

  it('reports a lane block naming no resolvable branch as its own, weaker failure', () => {
    // mtg-wk2x and mtg-4pj3m are real examples: both carry `blocked/lane` and describe
    // uncommitted work in prose, naming no `work/...` branch a check could run against.
    const issues = [
      issue('mtg-ooo', ['ui', 'blocked/lane'], {
        body: 'both files carry uncommitted work from another lane in this tree',
      }),
    ];
    const queue = buildQueue(issues, allReady(issues), nothingLanded);
    expect(queue.unresolvedLaneBlocks.map((i) => i.id)).toEqual(['mtg-ooo']);
    expect(queue.blocked).toHaveLength(0);
    expect(queue.ready).toHaveLength(0);
  });
});

describe('the order the ready queue is taken in', () => {
  it('takes the higher priority first and breaks a tie by id', () => {
    const issues = [
      issue('mtg-zzz', ['ui', 'ready/agent'], { priority: 3 }),
      issue('mtg-mmm', ['ui', 'ready/agent'], { priority: 0 }),
      issue('mtg-aab', ['ui', 'ready/agent'], { priority: 3 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready.map((e) => e.issue.id)).toEqual(['mtg-mmm', 'mtg-aab', 'mtg-zzz']);
    expect(nextUp(queue)?.issue.id).toBe('mtg-mmm');
  });

  it('holds a ready bead behind a real blocker and names it', () => {
    const issues = [issue('mtg-iii', ['ui', 'ready/agent'])];
    const queue = buildQueue(issues, new Map([['mtg-iii', ['mtg-jjj']]]));
    expect(queue.ready[0]?.held).toBe('blocked by mtg-jjj');
    expect(nextUp(queue)).toBeNull();
  });

  it('does not treat an open parent as a blocker, since every bead here has one', () => {
    const issues = [issue('mtg-iii', ['ui', 'ready/agent'], { parent: 'mtg-epic' })];
    const queue = buildQueue(issues, new Map([['mtg-iii', ['mtg-epic']]]));
    expect(queue.ready[0]?.held).toBeNull();
    expect(nextUp(queue)?.issue.id).toBe('mtg-iii');
  });
});

describe('one pixel lane at a time', () => {
  it('hands out one browser-measured bead and holds the next, naming the holder', () => {
    const issues = [
      issue('mtg-jjj', ['ui', 'ready/agent', 'serial/pixels'], { priority: 1 }),
      issue('mtg-kkk', ['ui', 'ready/agent', 'serial/pixels'], { priority: 1 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready[0]?.held).toBeNull();
    expect(queue.ready[1]?.held).toContain('mtg-jjj');
    expect(nextUp(queue)?.issue.id).toBe('mtg-jjj');
  });

  it('lets a bead that measures no pixels run beside the pixel lane', () => {
    const issues = [
      issue('mtg-lll', ['ui', 'ready/agent', 'serial/pixels'], { priority: 1 }),
      issue('mtg-nnn', ['ui', 'ready/agent'], { priority: 2 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.ready.every((e) => e.held === null)).toBe(true);
  });

  it('holds the whole pixel queue while one is already claimed', () => {
    const issues = [
      issue('mtg-ooo', ['ui', 'ready/agent', 'serial/pixels'], { status: 'in_progress', priority: 1 }),
      issue('mtg-ppp', ['ui', 'ready/agent', 'serial/pixels'], { priority: 1 }),
      issue('mtg-qqq', ['ui', 'ready/agent'], { priority: 1 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.inFlight.map((i) => i.id)).toEqual(['mtg-ooo']);
    expect(queue.ready.map((e) => e.issue.id)).toEqual(['mtg-ppp', 'mtg-qqq']);
    expect(queue.ready[0]?.held).toContain('mtg-ooo');
    expect(nextUp(queue)?.issue.id).toBe('mtg-qqq');
  });
});

describe("the pixel constraint is the machine's, not the lane's", () => {
  it('reports a browser-measured bead carrying no lane label rather than ignoring it', () => {
    // Found by hand on 2026-09-04, twice in one pass: `mtg-9uhe` and `mtg-txde`
    // carried `serial/pixels` and an admission label and not `ui`, so the queue
    // printed them in no section at all — not ready, not blocked, not
    // untriaged. A bead the queue cannot see is worse than one it refuses,
    // because the refusal is the whole product here.
    const issues = [issue('mtg-ccc', ['ready/agent', 'serial/pixels'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.offLane.map((i) => i.id)).toEqual(['mtg-ccc']);
    expect(queue.ready).toHaveLength(0);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('still ignores a bead outside the lane that measures nothing', () => {
    // The section is not a second lane. `mtg-qx35` is a kernel bead carrying
    // `ready/agent`, and it is right that this queue never mentions it.
    const issues = [issue('mtg-ccc', ['kernel', 'ready/agent'])];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.offLane).toHaveLength(0);
    expect(queue.ready).toHaveLength(0);
    expect(queue.untriaged).toHaveLength(0);
  });

  it('lets a measurement in flight outside the lane hold the lane, since the box is one box', () => {
    const issues = [
      issue('mtg-ccc', ['ready/agent', 'serial/pixels'], { status: 'in_progress', priority: 1 }),
      issue('mtg-ppp', ['ui', 'ready/agent', 'serial/pixels'], { priority: 1 }),
      issue('mtg-qqq', ['ui', 'ready/agent'], { priority: 1 }),
    ];
    const queue = buildQueue(issues, allReady(issues));
    expect(queue.offLane.map((i) => i.id)).toEqual(['mtg-ccc']);
    expect(queue.ready[0]?.held).toContain('mtg-ccc');
    expect(nextUp(queue)?.issue.id).toBe('mtg-qqq');
  });
});
