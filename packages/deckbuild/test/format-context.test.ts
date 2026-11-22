/**
 * Landwalk, protection and intimidate are priced against the format, not
 * against a prior that stood in for one (`mtg-embd`, `mtg-qlpi`).
 *
 * Four of `DEFAULT_KEYWORD_ABILITY_VALUE`'s numbers were guesses about the
 * *opponent's* deck, and each said so in its own docblock: 0.6
 * (`enabledWhileFactor`) for how often a landwalk finds the basic land type it
 * names and again for how often an intimidate finds nothing that can block it,
 * 2/5 folded into `protection`'s body share for how often an opposing
 * two-color deck plays a named color, and 0.5 (`staticSubtypeReachFactor`,
 * borrowed from a question about the deck being built) for how much of a board
 * a named creature type is. None of them was measured, and all of them are
 * measurable off the set the deck is being built for.
 *
 * What these pin is that each price now moves with a census and not with a
 * constant. Two shapes of assertion do that, and both are needed:
 *
 *  - **The price equals the census times the rate**, restated here from the
 *    weights rather than copied as a literal, so retuning flying moves the
 *    expectation with the code.
 *  - **The price changes when the census changes**, over two sets that differ
 *    only in what they print. A number that happened to equal a census once is
 *    caught by the first and not the second.
 *
 * The shipped constants are still what a caller that stated no set gets, and
 * the last block here proves that arm is the one every existing score was taken
 * under: no set in the repository prints a landwalk, a protection or an
 * intimidate, so every card of the flagship prices identically with a format
 * and without one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Ability,
  AuraModification,
  Card,
  CardInput,
  Color,
  KeywordAbility,
  StaticModification,
} from '@mtg/dsl';
import { BASIC_LAND_COLOR, COLORS, parseCard } from '@mtg/dsl';
import type { DeckContext } from '@mtg/deckbuild';
import {
  abilityValue,
  bodyValue,
  COLOR_PAIRS,
  COLORS_PER_DECK,
  colorSharesOf,
  DEFAULT_KEYWORD_ABILITY_VALUE,
  DEFAULT_SCORE_WEIGHTS,
  deckContextOf,
  evaluateCard,
  formatColorShare,
  formatContextOf,
  formatIntimidateShare,
  formatLandwalkShare,
  formatSubtypeShare,
  resolveConfig,
} from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;
const ABILITY = DEFAULT_KEYWORD_ABILITY_VALUE;

function creature(
  id: string,
  colors: readonly Color[],
  overrides: Partial<CardInput> = {},
  power = 3,
  toughness = 3,
): Card {
  return parseCard({
    kind: 'creature',
    id,
    name: `Test ${id}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, ...Object.fromEntries(colors.map((color) => [color, 1])) },
    colors: [...colors],
    power,
    toughness,
    ...overrides,
  } as CardInput);
}

/** One creature per color: the even format the shipped 2/5 assumed. */
function evenSet(): readonly Card[] {
  return COLORS.map((color, index) => creature(`even-${String(index)}`, [color]));
}

/** `count` cards of `color` among `size`, the rest dealt round-robin off it. */
function skewedSet(color: Color, count: number, size: number): readonly Card[] {
  const others = COLORS.filter((other) => other !== color);
  return Array.from({ length: size }, (_, index) =>
    creature(`skew-${String(index)}`, [
      index < count ? color : (others[(index - count) % others.length] ?? 'W'),
    ]),
  );
}

/** `count` of `size` creatures carry the subtype; the rest carry another. */
function tribalSet(subtype: string, count: number, size: number): readonly Card[] {
  return Array.from({ length: size }, (_, index) =>
    creature(`tribe-${String(index)}`, ['G'], { subtypes: [index < count ? subtype : 'Beast'] }),
  );
}

/** A one-card deck, so the only thing that differs between two contexts is the format. */
function contextFor(subject: Card, set: readonly Card[] | null): DeckContext {
  return deckContextOf([subject], resolveConfig(set === null ? {} : { set }));
}

