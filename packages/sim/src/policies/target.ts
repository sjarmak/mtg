/**
 * Targeting policy: score one candidate target tuple for one spell.
 *
 * The kernel enumerates target tuples for us (`targetChoicesFor`, folded into
 * the priority decision's cast options), so this policy never has to know what
 * is legal — only what is *good*. Each effect is scored independently against
 * the target chosen for it and the scores are summed, which is what makes
 * multi-effect cards (pump + gain life, counter + draw) come out sensibly.
 */
import type {
  Aura,
  AuraModification,
  Card,
  CountFilter,
  CounterKind,
  Effect,
  EffectScope,
  GrantableKeyword,
  PlayerScope,
  PumpAmount,
  TargetFilter,
  TokenSpec,
} from '@mtg/dsl';
import {
  assertNever,
  counterStatBonus,
  effectsFor,
  isAuraCard,
  isCreatureTokenSpec,
  isLiteralAmount,
} from '@mtg/dsl';
import type { GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import {
  counterCount,
  derivedCharacteristics,
  hasGrantableKeyword,
  hasKeyword,
  objectFilter,
  objectsInEffectScope,
  opponentOf,
  scopedGroup,
  PLAYER_IDS,
  powerOf,
  selectMatching,
  toughnessOf,
  tryObject,
} from '@mtg/kernel';
import type { CastPolicyConfig, RacePolicyConfig, TargetPolicyConfig } from '../config';
import { boardCreatureValue, isLethalDamage, modificationValueOn } from '../evaluate';
import { isAttacking } from './combat';
import type { RaceAssessment } from './race';
import { assessRace } from './race';

interface TargetContext {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly target: TargetPolicyConfig;
  readonly cast: CastPolicyConfig;
  readonly race: RacePolicyConfig;
  readonly assessment: RaceAssessment;
  /** The cast spell's retained X; zero for abilities and fixed-cost spells. */
  readonly chosenX: number;
  /**
   * The body the effect is printed on, when there is one.
   *
   * Only `fight` reads it, and it is the one primitive whose value depends on
   * the source rather than on the target alone: what a fight is worth is the
   * two power values against the two toughness values, and knowing only the
   * target's half answers half the question. `undefined` for a spell, whose
   * stack object is not a creature and has no power to fight with.
   */
  readonly sourceOid: ObjectId | undefined;
}

function isMine(state: GameState, oid: ObjectId, me: PlayerId): boolean {
  const object = tryObject(state, oid);
  return object !== undefined && object.controller === me;
}

/**
 * How much this opposing creature is worth removing *beyond its body*, given
 * what it is doing to the game.
 *
 * The body value alone answers "how good is this creature", which is the wrong
 * question for removal: the right question is "which creature is closest to
 * winning the game for its controller". Three named terms answer it — the share
 * of our remaining life its power represents, whether it is attacking us right
 * now, and whether it is the blocker standing between our own clock and their
 * life total.
 */
function threatValue(context: TargetContext, oid: ObjectId): number {
  const { state, me, race } = context;
  const object = tryObject(state, oid);
  if (object === undefined || object.card.kind !== 'creature') return 0;
  const power = Math.max(0, powerOf(state, oid));
  const life = Math.max(1, state.players[me].life);
  let value = race.threatWeight * Math.min(1, power / life);
  if (isAttacking(state, oid)) value += race.attackerRemovalBonus;
  if (context.assessment.winning && !object.tapped) value += race.blockerRemovalBonus;
  return value;
}

/**
 * What taking this body off the board is worth, before anything about what it
 * is doing to us right now.
 *
 * The anchor every removal-shaped score on this page is built from, and the
 * anchor an Aura's non-body clauses are priced as a share of
 * (`auraCombatDenialShare`). One owner rather than four copies of the same sum:
 * a burn spell that kills, a destroy, a lethal negative pump and an Aura that
 * shrinks a creature to nothing all take exactly one creature off the board,
 * and pricing any of them differently is the drift the shared evaluators exist
 * to prevent.
 */
function bodyRemovalValue(context: TargetContext, oid: ObjectId): number {
  return boardCreatureValue(context.cast, context.state, oid) + context.target.killBonus;
}

/** That, plus what this particular creature is doing to us (`threatValue`). */
function answerValue(context: TargetContext, oid: ObjectId): number {
  return bodyRemovalValue(context, oid) + threatValue(context, oid);
}

function lifeOf(state: GameState, player: PlayerId): number {
  return state.players[player].life;
}

/**
 * `deathtouch` defaults to false because a spell has none — every `dealDamage`
 * caller leaves it alone, so no burn spell's score moves. `fight` passes the
 * fighting body's own, since CR 702.2b is about the source of the damage and
 * a fight's source is a creature that can carry the keyword.
 */
function damageScore(
  context: TargetContext,
  amount: number,
  target: Target | null,
  deathtouch = false,
): number {
  const { state, me, target: weights } = context;
  if (target === null) return 0;
  if (target.kind === 'player') {
    if (target.player === me) return -weights.ownGoalPenalty;
    const lethal = amount >= lifeOf(state, target.player) ? weights.lethalBonus : 0;
    return amount * weights.faceDamageWeight + lethal;
  }
  if (target.kind === 'spell') return 0;
  const mine = isMine(state, target.oid, me);
  if (mine) return -weights.ownGoalPenalty;
  if (isLethalDamage(state, target.oid, amount, deathtouch)) return answerValue(context, target.oid);
  return amount * weights.damageChipWeight;
}

function destroyScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  return answerValue(context, target.oid);
}

/**
 * `destroyScore`'s sign flipped, because a shield is the opposite of removal:
 * this policy wants it aimed at its own board and penalized the same
 * `ownGoalPenalty` for aiming it at the opponent's, which is a body this seat
 * would rather see through combat or a burn spell than protected from one.
 * No `killBonus` and no `threatValue` — those price a body coming *off* the
 * board, and this effect keeps one on it.
 */
function preventDamageScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (!isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  return boardCreatureValue(context.cast, state, target.oid);
}

/**
 * A fight is removal that can answer back, and it is scored as both halves.
 *
 * The outgoing half is `damageScore` with the source's power as the amount, so
 * a fight that kills is priced exactly as a burn spell that kills and one that
 * merely bruises is priced exactly as a burn spell that bruises. Nothing about
 * the second reading is new; the whole point of routing through the existing
 * evaluator is that a 3-power fight and a Shock for 3 do not come out of two
 * different arithmetics.
 *
 * The returning half is what separates a fight from removal: our own body takes
 * the target's power back (CR 701.12a), so when that is lethal the score loses
 * the creature it kills with. That subtraction is why a 2/2's fight aimed at a
 * 5/5 comes out negative and the bot declines it, which is the behavior the
 * printed card has and a plain `destroyScore` arm would not.
 *
 * Deathtouch is read on both bodies, because a fight is the one place in this
 * policy where the source of the damage is a creature and can carry it (CR
 * 702.2b). A deathtouched 1/1 fighting a 6/6 kills it and dies, and both of
 * those facts are in the score.
 *
 * `sourceOid` absent scores zero rather than guessing. A fight only ever prints
 * on a creature's own enters trigger (`checkSourceBodyEffectInTrigger`), so the
 * source is known wherever this can actually be reached.
 */
