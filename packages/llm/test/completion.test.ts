/**
 * The provider policy layer: schema validation, the bounded retry that feeds
 * validation errors back, and the typed error that carries every attempt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixtureMissingError, LlmSchemaValidationError } from '../src/errors';
import type { CompletionRequest, LlmProvider } from '../src/types';
import { UNKNOWN_SPEND } from '../src/types';
import { makeTempDir, recordingProvider, removeTempDir, replayProvider } from './helpers';

const EVERGREEN = [
  'flying',
  'vigilance',
  'haste',
  'trample',
  'deathtouch',
  'lifelink',
  'menace',
  'reach',
  'firstStrike',
] as const;

const CardSchema = z.object({
  name: z.string().min(1),
  color: z.enum(['W', 'U', 'B', 'R', 'G']),
  power: z.number().int().min(0),
  keywords: z.array(z.enum(EVERGREEN)),
});

const VALID = { name: 'Emberclaw Drake', color: 'R', power: 3, keywords: ['flying', 'haste'] };

const REQUEST: CompletionRequest<z.infer<typeof CardSchema>> = {
  system: 'You design Magic cards for a custom set.',
  prompt: 'Design a red three-power flier.',
  schema: CardSchema,
};

/** Runs a completion that cannot validate and hands back the error it raised. */
async function failedCompletion(provider: LlmProvider): Promise<LlmSchemaValidationError> {
  const caught = await provider.complete(REQUEST).then(
    () => null,
    (error: unknown) => error,
  );
  if (!(caught instanceof LlmSchemaValidationError)) {
    throw new Error(`expected LlmSchemaValidationError, got ${String(caught)}`);
  }
  return caught;
}

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

