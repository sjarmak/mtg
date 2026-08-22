/**
 * Hand-written providers for the referee tests.
 *
 * Tests never reach a model: `fixture` is the only provider CI may use, and a
 * scripted stub is how a test states "the model answered *this*" without
 * recording a fixture per case. Candidate answers are pushed through the
 * caller's real schema, so a scripted answer the schema would reject fails the
 * same way a live one does.
 *
 * Both stubs bill the way `@mtg/llm` bills: the guard is checked before a call
 * and recorded into once the call comes back, whether or not what came back is
 * usable. A double that skipped the recording would make the referee's metering
 * look right in a test and wrong in a run.
 */
import {
  createProvider,
  formatIssues,
  LlmSchemaValidationError,
  unlimitedBudget,
  ZERO_USAGE,
} from '@mtg/llm';
import type {
  BudgetGuard,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  LlmTransport,
  RawResponse,
} from '@mtg/llm';

const MODEL = 'stub-referee-model';
const USAGE = { ...ZERO_USAGE, inputTokens: 900, outputTokens: 40 };

/** One scripted answer: a value the schema will see, or a failure to raise. */
export type ScriptedAnswer = { readonly value: unknown } | { readonly error: Error };

export interface StubProviderOptions {
  readonly answers: readonly ScriptedAnswer[];
  /** Keep answering with the last scripted answer instead of running out. */
  readonly repeat?: boolean;
  /** The ceiling this provider bills against. Unlimited when not given. */
  readonly budget?: BudgetGuard;
  readonly costUsd?: number;
}

export interface StubProvider extends LlmProvider {
  /** Every request the referee made, in order. */
  readonly requests: readonly CompletionRequest<unknown>[];
}

export function stubProvider(options: StubProviderOptions): StubProvider {
  const queue = [...options.answers];
  const requests: CompletionRequest<unknown>[] = [];
  const budget = options.budget ?? unlimitedBudget();
  const costUsd = options.costUsd ?? 0.0021;

  return {
    name: 'fixture',
    model: MODEL,
    budget,
    requests,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      budget.assertAvailable();
      requests.push(request as CompletionRequest<unknown>);
      const scripted = queue.length === 1 && options.repeat === true ? queue[0] : queue.shift();
      if (scripted === undefined) throw new Error('stubProvider: the script ran out of answers');
      // A transport that dies never answers, so nothing is billed for it.
      if ('error' in scripted) throw scripted.error;
      budget.record({ costUsd, usage: USAGE });

      const parsed = request.schema.safeParse(scripted.value);
      if (!parsed.success) {
        throw new LlmSchemaValidationError('fixture', MODEL, [
          { attempt: 1, rawText: JSON.stringify(scripted.value), issues: formatIssues(parsed.error) },
        ]);
      }
      return Promise.resolve({
        value: parsed.data,
        raw: JSON.stringify(scripted.value),
        meta: {
          provider: 'fixture',
          model: MODEL,
          usage: USAGE,
          costUsd,
          costSource: 'estimated',
          attempts: 1,
          durationMs: 3,
        },
      });
    },
  };
}

export interface OffSchemaProviderOptions {
  /** The ceiling every attempt is billed against. */
  readonly budget: BudgetGuard;
  /** What one attempt costs; the real provider makes several per completion. */
  readonly costUsd: number;
}

/**
 * A real provider over a transport that answers, is billed, and is off schema.
 *
 * This is the failure the referee's metering has to survive: `@mtg/llm` records
 * each attempt as it returns and raises `LlmSchemaValidationError` only once
 * they are exhausted, so the most expensive ruling is the one with no
 * `CompletionMeta` to report. Going through `createProvider` rather than faking
 * the error is the point — the retry loop, the per-attempt billing and the
 * error are the shipped ones.
 */
export function offSchemaProvider(options: OffSchemaProviderOptions): LlmProvider {
  const transport: LlmTransport = {
    name: 'fixture',
    model: MODEL,
    send(): Promise<RawResponse> {
      return Promise.resolve({
        text: 'I would block the golem with the guardian.',
        usage: USAGE,
        costUsd: options.costUsd,
        costSource: 'estimated',
        model: MODEL,
      });
    },
  };
  return createProvider(transport, { budget: options.budget });
}

/** A clock that advances a fixed amount per read, so latency is assertable. */
export function steppingClock(stepMs: number): () => number {
  let now = 1_000;
  return () => {
    const value = now;
    now += stepMs;
    return value;
  };
}
