/**
 * The concave removal premium (`mtg-46ka`).
 *
 * The premium `removalPremiumFor` pays is flat per card, so a deck holding ten
 * answers scored ten premiums and its tenth answer was priced like its first.
 * An answer is only cashed in against a creature worth answering, and no deck
 * answers more creatures than the opponent presents, so the shape is concave:
 * `removalSaturation` is that shape and this file pins it.
 *
 * Two boundaries are load-bearing and are asserted rather than described. The
 * discount reaches a card only through a `DeckContext` — the color-pair
 * ranking sees no deck and must keep sorting on the flat price, which
 * `color-pair.ts` states as the reason its `removalCount` is reported and not
 * ranked on. And a candidate is priced with itself in the deck, so the first
 * answer is ordinal 1 rather than ordinal 0 and pays the premium in full.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  deckContextOf,
  deckContextWith,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_MANA_BASE_CONFIG,
  DEFAULT_REMOVAL_SATURATION,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  hypergeometricAtLeast,
  isRemovalCard,
} from '../src/index';

const config = DEFAULT_DECK_BUILD_CONFIG;
const weights = DEFAULT_SCORE_WEIGHTS;

let nextNumber = 1;
function card(input: Partial<CardInput> & { readonly id: string }): Card {
  nextNumber += 1;
  return parseCard({
    name: input.id,
    rarity: 'common',
    set: { code: 'SAT', collectorNumber: nextNumber },
    ...input,
  } as CardInput);
}

const DESTROY: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };

function answer(id: string): Card {
  return card({ id, kind: 'sorcery', manaCost: { generic: 2, B: 1 }, colors: ['B'], effects: [DESTROY] });
}

function bear(id: string): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    subtypes: ['Bear'],
    power: 2,
    toughness: 2,
  });
}

function premiumOf(subject: Card, deck: readonly Card[]): number {
  const context = deckContextOf(deck, config);
  const component = evaluateCard(subject, weights, context).components.find(
    (entry) => entry.name === 'removalPremium',
  );
  return component?.value ?? 0;
}

function deckOfAnswers(count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) => answer(`answer-${index}`));
}

describe('the removal saturation table', () => {
  it('starts at exactly one, never rises, and ends below one', () => {
    expect(DEFAULT_REMOVAL_SATURATION[0]).toBe(1);
    for (let index = 1; index < DEFAULT_REMOVAL_SATURATION.length; index += 1) {
      const previous = DEFAULT_REMOVAL_SATURATION[index - 1] ?? 0;
      const entry = DEFAULT_REMOVAL_SATURATION[index] ?? 0;
      expect(entry).toBeLessThanOrEqual(previous);
      expect(entry).toBeGreaterThan(0);
    }
    const last = DEFAULT_REMOVAL_SATURATION[DEFAULT_REMOVAL_SATURATION.length - 1] ?? 1;
    expect(last).toBeLessThan(1);
  });

  it('pins the table against the format defaults it is derived from', () => {
    const deckSize = DEFAULT_DECK_BUILD_CONFIG.deckSize;
    const openingHand = DEFAULT_MANA_BASE_CONFIG.openingHandSize;
    const medianRounds = DEFAULT_SCORE_WEIGHTS.formatMedianRounds;
    expect(DEFAULT_MANA_BASE_CONFIG.onThePlay).toBe(true);
    const draws = openingHand + Math.max(0, medianRounds - 1);
    // The one assumption the table carries that this file cannot read off a
    // published default: how many creatures worth answering an opponent shows
    // by the median round. Restated here so a change to it fails a test.
    const presented = 5;
    const expected = (answers: number): number => {
      let sum = 0;
      for (let spent = 1; spent <= presented; spent += 1) {
        sum += hypergeometricAtLeast(spent, answers, draws, deckSize);
      }
      return sum;
    };
    const first = expected(1);
    expect(DEFAULT_REMOVAL_SATURATION[2]).toBeCloseTo((expected(3) - expected(2)) / first, 10);
    expect(DEFAULT_REMOVAL_SATURATION[9]).toBeCloseTo((expected(10) - expected(9)) / first, 10);
  });

  it('discounts late rather than early, which is what the draw model says', () => {
    // Thirteen cards seen is not enough to draw six answers often, so the
    // ceiling on targets does not bind until the deck is answer-heavy. The
    // shape is real and its magnitude is small; both are the finding.
    expect(DEFAULT_REMOVAL_SATURATION[4]).toBeGreaterThan(0.99);
    expect(DEFAULT_REMOVAL_SATURATION[9]).toBeLessThan(0.95);
  });
});

describe('what the discount reaches', () => {
  it('leaves a card scored without a deck at the flat premium', () => {
    const subject = answer('subject');
    const alone = evaluateCard(subject, weights).components.find((entry) => entry.name === 'removalPremium');
    expect(alone?.value).toBeCloseTo(weights.removalPremium, 10);
    expect(isRemovalCard(subject, weights)).toBe(true);
  });

  it('pays the first answer in a deck the whole premium', () => {
    const subject = answer('subject');
    expect(premiumOf(subject, [subject, bear('b1'), bear('b2')])).toBeCloseTo(weights.removalPremium, 10);
  });

  it('pays the tenth answer the tenth entry of the table', () => {
    const subject = answer('subject');
    const deck = [subject, ...deckOfAnswers(9)];
    const entry = DEFAULT_REMOVAL_SATURATION[9] ?? 1;
    expect(premiumOf(subject, deck)).toBeCloseTo(weights.removalPremium * entry, 10);
  });

  it('clamps past the end of the table instead of falling off it', () => {
    const subject = answer('subject');
    const long = [subject, ...deckOfAnswers(22)];
    const last = DEFAULT_REMOVAL_SATURATION[DEFAULT_REMOVAL_SATURATION.length - 1] ?? 1;
    expect(premiumOf(subject, long)).toBeCloseTo(weights.removalPremium * last, 10);
  });

  it('moves nothing about a card that answers nothing', () => {
    const subject = bear('subject');
    const thin = evaluateCard(subject, weights, deckContextOf([subject], config)).score;
    const heavy = evaluateCard(
      subject,
      weights,
      deckContextOf([subject, ...deckOfAnswers(11)], config),
    ).score;
    expect(heavy).toBeCloseTo(thin, 10);
  });

  it('counts the candidate itself when a context is widened for it', () => {
    const base = deckContextOf(deckOfAnswers(4), config);
    expect(base.removalSources).toBe(4);
    expect(deckContextWith(base, answer('one-more'), weights).removalSources).toBe(5);
    expect(deckContextWith(base, bear('a-body'), weights).removalSources).toBe(4);
  });
});
