/**
 * Mana pools, mana abilities and cost payment.
 *
 * Two honest pieces of machinery, both required by the rules and both visible
 * in the event log:
 *
 *  - a real pool per player that empties at the end of every step and phase
 *    (CR 106.4), with the wasted amount logged;
 *  - a payment planner that decides which untapped sources to tap for a cost.
 *
 * Tapping a source for mana is available to agents as its own action, because
 * mana abilities are a legal thing to do with priority. Casting additionally
 * auto-taps whatever the pool is short by, using the plan below, so the agent's
 * action space stays about *plays* rather than about clicking lands.
 *
 * Which sources that plan spends is decided against the rest of the payer's own
 * hand — spend what the hand needs least — because a planner that sees only the
 * cost in front of it will pay a generic pip with the only Forest while a green
 * one-drop sits in hand. `planPayment` states the model and its limits.
 *
 * A source is *not* one mana. `tapPromise` is the whole of what the planner is
 * allowed to believe about a permanent, and it is deliberately a promise rather
 * than a reading of the board: a chosen color and a fixed count of it. Gilded
 * Lotus adds three of one color the player picks, so a planner whose candidate
 * model was `landProduces` — lands only, one mana per tap — could not pay `{5}`
 * off two of them and had no reason to give for the refusal, because it never
 * saw them. What `tapPromise` refuses to promise is listed on it.
 *
 * Still fully deterministic: same state, same taps, every time. The choice
 * among equally good lands is the first of them in board order — not a random
 * one and not a seeded one, which `firstOfEquals` explains — so `replaySession`
 * reproduces a game byte for byte and two identical Plains tap in the order
 * they were played.
 */
import type { ActivatedAbility, Card, Color, ManaCost } from '@mtg/dsl';
import { COLORS, manaAbilityOf, manaValue } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { controllerOf, hasCardType, hasKeyword, isCreatureObject } from './layers';
import type { GameObject, GameState, ManaColor, ManaPool } from './state';
import { EMPTY_MANA_POOL } from './state';
import type { Trace } from './trace';
import { emit, playerOf, updatePlayer, withState } from './trace';
import { battlefieldObjects, tapObject } from './zones';

