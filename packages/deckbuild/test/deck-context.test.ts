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
  counterSupply,
  deckContextOf,
  deckContextWith,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  subtypeShare,
  subtypeSupply,
} from '../src/index';

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
    expect(context.counterSources.get('gloom')).toBe(1);
    expect(context.counterSources.get('plusOnePlusOne')).toBeUndefined();
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
    expect(context.counterSources.get('hide')).toBe(2);
    expect(context.counterSources.get('wing')).toBe(1);
    expect(counterSupply(context, 'hide')).toBeGreaterThan(0);
    expect(counterSupply(context, 'wing')).toBeGreaterThan(0);
    const wider = deckContextWith(context, tokenMinter('hide-minter-c', 'hide', 'Thick Pelt'));
    expect(wider.counterSources.get('hide')).toBe(3);
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
    expect(deckContextOf([both], config).counterSources.get('hide')).toBe(1);
  });

  it('adds one card without rebuilding the whole context', () => {
    const base = deckContextOf([body('a', 2, 'Soldier', 2, 2)], config);
    const wider = deckContextWith(base, body('b', 2, 'Soldier', 2, 2));
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
