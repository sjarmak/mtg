/**
 * `createMeteredGenerate` bridges Stagehand's `ClientLLM.generate` seam to an
 * `@mtg/llm` provider. Every provider here is built on a scripted transport or
 * on the fixture provider over a temporary directory, so nothing reaches a
 * network or a binary and nothing spends.
 *
 * The request shape is the one Stagehand 4.1.0's `generateStructured` sends
 * (`docs/research/stagehand-jev-seam.md`, 2026-09-22 section): a system prompt,
 * one user text message, and `responseFormat: { type: 'json_schema' }`. The
 * answer must come back as `outputFormat: 'json_schema'` with
 * `structuredContent`, or Stagehand throws before a candidate exists.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClientLLMSchema } from '@browserbasehq/stagehand';
import {
  createBudgetGuard,
  createFixtureProvider,
  createProvider,
  envelopeToRawResponse,
  LlmBudgetExceededError,
  parseClaudeCliEnvelope,
  UNCHECKED_COST,
} from '@mtg/llm';
import type { LlmTransport, RawRequest, RawResponse } from '@mtg/llm';
import {
  contentToText,
  createMeteredGenerate,
  UnsupportedGenerateRequestError,
} from '../../tools/stagehand-model-bridge';
import { StagehandMeter } from '../../tools/stagehand-meter';

const OBSERVE_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { elementId: { type: 'string' }, description: { type: 'string' } },
        required: ['elementId', 'description'],
      },
    },
  },
  required: ['elements'],
};

const ANSWER = { elements: [{ elementId: '1-7', description: 'the flip button' }] };

const OBSERVE_REQUEST = {
  systemPrompt: 'You find elements on a page.',
  messages: [
    { role: 'user' as const, content: { type: 'text' as const, text: 'instruction: flip the card' } },
  ],
  responseFormat: { type: 'json_schema' as const, name: 'Observation', schema: OBSERVE_SCHEMA },
};

function scriptedTransport(seen: RawRequest[], costUsd = 0.01): LlmTransport {
  return {
    name: 'claude-cli',
    model: 'scripted-model',
    send(request): Promise<RawResponse> {
      seen.push(request);
      return Promise.resolve({
        text: JSON.stringify(ANSWER),
        usage: { inputTokens: 40, outputTokens: 9, cacheCreationInputTokens: 0, cacheReadInputTokens: 5 },
        costUsd,
        costSource: 'reported',
        costCheck: UNCHECKED_COST,
        model: 'scripted-model',
      });
    },
  };
}

interface ParsesResults {
  safeParse(value: unknown): { success: boolean };
}

/** The result half of `ClientLLMSchema.generate`, unwrapped from its promise. */
function stagehandResultSchema(): ParsesResults {
  const generate = (
    ClientLLMSchema.shape.generate as unknown as { def: { output: { def: { innerType: ParsesResults } } } }
  ).def;
  return generate.output.def.innerType;
}

describe('contentToText', () => {
  it('joins a single text block', () => {
    expect(contentToText({ type: 'text', text: 'hello' })).toBe('hello');
  });

  it('joins an array of blocks, dropping non-text ones', () => {
    expect(
      contentToText([
        { type: 'text', text: 'first' },
        { type: 'image', image: 'ignored' } as unknown as { type: 'text'; text: string },
        { type: 'text', text: 'second' },
      ]),
    ).toBe('first\nsecond');
  });
});

