/**
 * The interruptible resolution runner, and the resolutions that pause.
 *
 * CR 608.2 resolves a spell's instructions in printed order and does not stop
 * to ask the reducer anything. Five of ours have to: CR 701.18 scry orders
 * cards its controller alone may look at, CR 701.19 search hands its
 * controller a library and asks which card comes out of it, CR 701.8 discard
 * asks somebody which cards leave a hand, `chooseFromGraveyard` asks which one
 * card comes back out of a graveyard, and CR 701.17's `sacrificePermanent`
 * asks a target player which of their own creatures leaves the battlefield.
 * None of those answers is derivable, all are choices, and a choice in this
 * kernel is an `Action` a seat submits — never a callback, never a heuristic
 * the resolver runs on the player's behalf.
 *
 * The fourth and fifth are the two whose zone is *public*, and it is worth
 * saying out loud because three files' worth of concealment machinery does not
 * apply to either: a graveyard is readable by both seats (CR 400.2) and so is
 * a battlefield (CR 403.2), so `PendingGraveyardChoice` and
 * `PendingPermanentSacrifice` have no arm in `visibility.ts` and nothing about
 * either question is hidden from the seat not being asked. What makes them
 * stop is the choice, not the secret.
 *
 * So `applyResolutionEffects` runs a resolution until it reaches one of those
 * effects and then *banks* the rest of it: the remaining steps, the `x` it
 * was cast for, the object headed for the graveyard when it finishes, the
 * exile tally a later step may count, and the triggers collected so far. That
 * bank is `PendingScry`, `PendingSearch`, `PendingHandDiscard`,
 * `PendingGraveyardChoice` or `PendingPermanentSacrifice` (`state.ts`),
 * `turn.awaiting` names which, and `legal.ts` offers exactly the matching
 * `Decision`. The answer comes back through `answerScry`, `answerSearch`,
 * `answerHandDiscard`, `answerGraveyardChoice` or `answerPermanentSacrifice`,
 * which apply it and call straight back into `applyResolutionEffects` with the
 * banked remainder.
 *
 * **One pending record per question, not per effect kind.** The alternative — a
 * single `PendingChoice` with a discriminated payload — was rejected for the
 * reason `@mtg/engine`'s `RecordedBackend`/`ObservedBackend` split gives: a
 * scry has a `count` and a card *order*, a search has a `filter`, a
 * `destination` and one card or none, and a shared record would let
 * `answerScry` typecheck against a pending search. The test is what the
 * *question* carries, not how many effect kinds reach it, which is why
 * `discardCards` and `chooseDiscard` share `PendingHandDiscard`: both ask
 * choose `count` of these cards, and the seat being asked and the hand's owner
 * are fields on the record rather than a reason for a second one. What is
 * shared across all three is the *shape* — bank the remainder, set `awaiting`,
 * resume through one function — and that is shared by construction here, not
 * by convention.
 */
import type {
  Amount,
  CardFilter,
  Effect,
  GraveyardArrivalGrant,
  GraveyardOwner,
  SearchDestination,
} from '@mtg/dsl';
import { isLiteralAmount } from '@mtg/dsl';
import { continuousEffectId, opponentOf } from './ids';
import type { ObjectId, PlayerId } from './ids';
import type { ZoneId } from './state';
import { applyEffect, evaluateAmount, playersInSweep, tallyThrough } from './effects';
import type {
  GameState,
  PendingGraveyardChoice,
  PendingHandDiscard,
  PendingPermanentSacrifice,
  PendingResolutionEffect,
  PendingScry,
  PendingSearch,
  ResolutionTally,
  Target,
} from './state';
import { NOTHING_TALLIED } from './state';
import { sacrificePermanent } from './destruction';
import type { ContinuousEffect } from './continuous';
import { onlyObject } from './continuous';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { collectTriggers, type PendingTrigger } from './triggers';
import { withTurn } from './turn';

/** The one member of the effect union this file's graveyard arm ever holds. */
type GraveyardChoiceEffect = Extract<Effect, { readonly kind: 'chooseFromGraveyard' }>;
import { graveyardMembers, printedFilter, selectPrinted } from './zone-filter';
import type { PrintedFilter } from './zone-filter';
import { creaturesControlledBy, moveObject, shuffleLibrary } from './zones';

function awaitScry(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  count: number,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  const cards = trace.state.players[controller].library.slice(0, count);
  const pendingScry: PendingScry = {
    player: controller,
    count,
    cards,
    sourceOid,
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'scry', awaitingPlayer: controller }),
    pendingScry,
  });
}

