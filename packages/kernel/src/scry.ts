/**
 * The interruptible resolution runner, and the resolutions that pause.
 *
 * CR 608.2 resolves a spell's instructions in printed order and does not stop
 * to ask the reducer anything. Several of ours have to: CR 701.18 scry orders
 * cards its controller alone may look at, CR 701.19 search hands its
 * controller a library and asks which card comes out of it, CR 701.8 discard
 * asks somebody which cards leave a hand, `chooseFromGraveyard` asks which one
 * card comes back out of a graveyard, CR 701.17's `sacrificePermanent`
 * asks a target player which of their own creatures leaves the battlefield,
 * and a group untap asks its controller which tappable permanents to affect.
 * None of those answers is derivable, all are choices, and a choice in this
 * kernel is an `Action` a seat submits — never a callback, never a heuristic
 * the resolver runs on the player's behalf.
 *
 * The public-zone choices are worth
 * saying out loud because three files' worth of concealment machinery does not
 * apply to them: a graveyard is readable by both seats (CR 400.2) and so is
 * a battlefield (CR 403.2), so `PendingGraveyardChoice`,
 * `PendingPermanentSacrifice`, and `PendingPermanentUntap` have no arm in
 * `visibility.ts` and nothing about those questions is hidden from the seat not
 * being asked. What makes them stop is the choice, not the secret.
 *
 * So `applyResolutionEffects` runs a resolution until it reaches one of those
 * effects and then *banks* the rest of it: the remaining steps, the `x` it
 * was cast for, the object headed for the graveyard when it finishes, the
 * exile tally a later step may count, and the triggers collected so far. That
 * bank is `PendingScry`, `PendingSearch`, `PendingHandDiscard`,
 * `PendingGraveyardChoice`, `PendingPermanentSacrifice`, or
 * `PendingPermanentUntap` (`state.ts`),
 * `turn.awaiting` names which, and `legal.ts` offers exactly the matching
 * `Decision`. The answer comes back through `answerScry`, `answerSearch`,
 * `answerHandDiscard`, `answerGraveyardChoice`, `answerPermanentSacrifice`, or
 * `answerPermanentUntap`,
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
 * shared across all of them is the *shape* — bank the remainder, set `awaiting`,
 * resume through one function — and that is shared by construction here, not
 * by convention.
 */
import type {
  Amount,
  CardFilter,
  CastableCard,
  Effect,
  GraveyardOwner,
  InstantCard,
  SearchDestination,
  SearchDestinationPlan,
  SearchFilterQuota,
  SorceryCard,
  TargetFilter,
} from '@mtg/dsl';
import { hasTarget, isCastable, isLiteralAmount, isSourceBodyOnlyTarget, manaValue } from '@mtg/dsl';
import { opponentOf } from './ids';
import type { ObjectId, PlayerId } from './ids';
import type { ZoneId } from './state';
import {
  applyEffect,
  evaluateAmount,
  fightCreatures,
  grantOnGraveyardArrival,
  playersInSweep,
  tallyThrough,
} from './effects';
import type {
  GameState,
  ChosenCardName,
  PendingCardNameChoice,
  PendingNamedZoneExile,
  PendingBattlefieldChoice,
  PendingPopulate,
  PendingPopulateCandidate,
  PendingCardCopyCast,
  PendingExiledBatchCard,
  PendingFreeCast,
  PendingGraveyardChoice,
  PendingHandDiscard,
  PendingManaColorChoice,
  PendingOriginalFreeCast,
  PendingRevealedHandChoice,
  PendingPermanentSacrifice,
  PendingPermanentSacrificeChoice,
  PendingPermanentSacrificeGroup,
  PendingPermanentUntap,
  PendingPermanentUntapChoice,
  PendingResolutionEffect,
  PendingScry,
  PendingSpellTargets,
  PendingSearch,
  PendingTopLibrary,
  ResolutionTally,
  Target,
} from './state';
import { apnapOrder, NOTHING_TALLIED } from './state';
import { sacrificePermanent } from './destruction';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { linkExileToSource } from './source-linked-exile';
import { collectTriggers, type PendingTrigger } from './triggers';
import { withTurn } from './turn';
import { controllerOf, copiableValuesOf, isCreatureObject, powerOf } from './layers';
import { satisfiesTargetFilter } from './target-filter';
import { applyReplacements } from './replacement';
import type { DiscardCause } from './replacement-effects';
import { handDiscardReplacementsFor } from './static-replacements';
import { nextBelow } from './rng';
import { changeSpellTargetsOnStack, copySpellOnStack } from './stack-spell-targets';
import {
  freeCastOptionsForCard,
  isCurrentBattlefieldChoiceCandidate,
  isCurrentPopulateCandidate,
  isCurrentPermanentUntapCandidate,
} from './legal';

/** The one member of the effect union this file's graveyard arm ever holds. */
type GraveyardChoiceEffect = Extract<Effect, { readonly kind: 'chooseFromGraveyard' }>;
import { graveyardMembers, selectPrintedByCardFilter } from './zone-filter';
import {
  exileNonbasicGraveyard,
  canUntapObject,
  createCopiedToken,
  moveObject,
  revealTopCards,
  shuffleLibrary,
  tryObject,
  untapObject,
} from './zones';

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
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const cards = trace.state.players[controller].library.slice(0, count);
  const pendingScry: PendingScry = {
    player: controller,
    count,
    cards,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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

function awaitManaColor(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  effect: Extract<Effect, { readonly kind: 'addMana' }>,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingManaColorChoice: PendingManaColorChoice = {
    player: controller,
    colors: effect.produces,
    effect,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'manaColor', awaitingPlayer: controller }),
    pendingManaColorChoice,
  });
}

function awaitTopLibrary(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  kind: PendingTopLibrary['kind'],
  cards: readonly ObjectId[],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
  eligible?: readonly ObjectId[],
  selectionRest?: 'bottom' | 'graveyard',
  selectionPublic?: true,
  pileRest?: 'bottom',
  orderDestination?: 'bottom',
  guildFeud?: PendingTopLibrary['guildFeud'],
): Trace {
  const chooser = kind === 'partition' ? opponentOf(controller) : controller;
  const pendingTopLibrary: PendingTopLibrary = {
    player: controller,
    chooser,
    kind,
    cards,
    ...(eligible === undefined ? {} : { eligible }),
    ...(selectionRest === undefined ? {} : { selectionRest }),
    ...(selectionPublic === undefined ? {} : { selectionPublic }),
    ...(pileRest === undefined ? {} : { pileRest }),
    ...(orderDestination === undefined ? {} : { orderDestination }),
    ...(guildFeud === undefined ? {} : { guildFeud }),
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  const awaiting =
    kind === 'order'
      ? 'topLibraryOrder'
      : kind === 'select'
        ? 'topLibrarySelect'
        : kind === 'partition'
          ? 'topLibraryPartition'
          : 'topLibraryPile';
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting, awaitingPlayer: chooser }),
    pendingTopLibrary,
  });
}

/** Opens one public Guild Feud top-three creature choice. */
function awaitGuildFeudSelection(
  trace: Trace,
  pending: PendingTopLibrary,
  player: PlayerId,
  phase: 'opponentSelection' | 'controllerSelection',
  firstCreature?: { readonly oid: ObjectId; readonly incarnation: number },
): Trace {
  const cards = trace.state.players[player].library.slice(0, 3);
  const revealed = revealTopCards(trace, player, 3);
  const waiting = awaitTopLibrary(
    revealed,
    pending.sourceOid,
    pending.controller,
    'select',
    cards,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
    selectPrintedByCardFilter(revealed.state, cards, { cardTypes: ['creature'] }),
    'graveyard',
    true,
    undefined,
    undefined,
    {
      phase,
      opponent: pending.guildFeud?.opponent ?? player,
      ...(firstCreature === undefined ? {} : { firstCreature }),
    },
  );
  const next = waiting.state.pendingTopLibrary;
  if (next === undefined) throw new Error('awaitGuildFeudSelection: top-library choice disappeared');
  return withState(waiting, {
    ...withTurn(waiting.state, { awaitingPlayer: player }),
    pendingTopLibrary: { ...next, player, chooser: player },
  });
}

/** Begins Guild Feud after its one opponent target has survived resolution recheck. */
export function beginGuildFeudContest(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  opponent: PlayerId,
): Trace {
  const cards = trace.state.players[opponent].library.slice(0, 3);
  const revealed = revealTopCards(trace, opponent, 3);
  const waiting = awaitTopLibrary(
    revealed,
    sourceOid,
    controller,
    'select',
    cards,
    [],
    null,
    null,
    NOTHING_TALLIED,
    [],
    undefined,
    selectPrintedByCardFilter(revealed.state, cards, { cardTypes: ['creature'] }),
    'graveyard',
    true,
    undefined,
    undefined,
    { phase: 'opponentSelection', opponent },
  );
  const pending = waiting.state.pendingTopLibrary;
  if (pending === undefined) throw new Error('beginGuildFeudContest: top-library choice disappeared');
  return withState(waiting, {
    ...withTurn(waiting.state, { awaitingPlayer: opponent }),
    pendingTopLibrary: { ...pending, player: opponent, chooser: opponent },
  });
}

