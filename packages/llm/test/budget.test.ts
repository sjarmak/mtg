/**
 * The per-run spend ceiling: a run that reaches its limit refuses the next call
 * with a typed error rather than quietly continuing to spend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBudgetGuard, unlimitedBudget } from '../src/budget';
import { LlmBudgetExceededError, LlmConfigError } from '../src/errors';
import type { CompletionRequest } from '../src/types';
import { totalTokens, ZERO_USAGE } from '../src/types';
import { makeTempDir, recordingProvider, removeTempDir } from './helpers';

const Schema = z.object({ ok: z.literal(true) });
const REQUEST: CompletionRequest<z.infer<typeof Schema>> = {
  system: 'system',
  prompt: 'prompt',
  schema: Schema,
};

const USAGE = { ...ZERO_USAGE, inputTokens: 100, outputTokens: 50 };

function captureError(run: () => void): unknown {
  try {
    run();
    return null;
  } catch (error: unknown) {
    return error;
  }
}

let dir = '';

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  removeTempDir(dir);
});

describe('createBudgetGuard', () => {
  it('accounts for spend without limits', () => {
    const guard = unlimitedBudget();
    guard.record({ costUsd: 0.5, usage: USAGE });
    guard.record({ costUsd: 0.25, usage: USAGE });

    const snapshot = guard.snapshot();
    expect(snapshot.spentUsd).toBeCloseTo(0.75, 10);
    expect(snapshot.calls).toBe(2);
    expect(snapshot.tokens).toBe(300);
    expect(() => guard.assertAvailable()).not.toThrow();
  });

  it('refuses the next call once the USD ceiling is reached', () => {
    const guard = createBudgetGuard({ maxUsd: 1 });
    guard.record({ costUsd: 1.5, usage: USAGE });

    const error = captureError(() => guard.assertAvailable());
    expect(error).toBeInstanceOf(LlmBudgetExceededError);
    const budgetError = error as LlmBudgetExceededError;
    expect(budgetError.limit).toBe('usd');
    expect(budgetError.max).toBe(1);
    expect(budgetError.spent).toBeCloseTo(1.5, 10);
  });

  it('enforces token and call ceilings', () => {
    const tokens = createBudgetGuard({ maxTokens: 150 });
    expect(() => tokens.assertAvailable()).not.toThrow();
    tokens.record({ costUsd: 0, usage: USAGE });
    expect(totalTokens(tokens.snapshot().usage)).toBe(150);
    expect(() => tokens.assertAvailable()).toThrow(LlmBudgetExceededError);

    const calls = createBudgetGuard({ maxCalls: 1 });
    calls.record({ costUsd: 0, usage: ZERO_USAGE });
    expect(() => calls.assertAvailable()).toThrow(LlmBudgetExceededError);
  });

  it('rejects nonsensical limits and costs', () => {
    expect(() => createBudgetGuard({ maxUsd: 0 })).toThrow(LlmConfigError);
    expect(() => createBudgetGuard({ maxCalls: -1 })).toThrow(LlmConfigError);
    expect(() => createBudgetGuard({ maxTokens: Number.NaN })).toThrow(LlmConfigError);
    expect(() => unlimitedBudget().record({ costUsd: Number.NaN, usage: ZERO_USAGE })).toThrow(
      LlmConfigError,
    );
  });
});

describe('budget enforcement inside complete', () => {
  it('stops a retry loop that would exceed the call ceiling', async () => {
    const budget = createBudgetGuard({ maxCalls: 2 });
    const { provider, transport } = recordingProvider(
      dir,
      [{ text: '{}' }, { text: '{}' }, { text: '{"ok":true}' }],
      { budget },
    );

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(transport.requests).toHaveLength(2);
    expect(budget.snapshot().calls).toBe(2);
  });

  it('refuses a call when the USD ceiling is already spent', async () => {
    const budget = createBudgetGuard({ maxUsd: 0.03 });
    const { provider, transport } = recordingProvider(
      dir,
      [{ text: '{}', costUsd: 0.02 }, { text: '{}', costUsd: 0.02 }, { text: '{"ok":true}' }],
      { budget },
    );

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(transport.requests).toHaveLength(2);
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.04, 10);
  });

  it('lets a run finish when it stays inside the ceiling', async () => {
    const budget = createBudgetGuard({ maxUsd: 1, maxCalls: 5 });
    const { provider } = recordingProvider(dir, [{ text: '{"ok":true}', costUsd: 0.01 }], {
      budget,
    });

    const result = await provider.complete(REQUEST);
    expect(result.value).toEqual({ ok: true });
    expect(budget.snapshot().calls).toBe(1);
  });
});
