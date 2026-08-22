import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Color } from '@mtg/dsl';
import { EXAMPLE_CARDS, exampleCard, parseCard } from '@mtg/dsl';
import {
  COLOR_PAIRS,
  colorPairKey,
  countPlayablesByColor,
  DEFAULT_SCORE_WEIGHTS,
  evaluatePool,
  isPlayableIn,
  playablesFor,
  rankColorPairs,
} from '@mtg/deckbuild';
import { makeSyntheticPool } from './helpers/pool';

function payoff(index: number, color: Color): Card {
  const cost: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  cost[color] = 1;
  return parseCard({
    kind: 'creature',
    id: `pay-${index}`,
    name: `Payoff ${index}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: index + 1 },
    manaCost: { generic: 1, ...cost },
    colors: [color],
    keywords: ['flying', 'lifelink'],
    power: 4,
    toughness: 4,
  } satisfies CardInput);
}

describe('COLOR_PAIRS', () => {
  it('is the ten pairs in WUBRG order', () => {
    expect(COLOR_PAIRS).toHaveLength(10);
    expect(COLOR_PAIRS.map(colorPairKey)).toEqual([
      'WU',
      'WB',
      'WR',
      'WG',
      'UB',
      'UR',
      'UG',
      'BR',
      'BG',
      'RG',
    ]);
  });
});

describe('isPlayableIn', () => {
  it('accepts on-color and colorless cards and rejects off-color ones', () => {
    const pair = ['U', 'R'] as const;
    expect(isPlayableIn(exampleCard('slc-lightning-lash'), pair)).toBe(true);
    expect(isPlayableIn(exampleCard('slc-windrider-drake'), pair)).toBe(true);
    expect(isPlayableIn(exampleCard('slc-ironclad-golem'), pair)).toBe(true);
    expect(isPlayableIn(exampleCard('slc-thornhide-guardian'), pair)).toBe(false);
  });
});

describe('rankColorPairs', () => {
  it('picks the pair the pool is actually stocked in', () => {
    const stacked = [
      ...makeSyntheticPool(11, { size: 40 }),
      ...Array.from({ length: 14 }, (_unused, index) => payoff(index, 'B')),
      ...Array.from({ length: 14 }, (_unused, index) => payoff(index + 100, 'G')),
    ];
    const ranked = rankColorPairs(evaluatePool(stacked, DEFAULT_SCORE_WEIGHTS), 23);
    expect(ranked[0]?.key).toBe('BG');
  });

  it('ranks all ten pairs and never lets a pair outscore a strictly better one', () => {
    const pool = makeSyntheticPool(7);
    const ranked = rankColorPairs(evaluatePool(pool, DEFAULT_SCORE_WEIGHTS), 23);
    expect(ranked).toHaveLength(10);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]?.topScore).toBeGreaterThanOrEqual(ranked[i]?.topScore ?? 0);
    }
  });

  it('is deterministic for the same pool', () => {
    const pool = makeSyntheticPool(31);
    const first = rankColorPairs(evaluatePool(pool, DEFAULT_SCORE_WEIGHTS), 23);
    const second = rankColorPairs(evaluatePool(pool, DEFAULT_SCORE_WEIGHTS), 23);
    expect(first.map((entry) => entry.key)).toEqual(second.map((entry) => entry.key));
    expect(first.map((entry) => entry.topScore)).toEqual(second.map((entry) => entry.topScore));
  });

  it('counts depth beyond the deck size without letting it decide the winner', () => {
    const ranked = rankColorPairs(evaluatePool(makeSyntheticPool(3), DEFAULT_SCORE_WEIGHTS), 23);
    for (const entry of ranked) {
      expect(entry.playableCount).toBeGreaterThan(0);
      if (entry.playableCount >= 23) {
        expect(entry.averageTopScore).toBeCloseTo(entry.topScore / 23, 10);
      }
    }
  });
});

describe('playablesFor', () => {
  it('excludes lands and returns best-first', () => {
    const pool = makeSyntheticPool(5);
    const playables = playablesFor(evaluatePool(pool, DEFAULT_SCORE_WEIGHTS), ['W', 'U']);
    expect(playables.every((entry) => entry.card.kind !== 'land')).toBe(true);
    for (let i = 1; i < playables.length; i += 1) {
      expect(playables[i - 1]?.score).toBeGreaterThanOrEqual(playables[i]?.score ?? 0);
    }
  });
});

describe('countPlayablesByColor', () => {
  it('counts each color of a card and tracks colorless separately', () => {
    const counts = countPlayablesByColor(EXAMPLE_CARDS);
    expect(counts.byColor.W).toBe(3);
    expect(counts.byColor.R).toBe(2);
    expect(counts.colorless).toBe(2);
  });
});
