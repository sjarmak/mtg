/**
 * The two card kinds whose text this evaluator could not see.
 *
 * Both holes were found the same way: the flagship set grew six enchantments
 * and two planeswalkers, and the builder's ranking of the 261-card pool put
 * both walkers in the top three and five of the six enchantments below a blank
 * card. Neither number was about the cards.
 *
 *  - An Aura's whole clause lives in `card.aura`. `evaluateCard` read
 *    `effects` and `abilities`, so every Aura priced at its mana penalty and
 *    nothing else, which is a negative score: the builder rated Pacifism below
 *    a card with no text. `isRemovalCard` had the same blind spot, so a deck
 *    holding four of them counted zero answers.
 *  - A loyalty ability went through the generic activated arm, which pays no
 *    attention to CR 606.3. Nothing was subtracted for the cost (a loyalty
 *    ability spends no mana), `activationUses` handed back the flat
 *    `activationUseCount`, and the three printed abilities were *summed* -
 *    pricing a walker for a turn in which it activates all three.
 *
 * The expectations below are written against `DEFAULT_SCORE_WEIGHTS` by name
 * rather than as literals wherever the point is a relation between weights, so
 * a retune moves them together. Literals appear only where the point is the
 * arithmetic itself.
 */
import { describe, expect, it } from 'vitest';
import type { AuraModification, Card, CardInput, Keyword } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard, isRemovalCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

/** A two-mana white Aura carrying exactly the clause under test. */
function aura(modifications: readonly AuraModification[]): Card {
  return parseCard({
    kind: 'enchantment',
    id: 'tst-aura',
    name: 'Test Aura',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Aura'],
    aura: { enchant: 'creature', modifications },
  } as CardInput);
}

function statBonus(power: number, toughness: number): AuraModification {
  return { kind: 'statBonus', power, toughness };
}

function grantKeyword(keyword: Keyword): AuraModification {
  return { kind: 'grantKeyword', keyword };
}

/** The named component's value, or 0 where the card contributed none. */
function componentOf(card: Card, name: string): number {
  const found = evaluateCard(card, WEIGHTS).components.find((component) => component.name === name);
  return found?.value ?? 0;
}

function auraComponent(modifications: readonly AuraModification[]): number {
  return componentOf(aura(modifications), 'aura');
}

/** A four-mana walker carrying exactly the loyalty abilities under test. */
function walker(startingLoyalty: number, abilities: readonly unknown[]): Card {
  return parseCard({
    kind: 'planeswalker',
    id: 'tst-walker',
    name: 'Test Walker',
    rarity: 'mythic',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 3, W: 1 },
    colors: ['W'],
    supertypes: ['legendary'],
    subtypes: ['Test'],
    startingLoyalty,
    abilities,
  } as CardInput);
}

/** `[N]: You gain `amount` life.`, the cheapest effect to price by hand. */
function lifeAbility(loyaltyCost: number, amount: number): unknown {
  return {
    kind: 'activated',
    loyaltyCost,
    cost: { mana: {} },
    effects: [{ kind: 'gainLife', amount, target: { kind: 'noTarget' } }],
  };
}

function gainLifeValue(amount: number): number {
  const row = WEIGHTS.effectValue.gainLife;
  return row.base + row.perUnit * amount;
}

