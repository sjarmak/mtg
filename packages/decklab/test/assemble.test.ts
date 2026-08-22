import { describe, expect, it } from 'vitest';
import type { Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { hypergeometricAtLeast, minSourcesFor } from '@mtg/deckbuild';
import { createRng, nextBelow, shuffle, type RngState } from '@mtg/kernel';
import {
  assembleDeck,
  CASTABILITY_TARGET,
  HEAVY_CASTABILITY_TARGET,
  resolveDeckColors,
  type AssembledDeck,
} from '../src/assemble';
import type { CandidateCard } from '../src/candidates';
import { DeckCriteriaSchema, type DeckCriteriaInput, type ResolvedCriteria } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import { parseManaCost } from '../src/mana-cost';
import type { Inclusion } from '../src/verify';

/**
 * Mana value the way the store supplies it. The parser deliberately does not
 * compute this, so the tests stand in for Scryfall's column.
 */
function manaValueOf(manaCost: string | null): number {
  if (manaCost === null) return 0;
  let total = 0;
  for (const match of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1] ?? '';
    if (symbol === 'X') continue;
    const generic = /^\d+$/.exec(symbol);
    total += generic === null ? 1 : Number.parseInt(symbol, 10);
  }
  return total;
}

function card(
  name: string,
  manaCost: string | null,
  typeLine = 'Instant',
  producedMana: readonly Color[] = [],
): CandidateCard {
  const parsedCost = parseManaCost(manaCost);
  return {
    oracleId: name,
    name,
    manaCost,
    manaValue: manaValueOf(manaCost),
    typeLine,
    oracleText: null,
    power: null,
    toughness: null,
    colorIdentity: '',
    keywords: [],
    priceUsd: 1,
    parsedCost,
    producedMana,
  };
}

function include(name: string, manaCost: string | null, count: number, typeLine?: string): Inclusion {
  return {
    card: card(name, manaCost, typeLine),
    count,
    criteria: ['archetype'],
    reason: 'test',
  };
}

/**
 * A nonbasic land that taps for the given colors. The type line matters for a
 * fetchland's targets — a Sacred Foundry is `Land — Mountain Plains` and an
 * Inspiring Vantage is a bare `Land` — so it is overridable.
 */
function land(name: string, count: number, produces: readonly Color[], typeLine = 'Land'): Inclusion {
  return {
    card: card(name, null, typeLine, produces),
    count,
    criteria: ['archetype'],
    reason: 'test',
  };
}

/**
 * Criteria with the land count already decided, which is what `assembleDeck`
 * takes: by the time a deck is assembled, either the player stated a count or
 * `planLandCount` asked the model for one.
 *
 * These cases are the first kind. The count is stated — in the overrides, or as
 * the 24 that stands in when a case does not care — so the plan they mint says
 * `stated`, which is what happened: no model was asked anything here. Calling it
 * a model answer instead would put a number nothing chose behind the source that
 * means something chose it, and would bind these fixtures to the band, which is
 * a rule about model answers and not about what a test may assemble.
 */
function criteriaFor(overrides: Partial<DeckCriteriaInput> = {}): ResolvedCriteria {
  const landCount = overrides.landCount ?? 24;
  const parsed = DeckCriteriaSchema.parse({ prompt: 'test', format: 'modern', ...overrides, landCount });
  return resolveCriteria(parsed, { count: landCount, source: 'stated', reason: 'as the player stated' });
}

describe('resolveDeckColors', () => {
  it('prefers the colors the user stated', () => {
    const colors = resolveDeckColors([include('a', '{R}', 4)], criteriaFor({ colors: ['W'] }));
    expect(colors).toEqual(['W']);
  });

  it('derives colors from the cards when the user stated none', () => {
    const colors = resolveDeckColors([include('a', '{R}', 4), include('b', '{U}', 4)], criteriaFor({}));
    expect(colors).toEqual(['U', 'R']);
  });
});

