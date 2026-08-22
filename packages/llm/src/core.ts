/**
 * The policy layer every provider shares: prompt contract, bounded retry with
 * validation errors fed back, budget enforcement, cost/token accounting.
 *
 * Transports stay dumb (one call in, one raw response out); everything a
 * feature package can rely on lives here, so all three providers behave
 * identically apart from where the bytes come from.
 */
import type { BudgetGuard } from './budget';
import { unlimitedBudget } from './budget';
import { LlmConfigError, LlmSchemaValidationError } from './errors';
import { extractJsonValue } from './json';
import { buildAttemptPrompt } from './prompt';
import { formatIssues, toJsonSchema } from './schema';
import type {
  AttemptRecord,
  CompletionRequest,
  CompletionResult,
  CostCheck,
  CostSource,
  LlmProvider,
  LlmTransport,
  RawRequest,
  TokenUsage,
} from './types';
import { addUsage, completionSpend, costCheckOf, worstAgreement, worstCostSource, ZERO_USAGE } from './types';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_TOKENS = 4096;

export interface ProviderCoreOptions {
  readonly budget?: BudgetGuard;
  /** Total attempts, including the first. Must be >= 1. */
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
}

export function createProvider(transport: LlmTransport, options: ProviderCoreOptions = {}): LlmProvider {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new LlmConfigError(`maxAttempts must be an integer >= 1, got ${maxAttempts}`);
  }
  if (!Number.isInteger(defaultMaxTokens) || defaultMaxTokens < 1) {
    throw new LlmConfigError(`defaultMaxTokens must be an integer >= 1, got ${defaultMaxTokens}`);
  }
  const budget = options.budget ?? unlimitedBudget();

  return {
    name: transport.name,
    model: transport.model,
    budget,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      return runCompletion(transport, budget, maxAttempts, defaultMaxTokens, request);
    },
  };
}

async function runCompletion<T>(
  transport: LlmTransport,
  budget: BudgetGuard,
  maxAttempts: number,
  defaultMaxTokens: number,
  request: CompletionRequest<T>,
): Promise<CompletionResult<T>> {
  const startedAt = Date.now();
  const jsonSchema = toJsonSchema(request.schema);
  const maxTokens = request.maxTokens ?? defaultMaxTokens;
  const failures: AttemptRecord[] = [];

  let usage: TokenUsage = ZERO_USAGE;
  let costUsd = 0;
  const costSources: CostSource[] = [];
  const costChecks: CostCheck[] = [];
  let model = transport.model;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rawRequest: RawRequest = {
      system: request.system,
      prompt: buildAttemptPrompt({ prompt: request.prompt, jsonSchema, previous: failures }),
      jsonSchema,
      maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };

    budget.assertAvailable();
    const raw = await transport.send(rawRequest);
    budget.record({ costUsd: raw.costUsd, usage: raw.usage, costCheck: costCheckOf(raw) });

    usage = addUsage(usage, raw.usage);
    costUsd += raw.costUsd;
    costSources.push(raw.costSource);
    costChecks.push(costCheckOf(raw));
    model = raw.model;

    const candidate =
      raw.structured === undefined
        ? extractJsonValue(raw.text)
        : ({ ok: true, value: raw.structured } as const);

    if (!candidate.ok) {
      failures.push({ attempt, rawText: raw.text, issues: [candidate.reason] });
      continue;
    }

    const parsed = request.schema.safeParse(candidate.value);
    if (parsed.success) {
      return {
        value: parsed.data,
        raw: raw.text,
        meta: {
          provider: transport.name,
          model,
          usage,
          costUsd,
          costSource: worstCostSource(costSources),
          costAgreement: worstAgreement(costChecks),
          costChecks: [...costChecks],
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        },
      };
    }
    failures.push({ attempt, rawText: raw.text, issues: formatIssues(parsed.error) });
  }

  // Every attempt was billed as it returned, so the error carries what the
  // completion burned; without it the only account is the provider's budget
  // guard, which cannot say where the figure came from and misattributes when
  // two completions share one provider.
  throw new LlmSchemaValidationError(
    transport.name,
    model,
    failures,
    completionSpend(usage, costUsd, costSources, costChecks),
  );
}
