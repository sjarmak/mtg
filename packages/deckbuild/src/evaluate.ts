/**
 * The card-evaluation function.
 *
 * Deliberately transparent: every card's score decomposes into named
 * components, and every component comes from a named weight in
 * `CardScoreWeights`. `evaluateCard` is a pure function of (card, weights), so
 * two runs over the same pool always produce the same ordering, and a
 * disagreement with the later LLM tier can be attributed to a specific weight.
 */
import type {
  Ability,
  ActivatedAbility,
  Amount,
  AnyEffectKind,
  Aura,
  AuraModification,
  Card,
  Color,
  Condition,
  Effect,
  EffectScope,
  Keyword,
  KeywordAbility,
  LoyaltyAbility,
  Modes,
  PlaneswalkerCard,
  PumpAmount,
  SacrificeOther,
  StaticModification,
  TargetFilter,
  TokenSpec,
} from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  amountOrAssume,
  assertNever,
  cardManaValue,
  COLORS,
  colorsFromCost,
  counterGrantedKeywords,
  counterStatBonus,
  isAttachingAbility,
  isAuraCard,
  isCreature,
  isCreatureTokenSpec,
  isGrantableKeywordAbilityKind,
  isLand,
  isLiteralAmount,
  isLoyaltyAbility,
  isPlaneswalker,
  isStaticAuraModification,
  manaValue,
  sortColors,
  targetFilterIsEmpty,
  tokenAbilities,
} from '@mtg/dsl';
import type { CardScoreWeights, EffectWeight } from './config';
import type { CurveBucket } from './curve-bucket';
import { curveBucket } from './curve-bucket';
import type { DeckContext, SubtypeBody } from './deck-context';
import { conditionSupply, counterSupply, subtypeShare, subtypeSupply } from './deck-context';
import { hypergeometricAtLeast } from './hypergeometric';

/** One named contribution to a card's score. */
export interface ScoreComponent {
  readonly name: string;
  readonly value: number;
}

export interface CardEvaluation {
  readonly card: Card;
  /** Sum of `components`. Higher is a better pick. */
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  readonly manaValue: number;
  readonly bucket: CurveBucket;
  /** Color identity used for playability: declared colors unioned with the cost's. */
  readonly colors: readonly Color[];
  readonly isCreature: boolean;
  /** True when the card can answer an opposing creature. */
  readonly isRemoval: boolean;
}

/**
 * Colors a card's own abilities have to be paid in, which its mana cost never
 * mentions.
 *
 * `checkColorIdentity` derives `colors` from the printed cost alone, and it
 * refuses a noncreature artifact whose printed cost is not colorless
 * (`ARTIFACT_NOT_COLORLESS`, `packages/dsl/src/validate/cost.ts`). So
 * "{1}{G}, {T}: Destroy target creature" is printed on a card the DSL calls
 * colorless and the builder offers to all ten pairs. A deck that cannot make
 * green owns that card and never activates it: a blank whose whole text is one
 * line it may not pay for, and one `isRemovalCard` counts as an answer the deck
 * has.
 *
 * Only an activated ability is reachable here, and that is the whole of it. A
 * trigger and a static cost nothing to have, and an equip clause is an
 * activated ability carrying `attach` (`AbilitySchema`), so "Equip {2}{W}" is
 * counted by this same arm rather than needing one of its own.
 */
function activationColors(card: Card): readonly Color[] {
  return card.abilities.flatMap((ability) =>
    ability.kind === 'activated' ? colorsFromCost(ability.cost.mana) : [],
  );
}

/**
 * Color identity for deck-building purposes.
 *
 * The DSL validators already require `colors` to equal the colors implied by
 * the cost, but the builder consumes cards from generators and files, so it
 * unions both rather than trusting one — an unvalidated card must never slip an
 * off-color spell into a deck. The abilities are unioned in for a stronger
 * reason: what a card costs to *use* is a color the deck has to make, and no
 * validator puts it in `colors`.
 *
 * A land is exempt because the DSL has only basics — `basicLandType` is
 * required and `checkLandColors` refuses a land that declares a color at all.
 */
export function cardColors(card: Card): readonly Color[] {
  const declared = card.colors;
  if (isLand(card)) return sortColors(declared);
  return sortColors([...new Set([...declared, ...colorsFromCost(card.manaCost), ...activationColors(card)])]);
}

/** Stat contribution of a body, before the cost baseline is subtracted. */
function statValue(power: number, toughness: number, weights: CardScoreWeights): number {
  return weights.creaturePowerWeight * power + weights.creatureToughnessWeight * toughness;
}

/**
 * Keywords whose whole benefit is combat damage getting through, and are
 * worth nothing on a body that deals none.
 *
 * The test is not "is this an evasion keyword" but "does the reminder text
 * name a thing that happens only when this creature deals combat damage":
 *
 *  - `flying`, `trample` and `menace` change *whether* damage gets through.
 *    Zero power carried through is still zero, so the keyword changes nothing.
 *  - `firstStrike` changes *when* combat damage is dealt, and a 0-power
 *    creature dealing it first is dealing zero first — no favorable trade it
 *    could not already get by not existing.
 *  - `deathtouch` reads "damage dealt by this creature is lethal" — no damage
 *    dealt, nothing is lethal.
 *  - `lifelink` reads "you gain life equal to the damage dealt" — the same
 *    dependency as deathtouch, and the task that named this set flagged it as
 *    arguable rather than settled; it is included here on the same reminder-
 *    text test the others pass, not as a special case.
 *
 * `vigilance` and `reach` are excluded because neither reads off combat
 * damage dealt: vigilance is worth exactly as much on a 0-power creature
 * (it still blocks a real threat without tapping down, and still attacks to
 * pressure a planeswalker even at 0 power), and reach only changes what the
 * creature may block, never what it deals. `haste` is excluded for the same
 * reason: what it grants is an untapped, unsummoning-sick body a turn early,
 * which a 0-power creature still has a use for (an activated ability, an
 * `enters`-triggered token) independent of whether it can attack for damage.
 *
 * Before this fix every keyword here scaled linearly through zero power and
 * flattened to its flat `keywordBase` at exactly zero rather than vanishing,
 * so a {W} 0/2 flier priced flying's entire base value onto a body that can
 * never deal the damage flying is for.
 */
const ZERO_AT_ZERO_POWER: ReadonlySet<Keyword> = new Set([
  'flying',
  'trample',
  'menace',
  'firstStrike',
  'deathtouch',
  'lifelink',
]);

/** Keyword contribution of a body; scaling keywords read the body's power. */
function keywordValue(keywords: readonly Keyword[], power: number, weights: CardScoreWeights): number {
  return keywords.reduce((sum, keyword) => {
    if (power === 0 && ZERO_AT_ZERO_POWER.has(keyword)) return sum;
    return sum + weights.keywordBase[keyword] + weights.keywordPowerScale[keyword] * power;
  }, 0);
}

/**
 * The keyword abilities whose whole benefit is combat damage getting through,
 * on `ZERO_AT_ZERO_POWER`'s test rather than a second one.
 *
 * `landwalk` is `flying` in that docblock's own words — it changes *whether*
 * damage gets through, and zero power carried through is still zero — and it is
 * priced off `keywordBase.flying` for exactly that reason, so it floors where
 * flying floors. `doubleStrike` is `firstStrike` one step later: CR 702.4b puts
 * its object in a second damage step, and a 0-power creature dealing zero
 * twice has dealt zero.
 *
 * The other four are absent and each for its own reason. `defender` is the case
 * the exclusion list up there settles: `vigilance` is out of it because a
 * 0-power creature "still attacks to pressure a planeswalker even at 0 power,"
 * and defender is the word that takes that attack away, so it costs the same on
 * a 0/6 as on a 6/6. The three survival-shaped abilities read no power at all —
 * their whole price is a share of the body's stat value — so flooring them on
 * power would be flooring on a term they do not have, and a 0/6 indestructible
 * wall is the card the floor would be most wrong about.
 */
const ZERO_AT_ZERO_POWER_ABILITIES: ReadonlySet<KeywordAbility['kind']> = new Set([
  'landwalk',
  'doubleStrike',
]);

/**
 * Keyword-ability contribution of a permanent.
 *
 * The second keyword vocabulary, priced on `keywordValue`'s terms one function
 * up: a flat part plus a rate read off the body. What is new is the third term,
 * because the six do not all scale on the same thing —
 * `DEFAULT_KEYWORD_ABILITY_VALUE` argues the split at length and every number
 * it uses.
 *
 * `body` is the thing the survival-shaped abilities keep alive, in `statValue`
 * units: a creature's own stats, a planeswalker's loyalty priced the way the
 * walker arm already prices it, and zero for a permanent with neither, which is
 * a hole the weights docblock names rather than an answer.
 *
 * The `protection` narrowing is the one place a price depends on the ability's
 * payload rather than only on its kind. `ProtectionQualitySchema`'s color arm
 * carries the table's rate outright; its subtype arm is narrowed by
 * `staticSubtypeReachFactor`, this file's existing number for how much of a
 * board a named creature type covers.
 */
function keywordAbilityValue(
  abilities: readonly KeywordAbility[],
  power: number,
  body: number,
  weights: CardScoreWeights,
): number {
  return abilities.reduce((sum, ability) => {
    if (power === 0 && ZERO_AT_ZERO_POWER_ABILITIES.has(ability.kind)) return sum;
    const weight = weights.keywordAbilityValue[ability.kind];
    const narrowing =
      ability.kind === 'protection' && ability.quality.kind === 'subtype'
        ? weights.staticSubtypeReachFactor
        : 1;
    return sum + (weight.flat + weight.perPower * power + weight.bodyShare * body) * narrowing;
  }, 0);
}

/**
 * Total value of a creature body, used for both printed creatures and tokens.
 *
 * `keywordAbilities` is required rather than defaulted, and that is the whole
 * of `mtg-gloz`'s fix at this call site. The six were invisible here for as
 * long as they existed because nothing passed them and nothing had to; a
 * defaulted empty list would have kept every existing caller compiling and kept
 * the same six priced at zero on whichever of them forgot. A `TokenSpec` is the
 * one caller that legitimately has none — `TokenSpecSchema` carries `keywords`
 * and no `keywordAbilities` field at all, so a token cannot print one — and it
 * says so by passing an empty list at a site the compiler named.
 */
export function bodyValue(
  power: number,
  toughness: number,
  keywords: readonly Keyword[],
  keywordAbilities: readonly KeywordAbility[],
  weights: CardScoreWeights,
): number {
  const stats = statValue(power, toughness, weights);
  return (
    stats +
    keywordValue(keywords, power, weights) +
    keywordAbilityValue(keywordAbilities, power, stats, weights)
  );
}

/**
 * A body, read out of the creature arm's currency and into the spell arm's.
 *
 * One exchange rate off two weights this file already carries, rather than a
 * constant tuned until a card looked right (`mtg-pxzq`).
 *
 * The two arms of `evaluateCard` charge a card's mana at different rates and
 * have to. A creature is scored cost-relative: `creatureStatBaselinePerMana`
 * stat points per mana is what a fair vanilla body costs, so a creature card's
 * whole cost is charged inside `statSurplus` and it pays nothing else. A spell
 * is charged `spellManaPenaltyPerMana` per mana and its text is then priced
 * absolutely. A token is a body a spell delivers, so it sits between the two,
 * and reading it in either arm's raw units charges the same mana twice or not
 * at all:
 *
 *  - at the full `bodyValue` a creature is credited, a five-mana sorcery making
 *    a 4/4 flier comes out near seven while the identical 4/4 flier printed as a
 *    five-mana creature comes out at 0.6, because the spell paid 0.55 a mana for
 *    what the creature paid 2.0 for;
 *  - at a flat fraction of `bodyValue` (the 0.4 rate this replaces), the
 *    fraction is standing in for a mana charge the spell arm is already making,
 *    which is the double charge the bug is.
 *
 * So the body is read as what it is worth *in mana of fair creature*
 * (`bodyValue / creatureStatBaselinePerMana`), and that mana is priced at the
 * rate the spell arm already prices mana. The two arms then agree exactly where
 * they must: a token spell delivering a fair body for its cost scores
 * `creaturePremium`, which is what a fair creature card of that cost scores, at
 * every cost. Above the rate they diverge, a creature card gaining a full point
 * per point of stats over fair where a token spell gains
 * `spellManaPenaltyPerMana / creatureStatBaselinePerMana` of one, and that is
 * the understating direction, which is the one this file takes wherever it has
 * to pick.
 *
 * A non-positive baseline is the one input this cannot convert at, because it is
 * the divisor: a config that sets it there has said a body has no cost
 * calibration at all. The body half is dropped rather than allowed to reach
 * Infinity, since an Infinity here does not fail; it silently sorts every token
 * spell to the front of every ordering `comparePoolCards` produces.
 *
 * Exported because the rate belongs in one place: a test that restated
 * `bodyValue / baseline * penalty` by hand would pass against a mistake in it.
 */