describe('assembleDeck', () => {
  it('fills the land slot with basics and reaches the stated deck size', () => {
    const deck = assembleDeck(
      [include('a', '{R}', 36)],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );
    expect(deck.manaBase.basics.R).toBe(24);
    expect(deck.totalCards).toBe(60);
    expect(deck.shortfalls).toEqual([]);
  });

  it('counts a nonbasic land against the land slot rather than adding to it', () => {
    const deck = assembleDeck(
      [include('a', '{R}', 36), include('Sacred Foundry', null, 4, 'Land — Mountain Plains')],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );
    expect(deck.manaBase.nonBasicLands).toBe(4);
    expect(deck.manaBase.basics.R).toBe(20);
    expect(deck.manaBase.totalLands).toBe(24);
    expect(deck.totalCards).toBe(60);
  });

  it('splits basics by weighted pip demand, not evenly', () => {
    const deck = assembleDeck(
      [include('heavy red', '{R}{R}', 12), include('light white', '{3}{W}', 4)],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );
    expect(deck.manaBase.basics.R).toBeGreaterThan(deck.manaBase.basics.W);
    expect(deck.manaBase.basics.R + deck.manaBase.basics.W).toBe(17);
  });

  it('never rounds a real second color down to zero sources', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 30), include('one splash', '{4}{W}', 1)],
      criteriaFor({ colors: ['R', 'W'], size: 48, landCount: 17 }),
    );
    expect(deck.manaBase.basics.W).toBeGreaterThan(0);
  });

  it('reports a deck that misses its size target instead of trimming it', () => {
    const deck = assembleDeck([include('a', '{R}', 10)], criteriaFor({ colors: ['R'], size: 60 }));
    expect(deck.totalCards).toBe(34);
    expect(deck.shortfalls.some((line) => line.includes('against a target of 60'))).toBe(true);
  });

  it('flags a color that cannot be cast on curve', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 35), include('turn-one white', '{W}', 1)],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );
    const white = deck.manaBase.reports.find((report) => report.color === 'W');
    expect(white?.castability).toBeLessThan(CASTABILITY_TARGET);
    expect(deck.shortfalls.some((line) => line.startsWith('W casts turn-one white'))).toBe(true);
  });

  it('buckets the curve and averages mana value over copies', () => {
    const deck = assembleDeck(
      [include('one', '{R}', 4), include('seven', '{6}{R}', 1)],
      criteriaFor({ colors: ['R'], size: 40, landCount: 17 }),
    );
    expect(deck.curve.histogram[1]).toBe(4);
    expect(deck.curve.histogram[6]).toBe(1);
    expect(deck.curve.averageManaValue).toBeCloseTo((4 * 1 + 7) / 5);
  });

  it('does not demand a source for a color only reachable through hybrid', () => {
    const deck = assembleDeck(
      [include('hybrid', '{R/W}', 23)],
      criteriaFor({ colors: ['R'], size: 40, landCount: 17 }),
    );
    expect(deck.manaBase.basics.R).toBe(17);
    expect(deck.manaBase.basics.W).toBe(0);
  });
});

/**
 * The mtg-bc2.40 regression. A dual land used to count as a card in the land
 * slot and as nothing else, so the basics were apportioned as if it produced no
 * mana and the castability report never saw it. That is what made a deck of 24
 * Mountains look equivalent to one with four Sacred Foundry.
 */
