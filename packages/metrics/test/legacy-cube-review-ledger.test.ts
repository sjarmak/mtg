import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveHoldoutReview } from '../src/legacy-cube-calibration/review-ledger';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'mtg-holdout-ledger-'));
  directories.push(path);
  return path;
}
const request = {
  proposal: 'a'.repeat(64),
  holdout: 'b'.repeat(64),
  sources: [{ url: 'https://example.org/draft', session: 'one' }],
};

it('persists a crash-visible reservation and refuses reuse after a changed corpus digest', async () => {
  const path = await directory();
  const reservation = await reserveHoldoutReview(path, request);
  expect(JSON.parse(await readFile(reservation.path, 'utf8'))).toMatchObject(request);
  await expect(reserveHoldoutReview(path, { ...request, holdout: 'c'.repeat(64) })).rejects.toThrow(/used/i);
});

it('prevents source and session reuse even after tracking or grouping changes', async () => {
  const path = await directory();
  await reserveHoldoutReview(path, request);
  for (const source of [
    { url: 'https://example.org/draft/?utm_campaign=new#frame', session: 'renamed' },
    { url: 'https://example.org/other', session: 'one' },
  ])
    await expect(reserveHoldoutReview(path, { ...request, sources: [source] })).rejects.toThrow(/used/i);
  await expect(
    reserveHoldoutReview(path, { ...request, sources: [{ url: 'https://example.org/new', session: 'new' }] }),
  ).resolves.toHaveProperty('path');
});

it('allows at most one concurrent reservation for overlapping sources', async () => {
  const path = await directory();
  const results = await Promise.allSettled([
    reserveHoldoutReview(path, request),
    reserveHoldoutReview(path, { ...request, proposal: 'd'.repeat(64) }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  await expect(reserveHoldoutReview(path, request)).rejects.toThrow(/used/i);
});

it('rejects empty sources and malformed provenance without leaving a locked ledger', async () => {
  const path = await directory();
  await expect(reserveHoldoutReview(path, { ...request, sources: [] })).rejects.toThrow();
  await expect(reserveHoldoutReview(path, { ...request, proposal: 'invalid' })).rejects.toThrow();
  await expect(reserveHoldoutReview(path, request)).resolves.toHaveProperty('path');
});

it('fails closed on partial journal writes and interrupted locks', async () => {
  const corrupt = await directory();
  await writeFile(join(corrupt, `reservation-${'e'.repeat(64)}.json`), '{');
  await expect(reserveHoldoutReview(corrupt, request)).rejects.toThrow();
  const locked = await directory();
  await mkdir(join(locked, '.reservation-lock'));
  await expect(reserveHoldoutReview(locked, request)).rejects.toMatchObject({ code: 'EEXIST' });
});
