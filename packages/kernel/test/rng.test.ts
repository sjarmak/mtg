import { describe, expect, it } from 'vitest';
import { createRng, nextBelow, nextUint32, shuffle } from '@mtg/kernel';

function draw(seed: string, count: number): number[] {
  let rng = createRng(seed);
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const [value, advanced] = nextUint32(rng);
    rng = advanced;
    values.push(value);
  }
  return values;
}

describe('seeded rng', () => {
  it('produces the same stream for the same seed', () => {
    expect(draw('alpha', 32)).toEqual(draw('alpha', 32));
  });

  it('produces different streams for different seeds', () => {
    expect(draw('alpha', 32)).not.toEqual(draw('beta', 32));
  });

  it('is purely functional: drawing does not disturb the source state', () => {
    const rng = createRng('pure');
    const first = nextUint32(rng)[0];
    const second = nextUint32(rng)[0];
    expect(first).toBe(second);
  });

  it('stays inside the requested bound and covers it', () => {
    let rng = createRng('bounded');
    const seen = new Set<number>();
    for (let index = 0; index < 2000; index += 1) {
      const [value, advanced] = nextBelow(rng, 6);
      rng = advanced;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('rejects a non-positive bound instead of returning nonsense', () => {
    expect(() => nextBelow(createRng('x'), 0)).toThrow(/positive integer/);
  });

  it('shuffles deterministically and preserves the multiset', () => {
    const items = Array.from({ length: 40 }, (_, index) => index);
    const [a] = shuffle(items, createRng('shuffle'));
    const [b] = shuffle(items, createRng('shuffle'));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(items[0]).toBe(0);
  });
});