/** What the abilities are worth on that body, against a stated format or none. */
function delta(abilities: readonly KeywordAbility[], set: readonly Card[] | null, power = 3): number {
  const vanilla = creature('subject', ['G'], {}, power);
  const carrier = creature('subject', ['G'], { keywordAbilities: [...abilities] }, power);
  return (
    evaluateCard(carrier, WEIGHTS, contextFor(carrier, set)).score -
    evaluateCard(vanilla, WEIGHTS, contextFor(vanilla, set)).score
  );
}

/** The stat contribution the survival abilities take a share of. */
function stats(power: number, toughness: number): number {
  return bodyValue(power, toughness, [], [], [], WEIGHTS, undefined);
}

/**
 * Flying's pair at a share, which is `conditionalEvasionValue` restated.
 *
 * One helper for both evasion blocks below, because landwalk and intimidate are
 * one expression at two shares and a second copy of it here would let the two
 * expectations drift apart in a file whose whole subject is that they cannot.
 */
function evasion(power: number, share: number): number {
  return (WEIGHTS.keywordBase.flying + WEIGHTS.keywordPowerScale.flying * power) * share;
}

describe('the color census', () => {
  it('covers as many colors as a deck of this format plays', () => {
    // Two derivations of one fact, pinned to each other: `buildDeck` plays the
    // winner of `COLOR_PAIRS` and a pair is a pair, so a builder that learned
    // to play three colors would fail here rather than leave the census
    // quietly measuring the wrong format.
    expect(COLORS_PER_DECK).toBe(COLOR_PAIRS[0]?.length);
  });

  it('measures an evenly colored set at exactly the share the constants assumed', () => {
    const shares = colorSharesOf(evenSet());
    for (const color of COLORS) expect(shares[color]).toBeCloseTo(COLORS_PER_DECK / COLORS.length, 10);
  });

  it('moves with what the set prints', () => {
    // Two of eight cards are blue and one is red, so a two-color deck of this
    // format plays blue half the time and red a quarter of it.
    expect(colorSharesOf(skewedSet('U', 2, 8)).U).toBeCloseTo(0.5, 10);
    expect(colorSharesOf(skewedSet('U', 2, 8)).R).toBeCloseTo(0.25, 10);
  });

  it('clamps a mono-color format at every deck rather than at two of them', () => {
    expect(colorSharesOf(skewedSet('R', 6, 6)).R).toBe(1);
    expect(colorSharesOf(skewedSet('R', 6, 6)).W).toBe(0);
  });

  it('counts a gold card for both its colors and a colorless card for none', () => {
    const gold = colorSharesOf([creature('gold', ['W', 'U'])]);
    expect(gold.W).toBe(1);
    expect(gold.U).toBe(1);
    const colorless = colorSharesOf([creature('rock', [])]);
    for (const color of COLORS) expect(colorless[color]).toBe(0);
  });

  it('reads a landwalk through the color its basic type makes', () => {
    const format = formatContextOf(skewedSet('G', 4, 8));
    expect(formatLandwalkShare(format, 'Forest')).toBe(formatColorShare(format, BASIC_LAND_COLOR.Forest));
    expect(formatLandwalkShare(format, 'Forest')).toBeGreaterThan(formatLandwalkShare(format, 'Island'));
  });
});

describe('the creature-subtype census', () => {
  it('is the share of the format that can put one on the battlefield', () => {
    expect(formatSubtypeShare(formatContextOf(tribalSet('Merfolk', 3, 10)), 'Merfolk')).toBeCloseTo(0.3, 10);
  });

  it('reads a subtype nobody prints as the zero it is', () => {
    expect(formatSubtypeShare(formatContextOf(tribalSet('Merfolk', 3, 10)), 'Sliver')).toBe(0);
  });

  it('counts a minted token, because an opposing token is a creature to get through', () => {
    const minter = creature('minter', ['G'], {
      subtypes: ['Beast'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Merfolk',
                subtypes: ['Merfolk'],
                power: 1,
                toughness: 1,
                keywords: [],
                colors: ['U'],
              },
            },
          ],
        },
      ],
    });
    const format = formatContextOf([minter, creature('plain', ['G'], { subtypes: ['Beast'] })]);
    expect(formatSubtypeShare(format, 'Merfolk')).toBeCloseTo(0.5, 10);
  });

  it('measures the same set the same way however the list was assembled', () => {
    const set = tribalSet('Merfolk', 3, 10);
    expect(formatSubtypeShare(formatContextOf([...set]), 'Merfolk')).toBe(
      formatSubtypeShare(formatContextOf(set), 'Merfolk'),
    );
  });
});

