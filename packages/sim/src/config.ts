/**
 * Tier-1 bot configuration: every heuristic weight, named and documented.
 *
 * The shape follows the Forge AI decomposition (`docs/research/prior-art-mtg-ai.md`
 * §2.1): per-decision policies over a small set of shared evaluators, with the
 * tuning surface pulled out into a profile object (Forge's `AiProps`) instead of
 * being sprinkled through the code as literals. Nothing in `policies/` reads a
 * bare number — if a decision depends on a magic constant, that constant is a
 * field here with a comment saying what it means.
 *
 * The config is plain data, so it survives `structuredClone` and crosses the
 * worker boundary in a `BotSpec`.
 */
import type { GrantableKeywordAbilityKind, Keyword, TriggerCondition } from '@mtg/dsl';

/** When to spend the turn's land drop. */
export interface LandPolicyConfig {
  /** Always take the land drop while controlling fewer lands than this. */
  readonly saturationLands: number;
  /**
   * Past saturation, keep making land drops only while something in hand costs
   * more than the lands already in play (i.e. we are still climbing our curve).
   */
  readonly keepDroppingForUncastables: boolean;
  /** Extra weight, per missing colored pip, when choosing which land to play. */
  readonly colorNeedWeight: number;
}

/** How spells are valued and when they are cast. */
export interface CastPolicyConfig {
  /** Flat value of resolving a creature, before power/toughness/keywords. */
  readonly creatureBaseValue: number;
  /** Flat value of resolving a noncreature spell, before its effects are scored. */
  readonly spellBaseValue: number;
  readonly powerWeight: number;
  readonly toughnessWeight: number;
  /** Value of each evergreen keyword on a creature. Named per keyword, not a blanket bonus. */
  readonly keywordValue: Readonly<Record<Keyword, number>>;
  /**
   * Value of each keyword *ability* a static may grant
   * (`GRANTABLE_KEYWORD_ABILITY_KINDS`).
   *
   * A table of its own rather than nine more rows in `keywordValue`, because
   * the two are read from different halves of a permanent's characteristics and
   * a config that let an override move `indestructible` by writing it beside
   * `flying` would hide which half it was moving. It prices a *grant* only: a
   * creature that prints indestructible on itself is still valued as a vanilla
   * body by `boardCreatureValue`, which is a hole this bead did not open and
   * did not close.
   */
  readonly grantedKeywordAbilityValue: Readonly<Record<GrantableKeywordAbilityKind, number>>;
  /**
   * How many permanents a static ability is assumed to reach, for a card still
   * in hand.
   *
   * `boardCreatureValue` needs nothing like this — it reads through the kernel's
   * layer system, so a creature a lord is already buffing is valued at its
   * derived stats. This is only for the decision to *cast* the lord, where the
   * board it will land on is knowable but the policy deliberately values cards
   * in hand from the printed card alone (`printedCreatureValue`). Set it to 0
   * for a bot that treats a lord as a vanilla body.
   */
  readonly staticAbilityReach: number;
  /**
   * How large a characteristic-defining P/T (CR 613.4a, e.g. Tarmogoyf) is
   * assumed to be when valuing a card still in hand.
   *
   * `boardCreatureValue` needs nothing like this either, for the same reason
   * `staticAbilityReach`'s docblock gives: once the permanent exists, its CDA
   * reads through the kernel's layer system and is exact. This is only for the
   * decision to *cast* it, where the graveyard it will be counting is a board
   * state the printed card cannot say.
   */
  readonly definePtAssumedCount: number;
  /**
   * What a printed triggered ability is worth to the decision to cast the card,
   * per condition, in the same units a keyword is worth.
   *
   * A flat figure per condition rather than a reading of the effects, because
   * nothing in this policy reads an effect payload: a noncreature spell is
   * worth `spellBaseValue` whatever it does, and a per-condition number is the
   * granularity the rest of the file works at. It exists at all for the reason
   * `staticAbilityReach` does — a bot that scores "Merfolk Tidecaller, 2/2" as a
   * 2/2 bear never plays the mechanic, and a balance run over a set whose
   * mechanic never fires reports healthy numbers for a format nobody played
   * (`mtg-bc2.132`'s risk 3). Set every entry to 0 for a bot that treats a
   * trigger as text it cannot read.
   */
  readonly triggerValue: Readonly<Record<TriggerCondition, number>>;
  /**
   * What a printed activated ability is worth to the decision to cast the card
   * carrying it, before its cost is discounted.
   *
   * Flat, like `triggerValue`, and for the same reason: valuing a card in hand
   * from its printed text is this policy's job, and reading the payload is the
   * activation policy's. It sits above `triggerValue`'s entries because an
   * ability the deck can use every turn is a better line of text than one that
   * fires when the game says so. Set it to 0 for a bot that treats an
   * activated ability as text it cannot read.
   */
  readonly activationValue: number;
  /** Score removed per point of mana in the cost, when valuing the card in hand. */
  readonly activationCostWeight: number;
  /**
   * Reward for using mana. Positive values make the bot prefer plans that spend
   * more of the mana available this turn (the mana-efficiency half of the
   * policy); the plan search is what stops it from casting one four-drop when
   * two two-drops are better.
   */
  readonly manaEfficiencyWeight: number;
  /**
   * Hold instants for the opponent's turn / after blockers, rather than casting
   * them in our own precombat main. Turn it off to get a strictly greedy caster.
   */
  readonly holdInstants: boolean;
  /**
   * Above this many distinct castable cards the exact spend-plan search is
   * replaced by a value-per-mana greedy fill. 2^n subsets, so keep it small —
   * `MAX_EXHAUSTIVE_PLAN_CANDIDATES` caps it whatever this says.
   */
  readonly planMaxCandidates: number;
}

