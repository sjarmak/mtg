/** Reserved offline reviews and provisional local adoption; model calls require an explicit run command. */
import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { parseCalibrationPaths, readCalibrationJson } from '../src/legacy-cube-calibration/artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from '../src/legacy-cube-calibration/io';
import { buildQualityCampaign, readQualityCampaign } from '../src/legacy-cube-calibration/quality-ledger';
import { exportQualityBundle, collectQualityBundle } from '../src/legacy-cube-calibration/quality-bundle';
import { adoptQualityCalibration } from '../src/legacy-cube-calibration/adopt';
import { exportAdvisorCalibration } from '../src/legacy-cube-calibration/export-active';
import { createCodexQualityReviewer } from '../src/legacy-cube-calibration/codex-review';
import { runQualityReviews } from '../src/legacy-cube-calibration/quality-run';
import { runTransferReviews } from '../src/legacy-cube-calibration/transfer-run';
import { buildMixedProposalCampaign } from '../src/legacy-cube-calibration/mixed-proposal';
import { readWeightStore } from '../src/legacy-cube-calibration/weight-store';
import { advisorModelFingerprint } from '../src/legacy-cube-calibration/tuning';

export async function main(args: readonly string[]) {
  const [command, ...options] = args;
  const catalog = parsePrintedCardCatalog(catalogJson);
  const runtime = await calibrationSourceFingerprint();
  if (command === 'propose') {
    const required = ['--corpus', '--store', '--root', '--indices', '--out'];
    const paths = parseCalibrationPaths(options, [...required, '--model-receipts'], required);
    const active = await readWeightStore(paths['--store']!, {
      catalogSha256: catalog.contentSha256,
      modelSha256: advisorModelFingerprint(),
    });
    if (active.transitionPending) throw new Error('Weight transition pending; cannot freeze a proposal');
    const indices = paths['--indices']!.split(',').map((value) => {
      if (!/^\d+$/.test(value)) throw new Error('Indices must be comma-separated nonnegative integers');
      return Number(value);
    });
    const result = buildMixedProposalCampaign(
      catalog,
      await readCalibrationJson(paths['--corpus']!),
      paths['--model-receipts'] ? await readCalibrationJson(paths['--model-receipts']) : [],
      {
        root: paths['--root'],
        indices,
        runtimeSha256: runtime,
        baseline: active.weights,
        step: 0.25,
      },
    );
    const out = resolve(paths['--out']!);
    await mkdir(out);
    await writeCalibrationJson(join(out, 'proposal.json'), result);
    await writeCalibrationJson(join(out, 'request.json'), result.campaign.request);
    process.stdout.write(
      `${JSON.stringify({ out, status: result.status, request: join(out, 'request.json'), modelCalls: 0 })}\n`,
    );
    return;
  }
  if (command === 'transfer-run') {
    const flags = ['--corpus', '--split', '--ledger', '--archive', '--codex-bin', '--model', '--max-calls'];
    const paths = parseCalibrationPaths(options, flags, flags);
    const maxCalls = z.number().int().min(0).max(500000).parse(Number(paths['--max-calls']));
    const split = z.enum(['tuning', 'holdout']).parse(paths['--split']);
    const corpus = await readCalibrationJson(paths['--corpus']!);
    const reviewer = createCodexQualityReviewer({
      binary: paths['--codex-bin']!,
      model: paths['--model']!,
      archive: paths['--archive']!,
      runtimeSha256: runtime,
    });
    const result = await runTransferReviews(
      { ledger: paths['--ledger']!, split, maxCalls },
      corpus,
      catalog,
      runtime,
      reviewer,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'run') {
    const flags = ['--bundle', '--ledger', '--archive', '--codex-bin', '--model', '--max-calls'];
    const paths = parseCalibrationPaths(options, flags, flags);
    const maxCalls = z.number().int().min(0).max(500000).parse(Number(paths['--max-calls']));
    const reviewer = createCodexQualityReviewer({
      binary: paths['--codex-bin']!,
      model: paths['--model']!,
      archive: paths['--archive']!,
      runtimeSha256: runtime,
    });
    const result = await runQualityReviews(
      { bundle: paths['--bundle']!, ledger: paths['--ledger']!, maxCalls },
      catalog,
      runtime,
      reviewer,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'snapshot') {
    const flags = ['--store', '--decision', '--out'];
    const paths = parseCalibrationPaths(options, flags, flags);
    const result = await exportAdvisorCalibration(
      { store: paths['--store']!, decision: paths['--decision']!, out: paths['--out']! },
      catalog,
    );
    process.stdout.write(
      `${JSON.stringify({ out: paths['--out'], revision: result.weights.revision, sha256: result.sha256, modelCalls: 0 })}\n`,
    );
    return;
  }
  if (command === 'adopt') {
    const flags = [
      '--bundle',
      '--ledger',
      '--receipts',
      '--transfer-corpus',
      '--transfer-receipts',
      '--store',
      '--out',
    ];
    const paths = parseCalibrationPaths(options, flags, flags);
    const result = await adoptQualityCalibration(
      {
        bundle: paths['--bundle']!,
        ledger: paths['--ledger']!,
        receipts: paths['--receipts']!,
        transferCorpus: paths['--transfer-corpus']!,
        transferReceipts: paths['--transfer-receipts']!,
        store: paths['--store']!,
        out: paths['--out']!,
      },
      catalog,
    );
    process.stdout.write(
      `${JSON.stringify({
        out: paths['--out'],
        status: result.decision.status,
        decision: result.decision.sha256,
        activeHead: result.activeHead,
        reasons: result.decision.reasons,
        modelCalls: 0,
      })}\n`,
    );
    return;
  }
  if (command === 'export') {
    const flags = ['--request', '--ledger', '--out'];
    const paths = parseCalibrationPaths(options, flags, flags);
    const campaign = buildQualityCampaign(catalog, await readCalibrationJson(paths['--request']!));
    readQualityCampaign(catalog, campaign, runtime);
    const result = await exportQualityBundle(paths['--out']!, paths['--ledger']!, catalog, campaign.request);
    process.stdout.write(
      `${JSON.stringify({
        out: result.out,
        campaign: result.campaign.sha256,
        tasks: result.manifest.tasks.length,
        modelCalls: 0,
      })}\n`,
    );
    return;
  }
  if (command === 'collect') {
    const flags = ['--bundle', '--ledger', '--receipts', '--out'];
    const paths = parseCalibrationPaths(options, flags, flags);
    const result = await collectQualityBundle(
      {
        bundle: paths['--bundle']!,
        ledger: paths['--ledger']!,
        receipts: paths['--receipts']!,
        out: paths['--out']!,
      },
      catalog,
      runtime,
    );
    process.stdout.write(
      `${JSON.stringify({
        out: result.out,
        report: result.report.sha256,
        reservationVerified: result.report.reservationVerified,
        adoptionEligible: result.report.summary.adoptionEligible,
        quality: result.report.quality.status,
        modelCalls: 0,
      })}\n`,
    );
    return;
  }
  throw new Error('Quality command must be propose, export, run, transfer-run, collect, adopt, or snapshot');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `Quality workflow failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
