/**
 * A small deterministic heuristic agent.
 *
 * This is not the bot tier — tier-1 greedy bots are their own package. It
 * exists so the kernel can prove itself end to end (a real game, played by
 * something, finishing with a winner) without depending on anything downstream.
 * It scores enumerated options and takes the best, ties going to enumeration
 * order, so it is fully deterministic.
 */
import type { Card, Effect, ManaCost, PumpAmount } from '@mtg/dsl';
import { assertNever, counterStatBonus, effectsFor, manaValue, printedEffects, resolveX } from '@mtg/dsl';
import { activatedAbilityAt } from './abilities';
import type { Action } from './actions';
import type { AgentView, PlayerAgent } from './agent';
import { scoringAgent } from './agent';
import { effectiveManaCost } from './cost';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import { powerOf, toughnessOf } from './layers';
import { canPay, planPayment } from './mana';
import { spellAwaitingMay } from './may-choice';
import { playerOf } from './trace';
import { spellAwaitingUnless } from './unless-choice';
import type { GameState, Target } from './state';
import { triggerOnStack } from './trigger-choice';
import { creaturesControlledBy, getObject, isOnBattlefield } from './zones';

function castValue(state: GameState, action: Extract<Action, { type: 'castSpell' }>): number {
  const card = getObject(state, action.oid).card;
  const creatureBonus = card.kind === 'creature' ? 6 : 0;
  const cost =
    card.kind === 'land'
      ? 0
      : card.manaCost.generic +
        card.manaCost.W +
        card.manaCost.U +
        card.manaCost.B +
        card.manaCost.R +
        card.manaCost.G;
  return 40 + creatureBonus + cost;
}

function chosenXUnits(effect: Effect): number {
  const chosen = (value: unknown): number =>
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { readonly kind?: unknown }).kind === 'chosenX'
      ? 1
      : 0;
  switch (effect.kind) {
    case 'dealDamage':
    case 'gainLife':
    case 'loseLife':
    case 'setLife':
      return chosen(effect.amount);
    case 'drawCards':
    case 'millCards':
    case 'createToken':
    case 'putCounters':
      return chosen(effect.count);
    case 'pumpUntilEndOfTurn':
      return chosen(effect.power) + chosen(effect.toughness);
    default:
      return 0;
  }
}

function attackValue(state: GameState, action: Extract<Action, { type: 'declareAttackers' }>): number {
  let total = 0;
  for (const declaration of action.attackers) {
    total += Math.max(0, powerOf(state, declaration.oid));
  }
  return total;
}

function blockValue(
  state: GameState,
  view: AgentView,
  action: Extract<Action, { type: 'declareBlockers' }>,
): number {
  const me = view.player;
  const incoming = state.combat.attacks
    .filter((attack) => typeof attack.defender === 'number' && attack.defender === me)
    .reduce((sum, attack) => sum + Math.max(0, powerOf(state, attack.oid)), 0);
  const facingLethal = incoming >= state.players[me].life;

  let score = 0;
  const blocked = new Set(action.blocks.map((block) => block.attacker));
  for (const block of action.blocks) {
    if (!isOnBattlefield(state, block.blocker) || !isOnBattlefield(state, block.attacker)) continue;
    const blockerPower = powerOf(state, block.blocker);
    const blockerToughness = toughnessOf(state, block.blocker);
    const attackerPower = powerOf(state, block.attacker);
    const attackerToughness = toughnessOf(state, block.attacker);
    const survives = blockerToughness > attackerPower;
    const kills = blockerPower >= attackerToughness;
    if (survives && kills) score += 5;
    else if (survives) score += 2;
    else if (kills) score += 1;
    else score -= 3;
  }
  if (facingLethal) {
    // Chump blocking beats losing: every blocked attacker is damage prevented.
    const prevented = state.combat.attacks
      .filter((attack) => blocked.has(attack.oid))
      .reduce((sum, attack) => sum + Math.max(0, powerOf(state, attack.oid)), 0);
    score += prevented * 10;
  }
  return score;
}

/**
 * How much this seat likes one set of cards leaving a hand.
 *
 * Both discard actions, and one arithmetic, which is a coincidence worth
 * naming rather than a generalization. Scoring its own cleanup discard, this
 * seat pitches the most expensive card it holds, because the cheap ones are the
 * ones it can still cast. Scoring a `chooseDiscard` against an opponent, it
 * takes the most expensive card *they* hold, because that is the one the
 * discard is buying. Two different readings of "the biggest number wins", and
 * they agree, so there is one function; the day a real policy makes them
 * disagree the split is at this comment.
 *
 * A land scores negative in both readings for the same accidental reason: it is
 * the card this seat least wants to pitch and the card it least wants to take.
 */