describe('nonbasic lands are sources, not blanks', () => {
  it('counts a dual for both of its colors', () => {
    const deck = assembleDeck(
      [include('boros thing', '{R}{W}', 33), land('Sacred Foundry', 4, ['R', 'W'])],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );
    expect(deck.manaBase.nonBasicSources.R).toBe(4);
    expect(deck.manaBase.nonBasicSources.W).toBe(4);

    const red = deck.manaBase.reports.find((report) => report.color === 'R');
    expect(red?.basicSources).toBe(deck.manaBase.basics.R);
    expect(red?.nonBasicSources).toBe(4);
    expect(red?.sources).toBe(deck.manaBase.basics.R + 4);
  });

  it('spends the basics on what the duals do not already cover', () => {
    // Demand is 3:1 red to white, so of 24 lands red wants ~18 and white ~6.
    // Six white-producing duals cover white outright, so the basics go to red.
    const spells = [include('heavy red', '{R}{R}{R}', 9), include('splash white', '{2}{W}', 3)];
    const withoutDuals = assembleDeck(spells, criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }));
    const withDuals = assembleDeck(
      [...spells, land('Sacred Foundry', 6, ['R', 'W'])],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );

    expect(withDuals.manaBase.basics.W).toBeLessThan(withoutDuals.manaBase.basics.W);
    expect(withDuals.manaBase.basics.R + withDuals.manaBase.basics.W).toBe(18);
    // White ends up no worse off, because the duals it lost basics to make it.
    const before = withoutDuals.manaBase.reports.find((report) => report.color === 'W');
    const after = withDuals.manaBase.reports.find((report) => report.color === 'W');
    expect(after?.sources ?? 0).toBeGreaterThanOrEqual(before?.sources ?? 0);
  });

  it('makes a splash castable that basics alone could not', () => {
    // One white three-drop against 35 red cards. Apportioned by demand the
    // splash earns almost no basics and is uncastable on curve; fourteen duals
    // carry it over the 90% line without taking a slot from red.
    const spells = [include('mono red', '{R}', 35), include('white splash', '{2}{W}', 1)];
    const criteria = criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 });
    const basicsOnly = assembleDeck(spells, criteria);
    const withDuals = assembleDeck([...spells, land('Sacred Foundry', 14, ['R', 'W'])], criteria);

    const before = basicsOnly.manaBase.reports.find((report) => report.color === 'W');
    const after = withDuals.manaBase.reports.find((report) => report.color === 'W');
    expect(before?.meetsTarget).toBe(false);
    expect(after?.meetsTarget).toBe(true);
    expect(after?.castability ?? 0).toBeGreaterThan(before?.castability ?? 0);
    expect(withDuals.shortfalls).toEqual([]);
  });

  it('ignores a land that taps only for colorless', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 36), land('Mishra’s Factory', 4, [])],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );
    expect(deck.manaBase.nonBasicSources.R).toBe(0);
    expect(deck.manaBase.basics.R).toBe(20);
    expect(deck.totalCards).toBe(60);
  });

  it('does not count a dual towards a color the deck does not play', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 36), land('Sacred Foundry', 4, ['R', 'W'])],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );
    expect(deck.manaBase.nonBasicSources.W).toBe(0);
    expect(deck.manaBase.nonBasicSources.R).toBe(4);
  });

  it('lets a color be covered entirely by duals, with no basic of its own', () => {
    const deck = assembleDeck(
      [include('mostly red', '{R}{R}', 20), include('one white', '{3}{W}', 1)],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );
    const withDuals = assembleDeck(
      [include('mostly red', '{R}{R}', 20), include('one white', '{3}{W}', 1), land('dual', 3, ['R', 'W'])],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );
    expect(deck.manaBase.basics.W).toBeGreaterThan(0);
    // The floor is on sources, not on basics: three duals already supply white.
    const white = withDuals.manaBase.reports.find((report) => report.color === 'W');
    expect(white?.sources ?? 0).toBeGreaterThan(0);
  });
});

/**
 * The UB Standard control deck the mana-base beads are argued from: twenty blue
 * cards against sixteen black ones, the black half carrying twenty pips
 * including a double-black four-drop, over four Gloomlake Verge, two Dismal
 * Backwater and a Fountainport.
 */
const blue = [
  include('Consider', '{U}', 4),
  include('Counterspell', '{U}{U}', 4),
  include('Three Steps Ahead', '{1}{U}{U}', 4),
  include('Stock Up', '{2}{U}', 4),
  include('Into the Flood Maw', '{3}{U}', 4),
];
const black = [
  include('Go for the Throat', '{1}{B}', 4),
  include('Bitter Triumph', '{2}{B}', 4),
  include('Cover-Up', '{2}{B}{B}', 4),
  include('Unable to Scream', '{4}{B}', 4),
];
const duals = [land('Gloomlake Verge', 4, ['U', 'B']), land('Dismal Backwater', 2, ['U', 'B'])];
const utility = land('Fountainport', 1, []);