describe('an Aura is priced by its clause', () => {
  it('scores above a card with no text at all, which is the bug', () => {
    // The whole failure in one assertion. Before the aura component existed
    // this was `-spellManaPenaltyPerMana * 2`, so the builder preferred a
    // blank two-mana enchantment to Pacifism.
    const pacifism = aura([{ kind: 'cantAttack' }, { kind: 'cantBlock' }]);
    expect(evaluateCard(pacifism, WEIGHTS).score).toBeGreaterThan(0);
  });

  it('decomposes into components that sum back to the score', () => {
    const evaluation = evaluateCard(aura([statBonus(2, 2)]), WEIGHTS);
    const summed = evaluation.components.reduce((sum, component) => sum + component.value, 0);
    expect(summed).toBeCloseTo(evaluation.score, 10);
    expect(evaluation.components.map((component) => component.name)).toContain('aura');
  });

  it('prices a stat bonus at what the same numbers are worth on a body', () => {
    expect(auraComponent([statBonus(2, 2)])).toBeCloseTo(
      2 * WEIGHTS.creaturePowerWeight + 2 * WEIGHTS.creatureToughnessWeight,
      10,
    );
  });

  it('prices a curse at what it takes away, not at a negative number', () => {
    // The Aura is worth its clause to the player who cast it, and a caster
    // pointing -2/-2 at a blocker gains exactly what the blocker loses.
    expect(auraComponent([statBonus(-2, -2)])).toBeCloseTo(auraComponent([statBonus(2, 2)]), 10);
  });

  it('clamps a swing no body in the format can carry, in both directions', () => {
    // `+-99` is the DSL's missing-digit backstop rather than a balance number,
    // and the ceiling is `equipModificationCeiling`: the stats a format-median
    // game can put on the board.
    const ceiling = WEIGHTS.creatureStatBaselinePerMana * WEIGHTS.formatMedianRounds;
    expect(auraComponent([statBonus(99, 99)])).toBe(ceiling);
    expect(auraComponent([statBonus(-99, -99)])).toBe(ceiling);
  });

  it('prices a granted keyword at its flat base, the way a lord does', () => {
    expect(auraComponent([grantKeyword('flying')])).toBe(WEIGHTS.keywordBase.flying);
  });

  it('prices each combat denial at half an answer and both at a whole one', () => {
    const answer = WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit;
    expect(auraComponent([{ kind: 'cantAttack' }])).toBeCloseTo(WEIGHTS.auraCombatDenialShare * answer, 10);
    expect(auraComponent([{ kind: 'cantAttack' }, { kind: 'cantBlock' }])).toBeCloseTo(answer, 10);
  });

  it('prices taking the creature above answering it, at the stated multiple', () => {
    // The one clause worth more than a removal spell, and the reason is that
    // the same body leaves one board and joins the other. Anchored on the same
    // `destroyPermanent` row the combat halves are a share of, so the strongest
    // clause in the vocabulary is priced against a number this scorer already
    // uses rather than against a fresh one.
    const answer = WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit;
    expect(WEIGHTS.auraControlMultiple).toBeGreaterThan(1);
    expect(auraComponent([{ kind: 'gainControl' }])).toBeCloseTo(WEIGHTS.auraControlMultiple * answer, 10);
    expect(auraComponent([{ kind: 'gainControl' }])).toBeGreaterThan(
      auraComponent([{ kind: 'cantAttack' }, { kind: 'cantBlock' }]),
    );
  });

  it('prices the untap hold at the whole answer, above both combat halves', () => {
    // It is strictly more than "can't attack or block": the creature keeps
    // neither its attack, its block, nor any tap cost it was printed with, and
    // it keeps losing them every turn. Less than the control clause, which puts
    // the same body on the other side of the table.
    const answer = WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit;
    expect(auraComponent([{ kind: 'doesNotUntap' }])).toBeCloseTo(answer, 10);
    expect(auraComponent([{ kind: 'doesNotUntap' }])).toBeGreaterThan(
      auraComponent([{ kind: 'cantAttack' }]),
    );
    expect(auraComponent([{ kind: 'doesNotUntap' }])).toBeLessThan(auraComponent([{ kind: 'gainControl' }]));
  });

  it('anchors unblockable to flying and landwalk to flying behind a condition', () => {
    expect(auraComponent([{ kind: 'cantBeBlocked' }])).toBe(WEIGHTS.keywordBase.flying);
    expect(auraComponent([{ kind: 'grantLandwalk', landType: 'Forest' }])).toBeCloseTo(
      WEIGHTS.keywordBase.flying * WEIGHTS.enabledWhileFactor,
      10,
    );
  });

  it('sums its modifications, because one host gets all of them at once', () => {
    expect(auraComponent([statBonus(2, 2), grantKeyword('flying')])).toBeCloseTo(
      auraComponent([statBonus(2, 2)]) + auraComponent([grantKeyword('flying')]),
      10,
    );
  });

  it('multiplies by no host count, because an Aura dies with its creature', () => {
    // CR 704.5m from the other side: an Equipment is picked back up and carries
    // `equipHostCount` for it, an Aura goes to the graveyard with the host, so
    // the clause is worth itself exactly once. The guard is that the weight is
    // not 1, which is what makes "no multiplier" distinguishable from "times
    // one"; it used to read `above 1` on the reasoning CR 704.5m supports, and
    // the measured 0.684 hosts per arrival is below 1 without touching that
    // reasoning, because most weapons that resolve are never equipped at all.
    expect(WEIGHTS.equipHostCount).not.toBe(1);
    expect(auraComponent([statBonus(2, 2)])).toBeCloseTo(
      2 * WEIGHTS.creaturePowerWeight + 2 * WEIGHTS.creatureToughnessWeight,
      10,
    );
  });

  /**
   * The rate clause splits the way the flat one does -- Armored Ascension helps
   * the host, Quag Sickness is a removal spell -- so it takes the same sign
   * correction. Reading it without one scored the second at a negative, which
   * is the ranking-below-a-blank-card failure this file was opened for.
   */
  it('prices a rate clause at its assumed count, in either direction', () => {
    const perPlains: AuraModification = {
      kind: 'statBonusPer',
      power: 1,
      toughness: 1,
      each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
    };
    const perSwamp: AuraModification = {
      kind: 'statBonusPer',
      power: -1,
      toughness: -1,
      each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
    };
    const count = WEIGHTS.computedAmountAssumption;
    const expected = count * WEIGHTS.creaturePowerWeight + count * WEIGHTS.creatureToughnessWeight;
    expect(auraComponent([perPlains])).toBeCloseTo(expected, 10);
    // The same magnitude, not its negation: what the caster gains is what the
    // host loses.
    expect(auraComponent([perSwamp])).toBeCloseTo(expected, 10);
  });
});