/** How a target tuple for a spell is scored. */
export interface TargetPolicyConfig {
  /** Bonus on top of the creature's value for a target the spell actually kills. */
  readonly killBonus: number;
  /** Value per point of damage dealt to a creature that survives it. */
  readonly damageChipWeight: number;
  /** Value per point of damage aimed at the opponent's face. */
  readonly faceDamageWeight: number;
  /** Bonus for a line that wins the game outright this resolution. */
  readonly lethalBonus: number;
  readonly cardDrawValue: number;
  readonly lifeGainValue: number;
  /** Value of tapping down an opposing creature. */
  readonly tapValue: number;
  /** Bonus, above the creature's value, for bouncing rather than killing. */
  readonly bounceValue: number;
  /** Value per card milled from the opponent. */
  readonly millValue: number;
  /** Value of countering a spell, added to the countered card's own value. */
  readonly counterValue: number;
  /**
   * Penalty applied when a harmful effect is pointed at our own stuff.
   *
   * A sentinel, not a valuation: it is large enough that no tuple aiming our
   * own removal at our own board ever wins a ranking, and it is flat, so it
   * says nothing about which of our permanents was aimed at. Anything that
   * needs to know what losing a *particular* permanent costs has to score the
   * effect from the other seat instead (`answerUnless` in `policies/trigger.ts`
   * is the one that does, and the comment there says why).
   */
  readonly ownGoalPenalty: number;
  readonly pumpPowerWeight: number;
  readonly pumpToughnessWeight: number;
  /**
   * What one mana is worth in board score, when a decision spends mana to keep
   * a permanent — CR 118.8's toll, today the only such decision.
   *
   * Read off this policy's own numbers rather than guessed: a 1/1 scores about
   * 4 here and a real one costs about a mana, a 5/5 scores about 12 and costs
   * about five, so a mana is worth somewhere between two and four points of
   * board. It is deliberately not `activate.manaValueWeight` (0.3), which
   * prices mana that would otherwise sit idle on our own turn; a toll is paid
   * at instant speed out of mana that had other uses.
   */
  readonly tollManaWeight: number;
  /**
   * What one of an Aura's combat restrictions is worth, as a share of answering
   * the enchanted creature outright.
   *
   * The anchor is this policy's own removal arithmetic — `boardCreatureValue`
   * plus `killBonus`, which is what `destroyScore` pays for taking the body off
   * the board — rather than a free-standing number, so a Pacifism and a
   * destroy-target-creature aimed at the same body come out of one scale. Below
   * 1 because the creature is still there: it blocks nothing and attacks into
   * nothing, but it still carries whatever its own printed line does, and a
   * second Aura or a bounce spell gives it back.
   *
   * `@mtg/deckbuild` prices the same clause under the same name against its own
   * `destroyPermanent` row. The share is the same judgment; the number it
   * multiplies is not, and this policy must not reach for that one — a deck
   * evaluator asks how much card this is and a target policy asks which body to
   * point it at.
   */
  readonly auraCombatDenialShare: number;
  /**
   * `grantLandwalk` as a share of unconditional evasion, which is the same
   * discount `@mtg/deckbuild`'s `enabledWhileFactor` applies to a static that is
   * only on some of the time: landwalk is `cantBeBlocked` behind a condition on
   * the defender's lands, and this policy cannot see the defender's future
   * lands any more than that one can.
   */
  readonly auraLandwalkShare: number;
}