function fightScore(context: TargetContext, target: Target | null): number {
  const { state, me, sourceOid, target: weights } = context;
  if (target === null || target.kind !== 'permanent' || sourceOid === undefined) return 0;
  if (isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  const dealt = damageScore(
    context,
    Math.max(0, powerOf(state, sourceOid)),
    target,
    hasKeyword(state, sourceOid, 'deathtouch'),
  );
  const struckBack = Math.max(0, powerOf(state, target.oid));
  const lost = isLethalDamage(state, sourceOid, struckBack, hasKeyword(state, target.oid, 'deathtouch'))
    ? boardCreatureValue(context.cast, state, sourceOid)
    : 0;
  return dealt - lost;
}

/**
 * A sweep is worth what it takes, measured rather than assumed, and what it is
 * worth depends on the zone it reaches into.
 *
 * The group comes from the kernel's own `objectsInEffectScope`, so the policy
 * scores exactly the objects the resolution would move. A board sweep prices
 * each member with the same `destroyScore` a single-target removal spell gets,
 * which is also what makes a sweep aimed at a board holding our own creatures
 * come out negative rather than merely small. A hand sweep cannot use that
 * function at all — `boardCreatureValue` and `threatValue` both read a
 * permanent, and a card in a hand is not one — so it is priced as the cards it
 * denies, at the same rate this policy values drawing one.
 */
/**
 * A board sweep is worth the sum of what it does to each body it reaches.
 *
 * The group comes from the kernel's own `objectsInEffectScope`, so the policy
 * scores exactly the objects the resolution would reach; deriving it a second
 * way here would let the bot value a sweep the kernel does not perform. The
 * per-member scorer is passed in because five primitives sweep the battlefield
 * now and each is worth what its *unscoped* form is worth, once per body — a
 * one-sided wrath is N destroys, "tap all creatures target opponent controls"
 * is N taps, and Overrun is N pumps. That is also what makes a sweep aimed at a
 * board holding our own creatures come out negative rather than merely small.
 *
 * Battlefield scopes only, and the call sites are what guarantee it: the four
 * primitives that reach here admit no other scope (`SCOPES_LEGAL_ON`,
 * `@mtg/dsl`), and `scopedExileScore` switches on the zone before delegating.
 * Every scorer this takes reads a permanent, and a card in a hand is not one.
 */
function scopedBoardScore(
  context: TargetContext,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  target: Target | null,
  perMember: (context: TargetContext, member: Target) => number,
): number {
  return scopedGroup(context.state, scope, filter, target, context.me).reduce(
    (sum, oid) => sum + perMember(context, { kind: 'permanent', oid }),
    0,
  );
}

function scopedExileScore(context: TargetContext, scope: EffectScope, target: Target | null): number {
  switch (scope) {
    // The space scopes share this arm rather than an unreachable stub: exile
    // does not admit them (`SCOPES_LEGAL_ON`), and if it ever did, what it
    // would be worth is what a one-sided wrath is worth. A `return 0` here
    // would be a guess about a card that cannot exist; this is the same answer
    // the arm above it gives, which is the honest one.
    case 'creaturesThatPlayerControls':
    case 'allPermanents':
    case 'permanentsYouControl':
    case 'permanentsOpponentsControl':
      return scopedBoardScore(context, scope, undefined, target, destroyScore);
    case 'creatureCardsInPlayerHand': {
      if (target === null || target.kind !== 'player') return 0;
      const group = objectsInEffectScope(context.state, scope, target.player);
      return harmfulPlayerScore(context, target, group.length * context.target.cardDrawValue);
    }
    // The same "the graveyard is a zone nothing here reads" stance
    // `effectScore`'s `destroyPermanent` comment states below: this policy has
    // no term for what a card sitting in a graveyard denies (recursion,
    // flashback, delve), so a graveyard sweep scores as doing nothing rather
    // than as a guess this evaluator cannot check.
    case 'creatureCardsInPlayerGraveyard':
      return 0;
    default:
      return assertNever(scope, 'scopedExileScore');
  }
}

function pumpScore(context: TargetContext, power: number, toughness: number, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  const mine = isMine(state, target.oid, me);
  const object = tryObject(state, target.oid);
  if (object === undefined) return 0;
  // A negative toughness modification is removal in disguise: score it as a kill.
  const wouldDie = toughnessOf(state, target.oid) + toughness - object.damage <= 0;
  if (!mine) {
    if (wouldDie) return answerValue(context, target.oid);
    return -weights.ownGoalPenalty;
  }
  if (wouldDie) return -weights.ownGoalPenalty;
  return power * weights.pumpPowerWeight + toughness * weights.pumpToughnessWeight;
}

/**
 * A layer-7b base P/T set, priced as the board it leaves rather than as a pump.
 *
 * The numbers on the card say nothing on their own: "base 1/1" is removal on a
 * 5/5 and a gift on a 0/1, so this reads the creature it is pointed at and
 * prices the difference. That much it shares with `pumpScore`. What it does not
 * share is that function's verdict on a debuff that does not kill, which is
 * `-ownGoalPenalty` — right for `-1/-1`, wrong here, because a set to base 0
 * takes the whole of a creature's power out of the combat whether or not the
 * body dies. Delegating to `pumpScore` made the bot refuse to cast Diminish at
 * any creature it could not kill, which is every creature the probe deck
 * fields, and the calibration corpus caught it as an unreached card.
 *
 * The delta ignores what applies *after* layer 7b: a +1/+1 counter (7d) and any
 * 7c modifier survive the set, so a 5/5 that is 5/5 because of a counter reads
 * one point low here. Approximate on purpose — re-deriving the layers for a
 * hypothetical record is `characteristics.ts`'s job, and this is a scoring
 * heuristic rather than the board.
 */
function baseSetScore(
  context: TargetContext,
  power: number,
  toughness: number,
  target: Target | null,
): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  const object = tryObject(state, target.oid);
  if (object === undefined) return 0;
  const powerDelta = power - powerOf(state, target.oid);
  const toughnessDelta = toughness - toughnessOf(state, target.oid);
  const wouldDie = toughness - object.damage <= 0;
  if (isMine(state, target.oid, me)) {
    if (wouldDie) return -weights.ownGoalPenalty;
    return powerDelta * weights.pumpPowerWeight + toughnessDelta * weights.pumpToughnessWeight;
  }
  if (wouldDie) return answerValue(context, target.oid);
  // Their creature, still alive, and smaller: worth what the power and
  // toughness taken off it would have been worth added to one of mine. A set
  // that leaves it bigger is the gift, and costs what any own goal costs.
  const gain = -powerDelta * weights.pumpPowerWeight + -toughnessDelta * weights.pumpToughnessWeight;
  return gain > 0 ? gain : -weights.ownGoalPenalty;
}

