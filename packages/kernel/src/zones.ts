/**
 * Object lookup and zone movement.
 *
 * Zones are ordered id lists; the object record is the single home for object
 * data, so a move is "drop the id from one list, add it to another, rewrite one
 * object". Library index 0 is the top of the library.
 */
import type { Card, Color, LibraryPosition, TokenSpec } from '@mtg/dsl';
import { isAuraCard, printedEntryReplacement, tokenCard } from '@mtg/dsl';
import { effectsRegisteredBy, registerStatics } from './abilities';
import { attachAuraTo, detached, isLegalAuraEntryHost, unattachFromHost } from './attach';
import type { ContinuousEffect, Counters } from './continuous';
import {
  addCounters,
  counterCount,
  detachEffectsFromSubject,
  hasCounters,
  NO_COUNTERS,
  setCounterCount,
} from './continuous';
import { costModifiersRegisteredBy, registerCostModifiers } from './cost';
import { registerStaticReplacements, staticReplacementsRegisteredBy } from './static-replacements';
import type { ObjectId, PlayerId } from './ids';
import { objectId } from './ids';
import { lifeLostByOpponentsThisTurn } from './life-history';
import {
  characteristicsOf,
  copiableValuesOf,
  controllerOf,
  hasCardType,
  hasSubtype,
  isCreatureObject,
  startingLoyaltyOf,
  startingDefenseOf,
} from './layers';
import { applyReplacements, earliestTimestamp } from './replacement';
import type { ReplacementEffect } from './replacement-effects';
import { shuffle } from './rng';
import type {
  GameObject,
  GameState,
  EntryCounterKind,
  PendingBattlefieldEntry,
  PendingBattlefieldEntryBatch,
  ZoneId,
} from './state';
import { copiableCardOf } from './state';
import type { Trace } from './trace';
import { emit, playerOf, putObject, updatePlayer, withState } from './trace';
import { zoneChangeReplacementsFor } from './zone-change-replacements';
import { sweepDetentionsForSubject } from './detention';
import { battleProtector } from './siege';
import { loseLife } from './life';
import { removeObjectFromCombat } from './combat-state';
import {
  answerBattlefieldEntryBatch,
  answerEntryTimestampNext as answerEntryTimestampNextInBatch,
  awaitEntryChoice,
  cardWithEntryCharacteristics,
  entryBatchEvaluationState,
  entryChoiceFor,
  mergeEntryBatchReplacements,
  startBattlefieldEntryBatch,
  type ResolvedEntryChoices,
} from './battlefield-entry';

export function tryObject(state: GameState, oid: ObjectId): GameObject | undefined {
  return state.objects[oid];
}

/** Throws on a missing id: a dangling reference is a kernel invariant break. */
export function getObject(state: GameState, oid: ObjectId): GameObject {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`unknown game object: ${oid}`);
  return object;
}

export function updateObject(
  state: GameState,
  oid: ObjectId,
  fn: (object: GameObject) => GameObject,
): GameState {
  return putObject(state, fn(getObject(state, oid)));
}

/** Every object currently on the battlefield, in entry order. */
export function battlefieldObjects(state: GameState): readonly GameObject[] {
  return state.battlefield.map((oid) => getObject(state, oid));
}

/**
 * Creatures on the battlefield, by *derived* type (layer 4), not by printed
 * card type — an animated artifact is a creature here, and a creature whose
 * type was stripped is not.
 */
export function creaturesOnBattlefield(state: GameState): readonly GameObject[] {
  return battlefieldObjects(state).filter((object) => isCreatureObject(state, object.oid));
}

/** Control is layer 2's answer, so a control-change effect moves these lists. */
export function creaturesControlledBy(state: GameState, player: PlayerId): readonly GameObject[] {
  return creaturesOnBattlefield(state).filter((object) => controllerOf(state, object.oid) === player);
}

export function landsControlledBy(state: GameState, player: PlayerId): readonly GameObject[] {
  return battlefieldObjects(state).filter(
    (object) => controllerOf(state, object.oid) === player && hasCardType(state, object.oid, 'land'),
  );
}

export function isOnBattlefield(state: GameState, oid: ObjectId): boolean {
  const object = tryObject(state, oid);
  return object !== undefined && object.zone === 'battlefield';
}

function removeFromZone(state: GameState, object: GameObject): GameState {
  const drop = (ids: readonly ObjectId[]): ObjectId[] => ids.filter((id) => id !== object.oid);
  switch (object.zone) {
    case 'battlefield':
      return { ...state, battlefield: drop(state.battlefield) };
    case 'exile':
      return { ...state, exile: drop(state.exile) };
    case 'stack':
      return { ...state, stack: state.stack.filter((entry) => entry.oid !== object.oid) };
    case 'library':
      return updatePlayer(state, object.owner, (p) => ({ ...p, library: drop(p.library) }));
    case 'hand':
      return updatePlayer(state, object.owner, (p) => ({ ...p, hand: drop(p.hand) }));
    case 'graveyard':
      return updatePlayer(state, object.owner, (p) => ({ ...p, graveyard: drop(p.graveyard) }));
  }
}

function addToZone(state: GameState, object: GameObject, zone: ZoneId): GameState {
  switch (zone) {
    case 'battlefield':
      return { ...state, battlefield: [...state.battlefield, object.oid] };
    case 'exile':
      return { ...state, exile: [...state.exile, object.oid] };
    case 'stack':
      // Stack entries are appended by `stack.ts`, which owns target bookkeeping.
      return state;
    case 'library':
      return updatePlayer(state, object.owner, (p) => ({ ...p, library: [...p.library, object.oid] }));
    case 'hand':
      return updatePlayer(state, object.owner, (p) => ({ ...p, hand: [...p.hand, object.oid] }));
    case 'graveyard':
      return updatePlayer(state, object.owner, (p) => ({ ...p, graveyard: [...p.graveyard, object.oid] }));
  }
}

/**
 * How a permanent arrives on the battlefield, after CR 614 replacement effects
 * have had their say ("enters tapped", "enters with a +1/+1 counter" — both are
 * replacement effects modifying the entry event, not triggers).
 */
interface Arrival {
  readonly state: GameState;
  readonly tapped: boolean;
  readonly counters: Counters;
  readonly appliedIds: readonly string[];
}

/**
 * `forcedTapped` is an effect saying "tapped" about *this* arrival, which is
 * not the same fact as a card printing "enters tapped" and is why it is a
 * parameter rather than another `printedEntryReplacement` kind. Farseek's land
 * has nothing printed on it; the search put it down tapped. Both end at the
 * same intrinsic CR 614 modification below, so an "enters untapped"
 * replacement — none exists yet — would see one event to replace rather than
 * two ways of arriving.
 */