/**
 * When paying for a printed activated ability is worth it.
 *
 * The decision is deliberately separate from casting rather than folded into
 * it. An activation is not a card leaving the hand: it is repeatable, it
 * competes with nothing for a slot, and the only thing it spends is mana the
 * cast policy has already declined to use — the greedy bot asks this question
 * after `chooseCast` has said no, so an ability can never take a spell's mana.
 *
 * One thing it *does* compete with, and this is a known limit rather than a
 * modeled one: a tap cost on a creature is mana-free and attack-expensive, and
 * this policy does not know that the creature could have attacked instead. It
 * activates in the precombat window and the attack policy finds the creature
 * tapped. Tuning `minimumValue` upward is the lever until an activation policy
 * that reads the combat step exists.
 */
export interface ActivatePolicyConfig {
  /**
   * Score the chosen targets must reach before the bot pays. It is a floor on
   * *value*, not on the ability: the same ability is worth activating at one
   * target and not at another, which is what `scoreEffectTargets` measures.
   */
  readonly minimumValue: number;
  /** Score removed per point of mana the activation costs. */
  readonly manaValueWeight: number;
  /**
   * What an attach clause is worth on a host the defending board has no legal
   * block for, as a multiple of what the clause says.
   *
   * This is the evasion half of "what a creature is worth carrying". A +2/+0 is
   * two points of power on every host on every scale the printed modification
   * has, so the bot armed whichever creature the kernel enumerated first — and
   * enumeration is battlefield order, which is arrival order, which is nothing.
   * Above 1 because a power grant on a creature nobody can block is damage, and
   * on one they can block it is a bigger creature in a bigger trade
   * (`mtg-oc5a`).
   */
  readonly hostUnblockedMultiplier: number;
  /**
   * The same multiple for a blockable host that lives through its best blocker:
   * the clause is on a body that comes back next turn.
   */
  readonly hostSurvivesMultiplier: number;
  /**
   * The same multiple for a blockable host that does not: whatever the clause
   * grants, it grants for one combat. Below 1, which is what makes the two
   * above worth stating.
   */
  readonly hostTradesMultiplier: number;
}

/** Attack heuristics: profitability plus race awareness. */
export interface AttackPolicyConfig {
  /**
   * How much value we will lose on the opponent's best block and still swing.
   * 0 = only strictly non-losing attacks; higher = more aggressive.
   */
  readonly acceptableTradeLoss: number;
  /** Value of a point of damage that gets through unblocked. */
  readonly unblockedDamageValue: number;
  /**
   * Race guard. When the opponent's untapped power is at least this multiple of
   * our life total, hold blockers back instead of swinging out.
   */
  readonly defensiveThreatRatio: number;
  /** Vigilance creatures attack even in defensive mode — attacking costs nothing. */
  readonly vigilanceAlwaysAttacks: boolean;
  /**
   * Ignore every other consideration when the swing is lethal. This is what
   * makes the bots finish games instead of grinding to the turn cap.
   */
  readonly alwaysSwingForLethal: boolean;
}

/** Block heuristics: survive, trade up, chump when lethal. */
export interface BlockPolicyConfig {
  /** Minimum exchange value for a voluntary (non-forced) block. */
  readonly minimumBlockValue: number;
  /** Value of each point of damage a block absorbs. */
  readonly absorbDamageWeight: number;
  /** Block even at a total loss when the unblocked damage would be lethal. */
  readonly chumpWhenLethal: boolean;
  /** Extra value required before spending two creatures on one menace attacker. */
  readonly menaceBlockPremium: number;
}

/**
 * Race-aware weights: the global "who kills whom first" term that the attack,
 * block and removal policies read on top of their local profitability
 * arithmetic. `policies/race.ts` turns a position into the two clocks these
 * weights are priced against.
 */