export function bodyEffectValue(body: number, weights: CardScoreWeights): number {
  const baseline = weights.creatureStatBaselinePerMana;
  if (baseline <= 0) return 0;
  return (body / baseline) * weights.spellManaPenaltyPerMana;
}

/**
 * What one token is worth: its body priced as a body, plus what its printed
 * abilities do.
 *
 * A token with no body is worth its abilities and nothing else, which is the
 * right answer rather than a fallback — a part token is an artifact that does
 * one thing when you spend it, and pricing it as a 0/0 creature would make
 * every Monster in the flagship set score as if it dropped nothing.
 *
 * A token that has a body is a creature, so it is credited `creaturePremium` on
 * the terms that weight states: a flat bonus every creature receives, because
 * Limited decks are won on the board. That is a claim about a permanent rather
 * than about a card, so it is per token and a bodiless part is not one. Said as
 * a derivation: one token is a creature card whose mana cost somebody else
 * paid, and the creature arm scores such a card at `creaturePremium` plus the
 * stats it got over fair, so a token is worth that premium plus the fair mana
 * the spell did not spend on it, priced at the rate the spell arm prices mana.
 * The two arms can be read against each other at the limit and this one comes
 * out lower: the creature arm would score a free 0/1 card at 1.65 and this
 * scores a 0/1 token at 1.03, which is the understating direction again.
 *
 * The ability half goes through `abilityValue`, the same function a printed
 * card's abilities are scored with, and it is added **unconverted**: an
 * ability's value is already denominated in the spell arm's currency, so
 * `bodyEffectValue` reaches the body and nothing else. That is what makes this
 * docblock's oldest sentence true rather than merely intended (a Fuse ability
 * on a token and the same ability on a card cannot be priced differently),
 * because until `mtg-pxzq` the `createToken` row multiplied all of this by 0.4,
 * abilities included, and a Part's Fuse was worth 0.4 of the counter it puts.
 *
 * The body half is `permanentBodyValue` rather than the expression written out,
 * because a `sacrificeOther` cost prices the body it eats with the same one
 * (`sacrificedValue` below) and the two must not drift. The creature premium is
 * deliberately added here rather than inside that shared function: it is the
 * credit for adding a creature to a Limited board, not a second price on the
 * body's stats, and the sacrifice-cost docblock argues why spending the body
 * does not reverse it.
 */
function permanentBodyValue(body: SubtypeBody | null, weights: CardScoreWeights): number {
  if (body === null) return 0;
  return bodyEffectValue(
    bodyValue(body.power, body.toughness, body.keywords, body.keywordAbilities, weights),
    weights,
  );
}

function tokenValue(token: TokenSpec, weights: CardScoreWeights): number {
  const creature = isCreatureTokenSpec(token);
  const body = permanentBodyValue(
    creature
      ? {
          power: token.power,
          toughness: token.toughness,
          keywords: token.keywords,
          keywordAbilities: [],
        }
      : null,
    weights,
  );
  const premium = creature ? weights.creaturePremium : 0;
  return tokenAbilities(token).reduce((sum, ability) => sum + abilityValue(ability, weights), body + premium);
}

/**
 * How many tokens one `createToken` makes when the card prints no numeral.
 *
 * One, and deliberately not `assumed`'s three. That guess is this file's answer
 * for a magnitude nobody can read, and three is right when the unknown is how
 * far an effect reaches; it is wrong here, because this magnitude is a count of
 * bodies and every body is credited `creaturePremium` before it is credited
 * anything else, so guessing high hands a card two free premiums it may not have.
 *
 * `nwo.ts`'s `wideBoard` rule reads the same unreadable count the other way and
 * for the same reason: a New World Order budget is spent by the widest board a
 * common could make, so there an unreadable count is wide by assumption and here
 * it is narrow by assumption. Both resolve it against the card. Both are also
 * only ever reached by a hand-authored one, because `ModelEffectSchema` builds
 * `count` over `z.int()` and no generated card can carry a computed amount.
 */
function tokenCount(count: Amount): number {
  return isLiteralAmount(count) ? count : 1;
}

/**
 * A quantity this evaluator cannot compute, resolved to the one assumption it
 * is willing to name.
 *
 * Every magnitude below reads its numbers through this, so there is one place
 * where "the card says X and we guessed 3" happens.
 *
 * A rate is the one shape whose printed number is not the guess: "-1/-1 for
 * each Swamp you control" states the -1 outright and leaves only the count
 * unknown, so `amountOrAssume` multiplies the assumption by the rate instead of
 * replacing it — Mutilate prices as -3/-3 under the standing assumption of
 * three, not as -1/-1.
 */
function assumed(amount: PumpAmount, weights: CardScoreWeights): number {
  return amountOrAssume(amount, weights.computedAmountAssumption);
}

/** The one effect the union carries for a given kind. */
type EffectOf<K extends AnyEffectKind> = Extract<Effect, { readonly kind: K }>;

/**
 * What one spell-effect primitive is worth: a flat part, a rate, and the
 * magnitude the rate is charged against.
 *
 * All three in one row rather than the numbers in `config.ts` and the magnitude
 * in a `switch` here, which is what they were. The split was visible in the
 * prose: `EffectWeight.perUnit` had to say "the unit differs per primitive and
 * is defined by `effectMagnitude` in `evaluate.ts`", and `exileTarget`'s comment
 * had to describe a pricing decision a reader could see only half of from either
 * site. A rate and the thing it is a rate *of* are one decision.
 *
 * The magnitude is not a tunable, which is why `CardScoreWeights` still carries
 * `base` and `perUnit` alone: retuning the evaluator moves numbers, and what a
 * unit of an effect *is* is structural. `DEFAULT_EFFECT_VALUE` below is these
 * rows with the structure dropped.
 */
export interface EffectPricing<K extends AnyEffectKind = AnyEffectKind> {
  /** Flat value of the primitive, before its magnitude. */
  readonly base: number;
  /** Value per unit of `magnitude`. */
  readonly perUnit: number;
  /** How many units of itself this effect is, on this card. */
  readonly magnitude: (effect: EffectOf<K>, weights: CardScoreWeights) => number;
}

/**
 * Every primitive's price. Mapped over the whole union, so a primitive added to
 * `@mtg/dsl` without a price is a compile error here exactly as the
 * `assertNever` default on the old `switch` was.
 */
export type EffectPricingTable = { readonly [K in AnyEffectKind]: EffectPricing<K> };

/**
 * One row with the caller's kind unknown: the union of the rows, not
 * `EffectPricing<AnyEffectKind>`. `magnitude`'s parameter is contravariant, so
 * the widened row is a type nothing can satisfy.
 */
type EffectPricingRow = EffectPricingTable[AnyEffectKind];

/**
 * How many bodies one effect reaches: one, or an assumed group when it is
 * scoped.
 *
 * Written once because six rows now ask it and every one of them must answer it
 * the same way. The reach is a *weight* rather than a constant for the reason
 * `exileTarget`'s row gives at length — it is an assumption about board width,
 * and this package names its assumptions where a caller can override them — and
 * reading the group any other way here (counting the live battlefield, say)
 * would let this evaluator price a sweeper the kernel does not perform.
 */
function scopeReach(effect: { readonly scope?: EffectScope | undefined }, w: CardScoreWeights): number {
  return effect.scope === undefined ? 1 : w.effectScopeReach[effect.scope];
}

