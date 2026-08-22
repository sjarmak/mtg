/**
 * Every tunable number the deck builder uses, in one inspectable object.
 *
 * This tier is a *deterministic heuristic baseline*: no LLM is consulted, so
 * the only thing standing between the pool and the deck is arithmetic over
 * these weights. They are therefore all named, all documented, and all
 * overridable — a magic number buried in a scoring function would make the
 * later LLM deck-building tier impossible to compare against.
 *
 * Sourced targets (see `docs/research/prior-art-set-design.md` §6.3 and
 * `docs/research/prior-art-playability-metrics.md` §4.4):
 *
 * - 40-card Limited deck = 17 lands + 23 spells (standard).
 * - Curve mass at MV 2-4, with two or three cards at MV 5+.
 * - Creature floor ~12, typical 14-17.
 * - Karsten's reliability threshold is ~90% on-curve castability; the mana
 *   base reports against it rather than guessing a land split.
 */
import type {
  AnyEffectKind,
  EffectScope,
  Keyword,
  KeywordAbility,
  StaticScope,
  TriggerCondition,
} from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_SCOPES,
  KEYWORD_ABILITY_KINDS,
  KEYWORDS,
  STATIC_SCOPES,
  TRIGGER_CONDITIONS,
} from '@mtg/dsl';
import { DEFAULT_EFFECT_VALUE, DEFAULT_TOP_END_REACHABILITY } from './evaluate';
import type { CurveBucket, CurveHistogram } from './curve-bucket';
import { CURVE_BUCKETS, curveTotal } from './curve-bucket';
import { checkUnknownConfigKeys } from './config-unknown-keys';

/**
 * What one spell-effect primitive is worth: a flat part and a rate.
 *
 * One record per primitive rather than two parallel tables keyed the same way,
 * for the reason `@mtg/dsl`'s `CounterDeclaration` is one record: the two
 * numbers are halves of a single pricing decision, and `exileTarget` in
 * `DEFAULT_EFFECT_VALUE` is the row that proves it — its comment had to
 * describe a split across two tables a reader could not see from either one.
 */
export interface EffectWeight {
  /** Flat value of the primitive, before its magnitude. */
  readonly base: number;
  /**
   * Value per unit of the effect's magnitude. The unit differs per primitive
   * and is defined by `effectMagnitude` in `evaluate.ts`: damage dealt, cards
   * drawn, life gained, stat points pumped, cards milled, or (for tokens) the
   * bodies created, already priced against the creature baseline, which is why
   * `createToken` carries a rate of 1 and a base of 0 rather than a rate of its
   * own, and why overriding it scales a derived price instead of naming one.
   */
  readonly perUnit: number;
}

/**
 * What one **keyword ability** is worth: a flat part, a rate per point of
 * power, and a share of the body it protects.
 *
 * Three parts rather than `EffectWeight`'s two, and the third is why this is a
 * record of its own rather than another pair of tables beside `keywordBase`
 * and `keywordPowerScale`. `KeywordAbilitySchema`'s six split cleanly into two
 * shapes that cannot share a scaling term:
 *
 *  - **combat-shaped** (`defender`, `landwalk`, `doubleStrike`), which change
 *    what the creature does with the power it has, and so read `perPower` the
 *    way `keywordPowerScale` does; and
 *  - **survival-shaped** (`hexproof`, `indestructible`, `protection`), which
 *    change how long the body keeps doing it, and so read a share of the whole
 *    body's stat value — power *and* toughness — because what they protect is
 *    the whole body. A 0/6 indestructible wall is the case that settles it: on
 *    a power rate it prices at nothing, and it is one of the better commons a
 *    Limited deck can open.
 *
 * Every row states all three, most of them zero, for `EffectWeight`'s stated
 * reason: an override replaces a keyword ability's whole price rather than one
 * third of it, and a caller who moved `perPower` without noticing `bodyShare`
 * would have silently repriced the card.
 */
export interface KeywordAbilityWeight {
  /** Flat value, independent of the body carrying it. */
  readonly flat: number;
  /** Value per point of the body's power. */
  readonly perPower: number;
  /**
   * Value as a share of the body this ability keeps alive, measured in the
   * same `statValue` units the creature arm scores stats in. A planeswalker's
   * body for this purpose is its loyalty, which is what `evaluate.ts` already
   * calls the quantity an opponent has to spend combat damage on.
   */
  readonly bodyShare: number;
}