export interface RacePolicyConfig {
  /**
   * Turns of clock advantage required before we play as the aggressor. 0 means
   * "as fast or faster than them"; 1 demands a clear turn of daylight.
   */
  readonly winningMargin: number;
  /**
   * Extra attack-exchange loss accepted while we are winning the race. A won
   * race is closed by damage, so the last few attacks are allowed to be bad
   * trades — this is the number that stops a winning board from grinding.
   */
  readonly racingTradeLoss: number;
  /**
   * Extra block value demanded while we are winning the race. Our creatures are
   * the clock; spending one on a marginal block gives away the tempo we are
   * ahead on.
   */
  readonly racingBlockPremium: number;
  /**
   * Block value forgiven while we are losing the race. Behind on the clock, a
   * trade that would be slightly unprofitable in a vacuum is how we buy the turn
   * that lets us stabilize.
   */
  readonly losingBlockDiscount: number;
  /**
   * Keep holding creatures back even when we are winning the race. Off by
   * default: holding blockers home while ahead on the clock is the single
   * behavior that produced the stalled games this profile exists to fix.
   */
  readonly holdBackWhileWinning: boolean;
  /**
   * Removal value for an opposing creature, scaled by the share of our
   * remaining life its power represents. A 4-power creature against 8 life is
   * worth half of this on top of its body value; against 30 life, an eighth.
   */
  readonly threatWeight: number;
  /** Extra removal value for a creature that is attacking us right now. */
  readonly attackerRemovalBonus: number;
  /**
   * Extra removal value, while we are winning the race, for an opposing
   * creature that is able to block: it is the thing slowing our clock.
   */
  readonly blockerRemovalBonus: number;
}

/**
 * The opening hand (CR 103.4).
 *
 * Two numbers and a ceiling. The band is stated for a full opening hand and
 * `policies/mulligan.ts` scales it to whatever size a keep would actually leave,
 * so a five-card keep is judged as five cards rather than as seven.
 */
export interface MulliganPolicyConfig {
  /** Fewest lands a full opening hand may hold and still be kept. */
  readonly minimumLands: number;
  /** Most lands a full opening hand may hold and still be kept. */
  readonly maximumLands: number;
  /**
   * Mulligans the bot will take before keeping whatever it is holding. The
   * rules allow more; this is where the profile stops.
   */
  readonly maximumMulligans: number;
  /**
   * Floor under the scaled minimum, so a small keep is still judged against a
   * real number rather than against a rounding.
   *
   * 0 leaves the scaling alone, which is what the policy did before this field
   * existed: `Math.round(2 * 5 / 7)` is 1, so a five-card keep passed on one
   * land. Set it to 2 to demand two lands whatever the keep size.
   */
  readonly minimumLandsFloor: number;
  /**
   * Turn by which the hand must be able to cast one of its own spells from its
   * own lands, or 0 to ask nothing of colors at all.
   *
   * This is the term the land band cannot express. `policies/castability.ts`
   * matches the hand's colored pips against the lands the hand actually holds,
   * so two Mountains in a blue-black hand stop counting as two lands. What it is
   * worth, and why the shipped value is 3 rather than 2, is argued in
   * `policies/mulligan.ts` against a census that ran both.
   */
  readonly castableByTurn: number;
}

/** Cleanup-step discard. */
export interface DiscardPolicyConfig {
  /** Keep value of a land while something in hand still costs more than we can pay. */
  readonly landKeepValue: number;
  /** Keep value of a land once available mana already covers the whole hand. */
  readonly surplusLandKeepValue: number;
  /**
   * Keep value lost per point of mana value we cannot yet pay for. Above 1 this
   * makes a stranded bomb the first card pitched, which is the point.
   */
  readonly uncastablePenalty: number;
}

export interface GreedyBotConfig {
  readonly land: LandPolicyConfig;
  readonly cast: CastPolicyConfig;
  readonly target: TargetPolicyConfig;
  readonly activate: ActivatePolicyConfig;
  readonly attack: AttackPolicyConfig;
  readonly block: BlockPolicyConfig;
  readonly discard: DiscardPolicyConfig;
  readonly mulligan: MulliganPolicyConfig;
  /** Cross-cutting: read by the attack, block and removal policies alike. */
  readonly race: RacePolicyConfig;
}

