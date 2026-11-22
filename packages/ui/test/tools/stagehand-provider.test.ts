/**
 * The Stagehand path resolves its `observe()` provider before Chrome launches,
 * and refuses there when the provider `@mtg/llm` would pick cannot run. Every
 * case injects the binary check and a hand-built environment, so nothing looks
 * at this machine's PATH or keys.
 */
import { describe, expect, it } from 'vitest';
import { resolveStagehandProvider, StagehandProviderUnavailableError } from '../../tools/stagehand-provider';

describe('resolveStagehandProvider', () => {
  it('refuses a claude-cli choice when the binary is absent, naming it', () => {
    expect(() =>
      resolveStagehandProvider({
        env: { MTG_LLM_PROVIDER: 'claude-cli' },
        maxUsd: 1,
        hasClaudeBinary: () => false,
      }),
    ).toThrow(/`claude` binary was not found/);
  });

  it('refuses when nothing is available at all', () => {
    expect(() => resolveStagehandProvider({ env: {}, maxUsd: 1, hasClaudeBinary: () => false })).toThrow(
      StagehandProviderUnavailableError,
    );
  });

  it('refuses an anthropic-api choice with no key, naming the variable', () => {
    expect(() =>
      resolveStagehandProvider({
        env: { MTG_LLM_PROVIDER: 'anthropic-api' },
        maxUsd: 1,
        hasClaudeBinary: () => true,
      }),
    ).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it('defaults to claude-cli when the binary is present', () => {
    const provider = resolveStagehandProvider({ env: {}, maxUsd: 2, hasClaudeBinary: () => true });
    expect(provider.llm.name).toBe('claude-cli');
  });

  it('builds the provider on a guard whose ceiling is --max-usd', () => {
    const provider = resolveStagehandProvider({
      env: { MTG_LLM_PROVIDER: 'fixture' },
      maxUsd: 0.75,
      hasClaudeBinary: () => false,
    });
    expect(provider.budget.snapshot().limits.maxUsd).toBe(0.75);
    expect(provider.budget.snapshot().calls).toBe(0);
  });
});