function arrivalOf(
  state: GameState,
  oid: ObjectId,
  controller: PlayerId,
  forcedTapped = false,
  copiedCard?: Card,
  chosenX = 0,
  optionalCounter?: { readonly counter: EntryCounterKind; readonly count: number },
  paidEntryLife?: boolean,
): Arrival {
  const object = getObject(state, oid);
  // Every card kind that prints an entry clause, read through the one
  // derivation in `@mtg/dsl` (`printedEntryReplacement`). This asked
  // `card.kind === 'land'` until `mtg-hgmz`, which is why a mana rock could
  // not buy its discount with a turn of tempo: the machinery below never cared
  // which kind produced the modification, and the question was the limit.
  const printed = printedEntryReplacement(copiedCard ?? copiableCardOf(object));
  const entersTapped =
    forcedTapped ||
    printed?.kind === 'entersTapped' ||
    (printed?.kind === 'payLifeOrEntersTapped' && paidEntryLife !== true) ||
    (printed?.kind === 'entersTappedUnlessControlsLandSubtype' &&
      !landsControlledBy(state, controller).some((land) =>
        printed.landTypes.some((type) => hasSubtype(state, land.oid, type)),
      ));
  const intrinsics: readonly ReplacementEffect[] = [
    ...(entersTapped
      ? [
          {
            id: `intrinsic:${oid}:entry`,
            sourceOid: oid,
            controller,
            timestamp: -2,
            duration: 'whileOnBattlefield' as const,
            selfReplacement: true,
            trigger: { kind: 'enters' as const, oid, controller },
            modification: { kind: 'entersTapped' as const },
          },
        ]
      : []),
    ...(printed?.kind === 'entersWithCounters'
      ? [
          {
            id: `intrinsic:${oid}:entry:counters`,
            sourceOid: oid,
            controller,
            timestamp: -1,
            duration: 'whileOnBattlefield' as const,
            selfReplacement: true,
            trigger: { kind: 'enters' as const, oid, controller },
            modification: {
              kind: 'entersWithCounters' as const,
              counter: printed.counter,
              count:
                typeof printed.count === 'number'
                  ? printed.count
                  : printed.count.kind === 'chosenX'
                    ? chosenX
                    : lifeLostByOpponentsThisTurn(state, controller),
            },
          },
        ]
      : []),
    ...(optionalCounter === undefined
      ? []
      : [
          {
            id: `intrinsic:${oid}:entry:optional-counter`,
            sourceOid: oid,
            controller,
            timestamp: 0,
            duration: 'whileOnBattlefield' as const,
            selfReplacement: true,
            trigger: { kind: 'enters' as const, oid, controller },
            modification: {
              kind: 'entersWithCounters' as const,
              counter: optionalCounter.counter,
              count: optionalCounter.count,
            },
          },
        ]),
  ];
  const prepared: GameState =
    intrinsics.length === 0 ? state : { ...state, replacements: [...state.replacements, ...intrinsics] };
  const outcome = applyReplacements(prepared, {
    kind: 'enters',
    oid,
    controller,
    tapped: false,
    plusOnePlusOne: 0,
    minusOneMinusOne: 0,
    charge: 0,
  });
  const intrinsicIds = new Set(intrinsics.map((effect) => effect.id));
  const withEffects: GameState = {
    ...state,
    replacements:
      intrinsics.length === 0
        ? outcome.replacements
        : outcome.replacements.filter((effect) => !intrinsicIds.has(effect.id)),
  };
  const event = outcome.event;
  const appliedIds = outcome.appliedIds;
  if (event === null || event.kind !== 'enters') {
    return { state: withEffects, tapped: false, counters: NO_COUNTERS, appliedIds };
  }
  // Entry replacements first determine how many counters the permanent would
  // receive. Battlefield counter-placement replacements then rewrite that
  // proposal while their sources are live. The entering object has not yet
  // registered its own static abilities, so Corpsejack cannot double its own
  // entry counters; another Corpsejack already on the battlefield can.
  const recipientCard = copiedCard ?? copiableCardOf(object);
  const plusOutcome = applyReplacements(withEffects, {
    kind: 'counterPlacement',
    oid,
    controller,
    counter: 'plusOnePlusOne',
    count: event.plusOnePlusOne,
    recipientCard,
  });
  const plusEvent = plusOutcome.event;
  const minusState = { ...withEffects, replacements: plusOutcome.replacements };
  const minusOutcome = applyReplacements(minusState, {
    kind: 'counterPlacement',
    oid,
    controller,
    counter: 'minusOneMinusOne',
    count: event.minusOneMinusOne,
    recipientCard,
  });
  const minusEvent = minusOutcome.event;
  const chargeState = { ...withEffects, replacements: minusOutcome.replacements };
  const chargeOutcome = applyReplacements(chargeState, {
    kind: 'counterPlacement',
    oid,
    controller,
    counter: 'charge',
    count: event.charge,
    recipientCard,
  });
  const chargeEvent = chargeOutcome.event;
  const entryCounters = setCounterCount(
    {
      ...NO_COUNTERS,
      plusOnePlusOne:
        plusEvent?.kind === 'counterPlacement' && plusEvent.counter === 'plusOnePlusOne'
          ? plusEvent.count
          : 0,
      minusOneMinusOne:
        minusEvent?.kind === 'counterPlacement' && minusEvent.counter === 'minusOneMinusOne'
          ? minusEvent.count
          : 0,
    },
    'charge',
    chargeEvent?.kind === 'counterPlacement' && chargeEvent.counter === 'charge' ? chargeEvent.count : 0,
  );
  return {
    state: { ...withEffects, replacements: chargeOutcome.replacements },
    tapped: event.tapped,
    counters: entryCounters,
    appliedIds,
  };
}

/**
 * Everything an arrival owes once the object sits on the battlefield: the
 * printed statics it registers (CR 604.3) and the events its entry emits.
 *
 * One path, two callers. `moveObject` arrives by changing zones and
 * `createToken` arrives by creating an object (CR 111.3), and the whole
 * difference between them is `zoneChanged`, which stays with the caller: a
 * token comes from no zone, and an event saying it moved from one would be a
 * record of something that did not happen. Every other entry-time obligation
 * belongs here, so the next one is written once rather than twice (`mtg-4vf`).
 *
 * The CR 601.2f cost modifier a printed reduction registers rides the same
 * pre-pass, for the same reason: `registerCostModifiers` reads the object off
 * the state by id exactly as `registerStatics` does, so it has to run after
 * the record exists and before anything downstream asks what this permanent
 * costs its controller to trigger with.
 */
function completeArrival(trace: Trace, oid: ObjectId, arrival: Arrival, auraHost?: ObjectId): Trace {
  // The CR 614 replacement a printed doubler registers rides the same pre-pass
  // as the other two, for the third time and the same reason
  // (`static-replacements.ts` states it).
  const state = registerStaticReplacements(
    registerCostModifiers(registerStatics(trace.state, oid), oid),
    oid,
  );
  const registered = withState(trace, state);
  const attached = auraHost === undefined ? registered : attachAuraTo(registered, oid, auraHost);
  const object = getObject(attached.state, oid);
  let entered = emit(attached, {
    type: 'permanentEntered',
    oid,
    controller: object.controller,
  });
  if (arrival.tapped) entered = emit(entered, { type: 'permanentTapped', oid });
  if (hasCounters(arrival.counters)) {
    const loyalty = counterCount(arrival.counters, 'loyalty');
    const defense = counterCount(arrival.counters, 'defense');
    entered = emit(entered, {
      type: 'countersChanged',
      oid,
      plusOnePlusOne: arrival.counters.plusOnePlusOne,
      minusOneMinusOne: arrival.counters.minusOneMinusOne,
      ...(loyalty === 0 ? {} : { loyalty }),
      ...(defense === 0 ? {} : { defense }),
    });
  }
  return entered;
}