/** Per-card scoring weights. Higher score = earlier pick. */
export interface CardScoreWeights {
  /**
   * Flat bonus every creature receives. Limited decks are won on the board;
   * a body is worth more than its raw stats suggest.
   */
  readonly creaturePremium: number;
  /**
   * Expected power+toughness per mana for a "fair" vanilla creature. The
   * printed bear line is 2/2 for two mana, 3/3 for three, so 2.0 stats/mana is
   * the zero point; creatures score their surplus over it.
   */
  readonly creatureStatBaselinePerMana: number;
  /** Power's share of a body's stat value. Power + toughness weights sum to the baseline. */
  readonly creaturePowerWeight: number;
  /** Toughness's share of a body's stat value; below power because Limited races. */
  readonly creatureToughnessWeight: number;
  /**
   * Flat value of each evergreen keyword on a creature. Read through
   * `keywordValue` in `evaluate.ts`, which floors an offensive-evasion keyword
   * (flying, trample, menace, firstStrike, deathtouch, lifelink — see
   * `ZERO_AT_ZERO_POWER` there) to zero on a zero-power body: this base value
   * is what the keyword is worth once the body has power to make good on it,
   * not an unconditional flat rate.
   */
  readonly keywordBase: Readonly<Record<Keyword, number>>;
  /**
   * Extra keyword value per point of power. Evasion and damage-linked keywords
   * (flying, trample, lifelink) scale with the body carrying them; deathtouch
   * scales negatively because it matters most on small creatures.
   */
  readonly keywordPowerScale: Readonly<Record<Keyword, number>>;
  /**
   * What each of `KEYWORD_ABILITY_KINDS` is worth on the permanent printing it.
   *
   * The second keyword vocabulary, and until `mtg-gloz` the unpriced one: the
   * six live on `card.keywordAbilities` rather than `card.keywords`, and
   * `keywordValue` above reads only the latter, so a 0/6 with `defender` and a
   * 0/6 vanilla were the same card to this builder while the kernel played
   * them as different cards. `DEFAULT_KEYWORD_ABILITY_VALUE` carries the
   * per-row derivations.
   */
  readonly keywordAbilityValue: Readonly<Record<KeywordAbility['kind'], KeywordAbilityWeight>>;
  /** What each spell-effect primitive is worth: a flat part and a rate. */
  readonly effectValue: Readonly<Record<AnyEffectKind, EffectWeight>>;
  /**
   * Premium for a card that can answer a creature. ~20% of a Limited
   * environment is removal and removal is the most contested pick class, so
   * this is the single largest lever in the table.
   */
  readonly removalPremium: number;
  /**
   * Fraction of `removalPremium` a card earns when the only place it answers a
   * creature is an activated ability.
   *
   * `isRemovalCard`'s docblock has always said this belongs here: "the timing
   * difference against an activation belongs in the weights, not here". Until
   * `isRemovalEffect` learned to read a shrink, nothing in the flagship reached
   * removal through an activation, so the sentence described a lever that did
   * not exist. Wyrmhead of the Gloom Chasm is what made it load-bearing: a
   * {3}{B}{B} 4/4 whose "{1}{B}, {T}: two gloom counters on target creature"
   * was priced at the same 1.5 as a sorcery that destroys one outright.
   *
   * The three ways they differ all point the same direction and none of them is
   * a matter of degree. It answers nothing the turn it lands. It answers at most
   * one creature per turn afterward, because the ability taps it. And it pays
   * mana every time, out of the same pool the turn's spells want. A spell that
   * did none of that would be a different card, so the premium is halved rather
   * than shaded.
   *
   * A trigger is deliberately not discounted. "When this enters, destroy target
   * creature" answers on the turn it is cast and costs nothing beyond the card,
   * which is the removal spell of Limited wearing a body.
   */
  readonly removalPremiumActivatedScale: number;
  /** Minimum damage before a damage spell counts as removal for the premium. */
  readonly removalDamageFloor: number;
  /**
   * Score lost per point of mana value on non-creature spells. Creature scores
   * are already cost-relative through `creatureStatBaselinePerMana`, so this
   * applies only to spells and noncreature artifacts.
   */
  readonly spellManaPenaltyPerMana: number;
  /**
   * Baseline for a noncreature artifact carrying nothing. An artifact with no
   * printed ability does nothing at all, so it starts negative; one that
   * carries a static earns its way back through `staticScopeReach`.
   */
  readonly vanillaArtifactBaseline: number;
  /**
   * How many permanents a static ability's scope is expected to reach, which is
   * the number its modification is worth per copy.
   *
   * A lord's real value is a function of board width, and board width is not on
   * the card — so this is an assumption, and it is named here rather than
   * buried in `evaluate.ts` for exactly that reason. The numbers are the
   * creature counts a 40-card Limited deck typically has in play by the middle
   * turns; `otherCreaturesYouControl` is one lower because it excludes the
   * source.
   */
  readonly staticScopeReach: Readonly<Record<StaticScope, number>>;
  /**
   * How many permanents a **one-shot** scope is expected to reach, which is the
   * number the scoped effect is worth per copy of its unscoped self.
   *
   * The same assumption `staticScopeReach` names, made once more for the same
   * reason: board width is not on the card. It is a separate table because the
   * two vocabularies are separate — a one-shot scope reads its group off a
   * target and a static scope reads its own controller's board — and because
   * the number wants to differ: a sweep aimed at an opponent is worth the
   * creatures *they* have, which is the board this evaluator is not counting.
   */
  readonly effectScopeReach: Readonly<Record<EffectScope, number>>;
  /**
   * The number a static card evaluator assumes when the card prints a quantity
   * it cannot compute ("damage equal to the number of cards exiled this way").
   *
   * There is no state here at all — `evaluateCard` sees a card and nothing else
   * — so a computed amount has no honest value and this is the assumption named
   * rather than hidden. Three, the same number `effectScopeReach` carries, and
   * for the same reason: the only computed amount in the vocabulary counts what
   * a board sweep took, and the sweep's assumed reach is three.
   */
  readonly computedAmountAssumption: number;
  /**
   * Multiplier applied to `staticScopeReach` when the scope names a creature
   * type. A tribal lord reaches a fraction of the board a generic anthem does,
   * and how large a fraction is a property of the set rather than of the card.
   */
  readonly staticSubtypeReachFactor: number;
  /**
   * Multiplier applied to a static's value when it carries `enabledWhile`
   * (CR 611.2c): the ability is off some of the time, so it is worth less than
   * the same modification printed unconditional. One number rather than a
   * table keyed by condition kind, for the reason `ConditionSchema` itself
   * gives (`condition.ts`) — one member exists today (`controlsSubtype`,
   * itself a threshold on `staticSubtypeReachFactor`'s board-width guess), and
   * a second one earns its own weight when a card needs it rather than before.
   */
  readonly enabledWhileFactor: number;
  /**
   * Multiplier applied to a tap when the effect also holds the permanent
   * through its controller's next untap step (Frost Breath, Sleep).
   *
   * A bare tap denies the permanent for the rest of the current turn and it is
   * back on the next untap step. The rider denies it that turn *and* the whole
   * of its controller's next one: no attack, no block on the turn after. Twice
   * the turns of nothing, so twice the number, and it is stated here rather
   * than in `evaluate.ts` because how much a turn of denial is worth is a
   * property of the format's speed and not of the card.
   *
   * Why the whole of it multiplies rather than a flat addend: the rider rides a
   * sweep as readily as a single target, and the second turn is bought for
   * every permanent the sweep reached. A flat bonus would price Sleep and a
   * one-mana held tap the same.
   */
  readonly heldTapFactor: number;
  /**
   * Multiplier applied to an effect whose target is narrowed, by a
   * `TargetRestriction` or by a `TargetFilter`: the effect names a narrower
   * space than the same effect printed open, so it is worth less.
   *
   * Both fields, one multiplier, applied once even when a target carries both.
   * `targetNarrowingFactor` in `evaluate.ts` carries that argument and
   * `mtg-xiis` carries the measurement that made the filter arm necessary - a
   * filtered target used to price at full, so "destroy target attacking
   * creature" was worth exactly what "destroy target creature" is.
   *
   * One number rather than a table keyed by `TargetRestrictionKind`, for the
   * reason `enabledWhileFactor` above is one number and for the reason
   * `TargetRestrictionSchema` itself gives (`packages/dsl/src/targets.ts`): a
   * member arrives with the card that needs it, and a weight written for a
   * narrowing nothing prints is an untested branch that is wrong the first
   * time somebody uses it. Seven restriction kinds and seven filter fields
   * exist; across the five committed sets, ten slots carry a restriction and
   * six carry a filter, all sixteen in the flagship set. `maxPower` and
   * `combat` are the two to watch, because how much space a power bound or a
   * combat role removes is on the card rather than in this file.
   *
   * `colors` and `excludeColors` no longer read this number when they are the
   * sole narrowing on a target: `colorFilterFactor` in `evaluate.ts` reads a
   * share of Magic's fixed five-color pie instead, because `mtg-re3i` measured
   * this number pricing "destroy target nonblack creature" as though a
   * `combat` or `maxPower` restriction had narrowed it, when four fifths of
   * the format's creatures are still legal targets. A restriction or a second
   * filter field beside a color field still reads this number - see
   * `targetNarrowingFactor`'s doc for why that branch stays flat.
   *
   * Below `enabledWhileFactor`, and the gap is the difference between a static
   * and a spell. An `enabledWhile` static sits on a permanent that is already
   * on the board doing the rest of its job, so the turns the condition is false
   * cost the modification and nothing else. A restricted target is the whole of
   * a spell: with no legal target the card cannot be cast at all, and it sits in
   * hand as a blank. Finish the Fallen is the case that named this number - {B}
   * for "destroy target creature with a gloom counter on it" is the cheapest
   * `destroyPermanent` this set prints, and priced as an unconditional kill it
   * outranked every other black card in the pool.
   *
   * What it does not reach: an unrestricted rider printed beside a restricted
   * effect. Marked for the Depths gains 2 life on the same card that shrinks a
   * marked creature, and the life stays at full price here even though it is
   * bought only when the shrink has a legal target. That is a card-level gate
   * rather than an effect-level one, and it would have to reach modes,
   * triggered abilities and auras to be correct anywhere; this seam prices
   * effects, so the discount is stated where it applies and the residual is
   * named here rather than left to be discovered.
   */
  readonly restrictedTargetFactor: number;
  /**
   * Multiplier applied to a spell printing CR 118.8's toll clause: the player
   * the spell is aimed at is offered a price to stop it, so the spell is worth
   * less than the same spell printed with no way out.
   *
   * `tolledSpellFactor` in `evaluate.ts` applies it, and it reaches the effect's
   * whole price rather than its magnitude for the reason
   * `restrictedTargetFactor` does: a spell whose toll is paid does not destroy
   * less, it does nothing.
   *
   * Zero until this field existed, which is the hole it closes. Every other
   * seam in this tree already reads `card.unless` - the kernel pauses on it
   * (`@mtg/kernel`'s `unless-choice.ts`), both bots answer it, the oracle
   * printer prints it, Forge exports it - and this file did not, so "destroy
   * target creature unless its controller pays {2}" priced at exactly what
   * "destroy target creature" prices at. That is `mtg-xiis`'s finding one field
   * over, and the same failure `mtg-gloz` records for `keywordAbilities`: a
   * lever the evaluator scores at zero is a lever no set tuned against this
   * evaluator will ever print.
   *
   * Above `restrictedTargetFactor`, and the gap is the difference between a
   * hatch that is always open and one that closes. A restriction is a
   * permanent fact about the target - "with power 3 or less" never kills the
   * 6/6 - while a toll is answerable only out of mana the payer has open, and
   * a payer who cannot pay is not asked at all: `unless-choice.ts` resolves the
   * spell as though the clause were not printed. So the tolled spell still does
   * its whole job against a tapped-out opponent, and the restricted one still
   * does nothing against the wrong creature.
   *
   * The number is one mana off the printed ladder rather than a fit. Six real
   * tolled counterspells sit against two untolled ones in the card store:
   * Counterspell {U}{U} MV2 and Cancel {1}{U}{U} MV3 print no clause, while
   * Force Spike {U} MV1 pays {1}, Mana Tithe {W} MV1 pays {1}, Quench {1}{U}
   * MV2 pays {2}, Mana Leak {1}{U} MV2 pays {3}, Convolute {2}{U} MV3 pays {4}
   * and Mindstatic {3}{U} MV4 pays {6}. The tolled spell is printed about one
   * mana under the unconditional one carrying the same effect, and one mana in
   * this file is `spellManaPenaltyPerMana`. Against `destroyPermanent`'s 2.6 at
   * magnitude 1, one mana of discount is 1 - 0.55 / 2.6, which rounds to the
   * number below.
   *
   * What it cannot say, named here rather than fitted: the toll's own size. The
   * store's ladder shows the price is chosen against the spell's own mana value
   * rather than against a table, and what decides whether a given price bites is
   * how much mana the payer has open on the turn it is cast. `evaluateCard`
   * takes a card, not a board, so it cannot see either; the simulator can, and
   * `answerUnless` in `@mtg/sim` is where the price is actually weighed
   * (`target.tollManaWeight`). A table keyed by toll size replaces this number
   * on the day a set prints enough tolled spells to fit one against, the way
   * `restrictedTargetFactor` says a restriction table would replace it.
   */
  readonly tolledSpellFactor: number;
  /**
   * How many times a triggered ability fires over the life of the permanent
   * that prints it, given it resolved, which is what its effects are worth
   * multiplied by.
   *
   * Fifteen of the sixteen rows are counted off a seeded sweep rather than
   * argued; `DEFAULT_TRIGGER_FIRE_COUNT` carries the run, the denominators and
   * the one row that is still a guess. The measurement is the reason the
   * numbers are what they are, so the reasoning that used to live here is gone
   * rather than restated beside them.
   *
   * Two things the sweep settled that the reasoning had backwards, kept here
   * because they are what a reader coming from `mtg-suy7`'s ordering will
   * expect. Combat conditions fire far less than they read: a creature that
   * resolves connects with a player 0.46 times and with another creature 0.27
   * times, and "blocks or is blocked by greater power" fires 0.09 times, which
   * is a tenth of what it was priced at. Upkeep and end step, priced as the
   * reliable repeaters, are the only rows the sweep moved *up*, and they now
   * bracket `activationUseCount` rather than sitting under it.
   */
  readonly triggerFireCount: Readonly<Record<TriggerCondition, number>>;
  /**
   * How many times an activated ability is used over the life of the permanent,
   * given it resolved, which is what its effects are worth multiplied by.
   *
   * Measured, on the same 10,035-game sweep that priced `triggerFireCount` and
   * by the same instrument (`packages/metrics/tools/ability-weight-census.ts`,
   * over `@mtg/sim`'s `activationArm`). The denominator is the *arrival*, not
   * the game and not the activation: every printed activated ability on every
   * permanent that resolved counts once, whether or not its cost was ever paid.
   * That is the population `evaluateCard` scores over — it prices a card before
   * anyone knows the deck will have mana spare for it — so a weapon that sits
   * unequipped and a ping that is never worth the mana both belong in it.
   *
   * The reasoning this replaces had it upside down, and the size of the error
   * is the reason to record it. This was 2.5, placed above every conditional
   * `triggerFireCount` row on the argument that repeatable removal is a bomb in
   * Limited because the deck decides when it happens. It measured 0.608, which
   * puts it under `selfAttacks` and barely over `selfDies`. What the argument
   * missed is that "the deck decides" is a claim about permission, not about
   * mana: the flagship's median game is 7 rounds, every one of those turns has
   * a land drop and a spell competing for the same pool, and an ability the
   * deck may use every turn is not an ability the deck can afford every turn.
   * A trigger fires for free.
   *
   * `beginningOfYourEndStep` at 2.708 and `beginningOfYourUpkeep` at 2.511 now
   * clear it by four times rather than bracketing it, and the old note's guess
   * that they *should* outrun it was the one part of that paragraph the sweep
   * agreed with.
   */
  readonly activationUseCount: number;
  /**
   * Multiplier applied to `activationUseCount` when the cost includes the tap
   * symbol. A tap cost is what makes an ability once per turn instead of once
   * per available mana, and it also competes with attacking.
   *
   * Measured as a ratio rather than a count, because that is what it is: uses
   * per arrival on the tapped arm divided by uses per arrival on the paid arm,
   * off the one sweep. The two arms are exclusive by construction — an ability
   * whose cost taps is never counted on the paid arm — so the quotient is the
   * whole of what the multiplier claims.
   *
   * This is why the census has no probe pass for the activation weights. The
   * lever that would make the builder play more activated abilities is
   * `activationUseCount`, and raising it moves both arms at once, which moves
   * the numerator and the denominator of this ratio together. A probe that
   * distorts the quantity being measured is not a probe.
   */
  readonly activationTapFactor: number;
  /**
   * Score subtracted per point of mana in the activation cost, per use. The
   * mana is real and it is spent on the turn the ability is used, so a cheap
   * repeatable ability and an expensive one are not the same card.
   */
  readonly activationCostPerMana: number;
  /**
   * How many creatures an equip ability is expected to carry its modification
   * onto over a game, which is what that modification is worth multiplied by.
   *
   * It replaces `activationUseCount` for an equip rather than joining it,
   * because the two count different things. A ping is worth its payload every
   * time it is paid for; a weapon is paid for to *move* a bonus that is already
   * live, so paying twice in a turn is worth nothing at all. So what the census
   * counts here is distinct hosts and not payments: `@mtg/sim` keys a host set
   * per weapon per life, and a weapon that leaves and re-enters starts a new
   * one, because CR 704.5m is why it comes back and the bonus it carries the
   * second time is a second bonus.
   *
   * Measured 0.684 hosts per arrival on the flagship sweep. The 1.5 this
   * replaces was reasoned "above 1, because CR 704.5m leaves the weapon on the
   * battlefield when the creature it armed dies and the deck picks it back up",
   * and the rule is right while the number was answering a different question.
   * Above 1 is true of a weapon that gets equipped at all; the denominator this
   * weight needs is every weapon that resolved, including the ones the deck
   * never had a spare two mana for. Both facts hold at once and only one of
   * them is what `evaluateCard` is asking.
   */
  readonly equipHostCount: number;
  /**
   * What share of destroying a creature it is worth to stop that creature doing
   * one half of combat, which is how an Aura's `cantAttack` and `cantBlock`
   * clauses are priced.
   *
   * An Aura is the one card kind whose whole text can sit outside `effects` and
   * `abilities` (`AuraSchema`), so nothing else in this file had ever read it,
   * and a Pacifism scored below a blank card: its printed cost with nothing on
   * the other side of the ledger. The anchor is `destroyPermanent` rather than a
   * free-standing number because a creature that can neither attack nor block is
   * off the board in every way this scorer measures, so the two halves together
   * should come out at what answering it with a removal spell comes out at, and
   * a share of that number is the only form that makes both halves agree with
   * their sum by construction.
   *
   * Half each is the split, and it is a real claim rather than a shrug: a
   * creature that cannot attack still trades with an attacker, and a creature
   * that cannot block still kills you, so neither half is the whole card and
   * neither is obviously the larger. A set whose Auras print one half far more
   * often than the other is the evidence that would move it.
   */
  readonly auraCombatDenialShare: number;
  /**
   * How many single-creature answers taking control of a creature is worth.
   *
   * A multiple rather than a share, because this is the one Aura clause that
   * lands on both sides of the board at once: the creature stops being an
   * answer the opponent holds and starts being a body you hold, so the swing
   * is two creatures wide where `destroyPermanent` is one. Anchored on the same
   * `destroyPermanent` row as `auraCombatDenialShare` for the same reason — the
   * price of answering one creature is already in this file, and a
   * free-standing number for the strongest clause in the Aura vocabulary is the
   * one place a free-standing number would do the most damage.
   *
   * Two is the multiple and the printed cards are the evidence: Mind Control is
   * five mana where Murder is three and Pacifism is two, so Magic prices taking
   * a creature well above answering it and nowhere near twice the *mana*. What
   * doubles is the board, not the cost, and this weight prices the board.
   *
   * Above two would say a control Aura beats two removal spells, which is false
   * in the way that matters here: it is one card, it dies to enchantment
   * removal, and the body it hands you is whatever the opponent happened to
   * play rather than one you chose.
   */
  readonly auraControlMultiple: number;
  /**
   * How many loyalty abilities a deck expects to activate off one resolved
   * planeswalker.
   *
   * It is a turn count, not a use count, and that is the whole correction. CR
   * 606.3 allows one loyalty ability per planeswalker per turn, so a walker's
   * three printed abilities are three things it can do *instead of* each other;
   * priced through `activationUseCount` they were three repeatable free
   * activations that all happened, which rated a four-mana walker above every
   * bomb in a 261-card set. `abilityValue` still prices what one activation
   * does; this is how many times it happens.
   *
   * Under `activationUseCount` for the reason that weight's own note gives from
   * the other side: an activation happens every turn there is mana for it, and
   * a walker's does not - it happens every turn the walker is still alive,
   * which in Limited is the turn it lands and however many the opponent's board
   * allows after it.
   */
  readonly planeswalkerActivations: number;
  /**
   * The format's measured median game length, in rounds. `evaluateCard`
   * prices every mana value up through this one at face value — the curve's
   * own top bucket (`DEFAULT_TARGET_CURVE`'s MV 6+) sits well inside it — and
   * discounts anything past it through `topEndReachability`. CR 305.2a caps a
   * player at one land drop a turn, so a spell that costs more mana than a
   * typical game has turns is not expensive the way a five-drop is expensive;
   * most games never reach the turn it would be cast on.
   */
  readonly formatMedianRounds: number;
  /**
   * Reachability of a spell whose mana value exceeds `formatMedianRounds`: a
   * probability in (0, 1], indexed by how many mana points past the median
   * the card costs (index 0 = one point past it) and clamped to the last
   * entry for anything further out. `evaluate.ts`'s
   * `DEFAULT_TOP_END_REACHABILITY` derives the default from this format's own
   * deck size, land count, and opening hand, through the same hypergeometric
   * machinery `mana-base.ts`'s `castability` already uses for colored
   * sources.
   */
  readonly topEndReachability: readonly number[];
}