export const EFFECT_PRICING: EffectPricingTable = {
  // Scoped, the same damage is dealt to every member of a group (CR 120.3), so
  // the printed number is multiplied by the assumed reach exactly as
  // `putCounters` multiplies the counters it places.
  dealDamage: {
    base: 0.4,
    perUnit: 0.55,
    magnitude: (effect, w) => assumed(effect.amount, w) * scopeReach(effect, w),
  },
  // `exileTarget`'s split, for `exileTarget`'s reason: once a row can price a
  // group, the whole price has to sit in `perUnit`, because per-unit is the only
  // place a group can be multiplied. Unscoped the two forms are the same number
  // to the last bit — `2.6 + 0.0 * 1` and `0.0 + 2.6 * 1` — so no card that
  // existed before this widening is priced differently by it.
  destroyPermanent: { base: 0.0, perUnit: 2.6, magnitude: (effect, w) => scopeReach(effect, w) },
  // Half of a destroy, and the half is the point: a fight answers a creature
  // only when the body it is printed on is big enough, it answers nothing at
  // all if that body is dealt with in response, and it can cost the fighter as
  // well as the fought. Priced at 1.3 rather than at 2.6, which puts it just
  // above a held tap (1.2) and well under unconditional removal — the ordering
  // the printed cards have.
  //
  // Flat rather than a function of the source's power, because this evaluator
  // prices an effect list and not a body: the power that matters is on the card
  // the effect is printed on, and that card's own `creatureBaseValue` term
  // already counts it. Charging for it twice would make a fight on a 5/5 read
  // as a better card than the 5/5 plus a removal spell.
  //
  // No `scopeReach`: `fight` carries no scope. The DSL prints one fight against
  // one creature, which is CR 701.12's whole shape.
  fight: { base: 1.3, perUnit: 0.0, magnitude: () => 1 },
  // A buff and a shrink are not the same primitive priced two ways: a buff
  // adds power the attacker gets to swing with and toughness that keeps it
  // alive, so the unit is the sum of both; a shrink that takes toughness away
  // is removal-shaped (CR 704.5g, toughness <= 0 is a state-based death), and
  // its unit is how much toughness it takes, not the sum — a card that reads
  // "target creature gets -2/-2" spends its whole effect on the toughness
  // line, and the old sum-of-both formula charged the *negative* power term
  // as a further penalty on top, so a stronger shrink scored as a worse card.
  // The floor read at `isRemovalEffect` below is the same floor a burn spell
  // has to clear, so the two paths agree on when a shrink is an answer.
  pumpUntilEndOfTurn: {
    base: 0.2,
    perUnit: 0.18,
    magnitude: (effect, w) => {
      const toughness = assumed(effect.toughness, w);
      if (toughness < 0) return -toughness * scopeReach(effect, w);
      return (assumed(effect.power, w) + toughness) * scopeReach(effect, w);
    },
  },
  drawCards: { base: 0.15, perUnit: 0.75, magnitude: (effect, w) => assumed(effect.count, w) },
  gainLife: { base: 0.0, perUnit: 0.1, magnitude: (effect, w) => assumed(effect.amount, w) },
  counterSpell: { base: 1.4, perUnit: 0.0, magnitude: () => 1 },
  // A token that enters the battlefield is a body, so `tokenValue` prices it as
  // one and this row multiplies by how many of them the effect makes. Count is
  // half the card: four 0/1s are not one 4/4, and one row that read only the
  // per-token body would price them the same.
  //
  // The whole price is therefore the magnitude, and `base` and `perUnit` are 0
  // and 1. That is not a rate withheld; it is a price this row does not get to
  // name. What a body is worth against a spell's mana is already settled by
  // `creatureStatBaselinePerMana` and `spellManaPenaltyPerMana`, and a third
  // number beside those two would be a third opinion about the same mana,
  // which is exactly what the 0.2/0.4 pair here was, and what charged a token
  // spell for its mana twice. `perUnit` stays overridable, so a caller who wants
  // tokens dearer still has the one lever, and it moves the derived price rather
  // than competing with it.
  //
  // Reached from an ability as well as from a spell, and that is correct rather
  // than incidental: `abilityValue` prices a trigger's and an activation's
  // effects through this same table, and a 1/1 is the same 1/1 whether a sorcery
  // or a death trigger put it on the battlefield. What differs between them is
  // the cost of reaching it, and every one of those costs is charged where it
  // lives: `triggerFireCount` for a trigger, `activationCostPerMana` and
  // `activationUses` for an activation, the printed mana for a spell. Pricing a
  // token by which line of the card printed it is the same mistake `tokenValue`
  // refuses for the token's own abilities.
  createToken: {
    base: 0.0,
    perUnit: 1.0,
    magnitude: (effect, w) => tokenCount(effect.count) * tokenValue(effect.token, w),
  },
  // `destroyPermanent`'s split, for its reason; `0.6 + 0.0 * 1` and
  // `0.0 + 0.6 * 1` are the same number.
  //
  // The hold multiplies the reach rather than adding to the base, so it is
  // bought once per permanent the effect reached; `heldTapFactor` states what a
  // second turn of denial is worth and why. An effect without the rider is
  // priced by the same arithmetic it always was, to the last bit.
  tapPermanent: {
    base: 0.0,
    perUnit: 0.6,
    magnitude: (effect, w) => scopeReach(effect, w) * (effect.doesNotUntap === true ? w.heldTapFactor : 1),
  },
  returnToHand: { base: 1.0, perUnit: 0.0, magnitude: () => 1 },
  millCards: { base: 0.0, perUnit: 0.02, magnitude: (effect, w) => assumed(effect.count, w) },
  putCounters: {
    base: 0.3,
    perUnit: 0.5,
    // A counter is worth what it declares, per counter placed: the stat half
    // priced like a permanent pump, the keyword half at its flat value. A
    // shrinking counter (gloom, minusOneMinusOne) is `pumpUntilEndOfTurn`'s
    // shrink arm's reason again: `statValue` charges the negative toughness as
    // a further penalty on top of itself, so a card whose whole point is
    // taking toughness away scored worse the more toughness it took. Priced
    // instead by the toughness removed, the same unit a burn spell is priced
    // by, so a permanent shrink and a temporary one agree on what a point of
    // toughness taken away is worth.
    magnitude: (effect, w) => {
      const bonus = counterStatBonus(effect.counter);
      const keywords = counterGrantedKeywords(effect.counter);
      const perCounter =
        bonus.toughness < 0
          ? -bonus.toughness
          : statValue(bonus.power, bonus.toughness, w) +
            keywords.reduce((total, keyword) => total + w.keywordBase[keyword], 0);
      // Scoped, the same counters land on every member of a group, so the
      // magnitude is multiplied by the same assumed reach `exileTarget` below
      // is multiplied by. Reading the group a second way here — counting the
      // board, say — would let this package value a sweeper the kernel does not
      // perform.
      return assumed(effect.count, w) * perCounter * scopeReach(effect, w);
    },
  },
  exileTarget: {
    // Zero base and the whole price in `perUnit`, which is the one row that
    // splits that way and the reason is `scope`. An unscoped exile answers one
    // creature and comes out at `destroyPermanent`'s 2.6 exactly; a scoped one
    // answers a group, and per-unit is where a group can be multiplied. Every
    // other kind's magnitude is a printed number, so its base and its rate can
    // be read apart; this kind's magnitude is a reach assumption, and pricing it
    // as a base plus a rate would be two numbers where the card has one idea.
    //
    // What exile is *worth over* a destroy is still nothing here: the graveyard
    // it denies is a zone this evaluator does not read, and a number invented
    // for it would be a claim nothing measures.
    base: 0.0,
    perUnit: 2.6,
    // One body unscoped, an assumed group scoped. The reach is a weight rather
    // than a constant because it is an assumption about board width, and this
    // package names its assumptions where they can be overridden.
    magnitude: (effect, w) => scopeReach(effect, w),
  },
  revealHand: {
    // Information, priced as information: it tells the caster what to play
    // around for one turn and changes nothing on the board. Small and nonzero,
    // because a card that does it is measurably better than a card that does
    // not, and nothing here can measure how much better.
    base: 0.3,
    perUnit: 0.0,
    // One reveal, whatever the hand holds. Scaling it by hand size would be a
    // claim that seeing six cards is twice seeing three, which nothing measures.
    magnitude: () => 1,
  },
  // Information quality depends on the deck and next draws, neither of which
  // this single-card evaluator holds.
  scry: { base: 0.0, perUnit: 0.0, magnitude: () => 1 },
  returnFromGraveyard: {
    // `exileTarget`'s split for `exileTarget`'s reason: the magnitude is a reach
    // assumption rather than a printed number, so the whole price is the rate
    // and there is no base to read apart from it.
    //
    // 2.6 per body is `destroyPermanent`'s number, and it is that number on
    // purpose. This evaluator measures a card by what it does to the board, and
    // one creature leaving the opponent's side and one creature arriving on
    // yours are the same one-body swing to it. What reanimation is worth *over*
    // a removal spell — that the body is one somebody already paid for, and that
    // it is chosen from a zone whose contents this evaluator cannot read — is
    // deliberately not priced, exactly as `exileTarget` refuses to price the
    // graveyard it denies. A number invented for it would be a claim nothing
    // measures.
    base: 0.0,
    perUnit: 2.6,
    magnitude: (effect, w) => w.effectScopeReach[effect.scope],
  },
  // Mana, priced as the mana it is, by the one number this package already
  // holds for what a point of mana is worth. `spellManaPenaltyPerMana` is what
  // a spell *loses* per point it costs; a mana added is that point handed back,
  // so a ritual for three is worth three of them and a Llanowar-style tap is
  // worth one. Deriving it rather than naming a fresh constant is
  // `createToken`'s reason verbatim: a second opinion about the value of a mana
  // would compete with the one every other row is already priced against, and
  // the two would drift.
  //
  // The whole price is therefore the magnitude, with `base` at zero and
  // `perUnit` at one, and `perUnit` stays the caller's lever — a format where
  // acceleration is dearer moves that number and moves this row with it.
  //
  // What is deliberately not priced: the color *choice*. A source that offers
  // two colors is better than one that offers one, and nothing here measures
  // how much better — the same refusal `exileTarget` makes about the graveyard
  // it denies. Repeatability is not priced here either, and that is not a
  // refusal but a division of labor: a mana ability is reached through
  // `abilityValue`, which charges `activationCostPerMana` and multiplies by
  // `activationUses`, so a permanent that taps every turn and a sorcery that
  // does it once already come out differently without this row knowing which
  // printed it.
  addMana: {
    base: 0.0,
    perUnit: 1.0,
    magnitude: (effect, w) => assumed(effect.amount, w) * w.spellManaPenaltyPerMana,
  },
  // The library and graveyard vocabulary, priced by what it does to the board:
  // four of the five do nothing to it at all, and the fifth is removal.
  //
  // A bare shuffle changes no zone contents and no board. It is worth something
  // to a deck that wants to re-randomize a known top, and this evaluator holds
  // one card rather than a deck, so what that is worth is a claim nothing here
  // measures — `scry`'s reason above, and the same zero.
  shuffleLibrary: { base: 0.0, perUnit: 0.0, magnitude: () => 1 },
  // `revealHand`'s number and `revealHand`'s argument, one zone over: it is
  // information, it changes nothing on the board, and how much a look at the
  // top of a library is worth depends on the deck under it. Priced at the same
  // 0.3 rather than at a number invented to separate the two, because nothing
  // here can measure the difference between seeing an opponent's hand and
  // seeing your own next three draws. Flat in the count for `revealHand`'s
  // reason: scaling by cards seen would claim three is three times one.
  revealTopCards: { base: 0.3, perUnit: 0.0, magnitude: () => 1 },
  // A tuck is removal (CR 701.19a puts the permanent in a hidden zone, off the
  // battlefield), so it is `destroyPermanent`'s 2.6 with `destroyPermanent`'s
  // split. What a tuck is worth *over* a destroy — the card has to be drawn
  // again rather than reanimated — and what it is worth *under* one — a tuck to
  // the top hands its owner their next draw — are two claims in opposite
  // directions that this single-card evaluator cannot weigh, so it makes
  // neither, exactly as `exileTarget` declines to price the graveyard it
  // denies. No `scopeReach`: the effect carries no scope and reaches one
  // permanent.
  putOnLibrary: { base: 0.0, perUnit: 2.6, magnitude: () => 1 },
  // Graveyard denial against a graveyard this evaluator cannot read. It is the
  // hate card whose whole value is the deck across the table, and a
  // single-card evaluator holds neither deck. Small and nonzero for
  // `revealHand`'s reason — a card that does it is better than a card that does
  // not — and flat in `whose`, because "both graveyards" is worth more than
  // "theirs" only when the reader knows what is in them.
  exileGraveyard: { base: 0.2, perUnit: 0.0, magnitude: () => 1 },
  // Zero, and `setLife`'s reason for a zero rather than a small nonzero: what a
  // shuffle-back is worth is the graveyard it reads and the library it feeds,
  // and its *sign* flips with the deck. It is the whole engine in a deck that
  // mills itself and a blank in a deck that does not, and this evaluator holds
  // one card and no game state. `includeSelf` does not move the number either:
  // a permanent that shuffles itself away is buying repetition, which is a fact
  // about the games ahead rather than about the card.
  shuffleGraveyardIntoLibrary: { base: 0.0, perUnit: 0.0, magnitude: () => 1 },
  // A tutor is worth the card it finds, and which card that is depends on the
  // deck it is in. `@mtg/deckbuild` builds the deck *from* these scores, so a
  // row that read the deck would be circular; the value it wants is the best
  // card the filter reaches, which is not a fact about this card. Priced above
  // a bare draw's 0.9 (`drawCards` at one card) because a search chooses and a
  // draw does not, and well under a removal spell, which is the ordering the
  // printed cards have. Flat in the filter and the destination for the reason
  // every unmeasurable rider in this table is flat: a number invented to
  // separate "put it onto the battlefield" from "put it into your hand" would
  // be a claim nothing measures.
  searchLibrary: { base: 1.2, perUnit: 0.0, magnitude: () => 1 },
  // The hand vocabulary, priced against the draw it is the mirror of.
  //
  // `drawCards` charges 0.75 per card, and a discard takes one card away for
  // every card a draw adds, so the naive reading is 0.75 back. It is priced
  // under that, at 0.55, and the discount is the one thing this evaluator can
  // say about a discard with a straight face: a drawn card is chosen by the
  // deck it came from and a discarded card is chosen by the player losing it,
  // who pitches the one they wanted least. That is a real gap and its size is
  // not measurable from one card, so the row takes the conservative end rather
  // than inventing a coefficient. Per-card rather than flat, unlike every other
  // information effect here, because a discard is card advantage and card
  // advantage is the one quantity this table already scales linearly
  // (`drawCards`, `millCards`).
  //
  // Both rows are `magnitude: (effect) => effect.count` and not `assumed`: the
  // DSL bounds the count at `MAX_DISCARD_COUNT` and prints it as a literal
  // integer, so there is no computed amount for `assumed` to guess at.
  discardCards: { base: 0.0, perUnit: 0.55, magnitude: (effect) => effect.count },
  // The same discard with the choice moved across the table, which is strictly
  // better and is priced strictly higher: 0.75, which is `drawCards`' rate
  // exactly, because the discount above was the whole of the gap between a
  // discard and a draw and choosing closes it. It is not priced *above* a draw
  // even though taking an opponent's best card plausibly beats drawing your
  // own, because how much better depends on what is in their hand and this
  // evaluator holds one card. `revealHand`'s 0.3 is not added on top: the
  // reveal here is the mechanism of the choice rather than a rider, and a card
  // that reveals and then takes is one effect, not two.
  chooseDiscard: { base: 0.0, perUnit: 0.75, magnitude: (effect) => effect.count },
  // `gainLife`'s rate, in the other direction, and the anchor is deliberate: a
  // drain moves a life total by N and does nothing to the board, which is the
  // whole of what a life gain does too. It is emphatically *not*
  // `dealDamage`'s 0.55, because that rate is paid for killing creatures and a
  // life-loss effect kills none — the asymmetry `loseLife`'s own docblock in
  // `@mtg/dsl` names is a reason to price it *below* damage, and this is the
  // number that does. No `scopeReach`: the effect carries no scope.
  loseLife: { base: 0.0, perUnit: 0.1, magnitude: (effect, w) => assumed(effect.amount, w) },
  // Zero, and `shuffleLibrary`'s reason for a zero rather than a withheld rate.
  // What this effect is worth is `|N - your current life|` and its *sign* flips
  // with which side of N the total is on: the same printed card is a heal at 4
  // life and a self-inflicted loss at 30. This evaluator holds one card and no
  // game state, so it cannot read the term that decides even the direction, and
  // a number invented here would be a claim about a life total nothing has
  // measured.
  setLife: { base: 0.0, perUnit: 0.0, magnitude: () => 1 },
  // A Fog: small, nonzero, and flat, for `exileGraveyard`'s reason. What it is
  // worth is the size of the combat step across the table, which is a fact
  // about the opponent's board rather than about this card — but a deck that
  // holds one is better off than a deck that holds a blank, so the row is not a
  // zero. `revealTopCards`' 0.3 rather than a number invented to separate the
  // two, because nothing here can measure the difference.
  preventCombatDamage: { base: 0.3, perUnit: 0.0, magnitude: () => 1 },
  // The row above, aimed rather than blanket, and worth more for it: a Fog
  // stops one combat step for the whole table, this stops every source of
  // damage — combat or a burn spell — aimed at one chosen creature, which is
  // Dawn Charm's first mode rather than a wider Holy Day. Still flat and still
  // small, for `preventCombatDamage`'s reason unchanged: what it is worth is
  // which removal spell or which attack it answers, a fact this evaluator
  // holds one card and no game state to read. Priced above the Fog it sits
  // beside and below `gainLife`'s per-point rate, because "saves a creature
  // outright" is worth more than "saves some damage" but is still a number
  // this row cannot pin to a real trade.
  preventAllDamageToTarget: { base: 0.5, perUnit: 0.0, magnitude: () => 1 },
  // Recursion, priced as the card it buys back, which is a card this evaluator
  // does hold — unlike `searchLibrary`, whose value is the best card in a deck
  // it cannot read. What it buys back is nonetheless a *spent* card rather than
  // a chosen one, so it prices under a tutor's 1.2 and above a bare draw's 0.9:
  // the graveyard is a smaller and worse-ordered pool than a library, and the
  // effect still chooses within it.
  //
  // Flat in `whose`, `filter` and `destination` for the reason every
  // unmeasurable rider in this table is flat. The destination is the one that
  // tempts a coefficient — putting a creature onto the battlefield is plainly
  // worth more than putting it into a hand, since it skips the mana — and the
  // temptation is refused here for `searchLibrary`'s stated reason: the size of
  // that gap is the mana value of a card in a graveyard this row is not handed.
  chooseFromGraveyard: { base: 1.0, perUnit: 0.0, magnitude: () => 1 },
  // Flat, and low, and the reason is the one `vocabulary.ts` gives for leaving
  // the kind unpriced by the color pie: an untap is worth whatever the board
  // makes it worth. Untapping a mana source is a ritual, untapping a blocker is
  // a Fog, untapping a permanent that was never tapped is nothing at all, and
  // this evaluator holds one card and no board. It prices a shade under the
  // `tapPermanent` a Voltaic Key untaps for, because a tap takes an opponent's
  // permanent out of a turn it wanted and an untap gives back one this seat
  // spent on purpose, which is the smaller half of the same trade.
  untapPermanent: { base: 0.5, perUnit: 0.0, magnitude: () => 1 },
  // One keyword on one creature for one turn: a combat trick, which is what
  // the row above `pumpUntilEndOfTurn` prices a small pump as. A flat base and
  // no per-unit term, because there is no unit — the magnitude of a grant is
  // the body it lands on, and a deck evaluator holding a card list has not
  // seen a board.
  //
  // `scopeReach` is the one thing this row can say about size, and it says it
  // for the reason the pump above does: the number of bodies is the one part of
  // "how big is this" that does not need a board, and Overwhelming Stampede
  // handing a whole team trample is not a combat trick priced at 0.8.
  grantKeywordUntilEndOfTurn: {
    base: 0.8,
    perUnit: 0.0,
    magnitude: (effect, w) => scopeReach(effect, w),
  },
  // Evasion for one turn on one creature, priced level with the grant above and
  // for the same reason: a deck evaluator holds a card list and no board, so the
  // magnitude of "gets through this turn" is the body it is aimed at, which this
  // seat cannot see. Slightly under `grantKeywordUntilEndOfTurn` because that
  // row's keyword can be lifelink or deathtouch or trample and this one is
  // always the narrowest of the three.
  cantBeBlockedThisTurn: { base: 0.7, perUnit: 0.0, magnitude: () => 1 },
  // Pulling a blocker out of position is the same trade `tapPermanent` makes —
  // an opponent's creature spends the turn somewhere it did not choose — and it
  // is priced under it, because a tap removes the creature from combat outright
  // while a lure only decides where it stands, and it may kill the thing that
  // lured it on the way in.
  attacksYouThisTurnIfAble: { base: 0.5, perUnit: 0.0, magnitude: () => 1 },
  // Diminish. Flat and boardless for the third time in this stretch of the
  // table, and here the reason is sharpest: the size of a base P/T set is the *gap*
  // between the printed numbers and the numbers the creature already has, and
  // a deck evaluator holds a card list. "Base 1/1" is removal aimed at a 5/5
  // and a blank aimed at a 1/1, and no per-unit term over `effect.power` can
  // tell the two apart without the body.
  //
  // Level with `grantKeywordUntilEndOfTurn` rather than under
  // `cantBeBlockedThisTurn`, and above neither by accident: a set can take an
  // attacker out of a combat outright and finishes a damaged creature the way
  // no evasion grant does, but it lasts a turn, which is what keeps it under
  // `returnToHand`'s 1.0 for a bounce that is gone for good.
  setBasePtUntilEndOfTurn: { base: 0.8, perUnit: 0.0, magnitude: () => 1 },
  // The first negative row in this table, and the sign is the whole entry. Every
  // other primitive here is something a card does to the board on its
  // controller's behalf; this one takes a permanent off that controller's own
  // board (CR 701.17). Ball Lightning and Arc Runner pay for their stats with
  // it, which is exactly a cost, and a zero would have priced them as free.
  //
  // `-destroyPermanent`'s magnitude, because that is what it is: the same
  // removal, aimed at the wrong side of the table. Flat, with no `scopeReach` —
  // the effect names the source and only the source, so there is no group for a
  // reach to multiply.
  sacrificeSelf: { base: -2.6, perUnit: 0.0, magnitude: () => 1 },
  // Removal, but not the caster's own pick (CR 701.17a): the target answers
  // with whichever creature they can most afford to lose, never the one this
  // seat would have named, and answers with nothing at all when they control
  // none. `destroyPermanent`'s 2.6 prices a caster naming the exact card that
  // dies; this row prices the same removal with the choice handed to the other
  // side of the table, so it sits below that ceiling for what the choice gives
  // away rather than at it. No `scopeReach`: the effect names one player and
  // no sweep, `sacrificePermanentEffect`'s stated cut in `@mtg/dsl`.
  sacrificePermanent: { base: 1.8, perUnit: 0.0, magnitude: () => 1 },
};

