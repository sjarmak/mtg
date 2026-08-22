import { describe, expect, it } from 'vitest';
import type { RecordedFixture, TokenUsage } from '@mtg/llm';
import { addUsage, estimateCostUsd, totalTokens, ZERO_USAGE } from '@mtg/llm';
import { tokenSummary, usdPerMillionTokens } from '@mtg/slice';
import { recordedRun, recordedSet, TIDEGLASS_RUN } from './helpers';

/**
 * Token accounting, asserted against the recorded bill.
 *
 * The Tideglass Reach run spent 54 plain input tokens and 1.53M cache tokens. A
 * summary that publishes only the plain input and the output — which is what the
 * first version of this format did — reports 0.003% of the volume beside 100% of
 * the dollars, and the memo then reads as if $24.64 bought 120k output tokens. So
 * the round trip is asserted field by field, from the fixture files on disk
 * through the generation report into the summary.
 *
 * A recorded run's bill is history, and history does not replay. This file has
 * now had the subject of that sum wrong twice, in opposite directions. It read
 * the whole fixture directory, which stopped being one run the moment a second
 * recording landed in the flat cache. Then it replayed a brief and summed the
 * keys the replay asked for, which is a fact about today's prompt bytes rather
 * than about money already spent: `setgen/signpost-payoff` reserved ability kinds
 * for signposts, the flagship's fill prompts moved, and a $22 recording could no
 * longer find its own fixtures. What a run served is written down in
 * `fixtures/runs/`, and the bills below are computed from that plus the files it
 * names. Nothing here runs the generator.
 *
 * The third time was the filename. A manifest named for its brief is one file
 * however many times the brief is recorded, so a regeneration an hour later
 * wrote over the record of the run below and this file started describing a
 * different run without a line of it changing. Manifests are named for the run
 * now, and each bill here names the id it means.
 */

function sumUsage(fixtures: readonly RecordedFixture[]): TokenUsage {
  return fixtures.reduce<TokenUsage>((total, fixture) => addUsage(total, fixture.response.usage), ZERO_USAGE);
}

function sumCostUsd(fixtures: readonly RecordedFixture[]): number {
  return fixtures.reduce((total, fixture) => total + fixture.response.costUsd, 0);
}

describe('the recorded Tideglass Reach run', () => {
  const { manifest, fixtures } = recordedRun(TIDEGLASS_RUN);

  it('records all four billed token kinds, not just the plain input', () => {
    // One fixture per call, so the files summed below are the calls billed. The
    // manifest carries both numbers because it is the only place they could
    // disagree: a request repeated verbatim resolves to a single file.
    expect(fixtures).toHaveLength(25);
    expect(manifest.calls).toBe(fixtures.length);

    // The specific numbers matter: they are what makes the dropped-cache bug
    // visible. Plain input is three orders of magnitude below the cache lines.
    expect(sumUsage(fixtures)).toEqual({
      inputTokens: 54,
      outputTokens: 120_346,
      cacheCreationInputTokens: 899_589,
      cacheReadInputTokens: 626_439,
    });
    expect(totalTokens(sumUsage(fixtures))).toBe(1_646_428);
  });

  /**
   * Ties the local price table to measured data.
   *
   * Every fixture carries a provider-reported `costUsd`, so the table can be
   * checked rather than trusted. An exact match across 25 independent records
   * pins all four rates at once — and it is how the 1-hour cache TTL was
   * identified: at the 5-minute multiplier the same tokens value the run at
   * $17.89 against a recorded $24.64, a 27% understatement.
   */
  it('prices exactly at the published claude-fable-5 rates with a 1-hour cache TTL', () => {
    for (const fixture of fixtures) {
      expect(fixture.model).toBe('claude-fable-5');
      expect(fixture.response.costSource).toBe('reported');
      const estimate = estimateCostUsd(fixture.model, fixture.response.usage, '1h');
      expect(estimate.costUsd).toBeCloseTo(fixture.response.costUsd, 10);
    }

    const recorded = sumCostUsd(fixtures);
    expect(recorded).toBeCloseTo(24.636059, 6);
    expect(estimateCostUsd('claude-fable-5', sumUsage(fixtures), '1h').costUsd).toBeCloseTo(recorded, 6);
    expect(estimateCostUsd('claude-fable-5', sumUsage(fixtures), '5m').costUsd).toBeCloseTo(17.8891415, 6);
  });
});

describe('the four usage fields on the way into the summary', () => {
  /**
   * The one place a replay still belongs, and it is a cross-check rather than a
   * source: the recorded bill is what the run cost, and replaying Tideglass says
   * whether today's pipeline still bills the same way over the same files. The
   * two agreeing is the round trip. If Tideglass's prompts drift the way the
   * flagship's did, this is where it surfaces, which is the canary
   * `packages/setgen/test/recorded-set.test.ts` describes and wants kept.
   */
  it('survives the trip from the fixture files through generation', async () => {
    const fixtureTotal = sumUsage(recordedRun(TIDEGLASS_RUN).fixtures);
    const { report } = await recordedSet();

    expect(report.usage.usage).toEqual(fixtureTotal);
    expect(report.usage.costUsd).toBeCloseTo(24.636059, 6);
    expect(report.usage.costSource).toBe('reported');
  });

  it('reaches the summary shape with every field intact', async () => {
    const { report } = await recordedSet();
    const tokens = tokenSummary(report.usage.usage);

    expect(tokens.input).toBe(report.usage.usage.inputTokens);
    expect(tokens.cacheWrite).toBe(report.usage.usage.cacheCreationInputTokens);
    expect(tokens.cacheRead).toBe(report.usage.usage.cacheReadInputTokens);
    expect(tokens.output).toBe(report.usage.usage.outputTokens);
    expect(tokens.billed).toBe(tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output);
    expect(tokens.billed).toBe(1_646_428);
  });
});

describe('usdPerMillionTokens', () => {
  it('lands between the cache-read rate and the input rate on a cached run', () => {
    const rate = usdPerMillionTokens(24.636059, 1_646_428, 'reported');
    expect(rate).not.toBeNull();
    expect(rate ?? 0).toBeCloseTo(14.9633, 3);
  });

  it('refuses to derive a rate it cannot stand behind', () => {
    expect(usdPerMillionTokens(0, 0, 'reported')).toBeNull();
    expect(usdPerMillionTokens(12, 1_000_000, 'unknown')).toBeNull();
    expect(usdPerMillionTokens(12, 1_000_000, 'estimated')).toBeCloseTo(12, 10);
  });
});
