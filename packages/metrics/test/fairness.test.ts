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
import type { FakeGameSpec } from './helpers/log';
import { fakeLog, matchup, repeatedGame } from './helpers/log';

/** Hits every land drop through turn 6, so the flood checkpoint fires. */
const FULL_CURVE = [1, 2, 3, 4, 5, 6, 6, 6, 6, 6];
const STEADY = [1, 2, 3, 4, 4, 4, 4, 4, 4, 4];

const TEST_FLOORS: MetricsConfigInput = {
  floors: { gameLength: 20, onPlay: 20, manaCheckpoint: 20, decisiveness: 20, colorPair: 20, matchup: 20 },
};

/**
 * Games per matchup in `evenLogs`, and the number is the load-bearing part.
 *
 * A gate reads green only when it clears its band by more than the seed moves
 * the statistic at this run's volume (`abstainWithinNoise`), so a fixture whose
 * claim is *nothing here fails* has to buy enough games to be allowed to make
 * it. The binding gate is `onPlay.winRate`, and it binds for a reason worth
 * knowing: its band is 48%-60%, because the on-play side really does win more
 * than half, and this fixture alternates the seat perfectly and lands on 50.0%.
 * That is a pass by 0.020 against a deviation of 0.0087 at the pinned 10,035
 * games, and 0.020 does not clear the scaled deviation until about 1,900 games.
 * 800 a matchup is 3,200, which clears that gate by 1.3x and the pair floors by
 * 3x.
 *
 * `lopsidedLogs` proves something cheaper on a fortieth of the games, and the
 * asymmetry is the rule rather than an inconsistency: a miss costs games in
 * inverse proportion to its size, and *no miss anywhere* is the most expensive
 * reading a run can buy.
 */
const GAMES_PER_MATCHUP = 800;

/**
 * What each game varies from the last, so the volume above is real evidence.
 *
 * `matchup` perturbs only the life totals, which cycle on 17, so 3,200 games
 * off four specs would be 272 trajectories dealt twelve times each. The seed
 * scaling divides by the games a run reports rather than by the trajectories it
 * actually flew (`mtg-pixl`), so a fixture built that way would buy its
 * decidability from a hole rather than from evidence. Two idle turns on periods
 * of 11 and 13, coprime to the life cycle and to the play/draw alternation,
 * make 3,152 of these 3,200 games distinct.
 */
const varied = (index: number): { readonly inertTurns: readonly number[] } => ({
  inertTurns: [2 + (index % 11), 3 + (index % 13)],
});