function playerScore(context: TargetContext, target: Target | null, valueForMe: number): number {
  const { me, target: weights } = context;
  if (target === null || target.kind !== 'player') return valueForMe;
  return target.player === me ? valueForMe : -Math.abs(valueForMe) - weights.ownGoalPenalty;
}

function harmfulPlayerScore(context: TargetContext, target: Target | null, valueAgainstThem: number): number {
  const { me, target: weights } = context;
  if (target === null || target.kind !== 'player') return 0;
  return target.player === opponentOf(me) ? valueAgainstThem : -weights.ownGoalPenalty;
}

/**
 * Which way a player sweep lands, from the scoring seat's side of the table.
 *
 * `+1` when the whole of it falls on this seat, `-1` when the whole of it falls
 * on the opponent, `0` when it falls on both and cancels. That is the entire
 * shape of a differential policy's answer to a sweep: the three arms that read
 * it keep their own arithmetic (a draw is worth `cardDrawValue` a card whoever
 * draws it), and only the sign and the cancellation differ between scopes.
 *
 * Zero for `eachPlayer` is arithmetic rather than a shrug — the same cards come
 * off both libraries and the two terms cancel — and it is what Temple Bell and
 * Howling Banshee have always scored. What makes those cards is that their
 * controller chose the moment, and this policy has no term for tempo.
 *
 * Total over `PLAYER_SCOPES`, which is the point: the day a third scope arrives
 * this stops compiling rather than inheriting an answer nobody checked.
 */
function sweepDirection(scope: PlayerScope): number {
  switch (scope) {
    case 'eachPlayer':
      return 0;
    case 'eachOpponent':
      return -1;
    default:
      return assertNever(scope, 'sweepDirection');
  }
}

function tapScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  const object = tryObject(state, target.oid);
  if (object !== undefined && object.tapped) return 0;
  return weights.tapValue + threatValue(context, target.oid);
}

/**
 * `tapScore` read backwards, and the three sign flips are the whole of it.
 *
 * The permanent has to be the scoring seat's own, so an untap aimed across the
 * table is the own goal a tap aimed at its own board is. The permanent has to
 * be *tapped*, and an untap aimed at one that is not scores zero rather than
 * `tapValue` — `untapObject` no-ops there, so a score above zero would be this
 * policy paying for an event the kernel is about to decline to emit.
 *
 * What it is worth is `tapValue` plus the body, and the body is
 * `boardCreatureValue` rather than `threatValue` because the permanent belongs
 * to the seat doing the scoring: a threat is measured from across the table and
 * there is no table between these two. A land or a Voltaic Key scores the flat
 * `tapValue` alone, which is the honest reading — this policy prices boards in
 * bodies, and the mana an untapped artifact is about to make is spent by a cast
 * this function never sees, exactly as `addMana`'s arm says.
 */
/**
 * A keyword the creature already has is worth nothing, which is `untapScore`'s
 * rule about an untapped permanent and for the identical reason: the layer-6
 * record still gets built, but `hasGrantableKeyword` answered the same before
 * and after, so a score above zero would be this policy paying for a board that
 * did not move.
 *
 * `hasGrantableKeyword` rather than `hasKeyword`, because the field reaches the
 * grantable keyword *abilities* too and those land in the other half of
 * `Characteristics`: asking `hasKeyword` about double strike answers no on a
 * creature that already has it, and the policy would pay twice for one grant.
 *
 * Aimed across the table it is an own goal, with no `wouldDie` escape hatch of
 * the sort `pumpScore` has. A negative pump is removal in disguise; nothing on
 * `GRANTABLE_KEYWORDS` is a drawback, so this one has no second reading.
 *
 * What it is worth to its own side is one point of power, and that is a
 * deliberate flat rate rather than a table. Trample on a 7/7 into a chump
 * blocker wins a game and trample on a 1/1 does nothing, deathtouch is a
 * removal spell on a creature that must be blocked and nothing on one that
 * will not be, and every one of those readings needs the *combat* this policy
 * is scoring a target for and does not yet model. A per-keyword table here
 * would be nine guesses where the vocabulary already declined to make one
 * (`UNPRICED_EFFECT_KINDS`); one honest unit keeps the grant preferred over
 * doing nothing and beaten by anything the policy can actually measure.
 */
function grantKeywordScore(context: TargetContext, keyword: GrantableKeyword, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (!isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  if (tryObject(state, target.oid) === undefined) return 0;
  if (hasGrantableKeyword(state, target.oid, keyword)) return 0;
  return weights.pumpPowerWeight;
}

/**
 * `grantKeywordScore` with the keyword check dropped, because there is nothing
 * to check: "can't be blocked this turn" is a turn-scoped record rather than a
 * keyword, so it cannot already be on the creature and there is no
 * already-has-it zero to return. Aimed across the table it is the same own goal
 * for the same reason — no reading of unblockable helps the seat being attacked.
 *
 * One flat `pumpPowerWeight`, which is `grantKeywordScore`'s deliberate flat
 * rate and its argument verbatim: what evasion is worth is the combat it wins,
 * this policy scores a target rather than a combat, and a table of guesses here
 * would be worse than one honest unit that keeps the effect preferred over
 * nothing and beaten by anything measurable.
 */
function unblockableScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (!isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  if (tryObject(state, target.oid) === undefined) return 0;
  return weights.pumpPowerWeight;
}

/**
 * The sign is flipped from every other arm in this group, and that is the whole
 * content of the row: a lure is aimed at a creature the *opponent* controls, so
 * `isMine` is the own goal here rather than the good outcome.
 *
 * `tapValue` is what it is worth, borrowed from `untapScore` because the trade
 * is the same one seen from the other side — an opposing creature spends the
 * turn where this seat put it instead of where its controller wanted it. It is
 * not worth the body on top of that, the way an untap is worth the body it
 * frees: the creature is still on the battlefield, still blocking nothing this
 * seat cares about only if this seat then attacks, and whether the attack
 * happens is a combat this policy does not model.
 */
function lureScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  if (tryObject(state, target.oid) === undefined) return 0;
  return weights.tapValue;
}

function untapScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (!isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  const object = tryObject(state, target.oid);
  if (object === undefined || !object.tapped) return 0;
  return weights.tapValue + boardCreatureValue(context.cast, state, target.oid);
}

