/**
 * What `../../tools/gameplay-recorder.ts` writes, and what it refuses.
 *
 * Every game is written into a temporary root, never `data/gameplay/`. The
 * kernel arms are pinned by playing a real game and handing the recorder its
 * seed and choices; the observed arm by `scriptBackend`, the engine's toy.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMANDER_RULES, scriptBackend } from '@mtg/engine';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { botSeat, choose, createSession, humanSeat } from '@mtg/kernel';
import type { Choice, GameResult, GameSetup, Seat } from '@mtg/kernel';
import { NETPLAY_PROTOCOL } from '@mtg/netplay';
import type {
  BrowserGameCapture,
  GameplayRecorder,
  KernelGameCapture,
  ObservedGameCapture,
} from '@mtg/netplay';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import { GameplayIndexRowSchema, GameplayRecordSchema } from '../../src/routes/replay/gameplay-record';
import type { SetIdentitySource } from '../../tools/gameplay-identity';
import { gameplayId, gameplayRecorder } from '../../tools/gameplay-recorder';

const SET: SetIdentitySource = {
  code: 'SLC',
  sha256: 'a'.repeat(64),
  cards: [...FIXTURE_DECK_RW.cards, ...FIXTURE_DECK_UB.cards],
};

const AT = new Date('2026-09-16T23:59:58.500Z');

interface Played {
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly choices: readonly Choice[];
  readonly result: GameResult;
}

function playedGame(): Played {
  const setup: GameSetup = {
    seed: 'gameplay/recorder/human-vs-greedy',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    startingPlayer: 0,
    maximumTurns: 4,
  };
  const seats: readonly [Seat, Seat] = [humanSeat('One'), botSeat(greedyBot('greedy-ub'))];
  let session = createSession(setup, seats);
  for (let guard = 0; session.result === null; guard += 1) {
    if (guard > 2000) throw new Error('the played game did not end');
    session = choose(session, 0);
  }
  if (session.result === null) throw new Error('unreachable');
  return { setup, seats, choices: session.choices, result: session.result };
}

const PLAYED = playedGame();

function tableCapture(): KernelGameCapture {
  return { source: 'netplay-kernel', format: 'sealed', ...PLAYED };
}

function wireCapture(overrides: Partial<BrowserGameCapture['wire']> = {}): BrowserGameCapture {
  const { decks, ...setup } = PLAYED.setup;
  return {
    source: 'browser-kernel',
    wire: {
      protocol: NETPLAY_PROTOCOL,
      format: 'constructed',
      setup,
      decks: [
        { name: decks[0].name, cardIds: decks[0].cards.map((card) => card.id) },
        { name: decks[1].name, cardIds: decks[1].cards.map((card) => card.id) },
      ],
      seats: [
        { kind: 'human', name: 'One' },
        { kind: 'bot', name: 'greedy-ub' },
      ],
      choices: PLAYED.choices,
      result: PLAYED.result,
      ...overrides,
    },
  };
}

const PRINTED: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [{ name: 'Island', count: 2 }] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [{ name: 'Swamp', count: 1 }] } },
  ],
  seed: 'gameplay-recorder',
  maximumTurns: null,
};

async function observed(table: SessionSpec, clock: number): Promise<ObservedSession> {
  const opened = await scriptBackend({ clock }).open(table);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  while (session.status !== 'finished') {
    const submitted = await session.submit('advance');
    if (!submitted.ok) throw new Error(submitted.error.message);
    session = submitted.session;
  }
  return session;
}

async function observedCapture(table: SessionSpec, clock: number): Promise<ObservedGameCapture> {
  const session = await observed(table, clock);
  if (session.result === null) throw new Error('finished without a result');
  return {
    source: 'gateway-forge',
    backend: session.backend,
    table,
    localSeats: session.localSeats,
    transcript: session.transcript,
    result: session.result,
  };
}

let root = '';
let reported: string[] = [];
let ids = 0;
let recorder: GameplayRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gameplay-recorder-'));
  reported = [];
  ids = 0;
  recorder = gameplayRecorder({
    root,
    sets: [SET],
    now: () => AT,
    newId: () => `uuid-${String((ids += 1))}`,
    report: (line) => reported.push(line),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function listing(): Promise<readonly string[]> {
  return readdir(root, { recursive: true });
}

describe('the game id', () => {
  it('sorts by the UTC second and carries the uuid', () => {
    expect(gameplayId(AT, 'abc')).toBe('20260916T235958Z-abc');
  });
});

describe('recording a kernel table', () => {
  it('writes the re-derived event rows under the UTC day, and one index row naming the file', async () => {
    const recorded = await recorder.record(tableCapture());
    expect(recorded).toEqual({ ok: true, id: '20260916T235958Z-uuid-1' });
    const path = join(root, '20260916', '20260916T235958Z-uuid-1.json');
    const text = await readFile(path, 'utf8');
    const record = GameplayRecordSchema.parse(JSON.parse(text));
    expect(record.source).toBe('netplay-kernel');
    expect(record.format).toBe('sealed');
    expect(record.at).toBe(AT.toISOString());
    expect(record.set).toEqual({
      setCode: 'SLC',
      setSha256: 'a'.repeat(64),
      formatId: null,
      formatSha256: null,
      cardsSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(record.seats.map((seat) => seat.kind)).toEqual(['human', 'kernel-bot']);
    expect(record.seats.map((seat) => seat.name)).toEqual(['One', 'greedy-ub']);
    expect(record.seats[0].deck).toEqual({
      name: 'RW Aggro',
      size: FIXTURE_DECK_RW.cards.length,
      cards: FIXTURE_DECK_RW.cards.map((card) => card.id),
    });
    expect(record.result).toEqual(PLAYED.result);
    expect(record.measurement.decisions).toBe(PLAYED.choices.length);
    expect(record.measurement.turns).toBe(PLAYED.result.endedOnTurn);
    expect(record.events.kind).toBe('event-log');
    if (record.events.kind !== 'event-log') return;
    expect(record.events.game.result).toEqual(PLAYED.result);
    expect(record.events.steps.length).toBe(PLAYED.choices.length + 1);
    expect(record.measurement.eventBytes).toBe(Buffer.byteLength(JSON.stringify(record.events)));

    const rows = (await readFile(join(root, 'index.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '');
    expect(rows.length).toBe(1);
    const row = GameplayIndexRowSchema.parse(JSON.parse(rows[0] ?? ''));
    expect(row).toEqual({
      id: record.id,
      at: record.at,
      source: record.source,
      format: record.format,
      set: record.set,
      seats: record.seats,
      result: record.result,
      measurement: record.measurement,
      events: 'event-log',
      path: '20260916/20260916T235958Z-uuid-1.json',
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
    });
    expect(reported).toEqual([]);
  });

  it('refuses a table whose claimed result the seed and choices do not produce, writing nothing', async () => {
    const claimed: GameResult = { ...PLAYED.result, endedOnTurn: PLAYED.result.endedOnTurn + 1 };
    const refused = await recorder.record({ ...tableCapture(), result: claimed });
    expect(refused).toMatchObject({ ok: false, code: 'not-reproduced' });
    expect(await listing()).toEqual([]);
    expect(reported.length).toBe(1);
    expect(reported[0]).toContain('not-reproduced');
  });
});

describe('recording a browser game', () => {
  it('rebuilds the bot as the greedy bot, reproduces the game, and records it as browser-kernel', async () => {
    const recorded = await recorder.record(wireCapture());
    expect(recorded).toEqual({ ok: true, id: '20260916T235958Z-uuid-1' });
    const text = await recorder.read('20260916T235958Z-uuid-1');
    const record = GameplayRecordSchema.parse(JSON.parse(text ?? ''));
    expect(record.source).toBe('browser-kernel');
    expect(record.format).toBe('constructed');
    expect(record.seats.map((seat) => seat.kind)).toEqual(['human', 'kernel-bot']);
    expect(record.result).toEqual(PLAYED.result);
  });

  it('refuses a claimed result the replay disagrees with', async () => {
    const winner = PLAYED.result.winner === 0 ? 1 : 0;
    const refused = await recorder.record(
      wireCapture({ result: { ...PLAYED.result, winner, loser: PLAYED.result.winner } }),
    );
    expect(refused).toMatchObject({ ok: false, code: 'not-reproduced' });
    expect(await listing()).toEqual([]);
  });

  it('refuses a choice the kernel would not have offered', async () => {
    const overrun = await recorder.record(wireCapture({ choices: [...PLAYED.choices, 0] }));
    expect(overrun).toMatchObject({ ok: false, code: 'invalid-choice' });
    if (overrun.ok) return;
    expect(overrun.message).toContain(`choice ${String(PLAYED.choices.length)}`);
    const absurd = await recorder.record(wireCapture({ choices: [999, ...PLAYED.choices.slice(1)] }));
    expect(absurd).toMatchObject({ ok: false, code: 'invalid-choice' });
    expect(await listing()).toEqual([]);
  });

  it('refuses a deck no staged set prints', async () => {
    const wire = wireCapture();
    const [first, second] = wire.wire.decks;
    const refused = await recorder.record({
      ...wire,
      wire: { ...wire.wire, decks: [{ ...first, cardIds: ['elsewhere-dragon', ...first.cardIds] }, second] },
    });
    expect(refused).toMatchObject({ ok: false, code: 'unknown-cards' });
    if (refused.ok) return;
    expect(refused.message).toContain('"elsewhere-dragon"');
    expect(await listing()).toEqual([]);
  });
});

describe('recording an observed game', () => {
  it('writes the transcript arm, the format off the rules, and the set off the content', async () => {
    const recorded = await recorder.record(await observedCapture(PRINTED, 2));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const record = GameplayRecordSchema.parse(JSON.parse((await recorder.read(recorded.id)) ?? ''));
    expect(record.source).toBe('gateway-forge');
    expect(record.format).toBe('constructed');
    expect(record.set).toEqual({
      setCode: null,
      setSha256: null,
      formatId: 'legacy-cube-2021-08',
      formatSha256: null,
      cardsSha256: null,
    });
    expect(record.seats).toEqual([
      { kind: 'human', name: 'North', deck: { name: 'north', size: 2, cards: ['Island', 'Island'] } },
      { kind: 'forge-bot', name: 'South', deck: { name: 'south', size: 1, cards: ['Swamp'] } },
    ]);
    expect(record.events.kind).toBe('transcript');
    if (record.events.kind !== 'transcript') return;
    expect(record.events.backend).toBe('script');
    expect(record.events.frames.length).toBe(3);
    expect(record.events.frames.map((frame) => frame.move)).toEqual([null, 'advance', 'advance']);
    expect(record.measurement.decisions).toBe(2);
  });

  it('names commander when the table plays under those rules, and a dsl set by its code', async () => {
    const commander: SessionSpec = {
      ...PRINTED,
      rules: COMMANDER_RULES,
      seats: [
        {
          ...PRINTED.seats[0],
          deck: { ...PRINTED.seats[0].deck, commanders: [{ name: 'general-north', count: 1 }] },
        },
        {
          ...PRINTED.seats[1],
          deck: { ...PRINTED.seats[1].deck, commanders: [{ name: 'general-south', count: 1 }] },
        },
      ],
    };
    // The toy backend plays printed formats only, so the dsl-set content is
    // stated on the capture: the recorder reads the table as data.
    const played = await observedCapture(commander, 1);
    const recorded = await recorder.record({
      ...played,
      table: { ...played.table, content: { kind: 'dsl-set', setCode: 'SLC' } },
    });
    expect(recorded.ok).toBe(true);
    const [row] = await recorder.index();
    expect(row).toMatchObject({
      format: 'commander',
      events: 'transcript',
      set: { setCode: 'SLC', formatId: null },
    });
  });
});

describe('the index', () => {
  it('appends one row per record, dedupes a repeated id, and refuses a corrupt line by number', async () => {
    await recorder.record(tableCapture());
    await recorder.record(wireCapture());
    const rows = (await recorder.index()).map((row) => GameplayIndexRowSchema.parse(row));
    expect(rows.map((row) => row.id)).toEqual(['20260916T235958Z-uuid-1', '20260916T235958Z-uuid-2']);

    const indexPath = join(root, 'index.jsonl');
    const text = await readFile(indexPath, 'utf8');
    const [first] = text.split('\n');
    const { appendFile } = await import('node:fs/promises');
    await appendFile(indexPath, `${first ?? ''}\n`);
    expect((await recorder.index()).length).toBe(2);

    await appendFile(indexPath, '{"id":"stray"}\n');
    await expect(recorder.index()).rejects.toThrow('index.jsonl line 4 is not an index row');
    await appendFile(indexPath, 'not json\n');
    await expect(recorder.index()).rejects.toThrow('index.jsonl line 4');
  });

  it('answers an empty index before the first game and null for an id it does not hold', async () => {
    expect(await recorder.index()).toEqual([]);
    expect(await recorder.read('../index')).toBeNull();
    await recorder.record(tableCapture());
    expect(await recorder.read('20260916T235958Z-uuid-9')).toBeNull();
    expect(await recorder.read('20260916T235958Z-uuid-1')).toContain('"schema":"mtg-ui/gameplay-record/1"');
  });

  it('serializes concurrent records so every row lands whole', async () => {
    const results = await Promise.all([
      recorder.record(tableCapture()),
      recorder.record(wireCapture()),
      recorder.record(await observedCapture(PRINTED, 1)),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await recorder.index()).length).toBe(3);
  });

  it('reports a write failure by code rather than throwing', async () => {
    const blocked = gameplayRecorder({
      root: join(root, 'index.jsonl'),
      sets: [SET],
      report: (line) => reported.push(line),
    });
    await recorder.record(tableCapture());
    const refused = await blocked.record(tableCapture());
    expect(refused).toMatchObject({ ok: false, code: 'write-failed' });
    expect(reported.at(-1)).toContain('write-failed');
  });
});