/**
 * The cards in a library a `searchLibrary` filter may take (CR 701.19a).
 *
 * A library is a hidden zone, so no `CharacteristicMap` exists for anything in
 * it and CR 611.2c leaves each card exactly what is printed on it —
 * `selectPrinted` is the selector written for that, and this is a second
 * caller for it rather than a second matcher. `asPrintedFilter` below carries
 * the conversion and the reason it is a function.
 */
export function searchableCards(state: GameState, player: PlayerId, filter: CardFilter): readonly ObjectId[] {
  return selectPrinted(state, state.players[player].library, asPrintedFilter(filter));
}

/**
 * The DSL's `CardFilter` as the selector's `PrintedFilter`.
 *
 * One function rather than the conversion written at each caller, because the
 * two callers must agree: `searchableCards` and `graveyardChoiceCards` are the
 * same predicate over two zones, and a field added to `CardFilter` and wired
 * into one of them would silently make the other's filter looser than the card
 * printed. `colors` is exactly that field — it arrived for Revive, which is a
 * graveyard clause, and `searchLibrary` inherits it here rather than by
 * somebody remembering.
 *
 * `keywords` is spelled out as `null` rather than left off, for the reason the
 * conversion existed before this: `PrintedFilter` carries seven required fields
 * where `CardFilter` carries six optional ones, and "don't care" is a value
 * this states rather than a thing `exactOptionalPropertyTypes` decides.
 *
 * `maxManaValue` is the second field to arrive by the route `colors` did, and
 * it names the same hazard: it was added for a graveyard clause (a bounded
 * return) and a search inherits it here rather than by somebody remembering
 * to wire the other caller.
 *
 * `names` is the third, arriving from the other direction: it was added for a
 * search clause (Squadron Hawk's) and the graveyard read inherits it here. The
 * hazard is symmetric and so is the fix.
 *
 * `excludeCardTypes` is the fourth and it arrives from a *third* direction,
 * which is what makes it the strongest case for the function existing.
 * `chooseDiscard` gained a filter for Duress and became this conversion's third
 * caller, so the field was written for a revealed hand — and a search and a
 * graveyard choice both inherit it here, on the same line, without either
 * caller being edited. Written at the call sites instead, a Duress that refuses
 * a creature would have sat next to a search that quietly did not.
 */
function asPrintedFilter(filter: CardFilter): PrintedFilter {
  return printedFilter({
    cardTypes: filter.cardTypes ?? null,
    excludeCardTypes: filter.excludeCardTypes ?? null,
    subtypes: filter.subtypes ?? null,
    supertypes: filter.supertypes ?? null,
    colors: filter.colors ?? null,
    names: filter.names ?? null,
    maxManaValue: filter.maxManaValue ?? null,
  });
}

/**
 * The cards a `chooseFromGraveyard` may take, in seat order.
 *
 * `searchableCards` over the other zone, and the two differences are both in
 * the zone rather than in the predicate. A graveyard is public, so nothing here
 * is being un-concealed by building the list — it is the legal-answer list and
 * only that. And `whose` names one graveyard or both, where a search is always
 * the controller's own library, so the member list comes from
 * `graveyardMembers` (which walks `PLAYER_IDS` in seat order for `'each'`) and
 * the order two seats' cards appear in is a fact about the position rather than
 * about which literal was written first.
 */
export function graveyardChoiceCards(
  state: GameState,
  controller: PlayerId,
  whose: GraveyardOwner,
  filter: CardFilter,
): readonly ObjectId[] {
  const members =
    whose === 'each'
      ? graveyardMembers(state, 'each')
      : graveyardMembers(state, whose === 'you' ? controller : opponentOf(controller));
  return selectPrinted(state, members, asPrintedFilter(filter));
}

/**
 * Where a search's destination puts a card, and whether it arrives tapped.
 *
 * The one place `SEARCH_DESTINATIONS`' third member is read back apart, which
 * is what its docblock in `@mtg/dsl` promises: everything upstream carries the
 * destination as one word, and `battlefieldTapped` becomes a zone plus a
 * boolean here and nowhere else. A second reader would be a second chance to
 * forget the tap.
 */
function searchDestinationZone(destination: SearchDestination): { zone: ZoneId; tapped: boolean } {
  return destination === 'hand'
    ? { zone: 'hand', tapped: false }
    : { zone: 'battlefield', tapped: destination === 'battlefieldTapped' };
}