function bounceScore(context: TargetContext, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  if (isMine(state, target.oid, me)) return -weights.ownGoalPenalty;
  return (
    boardCreatureValue(context.cast, state, target.oid) * 0.6 +
    weights.bounceValue +
    threatValue(context, target.oid)
  );
}

function counterScore(context: TargetContext, target: Target | null): number {
  const { state, target: weights } = context;
  if (target === null || target.kind !== 'spell') return 0;
  const entry = state.stack.find((item) => item.oid === target.oid);
  if (entry === undefined) return 0;
  if (entry.controller === context.me) return -weights.ownGoalPenalty;
  return weights.counterValue + boardCreatureValue(context.cast, state, target.oid);
}

/**
 * What one token adds to the board, as this policy measures a board: bodies.
 *
 * A token with no body adds none. That is not the policy shrugging — a part
 * token is an artifact that waits to be spent, and the swing it eventually
 * causes is the counter it places, which this evaluator has no term for any
 * more than it has one for a keyword (see `putCounters` below). Scoring it as a
 * 0-power creature would be the same arithmetic and a claim that a Trophy Horn
 * is a creature.
 */
function tokenScore(context: TargetContext, token: TokenSpec): number {
  if (!isCreatureTokenSpec(token)) return 0;
  return context.cast.creatureBaseValue + token.power * context.cast.powerWeight;
}

/**
 * How many *cards* this effect would put into exile, read off the board the
 * policy is looking at.
 *
 * The mirror of the kernel's `exiledSince`, and it has to be a prediction rather
 * than a reading because a policy runs before the spell resolves. The group
 * comes from the kernel's own `objectsInEffectScope`, so the two answers
 * agree by construction on everything except what changes between the choice and
 * the resolution — which is the honest residue, not a guess. Tokens are dropped
 * for the reason the kernel drops them: a token exiled is not a card exiled.
 */
function exiledCardsBy(context: TargetContext, effect: Effect, target: Target | null): number {
  if (effect.kind !== 'exileTarget') return 0;
  const isCard = (oid: ObjectId): boolean => tryObject(context.state, oid)?.token !== true;
  if (effect.scope !== undefined) {
    if (target === null || target.kind !== 'player') return 0;
    return objectsInEffectScope(context.state, effect.scope, target.player).filter(isCard).length;
  }
  if (target === null || target.kind !== 'permanent') return 0;
  return isCard(target.oid) ? 1 : 0;
}

/**
 * How many cards sit in a graveyard right now, `whose` this policy's `Amount`
 * evaluator is given.
 *
 * `'you'` is the caster's own, mirroring how the kernel resolves the same word
 * against the effect's controller (`kernel/effects.ts`'s `evaluateAmount`,
 * `amount.ts`'s docblock on `CardsInGraveyardSchema`); `'each'` sums both, in
 * the same `PLAYER_IDS` order the kernel walks.
 */
function graveyardCount(context: TargetContext, whose: 'you' | 'each'): number {
  const { state, me } = context;
  if (whose === 'each') {
    return PLAYER_IDS.reduce<number>((total, player) => total + state.players[player].graveyard.length, 0);
  }
  return state.players[me].graveyard.length;
}

/**
 * How many of `me`'s permanents on `state` match `filter`, read off the board
 * this policy is looking at right now.
 *
 * `countMatching` (CR 107.3h) is a snapshot of the board, not an event log,
 * so unlike `exiledCardsBy` there is nothing to predict across the rest of
 * the spell's own effect list — the pre-resolution board is already the
 * right count for every tuple this policy scores, except the one where an
 * earlier effect of the same spell changes the board first, which a scoring
 * heuristic can afford to miss. `objectFilter` and `selectMatching` are the
 * same public primitives `@mtg/kernel`'s own evaluator builds `countMatching`
 * on, so this reads the identical shape the resolution will, the same
 * reasoning `objectsInEffectScope` above was exported for.
 */
function countMatching(state: GameState, me: PlayerId, filter: CountFilter): number {
  return selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({ cardTypes: filter.cardTypes ?? null, subtypes: filter.subtypes ?? null, controller: me }),
  ).length;
}

/**
 * The same count, narrowed to the permanents carrying one of the named
 * counters.
 *
 * Its own helper rather than an optional argument to `countMatching` above,
 * because the narrowing is answered against a different source: the filter is
 * a question for `derivedCharacteristics`, and a counter is not a derived
 * characteristic (layer 7d derives P/T from it, which is why `@mtg/dsl`'s
 * `countWithCounter` is a member and not a filter field). `counterCount` is the
 * same public primitive the kernel's own evaluator uses, so this policy
 * predicts the number the resolution will read rather than a second reading of
 * it.
 */
function countWithCounter(
  state: GameState,
  me: PlayerId,
  filter: CountFilter,
  counters: readonly CounterKind[],
): number {
  const matching = selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({ cardTypes: filter.cardTypes ?? null, subtypes: filter.subtypes ?? null, controller: me }),
  );
  return matching.filter((oid) => {
    const object = tryObject(state, oid);
    if (object === undefined) return false;
    return counters.some((kind) => counterCount(object.counters, kind) > 0);
  }).length;
}

/**
 * The greatest power among the permanents `filter` names on `me`'s side, or 0
 * when it names none.
 *
 * A reduction beside the two counters above rather than a mode on either, for
 * the reason `@mtg/dsl`'s `GreatestPowerAmongSchema` gives: `max` over an empty
 * set is not what `count` over one is, and CR 107.3 pins the empty answer at 0.
 * Power comes off `derivedCharacteristics`, so the policy predicts the number
 * the kernel will read after the layer walk rather than the printed one.
 */
function greatestPowerAmong(state: GameState, me: PlayerId, filter: CountFilter): number {
  const map = derivedCharacteristics(state);
  let greatest = 0;
  for (const oid of selectMatching(
    state.battlefield,
    map,
    objectFilter({ cardTypes: filter.cardTypes ?? null, subtypes: filter.subtypes ?? null, controller: me }),
  )) {
    const power = map.get(oid)?.power ?? 0;
    if (power > greatest) greatest = power;
  }
  return greatest;
}

/**
 * Lands of one basic type, on one side of the table or on both.
 *
 * A second counter beside `countMatching` rather than a filter fed into it,
 * because `landsWithSubtype`'s `each` axis has no `CountFilter` spelling: the
 * filter above always reads one player's half of the battlefield, and "on the
 * battlefield" is a null controller. Mirrors the kernel's own helper of the
 * same name — this policy predicts what the kernel will compute, so the two
 * count the same permanents.
 */
function countLandsWithSubtype(state: GameState, subtype: string, controller: PlayerId | null): number {
  return selectMatching(
    state.battlefield,
    derivedCharacteristics(state),
    objectFilter({ cardTypes: ['land'], subtypes: [subtype], controller }),
  ).length;
}