/**
 * Moves an object between zones as a new object (CR 400.7): battlefield status
 * — tapped, damage, summoning sickness, counters — resets on every zone change.
 *
 * A token is moved like a card. It stops existing a moment later, in
 * `checkStateBasedActions`, and the gap between the two is where a death
 * trigger is derived.
 *
 * `entry` is what the *caller* decides about an arrival, as opposed to what the
 * card prints, and it is one record rather than two positional flags because
 * both of its fields are optional and a reader at a call site cannot tell
 * `moveObject(t, oid, 'battlefield', 1)` from `moveObject(t, oid,
 * 'battlefield', true)` without opening this file.
 *
 * `entry.tapped` is "put it onto the battlefield tapped". `entry.controller`
 * names the seat a permanent enters *under*, and it is a parameter rather than
 * a continuous effect because CR 110.2a makes control a property of the entry:
 * the permanent comes onto the battlefield already controlled by that player,
 * and there is no window in which it was controlled by someone else. It never
 * touches `owner` — CR 108.4 and CR 110.2 are two properties, the card still
 * belongs to whoever started the game with it, and a reanimated creature goes
 * back to its owner's graveyard when it dies.
 *
 * Both are ignored for every destination but the battlefield, because tapped is
 * a battlefield status and no other zone has a controller to name. Left absent,
 * the arrival is untapped under the controller the object already had, which
 * for a card sitting in a zone is its owner; that is what the dozens of callers
 * with no opinion want. See `arrivalOf` for why tapped is a parameter and not a
 * printed entry clause.
 */
export interface ArrivalEntry {
  readonly tapped?: boolean;
  readonly controller?: PlayerId;
  /** X announced for the permanent spell that is becoming this permanent. */
  readonly chosenX?: number;
  /** A non-spell Aura's CR 303.4f host, chosen before it changes zones. */
  readonly auraHost?: ObjectId;
}

export function moveObject(
  trace: Trace,
  oid: ObjectId,
  requestedDestination: ZoneId,
  entry: ArrivalEntry = {},
): Trace {
  return moveObjectWithEntryChoices(
    trace,
    oid,
    requestedDestination,
    entry,
    entry.auraHost === undefined ? {} : { auraHost: entry.auraHost },
  );
}

function moveObjectWithEntryChoices(
  trace: Trace,
  oid: ObjectId,
  requestedDestination: ZoneId,
  entry: ArrivalEntry,
  resolved: ResolvedEntryChoices,
): Trace {
  const object = getObject(trace.state, oid);
  if (object.zone === requestedDestination) return trace;
  const nextController =
    requestedDestination === 'battlefield' ? (entry.controller ?? object.controller) : object.owner;
  if (requestedDestination === 'battlefield') {
    const item: PendingBattlefieldEntry = {
      oid,
      controller: nextController,
      tapped: entry.tapped ?? false,
      chosenX: entry.chosenX ?? 0,
      ...resolved,
    };
    const choice = entryChoiceFor(trace.state, oid, nextController, resolved);
    if (choice?.kind === 'auraUnavailable') return trace;
    if (choice?.kind === 'aura' && trace.state.pendingBattlefieldEntryBatch === undefined) {
      return startBattlefieldEntryBatch(trace, [item], commitBattlefieldEntry);
    }
    if (choice !== null) return awaitEntryChoice(trace, item, choice);
  }
  return commitMoveObject(trace, oid, requestedDestination, entry, resolved);
}