/** Four pairs at 50%, games ending around round 8-9: nothing to fail. */
function evenLogs(): ReturnType<typeof matchup> {
  const half = GAMES_PER_MATCHUP / 2;
  return [
    ...matchup(
      'WU',
      'BR',
      GAMES_PER_MATCHUP,
      half,
      {
        playerTurns: 16,
        userLands: FULL_CURVE,
        oppoLands: FULL_CURVE,
        activationsPerTurn: 1,
        triggersPerTurn: 1,
      },
      varied,
    ),
    ...matchup(
      'GW',
      'UB',
      GAMES_PER_MATCHUP,
      half,
      {
        playerTurns: 18,
        userLands: STEADY,
        oppoLands: STEADY,
        activationsPerTurn: 1,
        triggersPerTurn: 1,
      },
      varied,
    ),
    ...matchup(
      'WB',
      'RG',
      GAMES_PER_MATCHUP,
      half,
      {
        playerTurns: 16,
        userLands: STEADY,
        oppoLands: STEADY,
        activationsPerTurn: 1,
        triggersPerTurn: 1,
      },
      varied,
    ),
    ...matchup(
      'UR',
      'WR',
      GAMES_PER_MATCHUP,
      half,
      { playerTurns: 18, userLands: FULL_CURVE, oppoLands: FULL_CURVE },
      varied,
    ),
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
    expect(seedDeviation('balance.spread')).toBe(0.019);
    expect(seedDeviation('balance.pair.WU')).toBe(0.019);
    expect(seedDeviation('onPlay.winRate')).toBe(0.0087);
    // Not a rate, and that is the point of rounding to figures rather than to a
    // step: `abilities.triggers` guards a band whose floor is 0.0125 on a
    // quarter-triggered pool, so a flat 0.005 would have been 40% of it.
    expect(seedDeviation('abilities.triggers')).toBe(0.0024);
    // A measured zero, which is a claim: 24 seeds moved this gate by nothing.
    expect(seedDeviation('length.median')).toBe(0);
    // A mana checkpoint no config in this repo asks for. The ids are built from
    // a turn and a land count, so this is the shape the `null` branch is for.
    expect(seedDeviation('mana.screw.t3.l2')).toBeNull();
  });

  it('widens the deviation for a sweep smaller than the one it was measured on', () => {
    // A quarter of the games is twice the standard error, which is the whole
    // of the arithmetic. `npm run analyze` defaults to 2,700 against a pinned
    // 10,035, so this is the ordinary case and not a corner of it.
    const quarter = DEVIATION_MEASURED_AT_GAMES / 4;
    expect(scaledSeedDeviation('balance.spread', quarter)).toBeCloseTo(0.038, 10);
    expect(scaledSeedDeviation('balance.pair.WU', quarter)).toBeCloseTo(0.038, 10);
  });

  it('never narrows it below the number anybody measured', () => {
    // A larger sweep is not given a tighter band: the study sampled 24 seeds
    // at one volume, and extrapolating past its own resolution invents
    // precision.
    expect(scaledSeedDeviation('balance.spread', DEVIATION_MEASURED_AT_GAMES)).toBe(0.019);
    expect(scaledSeedDeviation('balance.spread', DEVIATION_MEASURED_AT_GAMES * 100)).toBe(0.019);
  });

  it('has nothing to widen for a statistic nobody measured', () => {
    expect(scaledSeedDeviation('mana.screw.t3.l2', 10)).toBeNull();
  });

  it('widens a measured zero to zero, however thin the sweep', () => {
    // Scaling multiplies, so a gate that does not move on the seed does not
    // start moving when the sweep gets thin. That is the arithmetic and it is
    // also the right answer: `length.median` is an integer over ten thousand
    // games and 24 seeds put every one of them on the same number.
    expect(scaledSeedDeviation('length.median', 10)).toBe(0);
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
    expect(finding?.noise ?? 0).toBeGreaterThanOrEqual(0.019);
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
 * both cases. A spread's seed deviation is 0.019 at the pinned 10,035 games and
 * 0.057 at a ninth of them, because a rate's standard error falls as the square
 * root of the sample, so the same miss is a verdict at one volume and inside
 * the dice at the other. Buying games is what makes a band enforceable, and
 * this is the arithmetic that says so.
 *
 * `mtg-ijl6` widened the same comparison to green rows. The distance a gate is
 * from its band is the statistic under examination whichever side of the band
 * it fell, so a bound cleared by less than the dice is exactly as undecided as
 * one missed by that much, and the tests below pin both sides.
 */
describe('a result the run cannot tell from its own dice', () => {
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
    expect(read?.detail).toContain('inside the 0.057');
    expect(read?.observed).toBe(missing.observed);
  });

  it('gives an exact tie to the band rather than to the sample', () => {
    // 0.019 against a deviation of 0.019, at the volume it was measured at.
    const tied = gateOf({ observed: 0.019, band: { min: null, max: 0 } });
    expect(abstainWithinNoise([tied], DEVIATION_MEASURED_AT_GAMES)[0]?.status).toBe('fail');
  });

  it('never abstains for a statistic nobody measured a deviation for', () => {
    // `null` means "nobody has measured it", not "zero noise". A gate with no
    // measured deviation fails the way it failed before this existed, at any
    // volume, which is what stops the abstention from spreading by default.
    expect(seedDeviation('mana.screw.t3.l2')).toBeNull();
    const unmeasured = gateOf({ id: 'mana.screw.t3.l2', observed: 0.4, band: { min: null, max: 0.3 } });
    expect(abstainWithinNoise([unmeasured], 10)[0]?.status).toBe('fail');
  });

  it('never abstains for a statistic measured at zero either', () => {
    // Same verdict, different reason, and no branch of its own: a miss is never
    // smaller than zero, so the strict comparison settles it. Worth pinning
    // because a `0` reaching a truthiness check somewhere would read as absent
    // and the two are not the same claim.
    expect(seedDeviation('length.median')).toBe(0);
    const median = gateOf({ id: 'length.median', observed: 13.1, band: { min: 6, max: 13 } });
    expect(abstainWithinNoise([median], 10)[0]?.status).toBe('fail');
  });

  it('leaves a status with nothing to measure exactly as it found it', () => {
    // No observation, or no edge to be near: there is no distance for the dice
    // to swallow, so neither of these is a reading the noise could take back.
    const others: readonly GateResult[] = [
      gateOf({ status: 'underSampled', observed: null }),
      gateOf({ status: 'notApplicable', observed: null, band: { min: null, max: null } }),
    ];
    expect(abstainWithinNoise(others, THIN_GAMES)).toEqual(others);
  });

  it('abstains on a pass that cleared its band by less than the dice', () => {
    // 0.296 against a 0.300 limit is a pass by 0.004, and at a ninth of the
    // pinned volume a spread moves 0.057 on the seed alone. Read as green, that
    // row banks a band the run never cleared, which is `mtg-ijl6`.
    const read = abstainWithinNoise([gateOf({ status: 'pass', observed: 0.296 })], THIN_GAMES)[0];
    expect(read?.status).toBe('withinNoise');
    expect(read?.detail).toContain('cleared by 0.004');
    expect(read?.detail).toContain('inside the 0.057');
  });

  it('leaves a pass that cleared its band by more than the dice', () => {
    // The other side of the same comparison, and the reason the change is not
    // just "abstain more": 0.100 of headroom against 0.057 is a real pass.
    const clear = gateOf({ status: 'pass', observed: 0.2 });
    expect(abstainWithinNoise([clear], THIN_GAMES)).toEqual([clear]);
  });
});