/**
 * Keyword values in "roughly a point of power" units: evasion and reach-into-
 * the-air matter most in a small-creature format, first strike and deathtouch
 * dominate combat maths, vigilance is worth about half a body.
 */
/**
 * Indestructible prices above every row in `DEFAULT_KEYWORD_VALUE` below, and
 * the ordering is the claim rather than the magnitude — no sweep has measured
 * either table, exactly as `DEFAULT_TRIGGER_VALUE`'s docblock says of its own.
 * A creature that cannot be destroyed survives every removal spell in the M11
 * and M13 commons, survives blocking anything, and stops the board from
 * trading; deathtouch at 1.6 is the best of the nine and buys one trade.
 */
export const DEFAULT_GRANTED_KEYWORD_ABILITY_VALUE: Readonly<Record<GrantableKeywordAbilityKind, number>> = {
  indestructible: 2.0,
  doubleStrike: 1.7,
};

export const DEFAULT_KEYWORD_VALUE: Readonly<Record<Keyword, number>> = {
  flying: 1.5,
  vigilance: 0.8,
  haste: 0.6,
  trample: 0.7,
  deathtouch: 1.6,
  lifelink: 1.0,
  menace: 0.9,
  reach: 0.5,
  firstStrike: 1.2,
};

/**
 * An enter trigger is certain and immediate, an attack trigger repeats but only
 * while the creature can attack, and a death trigger arrives late and on the
 * opponent's terms. The order matters more than the magnitudes, and no balance
 * run has measured either yet.
 *
 * Where the magnitudes sit against `DEFAULT_KEYWORD_VALUE`: the best of them,
 * `selfAttacks` at 1.0, ties lifelink, prices above vigilance, menace, trample,
 * haste and reach, and prices under flying, first strike and deathtouch. A
 * printed trigger is worth more than five of the nine evergreen keywords here,
 * not less than all nine. `bot-triggers.test.ts` holds that whole partition
 * rather than a single bound, so moving either table has to be deliberate.
 *
 * The nine conditions `mtg-suy7` added stay under `selfAttacks` deliberately,
 * so it keeps naming the best of the table the way `bot-triggers.test.ts`
 * reads it, and none is measured by a sweep any more than the first six were.
 * Upkeep and end step repeat every turn the source survives and need no
 * combat, so they sit close under `selfAttacks`; the "another permanent /
 * creature enters" and "you cast a spell / an instant or sorcery" pairs are
 * priced narrower-under-broader for the same reason `selfDealsCombatDamage-
 * ToCreature` is priced under `selfAttacks` — a payoff that depends on a
 * second card from the same hand is worth less to a bot deciding what to cast
 * right now than one the source alone can deliver. Blocking is priced under
 * `selfDies`: it needs the opponent to attack into this creature specifically,
 * which a deck can arrange far less often than a death.
 */
