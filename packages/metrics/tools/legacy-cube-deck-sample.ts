/** Export a simulated finished deck for isolated offline review; no model calls. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_ADVISOR_WEIGHTS, parseAdvisorWeights } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { calibrationSeed, draftCalibrationPool } from '../src/legacy-cube-calibration/draft';
import type { DraftPolicy } from '../src/legacy-cube-calibration/draft';
import { buildCalibrationDeck } from '../src/legacy-cube-calibration/deck';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { buildDeckReviewTask, DeckReviewJudgmentSchema } from '../src/legacy-cube-calibration/deck-review';

async function main(args: readonly string[]) {
  const required = ['--seed', '--split', '--policy', '--out'];
  const options = parseCalibrationPaths(args, [...required, '--weights'], required);
  const split = z.enum(['tuning', 'holdout']).parse(options['--split']);
  const catalog = parsePrintedCardCatalog(catalogJson);
  const weights = options['--weights']
    ? parseAdvisorWeights(await readCalibrationJson(options['--weights']))
    : DEFAULT_ADVISOR_WEIGHTS;
  const seed = calibrationSeed(options['--seed']!, split, 'draft', 0);
  const draft = draftCalibrationPool(catalog, seed, options['--policy']! as DraftPolicy, weights);
  const deck = buildCalibrationDeck(draft.pool, 'Offline review deck');
  const basicCount = (name: string) => deck.ref.cards.find((card) => card.name === name)?.count ?? 0;
  const task = buildDeckReviewTask(
    catalog,
    {
      pool: draft.pool.map((card) => card.physicalId),
      selected: deck.selected.map((card) => card.physicalId),
      basics: {
        Plains: basicCount('Plains'),
        Island: basicCount('Island'),
        Swamp: basicCount('Swamp'),
        Mountain: basicCount('Mountain'),
        Forest: basicCount('Forest'),
      },
    },
    { session: seed, split },
  );
  const out = resolve(options['--out']!);
  await mkdir(out);
  await writeCalibrationJson(join(out, 'manifest.json'), {
    version: 'legacy-cube-deck-sample/v1',
    origin: 'simulation',
    split,
    seed,
    policy: draft.policy,
    weights,
    catalogSha256: catalog.contentSha256,
    runtimeSha256: await calibrationSourceFingerprint(),
    builderVersion: deck.builderVersion,
    taskSha256: task.sha256,
  });
  await writeCalibrationJson(join(out, 'task.json'), task);
  await writeCalibrationJson(join(out, 'response-schema.json'), z.toJSONSchema(DeckReviewJudgmentSchema));
  await writeFile(
    join(out, 'prompt.txt'),
    `${task.instructions}\nTask SHA-256: ${task.sha256}\n${JSON.stringify(task.payload)}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify({ out, taskSha256: task.sha256, modelCalls: 0 })}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Deck sampling failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
