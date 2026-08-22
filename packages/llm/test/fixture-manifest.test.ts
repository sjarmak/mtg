/**
 * The run manifest's on-disk contract.
 *
 * A manifest exists so a recorded run's bill can be computed without replaying
 * anything, which makes every way it can be wrong a way to publish a wrong
 * dollar figure with no sign that anything went missing. So the three that
 * silently under-report are errors rather than gaps: a key with no file, a key
 * listed twice, and a file that is not a manifest at all.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmTransportError } from '../src/errors';
import { buildFixture, fixturePath, writeFixture } from '../src/providers/fixture';
import {
  listRunManifests,
  manifestId,
  readManifestFixtures,
  readRunManifest,
  writeRunManifest,
} from '../src/providers/fixture-manifest';
import type { RunManifest } from '../src/providers/fixture-manifest';
import type { RawRequest, RawResponse } from '../src/types';
import { makeTempDir, removeTempDir } from './helpers';

const REQUEST: RawRequest = {
  system: 'system prompt',
  prompt: 'user prompt',
  jsonSchema: { type: 'object' },
  maxTokens: 256,
};

const RESPONSE: RawResponse = {
  text: '{"ok":true}',
  usage: { inputTokens: 12, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  costUsd: 0.004,
  costSource: 'reported',
  model: 'claude-haiku-4-5',
};

const MANIFEST: RunManifest = {
  id: 'run',
  run: 'proving-ground',
  brief: 'packages/setgen/briefs/proving-ground.json',
  recordedAt: '2026-08-13T16:00:00.000Z',
  calls: 2,
  keys: ['aaa', 'bbb'],
};

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

function manifestPath(): string {
  return join(dir, 'run.json');
}

describe('a run manifest round trip', () => {
  it('reads back every field it was written with', () => {
    writeRunManifest(manifestPath(), MANIFEST);
    expect(readRunManifest(manifestPath())).toEqual(MANIFEST);
  });

  /**
   * The failure this guard exists for: a live regeneration of the flagship
   * brief wrote its manifest over the previous run's, and 31 keys plus the
   * prose explaining why that run no longer replays became 30 keys and nothing.
   * A manifest is the disk half of a bill that was paid, so replacing one is
   * always a mistake, whatever the filename says.
   */
  it('refuses to write over a manifest that is already there', () => {
    writeRunManifest(manifestPath(), MANIFEST);
    expect(() => writeRunManifest(manifestPath(), { ...MANIFEST, calls: 1, keys: ['ccc'] })).toThrow(
      /already/,
    );
    expect(readRunManifest(manifestPath()).keys).toStrictEqual(['aaa', 'bbb']);
  });

  it('creates the directory it is written into', () => {
    const nested = join(dir, 'fixtures', 'runs', 'run.json');
    writeRunManifest(nested, MANIFEST);
    expect(readRunManifest(nested).keys).toEqual(['aaa', 'bbb']);
  });

  it('keeps the prose saying why a run no longer replays', () => {
    // The schema strips unknown keys by default, which silently deleted this
    // note the first time a manifest carrying one was read.
    const stale = 'The brief moved past this run, so its keys no longer hash.';
    writeRunManifest(manifestPath(), { ...MANIFEST, stale });
    expect(readRunManifest(manifestPath()).stale).toBe(stale);
  });

  it('refuses a field nobody declared rather than dropping it', () => {
    writeFileSync(manifestPath(), JSON.stringify({ ...MANIFEST, notes: 'kept?' }), 'utf8');
    expect(() => readRunManifest(manifestPath())).toThrow(/does not match the manifest schema/);
  });
});

