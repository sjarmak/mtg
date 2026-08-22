/**
 * The two accounts of one call's dollars, and what happens when they disagree.
 *
 * The premise this file rests on is measured rather than assumed: the local
 * price table, applied to the usage a `claude-cli` envelope carried, reproduces
 * that envelope's own `total_cost_usd` to the cent. Both recorded envelopes in
 * `fixtures/claude-cli/` do it, which is what makes a *dis*agreement evidence
 * of something rather than of rounding.
 *
 * The two failures pinned below are both real shapes seen in recorded output:
 * dollars beside an absent usage block, and dollars an order of magnitude
 * larger than the usage beside them is worth. Each was summed into a published
 * total that read as settled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBudgetGuard } from '../src/budget';
import { envelopeToRawResponse, parseClaudeCliEnvelope } from '../src/providers/claude-cli';
import type { ClaudeCliEnvelope } from '../src/providers/claude-cli';
import { estimateCostUsd } from '../src/providers/pricing';
import { describeUsage, reconcileCost } from '../src/reconcile';
import { costCheckOf, worstAgreement, ZERO_USAGE } from '../src/types';
import type { CostCheck, TokenUsage } from '../src/types';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/claude-cli/', import.meta.url));

function envelope(name: string): ClaudeCliEnvelope {
  return parseClaudeCliEnvelope(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** A usage record whose cache writes were made at the one-hour TTL. */
const HOUR_CACHED: TokenUsage = {
  inputTokens: 10,
  outputTokens: 500,
  cacheCreationInputTokens: 20_000,
  cacheReadInputTokens: 40_000,
};

function check(overrides: Partial<Parameters<typeof reconcileCost>[0]> = {}): CostCheck {
  return reconcileCost({
    model: 'claude-fable-5',
    usage: HOUR_CACHED,
    usageMeasured: true,
    reportedUsd: null,
    ...overrides,
  });
}

describe('the price table reproduces what the CLI says it charged', () => {
  it.each(['success-plain', 'success-structured'])('corroborates %s', (name) => {
    const raw = envelopeToRawResponse(envelope(name), 'fallback');
    const result = costCheckOf(raw);

    expect(result.agreement).toBe('corroborated');
    expect(result.reportedUsd).not.toBeNull();
    expect(result.pricedUsd).toBeCloseTo(result.reportedUsd ?? 0, 9);
  });

  it('reads the cache-write TTL off the envelope rather than assuming the default', () => {
    // Both recorded envelopes wrote their cache at the one-hour TTL, which bills
    // at 2x the base input rate against the 5-minute default's 1.25x. Pricing
    // them at the default is what understated a whole run by 30%.
    const source = envelope('success-plain');
    expect(source.usage?.cache_creation?.ephemeral_1h_input_tokens).toBeGreaterThan(0);
    expect(source.usage?.cache_creation?.ephemeral_5m_input_tokens).toBe(0);

    const raw = envelopeToRawResponse(source, 'fallback');
    const atDefault = estimateCostUsd(raw.model, raw.usage);

    expect(costCheckOf(raw).agreement).toBe('corroborated');
    expect(atDefault.costUsd).toBeLessThan(raw.costUsd);
  });
});

