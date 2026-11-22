/** The process boundary that prepares calibration before changing the playable pair. */
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
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
import {
  buildCalibration,
  buildThenStagePlayDocuments,
  stagePlayDocuments,
} from '../../tools/stage-calibration-command';
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

/**
 * Two launchers staging into one `public/`, and a commit that fails halfway.
 *
 * Interleaved by hand rather than by two processes: the rename seam lets the
 * second invocation run to completion *inside* the first one's commit, which is
 * the interleaving a race would produce and is the same every run.
 */
describe('two invocations staging into one directory', () => {
  const built = (name: string) => ({ json: `{"of":"${name}"}\n`, summary: name });

  it('refuses a second invocation mid-commit, and keeps the pair the first run’s own', () => {
    const publicDir = join(TEMP, 'public-interleaved');
    const first = executableSet('First launcher');
    const second = executableSet('Second launcher');
    const temps: string[] = [];
    let refusal: string | null = null;

    stagePlayDocuments(first, built('first'), publicDir, {
      rename: (from, to) => {
        temps.push(from);
        // The whole of the second invocation, between the first one's commit of
        // the calibration and its commit of the set: the interleaving that used
        // to leave one run's set beside the other run's calibration.
        if (basename(to) === 'set.json') {
          try {
            stagePlayDocuments(second, built('second'), publicDir, {
              rename: renameSync,
              lockAttempts: 0,
              lockWaitMs: 0,
            });
          } catch (cause: unknown) {
            refusal = cause instanceof Error ? cause.message : String(cause);
          }
        }
        renameSync(from, to);
      },
    });

    expect(refusal).toMatch(/another launcher is staging/);
    expect(refusal).toContain(`pid ${String(process.pid)}`);
    // Unique staging names as well, so a run that does hold the lock is never
    // writing over a name another one picked.
    expect(new Set(temps).size).toBe(temps.length);
    expect(readFileSync(join(publicDir, 'set.json'), 'utf8')).toBe(first.json);
    expect(readFileSync(join(publicDir, 'calibration.json'), 'utf8')).toBe('{"of":"first"}\n');
    expect(readdirSync(publicDir).filter((name) => name.endsWith('.staging'))).toEqual([]);
  });

  it('releases the lock when the commit throws, so the next launcher is not locked out', () => {
    const publicDir = join(TEMP, 'public-lock-release');
    expect(() =>
      stagePlayDocuments(executableSet('Refused pair'), built('refused'), publicDir, {
        rename: () => {
          throw new Error('the disk refused the rename');
        },
      }),
    ).toThrow(/refused the rename/);
    expect(readdirSync(publicDir)).toEqual([]);

    const set = executableSet('Next launcher');
    stagePlayDocuments(set, built('next'), publicDir, { lockAttempts: 0, lockWaitMs: 0, rename: renameSync });
    expect(readFileSync(join(publicDir, 'set.json'), 'utf8')).toBe(set.json);
  });

  it('removes the calibration it committed when the set rename fails after it', () => {
    const publicDir = join(TEMP, 'public-second-rename');
    const set = executableSet('Committed pair');
    stagePlayDocuments(set, built('old'), publicDir);

    expect(() =>
      stagePlayDocuments(executableSet('Newer set'), built('new'), publicDir, {
        rename: (from, to) => {
          if (basename(to) === 'calibration.json') {
            renameSync(from, to);
            return;
          }
          throw new Error('the disk refused the second rename');
        },
      }),
    ).toThrow(/refused the second rename/);

    // The new calibration would pair with the old set, which is the one state
    // worth refusing outright; the set is untouched and no temporary survives.
    expect(readFileSync(join(publicDir, 'set.json'), 'utf8')).toBe(set.json);
    expect(readdirSync(publicDir).sort()).toEqual(['set.json']);
  });

  it('leaves a matched pair alone when the first rename fails', () => {
    const publicDir = join(TEMP, 'public-first-rename');
    const set = executableSet('Standing pair');
    stagePlayDocuments(set, built('standing'), publicDir);

    expect(() =>
      stagePlayDocuments(executableSet('Newer set'), built('new'), publicDir, {
        rename: () => {
          throw new Error('the disk refused the first rename');
        },
      }),
    ).toThrow(/refused the first rename/);

    // Nothing was committed, so the calibration on disk is still the one that
    // addresses the set beside it - possibly another invocation's, which is the
    // reason this run may not delete it.
    expect(readFileSync(join(publicDir, 'calibration.json'), 'utf8')).toBe('{"of":"standing"}\n');
    expect(readFileSync(join(publicDir, 'set.json'), 'utf8')).toBe(set.json);
    expect(readdirSync(publicDir).filter((name) => name.endsWith('.staging'))).toEqual([]);
  });
});