/** Opens Jace's source-attested three-card opponent partition. */
export function beginJaceArchitectPiles(trace: Trace, sourceOid: ObjectId, controller: PlayerId): Trace {
  const cards = trace.state.players[controller].library.slice(0, 3);
  const revealed = revealTopCards(trace, controller, 3);
  return awaitTopLibrary(
    revealed,
    sourceOid,
    controller,
    'partition',
    cards,
    [],
    null,
    null,
    NOTHING_TALLIED,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    'bottom',
  );
}

export function awaitSpellTargets(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  spell: ObjectId,
  operation: PendingSpellTargets['operation'],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingSpellTargets: PendingSpellTargets = {
    player: controller,
    spell,
    operation,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'spellTargets', awaitingPlayer: controller }),
    pendingSpellTargets,
  });
}

function awaitFreeCast(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  player: PlayerId,
  oid: ObjectId,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  optional: boolean,
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const selected = tryObject(trace.state, oid);
  if (selected === undefined || !isCastable(selected.card)) {
    throw new Error('awaitFreeCast: selected card cannot be cast');
  }
  const pendingFreeCast: PendingFreeCast = {
    player,
    oid,
    from: 'hand',
    card: selected.card,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
    ...(optional ? { optional: true } : {}),
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'freeCast', awaitingPlayer: player }),
    pendingFreeCast,
  });
}

function copiedCardCandidates(trace: Trace, since: number): readonly PendingCardCopyCast[] {
  return trace.events.slice(since).flatMap((event): readonly PendingCardCopyCast[] => {
    if (event.type !== 'zoneChanged' || event.from !== 'graveyard' || event.to !== 'exile') return [];
    const object = tryObject(trace.state, event.oid);
    if (object === undefined || object.zone !== 'exile') return [];
    if (object.card.kind !== 'instant' && object.card.kind !== 'sorcery') return [];
    return [{ oid: event.oid, incarnation: object.incarnation ?? 0, card: object.card }];
  });
}

function awaitCopiedCardCasts(
  trace: Trace,
  candidates: readonly PendingCardCopyCast[],
  continuation: Omit<PendingFreeCast, 'player' | 'oid' | 'from' | 'copyCandidates'>,
): Trace | null {
  const first = candidates[0];
  if (first === undefined) return null;
  const pendingFreeCast: PendingFreeCast = {
    ...continuation,
    player: continuation.controller,
    oid: first.oid,
    from: 'exile',
    copyCandidates: candidates,
  };
  const pending = withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'freeCast',
      awaitingPlayer: continuation.controller,
    }),
    pendingFreeCast,
  });
  const hasCast = candidates.some(
    (candidate) =>
      freeCastOptionsForCard(pending.state, continuation.controller, candidate.oid, candidate.card, 1).items
        .length > 0,
  );
  return hasCast ? pending : null;
}

function cleanExiledBatch(trace: Trace, batch: readonly PendingExiledBatchCard[]): Trace {
  return batch.reduce((current, candidate) => {
    const object = tryObject(current.state, candidate.oid);
    return object?.zone === 'exile' && (object.incarnation ?? 0) === candidate.incarnation
      ? moveObject(current, candidate.oid, 'graveyard')
      : current;
  }, trace);
}

function awaitOriginalCardCasts(
  trace: Trace,
  candidates: readonly PendingOriginalFreeCast[],
  cleanupExileBatch: readonly PendingExiledBatchCard[] | undefined,
  continuation: Omit<
    PendingFreeCast,
    'player' | 'oid' | 'from' | 'originalCandidates' | 'cleanupExileBatch' | 'optional'
  >,
): Trace | null {
  const first = candidates[0];
  if (first === undefined) return null;
  const pendingFreeCast: PendingFreeCast = {
    ...continuation,
    player: continuation.controller,
    oid: first.oid,
    from: 'exile',
    originalCandidates: candidates,
    ...(cleanupExileBatch === undefined ? {} : { cleanupExileBatch }),
    optional: true,
  };
  const pending = withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'freeCast',
      awaitingPlayer: continuation.controller,
    }),
    pendingFreeCast,
  });
  const hasCast = candidates.some(
    (candidate) =>
      freeCastOptionsForCard(pending.state, continuation.controller, candidate.oid, candidate.card, 1).items
        .length > 0,
  );
  return hasCast ? pending : null;
}

/** Pauses a Siege defeat resolution on its optional transformed cast. */
export function awaitTransformedFreeCast(
  trace: Trace,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
  deferredTriggers: readonly PendingTrigger[],
): Trace {
  const pendingFreeCast: PendingFreeCast = {
    player,
    oid,
    from: 'exile',
    card,
    optional: true,
    sourceOid: oid,
    controller: player,
    remaining: [],
    x: null,
    objectToGraveyard: null,
    tally: NOTHING_TALLIED,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'freeCast', awaitingPlayer: player }),
    pendingFreeCast,
  });
}

/**
 * The cards in a library a `searchLibrary` filter may take (CR 701.19a).
 *
 * A library is a hidden zone, so no `CharacteristicMap` exists for anything in
 * it and CR 611.2c leaves each card exactly what is printed on it —
 * `selectPrintedByCardFilter` is the selector written for that, and this is a
 * second caller for it rather than a second matcher.
 */
export function searchableCards(state: GameState, player: PlayerId, filter: CardFilter): readonly ObjectId[] {
  return selectPrintedByCardFilter(state, state.players[player].library, filter);
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
  return selectPrintedByCardFilter(state, members, filter);
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
type SearchedCardZoneDestination = Exclude<SearchDestination, 'libraryTop'> | 'graveyard';

function searchDestinationZone(destination: SearchedCardZoneDestination): {
  zone: ZoneId;
  tapped: boolean;
} {
  return destination === 'hand'
    ? { zone: 'hand', tapped: false }
    : destination === 'graveyard'
      ? { zone: 'graveyard', tapped: false }
      : destination === 'exile'
        ? { zone: 'exile', tapped: false }
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
  sourceOid: ObjectId,
  x: number | null,
  before: ResolutionTally,
): number {
  if (!isLiteralAmount(count) && count.kind === 'chosenX') return Math.max(0, x ?? 0);
  return Math.max(0, evaluateAmount(trace, count, since, controller, before, sourceOid));
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
  libraryOwner: PlayerId,
  selection:
    | { readonly kind: 'homogeneous'; readonly filter: CardFilter; readonly count: number }
    | { readonly kind: 'filterQuotas'; readonly quotas: readonly SearchFilterQuota[] },
  destination: SearchDestinationPlan,
  mayFail: boolean,
  reveal: boolean,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceBattlefieldIncarnation?: number,
  sourceCard?: InstantCard | SorceryCard,
  jaceArchitect?: {
    readonly ownersRemaining: readonly PlayerId[];
    readonly exiled: readonly PendingOriginalFreeCast[];
  },
): Trace {
  const firstQuota = selection.kind === 'filterQuotas' ? selection.quotas[0] : undefined;
  if (selection.kind === 'filterQuotas' && firstQuota === undefined) {
    throw new Error('awaitSearch: a heterogeneous search needs at least one quota');
  }
  const filter = firstQuota?.filter ?? (selection.kind === 'homogeneous' ? selection.filter : {});
  const count =
    selection.kind === 'homogeneous'
      ? selection.count
      : selection.quotas.reduce((sum, quota) => sum + quota.count, 0);
  if (destination === 'libraryTop' && count !== 1) {
    throw new Error(
      'the library-top search destination places one chosen card on top; use a one-card search',
    );
  }
  const cards = count === 0 ? [] : searchableCards(trace.state, libraryOwner, filter);
  const pending: PendingSearch = {
    player: controller,
    libraryOwner,
    cards,
    destination,
    count,
    reveal,
    mayFail,
    taken: [],
    // The homogeneous arm only: a quota search's restriction is the quota's, and
    // it is already on the record twice over (`activeFilterQuota` and
    // `remainingFilterQuotas`). Writing both would leave a reader two fields
    // that can disagree.
    ...(selection.kind === 'homogeneous' ? { filter: selection.filter } : {}),
    ...(firstQuota === undefined
      ? {}
      : {
          activeFilterQuota: firstQuota,
          remainingFilterQuotas: selection.kind === 'filterQuotas' ? selection.quotas.slice(1) : [],
          activeFilterQuotaTaken: 0,
        }),
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
    ...(sourceBattlefieldIncarnation === undefined ? {} : { sourceBattlefieldIncarnation }),
    ...(jaceArchitect === undefined
      ? {}
      : {
          jaceArchitectOwnersRemaining: jaceArchitect.ownersRemaining,
          jaceArchitectExiled: jaceArchitect.exiled,
        }),
  };
  if (cards.length > 0 || pending.mayFail) return searchPause(trace, pending);
  return completeSearch(
    emit(trace, { type: 'librarySearched', player: controller, found: false }),
    pending,
    [],
    null,
  );
}

/** Opens Jace's controller-chosen nonland search over both players' libraries. */
export function beginJaceArchitectSearchAndCast(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
): Trace {
  const owners = [controller, opponentOf(controller)] as const;
  return awaitSearch(
    trace,
    sourceOid,
    controller,
    owners[0],
    { kind: 'homogeneous', filter: { excludeCardTypes: ['land'] }, count: 1 },
    'exile',
    true,
    false,
    [],
    null,
    null,
    NOTHING_TALLIED,
    [],
    undefined,
    undefined,
    { ownersRemaining: owners.slice(1), exiled: [] },
  );
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
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingGraveyardChoice: PendingGraveyardChoice = {
    player: controller,
    cards,
    filter: effect.filter,
    destination: effect.destination,
    ...(effect.control === undefined ? {} : { control: effect.control }),
    ...(effect.alsoBecomes === undefined ? {} : { alsoBecomes: effect.alsoBecomes }),
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingHandDiscard: PendingHandDiscard = {
    player: chooser,
    owner,
    count,
    cards: [...trace.state.players[owner].hand],
    choosable: [...choosable],
    revealed,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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

function awaitRevealedHandChoice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  owner: PlayerId,
  choosable: readonly ObjectId[],
  outcome: PendingRevealedHandChoice['outcome'],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingRevealedHandChoice: PendingRevealedHandChoice = {
    player: controller,
    owner,
    cards: [...trace.state.players[owner].hand],
    choosable: [...choosable],
    outcome,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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
      awaiting: 'revealedHandChoice',
      awaitingPlayer: controller,
    }),
    pendingRevealedHandChoice,
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
 * leaves a controller with a legal filtered permanent no way to keep it.
 */
function awaitPermanentSacrifice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  player: PlayerId,
  permanents: readonly ObjectId[],
  remainingCount: number,
  remainingGroups: readonly PendingPermanentSacrificeGroup[],
  chosen: readonly PendingPermanentSacrificeChoice[],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingPermanentSacrifice: PendingPermanentSacrifice = {
    player,
    permanents,
    remainingCount,
    remainingGroups,
    chosen,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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

/** Banks one mandatory public-zone choice over controlled permanents. */
function awaitBattlefieldChoice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  permanents: readonly PendingPermanentUntapChoice[],
  filter: TargetFilter,
  destination: 'hand',
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingBattlefieldChoice: PendingBattlefieldChoice = {
    player: controller,
    permanents,
    filter,
    destination,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
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
      awaiting: 'battlefieldChoice',
      awaitingPlayer: controller,
    }),
    pendingBattlefieldChoice,
  });
}

