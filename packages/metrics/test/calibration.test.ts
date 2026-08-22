import { describe, expect, it } from 'vitest';
import type { CorrectionTable } from '@mtg/metrics';
import {
  applyCorrection,
  CALIBRATION_CANDIDATE_SETS,
  correctionFor,
  EMPTY_CORRECTION_TABLE,
  formatJoinContract,
  JOIN_CAVEATS,
  joinContract,
  roundsFromPlayerTurns,
  SEVENTEEN_LANDS_ATTRIBUTION,
  seventeenLandsTurnColumn,
  verifyJoinCompatibility,
} from '@mtg/metrics';
import { REPLAY_GAME_COLUMNS, SIM_LOG_SCHEMA_VERSION, TURN_SIDE_FIELDS } from '@mtg/sim';
import { fakeLog } from './helpers/log';

describe('joinContract', () => {
  const contract = joinContract();

  it('pins the sim log schema version it was written against', () => {
    expect(contract.simSchemaVersion).toBe(SIM_LOG_SCHEMA_VERSION);
  });

  it('names every 17lands game-level column the exporter emits', () => {
    expect(contract.sharedGameColumns).toEqual([...REPLAY_GAME_COLUMNS]);
    expect(contract.sharedGameColumns).toContain('num_turns');
    expect(contract.sharedGameColumns).toContain('main_colors');
  });

  it('keys the join on our own columns, which the human side never has', () => {
    expect(contract.keyColumns.every((column) => column.startsWith('sim_'))).toBe(true);
  });

  it('never lists a column of ours among the shared per-turn fields', () => {
    // The wide layout puts the owner, the turn and the side ahead of the field,
    // so a column of ours carries its `sim_` marker mid-name rather than at the
    // front. `sim_triggers` is emitted per side per turn and 17lands publishes
    // nothing like it; a contract that called it shared would send a reader
    // looking for it in their CSV.
    expect(TURN_SIDE_FIELDS).toContain('sim_triggers');
    expect(contract.sharedTurnSideFields).not.toContain('sim_triggers');
    for (const field of [
      ...contract.sharedTurnSideFields,
      ...contract.sharedTurnOwnerFields,
      ...contract.sharedTurnEotFields,
      ...contract.sharedTotalFields,
    ]) {
      expect(field.startsWith('sim_'), `${field} is ours, not 17lands'`).toBe(false);
    }
  });

  it('carries the attribution the CC BY 4.0 license requires', () => {
    expect(contract.attribution).toBe(SEVENTEEN_LANDS_ATTRIBUTION);
    expect(contract.attribution).toContain('17Lands');
    expect(contract.attribution).toContain('CC BY 4.0');
  });
});

describe('join caveats', () => {
  it('records all five schema mismatches', () => {
    expect(JOIN_CAVEATS.map((caveat) => caveat.id)).toEqual([
      'turn-index-base',
      'num-turns-unit',
      'structurally-zero',
      'mulligans',
      'activated-abilities',
    ]);
  });

  it('no longer calls the mulligan columns structurally zero', () => {
    // CR 103.4 is a decision the kernel asks and the bots answer, so a reader
    // told to exclude these two would be excluding a real measurement — the
    // same failure the abilities column had, one column family over.
    const zeroed = JOIN_CAVEATS.find((caveat) => caveat.id === 'structurally-zero');
    expect(zeroed?.columns).not.toContain('num_mulligans');
    expect(zeroed?.columns).not.toContain('opp_num_mulligans');
    expect(zeroed?.issue).not.toContain('mulligan');
    const mulligans = JOIN_CAVEATS.find((caveat) => caveat.id === 'mulligans');
    expect(mulligans?.columns).toEqual(['num_mulligans', 'opp_num_mulligans']);
    expect(mulligans?.issue).toContain('CR 103.4');
    // The -14.4 figure survives, because the offset it names has not gone away;
    // what changed is that it is now a difference of rates rather than a
    // comparison against zero.
    expect(mulligans?.issue).toContain('-14.4');
  });

  it('no longer calls the abilities column structurally zero', () => {
    // The sentence this asserts against was shipped and was false: the bots pay
    // for activated abilities every game, and a reader told to exclude the
    // column would be excluding a real measurement.
    const zeroed = JOIN_CAVEATS.find((caveat) => caveat.id === 'structurally-zero');
    expect(zeroed?.columns).not.toContain('{owner}_turn_{N}_{side}_abilities');
    expect(zeroed?.issue).not.toContain('activated abilities');
    const abilities = JOIN_CAVEATS.find((caveat) => caveat.id === 'activated-abilities');
    expect(abilities?.columns).toEqual(['{owner}_turn_{N}_{side}_abilities']);
    expect(abilities?.issue).toContain('CR 605.1');
  });

  it('gives every caveat a transform, not just a complaint', () => {
    for (const caveat of JOIN_CAVEATS) {
      expect(caveat.transform.length).toBeGreaterThan(20);
      expect(caveat.columns.length).toBeGreaterThan(0);
    }
  });

  it('states the turn-unit conversion the length metrics actually apply', () => {
    // The caveat is only true if roundsFromPlayerTurns is the conversion.
    expect(roundsFromPlayerTurns(18)).toBe(9);
  });
});