/**
 * The tunable half of `EFFECT_PRICING`, which is what `CardScoreWeights` holds
 * and what a caller may override. Derived rather than restated, so the two
 * cannot disagree.
 */
export const DEFAULT_EFFECT_VALUE: Readonly<Record<AnyEffectKind, EffectWeight>> = (() => {
  const table = {} as Record<AnyEffectKind, EffectWeight>;
  for (const kind of ALL_EFFECT_KINDS) {
    const { base, perUnit } = EFFECT_PRICING[kind];
    table[kind] = { base, perUnit };
  }
  return table;
})();

/**
 * The magnitude an effect is scaled by. Units differ per primitive and are
 * stated on each row of `EFFECT_PRICING`.
 */
export function effectMagnitude(effect: Effect, weights: CardScoreWeights): number {
  const pricing: EffectPricingRow = EFFECT_PRICING[effect.kind];
  // The one assertion in this file. `EFFECT_PRICING` is keyed by the same
  // discriminant `effect` carries, so `pricing` is by construction the row for
  // `effect.kind` and its `magnitude` takes exactly this effect; TypeScript
  // cannot correlate the two across an index lookup. Each row's magnitude is
  // still checked against its own effect shape at the definition site.
  const of = pricing.magnitude as (e: Effect, w: CardScoreWeights) => number;
  return of(effect, weights);
}

/**
 * Ceiling on what one `statBonus` entry in an equip clause may be priced at,
 * before it joins the rest of the clause's value and the equip cost is
 * subtracted (`mtg-6zs8`).
 *
 * The DSL bounds a printed `statBonus` delta at +-99 (`LIMITS.statBonusDelta`,
 * `packages/dsl/src/validate/effects.ts`), and its own comment says why: that
 * range exists "to stop the generator printing 40 damage," a backstop against
 * a missing digit, not a balance number. +99/-3 sits legally inside it, so
 * nothing upstream of this evaluator refuses it, and this function is where a
 * play-relevant answer has to come from instead.
 *
 * What a stat modification is worth is bounded by what a body can do with it,
 * and this scorer already states, in this same file, the largest body it has
 * ever assigned a meaning to: `creatureStatBaselinePerMana` per mana, out to
 * `formatMedianRounds` — the last mana value CR 305.2a's one-land-a-turn cap
 * lets a typical game actually reach (`topEndReachability` discounts every
 * mana value past it for exactly this reason). A creature that size is priced
 * elsewhere in this file as the best fair body the format recognizes; a
 * modification that would make a host bigger than that is not describing a
 * better creature, it is describing one this scorer has no calibration for,
 * so it is clamped to the size of the one it does.
 *
 * Symmetric rather than one-sided: a modification that subtracts an equally
 * extreme amount (a "curse" weapon nobody would equip) is exactly as
 * uncalibrated in the other direction, and `Math.max(0, …)` where this is
 * used already floors the ability at zero once a modification stops paying
 * for its own cost, so a very negative ceiling would be inert past that floor
 * for every real card and would only matter for the pathological one this
 * exists to catch.
 */
function equipModificationCeiling(weights: CardScoreWeights): number {
  return weights.creatureStatBaselinePerMana * weights.formatMedianRounds;
}

/** What one static modification is worth per permanent it reaches. */
function staticModificationValue(modification: StaticModification, weights: CardScoreWeights): number {
  switch (modification.kind) {
    case 'statBonus':
      return statValue(modification.power, modification.toughness, weights);
    case 'grantKeyword':
      // Only the flat half of a keyword's value. `keywordPowerScale` scales
      // against the body carrying the keyword, and the bodies a static reaches
      // are not on this card — which is also why the keyword-ability half reads
      // `flat` alone out of a `KeywordAbilityWeight` whose other two terms are
      // per-power and body-share. Two tables because the config already keeps
      // two (`keywordBase` prices the evergreen nine, `keywordAbilityValue`
      // prices the six), and a granted name is priced the same as a printed one.
      return isGrantableKeywordAbilityKind(modification.keyword)
        ? weights.keywordAbilityValue[modification.keyword].flat
        : weights.keywordBase[modification.keyword];
    case 'definePt': {
      // A characteristic-defining P/T (CR 613.4a, e.g. Tarmogoyf) is a live
      // board/graveyard count this evaluator has no state to compute — the same
      // gap `computedAmountAssumption` already names for a damage spell that
      // reads "cards exiled this way", reused here rather than duplicated as a
      // second named guess for the same kind of unknowable quantity.
      const count = weights.computedAmountAssumption;
      return statValue(count + modification.powerOffset, count + modification.toughnessOffset, weights);
    }
    case 'statBonusPer': {
      // A rate times a board count, and the count is the same unknowable this
      // evaluator already names once: `computedAmountAssumption` is what
      // `definePt` one case up spends on a live count, and spending it here too
      // keeps one named guess for one kind of unknown rather than two that can
      // drift apart. Priced through `statValue` like every other body term, so
      // an Earth Servant is scored as the +0/+3 it is assumed to be rather than
      // as the +0/+1 it prints.
      //
      // Zero would have been the silent regression: this modification is the
      // whole of what such a card does, so pricing it at nothing would score a
      // four-mana 4/1-that-grows as a four-mana 4/1 and let the deck builder
      // pass over every card in the family at once.
      const count = weights.computedAmountAssumption;
      return statValue(modification.power * count, modification.toughness * count, weights);
    }
    // Both doublers price at zero, and for the two halves of one reason: each
    // multiplies a quantity that is not on this card.
    //
    // `doubleDamage` is symmetric — Furnace of Rath doubles what the opponent
    // deals too — so whether it is worth anything depends on which deck deals
    // more damage, and `@mtg/deckbuild` builds the deck *from* these scores, so
    // a row that read the deck would be circular. That is `searchLibrary`'s
    // argument for its own flat rate, and here it goes all the way to zero,
    // because a symmetric effect can be worth a negative number and no rate is
    // right for a term whose sign is unknown.
    //
    // `doubleLifeGain` multiplies a life gain this card does not produce. It is
    // the rider whose whole value is the rest of the deck, which is the same
    // thing `exileGraveyard` says about the graveyard across the table — except
    // that this one is not even nonzero-by-default, because a deck with no life
    // gain in it gets literally nothing.
    case 'doubleDamage':
    case 'doubleLifeGain':
      return 0;
    // The combat class (`static-modification-class.ts`), reachable only on a
    // static ability's own scope — `STATIC_SCOPES` has no "opponent's
    // creatures" option, so unlike the Aura arm below (`auraModificationValue`,
    // which chooses its host and can name an opponent's), every one of these
    // six always lands on a creature this card's own controller keeps.
    case 'cantAttack':
    case 'cantBlock':
      // The Aura arm prices these two as a gain: what taking the equivalent
      // combat role away from an opponent's creature is worth, off the same
      // `singleCreatureAnswerValue` anchor. A static with no opponent-facing
      // scope can only place the identical restriction on the caster's own
      // creature, which is the same loss with the sign flipped rather than a
      // second number to calibrate.
      return -weights.auraCombatDenialShare * singleCreatureAnswerValue(weights);
    case 'cantBeBlocked':
      // Same clause, same anchor as the Aura arm's `cantBeBlocked` — the sign
      // does not flip here, because being unblockable is a gain for whoever's
      // creature carries it, caster or Aura target alike.
      return weights.keywordBase.flying;
    // `attacksEachCombatIfAble`, `mustBeBlockedIfAble` and
    // `blockOnlyCreaturesWithKeyword` price at zero for the `doubleDamage`/
    // `doubleLifeGain` reason two cases up, not a fresh one: each is a rider
    // whose sign this evaluator cannot resolve from the card alone.
    // `attacksEachCombatIfAble` only costs the controller a choice on turns
    // the board favors holding back, which is a fact about the game state at
    // the time, not the card. `mustBeBlockedIfAble` is a gain on a body big
    // enough to punish a forced block and dead weight on one that is not, and
    // the body itself is already priced by this card's own `statBonus` entry
    // — a flat rate here would double-count a swing this function has no way
    // to size independently. `blockOnlyCreaturesWithKeyword`'s sign is not
    // ambiguous — a narrower set of legal blocks is never a gain — but its
    // size depends on how common the named keyword is in the metagame the
    // deck faces, which is pool context `activationUses`'s docblock already
    // names this file as unable to read; zero rather than an unowned guess is
    // the same conservative call `doubleDamage` makes for a different unknown.
    // `cantBeBlockedBySubtype` is that last argument with the sign flipped and
    // the unknown unchanged: evasion against one creature type is a gain, and
    // how much of a gain depends entirely on how many of that type the opposing
    // deck plays. Juggernaut's own "can't be blocked by Walls" is worth a great
    // deal in a format full of Walls and nothing at all in one with none, and
    // this function cannot see which it is in. All four are unreachable from a
    // generated set today for the same containment reason as the two doublers,
    // so a guess here would price no card this checkout can produce.
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantBeBlockedBySubtype':
      return 0;
    default:
      return assertNever(modification, 'staticModificationValue');
  }
}

