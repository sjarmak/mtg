import { expect, it } from 'vitest';
import { allocateMana, colorPips, drawAtLeast } from '../src/limited-evaluation/mana';

it('matches exhaustive two-card draws from a four-card deck', () => {
  // Of the six equally likely pairs, five contain a source and one contains both sources.
  expect(drawAtLeast(4, 2, 2, 1)).toBeCloseTo(5 / 6, 12);
  expect(drawAtLeast(4, 2, 2, 2)).toBeCloseTo(1 / 6, 12);
  expect(drawAtLeast(4, 2, 2, 3)).toBe(0);
  expect(drawAtLeast(0, 0, 0, 0)).toBe(1);
  expect(drawAtLeast(40, 17, 1, 1)).toBeCloseTo(17 / 40, 12);
  expect(drawAtLeast(40, 17, 1, 1)).toBeCloseTo(17 / 40, 12);
});

it('rejects impossible probability inputs and malformed mana syntax', () => {
  for (const args of [
    [41, 17, 7, 1],
    [40, 41, 7, 1],
    [40, 17, 41, 1],
    [40, 17, 7, -1],
    [40, 17.5, 7, 1],
  ])
    expect(() => drawAtLeast(...(args as [number, number, number, number]))).toThrow(/inputs/);
  expect(() => allocateMana([], [], -1)).toThrow(/target/);
  expect(() => colorPips('{W}junk')).toThrow(/cost/);
  expect(colorPips(null)).toEqual({});
  expect(colorPips('')).toEqual({});
  expect(colorPips('{X}{2}{G}')).toEqual({ G: 1 });
});
