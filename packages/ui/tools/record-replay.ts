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
  DeckList,
  Decision,
  GameEvent,
  GameState,
  ObjectId,
  PlayerAgent,
  PlayerId,
  StackEntry,
} from '@mtg/kernel';
import {
  attachmentOf,
  counterCount,
  createGame,
  isCreatureObject,
  pendingDecision,
  powerOf,
  reduce,
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
  'ability',
  'mode',
  'multiTargets',
  'triggerContext',
  'x',
  'sourceCharacteristics',
  'copiedSpell',
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
    return {
      oid,
      controller: object.controller,
      tapped: object.tapped,
      summoningSick: object.summoningSick,
      damage: object.damage,
      plusCounters: object.counters.plusOnePlusOne,
      minusCounters: object.counters.minusOneMinusOne,
      ...(object.card.kind === 'planeswalker' ? { loyalty: counterCount(object.counters, 'loyalty') } : {}),
      power: creature ? powerOf(state, oid) : null,
      toughness: creature ? toughnessOf(state, oid) : null,
      attachedTo: attachmentOf(state, oid) ?? null,
      attacking: attacking.has(oid),
      blocking: blocking.has(oid),
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
    stack: state.stack.map((entry) => ({
      oid: entry.oid,
      controller: entry.controller,
      card: entry.ability?.sourceOid ?? entry.copiedSpell?.sourceOid ?? entry.oid,
      source: entry.ability === null ? null : entry.ability.sourceOid,
      copiedFrom: entry.copiedSpell?.copiedFrom ?? null,
      chosenX: entry.x,
      mode: entry.mode,
      triggerContext:
        entry.triggerContext === null
          ? null
          : {
              kind: entry.triggerContext.kind,
              triggeringCreature: entry.triggerContext.triggeringCreature,
            },
      sourceCharacteristics:
        entry.sourceCharacteristics === null
          ? null
          : {
              colors: [...entry.sourceCharacteristics.colors],
              subtypes: [...entry.sourceCharacteristics.subtypes],
            },
      targets: [...entry.targets],
      ...(entry.multiTargets === undefined ? {} : { multiTargets: entry.multiTargets }),
    })),
  });
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function decisionRecord(decision: Decision, action: Action, limit: number): unknown {
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
    const action = agent.decide({ state, player: decision.player, decision });
    const record = decisionRecord(decision, action, limit);
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

  const result = state.result;
  if (result === null) throw new Error(`game ${options.seed} stopped owing no decision but with no result`);

  const [first, second] = options.decks;
  const game = GameRecordSchema.parse({
    record: 'game',
    game: options.index,
    seed: options.seed,
    startingPlayer: options.startingPlayer,
    maximumTurns: options.maximumTurns,
    seats: [
      { bot: options.agents[0].name, deck: first.name },
      { bot: options.agents[1].name, deck: second.name },
    ],
    cards: cardDictionary(state),
    objects: objectTable(state),
    steps: steps.length,
    result,
  });
  return { game, steps };
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
