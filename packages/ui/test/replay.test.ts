/**
 * The event-log reader, against a real replay (see `support/replay-fixture`).
 *
 * The fixture's header still claims 135 games because it was copied verbatim
 * out of a 135-game run. That is exactly why `declaredGames` is reported
 * separately from `games.length`: `appendReplayJsonl` never rewrites the header
 * either, so the count in a real file is a claim, not a fact.
 */
import { describe, expect, it } from 'vitest';
import { ReplayLogError, lifeSeries, matchupLabel, readReplayLog, winningSide } from '../src/replay/timeline';
import { matchupRows, onPlayWon, ratePercent, summarizeLog } from '../src/replay/summary';
import { REPLAY_SCHEMA_VERSION } from '../src/replay/columns';
import { fixtureText } from './support/replay-fixture';

const LOG = readReplayLog(fixtureText());

describe('readReplayLog', () => {
  it('reads the header and every game row', () => {
    expect(LOG.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(LOG.runSeed).toBe('slice/v0');
    expect(LOG.games).toHaveLength(3);
    expect(LOG.declaredGames).toBe(135);
  });

  it('rebuilds one turn per recorded turn, alternating owners', () => {
    for (const game of LOG.games) {
      expect(game.turns).toHaveLength(game.metadata.num_turns);
      expect(game.turns.map((turn) => turn.turn)).toEqual(game.turns.map((_turn, index) => index + 1));
      for (const [index, turn] of game.turns.entries()) {
        expect(turn.owner).toBe(index % 2 === 0 ? 'user' : 'oppo');
      }
    }
  });

  it('carries both seats through every turn', () => {
    const game = LOG.games[0];
    if (game === undefined) throw new Error('fixture has no games');
    const first = game.turns[0];
    if (first === undefined) throw new Error('game has no turns');
    expect(first.user.eot_life).toBe(20);
    expect(first.oppo.eot_life).toBe(20);
    expect(first.cards_drawn).toBeGreaterThanOrEqual(0);
    const last = game.turns[game.turns.length - 1];
    if (last === undefined) throw new Error('game has no last turn');
    expect(Math.min(last.user.eot_life, last.oppo.eot_life)).toBeLessThanOrEqual(0);
  });

  it('keeps the totals and the metadata the sim wrote', () => {
    const game = LOG.games[0];
    if (game === undefined) throw new Error('fixture has no games');
    expect(game.metadata.expansion).toBe('TGR');
    expect(game.metadata.event_type).toBe('SelfPlay');
    expect(game.extras.sim_end_reason).toBe('lifeZero');
    expect(matchupLabel(game)).toBe('WU vs WB');
    expect(game.totals.user.lands_played).toBeGreaterThan(0);
    expect(game.totals.oppo.cards_drawn).toBeGreaterThan(0);
  });

  it('derives a life series with one point per turn', () => {
    const game = LOG.games[0];
    if (game === undefined) throw new Error('fixture has no games');
    const series = lifeSeries(game);
    expect(series).toHaveLength(game.turns.length);
    expect(series[0]?.user).toBe(20);
    expect(series[series.length - 1]?.turn).toBe(game.turns.length);
  });

  it('names the winning seat', () => {
    const winners = LOG.games.map(winningSide);
    expect(winners.every((side) => side === 'user' || side === 'oppo' || side === null)).toBe(true);
    for (const game of LOG.games) {
      const side = winningSide(game);
      if (side === 'user') expect(game.metadata.won).toBe(1);
      if (side === 'oppo') expect(game.metadata.won).toBe(0);
    }
  });
});

describe('readReplayLog rejects malformed input', () => {
  it('refuses an empty file', () => {
    expect(() => readReplayLog('')).toThrow(ReplayLogError);
  });

  it('refuses a file with no header record', () => {
    const rows = fixtureText().split('\n').slice(1).join('\n');
    expect(() => readReplayLog(rows)).toThrow(/does not start with a header record/);
  });

  it('refuses a schema version it does not know', () => {
    const text = fixtureText().replace(REPLAY_SCHEMA_VERSION, 'mtg-sim/replay-superset/999');
    expect(() => readReplayLog(text)).toThrow(/does not match/);
  });

  it('refuses a row missing a column, naming it', () => {
    const lines = fixtureText().split('\n');
    const row = lines[1];
    if (row === undefined) throw new Error('fixture has no rows');
    const parsed: Record<string, unknown> = JSON.parse(row) as Record<string, unknown>;
    delete parsed['user_turn_3_lands_played'];
    lines[1] = JSON.stringify(parsed);
    expect(() => readReplayLog(lines.join('\n'))).toThrow(/user_turn_3_lands_played/);
  });

  it('reports the line number of a broken row', () => {
    const lines = fixtureText().split('\n');
    lines[2] = '{not json';
    try {
      readReplayLog(lines.join('\n'));
      throw new Error('expected a ReplayLogError');
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayLogError);
      expect((error as ReplayLogError).line).toBe(3);
    }
  });
});

describe('summaries', () => {
  it('counts wins, draws and end reasons against the game count', () => {
    const summary = summarizeLog(LOG);
    expect(summary.games).toBe(3);
    expect(summary.winsBySide.user + summary.winsBySide.oppo + summary.draws).toBe(3);
    const reasonTotal = Object.values(summary.endReasons).reduce((sum, value) => sum + value, 0);
    expect(reasonTotal).toBe(3);
    expect(summary.turns.min).toBeLessThanOrEqual(summary.turns.median);
    expect(summary.turns.median).toBeLessThanOrEqual(summary.turns.max);
    expect(summary.meanDecisions).toBeGreaterThan(0);
  });

  it('agrees with the per-game on-play flag', () => {
    const summary = summarizeLog(LOG);
    expect(summary.onPlayWins).toBe(LOG.games.filter(onPlayWon).length);
  });

  it('groups games by matchup', () => {
    const rows = matchupRows(LOG.games);
    expect(rows.map((row) => row.key)).toEqual(['WU/WB', 'WU/WR', 'WU/UB']);
    expect(rows.reduce((sum, row) => sum + row.games, 0)).toBe(3);
  });

  it('says n/a rather than dividing by zero', () => {
    expect(ratePercent(0, 0)).toBe('n/a');
    expect(ratePercent(1, 4)).toBe('25.0%');
  });
});
