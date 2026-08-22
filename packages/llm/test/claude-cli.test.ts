/**
 * The `claude` CLI envelope, checked against output recorded from the real
 * binary, plus the spawn path itself exercised through a stub executable.
 *
 * Nothing here reaches the network: the recorded envelopes in
 * `fixtures/claude-cli/` came from probe runs against `claude-haiku-4-5`, and the
 * stub is a local script.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmConfigError, LlmTransportError } from '../src/errors';
import {
  CLAUDE_EFFORT_ENV,
  createClaudeCliTransport,
  DEFAULT_CLAUDE_CLI_EFFORT,
  envelopeToRawResponse,
  parseClaudeCliEnvelope,
} from '../src/providers/claude-cli';
import type { RawRequest } from '../src/types';
import { makeTempDir, removeTempDir } from './helpers';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/claude-cli/', import.meta.url));

function recorded(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8');
}

const REQUEST: RawRequest = {
  system: 'You design Magic cards.',
  prompt: 'Design a red three-power flier.',
  jsonSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  maxTokens: 512,
};

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

describe('parseClaudeCliEnvelope', () => {
  it('parses a plain success envelope recorded from the real binary', () => {
    const envelope = parseClaudeCliEnvelope(recorded('success-plain'));

    expect(envelope.is_error).toBe(false);
    expect(envelope.result).toBe('{"ok":true}');
    expect(envelope.structured_output).toBeUndefined();
    expect(envelope.total_cost_usd).toBeCloseTo(0.0207307, 10);
    expect(envelope.usage?.input_tokens).toBe(10);
  });

  it('maps a success envelope onto a raw response with reported cost', () => {
    const raw = envelopeToRawResponse(parseClaudeCliEnvelope(recorded('success-plain')), 'fallback');

    expect(raw.text).toBe('{"ok":true}');
    expect(raw.costUsd).toBeCloseTo(0.0207307, 10);
    expect(raw.costSource).toBe('reported');
    expect(raw.model).toBe('claude-haiku-4-5');
    expect(raw.usage).toEqual({
      inputTokens: 10,
      outputTokens: 49,
      cacheCreationInputTokens: 9141,
      cacheReadInputTokens: 21937,
    });
  });

  it('carries native structured output when --json-schema was used', () => {
    const raw = envelopeToRawResponse(parseClaudeCliEnvelope(recorded('success-structured')), 'fallback');

    expect(raw.structured).toEqual({ name: 'Emberclaw Drake', power: 3 });
    expect(raw.text).toBe('{"name":"Emberclaw Drake","power":3}');
  });

  it('turns a reported CLI error into a transport error carrying the HTTP status', () => {
    const envelope = parseClaudeCliEnvelope(recorded('error-unknown-model'));
    expect(envelope.is_error).toBe(true);

    let caught: unknown = null;
    try {
      envelopeToRawResponse(envelope, 'fallback');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LlmTransportError);
    const transportError = caught as LlmTransportError;
    expect(transportError.httpStatus).toBe(404);
    expect(transportError.message).toContain('no-such-model-xyz');
  });

  it('rejects empty, non-JSON, and structurally wrong output', () => {
    expect(() => parseClaudeCliEnvelope('   ')).toThrow(LlmTransportError);
    expect(() => parseClaudeCliEnvelope('not json at all')).toThrow(/stdout was not JSON/);
    expect(() => parseClaudeCliEnvelope('{"is_error":false}')).toThrow(
      /envelope did not match the expected shape/,
    );
  });
});

describe('createClaudeCliTransport', () => {
  it('sends the prompt on stdin and the schema on argv', async () => {
    const logPath = join(dir, 'invocation.json');
    const binary = writeLoggingStub(dir, logPath);

    const transport = createClaudeCliTransport({ binary, model: 'claude-haiku-4-5', env: {} });
    const raw = await transport.send(REQUEST);

    expect(raw.structured).toEqual({ name: 'Emberclaw Drake', power: 3 });
    expect(raw.costSource).toBe('reported');

    const log = readInvocation(logPath);
    expect(log.stdin).toBe(REQUEST.prompt);
    expect(log.argv).toContain('-p');
    expect(log.argv).toContain('--output-format');
    expect(log.argv[log.argv.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
    expect(log.argv[log.argv.indexOf('--system-prompt') + 1]).toBe(REQUEST.system);
    expect(JSON.parse(log.argv[log.argv.indexOf('--json-schema') + 1] ?? 'null')).toEqual(REQUEST.jsonSchema);
  });

  /**
   * mtg-bc2.24.2. `maxTokens` is a bound this backend has no flag for, so left
   * to itself one call spends what it likes: at the binary's default effort a
   * single `@mtg/decklab` selection round burned 15,555 output tokens and 238
   * seconds on an answer of about 3 KB, landing either side of this transport's
   * own timeout run to run. Effort is the bound the binary does offer, and
   * tools are switched off because a schema-constrained answer has no use for
   * them and every use of one is latency and reach this seam never wanted.
   */
  it('states the effort it allows and asks for no tools', async () => {
    const logPath = join(dir, 'invocation.json');
    const binary = writeLoggingStub(dir, logPath);

    await createClaudeCliTransport({ binary, env: {} }).send(REQUEST);

    const log = readInvocation(logPath);
    expect(log.argv[log.argv.indexOf('--effort') + 1]).toBe(DEFAULT_CLAUDE_CLI_EFFORT);
    expect(log.argv[log.argv.indexOf('--tools') + 1]).toBe('');
  });

  it('takes the effort from the environment, and refuses a level the binary has no name for', async () => {
    const logPath = join(dir, 'invocation.json');
    const binary = writeLoggingStub(dir, logPath);

    await createClaudeCliTransport({ binary, env: { [CLAUDE_EFFORT_ENV]: 'max' } }).send(REQUEST);

    const log = readInvocation(logPath);
    expect(log.argv[log.argv.indexOf('--effort') + 1]).toBe('max');
    // Caught here rather than as an unknown-argument exit from a live binary,
    // which costs a spawn to find out and reads as a transport failure.
    expect(() => createClaudeCliTransport({ binary, env: { [CLAUDE_EFFORT_ENV]: 'thorough' } })).toThrow(
      LlmConfigError,
    );
  });

  it('surfaces a non-zero exit as a transport error', async () => {
    const binary = writeStub(
      dir,
      'fail',
      `process.stderr.write('claude: authentication required\\n');
       process.exit(3);`,
    );

    const transport = createClaudeCliTransport({ binary, env: {} });
    const error = await transport.send(REQUEST).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LlmTransportError);
    expect((error as LlmTransportError).exitCode).toBe(3);
    expect((error as LlmTransportError).message).toContain('authentication required');
  });

  it('enforces the timeout instead of hanging', async () => {
    const binary = writeStub(dir, 'hang', `setInterval(() => {}, 1000);`);

    const transport = createClaudeCliTransport({ binary, timeoutMs: 250, env: {} });
    await expect(transport.send(REQUEST)).rejects.toThrow(/timed out after 250ms/);
  });

  it('names the binary when it cannot be executed', async () => {
    const transport = createClaudeCliTransport({ binary: join(dir, 'absent-binary'), env: {} });
    await expect(transport.send(REQUEST)).rejects.toThrow(/ENOENT/);
  });

  it('refuses an oversized system prompt rather than blowing the argv limit', async () => {
    const binary = writeStub(dir, 'unused', `process.stdout.write('{}');`);
    const transport = createClaudeCliTransport({ binary, env: {} });

    await expect(transport.send({ ...REQUEST, system: 'x'.repeat(200_000) })).rejects.toBeInstanceOf(
      LlmConfigError,
    );
  });
});

/** A stub that records the argv and stdin it was called with, then answers. */
function writeLoggingStub(directory: string, logPath: string): string {
  return writeStub(
    directory,
    'ok',
    `const fs = require('fs');
     let input = '';
     process.stdin.setEncoding('utf8');
     process.stdin.on('data', (chunk) => { input += chunk; });
     process.stdin.on('end', () => {
       fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv: process.argv.slice(2), stdin: input }));
       process.stdout.write(fs.readFileSync(${JSON.stringify(join(FIXTURE_DIR, 'success-structured.json'))}, 'utf8'));
     });`,
  );
}

function readInvocation(logPath: string): { readonly argv: string[]; readonly stdin: string } {
  return JSON.parse(readFileSync(logPath, 'utf8')) as { argv: string[]; stdin: string };
}

/** Write an executable node stub and return its absolute path. */
function writeStub(directory: string, name: string, body: string): string {
  const path = join(directory, `${name}-stub.cjs`);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}
