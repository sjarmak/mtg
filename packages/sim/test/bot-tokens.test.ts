/**
 * What a token is worth to a bot, measured in the sim.
 *
 * `tokenScore` is two branches and both were unasserted here. Replacing the
 * whole function with `return 1` left the sim suite green, and so did replacing
 * the creature branch's body with `return 0`: the only tests that touched it
 * lived in `@mtg/deckbuild`, which scores a card in the abstract rather than a
 * spell aimed at a board. A policy nothing in its own package pins is a policy
 * that drifts the next time somebody edits the weights.
 *
 * Both branches are stated as arithmetic in the configured weights rather than
 * as literals, so a config change moves the expectation with the policy instead
 * of turning this file red for the wrong reason.
 */
import { describe, expect, it } from 'vitest';
import type { Effect, TokenSpec } from '@mtg/dsl';
import { mana } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { scoreTargets } from '../src/policies/target';
import { creature, sorcery } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

/** A quiet board: nothing here should move a token's score. */
function board(): GameState {
  return scenario({
    life: [20, 20],
    battlefield: [{ card: creature('Bystander', 1, 1), controller: 0 }],
  }).state;
}

function tokenMaker(name: string, token: TokenSpec, count = 1) {
  const effect = { kind: 'createToken', count, token } as Effect;
  return sorcery(name, [effect], { generic: 1, G: 1 }, ['G']);
}

function score(name: string, token: TokenSpec, count = 1): number {
  return scoreTargets(
    board(),
    0,
    tokenMaker(name, token, count),
    [null],
    config.cast,
    config.target,
    config.race,
  );
}

const BEAR_POWER = 2;

const BEAR: TokenSpec = {
  name: 'Bear',
  power: BEAR_POWER,
  toughness: 2,
  colors: ['G'],
  subtypes: ['Bear'],
  keywords: [],
};

/** A part: an artifact token with no body, which is what the flagship set drops. */
const TROPHY_HORN: TokenSpec = {
  name: 'Trophy Horn',
  colors: [],
  subtypes: ['Part'],
  keywords: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: mana({ generic: 1 }), tapSelf: false, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
};

describe('what a created token is worth', () => {
  it('prices a creature token as a body: base value plus its power', () => {
    expect(score('Call the Bear', BEAR)).toBeCloseTo(
      config.cast.creatureBaseValue + BEAR_POWER * config.cast.powerWeight,
      6,
    );
  });

  it('prefers the bigger body when nothing else differs', () => {
    const cub: TokenSpec = { ...BEAR, name: 'Cub', power: 1, toughness: 1 };
    expect(score('Call the Bear', BEAR) - score('Call the Cub', cub)).toBeCloseTo(config.cast.powerWeight, 6);
  });

  it('multiplies by the number of copies made', () => {
    expect(score('Call the Pack', BEAR, 3)).toBeCloseTo(3 * score('Call the Bear', BEAR), 6);
  });

  /**
   * A token with no body adds no body, which is what this evaluator measures.
   * The swing a part eventually causes is the counter it places, and that is
   * scored when the Fuse ability is activated (`scoreEffectTargets` over the
   * ability's own effects), not when the part arrives. Pricing it as a creature
   * here would double-count it and would tell the bot a Trophy Horn can block.
   */
  it('prices a bodiless token at nothing, however many it makes', () => {
    expect(score('Drop the Horn', TROPHY_HORN)).toBe(0);
    expect(score('Drop the Horns', TROPHY_HORN, 4)).toBe(0);
  });

  it('never rates a part above the smallest creature token', () => {
    const runt: TokenSpec = { ...BEAR, name: 'Runt', power: 0, toughness: 1 };
    expect(score('Drop the Horn', TROPHY_HORN)).toBeLessThan(score('Call the Runt', runt));
  });
});