export function poolTotal(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

export function addMana(pool: ManaPool, color: ManaColor, amount: number): ManaPool {
  return { ...pool, [color]: pool[color] + amount };
}

/** Mana choices printed on a land, with colorless `C` explicit. */
export function landProduces(card: Card): readonly ManaColor[] {
  if (card.kind !== 'land') return [];
  return card.producesMana;
}

/**
 * Spends a cost out of a pool, or returns `null` when the pool cannot cover it.
 * Colored pips come from their own color; generic is paid colorless-first,
 * then WUBRG, which cannot strand a needed pip because pips are taken first.
 */
export function payFromPool(pool: ManaPool, cost: ManaCost): ManaPool | null {
  let remaining: ManaPool = pool;
  for (const color of COLORS) {
    const need = cost[color];
    if (remaining[color] < need) return null;
    remaining = { ...remaining, [color]: remaining[color] - need };
  }
  let generic = cost.generic;
  for (const source of ['C', ...COLORS] as const) {
    if (generic <= 0) break;
    const spend = Math.min(generic, remaining[source]);
    remaining = { ...remaining, [source]: remaining[source] - spend };
    generic -= spend;
  }
  return generic > 0 ? null : remaining;
}

export interface PaymentPlan {
  /** Sources to tap, in the order they are tapped. */
  readonly taps: readonly ObjectId[];
  /** Color each tapped source is asked to produce, parallel to `taps`. */
  readonly produces: readonly ManaColor[];
  /**
   * How much of that color each tap adds, parallel to `taps`.
   *
   * Carried on the plan rather than re-read off the card by `executePayment`,
   * because a second derivation of the amount is a second chance for the plan
   * and the pool to disagree — which is the bug this field was added to close.
   */
  readonly amounts: readonly number[];
}

/**
 * What one untapped permanent promises the planner: a choice of colors, and how
 * many of the one chosen color arrive.
 *
 * `amount` is never a sum across `colors`. A Forest is `['G']` and one; a dual
 * is `['W','U']` and one; Gilded Lotus is the five colors and three. Exactly
 * one color is chosen, which is the same shape `addMana` prints and the same
 * shape `activateManaAbility` has always carried.
 */
interface Candidate {
  readonly oid: ObjectId;
  readonly colors: readonly ManaColor[];
  readonly amount: number;
}

/** True when tapping is the entire activation cost — no mana, nothing else. */
function costIsOnlyTheTap(ability: ActivatedAbility): boolean {
  if (!ability.cost.tapSelf) return false;
  // `hasX` is asked beside the value because an `{X}` cost has a mana value of
  // zero and is not free; nothing prints one on a mana ability today, and a
  // guard that reads the flag cannot be surprised by the first card that does.
  if (ability.cost.mana.hasX || manaValue(ability.cost.mana) > 0) return false;
  if (ability.cost.sacrificeSelf) return false;
  if (ability.cost.sacrificeOther !== undefined) return false;
  if (ability.cost.discard !== undefined) return false;
  return ability.loyaltyCost === undefined;
}

/**
 * What this permanent promises if the planner taps it now, or `null` when it
 * promises nothing the planner may act on.
 *
 * A land's promise is CR 605.1a's intrinsic ability: one mana, from the printed
 * choices. Everything else prints an activated mana ability, and the promise is
 * that ability's `produces` and `amount`.
 *
 * Four things it deliberately refuses to promise rather than guess at:
 *
 *  - **An amount that is computed.** Cabal Coffers adds one per Swamp. That is
 *    a number the board decides at resolution and the planner would have to
 *    evaluate to know; a plan built on a guess is a plan `executePayment`
 *    throws on. So a computed amount is not a candidate.
 *  - **A cost that is more than the tap.** Paying for the payment is a
 *    recursion this planner does not do, so a mana ability that also charges
 *    mana, a sacrifice or a discard is left to the player to activate by hand
 *    through `activateManaSource`, which does pay it.
 *  - **A tap that is not legal now.** CR 302.6: a summoning-sick creature
 *    cannot pay `{T}` unless it has haste (CR 702.10c). `activationBlocker` says
 *    the same thing for the action; a plan that tapped one anyway would be a
 *    plan the reducer refuses.
 *  - **A repeatable source.** Nothing here promises mana without turning
 *    sideways, because the planner spends each candidate once and a source that
 *    never taps is not spent by being used.
 */
function tapPromise(state: GameState, object: GameObject): Candidate | null {
  const colors = landProduces(object.card);
  if (colors.length > 0 && hasCardType(state, object.oid, 'land')) {
    return { oid: object.oid, colors, amount: 1 };
  }
  const ability = manaAbilityOf(object.card);
  if (ability === null || !costIsOnlyTheTap(ability)) return null;
  if (
    isCreatureObject(state, object.oid) &&
    object.summoningSick &&
    !hasKeyword(state, object.oid, 'haste')
  ) {
    return null;
  }
  for (const effect of ability.effects) {
    if (effect.kind !== 'addMana') continue;
    if (typeof effect.amount !== 'number' || effect.amount <= 0) return null;
    return effect.produces.length === 0
      ? null
      : { oid: object.oid, colors: effect.produces, amount: effect.amount };
  }
  return null;
}

function untappedManaSources(
  state: GameState,
  player: PlayerId,
  excluded: readonly ObjectId[] = [],
): readonly Candidate[] {
  return battlefieldObjects(state)
    .filter(
      (object) =>
        !object.tapped && !excluded.includes(object.oid) && controllerOf(state, object.oid) === player,
    )
    .flatMap((object) => {
      const candidate = tapPromise(state, object);
      return candidate === null ? [] : [candidate];
    })
    .sort((a, b) => (a.colors.length !== b.colors.length ? a.colors.length - b.colors.length : 0));
}

/**
 * How many sources of each color the rest of the payer's hand still wants.
 *
 * A reserve of 1 for green means "leave one green source standing"; 0 means the
 * hand does not care about green at all. It is a *max* over the hand rather
 * than a sum, because the question this answers is which single card gets cast
 * next, not how many cards can be cast this turn.
 */
type ColorReserve = Readonly<Record<Color, number>>;

const NO_RESERVE: ColorReserve = { W: 0, U: 0, B: 0, R: 0, G: 0 };

/**
 * Picks the first of equal candidates: the order in `untappedManaSources`.
 *
 * Equal means equal to the reserve model — same colors, same constraint, same
 * effect on what the hand can still cast. the playtester asked for a random
 * tiebreak here and then took the stable one on the evidence, which is worth
 * recording because the request was explicit: across 4,150 tests the only thing
 * the seeded version changed was two identical Plains swapping order inside a
 * pinned replay fixture. Random among genuine equals buys nothing the reserve
 * model has not already decided, and it costs a fixture regeneration on every
 * future change to the planner and makes "why did it tap that one" a question
 * with no answer.
 */
const firstOfEquals = (): number => 0;

/** Compares two ranking keys element by element; shorter keys never occur. */
function compareKeys(left: readonly number[], right: readonly number[]): number {
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return value - other;
  }
  return 0;
}