/**
 * A printed quantity, as this policy expects it to come out.
 *
 * `exiled` is what the earlier effects of the same spell are predicted to have
 * exiled by the time this one applies — the policy's version of the kernel's
 * resolution mark. Without it a spell whose damage counts its own sweep scores
 * as zero damage, and a bot holding the set's best card would cast it as though
 * it were half a card.
 *
 * `cardsInGraveyard` reads the graveyard as the board stands before the spell
 * resolves, not as an earlier effect in the same list would leave it after
 * milling into it. That gap is the same one `destroyPermanent`'s comment below
 * names for the graveyard generally, here on the one path that actually counts
 * it; a card pairing "mill N" with "gain life equal to cards in your
 * graveyard" is rare enough that a stale count on it costs less than the
 * per-player mill bookkeeping `exiled`-style plumbing would add everywhere
 * else to avoid it.
 *
 * `PumpAmount` rather than `Amount` because the pump's stat deltas admit a rate
 * as well as a count, and this policy has to price Mutilate before it decides
 * where to aim it.
 */
function predictAmount(context: TargetContext, amount: PumpAmount, exiled: number): number {
  if (isLiteralAmount(amount)) return amount;
  switch (amount.kind) {
    case 'exiledThisResolution':
      return exiled;
    case 'cardsInGraveyard':
      return graveyardCount(context, amount.whose);
    case 'countMatching':
      return countMatching(context.state, context.me, amount.filter);
    case 'countWithCounter':
      return countWithCounter(context.state, context.me, amount.filter, amount.counters);
    case 'countMatchingOpponent':
      return countMatching(context.state, opponentOf(context.me), amount.filter);
    case 'landsWithSubtype':
      return countLandsWithSubtype(
        context.state,
        amount.subtype,
        amount.whose === 'each' ? null : context.me,
      );
    case 'greatestPowerAmong':
      return greatestPowerAmong(context.state, context.me, amount.among);
    case 'damageDealtThisResolution':
      // What this resolution has already dealt, which a targeting policy runs
      // *before* any of it has happened: the span is empty at decision time, so
      // there is no number here to predict. Zero is the true prediction rather
      // than a shrug — the policy is choosing a target for the clause that will
      // deal the damage, and Corrupt's life-gain clause takes no target at all.
      return 0;
    case 'ratePer':
      // The rate the board is standing at right now, which is also the number
      // the kernel will fix at resolution unless something changes in between —
      // and nothing does, between choosing a target and putting the spell on
      // the stack. So this is a prediction only in the sense that every other
      // arm here is one.
      return amount.rate * predictAmount(context, amount.each, exiled);
    case 'chosenX':
      return context.chosenX;
    default:
      return assertNever(amount, 'predictAmount');
  }
}

