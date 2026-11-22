/**
 * What a finished game is to the server that records it.
 *
 * The lab keeps every finished game under `data/gameplay/`, and this package
 * is where two of the three ways a game finishes are seen whole: a kernel
 * table on `./server.ts` holds the seed, the seats and every choice, and a
 * gateway session on `./backend-gateway.ts` holds the transcript the backend
 * showed. The third, a game played in the browser against a bot, is posted
 * here over `/api/games`, and the browser's word for it is taken the way any
 * request body is: read by hand, refused by name, and then reproduced from
 * the seed and the choices before a byte of it is trusted.
 *
 * The recorder itself lives in `@mtg/ui` (`packages/ui/tools/gameplay-recorder.ts`),
 * because writing a record means resolving card ids against a set library and
 * this package holds no sets. What this file owns is the seam: the capture
 * shapes a server hands over, the wire shape a browser sends, the ceilings the
 * route enforces, and the refusal codes a recorder answers with. A relay for
 * an observed table on this server records through the same interface with a
 * `netplay-forge` capture.
 *
 * The three ceilings, and why each is a ceiling rather than a policy: a body
 * cap because a record is one game and a megabyte holds any game the kernel
 * can play; a cap on open tokens because a token is minted before the game is
 * played and a page that mints without finishing would otherwise hold them
 * forever; a cap on accepted posts because the directory is unbounded and the
 * lab is on a loopback port anybody on the machine can reach.
 */
import type { Choice, GameResult, GameSetup, Seat } from '@mtg/kernel';
import type { ObservedTableCapture } from './observed-table';
import { MAX_NETPLAY_DECISIONS, NETPLAY_PROTOCOL } from './protocol';

export type GameplayFormat = 'constructed' | 'draft' | 'sealed' | 'commander';

export type GameplaySource = 'browser-kernel' | 'netplay-kernel' | 'netplay-forge' | 'gateway-forge';

/** The largest body `PUT /api/games/<token>` reads. */
export const MAX_GAME_BODY_BYTES = 1024 * 1024;

/** How many minted tokens may wait for a finish at once. */
export const MAX_OPEN_RECORDINGS = 8;

/** How many browser games one server process records before refusing. */
export const MAX_RECORDED_POSTS = 64;

const MAX_SEED_LENGTH = 200;
const MAX_NAME_LENGTH = 80;
const MAX_CARD_ID_LENGTH = 120;
const MAX_DECK_CARDS = 250;
const MAX_TURNS = 10_000;
const MAX_LIFE = 10_000;
const MAX_HAND = 100;

export interface WireSeat {
  readonly kind: 'human' | 'bot';
  readonly name: string;
}

export interface WireDeck {
  readonly name: string;
  readonly cardIds: readonly string[];
}

/** A browser's account of a kernel game: everything but the cards themselves. */
export interface KernelGameWire {
  readonly protocol: number;
  readonly format: GameplayFormat;
  readonly setup: Omit<GameSetup, 'decks'>;
  readonly decks: readonly [WireDeck, WireDeck];
  readonly seats: readonly [WireSeat, WireSeat];
  readonly choices: readonly Choice[];
  readonly result: GameResult;
}

/** A kernel table this server played to a result. */
export interface KernelGameCapture {
  readonly source: 'netplay-kernel';
  readonly format: GameplayFormat;
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly choices: readonly Choice[];
  readonly result: GameResult;
}

/** A browser's claim, not yet reproduced. */
export interface BrowserGameCapture {
  readonly source: 'browser-kernel';
  readonly wire: KernelGameWire;
}

/**
 * A game an observed backend played, as the transcript it showed.
 *
 * The four fields are `./observed-table.ts`'s `ObservedTableCapture`, which is
 * what an observed table hands its `onFinished`; all this adds is which of the
 * two arms saw it, because that is the one thing the table itself cannot know.
 * Restating the shape here would be two declarations of one record, and the
 * relay that forwards a table's capture would then typecheck against a copy.
 */
export type ObservedGameCapture = ObservedTableCapture & {
  readonly source: 'netplay-forge' | 'gateway-forge';
};

export type GameplayCapture = KernelGameCapture | BrowserGameCapture | ObservedGameCapture;

