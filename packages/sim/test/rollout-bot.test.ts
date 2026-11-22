import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  actionKey,
  agentView,
  observeState,
  pendingDecision,
  scenario,
  settleAgentAction,
  type Action,
  type AgentObservation,
  type AgentView,
  type GameState,
  type ObjectId,
  type PlayerId,
  type Target,
} from '@mtg/kernel';
import {
  DEFAULT_GREEDY_CONFIG,
  DEFAULT_ROLLOUT_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  decideGreedy,
  decideRollout,
  decideSearch,
  createBot,
  rolloutSpec,
  withRolloutPreview,
  type RolloutBotConfig,
  type RolloutAgentView,
} from '@mtg/sim';
import { creature, SWAMP } from './cards';

const SICKNESS: Card = parseCard({
  kind: 'enchantment',
  id: 'rollout-quag-sickness',
  name: 'Quag Sickness',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 111 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'statBonusPer',
        power: -1,
        toughness: -1,
        each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
      },
    ],
  },
});

const BEAR = creature('Runeclaw Bear', 2, 2);
const OGRE = creature('Opposing Ogre', 6, 6);
const DELAYED_PAYOFF = creature('Serra Angel', 12, 12);
const HIDDEN_SMALL = creature('Hidden Small', 1, 1);
const HIDDEN_LARGE = creature('Hidden Large', 9, 9);
const TOP_REVEALER: Card = parseCard({
  kind: 'creature',
  id: 'rollout-top-revealer',
  name: 'Top Revealer',
  rarity: 'rare',
  set: { code: 'BOT', collectorNumber: 1 },
  manaCost: { generic: 4 },
  colors: [],
  power: 2,
  toughness: 2,
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'playWithTopLibraryRevealed' }],
});

function contested(seed: string): GameState {
  return scenario({
    seed,
    battlefield: [
      ...Array.from({ length: 3 }, () => ({ card: SWAMP, controller: 0 as PlayerId })),
      { card: BEAR, controller: 0 as PlayerId },
      { card: OGRE, controller: 1 as PlayerId },
    ],
    hands: [[SICKNESS], []],
  }).state;
}