function effectScore(context: TargetContext, effect: Effect, target: Target | null, exiled: number): number {
  const weights = context.target;
  const number = (amount: PumpAmount): number => predictAmount(context, amount, exiled);
  switch (effect.kind) {
    // Each of the four sweepers below is its own unscoped score, once per body.
    // The scoped arm is asked first in each because a sweeper's target names a
    // player and every single-target scorer here reads a permanent off it.
    case 'dealDamage': {
      const amount = number(effect.amount);
      return effect.scope === undefined
        ? damageScore(context, amount, target)
        : scopedBoardScore(context, effect.scope, effect.scopeFilter, target, (inner, member) =>
            damageScore(inner, amount, member),
          );
    }
    // The unscoped exile takes the same score a destroy does, because this
    // policy prices the board and both take a creature off it. What separates
    // them is the graveyard, and the graveyard is a zone nothing here reads —
    // the same reason `putCounters` below scores as the pump it is and not as
    // the keyword it also grants. The scoped one is a different question, and
    // it is the only place in this switch where the target names a player and
    // the score is about permanents.
    case 'destroyPermanent':
      return effect.scope === undefined
        ? destroyScore(context, target)
        : scopedBoardScore(context, effect.scope, effect.scopeFilter, target, destroyScore);
    case 'exileTarget':
      return effect.scope === undefined
        ? destroyScore(context, target)
        : scopedExileScore(context, effect.scope, target);
    case 'pumpUntilEndOfTurn': {
      const power = number(effect.power);
      const toughness = number(effect.toughness);
      return effect.scope === undefined
        ? pumpScore(context, power, toughness, target)
        : scopedBoardScore(context, effect.scope, effect.scopeFilter, target, (inner, member) =>
            pumpScore(inner, power, toughness, member),
          );
    }
    // A player sweep is scored by which side of the table it lands on, and
    // `sweepDirection` is the whole of that: everybody drawing cancels, the
    // opponent drawing is worth the draw against this seat. It is not
    // `playerScore` with a synthesized seat, because that helper charges
    // `ownGoalPenalty` for aiming across the table and a sweep aims at nobody.
    case 'drawCards':
      return effect.players !== undefined
        ? sweepDirection(effect.players) * number(effect.count) * weights.cardDrawValue
        : playerScore(context, target, number(effect.count) * weights.cardDrawValue);
    case 'gainLife':
      return playerScore(context, target, number(effect.amount) * weights.lifeGainValue);
    case 'counterSpell':
      return counterScore(context, target);
    case 'createToken':
      return number(effect.count) * tokenScore(context, effect.token);
    case 'tapPermanent':
      return effect.scope === undefined
        ? tapScore(context, target)
        : scopedBoardScore(context, effect.scope, effect.scopeFilter, target, tapScore);
    case 'returnToHand':
      return bounceScore(context, target);
    case 'fight':
      return fightScore(context, target);
    case 'millCards':
      return harmfulPlayerScore(context, target, number(effect.count) * weights.millValue);
    // Mana, and this policy prices the board rather than the pool. A ritual's
    // mana is spent by a later cast this function never sees, and a mana
    // ability is never scored here at all because CR 605.3a keeps it off the
    // stack and out of the cast options this policy ranks. Zero rather than a
    // guess, and like the reveal below it never varies between the tuples of
    // one effect list.
    case 'addMana':
      return 0;
    // Information, and this policy has no term for information: nothing it
    // reads is a decision the reveal would change. Scored at zero rather than
    // guessed, and it costs the bot nothing — a reveal is never the reason a
    // spell is cast and never varies between the tuples this function ranks.
    case 'revealHand':
    case 'scry':
      return 0;
    case 'putCounters': {
      // Scored as the pump it is, times the number placed. The keyword half of
      // a declaration has no term here for the reason `pumpScore` has none: the
      // policy prices board swing, and this evaluator sees only P/T.
      //
      // Scoped, the same pump lands on every member of a group the kernel picks,
      // so the group comes from `objectsInEffectScope` rather than from a second
      // reading of the board — the same construction `scopedExileScore` uses and
      // for the same reason: a policy that derived the group its own way could
      // value a sweep the resolution does not perform.
      const bonus = counterStatBonus(effect.counter);
      const per = (at: Target | null): number =>
        number(effect.count) * pumpScore(context, bonus.power, bonus.toughness, at);
      if (effect.scope === undefined) return per(target);
      if (target === null || target.kind !== 'player') return 0;
      return objectsInEffectScope(context.state, effect.scope, target.player).reduce(
        (sum, oid) => sum + per({ kind: 'permanent', oid }),
        0,
      );
    }
    // Reanimation, priced as the bodies it puts on the board — `tokenScore`'s
    // arithmetic, since a creature arriving is a creature arriving however it
    // got there, and this policy reads a printed power because a card in a
    // graveyard has no derived one (CR 611.2c).
    //
    // Whose board it lands on is the sign: each card returns under its owner's
    // control, so a Blood Moon aimed at an opponent's graveyard is a gift and
    // this switch has to say so rather than counting bodies and stopping.
    case 'returnFromGraveyard': {
      if (target === null || target.kind !== 'player') return 0;
      const members = objectsInEffectScope(context.state, effect.scope, target.player);
      // To hand it is a draw and not a board swing, so it is priced as the draw
      // it is: `cardDrawValue` per card, the same term the `drawCards` arm
      // above uses. Pricing it as bodies would let a policy value a card in a
      // hand at what a creature on the battlefield is worth, which is the
      // claim the destination exists to distinguish.
      if (effect.destination === 'hand') {
        const drawn = members.length * weights.cardDrawValue;
        return target.player === context.me ? drawn : -drawn;
      }
      const bodies = members.reduce((sum, oid) => {
        const card = tryObject(context.state, oid)?.card;
        if (card === undefined || card.kind !== 'creature') return sum;
        return sum + context.cast.creatureBaseValue + card.power * context.cast.powerWeight;
      }, 0);
      return target.player === context.me ? bodies : -bodies;
    }
    // A tuck takes a permanent off the board, which is exactly what a bounce
    // does to this policy's arithmetic — the difference between a hand and a
    // library is a fact about the owner's next draws, and nothing this policy
    // reads is a draw.
    case 'putOnLibrary':
      return bounceScore(context, target);
    // The rest of the library and graveyard vocabulary is `revealHand`'s and
    // `scry`'s case: nothing this policy reads is a hidden zone, so a shuffle,
    // a reveal off the top and a graveyard exile all move numbers it does not
    // hold. Scored at zero rather than guessed, and it costs the bot nothing,
    // because none of the three varies between the target tuples this function
    // ranks — `searchLibrary`, `exileGraveyard`, `chooseFromGraveyard` and
    // `shuffleGraveyardIntoLibrary` name no target at all.
    case 'shuffleLibrary':
    case 'revealTopCards':
    case 'exileGraveyard':
    case 'shuffleGraveyardIntoLibrary':
    case 'searchLibrary':
    case 'chooseFromGraveyard':
      return 0;
    // A discard is a draw run backwards, so it is priced with the draw's own
    // term rather than with `millValue`: a card out of a hand is a card, and a
    // card off a library is a card the opponent had not drawn yet. That is the
    // same argument `@mtg/deckbuild`'s `EFFECT_PRICING` makes, reached here
    // independently and worth the duplication, because these two evaluators
    // answer different questions — that one prices a card for a deck list, this
    // one ranks target tuples for one cast.
    //
    // `harmfulPlayerScore` rather than `playerScore` is the whole of what this
    // policy needs to know about the two of them: the sign follows whose hand
    // it is, and a bot that aimed a discard at itself would be making the
    // `pumpUntilEndOfTurn` mistake `calibration.ts` documents at the other end
    // of the pipeline.
    //
    // `players` is Liliana's Specter, and it is `loseLife`'s sweep branch with
    // the discard's own rate: a hand emptied on both sides cancels, and one
    // emptied across the table is worth what taking the card is worth.
    case 'discardCards':
      return effect.players !== undefined
        ? -sweepDirection(effect.players) * effect.count * weights.cardDrawValue
        : harmfulPlayerScore(context, target, effect.count * weights.cardDrawValue);
    // Priced identically to the discard above, and the tie is deliberate.
    // Choosing beats not choosing, but how much depends on what is in the hand
    // and this policy reads no hidden zone — the reveal that would tell it has
    // not happened when a target tuple is being ranked. A number invented to
    // separate them would be a claim about a zone nothing here holds.
    case 'chooseDiscard':
      return harmfulPlayerScore(context, target, effect.count * weights.cardDrawValue);
    // A life total losing N is `damageScore`'s player branch exactly: the same
    // `faceDamageWeight` per point and the same `lethalBonus` when it finishes
    // the game. The two effects differ in everything that happens on the way to
    // a life total — prevention, protection, marking a creature — and in
    // nothing that happens once it gets there, so reusing the arithmetic is not
    // a shortcut, it is the claim that a player at 3 does not care which one
    // took the last three.
    //
    // Untargeted, `damageScore` returns zero, and that is the right answer here
    // rather than an inherited one: an untargeted life loss is this seat's own,
    // so it is the same number for every tuple this function ranks and moves
    // none of them. `harmfulPlayerScore` already answers zero for exactly this
    // shape, and `millCards` is the primitive that proves it is a decision and
    // not an oversight — an untargeted mill is this seat's own library, and it
    // is scored at zero and priced positively all the same. Both evaluators are
    // blind to which seat a self-inflicted clause lands on, and a `loseLife`
    // that broke the pattern would be the only primitive in the vocabulary that
    // is not.
    //
    // A player sweep is `drawCards`' branch with the sign turned over, because
    // life taken is worth what a card given is not: everybody losing the same
    // life cancels under a differential policy, and the opponent losing it
    // alone is worth the loss to this seat. `faceDamageWeight` rather than
    // `damageScore` — the sweep names no target for that helper to read, and
    // its `lethalBonus` is a claim about one seat's total that a scope does not
    // make.
    case 'loseLife':
      return effect.players !== undefined
        ? -sweepDirection(effect.players) * number(effect.amount) * weights.faceDamageWeight
        : damageScore(context, number(effect.amount), target);
    // The one arm in this switch whose whole value is a number the *board*
    // holds, and this policy holds the board — so unlike `@mtg/deckbuild`,
    // which prices this at zero because a single card cannot know which side of
    // N the total is on, here it can just look. CR 118.5 makes the effect a
    // gain or a loss of the difference, so the score is that difference at the
    // rate a life gain is worth, signed. It names no target, so it is the same
    // number for every tuple, which is what makes it safe to compute exactly
    // rather than guess.
    case 'setLife':
      return (number(effect.amount) - lifeOf(context.state, context.me)) * weights.lifeGainValue;
    // A Fog, and zero for `shuffleLibrary`'s reason one step removed: what it is
    // worth is the combat step it stops, and this function scores an effect
    // against a target tuple rather than against a combat. It names no target,
    // so the zero costs the bot nothing here — whether the card is worth
    // casting at all is `printedCardValue`'s question, and that one it answers.
    case 'preventCombatDamage':
      return 0;
    // Dawn Charm's first mode, and it does name a target — the Fog above it in
    // this switch names none, so this arm cannot share its zero. `preventDamageScore`
    // is `destroyScore` with the sign flipped: point the shield at this seat's
    // own board and it is worth what the creature is worth, point it at the
    // opponent's and it costs the same `ownGoalPenalty` a self-destroy would.
    case 'preventAllDamageToTarget':
      return preventDamageScore(context, target);
    case 'untapPermanent':
      return untapScore(context, target);
    case 'grantKeywordUntilEndOfTurn':
      return grantKeywordScore(context, effect.keyword, target);
    case 'cantBeBlockedThisTurn':
      return unblockableScore(context, target);
    case 'attacksYouThisTurnIfAble':
      return lureScore(context, target);
    case 'setBasePtUntilEndOfTurn':
      return baseSetScore(context, effect.power, effect.toughness, target);
    // Zero, `scry`'s and the Fog's zero rather than a price. This policy ranks
    // the *tuples of targets* an effect list could be aimed at, and this effect
    // offers none: the only kinds its row admits are `selfCreature` and
    // `selfPermanent`, retained referents filled from the ability's own source
    // (CR 115.6a). Every tuple scores the same, so a number here would tilt no
    // decision and would only make the sacrifice look like a choice.
    //
    // What the drawback is worth is a question about whether to cast or
    // activate the card at all, and that is `@mtg/deckbuild`'s `EFFECT_PRICING`,
    // where it is priced negative.
    case 'sacrificeSelf':
      return 0;
    // The edict (CR 701.17a): the target chooses what leaves their board, so
    // this policy has no single object to price the way `destroyScore` prices
    // a named permanent. `killBonus` alone is the floor value of removal
    // landing at all, without a guess at which body pays it — the same
    // shape `harmfulPlayerScore` already gives `discardCards`, priced by a
    // count instead of a target-dependent card. Zero candidates on the board
    // is not a case this function needs to special-case: it still favors
    // aiming at the opponent, and CR 701.17a's own auto-resolve pays out
    // nothing regardless of where the policy pointed.
    case 'sacrificePermanent':
      return harmfulPlayerScore(context, target, weights.killBonus);
  }
}