/**
 * How many times a deck expects to pay an activation cost.
 *
 * The tap clause is a weight, because "once per turn instead of once per
 * available mana" is an assumption about how many turns the ability gets.
 * `sacrificeSelf` is not: the cost is paid on activation (CR 602.2a) and eats
 * the permanent that carries the ability, so the ability happens once and there
 * is no second time to have an opinion about. It caps the count rather than
 * replacing it, so a config that expects an activation never to be used still
 * gets nothing — `activationUseCount: 0` means no ability is worth anything,
 * and a structural fact about one cost does not override that.
 *
 * A tap clause alongside it changes nothing: a permanent about to be sacrificed
 * does not care whether it also tapped. That is why the sacrifice branch returns
 * before the tap factor is applied rather than capping the tapped product. Under
 * the old guessed `activationUseCount: 2.5` the two spellings agreed, because
 * 2.5 and 2.5 x 0.6 both exceeded the cap and both came out at 1; under the
 * measured 0.608 they do not, and capping the product would have priced
 * "{T}, Sacrifice this" at a quarter of "Sacrifice this". The stated rule was
 * always this one, and it now has to be written to hold.
 *
 * The cap no longer binds on the flagship, and that is a measurement rather than
 * a bug. `Math.min(1, 0.608)` is 0.608, so a one-shot and a non-tapping
 * repeatable ability price identically. The statistic that would separate them
 * is the share of arrivals that activate *at all* — a one-shot gets one use with
 * that probability, a repeatable one gets 0.608 uses spread over a smaller share
 * activating more than once — and the census counts activations and arrivals but
 * not arrivals-that-activated, so nothing here can tell them apart yet.
 *
 * `cost.sacrificeOther` is the third clause, and it is the one that cannot be a
 * weight at all. How many times a deck can eat a Part is a property of the deck
 * the card is played in, not of the card, so it is answered where every other
 * board question in this file is answered — off a `DeckContext`, through the
 * same `subtypeSupply` an `enabledWhile` condition reads. Handed no deck the
 * factor is 1, which is what this function returned before `mtg-ji87` and what
 * every committed deck was built from; handed one it is the chance the deck has
 * drawn `count` sources of the named subtype by the turn a median game ends.
 *
 * The context-free 1 is a deliberate asymmetry with `staticSubtypeReachFactor`
 * and `enabledWhileFactor`, which each name a measured constant for the
 * no-deck case. There is no measured constant for this one yet, and inventing
 * an unmeasured one would move every context-free score in the repository —
 * which is to say every color-pair ranking, on every set, for a number nobody
 * counted. So the first pass keeps today's answer and the second pass, which is
 * the one that builds the deck, gets the real one.
 *
 * The supply factor multiplies rather than caps, which is the opposite of what
 * `sacrificeSelf` does one line up and for the opposite reason: a one-shot's
 * cost is a fact about the ability that bounds it at one use however cheap it
 * is, while a sacrifice-another cost is a fact about the deck that scales the
 * uses the deck was going to get. There is one honest overlap to state:
 * `activationUseCount` was measured over every activated ability that resolved,
 * outlets that could never pay included, so a share of this discount is already
 * inside the 0.608. What the factor buys is not the level but the difference —
 * the same outlet in a deck that mints sixteen Parts and in a deck that mints
 * none, which the pooled average prices identically and which is the whole
 * question `mtg-ji87` asked.
 */
function activationUses(
  cost: ActivatedAbility['cost'],
  weights: CardScoreWeights,
  context: DeckContext | undefined,
): number {
  const payable = sacrificeSupplyFactor(cost.sacrificeOther, context);
  if (cost.sacrificeSelf) return Math.min(1, weights.activationUseCount) * payable;
  const repeatable = cost.tapSelf
    ? weights.activationUseCount * weights.activationTapFactor
    : weights.activationUseCount;
  return repeatable * payable;
}

/**
 * How often a deck can pay a cost that eats a permanent it has to have made.
 *
 * `subtypeSupply` with the cost's own `count` as the `atLeast`, which is the
 * same question `controlsSubtype` asks and the same answer: the chance the deck
 * has drawn that many sources of the subtype by the median turn. Counted per
 * *card*, per that module's stated invariant, so a card minting two Parts is
 * one draw and a cost eating two Parts wants two draws — conservative in the
 * one direction, and the direction this file takes wherever it has to pick.
 *
 * No clause, or no deck, is 1: the ability is as payable as it ever was.
 */
function sacrificeSupplyFactor(
  sacrifice: SacrificeOther | undefined,
  context: DeckContext | undefined,
): number {
  if (sacrifice === undefined || context === undefined) return 1;
  return subtypeSupply(context, sacrifice.subtype, sacrifice.count);
}

/**
 * What paying a `sacrificeOther` cost costs, per use.
 *
 * The permanent eaten is charged for the body's stats and keywords the player
 * gives up, but not for `creaturePremium`. That premium belongs on the mint
 * side: it is this builder's flat credit for adding a creature to a Limited
 * board, after the creature arm has already priced the printed stats, and not
 * another unit of body value. Putting it on both sides made minting a 0/1 Part
 * earn the premium and spending that same Part repay it, so an outlet's effect
 * had to clear the body, its mana and a deck-construction prior before it could
 * be worth anything. The rejected alternative was to charge the premium only
 * when the eaten permanent "could have been kept." `DeckContext` knows a
 * subtype's sources and bodies, and `suppliedBodies` can distinguish a printed
 * permanent from a token while it records them, but neither fact answers that
 * question: a token can attack, block and survive, while a cast creature can be
 * expendable, and whether either should be kept depends on the battlefield and
 * the deck's competing uses, which this evaluator does not model. Provenance
 * would therefore turn an unavailable gameplay judgment into a token-versus-
 * card proxy. Charging the shared body value and leaving the flat premium where
 * it was earned is the smaller defensible rule; a real 3/3 still costs more than a
 * 0/1 because `bodyValue` carries every stat and keyword it gives up.
 *
 * **The cheapest, not the average.** CR 701.17a lets the player choose which
 * permanent they control to sacrifice, and a player paying a cost pays it with
 * the least valuable thing that is legal — a deck holding eight 0/1 Parts and
 * one 4/4 Monster feeds the outlet a Part every time. The bead that asked for
 * this proposed the mean of the subtype's tokens; the mean is what a player who
 * sacrificed at random would pay, and it prices `The Gloom Pit`'s "Sacrifice a
 * Monster" off ninety-nine printed creatures whose average is nothing like the
 * one it would actually eat. Two consequences worth stating: this is the
 * *understating* direction for the cost, so it is the conservative side of a
 * change whose whole point is that outlets have been overpriced; and it ignores
 * which of those bodies has actually been drawn, which is a survival-and-draw
 * model this package has no data for and the same bound `subtypeSupply` states
 * about itself.
 *
 * A deck that produces nothing of the subtype returns zero here and is charged
 * nothing — correctly, because `sacrificeSupplyFactor` has already priced the
 * whole ability at zero uses, and a cost nobody can pay is not a cost.
 */
function sacrificedValue(
  sacrifice: SacrificeOther | undefined,
  weights: CardScoreWeights,
  context: DeckContext | undefined,
): number {
  if (sacrifice === undefined || context === undefined) return 0;
  const bodies = context.subtypeBodies.get(sacrifice.subtype) ?? [];
  if (bodies.length === 0) return 0;
  const cheapest = Math.min(...bodies.map((body) => permanentBodyValue(body, weights)));
  return sacrifice.count * cheapest;
}

/**
 * How much of a static's reach a subtype narrowing leaves it.
 *
 * `staticSubtypeReachFactor` is the answer when nothing knows the deck: a flat
 * guess at what share of the creatures a scope reaches carry any one named
 * subtype. Handed a deck it is the share the deck actually has, which is the
 * quantity the weight was always standing in for — a Merfolk lord in a deck of
 * nine Merfolk reaches nine, and in a deck of none it reaches none, and the flat
 * weight says the same thing about both (`mtg-f0nf`).
 */
function subtypeReachFactor(
  subtype: string | null,
  weights: CardScoreWeights,
  context: DeckContext | undefined,
): number {
  if (subtype === null) return 1;
  return context === undefined ? weights.staticSubtypeReachFactor : subtypeShare(context, subtype);
}

/**
 * How much of the time a conditional static is on.
 *
 * `enabledWhileFactor` is the context-free answer and keeps its meaning: what
 * an unknown deck is assumed to turn on. With a deck in hand the condition is
 * not a guess — `controlsSubtype` counts permanents the deck can produce and
 * `anyCreatureHasCounter` asks for one counter some card in the deck places —
 * so the probability of having drawn what it names replaces the assumption.
 * Both directions matter: a Part-fed static in a deck printing eight Part
 * makers is on more than the weight assumes, and one whose subtype the deck
 * never prints is on never.
 *
 * A condition the deck does not supply keeps the assumption even with a deck in
 * hand: `conditionSupply` answers `null` for one, and an opponent's graveyard
 * is not a thing this list predicts either way.
 */
function enabledWhileFactorFor(
  condition: Condition | null,
  weights: CardScoreWeights,
  context: DeckContext | undefined,
): number {
  if (condition === null) return 1;
  if (context === undefined) return weights.enabledWhileFactor;
  return conditionSupply(context, condition) ?? weights.enabledWhileFactor;
}

/**
 * Value of one printed ability: what it does, times how many permanents it is
 * expected to do it to. Both halves are named weights (`config.ts`), because a
 * lord's worth is a function of the board rather than of the card.
 *
 * `context` is the deck the ability is being priced for, and it is optional
 * because most callers have no deck yet — the color-pair ranking runs before
 * one exists. Where it is given, the two board questions a static asks (its
 * subtype narrowing and its `enabledWhile` clause) are answered by the deck
 * instead of by a flat weight, and so is the one an activation asks: whether
 * the deck can produce the permanent its cost eats, and what that permanent was
 * worth.
 */
