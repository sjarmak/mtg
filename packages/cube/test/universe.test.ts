/**
 * The projection from a cube's restrictions onto the deck lab's pool query.
 *
 * There is no cube-specific SQL to test — `selectCubePool` delegates to
 * `@mtg/decklab`'s `selectUniverse`, which has its own tests against the real
 * schema — so what is checked here is the projection, which is where a cube can
 * silently ask the wrong question. The one live check runs against
 * `data/store/mtg.sqlite` and skips when it is absent, which it is in CI.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DB_PATH, openStore } from '@mtg/data';
import { CubeCriteriaSchema } from '../src/criteria';
import { selectCubePool, toPoolQuery } from '../src/universe';

const base = { prompt: 'a cube', format: 'modern' } as const;

describe('the pool query a cube asks', () => {
  it('spans the whole pie and puts no ceiling on mana value', () => {
    const query = toPoolQuery(CubeCriteriaSchema.parse(base));
    // Empty colors means unconstrained, which is what a cube is; a curve is a
    // distribution the finished list is measured against, not an entry filter.
    expect(query.colors).toStrictEqual([]);
    expect(query.maxManaValue).toBeUndefined();
    expect(query.format).toBe('modern');
  });

  it('carries the singleton flag through as the copy limit', () => {
    expect(toPoolQuery(CubeCriteriaSchema.parse(base)).maxCopies).toBe(1);
    expect(toPoolQuery(CubeCriteriaSchema.parse({ ...base, singleton: false })).maxCopies).toBe(4);
  });

  it('states no budget at all when no ceiling was stated', () => {
    // A budget object with no ceiling would add `selectUniverse`'s "priced
    // cards only" guard, dropping every card the store has no USD price for
    // from a cube whose designer never mentioned money.
    expect(toPoolQuery(CubeCriteriaSchema.parse(base)).budget).toBeUndefined();
  });

  it('passes a stated ceiling straight through', () => {
    const query = toPoolQuery(CubeCriteriaSchema.parse({ ...base, maxCardUsd: 5 }));
    expect(query.budget).toStrictEqual({ maxCardUsd: 5, allowUnpriced: false });
  });
});

/**
 * The one test that opens `data/store/mtg.sqlite` reads a pool out of 38,623
 * oracle cards, which makes it the only test in the suite doing real query work
 * and by far the slowest thing in this package — the four above it are too fast
 * to measure.
 *
 * Measured on a quiet 16-core box: 897ms. Under 24 competing CPU hogs, which is
 * roughly what several agent worktrees running suites at once produce: 4546ms,
 * against vitest's 5s default — the narrowest margin left anywhere in the suite
 * once the tests named in mtg-bc2.107 were budgeted. Under 48 it runs 6684ms
 * and fails. It is budgeted here, at the cost, rather than by raising the
 * default for every test that should still fail fast when it hangs.
 */
const STORE_BUDGET_MS = 30_000;

describe.skipIf(!existsSync(DEFAULT_DB_PATH))(
  'against the real card store',
  { timeout: STORE_BUDGET_MS },
  () => {
    it('returns a pool the whole store is bigger than, with the filters it applied', ({ task }) => {
      // Reads back the budget the runner applied: drop the describe option above
      // and this is 5000, so the docblock cannot outlive what it describes.
      expect(task.timeout, 'a query over the whole store needs its own budget under load').toBe(
        STORE_BUDGET_MS,
      );

      const store = openStore(DEFAULT_DB_PATH, { readonly: true });
      try {
        const pool = selectCubePool(store, CubeCriteriaSchema.parse({ ...base, maxCardUsd: 1 }));

        expect(pool.universe.cards.length).toBeGreaterThan(1000);
        expect(pool.universe.filters).toContain('legal in modern');
        expect(pool.universe.filters).toContain('no card over $1');
        expect(pool.knownNames.size).toBeGreaterThan(pool.universe.cards.length);
        // Basics are held out of the pool: a cube's basics come from the box.
        expect(pool.universe.byName.has('mountain')).toBe(false);
        for (const card of pool.universe.cards.slice(0, 200)) {
          expect(card.priceUsd, `${card.name} has no price`).not.toBeNull();
          expect(card.priceUsd ?? 0).toBeLessThanOrEqual(1);
        }
      } finally {
        store.db.close();
      }
    });
  },
);