/**
 * The mtg-bc2.48 regression, rebuilt from the reported numbers.
 *
 * Weighted demand runs 36.2 blue to 22.8 black, so apportioning the land slot
 * proportionally gives black about ten of the twenty-four sources — thirteen
 * Island, four Swamp, blue at nineteen sources and 94%, black at ten and 79%.
 *
 * That arithmetic is self-consistent and still wrong, because castability is a
 * threshold rather than a proportion: black's cheapest card costs {1}{B} and
 * wants fifteen sources in a sixty-card deck whatever its share of the pips
 * works out to. Proportional apportionment cannot express a floor, so the build
 * raised a shortfall the reader had no way to act on.
 */
describe('castability floors', () => {
  it('names the land count when the floors do not fit the land slot', () => {
    const deck = assembleDeck(
      [...blue, ...black, ...duals, utility],
      criteriaFor({ colors: ['U', 'B'], size: 60, landCount: 24 }),
    );

    expect(deck.totalCards).toBe(60);
    const blackReport = deck.manaBase.reports.find((report) => report.color === 'B');
    expect(blackReport?.sources).toBe(11);
    expect(blackReport?.sourceFloor).toBe(16);

    // Six duals and seventeen basics cannot hold both floors at once, so the
    // split falls back to demand and the shortfall names the count that would.
    expect(deck.shortfalls).toContain(
      'B casts Cover-Up on curve only 59% of the time (target 80%): 11 sources against the 16 it needs',
    );
    expect(deck.shortfalls).toContain("meeting every color's source floor needs 31 lands; the deck runs 24");
  });

  it('gives every color its floor once the duals can hold them', () => {
    // The same deck at twenty-six lands, carried on twelve duals rather than
    // six: the land slot is unchanged and every floor is met, which is the fix
    // the shortfall is pointing at.
    const deck = assembleDeck(
      [
        ...blue.slice(0, 4),
        include('Into the Flood Maw', '{3}{U}', 2),
        ...black,
        land('Gloomlake Verge', 8, ['U', 'B']),
        land('Dismal Backwater', 4, ['U', 'B']),
        utility,
      ],
      criteriaFor({ colors: ['U', 'B'], size: 60, landCount: 26 }),
    );

    expect(deck.totalCards).toBe(60);
    expect(deck.manaBase.basics).toMatchObject({ U: 9, B: 4 });
    expect(deck.manaBase.reports.map((report) => report.sources)).toEqual([21, 16]);
    for (const report of deck.manaBase.reports) expect(report.meetsTarget).toBe(true);
    expect(deck.shortfalls).toEqual([]);
  });

  it('spends only what the floors leave over in proportion to demand', () => {
    // Twenty blue and sixteen black, less the six duals, is twenty-four of the
    // twenty-five basics. The one that is left over follows the 32.0-to-18.8
    // demand split rather than being apportioned from the start, so it lands on
    // blue and black ends exactly on its floor.
    const deck = assembleDeck(
      [...blue.slice(0, 4), ...black.slice(0, 3), ...duals, utility],
      criteriaFor({ colors: ['U', 'B'], size: 60, landCount: 32 }),
    );

    expect(deck.manaBase.basics.U + deck.manaBase.basics.B).toBe(25);
    const surplus = deck.manaBase.reports.map((report) => report.sources - report.sourceFloor);
    expect(surplus).toEqual([1, 0]);
    expect(deck.shortfalls).toEqual([]);
  });
});

/**
 * The mtg-bc2.63 regression: the floor used to be solved for one source by the
 * turn a color's *cheapest* card wants to be cast, and nothing looked at the
 * deck's heaviest requirement. Four {2}{B}{B} in sixty cards passed on black's
 * {1}{B} floor of fifteen, and on the other side a lone {3}{W} four-drop took
 * seven of a mono-red deck's seventeen lands while twenty {R}{R} two-drops kept
 * ten — enough for one red source, not for two on turn two.
 */
