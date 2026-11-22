/** The real greedy bot uses Yeva's permission during the opponent turn. */
import { basicLand, parseCard } from '@mtg/dsl';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy } from '@mtg/sim';
import { describe, expect, it } from 'vitest';

const YEVA = parseCard({
  kind: 'creature',
  id: 'sim-yeva-natures-herald',
  name: "Yeva, Nature's Herald",
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 197 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'],
  supertypes: ['legendary'],
  subtypes: ['Elf', 'Shaman'],
  power: 4,
  toughness: 4,
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsAsThoughFlash',
      spellFilter: { cardTypes: ['creature'], colors: ['G'] },
    },
  ],
});

const AMBUSHER = parseCard({
  kind: 'creature',
  id: 'sim-yeva-ambusher',
  name: 'Yeva Ambusher',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 3,
  toughness: 3,
});

describe('M13 Flash in the sim policy', () => {
  it('chooses and executes a green creature cast during the opponent turn', () => {
    const start = scenario({
      seed: 'sim/m13-flash/opponent-turn',
      active: 1,
      battlefield: [
        { card: YEVA, controller: 0 },
        { card: basicLand('Forest', 'TST', 10), controller: 0 },
        { card: basicLand('Forest', 'TST', 11), controller: 0 },
      ],
      hands: [[AMBUSHER], []],
    });
    const responseWindow = reduce(start.state, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(responseWindow.state);
    if (decision?.kind !== 'priority') throw new Error('sim Flash probe did not reach priority');
    const action = decideGreedy(
      { state: observeState(responseWindow.state, 0, 'test/m13-flash.test.ts:57'), player: 0, decision },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(action).toEqual(expect.objectContaining({ type: 'castSpell', player: 0 }));
    expect(validateAction(responseWindow.state, action)).toBeNull();

    const cast = reduce(responseWindow.state, action);
    expect(cast.state.turn.active).toBe(1);
    expect(cast.events).toContainEqual(expect.objectContaining({ type: 'spellCast', player: 0 }));
    expect(cast.state.stack).toHaveLength(1);
  });
});
