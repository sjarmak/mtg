import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type GateBar = 'full' | 'scoped';

export interface GatePlan {
  readonly bar: GateBar;
  readonly changedFiles: readonly string[];
  readonly reviewTestFiles: readonly string[];
  readonly mergeTestFiles: readonly string[];
}

const VITEST_BINARY = 'node_modules/.bin/vitest';

const FULL_BAR_FILES: readonly RegExp[] = [
  /^package(?:-lock)?\.json$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^vitest\.config\.[^/]+$/,
  /^(?:eslint|prettier)\.config\.[^/]+$/,
  /^\.(?:eslint|prettier)rc(?:\.[^/]+)?$/,
  /^packages\/[^/]+\/package\.json$/,
  /^packages\/slice\/tools\/gate(?:\/|$)/,
  /^packages\/slice\/tools\/test-load(?:\/|$)/,
  /^packages\/[^/]+\/test\/(?:helpers|setup)(?:\.[^/]+|\/)/,
];

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function isFullBarFile(path: string): boolean {
  return FULL_BAR_FILES.some((pattern) => pattern.test(path));
}

export function barForChangedFiles(changedFiles: readonly string[]): GateBar {
  return changedFiles.some(isFullBarFile) ? 'full' : 'scoped';
}

export function gatePlan(
  changedFiles: readonly string[],
  reviewTestFiles: readonly string[],
  mergeTestFiles: readonly string[],
): GatePlan {
  return {
    bar: barForChangedFiles(changedFiles),
    changedFiles: sortedUnique(changedFiles),
    reviewTestFiles: sortedUnique(reviewTestFiles),
    mergeTestFiles: sortedUnique(mergeTestFiles),
  };
}

export function directReaderTestFiles(root: string, changedFiles: readonly string[]): string[] {
  const needles = sortedUnique(changedFiles.flatMap((path) => [path, basename(path)])).filter(
    (needle) => needle !== '',
  );
  if (needles.length === 0) return [];
  const tests = globSync('packages/*/test/**/*.test.{ts,tsx}', { cwd: root });
  return tests
    .filter((path) => {
      const source = readFileSync(`${root}/${path}`, 'utf8');
      return needles.some((needle) => source.includes(needle));
    })
    .sort();
}

export function relatedTestCommand(
  changedFiles: readonly string[],
  directReaders: readonly string[],
  projects: readonly string[],
): string[] {
  return [
    VITEST_BINARY,
    'related',
    '--run',
    '--passWithNoTests',
    ...projects.flatMap((project) => ['--project', project]),
    ...sortedUnique([...changedFiles, ...directReaders]),
  ];
}

function projectFlags(projects: readonly string[]): string[] {
  return projects.flatMap((project) => ['--project', project]);
}

export function changedTestListCommand(baseSha: string, projects: readonly string[]): string[] {
  return [
    VITEST_BINARY,
    'list',
    '--changed',
    baseSha,
    '--filesOnly',
    '--passWithNoTests',
    ...projectFlags(projects),
  ];
}

export function directTestListCommand(testFiles: readonly string[], projects: readonly string[]): string[] {
  return [
    VITEST_BINARY,
    'list',
    '--filesOnly',
    '--passWithNoTests',
    ...projectFlags(projects),
    ...sortedUnique(testFiles),
  ];
}

export function parseListedTestFiles(output: string): string[] {
  return sortedUnique(
    output
      .split('\n')
      .map((line) => line.trim().replace(/^\[[^\]]+\]\s+/, ''))
      .filter((line) => line !== ''),
  );
}
