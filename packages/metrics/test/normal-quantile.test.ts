import { expect, it } from 'vitest';
import { normalQuantile } from '../src/normal-quantile';
import { NORMAL_80_POWER, NORMAL_95_TWO_SIDED } from '../src/paired-promotion';

it.each([
  [0.5, 0],
  [0.975, 1.959_963_984_540_054],
  [0.8, 0.841_621_233_572_914_3],
  [0.995, 2.575_829_303_548_901],
  [0.999_75, 3.480_756_404_453_508],
  [0.01, -2.326_347_874_040_841],
  [1e-6, -4.753_424_308_822_899],
])('inverts the standard normal CDF at %s', (p, z) => {
  expect(normalQuantile(p)).toBeCloseTo(z, 6);
});

it('is antisymmetric about one half', () => {
  expect(normalQuantile(0.3)).toBeCloseTo(-normalQuantile(0.7), 12);
});

it('reproduces the quantiles the power plan was written against', () => {
  expect(normalQuantile(0.975)).toBeCloseTo(NORMAL_95_TWO_SIDED, 8);
  expect(normalQuantile(0.8)).toBeCloseTo(NORMAL_80_POWER, 8);
});

it.each([0, 1, -0.1, 1.5, Number.NaN])('refuses %s', (p) => {
  expect(() => normalQuantile(p)).toThrow(/strictly inside/);
});