/**
 * How many cards this search wants, resolved against the board it paused on.
 *
 * `evaluateAmount` with the `chosenX` arm answered here rather than there, for
 * the reason that function's own `chosenX` case gives: the chosen X is a fact
 * about the spell on the stack, and the runner is the caller that holds it.
 * Every other kind counts something `evaluateAmount` can see.
 *
 * Clamped at zero, because a computed count is arithmetic over a board and a
 * board can be empty. M13's mass-ramp sorcery searches for "X basic land cards,
 * where X is the number of lands you control", and cast with no lands it
 * searches for none, which under CR 701.19 is still a search: the seat is
 * offered only "find nothing", the shuffle still happens, and the log still
 * says a library was searched. Returning early instead would have made that
 * spell skip its own clause on an empty board.
 */
function searchCount(
  trace: Trace,
  count: Amount,
  since: number,
  controller: PlayerId,
  x: number | null,
  before: ResolutionTally,
): number {
  if (!isLiteralAmount(count) && count.kind === 'chosenX') return Math.max(0, x ?? 0);
  return Math.max(0, evaluateAmount(trace, count, since, controller, before));
}

/**
 * The matches still offerable once `taken` has been taken.
 *
 * `legal.ts`'s `selectionPool` at a different zone and for its exact reason:
 * the seat answers one card at a time, so "these two in either order" would be
 * two routes to one selection and two different recorded option indices for one
 * game. Restricting to the matches *after* the last one taken leaves one route,
 * and because `cards` is in library order the taken list is too.
 *
 * It slices the list the pause was built with rather than re-running
 * `searchableCards`, and that is not an optimization either: nothing moves
 * until the search finishes (`PendingSearch`), so the matched set is the same
 * set, and re-deriving it would be a second reading of one rule that could
 * disagree with the list the seat was actually shown.
 */
function searchCandidatesAfter(cards: readonly ObjectId[], last: ObjectId): readonly ObjectId[] {
  const at = cards.indexOf(last);
  // Unreachable: the answer was validated against this list before it arrived.
  if (at < 0) throw new Error(`searchCandidatesAfter: ${last} was found but is not a candidate`);
  return cards.slice(at + 1);
}

/** Sets `turn.awaiting` on the search question the record describes. */
function searchPause(trace: Trace, pendingSearch: PendingSearch): Trace {
  return withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'searchLibrary',
      awaitingPlayer: pendingSearch.player,
    }),
    pendingSearch,
  });
}

function awaitSearch(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  filter: CardFilter,
  destination: SearchDestination,
  count: number,
  reveal: boolean,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  return searchPause(trace, {
    player: controller,
    cards: count === 0 ? [] : searchableCards(trace.state, controller, filter),
    destination,
    count,
    reveal,
    taken: [],
    sourceOid,
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  });
}

/**
 * Banks the resolution and stops on the graveyard's question.
 *
 * `awaitSearch` with the library swapped out, and it is a separate function
 * rather than a widened one for the reason the two pending records are separate
 * types: a search shuffles afterwards and un-conceals a window, and this does
 * neither. Sharing the banker would have meant one function whose body is two
 * bodies behind a flag, which is what `state.ts`'s "one pending record per
 * question" is a rule against.
 *
 * The caller has already established that `cards` is non-empty. A choice with
 * only "take nothing" on it is a prompt with nothing on it, and
 * `awaitHandDiscard`'s docblock argues the case at the other pausing effect.
 *
 * It takes the whole effect where `awaitSearch` takes a destination, because
 * three of this effect's fields are read at the arrival rather than at the
 * pause and a fourth positional parameter for each of them is a signature
 * nobody can call correctly.
 */
function awaitGraveyardChoice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  cards: readonly ObjectId[],
  effect: GraveyardChoiceEffect,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  const pendingGraveyardChoice: PendingGraveyardChoice = {
    player: controller,
    cards,
    destination: effect.destination,
    ...(effect.control === undefined ? {} : { control: effect.control }),
    ...(effect.alsoBecomes === undefined ? {} : { alsoBecomes: effect.alsoBecomes }),
    sourceOid,
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'graveyardChoice',
      awaitingPlayer: controller,
    }),
    pendingGraveyardChoice,
  });
}