describe('verifyJoinCompatibility', () => {
  it('accepts a real exported row without needing the 17lands dataset', () => {
    const result = verifyJoinCompatibility(fakeLog({ playerTurns: 12 }));
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.columns).toBeGreaterThan(REPLAY_GAME_COLUMNS.length);
  });

  it('lists our own columns separately from the shared ones', () => {
    const result = verifyJoinCompatibility(fakeLog({ playerTurns: 12 }));
    expect(result.simOnly).toContain('sim_run_seed');
    expect(result.simOnly).toContain('sim_end_reason');
    // A per-turn column of ours carries the marker on the field rather than at
    // the front, and it is no less ours for that: a reader handed this list is
    // being told which columns the human side will not have.
    expect(result.simOnly).toContain('user_turn_1_user_sim_triggers');
    expect(result.simOnly.every((column) => column.includes('sim_'))).toBe(true);
  });

  it('scales its expectation with the game length rather than a fixed column list', () => {
    const short = verifyJoinCompatibility(fakeLog({ playerTurns: 4 }));
    const long = verifyJoinCompatibility(fakeLog({ playerTurns: 20 }));
    expect(long.columns).toBeGreaterThan(short.columns);
    expect(long.ok).toBe(true);
  });
});

describe('seventeenLandsTurnColumn', () => {
  it('builds their per-owner turn coordinate, not our global one', () => {
    expect(seventeenLandsTurnColumn('user', 3, 'lands_played')).toBe('user_turn_3_lands_played');
    expect(seventeenLandsTurnColumn('oppo', 3, 'eot_user_life')).toBe('oppo_turn_3_eot_user_life');
  });
});

describe('correction table', () => {
  it('ships empty, because no calibration run has happened', () => {
    expect(EMPTY_CORRECTION_TABLE.entries).toEqual([]);
    expect(EMPTY_CORRECTION_TABLE.measuredAt).toBeNull();
    expect(EMPTY_CORRECTION_TABLE.version).toBe('uncalibrated');
  });

  it('leaves a value untouched when the metric is not calibrated', () => {
    expect(applyCorrection(EMPTY_CORRECTION_TABLE, 'gameLength.medianRounds', 9)).toBe(9);
    expect(correctionFor(EMPTY_CORRECTION_TABLE, 'anything')).toBeUndefined();
  });

  it('applies additive and multiplicative offsets once a table exists', () => {
    const table: CorrectionTable = {
      version: 'pilot',
      measuredAt: '2026-01-01',
      entries: [
        {
          metric: 'colorPair.winRateSpread',
          kind: 'additive',
          offset: -0.08,
          tolerance: 0.05,
          measuredUnder: 'kernel@v0+greedy@v0',
          sets: ['DSK', 'ECL'],
        },
        {
          metric: 'interaction.creaturesKilledPerGame',
          kind: 'multiplicative',
          offset: 0.8,
          tolerance: 0.2,
          measuredUnder: 'kernel@v0+greedy@v0',
          sets: ['DSK'],
        },
      ],
    };
    expect(applyCorrection(table, 'colorPair.winRateSpread', 0.3)).toBeCloseTo(0.22, 10);
    expect(applyCorrection(table, 'interaction.creaturesKilledPerGame', 5)).toBeCloseTo(4, 10);
  });
});

describe('formatJoinContract', () => {
  const markdown = formatJoinContract();

  it('documents the source, the keys, the shared columns and the caveats', () => {
    expect(markdown).toContain('# 17lands join contract');
    expect(markdown).toContain('17lands-public.s3.amazonaws.com');
    expect(markdown).toContain('## Keys');
    expect(markdown).toContain('## Shared columns');
    expect(markdown).toContain('## Caveats');
    for (const caveat of JOIN_CAVEATS) expect(markdown).toContain(`### ${caveat.id}`);
  });

  it('names the calibration sets verified to carry all three data types', () => {
    for (const set of CALIBRATION_CANDIDATE_SETS) expect(markdown).toContain(set);
  });
});
