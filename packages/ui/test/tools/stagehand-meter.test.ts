/**
 * `StagehandMeter` over `@mtg/llm`'s `BudgetGuard`: the guard owns the ceiling
 * and the totals, and the meter adds the per-step log and remembers a refusal.
 * The price table is down to the one call that still needs it, Jev's.
 * No network, no Stagehand import.
 */
import { describe, expect, it } from 'vitest';
import { createBudgetGuard, LlmBudgetExceededError, ZERO_USAGE } from '@mtg/llm';
import { StagehandMeter } from '../../tools/stagehand-meter';
import { priceOf, UnpricedModelError } from '../../tools/stagehand-price-table';

function spend(
  meter: StagehandMeter,
  costUsd: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  return meter.track('some-model', () => {
    meter.budget.assertAvailable();
    meter.budget.record({ costUsd, usage: { ...ZERO_USAGE, inputTokens, outputTokens } });
    return Promise.resolve();
  });
}

describe('StagehandMeter', () => {
  it('logs every call under the step that was current when it ran', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 10 }));
    meter.setStep('step-a');
    await spend(meter, 0.5, 100, 10);
    meter.setStep('step-b');
    await spend(meter, 0.25, 50, 5);

    expect(meter.callLog()).toEqual([
      {
        step: 'step-a',
        modelId: 'some-model',
        inputTokens: 100,
        outputTokens: 10,
        usd: 0.5,
        rawText: null,
        elementCount: null,
      },
      {
        step: 'step-b',
        modelId: 'some-model',
        inputTokens: 50,
        outputTokens: 5,
        usd: 0.25,
        rawText: null,
        elementCount: null,
      },
    ]);
    expect(meter.snapshot()).toMatchObject({ spentUsd: 0.75, calls: 2, unreconciledCalls: 0 });
  });

  it('logs the raw text and element count a diagnosticsOf callback reads off the result', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 10 }));
    meter.setStep('printed-gallery-face-toggle');

    await meter.track(
      'some-model',
      () => {
        meter.budget.assertAvailable();
        meter.budget.record({ costUsd: 0.1, usage: { ...ZERO_USAGE, inputTokens: 20, outputTokens: 8 } });
        return Promise.resolve({ elements: ['a', 'b'] });
      },
      (result) => ({ rawText: JSON.stringify(result), elementCount: result.elements.length }),
    );

    expect(meter.callLog()).toEqual([
      {
        step: 'printed-gallery-face-toggle',
        modelId: 'some-model',
        inputTokens: 20,
        outputTokens: 8,
        usd: 0.1,
        rawText: '{"elements":["a","b"]}',
        elementCount: 2,
      },
    ]);
  });

  it('logs no diagnostics for a call that throws, even though it spent', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 10 }));
    await expect(
      meter.track(
        'some-model',
        () => {
          meter.budget.assertAvailable();
          meter.budget.record({ costUsd: 0.1, usage: { ...ZERO_USAGE, inputTokens: 5, outputTokens: 1 } });
          return Promise.reject(new Error('schema validation failed'));
        },
        () => ({ rawText: 'unreachable', elementCount: 0 }),
      ),
    ).rejects.toThrow('schema validation failed');

    expect(meter.callLog()).toEqual([
      {
        step: null,
        modelId: 'some-model',
        inputTokens: 5,
        outputTokens: 1,
        usd: 0.1,
        rawText: null,
        elementCount: null,
      },
    ]);
  });

  it('logs nothing for a call the guard refused before it was made', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 0.1 }));
    await spend(meter, 0.2, 1, 1);
    await expect(spend(meter, 0.2, 1, 1)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(meter.callLog()).toHaveLength(1);
    expect(meter.snapshot().calls).toBe(1);
  });

  it('remembers the refusal with the ceiling, the spend and the step', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 0.1 }));
    meter.setStep('printed-gallery-face-toggle');
    await spend(meter, 0.2, 1, 1);
    expect(meter.refusal()).toBeNull();
    meter.setStep('precon-your-deck-select');
    await expect(spend(meter, 0.2, 1, 1)).rejects.toThrow(/budget exhausted/);
    expect(meter.refusal()).toEqual({ maxUsd: 0.1, spentUsd: 0.2, step: 'precon-your-deck-select' });
  });

  it('does not mistake any other failure for a refusal', async () => {
    const meter = new StagehandMeter(createBudgetGuard({ maxUsd: 1 }));
    await expect(meter.track('some-model', () => Promise.reject(new Error('page gone')))).rejects.toThrow(
      'page gone',
    );
    expect(meter.refusal()).toBeNull();
  });
});

describe('the price table', () => {
  it("prices Jev's direct model at the published input rate, output free", () => {
    const price = priceOf('jev-latest');
    expect(price.inputUsdPerToken).toBeCloseTo(0.042 / 1_000_000, 15);
    expect(price.outputUsdPerToken).toBe(0);
  });

  it('carries no entry for a model the armed path no longer prices by hand', () => {
    expect(() => priceOf('anthropic/claude-sonnet-5')).toThrow(UnpricedModelError);
    expect(() => priceOf('typesafe-ai/jev')).toThrow(UnpricedModelError);
  });
});
