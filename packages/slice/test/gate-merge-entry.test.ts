import type { SpawnSyncReturns } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { buildMergeInvocation, main, systemdUserScopeAvailable } from '../tools/gate/merge-entry';

function result(status: number | null): SpawnSyncReturns<Buffer> {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status,
    signal: null,
  };
}

describe('gate:merge entry point', () => {
  it('builds a transient default-weight scope invocation when systemd-run is available', () => {
    expect(buildMergeInvocation(true, ['--beside-lanes'])).toEqual({
      command: 'systemd-run',
      args: [
        '--user',
        '--scope',
        '--collect',
        '-p',
        'CPUWeight=100',
        '--',
        'tsx',
        'packages/slice/tools/gate/merge.ts',
        '--beside-lanes',
      ],
    });
  });

  it('builds the existing direct invocation without a systemd user scope', () => {
    expect(buildMergeInvocation(false, [])).toEqual({
      command: 'tsx',
      args: ['packages/slice/tools/gate/merge.ts'],
    });
  });

  it('requires both systemd-run and a reachable user manager', () => {
    const available = vi.fn().mockReturnValueOnce(result(0)).mockReturnValueOnce(result(0));
    const noManager = vi.fn().mockReturnValueOnce(result(0)).mockReturnValueOnce(result(1));
    expect(systemdUserScopeAvailable(available)).toBe(true);
    expect(systemdUserScopeAvailable(noManager)).toBe(false);
  });

  it('propagates the delegated command exit code unchanged', () => {
    const spawn = vi.fn().mockReturnValue(result(23));
    expect(main([], { available: () => true, spawn, write: vi.fn() })).toBe(23);
  });

  it('states when it falls back to the caller scope', () => {
    const write = vi.fn();
    const spawn = vi.fn().mockReturnValue(result(0));
    expect(main([], { available: () => false, spawn, write })).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("systemd user scope isn't available"));
    expect(spawn).toHaveBeenCalledWith(
      'tsx',
      ['packages/slice/tools/gate/merge.ts'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });
});
