import { describe, expect, it } from 'vitest';
import type {
  Ability,
  Card,
  CardInput,
  Effect,
  TargetFilter,
  TargetSpec,
  TokenAbility,
  TriggerCondition,
  TriggeredAbility,
  UnlessClause,
} from '@mtg/dsl';
import {
  BASIC_LANDS,
  CardSchema,
  exampleCard,
  mana,
  parseCard,
  safeParseCard,
  TargetFilterSchema,
} from '@mtg/dsl';
import {
  abilityValue,
  bodyEffectValue,
  bodyValue,
  cardColors,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_MANA_BASE_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_TOP_END_REACHABILITY,
  effectMagnitude,
  evaluateCard,
  evaluatePool,
  hypergeometricAtLeast,
  isRemovalCard,
  removalPremiumFor,
  resolveConfig,
} from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

function creature(overrides: Partial<CardInput> & { power: number; toughness: number }): Card {
  return parseCard({
    kind: 'creature',
    id: 'tst-body',
    name: 'Test Body',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    ...overrides,
  } as CardInput);
}

describe('evaluateCard', () => {
  it('decomposes the score into components that sum back to it', () => {
    for (const card of [
      exampleCard('slc-lightning-lash'),
      exampleCard('slc-thornhide-guardian'),
      exampleCard('slc-wild-summons'),
      exampleCard('slc-bronze-monument'),
    ]) {
      const evaluation = evaluateCard(card, WEIGHTS);
      const summed = evaluation.components.reduce((sum, component) => sum + component.value, 0);
      expect(summed).toBeCloseTo(evaluation.score, 10);
      expect(evaluation.components.length).toBeGreaterThan(0);
    }
  });

  it('is a pure function of card and weights', () => {
    const card = exampleCard('slc-graveblade-stalker');
    expect(evaluateCard(card, WEIGHTS).score).toBe(evaluateCard(card, WEIGHTS).score);
  });

  it('pays a premium for removal over an equally costed non-removal spell', () => {
    const removal = evaluateCard(exampleCard('slc-mortal-verdict'), WEIGHTS);
    const mill = evaluateCard(exampleCard('slc-grasping-mire'), WEIGHTS);
    expect(removal.isRemoval).toBe(true);
    expect(mill.isRemoval).toBe(false);
    expect(removal.score).toBeGreaterThan(mill.score + WEIGHTS.removalPremium);
  });

  it('counts damage as removal only at or above the configured floor', () => {
    const pinger = parseCard({
      kind: 'instant',
      id: 'tst-ping',
      name: 'Ping',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { R: 1 },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    } satisfies CardInput);
    expect(isRemovalCard(pinger, WEIGHTS)).toBe(false);
    expect(isRemovalCard(pinger, { ...WEIGHTS, removalDamageFloor: 1 })).toBe(true);
  });

  it('does not treat player-only damage as removal', () => {
    const burn = parseCard({
      kind: 'sorcery',
      id: 'tst-burn',
      name: 'Face Burn',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: 4, target: { kind: 'targetPlayer' } }],
    } satisfies CardInput);
    expect(isRemovalCard(burn, WEIGHTS)).toBe(false);
  });

  /**
   * The rider is the whole question, and it is asked three ways because the arm
   * can be wrong in three directions.
   *
   * A tapper without `doesNotUntap` buys one attack and the creature stands up
   * on its controller's next untap step, so it answers nothing and must not
   * read as an answer. A tapper with the rider is Claustrophobia by another
   * spelling and must. A held sweep names a player and no creature at all
   * (CR 115.1), which is the arm `sweepsCreatures` exists for and the one every
   * target-kind test reads as touching nothing.
   *
   * There is no fourth case here because the DSL will not build it: the arm
   * carries the same aim gate every arm above it carries, but an unscoped
   * `tapPermanent` aimed at a player is `ILLEGAL_EFFECT_SCOPE` at parse time.
   * The gate stays in the arm anyway - a validator rule and an evaluator rule
   * that agree today are still two rules, and this one is cheap.
   *
   * `isRemovalCard` rather than the pricing, because these two cards were never
   * priced the same - `EFFECT_PRICING.tapPermanent` has multiplied the held
   * reach by `heldTapFactor` since the rider landed. The classification is what
   * was missing, and `removalCount` and every "does this deck hold answers"
   * test downstream read that, not the price.
   */
  it('counts a held tap and a held sweep as removal, and an unheld tap as not', () => {
    const tapper = (
      id: string,
      overrides: {
        readonly doesNotUntap?: true;
        readonly target: TargetSpec;
        readonly scope?: 'creaturesThatPlayerControls';
      },
    ): Card =>
      parseCard({
        kind: 'sorcery',
        id,
        name: 'Test Lock',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 4 },
        manaCost: { generic: 2, U: 1 },
        colors: ['U'],
        effects: [
          {
            kind: 'tapPermanent',
            target: overrides.target,
            ...(overrides.doesNotUntap === undefined ? {} : { doesNotUntap: true }),
            ...(overrides.scope === undefined ? {} : { scope: overrides.scope }),
          },
        ],
      } satisfies CardInput);

    const held = tapper('tst-held', { doesNotUntap: true, target: { kind: 'targetCreature' } });
    const fleeting = tapper('tst-fleeting', { target: { kind: 'targetCreature' } });
    const sweep = tapper('tst-sweep', {
      doesNotUntap: true,
      target: { kind: 'targetOpponent' },
      scope: 'creaturesThatPlayerControls',
    });
    expect(isRemovalCard(held, WEIGHTS)).toBe(true);
    expect(isRemovalCard(sweep, WEIGHTS)).toBe(true);
    expect(isRemovalCard(fleeting, WEIGHTS)).toBe(false);
    expect(removalPremiumFor(held, WEIGHTS)).toBe(WEIGHTS.removalPremium);
    expect(removalPremiumFor(fleeting, WEIGHTS)).toBe(0);
  });

  it('rewards a bigger body at the same cost', () => {
    const small = evaluateCard(creature({ power: 1, toughness: 1 }), WEIGHTS);
    const large = evaluateCard(creature({ power: 4, toughness: 4 }), WEIGHTS);
    expect(large.score).toBeGreaterThan(small.score);
  });

  it('rewards keywords, and rewards evasion on a bigger body more', () => {
    const vanilla = evaluateCard(creature({ power: 3, toughness: 3 }), WEIGHTS);
    const flier = evaluateCard(creature({ power: 3, toughness: 3, keywords: ['flying'] }), WEIGHTS);
    expect(flier.score).toBeGreaterThan(vanilla.score);

    const smallFlierGain =
      evaluateCard(creature({ power: 1, toughness: 1, keywords: ['flying'] }), WEIGHTS).score -
      evaluateCard(creature({ power: 1, toughness: 1 }), WEIGHTS).score;
    const bigFlierGain =
      evaluateCard(creature({ power: 5, toughness: 5, keywords: ['flying'] }), WEIGHTS).score -
      evaluateCard(creature({ power: 5, toughness: 5 }), WEIGHTS).score;
    expect(bigFlierGain).toBeGreaterThan(smallFlierGain);
  });

  it('scores a bear at the vanilla baseline plus the creature premium', () => {
    const bear = parseCard({
      kind: 'creature',
      id: 'tst-bear',
      name: 'Bear',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 4 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      power: 2,
      toughness: 2,
    } satisfies CardInput);
    expect(evaluateCard(bear, WEIGHTS).score).toBeCloseTo(WEIGHTS.creaturePremium, 10);
  });

  it('scores lands at zero and vanilla artifacts below zero', () => {
    for (const land of BASIC_LANDS) {
      expect(evaluateCard(land, WEIGHTS).score).toBe(0);
    }
    expect(evaluateCard(exampleCard('slc-bronze-monument'), WEIGHTS).score).toBeLessThan(0);
  });

  it('places every card in the right curve bucket, collapsing 6 and above', () => {
    expect(evaluateCard(exampleCard('slc-lightning-lash'), WEIGHTS).bucket).toBe(2);
    const giant = creature({ power: 8, toughness: 8, manaCost: { generic: 7, G: 1 } });
    expect(evaluateCard(giant, WEIGHTS).manaValue).toBe(8);
    expect(evaluateCard(giant, WEIGHTS).bucket).toBe(6);
  });
});

/**
 * A modal spell (`checkEffects` requires `effects: []` beside a populated
 * `modes` list, CR 700.2) resolves exactly one mode, chosen at cast time —
 * never all of them and never a fixed one. Reading `card.effects` alone, as
 * every other spell case does, sees an empty list and prices the card as a
 * blank vanilla with no removal and no effect value.
 */
