import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tool = fileURLToPath(new URL('../tools/fetch-printed-sources.ts', import.meta.url));
function run(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', tool, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('printed source acquisition CLI safety', () => {
  it('requires an explicit destination and source list before network access', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: fetch-printed-sources');
  });

  it('rejects malformed source lists before creating an output directory', () => {
    const result = run(['--out', 'unused', '--sets', 'AKH,AKH']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unique uppercase set codes');
  });

  it('refuses overwriting an existing pin before network access', () => {
    const out = mkdtempSync(join(tmpdir(), 'printed-source-refusal-'));
    try {
      const result = run(['--out', out, '--sets', 'AKH']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('EEXIST');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