describe('complete', () => {
  it('validates the response and reports usage and cost', async () => {
    const { provider, transport } = recordingProvider(dir, [
      { text: JSON.stringify(VALID), costUsd: 0.02, usage: { inputTokens: 120, outputTokens: 40 } },
    ]);

    const result = await provider.complete(REQUEST);

    expect(result.value).toEqual(VALID);
    expect(result.meta.attempts).toBe(1);
    expect(result.meta.provider).toBe('fixture');
    expect(result.meta.costUsd).toBeCloseTo(0.02, 10);
    expect(result.meta.costSource).toBe('reported');
    expect(result.meta.usage.inputTokens).toBe(120);
    expect(result.meta.usage.outputTokens).toBe(40);
    expect(transport.requests).toHaveLength(1);
  });

  it('states the output contract in the prompt', async () => {
    const { provider, transport } = recordingProvider(dir, [{ text: JSON.stringify(VALID) }]);
    await provider.complete(REQUEST);

    const first = transport.requests[0];
    expect(first?.system).toBe(REQUEST.system);
    expect(first?.prompt).toContain('Design a red three-power flier.');
    expect(first?.prompt).toContain('<output_contract>');
    expect(first?.prompt).toContain('"firstStrike"');
    expect(first?.jsonSchema['type']).toBe('object');
  });

  it('accepts JSON wrapped in a fenced block or prose', async () => {
    const { provider } = recordingProvider(dir, [
      { text: `Here you go:\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`` },
    ]);

    const result = await provider.complete(REQUEST);
    expect(result.value.name).toBe('Emberclaw Drake');
  });

  it('prefers provider-native structured output over the text body', async () => {
    const { provider } = recordingProvider(dir, [
      { text: 'ignored prose that is not JSON at all', structured: VALID },
    ]);

    const result = await provider.complete(REQUEST);
    expect(result.value).toEqual(VALID);
  });

  it('retries with the validation errors fed back into the next attempt', async () => {
    const rejected = { name: 'Emberclaw Drake', color: 'R', power: -1, keywords: ['flight'] };
    const { provider, transport } = recordingProvider(dir, [
      { text: JSON.stringify(rejected) },
      { text: JSON.stringify(VALID) },
    ]);

    const result = await provider.complete(REQUEST);

    expect(result.value).toEqual(VALID);
    expect(result.meta.attempts).toBe(2);
    expect(transport.requests).toHaveLength(2);

    const retry = transport.requests[1]?.prompt ?? '';
    expect(retry).toContain('<rejected_attempt n="1">');
    expect(retry).toContain(JSON.stringify(rejected));
    expect(retry).toContain('power:');
    expect(retry).toContain('keywords.0:');
    expect(retry).toContain('Fix exactly these errors');
  });

  it('reports a parse failure back to the model when the output is not JSON', async () => {
    const { provider, transport } = recordingProvider(dir, [
      { text: 'I cannot comply with that request.' },
      { text: JSON.stringify(VALID) },
    ]);

    const result = await provider.complete(REQUEST);

    expect(result.meta.attempts).toBe(2);
    expect(transport.requests[1]?.prompt).toContain('response was not JSON');
  });

  it('throws a typed error carrying every attempt once retries are exhausted', async () => {
    const attempts = [
      { name: '', color: 'R', power: 3, keywords: [] },
      { name: 'Two', color: 'Q', power: 3, keywords: [] },
      { name: 'Three', color: 'R', power: 1.5, keywords: [] },
    ];
    const { provider, transport } = recordingProvider(
      dir,
      attempts.map((value) => ({ text: JSON.stringify(value), costUsd: 0.01 })),
    );

    const error = await provider.complete(REQUEST).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LlmSchemaValidationError);
    const failure = error as LlmSchemaValidationError;
    expect(failure.code).toBe('schema_validation');
    expect(failure.attempts).toHaveLength(3);
    expect(failure.attempts.map((record) => record.attempt)).toEqual([1, 2, 3]);
    for (const [index, value] of attempts.entries()) {
      expect(failure.attempts[index]?.rawText).toBe(JSON.stringify(value));
      expect(failure.message).toContain(JSON.stringify(value));
    }
    expect(transport.requests).toHaveLength(3);
  });

  /**
   * A completion that raises has no `CompletionMeta`, so without this the only
   * account of what it cost is the provider's budget guard — which cannot say
   * where the figure came from and misattributes when two completions share a
   * provider.
   */
  it('carries the spend the exhausted attempts burned', async () => {
    const { provider } = recordingProvider(dir, [
      { text: '{"name":"One"}', costUsd: 0.01, usage: { inputTokens: 100, outputTokens: 10 } },
      { text: '{"name":"Two"}', costUsd: 0.02, usage: { inputTokens: 100, outputTokens: 10 } },
      { text: '{"name":"Three"}', costUsd: 0.03, usage: { inputTokens: 100, outputTokens: 10 } },
    ]);

    const failure = await failedCompletion(provider);

    expect(failure.spend.costUsd).toBeCloseTo(0.06, 10);
    expect(failure.spend.costSource).toBe('reported');
    expect(failure.spend.usage.inputTokens).toBe(300);
    expect(failure.spend.usage.outputTokens).toBe(30);
    expect(failure.message).toContain('spending $0.0600 (reported)');
  });

  it('says the spend is unknown, not zero, when no attempt could be priced', async () => {
    const unpriced = { costUsd: 0, costSource: 'unknown', usage: { inputTokens: 100 } } as const;
    const { provider } = recordingProvider(dir, [
      { text: '{"name":"One"}', ...unpriced },
      { text: '{"name":"Two"}', ...unpriced },
      { text: '{"name":"Three"}', ...unpriced },
    ]);

    const failure = await failedCompletion(provider);

    expect(failure.spend.costUsd).toBeNull();
    expect(failure.spend.costSource).toBe('unknown');
    expect(failure.spend.usage.inputTokens).toBe(300);
    expect(failure.message).toContain('spend unknown');
  });

  it('keeps what the priced attempts cost as a floor when a later one is unpriced', async () => {
    const { provider } = recordingProvider(dir, [
      { text: '{"name":"One"}', costUsd: 0.02, costSource: 'reported' },
      { text: '{"name":"Two"}', costUsd: 0, costSource: 'unknown' },
      { text: '{"name":"Three"}', costUsd: 0, costSource: 'unknown' },
    ]);

    const failure = await failedCompletion(provider);

    expect(failure.spend.costUsd).toBeCloseTo(0.02, 10);
    expect(failure.spend.costSource).toBe('unknown');
  });

  it('reports an unknown spend when the error is built by hand instead of by a completion', () => {
    const error = new LlmSchemaValidationError('fixture', 'test-model', [
      { attempt: 1, rawText: '{}', issues: ['name: required'] },
    ]);

    expect(error.spend).toEqual(UNKNOWN_SPEND);
    expect(error.spend.costUsd).toBeNull();
  });

  it('honors a maxAttempts of 1', async () => {
    const { provider, transport } = recordingProvider(dir, [{ text: '{}' }], { maxAttempts: 1 });

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(LlmSchemaValidationError);
    expect(transport.requests).toHaveLength(1);
  });
});

describe('fixture replay', () => {
  it('reproduces a recorded run with no live transport', async () => {
    const { provider } = recordingProvider(dir, [
      { text: JSON.stringify({ ...VALID, power: -2 }) },
      { text: JSON.stringify(VALID) },
    ]);
    await provider.complete(REQUEST);

    const replayed = await replayProvider(dir).complete(REQUEST);

    expect(replayed.value).toEqual(VALID);
    expect(replayed.meta.attempts).toBe(2);
  });

  it('fails loudly on a miss instead of calling a live backend', async () => {
    const error = await replayProvider(dir)
      .complete(REQUEST)
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(FixtureMissingError);
    expect((error as FixtureMissingError).message).toContain('FIXTURE_RECORD=1');
    expect((error as FixtureMissingError).path).toContain(dir);
  });
});