/** How the 17 lands are split and how the split is judged. */
export interface ManaBaseConfig {
  /**
   * Weight applied to a colored pip by the mana value of the card requiring
   * it, indexed by mana value and clamped to the last entry. Early pips need
   * more sources to be castable on curve, so they pull harder on the split.
   */
  readonly pipWeightByManaValue: readonly number[];
  /**
   * Minimum sources for a color that carries a real share of the deck's pip
   * demand. Prevents a 16/1 split when one color happens to be pip-light.
   */
  readonly minSourcesPerColor: number;
  /** Pip-demand share at or above which `minSourcesPerColor` applies. */
  readonly colorFloorShareThreshold: number;
  /**
   * Karsten's reliability threshold: the probability of having the colored
   * sources you need, on the play, on the turn you want to cast the spell.
   */
  readonly castabilityTarget: number;
  /** Cards seen before the first draw step. */
  readonly openingHandSize: number;
  /**
   * On the play you draw one fewer card. Castability is reported for the
   * harder case by default.
   */
  readonly onThePlay: boolean;
}

export interface DeckBuildConfig {
  /** Total cards in the finished deck. */
  readonly deckSize: number;
  /** Lands in the finished deck; spells are `deckSize - landCount`. */
  readonly landCount: number;
  /** Minimum creatures the selector tries to reach before quality-only picks. */
  readonly minCreatures: number;
  /**
   * How many copies of one card by name a legal deck may play, or `null` for no
   * limit at all.
   *
   * `null` is the default because this tier was written for Limited, where six
   * boosters opening the same common three times is the format working
   * correctly. Constructed passes 4 (`constructedConfig`). Basic lands are
   * exempt wherever it is enforced, per CR 100.4.
   */
  readonly copyLimit: number | null;
  /** Spells wanted per curve bucket; must sum to `deckSize - landCount`. */
  readonly targetCurve: CurveHistogram;
  /**
   * Bucket fill order. The 2-4 mass is filled first so that a thin pool
   * degrades at the edges of the curve rather than in its middle.
   */
  readonly curvePriority: readonly CurveBucket[];
  readonly weights: CardScoreWeights;
  readonly manaBase: ManaBaseConfig;
}