export function abilityValue(
  ability: Ability,
  weights: CardScoreWeights,
  context?: DeckContext | undefined,
): number {
  switch (ability.kind) {
    case 'static': {
      const reach =
        weights.staticScopeReach[ability.scope] *
        subtypeReachFactor(ability.subtype, weights, context) *
        enabledWhileFactorFor(ability.enabledWhile ?? null, weights, context);
      return reach * staticModificationValue(ability.modification, weights);
    }
    case 'triggered': {
      // The same effects a spell is scored on, times how often the condition
      // is expected to be met. A trigger is a spell you do not have to cast,
      // and the condition is what it costs instead.
      const effects = ability.effects.reduce((sum, effect) => sum + effectValue(effect, weights, context), 0);
      return weights.triggerFireCount[ability.condition] * effects;
    }
    case 'activated': {
      // An equip ability prints no effect — the attach clause replaces the
      // list (CR 702.6b) — so the sum below is zero for every weapon ever
      // printed, and a builder that stopped here would rate a Moonblade as
      // a blank two-mana artifact and leave it in the pool. What it is worth is
      // what being attached does, priced per host through the same
      // `staticModificationValue` a lord's line goes through: one creature at a
      // time (CR 301.5), for as long as both of them are there.
      if (isAttachingAbility(ability)) {
        // Summed over the clause's modifications, because one host gets all of
        // them at once: a weapon granting a bonus and a keyword is worth what
        // the creature holding it gains, which is both.
        //
        // Each `statBonus` entry is clamped to `equipModificationCeiling`
        // before it joins that sum (`mtg-6zs8`): nothing above bounded a
        // printed statBonus delta at anything tighter than the DSL's own
        // +-99 backstop, so a clause could carry a swing with no realistic
        // body behind it and this arm priced it exactly as printed. The clamp
        // is per entry rather than on the sum on purpose — `grantKeyword`
        // carries no magnitude to run away with (a fixed keyword against a
        // fixed, named weight, already bounded by construction) and
        // `checkEquipAbility` refuses `definePt` in an equip clause outright,
        // so `statBonus` is the one kind this clause can print that is
        // unbounded in the first place. Clamping the sum instead would have
        // let an oversized stat swing swallow a real keyword grant it sits
        // beside — deathtouch stops being worth anything once the stat term
        // alone already saturates the ceiling — which prices the clause for a
        // defect one of its two clauses has, not for what both of them do.
        const ceiling = equipModificationCeiling(weights);
        const modification = ability.attach.modifications.reduce((sum, entry) => {
          const value = staticModificationValue(entry, weights);
          const bounded = entry.kind === 'statBonus' ? Math.max(-ceiling, Math.min(ceiling, value)) : value;
          return sum + bounded;
        }, 0);
        // Only the equip cost, deliberately: what this Equipment cost to
        // *cast* is not this arm's to charge a second time. Every non-creature
        // card kind's own casting cost is already charged once, uniformly, by
        // the `switch` in `evaluateCard` — `spellManaPenaltyPerMana` per mana
        // of the printed cost — and CR 301.5 requires Equipment to be an
        // artifact, so that `artifact` case already runs for every Equipment
        // card before this component is even added to it. Charging it again
        // here, in a second unit, would be the exact failure this bead warns
        // against: two prices for one card's mana, disagreeing. What is
        // uniquely this ability's to charge is the mana spent to *equip*,
        // which nothing else on the card pays for, so that is what stays here.
        const cost = weights.activationCostPerMana * manaValue(ability.cost.mana);
        return Math.max(0, weights.equipHostCount * (modification - cost));
      }
      // The same effects a spell is scored on, times how often the deck expects
      // to pay for them, less what paying costs. A trigger's condition is what
      // it costs instead of mana; an activation's cost is printed, so it is
      // subtracted rather than assumed. Both halves of a printed cost are
      // subtracted: the mana, and the permanent a `sacrificeOther` clause eats.
      const effects = ability.effects.reduce((sum, effect) => sum + effectValue(effect, weights, context), 0);
      const uses = activationUses(ability.cost, weights, context);
      const sacrificed = sacrificedValue(ability.cost.sacrificeOther, weights, context);
      // Floored at zero because nobody is forced to activate: an ability whose
      // cost is worth more than what it does is simply never used, so it is
      // worth nothing to the card rather than worth less than nothing. Without
      // the floor the arithmetic runs backwards — a cheap repeatable ability
      // scores below the same ability with a tap cost, because multiplying a
      // negative by more uses makes it worse.
      return Math.max(
        0,
        uses * (effects - weights.activationCostPerMana * manaValue(ability.cost.mana) - sacrificed),
      );
    }
    default:
      return assertNever(ability, 'abilityValue');
  }
}

/**
 * What answering one creature with a removal spell comes out at.
 *
 * Read off the `destroyPermanent` row rather than restated, and unscoped, so it
 * is the price of the single-target destroy this scorer already prices
 * everywhere else. It is the anchor the Aura combat clauses are a share of: a
 * clause that stops a creature attacking and blocking has taken it off the
 * board in every way this file measures, and the number for that is already
 * here.
 */
function singleCreatureAnswerValue(weights: CardScoreWeights): number {
  const row = weights.effectValue.destroyPermanent;
  return row.base + row.perUnit;
}

/**
 * What one clause of an Aura is worth **to the player who cast it**.
 *
 * That framing is the whole of this function. Every other modification in this
 * file is worth what it does to a permanent its own controller keeps, so value
 * and sign agree; an Aura chooses its host and half the printed ones choose an
 * opponent's, where the caster gains exactly what the host loses. So a `-2/-2`
 * clause is not worth -4 to the deck holding it, it is worth what taking 2/2
 * away from a blocker is worth, and `Math.abs` is what says so.
 *
 * The sign correction covers every clause that moves P/T, not `statBonus`
 * alone. `statBonusPer` is the same clause with a board count in front of it,
 * and its printed cards split the same way -- Armored Ascension helps its host,
 * Quag Sickness is a removal spell -- so scoring the second one at a negative
 * would have ranked a playable common below a blank card.
 *
 * The clamp is `equipModificationCeiling`'s, for its argument verbatim: the DSL
 * bounds a printed `statBonus` at +-99 as a missing-digit backstop, not as a
 * balance number, and a swing no body in this format can carry is not a better
 * card, it is one this scorer has no calibration for. Applying it after the
 * absolute value is what makes the two directions clamp at the same size.
 *
 * `cantBeBlocked` is priced as flying, which understates it - a flier is
 * blocked by fliers and reach, an unblockable creature by nothing - and
 * understating is the safe direction for an anchor that would otherwise be a
 * free-standing number. `grantLandwalk` is that same evasion behind a condition
 * on the defender's lands, which is what `enabledWhileFactor` already means for
 * a static that is off some of the time, so it is reused rather than given a
 * second name for the same idea.
 */
function auraModificationValue(modification: AuraModification, weights: CardScoreWeights): number {
  if (isStaticAuraModification(modification)) {
    const value = staticModificationValue(modification, weights);
    if (modification.kind === 'grantKeyword') return value;
    return Math.min(equipModificationCeiling(weights), Math.abs(value));
  }
  switch (modification.kind) {
    case 'cantAttack':
    case 'cantBlock':
      return weights.auraCombatDenialShare * singleCreatureAnswerValue(weights);
    case 'cantBeBlocked':
      return weights.keywordBase.flying;
    case 'grantLandwalk':
      return weights.keywordBase.flying * weights.enabledWhileFactor;
    case 'doesNotUntap':
      // Priced at the whole anchor rather than at `auraCombatDenialShare`'s
      // fraction of it, because it is strictly more than the two combat clauses
      // together: a creature held tapped cannot attack, cannot block and cannot
      // pay a tap cost either, and it is already tapped when the Aura lands
      // (`tapPermanent`'s one-shot rider is what this file prices as removal
      // under `heldTapFactor`, and this clause is that rider with no expiry).
      // Not `auraControlMultiple`'s two-creature swing, though: the body stays
      // on the board it was on and blocks nothing for you.
      return singleCreatureAnswerValue(weights);
    case 'gainControl':
      // The one clause worth more than answering the creature outright, and
      // `auraControlMultiple` carries the argument for why: the same body
      // leaves the opponent's board and joins yours, so the swing is two
      // creatures wide where `destroyPermanent` is one. Same anchor as the
      // combat clauses above, which is what keeps the strongest clause in this
      // vocabulary priced against a number the rest of the file already uses
      // rather than against a fresh one.
      return weights.auraControlMultiple * singleCreatureAnswerValue(weights);
    default:
      return assertNever(modification, 'auraModificationValue');
  }
}

/**
 * An Aura's whole clause, summed over its modifications.
 *
 * Summed for the reason the equip arm sums: one host gets all of them at once,
 * so an Aura that shrinks a creature and stops it blocking is worth both to the
 * player who cast it.
 *
 * No host count multiplies it. An Equipment carries `equipHostCount` above 1
 * because CR 704.5m leaves it on the battlefield when its creature dies and the
 * deck picks it back up; an Aura goes to the graveyard with its host (CR
 * 704.5m again, from the other side), so its count is one by the rules rather
 * than by an assumption, and the difference between the two card kinds is
 * already carried by that weight being above 1 rather than by a second weight
 * here being below it.
 */
function auraValue(aura: Aura, weights: CardScoreWeights): number {
  return aura.modifications.reduce(
    (sum, modification) => sum + auraModificationValue(modification, weights),
    0,
  );
}

/**
 * How many times a deck can use one loyalty ability.
 *
 * A plus or a zero pays for itself, so the only bound on it is how long the
 * walker lives. A minus is bought out of loyalty the walker already has, and
 * what it has to spend here is its printed starting loyalty: this evaluator has
 * no turn model, so it does not get to assume the plus abilities were used
 * first to grow a budget the minus then spends. That assumption is what an
 * ultimate needs, and the consequence is stated rather than hidden - an
 * ultimate costing more than the walker starts with is priced at nothing. It is
 * the conservative direction, it is close to true in Limited, and a walker
 * whose ultimate is reachable off the printed loyalty is priced for it.
 */
function loyaltyAbilityUses(
  ability: LoyaltyAbility,
  startingLoyalty: number,
  weights: CardScoreWeights,
): number {
  if (ability.loyaltyCost >= 0) return weights.planeswalkerActivations;
  return Math.min(weights.planeswalkerActivations, Math.floor(startingLoyalty / -ability.loyaltyCost));
}

/**
 * A planeswalker's printed abilities, priced as the one thing it does per turn.
 *
 * The correction is `Math.max` where every other card kind sums. CR 606.3 lets
 * a player activate one loyalty ability of a planeswalker per turn, so three
 * printed abilities are three things the walker does *instead of* each other,
 * and the sum prices a card for a turn it never has. Summed through
 * `activationUseCount` - a loyalty ability pays no mana, so nothing in the
 * activation arm subtracted anything from it - a four-mana walker came out
 * above every bomb in a 261-card set, which is how this was found.
 *
 * The best line rather than a blend, on `bestModeValue`'s argument for a modal
 * spell: the deck chooses knowing the board, so the ability it actually uses is
 * never worse than its best available one.
 */
function loyaltyAbilitiesValue(
  card: PlaneswalkerCard,
  weights: CardScoreWeights,
  context?: DeckContext | undefined,
): number {
  return card.abilities.reduce((best, ability) => {
    if (!isLoyaltyAbility(ability)) return best;
    const effects = ability.effects.reduce((sum, effect) => sum + effectValue(effect, weights, context), 0);
    return Math.max(best, loyaltyAbilityUses(ability, card.startingLoyalty, weights) * effects);
  }, 0);
}

/**
 * The discount an effect takes for naming a narrower space than its target kind
 * allows, whichever of the two fields narrows it (`TargetRestriction` and
 * `TargetFilter`, `packages/dsl/src/targets.ts`).
 *
 * One multiplier over the whole effect rather than over the magnitude alone,
 * because a narrowing is a condition on the cast and not on the size of what
 * happens: a destroy that finds no legal target does not destroy less, it does
 * nothing. So the row's `base` is discounted with its `perUnit` arm.
 *
 * Effects with no `target` field and targets narrowed by neither field both
 * return 1, which is every card in the four sets committed beside The Hidden
 * Kingdom. `restrictedTargetFactor` states how large the discount is and what
 * it was measured against.
 *
 * ## Once per target, not once per clause
 *
 * `filter` was read here from `mtg-xiis`, which measured the hole: "destroy
 * target attacking creature" priced at 3.000, exactly what "destroy target
 * creature" prices at, so a strictly weaker card was worth what the stronger
 * one is and no set tuned against this evaluator would ever print the
 * conditional version. `combat` is not the only member that was free - "exile
 * target planeswalker" is `targetPermanent` plus a `cardTypes` filter, and it
 * was priced as though it exiled any permanent at all.
 *
 * A target that carries both fields still takes the discount once. Stacking two
 * flat guesses multiplies the guessing rather than the evidence:
 * `restrictedTargetFactor` is one number for seven restriction kinds precisely
 * because how much space a bound removes is on the card rather than in this
 * file, and squaring it would price "exile target attacking or blocking
 * creature with power 3 or greater" at a quarter of unconditional exile, below
 * a vanilla two-drop, which nobody who has drafted the card would agree with.
 * The clause that fires first is the one this file can measure at all. What
 * this seam still cannot say is *which* narrowing is narrower; the day a set
 * prints enough of them to fit a table against, the table replaces the number
 * here rather than beside it.
 *
 * An empty filter object is not a narrowing. `validateCard` refuses one outright
 * ("a filter that states no constraint is 'no filter' written the long way"),
 * so a validated card cannot carry one, but `evaluateCard` takes a parsed card
 * and parsing is the weaker gate - so the empty case is read rather than
 * assumed away.
 *
 * ## The second member the flat weight prices wrong
 *
 * `colors` and `excludeColors` are the two `TargetFilter` fields
 * `colorFilterFactor` reads instead of the flat number, and `mtg-re3i`
 * measured why: Claimed by the Depths ("destroy target nonblack creature", the
 * printed Doom Blade) priced at 1.7 against Held in Stasis's 3.0 under the flat
 * 0.5, so the builder dropped the printed comparable for a strictly weaker card
 * in three of ten pair decks and one, WB, fell through the format's 40% floor
 * over 10,035 seeded games. `combat` and `maxPower` have no closed form - how
 * much of the board is attacking is a fact about the game state, not the card -
 * which is `restrictedTargetFactor`'s own argument for staying flat. A color
 * is not that: Magic prints five of them by construction, so "every color but
 * one" is four fifths of the pie whichever pool ships, the way `tolledSpellFactor`
 * reads a mana off the printed ladder rather than fitting one pool's numbers.
 * the flagship set's own creature census (208 creatures, 40 of them black)
 * lands at 19.2%, within two points of the 20% the five-color pie predicts.
 *
 * Only when a color field is the *sole* narrowing on the target: a restriction
 * or a second filter field is real evidence the flat weight still has nothing
 * better to read, and stacking a second factor on top would be the squaring
 * this file's own "once per target" rule refuses one paragraph up. No
 * committed card combines `excludeColors` with a second field, so that branch
 * has no card to be wrong about yet.
 */