/** A creature card that also mints a creature token, of stated colors. */
function minter(id: string, colors: readonly Color[], token: readonly Color[]): Card {
  return creature(id, colors, {
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: 'Servant',
              subtypes: ['Servant'],
              power: 1,
              toughness: 1,
              keywords: [],
              colors: [...token],
            },
          },
        ],
      },
    ],
  });
}

describe('the creature-color census', () => {
  it('reads an evenly colored format as every creature but the ones sharing a color', () => {
    // Five creatures, one per color, so each color is a fifth of what could
    // block and an intimidator gets past the other four fifths.
    const format = formatContextOf(evenSet());
    expect(formatIntimidateShare(format, ['G'])).toBeCloseTo(0.8, 10);
  });

  it("subtracts each of a two-color creature's colors once and no card twice", () => {
    // The whole reason the census is keyed by a card's color identity rather
    // than by one color at a time. A gold WU blocker is one card; reading the
    // share as 1 - W - U would subtract it for W and again for U and hand a WU
    // attacker a share below the third of the format that is actually blind to
    // it.
    const format = formatContextOf([
      creature('gold', ['W', 'U']),
      creature('mono-w', ['W']),
      creature('mono-u', ['U']),
    ]);
    expect(formatIntimidateShare(format, ['W', 'U'])).toBe(0);
    expect(formatIntimidateShare(format, ['W'])).toBeCloseTo(1 / 3, 10);
    expect(formatIntimidateShare(format, ['B'])).toBe(1);
  });

  it('lets an artifact creature block whatever colors either of them is', () => {
    // CR 702.13a's second clause, and the only reason the census needs the
    // card types at all. The two sets differ in one boolean.
    const colored = [creature('w1', ['W']), creature('w2', ['W']), creature('w3', ['W'])];
    const plain = formatContextOf([creature('rock', []), ...colored]);
    const armored = formatContextOf([creature('rock', [], { artifact: true }), ...colored]);
    expect(formatIntimidateShare(plain, ['G'])).toBe(1);
    expect(formatIntimidateShare(armored, ['G'])).toBeCloseTo(0.75, 10);
  });

  it('reads a colorless intimidator as live against everything but the artifacts', () => {
    // It shares a color with nothing, so the color clause stops none of the
    // format and the artifact clause stops all of what it stops.
    const set = [creature('rock', [], { artifact: true }), creature('w1', ['W']), creature('u1', ['U'])];
    expect(formatIntimidateShare(formatContextOf(set), [])).toBeCloseTo(2 / 3, 10);
  });

  it('counts a minted token, because an opposing token is a creature to be blocked by', () => {
    // The same descent the subtype census makes, and the same argument: a green
    // card that mints a blue token can block a blue intimidator, so the key is
    // the union of the colors the card can put on the battlefield.
    const format = formatContextOf([minter('minter', ['G'], ['U']), creature('plain', ['G'])]);
    expect(formatIntimidateShare(format, ['U'])).toBeCloseTo(0.5, 10);
    expect(formatIntimidateShare(format, ['G'])).toBe(0);
  });

  it('reads a format with no creatures in it as nothing to get past', () => {
    expect(formatIntimidateShare(formatContextOf([]), ['G'])).toBe(0);
  });
});