export const DEFAULT_TRIGGER_VALUE: Readonly<Record<TriggerCondition, number>> = {
  selfEnters: 0.8,
  selfAttacks: 1.0,
  selfDies: 0.5,
  selfDiesNotSacrificed: 0.4,
  controlledCreatureAttacksAlone: 1.0,
  // Priced with `selfAttacks`: it needs the source to attack or block and then
  // to survive to the damage step, which is strictly more than attacking, but
  // it also fires on defense. No sweep has measured it.
  selfDealsCombatDamageToCreature: 0.9,
  beginningOfYourUpkeep: 0.85,
  beginningOfYourEndStep: 0.85,
  // The same 0.85 rather than a doubled one. This table is what a *cast*
  // decision is worth, and the extra firings this condition buys land on the
  // opponent's turns, which the bot is not choosing between when it decides
  // what to play right now. `DEFAULT_TRIGGER_FIRE_COUNT` in `@mtg/deckbuild` is
  // the table that counts firings, and it does double it.
  beginningOfEndStep: 0.85,
  anotherControlledPermanentEnters: 0.6,
  anotherControlledCreatureEnters: 0.5,
  youCastSpell: 0.55,
  youCastInstantOrSorcery: 0.4,
  // Priced with `selfDealsCombatDamageToCreature`: same event, a player
  // recipient instead of a creature one, and neither has been measured.
  selfDealsCombatDamageToPlayer: 0.9,
  selfBlocks: 0.35,
  // Above `selfBlocks` and under `selfAttacks`, for the reason the deckbuild
  // table gives at the same row: a strictly narrower block, but one that fires
  // on the attacking half of the same event as well, so a deck reaches it from
  // both sides of combat. No sweep has measured it.
  selfBlocksOrIsBlockedByGreaterPower: 0.6,
  youGainLife: 0.45,
  // Above `selfAttacks`, which is this table's ceiling for a single event,
  // because it is the only condition that pays twice from one card: the
  // arrival is guaranteed the moment the spell resolves and every attack
  // afterwards pays again. A bot deciding what to cast right now is choosing
  // the first of those, so the premium over `selfAttacks` is the tail rather
  // than a second full payment. No sweep has measured it.
  selfEntersOrAttacks: 1.3,
  // The M11 artifact cycle, priced under `youCastSpell` and above nothing in
  // particular: it fires on either player's spells, which is strictly more
  // events than `youCastSpell` sees, but each firing pays one life and a bot
  // choosing what to cast right now cannot steer the opponent's half at all.
  // No sweep has measured any of the five.
  aPlayerCastsWhiteSpell: 0.45,
  aPlayerCastsBlueSpell: 0.45,
  aPlayerCastsBlackSpell: 0.45,
  aPlayerCastsRedSpell: 0.45,
  aPlayerCastsGreenSpell: 0.45,
  // Priced under `selfBlocks`: it needs a noncombat damage source the deck may
  // not carry at all, which is a narrower requirement than the source merely
  // being attacked into. Unmeasured.
  opponentDealtNoncombatDamage: 0.3,
  // Priced under `anotherControlledCreatureEnters`, which is the same event
  // with the power clause dropped: strictly fewer arrivals qualify, so it is
  // worth strictly less to a bot with an unbuilt board. Unmeasured.
  anotherControlledCreatureWithPowerThreeOrGreaterEnters: 0.35,
};

/**
 * Race defaults measured against the balance sweep rather than guessed. The two
 * that carry the behavior change are `holdBackWhileWinning: false` and
 * `racingTradeLoss`; the rest shade decisions that were already close.
 */
export const DEFAULT_RACE_CONFIG: RacePolicyConfig = {
  winningMargin: 0,
  racingTradeLoss: 1.5,
  racingBlockPremium: 1.5,
  losingBlockDiscount: 1,
  holdBackWhileWinning: false,
  threatWeight: 3,
  attackerRemovalBonus: 1,
  blockerRemovalBonus: 0.75,
};