function colorFilterFactor(filter: TargetFilter): number | undefined {
  if (filter.excludeColors !== undefined) {
    return (COLORS.length - filter.excludeColors.length) / COLORS.length;
  }
  if (filter.colors !== undefined) {
    return filter.colors.length / COLORS.length;
  }
  return undefined;
}

function targetNarrowingFactor(
  effect: Effect,
  weights: CardScoreWeights,
  context?: DeckContext | undefined,
): number {
  if (!('target' in effect)) return 1;
  const { restriction, filter } = effect.target;
  const filtered = filter !== undefined && !targetFilterIsEmpty(filter);
  if (restriction === undefined && !filtered) return 1;
  // The one restriction a deck answers for itself. Every other member names a
  // characteristic the deck does not put there — a power, a tapped state, a
  // printed keyword, and on a creature that is usually the opponent's — so the
  // flat weight stays the honest answer for them.
  if (context !== undefined && restriction?.kind === 'withCounter') {
    return counterSupply(context, restriction.counter);
  }
  // A color field narrowing the target alone has a closed-form answer the flat
  // weight does not: see `colorFilterFactor` above. "Alone" is derived from the
  // filter in hand rather than from a list of the other fields, because a list
  // of the other fields is a copy of `TargetFilter` that nothing keeps honest:
  // the day a seventh field lands, a card carrying it beside a color would take
  // the color's factor and the second narrowing would price at nothing.
  if (restriction === undefined && filter !== undefined) {
    const stated = Object.keys(filter).filter((field) => filter[field as keyof TargetFilter] !== undefined);
    if (stated.length === 1) {
      const factor = colorFilterFactor(filter);
      if (factor !== undefined) return factor;
    }
  }
  return weights.restrictedTargetFactor;
}

/**
 * The discount a spell takes for printing CR 118.8's toll clause, or 1.
 *
 * Read off `card.unless` and nothing else, which is all there is to read: the
 * clause is refused on anything that is not a spell, alongside `modes` and
 * `may`, and on a spell printing more than one effect (`@mtg/dsl`'s
 * `unless.ts`), so a card carrying one carries exactly one effect and the
 * factor has exactly one price to scale.
 *
 * The toll's own size is deliberately not read. `tolledSpellFactor` in
 * `config.ts` carries that argument, the store ladder it is derived from, and
 * why the seam that can weigh a price is the simulator rather than this one.
 */
function tolledSpellFactor(card: Card, weights: CardScoreWeights): number {
  return card.unless === undefined ? 1 : weights.tolledSpellFactor;
}

function effectValue(effect: Effect, weights: CardScoreWeights, context?: DeckContext | undefined): number {
  return (
    (weights.effectValue[effect.kind].base +
      weights.effectValue[effect.kind].perUnit * effectMagnitude(effect, weights)) *
    targetNarrowingFactor(effect, weights, context)
  );
}

/** One mode's own effect list, priced the same way a fixed effect list is. */
function modeEffectsValue(
  effects: readonly Effect[],
  weights: CardScoreWeights,
  context?: DeckContext | undefined,
): number {
  return effects.reduce((sum, effect) => sum + effectValue(effect, weights, context), 0);
}

/**
 * A modal spell resolves exactly one of its modes (CR 700.2), never all of
 * them, so pricing it by the sum of every mode would price a card for effects
 * it can never stack in one cast. The caster chooses, and chooses knowing the
 * board, so the mode actually picked is never worse than the deck's best
 * available line — the best-mode value is the same upper bound the format's
 * top-end reachability discount elsewhere prices *down from*, not a guess at
 * which mode a game happens to need.
 */
function bestModeValue(modes: Modes, weights: CardScoreWeights, context?: DeckContext | undefined): number {
  return Math.max(...modes.map((mode) => modeEffectsValue(mode.effects, weights, context)));
}

/** True when an effect can be pointed at an opposing creature. */
function hitsCreatures(effect: Effect): boolean {
  if (!('target' in effect)) return false;
  return effect.target.kind === 'anyTarget' || effect.target.kind === 'targetCreature';
}

/**
 * True when an effect reaches a group of creatures rather than naming one.
 *
 * The sweeper's half of `hitsCreatures`, and it is a separate question for the
 * reason the scoped exile row below records: a sweeper names a *player* and no
 * creature at all (CR 115.1), so every test written against the target kind
 * reads it as touching nothing. Whether the player named is the opponent is not
 * asked, because the caster picks — `targetPlayer` on a one-sided wrath is a
 * removal spell aimed wherever the board rewards.
 */
function sweepsCreatures(effect: Effect): boolean {
  return 'scope' in effect && effect.scope === 'creaturesThatPlayerControls';
}

function isRemovalEffect(effect: Effect, weights: CardScoreWeights, sourcePower: number): boolean {
  // A fight answers a creature when the body it is printed on can kill one, and
  // that is the same question the damage arm below asks about a burn spell's
  // number: it clears `removalDamageFloor` or it does not. The vocabulary aims
  // it for us — `targetCreatureYouDontControl` is the only target a fight can
  // take — so there is no `hitsCreatures` call here, which is the one arm in
  // this function that does not need one.
  //
  // `sourcePower` is the printed power rather than a derived one, for the
  // reason every number in this evaluator is printed: this runs over a card in
  // a pool, and there is no board to derive anything from.
  if (effect.kind === 'fight') return sourcePower >= weights.removalDamageFloor;
  if (effect.kind === 'destroyPermanent') return sweepsCreatures(effect) || hitsCreatures(effect);
  // Exile is removal, and this row was missing rather than decided against: the
  // evaluator already prices `exileTarget` at `destroyPermanent`'s number
  // (`DEFAULT_EFFECT_VALUE` above), so a set whose white removal is written as
  // exile read back as a set with no white answers at all. Unscoped, it answers
  // the creature it names; scoped over a player's creatures, it answers the
  // group and names no creature, which is why that arm is asked separately.
  if (effect.kind === 'exileTarget') {
    return sweepsCreatures(effect) || hitsCreatures(effect);
  }
  // A held tap is an answer; an unheld one is not. `doesNotUntap` is the whole
  // difference between Claustrophobia and buying one attack, and the evaluator
  // already knew that about the *price* — `EFFECT_PRICING.tapPermanent`
  // multiplies the reach by `heldTapFactor`. What it did not know is that a
  // held tap is removal, which is a different question with a different
  // consumer: price feeds a pick order, this feeds `removalCount` and every
  // "does this deck hold answers" test built on it. So the eight blue cards
  // whose whole job is locking a creature down read as answering nothing, and
  // the color they belong to read as a color with no removal.
  //
  // Measured over the 400 seeds of `mtg-4wpx`, on an unchanged card pool: blue
  // reached 34 of 400 built decks with this arm absent and 67 with it present.
  // That gap is the whole residual after the three Auras landed, which is what
  // makes this the binding constraint rather than the pool.
  //
  // Gated on aim for the reason every arm above is: a held tap on a land is a
  // real effect and is not creature removal.
  if (effect.kind === 'tapPermanent') {
    return effect.doesNotUntap === true && (sweepsCreatures(effect) || hitsCreatures(effect));
  }
  if (effect.kind === 'dealDamage')
    return (
      (sweepsCreatures(effect) || hitsCreatures(effect)) &&
      amountOrAssume(effect.amount, weights.computedAmountAssumption) >= weights.removalDamageFloor
    );
  // A shrink is removal on the same terms the damage arm is removal:
  // conditional on toughness, so it counts once the toughness it takes away
  // reaches the same floor a burn spell has to reach (CR 704.5g state-based
  // death at toughness <= 0). This arm used to require `scope ===
  // 'creaturesThatPlayerControls'`, which read an unscoped shrink as answering
  // nothing on its own — but a single "target creature gets -4/-4" answers the
  // one creature it targets exactly as a single-target `destroyPermanent`
  // does, and reading it as a non-answer is what left ten flagship set black
  // cards scored as penalties and the whole color reading as unplayable.
  // `hitsCreatures`/`sweepsCreatures` are the same pair of questions the
  // `dealDamage` arm above asks for the same reason.
  if (effect.kind === 'putCounters') {
    const shrink = -counterStatBonus(effect.counter).toughness;
    return (
      (sweepsCreatures(effect) || hitsCreatures(effect)) &&
      shrink > 0 &&
      amountOrAssume(effect.count, weights.computedAmountAssumption) * shrink >= weights.removalDamageFloor
    );
  }
  // A negative `pumpUntilEndOfTurn` is the temporary half of the same shape:
  // it shrinks rather than destroys, and it is removal exactly when the
  // toughness it takes away clears the floor a burn spell has to clear. It had
  // no arm at all before this fix, so "target creature gets -2/-2" was priced
  // as a buff effect that happened to subtract, never counted as an answer.
  if (effect.kind === 'pumpUntilEndOfTurn') {
    const shrink = -amountOrAssume(effect.toughness, weights.computedAmountAssumption);
    return (sweepsCreatures(effect) || hitsCreatures(effect)) && shrink >= weights.removalDamageFloor;
  }
  // A tuck is removal for `exileTarget`'s reason stated one more time: the
  // permanent leaves the battlefield, `EFFECT_PRICING.putOnLibrary` already
  // prices it at `destroyPermanent`'s number, and a row priced as an answer
  // that this function reads as a non-answer is exactly the split that made a
  // set's exile-based removal read as no removal at all. Gated on aim like
  // every arm above: a tuck aimed at an artifact is a real effect and is not
  // creature removal. No `sweepsCreatures`: the effect carries no scope.
  if (effect.kind === 'putOnLibrary') return hitsCreatures(effect);
  return false;
}

/**
 * An Aura that answers a creature rather than arming one.
 *
 * Four shapes, and all of them are already this file's rules read onto a
 * clause that carries no effect. A clause that takes control of the creature
 * has answered it and then some, which is the claim `auraControlMultiple`
 * prices. A creature that can neither attack nor block is answered, which is
 * the same claim `auraCombatDenialShare` prices; one half alone is not, because
 * a creature that cannot attack still trades with an attacker and one that
 * cannot block still kills you. And a clause that takes toughness away is
 * removal once it takes away as much as a burn spell has to deal, which is
 * `removalDamageFloor` doing here exactly what it does for the gloom sweeper
 * above.
 *
 * It matters beyond the premium: the builder counts removal when it decides
 * whether a deck has answers, so a Limited deck holding four Pacifisms and
 * reading itself as having none is the failure this arm exists to stop.
 */
function isRemovalAura(aura: Aura, weights: CardScoreWeights): boolean {
  const carries = (kind: AuraModification['kind']): boolean =>
    aura.modifications.some((modification) => modification.kind === kind);
  // Taking the creature is the completest answer this vocabulary has: it does
  // not need a second clause beside it the way the combat halves do, because
  // the creature is gone from the board it was threatening in every sense the
  // builder measures. It reads as removal on its own for that reason.
  if (carries('gainControl')) return true;
  // Holding the creature tapped is the other clause that needs no second half:
  // it takes both combat halves and every tap cost at once, which is why
  // Claustrophobia is a removal spell in a Limited deck and half a Pacifism is
  // not.
  if (carries('doesNotUntap')) return true;
  if (carries('cantAttack') && carries('cantBlock')) return true;
  return aura.modifications.some((modification) => {
    if (modification.kind === 'statBonus') return -modification.toughness >= weights.removalDamageFloor;
    // A rate over the board is the same clause with a count in front of it, and
    // the count is the one this file already names for a quantity it cannot
    // compute. Quag Sickness is the printed card: read without the count it is
    // -1/-1, which clears no floor, and the deck holding four of them counted
    // zero answers.
    if (modification.kind === 'statBonusPer') {
      return -modification.toughness * weights.computedAmountAssumption >= weights.removalDamageFloor;
    }
    return false;
  });
}

/**
 * Removal test: unconditional destruction, or damage at or above the configured
 * floor, aimed somewhere a creature can be.
 *
 * Activated and triggered abilities both count; a static does not, because it
 * modifies its scope rather than answering a creature. An activation aims —
 * "{2}, {T}: Destroy target creature" is removal by every measure the
 * deck-builder uses, and a builder that scored it as a vanilla artifact would
 * leave a Limited deck with none.
 *
 * The trigger half arrived with `mtg-bc2.132.6`. Until it landed a trigger
 * could not choose a target at all, so `destroyPermanent` inside one had
 * nowhere to point and the test was about aiming rather than about the word.
 * Now "when this enters the battlefield, destroy target creature" is a card the
 * kernel runs, and it is the removal spell of Limited: counting it as a vanilla
 * body would build a deck that thinks it has no answers while holding four.
 * The trigger is unconditional in the only sense this test cares about — a
 * board where it fires is a board where it aims — so the timing difference
 * against an activation belongs in the weights, not here.
 */
