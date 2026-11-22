/** Directional policy for the targeted, hand-authored graveyard-exile form. */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, scoreEffectTargets } from '@mtg/sim';
import { creature } from './cards';

const config = DEFAULT_GREEDY_CONFIG;
const TARGETED = {
  kind: 'exileGraveyard',
  target: { kind: 'targetPlayer' },
} satisfies Effect;
const FIXED = { kind: 'exileGraveyard', whose: 'opponent' } satisfies Effect;

function score(effect: Effect, player: 0 | 1): number {
  const state = scenario({ graveyards: [[], [creature('Buried Rival', 2, 2)]] }).state;
  return scoreEffectTargets(
    state,
    0,
    [effect],
    ['target' in effect ? { kind: 'player', player } : null],
    config.cast,
    config.target,
    config.race,
  );
}

describe('targeted graveyard exile policy', () => {
  it("prefers the opponent's graveyard and penalizes exiling its own", () => {
    expect(score(TARGETED, 1)).toBeGreaterThan(0);
    expect(score(TARGETED, 0)).toBeLessThan(0);
  });

  it('keeps the fixed-owner form neutral because it offers no aim choice', () => {
    expect(score(FIXED, 1)).toBe(0);
  });
});
