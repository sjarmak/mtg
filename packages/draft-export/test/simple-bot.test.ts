/**
 * The bot, against the algorithm ADR-0003 §1 records.
 *
 * These tests are the mirror's spec sheet: every one of them states a number
 * the source states, so the day someone runs a real Draftmancer against the
 * emitted file the two can be compared rather than guessed at. The most
 * load-bearing is the fifteenth on-color card — ADR-0003 §2.1 chose the 0-5
 * band because `5 / 0.35` is the point where color affinity overtakes the whole
 * quality range, and if that arithmetic is wrong here the band is wrong there.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { CardRating } from '@mtg/draft-export';
import {
  countPickedColors,
  DraftError,
  simpleBotPick,
  simpleBotScore,
  simpleBotScores,
  SIMPLE_BOT_COLOR_BONUS,
} from '@mtg/draft-export';
import { createRng } from '../src/rng';

const WHITE = exampleCard('slc-skywatch-sentinel');
const BLUE = exampleCard('slc-windrider-drake');
const RED = exampleCard('slc-emberflow-raider');
const COLORLESS = exampleCard('slc-ironclad-golem');

const GOLD_INPUT: CardInput = {
  id: 'test-tidebound-envoy',
  name: 'Tidebound Envoy',
  kind: 'creature',
  manaCost: { generic: 1, W: 1, U: 1 },
  colors: ['W', 'U'],
  subtypes: ['Bird'],
  keywords: ['flying'],
  power: 2,
  toughness: 2,
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
};
const GOLD = parseCard(GOLD_INPUT);

/** A rating the bot reads, without going through the evaluator. */
function rated(card: Card, rating: number): CardRating {
  return { card, score: rating, rating };
}

/** `count` copies of a card, as an already-picked pile. */
function pile(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

describe('counting a pile by color', () => {
  it('counts a card once in each of its colors', () => {
    expect(countPickedColors([WHITE, BLUE, GOLD])).toEqual({ W: 2, U: 2, B: 0, R: 0, G: 0 });
  });

  it('counts a colorless card in no color at all', () => {
    expect(countPickedColors([COLORLESS, COLORLESS])).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });
});

describe('the score', () => {
  it('is the rating alone before anything is picked', () => {
    expect(simpleBotScore(rated(BLUE, 3.2), countPickedColors([]))).toBe(3.2);
  });

  it('adds the bonus once per already-picked card of the color', () => {
    const score = simpleBotScore(rated(BLUE, 1), countPickedColors(pile(BLUE, 4)));
    expect(score).toBeCloseTo(1 + 4 * SIMPLE_BOT_COLOR_BONUS, 10);
  });

  it('adds it for both colors of a gold card, which is what the source loops over', () => {
    const picked = countPickedColors([...pile(WHITE, 3), ...pile(BLUE, 2)]);
    expect(simpleBotScore(rated(GOLD, 1), picked)).toBeCloseTo(1 + 5 * SIMPLE_BOT_COLOR_BONUS, 10);
  });

  it('gives a colorless card no affinity, however deep the pile is', () => {
    const picked = countPickedColors(pile(RED, 20));
    expect(simpleBotScore(rated(COLORLESS, 2), picked)).toBe(2);
  });

  it('scores a whole pack in pack order', () => {
    const pack = [rated(BLUE, 1), rated(RED, 4), rated(COLORLESS, 2)];
    expect(simpleBotScores(pack, pile(BLUE, 2))).toEqual([1 + 2 * SIMPLE_BOT_COLOR_BONUS, 4, 2]);
  });
});

describe('the pick', () => {
  const rng = createRng('bot/test');

  it('takes the highest-scoring card', () => {
    const pack = [rated(BLUE, 1), rated(RED, 4.5), rated(COLORLESS, 2)];
    expect(simpleBotPick(pack, [], rng)[0]).toBe(1);
  });

  it('takes the worst on-color card over the best off-color one at fifteen picks', () => {
    // ADR-0003 §2.1's whole argument for the 0-5 band, asserted as behavior:
    // the floor of the band plus fifteen color steps clears the ceiling, and
    // fourteen does not.
    const pack = [rated(BLUE, 0), rated(RED, 5)];
    expect(simpleBotPick(pack, pile(BLUE, 14), rng)[0]).toBe(1);
    expect(simpleBotPick(pack, pile(BLUE, 15), rng)[0]).toBe(0);
  });

  it('breaks a tie from the stream it is handed, and the same stream breaks it the same way', () => {
    const pack = [rated(BLUE, 3), rated(RED, 3), rated(COLORLESS, 3)];
    const chosen = new Set(
      Array.from(
        { length: 40 },
        (_unused, index) => simpleBotPick(pack, [], createRng(`tie/${String(index)}`))[0],
      ),
    );
    expect(chosen).toEqual(new Set([0, 1, 2]));
    expect(simpleBotPick(pack, [], createRng('tie/7'))[0]).toBe(
      simpleBotPick(pack, [], createRng('tie/7'))[0],
    );
  });

  it('refuses an empty pack rather than returning a card nobody has', () => {
    expect(() => simpleBotPick([], [], rng)).toThrow(DraftError);
    expect(() => simpleBotPick([], [], rng)).toThrow(/empty pack/);
  });
});
