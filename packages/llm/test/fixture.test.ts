/**
 * The fixture transport's on-disk contract: what gets written, what a corrupt
 * file does, and what happens when record mode has nothing to record from.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmConfigError, LlmTransportError } from '../src/errors';
import { createFixtureTransport, fixturePath, keyForRequest, readFixture } from '../src/providers/fixture';
import type { RawRequest } from '../src/types';
import { makeTempDir, removeTempDir, scriptedTransport } from './helpers';

const REQUEST: RawRequest = {
  system: 'system prompt',
  prompt: 'user prompt',
  jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  maxTokens: 256,
};

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

describe('createFixtureTransport', () => {
  it('writes a fixture named after the request key and replays it verbatim', async () => {
    const delegate = scriptedTransport([
      {
        text: '{"ok":true}',
        structured: { ok: true },
        costUsd: 0.004,
        usage: { inputTokens: 12, outputTokens: 3 },
        model: 'claude-haiku-4-5',
      },
    ]);

    const recorder = createFixtureTransport({ dir, record: true, delegate, env: {} });
    const recorded = await recorder.send(REQUEST);

    const key = keyForRequest(REQUEST);
    const path = fixturePath(dir, key);
    expect(existsSync(path)).toBe(true);

    const fixture = readFixture(path);
    expect(fixture.key).toBe(key);
    expect(fixture.provider).toBe('claude-cli');
    expect(fixture.model).toBe('claude-haiku-4-5');
    expect(fixture.request.prompt).toBe(REQUEST.prompt);
    expect(fixture.request.schema).toEqual(REQUEST.jsonSchema);
    expect(fixture.response.costUsd).toBeCloseTo(0.004, 10);

    const replayed = await createFixtureTransport({ dir, record: false, env: {} }).send(REQUEST);
    expect(replayed).toEqual(recorded);
  });

  it('reads record mode and the fixture directory from the environment', async () => {
    const delegate = scriptedTransport([{ text: '{}' }]);
    const transport = createFixtureTransport({
      delegate,
      env: { FIXTURE_RECORD: '1', MTG_LLM_FIXTURE_DIR: dir },
    });

    await transport.send(REQUEST);
    expect(existsSync(fixturePath(dir, keyForRequest(REQUEST)))).toBe(true);
  });

  it('refuses to record without a live delegate', async () => {
    const transport = createFixtureTransport({ dir, record: true, env: {} });
    await expect(transport.send(REQUEST)).rejects.toBeInstanceOf(LlmConfigError);
  });

  it('rejects a corrupt fixture file instead of replaying garbage', async () => {
    const path = fixturePath(dir, keyForRequest(REQUEST));
    writeFileSync(path, '{"key":"abc"}', 'utf8');

    const transport = createFixtureTransport({ dir, record: false, env: {} });
    await expect(transport.send(REQUEST)).rejects.toBeInstanceOf(LlmTransportError);

    writeFileSync(path, 'not json', 'utf8');
    await expect(transport.send(REQUEST)).rejects.toThrow(/not readable JSON/);
  });
});
