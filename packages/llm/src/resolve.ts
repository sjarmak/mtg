/**
 * Provider resolution.
 *
 * Order: explicit config wins; else the fixture provider under vitest (tests are
 * hermetic and free by construction, never accidentally live); else claude-cli
 * when the authenticated binary is on PATH; else anthropic-api when a key is
 * exported; else a typed error that names all three ways to proceed.
 *
 * The decision is a pure function of an injected environment so it can be tested
 * without touching the real process or filesystem.
 */
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { BudgetGuard, BudgetLimits } from './budget';
import { createBudgetGuard } from './budget';
import { LlmConfigError, LlmProviderUnavailableError } from './errors';
import type { LlmProvider, LlmTransport, ProviderName } from './types';
import { isProviderName, PROVIDER_NAMES } from './types';
import type { AnthropicApiOptions } from './providers/anthropic-api';
import { ANTHROPIC_API_KEY_ENV, createAnthropicApiTransport } from './providers/anthropic-api';
import type { ClaudeCliOptions } from './providers/claude-cli';
import { CLAUDE_BINARY_ENV, createClaudeCliTransport, DEFAULT_CLAUDE_BINARY } from './providers/claude-cli';
import type { FixtureTransportOptions } from './providers/fixture';
import { createFixtureTransport } from './providers/fixture';
import { createProvider } from './core';

export const PROVIDER_ENV = 'MTG_LLM_PROVIDER';
export const MAX_USD_ENV = 'MTG_LLM_MAX_USD';
export const MAX_CALLS_ENV = 'MTG_LLM_MAX_CALLS';

export type Env = Readonly<Record<string, string | undefined>>;

export interface ResolutionDeps {
  readonly env: Env;
  /** Whether the `claude` binary is executable. Injected so tests stay hermetic. */
  readonly hasClaudeBinary: () => boolean;
}

export interface ProviderResolution {
  readonly name: ProviderName;
  readonly reason: string;
}

/** Decide which provider to use. Pure — no IO beyond the injected probes. */
export function resolveProviderName(deps: ResolutionDeps): ProviderResolution {
  const requested = deps.env[PROVIDER_ENV];
  if (requested !== undefined && requested.trim().length > 0) {
    const trimmed = requested.trim();
    if (!isProviderName(trimmed)) {
      throw new LlmConfigError(
        `${PROVIDER_ENV}=${trimmed} is not a provider. Valid: ${PROVIDER_NAMES.join(', ')}`,
      );
    }
    return { name: trimmed, reason: `${PROVIDER_ENV}=${trimmed}` };
  }

  if (isUnderVitest(deps.env)) {
    return { name: 'fixture', reason: 'running under vitest; only recorded responses are allowed' };
  }
  if (deps.hasClaudeBinary()) {
    return { name: 'claude-cli', reason: 'the authenticated `claude` binary is on PATH' };
  }
  if (hasApiKey(deps.env)) {
    return { name: 'anthropic-api', reason: `${ANTHROPIC_API_KEY_ENV} is set` };
  }
  throw new LlmProviderUnavailableError([
    `${PROVIDER_ENV} unset`,
    'not under vitest',
    '`claude` not found on PATH',
    `${ANTHROPIC_API_KEY_ENV} unset`,
  ]);
}

export interface ResolveProviderConfig {
  /** Force a provider, bypassing environment detection entirely. */
  readonly provider?: ProviderName;
  readonly env?: Env;
  readonly budget?: BudgetGuard;
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
  readonly fixture?: FixtureTransportOptions;
  readonly claudeCli?: ClaudeCliOptions;
  readonly anthropicApi?: AnthropicApiOptions;
  readonly hasClaudeBinary?: () => boolean;
}

/** Build the provider the environment calls for, fully wired. */
export function resolveProvider(config: ResolveProviderConfig = {}): LlmProvider {
  const env = config.env ?? process.env;
  const deps: ResolutionDeps = {
    env,
    hasClaudeBinary: config.hasClaudeBinary ?? (() => claudeBinaryExists(env)),
  };
  const name = config.provider ?? resolveProviderName(deps).name;
  const budget = config.budget ?? createBudgetGuard(budgetLimitsFromEnv(env));

  return createProvider(buildTransport(name, config, env, deps), {
    budget,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: config.defaultMaxTokens }),
  });
}

function buildTransport(
  name: ProviderName,
  config: ResolveProviderConfig,
  env: Env,
  deps: ResolutionDeps,
): LlmTransport {
  switch (name) {
    case 'fixture':
      return createFixtureTransport({
        env,
        // Recording needs a live backend; construct it lazily so replay-only runs
        // never require a key or a binary.
        delegate: () => liveTransport(config, env, deps),
        ...config.fixture,
      });
    case 'claude-cli':
      return createClaudeCliTransport({ env, ...config.claudeCli });
    case 'anthropic-api':
      return createAnthropicApiTransport({ env, ...config.anthropicApi });
  }
}

/** The backend a fixture recording should capture from. */
function liveTransport(config: ResolveProviderConfig, env: Env, deps: ResolutionDeps): LlmTransport {
  if (deps.hasClaudeBinary()) return createClaudeCliTransport({ env, ...config.claudeCli });
  if (hasApiKey(env)) return createAnthropicApiTransport({ env, ...config.anthropicApi });
  throw new LlmProviderUnavailableError(['`claude` not found on PATH', `${ANTHROPIC_API_KEY_ENV} unset`]);
}

export function isUnderVitest(env: Env): boolean {
  return env['VITEST'] === 'true' || env['VITEST_WORKER_ID'] !== undefined;
}

export function hasApiKey(env: Env): boolean {
  const key = env[ANTHROPIC_API_KEY_ENV];
  return key !== undefined && key.trim().length > 0;
}

/** PATH lookup for the `claude` binary, honoring `MTG_LLM_CLAUDE_BINARY`. */
export function claudeBinaryExists(env: Env): boolean {
  const binary = env[CLAUDE_BINARY_ENV] ?? DEFAULT_CLAUDE_BINARY;
  if (binary.includes('/')) return isExecutable(binary);
  const pathVar = env['PATH'];
  if (pathVar === undefined) return false;
  return pathVar.split(delimiter).some((dir) => dir.length > 0 && isExecutable(join(dir, binary)));
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Opt-in run ceilings from the environment, used when no guard is supplied. */
export function budgetLimitsFromEnv(env: Env): BudgetLimits {
  return {
    ...numberFromEnv(env, MAX_USD_ENV, 'maxUsd'),
    ...numberFromEnv(env, MAX_CALLS_ENV, 'maxCalls'),
  };
}

function numberFromEnv(env: Env, key: string, field: 'maxUsd' | 'maxCalls'): BudgetLimits {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) return {};
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new LlmConfigError(`${key}=${raw} is not a positive number`);
  }
  return { [field]: value };
}