describe('landwalk is priced at the share of decks that play its basic type', () => {
  const forestwalk: readonly KeywordAbility[] = [{ kind: 'landwalk', landType: 'Forest' }];

  it('prices it at flying times the measured share', () => {
    const set = skewedSet('G', 2, 8);
    const share = formatColorShare(formatContextOf(set), 'G');
    expect(delta(forestwalk, set)).toBeCloseTo(evasion(3, share), 10);
  });

  it('moves when the format prints more forests to walk over', () => {
    const scarce = delta(forestwalk, skewedSet('G', 1, 10));
    const common = delta(forestwalk, skewedSet('G', 4, 10));
    expect(common).toBeGreaterThan(scarce);
    // The two prices are one expression at two shares, so their ratio is the
    // shares' ratio: what moved is the census and nothing else.
    expect(common / scarce).toBeCloseTo(4, 10);
  });

  it('keeps the shipped row for a caller that stated no set', () => {
    expect(delta(forestwalk, null)).toBeCloseTo(ABILITY.landwalk.flat + ABILITY.landwalk.perPower * 3, 10);
    // And the row is that same expression at the constant it stood in for, so
    // the two arms are one derivation rather than two numbers that agree today.
    expect(delta(forestwalk, null)).toBeCloseTo(evasion(3, WEIGHTS.enabledWhileFactor), 10);
  });
});

describe('intimidate is priced at the share of the format that cannot block it', () => {
  const intimidate: readonly KeywordAbility[] = [{ kind: 'intimidate' }];

  it('prices it at flying times the measured share', () => {
    // `delta` prices a green creature, so the share is read for green.
    const set = skewedSet('G', 2, 8);
    const share = formatIntimidateShare(formatContextOf(set), ['G']);
    expect(share).toBeCloseTo(0.75, 10);
    expect(delta(intimidate, set)).toBeCloseTo(evasion(3, share), 10);
  });

  it("moves when the format prints more of the creature's own color to block it", () => {
    const scarce = delta(intimidate, skewedSet('G', 1, 10));
    const crowded = delta(intimidate, skewedSet('G', 4, 10));
    expect(crowded).toBeLessThan(scarce);
    // Nine of ten cards are blind to green in the first format and six of ten
    // in the second, and the two prices are one expression at those two shares.
    expect(scarce / crowded).toBeCloseTo(1.5, 10);
  });

  it('is worth less to a gold creature than to either of its halves', () => {
    // Two colors is two ways to be blocked, which is the arithmetic that made
    // this ability a different reading of the census rather than landwalk's.
    const set = skewedSet('G', 2, 8);
    const format = formatContextOf(set);
    expect(formatIntimidateShare(format, ['G', 'W'])).toBeLessThan(formatIntimidateShare(format, ['G']));
  });

  it('keeps the shipped row for a caller that stated no set', () => {
    expect(delta(intimidate, null)).toBeCloseTo(
      ABILITY.intimidate.flat + ABILITY.intimidate.perPower * 3,
      10,
    );
    // And that row is the same expression at the constant it stood in for, so
    // the measured arm and the shipped one are one derivation. It is landwalk's
    // constant because it was landwalk's row: both shipped as flying's pair at
    // `enabledWhileFactor`, and what parts them now is which census they read.
    expect(delta(intimidate, null)).toBeCloseTo(evasion(3, WEIGHTS.enabledWhileFactor), 10);
  });
});

