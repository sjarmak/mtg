/**
 * Provider resolution: explicit config wins, tests are pinned to fixtures, and
 * an environment with nothing usable fails with a message naming every option.
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmConfigError, LlmProviderUnavailableError } from '../src/errors';
import {
  budgetLimitsFromEnv,
  claudeBinaryExists,
  hasApiKey,
  isUnderVitest,
  resolveProvider,
  resolveProviderName,
} from '../src/resolve';
import type { Env, ResolutionDeps } from '../src/resolve';
import { makeTempDir, removeTempDir } from './helpers';

function deps(env: Env, hasBinary: boolean): ResolutionDeps {
  return { env, hasClaudeBinary: () => hasBinary };
}

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

describe('resolveProviderName', () => {
  it('honors an explicit provider over every fallback', () => {
    const env = { MTG_LLM_PROVIDER: 'anthropic-api', VITEST: 'true', ANTHROPIC_API_KEY: 'k' };
    const resolution = resolveProviderName(deps(env, true));

    expect(resolution.name).toBe('anthropic-api');
    expect(resolution.reason).toContain('MTG_LLM_PROVIDER');
  });

  it('rejects an unknown provider name', () => {
    expect(() => resolveProviderName(deps({ MTG_LLM_PROVIDER: 'openai' }, true))).toThrow(LlmConfigError);
    expect(() => resolveProviderName(deps({ MTG_LLM_PROVIDER: 'openai' }, true))).toThrow(
      /fixture, claude-cli, anthropic-api/,
    );
  });

  it('pins test runs to the fixture provider', () => {
    expect(resolveProviderName(deps({ VITEST: 'true' }, true)).name).toBe('fixture');
    expect(resolveProviderName(deps({ VITEST_WORKER_ID: '2' }, true)).name).toBe('fixture');
  });

  it('prefers the local claude binary outside tests', () => {
    const resolution = resolveProviderName(deps({ ANTHROPIC_API_KEY: 'k' }, true));
    expect(resolution.name).toBe('claude-cli');
    expect(resolution.reason).toContain('PATH');
  });

  it('falls back to the API when only a key is available', () => {
    expect(resolveProviderName(deps({ ANTHROPIC_API_KEY: 'k' }, false)).name).toBe('anthropic-api');
  });

  it('names all three options when nothing is available', () => {
    let caught: unknown = null;
    try {
      resolveProviderName(deps({}, false));
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LlmProviderUnavailableError);
    const message = (caught as LlmProviderUnavailableError).message;
    expect(message).toContain('fixture');
    expect(message).toContain('claude-cli');
    expect(message).toContain('anthropic-api');
    expect(message).toContain('ANTHROPIC_API_KEY');
  });
});

describe('environment probes', () => {
  it('detects a vitest run', () => {
    expect(isUnderVitest({ VITEST: 'true' })).toBe(true);
    expect(isUnderVitest({})).toBe(false);
  });

  it('treats a blank API key as absent', () => {
    expect(hasApiKey({ ANTHROPIC_API_KEY: 'sk-ant-xxx' })).toBe(true);
    expect(hasApiKey({ ANTHROPIC_API_KEY: '   ' })).toBe(false);
    expect(hasApiKey({})).toBe(false);
  });

  it('finds an executable on PATH and ignores a non-executable one', () => {
    const executable = join(dir, 'claude');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(executable, 0o755);
    expect(claudeBinaryExists({ PATH: dir })).toBe(true);

    const plain = join(dir, 'plain');
    writeFileSync(plain, 'not executable\n', 'utf8');
    chmodSync(plain, 0o644);
    expect(claudeBinaryExists({ PATH: dir, MTG_LLM_CLAUDE_BINARY: 'plain' })).toBe(false);

    expect(claudeBinaryExists({ PATH: dir, MTG_LLM_CLAUDE_BINARY: executable })).toBe(true);
    expect(claudeBinaryExists({})).toBe(false);
  });

  it('reads opt-in ceilings from the environment', () => {
    expect(budgetLimitsFromEnv({})).toEqual({});
    expect(budgetLimitsFromEnv({ MTG_LLM_MAX_USD: '2.5', MTG_LLM_MAX_CALLS: '10' })).toEqual({
      maxUsd: 2.5,
      maxCalls: 10,
    });
    expect(() => budgetLimitsFromEnv({ MTG_LLM_MAX_USD: 'lots' })).toThrow(LlmConfigError);
    expect(() => budgetLimitsFromEnv({ MTG_LLM_MAX_CALLS: '-1' })).toThrow(LlmConfigError);
  });
});

describe('resolveProvider', () => {
  it('builds a fixture provider without touching a live backend', () => {
    const provider = resolveProvider({
      env: { VITEST: 'true' },
      fixture: { dir, record: false },
      hasClaudeBinary: () => false,
    });

    expect(provider.name).toBe('fixture');
    expect(provider.budget.snapshot().calls).toBe(0);
  });

  it('applies environment ceilings when no guard is supplied', () => {
    const provider = resolveProvider({
      env: { VITEST: 'true', MTG_LLM_MAX_USD: '0.5' },
      fixture: { dir, record: false },
      hasClaudeBinary: () => false,
    });

    expect(provider.budget.snapshot().limits.maxUsd).toBe(0.5);
  });

  it('refuses to build the API provider without a key', () => {
    expect(() =>
      resolveProvider({
        provider: 'anthropic-api',
        env: {},
        hasClaudeBinary: () => false,
      }),
    ).toThrow(LlmConfigError);
    expect(() =>
      resolveProvider({ provider: 'anthropic-api', env: {}, hasClaudeBinary: () => false }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});