describe('a run id', () => {
  it('carries the brief and the finish time, to the second', () => {
    expect(manifestId('flagship-set', '2026-08-13T17:25:06.188Z')).toBe('flagship-set-2026-08-13T17-25-06Z');
  });

  it('separates two runs of one brief in the same hour', () => {
    const first = manifestId('flagship-set', '2026-08-13T16:01:42.253Z');
    const second = manifestId('flagship-set', '2026-08-13T16:01:43.000Z');
    expect(first).not.toBe(second);
  });

  it('is the filename, and a manifest that says otherwise is rejected', () => {
    writeRunManifest(manifestPath(), { ...MANIFEST, id: 'some-other-run' });
    expect(() => readRunManifest(manifestPath())).toThrow(/calls itself some-other-run/);
  });
});

describe('listRunManifests', () => {
  it('returns every run oldest first, so the newest is the last one', () => {
    const runs = [
      { ...MANIFEST, id: 'brief-2026-08-13T17-25-06Z', recordedAt: '2026-08-13T17:25:06.188Z' },
      { ...MANIFEST, id: 'brief-2026-08-09T22-30-10Z', recordedAt: '2026-08-09T22:30:10.127Z' },
      { ...MANIFEST, id: 'brief-2026-08-13T16-01-42Z', recordedAt: '2026-08-13T16:01:42.253Z' },
    ];
    for (const run of runs) writeRunManifest(join(dir, `${run.id}.json`), run);

    // The lookup that replaces a file meaning "the latest run of this brief".
    const listed = listRunManifests(dir);
    expect(listed.map((manifest) => manifest.id)).toStrictEqual([
      'brief-2026-08-09T22-30-10Z',
      'brief-2026-08-13T16-01-42Z',
      'brief-2026-08-13T17-25-06Z',
    ]);
    expect(listed.at(-1)?.recordedAt).toBe('2026-08-13T17:25:06.188Z');
  });

  it('is empty for a directory no run has written to', () => {
    expect(listRunManifests(join(dir, 'nothing-here'))).toStrictEqual([]);
  });
});

describe('a manifest that would under-report the bill', () => {
  it('refuses a key listed twice, which would double-count one file', () => {
    writeRunManifest(manifestPath(), { ...MANIFEST, calls: 3, keys: ['aaa', 'bbb', 'aaa'] });
    expect(() => readRunManifest(manifestPath())).toThrow(LlmTransportError);
    expect(() => readRunManifest(manifestPath())).toThrow(/lists 1 key\(s\) twice/);
  });

  it('refuses a file that is not a manifest', () => {
    writeFileSync(manifestPath(), JSON.stringify({ run: 'proving-ground' }), 'utf8');
    expect(() => readRunManifest(manifestPath())).toThrow(/does not match the manifest schema/);
  });

  it('refuses a file that is not JSON', () => {
    writeFileSync(manifestPath(), 'not json at all', 'utf8');
    expect(() => readRunManifest(manifestPath())).toThrow(/is not readable JSON/);
  });

  it('refuses a run that served nothing, because a run always serves something', () => {
    writeFileSync(manifestPath(), JSON.stringify({ ...MANIFEST, calls: 0, keys: [] }), 'utf8');
    expect(() => readRunManifest(manifestPath())).toThrow(/does not match the manifest schema/);
  });
});

describe('readManifestFixtures', () => {
  it('returns the named fixtures in manifest order', () => {
    for (const key of ['aaa', 'bbb']) {
      writeFixture(fixturePath(dir, key), buildFixture(key, 'fixture', REQUEST, RESPONSE));
    }
    const fixtures = readManifestFixtures(dir, MANIFEST);
    expect(fixtures.map((fixture) => fixture.key)).toEqual(['aaa', 'bbb']);
  });

  it('names every missing fixture rather than summing the ones that are there', () => {
    writeFixture(fixturePath(dir, 'aaa'), buildFixture('aaa', 'fixture', REQUEST, RESPONSE));
    expect(() => readManifestFixtures(dir, MANIFEST)).toThrow(LlmTransportError);
    expect(() => readManifestFixtures(dir, MANIFEST)).toThrow(
      /run proving-ground names 1 fixture\(s\) that are not in .*: bbb/,
    );
  });
});
