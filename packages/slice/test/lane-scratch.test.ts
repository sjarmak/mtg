/**
 * Two lanes writing gate output at once, and the paths that keep them apart.
 *
 * `mtg-8h0g` is the incident: concurrent lanes wrote to one scratchpad path, so
 * one lane's evidence overwrote another's and the loser read a summary from a
 * tree that was not its own. The case that matters most here is the concurrent
 * one at the bottom, which runs two lanes' writes against one root and reads
 * both back; the derivation cases above it are what make that outcome a
 * property rather than a coincidence of timing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LaneScratchError,
  describeScratch,
  laneScratchDir,
  laneScratchFile,
  ownedByLane,
} from '../tools/lane-scratch/scratch';

const ROOT = '/scratch/session';
const N28 = { lane: 'n28', agentId: 'agent-a' };

describe('where a lane writes its gate output', () => {
  it('gives a lane a directory of its own under the shared root', () => {
    expect(laneScratchDir(ROOT, N28)).toBe('/scratch/session/lanes/n28/agent-a');
  });

  it('separates two lanes, and a lane from a twin of itself', () => {
    const sibling = laneScratchDir(ROOT, { lane: 'n29', agentId: 'agent-a' });
    const twin = laneScratchDir(ROOT, { lane: 'n28', agentId: 'agent-b' });
    expect(sibling).not.toBe(laneScratchDir(ROOT, N28));
    expect(twin).not.toBe(laneScratchDir(ROOT, N28));
  });

  it('is the same path for the same lane, because a resume comes back to its own evidence', () => {
    expect(laneScratchDir(ROOT, N28)).toBe(laneScratchDir(ROOT, { lane: 'n28', agentId: 'agent-a' }));
  });

  it('refuses a name that would leave the lane directory, naming the value it refused', () => {
    for (const bad of ['../n29', 'n28/sub', '.hidden', '', 'a b']) {
      expect(() => laneScratchDir(ROOT, { lane: bad, agentId: 'agent-a' }), bad).toThrow(LaneScratchError);
    }
    expect(() => laneScratchDir(ROOT, { lane: '../n29', agentId: 'agent-a' })).toThrow(/"\.\.\/n29"/);
    expect(() => laneScratchDir(ROOT, { lane: 'n28', agentId: '../agent-b' })).toThrow(/agent id/);
    expect(() => laneScratchFile(ROOT, N28, '../unit.log')).toThrow(/file name/);
  });

  it('requires a root rather than defaulting to one, because a default is the shared path again', () => {
    expect(() => laneScratchDir('', N28)).toThrow(/scratch root is required/);
  });

  it("answers whether a handed path is this lane's to write", () => {
    expect(ownedByLane(ROOT, N28, '/scratch/session/lanes/n28/agent-a/unit.log')).toBe(true);
    expect(ownedByLane(ROOT, N28, '/scratch/session/lanes/n28/agent-a')).toBe(true);
    expect(ownedByLane(ROOT, N28, '/scratch/session/lanes/n28/agent-b/unit.log')).toBe(false);
    expect(ownedByLane(ROOT, N28, '/scratch/session/unit.log')).toBe(false);
    // The prefix is a directory, not a string: a sibling whose name starts with
    // this lane's is not inside it.
    expect(ownedByLane(ROOT, N28, '/scratch/session/lanes/n28/agent-a-twin/unit.log')).toBe(false);
  });

  it('says where the output went, in the output', () => {
    expect(describeScratch(ROOT, N28)).toContain('/scratch/session/lanes/n28/agent-a');
    expect(describeScratch(ROOT, N28)).toContain('agent-a');
  });
});

describe('the directories on disk', () => {
  const roots: string[] = [];
  function root(): string {
    const made = mkdtempSync(join(tmpdir(), 'lane-scratch-'));
    roots.push(made);
    return made;
  }
  afterAll(() => {
    for (const made of roots) rmSync(made, { recursive: true, force: true });
  });

  const CLI = join(process.cwd(), 'packages/slice/tools/lane-scratch/cli.ts');
  function run(
    args: readonly string[],
    env: Readonly<Record<string, string>> = {},
  ): { status: number; out: string } {
    try {
      const out = execFileSync('npx', ['tsx', CLI, ...args], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, ...env },
      });
      return { status: 0, out };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? -1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  }

  it('keeps two lanes writing the same gate from touching each other', () => {
    const shared = root();
    const lanes = [
      { lane: 'n28', agentId: 'agent-a' },
      { lane: 'n29', agentId: 'agent-b' },
    ];
    for (const lane of lanes) {
      const file = laneScratchFile(shared, lane, 'unit.log');
      mkdirSync(laneScratchDir(shared, lane), { recursive: true });
      writeFileSync(file, `${lane.lane} ran the unit project\n`, 'utf8');
    }
    for (const lane of lanes) {
      expect(readFileSync(laneScratchFile(shared, lane, 'unit.log'), 'utf8')).toBe(
        `${lane.lane} ran the unit project\n`,
      );
    }
  });

  it(
    'prints a bare path so a shell can hold it, creates it on request, and refuses a root it was never given',
    { timeout: 90_000 },
    () => {
      const shared = root();
      const printed = run(['path', 'n28', 'agent-a', '--root', shared]);
      expect(printed.status).toBe(0);
      expect(printed.out.trim()).toBe(laneScratchDir(shared, N28));

      const created = run(['path', 'n28', 'agent-a', '--root', shared, '--create']);
      expect(created.status).toBe(0);
      writeFileSync(join(created.out.trim(), 'unit.log'), 'ran\n', 'utf8');

      const fromEnv = run(['path', 'n28', 'agent-a'], { MTG_SCRATCH_ROOT: shared });
      expect(fromEnv.out.trim()).toBe(laneScratchDir(shared, N28));

      const rootless = run(['path', 'n28', 'agent-a'], { MTG_SCRATCH_ROOT: '' });
      expect(rootless.status).toBe(2);
      expect(rootless.out).toContain('no scratch root');

      const traversal = run(['path', '../n29', 'agent-a', '--root', shared]);
      expect(traversal.status).toBe(2);
      expect(traversal.out).toContain('refused:');

      const mine = run([
        'check',
        'n28',
        'agent-a',
        join(laneScratchDir(shared, N28), 'unit.log'),
        '--root',
        shared,
      ]);
      expect(mine.status).toBe(0);

      const theirs = run([
        'check',
        'n28',
        'agent-a',
        join(laneScratchDir(shared, { lane: 'n29', agentId: 'agent-b' }), 'unit.log'),
        '--root',
        shared,
      ]);
      expect(theirs.status).toBe(1);
      expect(theirs.out).toContain('another lane');
    },
  );
});
