import { afterEach, expect, it, vi } from 'vitest';
import ScheduledFilesReporter from '../tools/test-load/scheduled-files';
import config from '../../../vitest.config';

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

const first = { taskId: 'unit/a', moduleId: '/a.test.ts' };
const later = { taskId: 'calibration/a', moduleId: '/a.test.ts' };

it('rejects an entire scheduled group missing after a reporting timeout', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const reporter = new ScheduledFilesReporter();
  reporter.onTestRunStart([first, later]);
  process.exitCode = 0;
  reporter.onTestRunEnd([{ id: first.taskId }]);
  expect(process.exitCode).toBe(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining(later.taskId));
});

it('accepts every planned identity, including the same path in separate projects', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const reporter = new ScheduledFilesReporter();
  reporter.onTestRunStart([first, later]);
  process.exitCode = 0;
  reporter.onTestRunEnd([{ id: first.taskId }, { id: later.taskId }]);
  expect(process.exitCode).toBe(0);
  expect(log).not.toHaveBeenCalled();
});

it('resets the plan between watch runs and preserves an existing failure code', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const reporter = new ScheduledFilesReporter();
  reporter.onTestRunStart([first, later]);
  reporter.onTestRunStart([first]);
  process.exitCode = 7;
  reporter.onTestRunEnd([{ id: first.taskId }]);
  expect(process.exitCode).toBe(7);
  reporter.onTestRunEnd([]);
  expect(process.exitCode).toBe(7);
});

it('leaves empty plans alone and runs after any exit-code-clearing reporter', () => {
  const reporter = new ScheduledFilesReporter();
  process.exitCode = 0;
  reporter.onTestRunStart([]);
  reporter.onTestRunEnd([]);
  expect(process.exitCode).toBe(0);
  const reporters = (config as { test: { reporters: string[] } }).test.reporters;
  expect(reporters.at(-1)).toBe('./packages/slice/tools/test-load/scheduled-files.ts');
});