describe('protection is priced at the share of the format it is live against', () => {
  const fromBlue: readonly KeywordAbility[] = [
    { kind: 'protection', quality: { kind: 'color', color: 'U' } },
  ];
  const fromMerfolk: readonly KeywordAbility[] = [
    { kind: 'protection', quality: { kind: 'subtype', subtype: 'Merfolk' } },
  ];

  it('states the shipped row as the live share at the even-format color census', () => {
    expect(ABILITY.protection.bodyShare).toBeCloseTo(
      WEIGHTS.protectionLiveBodyShare * (COLORS_PER_DECK / COLORS.length),
      10,
    );
  });

  it('prices the color quality at the live share times the measured one', () => {
    const set = skewedSet('U', 2, 8);
    const share = formatColorShare(formatContextOf(set), 'U');
    expect(delta(fromBlue, set)).toBeCloseTo(WEIGHTS.protectionLiveBodyShare * share * stats(3, 3), 10);
  });

  it('prices the subtype quality at the live share times the creature census', () => {
    const set = tribalSet('Merfolk', 3, 10);
    expect(delta(fromMerfolk, set)).toBeCloseTo(WEIGHTS.protectionLiveBodyShare * 0.3 * stats(3, 3), 10);
  });

  it('moves when the format prints more of the creature type', () => {
    const scarce = delta(fromMerfolk, tribalSet('Merfolk', 1, 10));
    const common = delta(fromMerfolk, tribalSet('Merfolk', 5, 10));
    expect(common / scarce).toBeCloseTo(5, 10);
  });

  it('is worth nothing against a creature type the format never prints', () => {
    // A measurement rather than a missing answer: protection from Sliver in a
    // format with no Slivers stops nothing, and the shipped 0.5 borrowed from
    // `staticSubtypeReachFactor` would have charged half a board for it.
    expect(delta(fromMerfolk, tribalSet('Beast', 10, 10))).toBe(0);
  });

  it('keeps the shipped rows for a caller that stated no set', () => {
    expect(delta(fromBlue, null)).toBeCloseTo(ABILITY.protection.bodyShare * stats(3, 3), 10);
    expect(delta(fromMerfolk, null)).toBeCloseTo(
      ABILITY.protection.bodyShare * WEIGHTS.staticSubtypeReachFactor * stats(3, 3),
      10,
    );
  });
});

/**
 * One member of a bundled grant.
 *
 * Derived from the modification rather than restated, because `@mtg/dsl`
 * exports the schema and not the inferred type, and a hand-written union here
 * would be a second spelling of a list this file does not own.
 */
type GrantedKeywordAbility = Extract<StaticModification, { kind: 'grantKeywordAbilities' }>['grants'][number];

