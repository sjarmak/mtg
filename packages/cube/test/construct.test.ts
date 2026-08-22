/**
 * The loop, over a scripted model and a hand-written pool.
 *
 * Four outcomes matter and each is a different thing to tell a designer: the
 * cube filled, the rounds ran out with it short, the money ran out with it
 * short, or the model stopped producing anything the gate would take. A build
 * that comes back short has to name which one it was, because "the model ran
 * out of ideas", "you gave it two rounds" and "you gave it two dollars" send a
 * reader to three different places.
 */
import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '@mtg/llm';
import { fixtureCard, fixturePool } from './support/fixture-cube';
import { scriptedProvider } from './support/scripted-provider';
import {
  assembleCube,
  cubeRoundCostUsd,
  DEFAULT_CUBE_ROUNDS,
  defaultMaxCubeSpendUsd,
  EmptyCubePoolError,
} from '../src/construct';
import type { CubeCriteriaInput } from '../src/criteria';
import type { CubeProposal } from '../src/propose';

/** Forty-five mono-colored cards, nine in each color. */
const CARDS = ['W', 'U', 'B', 'R', 'G'].flatMap((color) =>
  Array.from({ length: 9 }, (_unused, index) =>
    fixtureCard({
      name: `${color} card ${String(index + 1)}`,
      manaCost: `{${color}}`,
      manaValue: index < 5 ? 2 : 4,
      colorIdentity: color,
    }),
  ),
);

const POOL = fixturePool(CARDS);

const CRITERIA: CubeCriteriaInput = {
  prompt: 'forty-five cards for three drafters',
  format: 'modern',
  size: 45,
  seats: 3,
  cardsPerSeat: 15,
  archetypes: [
    { name: 'azorius control', colors: ['W', 'U'], minPlayable: 10 },
    { name: 'rakdos aggro', colors: ['B', 'R'], minPlayable: 10 },
    { name: 'mono-green stompy', colors: ['G'], minPlayable: 5 },
  ],
};

const TAGS: Readonly<Record<string, string>> = {
  W: 'azorius control',
  U: 'azorius control',
  B: 'rakdos aggro',
  R: 'rakdos aggro',
  G: 'mono-green stompy',
};

/** An answer naming `count` of the pool's cards, correctly tagged. */
function answerNaming(count: number, from = 0): CubeProposal {
  return {
    plan: 'a plain five-color cube',
    cards: CARDS.slice(from, from + count).map((card) => ({
      name: card.name,
      count: 1,
      archetypes: [TAGS[card.colorIdentity] ?? 'azorius control'],
      reason: 'it is in the pool',
    })),
  };
}

describe('a cube the model can fill', () => {
  it('stops when it is full and reports the whole run', async () => {
    const provider = scriptedProvider([answerNaming(45)]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA });

    expect(cube.stop).toStrictEqual({ kind: 'filled' });
    expect(cube.rounds).toBe(1);
    expect(cube.shortBy).toBe(0);
    expect(cube.entries).toHaveLength(45);
    expect(cube.plan).toBe('a plain five-color cube');
    expect(cube.poolSize).toBe(45);
  });

  it('measures what it built, and passes only if the build actually holds up', async () => {
    const provider = scriptedProvider([answerNaming(45)]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA });

    expect(cube.validation.measurement.size).toBe(45);
    expect(cube.validation.measurement.colors.map((color) => color.cards)).toStrictEqual([9, 9, 9, 9, 9]);
    expect(cube.validation.findings).toStrictEqual([]);
    expect(cube.validation.ok).toBe(true);
  });

  it('asks again for exactly what is still missing', async () => {
    const provider = scriptedProvider([answerNaming(20), answerNaming(25, 20)]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA });

    expect(cube.rounds).toBe(2);
    expect(cube.entries).toHaveLength(45);
    expect(provider.prompts[0]).toContain('Choose 45 more cards');
    expect(provider.prompts[1]).toContain('Choose 25 more cards');
  });
});