describe('a bill nothing measured', () => {
  it('contradicts dollars reported against an absent usage block', () => {
    // The envelope's `total_cost_usd` and `usage` are independently optional,
    // and this is what one without the second used to record as: real spend,
    // four zero token counts, and nothing saying the two disagreed.
    const source: ClaudeCliEnvelope = {
      is_error: false,
      result: '{"ok":true}',
      total_cost_usd: 0.65903,
    };
    const raw = envelopeToRawResponse(source, 'claude-fable-5');
    const result = costCheckOf(raw);

    expect(raw.costUsd).toBeCloseTo(0.65903, 10);
    expect(raw.costSource).toBe('reported');
    expect(raw.usage).toEqual(ZERO_USAGE);
    expect(result.usageMeasured).toBe(false);
    expect(result.agreement).toBe('contradicted');
    expect(result.reportedUsd).toBeCloseTo(0.65903, 10);
    expect(result.detail).toContain('sent no usage block');
  });

  it('does not confuse a measured zero with an absent measurement', () => {
    const source: ClaudeCliEnvelope = {
      is_error: false,
      result: '{"ok":true}',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const result = costCheckOf(envelopeToRawResponse(source, 'claude-fable-5'));

    expect(result.usageMeasured).toBe(true);
    expect(result.agreement).toBe('corroborated');
  });
});

describe('a bill the usage cannot account for', () => {
  it('contradicts dollars an order of magnitude over the priced usage', () => {
    const result = check({ reportedUsd: 0.581425, cacheWrite: '1h' });

    expect(result.agreement).toBe('contradicted');
    expect(result.pricedUsd).not.toBeNull();
    expect(result.detail).toContain('One of the two is wrong');
  });

  it('keeps both numbers rather than picking one', () => {
    const result = check({ reportedUsd: 0.581425, cacheWrite: '1h' });

    expect(result.reportedUsd).toBeCloseTo(0.581425, 10);
    expect(result.pricedUsd).toBeGreaterThan(0);
  });

  it('tolerates a cent of rounding between two honest accounts', () => {
    const priced = estimateCostUsd('claude-fable-5', HOUR_CACHED, '1h').costUsd;
    const result = check({ reportedUsd: priced * 1.001, cacheWrite: '1h' });

    expect(result.agreement).toBe('corroborated');
  });
});

describe('nothing to check against', () => {
  it('is unchecked when the backend reported no dollars', () => {
    const result = check({ reportedUsd: null });

    expect(result.agreement).toBe('unchecked');
    expect(result.reportedUsd).toBeNull();
    expect(result.pricedUsd).not.toBeNull();
  });

  it('is unchecked when no price covers the model', () => {
    const result = check({ model: 'some-other-vendor-model', reportedUsd: 4.2 });

    expect(result.agreement).toBe('unchecked');
    expect(result.pricedUsd).toBeNull();
    expect(result.detail).toContain('some-other-vendor-model');
  });

  it('reads an absent check as unchecked rather than as agreement', () => {
    expect(costCheckOf({}).agreement).toBe('unchecked');
    expect(worstAgreement([])).toBe('unchecked');
  });
});

describe('aggregation', () => {
  it('takes the worst of several attempts', () => {
    const good = check({
      reportedUsd: estimateCostUsd('claude-fable-5', HOUR_CACHED, '1h').costUsd,
      cacheWrite: '1h',
    });
    const bad = check({ reportedUsd: 9.99, cacheWrite: '1h' });

    expect(worstAgreement([good, good])).toBe('corroborated');
    expect(worstAgreement([good, check({ reportedUsd: null })])).toBe('unchecked');
    expect(worstAgreement([good, check({ reportedUsd: null }), bad])).toBe('contradicted');
  });

  it('counts unreconciled calls in the budget snapshot', () => {
    const budget = createBudgetGuard();
    const good = check({
      reportedUsd: estimateCostUsd('claude-fable-5', HOUR_CACHED, '1h').costUsd,
      cacheWrite: '1h',
    });
    const bad = check({ reportedUsd: 9.99, cacheWrite: '1h' });

    budget.record({ costUsd: 1, usage: HOUR_CACHED, costCheck: good });
    budget.record({ costUsd: 9.99, usage: HOUR_CACHED, costCheck: bad });
    budget.record({ costUsd: 1, usage: HOUR_CACHED });

    expect(budget.snapshot().calls).toBe(3);
    expect(budget.snapshot().unreconciledCalls).toBe(1);
  });
});

describe('describeUsage', () => {
  it('names every billed component, because two of the four hide the volume', () => {
    const line = describeUsage({
      inputTokens: 68,
      outputTokens: 169_574,
      cacheCreationInputTokens: 1_847_881,
      cacheReadInputTokens: 798_248,
    });

    expect(line).toContain('2,815,771 billed');
    expect(line).toContain('68 fresh input');
    expect(line).toContain('1,847,881 cache write');
    expect(line).toContain('798,248 cache read');
    expect(line).toContain('169,574 output');
  });
});