/**
 * A pair at 39%, and 400 games is nowhere near enough to say so.
 *
 * WU plays two matchups and wins 39% of both, one point under the 40% floor.
 * A pair win rate moves 0.095 on the seed alone over 400 games, so the run
 * cannot tell that point from the dice that produced it. Nothing here fails:
 * the one gate under examination is the only one that misses a band at all.
 *
 * Three green rows abstain beside it, which is `mtg-ijl6` and is the same fact
 * read from the other side. UB is the mirror of WU at 61% and clears the 70%
 * ceiling by 0.090; the spread is 0.220 against a 0.300 limit, clearing by
 * 0.080; both are inside the same 0.095. `onPlay.winRate` sits at 51.0%,
 * clearing its 48% floor by 0.030 against a deviation of 0.044. At this volume
 * the run cannot say UB is inside its band any more than it can say WU is
 * outside its own.
 *
 * BR and GW sit at 50% and clear the 40% floor by 0.100, which is the other
 * edge of the same comparison and the reason this is a rule and not a mood:
 * five thousandths more headroom than the dice, and the row is a pass. Four
 * abstentions out of a run that looked like it had one is what 400 games buys.
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
    expect(wu?.detail).toContain('missed by 0.010');
    expect(health.gates.filter((gate) => gate.status === 'fail')).toEqual([]);
    // Its mirror, which never failed anything and is just as undecided.
    const ub = health.gates.find((gate) => gate.id === 'balance.pair.UB');
    expect(ub?.status).toBe('withinNoise');
    expect(ub?.detail).toContain('cleared by 0.090');
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
    expect(text).toContain('4 inside the seed noise');
  });
});

/**
 * Two thousand games and two hundred and seventy-two of them, which is
 * `mtg-pixl`.
 *
 * A sweep whose seeds collide flies the same trajectory again and again, and
 * that is the sample illusion `../src/sample.ts` names in its second rule and
 * sources: a repeated trajectory is one piece of evidence counted twice. The
 * under-sampling floor has always been checked against the distinct count for
 * exactly that reason. The seed-noise scaling read the total until 2026-08-27,
 * so the two rules disagreed about what a game was.
 *
 * WU misses the 40% floor by 0.070 here. A pair moves 0.043 on the seed alone
 * over 2,000 games and 0.115 over 272, so the miss is a verdict under the total
 * and undecidable under the distinct count, and which number the seam reads is
 * the difference between this run failing a set and admitting it cannot say.
 * The set is the same either way; only the evidence differs.
 */