describe('a static grant is priced against the format and the board it reaches', () => {
  const REACH = WEIGHTS.staticScopeReach.creaturesYouControl;

  /** One anthem-scoped bundle of grants; `REACH` is the whole of its multiplier. */
  function grant(grants: readonly GrantedKeywordAbility[]): Ability {
    return {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'grantKeywordAbilities', grants: [...grants] },
    };
  }

  /** An Aura carrying one clause, priced through `evaluateCard`'s aura component. */
  function aura(modifications: readonly AuraModification[]): Card {
    return parseCard({
      kind: 'enchantment',
      id: 'aura',
      name: 'Test Aura',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      subtypes: ['Aura'],
      aura: { enchant: 'creature', modifications: [...modifications] },
    } as CardInput);
  }

  const islandwalk = grant([{ kind: 'landwalk', landType: 'Island' }]);
  const fromBlue = grant([{ kind: 'protection', quality: { kind: 'color', color: 'U' } }]);
  const fromMerfolk = grant([{ kind: 'protection', quality: { kind: 'subtype', subtype: 'Merfolk' } }]);
  const subject = creature('subject', ['G']);

  it('prices a granted landwalk at flying times the measured share', () => {
    // Flying's base and no rate: the rate reads the body carrying the word, and
    // the bodies a static grant reaches are not this card's.
    const set = skewedSet('U', 2, 8);
    const share = formatLandwalkShare(formatContextOf(set), 'Island');
    expect(abilityValue(islandwalk, WEIGHTS, contextFor(subject, set))).toBeCloseTo(
      REACH * WEIGHTS.keywordBase.flying * share,
      10,
    );
  });

  it('moves a granted landwalk when the format prints more islands to walk over', () => {
    const scarce = abilityValue(islandwalk, WEIGHTS, contextFor(subject, skewedSet('U', 1, 10)));
    const common = abilityValue(islandwalk, WEIGHTS, contextFor(subject, skewedSet('U', 4, 10)));
    expect(common / scarce).toBeCloseTo(4, 10);
  });

  it('keeps the shipped flat row for a granted landwalk when no set is stated', () => {
    const flat = REACH * ABILITY.landwalk.flat;
    expect(abilityValue(islandwalk, WEIGHTS)).toBeCloseTo(flat, 10);
    expect(abilityValue(islandwalk, WEIGHTS, contextFor(subject, null))).toBeCloseTo(flat, 10);
  });

  it('prices a granted protection against the bodies the deck can put out', () => {
    // The defect `mtg-6f2g` names, from the other side: the whole of
    // protection's price is a share of a body, the body a static reaches is not
    // this card's, so the arm that read `flat` alone read a zero. A stated deck
    // has bodies in it, and this one has a single 3/3 in it.
    const set = skewedSet('U', 2, 8);
    const share = formatColorShare(formatContextOf(set), 'U');
    expect(abilityValue(fromBlue, WEIGHTS, contextFor(subject, set))).toBeCloseTo(
      REACH * WEIGHTS.protectionLiveBodyShare * share * stats(3, 3),
      10,
    );
  });

  it('prices a granted protection at the shipped row against a deck with no set stated', () => {
    expect(abilityValue(fromBlue, WEIGHTS, contextFor(subject, null))).toBeCloseTo(
      REACH * ABILITY.protection.bodyShare * stats(3, 3),
      10,
    );
    expect(abilityValue(fromMerfolk, WEIGHTS, contextFor(subject, null))).toBeCloseTo(
      REACH * ABILITY.protection.bodyShare * WEIGHTS.staticSubtypeReachFactor * stats(3, 3),
      10,
    );
  });

  it('keeps the zero a caller with no deck at all has always been given', () => {
    // Not an oversight preserved: every score taken before a deck exists is
    // taken on this arm (`color-pair.ts` ranks the pairs first), and there is
    // no measured body for an unknown board to take a share of. The row it
    // reads is 0, and the assertion says so outright rather than restating the
    // weight, because a row that stopped being zero should fail here and be
    // read again.
    expect(ABILITY.protection.flat).toBe(0);
    expect(abilityValue(fromBlue, WEIGHTS)).toBe(0);
  });

  it('moves a granted protection when the format prints more of the color', () => {
    const scarce = abilityValue(fromBlue, WEIGHTS, contextFor(subject, skewedSet('U', 1, 10)));
    const common = abilityValue(fromBlue, WEIGHTS, contextFor(subject, skewedSet('U', 4, 10)));
    expect(common / scarce).toBeCloseTo(4, 10);
  });

  it('reads an Aura landwalk clause off the same census the bundled grant reads', () => {
    // The Aura arm spelled the constant out where the bundle named the row, and
    // one number written twice is two chances to measure only one of them.
    const clause = aura([{ kind: 'grantLandwalk', landType: 'Island' }]);
    const scarce = evaluateCard(clause, WEIGHTS, contextFor(clause, skewedSet('U', 1, 10))).score;
    const common = evaluateCard(clause, WEIGHTS, contextFor(clause, skewedSet('U', 4, 10))).score;
    expect(common - scarce).toBeCloseTo(WEIGHTS.keywordBase.flying * (0.8 - 0.2), 10);
    expect(evaluateCard(clause, WEIGHTS, contextFor(clause, null)).score).toBeCloseTo(
      evaluateCard(clause, WEIGHTS).score,
      10,
    );
  });
});

/**
 * `cantBeBlockedBySubtype` and the trigger an Aura hands its host (`mtg-y93l`).
 *
 * Two more value functions holding a context and not reading it, both found
 * while the three keyword rows above were being measured. The static's whole
 * value is a count of the opposing board — how many Walls a "can't be blocked
 * by Walls" gets past — which is the census question, and the Aura's granted
 * trigger is the same text the host could have printed, priced by the same
 * function against the same deck.
 */
