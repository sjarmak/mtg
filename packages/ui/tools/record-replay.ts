/**
 * The recorder: plays a real kernel game and writes the viewer's event log.
 *
 * This is the producer side of `../src/routes/replay/log-schema.ts`. It is
 * Node-only — it reaches the kernel and it is what a launcher runs — so it
 * lives under `tools/` beside `stage-art.ts` and `stage-symbols.ts`, the other
 * two things a launcher does before Vite starts.
 *
 * # Why it is not in `@mtg/sim`, which is where the route's doc comment sent it
 *
 * That note called the move "a file move plus an export". It is not, and the
 * dependency is in the first line of the imports below: everything written goes
 * through the reader's own zod schemas, and those schemas live in `@mtg/ui`
 * because the *reader* is a browser bundle. `@mtg/ui` already depends on
 * `@mtg/sim`, so a recorder in `@mtg/sim` that imported them would close a
 * cycle; and the schemas cannot move the other way, because `@mtg/sim`'s entry
 * point reaches `node:fs` and `node:worker_threads` and `src/replay/columns.ts`
 * exists precisely so that no browser file has to import it.
 *
 * The remaining option is to write the records unvalidated in `@mtg/sim` and
 * check them only on the way in. That trades away the property the schema
 * docblock calls load-bearing: a field added or renamed in `@mtg/kernel` fails
 * *here*, loudly, at the point of writing, rather than producing a log the
 * viewer narrates as `undefined`. So the recorder stays on the side of the seam
 * that holds the contract, and the seam that would actually be worth opening is
 * a neutral package for the log format itself — filed rather than taken.
 */
import type {
  Action,
  Choice,
  DeckList,
  Decision,
  GameEvent,
  GameSession,
  GameSetup,
  GameState,
  ObjectId,
  PlayerAgent,
  PlayerId,
  Seat,
  SessionOptions,
  StackEntry,
} from '@mtg/kernel';
import {
  DEFAULT_CONFIG,
  agentView,
  attachmentOf,
  choose,
  copiableValuesOf,
  counterCount,
  createGame,
  createSession,
  isCreatureObject,
  isDetained,
  pendingDecision,
  powerOf,
  reduce,
  seatName,
  settleAgentAction,
  spellCardByOid,
  toughnessOf,
} from '@mtg/kernel';
import type { Card, MutuallyAssignable } from '@mtg/dsl';
import {
  ActionSchema,
  DecisionSchema,
  EVENT_LOG_SCHEMA_VERSION,
  EventSchema,
  GameRecordSchema,
  HeaderRecordSchema,
  SnapshotSchema,
  StepRecordSchema,
} from '../src/routes/replay/log-schema';
import type { GameRecord, HeaderRecord, LogSnapshot, StepRecord } from '../src/routes/replay/log-schema';

export interface RecordGameOptions {
  readonly index: number;
  readonly seed: string;
  readonly decks: readonly [DeckList, DeckList];
  readonly agents: readonly [PlayerAgent, PlayerAgent];
  readonly startingPlayer: PlayerId;
  readonly maximumTurns: number;
  /** How many enumerated options a decision record carries. */
  readonly optionLimit?: number;
  /** Enumeration cap handed to the kernel; the recorder wants the full list. */
  readonly enumerationCap?: number;
}

export interface RecordedGame {
  readonly game: GameRecord;
  readonly steps: readonly StepRecord[];
}

const DEFAULT_OPTION_LIMIT = 24;
const DEFAULT_ENUMERATION_CAP = 512;
/** A recorded game must finish; this is the same shape of valve the sim uses. */
const MAX_DECISIONS = 20_000;

/**
 * Every key `StackEntry` has, named once so a field the kernel adds is a
 * compile error here rather than a silently dropped log column.
 *
 * `snapshotOf` cannot spread `StackEntry` the way `SnapshotSchema.parse` can
 * reject an *unknown* key on the way in — this transform reshapes several of
 * these fields (`ability`/`copiedSpell` become `source`/`card`/`copiedFrom`)
 * rather than renaming them one for one, so there is no single `Pick<...>` that
 * both types agree on. `StackEntryKeysCovered` is the next best guarantee: it
 * is `true` only when this list names every key `StackEntry` has, the same
 * device `packages/dsl/src/exhaustive.ts` uses for its own tuple/union pairs.
 * It does not check that a listed key is actually threaded into the object
 * literal below — TypeScript has no way to prove that — only that whoever adds
 * a kernel field is forced to visit this file and decide, which is what this
 * bead's own instance of the bug (`mode`) skipped past.
 */
