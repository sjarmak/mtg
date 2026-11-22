/** Once-only IO shared by offline quality and adjacent-source reviews. */
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCalibrationJson } from './artifact-io';
import { writeCalibrationJson } from './io';

export interface QualityReviewer {
  readonly model: string;
  review(input: { readonly prompt: string; readonly schema: unknown; readonly taskSha256: string }): Promise<{
    readonly response: unknown;
    readonly provenance: unknown;
  }>;
}
export interface ReviewSubject {
  readonly task: { readonly sha256: string };
  readonly prompt: string;
  readonly schema: unknown;
}
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

async function prepareDirectory(root: string, configuration: unknown) {
  try {
    await mkdir(root);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (!isDeepStrictEqual(await readCalibrationJson(join(root, 'configuration.json')), configuration))
      throw new Error('Review configuration differs from first attempt');
    return;
  }
  await mkdir(join(root, 'attempts'));
  await mkdir(join(root, 'receipts'));
  await writeCalibrationJson(join(root, 'configuration.json'), configuration);
}

async function completed<T extends ReviewSubject>(
  root: string,
  subject: T,
  receiptFor: (subject: T, input: unknown) => unknown,
) {
  let receipt: unknown;
  try {
    receipt = await readCalibrationJson(join(root, 'receipts', `${subject.task.sha256}.json`));
  } catch (error) {
    if (!missing(error)) throw error;
    return false;
  }
  const raw = await readCalibrationJson(join(root, 'attempts', subject.task.sha256, 'response.json'));
  if (!isDeepStrictEqual(receipt, receiptFor(subject, raw)))
    throw new Error('Modified review receipt differs from archived response');
  return true;
}

async function reviewOne<T extends ReviewSubject>(
  root: string,
  subject: T,
  reviewer: QualityReviewer,
  receiptFor: (subject: T, input: unknown) => unknown,
) {
  const attempt = join(root, 'attempts', subject.task.sha256);
  try {
    await mkdir(attempt);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    throw new Error(`Review attempt ${subject.task.sha256} is incomplete; refusing a replacement sample`);
  }
  await writeCalibrationJson(join(attempt, 'started.json'), {
    task: subject.task.sha256,
    model: reviewer.model,
  });
  try {
    const result = structuredClone(
      await reviewer.review({
        prompt: subject.prompt,
        schema: subject.schema,
        taskSha256: subject.task.sha256,
      }),
    );
    await writeCalibrationJson(join(attempt, 'response.json'), result);
    await writeCalibrationJson(
      join(root, 'receipts', `${subject.task.sha256}.json`),
      receiptFor(subject, result),
    );
  } catch (error) {
    await writeCalibrationJson(join(attempt, 'failure.json'), {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Callers supply canonical tasks and domain validation before any external call. */
export async function runReviewBatch<T extends ReviewSubject>(input: {
  readonly root: string;
  readonly configuration: unknown;
  readonly tasks: readonly T[];
  readonly maxCalls: number;
  readonly reviewer: QualityReviewer;
  readonly receiptFor: (subject: T, input: unknown) => unknown;
}) {
  const { root, tasks, receiptFor, reviewer, maxCalls } = input;
  await prepareDirectory(root, input.configuration);
  let pending: readonly T[] = [];
  for (const subject of tasks) {
    if (!(await completed(root, subject, receiptFor))) pending = [...pending, subject];
  }
  if (pending.length > maxCalls)
    throw new Error(`Review call budget ${maxCalls} is below ${pending.length} pending tasks`);
  // Preflight every old claim before spending calls on any unstarted task.
  for (const subject of pending) {
    let claimed = true;
    try {
      await lstat(join(root, 'attempts', subject.task.sha256));
    } catch (error) {
      if (!missing(error)) throw error;
      claimed = false;
    }
    if (claimed)
      throw new Error(`Review attempt ${subject.task.sha256} is incomplete; refusing a replacement sample`);
  }
  for (const subject of pending) await reviewOne(root, subject, reviewer, receiptFor);
  return { receipts: join(root, 'receipts'), modelCalls: pending.length };
}
