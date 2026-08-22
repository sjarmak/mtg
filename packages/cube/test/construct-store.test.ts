/**
 * `constructCube` — the entry point that starts at a store rather than a pool.
 *
 * Everything else in this package is tested over a hand-written pool, which
 * leaves exactly one thing unguarded: the two lines that turn a store into that
 * pool. They are short enough to look obviously right and are the only place a
 * cube can be built against criteria nobody asked for — a caller's criteria
 * dropped here would still produce a plausible cube, just not the one that was
 * requested. So the store here is real SQLite holding real rows, and what is
 * checked is that the pool came out of it and that the criteria that reached
 * the model are the ones that went in.
 */
import { describe, expect, it } from 'vitest';
import { closeStore } from '@mtg/data';
import { fixtureStore, type StoreCardSpec } from './support/fixture-store';
import { scriptedProvider } from './support/scripted-provider';
import { constructCube, EmptyCubePoolError } from '../src/construct';
import type { CubeCriteriaInput } from '../src/criteria';
import type { CubeProposal } from '../src/propose';

/** Forty-five legal cards, nine in each color, all a dollar. */
const LEGAL: readonly StoreCardSpec[] = ['W', 'U', 'B', 'R', 'G'].flatMap((color) =>
  Array.from({ length: 9 }, (_unused, index) => ({
    name: `${color} Store Card ${String(index + 1)}`,
    manaCost: `{${color}}`,
    manaValue: 1,
    colorIdentity: color,
  })),
);

/** A real card the format bans, and a basic: both in the store, neither in the pool. */
const BANNED: StoreCardSpec = {
  name: 'Banished Beast',
  manaCost: '{4}{B}',
  manaValue: 5,
  colorIdentity: 'B',
  legal: false,
};

const BASIC: StoreCardSpec = {
  name: 'Mountain',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Mountain',
  colorIdentity: 'R',
};

const CARDS: readonly StoreCardSpec[] = [...LEGAL, BANNED, BASIC];

const CRITERIA: CubeCriteriaInput = {
  prompt: 'forty-five cards for three drafters',
  format: 'modern',
  size: 45,
  seats: 3,
  cardsPerSeat: 15,
  archetypes: [{ name: 'five-color pile', colors: ['W', 'U', 'B', 'R', 'G'], minPlayable: 45 }],
};

function answerNaming(names: readonly string[]): CubeProposal {
  return {
    plan: 'a plain five-color cube',
    cards: names.map((name) => ({
      name,
      count: 1,
      archetypes: ['five-color pile'],
      reason: 'it is in the pool',
    })),
  };
}

const EVERY_LEGAL_NAME = LEGAL.map((card) => card.name);

describe('a cube built from a store', () => {
  it('draws its pool from the store and its criteria from the caller', async () => {
    const store = fixtureStore(CARDS);
    const provider = scriptedProvider([answerNaming(EVERY_LEGAL_NAME)]);
    try {
      const cube = await constructCube({ store, provider, criteria: CRITERIA });

      // Forty-five legal cards: the banned one and the basic are in the store
      // and out of the pool, which is what selectCubePool is there to do.
      expect(cube.poolSize).toBe(45);
      expect(cube.criteria.size).toBe(45);
      expect(cube.criteria.seats).toBe(3);
      expect(cube.criteria.prompt).toBe('forty-five cards for three drafters');
      // The ask the model actually saw, which is where substituted criteria
      // would show up first.
      expect(provider.prompts[0]).toContain('forty-five cards for three drafters');
      expect(provider.prompts[0]).toContain('Choose 45 more cards');
      expect(provider.prompts[0]).toContain('The pool holds 45 legal cards');

      expect(cube.stop).toStrictEqual({ kind: 'filled' });
      expect(cube.entries).toHaveLength(45);
      expect(cube.validation.ok).toBe(true);
      // Store rows, not fixtures: the oracle id is the one the ingest wrote.
      for (const entry of cube.entries) expect(entry.card.oracleId).toMatch(/^0a000000-/);
    } finally {
      closeStore(store);
    }
  });

  it('tells a card the store never had from one the cube may not have', async () => {
    const store = fixtureStore(CARDS);
    const provider = scriptedProvider([answerNaming(['Banished Beast', 'Nonesuch Colossus'])]);
    try {
      const cube = await constructCube({ store, provider, criteria: CRITERIA });

      expect(cube.entries).toStrictEqual([]);
      expect(cube.rejections.map((rejection) => rejection.code)).toStrictEqual([
        'not-in-universe',
        'unknown-card',
      ]);
    } finally {
      closeStore(store);
    }
  });

  it('fails before a model call when the store holds nothing the format allows', async () => {
    const store = fixtureStore([BANNED, BASIC]);
    const provider = scriptedProvider([answerNaming(EVERY_LEGAL_NAME)]);
    try {
      await expect(constructCube({ store, provider, criteria: CRITERIA })).rejects.toBeInstanceOf(
        EmptyCubePoolError,
      );
      expect(provider.prompts).toStrictEqual([]);
    } finally {
      closeStore(store);
    }
  });
});
