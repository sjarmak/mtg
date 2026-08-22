/**
 * Land, cast, targeting, ordering and discard policy tests.
 *
 * These go through `decideGreedy` on a real `pendingDecision`, so what is
 * asserted is the action the bot would actually submit — and every asserted
 * action is run past `validateAction` to prove the kernel would accept it. The
 * spend-plan bound at the end is the exception: it drives the search directly,
 * because the widths it has to cap are past anything a real board produces.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import type { CastCandidate } from '@mtg/sim';
import {
  DEFAULT_GREEDY_CONFIG,
  MAX_EXHAUSTIVE_PLAN_CANDIDATES,
  bestSpendPlan,
  chooseBlockerOrder,
  chooseDiscards,
  chooseLandDrop,
  decideGreedy,
  greedyConfig,
} from '@mtg/sim';
import { creature, FOREST, instant, MOUNTAIN, PLAINS, sorcery, SWAMP } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

function decide(state: GameState, player: 0 | 1 = 0, profile = config): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  expect(decision.player).toBe(player);
  const action = decideGreedy({ state, player, decision }, profile);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

function nameOf(state: GameState, oid: ObjectId): string {
  return state.objects[oid]?.card.name ?? '?';
}

const BOLT = instant(
  'Bolt',
  [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
  { generic: 1, R: 1 },
  ['R'],
);
const DOOM = sorcery(
  'Doom',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { generic: 2, B: 1 },
  ['B'],
);

describe('land policy', () => {
  it('takes the land drop while short of lands', () => {
    const { state } = scenario({
      active: 0,
      hands: [[FOREST, creature('Beast', 4, 4, [], { generic: 3, G: 1 }, ['G'])], []],
    });
    const action = decide(state);
    expect(action.type).toBe('playLand');
  });

  it('skips the drop at saturation when nothing in hand needs the mana', () => {
    const lands = Array.from({ length: 6 }, () => ({ card: FOREST, controller: 0 as const }));
    const { state } = scenario({
      active: 0,
      battlefield: lands,
      hands: [[FOREST], []],
    });
    const drop = chooseLandDrop(
      state,
      0,
      pendingDecision(state, 512)?.options.flatMap((option) =>
        option.type === 'playLand' ? [option] : [],
      ) ?? [],
      config.land,
    );
    expect(drop).toBeNull();
  });

  it('prefers the land that unlocks the most stranded colored pips', () => {
    const { state } = scenario({
      active: 0,
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [
        [
          SWAMP,
          PLAINS,
          sorcery('Wrath', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], { B: 2 }, [
            'B',
          ]),
        ],
        [],
      ],
    });
    const action = decide(state);
    expect(action.type).toBe('playLand');
    if (action.type !== 'playLand') return;
    expect(nameOf(state, action.oid)).toBe('Swamp');
  });
});

describe('cast policy', () => {
  it("points removal at the opponent's best creature, never at its own", () => {
    const { state } = scenario({
      active: 0,
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: creature('Mine', 2, 2), controller: 0 },
        { card: creature('Small Theirs', 1, 1), controller: 1 },
        { card: creature('Big Theirs', 5, 5), controller: 1 },
      ],
      hands: [[DOOM], []],
    });
    const action = decide(state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    const target = action.targets[0];
    expect(target?.kind).toBe('permanent');
    if (target?.kind !== 'permanent') return;
    expect(nameOf(state, target.oid)).toBe('Big Theirs');
  });

  it('holds an instant during its own main phase', () => {
    const { state } = scenario({
      active: 0,
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: creature('Target', 2, 2), controller: 1 },
      ],
      hands: [[BOLT], []],
    });
    expect(decide(state).type).toBe('passPriority');
  });

  it('never holds a lethal burn spell', () => {
    const { state } = scenario({
      active: 0,
      life: [20, 3],
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[BOLT], []],
    });
    const action = decide(state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(action.targets[0]).toEqual({ kind: 'player', player: 1 });
  });

  it('casts instants freely when the profile turns holding off', () => {
    const eager = greedyConfig({ cast: { holdInstants: false } });
    const { state } = scenario({
      active: 0,
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: creature('Target', 2, 2), controller: 1 },
      ],
      hands: [[BOLT], []],
    });
    expect(decide(state, 0, eager).type).toBe('castSpell');
  });

  it('chooses the smallest lethal X for a creature rather than collapsing to zero or maximizing blindly', () => {
    const geyser = parseCard({
      kind: 'instant',
      id: 'tst-variable-geyser',
      name: 'Variable Geyser',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 900 },
      manaCost: { hasX: true, R: 2 },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
    });
    const eager = greedyConfig({ cast: { holdInstants: false } });
    const { state } = scenario({
      active: 0,
      battlefield: [
        ...Array.from({ length: 5 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
        { card: creature('X Target', 2, 2), controller: 1 },
      ],
      hands: [[geyser], []],
    });
    const action = decide(state, 0, eager);
    expect(action).toEqual(
      expect.objectContaining({
        type: 'castSpell',
        x: 2,
        targets: [expect.objectContaining({ kind: 'permanent' })],
      }),
    );
  });

  it('spends the whole turn: two two-drops beat one four-drop', () => {
    const cheapA = creature('Cheap A', 2, 2, [], { generic: 1, G: 1 }, ['G']);
    const cheapB = creature('Cheap B', 2, 2, [], { generic: 1, G: 1 }, ['G']);
    const expensive = creature('Pricey', 3, 3, [], { generic: 3, G: 1 }, ['G']);
    const { state } = scenario({
      active: 0,
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 as const })),
      hands: [[expensive, cheapA, cheapB], []],
    });
    const action = decide(state);
    expect(action.type).toBe('castSpell');
    if (action.type !== 'castSpell') return;
    expect(nameOf(state, action.oid)).toMatch(/^Cheap/);
  });
});

describe('spend-plan search bound', () => {
  const FILLER = creature('Filler', 1, 1);

  function candidate(oid: ObjectId, value: number, cost: number): CastCandidate {
    return {
      action: { type: 'castSpell', player: 0, oid, targets: [] },
      card: FILLER,
      value,
      cost,
    };
  }

  /**
   * A knapsack the two searches disagree on. Under 4 mana the exhaustive search
   * takes the two 2-drops; the value-per-mana greedy fill takes the 3-drop for
   * its better ratio and can then afford nothing else. Everything past index 2
   * costs more than the whole turn, so neither search can pick it — that padding
   * exists only to set the width of the subset search.
   */
  function disagreeingCandidates(count: number): readonly CastCandidate[] {
    const real = [candidate('three', 3.3, 3), candidate('two-a', 2, 2), candidate('two-b', 2, 2)];
    const padding = Array.from({ length: count - real.length }, (_unused, index) =>
      candidate(`pad-${index}`, 0.1, 5),
    );
    return [...real, ...padding];
  }

  it('falls back to the greedy fill above the ceiling, whatever the profile asks for', () => {
    const { cast } = greedyConfig({ cast: { planMaxCandidates: 32 } });
    const wide = disagreeingCandidates(MAX_EXHAUSTIVE_PLAN_CANDIDATES + 1);
    expect(bestSpendPlan(wide, 4, cast).map((chosen) => chosen.cost)).toEqual([3]);
  });

  it('still runs the exact search at the ceiling', () => {
    const { cast } = greedyConfig({ cast: { planMaxCandidates: 32 } });
    const atLimit = disagreeingCandidates(MAX_EXHAUSTIVE_PLAN_CANDIDATES);
    expect(bestSpendPlan(atLimit, 4, cast).map((chosen) => chosen.cost)).toEqual([2, 2]);
  });

  it('never reaches the width where the subset search silently plans nothing', () => {
    const { cast } = greedyConfig({ cast: { planMaxCandidates: 64 } });
    expect(bestSpendPlan(disagreeingCandidates(32), 4, cast).length).toBeGreaterThan(0);
  });

  it('leaves the shipped profile under the ceiling, so the cap changes no real run', () => {
    expect(DEFAULT_GREEDY_CONFIG.cast.planMaxCandidates).toBeLessThanOrEqual(MAX_EXHAUSTIVE_PLAN_CANDIDATES);
  });
});

