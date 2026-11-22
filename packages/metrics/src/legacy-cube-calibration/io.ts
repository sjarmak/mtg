/** Filesystem boundary. Each run owns a fresh directory; existing results are never overwritten. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import {
  executeLegacyCubeCampaign,
  parseLegacyCubeCalibrationArgs,
  planLegacyCubeCampaign,
} from './campaign';
import type { CalibrationGameplay, LegacyCubeCampaignPlan } from './campaign';

type Args = ReturnType<typeof parseLegacyCubeCalibrationArgs>;
export type GameplayFactory = (
  options: Args,
  plan: LegacyCubeCampaignPlan,
) => Promise<
  CalibrationGameplay & {
    readonly dispose: () => Promise<void>;
  }
>;

export async function calibrationSourceManifest() {
  const packages = fileURLToPath(new URL('../../..', import.meta.url));
  const directories = [
    'metrics/src/legacy-cube-calibration',
    'draft-export/src/advisor',
    'limited/src',
    'printed-card/src',
  ];
  const files = [
    ...(
      await Promise.all(
        directories.map(async (dir) =>
          (await readdir(join(packages, dir)))
            .filter((name) => name.endsWith('.ts'))
            .map((name) => `${dir}/${name}`),
        ),
      )
    ).flat(),
    'draft-export/src/physical-cube-draft.ts',
    'draft-export/src/rng.ts',
    'metrics/src/stats.ts',
    '../package-lock.json',
    'metrics/tools/legacy-cube-propose.ts',
    'metrics/tools/legacy-cube-review.ts',
    'metrics/tools/legacy-cube-evidence.ts',
    'metrics/tools/legacy-cube-model-sample.ts',
    'metrics/tools/legacy-cube-deck-sample.ts',
    'metrics/tools/legacy-cube-advice-sample.ts',
    'metrics/tools/legacy-cube-quality.ts',
    'metrics/tools/legacy-cube-model-import.ts',
    'metrics/tools/legacy-cube-model-compare.ts',
    'metrics/tools/legacy-cube-calibration.ts',
    'forge-export/src/bot-benchmark.ts',
    'forge-export/src/bot-benchmark-protocol.ts',
    'forge-export/src/bot-fingerprint.ts',
    'forge-export/src/bot-probe-coverage.ts',
    'forge-export/bridge/ForgeBotBenchmark.java',
    'forge-export/bridge/LegacyCubeBotProbes.java',
    'forge-export/bridge/legacy-cube-bot-probes.json',
  ];
  return Promise.all(
    files.sort().map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(join(packages, path)))
        .digest('hex'),
    })),
  );
}

export async function calibrationSourceFingerprint() {
  return createHash('sha256')
    .update(JSON.stringify(await calibrationSourceManifest()))
    .digest('hex');
}

export async function writeCalibrationJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

export async function runLegacyCubeCalibrationCli(args: readonly string[], createGameplay: GameplayFactory) {
  const parsed = parseLegacyCubeCalibrationArgs(args);
  const out = resolve(parsed.out);
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out); // EEXIST is intentional, including an existing empty directory.
  const catalogPath = fileURLToPath(
    new URL('../../../data/data/legacy-cube-2021-card-catalog-v1.json', import.meta.url),
  );
  const catalog = parsePrintedCardCatalog(JSON.parse(await readFile(catalogPath, 'utf8')) as unknown);
  const planned = planLegacyCubeCampaign(catalog, parsed);
  const plan = {
    ...planned,
    provenance: {
      ...planned.provenance,
      source: await calibrationSourceFingerprint(),
      node: process.version,
    },
  };
  await writeCalibrationJson(join(out, 'plan.json'), plan);
  process.stdout.write(
    `Legacy Cube: ${String(plan.pods.length)} pods, ${String(plan.games.length)} scheduled games. ${out}\n`,
  );
  if (parsed.planOnly) return;
  const gameplay = await createGameplay({ ...parsed, out }, plan);
  try {
    const report = await executeLegacyCubeCampaign(plan, gameplay);
    await writeCalibrationJson(join(out, 'report.json'), report);
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  } finally {
    await gameplay.dispose();
  }
}