/** Deep-partial input accepted by `resolveConfig`; every record merges per key. */
export interface DeckBuildConfigInput {
  readonly deckSize?: number;
  readonly landCount?: number;
  readonly minCreatures?: number;
  readonly copyLimit?: number | null;
  readonly targetCurve?: Partial<CurveHistogram>;
  readonly curvePriority?: readonly CurveBucket[];
  readonly weights?: CardScoreWeightsInput;
  readonly manaBase?: Partial<ManaBaseConfig>;
}

export interface CardScoreWeightsInput extends Partial<
  Omit<
    CardScoreWeights,
    | 'keywordBase'
    | 'keywordPowerScale'
    | 'keywordAbilityValue'
    | 'effectValue'
    | 'staticScopeReach'
    | 'effectScopeReach'
    | 'triggerFireCount'
  >
> {
  readonly keywordBase?: Partial<Record<Keyword, number>>;
  readonly keywordPowerScale?: Partial<Record<Keyword, number>>;
  readonly keywordAbilityValue?: Partial<Record<KeywordAbility['kind'], KeywordAbilityWeight>>;
  readonly effectValue?: Partial<Record<AnyEffectKind, EffectWeight>>;
  readonly staticScopeReach?: Partial<Record<StaticScope, number>>;
  readonly effectScopeReach?: Partial<Record<EffectScope, number>>;
  readonly triggerFireCount?: Partial<Record<TriggerCondition, number>>;
}