function sourcesPerColor(available: readonly Candidate[]): Record<Color, number> {
  const counts: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const candidate of available) {
    for (const color of candidate.colors) {
      if (color !== 'C') counts[color] += 1;
    }
  }
  return counts;
}

/**
 * How many of the hand's reservations tapping this land would break.
 *
 * `remaining` is counted over the lands still standing, this one included, so
 * `remaining <= reserve` is exactly "one fewer would drop below what the hand
 * wants". A land that produces a color nothing in hand needs, or a color there
 * is a spare source of, breaks nothing and is the one to spend.
 */
function reservationsBroken(
  candidate: Candidate,
  remaining: Readonly<Record<Color, number>>,
  reserve: ColorReserve,
): number {
  let broken = 0;
  for (const color of candidate.colors) {
    if (color === 'C') continue;
    if (reserve[color] > 0 && remaining[color] <= reserve[color]) broken += 1;
  }
  return broken;
}

/** The lowest-ranked candidate, with ties handed to `tiebreak`. */
function pickBy(
  candidates: readonly Candidate[],
  key: (candidate: Candidate) => readonly number[],
  tiebreak: (count: number) => number,
): Candidate | undefined {
  let bestKey: readonly number[] | null = null;
  let tied: Candidate[] = [];
  for (const candidate of candidates) {
    const rank = key(candidate);
    const order = bestKey === null ? -1 : compareKeys(rank, bestKey);
    if (order < 0) {
      bestKey = rank;
      tied = [candidate];
    } else if (order === 0) {
      tied.push(candidate);
    }
  }
  return tied[tiebreak(tied.length)];
}

/**
 * Builds a plan for `cost` out of `sources`, or returns `null` when they cannot
 * cover it.
 *
 * Colored pips are satisfied first and by the most constrained land, which is
 * the payability heuristic and stays the primary key: spending a dual on a pip
 * a mono land could have paid is how a plan strands the other pip. `reserve` is
 * the secondary key there and the primary one for generic, where nothing about
 * the cost in front of us says which land to spend.
 *
 * The final `payFromPool` is not a formality. `executePayment` throws when a
 * plan does not cover its cost, so a plan that does not is returned as `null`
 * here — an unpayable plan is never a preference the caller has to unpick.
 */
function buildPlan(
  startingPool: ManaPool,
  sources: readonly Candidate[],
  cost: ManaCost,
  reserve: ColorReserve,
  tiebreak: (count: number) => number,
): PaymentPlan | null {
  let pool = startingPool;
  const available = [...sources];
  const taps: ObjectId[] = [];
  const produces: ManaColor[] = [];
  const amounts: number[] = [];

  const tapFor = (candidate: Candidate, color: ManaColor): void => {
    taps.push(candidate.oid);
    produces.push(color);
    amounts.push(candidate.amount);
    pool = addMana(pool, color, candidate.amount);
    const index = available.findIndex((entry) => entry.oid === candidate.oid);
    if (index >= 0) available.splice(index, 1);
  };

  for (const color of COLORS) {
    let need = cost[color] - pool[color];
    while (need > 0) {
      const remaining = sourcesPerColor(available);
      const candidate = pickBy(
        available.filter((entry) => entry.colors.includes(color)),
        (entry) => [entry.colors.length, reservationsBroken(entry, remaining, reserve), entry.amount],
        tiebreak,
      );
      if (candidate === undefined) return null;
      tapFor(candidate, color);
      need -= candidate.amount;
    }
  }

  const afterPips = payFromPool(pool, { ...cost, generic: 0 });
  if (afterPips === null) return null;
  let genericShort = cost.generic - poolTotal(afterPips);
  while (genericShort > 0) {
    const remaining = sourcesPerColor(available);
    const candidate = pickBy(
      available,
      (entry) => [reservationsBroken(entry, remaining, reserve), entry.colors.length, entry.amount],
      tiebreak,
    );
    if (candidate === undefined) return null;
    tapFor(candidate, candidate.colors[0] ?? 'C');
    genericShort -= candidate.amount;
  }

  return payFromPool(pool, cost) === null ? null : { taps, produces, amounts };
}