describe('a run whose games repeated each other', () => {
  /** Distinct life lines per matchup, before the seat and the winner split them. */
  const LINES_PER_MATCHUP = 34;

  /**
   * Measured, not derived: 68 per matchup is what the construction predicts
   * (34 lines x 2 winners, the seat being pinned to the line's parity) and 272
   * is what the four matchups actually fingerprint to. Written down rather than
   * computed from the health object, because a test that asserts a number
   * against itself asserts nothing.
   */
  const DISTINCT_TRAJECTORIES = 272;

  /**
   * A matchup that repeats itself: `count` games flown over `lines` life lines.
   *
   * Built rather than inherited. `matchup` deals a distinct trajectory per game
   * by construction, so a fixture about repetition has to arrange the repetition
   * itself, and the one line that does it is the wrapping `variant` — game `n`
   * and game `n + lines` fly the same life line and fingerprint as one game.
   */
  function repeating(
    userColors: string,
    oppoColors: string,
    count: number,
    winsForUser: number,
    lines: number,
    spec: Omit<FakeGameSpec, 'userColors' | 'oppoColors' | 'winner' | 'onPlay' | 'index' | 'variant'>,
  ): readonly ReturnType<typeof fakeLog>[] {
    return Array.from({ length: count }, (_unused, index) =>
      fakeLog({
        ...spec,
        index,
        userColors,
        oppoColors,
        winner: index < winsForUser ? 0 : 1,
        onPlay: index % 2 === 0 ? 0 : 1,
        variant: index % lines,
      }),
    );
  }

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

  /** 33.0% for WU over its two matchups, every matchup repeating itself. */
  function repetitiveLogs(): ReturnType<typeof matchup> {
    return [
      ...repeating('WU', 'BR', 500, 165, LINES_PER_MATCHUP, fast),
      ...repeating('WU', 'GW', 500, 165, LINES_PER_MATCHUP, slow),
      ...repeating('BR', 'UB', 500, 165, LINES_PER_MATCHUP, slow),
      ...repeating('GW', 'UB', 500, 165, LINES_PER_MATCHUP, fast),
    ];
  }

  const health = healthOf(repetitiveLogs(), 'two thousand games, two hundred trajectories');

  it('counts the trajectories it flew, not the games it dealt', () => {
    expect(health.games).toBe(2000);
    expect(health.distinctGames).toBe(DISTINCT_TRAJECTORIES);
    expect(health.duplicateShare).toBeCloseTo(1 - DISTINCT_TRAJECTORIES / 2000, 10);
  });

  it('is the arithmetic that makes the two counts different answers', () => {
    // Stated rather than implied: the miss sits between the two deviations, so
    // this fixture cannot come out the same way under both readings.
    const missedBy = 0.07;
    expect(scaledSeedDeviation('balance.pair.WU', health.games) ?? 0).toBeLessThan(missedBy);
    expect(scaledSeedDeviation('balance.pair.WU', health.distinctGames) ?? 0).toBeGreaterThan(missedBy);
  });

  it('abstains, because 272 trajectories cannot decide a 0.070 miss', () => {
    const wu = health.gates.find((gate) => gate.id === 'balance.pair.WU');
    expect(wu?.status).toBe('withinNoise');
    expect(wu?.observed).toBeCloseTo(0.33, 10);
    expect(wu?.detail).toContain('missed by 0.070');
    // The row names the number it judged against, so a reader can tell which
    // of the two counts bought the verdict without re-deriving it.
    expect(wu?.detail).toContain(`over ${String(DISTINCT_TRAJECTORIES)} distinct games`);
    expect(health.gates.filter((gate) => gate.status === 'fail')).toEqual([]);
  });

  it('carries the same number into the finding, so the report holds one answer', () => {
    const balance = fairness(health).readings.find((reading) => reading.question === 'balance');
    expect(balance?.findings).toEqual([]);
    expect(balance?.unjudged.map((entry) => entry.gate)).toContain('balance.pair.WU');
    expect(balance?.verdict).toBe('unjudged');
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
