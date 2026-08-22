/**
 * A `countMatching` amount reaching the bot's targeting policy.
 *
 * `predictAmount` (`policies/target.ts`) has to read the same board a
 * `dealDamage` effect will actually deal against, or a bot holding "deals
 * damage equal to the number of creatures you control" prices it at zero —
 * the same failure mode `exiledCardsBy`'s docblock names for the sibling
 * computed amount. Mirrors `bot-tokens.test.ts`'s shape: score through the
 * exported `scoreTargets`, never the unexported per-effect helpers, so this
 * proves the whole path from effect to score rather than one private branch.
 */
import { describe, expect, it } from 'vitest';
import type { Amount, Effect } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { scoreTargets } from '../src/policies/target';
import { creature, sorcery } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const CREATURE_COUNT: Amount = { kind: 'countMatching', filter: { cardTypes: ['creature'] } };

function board(myCreatures: number, theirCreatures: number): GameState {
  return scenario({
    life: [20, 20],
    battlefield: [
      ...Array.from({ length: myCreatures }, (_, i) => ({
        card: creature(`Ally ${String(i)}`, 1, 1),
        controller: 0 as const,
      })),
      ...Array.from({ length: theirCreatures }, (_, i) => ({
        card: creature(`Foe ${String(i)}`, 1, 1),
        controller: 1 as const,
      })),
    ],
  }).state;
}

function score(myCreatures: number, theirCreatures: number): number {
  const effect: Effect = { kind: 'dealDamage', amount: CREATURE_COUNT, target: { kind: 'targetOpponent' } };
  const card = sorcery('Swarm Call', [effect], { generic: 1, R: 1 }, ['R']);
  return scoreTargets(
    board(myCreatures, theirCreatures),
    0,
    card,
    [{ kind: 'player', player: 1 }],
    config.cast,
    config.target,
    config.race,
  );
}

describe('a countMatching amount reaching the targeting policy', () => {
  it("scores face damage proportional to the caster's own creature count", () => {
    expect(score(3, 0)).toBeCloseTo(3 * config.target.faceDamageWeight);
  });

  it('is zero with no matching permanents, not a policy that ignores the card', () => {
    expect(score(0, 0)).toBe(0);
  });

  it("does not count the opponent's creatures", () => {
    expect(score(0, 5)).toBe(0);
  });
});
