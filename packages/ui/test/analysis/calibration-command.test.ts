/** The process boundary that prepares calibration before changing the playable pair. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import {
  calibrationPayloadText,
  canonicalJsonText,
  classifyCalibration,
  readCalibrationArtifact,
  sha256Text,
} from '../../src/routes/analysis/calibration-read';
import { buildCalibration, buildThenStagePlayDocuments } from '../../tools/stage-calibration-command';
import type { ResolvedSet } from '../../tools/resolve-set';

const TEMP = mkdtempSync(join(tmpdir(), 'mtg-ui-calibration-command-'));
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

afterAll(() => {
  rmSync(TEMP, { recursive: true, force: true });
});

function executableSet(name: string): ResolvedSet {
  const path = join(TEMP, `${name}.json`);
  const json = `${JSON.stringify({ set: { code: 'XMP', name }, cards: EXAMPLE_CARDS }, null, 2)}\n`;
  writeFileSync(path, json, 'utf8');
  return { ok: true, path, what: `test set ${name}`, cardCount: EXAMPLE_CARDS.length, json };
}

describe('calibration subprocess staging', () => {
  it('keeps staged calibration and retune documents out of version control', () => {
    for (const path of ['packages/ui/public/calibration.json', 'packages/ui/public/retune.json']) {
      expect(() =>
        execFileSync('git', ['check-ignore', '-q', '--', path], {
          cwd: REPO_ROOT,
          stdio: 'ignore',
        }),
      ).not.toThrow();
    }
  });

  it('returns a self-addressed document through the non-UI producer process', async () => {
    const built = buildCalibration(executableSet('Addressed'));
    const artifact = readCalibrationArtifact(JSON.parse(built.json) as unknown);
    expect(await sha256Text(calibrationPayloadText(artifact))).toBe(artifact.payloadDigest);
    expect(built.summary).toMatch(/12 reference profiles.*21 metrics/i);
  });

  it('addresses the resolver bytes that will be staged rather than rereading a changed path', async () => {
    const onDisk = executableSet('Old disk contents');
    const document = { set: { code: 'XMP', name: 'Resolved bytes' }, cards: EXAMPLE_CARDS };
    const resolved = { ...onDisk, json: `${JSON.stringify(document, null, 2)}\n` };
    const artifact = readCalibrationArtifact(JSON.parse(buildCalibration(resolved).json));
    expect(artifact.subject.name).toBe('Resolved bytes');
    expect(artifact.subject.fingerprint).toBe(`sha256:${await sha256Text(canonicalJsonText(document))}`);
  });

  it('does not mutate public state when production fails before staging', () => {
    const publicDir = join(TEMP, 'public-failure');
    const set = executableSet('New set');
    buildThenStagePlayDocuments(set, publicDir, () => ({ json: '{"old":true}\n', summary: 'old' }));
    const beforeSet = readFileSync(join(publicDir, 'set.json'), 'utf8');
    const beforeCalibration = readFileSync(join(publicDir, 'calibration.json'), 'utf8');
    expect(() =>
      buildThenStagePlayDocuments(set, publicDir, () => {
        throw new Error('producer refused the set');
      }),
    ).toThrow(/producer refused/);
    expect(readFileSync(join(publicDir, 'set.json'), 'utf8')).toBe(beforeSet);
    expect(readFileSync(join(publicDir, 'calibration.json'), 'utf8')).toBe(beforeCalibration);
  });

  it('rejects another staged document with the same set code', async () => {
    const first = readCalibrationArtifact(JSON.parse(buildCalibration(executableSet('First XMP')).json));
    const second = readCalibrationArtifact(JSON.parse(buildCalibration(executableSet('Second XMP')).json));
    expect(first.subject.code).toBe(second.subject.code);
    expect(first.subject.fingerprint).not.toBe(second.subject.fingerprint);
    expect(
      await classifyCalibration(first, {
        code: second.subject.code,
        fingerprint: second.subject.fingerprint,
      }),
    ).toMatchObject({ status: 'stale' });
  });
});