export const DEFAULT_KEYWORD_BASE: Readonly<Record<Keyword, number>> = {
  flying: 1.2,
  vigilance: 0.35,
  haste: 0.45,
  trample: 0.35,
  deathtouch: 1.0,
  lifelink: 0.4,
  menace: 0.4,
  reach: 0.25,
  firstStrike: 0.55,
};

export const DEFAULT_KEYWORD_POWER_SCALE: Readonly<Record<Keyword, number>> = {
  flying: 0.15,
  vigilance: 0.05,
  haste: 0.1,
  trample: 0.15,
  deathtouch: -0.05,
  lifelink: 0.12,
  menace: 0.08,
  reach: 0.02,
  firstStrike: 0.12,
};

/**
 * What each of the six keyword abilities is worth, and where each number comes
 * from.
 *
 * Nothing here is a fresh constant. Every row is an arithmetic statement about
 * weights this file already carries, because the alternative — six invented
 * numbers for a vocabulary the evaluator had never read at all — is how a
 * scorer stops being auditable. The derivations are checked against these
 * literals in `evaluate.test.ts`, so retuning `destroyPermanent` or
 * `keywordBase.flying` and leaving these behind fails a test rather than
 * silently pricing one rules text two ways.
 *
 * ## `defender`: the price this file already pays for "cannot attack"
 *
 * `-auraCombatDenialShare * singleCreatureAnswerValue` = `-0.5 * 2.6` = -1.3.
 * A `cantAttack` static aimed at the caster's own creature is scored at exactly
 * that in `evaluate.ts`, and CR 702.3b's defender is that restriction printed
 * on the card instead of enchanted onto it. One rules text, one price. It is
 * the only negative row here, which is the whole shape of the vocabulary: five
 * of the six add a capability and this one removes half of a creature's job.
 *
 * The rejected alternative was to scale it on power, so that a 0/6 wall pays
 * less than a 6/6 would. Two things argue it down. It would put two prices on
 * one rules text — the aura clause is flat, so a power-scaled `defender` and a
 * flat `cantAttack` would disagree about the same wall — and the file has
 * already decided that a zero-power creature attacking is worth something:
 * `ZERO_AT_ZERO_POWER`'s docblock excludes `vigilance` precisely because a
 * 0-power creature "still attacks to pressure a planeswalker at 0 power," and
 * defender is what takes that away. Power-scaling both together is a change to
 * a shipped price and belongs in its own bead.
 *
 * ## `landwalk`: the price this file already pays for granting it
 *
 * `keywordBase.flying * enabledWhileFactor` = `1.2 * 0.6` = 0.72 flat, and
 * `keywordPowerScale.flying * enabledWhileFactor` = `0.15 * 0.6` = 0.09 per
 * point of power. `evaluate.ts`'s `grantLandwalk` aura clause is already priced
 * at the first of those two products; this is that decision applied to the
 * printed word, with the power rate carried along so the two halves of flying's
 * pair are discounted together rather than one of them.
 *
 * `enabledWhileFactor` is the conditional discount, and landwalk is conditional
 * on a thing this evaluator cannot see: whether the *opponent* plays the named
 * basic land type. Nothing in `CardScoreWeights` models the opposing deck, and
 * the file's usual answer to that (`blockOnlyCreaturesWithKeyword`,
 * `cantBeBlockedBySubtype`) is to price at zero rather than guess. Zero is
 * wrong here only because the file has already declined to take it — the aura
 * clause pays 0.72 — so the printed word matches the granted one.
 *
 * This understates, and deliberately. Landwalk when it is live is strictly
 * better than flying (unblockable beats hard-to-block), so the true value is a
 * share of something *above* `keywordBase.flying`, not of `keywordBase.flying`
 * itself. Doing better needs the one input this package does not have: the
 * share of decks in the format that play the named basic type. A format-level
 * basic-land census, fed in the way `DeckContext` feeds this file its own
 * deck's contents, is what it would take.
 *
 * ## `doubleStrike`: first strike, plus most of a second body's worth of power
 *
 * Flat `keywordBase.firstStrike` = 0.55, because CR 702.4b's double strike *is*
 * first strike (a creature with it strikes in the first-strike damage step),
 * and pricing the shared half at anything else would say otherwise.
 *
 * Per power, `keywordPowerScale.firstStrike + creaturePowerWeight / 2` =
 * `0.12 + 0.575` = 0.695. The second damage step applies the creature's power
 * again, and what this file pays for a point of power is `creaturePowerWeight`,
 * so the ceiling is a whole extra body's worth of it. Halved, because without
 * trample the second strike is wasted in the combat it most often sees: the
 * first-strike damage has already killed the blocker and the excess goes
 * nowhere. It is a doubler when the creature is unblocked or is the blocker,
 * and nothing when it kills what it hit, so half is the split rather than a
 * shading of one.
 *
 * ## `hexproof`, `indestructible`, `protection`: a share of the body
 *
 * These three do not change what the creature does; they change how long it
 * keeps doing it. So each is a share of `statValue(power, toughness)` — the
 * body's own stat contribution — and the ceiling on that share is 1.0, which
 * would say the ability delivers a second copy of the body outright.
 *
 * `indestructible` takes **0.25**. It survives every combat and every
 * destroy-shaped answer, and survives nothing else: exile, bounce, -X/-X and
 * sacrifice edicts all still take it. A quarter of a second body is the claim
 * that it wins the exchange rather more often than not over a median game, and
 * the cross-check is `singleCreatureAnswerValue`: on a 5/5 this pays 2.5
 * against that 2.6, which reads as "an indestructible 5/5 is worth about one
 * removal spell more than a 5/5," and that is the right order of magnitude for
 * a card the opponent may simply have no answer to.
 *
 * `hexproof` takes **0.125**, half of indestructible. It is narrower where it
 * matters most in Limited — it stops nothing in combat, and combat is where
 * most creatures die — and wider in one place indestructible is not, since
 * targeted exile and targeted bounce go through indestructible and stop at
 * hexproof. Not a containment, so the half is a judgment; stated as one.
 *
 * `protection` takes **0.2** for a color quality. CR 702.16 is the widest of
 * the three when it applies: against the named quality it is hexproof and
 * indestructible and unblockable at once, which puts its live value above
 * indestructible's 0.25 — call it 0.5, half a second body. But it applies only
 * against the named color, and a Limited opponent's two-color deck covers 2 of
 * the 5 colors, so `0.5 * (2/5)` = 0.2 is the expected share. That the 2/5 is a
 * format-wide prior rather than a fact about the opponent is the same bound
 * landwalk states above, and it points the same way.
 *
 * **The two protection qualities are priced differently**, because
 * `ProtectionQualitySchema`'s two arms differ by more than a name: a color is
 * on roughly two fifths of opposing decks and a named creature subtype is on a
 * handful of cards. `evaluate.ts` multiplies the subtype arm by
 * `staticSubtypeReachFactor`, this file's existing answer to "a named creature
 * type reaches a fraction of the board a generic scope reaches," which is 0.5
 * and is documented there as a property of the set rather than of the card. It
 * is a borrowed number and it is borrowed loosely: 0.5 was fitted for a deck
 * *built around* the subtype, and the count of any one creature type in a
 * random opponent's deck is lower than that. So subtype protection is the one
 * row in this table that overstates, by at most half of `0.2 * statValue`, and
 * a subtype census over the format is what would replace it.
 *
 * ## What is priced at zero, and why it is a hole rather than an answer
 *
 * `indestructible` and `hexproof` are legal on any permanent, not only on
 * creatures (`typeline.ts`'s `CREATURE_ONLY_KEYWORD_ABILITY_KINDS` lists the
 * other four). On a planeswalker `evaluate.ts` has a body to take a share of —
 * loyalty, which it already prices at `creatureToughnessWeight` for being the
 * quantity an attacker spends combat damage on — so the walker arm reads these
 * two. On an artifact or an enchantment there is no body at all, the share is a
 * share of nothing, and both price at zero. That is a hole: an indestructible
 * artifact is worth more than a destructible one. Filling it means taking a
 * share of the permanent's own text value, which is computed after the card
 * kind is switched on, and that reordering is its own change.
 */
