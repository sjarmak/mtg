import { describe, expect, it } from 'vitest';
import type { ManaCheckpoint, MetricsConfig } from '@mtg/metrics';
import {
  checkpointId,
  checkpointLabel,
  DEFAULT_MANA_CHECKPOINTS,
  DEFAULT_METRICS_CONFIG,
  karstenPrior,
  LIMITED_DECK_SHAPE,
  manaCheckpoint,
  manaCheckpoints,
  metricsConfig,
} from '@mtg/metrics';
import { fakeLog } from './helpers/log';

const SCREW_T4: ManaCheckpoint = { kind: 'screw', ordinal: 4, lands: 3 };
const FLOOD_T8: ManaCheckpoint = { kind: 'flood', ordinal: 8, lands: 8 };

describe('karstenPrior', () => {
  it('matches the hypergeometric for a 17-land, 40-card deck', () => {
    // Ten cards seen by the end of own turn 4 on the play (7 + 3 draws).
    // P(fewer than 3 lands) = 9.64%.
    expect(karstenPrior(SCREW_T4, LIMITED_DECK_SHAPE, true)).toBeCloseTo(0.0964, 4);
    // Eleven cards on the draw makes screw rarer.
    expect(karstenPrior(SCREW_T4, LIMITED_DECK_SHAPE, false)).toBeCloseTo(0.0571, 4);
  });

  it('makes screw strictly more likely on the play than on the draw', () => {
    for (const checkpoint of DEFAULT_MANA_CHECKPOINTS.filter((entry) => entry.kind === 'screw')) {
      expect(karstenPrior(checkpoint, LIMITED_DECK_SHAPE, true)).toBeGreaterThan(
        karstenPrior(checkpoint, LIMITED_DECK_SHAPE, false),
      );
    }
  });

  it('inverts the direction for flood', () => {
    expect(karstenPrior(FLOOD_T8, LIMITED_DECK_SHAPE, true)).toBeCloseTo(0.1494, 4);
    expect(karstenPrior(FLOOD_T8, LIMITED_DECK_SHAPE, false)).toBeCloseTo(0.2284, 4);
  });

  it('tracks the deck shape rather than a hardcoded table', () => {
    const landHeavy = karstenPrior(SCREW_T4, { size: 40, lands: 24 }, true);
    const landLight = karstenPrior(SCREW_T4, { size: 40, lands: 12 }, true);
    expect(landHeavy).toBeLessThan(landLight);
  });
});

describe('manaCheckpoint', () => {
  const config = metricsConfig({ floors: { manaCheckpoint: 4 } });

  it('counts a side as screwed only from its own turn record', () => {
    const logs = [
      // user has 2 lands at end of its own turn 4: screwed. oppo has 4: fine.
      fakeLog({ index: 0, playerTurns: 16, onPlay: 0, userLands: [1, 2, 2, 2, 3], variant: 1 }),
      fakeLog({ index: 1, playerTurns: 16, onPlay: 0, userLands: [1, 2, 3, 4, 5], variant: 2 }),
    ];
    const result = manaCheckpoint(logs, SCREW_T4, config);
    expect(result.observedSides).toBe(4);
    expect(result.eligibleSides).toBe(4);
    expect(result.hits).toBe(1);
    expect(result.observed.value).toBe(0.25);
  });

  it('excludes sides whose game ended before the checkpoint, and says so', () => {
    const logs = [
      fakeLog({ index: 0, playerTurns: 4, userLands: [1, 2], variant: 1 }),
      fakeLog({ index: 1, playerTurns: 16, userLands: [1, 2, 3, 4], variant: 2 }),
    ];
    const result = manaCheckpoint(logs, SCREW_T4, config);
    // Game 0 ran four global turns, so each side took only two of their own.
    expect(result.eligibleSides).toBe(4);
    expect(result.observedSides).toBe(2);
  });

  it('averages the prior over the observed play/draw split', () => {
    const onPlayPrior = karstenPrior(SCREW_T4, LIMITED_DECK_SHAPE, true);
    const onDrawPrior = karstenPrior(SCREW_T4, LIMITED_DECK_SHAPE, false);
    // One game contributes one on-play side and one on-draw side.
    const result = manaCheckpoint([fakeLog({ playerTurns: 16 })], SCREW_T4, config);
    expect(result.prior).toBeCloseTo((onPlayPrior + onDrawPrior) / 2, 10);
  });

  it('reports the delta against the prior', () => {
    const logs = Array.from({ length: 4 }, (_unused, index) =>
      fakeLog({ index, playerTurns: 16, userLands: [1, 1, 1, 1, 2], variant: index }),
    );
    const result = manaCheckpoint(logs, SCREW_T4, config);
    // Every user side is screwed, no oppo side is: 50% observed.
    expect(result.observed.value).toBe(0.5);
    expect(result.delta).toBeCloseTo(0.5 - result.prior, 10);
  });

  it('returns null and no delta below the sample floor', () => {
    const result = manaCheckpoint([fakeLog({ playerTurns: 16 })], SCREW_T4);
    expect(result.observed.value).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.prior).toBeGreaterThan(0);
  });

  it('counts flood in the other direction', () => {
    const logs = [
      fakeLog({ index: 0, playerTurns: 20, userLands: [1, 2, 3, 4, 5, 6, 7, 8], variant: 1 }),
      fakeLog({ index: 1, playerTurns: 20, userLands: [1, 2, 3, 4, 5, 5, 5, 5], variant: 2 }),
    ];
    const result = manaCheckpoint(logs, FLOOD_T8, config);
    // Both oppo sides curve out perfectly (the default schedule), plus the
    // first user side: three of four.
    expect(result.hits).toBe(3);
    expect(result.observed.value).toBe(0.75);
  });
});

