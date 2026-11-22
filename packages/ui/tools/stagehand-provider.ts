/**
 * The `@mtg/llm` provider the Stagehand path's `observe()` calls go through,
 * resolved before Chrome launches (`mtg-onjme.2`).
 *
 * Resolution is `@mtg/llm`'s own: `MTG_LLM_PROVIDER` when set, else the
 * `claude` binary, else `ANTHROPIC_API_KEY`. What this adds is the check
 * `resolveProvider` leaves to the first call, whether the provider it picked
 * can actually run: a `claude-cli` choice with no binary, or an
 * `anthropic-api` choice with no key, would otherwise surface as the first
 * step's failure after the browser is up. Either is a refusal here instead,
 * naming what was looked for.
 *
 * The provider is built on a `BudgetGuard` whose `maxUsd` is `--max-usd`,
 * which is the one ceiling for the run: Jev's calls are recorded against the
 * same guard (`meterJev` in `stagehand-runner.ts`).
 */
import {
  claudeBinaryExists,
  createBudgetGuard,
  hasApiKey,
  LlmError,
  resolveProvider,
  resolveProviderName,
} from '@mtg/llm';
import type { BudgetGuard, Env, LlmProvider } from '@mtg/llm';

export class StagehandProviderUnavailableError extends Error {
  constructor(detail: string) {
    super(`no @mtg/llm provider for the Stagehand path (--max-usd): ${detail}`);
    this.name = 'StagehandProviderUnavailableError';
  }
}

export interface StagehandProvider {
  readonly llm: LlmProvider;
  readonly budget: BudgetGuard;
}

export interface ResolveStagehandProviderOptions {
  readonly env: Env;
  readonly maxUsd: number;
  /** Injected so a test stays hermetic; defaults to a PATH lookup. */
  readonly hasClaudeBinary?: () => boolean;
}

function unrunnable(name: string, env: Env, hasClaudeBinary: () => boolean): string | null {
  if (name === 'claude-cli' && !hasClaudeBinary()) {
    return 'claude-cli was chosen but the `claude` binary was not found on PATH (or at MTG_LLM_CLAUDE_BINARY)';
  }
  if (name === 'anthropic-api' && !hasApiKey(env)) {
    return 'anthropic-api was chosen but ANTHROPIC_API_KEY is not set';
  }
  return null;
}

export function resolveStagehandProvider(options: ResolveStagehandProviderOptions): StagehandProvider {
  const hasClaudeBinary = options.hasClaudeBinary ?? (() => claudeBinaryExists(options.env));
  try {
    const { name } = resolveProviderName({ env: options.env, hasClaudeBinary });
    const problem = unrunnable(name, options.env, hasClaudeBinary);
    if (problem !== null) throw new StagehandProviderUnavailableError(problem);
    const budget = createBudgetGuard({ maxUsd: options.maxUsd });
    const llm = resolveProvider({ provider: name, env: options.env, budget, hasClaudeBinary });
    return { llm, budget };
  } catch (error) {
    if (error instanceof LlmError) throw new StagehandProviderUnavailableError(error.message);
    throw error;
  }
}
