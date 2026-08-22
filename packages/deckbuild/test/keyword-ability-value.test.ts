/**
 * `card.keywordAbilities` is priced, and priced off numbers this file can
 * restate (`mtg-gloz`).
 *
 * The defect these cover was a hole rather than a wrong number: `@mtg/dsl`
 * carries two keyword vocabularies, `card.keywords` (the evergreen enum) and
 * `card.keywordAbilities` (defender, landwalk, hexproof, indestructible,
 * protection, doubleStrike), and until this suite existed the evaluator read
 * only the first. The kernel plays all six — `layers.ts` grants them,
 * `combat.ts` refuses the attack and skips the blocker, `destruction.ts`
 * survives the destroy — so a simulated game and the builder that assembled the
 * deck disagreed about what the card was. A 0/6 with `defender` and a 0/6
 * vanilla were the same card to `buildDeck`.
 *
 * The derivation block below is the load-bearing half. Every default in
 * `DEFAULT_KEYWORD_ABILITY_VALUE` is an arithmetic statement about a weight
 * that was already in `config.ts`, and a docblock saying so is not enforcement:
 * retuning `destroyPermanent` and leaving `defender` behind would leave one
 * rules text priced two ways, silently, which is the shape of the bug this
 * whole lane is about. These fail instead.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, KeywordAbility } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  bodyValue,
  DEFAULT_KEYWORD_ABILITY_VALUE,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  resolveConfig,
} from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;
const ABILITY = DEFAULT_KEYWORD_ABILITY_VALUE;

function creature(power: number, toughness: number, overrides: Partial<CardInput> = {}): Card {
  return parseCard({
    kind: 'creature',
    id: 'tst-body',
    name: 'Test Body',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    power,
    toughness,
    ...overrides,
  } as CardInput);
}

/** A creature identical to a vanilla one except for the abilities under test. */
function withAbilities(power: number, toughness: number, keywordAbilities: readonly KeywordAbility[]): Card {
  return creature(power, toughness, { keywordAbilities: [...keywordAbilities] });
}

/** How much the abilities are worth on that body: the whole of the delta. */
function delta(power: number, toughness: number, abilities: readonly KeywordAbility[]): number {
  return (
    evaluateCard(withAbilities(power, toughness, abilities), WEIGHTS).score -
    evaluateCard(creature(power, toughness), WEIGHTS).score
  );
}

/**
 * A four-mana walker carrying no loyalty ability at all, because the quantity
 * under test is the loyalty itself: `evaluateCard` prices that at
 * `creatureToughnessWeight` for being what an attacker has to spend combat
 * damage on, and the two survival-shaped abilities take a share of it.
 */
function walker(startingLoyalty: number, keywordAbilities: readonly KeywordAbility[]): Card {
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
    keywordAbilities: [...keywordAbilities],
  });
}

describe('the defaults are the derivations they claim to be', () => {
  it('prices defender at what this file already pays to stop a creature attacking', () => {
    const answer = WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit;
    expect(ABILITY.defender.flat).toBeCloseTo(-WEIGHTS.auraCombatDenialShare * answer, 10);
    expect(ABILITY.defender.perPower).toBe(0);
    expect(ABILITY.defender.bodyShare).toBe(0);
  });

  it('prices landwalk at what the grantLandwalk aura clause already pays', () => {
    expect(ABILITY.landwalk.flat).toBeCloseTo(WEIGHTS.keywordBase.flying * WEIGHTS.enabledWhileFactor, 10);
    expect(ABILITY.landwalk.perPower).toBeCloseTo(
      WEIGHTS.keywordPowerScale.flying * WEIGHTS.enabledWhileFactor,
      10,
    );
  });

  it('prices double strike as first strike plus half a body of power', () => {
    expect(ABILITY.doubleStrike.flat).toBeCloseTo(WEIGHTS.keywordBase.firstStrike, 10);
    expect(ABILITY.doubleStrike.perPower).toBeCloseTo(
      WEIGHTS.keywordPowerScale.firstStrike + WEIGHTS.creaturePowerWeight / 2,
      10,
    );
  });

  it('keeps the three survival-shaped rows on the body share and off the power rate', () => {
    for (const kind of ['hexproof', 'indestructible', 'protection'] as const) {
      expect(ABILITY[kind].flat).toBe(0);
      expect(ABILITY[kind].perPower).toBe(0);
      expect(ABILITY[kind].bodyShare).toBeGreaterThan(0);
    }
    // Hexproof stops nothing in combat, and combat is where most Limited
    // creatures die, so it sits under indestructible rather than beside it.
    expect(ABILITY.hexproof.bodyShare).toBeLessThan(ABILITY.indestructible.bodyShare);
  });
});