function commitMoveObject(
  trace: Trace,
  oid: ObjectId,
  requestedDestination: ZoneId,
  entry: ArrivalEntry,
  resolved: ResolvedEntryChoices,
  batch?: PendingBattlefieldEntryBatch,
): Trace {
  const {
    copiedCard,
    counterPermanent,
    characteristicsMode,
    chosenPlayer,
    chosenCardName,
    chosenColors,
    optionalCounter,
    paidEntryLife,
  } = resolved;
  const object = getObject(trace.state, oid);
  if (object.zone === requestedDestination) return trace;
  const nextController =
    requestedDestination === 'battlefield' ? (entry.controller ?? object.controller) : object.owner;
  const currentEntryReplacement = printedEntryReplacement(copiedCard ?? copiableCardOf(object));
  const enteringCard =
    characteristicsMode === undefined
      ? copiedCard
      : cardWithEntryCharacteristics(copiedCard ?? copiableCardOf(object), characteristicsMode);
  const replacementState = batch === undefined ? trace.state : entryBatchEvaluationState(trace.state, batch);
  const entryCard = enteringCard ?? copiableCardOf(object);
  if (requestedDestination === 'battlefield' && isAuraCard(entryCard)) {
    if (resolved.auraHost === null) return trace;
    if (resolved.auraHost === undefined) {
      throw new Error(`commitMoveObject: Aura ${oid} has no resolved entry host`);
    }
    if (!isLegalAuraEntryHost(replacementState, entryCard, resolved.auraHost)) return trace;
  }
  const proposed = {
    kind: 'zoneChange' as const,
    oid,
    owner: object.owner,
    from: object.zone,
    destination: requestedDestination,
  };
  const replacement = applyReplacements(
    replacementState,
    proposed,
    earliestTimestamp,
    zoneChangeReplacementsFor(replacementState, proposed),
  );
  let prepared = withState(trace, {
    ...trace.state,
    replacements:
      batch === undefined
        ? replacement.replacements
        : mergeEntryBatchReplacements(trace.state, replacement.replacements, batch),
  });
  for (const id of replacement.appliedIds) {
    prepared = emit(prepared, { type: 'replacementApplied', id, event: 'zoneChange' });
  }
  const replacedEvent = replacement.event;
  if (replacedEvent === null || replacedEvent.kind !== 'zoneChange') return prepared;
  const to = replacedEvent.destination;
  if (object.zone === to) return prepared;
  const from = object.zone;
  const attachmentSources =
    from === 'battlefield'
      ? trace.state.battlefield.filter((source) => trace.state.objects[source]?.attachedTo === oid)
      : [];
  const attachedSources = attachmentSources.length === 0 ? undefined : attachmentSources;
  const lastKnownController = attachedSources === undefined ? undefined : controllerOf(trace.state, oid);
  const departing = from === 'battlefield' ? characteristicsOf(trace.state, oid) : undefined;
  const departingCreature = departing?.cardTypes.includes('creature') === true ? departing : undefined;
  const departingCreaturePower = departingCreature?.power;
  const departingCreatureToughness = departingCreature?.toughness;
  const departingBattlefieldIncarnation =
    departingCreaturePower === undefined ? undefined : (object.incarnation ?? 0);
  if (from === 'battlefield') prepared = unattachFromHost(prepared, oid);
  const departingCharacteristics =
    departing === undefined
      ? undefined
      : {
          colors: [...departing.colors],
          subtypes: [...departing.subtypes],
          keywords: [...departing.keywords],
        };
  const departingAbilities = departing === undefined ? undefined : [...departing.abilities];
  const entering = to === 'battlefield';
  if (entering && counterPermanent !== undefined) {
    const recipient = getObject(prepared.state, counterPermanent);
    const replacement = currentEntryReplacement;
    if (recipient.zone === 'battlefield' && replacement?.kind === 'putCounterOnControlledPermanent') {
      prepared = withState(
        prepared,
        putObject(prepared.state, {
          ...recipient,
          counters: addCounters(recipient.counters, replacement.counter, replacement.count),
        }),
      );
    }
  }
  // The controller is settled before the replacement pass rather than after it,
  // because a CR 614 "enters tapped" or "enters with a counter" replacement is
  // read against the seat the permanent is entering under. Applying those as
  // the old controller and then handing the finished permanent to a new one
  // would be two different answers to `arrivalOf`'s question.
  const arrivalState =
    batch === undefined ? prepared.state : entryBatchEvaluationState(prepared.state, batch);
  const evaluatedArrival: Arrival = entering
    ? arrivalOf(
        arrivalState,
        oid,
        nextController,
        entry.tapped ?? false,
        enteringCard ?? undefined,
        entry.chosenX ?? 0,
        optionalCounter ?? undefined,
        paidEntryLife,
      )
    : { state: arrivalState, tapped: false, counters: NO_COUNTERS, appliedIds: [] };
  const arrival: Arrival =
    batch === undefined
      ? evaluatedArrival
      : {
          ...evaluatedArrival,
          state: {
            ...prepared.state,
            replacements: mergeEntryBatchReplacements(
              prepared.state,
              evaluatedArrival.state.replacements,
              batch,
            ),
          },
        };

  // CR 400.7: the object is new in the zone it arrives in, so every piece of
  // battlefield status resets. An attachment is one of them, which is what "an
  // Equipment that leaves the battlefield takes its attachment with it" means
  // here; the continuous effect it registered is dropped a few lines below by
  // `effectsRegisteredBy`, which every printed ability's record goes through.
  const reset = { ...object };
  const preserveFace = (from === 'exile' && to === 'stack') || (from === 'stack' && to === 'battlefield');
  const activeFace = preserveFace ? object.faceCard : undefined;
  delete reset.faceCard;
  const currentCopiableCard = from === 'battlefield' ? copiableValuesOf(trace.state, oid) : undefined;
  const departingCopiableCard = currentCopiableCard === object.card ? undefined : currentCopiableCard;
  delete reset.copiableCard;
  delete reset.chosenPlayer;
  delete reset.chosenCardName;
  delete reset.chosenColors;
  delete reset.lastKnownCopiableCard;
  const departingLinkedExile = from === 'battlefield' ? object.linkedExile : undefined;
  delete reset.linkedExile;
  // A linked relation names the object this card became when the search moved
  // it to exile. Any later zone change creates a new object under CR 400.7,
  // even when this engine deliberately keeps the physical card's oid stable.
  delete reset.linkedExileId;
  delete reset.loyaltyActivatedTurn;
  delete reset.activationLimitedTurns;
  delete reset.battlefieldTimestamp;
  delete reset.protector;
  delete reset.siegeDefeatPending;
  // A held permanent that changed zones is a new object and owes nothing
  // (CR 400.7). Bouncing your own creature out from under a Sleep is a real
  // line, and the debt following it back would be the kernel remembering a
  // permanent that no longer exists.
  delete reset.skipsNextUntap;
  if (entering) {
    delete reset.lastKnownSourceCharacteristics;
    delete reset.lastKnownAbilities;
    delete reset.lastKnownController;
    delete reset.lastKnownLinkedExile;
  }
  const battlefieldTimestamp = entering ? arrival.state.nextId : undefined;
  let moved: GameObject = detached({
    ...reset,
    zone: to,
    incarnation: (object.incarnation ?? 0) + 1,
    controller: nextController,
    tapped: arrival.tapped,
    damage: 0,
    deathtouched: false,
    counters: arrival.counters,
    summoningSick: entering,
    ...(activeFace === undefined ? {} : { faceCard: activeFace }),
    ...(entering && enteringCard !== null && enteringCard !== undefined
      ? { copiableCard: enteringCard }
      : {}),
    ...(entering && chosenPlayer !== undefined ? { chosenPlayer } : {}),
    ...(entering && chosenCardName !== undefined ? { chosenCardName } : {}),
    ...(entering && chosenColors !== undefined ? { chosenColors: [...chosenColors] } : {}),
    ...(battlefieldTimestamp === undefined ? {} : { battlefieldTimestamp }),
    ...(departingCharacteristics === undefined
      ? {}
      : { lastKnownSourceCharacteristics: departingCharacteristics }),
    ...(departingAbilities === undefined ? {} : { lastKnownAbilities: departingAbilities }),
    ...(departing === undefined ? {} : { lastKnownController: departing.controller }),
    ...(departingLinkedExile === undefined ? {} : { lastKnownLinkedExile: [...departingLinkedExile] }),
    ...(departingCopiableCard === undefined ? {} : { lastKnownCopiableCard: departingCopiableCard }),
  });

  // A token that leaves the battlefield goes where it was headed, like anything
  // else. "A token ceases to exist" (CR 111.7) is two steps rather than one:
  // the token is put into the zone the move names, and a state-based action
  // then removes it from existence (CR 704.5d, `sba.ts`). Doing the second step
  // here — redirecting a token to exile on the way out — is what this kernel
  // used to do, and it ate every token's death trigger, because `selfDies` is
  // derived from a `zoneChanged` into a graveyard (`triggers.ts`) and no token
  // ever emitted one. the flagship set's whole economy is a Monster dying and
  // leaving a part, so that was not a corner.
  let state = removeFromZone(arrival.state, object);
  if (battlefieldTimestamp !== undefined) state = { ...state, nextId: battlefieldTimestamp + 1 };
  state = putObject(state, moved);
  state = addToZone(state, moved, to);
  if (from === 'battlefield') state = removeObjectFromCombat(state, oid);
  if (from === 'battlefield' && to === 'graveyard') {
    state = {
      ...state,
      turn: {
        ...state.turn,
        battlefieldToGraveyardThisTurn: [
          ...state.turn.battlefieldToGraveyardThisTurn,
          { oid, incarnation: moved.incarnation ?? 0 },
        ],
      },
    };
  }
  let completedArrival = arrival;
  if (entering) {
    const startingLoyalty = startingLoyaltyOf(state, oid);
    if (startingLoyalty !== null) {
      const counters = setCounterCount(arrival.counters, 'loyalty', startingLoyalty);
      moved = { ...moved, counters };
      state = putObject(state, moved);
      completedArrival = { ...arrival, counters };
    }
    const startingDefense = startingDefenseOf(state, oid);
    if (startingDefense !== null) {
      const counters = setCounterCount(completedArrival.counters, 'defense', startingDefense);
      moved = {
        ...moved,
        counters,
        protector: battleProtector(copiableValuesOf(state, oid), nextController),
      };
      state = putObject(state, moved);
      completedArrival = { ...completedArrival, counters };
    }
  }

  // A permanent's printed static abilities exist exactly while it is on the
  // battlefield (CR 604.3), so the removal half belongs here, at the single
  // choke point every zone change goes through; the registration half is
  // `completeArrival`'s, which every arrival runs.
  //
  // A grant made *to* this permanent ends on the same event, off the mirrored
  // operation: `effectsRegisteredBy` matches the records this object sourced,
  // while `detachEffectsFromSubject` removes this incarnation from records it
  // was explicitly affecting. The latter narrows a group record rather than
  // expiring it, so creatures that stayed on the battlefield keep the shared
  // effect. `expired` therefore names only whole records that ended.
  let expired: readonly ContinuousEffect[] = [];
  if (from === 'battlefield') {
    const sourceExpired = effectsRegisteredBy(state.continuous, oid);
    const withoutSource = state.continuous.filter((effect) => !sourceExpired.includes(effect));
    const detachedSubject = detachEffectsFromSubject(withoutSource, oid);
    expired = [...sourceExpired, ...detachedSubject.expired];
    state = { ...state, continuous: detachedSubject.effects };
  }
  if (from === 'battlefield') {
    // Two sweeps over one array, and the split is the point. The regeneration
    // shield is an activated ability's one-shot with no duration to key on, so
    // it is matched by modification kind; a printed static's replacement is
    // registered with `whileOnBattlefield` and matched by that, which is what
    // keeps the sweep off `damage.ts`'s ephemeral protection shields and
    // `zones.ts`'s own `intrinsic:<oid>:entry` effect.
    const expiredReplacements = staticReplacementsRegisteredBy(state.replacements, oid);
    state = {
      ...state,
      replacements: state.replacements.filter(
        (effect) =>
          !(effect.sourceOid === oid && effect.modification.kind === 'regenerate') &&
          !expiredReplacements.includes(effect),
      ),
    };
  }

  // A printed cost reduction has the identical CR 604.3 lifetime, so it drops
  // at the same choke point, off the same parallel array `cost.ts` argues for.
  const expiredCostModifiers =
    from === 'battlefield' ? costModifiersRegisteredBy(state.costModifiers, oid) : [];
  if (expiredCostModifiers.length > 0) {
    state = {
      ...state,
      costModifiers: state.costModifiers.filter((modifier) => !expiredCostModifiers.includes(modifier)),
    };
  }

  // A turn-scoped combat rule ends when its subject leaves the battlefield, the
  // subject-detachment half of the operation above and for that half's reason:
  // this kernel reuses an object's id across a zone change, so a rule left
  // behind would come back with the card. The source is deliberately not swept on —
  // both rules are one-shots that finished resolving, and the player
  // `attacksYouThisTurnIfAble` names was fixed then (CR 109.5), so the source
  // dying afterwards changes nothing.
  if (from === 'battlefield' && state.turnCombatRules.length > 0) {
    state = {
      ...state,
      turnCombatRules: state.turnCombatRules.filter((imposed) => imposed.subject !== oid),
    };
  }
  if (from === 'battlefield' && state.detentions.length > 0) {
    state = sweepDetentionsForSubject(state, oid);
  }

  if (departingBattlefieldIncarnation !== undefined) {
    state = {
      ...state,
      stack: state.stack.map((entry) =>
        entry.triggerContext !== null &&
        'triggeringCreature' in entry.triggerContext &&
        entry.triggerContext.triggeringCreature === oid &&
        entry.triggerContext.triggeringCreatureIncarnation === departingBattlefieldIncarnation
          ? {
              ...entry,
              triggerContext: {
                ...entry.triggerContext,
                ...(departingCreaturePower === undefined
                  ? {}
                  : { triggeringCreaturePower: departingCreaturePower }),
                ...(departingCreatureToughness === undefined
                  ? {}
                  : { triggeringCreatureToughness: departingCreatureToughness }),
              },
            }
          : entry,
      ),
    };
  }

  let next = withState(prepared, state);
  for (const id of arrival.appliedIds) {
    next = emit(next, { type: 'replacementApplied', id, event: 'enters' });
  }
  next = emit(next, {
    type: 'zoneChanged',
    oid,
    from,
    to,
    owner: object.owner,
    ...(lastKnownController === undefined ? {} : { lastKnownController }),
    ...(attachedSources === undefined ? {} : { attachedSources }),
    ...(departingCreaturePower === undefined ? {} : { departingCreaturePower }),
    ...(departingCreatureToughness === undefined ? {} : { departingCreatureToughness }),
    ...(departingBattlefieldIncarnation === undefined ? {} : { departingBattlefieldIncarnation }),
  });
  if (expired.length > 0) {
    next = emit(next, { type: 'continuousEffectsExpired', ids: expired.map((effect) => effect.id) });
  }
  if (!entering) return next;
  return completeArrival(next, oid, completedArrival, resolved.auraHost ?? undefined);
}

