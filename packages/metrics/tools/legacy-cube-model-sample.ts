/** Deterministic scenario export only. This command does not call a model. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { calibrationSeed, draftCalibrationPool } from '../src/legacy-cube-calibration/draft';
import type { DraftPolicy } from '../src/legacy-cube-calibration/draft';
import { parseCalibrationPaths } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { ModelJudgmentSchema, sampleDraftReviewTasks } from '../src/legacy-cube-calibration/model-review';

async function main(args: readonly string[]) {
  const flags = ['--seed', '--split', '--policy', '--out'];
  const options = parseCalibrationPaths(args, flags, flags);
  const split = z.enum(['tuning', 'holdout']).parse(options['--split']);
  const catalog = parsePrintedCardCatalog(catalogJson);
  const seed = calibrationSeed(options['--seed']!, split, 'draft', 0);
  // draftCalibrationPool validates the policy before generating any observations.
  const draft = draftCalibrationPool(catalog, seed, options['--policy']! as DraftPolicy);
  const tasks = sampleDraftReviewTasks(catalog, draft.trace, { session: seed, split });
  const out = resolve(options['--out']!);
  await mkdir(out); // Refuse even an empty existing directory; never overwrite evidence.
  await writeCalibrationJson(join(out, 'manifest.json'), {
    version: 'legacy-cube-model-sample/v1',
    origin: 'simulation',
    split,
    seed,
    policy: draft.policy,
    catalogSha256: catalog.contentSha256,
    runtimeSha256: await calibrationSourceFingerprint(),
    tasks: tasks.map((task) => task.sha256),
  });
  await writeCalibrationJson(join(out, 'response-schema.json'), z.toJSONSchema(ModelJudgmentSchema));
  for (const [index, task] of tasks.entries()) {
    await writeCalibrationJson(join(out, `task-${String(index)}.json`), task);
    const prompt = `${task.instructions}\nTask SHA-256: ${task.sha256}\n${JSON.stringify(task.payload)}\n`;
    await writeFile(join(out, `prompt-${String(index)}.txt`), prompt, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify({ out, tasks: tasks.length, modelCalls: 0 })}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Model sampling failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
