/**
 * Bridges Stagehand's `ClientLLM.generate` seam to an `@mtg/llm` provider,
 * metered on the way. This is the one path every `observe()` model call
 * crosses, which is what lets `StagehandMeter` see all of them
 * (`docs/research/stagehand-jev-seam.md`: the `ClientLLM` seam is real and
 * wired; metering, not Jev, is what belongs on it).
 *
 * It used to post to a hosted gateway's chat-completions endpoint. It now
 * holds no URL and no key at all (`mtg-onjme.2`): the provider decides where
 * the call goes, and its default local provider is the `claude` binary. The
 * provider's `BudgetGuard` is the ceiling, so a call past `--max-usd` is
 * refused before it is made.
 *
 * Stagehand 4.1.0 asks this seam for structured output only. Its `observe()`
 * and `act()` both go through `generateStructured` in the shipped service
 * worker, which sends `responseFormat: { type: 'json_schema' }`, sends no
 * tools, and throws unless the answer comes back as `outputFormat:
 * 'json_schema'` with `structuredContent`. So that is the one shape served
 * here, and a request for free text or for tool calling is refused by name
 * rather than answered in a shape Stagehand would reject a step later.
 */
import type { ClientLLM } from '@browserbasehq/stagehand';
import type { LlmProvider } from '@mtg/llm';
import { z } from 'zod';
import type { StagehandMeter } from './stagehand-meter';

export type GenerateRequest = Parameters<ClientLLM['generate']>[0];
export type GenerateResult = Awaited<ReturnType<ClientLLM['generate']>>;
type MessageContent = GenerateRequest['messages'][number]['content'];
type GenerateStructuredContent = Extract<
  GenerateResult,
  { outputFormat: 'json_schema' }
>['structuredContent'];

/**
 * Stagehand's message content is a single text/image/tool_use/tool_result
 * block, or an array of them (confirmed against `ClientLLMSchema` directly:
 * there is no plain-string variant). A provider takes a prompt string, so only
 * text blocks survive the bridge; the three converted journey steps
 * (`stagehand-runner.ts`) never send an image or a tool block.
 */
export function contentToText(content: MessageContent): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/** A request this bridge will not answer, named so the step's failure says why. */
export class UnsupportedGenerateRequestError extends Error {
  constructor(detail: string) {
    super(`the Stagehand model bridge serves json_schema requests only: ${detail}`);
    this.name = 'UnsupportedGenerateRequestError';
  }
}

export interface MeteredGenerateOptions {
  readonly llm: LlmProvider;
  readonly meter: StagehandMeter;
}

type JsonSchema = Parameters<typeof z.fromJSONSchema>[0];

/** A few KB: enough to read the model's answer, never enough to hold key material. */
const RAW_TEXT_DIAGNOSTIC_LIMIT = 4096;

function truncateForDiagnostics(text: string): string {
  return text.length <= RAW_TEXT_DIAGNOSTIC_LIMIT ? text : `${text.slice(0, RAW_TEXT_DIAGNOSTIC_LIMIT)}…`;
}

/**
 * How many elements the answer named, when it is shaped like Stagehand's
 * `observe()` answer (`{ elements: [...] }`). `null` for any other shape
 * (an `act()` answer has no `elements` field), so the report can tell "this
 * call could not have named elements" from "this call named zero".
 */
function observedElementCount(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const elements = (value as { elements?: unknown }).elements;
  return Array.isArray(elements) ? elements.length : null;
}

/** The answer schema a request states, or a refusal naming what it asked for instead. */
function answerSchemaOf(request: GenerateRequest): JsonSchema {
  if ('tools' in request && request.tools !== undefined && request.tools.length > 0) {
    throw new UnsupportedGenerateRequestError(`it asked for ${String(request.tools.length)} tool(s)`);
  }
  const format = request.responseFormat;
  if (format === undefined || format.type !== 'json_schema') {
    throw new UnsupportedGenerateRequestError('it asked for free text');
  }
  return format.schema as JsonSchema;
}

function promptOf(request: GenerateRequest): string {
  return request.messages.map((message) => contentToText(message.content)).join('\n\n');
}

export function createMeteredGenerate(options: MeteredGenerateOptions): ClientLLM['generate'] {
  return async (request: GenerateRequest): Promise<GenerateResult> => {
    const schema = z.fromJSONSchema(answerSchemaOf(request));
    const result = await options.meter.track(
      options.llm.model,
      () =>
        options.llm.complete({
          system: request.systemPrompt ?? '',
          prompt: promptOf(request),
          schema,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        }),
      (completion) => ({
        rawText: truncateForDiagnostics(completion.raw),
        elementCount: observedElementCount(completion.value),
      }),
    );
    const usage = result.meta.usage;
    const inputTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
    return {
      role: 'assistant',
      content: { type: 'text', text: result.raw },
      outputFormat: 'json_schema',
      structuredContent: result.value as GenerateStructuredContent,
      usage: {
        inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: inputTokens + usage.outputTokens,
        cachedInputTokens: usage.cacheReadInputTokens,
      },
    };
  };
}
