/**
 * The rating scale: `evaluateCard`'s score -> Draftmancer's 0-5 `rating`.
 *
 * The scale is the whole of a custom-set bot's judgment — `SimpleBot` adds
 * nothing to `rating` but color affinity — so these tests pin both halves of
 * ADR-0003: the transform is monotone in the evaluator's score, and the range
 * it spans is a stated multiple of the one constant Draftmancer contributes.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS, EXAMPLE_SET, exampleCard, isLand } from '@mtg/dsl';
import {
  RATING_MAX,
  RATING_MIN,
  RATING_RANGE_IN_COLOR_CARDS,
  rateCards,
  SIMPLE_BOT_COLOR_BONUS,
} from '@mtg/draft-export';

describe('rateCards', () => {
  it('keeps every rating inside the documented 0-5 band', () => {
    for (const rated of rateCards(EXAMPLE_SET)) {
      expect(rated.rating).toBeGreaterThanOrEqual(RATING_MIN);
      expect(rated.rating).toBeLessThanOrEqual(RATING_MAX);
    }
  });

  it('spans the full band: the worst card is 0 and the best is 5', () => {
    const ratings = rateCards(EXAMPLE_SET).map((rated) => rated.rating);
    expect(Math.min(...ratings)).toBe(RATING_MIN);
    expect(Math.max(...ratings)).toBe(RATING_MAX);
  });

  it('orders by rating exactly as the evaluator orders by score', () => {
    const rated = rateCards(EXAMPLE_SET).filter((entry) => !isLand(entry.card));
    for (const a of rated) {
      for (const b of rated) {
        if (a.score > b.score) expect(a.rating).toBeGreaterThanOrEqual(b.rating);
        if (a.score === b.score) expect(a.rating).toBe(b.rating);
      }
    }
    // Best score first: the ratings down that list never climb. Two cards whose
    // scores differ only in float noise (the fixture set has two such pairs)
    // round to one rating, which is a tie at the resolution the bot reasons in
    // and not a reordering.
    const byScore = [...rated].sort((x, y) => y.score - x.score);
    for (const [index, entry] of byScore.entries()) {
      const next = byScore[index + 1];
      if (next !== undefined) expect(entry.rating).toBeGreaterThanOrEqual(next.rating);
    }
  });

  it('carries the evaluator score alongside the rating', () => {
    for (const rated of rateCards(EXAMPLE_CARDS)) {
      expect(rated.score).toBe(evaluateCard(rated.card, DEFAULT_SCORE_WEIGHTS).score);
    }
  });

  it('gives spells the evaluator cannot separate the midpoint rather than 0 or 5', () => {
    const sentinel = exampleCard('slc-skywatch-sentinel');
    const flat = rateCards([sentinel, { ...sentinel, id: 'slc-skywatch-sentinel-2' }]);
    expect(new Set(flat.map((rated) => rated.score)).size).toBe(1);
    expect(flat.map((rated) => rated.rating)).toEqual([2.5, 2.5]);
  });

  it('holds lands out of the map, because their 0 is a sentinel and not a score', () => {
    const spells = EXAMPLE_SET.filter((card) => !isLand(card));
    const withLands = rateCards(EXAMPLE_SET).filter((entry) => !isLand(entry.card));
    expect(withLands.map((entry) => entry.rating)).toEqual(rateCards(spells).map((entry) => entry.rating));
    expect(rateCards(BASIC_LANDS).map((entry) => entry.rating)).toEqual(BASIC_LANDS.map(() => RATING_MIN));
  });

  // The case above cannot see the hold-out on its own. EXAMPLE_SET's spells run
  // -2.10 to +2.45, so a land's 0 lands *inside* that range and folding it into
  // the fit moves neither endpoint: the assertion holds either way. Only a set
  // whose spells all sit on one side of zero can tell the two apart, and that is
  // the set a generator can easily produce — the sentinel becomes the new
  // minimum, every spell shifts, and the worst spell stops rating 0.
  it('fits the map to the spells even when no spell scores below the sentinel', () => {
    const scoreOf = (card: Card): number => evaluateCard(card, DEFAULT_SCORE_WEIGHTS).score;
    const spells = EXAMPLE_SET.filter((card) => !isLand(card) && scoreOf(card) > 0);
    // The premise, asserted rather than assumed: this pool really does sit above
    // the sentinel, and its spells are not all equal (which would take the
    // midpoint branch and prove nothing about the fit).
    expect(Math.min(...spells.map(scoreOf))).toBeGreaterThan(0);
    expect(new Set(spells.map(scoreOf)).size).toBeGreaterThan(1);

    const alone = rateCards(spells);
    const withLands = rateCards([...spells, ...BASIC_LANDS]).filter((entry) => !isLand(entry.card));
    expect(withLands.map((entry) => entry.rating)).toEqual(alone.map((entry) => entry.rating));
    // The floor of the band belongs to the worst spell; a basic does not take it.
    expect(Math.min(...alone.map((entry) => entry.rating))).toBe(RATING_MIN);
  });

  it('rates a one-card set at the midpoint, having nothing to compare it against', () => {
    expect(rateCards([exampleCard('slc-skywatch-sentinel')]).map((rated) => rated.rating)).toEqual([2.5]);
  });

  it('rates an empty set as nothing at all', () => {
    expect(rateCards([])).toEqual([]);
  });

  it('rates lands 0, because the evaluator scores them 0 and packs are drafted for spells', () => {
    const rated = rateCards(EXAMPLE_SET);
    for (const land of BASIC_LANDS) {
      expect(rated.find((entry) => entry.card.id === land.id)?.rating).toBe(RATING_MIN);
    }
  });
});

describe('the scale against SimpleBot', () => {
  it('states the range in units of the one bonus SimpleBot adds', () => {
    expect(SIMPLE_BOT_COLOR_BONUS).toBe(0.35);
    expect(RATING_RANGE_IN_COLOR_CARDS).toBeCloseTo((RATING_MAX - RATING_MIN) / SIMPLE_BOT_COLOR_BONUS, 10);
    expect(RATING_RANGE_IN_COLOR_CARDS).toBeCloseTo(14.2857, 4);
  });

  it('needs 15 on-color cards in the pile before affinity can outrank the whole band', () => {
    // SimpleBot scores `rating + 0.35 x (already-picked cards in this color)`,
    // so the worst on-color card overtakes the best off-color one only once
    // the pile holds this many on-color cards.
    expect(Math.floor(RATING_RANGE_IN_COLOR_CARDS) + 1).toBe(15);
  });
});