describe('manaCheckpoints', () => {
  it('runs every configured checkpoint', () => {
    const results = manaCheckpoints([fakeLog({ playerTurns: 20 })]);
    expect(results.map((result) => result.checkpoint)).toEqual(DEFAULT_MANA_CHECKPOINTS);
  });
});

describe('checkpoint naming', () => {
  it('produces a stable gate id and a readable label', () => {
    expect(checkpointId(SCREW_T4)).toBe('mana.screw.t4.l3');
    expect(checkpointLabel(SCREW_T4)).toBe('screw: <3 lands by own turn 4');
    expect(checkpointLabel(FLOOD_T8)).toBe('flood: >=8 lands by own turn 8');
  });
});

describe('checkpoint validation', () => {
  it('rejects a checkpoint the one-land-per-turn rule makes unreachable', () => {
    expect(() => metricsConfig({ mana: { checkpoints: [{ kind: 'screw', ordinal: 3, lands: 5 }] } })).toThrow(
      /unreachable/,
    );
  });

  it('rejects a deck shape with more lands than cards', () => {
    expect(() => metricsConfig({ mana: { shape: { size: 40, lands: 41 } } })).toThrow(/deck shape/);
  });

  /**
   * `checkpoints` is caller-supplied through the exported `metricsConfig`, and
   * both fields end up as arguments to `hypergeometricAtLeast`, which rejects a
   * fractional or negative one. Rejecting it here names the field the caller
   * wrote rather than the parameter it becomes two calls later.
   */
  it('rejects a checkpoint whose lands or ordinal is not a whole count', () => {
    expect(() =>
      metricsConfig({ mana: { checkpoints: [{ kind: 'screw', ordinal: 4, lands: 2.5 }] } }),
    ).toThrow(/checkpoint lands must be a non-negative integer, got 2.5/);
    expect(() =>
      metricsConfig({ mana: { checkpoints: [{ kind: 'screw', ordinal: 4, lands: -1 }] } }),
    ).toThrow(/checkpoint lands must be a non-negative integer, got -1/);
    expect(() =>
      metricsConfig({ mana: { checkpoints: [{ kind: 'flood', ordinal: 4.5, lands: 3 }] } }),
    ).toThrow(/checkpoint ordinal must be an integer >= 1, got 4.5/);
  });

  /**
   * The same asymmetry one field over: the shape's two numbers are the
   * hypergeometric's population and successes, so a fractional one surfaced
   * from `hypergeometricAtLeast` under a parameter name the caller never wrote.
   */
  it('rejects a deck shape whose size or lands is not a whole count', () => {
    expect(() => metricsConfig({ mana: { shape: { size: 40.5, lands: 17 } } })).toThrow(
      /deck shape size must be an integer >= 1, got 40.5/,
    );
    expect(() => metricsConfig({ mana: { shape: { size: 0, lands: 0 } } })).toThrow(
      /deck shape size must be an integer >= 1, got 0/,
    );
    expect(() => metricsConfig({ mana: { shape: { size: 40, lands: 2.5 } } })).toThrow(
      /deck shape lands must be a non-negative integer, got 2.5/,
    );
    expect(() => metricsConfig({ mana: { shape: { size: 40, lands: -1 } } })).toThrow(
      /deck shape lands must be a non-negative integer, got -1/,
    );
  });
});

/**
 * `karstenPrior` and `manaCheckpoint` take a checkpoint and a shape that never
 * had to pass through `metricsConfig`, so they run the config boundary's own
 * checks at their own door.
 */
describe('checkpoint validation at the metric entry points', () => {
  const BAD_LANDS: ManaCheckpoint = { kind: 'screw', ordinal: 4, lands: 2.5 };

  it('rejects a hand-built checkpoint at karstenPrior', () => {
    expect(() => karstenPrior(BAD_LANDS, LIMITED_DECK_SHAPE, true)).toThrow(
      /mana checkpoint lands must be a non-negative integer, got 2.5/,
    );
  });

  it('rejects a hand-built deck shape at karstenPrior', () => {
    expect(() => karstenPrior(SCREW_T4, { size: 40.5, lands: 17 }, true)).toThrow(
      /deck shape size must be an integer >= 1, got 40.5/,
    );
  });

  it('rejects a hand-built checkpoint at manaCheckpoint, before walking the logs', () => {
    expect(() => manaCheckpoint([fakeLog({ playerTurns: 16 })], BAD_LANDS)).toThrow(
      /mana checkpoint lands must be a non-negative integer, got 2.5/,
    );
  });

  it('rejects a hand-built config whose deck shape never passed metricsConfig', () => {
    const config: MetricsConfig = {
      ...DEFAULT_METRICS_CONFIG,
      mana: { ...DEFAULT_METRICS_CONFIG.mana, shape: { size: 40, lands: 41 } },
    };
    expect(() => manaCheckpoint([fakeLog({ playerTurns: 16 })], SCREW_T4, config)).toThrow(
      /deck shape has 41 lands in 40 cards/,
    );
  });
});
