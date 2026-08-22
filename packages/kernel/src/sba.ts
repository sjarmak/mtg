/**
 * State-based actions (CR 704).
 *
 * Checked whenever a player would receive priority and immediately after each
 * combat damage step, repeatedly until nothing more happens — one pass can
 * cause another (a creature dying can empty a combat that kills nothing else
 * here, but the loop is what keeps that correct as the slice grows).
 */
import { isAuraCard } from '@mtg/dsl';
import { illegalAttachments, unattach } from './attach';
import { annihilateCounters, counterCount } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import type { DestroyReason } from './events';
import { characteristicsOf, hasCardType, hasKeywordAbility, toughnessOf } from './layers';
import { destroyPermanent } from './destruction';
import type { GameEndReason, GameState, GameResult } from './state';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { withTurn } from './turn';
import { creaturesOnBattlefield, moveObject } from './zones';

interface Doomed {
  readonly oid: ObjectId;
  readonly reason: DestroyReason;
}

/** One player losing the game, tagged with the check that did it. */
interface Loss {
  readonly player: PlayerId;
  readonly reason: GameEndReason;
}

function doomedCreatures(state: GameState): readonly Doomed[] {
  const doomed: Doomed[] = [];
  for (const object of creaturesOnBattlefield(state)) {
    const toughness = toughnessOf(state, object.oid);
    if (toughness <= 0) {
      doomed.push({ oid: object.oid, reason: 'zeroToughness' });
      continue;
    }
    if (object.damage >= toughness) {
      if (!hasKeywordAbility(state, object.oid, 'indestructible')) {
        doomed.push({ oid: object.oid, reason: 'lethalDamage' });
      }
      continue;
    }
    if (object.deathtouched && object.damage > 0) {
      if (!hasKeywordAbility(state, object.oid, 'indestructible')) {
        doomed.push({ oid: object.oid, reason: 'deathtouch' });
      }
    }
  }
  return doomed;
}

/** CR 704.5i: a planeswalker with no loyalty is put into its owner's graveyard. */
function zeroLoyaltyPlaneswalkers(state: GameState): readonly ObjectId[] {
  return state.battlefield.filter((oid) => {
    const object = state.objects[oid];
    return (
      object !== undefined &&
      hasCardType(state, oid, 'planeswalker') &&
      counterCount(object.counters, 'loyalty') === 0
    );
  });
}

/**
 * CR 704.5d: a token in a zone other than the battlefield ceases to exist.
 *
 * "Ceases to exist" is modeled as exile, which keeps every zone list consistent
 * with every object's `zone` field and costs nothing: v0 has no card that reads
 * exile. So the check is "a token that is neither on the battlefield nor
 * already gone", and every route off the battlefield reaches it — the
 * destruction and legend-rule sweeps below, the sacrifice `reduce.ts` pays an
 * activation cost with, a `returnToHand` that bounces one. `moveObject` used to
 * redirect a token to exile itself; it no longer redirects anything, and this
 * is the single place a token stops existing.
 *
 * Being a state-based action rather than a line in `moveObject` is the whole of
 * why a token's death trigger fires. The token reaches its owner's graveyard,
 * `zoneChanged` records that, `conditionsFrom` derives `selfDies` from the
 * record, and the sweep happens afterwards. `settle` orders the two correctly
 * without knowing about either: state-based actions run before the trigger
 * scan, but the scan reads the trace's *events*, not the board, and
 * `collectTriggers` reads the printed text off the object record — which
 * survives the sweep exactly as a sacrificed card's does.
 *
 * Every object is scanned rather than only the graveyards, because a graveyard
 * is not the only zone a token can be moved to: `returnToHand` puts one in a
 * hand, and a token milled or drawn would be in a library or a hand too. One
 * predicate over `state.objects` covers each of them without a list of routes
 * to keep in step with `effects.ts`.
 *
 * `ceased-tokens.test.ts` states each of those zones, because the sentence
 * above used to be true of the code and checked by nothing: narrowing this
 * predicate to a graveyard left the whole repository green while a bounced
 * token waited in a hand to be played again. Exile is in the skip for its own
 * reason. A token there has nowhere further to go, and sweeping it again is a
 * pass that reports a change and moves nothing, which is the one way this loop
 * misses its fixed point and throws.
 */
function ceasedTokens(state: GameState): readonly ObjectId[] {
  const gone: ObjectId[] = [];
  for (const object of Object.values(state.objects)) {
    if (!object.token) continue;
    if (object.zone === 'battlefield' || object.zone === 'exile') continue;
    gone.push(object.oid);
  }
  return gone;
}

/**
 * One violation of the legend rule: every permanent a player controls under a
 * single legendary name, in entry order.
 */
