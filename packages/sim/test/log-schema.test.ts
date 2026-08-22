/**
 * Log schema tests.
 *
 * The column naming is the load-bearing part of this package: calibration
 * against 17lands is a join on these names
 * (`docs/research/prior-art-playability-metrics.md` §2.4). So the assertions
 * here are literal — the exact strings 17lands publishes must come out of
 * `replayRow`, and nothing must come out that is neither theirs nor `sim_`
 * prefixed.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectedReplayColumns,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  greedySpec,
  parseReplayJsonl,
  replayRow,
  REPLAY_GAME_COLUMNS,
  runMatchSerial,
  SIM_LOG_SCHEMA_VERSION,
  SimGameLogSchema,
  writeReplayJsonl,
} from '@mtg/sim';
import type { SimGameLog } from '@mtg/sim';

const run = runMatchSerial({
  runSeed: 'log-schema',
  games: 6,
  decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
  bots: [greedySpec('greedy-rw'), greedySpec('greedy-ub')],
  collectLogs: true,
  expansion: 'SLC',
  eventType: 'SelfPlay',
  gameTime: '2026-08-09T00:00:00Z',
});

function firstLog(): SimGameLog {
  const log = run.logs[0];
  if (log === undefined) throw new Error('the run produced no logs');
  return log;
}

describe('replay log structure', () => {
  it('produces one log per game and parses against its own schema', () => {
    expect(run.logs).toHaveLength(6);
    for (const log of run.logs) expect(() => SimGameLogSchema.parse(log)).not.toThrow();
  });

  it('records one turn per turn played, alternating owners from the player on the play', () => {
    for (const [index, log] of run.logs.entries()) {
      const outcome = run.outcomes[index];
      expect(log.turns).toHaveLength(log.metadata.num_turns);
      expect(log.turns.map((turn) => turn.turn)).toEqual(log.turns.map((_, position) => position + 1));
      const firstOwner = outcome?.startingPlayer === 0 ? 'user' : 'oppo';
      expect(log.turns[0]?.owner).toBe(firstOwner);
    }
  });

  it('agrees with the game outcome on winner, turn count and play/draw', () => {
    for (const [index, log] of run.logs.entries()) {
      const outcome = run.outcomes[index];
      expect(log.metadata.won).toBe(outcome?.winner === 0 ? 1 : 0);
      expect(log.metadata.num_turns).toBe(outcome?.turns);
      expect(log.metadata.on_play).toBe(outcome?.startingPlayer === 0 ? 1 : 0);
      expect(log.extras.sim_winner).toBe(outcome?.winner ?? null);
      expect(log.extras.sim_end_reason).toBe(outcome?.reason);
      expect(log.extras.sim_game_seed).toBe(outcome?.seed);
    }
  });

  it("carries the deck colors in 17lands' main_colors format", () => {
    const log = firstLog();
    expect(log.metadata.main_colors).toBe('WR');
    expect(log.metadata.opp_colors).toBe('UB');
    expect(log.metadata.expansion).toBe('SLC');
    expect(log.metadata.event_type).toBe('SelfPlay');
  });

  it('ends a life-total loss with the loser at zero or below in the last record', () => {
    for (const [index, log] of run.logs.entries()) {
      if (log.extras.sim_end_reason !== 'lifeZero') continue;
      const last = log.turns[log.turns.length - 1];
      expect(last).toBeDefined();
      if (last === undefined) continue;
      const winner = run.outcomes[index]?.winner;
      const loserLife = winner === 0 ? last.oppo.eot_life : last.user.eot_life;
      const winnerLife = winner === 0 ? last.user.eot_life : last.oppo.eot_life;
      expect(loserLife).toBeLessThanOrEqual(0);
      expect(winnerLife).toBeGreaterThan(0);
    }
  });

  it('reconciles the per-turn side stats against the per-game totals', () => {
    for (const log of run.logs) {
      for (const side of ['user', 'oppo'] as const) {
        const mana = log.turns.reduce((sum, turn) => sum + turn[side].mana_spent, 0);
        const spells = log.turns.reduce((sum, turn) => sum + turn[side].instants_sorceries_cast, 0);
        expect(mana).toBe(log.totals[side].mana_spent);
        expect(spells).toBe(log.totals[side].instants_sorceries_cast);
        // Owner-scoped columns are a subset of the totals by construction: they
        // only count what a side did on its own turn.
        const ownTurnDraws = log.turns
          .filter((turn) => turn.owner === side)
          .reduce((sum, turn) => sum + turn.cards_drawn, 0);
        expect(ownTurnDraws).toBeLessThanOrEqual(log.totals[side].cards_drawn);
      }
    }
  });

  it('never reports more blocked attackers than attackers', () => {
    for (const log of run.logs) {
      for (const turn of log.turns) {
        expect(turn.creatures_blocked + turn.creatures_unblocked).toBe(turn.creatures_attacked);
        expect(turn.creatures_blocking).toBeGreaterThanOrEqual(turn.creatures_blocked);
      }
    }
  });
});

describe('17lands column contract', () => {
  it('emits exactly the expected column set', () => {
    const log = firstLog();
    const row = replayRow(log);
    const expected = new Set([...expectedReplayColumns(log.turns), ...Object.keys(log.extras)]);
    expect(new Set(Object.keys(row))).toEqual(expected);
  });

  it('emits all 18 shared game-metadata columns verbatim', () => {
    const row = replayRow(firstLog());
    for (const column of REPLAY_GAME_COLUMNS) expect(row).toHaveProperty(column);
    expect(REPLAY_GAME_COLUMNS).toHaveLength(18);
  });

  it('emits the per-game total columns under 17lands names', () => {
    const row = replayRow(firstLog());
    for (const column of [
      'user_total_cards_drawn',
      'user_total_cards_tutored',
      'user_total_cards_discarded',
      'user_total_lands_played',
      'user_total_creatures_cast',
      'user_total_non_creatures_cast',
      'user_total_instants_sorceries_cast',
      'user_total_mana_spent',
      'oppo_total_cards_drawn',
      'oppo_total_mana_spent',
    ]) {
      expect(row).toHaveProperty(column);
    }
  });

  it('emits the per-turn wide columns under 17lands names', () => {
    const row = replayRow(firstLog());
    for (const column of [
      'user_turn_1_cards_drawn',
      'user_turn_1_lands_played',
      'user_turn_1_creatures_cast',
      'user_turn_1_non_creatures_cast',
      'user_turn_1_creatures_attacked',
      'user_turn_1_creatures_blocked',
      'user_turn_1_creatures_unblocked',
      'user_turn_1_creatures_blocking',
      'user_turn_1_user_instants_sorceries_cast',
      'user_turn_1_oppo_instants_sorceries_cast',
      'user_turn_1_user_abilities',
      'user_turn_1_user_combat_damage_taken',
      'user_turn_1_oppo_creatures_killed_combat',
      'user_turn_1_oppo_creatures_killed_non_combat',
      'user_turn_1_user_mana_spent',
      'user_turn_1_eot_user_cards_in_hand',
      'user_turn_1_eot_oppo_lands_in_play',
      'user_turn_1_eot_user_creatures_in_play',
      'user_turn_1_eot_oppo_non_creatures_in_play',
      'user_turn_1_eot_user_life',
      'oppo_turn_2_eot_oppo_life',
    ]) {
      expect(row, `missing column ${column}`).toHaveProperty(column);
    }
  });

  it('prefixes every column of ours with sim_ so it can never shadow theirs', () => {
    const log = firstLog();
    const known = new Set(expectedReplayColumns(log.turns));
    for (const column of Object.keys(replayRow(log))) {
      if (known.has(column)) continue;
      expect(column.startsWith('sim_')).toBe(true);
    }
  });
});

describe('JSONL export', () => {
  it('round-trips through a versioned file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-sim-log-'));
    const path = join(directory, 'nested', 'replay.jsonl');
    writeReplayJsonl(path, 'log-schema', run.logs);

    const text = readFileSync(path, 'utf8');
    expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(run.logs.length + 1);

    const parsed = parseReplayJsonl(text);
    expect(parsed.header.sim_schema_version).toBe(SIM_LOG_SCHEMA_VERSION);
    expect(parsed.header.sim_games).toBe(run.logs.length);
    expect(parsed.rows).toHaveLength(run.logs.length);
    expect(parsed.rows[0]).toEqual(replayRow(firstLog()));
  });

  it('refuses a file written under a different schema version', () => {
    const text = `${JSON.stringify({ sim_record: 'header', sim_schema_version: 'mtg-sim/replay-superset/0', sim_run_seed: 'x', sim_games: 0 })}\n`;
    expect(() => parseReplayJsonl(text)).toThrowError(/does not match/);
  });

  it('refuses a file with no header record', () => {
    expect(() => parseReplayJsonl('{"won":1}\n')).toThrowError(/header record/);
    expect(() => parseReplayJsonl('')).toThrowError(/empty/);
  });
});