/** Banks the creature selected to pay Faerie Impostor's return cost. */
export function awaitReturnAnotherCreatureChoice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  creatures: readonly ObjectId[],
): Trace {
  const permanents = creatures.map((oid): PendingPermanentUntapChoice => ({
    oid,
    incarnation: trace.state.objects[oid]?.incarnation ?? 0,
  }));
  return awaitBattlefieldChoice(
    trace,
    sourceOid,
    controller,
    permanents,
    { cardTypes: ['creature'] },
    'hand',
    [],
    null,
    null,
    NOTHING_TALLIED,
    [],
  );
}

/** Banks CR 701.30's mandatory choice without turning it into a target. */
function awaitPopulate(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  tokens: readonly PendingPopulateCandidate[],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingPopulate: PendingPopulate = {
    player: controller,
    tokens,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'populate', awaitingPlayer: controller }),
    pendingPopulate,
  });
}

function awaitPermanentUntap(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  permanents: readonly PendingPermanentUntapChoice[],
  chosen: readonly PendingPermanentUntapChoice[],
  remainingCount: number,
  filter: TargetFilter,
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  const pendingPermanentUntap: PendingPermanentUntap = {
    permanents,
    chosen,
    remainingCount,
    filter,
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'permanentUntap', awaitingPlayer: controller }),
    pendingPermanentUntap,
  });
}

function awaitCardNameChoice(
  trace: Trace,
  sourceOid: ObjectId,
  controller: PlayerId,
  player: PlayerId,
  remainingPlayers: readonly PlayerId[],
  chosen: readonly ChosenCardName[],
  remaining: readonly PendingResolutionEffect[],
  x: number | null,
  objectToGraveyard: ObjectId | null,
  tally: ResolutionTally,
  deferredTriggers: readonly PendingTrigger[],
  sourceCard?: InstantCard | SorceryCard,
  targetPlayer?: PlayerId,
): Trace {
  const pendingCardNameChoice: PendingCardNameChoice = {
    player,
    remainingPlayers,
    chosen,
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    sourceOid,
    ...(sourceCard === undefined ? {} : { sourceCard }),
    controller,
    remaining,
    x,
    objectToGraveyard,
    tally,
    deferredTriggers,
  };
  return withState(trace, {
    ...withTurn(trace.state, { priority: null, awaiting: 'cardName', awaitingPlayer: player }),
    pendingCardNameChoice,
  });
}

function awaitNamedZoneExile(trace: Trace, pendingNamedZoneExile: PendingNamedZoneExile): Trace {
  return withState(trace, {
    ...withTurn(trace.state, {
      priority: null,
      awaiting: 'namedZoneExile',
      awaitingPlayer: pendingNamedZoneExile.player,
    }),
    pendingNamedZoneExile,
  });
}

const DEFAULT_SACRIFICE_FILTER: TargetFilter = { cardTypes: ['creature'] };

type PermanentSacrificePlan =
  | {
      readonly kind: 'complete';
      readonly chosen: readonly PendingPermanentSacrificeChoice[];
    }
  | {
      readonly kind: 'choice';
      readonly group: PendingPermanentSacrificeGroup;
      readonly remainingGroups: readonly PendingPermanentSacrificeGroup[];
      readonly chosen: readonly PendingPermanentSacrificeChoice[];
    };

/** Freezes every affected player's legal candidates before anybody chooses. */
function permanentSacrificeGroups(
  state: GameState,
  players: readonly PlayerId[],
  count: number,
  filter: TargetFilter,
  excludedOid?: ObjectId,
): readonly PendingPermanentSacrificeGroup[] {
  return players.map((player) => {
    const permanents = state.battlefield.filter(
      (oid) =>
        oid !== excludedOid &&
        controllerOf(state, oid) === player &&
        satisfiesTargetFilter(state, oid, filter),
    );
    return { player, permanents, count: Math.min(count, permanents.length) };
  });
}

/** Banks forced groups until the next real choice, or completes the selection. */
function advancePermanentSacrifice(
  groups: readonly PendingPermanentSacrificeGroup[],
  chosen: readonly PendingPermanentSacrificeChoice[],
): PermanentSacrificePlan {
  let banked = [...chosen];
  for (const [index, group] of groups.entries()) {
    if (group.count === 0) continue;
    if (group.permanents.length <= group.count) {
      banked = [
        ...banked,
        ...group.permanents.map((oid): PendingPermanentSacrificeChoice => ({ oid, player: group.player })),
      ];
      continue;
    }
    return { kind: 'choice', group, remainingGroups: groups.slice(index + 1), chosen: banked };
  }
  return { kind: 'complete', chosen: banked };
}

/** Applies one simultaneous sacrifice action after every APNAP choice is banked. */
function sacrificeChosenPermanents(trace: Trace, chosen: readonly PendingPermanentSacrificeChoice[]): Trace {
  return chosen.reduce((current, choice) => sacrificePermanent(current, choice.oid, choice.player), trace);
}

/**
 * Performs one seat's named discard action and reports it.
 *
 * Shared by the resolution answer below and by the discard *cost* in
 * `reduce.ts`'s `onActivateAbility`, because CR 701.8 is one action however it
 * was reached. The proposed destination is the owner's graveyard; a printed
 * hand-active replacement may rewrite that destination before `moveObject`
 * performs the ordinary zone change. `cause` distinguishes a spell or ability
 * controlled by an opponent from a self-discard, a cost, or cleanup. The
 * `cardsDiscarded` action record remains one event whichever destinations its
 * selected cards reach.
 */
