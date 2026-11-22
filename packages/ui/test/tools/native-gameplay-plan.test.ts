import { expect, it } from 'vitest';
import { BotStrengthCampaignPlanSchema } from '@mtg/metrics';
import { buildNativeGameplayPlan } from '../../tools/native-gameplay-plan';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

function policy(policyId: string, configSha256 = SHA) {
  return { policyId, configSha256, modelSha256: null, dataSha256: null };
}

function inputs() {
  return {
    id: 'general-native-gameplay-tuning-v1',
    split: 'tuning' as const,
    runtime: { version: 'native-kernel@commit', buildSha256: SHA },
    features: {
      baseline: { schemaId: 'native/v1', schemaSha256: SHA },
      candidate: { schemaId: 'native/v1', schemaSha256: SHA },
    },
    policies: {
      baseline: policy('native-greedy/v1'),
      candidate: policy('native-learned/v1', OTHER_SHA),
    },
    formats: [
      { id: 'tideglass-reach', formatSha256: SHA, cardsSha256: SHA },
      { id: 'flagship-set', formatSha256: OTHER_SHA, cardsSha256: OTHER_SHA },
      { id: 'sim-fixtures', formatSha256: 'c'.repeat(64), cardsSha256: 'c'.repeat(64) },
    ],
    opponents: [
      { id: 'tgr/ub/greedy', ...policy('native-greedy/v1'), deckSha256: SHA },
      { id: 'xmp/gw/greedy', ...policy('native-greedy/v1'), deckSha256: OTHER_SHA },
      {
        id: 'fixtures/rw/search',
        ...policy('native-search/v1', 'c'.repeat(64)),
        deckSha256: 'c'.repeat(64),
      },
    ],
    matchups: [
      { formatId: 'tideglass-reach', focalDeckSha256: OTHER_SHA, opponentId: 'tgr/ub/greedy' },
      { formatId: 'flagship-set', focalDeckSha256: SHA, opponentId: 'xmp/gw/greedy' },
      { formatId: 'sim-fixtures', focalDeckSha256: OTHER_SHA, opponentId: 'fixtures/rw/search' },
    ],
    replicasPerMatchup: 17,
  };
}

it('freezes a powered cross-format seat-balanced native gameplay schedule', () => {
  const plan = buildNativeGameplayPlan(inputs());

  expect(BotStrengthCampaignPlanSchema.parse(plan)).toEqual(plan);
  expect(plan.schedule).toHaveLength(102);
  expect(new Set(plan.schedule.map(({ unitId }) => unitId))).toHaveLength(51);
  expect(plan.stoppingRule.count).toBe(51);
  expect(plan.minimumIndependentUnits).toBe(51);
  expect(plan.powerPlan.requiredIndependentUnits).toBe(50);
  expect(new Set(plan.schedule.map(({ formatId }) => formatId))).toEqual(
    new Set(['tideglass-reach', 'flagship-set', 'sim-fixtures']),
  );

  for (let index = 0; index < plan.schedule.length; index += 2) {
    const pair = plan.schedule.slice(index, index + 2);
    expect(pair.map(({ focalSeat }) => focalSeat)).toEqual([0, 1]);
    expect(pair[0]!.unitId).toBe(pair[1]!.unitId);
    expect(pair[0]!.seed).toBe(pair[1]!.seed);
  }
});

it('rejects an underpowered or incomplete declared population', () => {
  expect(() => buildNativeGameplayPlan({ ...inputs(), replicasPerMatchup: 16 })).toThrow(/power/i);
  expect(() =>
    buildNativeGameplayPlan({
      ...inputs(),
      matchups: inputs().matchups.slice(0, 2),
      replicasPerMatchup: 25,
    }),
  ).toThrow(/every declared format/i);
});

it('keeps tuning games out of the holdout seed namespace when ids are reused', () => {
  const tuning = buildNativeGameplayPlan(inputs());
  const holdout = buildNativeGameplayPlan({ ...inputs(), split: 'holdout' });
  expect(new Set(tuning.schedule.map(({ seed }) => seed))).not.toEqual(
    new Set(holdout.schedule.map(({ seed }) => seed)),
  );
});