describe('a modal spell', () => {
  const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };
  const BOLT: Effect = { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } };
  const DESTROY: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };

  function modalSpell(modes: readonly { effects: readonly Effect[] }[]): Card {
    return parseCard({
      kind: 'sorcery',
      id: 'tst-fork-in-the-road',
      name: 'Fork in the Road',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 50 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      effects: [],
      modes,
    } as unknown as CardInput);
  }

  it('is removal when any one mode answers a creature, not only when every mode does', () => {
    const card = modalSpell([{ effects: [DRAW] }, { effects: [DESTROY] }]);
    expect(isRemovalCard(card, WEIGHTS)).toBe(true);
    expect(evaluateCard(card, WEIGHTS).isRemoval).toBe(true);
  });

  it('is not removal when no mode answers a creature', () => {
    const card = modalSpell([
      { effects: [DRAW] },
      { effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }] },
    ]);
    expect(isRemovalCard(card, WEIGHTS)).toBe(false);
  });

  it('scores an effects component equal to its best mode, not the sum of every mode', () => {
    const card = modalSpell([{ effects: [DRAW] }, { effects: [BOLT] }]);
    const evaluation = evaluateCard(card, WEIGHTS);
    const effectsComponent = evaluation.components.find((entry) => entry.name === 'effects');
    if (effectsComponent === undefined) throw new Error('the modal spell scored no effects component');

    const drawValue = spellEffectValueOf([DRAW]);
    const boltValue = spellEffectValueOf([BOLT]);
    expect(boltValue).toBeGreaterThan(drawValue);
    expect(effectsComponent.value).toBeCloseTo(boltValue, 10);
    expect(effectsComponent.value).toBeLessThan(drawValue + boltValue);
  });
});

/**
 * The top-end reachability rule (`mtg-aoxo`): `evaluateCard` prices a mana
 * value at or below `formatMedianRounds` exactly as before this rule existed,
 * and discounts anything past it by `topEndReachability`, on the argument
 * that most games never reach the turn an over-median spell would be cast on.
 *
 * `DEFAULT_TOP_END_REACHABILITY`'s numbers are pinned against a value
 * computed here from the format's own published defaults
 * (`DEFAULT_DECK_BUILD_CONFIG`, `DEFAULT_MANA_BASE_CONFIG`) rather than
 * copied, so a change to the deck size or land count that forgets to
 * regenerate the table fails this test instead of silently disagreeing with
 * it.
 */
describe('top-end reachability', () => {
  // A minimal, fixed payload every card in this block carries so `parseCard`
  // accepts it (a sorcery needs at least one effect): worth
  // `WEIGHTS.effectValue.gainLife.base + perUnit * 1`, computed once so each
  // test can predict the pre-discount score by hand.
  const GAIN_ONE: Effect = { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } };
  const gainOneValue = WEIGHTS.effectValue.gainLife.base + WEIGHTS.effectValue.gainLife.perUnit * 1;

  function spellAt(manaValueGeneric: number, effects: Effect[] = [GAIN_ONE]): Card {
    return parseCard({
      kind: 'sorcery',
      id: 'tst-topend',
      name: 'Blessing',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 50 },
      manaCost: { generic: manaValueGeneric },
      colors: [],
      effects,
    } as CardInput);
  }

  /** manaPenalty + effects, before any top-end discount is applied. */
  function preDiscountScore(mv: number): number {
    return -WEIGHTS.spellManaPenaltyPerMana * mv + gainOneValue;
  }

  it('leaves every mana value at or below formatMedianRounds untouched', () => {
    expect(WEIGHTS.formatMedianRounds).toBe(7);
    for (let mv = 1; mv <= WEIGHTS.formatMedianRounds; mv++) {
      const evaluation = evaluateCard(spellAt(mv), WEIGHTS);
      expect(evaluation.components.some((c) => c.name === 'topEndUnreachable')).toBe(false);
      expect(evaluation.score).toBeCloseTo(preDiscountScore(mv), 10);
    }
  });

  it('discounts a mana value past formatMedianRounds by topEndReachability', () => {
    const mv = WEIGHTS.formatMedianRounds + 1;
    const overMedian = evaluateCard(spellAt(mv), WEIGHTS);
    const discount = overMedian.components.find((c) => c.name === 'topEndUnreachable');
    expect(discount).toBeDefined();
    expect(overMedian.score).toBeCloseTo(preDiscountScore(mv) * WEIGHTS.topEndReachability[0]!, 10);
    const summed = overMedian.components.reduce((sum, c) => sum + c.value, 0);
    expect(summed).toBeCloseTo(overMedian.score, 10);
  });

  it('clamps to the last table entry for a mana value further out than the table', () => {
    // 16 is the slice ceiling on a printed mana value, and it is already past
    // formatMedianRounds + the table's own length (15), so it exercises the
    // clamp rather than a real table entry.
    const farOut = 16;
    expect(farOut).toBeGreaterThan(WEIGHTS.formatMedianRounds + WEIGHTS.topEndReachability.length);
    const evaluation = evaluateCard(spellAt(farOut), WEIGHTS);
    const discount = evaluation.components.find((c) => c.name === 'topEndUnreachable');
    const lastEntry = WEIGHTS.topEndReachability[WEIGHTS.topEndReachability.length - 1]!;
    expect(discount?.value).toBeCloseTo(preDiscountScore(farOut) * (lastEntry - 1), 10);
  });

  it('discounts a strong over-median payload below a strong on-curve one at the top bucket', () => {
    // A sweep-shaped payload at the curve's own top bucket (MV 6, priced as
    // printed) against the same payload eight mana past it (MV 14, deep in
    // `topEndReachability`'s clamp). If the rule did nothing, the more
    // expensive card would still out-score the cheaper one on raw effect size
    // alone; the rule exists so it does not.
    const payload: Effect[] = [
      { kind: 'exileTarget', target: { kind: 'targetCreature' } },
      { kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } },
    ];
    const onCurve = evaluateCard(spellAt(6, payload), WEIGHTS);
    const wayOverMedian = evaluateCard(spellAt(14, payload), WEIGHTS);
    expect(wayOverMedian.score).toBeLessThan(onCurve.score);
  });

  it('pins the default table against the format defaults it is derived from', () => {
    const deckSize = DEFAULT_DECK_BUILD_CONFIG.deckSize;
    const landCount = DEFAULT_DECK_BUILD_CONFIG.landCount;
    const openingHand = DEFAULT_MANA_BASE_CONFIG.openingHandSize;
    const medianRounds = DEFAULT_SCORE_WEIGHTS.formatMedianRounds;
    expect(DEFAULT_MANA_BASE_CONFIG.onThePlay).toBe(true);
    const draws = openingHand + Math.max(0, medianRounds - 1);
    const expectedFirstEntry = hypergeometricAtLeast(medianRounds + 1, landCount, draws, deckSize);
    expect(DEFAULT_TOP_END_REACHABILITY[0]).toBeCloseTo(expectedFirstEntry, 10);
  });
});