function discardValue(
  state: GameState,
  action: Extract<Action, { type: 'discard' | 'chooseDiscards' }>,
): number {
  // Pitch the most expensive cards first.
  let total = 0;
  for (const oid of action.oids) {
    const card = getObject(state, oid).card;
    if (card.kind === 'land') total -= 2;
    else
      total +=
        card.manaCost.generic +
        card.manaCost.W +
        card.manaCost.U +
        card.manaCost.B +
        card.manaCost.R +
        card.manaCost.G;
  }
  return total;
}

/**
 * The fixed part of a `PumpAmount`, or zero when there is no number yet.
 *
 * `Amount` is `number | ComputedAmount` (`@mtg/dsl`'s `amount.ts`), and a
 * computed one - an X nobody has announced, a graveyard count, a board count -
 * has no value at the moment a target is chosen. Zero is the right reading for
 * the one question this file asks of it: a stat change whose size is unknown is
 * not known to be a shrink.
 *
 * A rate is the exception, and it is the reason this reads `PumpAmount` rather
 * than `Amount`: "-1/-1 for each Swamp you control" prints its sign even though
 * it does not print its size, and a board count is never negative, so the rate
 * alone answers the only question asked here. Returning zero for it would file
 * Mutilate as a gift and have the bot aim it at its own creatures.
 */
function fixedAmount(amount: PumpAmount): number {
  if (typeof amount === 'number') return amount;
  return amount.kind === 'ratePer' ? amount.rate : 0;
}

/**
 * Whether this effect is one to point at the *other* side of the table.
 *
 * `effectTargetBonus` reads this as `harmful === !owned`, which makes the
 * answer load-bearing in both directions: a kind missing from the harmful list
 * is not scored neutrally, it is scored as a *gift*, and the bot aims it at its
 * own board and is penalized for aiming it anywhere else.
 *
 * Two of the fourteen kinds have no fixed answer, and it is the same situation
 * twice: the primitive that moves a stat line points one way when the number is
 * positive and the other way when it is negative. "Target creature gets -2/-2"
 * and "target creature gets +2/+2" are one `pumpUntilEndOfTurn`; a gloom
 * counter and a +1/+1 counter are one `putCounters`. So the sign is read off
 * the stat line rather than guessed from the kind.
 *
 * Written as an exhaustive switch rather than as a list of `||`s because that
 * is the form a fifteenth effect kind cannot slip past: the three ways this
 * function was wrong before `mtg-4f2y` were all silence rather than a wrong
 * answer. `exileTarget` was absent outright, so "Exile target creature. You
 * gain 2 life." exiled the bot's own blocker and gained it two life for doing
 * so - reported from a live game on 2026-08-18, on a 1/3 the bot had played
 * itself. `pumpUntilEndOfTurn` was absent, so every card in the flagship
 * reading "target creature gets -N/-N" - six of them - was aimed at the bot's
 * own creatures. And `putCounters` read its sign only when the effect was
 * *scoped*, so the set's two single-target gloom spells were gifts as well.
 *
 * Two of the harmful kinds name a player rather than a permanent, and both are
 * harmful for the same reason: what `millCards` and `revealHand` do to the seat
 * they name is something that seat would rather avoid. They sit in the group
 * without a note of their own on the case, because a comment is a statement to
 * `no-fallthrough` and an empty case that holds one is a case it reports.
 *
 * `fight` is the one kind that hurts the chooser's own body as well, and it is
 * still harmful here without qualification: this function answers "which way
 * should this be aimed", the fight vocabulary can only be aimed at a creature
 * the chooser does not control, and a bot that read a fight as a gift would aim
 * a removal spell at nothing. Whether the fight is *worth* casting is a
 * question about the two power values, which this seat does not ask about any
 * effect.
 */
