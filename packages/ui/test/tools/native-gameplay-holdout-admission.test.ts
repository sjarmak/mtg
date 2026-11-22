import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { admitNativeGameplayHoldout } from '../../tools/native-gameplay-holdout-admission';

const MODEL = 'a'.repeat(64);

interface Overrides {
  readonly split?: 'tuning' | 'holdout';
  readonly modelSha256?: string;
  readonly status?: 'promote-candidate' | 'retain-baseline';
  readonly planSha256?: string;
  readonly comparisonSha256?: string;
}

function tuningCampaign(overrides: Overrides = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'native-tuning-'));
  const plan = { id: 'general-native-gameplay-tuning-v9', split: overrides.split ?? 'tuning' };
  const body = {
    planSha256: overrides.planSha256 ?? botEvidenceSha256(plan),
    scope: { engine: 'native', stage: 'gameplay', split: overrides.split ?? 'tuning' },
    promotion: {
      status: overrides.status ?? 'promote-candidate',
      reasons: overrides.status === 'retain-baseline' ? ['minimum-effect-not-established'] : [],
    },
  };
  const comparison = { ...body, sha256: overrides.comparisonSha256 ?? botEvidenceSha256(body) };
  const runtime = {
    version: 'native-gameplay-campaign-runtime/v1',
    modelSha256: overrides.modelSha256 ?? MODEL,
  };
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(directory, 'runtime.json'), JSON.stringify(runtime));
  writeFileSync(join(directory, 'comparison.json'), JSON.stringify(comparison));
  return directory;
}

it('admits a holdout on a promoted tuning campaign of the same model and binds their digests', () => {
  const directory = tuningCampaign();
  const admission = admitNativeGameplayHoldout({ tuningDirectory: directory, modelSha256: MODEL });
  expect(admission.tuningCampaignId).toBe('general-native-gameplay-tuning-v9');
  expect(admission.tuningPlanSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(admission.tuningComparisonSha256).toMatch(/^[a-f0-9]{64}$/u);
});

it('refuses a tuning campaign that retained the baseline', () => {
  const directory = tuningCampaign({ status: 'retain-baseline' });
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: directory, modelSha256: MODEL })).toThrow(
    /retained the baseline \(minimum-effect-not-established\)/,
  );
});

it('refuses a tuning campaign that evaluated a different model', () => {
  const directory = tuningCampaign({ modelSha256: 'b'.repeat(64) });
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: directory, modelSha256: MODEL })).toThrow(
    /not the holdout candidate/,
  );
});

it('refuses a holdout campaign standing in for tuning', () => {
  const directory = tuningCampaign({ split: 'holdout' });
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: directory, modelSha256: MODEL })).toThrow(
    /needs a tuning campaign/,
  );
});

it('refuses artifacts whose digests do not bind plan and comparison together', () => {
  const foreignPlan = tuningCampaign({ planSha256: 'c'.repeat(64) });
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: foreignPlan, modelSha256: MODEL })).toThrow(
    /does not belong to its plan/,
  );
  const edited = tuningCampaign({ comparisonSha256: 'd'.repeat(64) });
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: edited, modelSha256: MODEL })).toThrow(
    /recorded digest/,
  );
});

it('refuses a directory with no tuning campaign in it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-empty-'));
  expect(() => admitNativeGameplayHoldout({ tuningDirectory: directory, modelSha256: MODEL })).toThrow(
    /plan\.json/,
  );
});