export const STACK_ENTRY_KEYS_HANDLED = [
  'oid',
  'controller',
  'targets',
  'targetIncarnations',
  'ability',
  'sourceCard',
  'castingCost',
  'mode',
  'multiTargets',
  'multiTargetIncarnations',
  'damageAllocations',
  'triggerContext',
  'x',
  'sourceCharacteristics',
  'paidSacrificePower',
  'paidSacrificeToughness',
  'paidDiscardManaValue',
  'copiedSpell',
  // These source-memory fields affect future resolution but not this board
  // snapshot: linked cards are already visible in `exile`, and an obsolete
  // source incarnation has no visual representation in the replay viewer.
  // Naming them here records that omission and keeps the exhaustive guard.
  'sourceBattlefieldIncarnation',
  'sourceIncarnationAtStackCreation',
  'sourceLinkedExile',
  'delayedZoneChange',
  'siegeDefeat',
  'delayedCounterPlacement',
  'delayedSpellCopy',
] as const satisfies readonly (keyof StackEntry)[];
export type StackEntryKeysCovered = MutuallyAssignable<
  keyof StackEntry,
  (typeof STACK_ENTRY_KEYS_HANDLED)[number]
>;

export function snapshotOf(state: GameState): LogSnapshot {
  const attacking = new Set<ObjectId>(state.combat.attacks.map((attack) => attack.oid));
  const blocking = new Set<ObjectId>(state.combat.blocks.flatMap((block) => block.blockers));
  const battlefield = state.battlefield.map((oid) => {
    const object = state.objects[oid];
    if (object === undefined) throw new Error(`battlefield names unknown object ${oid}`);
    const creature = isCreatureObject(state, oid);
    const card = copiableValuesOf(state, oid);
    return {
      oid,
      ...(card === object.card ? {} : { copiedCard: card }),
      controller: object.controller,
      tapped: object.tapped,
      summoningSick: object.summoningSick,
      damage: object.damage,
      plusCounters: object.counters.plusOnePlusOne,
      minusCounters: object.counters.minusOneMinusOne,
      ...(card.kind === 'planeswalker' ? { loyalty: counterCount(object.counters, 'loyalty') } : {}),
      ...(card.kind === 'battle'
        ? {
            defense: counterCount(object.counters, 'defense'),
            protector: object.protector ?? object.controller,
          }
        : {}),
      power: creature ? powerOf(state, oid) : null,
      toughness: creature ? toughnessOf(state, oid) : null,
      attachedTo: attachmentOf(state, oid) ?? null,
      attacking: attacking.has(oid),
      blocking: blocking.has(oid),
      ...(isDetained(state, oid) ? { detained: true } : {}),
    };
  });
  const seats = state.players.map((seat) => ({
    life: seat.life,
    hand: [...seat.hand],
    library: seat.library.length,
    graveyard: [...seat.graveyard],
    pool: { ...seat.pool },
    lost: seat.lost,
  }));
  const [you, opponent] = seats;
  if (you === undefined || opponent === undefined) throw new Error('a game state without two seats');
  return SnapshotSchema.parse({
    seats: [you, opponent],
    battlefield,
    exile: [...state.exile],
    stack: state.stack.map((entry) => {
      const physical = state.objects[entry.oid]?.card;
      const active = entry.ability === null ? spellCardByOid(state, entry.oid) : null;
      const sourceCard = entry.sourceCard ?? (active !== null && active !== physical ? active : undefined);
      return {
        oid: entry.oid,
        controller: entry.controller,
        card: entry.ability?.sourceOid ?? entry.copiedSpell?.sourceOid ?? entry.oid,
        ...(sourceCard === undefined ? {} : { sourceCard }),
        source: entry.ability === null ? null : entry.ability.sourceOid,
        ...(entry.ability === null ? {} : { abilityIndex: entry.ability.index }),
        copiedFrom: entry.copiedSpell?.copiedFrom ?? null,
        chosenX: entry.x,
        ...(entry.castingCost === undefined ? {} : { castingCost: entry.castingCost }),
        mode: entry.mode,
        triggerContext: entry.triggerContext,
        sourceCharacteristics:
          entry.sourceCharacteristics === null
            ? null
            : {
                colors: [...entry.sourceCharacteristics.colors],
                subtypes: [...entry.sourceCharacteristics.subtypes],
              },
        targets: [...entry.targets],
        ...(entry.multiTargets === undefined ? {} : { multiTargets: entry.multiTargets }),
        ...(entry.damageAllocations === undefined ? {} : { damageAllocations: entry.damageAllocations }),
        ...(entry.paidSacrificePower === undefined ? {} : { paidSacrificePower: entry.paidSacrificePower }),
        ...(entry.paidSacrificeToughness === undefined
          ? {}
          : { paidSacrificeToughness: entry.paidSacrificeToughness }),
        ...(entry.paidDiscardManaValue === undefined
          ? {}
          : { paidDiscardManaValue: entry.paidDiscardManaValue }),
        ...(entry.siegeDefeat === undefined ? {} : { siegeDefeat: true }),
      };
    }),
  });
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function decisionRecord(state: GameState, decision: Decision, action: Action, limit: number): unknown {
  const all = decision.options;
  const fullIndex = all.findIndex((option) => sameAction(option, action));
  const kept: Action[] = [...all.slice(0, limit)];
  let chosen: number | null = null;
  if (fullIndex >= 0 && fullIndex < kept.length) {
    chosen = fullIndex;
  } else if (fullIndex >= 0) {
    kept.push(action);
    chosen = kept.length - 1;
  }
  return DecisionSchema.parse({
    kind: decision.kind,
    player: decision.player,
    ...(decision.kind === 'freeCast' && state.pendingFreeCast?.card !== undefined
      ? { activeCard: state.pendingFreeCast.card }
      : {}),
    optionCount: all.length,
    truncated: all.length > limit,
    complete: decision.complete,
    options: kept.map((option) => ActionSchema.parse(option)),
    chosen,
  });
}

export function stepRecord(
  index: number,
  seq: number,
  state: GameState,
  events: readonly GameEvent[],
  snapshot: LogSnapshot | null,
  decision: unknown,
  action: Action | null,
): StepRecord {
  return StepRecordSchema.parse({
    record: 'step',
    game: index,
    seq,
    turn: state.turn.number,
    step: state.turn.step,
    active: state.turn.active,
    decision,
    action: action === null ? null : ActionSchema.parse(action),
    events: events.map((event) => EventSchema.parse(event)),
    state: snapshot,
  });
}

function cardDictionary(state: GameState): Readonly<Record<string, Card>> {
  const cards: Record<string, Card> = {};
  for (const object of Object.values(state.objects)) cards[object.card.id] = object.card;
  return cards;
}

function objectTable(state: GameState): Readonly<Record<string, unknown>> {
  const objects: Record<string, unknown> = {};
  for (const [oid, object] of Object.entries(state.objects)) {
    objects[oid] = { card: object.card.id, owner: object.owner, token: object.token };
  }
  return objects;
}

/** Plays one game and returns its records. Deterministic in the seed and agents. */
export function recordGame(options: RecordGameOptions): RecordedGame {
  const limit = options.optionLimit ?? DEFAULT_OPTION_LIMIT;
  const cap = options.enumerationCap ?? DEFAULT_ENUMERATION_CAP;
  const created = createGame({
    seed: options.seed,
    decks: options.decks,
    startingPlayer: options.startingPlayer,
    maximumTurns: options.maximumTurns,
  });

  let state: GameState = created.state;
  let previous = snapshotOf(state);
  const steps: StepRecord[] = [stepRecord(options.index, 0, state, created.events, previous, null, null)];

  for (;;) {
    const decision = pendingDecision(state, cap);
    if (decision === null) break;
    if (steps.length > MAX_DECISIONS) {
      throw new Error(`recording ${options.seed} exceeded ${MAX_DECISIONS} decisions`);
    }
    const agent = options.agents[decision.player];
    const action = agent.decide(
      agentView(state, decision.player, decision, `replay:${String(steps.length)}`, (candidate) =>
        settleAgentAction(state, candidate),
      ),
    );
    const record = decisionRecord(state, decision, action, limit);
    const before = state;
    const stepped = reduce(state, action);
    state = stepped.state;
    const snapshot = snapshotOf(state);
    const changed = JSON.stringify(snapshot) !== JSON.stringify(previous);
    previous = snapshot;
    steps.push(
      stepRecord(
        options.index,
        steps.length,
        before,
        stepped.events,
        changed ? snapshot : null,
        record,
        action,
      ),
    );
  }

  if (state.result === null) {
    throw new Error(`game ${options.seed} stopped owing no decision but with no result`);
  }
  const setup: GameSetup = {
    seed: options.seed,
    decks: options.decks,
    startingPlayer: options.startingPlayer,
    maximumTurns: options.maximumTurns,
  };
  const seats: readonly [string, string] = [options.agents[0].name, options.agents[1].name];
  return { game: gameRecordOf(options.index, setup, seats, state, steps.length), steps };
}

/**
 * The game row over a finished state: what `recordGame` and `recordChoices`
 * both write once the steps are in hand. Throws when the state has no result,
 * because a game row is a row about a finished game.
 */
export function gameRecordOf(
  index: number,
  setup: GameSetup,
  seats: readonly [string, string],
  state: GameState,
  steps: number,
): GameRecord {
  if (state.result === null) throw new Error(`game ${setup.seed} has no result to record`);
  const [first, second] = setup.decks;
  return GameRecordSchema.parse({
    record: 'game',
    game: index,
    seed: setup.seed,
    startingPlayer: setup.startingPlayer ?? DEFAULT_CONFIG.startingPlayer,
    maximumTurns: setup.maximumTurns ?? DEFAULT_CONFIG.maximumTurns,
    seats: [
      { bot: seats[0], deck: first.name },
      { bot: seats[1], deck: second.name },
    ],
    cards: cardDictionary(state),
    objects: objectTable(state),
    steps,
    result: state.result,
  });
}

/**
 * A played game as the kernel's session layer records it: the seed, the seats,
 * and every choice a human made. Seed plus choices is the whole record, so this
 * is what a recorder is handed and asked to reproduce.
 */
export interface RecordChoicesOptions {
  readonly index: number;
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly choices: readonly Choice[];
  /** How many enumerated options a decision record carries. */
  readonly optionLimit?: number;
}

/**
 * Thrown when the choice list and the game disagree: a choice arrives while no
 * human decision is owed, an index names an option the kernel did not offer,
 * or the list runs out before the game ends. `choiceIndex` is the position in
 * the list where the disagreement was found, so a refusal can name it.
 */
export class ReplayDivergedError extends Error {
  constructor(
    readonly choiceIndex: number,
    message: string,
  ) {
    super(`choice ${String(choiceIndex)}: ${message}`);
    this.name = 'ReplayDivergedError';
  }
}

/**
 * The session options a reproduction runs under. No auto-pass, because a pass
 * the player never chose is a decision the record does not hold; no beats,
 * because a pause is not a decision either. `replaySession` in the kernel
 * strips the same three.
 */
const DETERMINISTIC: SessionOptions = { autoPass: undefined, seatAutoPass: undefined, watchBeats: undefined };

interface ReplayedStep {
  readonly session: GameSession;
  readonly events: readonly GameEvent[];
  readonly action: Action;
  readonly decision: unknown;
}

/** One human choice applied, with the events it and the bots' replies produced. */
function nextStep(session: GameSession, choice: Choice, position: number, limit: number): ReplayedStep {
  const pending = session.pending;
  if (pending === null) throw new ReplayDivergedError(position, 'no human decision was owed');
  if (
    typeof choice === 'number' &&
    (!Number.isInteger(choice) || choice < 0 || choice >= pending.options.length)
  ) {
    throw new ReplayDivergedError(
      position,
      `index ${String(choice)} names none of the ${String(pending.options.length)} options offered`,
    );
  }
  const action = typeof choice === 'number' ? (pending.options[choice] as Action) : choice;
  const decision = decisionRecord(session.state, pending, action, limit);
  const next = choose(session, choice, DETERMINISTIC);
  return { session: next, events: next.events.slice(session.events.length), action, decision };
}

/**
 * Re-plays `choices` from `setup` and writes the same rows `recordGame` does,
 * one step per human choice, with the events the choice and the bots' replies
 * produced. The game must end exactly when the list does: a list that runs out
 * first, or runs on after the result, is a `ReplayDivergedError`, and an action
 * the kernel refuses is whatever `choose` throws.
 */
export function recordChoices(options: RecordChoicesOptions): RecordedGame {
  const limit = options.optionLimit ?? DEFAULT_OPTION_LIMIT;
  let session = createSession(options.setup, options.seats, DETERMINISTIC);
  let previous = snapshotOf(session.state);
  const steps: StepRecord[] = [
    stepRecord(options.index, 0, session.state, session.events, previous, null, null),
  ];
  for (const [position, choice] of options.choices.entries()) {
    if (session.result !== null) throw new ReplayDivergedError(position, 'the game had already ended');
    const before = session.state;
    const stepped = nextStep(session, choice, position, limit);
    session = stepped.session;
    const snapshot = snapshotOf(session.state);
    const changed = JSON.stringify(snapshot) !== JSON.stringify(previous);
    previous = snapshot;
    steps.push(
      stepRecord(
        options.index,
        steps.length,
        before,
        stepped.events,
        changed ? snapshot : null,
        stepped.decision,
        stepped.action,
      ),
    );
  }
  if (session.result === null) {
    throw new ReplayDivergedError(options.choices.length, 'the list ran out before the game ended');
  }
  const seats: readonly [string, string] = [seatName(options.seats[0]), seatName(options.seats[1])];
  return { game: gameRecordOf(options.index, options.setup, seats, session.state, steps.length), steps };
}

/** Serializes recorded games as the JSONL the viewer reads. */
export function writeEventLog(source: string, games: readonly RecordedGame[]): string {
  const header: HeaderRecord = HeaderRecordSchema.parse({
    record: 'header',
    schema: EVENT_LOG_SCHEMA_VERSION,
    source,
    games: games.length,
  });
  const lines: string[] = [JSON.stringify(header)];
  for (const recorded of games) {
    lines.push(JSON.stringify(recorded.game));
    for (const step of recorded.steps) lines.push(JSON.stringify(step));
  }
  return `${lines.join('\n')}\n`;
}
