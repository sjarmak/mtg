/**
 * A weapon is a card the deck plays.
 *
 * CR 702.6b prints its clause in the `attach` field and leaves `effects` empty,
 * so every function that reads an activated ability's payload reads nothing off
 * an equip ability. In `abilityValue` that meant a weapon scored as a blank
 * artifact — `vanillaArtifactBaseline` and a mana penalty and no text — which
 * is a negative score, which is the bottom of every pool it is ever opened in.
 * The set can print eight named weapons (Decision 12 of
 * the set design document) and the builder would sideboard all of
 * them, in every seeded pool, without a single test going red.
 *
 * The scoring assertions are `evaluate.test.ts`': a card against the same card
 * with one thing changed, so what moved the number is named rather than
 * inferred.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import { buildDeck, DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const weights = DEFAULT_SCORE_WEIGHTS;

let collector = 900;

function next(): number {
  collector += 1;
  return collector;
}

function weapon(name: string, abilities: readonly AbilityInput[], cost = 2): Card {
  const input: CardInput = {
    kind: 'artifact',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: next() },
    manaCost: { generic: cost },
    subtypes: abilities.length > 0 ? ['Equipment'] : [],
    abilities: [...abilities],
  };
  return parseCard(input);
}

function equipAbility(power: number, toughness: number, cost: number): AbilityInput {
  return {
    kind: 'activated',
    cost: { mana: { generic: cost } },
    attach: { modifications: [{ kind: 'statBonus', power, toughness }] },
    effects: [],
  };
}

/** `Equipped creature gets +2/+0.` / `Equip {2}` */
const MOONBLADE = weapon('Moonblade', [equipAbility(2, 0, 2)]);
/** The same card with the printed clause taken off: the control. */
const BLANK = weapon('Rusted Frame', []);
/** The same clause behind a cheaper cost, and a bigger clause behind the same cost. */
const CHEAP_SWORD = weapon('Traveler Sword', [equipAbility(2, 0, 1)]);
const BIG_SWORD = weapon('Bastion Sword', [equipAbility(4, 2, 2)]);
/** A clause nobody would pay for: six mana to move +1/+0. */
const TOLL_SWORD = weapon('Toll Blade', [equipAbility(1, 0, 6)]);

/** `Equipped creature has first strike.` — the layer 6 half of the vocabulary. */
const SCIMITAR = weapon('Scimitar of the Dunes', [
  {
    kind: 'activated',
    cost: { mana: { generic: 1 } },
    attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
    effects: [],
  },
]);

function score(card: Card): number {
  return evaluateCard(card, weights).score;
}

function component(card: Card, name: string): number {
  return evaluateCard(card, weights).components.find((entry) => entry.name === name)?.value ?? 0;
}

/**
 * An understatted body with one cheap keyword: a card that scores just above
 * zero, which is what makes the pool below a real competition rather than a
 * pool the weapon wins by being the only card in it.
 */
function filler(name: string, power: number, toughness: number, cost: number): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: next() },
    manaCost: { generic: cost - 1, W: 1 },
    colors: ['W'],
    keywords: ['vigilance'],
    power,
    toughness,
  });
}