describe('static abilities', () => {
  const LORD: Ability = {
    kind: 'static',
    scope: 'otherCreaturesYouControl',
    subtype: 'Bear',
    modification: { kind: 'statBonus', power: 1, toughness: 1 },
  };

  it('scores a lord above the identical vanilla body', () => {
    const vanilla = creature({ power: 2, toughness: 2, subtypes: ['Bear'] });
    const lord = creature({ power: 2, toughness: 2, subtypes: ['Bear'], abilities: [LORD] });
    expect(evaluateCard(lord, WEIGHTS).score).toBeGreaterThan(evaluateCard(vanilla, WEIGHTS).score);
    const component = evaluateCard(lord, WEIGHTS).components.find((entry) => entry.name === 'abilities');
    expect(component?.value).toBeCloseTo(abilityValue(LORD, WEIGHTS), 10);
  });

  it('scores a wider scope above a narrower one, and a subtype below no subtype', () => {
    const anthem: Ability = { ...LORD, scope: 'creaturesYouControl', subtype: null };
    const tribal: Ability = { ...anthem, subtype: 'Bear' };
    expect(abilityValue(anthem, WEIGHTS)).toBeGreaterThan(abilityValue(LORD, WEIGHTS));
    expect(abilityValue(tribal, WEIGHTS)).toBeLessThan(abilityValue(anthem, WEIGHTS));
  });

  it('discounts a conditional static below the same modification printed unconditional', () => {
    const anthem: Ability = { ...LORD, scope: 'creaturesYouControl', subtype: null };
    const conditional: Ability = {
      ...anthem,
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Trisigil', atLeast: 1 },
    };
    expect(abilityValue(conditional, WEIGHTS)).toBeCloseTo(
      abilityValue(anthem, WEIGHTS) * WEIGHTS.enabledWhileFactor,
      10,
    );
    expect(abilityValue(conditional, WEIGHTS)).toBeLessThan(abilityValue(anthem, WEIGHTS));
  });

  /**
   * The restriction discount, and the two things it must not do.
   *
   * It must reach the effect's whole price rather than its magnitude, because a
   * destroy that finds no legal target does not destroy less - it does nothing;
   * and it must not reach a card that carries no restriction, which is every
   * card in four of the five committed sets. Both are asserted against a
   * computed number rather than a recorded one, so a change to
   * `destroyPermanent`'s row cannot make this pass for the wrong reason.
   */
  describe('a restricted target', () => {
    function kill(target: TargetSpec): Card {
      return parseCard({
        kind: 'instant',
        id: 'tst-kill',
        name: 'Kill',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 51 },
        manaCost: { B: 1 },
        colors: ['B'],
        effects: [{ kind: 'destroyPermanent', target }],
      } as CardInput);
    }

    const open = kill({ kind: 'targetCreature' });
    const restricted = kill({
      kind: 'targetCreature',
      restriction: { kind: 'withCounter', counter: 'gloom' },
    });

    it('prices the effect below the same effect printed unrestricted', () => {
      const row = WEIGHTS.effectValue.destroyPermanent;
      const unrestricted = row.base + row.perUnit * effectMagnitude(open.effects[0]!, WEIGHTS);
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(restricted, WEIGHTS).score).toBeCloseTo(
        unrestricted * (1 - WEIGHTS.restrictedTargetFactor),
        10,
      );
    });

    it('is still removal, because a conditional answer is an answer the deck holds', () => {
      expect(evaluateCard(restricted, WEIGHTS).isRemoval).toBe(true);
      expect(removalPremiumFor(restricted, WEIGHTS)).toBe(removalPremiumFor(open, WEIGHTS));
    });

    it('leaves an unrestricted card at exactly the price it had', () => {
      const off = { ...WEIGHTS, restrictedTargetFactor: 1 };
      expect(evaluateCard(open, WEIGHTS).score).toBe(evaluateCard(open, off).score);
      expect(evaluateCard(restricted, WEIGHTS).score).toBeLessThan(evaluateCard(restricted, off).score);
    });
  });

  /**
   * The same discount, reached through the other field.
   *
   * `mtg-xiis` measured the hole this closes: "destroy target attacking
   * creature" and "destroy target creature" both priced at 3.000, so a strictly
   * weaker card was worth exactly what the stronger one is and no set tuned
   * against this evaluator would ever print the conditional version. The four
   * cases below are the shapes that were free - the three combat roles, and a
   * card-type filter, which is how "exile target planeswalker" is spelled
   * against `targetPermanent`.
   *
   * The last case is the design decision rather than the bug: a target narrowed
   * twice takes the discount once. `targetNarrowingFactor` argues why, and this
   * asserts it, because squaring a flat guess is the change somebody would
   * otherwise make here on the way past.
   */
  describe('a filtered target', () => {
    function kill(target: TargetSpec): Card {
      return parseCard({
        kind: 'instant',
        id: 'tst-filtered-kill',
        name: 'Filtered Kill',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 52 },
        manaCost: { B: 1 },
        colors: ['B'],
        effects: [{ kind: 'destroyPermanent', target }],
      } as CardInput);
    }

    const open = kill({ kind: 'targetCreature' });

    it.each(['attacking', 'blocking', 'attackingOrBlocking'] as const)(
      'prices a %s creature below the same effect printed at any creature',
      (combat) => {
        const narrowed = kill({ kind: 'targetCreature', filter: { combat } });
        const row = WEIGHTS.effectValue.destroyPermanent;
        const unnarrowed = row.base + row.perUnit * effectMagnitude(open.effects[0]!, WEIGHTS);
        expect(evaluateCard(narrowed, WEIGHTS).score).toBeLessThan(evaluateCard(open, WEIGHTS).score);
        expect(evaluateCard(open, WEIGHTS).score - evaluateCard(narrowed, WEIGHTS).score).toBeCloseTo(
          unnarrowed * (1 - WEIGHTS.restrictedTargetFactor),
          10,
        );
      },
    );

    it('reaches a card-type filter too, so it is not a combat-role patch', () => {
      const anyPermanent = kill({ kind: 'targetPermanent' });
      const walkerOnly = kill({ kind: 'targetPermanent', filter: { cardTypes: ['planeswalker'] } });
      expect(evaluateCard(walkerOnly, WEIGHTS).score).toBeLessThan(evaluateCard(anyPermanent, WEIGHTS).score);
    });

    it('takes the discount once when both fields narrow the same target', () => {
      const byPower = kill({ kind: 'targetCreature', restriction: { kind: 'minPower', power: 3 } });
      const byBoth = kill({
        kind: 'targetCreature',
        restriction: { kind: 'minPower', power: 3 },
        filter: { combat: 'attacking' },
      });
      expect(evaluateCard(byBoth, WEIGHTS).score).toBe(evaluateCard(byPower, WEIGHTS).score);
      expect(evaluateCard(byBoth, WEIGHTS).score).toBeLessThan(evaluateCard(open, WEIGHTS).score);
    });

    it('leaves a filter that states nothing at the price the card had', () => {
      // Two gates, and the reason the evaluator reads the empty case rather
      // than assuming it away: `parseCard` refuses this card outright, so
      // nothing that came through the front door carries an empty filter, but
      // `CardSchema` alone accepts it and `evaluateCard` takes whatever is
      // typed `Card`.
      const empty = {
        ...open,
        effects: [{ ...open.effects[0]!, target: { kind: 'targetCreature', filter: {} } }],
      };
      expect(safeParseCard({ ...empty, oracleText: open.oracleText }).ok).toBe(false);
      expect(evaluateCard(CardSchema.parse(empty), WEIGHTS).score).toBe(evaluateCard(open, WEIGHTS).score);
    });
  });

  /**
   * A color-narrowed target reads a share of the five-color pie rather than
   * the flat `restrictedTargetFactor`, when the color field is the only thing
   * narrowing the target.
   *
   * `mtg-re3i` measured why the flat number was wrong for this member: a
   * common priced word-for-word as Doom Blade ("destroy target nonblack
   * creature") came out below a card it strictly outperformed in 10,035 seeded
   * games, because the same 0.5 tuned against "with a gloom counter on it"
   * (a genuinely rare state) was also charged against a filter that excludes
   * one color of five. Magic prints five colors by construction, so "every
   * color but one" is four fifths of the pie whichever pool ships - a
   * structural fact rather than a number fit to one set's census, the way
   * `tolledSpellFactor` reads a mana off the printed ladder instead of fitting
   * a pool.
   */
  describe('a color-filtered target', () => {
    function kill(target: TargetSpec): Card {
      return parseCard({
        kind: 'instant',
        id: 'tst-color-filtered-kill',
        name: 'Color Filtered Kill',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 53 },
        manaCost: { B: 1 },
        colors: ['B'],
        effects: [{ kind: 'destroyPermanent', target }],
      } as CardInput);
    }

    const open = kill({ kind: 'targetCreature' });
    const row = WEIGHTS.effectValue.destroyPermanent;
    const unnarrowed = row.base + row.perUnit * effectMagnitude(open.effects[0]!, WEIGHTS);

    it('discounts an excludeColors filter by the excluded share of the five-color pie, not the flat weight', () => {
      const nonblack = kill({ kind: 'targetCreature', filter: { excludeColors: ['B'] } });
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(nonblack, WEIGHTS).score).toBeCloseTo(
        unnarrowed * (1 / 5),
        10,
      );
      // Strictly less punishing than the flat combat/restriction discount this
      // set also ships, which is the whole point: one color of five excluded
      // is not "with a gloom counter on it".
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(nonblack, WEIGHTS).score).toBeLessThan(
        unnarrowed * (1 - WEIGHTS.restrictedTargetFactor),
      );
    });

    it('discounts a two-color exclusion further than a one-color exclusion', () => {
      const nonblack = kill({ kind: 'targetCreature', filter: { excludeColors: ['B'] } });
      const nonblackNonblue = kill({ kind: 'targetCreature', filter: { excludeColors: ['B', 'U'] } });
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(nonblackNonblue, WEIGHTS).score).toBeCloseTo(
        unnarrowed * (2 / 5),
        10,
      );
      expect(evaluateCard(nonblackNonblue, WEIGHTS).score).toBeLessThan(
        evaluateCard(nonblack, WEIGHTS).score,
      );
    });

    it('discounts a colors filter by the excluded share of the five-color pie', () => {
      const blueOnly = kill({ kind: 'targetCreature', filter: { colors: ['U'] } });
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(blueOnly, WEIGHTS).score).toBeCloseTo(
        unnarrowed * (4 / 5),
        10,
      );
    });

    it('falls back to the flat weight once a second field also narrows the target', () => {
      const nonblackAttacking = kill({
        kind: 'targetCreature',
        filter: { excludeColors: ['B'], combat: 'attacking' },
      });
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(nonblackAttacking, WEIGHTS).score).toBeCloseTo(
        unnarrowed * (1 - WEIGHTS.restrictedTargetFactor),
        10,
      );
    });

    /**
     * The fallback is derived, and this is what says so.
     *
     * `targetNarrowingFactor` decides "the color field is the only narrowing"
     * by counting the fields the filter states, not by listing the other six.
     * A list would be a copy of `TargetFilter` that nothing keeps honest: the
     * day a seventh narrowing field lands, a card that carried it beside a
     * color would take the color's factor and the new field would price at
     * nothing at all - a silent under-discount on a card nobody wrote yet.
     *
     * So the sample map is keyed off `TargetFilterSchema.shape` and the first
     * assertion is that it still covers it. Adding a field to the DSL turns
     * this red with the field's own name in the message, which is the whole
     * point: the person who adds it decides whether it has a closed form or
     * takes the flat weight, rather than finding out from a balance sweep.
     */
    it('takes the flat weight for every other narrowing field the DSL states', () => {
      const samples: Record<string, TargetFilter> = {
        cardTypes: { cardTypes: ['creature'] },
        allCardTypes: { allCardTypes: ['creature', 'artifact'] },
        excludeCardTypes: { excludeCardTypes: ['artifact'] },
        subtypes: { subtypes: ['Goblin'] },
        colors: { colors: ['U'] },
        excludeColors: { excludeColors: ['B'] },
        keywords: { keywords: ['flying'] },
        combat: { combat: 'attacking' },
      };
      const fields = Object.keys(TargetFilterSchema.shape);

      expect(Object.keys(samples).sort()).toEqual([...fields].sort());

      // A card-type field is illegal on `targetCreature`, which has already
      // fixed its types by being the kind it is, so the whole sweep runs off
      // `targetPermanent` and takes its own unnarrowed baseline.
      const openPermanent = kill({ kind: 'targetPermanent' });
      const permanentBaseline = row.base + row.perUnit * effectMagnitude(openPermanent.effects[0]!, WEIGHTS);

      // `keywords` is the third answer this tripwire can take, and it is the
      // reason the skip below is spelled as an assertion rather than a comment.
      // The field's only legal site is a sweep's `scopeFilter` (`mtg-nhyv.62`),
      // and `targetNarrowingFactor` reads `effect.target.filter` and nothing
      // else, so there is no price to set — a card carrying it never reaches
      // this seam. The day the validator admits it on a target slot this stops
      // throwing, and whoever made that change is handed the pricing question
      // here instead of finding it in a balance sweep.
      expect(() => kill({ kind: 'targetPermanent', filter: samples['keywords'] })).toThrow(
        'ILLEGAL_TARGET_FILTER',
      );

      for (const field of fields) {
        if (field === 'colors' || field === 'excludeColors' || field === 'keywords') continue;
        const beside = kill({
          kind: 'targetPermanent',
          filter: { excludeColors: ['B'], ...samples[field] },
        });
        expect(
          evaluateCard(openPermanent, WEIGHTS).score - evaluateCard(beside, WEIGHTS).score,
          `${field} beside a color filter`,
        ).toBeCloseTo(permanentBaseline * (1 - WEIGHTS.restrictedTargetFactor), 10);
      }
    });

    it('falls back to the flat weight when a restriction narrows the target beside the color filter', () => {
      const nonblackHighPower = kill({
        kind: 'targetCreature',
        restriction: { kind: 'minPower', power: 3 },
        filter: { excludeColors: ['B'] },
      });
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(nonblackHighPower, WEIGHTS).score).toBeCloseTo(
        unnarrowed * (1 - WEIGHTS.restrictedTargetFactor),
        10,
      );
    });
  });

  /**
   * The toll discount: CR 118.8's clause, priced the way a narrowed target is.
   *
   * `unless` has been printable since the clause landed, and every other seam
   * reads it - the kernel pauses on it (`unless-choice.ts`), both bots answer
   * it (`answerUnless`, which converts the price through `tollManaWeight`), the
   * oracle printer prints it, Forge exports it. This file was the one that did
   * not, so "destroy target creature unless its controller pays {2}" scored
   * exactly what "destroy target creature" scores, and a set tuned against this
   * evaluator would never print the tolled version. Same hole `mtg-xiis` closed
   * for `TargetFilter`, one field over.
   *
   * The discount reaches the effect's whole price rather than its magnitude,
   * for the reason the restriction's does: a spell whose toll is paid does not
   * destroy less, it does nothing.
   */
  describe('a tolled spell', () => {
    function kill(unless?: UnlessClause): Card {
      return parseCard({
        kind: 'instant',
        id: 'tst-tolled-kill',
        name: 'Tolled Kill',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 53 },
        manaCost: { generic: 1, B: 1 },
        colors: ['B'],
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        ...(unless === undefined ? {} : { unless }),
      } as CardInput);
    }

    const open = kill();
    const tolled = kill({ payer: 'targetController', cost: mana({ generic: 2 }) });

    it('prices the effect below the same effect printed with no toll', () => {
      const row = WEIGHTS.effectValue.destroyPermanent;
      const untolled = row.base + row.perUnit * effectMagnitude(open.effects[0]!, WEIGHTS);
      expect(evaluateCard(tolled, WEIGHTS).score).toBeLessThan(evaluateCard(open, WEIGHTS).score);
      expect(evaluateCard(open, WEIGHTS).score - evaluateCard(tolled, WEIGHTS).score).toBeCloseTo(
        untolled * (1 - WEIGHTS.tolledSpellFactor),
        10,
      );
    });

    it('discounts a toll less than a restriction, because the hatch closes', () => {
      // A restriction is permanent: the 6/6 is never a legal target. A toll is
      // answerable only out of open mana, and a payer who cannot pay is never
      // asked at all (`unless-choice.ts`). So the softer hatch costs less, and
      // the ordering is asserted rather than left to two numbers in a config.
      expect(WEIGHTS.tolledSpellFactor).toBeGreaterThan(WEIGHTS.restrictedTargetFactor);
    });

    it('is still removal, because a toll an opponent may decline is an answer', () => {
      expect(evaluateCard(tolled, WEIGHTS).isRemoval).toBe(true);
      expect(removalPremiumFor(tolled, WEIGHTS)).toBe(removalPremiumFor(open, WEIGHTS));
    });

    it('leaves a card printing no toll at exactly the price it had', () => {
      const off = { ...WEIGHTS, tolledSpellFactor: 1 };
      expect(evaluateCard(open, WEIGHTS).score).toBe(evaluateCard(open, off).score);
      expect(evaluateCard(tolled, WEIGHTS).score).toBeLessThan(evaluateCard(tolled, off).score);
    });

    it('prices every toll the same, because this seam cannot see the payer', () => {
      // The store says the toll's size is chosen against the spell's own cost
      // rather than against a table (Force Spike {1} at MV1, Mana Leak {3} at
      // MV2, Mindstatic {6} at MV4), and what makes a given price bite is how
      // much mana the payer has open, which `evaluateCard` cannot see: it takes
      // a card, not a board. One flat factor is what this seam can honestly
      // say, and the residual is named here rather than fitted to six cards.
      const cheap = kill({ payer: 'targetController', cost: mana({ generic: 1 }) });
      const dear = kill({ payer: 'targetController', cost: mana({ generic: 6 }) });
      expect(evaluateCard(cheap, WEIGHTS).score).toBe(evaluateCard(dear, WEIGHTS).score);
    });
  });

  it('lets an anthem earn a noncreature artifact back above the vanilla baseline', () => {
    const bare = parseCard({
      kind: 'artifact',
      id: 'tst-bare-idol',
      name: 'Bare Idol',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 2 },
    } as CardInput);
    const anthem = parseCard({
      kind: 'artifact',
      id: 'tst-banner',
      name: 'Banner',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    } as CardInput);
    expect(evaluateCard(bare, WEIGHTS).score).toBeLessThan(0);
    expect(evaluateCard(anthem, WEIGHTS).score).toBeGreaterThan(evaluateCard(bare, WEIGHTS).score);
  });

  it('still decomposes into components that sum back to the score', () => {
    const lord = creature({ power: 2, toughness: 2, subtypes: ['Bear'], abilities: [LORD] });
    const evaluation = evaluateCard(lord, WEIGHTS);
    const summed = evaluation.components.reduce((sum, component) => sum + component.value, 0);
    expect(summed).toBeCloseTo(evaluation.score, 10);
  });
});

