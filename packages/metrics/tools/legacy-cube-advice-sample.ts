/** Offline explanation-review export; no model calls or weight installation. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import {
  AdviceReviewJudgmentSchema,
  buildAdviceReviewTask,
} from '../src/legacy-cube-calibration/advice-review';

async function main(args: readonly string[]) {
  const flags = ['--task', '--weights', '--out'];
  const paths = parseCalibrationPaths(args, flags, flags);
  const [source, weights] = await Promise.all([
    readCalibrationJson(paths['--task']!),
    readCalibrationJson(paths['--weights']!),
  ]);
  const task = buildAdviceReviewTask(parsePrintedCardCatalog(catalogJson), source, weights);
  const out = resolve(paths['--out']!);
  await mkdir(out);
  await writeCalibrationJson(join(out, 'manifest.json'), {
    version: 'legacy-cube-advice-sample/v1',
    sourceTask: task.source.sha256,
    task: task.sha256,
    coordinates: task.source.coordinates,
    weights: task.weights,
    catalogSha256: task.payload.context.catalogSha256,
    runtimeSha256: await calibrationSourceFingerprint(),
  });
  await writeCalibrationJson(join(out, 'task.json'), task);
  await writeCalibrationJson(join(out, 'response-schema.json'), z.toJSONSchema(AdviceReviewJudgmentSchema));
  await writeFile(
    join(out, 'prompt.txt'),
    `${task.instructions}\nTask SHA-256: ${task.sha256}\n${JSON.stringify(task.payload)}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify({ out, task: task.sha256, modelCalls: 0 })}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Advice sampling failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
