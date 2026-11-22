import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  barForChangedFiles,
  changedTestListCommand,
  directTestListCommand,
  directReaderTestFiles,
  gatePlan,
  isFullBarFile,
  parseListedTestFiles,
  relatedTestCommand,
} from '../tools/gate/scope';

describe('gate scope', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('keeps a CSS-only change scoped to UI tests and skips the simulation gate', () => {
    const plan = gatePlan(
      ['packages/ui/src/styles/table.css'],
      ['packages/ui/test/table.browser.test.ts'],
      [],
    );

    expect(plan).toEqual({
      bar: 'scoped',
      changedFiles: ['packages/ui/src/styles/table.css'],
      reviewTestFiles: ['packages/ui/test/table.browser.test.ts'],
      mergeTestFiles: [],
    });
  });

  it('selects balance and calibration when a kernel change reaches simulations', () => {
    const plan = gatePlan(
      ['packages/kernel/src/reduce.ts'],
      ['packages/kernel/test/reduce.test.ts'],
      [
        'packages/metrics/test/balance/format-health.test.ts',
        'packages/metrics/test/legacy-cube-quality-pipeline.test.ts',
      ],
    );

    expect(plan.bar).toBe('scoped');
    expect(plan.mergeTestFiles).toEqual([
      'packages/metrics/test/balance/format-health.test.ts',
      'packages/metrics/test/legacy-cube-quality-pipeline.test.ts',
    ]);
  });

  it('forces the full bar for a package manifest', () => {
    expect(barForChangedFiles(['packages/ui/package.json'])).toBe('full');
    expect(gatePlan(['package.json'], [], []).bar).toBe('full');
  });

  it('keeps the full-bar file decision invariant under ordering and duplicates', () => {
    const ordinary = ['packages/ui/src/App.tsx', 'packages/kernel/src/reduce.ts'];
    const global = ['vitest.config.ts', ...ordinary];
    for (const changed of [global, [...global].reverse(), [...global, ...global]]) {
      expect(barForChangedFiles(changed)).toBe('full');
    }
    for (const changed of [ordinary, [...ordinary].reverse(), [...ordinary, ...ordinary]]) {
      expect(barForChangedFiles(changed)).toBe('scoped');
    }
  });

  it('holds the global file list in one exported predicate', () => {
    expect(
      [
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'tsconfig.build.json',
        'vitest.config.ts',
        'eslint.config.mjs',
        '.prettierrc.json',
        'packages/ui/package.json',
        'packages/slice/tools/gate/cli.ts',
        'packages/slice/tools/test-load/reporter.ts',
        'packages/ui/test/helpers.ts',
        'packages/deckbuild/test/helpers/pool.ts',
      ].every(isFullBarFile),
    ).toBe(true);
    expect(isFullBarFile('packages/ui/src/App.tsx')).toBe(false);
  });

  it('selects tests that name a changed document even when there is no import edge', () => {
    const root = mkdtempSync(join(tmpdir(), 'mtg-gate-scope-'));
    roots.push(root);
    mkdirSync(join(root, 'packages/slice/test'), { recursive: true });
    writeFileSync(
      join(root, 'packages/slice/test/reads-doc.test.ts'),
      "readFileSync(join(root, 'CLAUDE.md'), 'utf8')\n",
      'utf8',
    );
    writeFileSync(join(root, 'packages/slice/test/unrelated.test.ts'), "readFileSync('README.md')\n", 'utf8');

    expect(directReaderTestFiles(root, ['CLAUDE.md'])).toEqual(['packages/slice/test/reads-doc.test.ts']);
  });

  it('builds vitest related over changed files and direct readers for named projects', () => {
    expect(
      relatedTestCommand(
        ['packages/ui/src/styles/table.css'],
        ['packages/ui/test/reads-style.test.ts'],
        ['unit', 'browser'],
      ),
    ).toEqual([
      'node_modules/.bin/vitest',
      'related',
      '--run',
      '--passWithNoTests',
      '--project',
      'unit',
      '--project',
      'browser',
      'packages/ui/src/styles/table.css',
      'packages/ui/test/reads-style.test.ts',
    ]);
  });

  it('starts vitest directly when the related scope contains eleven thousand paths', () => {
    const paths = Array.from(
      { length: 11_000 },
      (_, index) => `packages/synthetic/path-${index.toString().padStart(5, '0')}.ts`,
    );
    const command = relatedTestCommand(paths, [], ['unit', 'browser']);
    const [binary] = command;

    expect(binary).toBe('node_modules/.bin/vitest');
    expect(binary).not.toBe('npx');
    if (binary === undefined) throw new Error('related command has no binary');
    const result = spawnSync(binary, ['--version', ...paths], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it('parses and deduplicates vitest list output without retaining project labels', () => {
    expect(
      parseListedTestFiles(
        '[unit] packages/kernel/test/reduce.test.ts\n' +
          '[balance] packages/metrics/test/balance/format-health.test.ts\n' +
          '[unit] packages/kernel/test/reduce.test.ts\n',
      ),
    ).toEqual(['packages/kernel/test/reduce.test.ts', 'packages/metrics/test/balance/format-health.test.ts']);
  });

  it('builds merge-selection commands for import edges and direct readers', () => {
    expect(changedTestListCommand('abc123', ['balance', 'calibration'])).toEqual([
      'node_modules/.bin/vitest',
      'list',
      '--changed',
      'abc123',
      '--filesOnly',
      '--passWithNoTests',
      '--project',
      'balance',
      '--project',
      'calibration',
    ]);
    expect(
      directTestListCommand(['packages/metrics/test/balance/format-health.test.ts'], ['balance']),
    ).toEqual([
      'node_modules/.bin/vitest',
      'list',
      '--filesOnly',
      '--passWithNoTests',
      '--project',
      'balance',
      'packages/metrics/test/balance/format-health.test.ts',
    ]);
  });
});
