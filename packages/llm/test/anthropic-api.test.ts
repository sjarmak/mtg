/**
 * The Anthropic API provider, exercised through an injected client double.
 *
 * No network, no key, no spend: the double returns hand-built Messages
 * responses so the tool-use forcing, refusal handling, and cost estimation can
 * be asserted directly.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { LlmConfigError, LlmRefusalError, LlmTransportError } from '../src/errors';
import type { AnthropicMessagesClient } from '../src/providers/anthropic-api';
import { createAnthropicApiTransport, RESULT_TOOL_NAME } from '../src/providers/anthropic-api';
import type { RawRequest } from '../src/types';

const REQUEST: RawRequest = {
  system: 'You design Magic cards.',
  prompt: 'Design a red three-power flier.',
  jsonSchema: {
    type: 'object',
    properties: { name: { type: 'string' }, power: { type: 'integer' } },
    required: ['name', 'power'],
    additionalProperties: false,
  },
  maxTokens: 1024,
};

const USAGE: Anthropic.Usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: null,
  server_tool_use: null,
  service_tier: 'standard',
};

interface Recorder {
  readonly client: AnthropicMessagesClient;
  readonly calls: Anthropic.MessageCreateParamsNonStreaming[];
}

function clientReturning(message: Anthropic.Message): Recorder {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    client: {
      create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        calls.push(params);
        return Promise.resolve(message);
      },
    },
  };
}

function message(overrides: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-fable-5',
    content: [],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: USAGE,
    ...overrides,
  };
}

function toolUse(input: unknown, name = RESULT_TOOL_NAME): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id: 'toolu_test', name, input };
}

describe('createAnthropicApiTransport', () => {
  it('forces the result tool and returns its input as structured output', async () => {
    const value = { name: 'Emberclaw Drake', power: 3 };
    const recorder = clientReturning(message({ content: [toolUse(value)] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    const raw = await transport.send(REQUEST);

    expect(raw.structured).toEqual(value);
    expect(raw.text).toBe(JSON.stringify(value));
    expect(raw.model).toBe('claude-fable-5');
    expect(raw.usage.inputTokens).toBe(1000);

    const params = recorder.calls[0];
    expect(params?.model).toBe('claude-fable-5');
    expect(params?.max_tokens).toBe(1024);
    expect(params?.system).toBe(REQUEST.system);
    expect(params?.tool_choice).toEqual({
      type: 'tool',
      name: RESULT_TOOL_NAME,
      disable_parallel_tool_use: true,
    });
    expect(params?.tools?.[0]).toMatchObject({
      name: RESULT_TOOL_NAME,
      input_schema: { type: 'object', required: ['name', 'power'] },
    });
  });

  it('estimates cost from the local price table', async () => {
    const recorder = clientReturning(message({ content: [toolUse({ name: 'X', power: 1 })] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    const raw = await transport.send(REQUEST);

    // 1000 input @ $10/MTok + 200 output @ $50/MTok
    expect(raw.costUsd).toBeCloseTo(0.01 + 0.01, 10);
    expect(raw.costSource).toBe('estimated');
  });

  it('reports an unknown cost rather than a fabricated zero', async () => {
    const recorder = clientReturning(
      message({ model: 'claude-experimental-9', content: [toolUse({ name: 'X', power: 1 })] }),
    );
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    const raw = await transport.send(REQUEST);
    expect(raw.costSource).toBe('unknown');
    expect(raw.costUsd).toBe(0);
  });

  it('wraps and unwraps a non-object schema for tool-use forcing', async () => {
    const recorder = clientReturning(message({ content: [toolUse({ value: [1, 2, 3] })] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    const raw = await transport.send({
      ...REQUEST,
      jsonSchema: { type: 'array', items: { type: 'integer' } },
    });

    expect(raw.structured).toEqual([1, 2, 3]);
    expect(recorder.calls[0]?.tools?.[0]).toMatchObject({
      input_schema: { type: 'object', required: ['value'] },
    });
  });

  it('raises a typed refusal instead of returning empty content', async () => {
    const recorder = clientReturning(message({ stop_reason: 'refusal', content: [] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    await expect(transport.send(REQUEST)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('explains a truncated response', async () => {
    const recorder = clientReturning(message({ stop_reason: 'max_tokens', content: [] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    await expect(transport.send(REQUEST)).rejects.toThrow(/max_tokens/);
  });

  it('fails when the model answered without calling the tool', async () => {
    const recorder = clientReturning(
      message({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Sure, here is a card.', citations: null }],
      }),
    );
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    const error = await transport.send(REQUEST).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LlmTransportError);
    expect((error as LlmTransportError).output).toContain('Sure, here is a card.');
  });

  it('refuses temperature on models that reject it', async () => {
    const recorder = clientReturning(message({ content: [toolUse({ name: 'X', power: 1 })] }));
    const transport = createAnthropicApiTransport({ client: recorder.client, env: {} });

    await expect(transport.send({ ...REQUEST, temperature: 0.7 })).rejects.toBeInstanceOf(LlmConfigError);
  });

  it('passes temperature through on models that accept it', async () => {
    const recorder = clientReturning(
      message({ model: 'claude-sonnet-5', content: [toolUse({ name: 'X', power: 1 })] }),
    );
    const transport = createAnthropicApiTransport({
      client: recorder.client,
      model: 'claude-sonnet-5',
      env: {},
    });

    await transport.send({ ...REQUEST, temperature: 0.7 });
    expect(recorder.calls[0]?.temperature).toBe(0.7);
  });

  it('requires an API key when no client is injected', () => {
    expect(() => createAnthropicApiTransport({ env: {} })).toThrow(LlmConfigError);
    expect(() => createAnthropicApiTransport({ env: { ANTHROPIC_API_KEY: '  ' } })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});