/**
 * What the cards in a hand want a source of, per color.
 *
 * Deliberately takes cards and not a `GameState`: there is no seat, no player
 * id and no object table in scope, so this rule cannot reach a hand other than
 * the one it was handed. Its single caller resolves that list from the payer's
 * own seat, and the payer is the argument `planPayment` was called with.
 *
 * A card counts only if `sources` could pay for it as they stand. That is the
 * whole of the "is this card worth reserving for" question, and it settles
 * three at once: a seven-drop with four lands out reserves nothing, a `GG` card
 * with one Forest reserves nothing (preserving that Forest buys a cast that
 * cannot happen), and a color the battlefield cannot produce at all reserves
 * nothing.
 */
function handReserve(hand: readonly Card[], pool: ManaPool, sources: readonly Candidate[]): ColorReserve {
  const reserve: Record<Color, number> = { ...NO_RESERVE };
  for (const card of hand) {
    if (card.kind === 'land') continue;
    if (buildPlan(pool, sources, card.manaCost, NO_RESERVE, firstOfEquals) === null) continue;
    for (const color of COLORS) {
      if (card.manaCost[color] > reserve[color]) reserve[color] = card.manaCost[color];
    }
  }
  return reserve;
}

/**
 * Works out how to pay `cost` from the pool plus untapped lands, or returns
 * `null` when it is unpayable.
 *
 * Which lands get spent is decided against the rest of the payer's hand: with
 * three Swamps and a Forest on the battlefield and a green one-drop in hand, a
 * generic three taps the three Swamps. The cost in front of the planner cannot
 * see that on its own, and a generic pip eating the only Forest is how a hand
 * strands itself.
 *
 * The model is deliberately small, and here is what it does *not* consider: it
 * reserves colors, never a count of lands, so it will happily leave a Forest
 * standing that the hand cannot afford to use anyway; it ranks the hand's cards
 * by nothing (a bomb and a filler card reserve alike); it looks only at what is
 * castable from the untapped lands as they stand now, so a card one land drop
 * away reserves nothing; and it optimizes for the next single cast rather than
 * for the most cards castable this turn.
 *
 * `casting` names the object this payment is for when it is a card in the
 * payer's hand. Its own pips are the cost being paid, not a reason to reserve.
 *
 * Payability wins over every preference: when the preferred plan cannot cover
 * the cost the blind one is returned, so a hand-aware planner can never turn a
 * castable spell into an uncastable one.
 */
export function planPayment(
  state: GameState,
  player: PlayerId,
  cost: ManaCost,
  casting?: ObjectId,
  excludedSources: readonly ObjectId[] = [],
): PaymentPlan | null {
  const seat = playerOf(state, player);
  const sources = untappedManaSources(state, player, excludedSources);
  const hand = seat.hand
    .filter((oid) => oid !== casting)
    .map((oid) => state.objects[oid]?.card)
    .filter((card): card is Card => card !== undefined);

  const reserve = handReserve(hand, seat.pool, sources);
  const preferred = buildPlan(seat.pool, sources, cost, reserve, firstOfEquals);
  return preferred ?? buildPlan(seat.pool, sources, cost, NO_RESERVE, firstOfEquals);
}

/**
 * Whether the cost can be paid at all.
 *
 * Asks the blind planner on purpose. Preference never changes payability, and
 * this runs over every card in hand at every priority — `legal.ts` enumerates
 * with it — so it stays the cheap question it was.
 */