describe('the heaviest requirement', () => {
  /** Cards seen by the turn a card of this mana value wants to be cast, on the play. */
  const cardsSeen = (manaValue: number): number => 7 + Math.max(0, Math.ceil(manaValue) - 1);

  it('is held to a band the single-source check is not', () => {
    // The bead's case, {2}{B}{B} on turn four in sixty cards, is what pins the
    // constant at both ends. Fifteen is black's {1}{B} floor: at 0.75 the
    // double pip asks for the same number and the check would be invisible.
    // Twenty is the number two colors cannot both hold out of twenty-four
    // lands unless every land is a dual.
    expect(minSourcesFor(1, CASTABILITY_TARGET, cardsSeen(2), 60)).toBe(15);
    expect(minSourcesFor(2, 0.75, cardsSeen(4), 60)).toBe(15);
    expect(minSourcesFor(2, CASTABILITY_TARGET, cardsSeen(4), 60)).toBe(20);
    expect(minSourcesFor(2, HEAVY_CASTABILITY_TARGET, cardsSeen(4), 60)).toBe(16);
  });

  it('raises a color above the floor its cheapest card alone would ask for', () => {
    const deck = assembleDeck(
      [
        include('Go for the Throat', '{1}{B}', 4),
        include('Cover-Up', '{2}{B}{B}', 4),
        include('filler', '{1}{B}', 28),
      ],
      criteriaFor({ colors: ['B'], size: 60, landCount: 24 }),
    );

    const report = deck.manaBase.reports.find((entry) => entry.color === 'B');
    expect(report?.sourceFloor).toBe(16);
    expect(report?.binding).toMatchObject({ pips: 2, manaValue: 4, cardName: 'Cover-Up' });
  });

  it('leaves a single-pip color on the cheapest-card check', () => {
    const deck = assembleDeck(
      [include('Consider', '{U}', 4), include('Stock Up', '{2}{U}', 32)],
      criteriaFor({ colors: ['U'], size: 60, landCount: 24 }),
    );

    const report = deck.manaBase.reports.find((entry) => entry.color === 'U');
    expect(report?.sourceFloor).toBe(16);
    expect(report?.binding).toMatchObject({ pips: 1, manaValue: 1, cardName: 'Consider' });
  });

  it('does not come from a hybrid pip, which forces no color', () => {
    const deck = assembleDeck(
      [include('hybrid', '{R/W}{R/W}', 23)],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );

    for (const report of deck.manaBase.reports) {
      expect(report.binding).toMatchObject({ pips: 1 });
    }
  });

  it('gives a double-red curve the mana base a lone white splash used to take', () => {
    // Twenty {R}{R} two-drops and one {3}{W}. White's floor of seven and red's
    // single-source floor of nine fit inside seventeen lands, so red used to be
    // left on ten — enough for one red source on turn two, not for two.
    const deck = assembleDeck(
      [include('red two-drop', '{R}{R}', 20), include('white four-drop', '{3}{W}', 1)],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );

    const red = deck.manaBase.reports.find((report) => report.color === 'R');
    expect(red?.sourceFloor).toBe(12);
    expect(red?.sources).toBe(16);
    expect(red?.meetsTarget).toBe(true);

    // The splash is what the deck cannot afford, and the shortfall says so
    // rather than quietly charging red for it.
    expect(deck.manaBase.basics.W).toBe(1);
    expect(deck.shortfalls).toContain(
      'W casts white four-drop on curve only 26% of the time (target 90%): 1 sources against the 7 it needs',
    );
    expect(deck.shortfalls).toContain("meeting every color's source floor needs 19 lands; the deck runs 17");
  });

  it('reports the check that set the floor, so the count and the sentence agree', () => {
    const decks: readonly AssembledDeck[] = [
      assembleDeck(
        [
          include('Counterspell', '{U}{U}', 12),
          include('Cover-Up', '{2}{B}{B}', 12),
          land('dual', 6, ['U', 'B']),
        ],
        criteriaFor({ colors: ['U', 'B'], size: 60, landCount: 24 }),
      ),
      assembleDeck(
        [include('red two-drop', '{R}{R}', 20), include('white four-drop', '{3}{W}', 1)],
        criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
      ),
      assembleDeck(
        [include('Consider', '{U}', 4), include('Stock Up', '{2}{U}', 32)],
        criteriaFor({ colors: ['U'], size: 60, landCount: 24 }),
      ),
    ];

    for (const deck of decks) {
      for (const report of deck.manaBase.reports) {
        const check = report.binding;
        expect(check).toBeDefined();
        if (check === undefined) continue;
        const achieved = hypergeometricAtLeast(
          check.pips,
          report.sources,
          cardsSeen(check.manaValue),
          deck.totalCards,
        );
        expect(achieved).toBeCloseTo(report.castability, 12);
        // The floor is solved from the same check the report quotes, so
        // clearing the count and clearing the probability are one fact.
        expect(report.meetsTarget).toBe(report.sources >= report.sourceFloor);
        expect(report.meetsTarget).toBe(achieved >= check.target);
      }
    }
  });
});