function isHarmful(effect: Effect): boolean {
  switch (effect.kind) {
    case 'dealDamage':
    case 'destroyPermanent':
    case 'exileTarget':
    case 'tapPermanent':
    case 'returnToHand':
    case 'millCards':
    case 'revealHand':
    case 'fight':
    case 'discardCards':
    case 'chooseDiscard':
    case 'sacrificePermanent':
      // CR 701.8 costs its target cards whoever chooses them, so both discards
      // are harmful in the one sense this predicate measures — aim them at an
      // opponent. `chooseDiscard` is the strictly better of the two for the
      // same reason it is unpriced separately, and this seat has no policy fine
      // enough to say so. `sacrificePermanent` joins them for the identical
      // reason: CR 701.17a costs its target a permanent whoever chooses which
      // one, unlike `sacrificeSelf` below, whose referent is fixed at print
      // time and never a target at all.
      return true;
    case 'putCounters': {
      const bonus = counterStatBonus(effect.counter);
      return bonus.power + bonus.toughness < 0;
    }
    case 'pumpUntilEndOfTurn':
      return fixedAmount(effect.power) + fixedAmount(effect.toughness) < 0;
    // The aim question for a base P/T set is a question about the *body*: base
    // 1/1 is a curse on a 5/5 and a gift on a 0/1, and the difference is the
    // creature rather than the effect. This predicate is handed the effect
    // alone, so it cannot ask, and `true` is the answer that is correct for
    // every card that can print this kind — it is hand-authored only
    // (`UNPRICED_EFFECT_KINDS`), and Diminish and its printed kin all shrink.
    //
    // A hand-authored base P/T *raise* is where this arm would be wrong, and
    // the fix is not a threshold here: `@mtg/sim`'s target policy scores the
    // same effect with the board in hand and already reads the current stats,
    // which is where a state-dependent answer belongs.
    case 'setBasePtUntilEndOfTurn':
      return true;
    case 'addMana':
    case 'counterSpell':
    case 'createToken':
    case 'drawCards':
    case 'gainLife':
    case 'returnFromGraveyard':
    case 'scry':
    case 'shuffleLibrary':
    case 'revealTopCards':
    case 'exileGraveyard':
    case 'shuffleGraveyardIntoLibrary':
    case 'searchLibrary':
    case 'chooseFromGraveyard':
    case 'setLife':
    case 'preventCombatDamage':
      // Neither of the last two names a target at all, so "which way should
      // this be aimed" has no answer and `false` is the one that stops the bot
      // aiming anything. `setLife` is the interesting one: it is a gift or a
      // killing blow depending on a life total this function is not handed, and
      // it is still untargeted either way — the total it moves is always the
      // controller's.
      return false;
    // Unlike the two effects just above, this one does name a target — but it
    // is a shield, not a strike, so `false` is still the right answer and
    // `effectTargetBonus` below is what makes the bot point it at its own
    // board rather than leaving it unscored.
    case 'preventAllDamageToTarget':
      return false;
    // The same shape and the same answer: an untap is something a seat does to
    // its own board, so `false` points it there. What this seat cannot say is
    // that the permanent should be *tapped* — `effectTargetBonus` scores a
    // permanent by its body and its controller and asks nothing else — so the
    // bot will happily untap an untapped creature and get a no-op. That is a
    // policy this agent has nowhere to put rather than a missing arm here, and
    // it is the same blunt reading that makes it pump the biggest body instead
    // of the one that is about to trade.
    case 'untapPermanent':
      return false;
    // Never harmful, and unlike the untap above it there is no second reading
    // at all: `KEYWORDS` carries nine, every one of them an upgrade, so the
    // worst a grant does to the creature it names is nothing.
    case 'grantKeywordUntilEndOfTurn':
      return false;
    // Evasion for a turn, and never a drawback: the same reading the grant
    // above it gets, so `false` points it at this seat's own board.
    case 'cantBeBlockedThisTurn':
      return false;
    // The one arm in this switch that is harmful *and* aimed at a creature
    // rather than at a player. A creature compelled to attack leaves its
    // controller's board undefended and may die doing it, so the seat it names
    // is the seat that would rather avoid it — which is `isHarmful`'s whole
    // question, and `true` is what points the bot across the table.
    case 'attacksYouThisTurnIfAble':
      return true;
    // Life loss is `dealDamage`'s answer for `dealDamage`'s reason: it is the
    // one thing the seat it names would rather avoid.
    case 'loseLife':
      return true;
    // The one arm where the question has no answer, and `false` is what says
    // so. A sacrifice of the source is aimed at a retained referent -- the
    // permanent whose ability this is -- so there is no tuple to point either
    // way and this predicate is never the thing that decides anything about
    // it. `false` rather than `true` because the single legal referent is
    // always on this seat's own board, and pointing across the table would be
    // pointing at nothing.
    case 'sacrificeSelf':
      return false;
    case 'putOnLibrary':
      // The one library effect that aims at something, and it is removal: a
      // permanent tucked into its owner's library has left the battlefield and
      // has to be drawn again. `exileGraveyard` is above it in the benign group
      // for the opposite reason — it names a graveyard by `whose` rather than
      // by target, so there is no way to aim it and nothing here to score.
      return true;
    default:
      return assertNever(effect, 'isHarmful');
  }
}