function commitBattlefieldEntry(
  trace: Trace,
  prepared: PendingBattlefieldEntry,
  batch: PendingBattlefieldEntryBatch,
): Trace {
  return commitMoveObject(
    trace,
    prepared.oid,
    'battlefield',
    {
      controller: prepared.controller,
      tapped: prepared.tapped,
      chosenX: prepared.chosenX,
    },
    prepared,
    batch,
  );
}

export interface SimultaneousBattlefieldEntry {
  readonly oid: ObjectId;
  readonly entry?: ArrivalEntry;
}

/**
 * Moves one public-zone cohort onto the battlefield as one CR 400.7 event.
 *
 * All as-entry choices are banked before any member moves. The commit then
 * evaluates every member against the same pre-entry battlefield, while still
 * carrying forward replacement effects consumed by an earlier member. No
 * decision, trigger, state-based action, or priority window occurs inside the
 * cohort.
 */
export function moveObjectsToBattlefieldSimultaneously(
  trace: Trace,
  entries: readonly SimultaneousBattlefieldEntry[],
): Trace {
  const seen = new Set<ObjectId>();
  const remaining: PendingBattlefieldEntry[] = [];
  for (const requested of entries) {
    if (seen.has(requested.oid)) {
      throw new Error(`moveObjectsToBattlefieldSimultaneously: duplicate object ${requested.oid}`);
    }
    seen.add(requested.oid);
    const object = getObject(trace.state, requested.oid);
    if (object.zone === 'battlefield') continue;
    remaining.push({
      oid: requested.oid,
      controller: requested.entry?.controller ?? object.controller,
      tapped: requested.entry?.tapped ?? false,
      chosenX: requested.entry?.chosenX ?? 0,
      ...(requested.entry?.auraHost === undefined ? {} : { auraHost: requested.entry.auraHost }),
    });
  }
  return startBattlefieldEntryBatch(trace, remaining, commitBattlefieldEntry);
}

/** Finishes the zone change banked by a copy-as-entry decision. */
export function answerEntryCopy(trace: Trace, copyOf: ObjectId | null): Trace {
  const pending = trace.state.pendingEntryCopy;
  if (pending === undefined) throw new Error('answerEntryCopy: no copy-as-entry choice is pending');
  const copiedCard = copyOf === null ? null : copiableValuesOf(trace.state, copyOf);
  const { pendingEntryCopy: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(cleared, pending.oid, { copiedCard }, commitBattlefieldEntry);
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    { copiedCard },
  );
}

/** Finishes the zone change banked by an as-entry counter choice. */
export function answerEntryCounter(trace: Trace, permanent: ObjectId): Trace {
  const pending = trace.state.pendingEntryCounterChoice;
  if (pending === undefined) throw new Error('answerEntryCounter: no entry counter choice is pending');
  const { pendingEntryCounterChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(
      cleared,
      pending.oid,
      { copiedCard: pending.copiedCard, counterPermanent: permanent },
      commitBattlefieldEntry,
    );
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    { copiedCard: pending.copiedCard, counterPermanent: permanent },
  );
}

/** Finishes the zone change banked by a characteristic-mode entry choice. */
export function answerEntryCharacteristics(trace: Trace, mode: number): Trace {
  const pending = trace.state.pendingEntryCharacteristicsChoice;
  if (pending === undefined) {
    throw new Error('answerEntryCharacteristics: no entry characteristic choice is pending');
  }
  const chosen = pending.modes[mode];
  if (chosen === undefined) throw new Error(`answerEntryCharacteristics: unknown mode ${String(mode)}`);
  const { pendingEntryCharacteristicsChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(
      cleared,
      pending.oid,
      { copiedCard: pending.copiedCard, characteristicsMode: chosen },
      commitBattlefieldEntry,
    );
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    { copiedCard: pending.copiedCard, characteristicsMode: chosen },
  );
}

/** Finishes an optional as-entry counter choice without moving the object early. */
export function answerEntryOptionalCounter(trace: Trace, accept: boolean): Trace {
  const pending = trace.state.pendingEntryOptionalCounterChoice;
  if (pending === undefined) {
    throw new Error('answerEntryOptionalCounter: no optional entry counter choice is pending');
  }
  const { pendingEntryOptionalCounterChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  const optionalCounter = accept ? { counter: pending.counter, count: pending.count } : null;
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(
      cleared,
      pending.entry.oid,
      { optionalCounter },
      commitBattlefieldEntry,
    );
  }
  const { oid, controller, tapped, chosenX, ...priorChoices } = pending.entry;
  return moveObjectWithEntryChoices(
    cleared,
    oid,
    'battlefield',
    { controller, tapped, chosenX },
    { ...priorChoices, optionalCounter },
  );
}

