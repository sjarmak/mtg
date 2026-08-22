/**
 * Deterministic position builder.
 *
 * Combat rules are only testable if you can state a board position in one
 * expression. `scenario` builds a legal `GameState` directly and then walks it
 * forward through the *real* turn machinery (by passing priority) to the
 * requested step, so nothing here can fabricate a position the kernel could not
 * have reached itself.
 */
import type { Card } from '@mtg/dsl';
import { BASIC_LANDS } from '@mtg/dsl';
import { registerStatics } from './abilities';
import { NO_COUNTERS, setCounterCount } from './continuous';
import { registerCostModifiers } from './cost';
import { registerStaticReplacements } from './static-replacements';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import { objectId } from './ids';
import type { ReduceResult } from './reduce';
import { reduce, settle } from './reduce';
import { createRng } from './rng';
import type { GameConfig, GameObject, GameState, PlayerState, Step, ZoneId } from './state';
import { EMPTY_COMBAT, EMPTY_MANA_POOL } from './state';
import { beginTrace } from './trace';
import { DEFAULT_CONFIG } from './setup';

export interface ScenarioPermanent {
  readonly card: Card;
  readonly controller: PlayerId;
  readonly tapped?: boolean | undefined;
  readonly summoningSick?: boolean | undefined;
  readonly damage?: number | undefined;
  /**
   * CR 111.1: this permanent is a token, so leaving the battlefield ends it
   * (CR 111.7, CR 704.5d). Stated rather than derived, because a token's card
   * is an ordinary `Card` built by `tokenCard` and nothing about it says so.
   *
   * A stated board of tokens is not the same thing as a board that created
   * them: `createToken` is a real arrival with an `enters` event behind it, and
   * this is a position, exactly as the note above `withRegisteredStatics`
   * explains for triggers.
   */
  readonly token?: boolean | undefined;
  /** Current loyalty counters; defaults to printed starting loyalty on a planeswalker. */
  readonly loyalty?: number | undefined;
}

export interface ScenarioSpec {
  readonly seed?: string | undefined;
  readonly life?: readonly [number, number] | undefined;
  readonly battlefield?: readonly ScenarioPermanent[] | undefined;
  readonly hands?: readonly [readonly Card[], readonly Card[]] | undefined;
  readonly libraries?: readonly [readonly Card[], readonly Card[]] | undefined;
  readonly graveyards?: readonly [readonly Card[], readonly Card[]] | undefined;
  readonly active?: PlayerId | undefined;
  readonly turn?: number | undefined;
  /** Step to walk to by passing priority; defaults to `precombatMain`. */
  readonly step?: Step | undefined;
  readonly maximumTurns?: number | undefined;
  readonly maximumHandSize?: number | undefined;
}

