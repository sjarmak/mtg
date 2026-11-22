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
  communityPickOrderRating,
  evaluatorRating,
  playDataRating,
  RATING_MAX,
  RATING_MIN,
  RATING_RANGE_IN_COLOR_CARDS,
  rateCards,
  ratingValueOf,
  resolveCardRating,
  seventeenLandsRating,
  SIMPLE_BOT_COLOR_BONUS,
} from '@mtg/draft-export';
import type { CardRating, EvaluatorRating, PlayDataRating } from '@mtg/draft-export';

describe('a rating carries its source', () => {
  it('rateCards produces evaluator-sourced ratings, never bare numbers', () => {
    for (const rated of rateCards(EXAMPLE_SET)) {
      expect(rated.source).toBe('evaluator');
      expect(typeof rated.score).toBe('number');
    }
  });

  it('evaluatorRating and playDataRating stamp their own source', () => {
    const [card] = EXAMPLE_SET;
    if (card === undefined) throw new Error('EXAMPLE_SET is empty');
    expect(evaluatorRating(card, 1.2, 3).source).toBe('evaluator');
    expect(playDataRating(card, 0.54, 3).source).toBe('play-data');
  });

  it('communityPickOrderRating stamps its source and carries Forge quality', () => {
    const rated = communityPickOrderRating('ktk-1-abzan-falconer', 4.2);
    expect(rated.source).toBe('community-pick-order');
    expect(rated.quality).toBe(4.2);
  });

  it('seventeenLandsRating stamps its own source, distinct from play-data', () => {
    const rated = seventeenLandsRating('ktk-1-abzan-falconer', 0.58, 4.1);
    expect(rated.source).toBe('seventeen-lands');
    expect(rated.source).not.toBe('play-data');
    expect(rated.mappedRating).toBe(4.1);
    expect(rated.winRate).toBe(0.58);
  });

  it('a function typed over CardRating cannot read a variant-specific field without narrowing', () => {
    // @ts-expect-error `score`, `winRate` and `quality` each live on exactly one
    // member of the union; the ADR-0005 claim that averaging two different
    // sources fails to typecheck rests on there being no field a caller can
    // read across `CardRating` without first narrowing on `source`.
    const readEvidence = (rating: CardRating): number => rating.score;
    expect(typeof readEvidence).toBe('function');
  });

  it('mtg-1j00i.6: averaging two CardRating sources fails to typecheck', () => {
    // @ts-expect-error `rating` is not a shared field either: only
    // `EvaluatorRating` carries it, while `PlayDataRating`,
    // `CommunityPickOrderRating` and `SeventeenLandsRating` hold their 0-5
    // value under `simRating`, `quality` and `mappedRating` instead —
    // precisely so this blend, which ADR-0005 forbids, cannot compile.
    const mean = (a: CardRating, b: CardRating): number => (a.rating + b.rating) / 2;
    expect(typeof mean).toBe('function');
  });

  it('mtg-tye7s: averaging an EvaluatorRating and a PlayDataRating still fails to typecheck', () => {
    // @ts-expect-error Both are rung 3 (ADR-0005), and narrowing to these two
    // concrete members — rather than the wider `CardRating` union the test
    // above covers — is exactly the gap `mtg-1j00i.6` left open: each still
    // declared its 0-5 number as a bare `rating: number`, so a function typed
    // over these two specific interfaces could average them without ever
    // checking `source`. `PlayDataRating` no longer shares that field name.
    const mean = (a: EvaluatorRating, b: PlayDataRating): number => (a.rating + b.rating) / 2;
    expect(typeof mean).toBe('function');
  });

  it('ratingValueOf reads the right field for every source, no blending possible', () => {
    const [card] = EXAMPLE_SET;
    if (card === undefined) throw new Error('EXAMPLE_SET is empty');
    expect(ratingValueOf(evaluatorRating(card, 1.2, 3))).toBe(3);
    expect(ratingValueOf(playDataRating(card, 0.54, 3.5))).toBe(3.5);
    expect(ratingValueOf(communityPickOrderRating('ktk-1-abzan-falconer', 4))).toBe(4);
    expect(ratingValueOf(seventeenLandsRating('ktk-1-abzan-falconer', 0.58, 4.1))).toBe(4.1);
  });
});

describe('resolveCardRating walks ADR-0005 section 2s ladder', () => {
  const [CARD] = EXAMPLE_SET;
  if (CARD === undefined) throw new Error('EXAMPLE_SET is empty');
  const evaluator = evaluatorRating(CARD, 1.2, 3);
  const communityPickOrder = communityPickOrderRating('ktk-1-abzan-falconer', 4);
  const simPlayData = playDataRating(CARD, 0.54, 3.5);
  const seventeenLands = seventeenLandsRating('ktk-1-abzan-falconer', 0.58, 4.1);

  it('falls through to the evaluator rung when nothing higher was supplied', () => {
    expect(resolveCardRating({ evaluator })).toBe(evaluator);
  });

  it('prefers a staged community pick order over the evaluator', () => {
    expect(resolveCardRating({ communityPickOrder, evaluator })).toBe(communityPickOrder);
  });

  it('prefers our own sim play data over the evaluator', () => {
    expect(resolveCardRating({ simPlayData, evaluator })).toBe(simPlayData);
  });

  it('prefers 17lands over our own sim play data, a community pick order, and the evaluator', () => {
    expect(resolveCardRating({ seventeenLands, simPlayData, communityPickOrder, evaluator })).toBe(
      seventeenLands,
    );
  });

  it('a sim-derived rating never outranks a Forge community pick order', () => {
    expect(resolveCardRating({ simPlayData, communityPickOrder })).toBe(communityPickOrder);
    expect(resolveCardRating({ simPlayData, communityPickOrder })).not.toBe(simPlayData);
  });

  it('falls through cleanly to undefined rather than throwing or inventing a zero', () => {
    expect(resolveCardRating({})).toBeUndefined();
    expect(
      resolveCardRating({
        seventeenLands: undefined,
        communityPickOrder: undefined,
        simPlayData: undefined,
        evaluator: undefined,
      }),
    ).toBeUndefined();
  });
});

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