/**
 * The mtg-bc2.74 regression: a raised floor must not lower a color's share.
 *
 * mtg-bc2.63's heavy check pushed decks that used to meet every floor into the
 * branch that meets none, and the fallback there aimed a share of the *land
 * count* at each color and subtracted that color's *sources*. Six duals are
 * six lands and twelve sources, so both colors were charged for all six and a
 * 60/40 demand split came out 20/11 — black below the fifteen the weaker
 * predicate had given it at the same land count.
 */
describe('the floors-do-not-fit fallback', () => {
  it('divides the sources by demand rather than the land count', () => {
    // The mtg-bc2.48 deck at twenty-six lands on six duals. Nineteen basics
    // over twelve dual-sources is a budget of thirty-one; 34.1 blue to 22.8
    // black divides it 19/12, where charging the duals twice gave 20/11.
    const deck = assembleDeck(
      [...blue.slice(0, 4), include('Into the Flood Maw', '{3}{U}', 2), ...black, ...duals, utility],
      criteriaFor({ colors: ['U', 'B'], size: 60, landCount: 26 }),
    );

    expect(deck.totalCards).toBe(60);
    expect(deck.manaBase.basics).toMatchObject({ U: 13, B: 6 });
    expect(deck.manaBase.reports.map((report) => report.sources)).toEqual([19, 12]);
    expect(deck.shortfalls).toContain("meeting every color's source floor needs 31 lands; the deck runs 26");
  });

  it('still spends the basics on what the nonbasics do not cover', () => {
    // Twice the red demand, and eight red-only nonbasics that have already paid
    // for it, so the sixteen basics split evenly rather than 11/5. Apportioning
    // the basics by demand alone — the obvious simplification — loses this.
    const deck = assembleDeck(
      [
        include('red two-drop', '{R}{R}', 12),
        include('white two-drop', '{W}{W}', 6),
        include('artifact filler', '{2}', 18),
        land('red utility', 8, ['R']),
      ],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );

    expect(deck.totalCards).toBe(60);
    expect(deck.manaBase.basics).toMatchObject({ R: 8, W: 8 });
    expect(deck.manaBase.reports.map((report) => report.sources)).toEqual([8, 16]);
  });

  it('does not pay a splash its floor out of the color the deck is made of', () => {
    // The alternative mtg-bc2.74 proposed — apportioning by each color's
    // distance from its own floor — reaches here. It divides seventeen lands by
    // a deficit of twelve red to seven white and hands one {3}{W} six of them,
    // which is the mono-red half of mtg-bc2.63 undone. Leveling every color
    // to the same fraction of its floor gives the same six. Demand is the only
    // signal a floor nobody can meet leaves intact.
    const deck = assembleDeck(
      [include('red two-drop', '{R}{R}', 20), include('white four-drop', '{3}{W}', 1)],
      criteriaFor({ colors: ['R', 'W'], size: 40, landCount: 17 }),
    );

    expect(deck.manaBase.basics).toMatchObject({ R: 16, W: 1 });
    const white = deck.manaBase.reports.find((report) => report.color === 'W');
    expect(white?.sourceFloor).toBe(7);
    expect(white?.sources).toBe(1);
  });
});