export function discardFromHand(
  trace: Trace,
  player: PlayerId,
  oids: readonly ObjectId[],
  cause: DiscardCause | null,
): Trace {
  let current = trace;
  for (const oid of oids) {
    const object = tryObject(current.state, oid);
    if (object === undefined) throw new Error(`discardFromHand: unknown object ${oid}`);
    const intrinsic = handDiscardReplacementsFor(object.card, oid, player);
    const outcome = applyReplacements(
      current.state,
      { kind: 'discard', oid, player, cause, destination: 'graveyard' },
      undefined,
      intrinsic,
    );
    current = withState(current, { ...current.state, replacements: outcome.replacements });
    for (const id of outcome.appliedIds) {
      current = emit(current, { type: 'replacementApplied', id, event: 'discard' });
    }
    if (outcome.event !== null && outcome.event.kind === 'discard') {
      current = moveObject(current, oid, outcome.event.destination);
    }
  }
  return emit(current, { type: 'cardsDiscarded', player, oids: [...oids] });
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
  sourceCard?: InstantCard | SorceryCard,
): Trace {
  let current = trace;
  const since = current.events.length;
  for (const [index, step] of effects.entries()) {
    if (
      step.requiresSacrificeThisResolution === true &&
      (tallyThrough(current, since, before).sacrificedPermanents ?? 0) === 0
    ) {
      continue;
    }
    if (step.effect.kind === 'flipCoin') {
      const [pick, rng] = nextBelow(current.state.rng, 2);
      const result = pick === 1 ? 'win' : 'loss';
      current = emit(withState(current, { ...current.state, rng }), {
        type: 'coinFlipped',
        player: controller,
        sourceOid,
        result,
      });
      const selected = result === 'win' ? step.effect.winEffects : step.effect.loseEffects;
      const source = tryObject(current.state, sourceOid);
      const sourceTarget: Target | null =
        source?.zone === 'battlefield' ? { kind: 'permanent', oid: sourceOid } : null;
      const branch: readonly PendingResolutionEffect[] = (selected ?? []).map((effect) => ({
        effect,
        target: hasTarget(effect) && isSourceBodyOnlyTarget(effect.target.kind) ? sourceTarget : null,
        ...(step.sourceCharacteristics === undefined
          ? {}
          : { sourceCharacteristics: step.sourceCharacteristics }),
      }));
      return applyResolutionEffects(
        current,
        sourceOid,
        controller,
        [...branch, ...effects.slice(index + 1)],
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
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
        sourceCard,
      );
    }
    if (step.effect.kind === 'addMana' && step.effect.produces.length > 1) {
      return awaitManaColor(
        current,
        sourceOid,
        controller,
        step.effect,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'reorderTopLibrary') {
      return awaitTopLibrary(
        current,
        sourceOid,
        controller,
        'order',
        current.state.players[controller].library.slice(0, step.effect.count),
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'selectFromTopLibrary') {
      const cards = current.state.players[controller].library.slice(0, step.effect.count);
      const eligible = selectPrintedByCardFilter(current.state, cards, step.effect.filter);
      if (step.effect.rest === 'graveyard' && step.effect.revealAll === true) {
        current = revealTopCards(current, controller, step.effect.count);
      }
      return awaitTopLibrary(
        current,
        sourceOid,
        controller,
        'select',
        cards,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
        eligible,
        step.effect.rest,
        step.effect.revealAll,
      );
    }
    if (step.effect.kind === 'separateTopLibraryIntoPiles') {
      const cards = current.state.players[controller].library.slice(0, step.effect.count);
      current = revealTopCards(current, controller, step.effect.count);
      return awaitTopLibrary(
        current,
        sourceOid,
        controller,
        'partition',
        cards,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'playRandomHandCardWithoutPayingManaCost') {
      const player = playerOf(step.target);
      if (player === null) continue;
      const hand = current.state.players[player].hand;
      if (hand.length === 0) continue;
      const [pick, rng] = nextBelow(current.state.rng, hand.length);
      const oid = hand[pick];
      if (oid === undefined) throw new Error('random hand play selected outside the hand');
      current = emit(withState(current, { ...current.state, rng }), {
        type: 'handRevealed',
        player,
        oids: [oid],
      });
      const object = tryObject(current.state, oid);
      if (object?.card.kind === 'land') {
        current = moveObject(current, oid, 'battlefield', { controller: player });
        continue;
      }
      if (object === undefined || !isCastable(object.card)) continue;
      const pending = awaitFreeCast(
        current,
        sourceOid,
        controller,
        player,
        oid,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        false,
        sourceCard,
      );
      if (freeCastOptionsForCard(pending.state, player, oid, object.card, 1).items.length === 0) continue;
      return pending;
    }
    if (step.effect.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts') {
      if (step.effect.topXOriginalsProfile === true) {
        const chosenX = x ?? 0;
        const tops = current.state.players[controller].library.slice(0, chosenX);
        current = tops.reduce((next, oid) => moveObject(next, oid, 'exile'), current);
        const batch = tops.flatMap((oid): readonly PendingExiledBatchCard[] => {
          const object = tryObject(current.state, oid);
          return object?.zone === 'exile' ? [{ oid, incarnation: object.incarnation ?? 0 }] : [];
        });
        const candidates = batch.flatMap((candidate): readonly PendingOriginalFreeCast[] => {
          const object = tryObject(current.state, candidate.oid);
          const card = object?.card;
          return card !== undefined &&
            (card.kind === 'instant' || card.kind === 'sorcery') &&
            manaValue(card.manaCost) <= chosenX
            ? [{ ...candidate, card }]
            : [];
        });
        const continuation = {
          sourceOid,
          ...(sourceCard === undefined ? {} : { sourceCard }),
          controller,
          remaining: effects.slice(index + 1),
          x,
          objectToGraveyard,
          tally: tallyThrough(current, since, before),
          deferredTriggers: [...deferredTriggers, ...collectTriggers(current, since)],
        };
        const pending = awaitOriginalCardCasts(current, candidates, batch, continuation);
        if (pending !== null) return pending;
        current = cleanExiledBatch(current, batch);
        continue;
      }
      const candidates = copiedCardCandidates(current, since);
      const pending = awaitCopiedCardCasts(current, candidates, {
        sourceOid,
        ...(sourceCard === undefined ? {} : { sourceCard }),
        controller,
        remaining: effects.slice(index + 1),
        x,
        objectToGraveyard,
        tally: tallyThrough(current, since, before),
        deferredTriggers: [...deferredTriggers, ...collectTriggers(current, since)],
      });
      if (pending !== null) return pending;
      continue;
    }
    if (step.effect.kind === 'changeSpellTargets' || step.effect.kind === 'copySpell') {
      if (step.target === null || step.target.kind !== 'spell') continue;
      return awaitSpellTargets(
        current,
        sourceOid,
        controller,
        step.target.oid,
        step.effect.kind,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'searchLibrary') {
      const banked = tallyThrough(current, since, before);
      const filterQuotas = step.effect.filterQuotas;
      const printedCount = filterQuotas === undefined ? step.effect.count : undefined;
      const filter = step.effect.filter;
      if (filterQuotas === undefined && filter === undefined) {
        throw new Error('a homogeneous search needs a card filter');
      }
      const homogeneousFilter = filter ?? {};
      const selection =
        filterQuotas !== undefined
          ? ({ kind: 'filterQuotas', quotas: filterQuotas } as const)
          : ({
              kind: 'homogeneous',
              filter: homogeneousFilter,
              count:
                printedCount === undefined
                  ? 1
                  : searchCount(current, printedCount, since, controller, sourceOid, x, banked),
            } as const);
      return awaitSearch(
        current,
        sourceOid,
        controller,
        controller,
        selection,
        step.effect.destination,
        filterQuotas !== undefined ||
          Object.keys(homogeneousFilter).length > 0 ||
          (printedCount !== undefined && (!isLiteralAmount(printedCount) || printedCount !== 1)),
        step.effect.reveal === true,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        banked,
        [...deferredTriggers, ...collectTriggers(current, since)],
        step.effect.destination === 'sourceLinkedExile' ? step.sourceBattlefieldIncarnation : undefined,
        sourceCard,
      );
    }
    if (step.effect.kind === 'exileNonbasicGraveyardAndMatchingLibrary') {
      const target = playerOf(step.target);
      if (target === null) continue;
      const exiled = exileNonbasicGraveyard(current, target);
      current = exiled.trace;
      const banked = tallyThrough(current, since, before);
      const heldTriggers = [...deferredTriggers, ...collectTriggers(current, since)];
      if (exiled.names.length === 0) {
        return applyResolutionEffects(
          shuffleLibrary(current, target),
          sourceOid,
          controller,
          effects.slice(index + 1),
          x,
          objectToGraveyard,
          banked,
          heldTriggers,
          sourceCard,
        );
      }
      return awaitSearch(
        current,
        sourceOid,
        controller,
        target,
        {
          kind: 'homogeneous',
          filter: { names: [...exiled.names] },
          count: current.state.players[target].library.length,
        },
        'exile',
        true,
        false,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        banked,
        heldTriggers,
        undefined,
        sourceCard,
      );
    }
    if (step.effect.kind === 'eachPlayerNamesCardThenRevealsTop') {
      const [first, ...rest] = apnapOrder(current.state);
      if (first === undefined) continue;
      return awaitCardNameChoice(
        current,
        sourceOid,
        controller,
        first,
        rest,
        [],
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'nameNonlandCardAndExileMatchingOpponentZones') {
      const targetPlayer = playerOf(step.target);
      if (targetPlayer === null) continue;
      return awaitCardNameChoice(
        current,
        sourceOid,
        controller,
        controller,
        [],
        [],
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
        targetPlayer,
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
        sourceCard,
      );
    }
    if (step.effect.kind === 'chooseFromBattlefield') {
      const effect = step.effect;
      const candidates = current.state.battlefield
        .filter(
          (oid) =>
            controllerOf(current.state, oid) === controller &&
            satisfiesTargetFilter(current.state, oid, effect.filter),
        )
        .map((oid): PendingPermanentUntapChoice => ({
          oid,
          incarnation: current.state.objects[oid]?.incarnation ?? 0,
        }));
      if (candidates.length === 0) continue;
      if (candidates.length === 1) {
        const only = candidates[0];
        if (only !== undefined) current = moveObject(current, only.oid, effect.destination);
        continue;
      }
      return awaitBattlefieldChoice(
        current,
        sourceOid,
        controller,
        candidates,
        effect.filter,
        effect.destination,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'populate') {
      const tokens = current.state.battlefield
        .filter((oid) => {
          const object = current.state.objects[oid];
          return (
            object?.token === true &&
            controllerOf(current.state, oid) === controller &&
            isCreatureObject(current.state, oid)
          );
        })
        .map((oid): PendingPopulateCandidate => ({
          oid,
          incarnation: current.state.objects[oid]?.incarnation ?? 0,
        }));
      if (tokens.length === 0) continue;
      return awaitPopulate(
        current,
        sourceOid,
        controller,
        tokens,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
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
        sourceCard,
      );
    }
    if (step.effect.kind === 'discardCards' || step.effect.kind === 'chooseDiscard') {
      // One branch for two kinds, because CR 701.8 is one action and the two
      // differ only in who answers it. `chooseDiscard` also performs CR
      // 701.16a's reveal first, and that reveal is what licenses asking a seat
      // about cards in a hidden zone it does not own.
      const chooseDiscard = step.effect.kind === 'chooseDiscard';
      const owner =
        step.effect.kind === 'discardCards' &&
        step.effect.players === undefined &&
        step.effect.target.kind === 'noTarget' &&
        step.target === null
          ? controller
          : playerOf(step.target);
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
          ? selectPrintedByCardFilter(current.state, hand, step.effect.filter)
          : hand;
      // The reveal has already happened, so a hand with nothing the filter
      // matches is a Duress that showed the opponent's hand and took none of
      // it. That is the printed outcome, not a degenerate one.
      if (choosable.length === 0) continue;
      const countFrom = step.effect.kind === 'discardCards' ? step.effect.countFrom : undefined;
      if (countFrom === 'chosenX' && x === null) {
        throw new Error('chosen-X discard resolved without an X value');
      }
      const discardCount =
        step.effect.count === 'all' ? choosable.length : countFrom === 'chosenX' ? x! : step.effect.count;
      if (discardCount === 0) continue;
      // CR 701.8a discards as many as possible when the count exceeds what can
      // be discarded, and a count that takes every card the chooser may name
      // leaves no choice to ask about — so that case is performed here rather
      // than banked. The comparison is against `choosable` rather than the hand
      // because those are the cards CR 701.8a can actually reach.
      if (choosable.length <= discardCount) {
        current = discardFromHand(current, owner, choosable, { sourceOid, controller });
        continue;
      }
      if (step.effect.kind === 'discardCards' && step.effect.random === true) {
        const pool = [...choosable];
        const chosen: ObjectId[] = [];
        let rng = current.state.rng;
        for (let remaining = discardCount; remaining > 0; remaining -= 1) {
          const [pick, advanced] = nextBelow(rng, pool.length);
          rng = advanced;
          const [oid] = pool.splice(pick, 1);
          if (oid === undefined) throw new Error('random discard selected outside the hand');
          chosen.push(oid);
        }
        current = withState(current, { ...current.state, rng });
        current = discardFromHand(current, owner, chosen, { sourceOid, controller });
        continue;
      }
      return awaitHandDiscard(
        current,
        sourceOid,
        controller,
        chooseDiscard ? controller : owner,
        owner,
        discardCount,
        choosable,
        chooseDiscard,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'chooseFromRevealedHand') {
      const owner = playerOf(step.target);
      if (owner === null) continue;
      const hand = current.state.players[owner].hand;
      current = emit(current, { type: 'handRevealed', player: owner, oids: [...hand] });
      const choosable = selectPrintedByCardFilter(current.state, hand, step.effect.filter);
      if (choosable.length === 0) continue;
      return awaitRevealedHandChoice(
        current,
        sourceOid,
        controller,
        owner,
        choosable,
        step.effect.outcome,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'sacrificePermanent') {
      // CR 101.4: every affected seat chooses in APNAP order, then all chosen
      // permanents are sacrificed together. Candidate groups are frozen before
      // the first pause, so an early choice cannot remove a type-changing
      // permanent and change what a later seat was required to choose among.
      const targetedPlayer = playerOf(step.target);
      const players =
        step.effect.players === undefined
          ? targetedPlayer === null
            ? step.effect.target.kind === 'noTarget'
              ? [controller]
              : []
            : [targetedPlayer]
          : playersInSweep(current.state, step.effect.players, controller);
      const groups = permanentSacrificeGroups(
        current.state,
        players,
        step.effect.count ?? 1,
        step.effect.filter ?? DEFAULT_SACRIFICE_FILTER,
        step.effect.excludeSource === true &&
          current.state.objects[sourceOid]?.zone === 'battlefield' &&
          (step.sourceIncarnationAtStackCreation === undefined ||
            (current.state.objects[sourceOid]?.incarnation ?? 0) === step.sourceIncarnationAtStackCreation)
          ? sourceOid
          : undefined,
      );
      const plan = advancePermanentSacrifice(groups, []);
      if (plan.kind === 'complete') {
        const sacrificedPower = plan.chosen[0] === undefined ? 0 : powerOf(current.state, plan.chosen[0].oid);
        const sacrificed = sacrificeChosenPermanents(current, plan.chosen);
        return applyResolutionEffects(
          sacrificed,
          sourceOid,
          controller,
          effects.slice(index + 1),
          x,
          objectToGraveyard,
          {
            ...tallyThrough(sacrificed, since, before),
            sacrificedPermanents: (before.sacrificedPermanents ?? 0) + plan.chosen.length,
            sacrificedPermanentPower: sacrificedPower,
          },
          [...deferredTriggers, ...collectTriggers(sacrificed, since)],
          sourceCard,
        );
      }
      return awaitPermanentSacrifice(
        current,
        sourceOid,
        controller,
        plan.group.player,
        plan.group.permanents,
        plan.group.count,
        plan.remainingGroups,
        plan.chosen,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
      );
    }
    if (step.effect.kind === 'untapPermanents') {
      const effect = step.effect;
      const permanents = current.state.battlefield
        .filter(
          (oid) =>
            canUntapObject(current.state, oid) && satisfiesTargetFilter(current.state, oid, effect.filter),
        )
        .map((oid) => ({ oid, incarnation: current.state.objects[oid]?.incarnation ?? 0 }));
      if (permanents.length === 0) continue;
      return awaitPermanentUntap(
        current,
        sourceOid,
        controller,
        permanents,
        [],
        effect.upTo,
        effect.filter,
        effects.slice(index + 1),
        x,
        objectToGraveyard,
        tallyThrough(current, since, before),
        [...deferredTriggers, ...collectTriggers(current, since)],
        sourceCard,
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
      step.damageAllocation,
      step.referentToughness,
      step.sourceLinkedExile,
      step.sourceBattlefieldIncarnation,
      sourceCard,
      step.paidSacrificePower,
      step.paidSacrificeToughness,
      step.paidDiscardManaValue,
      step.sourceIncarnationAtStackCreation,
      step.sourceAbilityIndex,
      step.delayedSourceCard,
      step.sourceCharacteristics,
      step.triggeringCreaturePower,
      step.triggeringCreatureToughness,
      step.referentOid,
      step.referentPlayer,
    );
    if (current.state.result !== null) return current;
    if (current.state.pendingBattlefieldEntryBatch !== undefined) {
      const batch = current.state.pendingBattlefieldEntryBatch;
      return withState(current, {
        ...current.state,
        pendingBattlefieldEntryBatch: {
          ...batch,
          resolution: {
            sourceOid,
            ...(sourceCard === undefined ? {} : { sourceCard }),
            controller,
            remaining: effects.slice(index + 1),
            x,
            objectToGraveyard,
            tally: tallyThrough(current, since, before),
            deferredTriggers: [...deferredTriggers, ...collectTriggers(current, since)],
          },
        },
      });
    }
    if (current.state.turn.awaiting === 'damagePrevention') {
      const pending = current.state.pendingDamagePrevention;
      if (pending === undefined) {
        throw new Error('applyResolutionEffects: damage allocation has no pending batch');
      }
      return withState(current, {
        ...current.state,
        pendingDamagePrevention: {
          ...pending,
          resolution: {
            sourceOid,
            ...(sourceCard === undefined ? {} : { sourceCard }),
            controller,
            remaining: effects.slice(index + 1),
            x,
            objectToGraveyard,
            tally: tallyThrough(current, since, before),
            deferredTriggers: [...deferredTriggers, ...collectTriggers(current, since)],
          },
        },
      });
    }
  }
  if (deferredTriggers.length > 0) {
    current = withState(current, { ...current.state, deferredTriggers });
  }
  if (objectToGraveyard === null) return current;
  const resolvedSpell = tryObject(current.state, objectToGraveyard);
  return resolvedSpell?.zone === 'stack' ? moveObject(current, objectToGraveyard, 'graveyard') : current;
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
    pending.sourceCard,
  );
}

/** Applies one legal color and resumes the interrupted ordinary resolution. */
export function answerManaColor(
  trace: Trace,
  player: PlayerId,
  color: PendingManaColorChoice['colors'][number],
): Trace {
  const pending = trace.state.pendingManaColorChoice;
  if (pending === undefined || pending.player !== player || !pending.colors.includes(color)) {
    throw new Error('answerManaColor: no matching mana-color choice is pending');
  }
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingManaColorChoice: _answered, ...withoutPending } = clearedState;
  return applyResolutionEffects(
    withState(trace, withoutPending),
    pending.sourceOid,
    pending.controller,
    [{ effect: { ...pending.effect, produces: [color] }, target: null }, ...pending.remaining],
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

function resumeTopLibrary(trace: Trace, pending: PendingTopLibrary): Trace {
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingTopLibrary: _answered, ...withoutPending } = clearedState;
  return applyResolutionEffects(
    withState(trace, withoutPending),
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

export function answerTopLibraryOrder(trace: Trace, cards: readonly ObjectId[]): Trace {
  const pending = trace.state.pendingTopLibrary;
  if (pending?.kind !== 'order') throw new Error('answerTopLibraryOrder: no order is pending');
  const tail = trace.state.players[pending.player].library.slice(pending.cards.length);
  return resumeTopLibrary(
    withState(
      trace,
      updatePlayer(trace.state, pending.player, (p) => ({
        ...p,
        library: pending.orderDestination === 'bottom' ? [...tail, ...cards] : [...cards, ...tail],
      })),
    ),
    pending,
  );
}

export function answerTopLibrarySelect(
  trace: Trace,
  chosen: ObjectId | null,
  rest: readonly ObjectId[],
): Trace {
  const pending = trace.state.pendingTopLibrary;
  if (pending?.kind !== 'select') throw new Error('answerTopLibrarySelect: no selection is pending');
  if (
    pending.guildFeud?.phase === 'opponentSelection' ||
    pending.guildFeud?.phase === 'controllerSelection'
  ) {
    const nextPhase = pending.guildFeud.phase === 'opponentSelection' ? 'opponentEntry' : 'controllerEntry';
    const staged = withState(trace, {
      ...withTurn(trace.state, { awaiting: null, awaitingPlayer: null }),
      pendingTopLibrary: {
        ...pending,
        guildFeud: { ...pending.guildFeud, phase: nextPhase, ...(chosen === null ? {} : { chosen }) },
      },
    });
    if (chosen === null) return continueGuildFeudContest(staged);
    const entered = moveObject(staged, chosen, 'battlefield', { controller: pending.player });
    return entered.state.turn.awaiting === null ? continueGuildFeudContest(entered) : entered;
  }
  if (pending.selectionRest === 'graveyard') {
    let current = trace;
    if (chosen !== null) current = moveObject(current, chosen, 'hand');
    for (const oid of rest) current = moveObject(current, oid, 'graveyard');
    return resumeTopLibrary(current, pending);
  }
  const tail = trace.state.players[pending.player].library.slice(pending.cards.length);
  const reported =
    chosen === null || pending.selectionPublic === true
      ? trace
      : emit(trace, { type: 'libraryCardsRevealed', player: pending.player, oids: [chosen] });
  let current = withState(
    reported,
    updatePlayer(reported.state, pending.player, (p) => ({ ...p, library: [...tail, ...rest] })),
  );
  if (chosen !== null) current = moveObject(current, chosen, 'hand');
  return resumeTopLibrary(current, pending);
}

/** Resumes Guild Feud after one selected creature has completed all as-entry choices. */
export function continueGuildFeudContest(trace: Trace): Trace {
  const pending = trace.state.pendingTopLibrary;
  const contest = pending?.guildFeud;
  if (
    pending?.kind !== 'select' ||
    contest === undefined ||
    (contest.phase !== 'opponentEntry' && contest.phase !== 'controllerEntry')
  ) {
    return trace;
  }
  let current = trace;
  const chosen = contest.chosen;
  const object = chosen === undefined ? undefined : tryObject(current.state, chosen);
  const entered =
    object?.zone === 'battlefield' && isCreatureObject(current.state, chosen!)
      ? { oid: chosen!, incarnation: object.incarnation ?? 0 }
      : undefined;
  for (const oid of pending.cards) {
    if (oid !== chosen && tryObject(current.state, oid)?.zone === 'library') {
      current = moveObject(current, oid, 'graveyard');
    }
  }
  const carriedTriggers = [...pending.deferredTriggers, ...collectTriggers(current, 0)];
  const carried: PendingTopLibrary = { ...pending, deferredTriggers: carriedTriggers };
  if (contest.phase === 'opponentEntry') {
    return awaitGuildFeudSelection(current, carried, pending.controller, 'controllerSelection', entered);
  }
  const { pendingTopLibrary: _answered, ...withoutPending } = withTurn(current.state, {
    awaiting: null,
    awaitingPlayer: null,
  });
  current = withState(current, withoutPending);
  const first = contest.firstCreature;
  const firstObject = first === undefined ? undefined : tryObject(current.state, first.oid);
  const secondObject = entered === undefined ? undefined : tryObject(current.state, entered.oid);
  const bothCurrent =
    first !== undefined &&
    entered !== undefined &&
    firstObject?.zone === 'battlefield' &&
    (firstObject.incarnation ?? 0) === first.incarnation &&
    secondObject?.zone === 'battlefield' &&
    (secondObject.incarnation ?? 0) === entered.incarnation;
  if (bothCurrent) current = fightCreatures(current, first.oid, entered.oid);
  return applyResolutionEffects(
    current,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    tallyThrough(current, 0, pending.tally),
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

export function answerTopLibraryPartition(
  trace: Trace,
  first: readonly ObjectId[],
  second: readonly ObjectId[],
): Trace {
  const pending = trace.state.pendingTopLibrary;
  if (pending?.kind !== 'partition') throw new Error('answerTopLibraryPartition: no partition is pending');
  const next: PendingTopLibrary = {
    ...pending,
    kind: 'pile',
    chooser: pending.controller,
    piles: [first, second],
  };
  return withState(trace, {
    ...withTurn(trace.state, { awaiting: 'topLibraryPile', awaitingPlayer: pending.controller }),
    pendingTopLibrary: next,
  });
}

export function answerTopLibraryPile(trace: Trace, pile: 0 | 1): Trace {
  const pending = trace.state.pendingTopLibrary;
  if (pending?.kind !== 'pile' || pending.piles === undefined)
    throw new Error('answerTopLibraryPile: no pile choice is pending');
  const hand = pending.piles[pile];
  const rest = pending.piles[pile === 0 ? 1 : 0];
  let current = trace;
  for (const oid of hand) current = moveObject(current, oid, 'hand');
  if (pending.pileRest === 'bottom') {
    if (rest.length <= 1) {
      const tail = current.state.players[pending.player].library.slice(rest.length);
      return resumeTopLibrary(
        withState(
          current,
          updatePlayer(current.state, pending.player, (player) => ({
            ...player,
            library: [...tail, ...rest],
          })),
        ),
        pending,
      );
    }
    const next: PendingTopLibrary = {
      ...pending,
      kind: 'order',
      chooser: pending.controller,
      cards: rest,
      orderDestination: 'bottom',
    };
    return withState(current, {
      ...withTurn(current.state, { awaiting: 'topLibraryOrder', awaitingPlayer: pending.controller }),
      pendingTopLibrary: next,
    });
  }
  for (const oid of rest) current = moveObject(current, oid, 'graveyard');
  return resumeTopLibrary(current, pending);
}

/** Applies the final target tuple, creates a copy when asked, and resumes. */
export function answerSpellTargets(
  trace: Trace,
  targets: readonly (Target | null)[],
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
): Trace {
  const pending = trace.state.pendingSpellTargets;
  if (pending === undefined) throw new Error('answerSpellTargets: no spell target choice is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingSpellTargets: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const since = cleared.events.length;
  const tuple = {
    targets,
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
  };
  const changed =
    pending.operation === 'copySpell'
      ? copySpellOnStack(cleared, pending.spell, { ...tuple, controller: pending.controller })
      : changeSpellTargetsOnStack(cleared, pending.player, pending.spell, tuple);
  return applyResolutionEffects(
    changed,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    [...pending.deferredTriggers, ...collectTriggers(changed, since)],
    pending.sourceCard,
  );
}

/** Finishes the interrupted instruction after its required cast declaration. */
export function finishFreeCast(trace: Trace, chosenOid: ObjectId): Trace {
  const pending = trace.state.pendingFreeCast;
  if (pending === undefined) throw new Error('finishFreeCast: no free cast is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingFreeCast: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const remainingCopies = pending.copyCandidates?.filter((candidate) => candidate.oid !== chosenOid);
  if (remainingCopies !== undefined) {
    const next = awaitCopiedCardCasts(cleared, remainingCopies, {
      sourceOid: pending.sourceOid,
      ...(pending.sourceCard === undefined ? {} : { sourceCard: pending.sourceCard }),
      controller: pending.controller,
      remaining: pending.remaining,
      x: pending.x,
      objectToGraveyard: pending.objectToGraveyard,
      tally: pending.tally,
      deferredTriggers: [...pending.deferredTriggers, ...collectTriggers(cleared, 0)],
    });
    if (next !== null) return next;
  }
  const remainingOriginals = pending.originalCandidates?.filter((candidate) => candidate.oid !== chosenOid);
  if (remainingOriginals !== undefined) {
    const next = awaitOriginalCardCasts(cleared, remainingOriginals, pending.cleanupExileBatch, {
      sourceOid: pending.sourceOid,
      ...(pending.sourceCard === undefined ? {} : { sourceCard: pending.sourceCard }),
      controller: pending.controller,
      remaining: pending.remaining,
      x: pending.x,
      objectToGraveyard: pending.objectToGraveyard,
      tally: pending.tally,
      deferredTriggers: [...pending.deferredTriggers, ...collectTriggers(cleared, 0)],
    });
    if (next !== null) return next;
  }
  const resumed =
    pending.cleanupExileBatch === undefined ? cleared : cleanExiledBatch(cleared, pending.cleanupExileBatch);
  return applyResolutionEffects(
    resumed,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    [...pending.deferredTriggers, ...collectTriggers(cleared, 0)],
    pending.sourceCard,
  );
}

/** Declines an optional free-cast permission and finishes its resolution. */
export function declineFreeCast(trace: Trace): Trace {
  const pending = trace.state.pendingFreeCast;
  if (pending?.optional !== true) throw new Error('declineFreeCast: no optional free cast is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingFreeCast: _answered, ...withoutPending } = clearedState;
  const cleared = emit(withState(trace, withoutPending), {
    type: 'freeCastDeclined',
    oid: pending.oid,
    player: pending.player,
  });
  const resumed =
    pending.cleanupExileBatch === undefined ? cleared : cleanExiledBatch(cleared, pending.cleanupExileBatch);
  return applyResolutionEffects(
    resumed,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
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
  if (pending.activeFilterQuota !== undefined) {
    const quotaTaken = (pending.activeFilterQuotaTaken ?? 0) + (found === null ? 0 : 1);
    if (found !== null && quotaTaken < pending.activeFilterQuota.count) {
      const next = searchCandidatesAfter(pending.cards, found);
      if (next.length > 0) {
        return searchPause(trace, {
          ...pending,
          cards: next,
          taken,
          activeFilterQuotaTaken: quotaTaken,
        });
      }
    }
    const [nextQuota, ...remainingFilterQuotas] = pending.remainingFilterQuotas ?? [];
    if (nextQuota !== undefined) {
      const cards = searchableCards(trace.state, pending.libraryOwner, nextQuota.filter).filter(
        (oid) => !taken.includes(oid),
      );
      return searchPause(trace, {
        ...pending,
        cards,
        taken,
        activeFilterQuota: nextQuota,
        remainingFilterQuotas,
        activeFilterQuotaTaken: 0,
      });
    }
  }
  // A search for more than one is asked again rather than answered wider, and
  // the two ways it stops early are both CR 701.19b's: the seat declines, or the
  // matches after the last one taken run out. Neither is an error and neither
  // needs a flag — a search that took one of two took one.
  if (pending.activeFilterQuota === undefined && found !== null && taken.length < pending.count) {
    const next = searchCandidatesAfter(pending.cards, found);
    if (next.length > 0) return searchPause(trace, { ...pending, cards: next, taken });
  }
  const reported = emit(trace, {
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
  if (typeof pending.destination !== 'string' && taken.length > 1) {
    return withState(shown, {
      ...withTurn(shown.state, {
        priority: null,
        awaiting: 'searchDestination',
        awaitingPlayer: pending.player,
      }),
      pendingSearch: { ...pending, cards: [], taken },
    });
  }
  return completeSearch(shown, pending, taken, taken[0] ?? null);
}

/** Assigns the controller's chosen card, then completes the interrupted search. */
export function answerSearchDestination(trace: Trace, one: ObjectId): Trace {
  const pending = trace.state.pendingSearch;
  if (pending === undefined) {
    throw new Error('answerSearchDestination: no search destination is pending');
  }
  return completeSearch(trace, pending, pending.taken, one);
}

function moveSearchedCards(
  trace: Trace,
  destination: SearchedCardZoneDestination,
  cards: readonly ObjectId[],
): Trace {
  const { zone, tapped } = searchDestinationZone(destination);
  return cards.reduce((current, oid) => moveObject(current, oid, zone, { tapped }), trace);
}

function completeSearch(
  trace: Trace,
  pending: PendingSearch,
  taken: readonly ObjectId[],
  one: ObjectId | null,
): Trace {
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingSearch: _answered, ...withoutPendingSearch } = clearedState;
  const cleared = withState(trace, withoutPendingSearch);
  if (pending.destination === 'libraryTop') {
    const shuffled = shuffleLibrary(cleared, pending.libraryOwner);
    const placed =
      one === null
        ? shuffled
        : withState(
            shuffled,
            updatePlayer(shuffled.state, pending.libraryOwner, (player) => ({
              ...player,
              library: [one, ...player.library.filter((oid) => oid !== one)],
            })),
          );
    return applyResolutionEffects(
      placed,
      pending.sourceOid,
      pending.controller,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      pending.sourceCard,
    );
  }
  let moved: Trace;
  if (pending.destination === 'sourceLinkedExile') {
    const exiled = taken.reduce((current, oid) => moveObject(current, oid, 'exile'), cleared);
    moved = linkExileToSource(exiled, pending.sourceOid, pending.sourceBattlefieldIncarnation, taken);
  } else if (typeof pending.destination === 'string') {
    moved = moveSearchedCards(cleared, pending.destination, taken);
  } else if (taken.length === 0) {
    moved = cleared;
  } else {
    if (one === null || !taken.includes(one)) {
      throw new Error('completeSearch: the one destination needs a card found by this search');
    }
    const withOne = moveSearchedCards(cleared, pending.destination.one, [one]);
    const restDestination =
      pending.destination.kind === 'oneToHandRestToGraveyard' ? 'graveyard' : pending.destination.rest;
    moved = moveSearchedCards(
      withOne,
      restDestination,
      taken.filter((oid) => oid !== one),
    );
  }
  const shuffled = shuffleLibrary(moved, pending.libraryOwner);
  if (pending.jaceArchitectOwnersRemaining !== undefined) {
    const newlyExiled = taken.flatMap((oid): readonly PendingOriginalFreeCast[] => {
      const object = tryObject(shuffled.state, oid);
      return object?.zone === 'exile' && isCastable(object.card)
        ? [{ oid, incarnation: object.incarnation ?? 0, card: object.card }]
        : [];
    });
    const exiled = [...(pending.jaceArchitectExiled ?? []), ...newlyExiled];
    const [nextOwner, ...ownersRemaining] = pending.jaceArchitectOwnersRemaining;
    if (nextOwner !== undefined) {
      return awaitSearch(
        shuffled,
        pending.sourceOid,
        pending.controller,
        nextOwner,
        { kind: 'homogeneous', filter: { excludeCardTypes: ['land'] }, count: 1 },
        'exile',
        true,
        false,
        pending.remaining,
        pending.x,
        pending.objectToGraveyard,
        pending.tally,
        pending.deferredTriggers,
        undefined,
        pending.sourceCard,
        { ownersRemaining, exiled },
      );
    }
    const freeCast = awaitOriginalCardCasts(shuffled, exiled, undefined, {
      sourceOid: pending.sourceOid,
      ...(pending.sourceCard === undefined ? {} : { sourceCard: pending.sourceCard }),
      controller: pending.controller,
      remaining: pending.remaining,
      x: pending.x,
      objectToGraveyard: pending.objectToGraveyard,
      tally: pending.tally,
      deferredTriggers: pending.deferredTriggers,
    });
    if (freeCast !== null) return freeCast;
  }
  return applyResolutionEffects(
    shuffled,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
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
    pending.sourceCard,
  );
}

/** Moves the chosen controlled permanent and resumes the interrupted resolution. */
export function answerBattlefieldChoice(trace: Trace, chosen: ObjectId): Trace {
  const pending = trace.state.pendingBattlefieldChoice;
  if (pending === undefined) throw new Error('answerBattlefieldChoice: no battlefield choice is pending');
  const candidate = pending.permanents.find((entry) => entry.oid === chosen);
  if (candidate === undefined || !isCurrentBattlefieldChoiceCandidate(trace.state, pending, candidate)) {
    throw new Error(`answerBattlefieldChoice: ${chosen} is no longer an eligible permanent`);
  }
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingBattlefieldChoice: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const moved = moveObject(cleared, chosen, pending.destination);
  return applyResolutionEffects(
    moved,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

/** Copies the chosen token's copiable values, then resumes the interrupted resolution once. */
export function answerPopulate(trace: Trace, token: ObjectId): Trace {
  const pending = trace.state.pendingPopulate;
  if (pending === undefined) throw new Error('answerPopulate: no Populate choice is pending');
  const candidate = pending.tokens.find((entry) => entry.oid === token);
  if (candidate === undefined || !isCurrentPopulateCandidate(trace.state, pending, candidate)) {
    throw new Error(`answerPopulate: ${token} is no longer an eligible creature token`);
  }
  const copiedCard = copiableValuesOf(trace.state, token);
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingPopulate: _answered, ...withoutPending } = clearedState;
  const created = createCopiedToken(withState(trace, withoutPending), pending.controller, copiedCard);
  return applyResolutionEffects(
    created,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
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
  return grantOnGraveyardArrival(moved, chosen, pending.alsoBecomes, pending.sourceOid);
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
  const discarded = discardFromHand(cleared, pending.owner, oids, {
    sourceOid: pending.sourceOid,
    controller: pending.controller,
  });
  return applyResolutionEffects(
    discarded,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

/** Answers a linked revealed-hand choice and resumes or opens the native free-cast declaration. */
export function answerRevealedHandChoice(trace: Trace, chosen: ObjectId | null): Trace {
  const pending = trace.state.pendingRevealedHandChoice;
  if (pending === undefined) {
    throw new Error('answerRevealedHandChoice: no revealed-hand choice is pending');
  }
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingRevealedHandChoice: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  if (chosen === null) {
    return applyResolutionEffects(
      cleared,
      pending.sourceOid,
      pending.controller,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      pending.sourceCard,
    );
  }
  const selected = tryObject(cleared.state, chosen);
  if (selected === undefined || selected.zone !== 'hand' || selected.owner !== pending.owner) {
    throw new Error(`answerRevealedHandChoice: ${chosen} is no longer in the revealed hand`);
  }
  if (pending.outcome.kind === 'mayCastWithoutPayingManaCost') {
    if (!isCastable(selected.card)) {
      throw new Error('answerRevealedHandChoice: selected card cannot be cast');
    }
    return awaitFreeCast(
      cleared,
      pending.sourceOid,
      pending.controller,
      pending.controller,
      chosen,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      true,
      pending.sourceCard,
    );
  }

  const name = selected.card.name;
  const owner = pending.owner;
  const members = [
    ...cleared.state.players[owner].hand,
    ...cleared.state.players[owner].graveyard,
    ...cleared.state.players[owner].library,
  ];
  const matching = selectPrintedByCardFilter(cleared.state, members, { names: [name] });
  const exiled = matching.reduce((current, oid) => moveObject(current, oid, 'exile'), cleared);
  const shuffled = shuffleLibrary(exiled, owner);
  return applyResolutionEffects(
    shuffled,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    tallyThrough(shuffled, 0, pending.tally),
    pending.deferredTriggers,
    pending.sourceCard,
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
  const chosen: readonly PendingPermanentSacrificeChoice[] = [
    ...pending.chosen,
    { oid, player: pending.player },
  ];
  const remainingCount = pending.remainingCount - 1;
  const remainingCurrent = pending.permanents.filter((candidate) => candidate !== oid);
  const groups: readonly PendingPermanentSacrificeGroup[] = [
    ...(remainingCount > 0
      ? [{ player: pending.player, permanents: remainingCurrent, count: remainingCount }]
      : []),
    ...pending.remainingGroups,
  ];
  const plan = advancePermanentSacrifice(groups, chosen);
  if (plan.kind === 'choice') {
    return awaitPermanentSacrifice(
      cleared,
      pending.sourceOid,
      pending.controller,
      plan.group.player,
      plan.group.permanents,
      plan.group.count,
      plan.remainingGroups,
      plan.chosen,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      pending.sourceCard,
    );
  }
  const sacrificedPower = plan.chosen[0] === undefined ? 0 : powerOf(cleared.state, plan.chosen[0].oid);
  const sacrificed = sacrificeChosenPermanents(cleared, plan.chosen);
  return applyResolutionEffects(
    sacrificed,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    {
      ...pending.tally,
      sacrificedPermanents: (pending.tally.sacrificedPermanents ?? 0) + plan.chosen.length,
      sacrificedPermanentPower: sacrificedPower,
    },
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

/** Applies the selected group in canonical selection order, then resumes. */
export function answerPermanentUntap(trace: Trace, oid: ObjectId | null): Trace {
  const pending = trace.state.pendingPermanentUntap;
  if (pending === undefined) throw new Error('answerPermanentUntap: no permanent untap is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingPermanentUntap: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  let selected: PendingPermanentUntapChoice | null = null;
  if (oid !== null) {
    selected = pending.permanents.find((candidate) => candidate.oid === oid) ?? null;
    if (selected === null) throw new Error(`answerPermanentUntap: ${oid} is not a pending candidate`);
  }
  const chosen = selected === null ? pending.chosen : [...pending.chosen, selected];
  const selectedIndex = selected === null ? -1 : pending.permanents.indexOf(selected);
  const candidates = oid === null ? [] : pending.permanents.slice(selectedIndex + 1);
  const remainingCount = pending.remainingCount - (oid === null ? 0 : 1);

  if (oid !== null && remainingCount > 0 && candidates.length > 0) {
    return awaitPermanentUntap(
      cleared,
      pending.sourceOid,
      pending.controller,
      candidates,
      chosen,
      remainingCount,
      pending.filter,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      pending.sourceCard,
    );
  }

  let untapped = cleared;
  for (const selected of chosen) {
    if (isCurrentPermanentUntapCandidate(untapped.state, pending, selected)) {
      untapped = untapObject(untapped, selected.oid);
    }
  }
  return applyResolutionEffects(
    untapped,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

function canonicalCardName(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

/** Banks one name, then reveals and moves every player's top card together. */
export function answerCardName(trace: Trace, name: string): Trace {
  const pending = trace.state.pendingCardNameChoice;
  if (pending === undefined) throw new Error('answerCardName: no card-name choice is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingCardNameChoice: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const chosen: readonly ChosenCardName[] = [...pending.chosen, { player: pending.player, name }];
  const [next, ...rest] = pending.remainingPlayers;
  if (next !== undefined) {
    return awaitCardNameChoice(
      cleared,
      pending.sourceOid,
      pending.controller,
      next,
      rest,
      chosen,
      pending.remaining,
      pending.x,
      pending.objectToGraveyard,
      pending.tally,
      pending.deferredTriggers,
      pending.sourceCard,
      pending.targetPlayer,
    );
  }

  if (pending.targetPlayer !== undefined) {
    const target = cleared.state.players[pending.targetPlayer];
    const candidates = [...target.graveyard, ...target.hand, ...target.library].filter((oid) => {
      const printed = cleared.state.objects[oid]?.card.name;
      return printed !== undefined && canonicalCardName(printed) === canonicalCardName(name);
    });
    if (candidates.length === 0) {
      return applyResolutionEffects(
        shuffleLibrary(cleared, pending.targetPlayer),
        pending.sourceOid,
        pending.controller,
        pending.remaining,
        pending.x,
        pending.objectToGraveyard,
        pending.tally,
        pending.deferredTriggers,
        pending.sourceCard,
      );
    }
    return awaitNamedZoneExile(cleared, {
      player: pending.controller,
      targetPlayer: pending.targetPlayer,
      name,
      candidates,
      chosen: [],
      sourceOid: pending.sourceOid,
      ...(pending.sourceCard === undefined ? {} : { sourceCard: pending.sourceCard }),
      controller: pending.controller,
      remaining: pending.remaining,
      x: pending.x,
      objectToGraveyard: pending.objectToGraveyard,
      tally: pending.tally,
      deferredTriggers: pending.deferredTriggers,
    });
  }

  const tops = chosen.map(({ player, name: chosenName }) => ({
    player,
    chosenName,
    oid: cleared.state.players[player].library[0] ?? null,
  }));
  let moved = tops.reduce((current, top) => revealTopCards(current, top.player, 1), cleared);
  for (const top of tops) {
    const oid = top.oid;
    if (oid === null) continue;
    const printed = moved.state.objects[oid]?.card.name;
    if (printed !== undefined && canonicalCardName(printed) === canonicalCardName(top.chosenName)) {
      moved = moveObject(moved, oid, 'hand');
      continue;
    }
    moved = withState(
      moved,
      updatePlayer(moved.state, top.player, (player) => ({
        ...player,
        library: [...player.library.filter((entry) => entry !== oid), oid],
      })),
    );
  }
  return applyResolutionEffects(
    moved,
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}

/** Banks one canonical subset member, or applies the chosen set and shuffles. */
export function answerNamedZoneExile(trace: Trace, oid: ObjectId | null): Trace {
  const pending = trace.state.pendingNamedZoneExile;
  if (pending === undefined) throw new Error('answerNamedZoneExile: no named-zone exile is pending');
  const clearedState = withTurn(trace.state, { awaiting: null, awaitingPlayer: null });
  const { pendingNamedZoneExile: _answered, ...withoutPending } = clearedState;
  const cleared = withState(trace, withoutPending);
  const index = oid === null ? -1 : pending.candidates.indexOf(oid);
  if (oid !== null && index < 0) throw new Error(`answerNamedZoneExile: ${oid} is not available`);
  const chosen = oid === null ? pending.chosen : [...pending.chosen, oid];
  const candidates = oid === null ? [] : pending.candidates.slice(index + 1);
  if (oid !== null && candidates.length > 0) {
    return awaitNamedZoneExile(cleared, { ...pending, candidates, chosen });
  }
  const exiled = chosen.reduce((current, selected) => moveObject(current, selected, 'exile'), cleared);
  return applyResolutionEffects(
    shuffleLibrary(exiled, pending.targetPlayer),
    pending.sourceOid,
    pending.controller,
    pending.remaining,
    pending.x,
    pending.objectToGraveyard,
    pending.tally,
    pending.deferredTriggers,
    pending.sourceCard,
  );
}
