/**
 * `@mtg/llm` — the one seam between this repo and a language model.
 *
 * Feature packages hand in a Zod schema and get a validated, typed value back,
 * with retries, budget enforcement, and cost accounting handled here. Which
 * backend answers (recorded fixture, the local `claude` binary, or the Anthropic
 * API) is a deployment detail resolved from the environment, not something
 * callers branch on.
 *
 * ```ts
 * const llm = resolveProvider({ budget: createBudgetGuard({ maxUsd: 2 }) });
 * const { value, meta } = await llm.complete({
 *   system: 'You design Magic cards.',
 *   prompt: 'Design a red 3-drop.',
 *   schema: CardSchema,
 * });
 * ```
 */

export { createBudgetGuard, unlimitedBudget } from './budget';
export type { BudgetGuard, BudgetLimits, BudgetSnapshot } from './budget';

export { createProvider, DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_TOKENS } from './core';
export type { ProviderCoreOptions } from './core';

export {
  FixtureMissingError,
  isLlmError,
  LLM_ERROR_CODES,
  LlmBudgetExceededError,
  LlmConfigError,
  LlmError,
  LlmProviderUnavailableError,
  LlmRefusalError,
  LlmSchemaValidationError,
  LlmTransportError,
} from './errors';
export type { LlmErrorCode } from './errors';

export { extractJsonValue } from './json';
export type { JsonExtraction } from './json';

export { buildAttemptPrompt } from './prompt';
export type { AttemptPromptInput } from './prompt';

export {
  asObjectSchema,
  FIXTURE_KEY_VERSION,
  fixtureKey,
  formatIssues,
  toJsonSchema,
  WRAPPER_PROPERTY,
} from './schema';
export type { ObjectSchemaEnvelope } from './schema';

export {
  budgetLimitsFromEnv,
  claudeBinaryExists,
  hasApiKey,
  isUnderVitest,
  MAX_CALLS_ENV,
  MAX_USD_ENV,
  PROVIDER_ENV,
  resolveProvider,
  resolveProviderName,
} from './resolve';
export type { Env, ProviderResolution, ResolutionDeps, ResolveProviderConfig } from './resolve';

export {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_MODEL_ENV,
  createAnthropicApiProvider,
  createAnthropicApiTransport,
  DEFAULT_ANTHROPIC_MODEL,
  RESULT_TOOL_NAME,
} from './providers/anthropic-api';
export type {
  AnthropicApiOptions,
  AnthropicApiProviderOptions,
  AnthropicMessagesClient,
} from './providers/anthropic-api';

export {
  CLAUDE_BINARY_ENV,
  CLAUDE_EFFORT_ENV,
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_MODEL_ENV,
  createClaudeCliProvider,
  createClaudeCliTransport,
  DEFAULT_CLAUDE_BINARY,
  DEFAULT_CLAUDE_CLI_EFFORT,
  DEFAULT_CLAUDE_CLI_MODEL,
  DEFAULT_CLI_TIMEOUT_MS,
  envelopeToRawResponse,
  parseClaudeCliEnvelope,
  resolveEffort,
} from './providers/claude-cli';
export type {
  ClaudeCliEnvelope,
  ClaudeCliOptions,
  ClaudeCliProviderOptions,
  ClaudeEffort,
} from './providers/claude-cli';

export {
  buildFixture,
  createFixtureProvider,
  createFixtureTransport,
  DEFAULT_FIXTURE_DIR,
  FIXTURE_DIR_ENV,
  FIXTURE_RECORD_ENV,
  fixturePath,
  keyForRequest,
  readFixture,
  writeFixture,
} from './providers/fixture';
export type { FixtureProviderOptions, FixtureTransportOptions, RecordedFixture } from './providers/fixture';

export {
  listRunManifests,
  manifestId,
  readManifestFixtures,
  readRunManifest,
  runManifestPath,
  writeRunManifest,
} from './providers/fixture-manifest';
export type { RunManifest } from './providers/fixture-manifest';

export {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIERS,
  DEFAULT_CACHE_TTL,
  estimateCostUsd,
  isCacheWriteSplit,
  MODEL_PRICES,
  priceFor,
} from './providers/pricing';
export type { CacheTtl, CacheWriteSplit, CostEstimate, ModelPrice } from './providers/pricing';

export {
  COST_AGREEMENT_TOLERANCE_RATIO,
  COST_AGREEMENT_TOLERANCE_USD,
  describeCostChecks,
  describeUsage,
  reconcileCost,
} from './reconcile';
export type { ReconcileInput } from './reconcile';

export {
  addUsage,
  completionSpend,
  costAgreementOf,
  costCheckOf,
  isProviderName,
  PROVIDER_NAMES,
  totalTokens,
  UNCHECKED_COST,
  UNKNOWN_SPEND,
  worstAgreement,
  worstCostSource,
  ZERO_USAGE,
} from './types';
export type {
  AttemptRecord,
  CompletionMeta,
  CompletionRequest,
  CompletionResult,
  CompletionSpend,
  CostAgreement,
  CostCheck,
  CostSource,
  JsonSchema,
  LlmProvider,
  LlmTransport,
  ProviderName,
  RawRequest,
  RawResponse,
  TokenUsage,
} from './types';