export function isRemovalCard(card: Card, weights: CardScoreWeights): boolean {
  return removalPremiumFor(card, weights) > 0;
}

/**
 * The premium this card earns for answering a creature, discounted by what it
 * costs to reach the answer.
 *
 * Split out from `isRemovalCard` rather than folded into it because the two
 * questions have different right answers. A deck asks "do I hold an answer",
 * which is a boolean and which a tap ability satisfies; a pick order asks "how
 * much is this answer worth against the body I would take instead", which a tap
 * ability satisfies by half. `isRemovalCard` is defined in terms of this
 * function so the two can never disagree about what counts.
 *
 * The order of the arms is the order of how cheaply the answer is reached, and
 * the first match wins: a card whose spell effects answer a creature is not
 * demoted because it also carries an activated ability that does.
 */
export function removalPremiumFor(card: Card, weights: CardScoreWeights): number {
  // What a fight on this card would fight with; zero for every other card kind,
  // which is the right answer rather than a stand-in — a fight can only be
  // printed on a creature's own enters trigger.
  const sourcePower = card.kind === 'creature' ? card.power : 0;
  if (card.effects.some((effect) => isRemovalEffect(effect, weights, sourcePower)))
    return weights.removalPremium;
  if (isAuraCard(card) && isRemovalAura(card.aura, weights)) return weights.removalPremium;
  // A modal spell is removal if *any* mode is: the caster picks it precisely
  // when a board has a creature worth answering, the same reason a
  // conditional trigger below counts on the strength of its aim rather than
  // its certainty.
  if (
    (card.modes ?? []).some((mode) =>
      mode.effects.some((effect) => isRemovalEffect(effect, weights, sourcePower)),
    )
  ) {
    return weights.removalPremium;
  }
  const answering = card.abilities.filter(
    (ability) =>
      ability.kind !== 'static' &&
      ability.effects.some((effect) => isRemovalEffect(effect, weights, sourcePower)),
  );
  if (answering.length === 0) return 0;
  // A trigger answers on the turn the card is cast and pays nothing beyond the
  // card; an activation waits a turn, taps, and pays mana every time. So a card
  // that reaches removal both ways is priced at the cheaper reach.
  const triggered = answering.some((ability) => ability.kind !== 'activated');
  return triggered ? weights.removalPremium : weights.removalPremium * weights.removalPremiumActivatedScale;
}

/**
 * Format assumptions `DEFAULT_TOP_END_REACHABILITY` is derived from. Restated
 * here rather than imported: `config.ts` already imports `DEFAULT_EFFECT_VALUE`
 * from this file, so an import the other way would be a cycle. `evaluate.test.ts`
 * pins this table against a value computed from
 * `DEFAULT_DECK_BUILD_CONFIG.deckSize`/`landCount` and
 * `DEFAULT_MANA_BASE_CONFIG.openingHandSize`/`onThePlay` so a drift between
 * the two is a test failure rather than a silent disagreement.
 */
const TOP_END_DECK_SIZE = 40;
const TOP_END_LAND_COUNT = 17;
const TOP_END_OPENING_HAND = 7;
const TOP_END_ROUNDS_MEASURED = 7;

/**
 * How many mana values past `formatMedianRounds` `DEFAULT_TOP_END_REACHABILITY`
 * covers before its last entry is reused for anything further out. Eight is
 * already generous: at this land count the ninth entry and beyond round to
 * zero, so nothing is lost by clamping there.
 */
const TOP_END_OVERRUN_ENTRIES = 8;

/**
 * Default for `CardScoreWeights.topEndReachability`: the probability of
 * having drawn at least `formatMedianRounds + overrun` lands by the turn a
 * median game ends, on the play, indexed by `overrun - 1`.
 *
 * CR 305.2a limits a player to one land drop a turn absent another effect, so
 * a card whose mana value exceeds the number of turns a typical game lasts is
 * not expensive the way a five-drop is expensive — most games never reach the
 * turn it would be cast on. `evaluateCard`'s other mana-value terms
 * (`creatureStatBaselinePerMana`, `spellManaPenaltyPerMana`) are linear and
 * uncapped, which is the right shape for every mana value the curve actually
 * targets (`DEFAULT_TARGET_CURVE` tops out at MV 6+, inside
 * `formatMedianRounds`) and the wrong one past it: a flat penalty per point of
 * cost never asks how much of the game that cost demands. This table is that
 * question, asked only where the linear terms stop answering it.
 *
 * Reuses `hypergeometricAtLeast`, the same draw-probability machinery
 * `mana-base.ts`'s `castability` already prices colored sources with, over
 * this format's own numbers (40-card deck, 17 lands, 7-card opening hand, on
 * the play). It answers "how many lands has a player seen by the last turn a
 * median game reaches," not "how many they could have played" — the one-land-
 * a-turn cap makes the true number lower still — so this is a deliberately
 * generous upper bound on reachability, not a precise one.
 */
export const DEFAULT_TOP_END_REACHABILITY: readonly number[] = (() => {
  const draws = TOP_END_OPENING_HAND + Math.max(0, TOP_END_ROUNDS_MEASURED - 1); // on the play
  const table: number[] = [];
  for (let overrun = 1; overrun <= TOP_END_OVERRUN_ENTRIES; overrun++) {
    const landsNeeded = TOP_END_ROUNDS_MEASURED + overrun;
    table.push(hypergeometricAtLeast(landsNeeded, TOP_END_LAND_COUNT, draws, TOP_END_DECK_SIZE));
  }
  return table;
})();

/**
 * Reachability multiplier for a card's mana value: 1 at or below
 * `formatMedianRounds`, `topEndReachability` beyond it.
 */
function topEndReachability(cardMV: number, weights: CardScoreWeights): number {
  const overrun = cardMV - weights.formatMedianRounds;
  if (overrun <= 0) return 1;
  const index = Math.min(overrun - 1, weights.topEndReachability.length - 1);
  return weights.topEndReachability[index] ?? 1;
}

/**
 * The reachability discount `evaluateCard` applies to a card of this mana
 * value, exported so a caller pricing a card's effect on *other* cards in a
 * deck can discount it the same way this file discounts the card's own score.
 */
export function reachabilityOf(card: Card, weights: CardScoreWeights): number {
  return topEndReachability(cardManaValue(card), weights);
}

function pushIfNonZero(components: ScoreComponent[], name: string, value: number): void {
  if (value !== 0) components.push({ name, value });
}

/**
 * Scores one card. Lands score 0: the mana base is built separately.
 *
 * `context` is the deck this card is being scored *for*, and omitting it is the
 * shipped behavior verbatim: every price below is then a pure function of
 * (card, weights), which is what the color-pair ranking needs, because no deck
 * exists at the moment the colors are chosen. Passing one answers the three
 * board questions this file otherwise settles with a flat weight — a static's
 * subtype narrowing, its `enabledWhile` clause, and a `withCounter` target
 * restriction — from the deck's own contents. The function stays pure: it is
 * now a pure function of three arguments rather than of two.
 *
 * The last step discounts a card whose mana value exceeds
 * `weights.formatMedianRounds` by `topEndReachability`: everything above is
 * priced as printed, on the argument that a card the format's typical game
 * can actually reach should be judged by what it does, not by a guess about
 * how often it does it.
 */
export function evaluateCard(
  card: Card,
  weights: CardScoreWeights,
  context?: DeckContext | undefined,
): CardEvaluation {
  const manaValue = cardManaValue(card);
  const components: ScoreComponent[] = [];
  const removalPremium = removalPremiumFor(card, weights);
  const removal = removalPremium > 0;

  switch (card.kind) {
    case 'creature': {
      const stats = statValue(card.power, card.toughness, weights);
      const baseline = weights.creatureStatBaselinePerMana * manaValue;
      pushIfNonZero(components, 'statSurplus', stats - baseline);
      pushIfNonZero(components, 'keywords', keywordValue(card.keywords, card.power, weights));
      // The body the survival-shaped abilities keep alive is `stats`, not
      // `stats - baseline`: what an opponent has to get through is the printed
      // 5/5, and how fair a 5/5 was for its mana is a different question that
      // `statSurplus` one line up already answers.
      pushIfNonZero(
        components,
        'keywordAbilities',
        keywordAbilityValue(card.keywordAbilities ?? [], card.power, stats, weights),
      );
      pushIfNonZero(components, 'creaturePremium', weights.creaturePremium);
      break;
    }
    case 'instant':
    case 'sorcery': {
      pushIfNonZero(components, 'manaPenalty', -weights.spellManaPenaltyPerMana * manaValue);
      break;
    }
    case 'enchantment': {
      pushIfNonZero(components, 'manaPenalty', -weights.spellManaPenaltyPerMana * manaValue);
      // The one card kind whose text can live outside `effects` and
      // `abilities`, which is why it needs a line of its own here rather than
      // falling through with the sorceries: an Aura's whole clause is
      // `card.aura`, and the two components below read neither.
      if (isAuraCard(card)) pushIfNonZero(components, 'aura', auraValue(card.aura, weights));
      break;
    }
    case 'artifact': {
      pushIfNonZero(components, 'vanillaArtifactBaseline', weights.vanillaArtifactBaseline);
      pushIfNonZero(components, 'manaPenalty', -weights.spellManaPenaltyPerMana * manaValue);
      break;
    }
    case 'planeswalker': {
      pushIfNonZero(components, 'manaPenalty', -weights.spellManaPenaltyPerMana * manaValue);
      // Loyalty priced as toughness, because that is what it is: the opponent
      // takes a walker off the board by attacking through it (CR 306.7), so
      // what it costs them is the same quantity a creature's toughness costs
      // them, at the same weight. It is not a second body - a walker blocks
      // nothing and deals no combat damage - so only the toughness half of
      // `statValue` is read, and the power half is absent rather than zero.
      const loyalty = weights.creatureToughnessWeight * card.startingLoyalty;
      pushIfNonZero(components, 'loyalty', loyalty);
      // A walker is the one noncreature permanent this file has a body for, so
      // it is the one that can price `indestructible` and `hexproof` — the two
      // of the six `typeline.ts` lets off a creature. The share is taken of the
      // same loyalty the line above prices, for the same reason it prices it:
      // that is the quantity an opponent has to spend to answer the permanent.
      // Power is passed as zero because a walker has none, which is also why
      // the four combat-shaped kinds are refused on one before they reach here.
      pushIfNonZero(
        components,
        'keywordAbilities',
        keywordAbilityValue(card.keywordAbilities ?? [], 0, loyalty, weights),
      );
      break;
    }
    case 'land':
      break;
    default:
      return assertNever(card, 'evaluateCard');
  }

  if (!isLand(card)) {
    // The toll scales the printed effect and stops there. It cannot reach
    // `bestModeValue`, because `checkEffects` refuses the clause alongside
    // `modes`, and it does not reach `abilities` below, because the clause is
    // spell-only and a spell prints none. Multiplied here rather than inside
    // `effectValue` so the one card-level gate this file has stays at card
    // level, where a reader looking for what `card.unless` costs will find it.
    const effects =
      (card.modes !== undefined
        ? bestModeValue(card.modes, weights, context)
        : modeEffectsValue(card.effects, weights, context)) * tolledSpellFactor(card, weights);
    pushIfNonZero(components, 'effects', effects);
    const abilities = isPlaneswalker(card)
      ? loyaltyAbilitiesValue(card, weights, context)
      : card.abilities.reduce((sum, ability) => sum + abilityValue(ability, weights, context), 0);
    pushIfNonZero(components, 'abilities', abilities);
    pushIfNonZero(components, 'removalPremium', removalPremium);
  }

  const preReachScore = components.reduce((sum, component) => sum + component.value, 0);
  const reach = topEndReachability(manaValue, weights);
  pushIfNonZero(components, 'topEndUnreachable', preReachScore * (reach - 1));

  const score = components.reduce((sum, component) => sum + component.value, 0);
  return {
    card,
    score,
    components,
    manaValue,
    bucket: curveBucket(manaValue),
    colors: cardColors(card),
    isCreature: isCreature(card),
    isRemoval: removal,
  };
}

/**
 * An evaluation that remembers where in the pool its card came from. The pool
 * position is the tie-break for equal scores, which is what makes every
 * downstream ordering a pure function of the pool.
 */
export interface PoolCard extends CardEvaluation {
  readonly poolIndex: number;
}

/** Scores a whole pool, tagging each card with its pool position. */
export function evaluatePool(pool: readonly Card[], weights: CardScoreWeights): readonly PoolCard[] {
  return pool.map((card, poolIndex) => ({ ...evaluateCard(card, weights), poolIndex }));
}

/** Score descending, then pool position ascending: a total order over pool cards. */
export function comparePoolCards(a: PoolCard, b: PoolCard): number {
  return b.score - a.score || a.poolIndex - b.poolIndex;
}