export const DEFAULT_KEYWORD_ABILITY_VALUE: Readonly<Record<KeywordAbility['kind'], KeywordAbilityWeight>> = {
  // -auraCombatDenialShare * (destroyPermanent.base + destroyPermanent.perUnit).
  defender: { flat: -1.3, perPower: 0, bodyShare: 0 },
  // flying's base and power rate, both at enabledWhileFactor.
  landwalk: { flat: 0.72, perPower: 0.09, bodyShare: 0 },
  hexproof: { flat: 0, perPower: 0, bodyShare: 0.125 },
  indestructible: { flat: 0, perPower: 0, bodyShare: 0.25 },
  // The color quality's rate; evaluate.ts narrows the subtype quality.
  protection: { flat: 0, perPower: 0, bodyShare: 0.2 },
  // firstStrike's base, and its power rate plus half of creaturePowerWeight.
  doubleStrike: { flat: 0.55, perPower: 0.695, bodyShare: 0 },
};

/**
 * One creature per copy of the unscoped spell.
 *
 * Three is `creaturesYouControl`'s reach one table up, and the argument is the
 * same one: it is the creature count a 40-card Limited deck typically has in
 * play by the middle turns. Aimed at an opponent it is *their* count rather than
 * yours, which this evaluator has no way to tell apart, so the two are assumed
 * equal and the assumption is written here rather than left implied.
 */
export const DEFAULT_EFFECT_SCOPE_REACH: Readonly<Record<EffectScope, number>> = {
  creaturesThatPlayerControls: 3,
  // Lower, and for a reason that is not board width: a hand mid-game holds a
  // few cards and only some of them are creatures. Two is the creature share of
  // a Limited hand at the turn a seven-mana sorcery is cast, which is the same
  // kind of assumption the row above makes and the same kind of guess.
  creatureCardsInPlayerHand: 2,
  // The same guess, aimed at a graveyard instead: a public zone that accumulates
  // over a game rather than one dealt at its start, and by the turn this scope
  // is worth casting it holds a comparable creature share to a mid-game hand.
  creatureCardsInPlayerGraveyard: 2,
  // Three again for all three board sweeps, and the equal figure is the claim
  // worth stating. A symmetric wrath reaches both boards, so counting six would
  // price Day of Judgment as twice Plague Wind — backwards, because half of
  // what a symmetric sweep destroys is yours, and this evaluator scores what a
  // card is worth to its caster rather than how many objects it touches. What
  // separates the three in a real deck is *when* you want them, and a deck
  // builder that reads a card in isolation has no term for that.
  allPermanents: 3,
  permanentsYouControl: 3,
  permanentsOpponentsControl: 3,
};

export const DEFAULT_STATIC_SCOPE_REACH: Readonly<Record<StaticScope, number>> = {
  self: 1,
  creaturesYouControl: 3,
  otherCreaturesYouControl: 2,
};

/**
 * Fires per resolved permanent, measured off the balance sweep by
 * `packages/metrics/tools/ability-weight-census.ts`.
 *
 * Run of record: the committed 341-card flagship fixture, seed `mtg-balance/v0`,
 * 223 games per matchup over 45 color-pair matchups, so 10,035 games per pass
 * and 30,105 games over the three passes. `n` on each row below is that row's
 * own denominator: arrivals, not games. The tool takes the set as an argument,
 * so rerunning this means handing it the same fixture the balance gate reads.
 *
 * The denominator is the arrival because that is the question `evaluate.ts`
 * asks — how often this fires over the life of this permanent, given it
 * resolved — and fires per game would fold in draw rate and copy count, which
 * the scorer is not asking about. `selfEnters` is the instrument checking
 * itself: the arrival is the triggering event, so its 1.000 over 27,557
 * arrivals is arithmetic rather than a finding, and a rerun printing anything
 * else there has a broken instrument.
 *
 * Two passes measure the format as the builder actually builds it, and where
 * a row has a reading from the first it is taken from there. The rows marked
 * `probe` had no reading at all: they sit on cards this very table prices out
 * of all ten decks, so the sweep never played one. The probe pass raises those
 * rows to 8 until the builder plays the cards carrying them, which buys a real
 * denominator on decks nobody would draft. That is a worse measurement than
 * pass 1 and much better than a guess, and it is labeled so the next person
 * knows which they are reading.
 *
 * `anotherControlledPermanentEnters` is the one row no pass can reach: zero
 * cards in the pool print it, and a probe cannot conjure a card. It keeps its
 * guess, and the first set that prints one earns it a number.
 *
 * What the measurement is not: a claim about a card in a deck built for it.
 * Every reading here is conditioned on decks this scorer chose, so
 * `youCastInstantOrSorcery` at 0.251 is a fact about decks carrying one to six
 * instants and sorceries, not about that trigger in a deck built to turn it on.
 * An isolated-card scorer has no term for deck composition, which is why the
 * four rares that opened `mtg-fe2n` are still negative under measured numbers,
 * and why measuring this table did not rescue them.
 */
export const DEFAULT_TRIGGER_FIRE_COUNT: Readonly<Record<TriggerCondition, number>> = {
  selfEnters: 1.0, // pass 1, n=27557
  selfAttacks: 1.221, // pass 1, n=7317
  selfDies: 0.463, // pass 1, n=18572
  selfDiesNotSacrificed: 0.337, // pass 1, n=1631
  controlledCreatureAttacksAlone: 0.802, // pass 1, n=2494
  selfDealsCombatDamageToCreature: 0.274, // pass 1, n=1321
  beginningOfYourUpkeep: 2.511, // probe, n=2671
  beginningOfYourEndStep: 2.708, // probe, n=5349
  // Twice the row above, derived rather than probed: an end step happens on
  // every turn and this member fires on all of them, where "your end step"
  // fires on half. Doubling a measured number is a weaker claim than measuring
  // one, and it is marked as such — no card in the flagship prints this
  // condition either, so no pass has a denominator for it.
  beginningOfEndStep: 5.416, // derived = 2 x beginningOfYourEndStep
  // The only guess left. No card in the flagship prints it, so no pass has a
  // denominator for it; it stays where `mtg-suy7` put it, above
  // `anotherControlledCreatureEnters` because a land drop counts for this one
  // and not for that one.
  anotherControlledPermanentEnters: 2.0,
  anotherControlledCreatureEnters: 1.39, // pass 1, n=559
  youCastSpell: 1.662, // probe, n=1683
  youCastInstantOrSorcery: 0.251, // probe, n=13673
  selfDealsCombatDamageToPlayer: 0.46, // pass 1, n=2282
  selfBlocks: 0.381, // probe, n=5304
  selfBlocksOrIsBlockedByGreaterPower: 0.091, // pass 1, n=10839
  youGainLife: 0.112, // probe, n=4411
  // Unmeasured, and the sum of two rows that are: it fires on the arrival every
  // `selfEnters` fires on and on every attack `selfAttacks` fires on, so the
  // count a deck sees is the two added rather than either alone. No card in the
  // flagship prints it, so no pass has a denominator for it; the first sweep
  // that runs a Titan replaces this line with a measurement.
  selfEntersOrAttacks: 2.221,
  // The M11 artifact cycle. Unmeasured: no card in the flagship prints any of
  // the five, so no pass has a denominator. Placed above `youCastSpell`'s 1.662
  // because this one counts both seats' spells rather than one, and a color
  // narrows it back down again — the two adjustments are guessed to roughly
  // cancel, which is what the sweep that first runs one of these will check.
  aPlayerCastsWhiteSpell: 1.6,
  aPlayerCastsBlueSpell: 1.6,
  aPlayerCastsBlackSpell: 1.6,
  aPlayerCastsRedSpell: 1.6,
  aPlayerCastsGreenSpell: 1.6,
  // Unmeasured, and the row most dependent on deck composition in this table:
  // a deck with no noncombat damage source fires it zero times. Guessed near
  // `youGainLife`'s measured 0.112 for that reason.
  opponentDealtNoncombatDamage: 0.15,
  // Unmeasured, and strictly under `anotherControlledCreatureEnters`'s measured
  // 1.39, which is this event with the power clause dropped. Halved, because
  // roughly half the creatures a built deck plays are under power 3.
  anotherControlledCreatureWithPowerThreeOrGreaterEnters: 0.7,
};