/**
 * Banks the resolution and stops on CR 701.8's question, or declines to stop.
 *
 * Returns `null` when there is nothing to ask, and the caller then carries on
 * with the next effect rather than pausing. Three ways that happens, and each
 * is a rule rather than a guard against a caller bug:
 *
 *  - the effect is not aimed at a player (CR 115.7's target has become illegal,
 *    or the printed text names a permanent), so no hand is named;
 *  - the hand is empty, or a printed filter matches none of it, and CR 701.8a's
 *    "discards as many as possible" is zero cards. A decision with one legal
 *    answer and that answer empty is a prompt with nothing on it;
 *  - the cards the chooser may name are at or below the count, so all of them
 *    go and no choice is involved. The caller discards them itself.
 *
 * The third case is why `choosable` arrives *clamped*: `count` is never larger
 * than that list here, so `legal.ts` can enumerate without re-deriving the rule
 * and `validateSelection` can compare against a number it trusts. It is a
 * parameter rather than something this function derives, because the caller has
 * already computed it to decide whether to stop at all, and deriving it twice is
 * two chances for the pause and the enumeration to disagree about what the card
 * offers.
 */
function awaitHandDiscard(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  chooser: PlayerId,
  owner: PlayerId,
  count: number,
  choosable: readonly ObjectId[],
  revealed: boolean,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  const pendingHandDiscard: PendingHandDiscard = {
    player: chooser,
    owner,
    count,
    cards: trace.state.players[owner].hand,
    choosable,
    revealed,
    sourceOid,
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'handDiscard',
      awaitingPlayer: chooser,
    }),
    pendingHandDiscard,
  });
}

/**
 * Banks the resolution and stops on CR 701.17's question.
 *
 * `awaitGraveyardChoice` with the graveyard swapped for the battlefield, and
 * the caller has already established that `permanents` holds at least two
 * candidates — `applyResolutionEffects`'s branch below resolves zero and one
 * without asking, the same forced-answer test `awaitHandDiscard` applies to
 * CR 701.8a. No "decline" arm exists here because none is printed: CR 701.17a
 * leaves a controller with a legal creature no way to keep it.
 */
function awaitPermanentSacrifice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  player: PlayerId,
  permanents: readonly ObjectId[],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  const pendingPermanentSacrifice: PendingPermanentSacrifice = {
    player,
    permanents,
    sourceOid,
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'permanentSacrifice',
      awaitingPlayer: player,
    }),
    pendingPermanentSacrifice,
  });
}

/**
 * Moves one seat's named cards from hand to graveyard and reports the move.
 *
 * Shared by the resolution answer below and by the discard *cost* in
 * `reduce.ts`'s `onActivateAbility`, because CR 701.8 is one action however it
 * was reached: the cards go to their owner's graveyard and `cardsDiscarded`
 * says whose and which. What differs between a cost and an effect is
 * everything around this — a cost is paid before the ability exists and is
 * never interrupted, an effect stops a resolution to ask — and none of that
 * belongs to the move itself.
 */
export function discardFromHand(trace: Trace, player: PlayerId, oids: readonly ObjectId[]): Trace {
  const moved = oids.reduce((acc, oid) => moveObject(acc, oid, 'graveyard'), trace);
  return emit(moved, { type: 'cardsDiscarded', player, oids: [...oids] });
}

/**
 * Applies a resolution until it finishes or reaches its next pausing effect.
 *
 * `since` is a mark in *this* reduction's event log and is recomputed at each
 * call, because a resumed resolution runs against a fresh log (`beginTrace`)
 * in which the events from before the pause do not appear. What that mark
 * therefore cannot answer on its own is a printed quantity counting what the
 * resolution has already done — "exile that player's creatures, scry 2, then
 * deal damage equal to the number of cards exiled this way" would read the
 * damage as 0. So the tally is banked at the pause (`tally` on `PendingScry`),
 * arrives back here as `before`, and is added to the span this call can see.
 * Everything else a resolution needs is still derived rather than threaded.
 */
