/**
 * The tier-1.5 bot: one ply of lookahead over the greedy policies (`mtg-y4gw`).
 *
 * The acceptance criterion this file exists for is stated as a negative: the
 * search must refuse `bot-aura.test.ts`'s Quag Sickness play "with no
 * aura-specific code in it". A passing test does not prove that on its own,
 * because the greedy policies underneath now DO know what an Aura is
 * (`mtg-4aaw` taught them), and a search sitting on a policy that already picks
 * correctly would pass while proving nothing.
 *
 * So the policy underneath is skewed until it picks the wrong host on purpose.
 * `SKEWED` is `DEFAULT_GREEDY_CONFIG` with `ownGoalPenalty` negated: the
 * sentinel that stops the bot pointing its own removal at its own board becomes
 * a bounty for doing exactly that, and the greedy bot really does enchant its
 * own 2/2. This file asserts that first, because a control that is not checked
 * is not a control. The search over THE SAME config takes the other host, and
 * the search reads no policy weight at all on the way — `decideSearch` consults
 * `evaluateState`, which knows about bodies, life and cards in hand and has
 * never heard of an Aura.
 *
 * The first attempt at this control zeroed every weight in `TargetPolicyConfig`
 * and did not work, which is worth recording: the Aura arm of `scoreTargets`
 * prices a host through `boardCreatureValue`, the evaluator every policy shares,
 * so a config of zeroes still ranks the 6/6 above the 2/2. Zeroing the weights
 * blinds the arithmetic and not the knowledge.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import type { AgentView } from '@mtg/kernel';
import {
  agentView,
  observeState,
  pendingDecision,
  reduce,
  scenario,
  settleAgentAction,
  validateAction,
} from '@mtg/kernel';
import type { GreedyBotConfig, SearchBotConfig, TargetPolicyConfig } from '@mtg/sim';
import {
  createBot,
  DEFAULT_GREEDY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_STATE_EVAL_CONFIG,
  decideGreedy,
  decideSearch,
  evaluateState,
  quiesce,
  searchSpec,
} from '@mtg/sim';
import { creature, SWAMP } from './cards';

/**
 * The policy, told to aim at its own board.
 *
 * `ownGoalPenalty` is documented in `../src/config` as a sentinel large enough
 * that no tuple aiming our own removal at our own stuff ever wins a ranking.
 * Negating it turns the sentinel around, which is the smallest possible edit
 * that makes the depth-0 bot wrong about this exact position and leaves every
 * other number it reads alone.
 */
const SKEWED_TARGET: TargetPolicyConfig = { ...DEFAULT_GREEDY_CONFIG.target, ownGoalPenalty: -1000 };

const SKEWED_GREEDY: GreedyBotConfig = { ...DEFAULT_GREEDY_CONFIG, target: SKEWED_TARGET };
const SKEWED_SEARCH: SearchBotConfig = {
  greedy: SKEWED_GREEDY,
  state: DEFAULT_STATE_EVAL_CONFIG,
};