function named(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function targetOf(action: Action): ObjectId | null {
  if (action.type !== 'castSpell') return null;
  const target: Target | null | undefined = action.targets[0];
  return target?.kind === 'permanent' ? target.oid : null;
}

function baseView(state: GameState): AgentView {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  return agentView(state, 0, decision, 'rollout-test', (action) => settleAgentAction(state, action));
}

function futureObservation(seed: string, hasPayoff: boolean): AgentObservation {
  const future = scenario({
    seed,
    battlefield: hasPayoff ? [{ card: DELAYED_PAYOFF, controller: 0 as PlayerId }] : [],
    hands: [[], []],
  }).state;
  return observeState(future, 0, seed);
}

const CONFIG: RolloutBotConfig = {
  ...DEFAULT_ROLLOUT_CONFIG,
  closeMargin: 100,
  rolloutsPerCandidate: 2,
  maximumCandidates: 3,
  maximumRolloutsPerDecision: 6,
  turnHorizon: 3,
};

describe('rollout look-ahead', () => {
  it('uses position-named seeds and reproduces the same decision', () => {
    const state = contested('sim/rollout/determinism');
    const seen: string[] = [];
    const view: RolloutAgentView = {
      ...baseView(state),
      rollout(action, request) {
        seen.push(request.seed);
        return futureObservation(request.seed, targetOf(action) === named(state, 'Runeclaw Bear'));
      },
    };

    const first = decideRollout(view, CONFIG, 'game-seed', 17);
    const firstSeeds = [...seen];
    seen.length = 0;
    const second = decideRollout(view, CONFIG, 'game-seed', 17);

    expect(second).toEqual(first);
    expect(seen).toEqual(firstSeeds);
    expect(new Set(firstSeeds).size).toBe(firstSeeds.length);
    expect(firstSeeds).toHaveLength(4);
    expect(firstSeeds.every((seed) => seed.startsWith('game-seed/decision/17/candidate/'))).toBe(true);
  });

  it('returns greedy exactly when no alternative is close', () => {
    const state = contested('sim/rollout/not-close');
    let rollouts = 0;
    const view: RolloutAgentView = {
      ...baseView(state),
      rollout(_action, request) {
        rollouts += 1;
        return futureObservation(request.seed, false);
      },
    };
    const greedy = decideGreedy(view, DEFAULT_GREEDY_CONFIG);
    const chosen = decideRollout(view, { ...CONFIG, closeMargin: 0 }, 'game-seed', 2);
    expect(chosen).toEqual(greedy);
    expect(rollouts).toBe(0);
  });

  it('takes a delayed payoff that both greedy and one-ply decline', () => {
    const state = contested('sim/rollout/delayed-payoff');
    const bear = named(state, 'Runeclaw Bear');
    const view: RolloutAgentView = {
      ...baseView(state),
      rollout(action, request) {
        return futureObservation(request.seed, targetOf(action) === bear);
      },
    };
    const greedy = decideGreedy(view, DEFAULT_GREEDY_CONFIG);
    const onePly = decideSearch(view, DEFAULT_SEARCH_CONFIG);
    const rollout = decideRollout(view, CONFIG, 'game-seed', 9);

    expect(actionKey(onePly)).toBe(actionKey(greedy));
    expect(actionKey(rollout)).not.toBe(actionKey(greedy));
    expect(targetOf(rollout)).toBe(bear);
  });

  it('rejects a config whose declared work exceeds its per-decision cap', () => {
    const state = contested('sim/rollout/cap');
    const view: RolloutAgentView = {
      ...baseView(state),
      rollout(_action, request) {
        return futureObservation(request.seed, false);
      },
    };
    expect(() =>
      decideRollout(
        view,
        { ...CONFIG, maximumCandidates: 4, rolloutsPerCandidate: 2, maximumRolloutsPerDecision: 7 },
        'game-seed',
        0,
      ),
    ).toThrow(/rollout cap/i);
    expect(() => decideRollout(view, { ...CONFIG, closeMargin: -1 }, 'game-seed', 0)).toThrow(
      /close margin/i,
    );
    expect(() => decideRollout(view, { ...CONFIG, rolloutsPerCandidate: 0 }, 'game-seed', 0)).toThrow(
      /positive integer/i,
    );
  });

  it('crosses the worker boundary as a serializable bot spec', () => {
    const spec = rolloutSpec('rollout', CONFIG);
    const state = contested('sim/rollout/registry');
    const seeds: string[] = [];
    const view: RolloutAgentView = {
      ...baseView(state),
      rollout(action, request) {
        seeds.push(request.seed);
        return futureObservation(request.seed, targetOf(action) === named(state, 'Runeclaw Bear'));
      },
    };
    const greedy = decideGreedy(view, DEFAULT_GREEDY_CONFIG);
    const agent = createBot(spec, 'agent-seed', 0, 'concrete-game-seed');
    expect(spec.kind).toBe('rollout');
    expect(agent.name).toBe('rollout');
    expect(agent.decide(view)).not.toEqual(greedy);
    expect(seeds).not.toHaveLength(0);
    expect(seeds.every((seed) => seed.startsWith('concrete-game-seed/decision/0/'))).toBe(true);
  });

  it('plays a real greedy continuation reproducibly through the driver seam', () => {
    const state = contested('sim/rollout/real-continuation');
    const ownDeck = Object.values(state.objects)
      .filter((object) => object.owner === 0 && !object.token)
      .map((object) => object.card);
    const view = withRolloutPreview(baseView(state), state, {
      ownDeck,
      opponentPool: [SWAMP, BEAR, OGRE],
      previewSeed: 'sim/rollout/real-continuation/preview',
    });
    const action = decideGreedy(view, DEFAULT_GREEDY_CONFIG);
    const request = {
      seed: 'sim/rollout/real-continuation/future',
      turnHorizon: 1,
      greedy: DEFAULT_GREEDY_CONFIG,
    } as const;
    expect(view.rollout?.(action, request)).toStrictEqual(view.rollout?.(action, request));
  });

  it('chooses identically when only concealed hands and libraries differ', () => {
    const position = (
      seed: string,
      ownLibrary: readonly Card[],
      opponentHand: readonly Card[],
      opponentLibrary: readonly Card[],
    ): GameState =>
      scenario({
        seed,
        battlefield: [
          ...Array.from({ length: 3 }, () => ({ card: SWAMP, controller: 0 as PlayerId })),
          { card: BEAR, controller: 0 as PlayerId },
          { card: OGRE, controller: 1 as PlayerId },
        ],
        hands: [[SICKNESS], opponentHand],
        libraries: [ownLibrary, opponentLibrary],
      }).state;
    const first = position(
      'sim/rollout/hidden-invariance',
      [HIDDEN_SMALL, HIDDEN_LARGE, SWAMP],
      [HIDDEN_LARGE],
      [HIDDEN_SMALL, SWAMP],
    );
    const second = position(
      'sim/rollout/hidden-invariance',
      [SWAMP, HIDDEN_SMALL, HIDDEN_LARGE],
      [HIDDEN_SMALL],
      [HIDDEN_LARGE, SWAMP],
    );
    const knowledge = {
      ownDeck: [SICKNESS, SWAMP, SWAMP, SWAMP, SWAMP, BEAR, HIDDEN_SMALL, HIDDEN_LARGE],
      opponentPool: [SWAMP, BEAR, OGRE, HIDDEN_SMALL, HIDDEN_LARGE],
      previewSeed: 'same-public-game/decision/4/preview',
    } as const;
    const firstView = withRolloutPreview(baseView(first), first, knowledge);
    const secondView = withRolloutPreview(baseView(second), second, knowledge);
    const firstGreedy = decideGreedy(firstView, DEFAULT_GREEDY_CONFIG);
    const secondGreedy = decideGreedy(secondView, DEFAULT_GREEDY_CONFIG);
    const request = {
      seed: 'same-public-game/decision/4/candidate/greedy/rollout/0',
      turnHorizon: 2,
      greedy: DEFAULT_GREEDY_CONFIG,
    } as const;

    expect(firstView.previewSettled?.(firstGreedy)).toStrictEqual(secondView.previewSettled?.(secondGreedy));
    expect(firstView.rollout?.(firstGreedy, request)).toStrictEqual(
      secondView.rollout?.(secondGreedy, request),
    );
    expect(actionKey(decideRollout(firstView, CONFIG, 'same-public-game', 4))).toBe(
      actionKey(decideRollout(secondView, CONFIG, 'same-public-game', 4)),
    );
  });

  it('keeps revealed cards fixed while sampling only concealed library slots', () => {
    const state = scenario({
      seed: 'sim/rollout/revealed-top',
      battlefield: [
        ...Array.from({ length: 3 }, () => ({ card: SWAMP, controller: 0 as PlayerId })),
        { card: TOP_REVEALER, controller: 0 as PlayerId },
        { card: OGRE, controller: 1 as PlayerId },
      ],
      hands: [[SICKNESS], []],
      libraries: [[HIDDEN_LARGE, HIDDEN_SMALL], []],
    }).state;
    const top = state.players[0].library[0];
    if (top === undefined) throw new Error('revealed-top fixture has no library card');
    const view = withRolloutPreview(baseView(state), state, {
      ownDeck: [SICKNESS, SWAMP, SWAMP, SWAMP, TOP_REVEALER, HIDDEN_LARGE, HIDDEN_SMALL],
      opponentPool: [SWAMP, OGRE],
      previewSeed: 'sim/rollout/revealed-top/preview',
    });

    const preview = view.previewSettled?.(decideGreedy(view, DEFAULT_GREEDY_CONFIG));

    expect(preview?.objects[top]?.card).toEqual(HIDDEN_LARGE);
  });
});