/**
 * How much the enchanted creature's toughness moves under this clause.
 *
 * Only the two P/T members move it: `grantKeyword` is layer 6, `definePt` is
 * unreachable on an Aura by construction (`AuraStaticModificationSchema` does
 * not admit it, because a CDA sets its *source's* P/T and an enchanted creature
 * is a different permanent), and the combat and untap clauses are rules
 * permissions rather than characteristics. So this is a sum over the clause and
 * needs no layer walk of its own — the same reading `policies/activate.ts`'s
 * `clauseToughness` takes of an equip clause, one member wider because an Aura
 * may print a rate and an equip clause may not.
 */
function auraToughnessDelta(context: TargetContext, modifications: readonly AuraModification[]): number {
  let total = 0;
  for (const modification of modifications) {
    if (modification.kind === 'statBonus') total += modification.toughness;
    if (modification.kind === 'statBonusPer') {
      total += modification.toughness * predictAmount(context, modification.each, 0);
    }
  }
  return total;
}

/**
 * What one clause of an Aura does **to the creature it lands on** — positive if
 * the host is better off carrying it, negative if it is worse off, in the units
 * `bodyRemovalValue` measures a body in.
 *
 * The sign is the whole of this function, and it is the one thing
 * `@mtg/deckbuild`'s `auraModificationValue` deliberately throws away: that file
 * takes `Math.abs` because it is asking how much *card* an Aura is, and the
 * caster gains exactly what the host loses either way. A target policy is asking
 * the question the absolute value erased — which side of the table the host
 * should be on — so it takes the case list and the argument from there and none
 * of the numbers, which are a deck evaluator's scale and not this one's.
 *
 * Two of the nine members come back signed and already on the right scale from
 * `modificationValueOn`, which is `@mtg/sim`'s own evaluator and reads the board
 * (a keyword the creature already has is worth nothing to grant it again). The
 * rate member is that same arithmetic with the tally counted live rather than at
 * `definePtAssumedCount`: Quag Sickness is `-1/-1` per Swamp, and how many
 * Swamps are actually out is the difference between a debuff and a kill.
 *
 * The other six are priced here because that evaluator has nothing to say about
 * them. Three of them are not a `StaticModification` at all — `grantLandwalk`,
 * `doesNotUntap` and `gainControl` are Aura vocabulary and nothing else prints
 * them — and the three combat restrictions are members it answers 0 for, on the
 * stated ground that it has a body-shaped scale and a combat permission is not
 * a body. So the five that are not `gainControl` are priced against this
 * policy's own removal anchor and its own keyword table.
 *
 * `gainControl` is not priced here at all. It is worth the same on every host
 * and its value is not a property of the host but of the *move*, which
 * `auraScore` handles in a branch of its own.
 */
function auraModificationHostValue(
  context: TargetContext,
  host: ObjectId,
  modification: AuraModification,
): number {
  const { state, cast, target: weights } = context;
  switch (modification.kind) {
    case 'statBonus':
    case 'grantKeyword':
      return modificationValueOn(cast, state, host, modification);
    case 'statBonusPer': {
      const count = predictAmount(context, modification.each, 0);
      return (
        modification.power * count * cast.powerWeight + modification.toughness * count * cast.toughnessWeight
      );
    }
    case 'cantAttack':
    case 'cantBlock':
      return -weights.auraCombatDenialShare * bodyRemovalValue(context, host);
    case 'doesNotUntap':
      // The whole anchor rather than a share of it, and `@mtg/deckbuild`'s
      // argument for the same choice holds here unchanged: a creature held
      // tapped cannot attack, cannot block and cannot pay a tap cost either, so
      // it is strictly more than the two combat clauses together.
      return -bodyRemovalValue(context, host);
    case 'cantBeBlocked':
      return cast.keywordValue.flying;
    case 'grantLandwalk':
      return weights.auraLandwalkShare * cast.keywordValue.flying;
    case 'gainControl':
      return 0;
    default:
      return assertNever(modification, 'auraModificationHostValue');
  }
}