export const DEFAULT_GREEDY_CONFIG: GreedyBotConfig = {
  land: {
    saturationLands: 6,
    keepDroppingForUncastables: true,
    colorNeedWeight: 1,
  },
  cast: {
    creatureBaseValue: 2,
    spellBaseValue: 1,
    powerWeight: 1,
    toughnessWeight: 0.8,
    keywordValue: DEFAULT_KEYWORD_VALUE,
    grantedKeywordAbilityValue: DEFAULT_GRANTED_KEYWORD_ABILITY_VALUE,
    staticAbilityReach: 2,
    definePtAssumedCount: 3,
    triggerValue: DEFAULT_TRIGGER_VALUE,
    activationValue: 2.5,
    activationCostWeight: 0.4,
    manaEfficiencyWeight: 0.5,
    holdInstants: true,
    planMaxCandidates: 8,
  },
  target: {
    killBonus: 2,
    damageChipWeight: 0.3,
    faceDamageWeight: 0.9,
    lethalBonus: 1000,
    cardDrawValue: 1.6,
    lifeGainValue: 0.4,
    tapValue: 1.2,
    bounceValue: 1.0,
    millValue: 0.2,
    counterValue: 2.5,
    ownGoalPenalty: 50,
    pumpPowerWeight: 0.9,
    pumpToughnessWeight: 0.6,
    tollManaWeight: 3,
    auraCombatDenialShare: 0.5,
    auraLandwalkShare: 0.6,
  },
  /**
   * The three host multipliers straddle 1 rather than sitting above it, so a
   * weapon on the only creature available is still worth roughly what it says.
   * A clause is worth half again as much on a body nothing can block and three
   * quarters as much on one that will not survive the combat it is bought for,
   * which is the ordering `CreatureEvaluator` in Forge's `ComputerUtil*` layer
   * encodes with an evasion bonus and a survivability term
   * (`docs/research/prior-art-mtg-ai.md` §2.1); the numbers are ours, the shape
   * is that one.
   */
  activate: {
    minimumValue: 0.5,
    manaValueWeight: 0.3,
    hostUnblockedMultiplier: 1.5,
    hostSurvivesMultiplier: 1.15,
    hostTradesMultiplier: 0.75,
  },
  attack: {
    acceptableTradeLoss: 0.5,
    unblockedDamageValue: 1.1,
    defensiveThreatRatio: 1,
    vigilanceAlwaysAttacks: true,
    alwaysSwingForLethal: true,
  },
  block: {
    minimumBlockValue: 0.25,
    absorbDamageWeight: 0.5,
    chumpWhenLethal: true,
    menaceBlockPremium: 1.5,
  },
  discard: {
    landKeepValue: 3,
    surplusLandKeepValue: 0.5,
    uncastablePenalty: 1.5,
  },
  /**
   * 2-5 lands of seven that can cast something by turn 3, and never past a
   * second mulligan.
   *
   * The band is the limited convention and it is also what the deck shape here
   * implies: a 40-card deck with 17 lands draws a seven inside 2-5 about 84% of
   * the time, so this sends back roughly one hand in six rather than reshaping
   * the format. The ceiling is where the arithmetic turns: a mulligan buys a
   * fresh look and costs a card, and by the third one the card is worth more
   * than the look to a bot that cannot read the rest of the hand.
   *
   * `castableByTurn: 3` is the colors half, measured over 13,500 seat-games per
   * arm on the flagship's 253-card build. It takes the mulligan rate from 12.2%
   * to 16.3%, empties the 5.1% of keeps that could cast nothing they held, and
   * moves no color pair's win rate by more than 0.4 points — so the recorded
   * balance baselines need re-measuring, and none of them were touched here.
   * `minimumLandsFloor` stays 0 because raising it is unreachable under a
   * two-mulligan cap; `policies/mulligan.ts` has both arguments in full.
   */
  mulligan: {
    minimumLands: 2,
    maximumLands: 5,
    maximumMulligans: 2,
    minimumLandsFloor: 0,
    castableByTurn: 3,
  },
  race: DEFAULT_RACE_CONFIG,
};

/** Builds a config from the default profile with per-section overrides. */
export function greedyConfig(overrides: DeepPartialConfig = {}): GreedyBotConfig {
  const base = DEFAULT_GREEDY_CONFIG;
  return {
    land: { ...base.land, ...overrides.land },
    cast: {
      ...base.cast,
      ...overrides.cast,
      keywordValue: { ...base.cast.keywordValue, ...overrides.cast?.keywordValue },
      grantedKeywordAbilityValue: {
        ...base.cast.grantedKeywordAbilityValue,
        ...overrides.cast?.grantedKeywordAbilityValue,
      },
    },
    target: { ...base.target, ...overrides.target },
    activate: { ...base.activate, ...overrides.activate },
    attack: { ...base.attack, ...overrides.attack },
    block: { ...base.block, ...overrides.block },
    discard: { ...base.discard, ...overrides.discard },
    mulligan: { ...base.mulligan, ...overrides.mulligan },
    race: { ...base.race, ...overrides.race },
  };
}

export interface DeepPartialConfig {
  readonly land?: Partial<LandPolicyConfig>;
  readonly cast?: Partial<Omit<CastPolicyConfig, 'keywordValue' | 'grantedKeywordAbilityValue'>> & {
    readonly keywordValue?: Partial<Record<Keyword, number>>;
    readonly grantedKeywordAbilityValue?: Partial<Record<GrantableKeywordAbilityKind, number>>;
  };
  readonly target?: Partial<TargetPolicyConfig>;
  readonly activate?: Partial<ActivatePolicyConfig>;
  readonly attack?: Partial<AttackPolicyConfig>;
  readonly block?: Partial<BlockPolicyConfig>;
  readonly discard?: Partial<DiscardPolicyConfig>;
  readonly mulligan?: Partial<MulliganPolicyConfig>;
  readonly race?: Partial<RacePolicyConfig>;
}