export interface LegendCollision {
  readonly controller: PlayerId;
  readonly name: string;
  /** Two or more, oldest first; exactly one of them survives. */
  readonly candidates: readonly ObjectId[];
}

/**
 * CR 704.5j: a player who controls two or more legendary permanents with the
 * same name chooses one, and the rest go to their owners' graveyards.
 *
 * **The choice is the controller's and this kernel asks for it.** That is why
 * this returns a collision rather than a victim list: the sweep cannot finish on
 * its own, so `checkStateBasedActions` raises a `legendRule` stop and the answer
 * arrives as a `keepLegend` action. A fixed tiebreak on entry order stood in for
 * the pick until `mtg-bc2.149` was finished, and a tiebreak is a legal board
 * reached by a decision nobody made — the class of bug that is invisible,
 * because the position it produces looks correct.
 *
 * Why the two names collided is not read at all. An arrival, a change of
 * control and a copy effect all end at this one grouping, so the question is
 * asked about *every* permanent under the name rather than about the one that
 * changed. That is the rule: CR 704.5j offers the controller all of them,
 * including the copy they have held all along.
 *
 * One collision at a time, and the first in entry order. Two players can each be
 * in violation at once, and one player can be in violation under two names; each
 * of those is its own question with its own answer, because asking them together
 * would need an action carrying one permanent per collision and a legality rule
 * for a partly answered board. The loop in `checkStateBasedActions` comes
 * straight back and asks the next one, so a board with four collisions costs
 * four answers and settles.
 *
 * Name, legendary-ness and control are read through the layer system rather
 * than off the printed card, so a layer 1 copy effect (the copy takes the
 * copied name and supertypes) and a layer 2 control-change effect both reach
 * this check. Reading name and supertypes off `GameObject.card` instead turns
 * the two copy boards red; reading the controller off the object turns the
 * control boards red.
 *
 * Nothing else can change a name: layer 3 rewrites subtypes only, layer 4 has
 * no supertype field, and the only continuous effects the kernel builds from a
 * card are layer 6 and layer 7c (`abilities.ts`, `effects.ts`). A token is
 * narrower still: `TokenSpec` has fields for a name, a body, colors, subtypes,
 * keywords and printed abilities, and none for a supertype, so `tokenCard`
 * (`@mtg/dsl`) writes an empty list and a token sharing a legend's name is
 * passed over. Layer 1 is the one thing that can hand it the supertype, and a
 * token copying a legend is offered like anything else — the loser goes to its
 * owner's graveyard, which is what CR 704.5j does, and then out of existence on
 * the next pass, which is `ceasedTokens` above. Both token boards are tests.
 */