/**
 * The mtg-bc2.44 regression, rebuilt from the Boros Burn build the deck lab
 * produced while mtg-bc2.40 was being fixed: four Inspiring Vantage, four
 * Sunbaked Canyon, three Sacred Foundry, four Arid Mesa and a Den of the
 * Bugbear over eight Mountains.
 *
 * A fetchland taps for nothing, so Scryfall gives it no `produced_mana` and the
 * four Arid Mesa counted as four blanks. White reported eleven sources and 82%
 * against a 90% target and raised a shortfall, when every one of those fetches
 * finds a Sacred Foundry.
 */
describe('fetchlands are the sources they can find', () => {
  const burn = [
    include('Monastery Swiftspear', '{R}', 4),
    include('Goblin Guide', '{R}', 4),
    include('Kumano Faces Kakkazan', '{R}', 4),
    include('Lightning Bolt', '{R}', 4),
    include('Lava Spike', '{R}', 4),
    include('Rift Bolt', '{2}{R}', 4),
    include('Skewer the Critics', '{2}{R}', 4),
    include('Searing Blaze', '{R}{R}', 4),
    include('Lightning Helix', '{R}{W}', 4),
  ];

  it('counts a fetch for the colors of the duals it can find', () => {
    const deck = assembleDeck(
      [
        ...burn,
        land('Inspiring Vantage', 4, ['R', 'W']),
        land('Sunbaked Canyon', 4, ['R', 'W']),
        land('Sacred Foundry', 3, ['R', 'W'], 'Land — Mountain Plains'),
        land('Arid Mesa', 4, []),
        land('Den of the Bugbear', 1, ['R']),
      ],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );

    const white = deck.manaBase.reports.find((report) => report.color === 'W');
    expect(white?.sourceFloor).toBe(15);
    expect(white?.sources).toBe(15);
    expect(white?.castability).toBeGreaterThanOrEqual(CASTABILITY_TARGET);
    expect(white?.meetsTarget).toBe(true);
    expect(deck.shortfalls).toEqual([]);
  });

  it('keeps one basic for a fetch that has nothing else to find', () => {
    // Sixteen Inspiring Vantage carry both colors, so white owes no basic to
    // its floor — but an Arid Mesa cannot find an Inspiring Vantage, which is
    // printed without land types. Counting the fetch as a white source and
    // running no Plains would report sources the deck does not have.
    const deck = assembleDeck(
      [...burn, land('Inspiring Vantage', 16, ['R', 'W']), land('Arid Mesa', 4, [])],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.basics.W).toBe(1);
    expect(deck.manaBase.nonBasicSources.W).toBe(20);
  });

  it('spends no basic on a color the fetches reach through a dual', () => {
    // The same deck with the land types printed on the duals. Now the fetches
    // have something to find without a Plains, and the basics all go to red.
    const deck = assembleDeck(
      [...burn, land('Sacred Foundry', 16, ['R', 'W'], 'Land — Mountain Plains'), land('Arid Mesa', 4, [])],
      criteriaFor({ colors: ['R', 'W'], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.basics.W).toBe(0);
    expect(deck.manaBase.nonBasicSources.W).toBe(20);
  });

  it('gives a fetch nothing when the deck plays neither type it names', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 36), land('Misty Rainforest', 4, [])],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.nonBasicSources.R).toBe(0);
    expect(deck.manaBase.basics.R).toBe(20);
  });

  it('separates a fetch that takes any card of a type from one restricted to basics', () => {
    // A mono-red deck on Sacred Foundry. Windswept Heath names Plains and takes
    // any card carrying the type, so it finds the Foundry and taps for red;
    // Obscura Storefront names the same type and may only take a basic Plains,
    // which a mono-red deck does not run.
    const spells = [include('mono red', '{R}', 32)];
    const anyCard = assembleDeck(
      [...spells, land('Sacred Foundry', 4, ['R'], 'Land — Mountain Plains'), land('Windswept Heath', 4, [])],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );
    const basicsOnly = assembleDeck(
      [
        ...spells,
        land('Sacred Foundry', 4, ['R'], 'Land — Mountain Plains'),
        land('Obscura Storefront', 4, []),
      ],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );

    expect(anyCard.manaBase.nonBasicSources.R).toBe(8);
    expect(basicsOnly.manaBase.nonBasicSources.R).toBe(4);
  });
});

