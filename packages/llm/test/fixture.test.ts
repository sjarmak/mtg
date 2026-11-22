/**
 * The fixture transport's on-disk contract: what gets written, what a corrupt
 * file does, and what happens when record mode has nothing to record from.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureMissingError, LlmConfigError, LlmTransportError } from '../src/errors';
import { createFixtureTransport, fixturePath, keyForRequest, readFixture } from '../src/providers/fixture';
import { buildAttemptPrompt } from '../src/prompt';
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

  it('reports every replayed request key in call order', async () => {
    const delegate = scriptedTransport([{ text: '{"ok":true}' }]);
    await createFixtureTransport({ dir, record: true, delegate, env: {} }).send(REQUEST);

    const keys: string[] = [];
    const replay = createFixtureTransport({
      dir,
      record: false,
      env: {},
      onCall: (key) => keys.push(key),
    });
    await replay.send(REQUEST);
    await replay.send(REQUEST);

    expect(keys).toStrictEqual([keyForRequest(REQUEST), keyForRequest(REQUEST)]);
  });

  it('reuses an older recording for a strictly additive answer-schema widening', async () => {
    const oldRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old'] } } },
    };
    const widenedRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old', 'new'] } } },
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"choice":"old"}', structured: { choice: 'old' } }]),
      env: {},
    }).send(oldRequest);

    const served: string[] = [];
    const replayed = await createFixtureTransport({
      dir,
      record: false,
      env: {},
      onCall: (key) => served.push(key),
    }).send(widenedRequest);

    expect(replayed.structured).toStrictEqual({ choice: 'old' });
    expect(served).toStrictEqual([keyForRequest(oldRequest)]);
    expect(existsSync(fixturePath(dir, keyForRequest(widenedRequest)))).toBe(false);
  });

  it('reuses an older recording when the wider contract adds an optional property', async () => {
    const oldRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: {
        type: 'object',
        properties: { cost: { type: 'object', properties: {}, additionalProperties: false } },
        additionalProperties: false,
      },
    };
    const widenedRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: {
        type: 'object',
        properties: {
          cost: {
            type: 'object',
            properties: { exileSpell: { type: 'boolean', const: true } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"cost":{}}', structured: { cost: {} } }]),
      env: {},
    }).send(oldRequest);

    const replayed = await createFixtureTransport({ dir, record: false, env: {} }).send(widenedRequest);

    expect(replayed.structured).toStrictEqual({ cost: {} });
  });

  it('does not treat a property added to an open object schema as a widening', async () => {
    const oldRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { cost: { type: 'object', properties: {} } } },
    };
    const narrowedRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: {
        type: 'object',
        properties: {
          cost: {
            type: 'object',
            properties: { exileSpell: { type: 'boolean', const: true } },
          },
        },
      },
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"cost":{}}', structured: { cost: {} } }]),
      env: {},
    }).send(oldRequest);

    await expect(
      createFixtureTransport({ dir, record: false, env: {} }).send(narrowedRequest),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it('reuses an older completion recording when its embedded output contract widens additively', async () => {
    const oldSchema = { type: 'object', properties: { choice: { enum: ['old'] } } };
    const widenedSchema = { type: 'object', properties: { choice: { enum: ['old', 'new'] } } };
    const oldRequest: RawRequest = {
      ...REQUEST,
      prompt: buildAttemptPrompt({ prompt: 'choose one', jsonSchema: oldSchema, previous: [] }),
      jsonSchema: oldSchema,
    };
    const widenedRequest: RawRequest = {
      ...REQUEST,
      prompt: buildAttemptPrompt({ prompt: 'choose one', jsonSchema: widenedSchema, previous: [] }),
      jsonSchema: widenedSchema,
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"choice":"old"}', structured: { choice: 'old' } }]),
      env: {},
    }).send(oldRequest);

    const replayed = await createFixtureTransport({ dir, record: false, env: {} }).send(widenedRequest);

    expect(replayed.structured).toStrictEqual({ choice: 'old' });
    expect(existsSync(fixturePath(dir, keyForRequest(widenedRequest)))).toBe(false);
  });

  it('does not reuse an embedded-contract recording for a different task', async () => {
    const oldSchema = { type: 'object', properties: { choice: { enum: ['old'] } } };
    const widenedSchema = { type: 'object', properties: { choice: { enum: ['old', 'new'] } } };
    const oldRequest: RawRequest = {
      ...REQUEST,
      prompt: buildAttemptPrompt({ prompt: 'choose one', jsonSchema: oldSchema, previous: [] }),
      jsonSchema: oldSchema,
    };
    const differentTask: RawRequest = {
      ...REQUEST,
      prompt: buildAttemptPrompt({
        prompt: 'choose something else',
        jsonSchema: widenedSchema,
        previous: [],
      }),
      jsonSchema: widenedSchema,
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"choice":"old"}', structured: { choice: 'old' } }]),
      env: {},
    }).send(oldRequest);

    await expect(
      createFixtureTransport({ dir, record: false, env: {} }).send(differentTask),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it('does not reuse a recording when the requested schema narrows the old contract', async () => {
    const oldRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old', 'new'] } } },
    };
    const narrowedRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old'] } } },
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"choice":"old"}', structured: { choice: 'old' } }]),
      env: {},
    }).send(oldRequest);

    await expect(
      createFixtureTransport({ dir, record: false, env: {} }).send(narrowedRequest),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it('does not reuse an answer that fails its own recorded schema', async () => {
    const oldRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old'] } } },
    };
    const widenedRequest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old', 'new'] } } },
    };
    await createFixtureTransport({
      dir,
      record: true,
      delegate: scriptedTransport([{ text: '{"choice":"invalid"}', structured: { choice: 'invalid' } }]),
      env: {},
    }).send(oldRequest);

    await expect(
      createFixtureTransport({ dir, record: false, env: {} }).send(widenedRequest),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it('prefers the widest compatible recording in a chain of additive schemas', async () => {
    const oldest: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old'] } } },
    };
    const newer: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old', 'new'] } } },
    };
    const requested: RawRequest = {
      ...REQUEST,
      jsonSchema: { type: 'object', properties: { choice: { enum: ['old', 'new', 'next'] } } },
    };
    for (const [request, choice] of [
      [oldest, 'old'],
      [newer, 'new'],
    ] as const) {
      await createFixtureTransport({
        dir,
        record: true,
        delegate: scriptedTransport([{ text: JSON.stringify({ choice }), structured: { choice } }]),
        env: {},
      }).send(request);
    }

    const served: string[] = [];
    const replayed = await createFixtureTransport({
      dir,
      record: false,
      env: {},
      onCall: (key) => served.push(key),
    }).send(requested);

    expect(replayed.structured).toStrictEqual({ choice: 'new' });
    expect(served).toStrictEqual([keyForRequest(newer)]);
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
