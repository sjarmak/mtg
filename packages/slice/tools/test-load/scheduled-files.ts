import type { Reporter, TestModule, TestSpecification } from 'vitest/node';

type PlannedFile = Pick<TestSpecification, 'taskId' | 'moduleId'>;

/**
 * A rejected worker pool can prevent later scheduling groups from starting.
 * Collected-module accounting cannot see those files. Compare the original
 * plan against final identities, after any reporter that can clear exitCode.
 */
export default class ScheduledFilesReporter implements Reporter {
  private planned: readonly PlannedFile[] = [];

  onTestRunStart(specifications: readonly PlannedFile[]): void {
    this.planned = specifications.map(({ taskId, moduleId }) => ({ taskId, moduleId }));
  }

  onTestRunEnd(modules: readonly Pick<TestModule, 'id'>[]): void {
    const reported = new Set(modules.map((module) => module.id));
    const missing = this.planned.filter((file) => !reported.has(file.taskId));
    if (missing.length === 0) return;
    console.error(
      `Scheduled test files never reported (${missing.length}):\n` +
        missing.map((file) => `  ${file.moduleId} [${file.taskId}]`).join('\n'),
    );
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  }
}