describe('an Aura that answers a creature counts as removal', () => {
  it('counts a clause that takes away as much toughness as a burn spell deals', () => {
    expect(WEIGHTS.removalDamageFloor).toBe(2);
    expect(isRemovalCard(aura([statBonus(-2, -2)]), WEIGHTS)).toBe(true);
    expect(isRemovalCard(aura([statBonus(0, -2)]), WEIGHTS)).toBe(true);
  });

  it('does not count a shrink below the floor, or one that only takes power', () => {
    expect(isRemovalCard(aura([statBonus(-1, -1)]), WEIGHTS)).toBe(false);
    expect(isRemovalCard(aura([statBonus(-4, 0)]), WEIGHTS)).toBe(false);
  });

  it('counts a rate clause at its assumed count rather than at its printed rate', () => {
    const shrinkPer = (toughness: number): AuraModification => ({
      kind: 'statBonusPer',
      power: 0,
      toughness,
      each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
    });
    // Quag Sickness prints -1/-1, which is under the floor read flat and over it
    // read at the count -- and the count is what the card does.
    expect(WEIGHTS.computedAmountAssumption * 1).toBeGreaterThanOrEqual(WEIGHTS.removalDamageFloor);
    expect(isRemovalCard(aura([shrinkPer(-1)]), WEIGHTS)).toBe(true);
    // The direction still has to matter: Armored Ascension is not removal.
    expect(isRemovalCard(aura([shrinkPer(1)]), WEIGHTS)).toBe(false);
  });

  it('counts both halves of combat denial together and neither one alone', () => {
    // A creature that cannot attack still trades with an attacker, and one that
    // cannot block still kills you. Only the pair takes it off the board in
    // every way this builder measures.
    expect(isRemovalCard(aura([{ kind: 'cantAttack' }, { kind: 'cantBlock' }]), WEIGHTS)).toBe(true);
    expect(isRemovalCard(aura([{ kind: 'cantAttack' }]), WEIGHTS)).toBe(false);
    expect(isRemovalCard(aura([{ kind: 'cantBlock' }]), WEIGHTS)).toBe(false);
  });

  it('counts a control clause on its own, unlike either half of combat denial', () => {
    // It needs no second clause beside it: the creature is gone from the board
    // it was threatening in every sense the builder measures, and it is on
    // yours. That is why this arm is a single `carries` rather than the pair
    // the combat halves need.
    expect(isRemovalCard(aura([{ kind: 'gainControl' }]), WEIGHTS)).toBe(true);
    expect(componentOf(aura([{ kind: 'gainControl' }]), 'removalPremium')).toBe(WEIGHTS.removalPremium);
  });

  it('counts the untap hold on its own, for the reason the control clause is counted', () => {
    // A held creature cannot attack and cannot block, so it fails both halves of
    // the pair above at once rather than one of them; the pair is what that test
    // says a single clause has to cover.
    expect(isRemovalCard(aura([{ kind: 'doesNotUntap' }]), WEIGHTS)).toBe(true);
    expect(componentOf(aura([{ kind: 'doesNotUntap' }]), 'removalPremium')).toBe(WEIGHTS.removalPremium);
  });

  it('does not count a clause that arms a creature', () => {
    expect(isRemovalCard(aura([statBonus(2, 2)]), WEIGHTS)).toBe(false);
    expect(isRemovalCard(aura([{ kind: 'cantBeBlocked' }]), WEIGHTS)).toBe(false);
  });

  it('pays the removal premium once the clause is read', () => {
    expect(componentOf(aura([statBonus(-2, -2)]), 'removalPremium')).toBe(WEIGHTS.removalPremium);
  });
});