export function applyResolutionEffects(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  effects: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  before: ResolutionTally = NOTHING_TALLIED,
  deferredTriggers: readonly PendingTrigger[] = [],
): Trace {
  let current = trace;
  const since = current.events.length;
  for (const [index, step] of effects.entries()) {
    if (step.effect.kind === 'scry') {
      return awaitScry(
        current,
        sourceOid,
        controller,
        step.effect.count,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    if (step.effect.kind === 'searchLibrary') {
      const banked = tallyThrough(current, since, before);
      const printedCount = step.effect.count;
      return awaitSearch(
        current,
        sourceOid,
        controller,
        step.effect.filter,
        step.effect.destination,
        printedCount === undefined ? 1 : searchCount(current, printedCount, since, controller, x, banked),
        step.effect.reveal === true,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        banked,
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    if (step.effect.kind === 'chooseFromGraveyard') {
      // The one pausing effect that can decline to pause, and it declines on a
      // *board* fact rather than on a target: an empty graveyard, or one
      // holding nothing the filter matches, leaves a choice with one answer and
      // that answer "nothing". `awaitHandDiscard` refuses the same way at CR
      // 701.8a, and both are rules rather than guards — Disentomb cast with no
      // creature in the graveyard does nothing, which is what a card that says
      // "return target creature card" does when no such card exists.
      const cards = graveyardChoiceCards(current.state, controller, step.effect.whose, step.effect.filter);
      if (cards.length === 0) continue;
      return awaitGraveyardChoice(
        current,
        sourceOid,
        controller,
        cards,
        step.effect,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    // A discard that names seats instead of a target is rewritten into one
    // step per seat before the branch below ever sees it, and rewriting is the
    // only shape that works here: CR 701.8's choice belongs to each hand's
    // owner, so a sweep over two seats owes two questions, and
    // `PendingHandDiscard` banks a *list of effects* rather than a
    // half-finished one. Handing the branch below the shape it already knows —
    // a discard aimed at one player — means a pause on the first seat carries
    // the seats after it along in `remaining`, with no second continuation
    // record and no per-seat state anywhere.
    //
    // The re-entry is the same one every pausing effect above makes: the tally
    // is banked, the triggers raised so far are deferred, and `since` is taken
    // fresh against the log the recursive call actually sees.
    if (step.effect.kind === 'discardCards' && step.effect.players !== undefined) {
      const { players, ...perSeat } = step.effect;
      const seats = playersInSweep(current.state, players, controller);
      return applyResolutionEffects(
        current,
        sourceOid,
        controller,
        [
          ...seats.map((player) => ({ effect: perSeat, target: { kind: 'player', player } as const })),
          ...effects.slice(index + 1),
        ],
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    if (step.effect.kind === 'discardCards' || step.effect.kind === 'chooseDiscard') {
      // One branch for two kinds, because CR 701.8 is one action and the two
      // differ only in who answers it. `chooseDiscard` also performs CR
      // 701.16a's reveal first, and that reveal is what licenses asking a seat
      // about cards in a hidden zone it does not own.
      const chooseDiscard = step.effect.kind === 'chooseDiscard';
      const owner = playerOf(step.target);
      if (owner === null) continue;
      if (chooseDiscard) {
        current = emit(current, {
          type: 'handRevealed',
          player: owner,
          oids: [...current.state.players[owner].hand],
        });
      }
      const hand = current.state.players[owner].hand;
      if (hand.length === 0) continue;
      // Which of the revealed cards the printed sentence lets the chooser name.
      // Only a `chooseDiscard` can carry a filter — a `discardCards` is answered
      // by the hand's own owner, and no printed card tells a player which of
      // their own cards they may pitch — so the whole hand is the answer
      // everywhere else, and the arithmetic below is unchanged for it.
      const choosable =
        chooseDiscard && step.effect.filter !== undefined
          ? selectPrinted(current.state, hand, asPrintedFilter(step.effect.filter))
          : hand;
      // The reveal has already happened, so a hand with nothing the filter
      // matches is a Duress that showed the opponent's hand and took none of
      // it. That is the printed outcome, not a degenerate one.
      if (choosable.length === 0) continue;
      // CR 701.8a discards as many as possible when the count exceeds what can
      // be discarded, and a count that takes every card the chooser may name
      // leaves no choice to ask about — so that case is performed here rather
      // than banked. The comparison is against `choosable` rather than the hand
      // because those are the cards CR 701.8a can actually reach.
      if (choosable.length <= step.effect.count) {
        current = discardFromHand(current, owner, choosable);
        continue;
      }
      return awaitHandDiscard(
        current,
        sourceOid,
        controller,
        chooseDiscard ? controller : owner,
        owner,
        step.effect.count,
        choosable,
        chooseDiscard,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    if (step.effect.kind === 'sacrificePermanent') {
      // CR 701.17a: the choice belongs to the target player, never the
      // caster, so `player` reads the effect's target rather than
      // `controller` — a target that has become illegal (CR 115.7) or never
      // named a player leaves nothing to ask, and the effect does nothing.
      const player = playerOf(step.target);
      if (player === null) continue;
      const permanents = creaturesControlledBy(current.state, player).map((object) => object.oid);
      // Zero candidates: nothing to sacrifice, so the effect does nothing.
      // One candidate: CR 701.17a leaves no choice to ask about, mirroring
      // `discardCards`'s "choosable.length <= count" forced-answer branch —
      // performed here rather than banked.
      if (permanents.length === 0) continue;
      if (permanents.length === 1) {
        const [only] = permanents;
        if (only !== undefined) current = sacrificePermanent(current, only, player);
        continue;
      }
      return awaitPermanentSacrifice(
        current,
        sourceOid,
        controller,
        player,
        permanents,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
      );
    }
    current = applyEffect(
      current,
      sourceOid,
      controller,
      step.effect,
      step.target,
      since,
      x,
      before,
      step.multiTarget,
    );
  }
  if (deferredTriggers.length > 0) {
    current = withState(current, { ...current.state, deferredTriggers });
  }
  return objectToGraveyard === null ? current : moveObject(current, objectToGraveyard, 'graveyard');
}

/** Applies the ordered partition and resumes the interrupted resolution. */
export function answerScry(trace: Trace, top: readonly ObjectId[], bottom: readonly ObjectId[]): Trace {
  const pending = trace.state.pendingScry;
  if (pending === undefined) throw new Error('answerScry: no scry is pending');
  const tail = trace.state.players[pending.player].library.slice(pending.cards.length);
  const reordered = updatePlayer(trace.state, pending.player, (player) => ({
    ...player,
    library: [...top, ...tail, ...bottom],
  }));
  const clearedState = withTurn(reordered, { awaiting: null, awaitingPlayer: null });
  const { pendingScry: _answered, ...withoutPendingScry } = clearedState;
  const cleared = withState(trace, withoutPendingScry);
  const reported = emit(cleared, {
    type: 'cardsScried',
    player: pending.player,
    count: pending.count,
    bottom: bottom.length,
  });
  return applyResolutionEffects(
    reported,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
  );
}

/**
 * Takes the chosen cards out of the library, shuffles, and resumes — or asks
 * again, when the search wants more than one and can still have it.
 *
 * The order is the order the oracle text prints (`oracle.ts` renders "search
 * your library for …, put it into your hand, then shuffle") and it is
 * load-bearing rather than cosmetic: the shuffle is what makes a search safe
 * to log. `librarySearched` carries a boolean and no id, so the opponent
 * learns that a search happened and whether it found something; the shuffle
 * then destroys the one inference a public failure would otherwise leave, that
 * the top of the library is where it was before.
 *
 * **The shuffle is unconditional**, including when nothing was found. CR
 * 701.19c shuffles whether or not a card was taken, and a shuffle skipped on
 * an empty search would tell both seats which branch was taken by the shape of
 * the event stream even though the event itself says so honestly.
 *
 * It draws from `shuffleLibrary` (`zones.ts`) and therefore from the seeded
 * generator in `GameState` — there is one shuffle primitive in this kernel for
 * exactly this reason, and a search that rolled its own would be the second
 * place a game could stop reproducing from its seed.
 */
export function answerSearch(trace: Trace, found: ObjectId | null): Trace {
  const pending = trace.state.pendingSearch;
  if (pending === undefined) throw new Error('answerSearch: no search is pending');
  const taken = found === null ? pending.taken : [...pending.taken, found];
  // A search for more than one is asked again rather than answered wider, and
  // the two ways it stops early are both CR 701.19b's: the seat declines, or the
  // matches after the last one taken run out. Neither is an error and neither
  // needs a flag — a search that took one of two took one.
  if (found !== null && taken.length < pending.count) {
    const next = searchCandidatesAfter(pending.cards, found);
    if (next.length > 0) return searchPause(trace, { ...pending, cards: next, taken });
  }
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingSearch: _answered, ...withoutPendingSearch } = clearedState;
  const cleared = withState(trace, withoutPendingSearch);
  const reported = emit(cleared, {
    type: 'librarySearched',
    player: pending.player,
    found: taken.length > 0,
  });
  // CR 701.16a, and it is emitted here — after the search is reported, before
  // anything moves — because that is the printed order and because the ids it
  // names have to be ids of cards still in the library. A reveal after the move
  // would be a second, later claim about cards the opponent may by then be
  // unable to see.
  const shown =
    pending.reveal && taken.length > 0
      ? emit(reported, { type: 'librarySearchRevealed', player: pending.player, oids: taken })
      : reported;
  const { zone, tapped } = searchDestinationZone(pending.destination);
  // In library order, which is `taken`'s order by construction
  // (`searchCandidatesAfter`). Two lands arriving on a battlefield emit two
  // arrivals, and a deterministic order is what keeps two runs of one seed
  // emitting them the same way round.
  const moved = taken.reduce((current, oid) => moveObject(current, oid, zone, { tapped }), shown);
  const shuffled = shuffleLibrary(moved, pending.player);
  return applyResolutionEffects(
    shuffled,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
  );
}

/**
 * Moves the chosen card out of the graveyard and resumes.
 *
 * No shuffle and no event of its own, which is the whole difference from
 * `answerSearch` and both halves fall out of the zone being public.
 * `librarySearched` exists because a search happens inside a hidden zone and
 * the opponent is otherwise told nothing; a card leaving a graveyard emits
 * `zoneChanged` from `moveObject` like every other move, and both seats could
 * already read the zone it left, so a second event would report a fact the log
 * already carries. The shuffle is CR 701.19c's and belongs to searching a
 * library — it is what destroys the inference a public failure would leave —
 * and there is no such inference to destroy here.
 *
 * **The card arrives under its owner's control unless the effect said
 * otherwise**, which is what `control: 'you'` says and what Rise from the Grave
 * prints. Absent the field the old sentence still holds: a card in a graveyard
 * is controlled by its owner, and `moveObject` carries that controller onto the
 * battlefield. Control and ownership stay two properties either way (CR 108.4,
 * CR 110.2) — the reanimated creature is controlled by the seat that cast the
 * spell and still owned by the seat whose graveyard it came from, so it goes
 * back to that graveyard when it dies and goes home if the game ends. Nothing
 * here writes `owner`.
 *
 * `alsoBecomes` is the "in addition to its other colors and types" clause, and
 * it lands in the CR 613 layer walk rather than on the card: two records, layer
 * 5 for the colors and layer 4 for the subtypes, both pinned to the arriving
 * permanent. Printed characteristics are not touched, which is what "in
 * addition" means — the creature keeps every color and type it was printed
 * with, and `characteristicsOf` unions the grant on top.
 *
 * `null` is the "take nothing" answer and it is not a no-op with a different
 * name: the resolution still resumes, so the effects printed after the choice
 * still run and the spell still finishes into its graveyard.
 */
export function answerGraveyardChoice(trace: Trace, chosen: ObjectId | null): Trace {
  const pending = trace.state.pendingGraveyardChoice;
  if (pending === undefined) throw new Error('answerGraveyardChoice: no graveyard choice is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingGraveyardChoice: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const taken = chosen === null ? cleared : takeFromGraveyard(cleared, chosen, pending);
  return applyResolutionEffects(
    taken,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
  );
}

/**
 * Moves the chosen card and applies whatever the effect said about its arrival.
 *
 * Split out of `answerGraveyardChoice` so the resume path stays one line:
 * everything here is about the card, and everything there is about the
 * resolution it interrupted.
 *
 * The control clause is an `entry` field on `moveObject` and the grant is two
 * continuous effects, and the asymmetry is the rules rather than a shortcut.
 * CR 110.2a makes control a property of the permanent as it enters, so there is
 * no moment at which it entered under someone else; a type or color change is a
 * continuous effect in CR 613's layers whenever it happens, and writing it onto
 * the object instead would put it below every other effect in the layer and
 * make it survive a `copy` that should have wiped it.
 */
function takeFromGraveyard(trace: Trace, chosen: ObjectId, pending: PendingGraveyardChoice): Trace {
  const moved = moveObject(trace, chosen, pending.destination, {
    ...(pending.control === 'you' ? { controller: pending.controller } : {}),
  });
  return grantOnArrival(moved, chosen, pending.alsoBecomes, pending.sourceOid);
}

/**
 * Registers the arrival grant as CR 613 layer-5 and layer-4 effects.
 *
 * Two records rather than one, because the layer a change applies in is a
 * property of the change and this clause makes two of them: "a black Zombie"
 * is a color in layer 5 (CR 613.1e) and a creature type in layer 4 (CR 613.1d),
 * and one record carrying both fields would have to be applied twice at
 * different points in the same walk. `pumpUntilEndOfTurn` is the pattern for
 * the bookkeeping — an id off `nextId`, the counter written back, the record
 * appended, an event emitted.
 *
 * `addColors` and `addSubtypes` are the additive fields of each record, never
 * `setColors` or `removeAllSubtypes`. That is the whole of "in addition to its
 * other colors and types": a green Elf Warrior reanimated this way is a black
 * green Zombie Elf Warrior, and every one of those words is load-bearing on a
 * board where a Forest-walking creature or an Elf lord is out.
 *
 * The duration is `'whileSubjectRemains'`, which `continuous.ts` argues: the
 * printed clause has no duration, and in this kernel "no duration" would follow
 * the card back out of the graveyard the second time somebody reanimated it.
 *
 * The event is `continuousEffectAdded`, whose `power` and `toughness` are not
 * optional. Both are `0` here, and that is not a P/T change hiding in a type
 * change — the record's `layer` says `'4'` and `'5'`, and layer 7 is where a
 * reader looks for a P/T. The alternative was a third event shape for a grant
 * that narrates in one line, which `events.ts` already declined once for the
 * keyword grant.
 */
function grantOnArrival(
  trace: Trace,
  oid: ObjectId,
  grant: GraveyardArrivalGrant | undefined,
  sourceOid: ObjectId,
): Trace {
  if (grant === undefined) return trace;
  const colors = grant.colors ?? [];
  const subtypes = grant.subtypes ?? [];
  const affects = onlyObject(oid);
  const records: ContinuousEffect[] = [];
  let counter = trace.state.nextId;
  if (colors.length > 0) {
    records.push({
      id: continuousEffectId(counter),
      kind: 'colorChange',
      layer: '5',
      affects,
      setColors: null,
      addColors: colors,
      duration: 'whileSubjectRemains',
      timestamp: counter,
      sourceOid,
      enabledWhile: null,
    });
    counter += 1;
  }
  if (subtypes.length > 0) {
    records.push({
      id: continuousEffectId(counter),
      kind: 'typeChange',
      layer: '4',
      affects,
      addTypes: [],
      removeTypes: [],
      addSubtypes: subtypes,
      removeAllSubtypes: false,
      duration: 'whileSubjectRemains',
      timestamp: counter,
      sourceOid,
      enabledWhile: null,
    });
    counter += 1;
  }
  if (records.length === 0) return trace;
  const state: GameState = {
    ...trace.state,
    nextId: counter,
    continuous: [...trace.state.continuous, ...records],
  };
  return records.reduce(
    (current, record) =>
      emit(current, {
        type: 'continuousEffectAdded',
        id: record.id,
        targetOid: oid,
        power: 0,
        toughness: 0,
        layer: record.layer,
      }),
    withState(trace, state),
  );
}

/**
 * The player a resolved target names, or `null` when it names none.
 *
 * `effects.ts`'s `playerTarget` falls back to the controller for the same
 * question, which is right for "you draw a card" printed with no target and
 * wrong here: a discard whose target became illegal must do nothing, and
 * falling back would silently make the controller discard instead of the
 * opponent the card named.
 */
function playerOf(target: Target | null): PlayerId | null {
  return target !== null && target.kind === 'player' ? target.player : null;
}

/**
 * Discards the named cards and resumes the interrupted resolution.
 *
 * The cards go to `pending.owner`'s graveyard, never `pending.player`'s: under
 * a `chooseDiscard` those two are different seats, and CR 701.8a puts a
 * discarded card into its *owner's* graveyard whoever chose it. That is the
 * one line in this file where reading the wrong field of the pending record
 * still typechecks, which is why the record names them differently.
 *
 * The cards are not re-derived from the hand. `pending.cards` is the hand as
 * it stood when the resolution stopped, and `legal.ts` enumerated the answers
 * from that list — a card that left the hand in between is a card the chooser
 * was offered, so `moveObject` is asked to move what was agreed rather than
 * what is there now. `validateAction` has already refused any oid outside that
 * list.
 */
export function answerHandDiscard(trace: Trace, oids: readonly ObjectId[]): Trace {
  const pending = trace.state.pendingHandDiscard;
  if (pending === undefined) throw new Error('answerHandDiscard: no discard is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingHandDiscard: _answered, pendingSelection: _held, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const discarded = discardFromHand(cleared, pending.owner, oids);
  return applyResolutionEffects(
    discarded,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
  );
}

/**
 * Sacrifices the chosen permanent and resumes the interrupted resolution.
 *
 * `pending.player` sacrifices, never `pending.controller`: that is the one
 * line where reading the wrong field of this record still typechecks (the two
 * coincide on every ordinary discard-style effect but never on an edict), and
 * it is why the record names them separately rather than reusing
 * `PendingGraveyardChoice`'s single `player`/`controller` pair by coincidence.
 *
 * `pending.permanents` is not re-checked here — `validatePermanentSacrifice`
 * (`legal.ts`) has already refused any oid outside it or off the battlefield
 * before this runs, the same division of labor `answerHandDiscard` and
 * `answerGraveyardChoice` keep with their own validators.
 */
export function answerPermanentSacrifice(trace: Trace, oid: ObjectId): Trace {
  const pending = trace.state.pendingPermanentSacrifice;
  if (pending === undefined) throw new Error('answerPermanentSacrifice: no sacrifice is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingPermanentSacrifice: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const sacrificed = sacrificePermanent(cleared, oid, pending.player);
  return applyResolutionEffects(
    sacrificed,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
  );
}