export function pendingLegendCollision(state: GameState): LegendCollision | null {
  const groups = new Map<string, ObjectId[]>();
  const order: string[] = [];
  for (const oid of state.battlefield) {
    const current = characteristicsOf(state, oid);
    if (!current.supertypes.includes('legendary')) continue;
    // NUL separates the two halves because it cannot appear in a card name, so
    // no pair of controller and name can spell the same key as another pair.
    const key = `${current.controller}\u0000${current.name}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [oid]);
      order.push(key);
    } else {
      group.push(oid);
    }
  }
  for (const key of order) {
    const candidates = groups.get(key);
    const first = candidates?.[0];
    if (candidates === undefined || first === undefined || candidates.length < 2) continue;
    const current = characteristicsOf(state, first);
    return { controller: current.controller, name: current.name, candidates };
  }
  return null;
}

/**
 * Raises CR 704.5j's question for the controller of a collision.
 *
 * Priority is left exactly where it was, the way `askForTriggerTargets` leaves
 * it: `pendingDecision` prefers an `awaiting` over a priority window, so the
 * question is asked first and the window is still owed to whoever held it once
 * the answer clears the stop.
 */
function askLegendChoice(trace: Trace, collision: LegendCollision): Trace {
  return withState(
    trace,
    withTurn(trace.state, { awaiting: 'legendRule', awaitingPlayer: collision.controller }),
  );
}

/**
 * CR 704.5j applied: everything in the pending collision except the permanent
 * its controller kept goes to its owner's graveyard.
 *
 * The collision is re-derived here rather than carried over from the question,
 * because the answer arrives in a later `reduce` call and the board is the
 * authority on what is still in violation. `reduce` validates the answer against
 * the same derivation first, so both throws guard a caller that applies an
 * action directly rather than a path an agent can reach.
 *
 * CR 704.5j *puts* the losers into the graveyard rather than destroying them, so
 * they get no `permanentDestroyed` event: nothing that replaces a destruction
 * can save one, while anything watching for a permanent dying still sees it
 * leave the battlefield.
 */
export function keepLegend(trace: Trace, kept: ObjectId): Trace {
  const collision = pendingLegendCollision(trace.state);
  if (collision === null) throw new Error('keepLegend: no legend rule collision is pending');
  if (!collision.candidates.includes(kept)) {
    throw new Error(`keepLegend: ${kept} is not one of the ${collision.name} permanents`);
  }
  let current = trace;
  for (const oid of collision.candidates) {
    if (oid === kept) continue;
    current = moveObject(current, oid, 'graveyard');
  }
  return current;
}

/**
 * The players who lose on this pass (CR 704.5a, 704.5b), in seat order.
 *
 * Seats already marked `lost` are skipped, so what comes back is exactly the
 * subset of the players *still in the game* that lose right now — which is the
 * set CR 104.4b's draw test asks about.
 */
function losingPlayers(state: GameState): readonly Loss[] {
  const losing: Loss[] = [];
  for (const seat of state.players) {
    if (seat.lost) continue;
    if (seat.life <= 0) {
      losing.push({ player: seat.id, reason: 'lifeZero' });
      continue;
    }
    if (seat.attemptedDrawFromEmptyLibrary) {
      losing.push({ player: seat.id, reason: 'emptyLibrary' });
    }
  }
  return losing;
}

/**
 * CR 704.5q: +1/+1 and -1/-1 counters on the same permanent annihilate in
 * pairs. It lives here rather than in the layer system on purpose — the layers
 * *read* counters (7d), they do not change them, and this is a state-based
 * action that rewrites the object.
 */
function annihilateOpposedCounters(trace: Trace): Trace {
  let current = trace;
  for (const oid of current.state.battlefield) {
    const object = current.state.objects[oid];
    if (object === undefined) continue;
    const reduced = annihilateCounters(object.counters);
    if (reduced === object.counters) continue;
    current = withState(current, {
      ...current.state,
      objects: { ...current.state.objects, [oid]: { ...object, counters: reduced } },
    });
    current = emit(current, {
      type: 'countersChanged',
      oid,
      plusOnePlusOne: reduced.plusOnePlusOne,
      minusOneMinusOne: reduced.minusOneMinusOne,
    });
  }
  return current;
}

function playersStillInGame(state: GameState): number {
  return state.players.filter((seat) => !seat.lost).length;
}

function markLost(state: GameState, losses: readonly Loss[]): GameState {
  let current = state;
  for (const loss of losses) {
    current = updatePlayer(current, loss.player, (seat) => ({ ...seat, lost: true }));
  }
  return current;
}

/**
 * Ends the game from a set of simultaneous losses.
 *
 * One loser hands the win to the other (CR 104.2a). Every player still in the
 * game losing at the same instant is a draw instead (CR 104.4b): `winner` and
 * `loser` are both null and every seat is flagged `lost`. Either way each loser
 * gets its own `playerLost` event carrying its own reason, so a mixed-cause
 * simultaneous loss loses no information to the single summary `result.reason`.
 */
function endGame(trace: Trace, losses: readonly Loss[]): Trace {
  const first = losses[0];
  if (first === undefined) throw new Error('endGame: called with no losing player');
  const drawn = losses.length === playersStillInGame(trace.state);
  const winner = drawn ? null : opponentOf(first.player);
  const loser = drawn ? null : first.player;
  const result: GameResult = {
    winner,
    loser,
    reason: first.reason,
    endedOnTurn: trace.state.turn.number,
  };
  const state: GameState = { ...markLost(trace.state, losses), result };

  let current = withState(trace, state);
  for (const loss of losses) {
    current = emit(current, { type: 'playerLost', player: loss.player, reason: loss.reason });
  }
  return emit(current, { type: 'gameEnded', winner, reason: result.reason, turn: state.turn.number });
}

/**
 * Runs state-based actions to a fixed point. Player losses are checked first,
 * so a lethal combat damage step ends the game before dead creatures are swept,
 * and the whole set of losses is collected before the game is ended, so
 * simultaneous losses are scored together rather than resolved one at a time.
 */
export function checkStateBasedActions(trace: Trace): Trace {
  let current = trace;
  for (let pass = 0; pass < 64; pass += 1) {
    if (current.state.result !== null) return current;

    const losing = losingPlayers(current.state);
    if (losing.length > 0) return endGame(current, losing);

    // CR 704.5j is the one state-based action a player answers, so it is raised
    // as a question and nothing else on this pass is performed. Nothing changes
    // while the game waits — asking is not an action — so the pass that resumes
    // reads the same board this one did, and every other action of that pass
    // happens there, together, as CR 704.3 has them.
    //
    // Both guards are load bearing. The first is why a pass that already asked
    // does nothing rather than sweeping the dead around an open question: this
    // function is called again from `settle` and from `finishResolution`, and
    // without it a creature at lethal damage on the same board died while its
    // controller was still being asked about a legend. The second keeps the
    // question from clobbering one somebody else already owes — `cleanupStep`
    // raises a discard from inside `settle`, and one `awaiting` field can only
    // hold one of them, so the collision waits for the pass after that answer.
    if (current.state.turn.awaiting === 'legendRule') return current;
    if (current.state.turn.awaiting === null) {
      const collision = pendingLegendCollision(current.state);
      if (collision !== null) return askLegendChoice(current, collision);
    }

    const ceased = ceasedTokens(current.state);
    for (const oid of ceased) current = moveObject(current, oid, 'exile');

    // CR 704.5m and 301.5c. This runs a pass *after* the one that killed the
    // creature, because the host is still on the battlefield while the pass
    // that dooms it is reading the board, and CR 704.3 has every action of one
    // pass happen at once. The loop below is what gets there: a pass that
    // swept a dead creature always repeats, and this one reports its own
    // change so the pass after it repeats too.
    const stranded = illegalAttachments(current.state);
    for (const oid of stranded) {
      const source = current.state.objects[oid];
      current =
        source !== undefined && isAuraCard(source.card)
          ? moveObject(current, oid, 'graveyard')
          : unattach(current, oid);
    }

    const annihilated = annihilateOpposedCounters(current);
    const countersChanged = annihilated !== current;
    current = annihilated;

    const emptyWalkers = zeroLoyaltyPlaneswalkers(current.state);
    for (const oid of emptyWalkers) current = moveObject(current, oid, 'graveyard');

    const changed = ceased.length > 0 || stranded.length > 0 || countersChanged || emptyWalkers.length > 0;

    const doomed = doomedCreatures(current.state);
    if (doomed.length === 0) {
      // Another pass only if this one actually changed something (CR 704.3).
      //
      // No term can currently change an outcome, and that is a property of the
      // order above rather than of the rule. Every action this pass can perform
      // happens before the check it ends with, so a pass that ceased a token,
      // unattached a weapon or annihilated a pair has already re-read the board
      // it changed: the repeat pass finds the same answers and returns. The
      // legend rule is not among them for a second reason — it returns rather
      // than acting, so a pass that reached this line found no collision.
      // Deleting any of the three terms leaves the whole unit suite
      // green, which was measured rather than assumed. They stay because CR
      // 704.3 says to repeat and the cost is one pass over the objects, and the
      // first action added here that reads a zone other than the battlefield
      // makes the ceasing term load bearing for real.
      //
      // The unattachment term is inert for a second reason worth writing down:
      // an attachment ends by *removing* a bonus from a permanent that has
      // already stopped being a creature, so it can never be what kills
      // something. The day an Equipment can change the host it is not attached
      // to, that stops being true.
      if (changed) continue;
      return current;
    }

    const regenerationParticipates = doomed.some((victim) =>
      current.state.replacements.some(
        (effect) =>
          effect.modification.kind === 'regenerate' &&
          effect.trigger.kind === 'destroy' &&
          effect.trigger.oid === victim.oid,
      ),
    );
    if (regenerationParticipates) {
      for (const victim of doomed) current = destroyPermanent(current, victim.oid, victim.reason);
    } else {
      for (const victim of doomed) {
        current = emit(current, {
          type: 'permanentDestroyed',
          oid: victim.oid,
          reason: victim.reason,
        });
      }
      for (const victim of doomed) current = moveObject(current, victim.oid, 'graveyard');
    }
  }
  throw new Error('state-based actions did not reach a fixed point');
}

/**
 * Ends the game as a draw or a concession without going through SBAs.
 *
 * A named loser is flagged `lost` here too, so the seat flags mean the same
 * thing however the game ended — `endGame` above reads them to tell a
 * simultaneous loss from a partial one.
 */
export function endGameWith(
  trace: Trace,
  winner: PlayerId | null,
  loser: PlayerId | null,
  reason: GameEndReason,
): Trace {
  if (trace.state.result !== null) return trace;
  const result: GameResult = { winner, loser, reason, endedOnTurn: trace.state.turn.number };
  const marked =
    loser === null ? trace.state : updatePlayer(trace.state, loser, (seat) => ({ ...seat, lost: true }));
  const state: GameState = { ...marked, result };
  const next = withState(trace, state);
  const withLoss = loser === null ? next : emit(next, { type: 'playerLost', player: loser, reason });
  return emit(withLoss, { type: 'gameEnded', winner, reason, turn: state.turn.number });
}