describe('createMeteredGenerate', () => {
  it('answers a json_schema request as structured content, in the shape Stagehand accepts', async () => {
    const seen: RawRequest[] = [];
    const budget = createBudgetGuard({ maxUsd: 1 });
    const llm = createProvider(scriptedTransport(seen), { budget });
    const generate = createMeteredGenerate({ llm, meter: new StagehandMeter(budget) });

    const result = await generate(OBSERVE_REQUEST);

    expect(result.outputFormat).toBe('json_schema');
    expect(result.outputFormat === 'json_schema' ? result.structuredContent : null).toEqual(ANSWER);
    expect(result.usage).toEqual({ inputTokens: 45, outputTokens: 9, totalTokens: 54, cachedInputTokens: 5 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.system).toBe('You find elements on a page.');
    expect(seen[0]?.prompt).toContain('instruction: flip the card');
  });

  it("passes Stagehand's own ClientLLM result schema", async () => {
    const budget = createBudgetGuard({ maxUsd: 1 });
    const generate = createMeteredGenerate({
      llm: createProvider(scriptedTransport([]), { budget }),
      meter: new StagehandMeter(budget),
    });
    const result = await generate(OBSERVE_REQUEST);
    expect(stagehandResultSchema().safeParse(result).success).toBe(true);
  });

  it('records the call against the guard and logs it under the current step', async () => {
    const budget = createBudgetGuard({ maxUsd: 1 });
    const meter = new StagehandMeter(budget);
    const generate = createMeteredGenerate({ llm: createProvider(scriptedTransport([]), { budget }), meter });
    meter.setStep('printed-gallery-face-toggle');

    await generate(OBSERVE_REQUEST);

    expect(budget.snapshot().calls).toBe(1);
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.01, 10);
    expect(meter.callLog()).toEqual([
      {
        step: 'printed-gallery-face-toggle',
        modelId: 'scripted-model',
        inputTokens: 40,
        outputTokens: 9,
        usd: 0.01,
        rawText: JSON.stringify(ANSWER),
        elementCount: 1,
      },
    ]);
  });

  it('refuses before the transport is reached once the ceiling is met, and the meter remembers it', async () => {
    const seen: RawRequest[] = [];
    const budget = createBudgetGuard({ maxUsd: 0.01 });
    budget.record({
      costUsd: 0.02,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    const meter = new StagehandMeter(budget);
    meter.setStep('precon-your-deck-select');
    const generate = createMeteredGenerate({
      llm: createProvider(scriptedTransport(seen), { budget }),
      meter,
    });

    await expect(generate(OBSERVE_REQUEST)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(seen).toEqual([]);
    expect(meter.refusal()).toMatchObject({ maxUsd: 0.01, step: 'precon-your-deck-select' });
  });

  it('refuses a free-text request and a tool-calling request by name, before any call', async () => {
    const seen: RawRequest[] = [];
    const budget = createBudgetGuard({ maxUsd: 1 });
    const generate = createMeteredGenerate({
      llm: createProvider(scriptedTransport(seen), { budget }),
      meter: new StagehandMeter(budget),
    });
    const messages = OBSERVE_REQUEST.messages;

    await expect(generate({ messages })).rejects.toThrow(/free text/);
    await expect(
      generate({
        messages,
        tools: [{ name: 'click', inputSchema: { type: 'object' } }],
      } as unknown as Parameters<typeof generate>[0]),
    ).rejects.toBeInstanceOf(UnsupportedGenerateRequestError);
    expect(seen).toEqual([]);
  });

  it('makes no fetch of its own: the provider decides where the call goes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const budget = createBudgetGuard({ maxUsd: 1 });
      const generate = createMeteredGenerate({
        llm: createProvider(scriptedTransport([]), { budget }),
        meter: new StagehandMeter(budget),
      });
      await generate(OBSERVE_REQUEST);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('replays under the fixture provider at zero cost once the answer is recorded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stagehand-bridge-fixture-'));
    const recordBudget = createBudgetGuard({ maxUsd: 1 });
    const recorder = createFixtureProvider({
      dir,
      record: true,
      delegate: () => scriptedTransport([], 0),
      budget: recordBudget,
    });
    await createMeteredGenerate({ llm: recorder, meter: new StagehandMeter(recordBudget) })(OBSERVE_REQUEST);

    const budget = createBudgetGuard({ maxUsd: 1 });
    const replay = createFixtureProvider({ dir, record: false, budget });
    const result = await createMeteredGenerate({ llm: replay, meter: new StagehandMeter(budget) })(
      OBSERVE_REQUEST,
    );

    expect(result.outputFormat === 'json_schema' ? result.structuredContent : null).toEqual(ANSWER);
    expect(budget.snapshot()).toMatchObject({ spentUsd: 0, calls: 1, unreconciledCalls: 0 });
  });
});

/**
 * `mtg-5a89i`: a live run reported every `observe()` call answered (billed,
 * with output tokens) and every step still zero candidates, with no raw
 * answer recorded to say why. Every test above scripts an `LlmTransport`
 * directly, so none of them exercise `envelopeToRawResponse` — the function
 * that turns what `claude-cli` actually prints into the `RawResponse` this
 * bridge reads. These do, against an answer shaped like Stagehand's real
 * `observe()` schema: an `elementId` matching `/^\d+-\d+$/` (the pattern
 * `ObservationSchema` enforces in
 * `node_modules/@browserbasehq/stagehand/dist/extension/service-worker.js`;
 * not exported from the package, so mirrored here rather than guessed at),
 * `description`, `method` and `arguments`, all `.strict()`.
 */
const STAGEHAND_ELEMENT_ID_PATTERN = /^\d+-\d+$/;

const REALISTIC_OBSERVE_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          elementId: { type: 'string', pattern: '^\\d+-\\d+$' },
          description: { type: 'string' },
          method: { type: 'string' },
          arguments: { type: 'array', items: { type: 'string' } },
        },
        required: ['elementId', 'description', 'method', 'arguments'],
        additionalProperties: false,
      },
    },
  },
  required: ['elements'],
  additionalProperties: false,
};

