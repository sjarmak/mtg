/** Offline tuning search with optional exclusive sealing; never an adoption authorization. */
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import defaultCorpus from '../data/legacy-cube-human-evidence-v1.json';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { sealTuningProposal } from '../src/legacy-cube-calibration/holdout';
import { selectTuningCandidate } from '../src/legacy-cube-calibration/tuning';

async function main(args: readonly string[]): Promise<void> {
  const paths = parseCalibrationPaths(args, ['--corpus', '--seal-out']);
  const input: unknown = paths['--corpus'] ? await readCalibrationJson(paths['--corpus']) : defaultCorpus;
  const source = await calibrationSourceFingerprint();
  const result = selectTuningCandidate(input, parsePrintedCardCatalog(catalogJson));
  const report = { ...result, provenance: { ...result.provenance, source, node: process.version } };
  if (paths['--seal-out'])
    await writeCalibrationJson(
      paths['--seal-out'],
      sealTuningProposal(result, { source, node: process.version }),
    );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Tuning proposal failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
