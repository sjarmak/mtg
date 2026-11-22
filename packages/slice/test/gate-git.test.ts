import { describe, expect, it } from 'vitest';
import { git } from '../tools/gate/git';

describe('the gate reads git output of any size', () => {
  it('returns a listing larger than the default spawnSync buffer', () => {
    const listing = git(['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(Buffer.byteLength(listing)).toBeGreaterThan(1024 * 1024);
  });

  it('names the failed command when git exits non-zero', () => {
    expect(() => git(['rev-parse', '--verify', 'no-such-ref-for-gate-test'])).toThrow(/git rev-parse/);
  });
});