/**
 * The triggered branch of `abilityValue`, held to what its docblocks claim.
 *
 * Two claims, and until these tests existed the whole branch could be deleted
 * with every test in the repository still green. `evaluate.ts` says a trigger
 * is "the same effects a spell is scored on, times how often the condition is
 * expected to be met"; `config.ts` says `triggerFireCount`'s rows are fires per
 * resolved permanent counted off a seeded sweep. A weight nothing reads and an
 * ordering nothing checks is a table anybody may retune in any direction, which
 * is the same failure `staticScopeReach` has a test for — and a measured table
 * is easier to retune by hand, not harder, because the numbers now look
 * arbitrary.
 *
 * The effect value is never written down here. It is read off a spell carrying
 * the identical effect, which is what makes "the same effects a spell is scored
 * on" the thing being asserted rather than a copy of `EffectWeight.base` plus
 * `EffectWeight.perUnit` that drifts with them.
 */
const GAIN_TWO: TriggeredAbility = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

const FIRE_COUNT = WEIGHTS.triggerFireCount;

function triggerOn(condition: TriggerCondition): TriggeredAbility {
  return { ...GAIN_TWO, condition };
}

/** What an effect list is worth when a sorcery carries it, from the score itself. */
function spellEffectValueOf(effects: readonly unknown[]): number {
  const spell = parseCard({
    kind: 'sorcery',
    id: 'tst-blessing',
    name: 'Blessing',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 40 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    effects,
  } as CardInput);
  const component = evaluateCard(spell, WEIGHTS).components.find((entry) => entry.name === 'effects');
  if (component === undefined) throw new Error('the spell scored no effects component');
  return component.value;
}

/** What one `gainLife 2` is worth when a sorcery carries it, from the score itself. */
function spellEffectValue(): number {
  return spellEffectValueOf([{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }]);
}

