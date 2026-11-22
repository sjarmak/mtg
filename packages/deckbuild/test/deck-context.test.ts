/**
 * The deck-conditioned half of the scorer.
 *
 * Everything here asks one question: does a price change when the deck around
 * the card changes? `evaluate.test.ts` is the other half and pins the
 * context-free prices, which must not move — a card scored with no deck in
 * hand is still scored exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, CounterKind } from '@mtg/dsl';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import {
  buildDeckForPair,
  colorPairKey,
  COLOR_PAIRS,
  conditionSupply,
  counterSourceCount,
  counterSupply,
  deckContextOf,
  deckContextWith,
  deckDraws,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  expectedCounterBearers,
  hypergeometricAtLeast,
  readsTheDeck,
  subtypeShare,
  subtypeSupply,
} from '../src/index';
import { matchingPermanentSupply } from '../src/deck-context';

const WU = COLOR_PAIRS.find((pair) => colorPairKey(pair) === 'WU');
if (WU === undefined) throw new Error('COLOR_PAIRS is missing WU');

const config = DEFAULT_DECK_BUILD_CONFIG;
const weights = DEFAULT_SCORE_WEIGHTS;

let nextNumber = 1;
function card(input: Partial<CardInput> & { readonly id: string }): Card {
  nextNumber += 1;
  return parseCard({
    name: input.id,
    rarity: 'common',
    set: { code: 'SYN', collectorNumber: nextNumber },
    ...input,
  } as CardInput);
}

type Cost = Extract<CardInput, { kind: 'creature' }>['manaCost'];

function whiteCost(manaValue: number): Cost {
  return { generic: Math.max(0, manaValue - 1), W: 1 };
}

function body(id: string, manaValue: number, subtype: string, power: number, toughness: number): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: whiteCost(manaValue),
    colors: ['W'],
    subtypes: [subtype],
    power,
    toughness,
  });
}

/** A lord whose whole value is a subtype-narrowed anthem. */
function lordOf(subtype: string): Card {
  return card({
    id: `lord-of-${subtype.toLowerCase()}`,
    kind: 'creature',
    manaCost: whiteCost(3),
    colors: ['W'],
    subtypes: ['Noble'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype,
        modification: { kind: 'statBonus', power: 2, toughness: 2 },
      },
    ],
  });
}

/** Puts a gloom counter on arrival: the deck's supply of that counter. */
const gloomSource = card({
  id: 'gloom-source',
  kind: 'creature',
  manaCost: whiteCost(2),
  colors: ['W'],
  subtypes: ['Scout'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

/** Reads that counter off the board: the deck's consumer of it. */
const gloomPayoff = card({
  id: 'gloom-payoff',
  kind: 'creature',
  manaCost: whiteCost(3),
  colors: ['W'],
  subtypes: ['Horror'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 3, toughness: 3 },
      enabledWhile: { kind: 'anyCreatureHasCounter', counter: 'gloom' },
    },
  ],
});

/**
 * Reads a count off the *other* seat's graveyard: a condition no deck list
 * predicts, which is the case `conditionSupply` answers `null` for.
 */
const gravePayoff = card({
  id: 'grave-payoff',
  kind: 'creature',
  manaCost: whiteCost(3),
  colors: ['W'],
  subtypes: ['Horror'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 3, toughness: 3 },
      enabledWhile: { kind: 'opponentGraveyardAtLeast', atLeast: 10 },
    },
  ],
});

/** Reads turn history, which a deck list cannot predict or supply. */
const damagePayoff = card({
  id: 'damage-payoff',
  kind: 'creature',
  manaCost: whiteCost(2),
  colors: ['W'],
  subtypes: ['Goblin'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttack' },
      enabledWhile: { kind: 'opponentUndamagedThisTurn' },
    },
  ],
});