describe('ordering and discard policies', () => {
  it('orders blockers cheapest kill first', () => {
    const { state } = scenario({
      active: 1,
      battlefield: [
        { card: creature('Attacker', 4, 4), controller: 1 },
        { card: creature('Tough', 2, 4), controller: 0 },
        { card: creature('Frail', 1, 1), controller: 0 },
      ],
    });
    const ids = new Map<string, ObjectId>();
    for (const [oid, object] of Object.entries(state.objects)) ids.set(object.card.name, oid);
    const attacker = ids.get('Attacker') ?? '';
    const tough = ids.get('Tough') ?? '';
    const frail = ids.get('Frail') ?? '';
    const ordered = chooseBlockerOrder(state, [{ attacker, blockers: [tough, frail] }]);
    expect(ordered[0]?.blockers).toEqual([frail, tough]);
  });

  it('pitches the clunkiest uncastable card at cleanup', () => {
    const cheap = creature('Cheap', 1, 1, [], { G: 1 }, ['G']);
    const clunker = creature('Clunker', 8, 8, [], { generic: 7, G: 1 }, ['G']);
    const { state } = scenario({
      active: 0,
      battlefield: [{ card: FOREST, controller: 0 }],
      hands: [[cheap, clunker, FOREST], []],
    });
    const hand = state.players[0].hand;
    const discards = chooseDiscards(state, 0, hand, 1, config.discard);
    expect(discards).toHaveLength(1);
    expect(nameOf(state, discards[0] ?? '')).toBe('Clunker');
  });
});