function defaultLibrary(): readonly Card[] {
  const cards: Card[] = [];
  for (let index = 0; index < 30; index += 1) {
    const card = BASIC_LANDS[index % BASIC_LANDS.length];
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

interface Builder {
  readonly objects: Record<ObjectId, GameObject>;
  counter: number;
}

function addObject(
  builder: Builder,
  card: Card,
  owner: PlayerId,
  controller: PlayerId,
  zone: ZoneId,
  overrides: Partial<GameObject> = {},
): ObjectId {
  const oid = objectId(builder.counter);
  builder.counter += 1;
  builder.objects[oid] = {
    oid,
    card,
    owner,
    controller,
    zone,
    token: false,
    tapped: false,
    summoningSick: false,
    damage: 0,
    deathtouched: false,
    counters: NO_COUNTERS,
    ...overrides,
  };
  return oid;
}

/**
 * The one thing `addObject` cannot skip.
 *
 * The builder writes battlefield objects straight into the state rather than
 * routing them through `moveObject`, which is fine for tapped/damage/counters —
 * those are fields — and *not* fine for a printed static ability, which is a
 * record in `state.continuous` that `moveObject` is the only thing that writes.
 * A lord placed here with no registered effect would do nothing, silently, in
 * exactly the tests written to prove that statics work, and this file's opening
 * claim that nothing here can fabricate a position the kernel could not have
 * reached itself would be false.
 *
 * Entering the battlefield here is not an *event*: the position is a given, so
 * `settle` must not see an arrival. Registration is state rather than an event,
 * which is what lets this be a one-line pre-pass instead of a replay of entries.
 *
 * Triggered abilities need the opposite of what statics needed, and get it from
 * the same fact. `collectTriggers` reads events, and a stated board emits none,
 * so a permanent placed here with an enters trigger does not fire it — which is
 * correct: the board is where the game *is*, not something that just happened.
 * `createToken` took the other road for the same reason it is a real arrival
 * (`mtg-4vf`), and the difference between the two is why neither is a bypass to
 * be tidied away.
 *
 * A CR 601.2f cost reduction registers here for the identical reason: it is
 * battlefield-lifetime state, not an event, so a scenario-placed reducer that
 * skipped this pass would silently do nothing in exactly the tests written to
 * prove it works — `cost.ts`'s `registerCostModifiers` states the same claim
 * `registerStatics` does, one permanent at a time.
 */
function withRegisteredStatics(state: GameState): GameState {
  let current = state;
  for (const oid of state.battlefield) {
    current = registerStaticReplacements(registerCostModifiers(registerStatics(current, oid), oid), oid);
  }
  return current;
}

/** Builds a position and settles it at the requested step. */
export function scenario(spec: ScenarioSpec = {}): ReduceResult {
  const active = spec.active ?? 0;
  const config: GameConfig = {
    seed: spec.seed ?? 'scenario',
    startingLife: DEFAULT_CONFIG.startingLife,
    openingHandSize: DEFAULT_CONFIG.openingHandSize,
    maximumHandSize: spec.maximumHandSize ?? DEFAULT_CONFIG.maximumHandSize,
    maximumTurns: spec.maximumTurns ?? DEFAULT_CONFIG.maximumTurns,
    startingPlayer: active,
    startingPlayerSkipsFirstDraw: DEFAULT_CONFIG.startingPlayerSkipsFirstDraw,
  };

  const builder: Builder = { objects: {}, counter: 0 };
  const battlefield: ObjectId[] = [];
  for (const permanent of spec.battlefield ?? []) {
    battlefield.push(
      addObject(builder, permanent.card, permanent.controller, permanent.controller, 'battlefield', {
        tapped: permanent.tapped ?? false,
        summoningSick: permanent.summoningSick ?? false,
        damage: permanent.damage ?? 0,
        token: permanent.token ?? false,
        counters:
          permanent.loyalty === undefined && permanent.card.kind !== 'planeswalker'
            ? NO_COUNTERS
            : setCounterCount(
                NO_COUNTERS,
                'loyalty',
                permanent.loyalty ??
                  (permanent.card.kind === 'planeswalker' ? permanent.card.startingLoyalty : 0),
              ),
      }),
    );
  }

  const seats: PlayerState[] = [];
  for (const player of [0, 1] as const) {
    const hand = (spec.hands?.[player] ?? []).map((card) => addObject(builder, card, player, player, 'hand'));
    const library = (spec.libraries?.[player] ?? defaultLibrary()).map((card) =>
      addObject(builder, card, player, player, 'library'),
    );
    const graveyard = (spec.graveyards?.[player] ?? []).map((card) =>
      addObject(builder, card, player, player, 'graveyard'),
    );
    seats.push({
      id: player,
      life: spec.life?.[player] ?? config.startingLife,
      library,
      hand,
      graveyard,
      pool: EMPTY_MANA_POOL,
      lost: false,
      attemptedDrawFromEmptyLibrary: false,
      // A scenario opens mid-game, so both opening hands were kept and neither
      // seat is owed CR 103.4's question. Saying so is what keeps
      // `pendingDecision` from finding an unanswered mulligan in a board that
      // was never dealt one.
      mulligans: 0,
      keptHand: true,
    });
  }

  const seatZero = seats[0];
  const seatOne = seats[1];
  if (seatZero === undefined || seatOne === undefined) throw new Error('scenario: seats were not built');

  const base: GameState = {
    objects: builder.objects,
    players: [seatZero, seatOne],
    battlefield,
    exile: [],
    stack: [],
    continuous: [],
    costModifiers: [],
    turnCombatRules: [],
    replacements: [],
    turn: {
      number: spec.turn ?? 2,
      active,
      step: 'precombatMain',
      priority: active,
      passes: 0,
      landsPlayed: 0,
      damagedPlayers: [],
      awaiting: null,
      awaitingPlayer: null,
    },
    combat: EMPTY_COMBAT,
    rng: createRng(config.seed),
    nextId: builder.counter,
    result: null,
    config,
  };

  const settled = settle(beginTrace(withRegisteredStatics(base)));
  const target = spec.step ?? 'precombatMain';
  return advanceToStep({ state: settled.state, events: settled.events }, target);
}

/**
 * Walks forward by passing priority until the given step is current. Only
 * steps reachable without any real decision are valid targets (anything up to
 * and including `declareAttackers`).
 */
export function advanceToStep(from: ReduceResult, step: Step): ReduceResult {
  let state = from.state;
  const events: GameEvent[] = [...from.events];
  for (let guard = 0; guard < 64; guard += 1) {
    if (state.turn.step === step) return { state, events };
    const priority = state.turn.priority;
    // `awaiting` outranks priority in `pendingDecision`, so a board that owes a
    // question can hold one and still be unable to pass. A stated board of two
    // same-named legends is the ordinary way to get here (CR 704.5j), and
    // without this the failure was `reduce` refusing a pass several frames on.
    if (priority === null || state.turn.awaiting !== null) {
      const owed = state.turn.awaiting ?? 'a decision other than priority';
      throw new Error(`advanceToStep: ${owed} is pending before reaching ${step}`);
    }
    const stepped = reduce(state, { type: 'passPriority', player: priority });
    state = stepped.state;
    events.push(...stepped.events);
  }
  throw new Error(`advanceToStep: could not reach ${step}`);
}