/** `Enchanted creature gets -1/-1 for each Swamp you control.` — Quag Sickness (M11 111). */
const SICKNESS: Card = parseCard({
  kind: 'enchantment',
  id: 'ref-quag-sickness',
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

/**
 * `bot-aura.test.ts`'s position: our 2/2, their 6/6, three Swamps and the Aura
 * in hand. Three Swamps make it -3/-3, which is lethal on the 2/2 and a debuff
 * on the 6/6, so the two hosts differ by a whole creature — the thing a bot that
 * looks at the resulting board cannot miss and a bot that scores a target tuple
 * has to be taught.
 */
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

function viewOf(state: GameState): AgentView {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  return agentView(state, 0, decision, 'search-test', (action) => settleAgentAction(state, action));
}

/** Each legal host, scored by `evaluateState` after `settle` has been applied to the line. */
function hostScores(state: GameState, settle: (next: GameState) => GameState): ReadonlyMap<ObjectId, number> {
  const scores = new Map<ObjectId, number>();
  for (const option of viewOf(state).decision.options) {
    const host = hostOf(option);
    if (host === null) continue;
    const next = settle(reduce(state, option).state);
    scores.set(
      host,
      evaluateState(
        SKEWED_GREEDY.cast,
        DEFAULT_STATE_EVAL_CONFIG,
        observeState(next, 0, `search-test:${host}`),
        0,
      ),
    );
  }
  return scores;
}

/** The host an action aims at, or `null` when it is not a cast at a permanent. */
function hostOf(action: {
  readonly type: string;
  readonly targets?: readonly (Target | null)[];
}): ObjectId | null {
  if (action.type !== 'castSpell') return null;
  const target = action.targets?.[0];
  if (target === undefined || target === null || target.kind !== 'permanent') return null;
  return target.oid;
}

describe('a policy skewed at its own board', () => {
  it('really does enchant our own creature, which is the control this file needs', () => {
    const state = contested('sim/search/aura/control');
    const action = decideGreedy(viewOf(state), SKEWED_GREEDY);
    expect(validateAction(state, action)).toBeNull();
    expect(hostOf(action)).toBe(named(state, 'Runeclaw Bear'));
  });

  it('is the only thing skewed: the default policy still picks the opponent', () => {
    const state = contested('sim/search/aura/default');
    expect(hostOf(decideGreedy(viewOf(state), DEFAULT_GREEDY_CONFIG))).toBe(named(state, 'Opposing Ogre'));
  });
});

describe('one ply of lookahead', () => {
  it('puts the hostile Aura on the opponent creature with no aura-specific code', () => {
    const state = contested('sim/search/aura/search');
    const action = decideSearch(viewOf(state), SKEWED_SEARCH);
    expect(validateAction(state, action)).toBeNull();
    expect(hostOf(action)).toBe(named(state, 'Opposing Ogre'));
  });

  it('needs the line settled: raw reduce leaves the Aura on the stack and the hosts tied', () => {
    const state = contested('sim/search/aura/stack');
    const scores = hostScores(state, (next) => next);
    // Both -7.2. `reduce` runs forward to the next decision and that decision is
    // priority with the spell still on the stack, so the two boards differ by
    // which target a stack entry names and by nothing on the battlefield.
    expect(scores.get(named(state, 'Runeclaw Bear'))).toBe(scores.get(named(state, 'Opposing Ogre')));
  });

  it('prices the two hosts apart once the line is settled, by about the creature it kills', () => {
    const state = contested('sim/search/aura/scores');
    const scores = hostScores(state, quiesce);
    const ours = scores.get(named(state, 'Runeclaw Bear')) ?? 0;
    const theirs = scores.get(named(state, 'Opposing Ogre')) ?? 0;
    // -12.8 against -0.8. The gap is the 2/2 the Aura kills when it lands on our
    // own side, valued the way every other policy values it.
    expect(theirs).toBeGreaterThan(ours);
    expect(theirs - ours).toBeGreaterThan(10);
  });
});

describe('the horizon rule', () => {
  it('passes when the policy passes, rather than scoring a pass against a play', () => {
    // An empty hand and no land to play, so the only thing greedy can do at
    // priority is pass. The pass is scored against nothing, which is the whole
    // rule: `reduce` on a pass runs forward through the opponent's entire turn
    // and `reduce` on a play stops at the play, so the two are never comparable.
    const state = scenario({
      seed: 'sim/search/horizon/pass',
      battlefield: [{ card: BEAR, controller: 0 as PlayerId }],
      hands: [[], []],
    }).state;
    const action = decideSearch(viewOf(state), DEFAULT_SEARCH_CONFIG);
    expect(action.type).toBe('passPriority');
    expect(action).toEqual(decideGreedy(viewOf(state), DEFAULT_GREEDY_CONFIG));
  });

  it('ranks only the options that do the same kind of thing', () => {
    // The Aura position offers casts and a pass. Greedy casts, so the pass is
    // out of the candidate set entirely and every candidate settles to a board
    // taken at the same moment.
    const state = contested('sim/search/horizon/cast');
    const options = viewOf(state).decision.options;
    expect(options.some((option) => option.type === 'passPriority')).toBe(true);
    const action = decideSearch(viewOf(state), SKEWED_SEARCH);
    expect(action.type).toBe('castSpell');
  });
});

describe('the registry', () => {
  it('builds a search seat from a spec, so it crosses a worker boundary as data', () => {
    const spec = searchSpec('search', SKEWED_SEARCH);
    expect(spec.kind).toBe('search');
    const agent = createBot(spec, 'seed', 0);
    expect(agent.name).toBe('search');
    const state = contested('sim/search/aura/registry');
    const action = agent.decide(viewOf(state));
    expect(hostOf(action)).toBe(named(state, 'Opposing Ogre'));
  });

  it('defaults to the greedy profile and the state weights', () => {
    expect(DEFAULT_SEARCH_CONFIG.greedy).toBe(DEFAULT_GREEDY_CONFIG);
    expect(DEFAULT_SEARCH_CONFIG.state).toBe(DEFAULT_STATE_EVAL_CONFIG);
  });
});