/**
 * How well one target tuple fits one effect list, from this seat's point of
 * view.
 *
 * Written over an effect list rather than over a cast, because the same
 * question is asked in three places now: a spell being cast, an ability being
 * activated, and a triggered ability being aimed as it goes on the stack (CR
 * 603.3d). A trigger that put its counter on the opponent's best creature would
 * be a bot that never fires the mechanic usefully, which is the failure
 * `docs/design/dsl-v1-ability-model.md` §9 risk 3 names — and it is the failure
 * a *shared* evaluator makes impossible, since a trigger's damage is scored by
 * the same arithmetic a bolt's is.
 */
function effectTargetBonus(
  state: GameState,
  me: PlayerId,
  effects: readonly Effect[],
  targets: readonly (Target | null)[],
  chosenX = 0,
): number {
  const them = opponentOf(me);
  let bonus = 0;
  for (const [index, effect] of effects.entries()) {
    const target = targets[index] ?? null;
    const harmful = isHarmful(effect);
    const xValue = chosenXUnits(effect) * chosenX;
    if (target === null) {
      if (!harmful) bonus += xValue;
      continue;
    }
    if (target.kind === 'player') {
      const desirable = harmful === (target.player === them);
      bonus += desirable ? 4 + xValue : -8 - xValue;
      continue;
    }
    if (target.kind === 'permanent') {
      if (!isOnBattlefield(state, target.oid)) continue;
      const owned = getObject(state, target.oid).controller === me;
      const value = powerOf(state, target.oid) + toughnessOf(state, target.oid);
      const desirable = harmful === !owned;
      bonus += desirable ? 3 + value + xValue : -8 - xValue;
    }
  }
  return bonus;
}

/**
 * What an act is worth once the direction it points in is read.
 *
 * `effectTargetBonus` never subtracts for anything but a clause aimed the wrong
 * way — every other arm of it contributes zero or more — so a negative bonus is
 * exactly the statement "this option points at something it should not". An
 * option that does is worth less than doing nothing, and `passPriority` scores
 * zero, so the act's own value must not be added on top of it.
 *
 * Adding it was the whole of the bug `isHarmful` above only half fixed. A
 * `{2}{W}` "exile target creature" is worth 43 before targets are read, and the
 * flat -8 that aiming it at the caster's own board costs never overcame that,
 * so the agent cast it anyway: aiming was fixed and casting was not, and a bot
 * holding removal with an empty board across the table exiled its own creature
 * rather than passing. The floor is what makes the same spell wait for a target
 * worth having.
 *
 * The two arms that cannot decline — `chooseTriggerTargets` and the two "may"
 * answers — do not route through here, because a trigger already on the stack
 * has to point somewhere and a negative score is a comparison between targets
 * there, not a refusal to act.
 */
function aimedValue(actValue: number, targetBonus: number): number {
  return targetBonus < 0 ? targetBonus : actValue + targetBonus;
}

/** The printed effects of a trigger sitting on the stack, or none. */
function triggerEffectsOf(state: GameState, oid: ObjectId): readonly Effect[] {
  return triggerOnStack(state, oid)?.ability.effects ?? [];
}

/**
 * The score a spend gets when this seat would rather keep the mana (`mtg-c86f`).
 *
 * Below `passPriority`'s zero and above nothing else, because that is the whole
 * of what holding means to a scoring agent: passing has to win the comparison,
 * and a land drop (100) still has to beat both.
 */
const HELD_OPEN = -1;

/**
 * Whether this card counters a spell, in any mode it prints.
 *
 * `printedEffects` rather than `effectsFor`: a modal card's flat `effects` list
 * is empty by construction, and this question is asked of a card sitting in a
 * hand, where no mode has been chosen and none will be until it is cast. A
 * modal card with one countering mode is a card this seat can point at a spell,
 * so it is a card worth keeping mana for.
 *
 * Narrowed to `instant` and not merely "carries `counterSpell`" because the
 * whole policy below is about a window that opens while somebody else's spell
 * is on the stack. CR 117.1a lets an instant be cast in that window and refuses
 * a sorcery it, so a sorcery that counters is not a card any amount of held
 * mana makes castable.
 */