export function canPay(
  state: GameState,
  player: PlayerId,
  cost: ManaCost,
  excludedSources: readonly ObjectId[] = [],
): boolean {
  const seat = playerOf(state, player);
  return (
    buildPlan(
      seat.pool,
      untappedManaSources(state, player, excludedSources),
      cost,
      NO_RESERVE,
      firstOfEquals,
    ) !== null
  );
}

/**
 * Puts mana in a player's pool, without tapping anything.
 *
 * Split out of `produceMana` for the `addMana` effect, which produces mana in
 * two situations that have no tap in them: a ritual, where the source is a
 * spell on the stack and there is nothing to turn sideways, and a mana ability
 * whose source was already tapped as the cost was paid. The tap and the mana
 * were one function while a land was the only mana source, because a land's
 * intrinsic ability is exactly "turn sideways, get one".
 *
 * `manaProduced` already carried `amount`, so a source that produces two
 * reports one event with a two in it rather than two events — which is what a
 * counter over the log wants, and what CR 106.1 describes.
 */
export function addManaToPool(
  trace: Trace,
  player: PlayerId,
  sourceOid: ObjectId,
  color: ManaColor,
  amount: number,
): Trace {
  const state = updatePlayer(trace.state, player, (seat) => ({
    ...seat,
    pool: addMana(seat.pool, color, amount),
  }));
  return emit(withState(trace, state), {
    type: 'manaProduced',
    player,
    sourceOid,
    color,
    amount,
  });
}

/**
 * Taps one permanent for mana of the given color.
 *
 * `amount` defaults to one because a land's intrinsic ability adds one and that
 * is most of the callers; a source that adds three passes three, and one
 * `manaProduced` event carries the quantity either way.
 */
export function produceMana(
  trace: Trace,
  player: PlayerId,
  sourceOid: ObjectId,
  color: ManaColor,
  amount = 1,
): Trace {
  return addManaToPool(tapObject(trace, sourceOid), player, sourceOid, color, amount);
}

/**
 * Executes a plan and then spends the cost. Throws when the plan does not
 * actually cover the cost, which would mean `planPayment` and `payFromPool`
 * had drifted apart.
 */
export function executePayment(trace: Trace, player: PlayerId, cost: ManaCost, plan: PaymentPlan): Trace {
  let current = trace;
  for (const [index, oid] of plan.taps.entries()) {
    const color = plan.produces[index];
    if (color === undefined) throw new Error('payment plan is missing a color for a tapped source');
    const amount = plan.amounts[index];
    if (amount === undefined) throw new Error('payment plan is missing an amount for a tapped source');
    current = produceMana(current, player, oid, color, amount);
  }
  const pool = playerOf(current.state, player).pool;
  const remaining = payFromPool(pool, cost);
  if (remaining === null) throw new Error('payment plan did not cover the cost it was built for');
  const state = updatePlayer(current.state, player, (seat) => ({ ...seat, pool: remaining }));
  return emit(withState(current, state), { type: 'manaPaid', player, cost });
}

/** Empties both pools; called at the end of every step and phase. */
export function emptyManaPools(trace: Trace): Trace {
  let current = trace;
  for (const seat of current.state.players) {
    const wasted = poolTotal(seat.pool);
    if (wasted === 0) continue;
    const state = updatePlayer(current.state, seat.id, (player) => ({ ...player, pool: EMPTY_MANA_POOL }));
    current = emit(withState(current, state), {
      type: 'manaPoolEmptied',
      player: seat.id,
      wasted,
    });
  }
  return current;
}

/**
 * Convenience for tests and bots: total mana a player could produce right now.
 *
 * A sum of what each untapped source promises rather than a count of them, for
 * the reason `tapPromise` exists: a board of two Gilded Lotuses has six mana
 * available and two sources, and `cost.ts` reads this as the ceiling on X.
 */
export function availableMana(state: GameState, player: PlayerId): number {
  return untappedManaSources(state, player).reduce(
    (total, candidate) => total + candidate.amount,
    poolTotal(playerOf(state, player).pool),
  );
}

export function producibleColors(state: GameState, player: PlayerId): readonly Color[] {
  const colors = new Set<Color>();
  for (const candidate of untappedManaSources(state, player)) {
    for (const color of candidate.colors) {
      if (color !== 'C') colors.add(color);
    }
  }
  return COLORS.filter((color) => colors.has(color));
}
