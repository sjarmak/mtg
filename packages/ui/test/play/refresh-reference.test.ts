/**
 * The launcher rebuilds the reduced reference sets before it stages them.
 *
 * The reduced historical sets are the positions committed audited milestones
 * prove the kernel can run, and that corpus grows: the build staged on 2026-08-24 was
 * emitted on 2026-08-21 and held 162 of M11's 249 positions where the current
 * command produces 247. A person looking at the Cards tab has no way to tell a
 * set that is missing playable cards from a set that never had them.
 *
 * The emitter resolves no provider, reads only committed inputs and takes 2.6s,
 * so the launcher runs it rather than trusting whatever `out/reference` happens
 * to hold. Everything it can fail at is tolerated: a checkout without the
 * research package (it is private and does not export), a failed run, a missing
 * `tsx`. In every one of those the sets already on disk are staged and the
 * launcher says what happened, because a launcher that refuses to open a game
 * over a reference build is worse than one that opens a slightly older one.
 */
import { describe, expect, it } from 'vitest';
import { describeReferenceRefresh, refreshReferenceSets } from '../../tools/refresh-reference';

const OUT = '/repo/out/reference';

describe('rebuilding the reduced reference sets', () => {
  it('runs the emitter and reports what it kept', () => {
    const calls: string[][] = [];
    const refresh = refreshReferenceSets('/repo', {
      exists: () => true,
      run: (command, argv) => {
        calls.push([command, ...argv]);
        return {
          ok: true,
          stdout:
            'M11: kept 247 of 249 collector positions, dropped 2 (2 with an identity-level reason).\n' +
            'M13: kept 170 of 249 collector positions, dropped 79 (79 with an identity-level reason).\n' +
            'RTR: kept 37 of 274 collector positions, dropped 237 (237 with an identity-level reason).\n',
        };
      },
    });
    expect(refresh.ran).toBe(true);
    expect(calls[0]?.slice(-3)).toEqual(['--out', OUT, '--all']);
    expect(describeReferenceRefresh(refresh)).toContain('M11 247');
    expect(describeReferenceRefresh(refresh)).toContain('M13 170');
    expect(describeReferenceRefresh(refresh)).toContain('RTR 37');
  });

  it('stages what is on disk when the research package is not in this checkout', () => {
    const refresh = refreshReferenceSets('/repo', {
      exists: () => false,
      run: () => {
        throw new Error('the emitter must not be run when it is not there');
      },
    });
    expect(refresh.ran).toBe(false);
    expect(describeReferenceRefresh(refresh)).toContain('not in this checkout');
  });

  it('says a failed run failed, and leaves the build that is there', () => {
    const refresh = refreshReferenceSets('/repo', {
      exists: () => true,
      run: () => ({ ok: false, stdout: 'Error: pinned corpus is not a regular file\n' }),
    });
    expect(refresh.ran).toBe(false);
    expect(describeReferenceRefresh(refresh)).toContain('pinned corpus is not a regular file');
  });
});