const REALISTIC_OBSERVE_REQUEST = {
  systemPrompt: 'You find elements on a page.',
  messages: [
    {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: 'instruction: Find the button on a card that shows the other face of a double-faced or modal card',
      },
    },
  ],
  responseFormat: { type: 'json_schema' as const, name: 'Observation', schema: REALISTIC_OBSERVE_SCHEMA },
};

const REALISTIC_ANSWER = {
  elements: [
    { elementId: '0-18372', description: 'the flip button on the card', method: 'click', arguments: [] },
  ],
};

/** A transport that turns a real `claude-cli --output-format json` envelope into a `RawResponse`, the way `createClaudeCliTransport` does. */
function claudeCliShapedTransport(envelopeJson: string): LlmTransport {
  return {
    name: 'claude-cli',
    model: 'claude-fable-5',
    send(): Promise<RawResponse> {
      return Promise.resolve(envelopeToRawResponse(parseClaudeCliEnvelope(envelopeJson), 'claude-fable-5'));
    },
  };
}

describe("the bridge against claude-cli's real envelope shape", () => {
  it('threads structured_output into Stagehand-shaped candidates with a valid element ID', async () => {
    const envelope = JSON.stringify({
      is_error: false,
      result: JSON.stringify(REALISTIC_ANSWER),
      structured_output: REALISTIC_ANSWER,
      total_cost_usd: 0.0157,
      usage: {
        input_tokens: 1200,
        output_tokens: 93,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
      },
      modelUsage: { 'claude-fable-5-20260101': { canonicalModel: 'claude-fable-5', costUSD: 0.0157 } },
    });
    const budget = createBudgetGuard({ maxUsd: 1 });
    const generate = createMeteredGenerate({
      llm: createProvider(claudeCliShapedTransport(envelope), { budget }),
      meter: new StagehandMeter(budget),
    });

    const result = await generate(REALISTIC_OBSERVE_REQUEST);

    expect(result.outputFormat).toBe('json_schema');
    const structured = result.outputFormat === 'json_schema' ? result.structuredContent : null;
    expect(structured).toEqual(REALISTIC_ANSWER);
    const elements = (structured as typeof REALISTIC_ANSWER).elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]?.elementId).toMatch(STAGEHAND_ELEMENT_ID_PATTERN);
  });

  it('threads a plain result string into the same shape when structured_output is absent', async () => {
    const envelope = JSON.stringify({
      is_error: false,
      result: JSON.stringify(REALISTIC_ANSWER),
      total_cost_usd: 0.0157,
      usage: {
        input_tokens: 1200,
        output_tokens: 93,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
      },
    });
    const budget = createBudgetGuard({ maxUsd: 1 });
    const meter = new StagehandMeter(budget);
    const generate = createMeteredGenerate({
      llm: createProvider(claudeCliShapedTransport(envelope), { budget }),
      meter,
    });
    meter.setStep('printed-gallery-face-toggle');

    const result = await generate(REALISTIC_OBSERVE_REQUEST);

    const structured = result.outputFormat === 'json_schema' ? result.structuredContent : null;
    expect(structured).toEqual(REALISTIC_ANSWER);
    expect(meter.callLog()).toMatchObject([
      {
        step: 'printed-gallery-face-toggle',
        modelId: 'claude-fable-5',
        rawText: JSON.stringify(REALISTIC_ANSWER),
        elementCount: 1,
      },
    ]);
  });

  it('records a zero-element answer as elementCount 0, not null, distinguishing "answered empty" from "not an observe call"', async () => {
    const emptyAnswer = { elements: [] };
    const envelope = JSON.stringify({
      is_error: false,
      result: JSON.stringify(emptyAnswer),
      structured_output: emptyAnswer,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 800,
        output_tokens: 41,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    const budget = createBudgetGuard({ maxUsd: 1 });
    const meter = new StagehandMeter(budget);
    const generate = createMeteredGenerate({
      llm: createProvider(claudeCliShapedTransport(envelope), { budget }),
      meter,
    });
    meter.setStep('precon-your-deck-select');

    await generate(REALISTIC_OBSERVE_REQUEST);

    expect(meter.callLog()[0]?.elementCount).toBe(0);
    expect(meter.callLog()[0]?.rawText).toBe(JSON.stringify(emptyAnswer));
  });
});