function countersSpells(card: Card): card is Extract<Card, { readonly kind: 'instant' }> {
  return card.kind === 'instant' && printedEffects(card).some((effect) => effect.kind === 'counterSpell');
}

/**
 * The cheapest counterspell in this seat's hand it could pay for right now, or
 * `null` when it holds none it can afford.
 *
 * Cheapest rather than best, and the reason is the same one the rest of this
 * file gives for every other tie: this agent has no card-quality policy. What
 * it can say is which reservation is smallest, and a smaller reservation is a
 * smaller bill for the turn it is charged against.
 *
 * `canPay` is the gate rather than a land count, so the answer is colored: two
 * Mountains and a `{1}{U}` counterspell reserve nothing, because preserving
 * those Mountains buys a cast that cannot happen. `handReserve` in `mana.ts`
 * turns down the same card for the same reason, one layer lower.
 */
function affordableCounterInHand(
  state: GameState,
  me: PlayerId,
  excluding: ObjectId | null,
): ManaCost | null {
  let cheapest: ManaCost | null = null;
  for (const oid of playerOf(state, me).hand) {
    if (oid === excluding) continue;
    const card = state.objects[oid]?.card;
    if (card === undefined || !countersSpells(card)) continue;
    const cost = effectiveManaCost(state, me, card);
    if (!canPay(state, me, cost)) continue;
    if (cheapest === null || manaValue(cost) < manaValue(cheapest)) cheapest = cost;
  }
  return cheapest;
}

/**
 * Whether a hold is worth making at all, before any particular spend is priced.
 *
 * Two conditions, and each is a release valve rather than a refinement — the
 * failure this policy has to avoid is an agent that holds mana every turn
 * forever and never develops a board, which loses more games than an uncast
 * counterspell ever wins.
 *
 * The opponent must hold a card. There is nothing to counter otherwise, and an
 * empty hand across the table is the one fact that says so. The *number* of
 * cards in a hand is free information (CR 108.3, and the same reading
 * `@mtg/sim`'s bots take of a hidden zone's size), so this reads the length and
 * never the contents — nothing here may know which card is coming.
 *
 * And this seat must already control a creature. A seat with an empty
 * battlefield is a seat whose next turn is worth more than any counterspell,
 * and it is the position a hold can starve indefinitely: hold, cast nothing,
 * hold again, still no board. Requiring one body means the agent develops
 * first and only then starts trading its turn for a window, and it means a
 * board wipe puts it straight back to developing. It is a blunt line — a lone
 * 1/1 satisfies it as well as a wall of dragons — and it is blunt on purpose,
 * because a board-parity judgment is a policy `@mtg/sim`'s tier-1 bots own and
 * this file does not.
 */
function holdWindowOpen(state: GameState, me: PlayerId): boolean {
  if (playerOf(state, opponentOf(me)).hand.length === 0) return false;
  return creaturesControlledBy(state, me).length > 0;
}

/**
 * Whether tapping `taps` would leave a held counterspell unpayable.
 *
 * The sources the spend would take come from `planPayment`, the same planner
 * `reduce` runs when the action is applied, so this asks the question against
 * the plan that would actually happen rather than against a mana count. That is
 * what makes the reservation colored on both ends: a generic pip that would eat
 * the seat's only Island breaks the hold, and the same pip paid off a Forest
 * does not.
 *
 * One imprecision, named rather than fixed: `canPay` counts the seat's mana
 * pool as well as its untapped sources, and the pool is not emptied here the
 * way paying for the spend would empty it. This agent never activates a mana
 * ability on its own (`activateManaAbility` scores -10), so the pool is empty
 * at essentially every priority it is asked about, and when it is not the error
 * runs toward holding *less* often, which is the safe direction for a policy
 * whose cost is a skipped turn.
 */
function breaksHold(
  state: GameState,
  me: PlayerId,
  fromHand: ObjectId | null,
  taps: readonly ObjectId[],
): boolean {
  if (taps.length === 0) return false;
  if (!holdWindowOpen(state, me)) return false;
  const reserve = affordableCounterInHand(state, me, fromHand);
  if (reserve === null) return false;
  return !canPay(state, me, reserve, taps);
}