describe('the two clauses that were holding a context and not reading it', () => {
  const WALLS = 'Wall';

  /** An Aura carrying one clause; the second copy of the helper one block up. */
  function aura(modifications: readonly AuraModification[]): Card {
    return parseCard({
      kind: 'enchantment',
      id: 'granting-aura',
      name: 'Granting Aura',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      subtypes: ['Aura'],
      aura: { enchant: 'creature', modifications: [...modifications] },
    } as CardInput);
  }

  /** The Aura clause's own component, which is the only one under test here. */
  function auraComponent(card: Card, context: DeckContext): number {
    return evaluateCard(card, WEIGHTS, context).components.find((part) => part.name === 'aura')?.value ?? 0;
  }

  /** A body that places the counter the granted trigger wants to point at. */
  function minter(): Card {
    return creature('minter', ['G'], {
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
          ],
        },
      ],
    });
  }

  /** Juggernaut's second line, on a body whose power the static can see. */
  function unblockableBy(subtype: string, power: number): Card {
    return creature(
      'subject',
      ['G'],
      {
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'cantBeBlockedBySubtype', subtype },
          },
        ],
      },
      power,
    );
  }

  /** What the clause is worth on that body against that format: the whole delta. */
  function blockDelta(set: readonly Card[] | null, power = 3): number {
    const carrier = unblockableBy(WALLS, power);
    const vanilla = creature('subject', ['G'], {}, power);
    return (
      evaluateCard(carrier, WEIGHTS, contextFor(carrier, set)).score -
      evaluateCard(vanilla, WEIGHTS, contextFor(vanilla, set)).score
    );
  }

  it('prices evasion against a creature type at flying times the share carrying it', () => {
    const set = tribalSet(WALLS, 3, 12);
    const share = formatSubtypeShare(formatContextOf(set), WALLS);
    expect(share).toBeCloseTo(0.25, 10);
    expect(blockDelta(set)).toBeCloseTo(evasion(3, share), 10);
  });

  it('is worth more in a format full of the type than in one with none of it', () => {
    const crowded = blockDelta(tribalSet(WALLS, 8, 12));
    const scarce = blockDelta(tribalSet(WALLS, 2, 12));
    expect(crowded).toBeGreaterThan(scarce);
    expect(crowded / scarce).toBeCloseTo(4, 10);
    // A format printing none of the type is the measured zero, not the absent
    // one: the word gets past nothing, and that is an answer.
    expect(blockDelta(tribalSet('Beast', 12, 12))).toBeCloseTo(0, 10);
  });

  it('stays at zero for a caller that stated no set, because nothing else can answer it', () => {
    expect(blockDelta(null)).toBe(0);
  });

  it('prices a granted trigger against the deck the same trigger would be priced against', () => {
    // The Aura hands its host a "destroy target creature with a +1/+1 counter
    // on it", and whether this deck can point that at anything is what
    // `counterSupply` answers. Before this the Aura arm dropped the context and
    // asked nobody.
    const trigger: Ability = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetCreature', restriction: { kind: 'withCounter', counter: 'plusOnePlusOne' } },
        },
      ],
    };
    const card = aura([{ kind: 'grantTriggeredAbility', ability: trigger }]);
    const supplied = deckContextOf([minter()], resolveConfig({}));
    const barren = deckContextOf([creature('inert', ['G'])], resolveConfig({}));

    expect(auraComponent(card, supplied)).toBeCloseTo(Math.abs(abilityValue(trigger, WEIGHTS, supplied)), 10);
    expect(auraComponent(card, barren)).toBeCloseTo(Math.abs(abilityValue(trigger, WEIGHTS, barren)), 10);
    // Not a vacuous pair: the two contexts price the same clause differently,
    // which is the whole of what the dropped argument was hiding.
    expect(auraComponent(card, supplied)).not.toBeCloseTo(auraComponent(card, barren), 10);
  });
});

describe('the format arm reaches nothing that shipped', () => {
  const SET_PATH = fileURLToPath(
    new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
  );

  function flagship(): readonly Card[] {
    const raw = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { readonly cards: readonly unknown[] };
    return raw.cards.map((card) => parseCard(card));
  }

  it('prices every card of the flagship identically with a format and without one', () => {
    // The whole of why this change cannot move the balance gate: no set in the
    // repository prints any of the three, so the two arms are the same arm on
    // every card anybody has scored. A card that starts printing one is
    // supposed to fail here, and the fix is to read the new prices rather than
    // to delete the case.
    const set = flagship();
    expect(set.length).toBeGreaterThan(0);
    for (const card of set) {
      const measured = evaluateCard(card, WEIGHTS, contextFor(card, set)).score;
      const assumed = evaluateCard(card, WEIGHTS, contextFor(card, null)).score;
      expect(measured, `${card.id} is priced differently once the format is measured`).toBeCloseTo(
        assumed,
        10,
      );
    }
  });
});