describe('a cube the model cannot fill', () => {
  it('runs out of rounds and says so, keeping what verified', async () => {
    const provider = scriptedProvider([answerNaming(5), answerNaming(5, 5), answerNaming(5, 10)]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA, maxRounds: 3 });

    expect(cube.stop).toStrictEqual({ kind: 'rounds', limit: 3 });
    expect(cube.entries).toHaveLength(15);
    expect(cube.shortBy).toBe(30);
    // Short is a finding, not an exception: the list is still measured.
    expect(cube.validation.findings.map((finding) => finding.code)).toContain('size');
  });

  it('stops the moment a whole round is rejected, and hands back the reasons', async () => {
    const invented: CubeProposal = {
      plan: 'a cube of cards that do not exist',
      cards: [{ name: 'Nonesuch Colossus', count: 1, archetypes: ['rakdos aggro'], reason: 'no' }],
    };
    const provider = scriptedProvider([invented]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA });

    expect(cube.stop).toStrictEqual({ kind: 'stalled' });
    expect(cube.rounds).toBe(1);
    expect(cube.entries).toStrictEqual([]);
    expect(cube.rejections.map((rejection) => rejection.code)).toStrictEqual(['unknown-card']);
  });
});

describe('the dollars a construction may spend', () => {
  /** One card a round against a 45-card cube: the loop always has room to ask again. */
  const DRIP = Array.from({ length: 40 }, (_unused, index) => answerNaming(1, index));

  /**
   * The sizes both bound tests run at, shared so they cannot drift apart.
   *
   * The arithmetic differs at each of them and the tie is only reachable at
   * some: six rounds of a 45-card cube fall 3.6e-15 under the ceiling and six of
   * a 1080-card cube land exactly on it, so a test at 45 alone reports a
   * property that floating point is holding up rather than the code.
   */
  const SIZES = [45, 360, 1080] as const;

  it('stops on spend long before the rounds run out, and names the bound', async () => {
    // Rounds are a proxy for cost and this is the gap: every round makes
    // progress, so the round budget would grant twenty of them, and the money
    // runs out on the third.
    const provider = scriptedProvider(DRIP, { costUsd: 1 });
    const cube = await assembleCube({
      pool: POOL,
      provider,
      criteria: CRITERIA,
      maxRounds: 20,
      maxSpendUsd: 2.5,
    });

    expect(cube.stop).toStrictEqual({ kind: 'spend', limit: 2.5, spentUsd: 3 });
    expect(cube.rounds).toBe(3);
    expect(provider.prompts).toHaveLength(3);
    expect(cube.entries).toHaveLength(3);
    expect(cube.shortBy).toBe(42);
  });

  it('measures that spend from where the build found the guard, not from zero', async () => {
    // The guard belongs to the provider and counts the whole run, so a second
    // cube built in the same process must not inherit the first one's bill.
    const provider = scriptedProvider(DRIP, { costUsd: 1 });
    provider.budget.record({ costUsd: 40, usage: ZERO_USAGE });

    const cube = await assembleCube({
      pool: POOL,
      provider,
      criteria: CRITERIA,
      maxRounds: 20,
      maxSpendUsd: 2.5,
    });

    expect(cube.stop).toStrictEqual({ kind: 'spend', limit: 2.5, spentUsd: 3 });
    expect(cube.rounds).toBe(3);
  });

  it('refuses a bound that is not a positive number of dollars', async () => {
    const provider = scriptedProvider(DRIP);
    await expect(assembleCube({ pool: POOL, provider, criteria: CRITERIA, maxSpendUsd: 0 })).rejects.toThrow(
      /maxSpendUsd must be a positive finite number/,
    );
    expect(provider.prompts).toStrictEqual([]);
  });

  it('lets the rounds it was granted finish under the default, at every size', async () => {
    // The property the default has to hold: a build that spends what a cube
    // round costs, every round, must run out of rounds rather than of money —
    // and must say so, because "raise --max-spend-usd" buys a build with no
    // rounds left exactly nothing.
    for (const size of SIZES) {
      const provider = scriptedProvider(DRIP, { costUsd: cubeRoundCostUsd(size) });
      const cube = await assembleCube({ pool: POOL, provider, criteria: { ...CRITERIA, size } });

      expect(cube.rounds, `at ${String(size)} cards`).toBe(DEFAULT_CUBE_ROUNDS);
      expect(cube.stop, `at ${String(size)} cards`).toStrictEqual({
        kind: 'rounds',
        limit: DEFAULT_CUBE_ROUNDS,
      });
    }
  });

  it('sizes the default on the cube, at every size the criteria accept', () => {
    // What a flat figure cannot do. `size` runs from 45 to 1080, and a bound
    // clear of the smallest cube stops the largest one a round or two in.
    for (const size of SIZES) {
      expect(defaultMaxCubeSpendUsd(size, DEFAULT_CUBE_ROUNDS)).toBeGreaterThanOrEqual(
        DEFAULT_CUBE_ROUNDS * cubeRoundCostUsd(size),
      );
    }
    expect(defaultMaxCubeSpendUsd(1080, DEFAULT_CUBE_ROUNDS)).toBeGreaterThan(
      defaultMaxCubeSpendUsd(45, DEFAULT_CUBE_ROUNDS),
    );
  });

  it('still stops a construction whose rounds cost far more than a round costs', async () => {
    // What the money bound is for, and what the derived default must not give
    // away: the round budget cannot tell a one-card proposal from a whole cube,
    // so a build at ten times the per-round cost runs out of dollars first.
    const provider = scriptedProvider(DRIP, { costUsd: cubeRoundCostUsd(45) * 10 });
    const cube = await assembleCube({ pool: POOL, provider, criteria: CRITERIA });

    expect(cube.stop).toMatchObject({
      kind: 'spend',
      limit: defaultMaxCubeSpendUsd(45, DEFAULT_CUBE_ROUNDS),
    });
    expect(cube.rounds).toBeLessThan(DEFAULT_CUBE_ROUNDS);
  });
});

