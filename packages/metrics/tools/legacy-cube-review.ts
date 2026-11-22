/** Compare only frozen arms; reserve the held-out sources before looking at their results. */
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint } from '../src/legacy-cube-calibration/io';
import { runHeldOutPickReview } from '../src/legacy-cube-calibration/review-run';

async function main(args: readonly string[]): Promise<void> {
  const flags = ['--proposal', '--holdout', '--ledger'];
  const paths = parseCalibrationPaths(args, flags, flags);
  const [proposal, holdout, source] = await Promise.all([
    readCalibrationJson(paths['--proposal']!),
    readCalibrationJson(paths['--holdout']!),
    calibrationSourceFingerprint(),
  ]);
  const result = await runHeldOutPickReview(
    proposal,
    holdout,
    parsePrintedCardCatalog(catalogJson),
    { source, node: process.version },
    paths['--ledger']!,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Held-out review failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