/**
 * The mtg-bc2.66 gap: paths a reviewer probed by hand, found sound, and left
 * unpinned, so the shipped suite covered the two-color case and nothing else.
 * Three colors, a color whose floor alone outruns the whole land slot, and the
 * invariant underneath every branch — every basic handed out, none twice, and
 * none to a color the deck does not play.
 */
describe('the split holds its shape off the two-color path', () => {
  it('gives a three-color deck exactly its land slot', () => {
    const deck = assembleDeck(
      [
        include('white two-drop', '{W}{W}', 8),
        include('blue two-drop', '{1}{U}', 8),
        include('black four-drop', '{2}{B}{B}', 8),
        include('filler', '{2}', 12),
        land('Godless Shrine', 4, ['W', 'B'], 'Land — Plains Swamp'),
        land('Watery Grave', 4, ['U', 'B'], 'Land — Island Swamp'),
      ],
      criteriaFor({ colors: ['W', 'U', 'B'], size: 60, landCount: 24 }),
    );

    expect(deck.totalCards).toBe(60);
    const { basics } = deck.manaBase;
    expect(basics.W + basics.U + basics.B).toBe(16);
    expect(basics.R + basics.G).toBe(0);
    expect(deck.manaBase.reports).toHaveLength(3);
    for (const report of deck.manaBase.reports) {
      expect(report.sources).toBe(report.basicSources + report.nonBasicSources);
      expect(report.basicSources).toBeGreaterThanOrEqual(0);
    }
  });

  it('spends the whole land slot on a color whose floor it cannot reach', () => {
    // {B}{B} on turn two wants thirteen sources in forty cards and the deck
    // runs ten lands, so no split meets the floor. The one it gets still hands
    // out every basic, and the count that would have worked is named.
    const deck = assembleDeck(
      [include('double black', '{B}{B}', 20), include('filler', '{2}', 10)],
      criteriaFor({ colors: ['B'], size: 40, landCount: 10 }),
    );

    expect(deck.totalCards).toBe(40);
    const black = deck.manaBase.reports.find((report) => report.color === 'B');
    expect(black?.sourceFloor).toBe(13);
    expect(deck.manaBase.basics.B).toBe(10);
    expect(deck.shortfalls).toContain("meeting every color's source floor needs 13 lands; the deck runs 10");
  });

  it('hands out every basic and no more, over 300 seeded deck shapes', () => {
    let rng: RngState = createRng('mtg-bc2.66');
    const pick = (bound: number): number => {
      const [value, advanced] = nextBelow(rng, bound);
      rng = advanced;
      return value;
    };

    for (let trial = 0; trial < 300; trial += 1) {
      const [order, advanced] = shuffle(COLORS, rng);
      rng = advanced;
      const colors = order.slice(0, 1 + pick(3));
      const landCount = 8 + pick(17);
      const spells = colors.map((color, index) =>
        include(
          `${color} card ${index}`,
          `{${pick(3)}}{${color}}${pick(2) === 0 ? `{${color}}` : ''}`,
          1 + pick(4),
        ),
      );
      const nonBasicLands = pick(9);
      const lands =
        nonBasicLands === 0 ? [] : [land('dual', nonBasicLands, colors.slice(0, 1 + pick(colors.length)))];

      const deck = assembleDeck([...spells, ...lands], criteriaFor({ colors, size: 60, landCount }));

      let handedOut = 0;
      for (const color of COLORS) {
        const count = deck.manaBase.basics[color];
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
        if (!colors.includes(color)) expect(count).toBe(0);
        handedOut += count;
      }
      expect(handedOut).toBe(Math.max(0, landCount - nonBasicLands));

      for (const report of deck.manaBase.reports) {
        expect(report.sources).toBe(report.basicSources + report.nonBasicSources);
        expect(Number.isInteger(report.sourceFloor)).toBe(true);
        expect(report.castability).toBeGreaterThanOrEqual(0);
        expect(report.castability).toBeLessThanOrEqual(1);
        expect(report.meetsTarget).toBe(report.sources >= report.sourceFloor);
      }
    }
  });
});
