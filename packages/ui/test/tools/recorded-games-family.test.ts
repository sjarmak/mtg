/**
 * The recorded-games reader in `../../tools/recorded-games-family.ts`: index
 * lines folded into one record per subject and matchup, and every line it
 * cannot read named by number rather than thrown.
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import { GameplayIndexRowSchema } from '../../src/routes/replay/gameplay-record';
import { matchupOfRow, readRecordedGames, subjectOfRow } from '../../tools/recorded-games-family';
import { DECK_NAMES, gameplayRow, gameplaySet } from './support/ledger-fixtures';

const PATH = 'data/gameplay/index.jsonl';

async function* lines(rows: readonly unknown[]): AsyncIterable<string> {
  for (const row of rows) yield typeof row === 'string' ? row : JSON.stringify(row);
}

function seats(first: [string, string], second: [string, string]): unknown[] {
  return [
    { kind: first[1], name: 'A', deck: { name: first[0], size: 40, cards: [] } },
    { kind: second[1], name: 'B', deck: { name: second[0], size: 40, cards: [] } },
  ];
}

describe('the join key of a row', () => {
  it('is the format id for a printed format, the cube for the cube, and the set code otherwise', () => {
    const printed = GameplayIndexRowSchema.parse(
      gameplayRow({ set: gameplaySet({ setCode: 'AKH', formatId: 'akh-hou' }) }),
    );
    expect(subjectOfRow(printed)).toEqual({ kind: 'format', id: 'akh-hou', code: 'AKH' });
    const cube = GameplayIndexRowSchema.parse(
      gameplayRow({ set: gameplaySet({ setCode: null, formatId: LEGACY_CUBE_FORMAT }) }),
    );
    expect(subjectOfRow(cube)).toEqual({ kind: 'cube', id: LEGACY_CUBE_FORMAT, code: null });
    const set = GameplayIndexRowSchema.parse(gameplayRow());
    expect(subjectOfRow(set)).toEqual({ kind: 'set', id: 'XMP', code: 'XMP' });
    const none = GameplayIndexRowSchema.parse(
      gameplayRow({ set: gameplaySet({ setCode: null, formatId: null }) }),
    );
    expect(subjectOfRow(none)).toBeNull();
  });

  it('labels the matchup independent of seat order and names an unnamed deck', () => {
    const one = GameplayIndexRowSchema.parse(
      gameplayRow({ seats: seats(['Gloom', 'kernel-bot'], ['', 'human']) }),
    );
    const two = GameplayIndexRowSchema.parse(
      gameplayRow({ seats: seats(['', 'human'], ['Gloom', 'kernel-bot']) }),
    );
    expect(matchupOfRow(one)).toBe('Gloom (kernel-bot) vs unnamed deck (human)');
    expect(matchupOfRow(two)).toBe(matchupOfRow(one));
  });
});

describe('reading the index', () => {
  it('folds rows into one record per subject and matchup, counting decided games', async () => {
    const read = await readRecordedGames(
      PATH,
      lines([
        gameplayRow({ id: 'g1', at: '2026-09-14T09:00:00.000Z' }),
        gameplayRow({
          id: 'g2',
          at: '2026-09-15T09:00:00.000Z',
          seats: seats([DECK_NAMES.bot, 'kernel-bot'], [DECK_NAMES.human, 'human']),
          result: { winner: null, reason: 'abandoned', endedOnTurn: 3 },
        }),
        gameplayRow({ id: 'g3', set: gameplaySet({ setCode: 'AKH', formatId: 'akh-hou' }) }),
        '',
      ]),
    );
    expect(read.skipped).toEqual([]);
    expect(read.records).toHaveLength(2);
    const [xmp, akh] = read.records;
    expect(xmp?.family).toBe('recorded-games');
    expect(xmp?.path).toBe(PATH);
    expect(xmp?.version).toBe('mtg-ui/gameplay-record/1');
    expect(xmp?.subject).toEqual({ kind: 'set', id: 'XMP', code: 'XMP' });
    expect(xmp?.matchup).toBe('Gloom (kernel-bot) vs The Sky Islands (human)');
    expect(xmp?.produced).toBe('2026-09-15T09:00:00.000Z');
    expect(xmp?.evidence).toEqual({
      strength: 'games',
      trials: { attempted: 2, completed: 1 },
      arms: null,
      source: 'gameplay-index',
      episode: null,
      status: null,
    });
    expect(akh?.subject.id).toBe('akh-hou');
  });

  it('names each unreadable line by number and keeps reading', async () => {
    const read = await readRecordedGames(
      PATH,
      lines([
        'not json',
        gameplayRow({ id: 'g2', source: 'telepathy' }),
        gameplayRow({
          id: 'g3',
          set: gameplaySet({ setCode: null, formatId: null }),
          path: '20260915/g3.json',
        }),
        gameplayRow({ id: 'g4' }),
      ]),
    );
    expect(read.records).toHaveLength(1);
    expect(read.skipped).toEqual([
      { path: `${PATH}:1`, why: 'is not JSON' },
      { path: `${PATH}:2`, why: expect.stringContaining('`source`') as unknown },
      { path: `${PATH}:3`, why: 'record 20260915/g3.json names neither a set code nor a format id' },
    ]);
  });
});
