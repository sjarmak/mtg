/**
 * Object lookup and zone movement.
 *
 * Zones are ordered id lists; the object record is the single home for object
 * data, so a move is "drop the id from one list, add it to another, rewrite one
 * object". Library index 0 is the top of the library.
 */
import type { LibraryPosition, TokenSpec } from '@mtg/dsl';
import { printedEntryReplacement, tokenCard } from '@mtg/dsl';
import { effectsRegisteredBy, registerStatics } from './abilities';
import { detached } from './attach';
import type { Counters } from './continuous';
import { counterCount, effectsPinnedTo, hasCounters, NO_COUNTERS, setCounterCount } from './continuous';
import { costModifiersRegisteredBy, registerCostModifiers } from './cost';
import { registerStaticReplacements, staticReplacementsRegisteredBy } from './static-replacements';
import type { ObjectId, PlayerId } from './ids';
import { objectId } from './ids';
import {
  characteristicsOf,
  controllerOf,
  hasCardType,
  hasSubtype,
  isCreatureObject,
  startingLoyaltyOf,
} from './layers';
import { applyReplacements } from './replacement';
import type { ReplacementEffect } from './replacement-effects';
import { shuffle } from './rng';
import type { GameObject, GameState, ZoneId } from './state';
import type { Trace } from './trace';
import { emit, playerOf, putObject, updatePlayer, withState } from './trace';

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
function arrivalOf(state: GameState, oid: ObjectId, controller: PlayerId, forcedTapped = false): Arrival {
  const object = getObject(state, oid);
  // Every card kind that prints an entry clause, read through the one
  // derivation in `@mtg/dsl` (`printedEntryReplacement`). This asked
  // `card.kind === 'land'` until `mtg-hgmz`, which is why a mana rock could
  // not buy its discount with a turn of tempo: the machinery below never cared
  // which kind produced the modification, and the question was the limit.
  const printed = printedEntryReplacement(object.card);
  const entersTapped =
    forcedTapped ||
    printed?.kind === 'entersTapped' ||
    (printed?.kind === 'entersTappedUnlessControlsLandSubtype' &&
      !landsControlledBy(state, controller).some((land) =>
        printed.landTypes.some((type) => hasSubtype(state, land.oid, type)),
      ));
  const intrinsic: ReplacementEffect | undefined = entersTapped
    ? {
        id: `intrinsic:${oid}:entry`,
        sourceOid: oid,
        controller,
        timestamp: -1,
        duration: 'whileOnBattlefield',
        selfReplacement: true,
        trigger: { kind: 'enters', oid, controller },
        modification: { kind: 'entersTapped' },
      }
    : undefined;
  const prepared: GameState =
    intrinsic === undefined ? state : { ...state, replacements: [...state.replacements, intrinsic] };
  const outcome = applyReplacements(prepared, {
    kind: 'enters',
    oid,
    controller,
    tapped: false,
    plusOnePlusOne: 0,
    minusOneMinusOne: 0,
  });
  const withEffects: GameState = {
    ...state,
    replacements:
      intrinsic === undefined
        ? outcome.replacements
        : outcome.replacements.filter((effect) => effect.id !== intrinsic.id),
  };
  const event = outcome.event;
  const appliedIds = outcome.appliedIds;
  if (event === null || event.kind !== 'enters') {
    return { state: withEffects, tapped: false, counters: NO_COUNTERS, appliedIds };
  }
  return {
    state: withEffects,
    tapped: event.tapped,
    counters: {
      ...NO_COUNTERS,
      plusOnePlusOne: event.plusOnePlusOne,
      minusOneMinusOne: event.minusOneMinusOne,
    },
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
function completeArrival(trace: Trace, oid: ObjectId, arrival: Arrival): Trace {
  // The CR 614 replacement a printed doubler registers rides the same pre-pass
  // as the other two, for the third time and the same reason
  // (`static-replacements.ts` states it).
  const state = registerStaticReplacements(
    registerCostModifiers(registerStatics(trace.state, oid), oid),
    oid,
  );
  const object = getObject(state, oid);
  let entered = emit(withState(trace, state), {
    type: 'permanentEntered',
    oid,
    controller: object.controller,
  });
  if (arrival.tapped) entered = emit(entered, { type: 'permanentTapped', oid });
  if (hasCounters(arrival.counters)) {
    const loyalty = counterCount(arrival.counters, 'loyalty');
    entered = emit(entered, {
      type: 'countersChanged',
      oid,
      plusOnePlusOne: arrival.counters.plusOnePlusOne,
      minusOneMinusOne: arrival.counters.minusOneMinusOne,
      ...(loyalty === 0 ? {} : { loyalty }),
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
}

export function moveObject(trace: Trace, oid: ObjectId, to: ZoneId, entry: ArrivalEntry = {}): Trace {
  const object = getObject(trace.state, oid);
  if (object.zone === to) return trace;
  const from = object.zone;
  const departingCharacteristics =
    from === 'battlefield'
      ? (() => {
          const current = characteristicsOf(trace.state, oid);
          return { colors: [...current.colors], subtypes: [...current.subtypes] };
        })()
      : undefined;
  const entering = to === 'battlefield';
  // The controller is settled before the replacement pass rather than after it,
  // because a CR 614 "enters tapped" or "enters with a counter" replacement is
  // read against the seat the permanent is entering under. Applying those as
  // the old controller and then handing the finished permanent to a new one
  // would be two different answers to `arrivalOf`'s question.
  const nextController = entering ? (entry.controller ?? object.controller) : object.owner;
  const arrival: Arrival = entering
    ? arrivalOf(trace.state, oid, nextController, entry.tapped ?? false)
    : { state: trace.state, tapped: false, counters: NO_COUNTERS, appliedIds: [] };

  // CR 400.7: the object is new in the zone it arrives in, so every piece of
  // battlefield status resets. An attachment is one of them, which is what "an
  // Equipment that leaves the battlefield takes its attachment with it" means
  // here; the continuous effect it registered is dropped a few lines below by
  // `effectsRegisteredBy`, which every printed ability's record goes through.
  const reset = { ...object };
  delete reset.loyaltyActivatedTurn;
  // A held permanent that changed zones is a new object and owes nothing
  // (CR 400.7). Bouncing your own creature out from under a Sleep is a real
  // line, and the debt following it back would be the kernel remembering a
  // permanent that no longer exists.
  delete reset.skipsNextUntap;
  if (entering) delete reset.lastKnownSourceCharacteristics;
  let moved: GameObject = detached({
    ...reset,
    zone: to,
    controller: nextController,
    tapped: arrival.tapped,
    damage: 0,
    deathtouched: false,
    counters: arrival.counters,
    summoningSick: entering,
    ...(departingCharacteristics === undefined
      ? {}
      : { lastKnownSourceCharacteristics: departingCharacteristics }),
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
  state = putObject(state, moved);
  state = addToZone(state, moved, to);
  let completedArrival = arrival;
  if (entering) {
    const startingLoyalty = startingLoyaltyOf(state, oid);
    if (startingLoyalty !== null) {
      const counters = setCounterCount(arrival.counters, 'loyalty', startingLoyalty);
      moved = { ...moved, counters };
      state = putObject(state, moved);
      completedArrival = { ...arrival, counters };
    }
  }

  // A permanent's printed static abilities exist exactly while it is on the
  // battlefield (CR 604.3), so the removal half belongs here, at the single
  // choke point every zone change goes through; the registration half is
  // `completeArrival`'s, which every arrival runs.
  //
  // A grant made *to* this permanent ends on the same event, off the mirrored
  // sweep: `effectsRegisteredBy` matches the effects this object is the source
  // of, `effectsPinnedTo` matches the ones it is the subject of. Both are
  // swept in one pass so one `continuousEffectsExpired` event names everything
  // the zone change ended, which is what the log has to say for a replay to
  // rebuild the same board. `continuous.ts` argues the second lifetime; the
  // short version is that this kernel reuses an object's id across a zone
  // change, so a grant with no duration would come back with the card.
  const expired =
    from === 'battlefield'
      ? [...effectsRegisteredBy(state.continuous, oid), ...effectsPinnedTo(state.continuous, oid)]
      : [];
  if (expired.length > 0) {
    state = { ...state, continuous: state.continuous.filter((effect) => !expired.includes(effect)) };
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
  // `effectsPinnedTo` half of the sweep above and for that half's reason: this
  // kernel reuses an object's id across a zone change, so a rule left behind
  // would come back with the card. The source is deliberately not swept on —
  // both rules are one-shots that finished resolving, and the player
  // `attacksYouThisTurnIfAble` names was fixed then (CR 109.5), so the source
  // dying afterwards changes nothing.
  if (from === 'battlefield' && state.turnCombatRules.length > 0) {
    state = {
      ...state,
      turnCombatRules: state.turnCombatRules.filter((imposed) => imposed.subject !== oid),
    };
  }

  let next = withState(trace, state);
  for (const id of arrival.appliedIds) {
    next = emit(next, { type: 'replacementApplied', id, event: 'enters' });
  }
  next = emit(next, { type: 'zoneChanged', oid, from, to, owner: object.owner });
  if (expired.length > 0) {
    next = emit(next, { type: 'continuousEffectsExpired', ids: expired.map((effect) => effect.id) });
  }
  if (!entering) return next;
  return completeArrival(next, oid, completedArrival);
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
export function createToken(trace: Trace, controller: PlayerId, spec: TokenSpec): Trace {
  const counter = trace.state.nextId;
  const oid = objectId(counter);
  const object: GameObject = {
    oid,
    card: tokenCard(spec),
    owner: controller,
    controller,
    zone: 'battlefield',
    token: true,
    tapped: false,
    summoningSick: true,
    damage: 0,
    deathtouched: false,
    counters: NO_COUNTERS,
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
  const arrived: GameObject = { ...object, tapped: arrival.tapped, counters: arrival.counters };
  const placed: GameState = addToZone(putObject(arrival.state, arrived), arrived, 'battlefield');

  let next = withState(trace, placed);
  next = emit(next, { type: 'tokenCreated', oid, controller, name: spec.name });
  for (const id of arrival.appliedIds) {
    next = emit(next, { type: 'replacementApplied', id, event: 'enters' });
  }
  return completeArrival(next, oid, arrival);
}
