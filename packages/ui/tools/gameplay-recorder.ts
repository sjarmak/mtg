/**
 * The recorder every finished game goes through, whichever server saw it end.
 *
 * `data/gameplay/<yyyymmdd>/<id>.json` holds one game as
 * `../src/routes/replay/gameplay-record.ts` states it, and `data/gameplay/index.jsonl`
 * holds one row per record, so an analysis can list what was played without
 * opening a file per game. The three ways a game finishes arrive through
 * `@mtg/netplay`'s `GameplayCapture`: a kernel table the netplay server played
 * whole, a browser's claim about a game it played against a bot, and the
 * transcript an observed backend showed. The first two are written as event
 * rows the Replay tab already reads, and both are **re-derived** here from the
 * seed and the choices through `./record-replay.ts` rather than copied. For the
 * server's own table that is a consistency check that costs a replay; for the
 * browser it is the whole of the trust, because a page can post any bytes it
 * likes and the seed plus the choices is the only claim a kernel game can
 * make that the kernel itself can check. A claimed result that disagrees with
 * the derived one is refused by name, and so is a choice the kernel would not
 * have offered.
 *
 * Every write is durable in the order the reader depends on: the record is
 * written and synced, its directory is synced, and only then does the index
 * gain a row naming it, so a row never points at a file that a crash left
 * short. Writes are serialized through one queue for the same reason: two
 * appends to one line-oriented index are two lines only if they take turns.
 * `record` never rejects; a game that cannot be recorded is a refusal with a
 * code and a sentence on `report`, because the game is over either way.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rulesOf } from '@mtg/engine';
import type { SeatId, SessionSpec } from '@mtg/engine';
import { botSeat, humanSeat, seatName } from '@mtg/kernel';
import type { Choice, DeckList, GameResult, GameSetup, Seat } from '@mtg/kernel';
import type {
  BrowserGameCapture,
  GameplayCapture,
  GameplayFormat,
  GameplayRecorded,
  GameplayRecorder,
  GameplayRefusal,
  GameplaySource,
  KernelGameCapture,
  ObservedGameCapture,
} from '@mtg/netplay';
import { greedyBot } from '@mtg/sim/bot';
import { boardSeatOrNull } from '../src/routes/play/board-seat';
import { EVENT_LOG_SCHEMA_VERSION } from '../src/routes/replay/log-schema';
import type { GameRecord, StepRecord } from '../src/routes/replay/log-schema';
import {
  GAMEPLAY_RECORD_SCHEMA,
  GameplayIndexRowSchema,
  GameplayRecordSchema,
} from '../src/routes/replay/gameplay-record';
import type {
  GameplayIndexRow,
  GameplayMeasurement,
  GameplaySeat,
  ObservedResult,
  SetIdentity,
} from '../src/routes/replay/gameplay-record';
import { GAMEPLAY_INDEX_FILENAME, dayDirectory, gameplayRecordPath } from './data-path';
import { appendDurably, fsyncDirectory, writeDurably } from './durable-write';
import { identifyCards, sha256Of } from './gameplay-identity';
import type { SetIdentitySource } from './gameplay-identity';
import { ReplayDivergedError, recordChoices } from './record-replay';

export interface GameplayRecorderOptions {
  /** The family root, already through `resolveDataDir` in `./data-path.ts`. */
  readonly root: string;
  readonly sets: readonly SetIdentitySource[];
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  /** Where a refusal's sentence goes. Standard error by default. */
  readonly report?: ((line: string) => void) | undefined;
}

/** `<yyyymmdd>T<hhmmss>Z-<uuid>`: sorts by time, and the uuid keeps two games in one second apart. */
export function gameplayId(at: Date, uuid: string): string {
  const stamp = at.toISOString().slice(0, 19).replaceAll(/[-:]/g, '');
  return `${stamp}Z-${uuid}`;
}

class Refused extends Error {
  constructor(
    readonly code: GameplayRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'GameplayRefused';
  }
}

/** A kernel game with its cards resolved: what both kernel arms reduce to. */
interface KernelGame {
  readonly source: GameplaySource;
  readonly format: GameplayFormat;
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly choices: readonly Choice[];
  readonly claimed: GameResult;
}

/** The events arm as built, before the schema parses it into the record. */
type DraftEvents =
  | {
      readonly kind: 'event-log';
      readonly schema: typeof EVENT_LOG_SCHEMA_VERSION;
      readonly game: GameRecord;
      readonly steps: readonly StepRecord[];
    }
  | {
      readonly kind: 'transcript';
      readonly backend: string;
      readonly localSeats: readonly SeatId[];
      readonly frames: readonly {
        readonly seq: number;
        readonly move: string | null;
        readonly view: Record<string, unknown>;
        readonly events: readonly Record<string, unknown>[];
      }[];
    };