/**
 * Whether this seat should decline this cast to keep a counterspell live.
 *
 * `castValue` prices the act of casting and nothing else, so before `mtg-c86f`
 * this agent spent every land it had on its own main phase and then watched the
 * opponent resolve a spell it was holding the answer to. A counterspell is the
 * one card in the vocabulary that this makes structurally uncastable rather
 * than merely badly timed: "counter target spell" chooses its target off the
 * stack (`target-choices.ts`), so with an empty stack there is no legal target,
 * CR 601.2c fails, and `castOptions` never enumerates the cast at all. The
 * agent could not have spent the mana on it even if it wanted to, and by the
 * time the window opened the mana was gone. Measured over 200 seeded games of a
 * blue deck against a red one, 756 of the 1,293 priority windows where this
 * agent held a counterspell against an opposing spell offered it no legal cast,
 * every one of them for want of two mana.
 *
 * The reservation is deliberately for that class alone, and not for every
 * instant. Every other instant in the vocabulary is castable at sorcery speed,
 * so this agent already casts them on its own turn and no mana it holds makes
 * one *possible* — holding would only make it better timed, which is a judgment
 * about the opponent's board and hand that this agent has nowhere to put.
 * Widening the reserve to all instants would move every balance number in every
 * set for a policy with no argument behind it; `@mtg/sim`'s `castTimingAllows`
 * is where instant timing is a policy with a profile.
 *
 * What the seat gives up when it holds is a turn of development: it declines
 * the spell it could have cast, and if the opponent casts nothing the mana goes
 * unspent and the card stays in hand — where, at a full grip, cleanup can
 * discard it (CR 514.1, and `discardValue` above pitches the most expensive
 * card, which is usually exactly the spell the hold declined). That is a real
 * price and this agent pays it blind: it cannot tell a turn where holding wins
 * the game from one where it loses it. `holdWindowOpen` bounds how often the
 * bill comes due; it does not make the trade free.
 *
 * Three casts are never held back. A land is not a spend. A counterspell is the
 * thing being held for, so reserving against it would be a seat refusing to
 * cast the card it kept the mana for — and with two in hand, refusing both. And
 * a cast the planner cannot pay for is not a decision this policy gets to make:
 * `legal.ts` already refused it.
 */
function castBreaksHold(
  state: GameState,
  me: PlayerId,
  action: Extract<Action, { type: 'castSpell' }>,
): boolean {
  const card = getObject(state, action.oid).card;
  if (card.kind === 'land' || countersSpells(card)) return false;
  const plan = planPayment(state, me, effectiveManaCost(state, me, card, action.x), action.oid);
  if (plan === null) return false;
  return breaksHold(state, me, action.oid, plan.taps);
}

/**
 * The activation arm of the same policy.
 *
 * An activation is mana off the table exactly as a cast is, and the arm below
 * already exists to spend *leftover* mana. Left unguarded it would spend the
 * reserve instead — the agent would decline the creature, pass, and then hand
 * the same two lands to a pinger. `tapSelf` is excluded from the sources for
 * the reason `onActivateAbility` excludes it: the permanent taps as part of the
 * cost, so it was never going to pay for anything else.
 *
 * The announced X is resolved into the cost first, for the same reason the
 * reducer resolves it: an `{X}{G}{G}` activation for six takes six more mana off
 * the table than the printed cost says, and planning against the printed cost
 * would let the agent spend its counterspell's reserve on the one option whose
 * real cost it never read.
 */
function activationBreaksHold(
  state: GameState,
  me: PlayerId,
  action: Extract<Action, { type: 'activateAbility' }>,
): boolean {
  const ability = activatedAbilityAt(state, action.oid, action.abilityIndex);
  if (ability === undefined) return false;
  const plan = planPayment(
    state,
    me,
    resolveX(ability.cost.mana, action.x ?? 0),
    undefined,
    ability.cost.tapSelf ? [action.oid] : [],
  );
  if (plan === null) return false;
  return breaksHold(state, me, null, plan.taps);
}

/**
 * Priorities: play a land, then the biggest castable spell, then attack with
 * everything, block profitably (or chump when facing lethal), pitch the
 * clunkiest cards. Mana abilities are never activated on their own — casting
 * auto-taps what it needs.
 *
 * One exception to "the biggest castable spell", and it is the only place this
 * agent declines an option it could take: while it holds a counterspell it can
 * afford, it will not spend the mana that counterspell needs (`mtg-c86f`,
 * `castBreaksHold` above). What it gives up by holding, and the two conditions
 * that stop it holding forever, are argued there.
 */