describe('a triggered ability', () => {
  it('is worth its effects times the number of times its condition is expected to fire', () => {
    const effects = spellEffectValue();
    expect(effects).toBeGreaterThan(0);
    expect(abilityValue(GAIN_TWO, WEIGHTS)).toBeCloseTo(FIRE_COUNT.selfEnters * effects, 10);
  });

  it('sums a two-effect payload before the fire count multiplies it', () => {
    const two: TriggeredAbility = {
      ...GAIN_TWO,
      effects: [
        { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    };
    const draw: TriggeredAbility = {
      ...GAIN_TWO,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    };
    expect(abilityValue(two, WEIGHTS)).toBeCloseTo(
      abilityValue(GAIN_TWO, WEIGHTS) + abilityValue(draw, WEIGHTS),
      10,
    );
  });

  /**
   * The order the sweep measured on the flagship: an attack trigger fires more
   * than once because a creature that attacks usually attacks again, an enter
   * trigger fires exactly once by construction, and a death trigger fires under
   * half the time because the game ends with creatures still on the board.
   */
  it('is worth more on attack than on enter, and least on death', () => {
    expect(FIRE_COUNT.selfAttacks).toBeGreaterThan(FIRE_COUNT.selfEnters);
    expect(FIRE_COUNT.selfEnters).toBeGreaterThan(FIRE_COUNT.selfDies);
    expect(abilityValue(triggerOn('selfAttacks'), WEIGHTS)).toBeGreaterThan(
      abilityValue(triggerOn('selfEnters'), WEIGHTS),
    );
    expect(abilityValue(triggerOn('selfEnters'), WEIGHTS)).toBeGreaterThan(
      abilityValue(triggerOn('selfDies'), WEIGHTS),
    );
  });

  it('prices the enter trigger at exactly one firing, which is the certain one', () => {
    expect(FIRE_COUNT.selfEnters).toBe(1);
    expect(abilityValue(GAIN_TWO, WEIGHTS)).toBeCloseTo(spellEffectValue(), 10);
  });

  /**
   * The sweep's headline, and the row most likely to be hand-tuned back.
   *
   * Combat contact was priced at 1.0 apiece by the reasoning that a creature
   * which resolves eventually hits something. It does not: over 10,035 seeded
   * games a resolved permanent connected with a player 0.46 times and with
   * another creature 0.27 times, and needed the opponent to block into it for
   * the greater-power condition 0.09 times. All three are below the one firing
   * an enter trigger is certain of, which is the whole finding — a condition
   * that waits on the opponent is worth less than a condition that waits on
   * nothing, and by a factor rather than a margin.
   */
  it('prices every combat-contact condition under the certain enter trigger', () => {
    expect(FIRE_COUNT.selfDealsCombatDamageToPlayer).toBeLessThan(FIRE_COUNT.selfEnters);
    expect(FIRE_COUNT.selfDealsCombatDamageToCreature).toBeLessThan(FIRE_COUNT.selfEnters);
    expect(FIRE_COUNT.selfBlocks).toBeLessThan(FIRE_COUNT.selfEnters);
    expect(FIRE_COUNT.selfBlocksOrIsBlockedByGreaterPower).toBeLessThan(FIRE_COUNT.selfBlocks);
  });

  /**
   * The one row no sweep can reach, kept honest by a test rather than a
   * comment: no committed set prints `anotherControlledPermanentEnters`, so the
   * instrument has no denominator for it and it is still the guess `mtg-suy7`
   * wrote. The day a set prints one, this test is what says the guess is now
   * measurable.
   */
  it('still prices the one unmeasurable condition above its measured neighbor', () => {
    expect(FIRE_COUNT.anotherControlledPermanentEnters).toBeGreaterThan(
      FIRE_COUNT.anotherControlledCreatureEnters,
    );
  });

  it('scores a creature carrying it above the identical vanilla body', () => {
    const vanilla = creature({ power: 2, toughness: 2 });
    const herald = creature({ power: 2, toughness: 2, abilities: [GAIN_TWO] });
    expect(evaluateCard(herald, WEIGHTS).score).toBeGreaterThan(evaluateCard(vanilla, WEIGHTS).score);
    const component = evaluateCard(herald, WEIGHTS).components.find((entry) => entry.name === 'abilities');
    expect(component?.value).toBeCloseTo(abilityValue(GAIN_TWO, WEIGHTS), 10);
  });

  it('is worth nothing to a config whose fire count for that condition is zero', () => {
    const weights = resolveConfig({ weights: { triggerFireCount: { selfEnters: 0 } } }).weights;
    expect(abilityValue(GAIN_TWO, weights)).toBe(0);
    // One condition overridden, the other two left where the defaults put them.
    expect(weights.triggerFireCount.selfAttacks).toBe(FIRE_COUNT.selfAttacks);
    expect(weights.triggerFireCount.selfDies).toBe(FIRE_COUNT.selfDies);
  });
});

/**
 * The activated branch of `abilityValue`, held to what its docblocks claim.
 *
 * Four claims, and none of them is checked anywhere else: `evaluate.ts` says an
 * activation is the same effects a spell is scored on, times how often the deck
 * expects to pay for them, less what paying costs, floored at nothing;
 * `config.ts` says the tap factor is what makes an ability once per turn
 * instead of once per available mana. The effect value is read off a spell
 * carrying the identical effect rather than written down, for the reason the
 * trigger block gives.
 */
describe('an activated ability', () => {
  const PING: Ability = {
    kind: 'activated',
    cost: { mana: mana({ generic: 1 }), tapSelf: true, sacrificeSelf: false },
    effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
  };

  function withCost(mana_: Parameters<typeof mana>[0], tapSelf: boolean): Ability {
    return { ...PING, cost: { mana: mana(mana_), tapSelf, sacrificeSelf: false } } as Ability;
  }

  it('is worth its effects times the uses expected, less the mana each use costs', () => {
    const effects = spellEffectValueOf([{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);
    const uses = WEIGHTS.activationUseCount * WEIGHTS.activationTapFactor;
    expect(effects).toBeGreaterThan(0);
    expect(abilityValue(PING, WEIGHTS)).toBeCloseTo(uses * (effects - WEIGHTS.activationCostPerMana * 1), 10);
  });

  it('prices a tap cost below the same ability without one', () => {
    expect(WEIGHTS.activationTapFactor).toBeLessThan(1);
    expect(abilityValue(withCost({ generic: 1 }, false), WEIGHTS)).toBeGreaterThan(
      abilityValue(PING, WEIGHTS),
    );
  });

  it('prices a dearer cost below a cheaper one carrying the same effect', () => {
    expect(abilityValue(withCost({ generic: 3 }, true), WEIGHTS)).toBeLessThan(abilityValue(PING, WEIGHTS));
  });

  /**
   * Nobody is forced to activate, so an ability that costs more than it does is
   * worth nothing rather than worth less than nothing. Without the floor the
   * arithmetic runs backwards and a cheap repeatable ability scores below the
   * same ability with a tap cost.
   */
  it('is worth nothing, never less, when the cost outweighs what it does', () => {
    const overpriced = withCost({ generic: 16 }, false);
    expect(abilityValue(overpriced, WEIGHTS)).toBe(0);
    expect(abilityValue(withCost({ generic: 16 }, true), WEIGHTS)).toBe(0);
  });

  /**
   * The ordering the sweep reversed, kept as an assertion so a re-measurement
   * that reverses it back fails loudly rather than passing quietly.
   *
   * The reasoning this replaces was that a repeatable ability is a spell you may
   * cast again, so `activationUseCount` belonged above every conditional
   * `triggerFireCount` row. Measured, a tapping activation is used 0.241 times
   * per arrival (n=2199) and a `selfEnters` trigger fires 1.000 times, and the
   * gap is mana: the tap is free but the ability's other costs compete with
   * casting on every one of the format's seven rounds, while a trigger competes
   * with nothing. The free-to-activate spelling below is the strongest case the
   * activated side has, and it still loses.
   */
  it('is worth less than the same effect printed once as a trigger', () => {
    const free: Ability = {
      kind: 'activated',
      cost: { mana: mana(), tapSelf: true, sacrificeSelf: false },
      effects: GAIN_TWO.effects,
    };
    expect(WEIGHTS.activationUseCount * WEIGHTS.activationTapFactor).toBeLessThan(
      WEIGHTS.triggerFireCount.selfEnters,
    );
    expect(abilityValue(free, WEIGHTS)).toBeLessThan(abilityValue(GAIN_TWO, WEIGHTS));
  });

  it('scores an artifact carrying it above the identical vanilla artifact', () => {
    const bare = parseCard({
      kind: 'artifact',
      id: 'tst-beacon-bare',
      name: 'Bare Beacon',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 41 },
      manaCost: { generic: 2 },
    } as CardInput);
    const wired = parseCard({
      kind: 'artifact',
      id: 'tst-beacon',
      name: 'Ashen Beacon',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 42 },
      manaCost: { generic: 2 },
      abilities: [PING],
    } as CardInput);
    expect(evaluateCard(wired, WEIGHTS).score).toBeGreaterThan(evaluateCard(bare, WEIGHTS).score);
    const component = evaluateCard(wired, WEIGHTS).components.find((entry) => entry.name === 'abilities');
    expect(component?.value).toBeCloseTo(abilityValue(PING, WEIGHTS), 10);
  });

  it('is worth nothing to a config that expects it never to be used', () => {
    const weights = resolveConfig({ weights: { activationUseCount: 0 } }).weights;
    expect(abilityValue(PING, weights)).toBe(0);
    // One weight overridden, the neighbors left where the defaults put them.
    expect(weights.activationTapFactor).toBe(WEIGHTS.activationTapFactor);
    expect(weights.activationCostPerMana).toBe(WEIGHTS.activationCostPerMana);
  });

  /**
   * A cost that eats its own source is paid once.
   *
   * The activation branch used to read `tapSelf` and nothing else, so
   * "{1}, Sacrifice this: ..." was priced at `activationUseCount` uses — two and
   * a half times a card that fires once. Both `sacrificeSelf` abilities in The
   * flagship set were scored that way. The count is one because the permanent
   * is gone after the cost is paid (CR 602.2a), which is arithmetic rather than
   * an assumption, so it is not a weight.
   */
  describe('an activation that sacrifices its own source', () => {
    const FUSE: Ability = {
      kind: 'activated',
      cost: { mana: mana({ generic: 1 }), tapSelf: false, sacrificeSelf: true },
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
    };

    /**
     * One use is a ceiling, and on the flagship's measured count it does not
     * bind. `activationUseCount` is 0.608, so `Math.min(1, 0.608)` is 0.608 and
     * a one-shot prices exactly as a non-tapping repeatable ability does. The
     * cap is still the rule; the pool it is applied to no longer reaches it.
     */
    it('is worth at most one use of its effects, never the repeatable count', () => {
      const effects = spellEffectValueOf(FUSE.effects);
      const uses = Math.min(1, WEIGHTS.activationUseCount);
      expect(uses).toBeLessThanOrEqual(1);
      expect(abilityValue(FUSE, WEIGHTS)).toBeCloseTo(
        uses * (effects - WEIGHTS.activationCostPerMana * 1),
        10,
      );
    });

    /**
     * Never above, and below exactly when the count clears 1. The statistic that
     * would make it strictly below at any count is the share of arrivals that
     * activate at all, which `@mtg/sim`'s census does not yet separate from the
     * activations themselves.
     */
    it('never scores above the same ability that keeps its source', () => {
      const repeatable: Ability = { ...FUSE, cost: { ...FUSE.cost, sacrificeSelf: false } } as Ability;
      expect(abilityValue(FUSE, WEIGHTS)).toBeLessThanOrEqual(abilityValue(repeatable, WEIGHTS));
    });

    /**
     * A permanent about to be sacrificed does not care whether it also tapped,
     * so the tap factor cannot make a one-shot cheaper than one use.
     */
    it('ignores a tap clause it is paid alongside', () => {
      const tapping: Ability = { ...FUSE, cost: { ...FUSE.cost, tapSelf: true } } as Ability;
      expect(abilityValue(tapping, WEIGHTS)).toBeCloseTo(abilityValue(FUSE, WEIGHTS), 10);
    });

    /** The cap is a ceiling, not a floor: a config expecting no activations still gets none. */
    it('is still worth nothing to a config that expects no activation at all', () => {
      const weights = resolveConfig({ weights: { activationUseCount: 0 } }).weights;
      expect(abilityValue(FUSE, weights)).toBe(0);
    });
  });

  /**
   * Repeatable removal is removal. Without this the builder scores
   * "{2}, {T}: Destroy target creature" as a vanilla artifact, and a Limited
   * deck built from a pool whose answers are all abilities gets none of them.
   */
  it('counts as removal when it can answer a creature', () => {
    const destroyer = parseCard({
      kind: 'artifact',
      id: 'tst-nightclad-blade',
      name: 'Nightclad Blade',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 43 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true, sacrificeSelf: false },
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    } as CardInput);
    expect(isRemovalCard(destroyer, WEIGHTS)).toBe(true);
    expect(evaluateCard(destroyer, WEIGHTS).isRemoval).toBe(true);
  });

  it('is not removal when the ability cannot answer a creature', () => {
    const healer = creature({
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, tapSelf: true, sacrificeSelf: false },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(isRemovalCard(healer, WEIGHTS)).toBe(false);
  });

  it('does not make a trigger carrying removal text into removal', () => {
    // The removal test is about aiming, not about the word: this trigger mills,
    // and nothing on the board is any less alive for it.
    const bearer = creature({
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'millCards', count: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(isRemovalCard(bearer, WEIGHTS)).toBe(false);
  });

  /**
   * The Flametongue Kavu case, which `mtg-bc2.132.6` made expressible.
   *
   * A creature whose enters trigger destroys something is the removal spell of
   * Limited, and it is a creature, so a builder that only looked at activated
   * abilities counted it as a body and built a deck it believed had no answers.
   */
  it('counts a targeted trigger that answers a creature', () => {
    const kavu = creature({
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    expect(isRemovalCard(kavu, WEIGHTS)).toBe(true);
    expect(evaluateCard(kavu, WEIGHTS).isRemoval).toBe(true);
  });

  /**
   * The premium is halved for an activation and paid in full for a trigger,
   * which is the difference `isRemovalCard`'s docblock has always said belongs
   * in the weights. Wyrmhead of the Gloom Chasm is the card that made it matter:
   * a {3}{B}{B} 4/4 whose only answer is "{1}{B}, {T}: two gloom counters on
   * target creature" was earning what a sorcery that destroys one outright
   * earns, and the builder took it over a five-mana spell that makes four
   * bodies. Both halves are asserted against `WEIGHTS` rather than against a
   * literal, so re-tuning the scale moves the test with the table.
   */
  it('pays an activation half of what it pays a trigger for the same answer', () => {
    const answer = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;
    const body = { power: 2, toughness: 2 } as const;
    const triggered = creature({
      ...body,
      abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [answer] }],
    });
    const activated = creature({
      ...body,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: mana({ generic: 1 }), tapSelf: true, sacrificeSelf: false },
          effects: [answer],
        },
      ],
    });
    expect(removalPremiumFor(triggered, WEIGHTS)).toBe(WEIGHTS.removalPremium);
    expect(removalPremiumFor(activated, WEIGHTS)).toBe(
      WEIGHTS.removalPremium * WEIGHTS.removalPremiumActivatedScale,
    );
    // Discounted, not disqualified: a deck asking whether it holds an answer
    // still counts this one, which is why `isRemovalCard` stays true.
    expect(isRemovalCard(activated, WEIGHTS)).toBe(true);
  });

  it('prices a card at its cheapest reach when it answers two ways', () => {
    const answer = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;
    const both = creature({
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: mana({ generic: 1 }), tapSelf: true, sacrificeSelf: false },
          effects: [answer],
        },
        { kind: 'triggered', condition: 'selfEnters', effects: [answer] },
      ],
    });
    expect(removalPremiumFor(both, WEIGHTS)).toBe(WEIGHTS.removalPremium);
  });

  it('still ignores a static, which modifies its scope rather than aiming', () => {
    const anthem = creature({
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          modification: { kind: 'statBonus', power: 1, toughness: 0 },
        },
      ],
    });
    expect(isRemovalCard(anthem, WEIGHTS)).toBe(false);
  });
});

