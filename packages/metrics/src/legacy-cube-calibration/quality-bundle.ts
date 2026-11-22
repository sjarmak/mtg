/** Local, reserved quality-review artifacts. Models receive only each hash-addressed prompt. */
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readQualityCampaign, reserveQualityCampaign } from './quality-ledger';
import type { buildQualityCampaign } from './quality-ledger';
import { buildQualityReviewPair, readQualityReviewPair } from './quality-pair';
import { compareQualityReviewPair } from './quality-comparison';
import { summarizeQualityCampaign } from './quality-summary';
import { assessQualitySummary } from './quality-gate';
import { qualityJudgmentSchema } from './quality-response-schema';
import { qualityReviewPrompt } from './quality-prompt';
import { readCalibrationJson, readCalibrationText } from './artifact-io';
import { writeCalibrationJson } from './io';

type Campaign = ReturnType<typeof buildQualityCampaign>;
type Pair = ReturnType<typeof buildQualityReviewPair>;
type Task = Pair['baseline']['deck'] | Pair['baseline']['advice'][number];
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const tasksOf = (pair: Pair): readonly Task[] => [
  pair.baseline.deck,
  ...pair.baseline.advice,
  pair.candidate.deck,
  ...pair.candidate.advice,
];
const pairName = (index: number) => `pair-${String(index).padStart(5, '0')}.json`;
const promptOf = qualityReviewPrompt;
const schemaOf = (task: Task) => z.toJSONSchema(qualityJudgmentSchema(task));

function manifestOf(campaign: Campaign, pairs: readonly string[], tasks: readonly string[]) {
  return { version: 'legacy-cube-quality-bundle/v1', campaign: campaign.sha256, pairs, tasks };
}

async function writeTask(root: string, task: Task) {
  const path = join(root, 'tasks', task.sha256);
  await mkdir(path);
  await writeCalibrationJson(join(path, 'task.json'), task);
  await writeCalibrationJson(join(path, 'response-schema.json'), schemaOf(task));
  await writeFile(join(path, 'prompt.txt'), promptOf(task), { flag: 'wx' });
}

async function assertTaskArtifacts(root: string, tasks: readonly Task[]) {
  const expected = [...new Set(tasks.map((task) => task.sha256))].sort();
  if (!isDeepStrictEqual((await readdir(join(root, 'tasks'))).sort(), expected))
    throw new Error('Quality task artifact directories differ from manifest');
  for (const id of expected) {
    const task = tasks.find((candidate) => candidate.sha256 === id)!;
    const path = join(root, 'tasks', id);
    if (!isDeepStrictEqual((await readdir(path)).sort(), ['prompt.txt', 'response-schema.json', 'task.json']))
      throw new Error('Quality task artifact files are missing or unexpected');
    if (
      !isDeepStrictEqual(await readCalibrationJson(join(path, 'task.json')), task) ||
      !isDeepStrictEqual(await readCalibrationJson(join(path, 'response-schema.json')), schemaOf(task)) ||
      (await readCalibrationText(join(path, 'prompt.txt'))) !== promptOf(task)
    )
      throw new Error('Quality task artifact differs from canonical export');
  }
}

/** Reservations remain consumed if any later export step fails; manifest is the completion marker. */
export async function exportQualityBundle(
  directory: string,
  ledger: string,
  catalog: PrintedCardCatalog,
  input: unknown,
) {
  const { campaign } = await reserveQualityCampaign(ledger, catalog, input);
  const root = resolve(directory);
  await mkdir(root);
  await mkdir(join(root, 'tasks'));
  await writeCalibrationJson(join(root, 'campaign.json'), campaign);
  const { indices: _indices, policies: _policies, ...common } = campaign.request;
  let pairs: readonly string[] = [];
  let tasks: readonly string[] = [];
  for (const [position, unit] of campaign.units.entries()) {
    const pair = buildQualityReviewPair(catalog, { ...common, index: unit.index, policy: unit.policy });
    await writeCalibrationJson(join(root, pairName(position)), pair);
    for (const task of tasksOf(pair)) {
      if (tasks.includes(task.sha256)) continue;
      await writeTask(root, task);
      tasks = [...tasks, task.sha256];
    }
    pairs = [...pairs, pair.sha256];
  }
  const manifest = manifestOf(campaign, pairs, tasks);
  await writeCalibrationJson(join(root, 'manifest.json'), manifest);
  return { campaign, manifest, out: root };
}