describe('a cube that states no archetypes', () => {
  /**
   * The schema default, and the shape of the most obvious call there is. It has
   * to build: the prompt tells the model to tag nothing, the schema it answers
   * under forbids a tag, and the gate takes untagged cards. Three pieces that
   * disagreed here made an unconstructable cube out of the default criteria.
   */
  const BARE: CubeCriteriaInput = {
    prompt: 'forty-five cards, no archetypes stated',
    format: 'modern',
    size: 45,
    seats: 3,
    cardsPerSeat: 15,
  };

  const untagged: CubeProposal = {
    plan: 'a plain five-color cube',
    cards: CARDS.map((card) => ({ name: card.name, count: 1, archetypes: [], reason: 'it is in the pool' })),
  };

  it('fills, and measures a list nothing tagged', async () => {
    const provider = scriptedProvider([untagged]);
    const cube = await assembleCube({ pool: POOL, provider, criteria: BARE });

    expect(cube.stop).toStrictEqual({ kind: 'filled' });
    expect(cube.entries).toHaveLength(45);
    expect(cube.validation.measurement.archetypes).toStrictEqual([]);
    expect(cube.validation.findings).toStrictEqual([]);
    expect(cube.validation.ok).toBe(true);
  });

  it('asks for what it will accept: no tagging rule, and an empty list', async () => {
    const provider = scriptedProvider([untagged]);
    await assembleCube({ pool: POOL, provider, criteria: BARE });

    expect(provider.prompts[0]).toContain('return an empty archetypes list');
    expect(provider.prompts[0]).not.toContain('Tag every card');
    expect(provider.systems[0]).not.toContain('must be tagged');
  });
});

describe('a pool with nothing in it', () => {
  it('fails before a single model call, naming the filters that emptied it', async () => {
    const provider = scriptedProvider([answerNaming(1)]);
    const empty = fixturePool([], [], ['legal in standard', 'no card over $1']);

    await expect(assembleCube({ pool: empty, provider, criteria: CRITERIA })).rejects.toBeInstanceOf(
      EmptyCubePoolError,
    );
    expect(provider.prompts).toStrictEqual([]);
  });
});
