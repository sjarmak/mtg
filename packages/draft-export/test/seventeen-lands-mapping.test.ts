/**
 * `mapSeventeenLandsWinRates` against the real staged KTK artifact
 * (`packages/metrics/data/17lands-ktk-card-win-rate-v1.json`), so the fitted
 * band is checked against actual 17lands numbers rather than a synthetic
 * fixture that could pass while the real distribution breaks the map.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapSeventeenLandsWinRates, RATING_MAX, RATING_MIN } from '@mtg/draft-export';
import type { SeventeenLandsCardWinRate } from '@mtg/draft-export';

const KTK_ARTIFACT_PATH = fileURLToPath(
  new URL('../../metrics/data/17lands-ktk-card-win-rate-v1.json', import.meta.url),
);

interface StagedArtifact {
  readonly cards: readonly SeventeenLandsCardWinRate[];
}

function loadKtkCards(): readonly SeventeenLandsCardWinRate[] {
  const artifact = JSON.parse(readFileSync(KTK_ARTIFACT_PATH, 'utf8')) as StagedArtifact;
  return artifact.cards;
}

describe('mapSeventeenLandsWinRates against the staged KTK artifact', () => {
  it('maps the lowest-win-rate card that clears the floor to RATING_MIN and the highest to RATING_MAX', () => {
    const cards = loadKtkCards();
    const ratings = mapSeventeenLandsWinRates(cards);

    // Measured 2026-09-22 from the staged artifact: 249 of 254 cards clear
    // the 200-sample floor. Asserted by physicalId, not name, so the test
    // does not depend on re-deriving the extremum by eye.
    const lowest = ratings.get('ktk-printed-v1:0237:8d59d264-87ee-4305-bffb-110549331a82');
    const highest = ratings.get('ktk-printed-v1:0032:25f0f6a2-b392-45e6-97c4-4f00016144d3');
    expect(lowest?.mappedRating).toBe(RATING_MIN);
    expect(highest?.mappedRating).toBe(RATING_MAX);
    expect(lowest?.winRate).toBeCloseTo(0.3873239436619718, 10);
    expect(highest?.winRate).toBeCloseTo(0.6552013422818792, 10);
  });

  it('omits an under-sampled card entirely, rather than rating it', () => {
    const cards = loadKtkCards();
    const ratings = mapSeventeenLandsWinRates(cards);
    const erase = cards.find(
      (card) => card.physicalId === 'ktk-printed-v1:0009:d1dd0e10-2ad7-467f-8d4b-c70b95bf2e9c',
    );
    expect(erase?.underSampled).toBe(true);
    expect(ratings.has('ktk-printed-v1:0009:d1dd0e10-2ad7-467f-8d4b-c70b95bf2e9c')).toBe(false);
  });

  it('every returned rating carries source seventeen-lands and a value in [0, 5]', () => {
    const ratings = mapSeventeenLandsWinRates(loadKtkCards());
    expect(ratings.size).toBeGreaterThan(0);
    for (const rating of ratings.values()) {
      expect(rating.source).toBe('seventeen-lands');
      expect(rating.mappedRating).toBeGreaterThanOrEqual(RATING_MIN);
      expect(rating.mappedRating).toBeLessThanOrEqual(RATING_MAX);
    }
  });

  it('rates a set with no spread at the midpoint, same as the evaluator scale', () => {
    const flat: readonly SeventeenLandsCardWinRate[] = [
      { physicalId: 'a', winRate: 0.55, samples: 500, floor: 200, underSampled: false },
      { physicalId: 'b', winRate: 0.55, samples: 500, floor: 200, underSampled: false },
    ];
    const ratings = mapSeventeenLandsWinRates(flat);
    expect(ratings.get('a')?.mappedRating).toBe((RATING_MIN + RATING_MAX) / 2);
    expect(ratings.get('b')?.mappedRating).toBe((RATING_MIN + RATING_MAX) / 2);
  });
});
