/** Archive a completed offline response; never invokes a model or installs weights. */
import { resolve } from 'node:path';
import { z } from 'zod';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { recordModelEvidence } from '../src/legacy-cube-calibration/model-evidence';
import { recordDeckReviewEvidence } from '../src/legacy-cube-calibration/deck-review-evidence';
import { recordAdviceReviewEvidence } from '../src/legacy-cube-calibration/advice-review';
import { recordTransferReviewEvidence } from '../src/legacy-cube-calibration/transfer-review';

async function main(args: readonly string[]) {
  const flags = ['--task', '--response', '--provenance', '--out'];
  const paths = parseCalibrationPaths(args, [...flags, '--corpus'], flags);
  const [task, response, provenance] = await Promise.all(
    ['--task', '--response', '--provenance'].map((flag) => readCalibrationJson(paths[flag]!)),
  );
  const { version } = z
    .object({
      version: z.enum([
        'legacy-cube-model-task/v1',
        'legacy-cube-deck-review-task/v1',
        'legacy-cube-advice-review-task/v1',
        'legacy-cube-transfer-review-task/v1',
      ]),
    })
    .parse(task);
  const transfer = version === 'legacy-cube-transfer-review-task/v1';
  if (transfer && !paths['--corpus']) throw new Error('Transfer import requires --corpus');
  if (!transfer && paths['--corpus']) throw new Error('--corpus applies only to transfer reviews');
  const corpus = transfer ? await readCalibrationJson(paths['--corpus']!) : null;
  const record = {
    'legacy-cube-model-task/v1': recordModelEvidence,
    'legacy-cube-deck-review-task/v1': recordDeckReviewEvidence,
    'legacy-cube-advice-review-task/v1': recordAdviceReviewEvidence,
    'legacy-cube-transfer-review-task/v1': (
      catalog: Parameters<typeof recordTransferReviewEvidence>[0],
      subject: unknown,
      judgment: unknown,
      metadata: unknown,
    ) => recordTransferReviewEvidence(catalog, corpus, subject, judgment, metadata),
  }[version];
  const receipt = record(parsePrintedCardCatalog(catalogJson), task, response, provenance);
  await writeCalibrationJson(resolve(paths['--out']!), receipt);
  process.stdout.write(
    `${JSON.stringify({
      sha256: receipt.sha256,
      origin: receipt.origin,
      adoptionEligible: receipt.adoptionEligible,
      limitations: receipt.limitations,
    })}\n`,
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Model import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