export const DEFAULT_SCORE_WEIGHTS: CardScoreWeights = {
  creaturePremium: 0.8,
  creatureStatBaselinePerMana: 2.0,
  creaturePowerWeight: 1.15,
  creatureToughnessWeight: 0.85,
  keywordBase: DEFAULT_KEYWORD_BASE,
  keywordPowerScale: DEFAULT_KEYWORD_POWER_SCALE,
  keywordAbilityValue: DEFAULT_KEYWORD_ABILITY_VALUE,
  effectValue: DEFAULT_EFFECT_VALUE,
  removalPremium: 1.5,
  removalPremiumActivatedScale: 0.5,
  removalDamageFloor: 2,
  spellManaPenaltyPerMana: 0.55,
  vanillaArtifactBaseline: -1.0,
  staticScopeReach: DEFAULT_STATIC_SCOPE_REACH,
  effectScopeReach: DEFAULT_EFFECT_SCOPE_REACH,
  computedAmountAssumption: 3,
  staticSubtypeReachFactor: 0.5,
  enabledWhileFactor: 0.6,
  heldTapFactor: 2.0,
  restrictedTargetFactor: 0.5,
  tolledSpellFactor: 0.8,
  triggerFireCount: DEFAULT_TRIGGER_FIRE_COUNT,
  activationUseCount: 0.608, // pass 1, n=32446
  activationTapFactor: 0.397, // pass 1, n=2199
  activationCostPerMana: 0.35,
  equipHostCount: 0.684, // pass 1, n=27884
  auraCombatDenialShare: 0.5,
  auraControlMultiple: 2,
  planeswalkerActivations: 3,
  formatMedianRounds: 7,
  topEndReachability: DEFAULT_TOP_END_REACHABILITY,
};

export const DEFAULT_MANA_BASE_CONFIG: ManaBaseConfig = {
  pipWeightByManaValue: [1.4, 1.4, 1.3, 1.15, 1.05, 1.0, 1.0],
  minSourcesPerColor: 6,
  colorFloorShareThreshold: 0.15,
  castabilityTarget: 0.9,
  openingHandSize: 7,
  onThePlay: true,
};

/**
 * 23 spells: 3/7/6/4/2/1 across MV 1/2/3/4/5/6+.
 *
 * 17 of the 23 sit at MV 2-4 (the sourced "curve mass at 2-4") and 3 sit at
 * MV 5+ (the sourced "two or three cards at 5+").
 */
export const DEFAULT_TARGET_CURVE: CurveHistogram = { 0: 0, 1: 3, 2: 7, 3: 6, 4: 4, 5: 2, 6: 1 };

/** Mass first, then the cheap end, then the top end, then the empty 0 bucket. */
export const DEFAULT_CURVE_PRIORITY: readonly CurveBucket[] = [2, 3, 4, 1, 5, 6, 0];

export const DEFAULT_DECK_BUILD_CONFIG: DeckBuildConfig = {
  deckSize: 40,
  landCount: 17,
  minCreatures: 12,
  copyLimit: null,
  targetCurve: DEFAULT_TARGET_CURVE,
  curvePriority: DEFAULT_CURVE_PRIORITY,
  weights: DEFAULT_SCORE_WEIGHTS,
  manaBase: DEFAULT_MANA_BASE_CONFIG,
};

function mergeNumberRecord<K extends string>(
  base: Readonly<Record<K, number>>,
  keys: readonly K[],
  override: Partial<Record<K, number>> | undefined,
): Readonly<Record<K, number>> {
  if (override === undefined) return base;
  const merged = {} as Record<K, number>;
  for (const key of keys) {
    const value = override[key];
    merged[key] = value ?? base[key];
  }
  return merged;
}

/**
 * An override replaces a primitive's whole price rather than half of it.
 *
 * `mergeNumberRecord`'s per-key merge is wrong here for the reason
 * `exileTarget` states in the table above: a base and a rate are two halves of
 * one decision, and a caller who moves one without the other has silently
 * repriced the card. Stating both is the cost of overriding either.
 */
function mergeEffectValue(
  base: Readonly<Record<AnyEffectKind, EffectWeight>>,
  override: Partial<Record<AnyEffectKind, EffectWeight>> | undefined,
): Readonly<Record<AnyEffectKind, EffectWeight>> {
  if (override === undefined) return base;
  const merged = {} as Record<AnyEffectKind, EffectWeight>;
  for (const kind of ALL_EFFECT_KINDS) {
    merged[kind] = override[kind] ?? base[kind];
  }
  return merged;
}

/**
 * A keyword ability's override replaces its whole price, for
 * `mergeEffectValue`'s reason and one more of its own.
 *
 * `KeywordAbilityWeight`'s three parts are three halves of one decision the way
 * `EffectWeight`'s two are, and a per-key merge would let a caller move
 * `doubleStrike`'s `perPower` while `flat` kept paying `firstStrike`'s base.
 * The extra reason is that the parts are not independent even in principle: a
 * row that states `bodyShare` states `perPower: 0` *because* the ability scales
 * on survival rather than on combat, and a merge that carried a stale
 * `perPower` through would price it on both at once.
 */
function mergeKeywordAbilityValue(
  base: Readonly<Record<KeywordAbility['kind'], KeywordAbilityWeight>>,
  override: Partial<Record<KeywordAbility['kind'], KeywordAbilityWeight>> | undefined,
): Readonly<Record<KeywordAbility['kind'], KeywordAbilityWeight>> {
  if (override === undefined) return base;
  const merged = {} as Record<KeywordAbility['kind'], KeywordAbilityWeight>;
  for (const kind of KEYWORD_ABILITY_KINDS) {
    merged[kind] = override[kind] ?? base[kind];
  }
  return merged;
}

function mergeCurve(base: CurveHistogram, override: Partial<CurveHistogram> | undefined): CurveHistogram {
  if (override === undefined) return base;
  const merged = {} as Record<CurveBucket, number>;
  for (const bucket of CURVE_BUCKETS) {
    merged[bucket] = override[bucket] ?? base[bucket];
  }
  return merged;
}