/** Pays or declines a land's as-entry life choice without moving it early. */
export function answerEntryPayLife(trace: Trace, pay: boolean): Trace {
  const pending = trace.state.pendingEntryPayLifeChoice;
  if (pending === undefined) {
    throw new Error('answerEntryPayLife: no entry life-payment choice is pending');
  }
  const { pendingEntryPayLifeChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  const paid = pay ? loseLife(cleared, pending.player, pending.life) : cleared;
  if (paid.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(
      paid,
      pending.entry.oid,
      { paidEntryLife: pay },
      commitBattlefieldEntry,
    );
  }
  const { oid, controller, tapped, chosenX, ...priorChoices } = pending.entry;
  return moveObjectWithEntryChoices(
    paid,
    oid,
    'battlefield',
    { controller, tapped, chosenX },
    { ...priorChoices, paidEntryLife: pay },
  );
}

/** Finishes the zone change banked by a mandatory as-entry player choice. */
export function answerEntryPlayer(trace: Trace, player: PlayerId): Trace {
  const pending = trace.state.pendingEntryPlayerChoice;
  if (pending === undefined) throw new Error('answerEntryPlayer: no entry player choice is pending');
  const { pendingEntryPlayerChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  const choices = { copiedCard: pending.copiedCard, chosenPlayer: player } as const;
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(cleared, pending.oid, choices, commitBattlefieldEntry);
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    choices,
  );
}

/** Finishes the zone change banked by Tablet's mandatory two-color choice. */
export function answerEntryColors(trace: Trace, colors: readonly [Color, Color]): Trace {
  const pending = trace.state.pendingEntryColorsChoice;
  if (pending === undefined) throw new Error('answerEntryColors: no entry color choice is pending');
  const { pendingEntryColorsChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  const choices = { copiedCard: pending.copiedCard, chosenColors: colors } as const;
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(cleared, pending.oid, choices, commitBattlefieldEntry);
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    choices,
  );
}

/** Finishes the zone change banked by a mandatory as-entry card-name choice. */
export function answerEntryCardName(trace: Trace, name: string): Trace {
  const pending = trace.state.pendingEntryCardNameChoice;
  if (pending === undefined) throw new Error('answerEntryCardName: no entry card-name choice is pending');
  const { pendingEntryCardNameChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  const choices = { copiedCard: pending.copiedCard, chosenCardName: name } as const;
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(cleared, pending.oid, choices, commitBattlefieldEntry);
  }
  return moveObjectWithEntryChoices(
    cleared,
    pending.oid,
    'battlefield',
    { controller: pending.controller, tapped: pending.tapped },
    choices,
  );
}

/** Finishes the CR 303.4f host choice banked for a non-spell Aura entry. */
export function answerEntryAura(trace: Trace, host: ObjectId): Trace {
  const pending = trace.state.pendingEntryAuraChoice;
  if (pending === undefined) throw new Error('answerEntryAura: no Aura entry choice is pending');
  const { pendingEntryAuraChoice: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, {
    ...withoutPending,
    turn: { ...withoutPending.turn, awaiting: null, awaitingPlayer: null },
  });
  if (cleared.state.pendingBattlefieldEntryBatch !== undefined) {
    return answerBattlefieldEntryBatch(
      cleared,
      pending.entry.oid,
      { auraHost: host },
      commitBattlefieldEntry,
    );
  }
  const { oid, controller, tapped, chosenX, ...priorChoices } = pending.entry;
  return moveObjectWithEntryChoices(
    cleared,
    oid,
    'battlefield',
    { controller, tapped, chosenX },
    { ...priorChoices, auraHost: host },
  );
}

/** Banks one next-earliest object in the active CR 613.7m controller group. */
export function answerEntryTimestampNext(trace: Trace, oid: ObjectId): Trace {
  return answerEntryTimestampNextInBatch(trace, oid, commitBattlefieldEntry);
}

export function tapObject(trace: Trace, oid: ObjectId): Trace {
  const object = getObject(trace.state, oid);
  if (object.tapped) return trace;
  const state = putObject(trace.state, { ...object, tapped: true });
  return emit(withState(trace, state), { type: 'permanentTapped', oid });
}

/**
 * Taps a permanent and holds it down through its controller's next untap step.
 *
 * Two departures from `tapObject`, both deliberate. It writes the flag onto a
 * permanent that is *already* tapped, where `tapObject` returns early: a sweep
 * that finds one creature tapped still stops that creature untapping, and
 * returning early would let a defender pre-tap its way out of the whole card.
 * And it emits `permanentTapped` only when the permanent actually turned, so
 * the log keeps meaning "this happened" rather than "this was asked for"; the
 * hold announces itself at the untap step it eats, which is where the game
 * action is.
 */
export function holdTapped(trace: Trace, oid: ObjectId): Trace {
  const object = getObject(trace.state, oid);
  const held = withState(trace, putObject(trace.state, { ...object, tapped: true, skipsNextUntap: true }));
  return object.tapped ? held : emit(held, { type: 'permanentTapped', oid });
}

/**
 * Makes a permanent miss its controller's next untap step without tapping it.
 *
 * Wall of Frost supplies the distinction: an attacker is usually already
 * tapped, but vigilance may leave it untapped and the triggered ability does
 * not change that. `untapStep` owns consumption of the shared debt, including
 * clearing it when the permanent is already untapped, and zone changes already
 * strip the battlefield-only field under CR 400.7.
 */
export function skipNextUntap(trace: Trace, oid: ObjectId): Trace {
  const object = getObject(trace.state, oid);
  return withState(trace, putObject(trace.state, { ...object, skipsNextUntap: true }));
}

/** Whether CR 701.21 can untap this current battlefield object. */
export function canUntapObject(state: GameState, oid: ObjectId): boolean {
  const object = tryObject(state, oid);
  return object !== undefined && object.zone === 'battlefield' && object.tapped;
}

export function untapObject(trace: Trace, oid: ObjectId): Trace {
  const object = getObject(trace.state, oid);
  if (!object.tapped) return trace;
  const state = putObject(trace.state, { ...object, tapped: false });
  return emit(withState(trace, state), { type: 'permanentUntapped', oid });
}

/**
 * Draws one card. An attempt to draw from an empty library does not lose the
 * game immediately (CR 104.3c); it sets a flag the state-based actions read.
 */
function performDraw(trace: Trace, player: PlayerId): Trace {
  const seat = playerOf(trace.state, player);
  const top = seat.library[0];
  if (top === undefined) {
    const state = updatePlayer(trace.state, player, (p) => ({
      ...p,
      attemptedDrawFromEmptyLibrary: true,
    }));
    return emit(withState(trace, state), { type: 'drawFromEmptyLibrary', player });
  }
  const moved = moveObject(trace, top, 'hand');
  return emit(moved, { type: 'cardDrawn', player, oid: top });
}

/**
 * A draw is a replaceable event (CR 121.2, 614): "skip your draw step" and
 * "draw an additional card" both rewrite it rather than reacting to it, so the
 * pipeline runs once and then the resulting number of draws is performed.
 */
export function drawCard(trace: Trace, player: PlayerId): Trace {
  const outcome = applyReplacements(trace.state, { kind: 'draw', player, count: 1 });
  let current = withState(trace, { ...trace.state, replacements: outcome.replacements });
  for (const id of outcome.appliedIds) {
    current = emit(current, { type: 'replacementApplied', id, event: 'draw' });
  }
  const event = outcome.event;
  if (event === null || event.kind !== 'draw') return current;
  let drawn = current;
  for (let index = 0; index < event.count; index += 1) {
    drawn = performDraw(drawn, player);
  }
  return drawn;
}

export function drawCards(trace: Trace, player: PlayerId, count: number): Trace {
  let current = trace;
  for (let index = 0; index < count; index += 1) {
    current = drawCard(current, player);
  }
  return current;
}

/**
 * Shuffles one player's library from the seeded generator in state.
 *
 * The one shuffle primitive, because there are now two callers — the opening
 * deal and every mulligan — and a second implementation would be a second place
 * for a game to stop reproducing from its seed. `rng.ts` bans `Math.random`
 * outright and this is what makes that ban keepable: the new generator state
 * goes back into `GameState`, so a shuffle is part of the position rather than
 * something that happened to it.
 */
export function shuffleLibrary(trace: Trace, player: PlayerId): Trace {
  const seat = playerOf(trace.state, player);
  const [shuffled, rng] = shuffle(seat.library, trace.state.rng);
  const withRng: GameState = { ...trace.state, rng };
  const state = updatePlayer(withRng, player, (existing) => ({ ...existing, library: shuffled }));
  return emit(withState(trace, state), { type: 'libraryShuffled', player, cards: shuffled.length });
}

/**
 * Puts one object on the top or the bottom of its owner's library (CR 701.19a).
 *
 * `moveObject` does the whole zone change, including the CR 400.7 reset and the
 * continuous effects a permanent registered, because a card headed for a
 * library is a card leaving wherever it was and that is one choke point rather
 * than two. What it cannot do is say *where* in the destination the card lands:
 * `addToZone` appends, and index 0 is the top, so a plain move is always a move
 * to the bottom. The top arm therefore rotates the moved id to the front
 * afterwards, reading it out of the list the move just produced instead of
 * rebuilding the list from a remembered position — the object's owner is what
 * decides which library it went to, and re-deriving that here would be a second
 * opinion about the same fact.
 */
export function putOnLibrary(trace: Trace, oid: ObjectId, position: LibraryPosition): Trace {
  const owner = getObject(trace.state, oid).owner;
  const moved = moveObject(trace, oid, 'library');
  if (position === 'bottom') return moved;
  const library = playerOf(moved.state, owner).library;
  const state = updatePlayer(moved.state, owner, (player) => ({
    ...player,
    library: [oid, ...library.filter((entry) => entry !== oid)],
  }));
  return withState(moved, state);
}

/**
 * Moves each distinct existing object to the top of its owner's library, then
 * shuffles each library that actually received at least one of those objects.
 *
 * The two phases are load-bearing: a multi-object instruction performs all
 * zone changes before any shuffle, and a same-owner pair causes one shuffle,
 * not one per object. Owners are captured before movement because cards outside
 * the battlefield have no controller; success is read afterwards so a
 * replacement that redirects a move does not invent an affected library.
 */
export function putObjectsOnOwnersLibrariesThenShuffle(trace: Trace, oids: readonly ObjectId[]): Trace {
  const distinct = oids.filter((oid, index) => oids.indexOf(oid) === index);
  const planned = distinct.flatMap((oid) => {
    const object = tryObject(trace.state, oid);
    return object === undefined ? [] : [{ oid, owner: object.owner }];
  });
  const moved = planned.reduce((current, entry) => putOnLibrary(current, entry.oid, 'top'), trace);
  const owners = planned
    .filter((entry) => tryObject(moved.state, entry.oid)?.zone === 'library')
    .map((entry) => entry.owner)
    .filter((owner, index, all) => all.indexOf(owner) === index);
  return owners.reduce((current, owner) => shuffleLibrary(current, owner), moved);
}

/**
 * Shows the top `count` cards of a library to both seats without moving them.
 *
 * The short-library case is the whole reason this reads a slice rather than
 * asserting a length: CR 701.16a reveals as many as are there, and a library
 * with two cards under a "reveal the top three" prints two. Emitting nothing
 * for an empty library is deliberate — `millCards` above takes the same
 * decision for the same reason, since an event naming no cards is a reveal that
 * did not happen.
 */
export function revealTopCards(trace: Trace, player: PlayerId, count: number): Trace {
  const oids = playerOf(trace.state, player).library.slice(0, count);
  if (oids.length === 0) return trace;
  return emit(trace, { type: 'libraryTopRevealed', player, oids });
}

/**
 * Reveals the current top card and moves that same physical card to hand.
 *
 * This is not a draw: no draw replacement applies, no `cardDrawn` trigger
 * fires, and an empty library does not set the failed-draw loss marker. The oid
 * is captured before either action, published by the existing reveal event,
 * and then handed to the ordinary zone-change choke point. `moveObject` keeps
 * the physical card id stable while incrementing its incarnation, which lets a
 * later resolution-scoped amount identify the card without retaining a stale
 * library position.
 */
export function revealTopCardToHand(trace: Trace, player: PlayerId): Trace {
  const top = playerOf(trace.state, player).library[0];
  if (top === undefined) return trace;
  return moveObject(revealTopCards(trace, player, 1), top, 'hand');
}

/**
 * Reveals the shortest library prefix containing `count` creature cards.
 *
 * A short library reveals fully. Creature cards move in revealed order through
 * `moveObject`, preserving the ordinary entry path and new-object semantics;
 * everything else was already in the library and joins the unrevealed suffix
 * in the one seeded shuffle. A zero count reveals nothing but still performs
 * the instructed shuffle.
 */
export function revealUntilCreatureCards(trace: Trace, player: PlayerId, count: number): Trace {
  const library = [...playerOf(trace.state, player).library];
  let found = 0;
  let length = 0;
  if (count > 0) {
    for (const oid of library) {
      length += 1;
      if (trace.state.objects[oid]?.card.kind === 'creature') found += 1;
      if (found >= count) break;
    }
  }
  const revealed = library.slice(0, length);
  let current = revealTopCards(trace, player, length);
  for (const oid of revealed) {
    if (current.state.objects[oid]?.card.kind === 'creature') {
      current = moveObject(current, oid, 'battlefield', { controller: player });
    }
  }
  return shuffleLibrary(current, player);
}

/** Reveals and mills the shortest top prefix that includes a land card. */
export function revealUntilLandToGraveyard(trace: Trace, player: PlayerId): Trace {
  const library = [...playerOf(trace.state, player).library];
  const firstLand = library.findIndex((oid) => trace.state.objects[oid]?.card.kind === 'land');
  const length = firstLand < 0 ? library.length : firstLand + 1;
  const revealed = library.slice(0, length);
  const shown = revealTopCards(trace, player, length);
  return revealed.reduce((current, oid) => moveObject(current, oid, 'graveyard'), shown);
}

/**
 * Exiles every card in one player's graveyard, in graveyard order.
 *
 * Every card, not every creature card: `objectsInEffectScope`'s graveyard arm
 * filters by printed card type because the scopes it serves all narrow that
 * way, and this one narrows by nothing (`exileGraveyardEffect` argues why). It
 * reads the id list once before the first move for CR 609.2's reason, the same
 * as `overEffectScope` — the moves themselves shorten the array being walked.
 */
export function exileGraveyard(trace: Trace, player: PlayerId): Trace {
  const cards = playerOf(trace.state, player).graveyard;
  return cards.reduce((current, oid) => moveObject(current, oid, 'exile'), trace);
}

/** Exiles the pre-move cohort of the named players' hands and graveyards. */
export function exileHandsAndGraveyards(trace: Trace, players: readonly PlayerId[]): Trace {
  const cards = players.flatMap((player) => {
    const seat = playerOf(trace.state, player);
    return [...seat.hand, ...seat.graveyard];
  });
  return cards.reduce((current, oid) => moveObject(current, oid, 'exile'), trace);
}

export interface NamedGraveyardExile {
  readonly trace: Trace;
  /** Unique printed names of cards that actually reached exile. */
  readonly names: readonly string[];
}

/**
 * Exiles one graveyard except its basic land cards and reports the names that
 * really arrived in exile.
 *
 * The result, rather than the intended member list, supplies the names. That
 * is the “exiled this way” boundary: a future replacement that changes or
 * prevents one move must not let the redirected card seed a hidden-zone
 * search. Names are unique because the later predicate asks membership; two
 * graveyard copies widen nothing and must not create duplicate search paths.
 */
export function exileNonbasicGraveyard(trace: Trace, player: PlayerId): NamedGraveyardExile {
  const cards = [...playerOf(trace.state, player).graveyard];
  return cards.reduce<NamedGraveyardExile>(
    (current, oid) => {
      const object = getObject(current.trace.state, oid);
      if (object.card.supertypes.includes('basic')) return current;
      const moved = moveObject(current.trace, oid, 'exile');
      if (tryObject(moved.state, oid)?.zone !== 'exile' || current.names.includes(object.card.name)) {
        return { ...current, trace: moved };
      }
      return { trace: moved, names: [...current.names, object.card.name] };
    },
    { trace, names: [] },
  );
}

/**
 * Puts every card in one player's graveyard into their library and shuffles it
 * (CR 701.22), optionally taking one further object along.
 *
 * The shuffle is inside this function rather than left to the caller because
 * CR 701.22b makes the two one action: a library that briefly held the
 * graveyard in graveyard order is a library somebody could have been told the
 * top of, and no printed card offers that window. `shuffleLibrary` is reused
 * rather than reimplemented, so the reordering still comes out of the seeded
 * generator in state and a replay reproduces it.
 *
 * `extra` is Elixir of Immortality's own body, and it moves *first* for the
 * reason the ids are read first: it is a permanent leaving the battlefield, so
 * `moveObject` has a CR 400.7 reset and a continuous-effect deregistration to
 * do, and doing it after the shuffle would put a card into a library that was
 * already random and then shuffle a second time. It is moved to its owner's
 * library, never the resolving player's, which is `putOnLibrary`'s rule and is
 * `moveObject`'s behavior rather than a decision taken here.
 */
export function shuffleGraveyardIntoLibrary(trace: Trace, player: PlayerId, extra: ObjectId | null): Trace {
  const moved = extra === null ? trace : moveObject(trace, extra, 'library');
  const cards = playerOf(moved.state, player).graveyard;
  const gathered = cards.reduce((current, oid) => moveObject(current, oid, 'library'), moved);
  const owner = extra === null ? player : getObject(gathered.state, extra).owner;
  const shuffled = shuffleLibrary(gathered, player);
  return owner === player ? shuffled : shuffleLibrary(shuffled, owner);
}

/** Moves one player's hand and graveyard into their library, then shuffles it. */
export function shuffleHandAndGraveyardIntoLibrary(trace: Trace, player: PlayerId): Trace {
  const seat = playerOf(trace.state, player);
  const cards = [...seat.hand, ...seat.graveyard];
  const gathered = cards.reduce((current, oid) => moveObject(current, oid, 'library'), trace);
  return shuffleLibrary(gathered, player);
}

export function millCards(trace: Trace, player: PlayerId, count: number): Trace {
  const seat = playerOf(trace.state, player);
  const milled = seat.library.slice(0, count);
  let current = trace;
  for (const oid of milled) {
    current = moveObject(current, oid, 'graveyard');
  }
  if (milled.length === 0) return current;
  return emit(current, { type: 'cardsMilled', player, oids: milled });
}

/**
 * Materializes a token spec as a real permanent on the battlefield.
 *
 * The card is built by `@mtg/dsl`'s `tokenCard`, which is the one place a spec
 * becomes a card: it decides the type from the spec's body (stats mean a
 * creature token, no stats mean an artifact token) and copies the printed
 * abilities across. Everything downstream then treats the token as what it is.
 * `registerStatics`, reached through the `completeArrival` every arrival runs,
 * registers a token's static abilities like any permanent's;
 * `activationOptions` enumerates its activated ones off
 * `card.abilities` (`legal.ts`); `conditionsFrom` watches its triggers
 * (`triggers.ts`). None of those three learned anything about tokens, which is
 * the point — a token's ability goes through the path a card's ability goes
 * through, or it is a second implementation waiting to disagree.
 *
 * So "a token created by `createToken` fires ETB triggers" became true with
 * `mtg-bc2.132.7`: a token can now carry the `selfEnters` trigger that reads
 * the `permanentEntered` this function already emitted. What is still owed is
 * the other half — a permanent watching some *other* permanent arrive — because
 * every DSL v1 trigger condition is about its own source.
 */
function createTokenCard(trace: Trace, controller: PlayerId, card: Card): Trace {
  const counter = trace.state.nextId;
  const oid = objectId(counter);
  const object: GameObject = {
    oid,
    card,
    owner: controller,
    controller,
    zone: 'battlefield',
    token: true,
    tapped: false,
    summoningSick: true,
    damage: 0,
    deathtouched: false,
    counters: NO_COUNTERS,
    battlefieldTimestamp: counter,
  };

  // The one step `moveObject` cannot lend, because it is the step that makes a
  // token a token: the object record has to be minted before anything can name
  // it. `arrivalOf` and `registerStatics` both read the object off the state by
  // id, so the record exists first and the zone list is written after — which is
  // the order `moveObject` already runs in, where a permanent is still in the
  // zone it came from while CR 614 decides how it arrives.
  const declared = putObject({ ...trace.state, nextId: counter + 1 }, object);

  // CR 111.3: a token is created on the battlefield rather than moved onto it,
  // so there is no zone change to report. Everything else an arrival owes is
  // owed here all the same — the CR 614 replacement pass, the statics the body
  // registers, and `permanentEntered`, which is what a triggered ability reads
  // to know the token arrived.
  const arrival = arrivalOf(declared, oid, controller);
  // Most tokens arrive exactly as minted, and then the record already in
  // `arrival.state` is the one to place: copying the whole object table again
  // to write an identical record is what made a batch of board-scaled tokens
  // cost the batch times the table (#307). `arrivalOf` builds a fresh counter
  // record every time, so "unchanged" is read off its contents: no counters,
  // and no key beyond the two zeroed ones `NO_COUNTERS` carries.
  const unchanged =
    arrival.tapped === object.tapped &&
    !hasCounters(arrival.counters) &&
    Object.keys(arrival.counters).length === Object.keys(NO_COUNTERS).length &&
    arrival.state.objects[oid] === object;
  const arrived: GameObject = unchanged
    ? object
    : { ...object, tapped: arrival.tapped, counters: arrival.counters };
  const placed: GameState = addToZone(
    unchanged ? arrival.state : putObject(arrival.state, arrived),
    arrived,
    'battlefield',
  );

  let next = withState(trace, placed);
  next = emit(next, { type: 'tokenCreated', oid, controller, name: card.name });
  for (const id of arrival.appliedIds) {
    next = emit(next, { type: 'replacementApplied', id, event: 'enters' });
  }
  return completeArrival(next, oid, arrival);
}

export function createToken(trace: Trace, controller: PlayerId, spec: TokenSpec): Trace {
  return createTokenCard(trace, controller, tokenCard(spec));
}

/** Creates a token from already-derived copiable card values through the ordinary token arrival path. */
export function createCopiedToken(trace: Trace, controller: PlayerId, card: Card): Trace {
  return createTokenCard(trace, controller, card);
}