export type GameplayRefusal = 'unknown-cards' | 'not-reproduced' | 'invalid-choice' | 'write-failed';

export type GameplayRecorded =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly code: GameplayRefusal; readonly message: string };

/**
 * What a server records through. `record` never throws: a game that cannot be
 * recorded is a refusal with a code, because the game is over either way and
 * the caller's next line is a log line, not a retry.
 */
export interface GameplayRecorder {
  record(capture: GameplayCapture): Promise<GameplayRecorded>;
  /** The index rows, oldest first, as the reader's schema will parse them. */
  index(): Promise<readonly unknown[]>;
  /** One record's bytes, or null when no record has that id. */
  read(id: string): Promise<string | null>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A field read, or the sentence that refuses it. */
type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

function refuse<T>(why: string): Read<T> {
  return { ok: false, why };
}

function text(value: unknown, where: string, max: number, min = 1): Read<string> {
  if (typeof value !== 'string') return refuse(`${where} is ${JSON.stringify(value)}, which is not text`);
  if (value.length < min) return refuse(`${where} is empty`);
  if (value.length > max) {
    return refuse(`${where} is ${String(value.length)} characters, over the ${String(max)} limit`);
  }
  return { ok: true, value };
}

function count(value: unknown, where: string, max: number): Read<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return refuse(`${where} is ${JSON.stringify(value)}, which is not a whole number`);
  }
  if (value > max) return refuse(`${where} is ${String(value)}, over the ${String(max)} limit`);
  return { ok: true, value };
}

function seat(value: unknown, where: string): Read<0 | 1> {
  return value === 0 || value === 1
    ? { ok: true, value }
    : refuse(`${where} is ${JSON.stringify(value)}, which is not a seat`);
}

const SETUP_COUNTS = [
  ['startingLife', MAX_LIFE],
  ['openingHandSize', MAX_HAND],
  ['maximumHandSize', MAX_HAND],
  ['maximumTurns', MAX_TURNS],
] as const;

function readSetup(value: unknown): Read<Omit<GameSetup, 'decks'>> {
  if (!isRecord(value)) return refuse('setup is not an object');
  const seed = text(value['seed'], 'setup.seed', MAX_SEED_LENGTH);
  if (!seed.ok) return seed;
  const counts: Record<string, number> = {};
  for (const [key, max] of SETUP_COUNTS) {
    if (value[key] === undefined) continue;
    const read = count(value[key], `setup.${key}`, max);
    if (!read.ok) return read;
    counts[key] = read.value;
  }
  const starting =
    value['startingPlayer'] === undefined ? null : seat(value['startingPlayer'], 'setup.startingPlayer');
  if (starting !== null && !starting.ok) return starting;
  const skips = value['startingPlayerSkipsFirstDraw'];
  if (skips !== undefined && typeof skips !== 'boolean') {
    return refuse('setup.startingPlayerSkipsFirstDraw is not true or false');
  }
  return {
    ok: true,
    value: {
      seed: seed.value,
      ...counts,
      ...(starting === null ? {} : { startingPlayer: starting.value }),
      ...(skips === undefined ? {} : { startingPlayerSkipsFirstDraw: skips }),
    },
  };
}

function readDeck(value: unknown, where: string): Read<WireDeck> {
  if (!isRecord(value)) return refuse(`${where} is not an object`);
  const name = text(value['name'], `${where}.name`, MAX_NAME_LENGTH, 0);
  if (!name.ok) return name;
  const ids = value['cardIds'];
  if (!Array.isArray(ids) || ids.length === 0) return refuse(`${where}.cardIds is not a non-empty list`);
  if (ids.length > MAX_DECK_CARDS) {
    return refuse(
      `${where}.cardIds holds ${String(ids.length)} cards, over the ${String(MAX_DECK_CARDS)} limit`,
    );
  }
  const cardIds: string[] = [];
  for (const [index, id] of ids.entries()) {
    const read = text(id, `${where}.cardIds[${String(index)}]`, MAX_CARD_ID_LENGTH);
    if (!read.ok) return read;
    cardIds.push(read.value);
  }
  return { ok: true, value: { name: name.value, cardIds } };
}