describe('a planeswalker is priced at one ability per turn', () => {
  it('prices loyalty as toughness, and prints no body components', () => {
    const evaluation = evaluateCard(walker(4, [lifeAbility(1, 2)]), WEIGHTS);
    const names = evaluation.components.map((component) => component.name);
    expect(componentOf(walker(4, [lifeAbility(1, 2)]), 'loyalty')).toBeCloseTo(
      WEIGHTS.creatureToughnessWeight * 4,
      10,
    );
    expect(names).not.toContain('statSurplus');
    expect(names).not.toContain('creaturePremium');
    expect(evaluation.components.reduce((sum, component) => sum + component.value, 0)).toBeCloseTo(
      evaluation.score,
      10,
    );
  });

  it('takes the best printed ability rather than the sum of all of them', () => {
    // CR 606.3: one loyalty ability per walker per turn, so three printed
    // abilities are three things it does *instead of* each other.
    const one = componentOf(walker(4, [lifeAbility(1, 6)]), 'abilities');
    const three = componentOf(
      walker(4, [lifeAbility(1, 2), lifeAbility(1, 6), lifeAbility(1, 3)]),
      'abilities',
    );
    expect(three).toBeCloseTo(one, 10);
  });

  it('buys a plus or a zero ability at the flat activation count', () => {
    const expected = WEIGHTS.planeswalkerActivations * gainLifeValue(2);
    expect(componentOf(walker(4, [lifeAbility(1, 2)]), 'abilities')).toBeCloseTo(expected, 10);
    expect(componentOf(walker(4, [lifeAbility(0, 2)]), 'abilities')).toBeCloseTo(expected, 10);
  });

  it('buys a minus ability out of printed starting loyalty, and no further', () => {
    // Starting loyalty 4, a -2 ability: two activations, which is below the
    // three a plus ability gets. There is no turn model here, so the plus
    // abilities do not grow a budget the minus then spends.
    expect(WEIGHTS.planeswalkerActivations).toBe(3);
    expect(componentOf(walker(4, [lifeAbility(-2, 2)]), 'abilities')).toBeCloseTo(2 * gainLifeValue(2), 10);
    expect(componentOf(walker(9, [lifeAbility(-2, 2)]), 'abilities')).toBeCloseTo(3 * gainLifeValue(2), 10);
  });

  it('prices an ultimate the walker cannot reach at nothing, and says so', () => {
    // The conservative direction and a stated consequence rather than a hidden
    // one: a -9 on a walker that starts at 4 is worth zero to this evaluator,
    // so the card is priced by its other lines.
    expect(componentOf(walker(4, [lifeAbility(-9, 20)]), 'abilities')).toBe(0);
    expect(componentOf(walker(4, [lifeAbility(1, 2), lifeAbility(-9, 20)]), 'abilities')).toBeCloseTo(
      WEIGHTS.planeswalkerActivations * gainLifeValue(2),
      10,
    );
  });
});