/**
 * What attaching this Aura to this host is worth to the seat casting it.
 *
 * An Aura prints no effect (CR 303.4), so the sum `scoreEffectTargets` takes
 * over the effect list is zero on every legal host and the choice fell through
 * to enumeration order — which is battlefield order, which is arrival order.
 * `ownGoalPenalty` did not catch it either, because that is charged per effect
 * and there are none. This is the arm that prices the host instead, and it is
 * `destroyScore` and `preventDamageScore` in one function because an Aura is
 * either of those depending on what its clause says.
 *
 * Four branches, in the order the rules resolve them:
 *
 *  - the clause takes the host's toughness to 0 or below (CR 704.5e), which is
 *    removal wearing an enchantment's frame — Quag Sickness on a small body is
 *    a destroy-target-creature and is priced as one, and pointed at our own
 *    board it is the own goal that started this;
 *  - the clause moves the host to our side (CR 613.1b, layer 2). Worth the
 *    answer plus the body, because the swing is two creatures wide where a
 *    destroy is one — the argument `@mtg/deckbuild`'s `auraControlMultiple`
 *    makes, reached here through numbers this policy already has rather than a
 *    new weight. Aimed at a creature we already control it buys nothing, and is
 *    refused for what `preventDamageScore` refuses a shield on the opponent's
 *    board for: the wrong side is the wrong side even when nothing of ours dies
 *    for it;
 *  - the clause helps the host, so we want it on ours;
 *  - the clause hurts the host, so we want it on theirs, and `threatValue`
 *    breaks the tie between two of theirs exactly as it does for removal.
 *
 * One stated limit. Between two of *our* creatures a beneficial Aura is worth
 * the same on both unless a keyword lands redundantly, so which one carries it
 * is enumeration order — the tie `policies/activate.ts`'s `hostQuality` breaks
 * for an equip by reading what the defending board can block. The same term
 * would break it here and is not in this change: nothing in the reported play
 * or in the bead turns on it, and an added constant per host is the bug that
 * file's docblock warns about.
 */
function auraScore(context: TargetContext, aura: Aura, target: Target | null): number {
  const { state, me, target: weights } = context;
  if (target === null || target.kind !== 'permanent') return 0;
  const object = tryObject(state, target.oid);
  if (object === undefined) return 0;
  const mine = isMine(state, target.oid, me);
  const modifications = aura.modifications;

  const toughness = auraToughnessDelta(context, modifications);
  if (toughnessOf(state, target.oid) + toughness - object.damage <= 0) {
    return mine ? -weights.ownGoalPenalty : answerValue(context, target.oid);
  }
  if (modifications.some((modification) => modification.kind === 'gainControl')) {
    return mine
      ? -weights.ownGoalPenalty
      : answerValue(context, target.oid) + boardCreatureValue(context.cast, state, target.oid);
  }

  let hostValue = 0;
  for (const modification of modifications) {
    hostValue += auraModificationHostValue(context, target.oid, modification);
  }
  // A clause worth nothing on this host — a keyword it already has — is worth
  // nothing on either side, and charging the penalty would claim otherwise.
  if (hostValue === 0) return 0;
  if (hostValue > 0) return mine ? hostValue : -weights.ownGoalPenalty;
  return mine ? -weights.ownGoalPenalty : -hostValue + threatValue(context, target.oid);
}

/**
 * The board and the weights every scorer on this page reads, in one record.
 *
 * Built in one place because both entry points below need the identical one and
 * `assessRace` is not free: a second literal here would be a second chance for
 * the two arms of a cast decision to score against different readings of the
 * same race.
 */
function targetContext(
  state: GameState,
  me: PlayerId,
  castConfig: CastPolicyConfig,
  targetConfig: TargetPolicyConfig,
  race: RacePolicyConfig,
  chosenX: number,
  sourceOid: ObjectId | undefined,
): TargetContext {
  return {
    state,
    me,
    target: targetConfig,
    cast: castConfig,
    race,
    assessment: assessRace(state, me, race),
    chosenX,
    sourceOid,
  };
}

/**
 * Total value of resolving an effect list against this exact target tuple. The
 * tuple is parallel to the list, matching the kernel's `StackEntry.targets`.
 *
 * Written over an effect list rather than over a card because an activated
 * ability's payload is the same ten primitives a spell's is, aimed by the same
 * enumeration at the same board. A second copy of this switch, scoring an
 * ability's damage differently from a spell's, is exactly the drift the shared
 * evaluators exist to prevent.
 */
export function scoreEffectTargets(
  state: GameState,
  me: PlayerId,
  effects: readonly Effect[],
  targets: readonly (Target | null)[],
  castConfig: CastPolicyConfig,
  targetConfig: TargetPolicyConfig,
  race: RacePolicyConfig,
  chosenX = 0,
  sourceOid?: ObjectId,
): number {
  const context = targetContext(state, me, castConfig, targetConfig, race, chosenX, sourceOid);
  let total = 0;
  // The policy's resolution mark: effects are scored in printed order and each
  // one sees what the earlier ones are predicted to have exiled, exactly as the
  // kernel's resolution loop does.
  let exiled = 0;
  for (const [index, effect] of effects.entries()) {
    const target = targets[index] ?? null;
    total += effectScore(context, effect, target, exiled);
    exiled += exiledCardsBy(context, effect, target);
  }
  return total;
}

/**
 * Total value of casting `card` with this exact target tuple. The tuple is
 * parallel to `effectsFor(card, mode)`, matching the kernel's
 * `StackEntry.targets` — which for a modal card (`legal.ts`'s `castOptions`)
 * is the chosen mode's effect list, never `card.effects`, which a modal card
 * leaves empty by construction (CR 700.2, `@mtg/dsl`'s `checkEffects`). Read
 * `card.effects` here instead and every modal cast option scores zero on
 * every target tuple regardless of what the chosen mode does, because the
 * effect loop below has nothing to iterate.
 *
 * An Aura is the same sentence about a different empty list, and it is answered
 * here rather than inside `scoreEffectTargets` for the reason `legal.ts`'s
 * `castOptions` answers it before it reads the effect list: an Aura's whole text
 * is `card.aura`, its host is `targets[0]` off `targetChoicesFor` rather than
 * off any effect's target, and there is no effect list to hand the loop. The
 * split falls on the same line in both files, so the enumeration and the policy
 * agree about what a cast of this card is. `scoreEffectTargets` keeps no aura
 * arm because an ability is the other caller and no ability attaches an Aura —
 * an equip clause is `policies/activate.ts`'s `attachmentValue`.
 */
export function scoreTargets(
  state: GameState,
  me: PlayerId,
  card: Card,
  targets: readonly (Target | null)[],
  castConfig: CastPolicyConfig,
  targetConfig: TargetPolicyConfig,
  race: RacePolicyConfig,
  chosenX = 0,
  mode: number | null = null,
): number {
  if (isAuraCard(card)) {
    return auraScore(
      targetContext(state, me, castConfig, targetConfig, race, chosenX, undefined),
      card.aura,
      targets[0] ?? null,
    );
  }
  return scoreEffectTargets(
    state,
    me,
    effectsFor(card, mode),
    targets,
    castConfig,
    targetConfig,
    race,
    chosenX,
  );
}
