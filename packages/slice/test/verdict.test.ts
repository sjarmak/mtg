import { describe, expect, it } from 'vitest';
import type { FormatHealth, GateResult } from '@mtg/metrics';
import { formatHealth } from '@mtg/metrics';
import type { GateCensus } from '@mtg/slice';
import { censusGates } from '@mtg/slice';

/** A `GateResult` built by hand, for the arithmetic that needs no sweep. */
function gateOf(overrides: Partial<GateResult>): GateResult {
  return {
    id: 'synthetic.gate',
    label: 'synthetic gate',
    status: 'pass',
    observed: 0.5,
    bound: 'n/a',
    band: { min: null, max: null },
    detail: 'synthetic',
    source: 'synthetic',
    ...overrides,
  };
}

/** An empty run still produces a real `FormatHealth`; only `gates` is overridden below. */
function healthWithGates(gates: readonly GateResult[]): FormatHealth {
  return { ...formatHealth([]), gates };
}

describe('censusGates', () => {
  it('a summary built from a health with one notApplicable gate and one withinNoise gate reports neither as a pass', () => {
    const health = healthWithGates([
      gateOf({ id: 'a', status: 'pass' }),
      gateOf({ id: 'b', status: 'fail' }),
      gateOf({ id: 'c', status: 'underSampled', observed: null }),
      gateOf({ id: 'd', status: 'notApplicable', observed: null }),
      gateOf({ id: 'e', status: 'withinNoise' }),
    ]);

    const census: GateCensus = censusGates(health);

    expect(census.passed).toBe(1);
    expect(census.failures.map((gate) => gate.id)).toEqual(['b']);
    expect(census.underSampled.map((gate) => gate.id)).toEqual(['c']);
    expect(census.notApplicable.map((gate) => gate.id)).toEqual(['d']);
    expect(census.withinNoise.map((gate) => gate.id)).toEqual(['e']);
  });

  it('counts every gate exactly once across the five statuses', () => {
    const health = healthWithGates([
      gateOf({ id: 'a', status: 'pass' }),
      gateOf({ id: 'b', status: 'pass' }),
      gateOf({ id: 'c', status: 'fail' }),
      gateOf({ id: 'd', status: 'underSampled', observed: null }),
      gateOf({ id: 'e', status: 'notApplicable', observed: null }),
      gateOf({ id: 'f', status: 'withinNoise' }),
    ]);

    const census = censusGates(health);

    expect(
      census.passed +
        census.failures.length +
        census.underSampled.length +
        census.notApplicable.length +
        census.withinNoise.length,
    ).toBe(health.gates.length);
    expect(census.passed).toBe(2);
  });

  it('reports every gate as a pass when nothing abstained or failed', () => {
    const health = healthWithGates([
      gateOf({ id: 'a', status: 'pass' }),
      gateOf({ id: 'b', status: 'pass' }),
    ]);
    expect(censusGates(health).passed).toBe(2);
  });
});
