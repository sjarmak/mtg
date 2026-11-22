import { beforeAll, expect, it } from 'vitest';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildQualityReviewPair } from '../src/legacy-cube-calibration/quality-pair';
import {
  compactAdvicePayload,
  expandAdvicePayload,
  qualityReviewPrompt,
} from '../src/legacy-cube-calibration/quality-prompt';

let arm: ReturnType<typeof buildQualityReviewPair>['baseline'];
beforeAll(() => {
  arm = buildQualityReviewPair(parsePrintedCardCatalog(catalogJson), {
    root: 'live-quality-pipeline-v1',
    split: 'tuning',
    index: 2,
    policy: 'current',
    baseline: DEFAULT_ADVISOR_WEIGHTS,
    candidate: DEFAULT_ADVISOR_WEIGHTS,
    runtimeSha256: 'a'.repeat(64),
  }).baseline;
});
it('round-trips every claim, observation, path and Oracle field across all draft stages', () => {
  for (const task of arm.advice) {
    const before = JSON.stringify(task);
    const compact = compactAdvicePayload(task.payload);
    expect(expandAdvicePayload(compact)).toEqual(task.payload);
    expect(compactAdvicePayload(task.payload)).toEqual(compact);
    expect(JSON.stringify(task)).toBe(before);
  }
});
it('substantially reduces the actual previously oversized pilot payload without sampling claims', () => {
  const task = arm.advice.reduce((largest, task) =>
    JSON.stringify(task.payload).length > JSON.stringify(largest.payload).length ? task : largest,
  );
  expect(task.payload.advice.claims.length).toBeGreaterThan(1000);
  expect(JSON.stringify(compactAdvicePayload(task.payload)).length).toBeLessThan(
    JSON.stringify(task.payload).length * 0.7,
  );
});
it('keeps canonical response citations and unchanged deck prompts', () => {
  expect(qualityReviewPrompt(arm.deck)).toContain(JSON.stringify(arm.deck.payload));
  const task = arm.advice[0]!;
  const prompt = qualityReviewPrompt(task);
  expect(prompt).toContain(task.sha256);
  expect(prompt).toContain('Return canonical card IDs, not aliases');
  expect(prompt).toContain(task.payload.advice.claims[0]!.id);
});

it('refuses ambiguous alias literals rather than corrupting payload text', () => {
  const payload = arm.advice[0]!.payload;
  const modified = { ...payload, context: { ...payload.context, cube: ['@c0'] } };
  expect(() => compactAdvicePayload(modified)).toThrow(/alias collides/);
});

it('preserves empty claim tables and optional-field absence', () => {
  const payload = arm.advice[0]!.payload;
  const empty = { ...payload, advice: { ...payload.advice, claims: [] } };
  expect(expandAdvicePayload(compactAdvicePayload(empty))).toEqual(empty);
  const first = payload.advice.claims[0]!;
  const minimal = {
    ...payload,
    advice: {
      ...payload.advice,
      claims: [
        {
          id: first.id,
          reason: {
            code: first.reason.code,
            text: first.reason.text,
            cards: [],
            polarity: first.reason.polarity,
          },
        },
      ],
    },
  };
  expect(expandAdvicePayload(compactAdvicePayload(minimal))).toEqual(minimal);
});

it('preserves additional reason details including explicit null values', () => {
  const payload = arm.advice[0]!.payload;
  const first = payload.advice.claims[0]!;
  const extended = {
    ...payload,
    advice: {
      ...payload.advice,
      claims: [{ ...first, reason: { ...first.reason, weight: 2.5, extension: null } }],
    },
  };
  expect(expandAdvicePayload(compactAdvicePayload(extended))).toEqual(extended);
});
