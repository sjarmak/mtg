/**
 * The `anthropic-api` provider: the official SDK against the Messages API.
 *
 * Structured output comes from tool-use forcing — the caller's JSON Schema
 * becomes a single tool's `input_schema` and `tool_choice` pins the model to it,
 * so the model returns a parsed object rather than prose we have to fish JSON
 * out of. The API key is read from the environment and validated at
 * construction; it is never defaulted, never logged, and never hardcoded.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BudgetGuard } from '../budget';
import { createProvider } from '../core';
import { LlmConfigError, LlmRefusalError, LlmTransportError } from '../errors';
import { reconcileCost } from '../reconcile';
import { asObjectSchema, WRAPPER_PROPERTY } from '../schema';
import type { LlmProvider, LlmTransport, RawRequest, RawResponse, TokenUsage } from '../types';
import { estimateCostUsd } from './pricing';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-fable-5';
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';
export const ANTHROPIC_MODEL_ENV = 'MTG_LLM_MODEL';
export const DEFAULT_API_TIMEOUT_MS = 600_000;
export const RESULT_TOOL_NAME = 'emit_result';

/**
 * Models that reject `temperature` outright (a 400, not a silent ignore).
 * Passing one anyway would fail mid-run, so the request is refused up front.
 */
const MODELS_REJECTING_TEMPERATURE: readonly string[] = ['claude-fable-5', 'claude-mythos-5'];

/** The single method this provider uses; narrow so tests can supply a double. */
export interface AnthropicMessagesClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface AnthropicApiOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseURL?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injected client, used by tests. Skips API-key validation when supplied. */
  readonly client?: AnthropicMessagesClient;
}

export interface AnthropicApiProviderOptions extends AnthropicApiOptions {
  readonly budget?: BudgetGuard;
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
}

export function createAnthropicApiTransport(options: AnthropicApiOptions = {}): LlmTransport {
  const env = options.env ?? process.env;
  const model = options.model ?? env[ANTHROPIC_MODEL_ENV] ?? DEFAULT_ANTHROPIC_MODEL;
  const client = options.client ?? createSdkClient(options, env);

  return {
    name: 'anthropic-api',
    model,
    async send(request: RawRequest): Promise<RawResponse> {
      const envelope = asObjectSchema(request.jsonSchema);
      if (request.temperature !== undefined && MODELS_REJECTING_TEMPERATURE.includes(model)) {
        throw new LlmConfigError(
          `model ${model} rejects the \`temperature\` parameter; omit it or pick another model`,
        );
      }

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        tools: [
          {
            name: RESULT_TOOL_NAME,
            description:
              'Return the final result. Call this exactly once; every field must satisfy the schema.',
            input_schema: { ...envelope.schema, type: 'object' },
          },
        ],
        tool_choice: { type: 'tool', name: RESULT_TOOL_NAME, disable_parallel_tool_use: true },
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      };

      const message = await callApi(client, params);
      return toRawResponse(message, model, envelope.wrapped);
    },
  };
}

export function createAnthropicApiProvider(options: AnthropicApiProviderOptions = {}): LlmProvider {
  return createProvider(createAnthropicApiTransport(options), {
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }),
  });
}

function createSdkClient(
  options: AnthropicApiOptions,
  env: Readonly<Record<string, string | undefined>>,
): AnthropicMessagesClient {
  const apiKey = options.apiKey ?? env[ANTHROPIC_API_KEY_ENV];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new LlmConfigError(
      `the anthropic-api provider needs ${ANTHROPIC_API_KEY_ENV}. Export it in the shell, or use ` +
        'the claude-cli provider, which reuses the local `claude` login instead of a key.',
    );
  }
  const sdk = new Anthropic({
    apiKey,
    timeout: options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });
  // Wrap rather than pass `sdk.messages` directly: `create` is overloaded, and the
  // narrow non-streaming signature is the only one this transport ever uses.
  return { create: (params) => sdk.messages.create(params) };
}

async function callApi(
  client: AnthropicMessagesClient,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    return await client.create(params);
  } catch (error: unknown) {
    const status = error instanceof Anthropic.APIError ? (error.status ?? null) : null;
    throw new LlmTransportError('anthropic-api', error instanceof Error ? error.message : String(error), {
      cause: error,
      httpStatus: status,
    });
  }
}

/** Map a Messages response onto a raw response, unwrapping the forced tool call. */
export function toRawResponse(
  message: Anthropic.Message,
  fallbackModel: string,
  wrapped: boolean,
): RawResponse {
  if (message.stop_reason === 'refusal') {
    throw new LlmRefusalError('anthropic-api', message.model || fallbackModel, null);
  }

  const usage = toTokenUsage(message.usage);
  const model = message.model || fallbackModel;
  const estimate = estimateCostUsd(model, usage);

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === RESULT_TOOL_NAME,
  );

  if (toolUse === undefined) {
    if (message.stop_reason === 'max_tokens') {
      throw new LlmTransportError(
        'anthropic-api',
        `response hit max_tokens (${message.usage.output_tokens}) before completing the ` +
          `${RESULT_TOOL_NAME} call; raise maxTokens`,
        { output: textOf(message) },
      );
    }
    throw new LlmTransportError(
      'anthropic-api',
      `response contained no ${RESULT_TOOL_NAME} tool call (stop_reason ${String(message.stop_reason)})`,
      { output: textOf(message) },
    );
  }

  const structured = wrapped ? unwrap(toolUse.input) : toolUse.input;
  return {
    text: JSON.stringify(structured),
    structured,
    usage,
    costUsd: estimate.costUsd,
    costSource: estimate.source,
    // This API sends token counts and no dollars, so the price table is the only
    // account there is and `unchecked` is the honest verdict. It stays a check
    // rather than an omission so a report can distinguish "nothing to compare"
    // from "compared and agreed".
    costCheck: reconcileCost({ model, usage, usageMeasured: true, reportedUsd: null }),
    model,
  };
}

function unwrap(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  return (input as Record<string, unknown>)[WRAPPER_PROPERTY];
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function toTokenUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}