function readSeat(value: unknown, where: string): Read<WireSeat> {
  if (!isRecord(value)) return refuse(`${where} is not an object`);
  const kind = value['kind'];
  if (kind !== 'human' && kind !== 'bot') {
    return refuse(`${where}.kind is ${JSON.stringify(kind)}, which is not human or bot`);
  }
  const name = text(value['name'], `${where}.name`, MAX_NAME_LENGTH);
  if (!name.ok) return name;
  return { ok: true, value: { kind, name: name.value } };
}

function readPair<T>(
  value: unknown,
  where: string,
  read: (item: unknown, at: string) => Read<T>,
): Read<readonly [T, T]> {
  if (!Array.isArray(value) || value.length !== 2) return refuse(`${where} is not a list of two`);
  const first = read(value[0], `${where}[0]`);
  if (!first.ok) return first;
  const second = read(value[1], `${where}[1]`);
  if (!second.ok) return second;
  return { ok: true, value: [first.value, second.value] };
}

function readChoices(value: unknown): Read<readonly Choice[]> {
  if (!Array.isArray(value)) return refuse('choices is not a list');
  if (value.length > MAX_NETPLAY_DECISIONS) {
    return refuse(
      `choices holds ${String(value.length)} entries, over the ${String(MAX_NETPLAY_DECISIONS)} limit`,
    );
  }
  const choices: Choice[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === 'number') {
      const read = count(item, `choices[${String(index)}]`, Number.MAX_SAFE_INTEGER);
      if (!read.ok) return read;
      choices.push(read.value);
      continue;
    }
    if (
      !isRecord(item) ||
      typeof item['type'] !== 'string' ||
      (item['player'] !== 0 && item['player'] !== 1)
    ) {
      return refuse(`choices[${String(index)}] is neither an option index nor an action`);
    }
    choices.push(item as unknown as Choice);
  }
  return { ok: true, value: choices };
}

function readResult(value: unknown): Read<GameResult> {
  if (!isRecord(value)) return refuse('result is not an object');
  const winner = value['winner'] === null ? null : seat(value['winner'], 'result.winner');
  if (winner !== null && !winner.ok) return winner;
  const loser = value['loser'] === null ? null : seat(value['loser'], 'result.loser');
  if (loser !== null && !loser.ok) return loser;
  const reason = value['reason'];
  if (typeof reason !== 'string') return refuse('result.reason is not text');
  const endedOnTurn = count(value['endedOnTurn'], 'result.endedOnTurn', MAX_TURNS);
  if (!endedOnTurn.ok) return endedOnTurn;
  return {
    ok: true,
    value: {
      winner: winner === null ? null : winner.value,
      loser: loser === null ? null : loser.value,
      reason: reason as GameResult['reason'],
      endedOnTurn: endedOnTurn.value,
    },
  };
}

/**
 * Reads a browser's account of a finished kernel game, or says what is wrong
 * with it. Shape only: whether the choices replay to the claimed result is the
 * recorder's question, not this one's.
 */
export function readKernelGameWire(body: unknown): KernelGameWire | string {
  if (!isRecord(body)) return 'the request body is not an object';
  if (body['protocol'] !== NETPLAY_PROTOCOL) {
    return `protocol ${JSON.stringify(body['protocol'])} is not ${String(NETPLAY_PROTOCOL)}`;
  }
  const format = body['format'];
  if (format !== 'constructed' && format !== 'draft' && format !== 'sealed' && format !== 'commander') {
    return `format ${JSON.stringify(format)} is not one the lab plays`;
  }
  const setup = readSetup(body['setup']);
  if (!setup.ok) return setup.why;
  const decks = readPair(body['decks'], 'decks', readDeck);
  if (!decks.ok) return decks.why;
  const seats = readPair(body['seats'], 'seats', readSeat);
  if (!seats.ok) return seats.why;
  const choices = readChoices(body['choices']);
  if (!choices.ok) return choices.why;
  const result = readResult(body['result']);
  if (!result.ok) return result.why;
  return {
    protocol: NETPLAY_PROTOCOL,
    format,
    setup: setup.value,
    decks: decks.value,
    seats: seats.value,
    choices: choices.value,
    result: result.value,
  };
}