function mergeWeights(overrides: CardScoreWeightsInput | undefined): CardScoreWeights {
  const base = DEFAULT_SCORE_WEIGHTS;
  if (overrides === undefined) return base;
  return {
    creaturePremium: overrides.creaturePremium ?? base.creaturePremium,
    creatureStatBaselinePerMana: overrides.creatureStatBaselinePerMana ?? base.creatureStatBaselinePerMana,
    creaturePowerWeight: overrides.creaturePowerWeight ?? base.creaturePowerWeight,
    creatureToughnessWeight: overrides.creatureToughnessWeight ?? base.creatureToughnessWeight,
    keywordBase: mergeNumberRecord(base.keywordBase, KEYWORDS, overrides.keywordBase),
    keywordPowerScale: mergeNumberRecord(base.keywordPowerScale, KEYWORDS, overrides.keywordPowerScale),
    keywordAbilityValue: mergeKeywordAbilityValue(base.keywordAbilityValue, overrides.keywordAbilityValue),
    effectValue: mergeEffectValue(base.effectValue, overrides.effectValue),
    removalPremium: overrides.removalPremium ?? base.removalPremium,
    removalPremiumActivatedScale: overrides.removalPremiumActivatedScale ?? base.removalPremiumActivatedScale,
    removalDamageFloor: overrides.removalDamageFloor ?? base.removalDamageFloor,
    spellManaPenaltyPerMana: overrides.spellManaPenaltyPerMana ?? base.spellManaPenaltyPerMana,
    vanillaArtifactBaseline: overrides.vanillaArtifactBaseline ?? base.vanillaArtifactBaseline,
    staticScopeReach: mergeNumberRecord(base.staticScopeReach, STATIC_SCOPES, overrides.staticScopeReach),
    effectScopeReach: mergeNumberRecord(base.effectScopeReach, EFFECT_SCOPES, overrides.effectScopeReach),
    computedAmountAssumption: overrides.computedAmountAssumption ?? base.computedAmountAssumption,
    staticSubtypeReachFactor: overrides.staticSubtypeReachFactor ?? base.staticSubtypeReachFactor,
    enabledWhileFactor: overrides.enabledWhileFactor ?? base.enabledWhileFactor,
    restrictedTargetFactor: overrides.restrictedTargetFactor ?? base.restrictedTargetFactor,
    tolledSpellFactor: overrides.tolledSpellFactor ?? base.tolledSpellFactor,
    heldTapFactor: overrides.heldTapFactor ?? base.heldTapFactor,
    triggerFireCount: mergeNumberRecord(
      base.triggerFireCount,
      TRIGGER_CONDITIONS,
      overrides.triggerFireCount,
    ),
    activationUseCount: overrides.activationUseCount ?? base.activationUseCount,
    activationTapFactor: overrides.activationTapFactor ?? base.activationTapFactor,
    activationCostPerMana: overrides.activationCostPerMana ?? base.activationCostPerMana,
    equipHostCount: overrides.equipHostCount ?? base.equipHostCount,
    auraCombatDenialShare: overrides.auraCombatDenialShare ?? base.auraCombatDenialShare,
    auraControlMultiple: overrides.auraControlMultiple ?? base.auraControlMultiple,
    planeswalkerActivations: overrides.planeswalkerActivations ?? base.planeswalkerActivations,
    formatMedianRounds: overrides.formatMedianRounds ?? base.formatMedianRounds,
    topEndReachability: overrides.topEndReachability ?? base.topEndReachability,
  };
}

function mergeManaBase(overrides: Partial<ManaBaseConfig> | undefined): ManaBaseConfig {
  const base = DEFAULT_MANA_BASE_CONFIG;
  if (overrides === undefined) return base;
  return {
    pipWeightByManaValue: overrides.pipWeightByManaValue ?? base.pipWeightByManaValue,
    minSourcesPerColor: overrides.minSourcesPerColor ?? base.minSourcesPerColor,
    colorFloorShareThreshold: overrides.colorFloorShareThreshold ?? base.colorFloorShareThreshold,
    castabilityTarget: overrides.castabilityTarget ?? base.castabilityTarget,
    openingHandSize: overrides.openingHandSize ?? base.openingHandSize,
    onThePlay: overrides.onThePlay ?? base.onThePlay,
  };
}

/** Spells the deck must find: total size minus the land count. */
export function spellCount(config: DeckBuildConfig): number {
  return config.deckSize - config.landCount;
}

/**
 * Merges overrides onto the defaults and validates the result.
 *
 * Config is a boundary: a target curve that does not sum to the spell count, or
 * a priority list that skips a bucket, would silently produce a mis-shaped deck,
 * so both fail loudly here instead. The key set is part of that boundary and
 * used not to be — an override this function does not read was simply never
 * read, which is the one failure that returns the answer a null result looks
 * like. `checkUnknownConfigKeys` refuses it by name, and names the real path
 * when the key belongs somewhere else in the config.
 */
export function resolveConfig(input: DeckBuildConfigInput = {}): DeckBuildConfig {
  checkUnknownConfigKeys(input);
  const config: DeckBuildConfig = {
    deckSize: input.deckSize ?? DEFAULT_DECK_BUILD_CONFIG.deckSize,
    landCount: input.landCount ?? DEFAULT_DECK_BUILD_CONFIG.landCount,
    minCreatures: input.minCreatures ?? DEFAULT_DECK_BUILD_CONFIG.minCreatures,
    copyLimit: input.copyLimit ?? DEFAULT_DECK_BUILD_CONFIG.copyLimit,
    targetCurve: mergeCurve(DEFAULT_TARGET_CURVE, input.targetCurve),
    curvePriority: input.curvePriority ?? DEFAULT_CURVE_PRIORITY,
    weights: mergeWeights(input.weights),
    manaBase: mergeManaBase(input.manaBase),
  };

  if (!Number.isInteger(config.deckSize) || config.deckSize <= 0) {
    throw new Error(`deckBuild config: deckSize must be a positive integer, got ${config.deckSize}`);
  }
  if (!Number.isInteger(config.landCount) || config.landCount < 0) {
    throw new Error(`deckBuild config: landCount must be a non-negative integer, got ${config.landCount}`);
  }
  const spells = spellCount(config);
  if (spells <= 0) {
    throw new Error(
      `deckBuild config: landCount ${config.landCount} leaves no room for spells in a ${config.deckSize}-card deck`,
    );
  }
  const curveSum = curveTotal(config.targetCurve);
  if (curveSum !== spells) {
    throw new Error(
      `deckBuild config: targetCurve sums to ${curveSum} but the deck needs ${spells} spells; supply a matching targetCurve`,
    );
  }
  if (!Number.isInteger(config.minCreatures) || config.minCreatures < 0 || config.minCreatures > spells) {
    throw new Error(
      `deckBuild config: minCreatures must be an integer in [0, ${spells}], got ${config.minCreatures}`,
    );
  }
  if (config.copyLimit !== null && (!Number.isInteger(config.copyLimit) || config.copyLimit < 1)) {
    throw new Error(
      `deckBuild config: copyLimit must be null or a positive integer, got ${String(config.copyLimit)}`,
    );
  }
  const missingBuckets = CURVE_BUCKETS.filter((bucket) => !config.curvePriority.includes(bucket));
  if (missingBuckets.length > 0) {
    throw new Error(
      `deckBuild config: curvePriority must list every bucket; missing ${missingBuckets.join(', ')}`,
    );
  }
  if (config.manaBase.pipWeightByManaValue.length === 0) {
    throw new Error('deckBuild config: pipWeightByManaValue must have at least one entry');
  }
  if (config.manaBase.castabilityTarget <= 0 || config.manaBase.castabilityTarget > 1) {
    throw new Error(
      `deckBuild config: castabilityTarget must be in (0, 1], got ${config.manaBase.castabilityTarget}`,
    );
  }
  if (!Number.isInteger(config.manaBase.openingHandSize) || config.manaBase.openingHandSize < 0) {
    throw new Error(
      `deckBuild config: openingHandSize must be a non-negative integer, got ${config.manaBase.openingHandSize}`,
    );
  }
  return config;
}
