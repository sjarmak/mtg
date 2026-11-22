import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const tool = fileURLToPath(new URL('../tools/build-printed-script-coverage-plan.ts', import.meta.url));

it('requires explicit catalogs, script archive, and semantic review plan', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', tool], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage: build-printed-script-coverage-plan');
  expect(result.stdout).toBe('');
});