/** The record without its identity, which the writer assigns; `GameplayRecordSchema` is the type gate. */
interface Draft {
  readonly source: GameplaySource;
  readonly format: GameplayFormat;
  readonly set: SetIdentity;
  readonly seats: readonly [GameplaySeat, GameplaySeat];
  readonly result: GameResult | ObservedResult;
  readonly measurement: GameplayMeasurement;
  readonly events: DraftEvents;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function kernelSeat(seat: Seat, deck: DeckList): GameplaySeat {
  return {
    kind: seat.kind === 'human' ? 'human' : 'kernel-bot',
    name: seatName(seat),
    deck: { name: deck.name, size: deck.cards.length, cards: deck.cards.map((card) => card.id) },
  };
}

function sameResult(claimed: GameResult, derived: GameResult): boolean {
  return (
    claimed.winner === derived.winner &&
    claimed.loser === derived.loser &&
    claimed.reason === derived.reason &&
    claimed.endedOnTurn === derived.endedOnTurn
  );
}

/** The wire's decks, resolved to cards through the set that prints them. */
function kernelGameOf(capture: BrowserGameCapture, sets: readonly SetIdentitySource[]): KernelGame {
  const { wire } = capture;
  const ids = wire.decks.flatMap((deck) => deck.cardIds);
  const identity = identifyCards(ids, sets);
  if (!identity.ok) throw new Refused('unknown-cards', identity.message);
  const { cardById } = identity;
  const deckOf = (deck: { readonly name: string; readonly cardIds: readonly string[] }): DeckList => ({
    name: deck.name,
    cards: deck.cardIds.flatMap((id) => {
      const card = cardById.get(id);
      return card === undefined ? [] : [card];
    }),
  });
  const seatOf = (seat: { readonly kind: 'human' | 'bot'; readonly name: string }): Seat =>
    seat.kind === 'human' ? humanSeat(seat.name) : botSeat(greedyBot(seat.name));
  return {
    source: 'browser-kernel',
    format: wire.format,
    setup: { ...wire.setup, decks: [deckOf(wire.decks[0]), deckOf(wire.decks[1])] },
    seats: [seatOf(wire.seats[0]), seatOf(wire.seats[1])],
    choices: wire.choices,
    claimed: wire.result,
  };
}

function kernelGameOfTable(capture: KernelGameCapture): KernelGame {
  return {
    source: capture.source,
    format: capture.format,
    setup: capture.setup,
    seats: capture.seats,
    choices: capture.choices,
    claimed: capture.result,
  };
}

/** Re-derives the event rows from seed and choices, refusing a game that does not reproduce. */
function kernelDraft(game: KernelGame, sets: readonly SetIdentitySource[]): Draft {
  const ids = game.setup.decks.flatMap((deck) => deck.cards.map((card) => card.id));
  const identity = identifyCards(ids, sets);
  if (!identity.ok) throw new Refused('unknown-cards', identity.message);
  let recorded;
  try {
    recorded = recordChoices({ index: 0, setup: game.setup, seats: game.seats, choices: game.choices });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const where = error instanceof ReplayDivergedError ? '' : 'the kernel refused a choice: ';
    throw new Refused('invalid-choice', `${where}${message}`);
  }
  const derived = recorded.game.result;
  if (!sameResult(game.claimed, derived)) {
    throw new Refused(
      'not-reproduced',
      `the claimed result ${JSON.stringify(game.claimed)} is not what the seed and the choices produce, ${JSON.stringify(derived)}`,
    );
  }
  const events: DraftEvents = {
    kind: 'event-log',
    schema: EVENT_LOG_SCHEMA_VERSION,
    game: recorded.game,
    steps: recorded.steps,
  };
  return {
    source: game.source,
    format: game.format,
    set: {
      setCode: identity.setCode,
      setSha256: identity.setSha256,
      formatId: null,
      formatSha256: null,
      cardsSha256: identity.cardsSha256,
    },
    seats: [kernelSeat(game.seats[0], game.setup.decks[0]), kernelSeat(game.seats[1], game.setup.decks[1])],
    result: derived,
    measurement: {
      decisions: game.choices.length,
      turns: derived.endedOnTurn,
      eventBytes: byteLength(events),
    },
    events,
  };
}

function observedSet(table: SessionSpec): SetIdentity {
  const { content } = table;
  return {
    setCode: content.kind === 'dsl-set' ? content.setCode : null,
    setSha256: null,
    formatId: content.kind === 'dsl-set' ? null : content.format,
    formatSha256: null,
    cardsSha256: null,
  };
}

function observedSeat(seat: SessionSpec['seats'][number]): GameplaySeat {
  const cards = seat.deck.cards.flatMap((slot) => Array.from({ length: slot.count }, () => slot.name));
  return {
    kind: seat.controller === 'local' ? 'human' : 'forge-bot',
    name: seat.name,
    deck: { name: seat.deck.name, size: Math.max(cards.length, 1), cards },
  };
}

/** The transcript as shown, with the format read off the table's rules. */
function observedDraft(capture: ObservedGameCapture): Draft {
  const frames = capture.transcript.map((frame) => ({
    seq: frame.seq,
    move: frame.move,
    view: frame.view as unknown as Record<string, unknown>,
    events: frame.events as unknown as Record<string, unknown>[],
  }));
  const events: DraftEvents = {
    kind: 'transcript',
    backend: capture.backend,
    localSeats: capture.localSeats,
    frames,
  };
  return {
    source: capture.source,
    format: rulesOf(capture.table).variant === 'commander' ? 'commander' : 'constructed',
    set: observedSet(capture.table),
    seats: [observedSeat(capture.table.seats[0]), observedSeat(capture.table.seats[1])],
    result: {
      winner: boardSeatOrNull(capture.result.winner),
      reason: capture.result.reason,
      endedOnTurn: capture.result.endedOnTurn,
    },
    measurement: {
      decisions: capture.transcript.filter((frame) => frame.move !== null).length,
      turns: capture.result.endedOnTurn,
      eventBytes: byteLength(events),
    },
    events,
  };
}

function draftOf(capture: GameplayCapture, sets: readonly SetIdentitySource[]): Draft {
  switch (capture.source) {
    case 'netplay-kernel':
      return kernelDraft(kernelGameOfTable(capture), sets);
    case 'browser-kernel':
      return kernelDraft(kernelGameOf(capture, sets), sets);
    case 'netplay-forge':
    case 'gateway-forge':
      return observedDraft(capture);
  }
}

/** Reads every row, refusing a corrupt line by number and keeping the first row per id. */
async function readIndex(root: string): Promise<readonly GameplayIndexRow[]> {
  let text: string;
  try {
    text = await readFile(join(root, GAMEPLAY_INDEX_FILENAME), 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw error;
  }
  const rows = new Map<string, GameplayIndexRow>();
  text.split('\n').forEach((line, at) => {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${GAMEPLAY_INDEX_FILENAME} line ${String(at + 1)} is not JSON`);
    }
    const row = GameplayIndexRowSchema.safeParse(parsed);
    if (!row.success) {
      throw new Error(
        `${GAMEPLAY_INDEX_FILENAME} line ${String(at + 1)} is not an index row: ${row.error.message}`,
      );
    }
    if (!rows.has(row.data.id)) rows.set(row.data.id, row.data);
  });
  return [...rows.values()];
}

export function gameplayRecorder(options: GameplayRecorderOptions): GameplayRecorder {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const report =
    options.report ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });
  let queue: Promise<unknown> = Promise.resolve();

  async function write(draft: Draft): Promise<string> {
    const at = now();
    const id = gameplayId(at, newId());
    const record = GameplayRecordSchema.parse({
      ...draft,
      id,
      at: at.toISOString(),
      schema: GAMEPLAY_RECORD_SCHEMA,
    });
    const path = gameplayRecordPath(options.root, at, id);
    const text = `${JSON.stringify(record)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeDurably(path, text);
    await fsyncDirectory(dirname(path));
    const { events, schema, ...head } = record;
    const row: GameplayIndexRow = {
      ...head,
      events: events.kind,
      path: `${dayDirectory(at)}/${id}.json`,
      sha256: sha256Of(text),
      bytes: Buffer.byteLength(text, 'utf8'),
    };
    void schema;
    await appendDurably(join(options.root, GAMEPLAY_INDEX_FILENAME), `${JSON.stringify(row)}\n`);
    return id;
  }

  async function record(capture: GameplayCapture): Promise<GameplayRecorded> {
    try {
      const draft = draftOf(capture, options.sets);
      const written = queue.then(() => write(draft));
      queue = written.catch(() => undefined);
      return { ok: true, id: await written };
    } catch (error) {
      const refused =
        error instanceof Refused
          ? error
          : new Refused('write-failed', error instanceof Error ? error.message : String(error));
      report(`not recording a ${capture.source} game (${refused.code}): ${refused.message}`);
      return { ok: false, code: refused.code, message: refused.message };
    }
  }

  return {
    record,
    index: () => readIndex(options.root),
    async read(id: string): Promise<string | null> {
      const row = (await readIndex(options.root)).find((candidate) => candidate.id === id);
      if (row === undefined) return null;
      return readFile(join(options.root, row.path), 'utf8');
    },
  };
}
