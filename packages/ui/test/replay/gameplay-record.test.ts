/**
 * The on-disk shape of a recorded game, pinned from the reader's side.
 *
 * A record is read by surfaces that never see the engine, so what a valid one
 * is has to be decidable from the file alone: the two event arms, the two set
 * identity halves, and the index row that names a record without opening it.
 * The event-log arm is filled from a real recording rather than typed, so a
 * kernel change that alters a row fails `./record.test.ts` first and this file
 * second, never silently.
 */
import { describe, expect, it } from 'vitest';
import {
  GAMEPLAY_RECORD_SCHEMA,
  GameplayIndexRowSchema,
  GameplayRecordSchema,
  type GameplayRecord,
} from '../../src/routes/replay/gameplay-record';
import { EVENT_LOG_SCHEMA_VERSION } from '../../src/routes/replay/log-schema';
import { recordGame } from '../../tools/record-replay';
import { FIXTURE_GAMES } from './support/fixture-games';

const SHA = 'c'.repeat(64);

function kernelRecord(): GameplayRecord {
  const [, draw] = FIXTURE_GAMES;
  if (draw === undefined) throw new Error('the fixture holds no draw game');
  const recorded = recordGame(draw);
  return {
    schema: GAMEPLAY_RECORD_SCHEMA,
    id: '20260916T120000Z-0f2c3b4a-1111-4222-8333-944455556666',
    at: '2026-09-16T12:00:00.000Z',
    source: 'netplay-kernel',
    format: 'sealed',
    set: { setCode: 'TST', setSha256: SHA, formatId: null, formatSha256: null, cardsSha256: SHA },
    seats: [
      { kind: 'human', name: 'One', deck: { name: 'RW', size: 40, cards: ['a', 'b'] } },
      { kind: 'kernel-bot', name: 'Two', deck: { name: 'UB', size: 40, cards: ['c'] } },
    ],
    result: recorded.game.result,
    measurement: { decisions: recorded.steps.length - 1, turns: 5, eventBytes: 1024 },
    events: {
      kind: 'event-log',
      schema: EVENT_LOG_SCHEMA_VERSION,
      game: recorded.game,
      steps: [...recorded.steps],
    },
  };
}

function forgeRecord(): GameplayRecord {
  return {
    ...kernelRecord(),
    source: 'gateway-forge',
    format: 'commander',
    set: {
      setCode: null,
      setSha256: null,
      formatId: 'legacy-cube-2021-08',
      formatSha256: SHA,
      cardsSha256: SHA,
    },
    seats: [
      { kind: 'human', name: 'North', deck: { name: 'north', size: 100, cards: [] } },
      { kind: 'forge-bot', name: 'South', deck: { name: 'south', size: 100, cards: [] } },
    ],
    result: { winner: 1, reason: 'concede', endedOnTurn: 3 },
    events: {
      kind: 'transcript',
      backend: 'forge',
      localSeats: [0],
      frames: [{ seq: 0, move: null, view: { seats: [] }, events: [] }],
    },
  };
}

describe('a recorded game', () => {
  it('holds a kernel game as one event-log/10 game with its steps', () => {
    const record = kernelRecord();
    expect(GameplayRecordSchema.parse(record)).toEqual(record);
    expect(record.events.kind === 'event-log' && record.events.steps.length).toBeGreaterThan(1);
  });

  it('holds a Forge game as the observed transcript, with the printed identity half filled', () => {
    const record = forgeRecord();
    expect(GameplayRecordSchema.parse(record)).toEqual(record);
  });

  it('refuses an event-log arm with no steps, an unknown seat kind, and a stray field', () => {
    const record = kernelRecord();
    if (record.events.kind !== 'event-log') throw new Error('expected the event-log arm');
    expect(
      GameplayRecordSchema.safeParse({ ...record, events: { ...record.events, steps: [] } }).success,
    ).toBe(false);
    expect(
      GameplayRecordSchema.safeParse({
        ...record,
        seats: [{ ...record.seats[0], kind: 'agent' }, record.seats[1]],
      }).success,
    ).toBe(false);
    expect(GameplayRecordSchema.safeParse({ ...record, extra: true }).success).toBe(false);
  });

  it('refuses a hash that is not sixty-four hex characters and a format the lab does not play', () => {
    const record = kernelRecord();
    expect(
      GameplayRecordSchema.safeParse({ ...record, set: { ...record.set, setSha256: 'abc' } }).success,
    ).toBe(false);
    expect(GameplayRecordSchema.safeParse({ ...record, format: 'vintage' }).success).toBe(false);
  });
});

describe('an index row', () => {
  it('is the head with the arm named, the path under its day, and the bytes hashed', () => {
    const { events, schema: _schema, ...head } = kernelRecord();
    const row = {
      ...head,
      events: events.kind,
      path: `20260916/${head.id}.json`,
      sha256: SHA,
      bytes: 4096,
    };
    expect(GameplayIndexRowSchema.parse(row)).toEqual(row);
  });

  it('refuses a path that is not <yyyymmdd>/<file>.json', () => {
    const { events, schema: _schema, ...head } = kernelRecord();
    const row = { ...head, events: events.kind, sha256: SHA, bytes: 1 };
    for (const path of [
      'x.json',
      '2026/x.json',
      '20260916/../x.json',
      '20260916/x.jsonl',
      '/20260916/x.json',
    ]) {
      expect(GameplayIndexRowSchema.safeParse({ ...row, path }).success, path).toBe(false);
    }
  });
});
