import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import {
  buildQualityCampaign,
  readQualityCampaign,
  reserveQualityCampaign,
} from '../src/legacy-cube-calibration/quality-ledger';

const catalog = parsePrintedCardCatalog(catalogJson);
const request = {
  root: 'quality-ledger-fixture',
  split: 'holdout',
  indices: [0, 1],
  policies: ['current', 'pin:reanimator'],
  baseline: DEFAULT_ADVISOR_WEIGHTS,
  candidate: { ...DEFAULT_ADVISOR_WEIGHTS, synergy: 1.25 },
  runtimeSha256: 'a'.repeat(64),
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'mtg-quality-ledger-'));
  directories.push(path);
  return path;
}

it('freezes both weight arms and the full seed/policy matrix without generating review subjects', () => {
  const campaign = buildQualityCampaign(catalog, request);
  expect(campaign.sessions).toHaveLength(2);
  expect(campaign.units).toHaveLength(4);
  expect(campaign.protocol.independentUnit).toBe('draft-seed');
  expect(campaign.protocol.advicePicks).toEqual([0, 7, 15, 29, 37, 44]);
  expect(campaign.units.every((unit) => campaign.sessions.includes(unit.session))).toBe(true);
  expect(readQualityCampaign(catalog, campaign, request.runtimeSha256)).toEqual(campaign);
  expect(JSON.stringify(campaign)).not.toContain('opponentPools');
  expect(() => readQualityCampaign(catalog, { ...campaign, units: [] }, request.runtimeSha256)).toThrow();
  expect(() => readQualityCampaign(catalog, campaign, 'b'.repeat(64))).toThrow(/runtime/i);
});

it('rejects ambiguous matrices, invalid strategies, and extra fields before writing', async () => {
  const path = await directory();
  for (const bad of [
    { ...request, indices: [0, 0] },
    { ...request, indices: [] },
    { ...request, policies: ['current', 'current'] },
    { ...request, policies: ['pin:nonexistent'] },
    { ...request, policies: [] },
    { ...request, hidden: [] },
  ])
    await expect(reserveQualityCampaign(path, catalog, bad)).rejects.toThrow();
  await expect(reserveQualityCampaign(path, catalog, request)).resolves.toHaveProperty('path');
});

it('reserves seeds durably across changed weights, policy names and campaign grouping', async () => {
  const path = await directory();
  const reservation = await reserveQualityCampaign(path, catalog, request);
  expect(JSON.parse(await readFile(reservation.path, 'utf8'))).toEqual(reservation.campaign);
  for (const next of [
    request,
    { ...request, policies: ['flexible'], candidate: request.baseline },
    { ...request, indices: [1, 2] },
  ])
    await expect(reserveQualityCampaign(path, catalog, next)).rejects.toThrow(/used/i);
  await expect(reserveQualityCampaign(path, catalog, { ...request, indices: [2] })).resolves.toHaveProperty(
    'path',
  );
});

it('snapshots mutable caller inputs before the first asynchronous operation', async () => {
  const path = await directory();
  const mutable = structuredClone(request);
  const pending = reserveQualityCampaign(path, catalog, mutable);
  mutable.indices[0] = 99;
  mutable.candidate.synergy = 0.75;
  const { campaign } = await pending;
  expect(campaign.request.indices).toEqual([0, 1]);
  expect(campaign.request.candidate.synergy).toBe(1.25);
});

it('allows only one concurrent reservation and preserves interrupted locks', async () => {
  const path = await directory();
  const results = await Promise.allSettled([
    reserveQualityCampaign(path, catalog, request),
    reserveQualityCampaign(path, catalog, request),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  await expect(reserveQualityCampaign(path, catalog, request)).rejects.toThrow(/used/i);
  const locked = await directory();
  await mkdir(join(locked, '.quality-lock'));
  await expect(reserveQualityCampaign(locked, catalog, request)).rejects.toMatchObject({ code: 'EEXIST' });
});

it('refuses corrupt journals rather than silently forgetting consumed sessions', async () => {
  const path = await directory();
  await writeFile(join(path, `quality-${'e'.repeat(64)}.json`), '{');
  await expect(reserveQualityCampaign(path, catalog, request)).rejects.toThrow();
  const changed = await directory();
  const { campaign } = await reserveQualityCampaign(changed, catalog, request);
  await writeFile(join(changed, `quality-${'e'.repeat(64)}.json`), JSON.stringify(campaign));
  await expect(reserveQualityCampaign(changed, catalog, { ...request, indices: [2] })).rejects.toThrow(
    /digest/i,
  );
});
