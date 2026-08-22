import { describe, expect, it } from 'vitest';
import type { Fairness, FormatHealth, GateResult, MetricsConfigInput } from '@mtg/metrics';
import {
  DEVIATION_MEASURED_AT_GAMES,
  FAIRNESS_QUESTIONS,
  NOT_ASKED,
  abstainWithinNoise,
  fairness,
  formatFairness,
  formatHealth,
  findingLine,
  gateMargin,
  metricsConfig,
  questionOf,
  report,
  scaledSeedDeviation,
  seedDeviation,
} from '@mtg/metrics';
import { matchup, repeatedGame } from './helpers/log';

/** Hits every land drop through turn 6, so the flood checkpoint fires. */
const FULL_CURVE = [1, 2, 3, 4, 5, 6, 6, 6, 6, 6];
const STEADY = [1, 2, 3, 4, 4, 4, 4, 4, 4, 4];

const TEST_FLOORS: MetricsConfigInput = {
  floors: { gameLength: 20, onPlay: 20, manaCheckpoint: 20, decisiveness: 20, colorPair: 20, matchup: 20 },
};

/** Four pairs at 50%, games ending around round 8-9: nothing to fail. */
function evenLogs(): ReturnType<typeof matchup> {
  return [
    ...matchup('WU', 'BR', 40, 20, {
      playerTurns: 16,
      userLands: FULL_CURVE,
      oppoLands: FULL_CURVE,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('GW', 'UB', 40, 20, {
      playerTurns: 18,
      userLands: STEADY,
      oppoLands: STEADY,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('WB', 'RG', 40, 20, {
      playerTurns: 16,
      userLands: STEADY,
      oppoLands: STEADY,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('UR', 'WR', 40, 20, { playerTurns: 18, userLands: FULL_CURVE, oppoLands: FULL_CURVE }),
  ];
}

/** The same format with one pair winning almost everything it plays. */
function lopsidedLogs(): ReturnType<typeof matchup> {
  return [
    ...matchup('WU', 'BR', 40, 38, {
      playerTurns: 16,
      userLands: FULL_CURVE,
      oppoLands: FULL_CURVE,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('GW', 'UB', 40, 20, {
      playerTurns: 18,
      userLands: STEADY,
      oppoLands: STEADY,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('WB', 'RG', 40, 20, {
      playerTurns: 16,
      userLands: STEADY,
      oppoLands: STEADY,
      activationsPerTurn: 1,
      triggersPerTurn: 1,
    }),
    ...matchup('UR', 'WR', 40, 20, { playerTurns: 18, userLands: FULL_CURVE, oppoLands: FULL_CURVE }),
  ];
}

/**
 * A pool with abilities on it, so all four questions are asked.
 *
 * `AbilityPool` is three counts, which is the whole of what the usage gates
 * need — the cards themselves never reach them — so a fixture can state one
 * without a set file.
 */
const POOL = { cards: 100, withActivatedAbility: 40, withTriggeredAbility: 40 };

function healthOf(logs: ReturnType<typeof matchup>, label: string): FormatHealth {
  return formatHealth(logs, { label, config: metricsConfig(TEST_FLOORS), pool: POOL });
}

/** A `GateResult` built by hand, for the arithmetic that needs no sweep. */
function gateOf(overrides: Partial<GateResult>): GateResult {
  return {
    id: 'balance.spread',
    label: 'win-rate spread across pairs',
    status: 'fail',
    observed: 0.4,
    bound: '<= 30.0%',
    band: { min: null, max: 0.3 },
    detail: 'synthetic',
    source: 'synthetic',
    ...overrides,
  };
}

describe('gateMargin', () => {
  it('reports a positive distance above an upper edge', () => {
    const margin = gateMargin(gateOf({ observed: 0.42, band: { min: null, max: 0.3 } }));
    expect(margin).toEqual({ observed: 0.42, edge: 0.3, distance: expect.closeTo(0.12, 10) });
  });

  it('reports a positive distance below a lower edge', () => {
    const margin = gateMargin(gateOf({ observed: 0.85, band: { min: 0.9, max: null } }));
    expect(margin).toEqual({ observed: 0.85, edge: 0.9, distance: expect.closeTo(0.05, 10) });
  });

  it('reports headroom as a negative distance, against the nearer edge', () => {
    // 0.55 in a 0.4-0.7 band: 0.15 of room below, 0.15 above — but 0.58 is
    // nearer the top, and the top is the edge that would fail first.
    const margin = gateMargin(gateOf({ observed: 0.58, band: { min: 0.4, max: 0.7 } }));
    expect(margin).toEqual({ observed: 0.58, edge: 0.7, distance: expect.closeTo(-0.12, 10) });
  });

  it('measures a one-sided pass against its only edge', () => {
    const margin = gateMargin(gateOf({ observed: 0.1, band: { min: null, max: 0.3 } }));
    expect(margin).toEqual({ observed: 0.1, edge: 0.3, distance: expect.closeTo(-0.2, 10) });
  });

  it('has nothing to measure without an observation or without an edge', () => {
    expect(gateMargin(gateOf({ observed: null }))).toBeNull();
    expect(gateMargin(gateOf({ band: { min: null, max: null } }))).toBeNull();
  });

  it('signs the distance so that positive is always a miss', () => {
    const missed = gateMargin(gateOf({ observed: 0.31, band: { min: null, max: 0.3 } }));
    const passed = gateMargin(gateOf({ observed: 0.29, band: { min: null, max: 0.3 } }));
    expect(missed?.distance).toBeGreaterThan(0);
    expect(passed?.distance).toBeLessThan(0);
  });
});

describe('every gate carries its bound as numbers', () => {
  const health = healthOf(evenLogs(), 'even');

  it('gives every emitted gate a band', () => {
    for (const gate of health.gates) {
      expect(gate.band, gate.id).toBeDefined();
    }
    expect(health.gates.length).toBeGreaterThan(10);
  });

  it('agrees with the prose bound it was already printing', () => {
    const spread = health.gates.find((gate) => gate.id === 'balance.spread');
    expect(spread?.bound).toBe('<= 30.0%');
    expect(spread?.band).toEqual({ min: null, max: 0.3 });
    const median = health.gates.find((gate) => gate.id === 'length.median');
    expect(median?.bound).toBe('6-13 rounds');
    expect(median?.band).toEqual({ min: 6, max: 13 });
  });

  it('leaves a band on a gate that could not be judged, so a bigger run is priceable', () => {
    const sparse = formatHealth(repeatedGame(4, { playerTurns: 16 }), {
      config: metricsConfig(TEST_FLOORS),
    });
    const median = sparse.gates.find((gate) => gate.id === 'length.median');
    expect(median?.status).toBe('underSampled');
    expect(median?.observed).toBeNull();
    expect(median?.band).toEqual({ min: 6, max: 13 });
  });
});

describe('questionOf', () => {
  it('files every gate family the evaluator emits', () => {
    expect(questionOf('balance.pair.WU')).toBe('balance');
    expect(questionOf('balance.spread')).toBe('balance');
    expect(questionOf('balance.noDominantStrategy')).toBe('balance');
    expect(questionOf('onPlay.winRate')).toBe('luck');
    expect(questionOf('mana.screw.t4.l3')).toBe('luck');
    expect(questionOf('length.median')).toBe('shape');
    expect(questionOf('decisiveness.stall')).toBe('shape');
    expect(questionOf('abilities.usage')).toBe('cards');
  });

  it('refuses to guess at a family it has not been told about', () => {
    expect(questionOf('velocity.median')).toBeNull();
  });
});

describe('fairness over a format nothing fails', () => {
  const result: Fairness = fairness(healthOf(evenLogs(), 'even'));

  it('answers the question', () => {
    expect(result.verdict).toBe('fair');
  });

  it('asks all four questions whether or not they had anything to say', () => {
    expect(result.readings.map((reading) => reading.question)).toEqual([...FAIRNESS_QUESTIONS]);
  });

  it('finds nothing', () => {
    expect(result.findings).toEqual([]);
    expect(result.unattributed).toEqual([]);
  });

  it('accounts for every gate exactly once', () => {
    const health = healthOf(evenLogs(), 'even');
    const read = fairness(health).readings.flatMap((reading) => reading.gates);
    expect([...read].sort()).toEqual([...health.gates.map((gate) => gate.id)].sort());
  });
});

describe('fairness over a format with a dominant pair', () => {
  const result = fairness(healthOf(lopsidedLogs(), 'lopsided'));

  it('answers no', () => {
    expect(result.verdict).toBe('unfair');
  });

  it('blames the balance question and leaves the other three alone', () => {
    const byQuestion = new Map(result.readings.map((reading) => [reading.question, reading.verdict]));
    expect(byQuestion.get('balance')).toBe('unfair');
    expect(byQuestion.get('shape')).toBe('fair');
  });

  it('carries the numbers on both sides of every miss, in the units the gate measures', () => {
    const finding = result.findings.find((entry) => entry.gate === 'balance.spread');
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(finding.question).toBe('balance');
    expect(finding.required).toBe(0.3);
    expect(finding.measured).toBeGreaterThan(0.3);
    expect(finding.distance).toBeCloseTo(finding.measured - finding.required, 10);
  });

  it('sorts the worst miss first', () => {
    const distances = result.findings.map((finding) => finding.distance);
    expect(distances).toEqual([...distances].sort((left, right) => right - left));
  });
});

describe('the dice get a say', () => {
  it('names a deviation only for the statistics somebody measured one for', () => {
    expect(seedDeviation('balance.spread')).toBe(0.02);
    expect(seedDeviation('balance.pair.WU')).toBe(0.02);
    expect(seedDeviation('length.median')).toBeNull();
    expect(seedDeviation('decisiveness.stall')).toBeNull();
  });

  it('widens the deviation for a sweep smaller than the one it was measured on', () => {
    // A quarter of the games is twice the standard error, which is the whole
    // of the arithmetic. `npm run analyze` defaults to 2,700 against a pinned
    // 10,035, so this is the ordinary case and not a corner of it.
    const quarter = DEVIATION_MEASURED_AT_GAMES / 4;
    expect(scaledSeedDeviation('balance.spread', quarter)).toBeCloseTo(0.04, 10);
    expect(scaledSeedDeviation('balance.pair.WU', quarter)).toBeCloseTo(0.04, 10);
  });

  it('never narrows it below the number anybody measured', () => {
    // A larger sweep is not given a tighter band: the study sampled eight
    // seeds, and extrapolating past its own resolution invents precision.
    expect(scaledSeedDeviation('balance.spread', DEVIATION_MEASURED_AT_GAMES)).toBe(0.02);
    expect(scaledSeedDeviation('balance.spread', DEVIATION_MEASURED_AT_GAMES * 100)).toBe(0.02);
  });

  it('has nothing to widen for a statistic nobody measured', () => {
    expect(scaledSeedDeviation('length.median', 10)).toBeNull();
  });

  it('marks a miss smaller than the seed deviation on a list nobody re-read', () => {
    // A hand-assembled gate list, which is the only way a `fail` inside the
    // noise still reaches `fairness`: `formatHealth` runs `abstainWithinNoise`
    // over its own list, so a gate like this one comes back `withinNoise`
    // there. The flag survives for a caller that built its list some other way,
    // because a silent `false` would be worse than a redundant `true`.
    const health = healthOf(evenLogs(), 'even');
    const nudged: FormatHealth = {
      ...health,
      gates: [...health.gates.filter((gate) => gate.id !== 'balance.spread'), gateOf({ observed: 0.31 })],
    };
    const finding = fairness(nudged).findings.find((entry) => entry.gate === 'balance.spread');
    expect(finding?.withinNoise).toBe(true);
    // At least the pinned deviation, and wider here because this health block
    // is built from a handful of games rather than the pinned sweep.
    expect(finding?.noise ?? 0).toBeGreaterThanOrEqual(0.02);
    expect(fairness(nudged).verdict).toBe('unfair');
    expect(finding === undefined ? '' : findingLine(finding)).toContain(
      'another seed could put it either side',
    );
  });

  it('does not mark a miss the dice cannot explain', () => {
    const health = healthOf(evenLogs(), 'even');
    const blown: FormatHealth = {
      ...health,
      gates: [...health.gates.filter((gate) => gate.id !== 'balance.spread'), gateOf({ observed: 0.6 })],
    };
    const finding = fairness(blown).findings.find((entry) => entry.gate === 'balance.spread');
    expect(finding?.withinNoise).toBe(false);
    expect(finding === undefined ? '' : findingLine(finding)).not.toContain('either side');
  });
});

/**
 * `mtg-qt1f`: the deviation used to be printed and not enforced.
 *
 * The boundary is pinned at **two volumes over one unchanged gate**, which is
 * the whole point of the shape: the thing being tested is the scaling, not a
 * threshold somebody typed once. The gate below misses its band by 0.035 in
 * both cases. A spread's seed deviation is 0.020 at the pinned 10,035 games and
 * 0.060 at a ninth of them, because a rate's standard error falls as the square
 * root of the sample, so the same miss is a verdict at one volume and inside
 * the dice at the other. Buying games is what makes a band enforceable, and
 * this is the arithmetic that says so.
 */
describe('a miss the run cannot tell from its own dice', () => {
  const THIN_GAMES = DEVIATION_MEASURED_AT_GAMES / 9;
  const MISSED_BY = 0.035;
  /** A spread of 0.335 against the 0.300 limit, at whatever volume it is read. */
  const missing = gateOf({ observed: 0.3 + MISSED_BY });

  it('fails at the pinned volume, where the miss is bigger than the dice', () => {
    expect(scaledSeedDeviation('balance.spread', DEVIATION_MEASURED_AT_GAMES) ?? 0).toBeLessThan(MISSED_BY);
    const read = abstainWithinNoise([missing], DEVIATION_MEASURED_AT_GAMES)[0];
    expect(read?.status).toBe('fail');
    expect(read?.detail).toBe(missing.detail);
  });

  it('abstains at a ninth of it, where the same miss is inside them', () => {
    expect(scaledSeedDeviation('balance.spread', THIN_GAMES) ?? 0).toBeGreaterThan(MISSED_BY);
    const read = abstainWithinNoise([missing], THIN_GAMES)[0];
    expect(read?.status).toBe('withinNoise');
    // Both numbers on the row, so the abstention argues rather than asserts.
    expect(read?.detail).toContain('missed by 0.035');
    expect(read?.detail).toContain('inside the 0.060');
    expect(read?.observed).toBe(missing.observed);
  });

  it('gives an exact tie to the band rather than to the sample', () => {
    // 0.020 against a deviation of 0.020, at the volume it was measured at.
    const tied = gateOf({ observed: 0.02, band: { min: null, max: 0 } });
    expect(abstainWithinNoise([tied], DEVIATION_MEASURED_AT_GAMES)[0]?.status).toBe('fail');
  });

  it('never abstains for a statistic nobody measured a deviation for', () => {
    // `null` means "nobody has measured it", not "zero noise". A gate with no
    // measured deviation fails the way it failed before this existed, at any
    // volume, which is what stops the abstention from spreading by default.
    expect(seedDeviation('length.median')).toBeNull();
    const median = gateOf({ id: 'length.median', observed: 13.1, band: { min: 6, max: 13 } });
    expect(abstainWithinNoise([median], 10)[0]?.status).toBe('fail');
  });

  it('leaves every status that was not a fail exactly as it found it', () => {
    const others: readonly GateResult[] = [
      gateOf({ status: 'pass', observed: 0.29 }),
      gateOf({ status: 'underSampled', observed: null }),
      gateOf({ status: 'notApplicable', observed: null, band: { min: null, max: null } }),
    ];
    expect(abstainWithinNoise(others, THIN_GAMES)).toEqual(others);
  });
});

/**
 * A pair at 39%, and 400 games is nowhere near enough to say so.
 *
 * WU plays two matchups and wins 39% of both, one point under the 40% floor.
 * At 400 games a pair win rate moves 0.100 on the seed alone, so the run cannot
 * tell that point from the dice that produced it. Every other pair sits inside
 * the band and the spread is 0.22 against a 0.30 limit, so the one gate under
 * examination is the only thing that could have failed.
 */
describe('the abstention lands where the gate list is assembled', () => {
  /** Half the matchups on each land curve, as `evenLogs` does: the mana gates
   * read the whole run, and a run where every game hits six lands by turn six
   * fails the flood checkpoint for reasons that have nothing to do with WU. */
  const fast = {
    playerTurns: 16,
    userLands: FULL_CURVE,
    oppoLands: FULL_CURVE,
    activationsPerTurn: 1,
    triggersPerTurn: 1,
  };
  const slow = {
    playerTurns: 18,
    userLands: STEADY,
    oppoLands: STEADY,
    activationsPerTurn: 1,
    triggersPerTurn: 1,
  };

  function hairsbreadthLogs(): ReturnType<typeof matchup> {
    return [
      ...matchup('WU', 'BR', 100, 39, fast),
      ...matchup('WU', 'GW', 100, 39, slow),
      ...matchup('BR', 'UB', 100, 39, slow),
      ...matchup('GW', 'UB', 100, 39, fast),
    ];
  }

  const health = healthOf(hairsbreadthLogs(), 'a hair under the floor');

  it('re-reads the gate rather than leaving the report to interpret the noise', () => {
    expect(health.games).toBe(400);
    const wu = health.gates.find((gate) => gate.id === 'balance.pair.WU');
    expect(wu?.status).toBe('withinNoise');
    expect(wu?.observed).toBeCloseTo(0.39, 10);
    expect(health.gates.filter((gate) => gate.status === 'fail')).toEqual([]);
  });

  it('is unjudged rather than a finding, so the run is not called fair either', () => {
    const balance = fairness(health).readings.find((reading) => reading.question === 'balance');
    expect(balance?.findings).toEqual([]);
    expect(balance?.unjudged.map((entry) => entry.gate)).toContain('balance.pair.WU');
    expect(balance?.unjudged.find((entry) => entry.gate === 'balance.pair.WU')?.reason).toContain(
      'inside the dice at this volume',
    );
    expect(balance?.verdict).toBe('unjudged');
    expect(fairness(health).verdict).toBe('unjudged');
  });

  it('says so in the report, in a word nobody mistakes for a pass', () => {
    const text = report(health);
    expect(text).toContain('| INSIDE-THE-NOISE |');
    expect(text).toContain('**Not judged:**');
    // The census subtracts it: an abstention counted as a pass is the whole
    // failure this status exists to prevent, one line up.
    expect(text).toContain('1 inside the seed noise');
  });
});

describe('a run that could not judge itself', () => {
  const sparse = formatHealth(repeatedGame(4, { playerTurns: 16 }), {
    config: metricsConfig(TEST_FLOORS),
  });

  it('is not fair, because under-sampled is not a pass one level up either', () => {
    expect(fairness(sparse).verdict).toBe('unjudged');
  });

  it('says which gates it could not judge, and why', () => {
    const shape = fairness(sparse).readings.find((reading) => reading.question === 'shape');
    expect(shape?.verdict).toBe('unjudged');
    expect(shape?.unjudged.map((entry) => entry.gate)).toContain('length.median');
    expect(shape?.unjudged[0]?.reason).toContain('did not buy enough evidence');
  });
});

describe('a question this run never asked', () => {
  // No `pool`, so `evaluateGates` emits no `abilities.*` gate at all. This is
  // the shape the slice's own verdict stage produces, which is the reason it
  // has to be a state rather than an oversight.
  const health = formatHealth(evenLogs(), { label: 'no pool', config: metricsConfig(TEST_FLOORS) });

  it('leaves the cards question with nothing to read', () => {
    const cards = fairness(health).readings.find((reading) => reading.question === 'cards');
    expect(cards?.gates).toEqual([]);
    expect(cards?.verdict).toBe('unjudged');
  });

  it('is not fair, because a question nobody asked is not a question answered yes', () => {
    expect(fairness(health).verdict).toBe('unjudged');
  });

  it('says so rather than printing zero of zero', () => {
    expect(formatFairness(fairness(health))).toContain(NOT_ASKED);
  });
});

describe('a gate no question reads', () => {
  const health = healthOf(evenLogs(), 'even');
  const withStranger: FormatHealth = {
    ...health,
    gates: [...health.gates, gateOf({ id: 'velocity.median', status: 'pass', observed: 1 })],
  };

  it('is named rather than dropped', () => {
    expect(fairness(withStranger).unattributed).toEqual(['velocity.median']);
  });

  it('costs the run its verdict, so a new gate family cannot be answered over', () => {
    expect(fairness(health).verdict).toBe('fair');
    expect(fairness(withStranger).verdict).toBe('unjudged');
  });
});

describe('the answer as prose', () => {
  it('leads with the verdict and prints every question, passing or not', () => {
    const text = formatFairness(fairness(healthOf(lopsidedLogs(), 'lopsided')));
    expect(text).toContain('Is the set fair? NOT FAIR');
    expect(text).toContain('Does any color pair beat the others?');
    expect(text).toContain('Do games end by being played?');
  });

  it('rides at the top of the markdown report, above the gate table', () => {
    const text = report(healthOf(lopsidedLogs(), 'lopsided'));
    expect(text).toContain('## Is the set fair?');
    expect(text.indexOf('## Is the set fair?')).toBeLessThan(text.indexOf('## Gates'));
    expect(text).toContain('**Missed bands, worst first:**');
  });
});