/**
 * The equip arm of `abilityValue` (`isAttachingAbility`), held to what
 * `mtg-6zs8` found: it summed a clause's modification with nothing bounding
 * it, so a two-mana Equipment granting +99/-3 scored 165.83 — twenty times
 * the strongest real card in the set that found it (RATE_ABOVE_CURVE fired
 * at 82.91 against a 3.55 runner-up).
 *
 * Two claims, each pinned the way `an activated ability` above pins its own:
 * a modification stops being worth more once it passes
 * `equipModificationCeiling`, and the card's own cast cost is charged exactly
 * once — by `evaluateCard`'s `artifact` case, which every Equipment runs
 * through because CR 301.5 requires Equipment to be an artifact — not a
 * second time inside this arm.
 */
describe('an equip ability', () => {
  function equip(power: number, toughness: number, equipGeneric: number): Ability {
    return {
      kind: 'activated',
      cost: { mana: mana({ generic: equipGeneric }), tapSelf: false, sacrificeSelf: false },
      effects: [],
      attach: { modifications: [{ kind: 'statBonus', power, toughness }] },
    };
  }

  const CEILING = WEIGHTS.creatureStatBaselinePerMana * WEIGHTS.formatMedianRounds;

  it('prices a modification under the ceiling exactly as printed, less the equip cost', () => {
    const modest = equip(3, 3, 1);
    const modification = bodyValue(3, 3, [], [], WEIGHTS);
    expect(modification).toBeLessThan(CEILING);
    const expected = WEIGHTS.equipHostCount * (modification - WEIGHTS.activationCostPerMana * 1);
    expect(abilityValue(modest, WEIGHTS)).toBeCloseTo(expected, 10);
  });

  /**
   * The property the ceiling exists to guarantee: past it, a bigger printed
   * delta buys nothing more. Without the clamp this fails outright — power 99
   * scores far above power at the ceiling, which is the 165.83 the bead
   * reports.
   */
  it('stops rewarding a modification once it passes the ceiling', () => {
    const atCeiling = equip(CEILING / WEIGHTS.creaturePowerWeight, 0, 1);
    const wayPast = equip(99, 0, 1);
    expect(abilityValue(wayPast, WEIGHTS)).toBeCloseTo(abilityValue(atCeiling, WEIGHTS), 10);
  });

  it('still floors at zero when even a clamped modification cannot pay for a dear equip cost', () => {
    const dear = equip(99, -3, 40);
    expect(abilityValue(dear, WEIGHTS)).toBe(0);
  });

  /**
   * `evaluateCard`'s `artifact` case charges every noncreature artifact's own
   * cast cost once, through `manaPenalty` — and every Equipment is an
   * artifact (CR 301.5), so that case runs for this card before the
   * `abilities` component below is even added to it. If this arm also
   * subtracted the cast cost, `abilities` would read low by that amount and
   * this equality would break; if `evaluateCard` stopped charging it,
   * `manaPenalty` below would read zero instead of the cast cost.
   */
  it('charges the equip cost inside the ability, and the cast cost once outside it', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'tst-fair-blade',
      name: 'Fair Blade',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 50 },
      manaCost: { generic: 2 },
      subtypes: ['Equipment'],
      abilities: [equip(3, 3, 1)],
    } as CardInput);
    const evaluation = evaluateCard(card, WEIGHTS);

    const manaPenalty = evaluation.components.find((entry) => entry.name === 'manaPenalty');
    expect(manaPenalty?.value).toBeCloseTo(-WEIGHTS.spellManaPenaltyPerMana * 2, 10);

    const abilities = evaluation.components.find((entry) => entry.name === 'abilities');
    const modification = bodyValue(3, 3, [], [], WEIGHTS);
    const equipOnlyCost = WEIGHTS.equipHostCount * (modification - WEIGHTS.activationCostPerMana * 1);
    expect(abilities?.value).toBeCloseTo(equipOnlyCost, 10);
  });

  /**
   * The card the bead reports, reconstructed: a two-mana Equipment granting
   * +99/-3 for a one-mana equip cost. Pre-fix this scored 165.83 (rate 82.91
   * per mana, `mtg-6zs8`) — about 23x the strongest real card the gate that
   * caught it had measured. Bounded, it still beats a realistic bomb
   * Equipment (the ceiling prices what the stats can do, and this evaluator
   * has no way to price the drawback the model could not express back down),
   * but it is a small multiple of one, not an order of magnitude past it.
   */
  it('lands the +99/-3 case within a small multiple of a realistic bomb Equipment, not twenty times it', () => {
    const reference = parseCard({
      kind: 'artifact',
      id: 'tst-fair-blade-2',
      name: 'Fair Blade',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 51 },
      manaCost: { generic: 2 },
      subtypes: ['Equipment'],
      abilities: [equip(5, 5, 2)],
    } as CardInput);
    const runaway = parseCard({
      kind: 'artifact',
      id: 'tst-runaway-blade',
      name: 'Runaway Blade',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 52 },
      manaCost: { generic: 2 },
      subtypes: ['Equipment'],
      abilities: [equip(99, -3, 1)],
    } as CardInput);

    const referenceScore = evaluateCard(reference, WEIGHTS).score;
    const runawayScore = evaluateCard(runaway, WEIGHTS).score;
    expect(runawayScore).toBeGreaterThan(referenceScore);
    expect(runawayScore).toBeLessThan(referenceScore * 10);
  });
});

