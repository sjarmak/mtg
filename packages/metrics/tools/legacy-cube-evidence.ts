/** Read-only source admission audit. Exit zero means the audit ran, not that evidence passed. */
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { z } from 'zod';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import defaultCorpus from '../data/legacy-cube-human-evidence-v1.json';
import { admitHumanEvidence } from '../src/legacy-cube-calibration/human-evidence';
import { auditMixedEvidence } from '../src/legacy-cube-calibration/mixed-evidence';
import {
  buildTransferReviewTasks,
  TransferJudgmentSchema,
} from '../src/legacy-cube-calibration/transfer-review';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';

function options(args: readonly string[]) {
  const usage =
    'Usage: npx tsx packages/metrics/tools/legacy-cube-evidence.ts [--corpus path] [--report strict-human|mixed|transfer-tasks]';
  try {
    const paths = parseCalibrationPaths(args, ['--corpus', '--report']);
    const report = paths['--report'] ?? 'strict-human';
    if (!['strict-human', 'mixed', 'transfer-tasks'].includes(report)) throw new Error('Unknown report');
    return { path: paths['--corpus'], report };
  } catch (cause) {
    throw new Error(usage, { cause });
  }
}

async function main(args: readonly string[]): Promise<void> {
  const selected = options(args);
  const input: unknown =
    selected.path === undefined ? defaultCorpus : await readCalibrationJson(selected.path);
  const catalog = parsePrintedCardCatalog(catalogJson);
  const reports = {
    'strict-human': () => admitHumanEvidence(input, catalog),
    mixed: () => auditMixedEvidence(input, catalog),
    'transfer-tasks': () => ({
      tasks: buildTransferReviewTasks(input, catalog),
      responseSchema: z.toJSONSchema(TransferJudgmentSchema),
      adoptionEligible: false,
    }),
  };
  const report = reports[selected.report as keyof typeof reports]();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Evidence audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
