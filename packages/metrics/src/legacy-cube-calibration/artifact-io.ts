/** Local operator inputs: bounded regular files, never streams or network requests. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const CALIBRATION_INPUT_LIMIT = 32 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;

export async function readCalibrationText(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Calibration input must be a regular file');
    if (stat.size > CALIBRATION_INPUT_LIMIT) throw new Error('Calibration input exceeds 32 MiB');
    // Read until EOF or one byte past the limit, but never allocate the limit up front: a zero-filled
    // 32 MiB buffer per call made every artifact read cost more than parsing the artifact.
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= CALIBRATION_INPUT_LIMIT) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK, CALIBRATION_INPUT_LIMIT + 1 - length));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > CALIBRATION_INPUT_LIMIT) throw new Error('Calibration input exceeds 32 MiB');
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    await file.close();
  }
}

export async function readCalibrationJson(path: string): Promise<unknown> {
  return JSON.parse(await readCalibrationText(path)) as unknown;
}

export function parseCalibrationPaths(
  args: readonly string[],
  allowed: readonly string[],
  required: readonly string[] = [],
) {
  let paths: Readonly<Record<string, string>> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!;
    const value = args[i + 1];
    if (
      !allowed.includes(flag) ||
      Object.hasOwn(paths, flag) ||
      !value ||
      value.startsWith('--') ||
      value.length > 4096 ||
      value.includes('\0')
    )
      throw new Error(`Invalid calibration options; allowed: ${allowed.join(', ')}`);
    paths = { ...paths, [flag]: value };
  }
  if (required.some((flag) => !paths[flag]))
    throw new Error(`Required calibration options: ${required.join(', ')}`);
  return paths;
}
