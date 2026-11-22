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

/** What it costs to kill a creature outright: the cap every denial price sits under. */
const ANSWER = WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit;

/** The power the `defender` row is pinned through. */
const REFERENCE_POWER = WEIGHTS.combatDenialReferencePower;

/**
 * The same rules text spelled as a static rather than as a keyword: a
 * `cantAttack` modification scoped at the creature that carries it. `defender`
 * is the printed word for exactly this, and `evaluate.ts` prices both through
 * one function.
 */
function staticDelta(power: number, toughness: number): number {
  const restricted = creature(power, toughness, {
    abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantAttack' } }],
  });
  return evaluateCard(restricted, WEIGHTS).score - evaluateCard(creature(power, toughness), WEIGHTS).score;
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
    expect(ABILITY.defender.flat).toBeCloseTo(-WEIGHTS.auraCombatDenialShare * ANSWER, 10);
    // The two zeroes are not "flat on every body": `evaluate.ts` reads this row
    // as the price at `combatDenialReferencePower` and rotates a curve through
    // it, because the same rules text arrives as a `cantAttack` static too and
    // one table row cannot carry a slope both spellings agree on. What they
    // mean is that this table contributes nothing else to the price.
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
    expect(delta(0, 6, [{ kind: 'defender' }])).toBeLessThan(0);
    // The table's row is the price at the reference power rather than the price
    // at every power (`mtg-eetd`), so this is where the two meet.
    expect(delta(REFERENCE_POWER, 6, [{ kind: 'defender' }])).toBeCloseTo(ABILITY.defender.flat, 10);
  });

  it('charges defender for the attack the body would actually have made', () => {
    // The defect `mtg-eetd` names, stated as the assertion that used to hold:
    // a 0/6 wall and a 6/6 that gains defender were charged the same 1.3, one
    // for an attack it could never profitably make and one for the attack that
    // was its whole point.
    const wall = delta(0, 6, [{ kind: 'defender' }]);
    const giant = delta(6, 6, [{ kind: 'defender' }]);
    expect(giant).toBeLessThan(wall);
    // Monotone across the whole range a printed creature occupies, and never
    // dearer than simply killing the thing.
    const prices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map((power) => delta(power, 6, [{ kind: 'defender' }]));
    for (const [index, price] of prices.entries()) {
      if (index > 0) expect(price).toBeLessThan((prices[index - 1] ?? 0) + 1e-9);
      expect(price).toBeGreaterThan(-ANSWER - 1e-9);
    }
    // The floor is a vigilance the card does not have: at zero power the only
    // thing "cannot attack" takes away is the choice to leave the body back.
    expect(prices[0]).toBeCloseTo(-WEIGHTS.keywordBase.vigilance, 10);
  });

  it('prices the printed word and the self-facing static as one rules text', () => {
    // `mtg-eetd`'s acceptance criterion. `defender` and a `cantAttack` static
    // scoped at the card that carries it are the same sentence in two
    // spellings, and moving one price without the other fails here rather than
    // pricing a Wall one thing printed and another thing granted.
    for (const power of [0, 1, 3, 5, 8]) {
      expect(staticDelta(power, 6)).toBeCloseTo(delta(power, 6, [{ kind: 'defender' }]), 10);
    }
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

/**
 * A cheap artifact whose whole value is one static, which is the point: an
 * artifact has no stat line, so the body `indestructible` takes a share of can
 * only be what the card's text is worth.
 */
function artifact(keywordAbilities: readonly KeywordAbility[], text = true): Card {
  return parseCard({
    kind: 'artifact',
    id: 'tst-artifact',
    name: 'Test Artifact',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 3 },
    manaCost: { generic: 2 },
    abilities: text
      ? [
          {
            kind: 'static',
            scope: 'creaturesYouControl',
            subtype: null,
            modification: { kind: 'statBonus', power: 1, toughness: 1 },
          },
        ]
      : [],
    keywordAbilities: [...keywordAbilities],
  });
}

/** The same arrangement one card kind over, because both hit the same arm. */
function enchantment(keywordAbilities: readonly KeywordAbility[]): Card {
  return parseCard({
    kind: 'enchantment',
    id: 'tst-enchantment',
    name: 'Test Enchantment',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 4 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    abilities: [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ],
    keywordAbilities: [...keywordAbilities],
  });
}

/** What `permanentTextBody` reads: every component but the mana penalty. */
function textBody(card: Card): number {
  return evaluateCard(card, WEIGHTS).components.reduce(
    (sum, component) => (component.name === 'manaPenalty' ? sum : sum + component.value),
    0,
  );
}

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

  it('ranks an indestructible artifact above the same artifact without the word', () => {
    // `mtg-trp8`. Both were the same card to `buildDeck` for as long as the
    // share was a share of a stat line an artifact does not have.
    expect(evaluateCard(artifact([{ kind: 'indestructible' }]), WEIGHTS).score).toBeGreaterThan(
      evaluateCard(artifact([]), WEIGHTS).score,
    );
  });

  it('takes the share of the artifact`s own text value', () => {
    const bare = evaluateCard(artifact([]), WEIGHTS).score;
    const tough = evaluateCard(artifact([{ kind: 'indestructible' }]), WEIGHTS).score;
    expect(tough - bare).toBeCloseTo(ABILITY.indestructible.bodyShare * textBody(artifact([])), 10);
  });

  it('prices an enchantment off the same body, because it has the same one', () => {
    const bare = evaluateCard(enchantment([]), WEIGHTS).score;
    const shrouded = evaluateCard(enchantment([{ kind: 'shroud' }]), WEIGHTS).score;
    expect(shrouded - bare).toBeCloseTo(ABILITY.shroud.bodyShare * textBody(enchantment([])), 10);
  });

  it('pays nothing for indestructible on an artifact whose text is a liability', () => {
    // The clamp. A vanilla artifact sits at `vanillaArtifactBaseline`, which is
    // negative, and a negative share would pay its controller for printing a
    // word that keeps a card doing nothing on the battlefield.
    expect(textBody(artifact([], false))).toBeLessThan(0);
    expect(evaluateCard(artifact([{ kind: 'indestructible' }], false), WEIGHTS).score).toBe(
      evaluateCard(artifact([], false), WEIGHTS).score,
    );
  });
});

describe('the body every permanent price shares', () => {
  it('carries keyword abilities, so a sacrifice cost prices what it eats', () => {
    // `sacrificedValue`'s docblock claims "bodyValue carries every stat and
    // keyword it gives up"; before this it carried one of the two vocabularies.
    const vanilla = bodyValue(2, 2, [], [], [], WEIGHTS, undefined);
    const tough = bodyValue(2, 2, [], [], [{ kind: 'indestructible' }], WEIGHTS, undefined);
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
