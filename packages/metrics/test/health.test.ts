import { describe, expect, it } from 'vitest';
import type { GateResult, MetricsConfigInput } from '@mtg/metrics';
import { formatGates, formatHealth, healthFailures, healthUnderSampled, metricsConfig } from '@mtg/metrics';
import { fakeLog, matchup, repeatedGame } from './helpers/log';

/** Hits every land drop through turn 6: the flood checkpoint fires. */
const FULL_CURVE = [1, 2, 3, 4, 5, 6, 6, 6, 6, 6];
/** Stalls at four lands: never screwed at the turn-4 or turn-6 threshold, never flooded. */
const STEADY = [1, 2, 3, 4, 4, 4, 4, 4, 4, 4];

const TEST_FLOORS: MetricsConfigInput = {
  floors: { gameLength: 20, onPlay: 20, manaCheckpoint: 20, decisiveness: 20, colorPair: 20, matchup: 20 },
};

/**
 * A format that should pass every gate: four pairs at 50%, games ending around
 * round 8-9, and half the side-games hitting every land drop through turn 6
 * (the flood prior there is ~44.6%).
 */
function healthyLogs(): ReturnType<typeof fakeLog>[] {
  return [
    ...matchup('WU', 'BR', 40, 20, { playerTurns: 16, userLands: FULL_CURVE, oppoLands: FULL_CURVE }),
    ...matchup('GW', 'UB', 40, 20, { playerTurns: 18, userLands: STEADY, oppoLands: STEADY }),
    ...matchup('WB', 'RG', 40, 20, { playerTurns: 16, userLands: STEADY, oppoLands: STEADY }),
    ...matchup('UR', 'WR', 40, 20, { playerTurns: 18, userLands: FULL_CURVE, oppoLands: FULL_CURVE }),
  ];
}

function gate(gates: readonly GateResult[], id: string): GateResult | undefined {
  return gates.find((entry) => entry.id === id);
}

describe('formatHealth on a healthy format', () => {
  const health = formatHealth(healthyLogs(), {
    label: 'synthetic healthy',
    config: metricsConfig(TEST_FLOORS),
  });

  it('passes every gate', () => {
    expect(formatGates(healthFailures(health))).toBe('(none)');
    expect(healthUnderSampled(health)).toEqual([]);
  });

  it('counts distinct trajectories, and finds no duplicates in a varied fixture', () => {
    expect(health.games).toBe(160);
    expect(health.distinctGames).toBe(160);
    expect(health.duplicateShare).toBe(0);
  });

  it('lands the median inside the human limited window', () => {
    const median = health.gameLength.value?.rounds.median;
    expect(median).toBeGreaterThanOrEqual(8);
    expect(median).toBeLessThanOrEqual(9);
  });

  it('reports the mana checkpoints against their priors', () => {
    const flood = health.mana.find((result) => result.checkpoint.kind === 'flood');
    expect(flood?.observed.value).toBeCloseTo(0.5, 2);
    expect(flood?.prior).toBeCloseTo(0.446, 2);
    const screw = health.mana.find((result) => result.checkpoint.ordinal === 4);
    expect(screw?.observed.value).toBe(0);
    expect(screw?.prior).toBeCloseTo(0.077, 3);
  });

  it('omits the matchup matrix unless asked', () => {
    expect(health.matchups).toEqual([]);
    const withMatrix = formatHealth(healthyLogs(), {
      config: metricsConfig(TEST_FLOORS),
      includeMatchups: true,
    });
    expect(withMatrix.matchups.length).toBe(8);
  });
});

describe('formatHealth gate failures', () => {
  it('fails the win-rate band on a lopsided pair and names the numbers', () => {
    // 400 games, not the 80 this used to run on. WU at 85% misses the 70%
    // ceiling by 0.150, and a pair win rate moves 0.224 on the seed alone over
    // 80 games against 0.100 over 400 (`src/seed-noise.ts`), so the smaller
    // sweep could not tell this failure from its own dice and `formatHealth`
    // now says so rather than failing it. The volume is what makes the band
    // enforceable; the shape of the fixture is unchanged.
    const health = formatHealth(
      [
        ...matchup('WU', 'BR', 200, 170, { playerTurns: 16, userLands: STEADY, oppoLands: STEADY }),
        ...matchup('GW', 'UB', 200, 100, { playerTurns: 16, userLands: STEADY, oppoLands: STEADY }),
      ],
      { config: metricsConfig(TEST_FLOORS) },
    );
    const failing = healthFailures(health).map((entry) => entry.id);
    expect(failing).toContain('balance.pair.WU');
    expect(failing).toContain('balance.pair.BR');
    expect(gate(health.gates, 'balance.pair.WU')?.detail).toContain('85.0%');
  });

  it('fails the stall gate when games hit the turn cap', () => {
    const logs = Array.from({ length: 60 }, (_unused, index) =>
      fakeLog({
        index,
        playerTurns: index < 20 ? 40 : 16,
        winner: index < 20 ? null : index % 2 === 0 ? 0 : 1,
        endReason: index < 20 ? 'turnLimit' : 'lifeZero',
        variant: index,
      }),
    );
    const health = formatHealth(logs, { config: metricsConfig(TEST_FLOORS) });
    expect(gate(health.gates, 'decisiveness.stall')?.status).toBe('fail');
    expect(gate(health.gates, 'decisiveness.stall')?.observed).toBeCloseTo(1 / 3, 5);
  });

  it('fails the length gate when the format never ends', () => {
    const logs = Array.from({ length: 60 }, (_unused, index) =>
      fakeLog({ index, playerTurns: 38, winner: index % 2 === 0 ? 0 : 1, variant: index }),
    );
    const health = formatHealth(logs, { config: metricsConfig(TEST_FLOORS) });
    expect(gate(health.gates, 'length.median')?.status).toBe('fail');
    expect(gate(health.gates, 'length.longTail')?.status).toBe('fail');
  });

  it('fails a mana checkpoint when screw runs far above the Karsten prior', () => {
    const screwed = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const health = formatHealth(
      matchup('WU', 'BR', 60, 30, { playerTurns: 20, userLands: screwed, oppoLands: screwed }),
      {
        config: metricsConfig(TEST_FLOORS),
      },
    );
    const screwGate = gate(health.gates, 'mana.screw.t4.l3');
    expect(screwGate?.status).toBe('fail');
    expect(screwGate?.detail).toContain('observed 100.0%');
  });
});

describe('formatHealth under-sampling', () => {
  it('reports under-sampled rather than pass when nothing distinct was played', () => {
    const health = formatHealth(repeatedGame(500, { playerTurns: 16 }));
    const statuses = new Set(health.gates.map((entry) => entry.status));
    expect(statuses.has('pass')).toBe(false);
    expect(statuses.has('fail')).toBe(false);
    expect(healthUnderSampled(health).length).toBe(health.gates.length);
    expect(health.games).toBe(500);
    expect(health.distinctGames).toBe(1);
    expect(health.duplicateShare).toBeCloseTo(0.998, 3);
  });

  it('handles an empty run without throwing', () => {
    const health = formatHealth([]);
    expect(health.games).toBe(0);
    expect(healthFailures(health)).toEqual([]);
    expect(health.gates.length).toBeGreaterThan(0);
  });

  it('formats gates one per line for a failure message', () => {
    const health = formatHealth(repeatedGame(10, { playerTurns: 16 }));
    const text = formatGates(health.gates);
    expect(text.split('\n').length).toBe(health.gates.length);
    expect(text).toContain('UNDER-SAMPLED');
  });
});