describe('what each of the six does to a card score', () => {
  it('is the only negative one, and the bead sentence stops being true', () => {
    // "A 0/6 with defender and a 0/6 vanilla are the same card to buildDeck."
    expect(delta(0, 6, [{ kind: 'defender' }])).toBeCloseTo(ABILITY.defender.flat, 10);
    expect(delta(0, 6, [{ kind: 'defender' }])).toBeLessThan(0);
  });

  it('charges defender the same on a zero-power body as on a big one', () => {
    // The aura arm's `cantAttack` is flat, and this is that rules text printed
    // on the card rather than enchanted onto it.
    expect(delta(0, 6, [{ kind: 'defender' }])).toBeCloseTo(delta(6, 6, [{ kind: 'defender' }]), 10);
  });

  it('credits the other five on a body that can use them', () => {
    const others: readonly KeywordAbility[] = [
      { kind: 'landwalk', landType: 'Swamp' },
      { kind: 'hexproof' },
      { kind: 'indestructible' },
      { kind: 'protection', quality: { kind: 'color', color: 'B' } },
      { kind: 'doubleStrike' },
    ];
    for (const ability of others) expect(delta(3, 3, [ability])).toBeGreaterThan(0);
  });

  it('puts a double strike 3/3 above a first strike 3/3 and says by how much', () => {
    const doubled = delta(3, 3, [{ kind: 'doubleStrike' }]);
    const single =
      evaluateCard(creature(3, 3, { keywords: ['firstStrike'] }), WEIGHTS).score -
      evaluateCard(creature(3, 3), WEIGHTS).score;
    expect(doubled).toBeGreaterThan(single);
    // The gap is the second damage step and nothing else: half of what this
    // file pays for a point of power, on each of the three points.
    expect(doubled - single).toBeCloseTo(3 * (WEIGHTS.creaturePowerWeight / 2), 10);
  });

  it('scales the survival-shaped three with the body rather than flatly', () => {
    const small = delta(1, 1, [{ kind: 'indestructible' }]);
    const large = delta(5, 5, [{ kind: 'indestructible' }]);
    expect(large).toBeGreaterThan(small * 4);
  });

  it('still credits indestructible on a wall with no power at all', () => {
    // The case a power rate would have priced at nothing, and one of the
    // better commons a Limited deck can open.
    expect(delta(0, 6, [{ kind: 'indestructible' }])).toBeGreaterThan(0);
  });

  it('narrows protection from a subtype against protection from a color', () => {
    const color = delta(3, 3, [{ kind: 'protection', quality: { kind: 'color', color: 'B' } }]);
    const subtype = delta(3, 3, [{ kind: 'protection', quality: { kind: 'subtype', subtype: 'Dragon' } }]);
    expect(subtype).toBeCloseTo(color * WEIGHTS.staticSubtypeReachFactor, 10);
  });

  it('zeroes the two combat-shaped credits on a body that deals no damage', () => {
    // `ZERO_AT_ZERO_POWER`'s test, on the second vocabulary: landwalk is
    // flying (whether damage gets through) and double strike is first strike
    // one step later (when it gets through), and zero twice is zero.
    expect(delta(0, 4, [{ kind: 'landwalk', landType: 'Island' }])).toBe(0);
    expect(delta(0, 4, [{ kind: 'doubleStrike' }])).toBe(0);
    expect(delta(1, 4, [{ kind: 'landwalk', landType: 'Island' }])).toBeGreaterThan(0);
    expect(delta(1, 4, [{ kind: 'doubleStrike' }])).toBeGreaterThan(0);
  });

  it('adds one component that the breakdown names and the score sums back to', () => {
    const evaluation = evaluateCard(withAbilities(2, 2, [{ kind: 'indestructible' }]), WEIGHTS);
    const named = evaluation.components.filter((component) => component.name === 'keywordAbilities');
    expect(named).toHaveLength(1);
    const summed = evaluation.components.reduce((sum, component) => sum + component.value, 0);
    expect(summed).toBeCloseTo(evaluation.score, 10);
  });
});

describe('the permanents that are not creatures', () => {
  it('prices a walker`s hexproof off the loyalty it already prices as toughness', () => {
    const bare = evaluateCard(walker(4, []), WEIGHTS).score;
    const protectedWalker = evaluateCard(walker(4, [{ kind: 'hexproof' }]), WEIGHTS).score;
    expect(protectedWalker - bare).toBeCloseTo(
      ABILITY.hexproof.bodyShare * WEIGHTS.creatureToughnessWeight * 4,
      10,
    );
  });

  it('scales that with the walker`s loyalty, because that is the body', () => {
    const low =
      evaluateCard(walker(2, [{ kind: 'indestructible' }]), WEIGHTS).score -
      evaluateCard(walker(2, []), WEIGHTS).score;
    const high =
      evaluateCard(walker(6, [{ kind: 'indestructible' }]), WEIGHTS).score -
      evaluateCard(walker(6, []), WEIGHTS).score;
    expect(high).toBeCloseTo(low * 3, 10);
  });
});

describe('the body every permanent price shares', () => {
  it('carries keyword abilities, so a sacrifice cost prices what it eats', () => {
    // `sacrificedValue`'s docblock claims "bodyValue carries every stat and
    // keyword it gives up"; before this it carried one of the two vocabularies.
    const vanilla = bodyValue(2, 2, [], [], WEIGHTS);
    const tough = bodyValue(2, 2, [], [{ kind: 'indestructible' }], WEIGHTS);
    expect(tough).toBeGreaterThan(vanilla);
  });
});

describe('the weights are tunable the way every other weight is', () => {
  it('takes an override through resolveConfig', () => {
    const resolved = resolveConfig({
      weights: { keywordAbilityValue: { defender: { flat: -5, perPower: 0, bodyShare: 0 } } },
    });
    expect(resolved.weights.keywordAbilityValue.defender.flat).toBe(-5);
    // Untouched rows survive the merge.
    expect(resolved.weights.keywordAbilityValue.indestructible).toEqual(ABILITY.indestructible);
  });

  it('replaces a row whole rather than per field', () => {
    // `EffectWeight`'s rule: a caller who moved `perPower` and left `flat`
    // paying first strike's base would have repriced the card silently.
    const resolved = resolveConfig({
      weights: { keywordAbilityValue: { doubleStrike: { flat: 0, perPower: 1, bodyShare: 0 } } },
    });
    expect(resolved.weights.keywordAbilityValue.doubleStrike).toEqual({
      flat: 0,
      perPower: 1,
      bodyShare: 0,
    });
  });
});