describe('an equip ability on an artifact', () => {
  it('is worth more than the same artifact with no printed clause', () => {
    expect(score(BLANK)).toBeLessThan(0);
    expect(score(MOONBLADE)).toBeGreaterThan(score(BLANK));
    expect(component(MOONBLADE, 'abilities')).toBeGreaterThan(0);
    expect(component(BLANK, 'abilities')).toBe(0);
  });

  it('is worth what it grants, on the scale a printed static is worth it on', () => {
    expect(score(BIG_SWORD)).toBeGreaterThan(score(MOONBLADE));
    expect(component(BIG_SWORD, 'abilities')).toBeCloseTo(
      weights.equipHostCount *
        (4 * weights.creaturePowerWeight +
          2 * weights.creatureToughnessWeight -
          weights.activationCostPerMana * 2),
      10,
    );
  });

  it('is worth less the more equipping costs', () => {
    expect(score(MOONBLADE)).toBeLessThan(score(CHEAP_SWORD));
    expect(component(CHEAP_SWORD, 'abilities') - component(MOONBLADE, 'abilities')).toBeCloseTo(
      weights.equipHostCount * weights.activationCostPerMana,
      10,
    );
  });

  it('grants a keyword at the same flat value a static grants one', () => {
    expect(component(SCIMITAR, 'abilities')).toBeCloseTo(
      weights.equipHostCount * (weights.keywordBase.firstStrike - weights.activationCostPerMana),
      10,
    );
  });

  /**
   * Two modifications are summed, because one host gets both at once.
   *
   * The card is Last-Blow Obliterator: +99/-3, and a fact about it that used to
   * be pinned here as arithmetic is now a fact about `mtg-6zs8` instead. Before
   * that fix, `equipHostCount` multiplied a bonus of 99 power against a
   * 1-mana equip straight through, uncapped, and this test's own comment said
   * so — "the arithmetic is what makes it the loudest card in any pool it is
   * in." It scored 165.83 (rate 82.91/mana, 23x the strongest real card the
   * gate that caught it had measured), which is exactly the number this test
   * used to pin as correct. The stat half is now clamped to
   * `equipModificationCeiling` (`evaluate.ts`) before it is summed with the
   * keyword half, so the expectation below reads that clamp rather than the
   * raw printed numbers.
   */
  it('sums what a clause grants when it grants more than one thing', () => {
    const obliterator = weapon(
      'Last-Blow Obliterator',
      [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'statBonus', power: 99, toughness: -3 },
              { kind: 'grantKeyword', keyword: 'deathtouch' },
            ],
          },
          effects: [],
        },
      ],
      3,
    );
    const ceiling = weights.creatureStatBaselinePerMana * weights.formatMedianRounds;
    const rawStat = 99 * weights.creaturePowerWeight - 3 * weights.creatureToughnessWeight;
    expect(rawStat).toBeGreaterThan(ceiling); // the clamp only means something if this holds
    expect(component(obliterator, 'abilities')).toBeCloseTo(
      weights.equipHostCount * (ceiling + weights.keywordBase.deathtouch - weights.activationCostPerMana),
      10,
    );
    // The keyword half is not free, still: dropping it drops the score by
    // exactly what the same keyword is worth on a printed static, times the
    // host count. The clamp is on the stat entry alone (`evaluate.ts` argues
    // why), which is what keeps this true even though the stat entry above is
    // already saturated — a keyword grant riding beside a maxed-out stat
    // clause is not free, and this is the assertion that would catch a clamp
    // written over the clause's whole sum instead of over the one entry that
    // needs it.
    const statOnly = weapon('Blunt Obliterator', [equipAbility(99, -3, 1)], 3);
    expect(component(obliterator, 'abilities') - component(statOnly, 'abilities')).toBeCloseTo(
      weights.equipHostCount * weights.keywordBase.deathtouch,
      10,
    );
    expect(score(obliterator)).toBeGreaterThan(score(BIG_SWORD));
  });

  it('floors at the blank artifact once the cost outruns what it grants', () => {
    // Nobody is forced to equip, so a clause priced past what it does is worth
    // nothing to the card rather than worth less than nothing — the same floor
    // the effect-carrying activated branch takes, for the same reason.
    expect(component(TOLL_SWORD, 'abilities')).toBe(0);
    expect(score(TOLL_SWORD)).toBe(score(BLANK));
  });
});

/**
 * The pool assertion. Thirty playable white bodies and one weapon, for 23 spell
 * slots: the deck takes the weapon exactly when the weapon is worth more than
 * the body it displaces. Scored as a blank artifact it is the worst card in the
 * pool and all thirty bodies come ahead of it.
 *
 * The weapon is the Bastion Sword and it used to be the Moonblade, because
 * the Moonblade's margin over a vanilla body was one weight's width. Equip 2
 * for +2/+0 cleared a 4/4-for-4 while `equipHostCount` was the guessed 1.5 and
 * lost to it at the measured 0.684, so this pool was measuring the weight and
 * not the builder. What it is here to prove is that `buildDeck` will take an
 * Equipment at all — it once scored every weapon as a blank artifact — and a
 * weapon with real margin proves that without depending on which value ships.
 */
describe('a pool containing a weapon', () => {
  const PLAINS = basicLand('Plains', 'TST', 999);
  const pool: readonly Card[] = [
    BIG_SWORD,
    ...Array.from({ length: 10 }, (_unused, index) => filler(`Vantan Guard ${index + 1}`, 1, 2, 2)),
    ...Array.from({ length: 10 }, (_unused, index) => filler(`Castle Sentry ${index + 1}`, 2, 3, 3)),
    ...Array.from({ length: 10 }, (_unused, index) => filler(`Gate Warden ${index + 1}`, 3, 4, 4)),
    ...Array.from({ length: 17 }, () => PLAINS),
  ];

  it('builds a deck containing it', () => {
    const result = buildDeck(pool);
    expect(result.spells).toHaveLength(23);
    expect(result.deck.map((card) => card.name)).toContain('Bastion Sword');
  });

  it('takes it over a body the deck leaves in the sideboard', () => {
    const result = buildDeck(pool);
    const pick = result.picks.find((entry) => entry.card.name === 'Bastion Sword');
    expect(pick).toBeDefined();
    expect(result.sideboard).not.toHaveLength(0);
    for (const left of result.sideboard) {
      expect(pick?.score ?? 0).toBeGreaterThan(left.score);
    }
  });
});
