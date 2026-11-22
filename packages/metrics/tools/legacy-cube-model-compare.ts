/** Offline diagnostic comparison. No candidate search, model calls, or weight adoption. */
import { resolve } from 'node:path';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { compareModelEvidence } from '../src/legacy-cube-calibration/model-comparison';

async function main(args: readonly string[]) {
  const flags = ['--receipts', '--split', '--baseline', '--candidate', '--out'];
  const paths = parseCalibrationPaths(args, flags, flags);
  const [receipts, baseline, candidate] = await Promise.all(
    ['--receipts', '--baseline', '--candidate'].map((flag) => readCalibrationJson(paths[flag]!)),
  );
  const comparison = compareModelEvidence(
    parsePrintedCardCatalog(catalogJson),
    receipts,
    paths['--split'],
    baseline,
    candidate,
  );
  await writeCalibrationJson(resolve(paths['--out']!), {
    runtimeSha256: await calibrationSourceFingerprint(),
    node: process.version,
    comparison,
  });
  process.stdout.write(
    `${JSON.stringify({
      adoptionEligible: comparison.adoptionEligible,
      baselineAgreement: comparison.baseline.agreement,
      candidateAgreement: comparison.candidate.agreement,
      strategicTruth: comparison.strategicTruth,
    })}\n`,
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `Model comparison failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
