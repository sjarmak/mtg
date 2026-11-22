/** Token-inclusive resolution exile counts in the bot's target scorer. */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { scoreEffectTargets } from '../src/policies/target';
import { creature } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const EXILE_OWN_CREATURES = {
  kind: 'exileTarget',
  scope: 'permanentsYouControl',
  scopeFilter: { cardTypes: ['creature'] },
  target: { kind: 'noTarget' },
} satisfies Effect;

function damageAfterExile(kind: 'exiledThisResolution' | 'permanentsExiledThisResolution'): Effect {
  return {
    kind: 'dealDamage',
    amount: { kind },
    target: { kind: 'targetOpponent' },
  };
}

function score(kind: 'exiledThisResolution' | 'permanentsExiledThisResolution'): number {
  const state = scenario({
    battlefield: [
      { card: creature('Card Body', 1, 1), controller: 0 },
      { card: creature('Token Body', 1, 1), controller: 0, token: true },
    ],
  }).state;
  return scoreEffectTargets(
    state,
    0,
    [EXILE_OWN_CREATURES, damageAfterExile(kind)],
    [null, { kind: 'player', player: 1 }],
    config.cast,
    config.target,
    config.race,
  );
}

function filteredSweepScore(): number {
  const state = scenario({
    battlefield: [
      { card: creature('Chosen Body', 1, 1, [], { U: 1 }, ['U']), controller: 0 },
      { card: creature('Spared Body', 1, 1, [], { R: 1 }, ['R']), controller: 0 },
    ],
  }).state;
  return scoreEffectTargets(
    state,
    0,
    [{ ...EXILE_OWN_CREATURES, scopeFilter: { colors: ['U'] } }],
    [null],
    config.cast,
    config.target,
    config.race,
  );
}

describe('a permanent-exile tally reaching the targeting policy', () => {
  it('counts an exiled token that the card-exile tally deliberately excludes', () => {
    expect(score('permanentsExiledThisResolution') - score('exiledThisResolution')).toBeCloseTo(
      config.target.faceDamageWeight,
    );
  });

  it('scores only the permanents selected by the exile scope filter', () => {
    expect(filteredSweepScore()).toBeCloseTo(-config.target.ownGoalPenalty);
  });
});