describe('effectMagnitude', () => {
  /**
   * A sweep is worth the removal spells it replaces, and how many that is comes
   * from a named weight rather than from the effect: board width is not on the
   * card. The unscoped half is pinned in the same test because the split of
   * `exileTarget`'s price into a zero base and a full per-unit rate exists only
   * so the scoped half can be multiplied — it must leave the single-target spell
   * scoring exactly what `destroyPermanent` does.
   */
  it('multiplies a scoped exile by its assumed reach and leaves the unscoped one alone', () => {
    const single: Effect = { kind: 'exileTarget', target: { kind: 'targetCreature' } };
    const sweep: Effect = {
      kind: 'exileTarget',
      scope: 'creaturesThatPlayerControls',
      target: { kind: 'targetOpponent' },
    };
    expect(effectMagnitude(single, WEIGHTS)).toBe(1);
    expect(effectMagnitude(sweep, WEIGHTS)).toBe(WEIGHTS.effectScopeReach.creaturesThatPlayerControls);
    expect(WEIGHTS.effectValue.exileTarget.base + WEIGHTS.effectValue.exileTarget.perUnit).toBeCloseTo(
      WEIGHTS.effectValue.destroyPermanent.base + WEIGHTS.effectValue.destroyPermanent.perUnit,
      10,
    );
  });

  it('scales token creation by count times the price of one body', () => {
    const summons = exampleCard('slc-wild-summons');
    const effect = summons.effects[0];
    if (effect === undefined || effect.kind !== 'createToken') throw new Error('fixture changed');
    const oneBody = bodyEffectValue(bodyValue(2, 2, [], [], WEIGHTS), WEIGHTS) + WEIGHTS.creaturePremium;
    expect(effectMagnitude(effect, WEIGHTS)).toBeCloseTo(2 * oneBody, 10);
  });

  /**
   * Both halves of "how much board did this put down" move the price, because
   * a row that read only one of them would price four 0/1s and one 4/4 the
   * same (`mtg-pxzq`).
   */
  it('moves with the count and with the body, and is linear in the count', () => {
    const soldier = { name: 'Soldier', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] };
    const one: Effect = { kind: 'createToken', count: 1, token: soldier };
    const four: Effect = { kind: 'createToken', count: 4, token: soldier };
    const ogre: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Ogre', power: 4, toughness: 4, colors: [], subtypes: [], keywords: [] },
    };

    expect(effectMagnitude(four, WEIGHTS)).toBeCloseTo(4 * effectMagnitude(one, WEIGHTS), 10);
    expect(effectMagnitude(four, WEIGHTS)).toBeGreaterThan(effectMagnitude(one, WEIGHTS));
    expect(effectMagnitude(ogre, WEIGHTS)).toBeGreaterThan(effectMagnitude(one, WEIGHTS));
  });

  /**
   * `nwo.ts`'s `wideBoard` rule reads an unreadable count as wide, because the
   * budget it spends is spent by the widest board the card could make. This
   * reads the same count as one, because the price it charges is charged for
   * every body it assumes.
   */
  it('reads an unreadable count as one body rather than as the file’s assumption of three', () => {
    const soldier = { name: 'Soldier', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] };
    const one: Effect = { kind: 'createToken', count: 1, token: soldier };
    const chosen: Effect = { kind: 'createToken', count: { kind: 'chosenX' }, token: soldier };

    expect(effectMagnitude(chosen, WEIGHTS)).toBeCloseTo(effectMagnitude(one, WEIGHTS), 10);
    expect(effectMagnitude(chosen, WEIGHTS)).toBeLessThan(
      WEIGHTS.computedAmountAssumption * effectMagnitude(one, WEIGHTS),
    );
  });

  /**
   * A part token is worth what spending it does, and a Key is worth nothing yet.
   *
   * `mtg-bc2.132.7` made a token able to carry an ability and able to have no
   * body. Both halves change what a Monster's death trigger is worth to a deck:
   * pricing an artifact token as a 0/0 creature would make every drop in The
   * flagship set score the same, whether the thing dropped does something or
   * nothing.
   */
  it('prices a bodiless token by its abilities rather than by a body it has not got', () => {
    // `TokenAbility` rather than `Ability`: a token's abilities are the card
    // vocabulary minus `createToken`, and the annotation is the compiler saying so.
    const fuse: TokenAbility = {
      kind: 'activated',
      cost: { mana: mana({ generic: 1 }), tapSelf: false, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    };
    const part: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Trophy Horn', colors: [], subtypes: [], keywords: [], abilities: [fuse] },
    };
    const key: Effect = {
      kind: 'createToken',
      count: 1,
      token: { name: 'Key', colors: [], subtypes: [], keywords: [] },
    };

    expect(effectMagnitude(key, WEIGHTS)).toBe(0);
    expect(effectMagnitude(part, WEIGHTS)).toBeCloseTo(abilityValue(fuse, WEIGHTS), 10);
    expect(effectMagnitude(part, WEIGHTS)).toBeGreaterThan(effectMagnitude(key, WEIGHTS));
  });

  it("adds a creature token's abilities to its body rather than replacing it", () => {
    const greeting: TokenAbility = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    };
    const body = { name: 'Herald', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] };
    const herald: Effect = {
      kind: 'createToken',
      count: 1,
      token: { ...body, abilities: [greeting] },
    };
    const vanilla: Effect = { kind: 'createToken', count: 1, token: body };

    const bodyPrice = bodyEffectValue(bodyValue(1, 1, [], [], WEIGHTS), WEIGHTS) + WEIGHTS.creaturePremium;
    expect(effectMagnitude(vanilla, WEIGHTS)).toBeCloseTo(bodyPrice, 10);
    // The ability is added unconverted: it is already worth what the same
    // ability printed on a card is worth, and only the body needs reading out
    // of the creature arm's units.
    expect(effectMagnitude(herald, WEIGHTS)).toBeCloseTo(bodyPrice + abilityValue(greeting, WEIGHTS), 10);
  });

  it('uses the primitive-specific unit for each effect kind', () => {
    expect(effectMagnitude({ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }, WEIGHTS)).toBe(
      3,
    );
    expect(
      effectMagnitude(
        { kind: 'pumpUntilEndOfTurn', power: 2, toughness: 3, target: { kind: 'targetCreature' } },
        WEIGHTS,
      ),
    ).toBe(5);
    expect(effectMagnitude({ kind: 'counterSpell' }, WEIGHTS)).toBe(1);
    expect(effectMagnitude({ kind: 'millCards', count: 4, target: { kind: 'noTarget' } }, WEIGHTS)).toBe(4);
  });
});

/**
 * The two arms of `evaluateCard` charge a card's mana at different rates, so a
 * body a spell delivers has to be read out of one arm's units and into the
 * other's. These are card-level tests because the agreement they pin is a claim
 * about scores: before `mtg-pxzq` the `createToken` row priced a token at a
 * flat fraction of its body value, which charged the spell for its mana a
 * second time and left a five-mana sorcery making a 4/4 flier and three parts
 * below a five-mana creature that makes one token when it dies.
 */