export function simpleAgent(name: string): PlayerAgent {
  return scoringAgent(name, (action, view) => {
    const state = view.state;
    switch (action.type) {
      case 'passPriority':
        return 0;
      case 'playLand':
        return 100;
      case 'castSpell':
        // `effectsFor` rather than `card.effects`: a modal spell (CR 700.2)
        // prints nothing in its flat list, so reading that list scored every
        // mode of every modal cast at exactly zero — a tie the agent breaks by
        // enumeration order, which is the bolt aimed at whichever creature
        // entered the battlefield first, usually its own. The action already
        // carries the chosen mode, and this is the one arm of this file where
        // that index is a live value — `answerMay` below reads a mode too, but
        // the DSL refuses a card that prints both a "you may" and a mode list,
        // so its read can only ever resolve to the flat list.
        //
        // The hold-open check runs before the act is priced, not as a term
        // inside it (`mtg-c86f`). `aimedValue` already reads a negative bonus
        // as a refusal, and a hold is the same verdict from a different
        // question — "this points somewhere it should not" and "this spends
        // mana this seat needs" are both answers of "not this option", and
        // neither is a number to be traded off against a bigger creature.
        if (castBreaksHold(state, view.player, action)) return HELD_OPEN;
        return aimedValue(
          castValue(state, action),
          effectTargetBonus(
            state,
            view.player,
            effectsFor(getObject(state, action.oid).card, action.mode ?? null),
            action.targets,
            action.x ?? 0,
          ),
        );
      case 'activateManaAbility':
        return -10;
      case 'activateAbility': {
        // Below every cast and above passing: this agent spends leftover mana
        // on an ability rather than holding it, and never at the price of a
        // spell. It scores the act, not the targets — the tier-1 bots in
        // `@mtg/sim` are where target choice is a policy, and this one exists
        // to prove the kernel plays a game through, not to play it well.
        //
        // The one thing it does read is which way the ability points, through
        // the same `aimedValue` floor the cast arm uses. A flat score here
        // meant a pinger with no opposing creature shot one of its own, for
        // exactly the reason the cast arm did.
        if (activationBreaksHold(state, view.player, action)) return HELD_OPEN;
        const ability = activatedAbilityAt(state, action.oid, action.abilityIndex);
        return aimedValue(
          20,
          effectTargetBonus(state, view.player, ability?.effects ?? [], action.targets, action.x ?? 0),
        );
      }
      case 'chooseTriggerTargets':
        // The one arm where scoring the act rather than the targets would be
        // meaningless: every option here *is* the same act, and they differ only
        // in where the ability points. A flat score would take enumeration order
        // — the first creature on the battlefield, which is usually the
        // opponent's oldest permanent — and the mechanic would fire every game
        // and do the wrong thing every time.
        return effectTargetBonus(state, view.player, triggerEffectsOf(state, action.oid), action.targets);
      case 'answerOptionalTrigger': {
        // Declining is worth exactly nothing, which is the right floor: a "may"
        // is taken when taking it beats not taking it and left alone otherwise.
        // The targets were already chosen — by this same agent, one decision ago
        // — so this scores the ability as it now stands rather than at its best.
        if (!action.accept) return 0;
        const entry = state.stack.find((item) => item.oid === action.oid);
        return effectTargetBonus(
          state,
          view.player,
          triggerEffectsOf(state, action.oid),
          entry?.targets ?? [],
        );
      }
      case 'answerMay': {
        // The same floor `answerOptionalTrigger` uses, and for the same
        // reason: declining is worth nothing, so a "you may" is taken only
        // when taking it beats leaving it alone.
        //
        // `entry.mode` rather than `null`, though it is null every time this
        // runs: `checkEffects` refuses a card carrying both `may` and `modes`
        // (`MAY_AND_MODES_BOTH_PRESENT`), so a modal "you may" cannot be built
        // and nothing here can distinguish the two. Reading the entry is the
        // shape every other resolution site uses, and it is the shape that
        // stays correct if that rule is ever relaxed; a hard-wired `null`
        // would answer with the empty flat list the day it was.
        if (!action.accept) return 0;
        const pending = spellAwaitingMay(state);
        if (pending === null) return 0;
        return effectTargetBonus(
          state,
          view.player,
          effectsFor(pending.card, pending.entry.mode),
          pending.entry.targets,
        );
      }
      case 'answerUnless': {
        // The one answer in this agent with no zero floor, because both arms
        // cost something: paying is scored as the mana it takes off the table,
        // declining as what the spell then does.
        //
        // Declining is scored from the *caster's* seat and negated, not from
        // the seat being charged. `effectTargetBonus` prices a harmful effect
        // aimed at the scoring player's own permanent at a flat -8, which is a
        // sentinel that keeps this agent from aiming its own removal at itself
        // and says nothing about which permanent was aimed at; read as the cost
        // of losing the creature it makes a {2} on a Bear and a {2} on a dragon
        // come out identically. From the other seat the same function returns
        // `3 + power + toughness`, which is the number that differs.
        // `@mtg/sim`'s `answerUnless` states the same argument at length and is
        // where the real version of this policy lives.
        //
        // What neither reads is what that mana was being saved for. A policy
        // that weighs the toll against the payer's own turn belongs to
        // `@mtg/sim`'s tier-1 bots, the same place `keepLegend` sends its own.
        const pending = spellAwaitingUnless(state);
        if (pending === null) return 0;
        if (action.pay) return -manaValue(pending.clause.cost);
        return -effectTargetBonus(
          state,
          pending.entry.controller,
          effectsFor(pending.card, pending.entry.mode),
          pending.entry.targets,
        );
      }
      case 'keepLegend':
        // CR 704.5j, and the second arm where scoring the act would be
        // meaningless: every option keeps a legend, and they differ only in
        // which one survives. Body and counters, less what has already been
        // marked on it, which is the whole of what this agent can read about a
        // permanent — a real policy belongs to `@mtg/sim`'s tier-1 bots.
        return (
          powerOf(state, action.oid) +
          toughnessOf(state, action.oid) -
          (getObject(state, action.oid).damage > 0 ? 1 : 0)
        );
      case 'sacrificePermanent':
        // CR 701.17a, and `keepLegend`'s formula negated rather than a second
        // one: that switch scores the option `scoringAgent` should take, and
        // the option this agent should take between two creatures it is being
        // made to give up is the cheaper one — the same body-and-damage read,
        // pointed at the loss instead of the keep. A real policy belongs to
        // `@mtg/sim`'s tier-1 bots, `keepLegend`'s stated reason.
        return -(
          powerOf(state, action.oid) +
          toughnessOf(state, action.oid) -
          (getObject(state, action.oid).damage > 0 ? 1 : 0)
        );
      case 'scry':
        // The unchanged top order is enumerated first. This minimal agent has
        // no card-quality policy, so retaining it is the honest default.
        return 0;
      case 'chooseFromGraveyard':
        // `searchLibrary` below, one zone over and with the same caveat: this
        // agent has no card-quality policy, so every match ties and the tie
        // breaks on the order `graveyardChoiceDecision` enumerated, which is
        // graveyard order. Taking something still beats taking nothing, because
        // an agent that always declined would make every recursion spell in a
        // generated set a blank and the balance simulations would report that as
        // a fact about the set.
        return action.chosen === null ? 0 : 1;
      case 'searchLibrary':
        // Taking a card beats failing to find, and every card the filter
        // matched scores the same. This agent has no card-quality policy (see
        // `scry` above), but "found something" and "found nothing" are not a
        // tie the way two orderings of the same two cards are: a search that
        // always declined would make every tutor in a generated set a blank,
        // and the simulations that read those sets would report it as balance.
        // `searchDecision` enumerates the matches first and the null last, so
        // the tie among matches breaks on library order, which is where the
        // seeded shuffle already put it.
        return action.found === null ? 0 : 1;
      case 'declareAttackers':
        return attackValue(state, action);
      case 'declareBlockers':
        return blockValue(state, view, action);
      case 'orderBlockers':
        return 0;
      case 'discard':
      case 'chooseDiscards':
        return discardValue(state, action);
      case 'keepHand':
        // This agent always keeps its opening seven. It exists to prove the
        // kernel plays a game through, and a mulligan policy is a judgment about
        // a hand — `@mtg/sim`'s tier-1 bots are where that judgment lives, with a
        // profile behind it. Keeping outranks mulliganing so the game starts on
        // the hand it was dealt, whatever the deck looks like.
        return 1;
      case 'mulligan':
        return 0;
      case 'concede':
        return -1000;
    }
  });
}