/** Mints Soldiers without being one: a subtype source that is not a subtype. */
const soldierToken = card({
  id: 'soldier-token-maker',
  kind: 'sorcery',
  manaCost: whiteCost(2),
  colors: ['W'],
  effects: [
    {
      kind: 'createToken',
      count: 1,
      token: { name: 'Recruit', power: 1, toughness: 1, colors: ['W'], subtypes: ['Soldier'], keywords: [] },
    },
  ],
});

/**
 * Mints a counter one layer down: the card creates a token, and the token's own
 * activated ability is what puts the counter on a creature.
 *
 * This is the shape the whole part mechanic is written in — a card that dies
 * leaves a Part behind, and sacrificing the Part is what fits the counter onto
 * something — so a census that reads only the card's own effect list sees a deck
 * full of minters as a deck that mints nothing.
 */
function tokenMinter(id: string, counter: CounterKind, tokenName: string): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: whiteCost(2),
    colors: ['W'],
    subtypes: ['Scout'],
    power: 2,
    toughness: 1,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: tokenName,
              colors: [],
              subtypes: ['Part'],
              keywords: [],
              abilities: [
                {
                  kind: 'activated',
                  cost: { mana: { generic: 0 }, sacrificeSelf: true },
                  effects: [
                    { kind: 'putCounters', counter, count: 1, target: { kind: 'targetCreatureYouControl' } },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

/** A card whose minted token is the only surface that reads the deck. */
function tokenCounterReader(id: string, counter: CounterKind): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: whiteCost(2),
    colors: ['W'],
    subtypes: ['Scout'],
    power: 2,
    toughness: 1,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: 'Recruit',
              colors: [],
              subtypes: ['Part'],
              keywords: [],
              abilities: [
                {
                  kind: 'activated',
                  cost: { mana: { generic: 1 }, sacrificeSelf: true },
                  effects: [
                    {
                      kind: 'destroyPermanent',
                      target: {
                        kind: 'targetCreature',
                        restriction: { kind: 'withCounter', counter },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

describe('deckContextOf', () => {
  it('counts a permanent under each subtype it can put on the battlefield', () => {
    const context = deckContextOf([body('a', 2, 'Soldier', 2, 2), body('b', 2, 'Beast', 2, 2)], config);
    expect(context.subtypeSources.get('Soldier')).toBe(1);
    expect(context.subtypeSources.get('Beast')).toBe(1);
    expect(context.subtypeSources.get('Zombie')).toBeUndefined();
  });

  it('counts a token maker as a source of the token subtype', () => {
    const context = deckContextOf([soldierToken], config);
    expect(context.subtypeSources.get('Soldier')).toBe(1);
    expect(context.creatureSources).toBe(1);
  });

  it('counts a counter placed from inside an ability', () => {
    const context = deckContextOf([gloomSource, body('a', 2, 'Soldier', 2, 2)], config);
    expect(counterSourceCount(context, ['gloom'])).toBe(1);
    expect(counterSourceCount(context, ['plusOnePlusOne'])).toBe(0);
  });

  /**
   * The acceptance criterion of `mtg-ibk4`: a pool whose only counter minting
   * happens inside a minted token's ability reports a source and a supply for
   * every counter it mints. Before the fix all five read zero, so a deck built
   * entirely of minters priced a counter payoff at nothing.
   */
  it('counts a counter a minted token places', () => {
    const pool = [
      tokenMinter('hide-minter-a', 'hide', 'Thick Pelt'),
      tokenMinter('hide-minter-b', 'hide', 'Thick Pelt'),
      tokenMinter('wing-minter', 'wing', 'Broad Pinion'),
    ];
    const context = deckContextOf(pool, config);
    expect(counterSourceCount(context, ['hide'])).toBe(2);
    expect(counterSourceCount(context, ['wing'])).toBe(1);
    expect(counterSupply(context, 'hide')).toBeGreaterThan(0);
    expect(counterSupply(context, 'wing')).toBeGreaterThan(0);
    const wider = deckContextWith(context, tokenMinter('hide-minter-c', 'hide', 'Thick Pelt'), weights);
    expect(counterSourceCount(wider, ['hide'])).toBe(3);
  });

  it('re-prices a card when only its minted token reads a counter from the deck', () => {
    expect(readsTheDeck(tokenCounterReader('token-reader', 'hide'), weights)).toBe(true);
  });

  /**
   * One layer is the whole depth, and it is the schema that says so:
   * `TokenEffectSchema` is the card vocabulary minus `createToken`, so a token's
   * ability cannot mint another token and there is no second layer to descend
   * into (`packages/dsl/test/token-abilities.test.ts`, "cannot carry an ability
   * that creates another token"). A card counts once per counter however many
   * ways it reaches that counter, because the hypergeometric asks how many of
   * the deck's cards are sources and a card is drawn once.
   */
  it('counts a card once for a counter it places both ways', () => {
    const both = card({
      id: 'both-ways',
      kind: 'creature',
      manaCost: whiteCost(3),
      colors: ['W'],
      subtypes: ['Scout'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            { kind: 'putCounters', counter: 'hide', count: 1, target: { kind: 'targetCreatureYouControl' } },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Thick Pelt',
                colors: [],
                subtypes: ['Part'],
                keywords: [],
                abilities: [
                  {
                    kind: 'activated',
                    cost: { mana: { generic: 0 }, sacrificeSelf: true },
                    effects: [
                      {
                        kind: 'putCounters',
                        counter: 'hide',
                        count: 1,
                        target: { kind: 'targetCreatureYouControl' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(counterSourceCount(deckContextOf([both], config), ['hide'])).toBe(1);
  });

  it('adds one card without rebuilding the whole context', () => {
    const base = deckContextOf([body('a', 2, 'Soldier', 2, 2)], config);
    const wider = deckContextWith(base, body('b', 2, 'Soldier', 2, 2), weights);
    expect(base.subtypeSources.get('Soldier')).toBe(1);
    expect(wider.subtypeSources.get('Soldier')).toBe(2);
    expect(wider.deckSize).toBe(base.deckSize);
  });

  it('rises with supply and never leaves [0, 1]', () => {
    const none = deckContextOf([body('a', 2, 'Beast', 2, 2)], config);
    const some = deckContextOf(
      Array.from({ length: 8 }, (_unused, index) => body(`s${index}`, 2, 'Soldier', 2, 2)),
      config,
    );
    expect(subtypeSupply(none, 'Soldier', 1)).toBe(0);
    expect(subtypeSupply(some, 'Soldier', 1)).toBeGreaterThan(0.8);
    expect(subtypeSupply(some, 'Soldier', 1)).toBeLessThanOrEqual(1);
    expect(subtypeShare(none, 'Soldier')).toBe(0);
    expect(subtypeShare(some, 'Soldier')).toBe(1);
    expect(counterSupply(none, 'gloom')).toBe(0);
    expect(counterSupply(deckContextOf([gloomSource], config), 'gloom')).toBeGreaterThan(0);
  });

  it('counts only exactly-one-color bodies for a monocolored permanent filter', () => {
    const monocolored = deckContextOf([body('mono', 2, 'Scout', 2, 2)], config);
    const multicolored = deckContextOf(
      [
        card({
          id: 'multi',
          kind: 'creature',
          manaCost: { W: 1, U: 1 },
          colors: ['W', 'U'],
          subtypes: ['Scout'],
          power: 2,
          toughness: 2,
        }),
      ],
      config,
    );
    const colorless = deckContextOf(
      [
        card({
          id: 'colorless',
          kind: 'artifact',
          manaCost: { generic: 2 },
          colors: [],
        }),
      ],
      config,
    );

    expect(matchingPermanentSupply(monocolored, { monocolored: true }, 1)).toBeGreaterThan(0);
    expect(matchingPermanentSupply(multicolored, { monocolored: true }, 1)).toBe(0);
    expect(matchingPermanentSupply(colorless, { monocolored: true }, 1)).toBe(0);
  });
});

describe('evaluateCard with a deck context', () => {
  it('is the shipped price when no deck is given', () => {
    for (const subject of EXAMPLE_CARDS) {
      expect(evaluateCard(subject, weights, undefined).score).toBe(evaluateCard(subject, weights).score);
    }
  });

  it('prices a tribal lord by how much of the deck is its tribe', () => {
    const lord = lordOf('Soldier');
    const flat = evaluateCard(lord, weights).score;
    const tribal = deckContextOf(
      Array.from({ length: 12 }, (_unused, index) => body(`s${index}`, 2, 'Soldier', 2, 2)),
      config,
    );
    const foreign = deckContextOf(
      Array.from({ length: 12 }, (_unused, index) => body(`b${index}`, 2, 'Beast', 2, 2)),
      config,
    );
    expect(evaluateCard(lord, weights, tribal).score).toBeGreaterThan(flat);
    expect(evaluateCard(lord, weights, foreign).score).toBeLessThan(flat);
  });

  it('prices a conditional static by whether the deck can turn it on', () => {
    const flat = evaluateCard(gloomPayoff, weights).score;
    const supplied = deckContextOf([gloomSource, gloomSource], config);
    const unsupplied = deckContextOf([body('a', 2, 'Soldier', 2, 2)], config);
    expect(evaluateCard(gloomPayoff, weights, supplied).score).toBeGreaterThan(
      evaluateCard(gloomPayoff, weights, unsupplied).score,
    );
    expect(evaluateCard(gloomPayoff, weights, unsupplied).score).toBeLessThan(flat);
  });

  it('keeps the context-free price for a condition the deck does not supply', () => {
    // The deck list says nothing about the opponent's graveyard either way, so
    // there is no supply to read and the shipped assumption survives having a
    // deck in hand. A deck that changes the price of this card would be
    // pricing it on evidence it does not have.
    const flat = evaluateCard(gravePayoff, weights).score;
    const soldiers = deckContextOf([body('a', 2, 'Soldier', 2, 2)], config);
    const gloomy = deckContextOf([gloomSource, gloomSource], config);
    expect(evaluateCard(gravePayoff, weights, soldiers).score).toBe(flat);
    expect(evaluateCard(gravePayoff, weights, gloomy).score).toBe(flat);
    const damageFlat = evaluateCard(damagePayoff, weights).score;
    expect(evaluateCard(damagePayoff, weights, soldiers).score).toBe(damageFlat);
    expect(evaluateCard(damagePayoff, weights, gloomy).score).toBe(damageFlat);
    expect(
      conditionSupply(soldiers, {
        kind: 'battlefieldCountBelow',
        filter: { subtypes: ['Island'] },
        fewerThan: 5,
      }),
    ).toBeNull();
  });

  it('names the deck-conditioned components so a price can be argued with', () => {
    const lord = lordOf('Soldier');
    const tribal = deckContextOf(
      Array.from({ length: 12 }, (_unused, index) => body(`s${index}`, 2, 'Soldier', 2, 2)),
      config,
    );
    const names = evaluateCard(lord, weights, tribal).components.map((component) => component.name);
    expect(names).toContain('abilities');
  });
});

/** Twenty-three white bodies of one tribe, spread over the target curve. */
function tribePool(subtype: string): Card[] {
  const cards: Card[] = [];
  for (const manaValue of [1, 2, 3, 4, 5, 6] as const) {
    for (let index = 0; index < 8; index += 1) {
      cards.push(
        body(`${subtype.toLowerCase()}-${manaValue}-${index}`, manaValue, subtype, manaValue, manaValue),
      );
    }
  }
  return cards;
}

describe('buildDeckForPair sees what the deck already holds', () => {
  it('takes a tribal lord when the deck is its tribe and leaves it when it is not', () => {
    const lord = lordOf('Soldier');
    const inTribe = buildDeckForPair([lord, ...tribePool('Soldier')], WU);
    const outOfTribe = buildDeckForPair([lord, ...tribePool('Beast')], WU);
    expect(inTribe.spells.map((spell) => spell.id)).toContain(lord.id);
    expect(outOfTribe.spells.map((spell) => spell.id)).not.toContain(lord.id);
  });

  it('is still a pure function of the pool', () => {
    const pool = [lordOf('Soldier'), ...tribePool('Soldier')];
    const first = buildDeckForPair(pool, WU);
    const second = buildDeckForPair(pool, WU);
    expect(second.deck.map((subject) => subject.id)).toEqual(first.deck.map((subject) => subject.id));
    expect(second.picks.map((pick) => pick.score)).toEqual(first.picks.map((pick) => pick.score));
  });
});

/**
 * `mtg-x2gb`: a clause counts permanents, so a card that mints several pays it
 * off one draw.
 *
 * The two supply questions here — a typed sacrifice cost and a `controlsSubtype`
 * condition — both read the battlefield, and the battlefield does not know how
 * many cards were spent to fill it. Everything below fixes a deck whose cards
 * mint a known number of Parts and asks whether the answer moves with the
 * permanents or with the cards.
 */
/**
 * Mints `count` Part tokens off one card.
 *
 * Every minter names its token the same: a name is not what the clauses below
 * count, and two decks that differ only in multiplicity have to differ in
 * nothing else for the comparisons to mean anything.
 */
function partMinter(id: string, count: number): Card {
  return card({
    id,
    kind: 'sorcery',
    manaCost: whiteCost(2),
    colors: ['W'],
    effects: [
      {
        kind: 'createToken',
        count,
        token: { name: 'Shard', power: 0, toughness: 1, colors: [], subtypes: ['Part'], keywords: [] },
      },
    ],
  });
}

describe('supply counts permanents rather than the cards that mint them', () => {
  const drawn = (sources: number): number =>
    hypergeometricAtLeast(1, sources, deckDraws(config), config.deckSize);

  it('pays a count-two clause off one card that mints two', () => {
    const pair = deckContextOf([partMinter('mints-two', 2)], config);
    expect(subtypeSupply(pair, 'Part', 2)).toBeCloseTo(drawn(1), 12);
  });

  it('ranks one double-minter above two single-minters for that clause', () => {
    const pair = deckContextOf([partMinter('mints-two', 2)], config);
    const singles = deckContextOf([partMinter('one-a', 1), partMinter('one-b', 1)], config);
    expect(subtypeSupply(pair, 'Part', 2)).toBeGreaterThan(subtypeSupply(singles, 'Part', 2));
    // Two cards are likelier to yield *a* Part than one card is, so the
    // ordering is the clause's, not the deck's: it flips at a count of one.
    expect(subtypeSupply(pair, 'Part', 1)).toBeLessThan(subtypeSupply(singles, 'Part', 1));
  });

  it('leaves a deck of single-minters exactly where it was', () => {
    const singles = deckContextOf(
      Array.from({ length: 5 }, (_unused, index) => partMinter(`one-${index}`, 1)),
      config,
    );
    expect(subtypeSupply(singles, 'Part', 1)).toBeCloseTo(drawn(5), 12);
    expect(subtypeSupply(singles, 'Part', 2)).toBeCloseTo(
      hypergeometricAtLeast(2, 5, deckDraws(config), config.deckSize),
      12,
    );
  });

  it('reads a printed creature and its minted token as two permanents', () => {
    // The card is a Part and mints a Part, so one draw pays a clause eating two.
    const both = card({
      id: 'part-that-mints-a-part',
      kind: 'creature',
      manaCost: whiteCost(2),
      colors: ['W'],
      subtypes: ['Part'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: { name: 'Shard', power: 0, toughness: 1, colors: [], subtypes: ['Part'], keywords: [] },
            },
          ],
        },
      ],
    });
    expect(subtypeSupply(deckContextOf([both], config), 'Part', 2)).toBeCloseTo(drawn(1), 12);
  });

  it('prices a two-Part outlet above the same outlet in a deck of single-minters', () => {
    const outlet = card({
      id: 'two-part-outlet',
      kind: 'creature',
      manaCost: whiteCost(3),
      colors: ['W'],
      subtypes: ['Scout'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, sacrificeOther: { count: 2, subtype: 'Part' } },
          effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const fed = evaluateCard(outlet, weights, deckContextOf([outlet, partMinter('mints-two', 2)], config));
    const starved = evaluateCard(
      outlet,
      weights,
      deckContextOf([outlet, partMinter('one-a', 1), partMinter('one-b', 1)], config),
    );
    expect(fed.score).toBeGreaterThan(starved.score);
  });

  it('prices a filtered two-permanent cost the same way', () => {
    // The other caller of the shared count: `sacrificeMatching` names a filter
    // instead of a subtype, and reaches the battlefield through the same walk.
    const outlet = card({
      id: 'filtered-outlet',
      kind: 'creature',
      manaCost: whiteCost(3),
      colors: ['W'],
      subtypes: ['Scout'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1 },
            sacrificeMatching: { count: 2, filter: { subtypes: ['Part'] } },
          },
          effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const fed = evaluateCard(outlet, weights, deckContextOf([outlet, partMinter('mints-two', 2)], config));
    const starved = evaluateCard(
      outlet,
      weights,
      deckContextOf([outlet, partMinter('one-a', 1), partMinter('one-b', 1)], config),
    );
    expect(fed.score).toBeGreaterThan(starved.score);
  });
});

/**
 * `mtg-cosl`: a printed quantity that counts permanents carrying a counter the
 * deck's own cards place is measured off the deck, not answered by
 * `computedAmountAssumption`.
 *
 * The bead's own measurement was that a build-around reading `countWithCounter`
 * over five counters scored the same number under four different pools.
 *
 * The sibling tally, `countMatching`, is refused, and the last test here is
 * what holds that decision in place. It looks like the same seam and is not:
 * the deck census answers a *supply*, "for each Part you control" asks a board
 * *occupancy*, and the flagship's Parts sacrifice themselves for counters, so
 * the supply runs ahead of the board by however many have been spent. Pricing
 * it off the supply anyway is measured in `mtg-q94w`: all ten flagship set
 * decks rewritten down to their mana bases and `balance.pair.BR` at 29.4%
 * against a 40% floor.
 */
describe('a count of the deck’s own permanents is measured rather than assumed', () => {
  const PARTS = ['fang', 'hide', 'horn', 'talon', 'wing'] as const;

  /** The build-around: its whole body is a rate over its own deck's counters. */
  function counterBuildAround(id: string, counters: readonly CounterKind[]): Card {
    return card({
      id,
      kind: 'creature',
      manaCost: whiteCost(4),
      colors: ['W'],
      subtypes: ['Beast'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: {
            kind: 'statBonusPer',
            power: 1,
            toughness: 1,
            each: {
              kind: 'countWithCounter',
              filter: { cardTypes: ['creature'] },
              counters: [...counters],
            },
          },
        },
      ],
    });
  }

  function counterMinter(id: string, counters: readonly CounterKind[]): Card {
    return card({
      id,
      kind: 'sorcery',
      manaCost: whiteCost(2),
      colors: ['W'],
      effects: counters.map((counter) => ({
        kind: 'putCounters' as const,
        counter,
        count: 1,
        target: { kind: 'targetCreature' as const },
      })),
    });
  }

  const minters = Array.from({ length: 13 }, (_, index) =>
    counterMinter(`minter-${index}`, [PARTS[index % PARTS.length]!]),
  );
  const blanks = Array.from({ length: 13 }, (_, index) => body(`blank-${index}`, 2, 'Bear', 2, 2));

  it('counts a card once for a tally naming two counters it both places', () => {
    // The union, not the sum: `countWithCounter` is paid per permanent carrying
    // any of the counters it names, and one card is drawn once however many of
    // them it places.
    const context = deckContextOf([counterMinter('both', ['hide', 'wing'])], config);
    expect(counterSourceCount(context, ['hide'])).toBe(1);
    expect(counterSourceCount(context, ['hide', 'wing'])).toBe(1);
  });

  it('expects one bearer per source card, drawn', () => {
    const context = deckContextOf(minters, config);
    expect(counterSourceCount(context, PARTS)).toBe(13);
    expect(expectedCounterBearers(context, PARTS)).toBeCloseTo(
      (13 * deckDraws(config)) / config.deckSize,
      12,
    );
    expect(expectedCounterBearers(deckContextOf(blanks, config), PARTS)).toBe(0);
  });

  /**
   * The bead's acceptance criterion, with the numbers it asked for. Before the
   * fix all three arms read 2.800 — the flat assumption of three, which the
   * free arm still reads because a caller with no deck has nothing else to
   * read. After it the same card is 5.250 in a deck of thirteen minters and
   * -3.200 in a deck that mints none, which is the 4-mana 2/2 it is there.
   */
  it('prices a counter build-around above its own deck and below a deck without one', () => {
    const buildAround = counterBuildAround('counter-build-around', PARTS);
    const rich = deckContextOf([buildAround, ...minters], config);
    const poor = deckContextOf([buildAround, ...blanks], config);
    expect(evaluateCard(buildAround, weights).score).toBeCloseTo(2.8, 10);
    expect(evaluateCard(buildAround, weights, rich).score).toBeCloseTo(5.25, 10);
    expect(evaluateCard(buildAround, weights, poor).score).toBeCloseTo(-3.2, 10);
    expect(readsTheDeck(buildAround, weights)).toBe(true);
  });

  it('reads the same count through a printed effect’s amount', () => {
    // The other arm: the tally is a spell's magnitude rather than a static's
    // rate, and it reaches `assumed` through the effect pricing table.
    const draw = card({
      id: 'counter-draw',
      kind: 'sorcery',
      manaCost: whiteCost(3),
      colors: ['W'],
      effects: [
        {
          kind: 'drawCards',
          count: { kind: 'countWithCounter', filter: { cardTypes: ['creature'] }, counters: [...PARTS] },
          target: { kind: 'noTarget' },
        },
      ],
    });
    const rich = evaluateCard(draw, weights, deckContextOf([draw, ...minters], config)).score;
    const poor = evaluateCard(draw, weights, deckContextOf([draw, ...blanks], config)).score;
    expect(rich).toBeGreaterThan(evaluateCard(draw, weights).score);
    expect(evaluateCard(draw, weights).score).toBeGreaterThan(poor);
    expect(readsTheDeck(draw, weights)).toBe(true);
  });

  /**
   * The decision `mtg-q94w` records, held by a test rather than by a comment.
   * `xmp-hero-s-armory`'s shape — a `countMatching` over a subtype this deck's
   * own tokens carry — is the one the flagship set actually prints, and it
   * prices the same in a deck of thirteen Part minters as in a deck of blanks.
   *
   * The measured arm for this tally is written and does move this test: it is
   * on the `mtg-q94w-occupancy` branch, and `measuredTally`'s docblock carries
   * the sweep that says why it is there and not here. What holds it off is one
   * color pair five points under the format floor (`mtg-3e2m`), so this test is
   * a record of a blocked change rather than of a settled question, and the
   * thing that unblocks it is a design pass on the set.
   */
  it('prices a subtype anthem the same however many Parts its deck mints', () => {
    const armory = card({
      id: 'part-anthem',
      kind: 'artifact',
      manaCost: { generic: 3 },
      colors: [],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: {
            kind: 'statBonusPer',
            power: 1,
            toughness: 1,
            each: { kind: 'countMatching', filter: { subtypes: ['Part'] } },
          },
        },
      ],
    });
    const rich = deckContextOf(
      [armory, ...Array.from({ length: 13 }, (_, i) => partMinter(`p${i}`, 1))],
      config,
    );
    const poor = deckContextOf([armory, ...blanks], config);
    const free = evaluateCard(armory, weights).score;
    expect(evaluateCard(armory, weights, rich).score).toBeCloseTo(free, 10);
    expect(evaluateCard(armory, weights, poor).score).toBeCloseTo(free, 10);
  });
});

/** A permanent that mints Parts from one triggered ability. */
function triggeredMinter(id: string, condition: 'beginningOfYourEndStep' | 'selfEnters' | 'selfDies'): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: whiteCost(3),
    colors: ['W'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition,
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Shard', power: 0, toughness: 1, colors: [], subtypes: ['Part'], keywords: [] },
          },
        ],
      },
    ],
  });
}

describe('a repeating minter supplies more than a one-shot', () => {
  const drawn = (sources: number): number =>
    hypergeometricAtLeast(1, sources, deckDraws(config), config.deckSize);
  const yielded = (rate: number): number => Math.max(1, Math.round(rate));

  it('mints its token once per firing of the ability that mints it', () => {
    const repeats = yielded(weights.triggerFireCount.beginningOfYourEndStep);
    const context = deckContextOf([triggeredMinter('end-step', 'beginningOfYourEndStep')], config);
    expect(repeats).toBeGreaterThan(1);
    expect(subtypeSupply(context, 'Part', repeats)).toBeCloseTo(drawn(1), 12);
    // The yield is exactly that many and not more: one card cannot pay a clause
    // asking for one Part past what its ability is measured to make.
    expect(subtypeSupply(context, 'Part', repeats + 1)).toBe(0);
  });

  it('ranks the repeating minter above the one-shot for a multi-Part clause', () => {
    const repeating = deckContextOf([triggeredMinter('end-step', 'beginningOfYourEndStep')], config);
    const once = deckContextOf([triggeredMinter('enters', 'selfEnters')], config);
    expect(subtypeSupply(repeating, 'Part', 2)).toBeGreaterThan(subtypeSupply(once, 'Part', 2));
    // Both are one card, so the ordering is the clause's and not the deck's:
    // it flattens at a count of one, which either card pays off one draw.
    expect(subtypeSupply(repeating, 'Part', 1)).toBeCloseTo(subtypeSupply(once, 'Part', 1), 12);
  });

  it('keeps a trigger that fires less than once as a source of one', () => {
    // `selfDies` is measured at 0.463 firings, which rounds to nothing. A card
    // that mints at all is a source, and the module reserves a zero for a deck
    // that genuinely cannot supply the clause.
    expect(weights.triggerFireCount.selfDies).toBeLessThan(0.5);
    const dying = deckContextOf([triggeredMinter('dies', 'selfDies')], config);
    expect(subtypeSupply(dying, 'Part', 1)).toBeCloseTo(drawn(1), 12);
    expect(subtypeSupply(dying, 'Part', 2)).toBe(0);
  });

  it('reads an activated minter through the same weight the pricing arm uses', () => {
    const printed = 3;
    const forge = card({
      id: 'part-forge',
      kind: 'artifact',
      manaCost: { generic: 2 },
      colors: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [
            {
              kind: 'createToken',
              count: printed,
              token: {
                name: 'Shard',
                power: 0,
                toughness: 1,
                colors: [],
                subtypes: ['Part'],
                keywords: [],
              },
            },
          ],
        },
      ],
    });
    const uses = yielded(printed * weights.activationUseCount);
    const context = deckContextOf([forge], config);
    expect(uses).not.toBe(printed);
    expect(subtypeSupply(context, 'Part', uses)).toBeCloseTo(drawn(1), 12);
    expect(subtypeSupply(context, 'Part', uses + 1)).toBe(0);
  });
});