async function readBundle(root: string, ledger: string, catalog: PrintedCardCatalog, runtime: unknown) {
  const campaign = readQualityCampaign(
    catalog,
    await readCalibrationJson(join(root, 'campaign.json')),
    runtime,
  );
  const reservation = await readCalibrationJson(join(ledger, `quality-${campaign.sha256}.json`));
  if (!isDeepStrictEqual(reservation, campaign))
    throw new Error('Quality bundle reservation differs from campaign');
  let pairs: readonly Pair[] = [];
  // Bounded sequential reads avoid opening thousands of files or simulations at once.
  for (const index of campaign.units.keys()) {
    const pair = readQualityReviewPair(
      catalog,
      await readCalibrationJson(join(root, pairName(index))),
      runtime,
    );
    pairs = [...pairs, pair];
  }
  const tasks = [...new Set(pairs.flatMap((pair) => tasksOf(pair).map((task) => task.sha256)))];
  const expected = manifestOf(
    campaign,
    pairs.map((pair) => pair.sha256),
    tasks,
  );
  if (!isDeepStrictEqual(await readCalibrationJson(join(root, 'manifest.json')), expected))
    throw new Error('Quality bundle manifest is incomplete or modified');
  await assertTaskArtifacts(
    root,
    pairs.flatMap((pair) => tasksOf(pair)),
  );
  return { campaign, pairs };
}

/** Validate the complete reserved bundle before exposing any prompt to a reviewer. */
export async function readQualityReviewTasks(
  root: string,
  ledger: string,
  catalog: PrintedCardCatalog,
  runtime: unknown,
) {
  const { campaign, pairs } = await readBundle(root, ledger, catalog, runtime);
  const tasks = [...new Map(pairs.flatMap(tasksOf).map((task) => [task.sha256, task])).values()];
  return { campaign, tasks: tasks.map((task) => ({ task, prompt: promptOf(task), schema: schemaOf(task) })) };
}

async function readReceipts(root: string, arm: Pair['baseline']) {
  const deck = await readCalibrationJson(join(root, `${arm.deck.sha256}.json`));
  const advice = await Promise.all(
    arm.advice.map((task) => readCalibrationJson(join(root, `${task.sha256}.json`))),
  );
  return { deck, advice };
}

/** First valid collection wins, including when output publication later fails. */
async function freezeCollection(ledger: string, campaign: string, report: string) {
  const path = join(ledger, `collection-${campaign}.json`);
  const claim = { version: 'legacy-cube-quality-collection-claim/v1', campaign, report };
  try {
    await writeCalibrationJson(path, claim);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (!isDeepStrictEqual(await readCalibrationJson(path), claim))
      throw new Error('Quality campaign already collected with different reviews');
  }
}

/** Collection is reproducible, but never re-reserves or re-samples the held-out draft. */
export async function collectQualityBundle(
  paths: {
    readonly bundle: string;
    readonly ledger: string;
    readonly receipts: string;
    readonly out: string;
  },
  catalog: PrintedCardCatalog,
  runtime: unknown,
) {
  const locations = { ...paths };
  const { campaign, pairs } = await readBundle(locations.bundle, locations.ledger, catalog, runtime);
  let reviews: { pair: Pair; comparison: ReturnType<typeof compareQualityReviewPair> }[] = [];
  for (const pair of pairs) {
    const baseline = await readReceipts(locations.receipts, pair.baseline);
    const candidate = await readReceipts(locations.receipts, pair.candidate);
    const comparison = compareQualityReviewPair(catalog, pair, { baseline, candidate }, runtime);
    reviews = [...reviews, { pair, comparison }];
  }
  const summary = summarizeQualityCampaign(catalog, campaign, reviews, runtime);
  const body = {
    version: 'legacy-cube-quality-collection/v1',
    campaign: campaign.sha256,
    reservationVerified: true,
    summary,
    quality: assessQualitySummary(summary),
    comparisons: reviews.map((r) => r.comparison.sha256),
  };
  const report = { ...body, sha256: digest(body) };
  await freezeCollection(locations.ledger, campaign.sha256, report.sha256);
  const out = resolve(locations.out);
  await mkdir(out);
  for (const [index, review] of reviews.entries())
    await writeCalibrationJson(
      join(out, `comparison-${String(index).padStart(5, '0')}.json`),
      review.comparison,
    );
  await writeCalibrationJson(join(out, 'report.json'), report);
  return { report, out, campaign, reviews: reviews.map((review) => review.comparison) };
}
