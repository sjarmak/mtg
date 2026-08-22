/**
 * A layer-7b base P/T set reaching the bot's targeting policy.
 *
 * `setBasePtUntilEndOfTurn` prices differently from a pump of the same delta,
 * and that divergence is the whole content of this file. `pumpScore` reads a
 * negative modification that fails to kill as an own goal, which is right for
 * `-1/-1` on a 5/5 and wrong for "base 0/1" on the same creature: the set takes
 * every point of power out of the combat whether or not the body dies. The
 * first spelling of the arm delegated to `pumpScore` and the bot cast Diminish
 * in none of six calibration games.
 *
 * Scored through the exported `scoreTargets`, never the unexported helper, so
 * this proves the path from effect to score the way `count-matching-score.test`
 * and `bot-tokens.test` do.
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import type { GameState, ObjectId, Target } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { scoreTargets } from '../src/policies/target';
import { creature, instant } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const SHRINK: Effect = {
  kind: 'setBasePtUntilEndOfTurn',
  power: 0,
  toughness: 1,
  target: { kind: 'targetCreature' },
};

function board(theirDamage = 0): GameState {
  return scenario({
    life: [20, 20],
    battlefield: [
      { card: creature('Ally', 3, 3), controller: 0 },
      { card: creature('Foe', 3, 3), controller: 1, damage: theirDamage },
    ],
  }).state;
}

/** The battlefield object with this name, the way `bot-aura.test.ts` finds one. */
function oidNamed(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function score(effect: Effect, state: GameState, target: Target): number {
  const card = instant('Test Shrink', [effect], { generic: 1, U: 1 }, ['U']);
  return scoreTargets(state, 0, card, [target], config.cast, config.target, config.race);
}

describe('a base power and toughness set reaching the targeting policy', () => {
  it("is worth the power it takes off an opponent's creature, even when nothing dies", () => {
    const state = board();
    const theirs: Target = { kind: 'permanent', oid: oidNamed(state, 'Foe') };
    // 3 power and 2 toughness come off a 3/3 that survives at 0/1.
    expect(score(SHRINK, state, theirs)).toBeCloseTo(
      3 * config.target.pumpPowerWeight + 2 * config.target.pumpToughnessWeight,
    );
  });

  it('diverges from the pump of the same delta, which reads a survivor as an own goal', () => {
    // The refutation. This is exactly what the arm returned while it delegated
    // to `pumpScore`, and it is why the bot would not cast the card.
    const state = board();
    const theirs: Target = { kind: 'permanent', oid: oidNamed(state, 'Foe') };
    const pump: Effect = {
      kind: 'pumpUntilEndOfTurn',
      power: -3,
      toughness: -2,
      target: { kind: 'targetCreature' },
    };
    expect(score(pump, state, theirs)).toBe(-config.target.ownGoalPenalty);
    expect(score(SHRINK, state, theirs)).toBeGreaterThan(0);
  });

  it('is removal when the toughness it sets is already dealt', () => {
    // A 3/3 with 1 damage marked reads 0/1 and dies as a state-based action
    // (CR 704.5g), so this is worth the body rather than the delta.
    const state = board(1);
    const theirs: Target = { kind: 'permanent', oid: oidNamed(state, 'Foe') };
    expect(score(SHRINK, state, theirs)).toBeGreaterThan(
      3 * config.target.pumpPowerWeight + 2 * config.target.pumpToughnessWeight,
    );
  });

  it("costs an own goal aimed at the caster's own creature", () => {
    const state = board();
    const mine: Target = { kind: 'permanent', oid: oidNamed(state, 'Ally') };
    expect(score(SHRINK, state, mine)).toBeLessThan(0);
  });
});