describe('token pricing against the creature baseline', () => {
  /** A creature whose stats are exactly what its cost buys at the baseline. */
  function fairBody(generic: number): { power: number; toughness: number } {
    const stats = WEIGHTS.creatureStatBaselinePerMana * generic;
    const power = stats / (WEIGHTS.creaturePowerWeight + WEIGHTS.creatureToughnessWeight);
    return { power, toughness: power };
  }

  function creatureCard(generic: number, power: number, toughness: number): Card {
    return parseCard({
      kind: 'creature',
      id: 'tst-golem',
      name: 'Golem',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 60 },
      manaCost: { generic },
      colors: [],
      power,
      toughness,
    } as CardInput);
  }

  function tokenSorcery(generic: number, power: number, toughness: number): Card {
    return parseCard({
      kind: 'sorcery',
      id: 'tst-blessing',
      name: 'Blessing',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 61 },
      manaCost: { generic },
      colors: [],
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: 'Golem', power, toughness, colors: [], subtypes: [], keywords: [] },
        },
      ],
    } as CardInput);
  }

  /**
   * The property that makes this a derivation rather than a constant: at the
   * baseline the two arms agree exactly, and they agree at every cost. A token
   * spell that hands over a fair body for its mana is worth what a fair
   * creature card of that mana is worth, which is `creaturePremium`.
   */
  it('scores a fair body handed over by a spell what a fair creature card of that cost scores', () => {
    for (const generic of [2, 4, 6]) {
      const { power, toughness } = fairBody(generic);
      const printed = evaluateCard(creatureCard(generic, power, toughness), WEIGHTS).score;
      const made = evaluateCard(tokenSorcery(generic, power, toughness), WEIGHTS).score;
      expect(printed).toBeCloseTo(WEIGHTS.creaturePremium, 10);
      expect(made).toBeCloseTo(printed, 10);
    }
  });

  /**
   * Above the baseline the arms have to diverge, because only one of them
   * charges 2.0 a mana. The direction is the one this evaluator takes wherever
   * it has to choose: the spell is still paid for the surplus, at the rate its
   * own arm prices mana, which is less than the creature arm pays.
   */
  it('pays a token spell less for stats above the baseline than a creature card is paid', () => {
    const printed = evaluateCard(creatureCard(4, 8, 8), WEIGHTS).score;
    const made = evaluateCard(tokenSorcery(4, 8, 8), WEIGHTS).score;
    expect(made).toBeGreaterThan(WEIGHTS.creaturePremium);
    expect(made).toBeLessThan(printed);
  });

  /**
   * The arm is reached from an ability as well as from a spell, and the body it
   * prices is the same body either way. What differs is the cost of reaching
   * it, and a trigger's cost is its condition, which `triggerFireCount` already
   * charges.
   */
  it('prices a token an ability makes at the same body, times the condition’s fire count', () => {
    const drop: TriggeredAbility = {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: 'Soldier', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] },
        },
      ],
    };
    const bare = evaluateCard(creature({ power: 2, toughness: 2 }), WEIGHTS).score;
    const dropper = evaluateCard(creature({ power: 2, toughness: 2, abilities: [drop] }), WEIGHTS).score;
    const bodyPrice = bodyEffectValue(bodyValue(1, 1, [], [], WEIGHTS), WEIGHTS) + WEIGHTS.creaturePremium;

    expect(dropper - bare).toBeCloseTo(WEIGHTS.triggerFireCount.selfDies * bodyPrice, 10);
  });
});

/**
 * A shrink is removal by the same rule a burn spell is removal: it takes away
 * toughness, and once it takes away enough, the creature is a state-based
 * action away from dead (CR 704.5g). Before this fix `isRemovalEffect` had no
 * arm for a negative `pumpUntilEndOfTurn` and only recognized a scoped
 * `putCounters` sweep, and `EFFECT_PRICING.pumpUntilEndOfTurn` charged a flat
 * per-point rate that read a negative toughness as a cost rather than a
 * benefit — so a card that shrinks a creature to death scored as a penalty
 * instead of an answer.
 */
describe('shrink effects as removal', () => {
  function shrinkSpell(toughness: number): Card {
    return parseCard({
      kind: 'instant',
      id: 'tst-shrink',
      name: 'Test Shrink',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 5 },
      manaCost: { generic: 1, B: 1 },
      colors: ['B'],
      effects: [{ kind: 'pumpUntilEndOfTurn', power: 0, toughness, target: { kind: 'targetCreature' } }],
    } satisfies CardInput);
  }

  function gloomSpell(count: number): Card {
    return parseCard({
      kind: 'instant',
      id: 'tst-gloom',
      name: 'Test Gloom',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 6 },
      manaCost: { B: 1 },
      colors: ['B'],
      effects: [{ kind: 'putCounters', counter: 'gloom', count, target: { kind: 'targetCreature' } }],
    } satisfies CardInput);
  }

  it('classifies a negative pumpUntilEndOfTurn as removal once it clears the floor', () => {
    const shrink = shrinkSpell(-2);
    expect(isRemovalCard(shrink, WEIGHTS)).toBe(true);
    expect(evaluateCard(shrink, WEIGHTS).isRemoval).toBe(true);
  });

  it('does not classify a sub-floor shrink as removal', () => {
    expect(isRemovalCard(shrinkSpell(-1), WEIGHTS)).toBe(false);
  });

  it('prices a shrinking pumpUntilEndOfTurn by the toughness it removes, not as a penalty', () => {
    expect(effectMagnitude(shrinkSpell(-2).effects[0] as Effect, WEIGHTS)).toBe(2);
  });

  it('still prices a positive pumpUntilEndOfTurn as power plus toughness', () => {
    expect(effectMagnitude(shrinkSpell(2).effects[0] as Effect, WEIGHTS)).toBe(2);
  });

  it('classifies an unscoped shrinking putCounters as removal, not only a scoped sweep', () => {
    const gloom = gloomSpell(2);
    expect(isRemovalCard(gloom, WEIGHTS)).toBe(true);
    expect(evaluateCard(gloom, WEIGHTS).isRemoval).toBe(true);
  });

  it('does not classify a sub-floor shrinking putCounters as removal', () => {
    expect(isRemovalCard(gloomSpell(1), WEIGHTS)).toBe(false);
  });

  it('prices a shrinking putCounters by the toughness it removes rather than by stat value', () => {
    expect(effectMagnitude(gloomSpell(2).effects[0] as Effect, WEIGHTS)).toBe(2);
  });

  it('still prices a growing putCounters (+1/+1) by its stat value', () => {
    const buff: Effect = {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 2,
      target: { kind: 'targetCreature' },
    };
    expect(effectMagnitude(buff, WEIGHTS)).toBeCloseTo(
      2 * (WEIGHTS.creaturePowerWeight + WEIGHTS.creatureToughnessWeight),
      10,
    );
  });
});

/**
 * A keyword whose whole benefit is combat damage getting through cannot help
 * a creature that deals none. `DEFAULT_KEYWORD_BASE.flying` used to be a flat
 * value regardless of power, so a 0-power flier scored as a playable common:
 * the flagship build prints a {W} 0/2 flying that evaluated at 1.70 and was
 * built into 70% of seeded decks, even though a 0-power evasive creature can
 * never win a game on its own.
 */
describe('keyword value at zero power', () => {
  const offensive = ['flying', 'trample', 'menace', 'firstStrike', 'deathtouch', 'lifelink'] as const;
  const flat = ['vigilance', 'reach'] as const;

  it('zeroes the offensive-evasion keywords on a zero-power body', () => {
    for (const keyword of offensive) {
      expect(bodyValue(0, 2, [keyword], [], WEIGHTS)).toBeCloseTo(bodyValue(0, 2, [], [], WEIGHTS), 10);
    }
  });

  it('keeps crediting keywords whose value does not depend on dealing damage', () => {
    for (const keyword of flat) {
      expect(bodyValue(0, 2, [keyword], [], WEIGHTS)).toBeGreaterThan(bodyValue(0, 2, [], [], WEIGHTS));
    }
  });

  it('resumes crediting an offensive keyword once the body has power to push through', () => {
    for (const keyword of offensive) {
      expect(bodyValue(1, 2, [keyword], [], WEIGHTS)).toBeGreaterThan(bodyValue(1, 2, [], [], WEIGHTS));
    }
  });

  it('stops a 0/2 flier from evaluating as a playable common', () => {
    const grounded = evaluateCard(creature({ power: 0, toughness: 2 }), WEIGHTS);
    const flier = evaluateCard(creature({ power: 0, toughness: 2, keywords: ['flying'] }), WEIGHTS);
    expect(flier.score).toBeCloseTo(grounded.score, 10);
  });
});

describe('cardColors', () => {
  it('is WUBRG-sorted and unions the declared colors with the cost', () => {
    expect(cardColors(exampleCard('slc-lightning-lash'))).toEqual(['R']);
    expect(cardColors(exampleCard('slc-ironclad-golem'))).toEqual([]);
    expect(cardColors(BASIC_LANDS[0] ?? exampleCard('slc-lightning-lash'))).toEqual([]);
  });

  it('does not trust a mislabeled color field to hide a colored pip', () => {
    // Deliberately inconsistent: the DSL validators would reject this, but the
    // builder must never let it through as a "colorless" playable.
    const mislabeled = { ...exampleCard('slc-lightning-lash'), colors: [] } as Card;
    expect(cardColors(mislabeled)).toEqual(['R']);
  });
});

describe('evaluatePool', () => {
  it('tags every evaluation with its pool position', () => {
    const pool = [...BASIC_LANDS, exampleCard('slc-lightning-lash')];
    const evaluated = evaluatePool(pool, WEIGHTS);
    expect(evaluated.map((entry) => entry.poolIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(evaluated.map((entry) => entry.card.id)).toEqual(pool.map((card) => card.id));
  });
});
