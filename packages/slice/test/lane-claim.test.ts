/**
 * The decision table that stops a twin, and the file it is written to.
 *
 * `mtg-cb2e` is the incident: a host restart spawned a second agent into a
 * worktree a first one was already writing, and the two never saw each other.
 * The claim's whole job is to make the second one stop, so the case that matters
 * most here is the refusal, and the case most likely to be broken by a later
 * edit is the resume — a rule that refused a resume would make every restart a
 * dead lane, which is worse than the bug it fixes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decideClaim, mayRelease, type LaneClaim } from '../tools/lane-claim/claim';
import { claimPath, readClaim } from '../tools/lane-claim/cli';

function claim(agentId: string, lane = 'n28'): LaneClaim {
  return { lane, agentId, claimedAt: '2026-08-20T18:00:00.000Z' };
}

describe('who may write a lane worktree', () => {
  it('grants an unclaimed worktree', () => {
    const verdict = decideClaim(null, claim('agent-a'), false);
    expect(verdict.granted).toBe(true);
    if (verdict.granted) expect(verdict.displaced).toBeNull();
  });

  it('grants the agent that already holds it, because that is a resume', () => {
    const verdict = decideClaim(claim('agent-a'), claim('agent-a'), false);
    expect(verdict.granted).toBe(true);
    expect(verdict.why).toContain('resume');
  });

  it('refuses a second agent, and names the holder in the refusal', () => {
    const verdict = decideClaim(claim('agent-a'), claim('agent-b'), false);
    expect(verdict.granted).toBe(false);
    expect(verdict.why).toContain('agent-a');
    expect(verdict.why).toContain('mtg-cb2e');
    if (!verdict.granted) expect(verdict.holder.agentId).toBe('agent-a');
  });

  it('grants a forced claim and reports whose it was', () => {
    const verdict = decideClaim(claim('agent-a'), claim('agent-b'), true);
    expect(verdict.granted).toBe(true);
    if (verdict.granted) expect(verdict.displaced?.agentId).toBe('agent-a');
  });

  it('lets only the holder release', () => {
    expect(mayRelease(claim('agent-a'), 'agent-a')).toBe(true);
    expect(mayRelease(claim('agent-a'), 'agent-b')).toBe(false);
    expect(mayRelease(null, 'agent-a')).toBe(false);
  });
});

describe('the claim on disk', () => {
  const roots: string[] = [];
  function worktree(): string {
    const root = mkdtempSync(join(tmpdir(), 'lane-claim-'));
    roots.push(root);
    return root;
  }
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const CLI = join(process.cwd(), 'packages/slice/tools/lane-claim/cli.ts');
  function run(args: readonly string[]): { status: number; out: string } {
    try {
      const out = execFileSync('npx', ['tsx', CLI, ...args], { encoding: 'utf8', stdio: 'pipe' });
      return { status: 0, out };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? -1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  }

  it('reads back nothing from a worktree nobody claimed', () => {
    expect(readClaim(worktree())).toBeNull();
  });

  it('refuses to read a file that is not a claim, rather than treating it as one', () => {
    const root = worktree();
    writeFileSync(claimPath(root), '{"lane":"n28"}\n', 'utf8');
    expect(() => readClaim(root)).toThrow(/is not a lane claim/);
  });

  it(
    'writes the claim, refuses the twin with exit 1, and releases only for its holder',
    { timeout: 60_000 },
    () => {
      const root = worktree();
      const first = run(['claim', root, 'agent-a']);
      expect(first.status).toBe(0);
      expect(readClaim(root)?.agentId).toBe('agent-a');

      const twin = run(['claim', root, 'agent-b']);
      expect(twin.status).toBe(1);
      expect(twin.out).toContain('agent-a');
      expect(readClaim(root)?.agentId).toBe('agent-a');

      const resumed = run(['claim', root, 'agent-a']);
      expect(resumed.status).toBe(0);

      const notHolder = run(['release', root, 'agent-b']);
      expect(notHolder.status).toBe(0);
      expect(readClaim(root)?.agentId).toBe('agent-a');

      const forced = run(['claim', root, 'agent-b', '--force']);
      expect(forced.status).toBe(0);
      expect(JSON.parse(readFileSync(claimPath(root), 'utf8'))).toMatchObject({
        agentId: 'agent-b',
        displaced: 'agent-a',
      });

      const released = run(['release', root, 'agent-b']);
      expect(released.status).toBe(0);
      expect(readClaim(root)).toBeNull();
    },
  );
});
