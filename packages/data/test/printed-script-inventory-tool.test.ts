import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tool = fileURLToPath(new URL('../tools/inventory-printed-scripts.ts', import.meta.url));
const catalogPath = fileURLToPath(new URL('../data/akh-hou/akh-printed-catalog-v1.json', import.meta.url));
const run = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', tool, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });

describe('script inventory CLI refusal boundaries', () => {
  it('requires explicit inputs', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: inventory-printed-scripts');
    expect(result.stdout).toBe('');
  });

  it('rejects a stale catalog before attempting any archive access', () => {
    const directory = mkdtempSync(join(tmpdir(), 'printed-inventory-'));
    try {
      const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
      const path = join(directory, 'stale.json');
      writeFileSync(path, JSON.stringify({ ...catalog, forgeVersion: 'changed' }));
      const result = run(['--catalog', path, '--forge-scripts', join(directory, 'absent.zip')]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('catalog checksum mismatch');
      expect(result.stderr).not.toContain('ENOENT');
      expect(result.stdout).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not emit a partial inventory when archive extraction fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'printed-inventory-'));
    try {
      const path = join(directory, 'invalid.zip');
      writeFileSync(path, 'not an archive');
      const result = run(['--catalog', catalogPath, '--forge-scripts', path]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unzip');
      expect(result.stdout).toBe('');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
