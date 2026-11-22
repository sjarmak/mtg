/**
 * The pluggable agent seam.
 *
 * Three things are proved here:
 *
 *  1. The random-policy bot is a first-class citizen — it runs through the same
 *     registry, the same driver and the same runner as the greedy bots, and the
 *     declarations it constructs are accepted by the kernel.
 *  2. A policy the registry has never heard of plugs in through `agentFactory`.
 *  3. The heuristics are load-bearing: greedy beats random decisively, and a
 *     profile change measurably changes how the bot plays.
 *
 * # Why two of the blocks carry a clock of their own
 *
 * `mtg-0jge`. Every case here pays for real seeded games through the kernel, and
 * the two blocks below run the most of them. Measured on this box with nothing
 * else on it, the longest case in each takes 3582ms and 3337ms, which is 72% and
 * 67% of vitest's 5s default. That is not headroom; it is a file that goes red
 * the first time another lane takes the cores, and it did, on three separate
 * full-suite runs.
 *
 * The budget is 20s for the audited checkpoint seed test's reason: the
 * measurement plus room for a loaded machine. A case that has
 * genuinely become slow still goes red; a case that was merely queued behind
 * another lane no longer does. It is the second half of a fix rather than the
 * whole of one — `mtg-qn2d` capped the worker pool at `1add4154`, which bounds
 * how much of the queueing this run can cause itself, and nothing either of them
 * does bounds what the other four lanes on the box are doing.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, AgentView, PlayerAgent } from '@mtg/kernel';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import {
  aggregateFingerprint,
  createBot,
  decidedWinRate,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  FIXTURE_FORMAT_POOL,
  greedyConfig,
  greedySpec,
  randomBot,
  randomSpec,
  rolloutSpec,
  runMatchSerial,
} from '@mtg/sim';
import type { AgentFactory, MatchSpec } from '@mtg/sim';
import { creature, creatureWithStatic } from './cards';

const decks: MatchSpec['decks'] = [FIXTURE_DECK_RW, { ...FIXTURE_DECK_RW, name: 'RW Mirror' }];

describe('random-policy bot', { timeout: 20_000 }, () => {
  it('plays complete games through the same runner', () => {
    const run = runMatchSerial({
      runSeed: 'seam/random',
      games: 12,
      decks,
      bots: [randomSpec('r0'), randomSpec('r1')],
    });
    expect(run.outcomes).toHaveLength(12);
    for (const outcome of run.outcomes) {
      expect(outcome.turns).toBeGreaterThan(0);
      expect(['lifeZero', 'emptyLibrary', 'spellOrAbility', 'concede', 'turnLimit']).toContain(
        outcome.reason,
      );
    }
  });

  it('is beaten decisively by the greedy heuristics', () => {
    const run = runMatchSerial({
      runSeed: 'seam/greedy-vs-random',
      games: 40,
      decks,
      bots: [greedySpec('greedy'), randomSpec('random')],
    });
    expect(decidedWinRate(run.aggregate, 0)).toBeGreaterThan(0.85);
  });

  it('constructs its own declarations rather than only sampling options', () => {
    // A random bot built directly (not through the registry) still satisfies the
    // kernel's PlayerAgent contract, which is the whole seam.
    const bot: PlayerAgent = randomBot('direct', 'seed');
    expect(bot.name).toBe('direct');
    expect(typeof bot.decide).toBe('function');
  });

  it('deterministically samples both player and planeswalker attack defenders', () => {
    const walker = parseCard({
      kind: 'planeswalker',
      id: 'random-bot-walker',
      name: 'Chance Arbiter',
      rarity: 'rare',
      set: { code: 'BOT', collectorNumber: 2 },
      manaCost: { generic: 3 },
      colors: [],
      supertypes: ['legendary'],
      subtypes: ['Tactician'],
      startingLoyalty: 3,
    });
    const state = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        {
          card: parseCard({
            kind: 'creature',
            id: 'random-bot-attacker',
            name: 'Coin Charger',
            rarity: 'common',
            set: { code: 'BOT', collectorNumber: 3 },
            manaCost: { generic: 2 },
            colors: [],
            power: 2,
            toughness: 2,
          }),
          controller: 0,
          summoningSick: false,
        },
        { card: walker, controller: 1 },
      ],
    }).state;
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack decision');
    const kinds = new Set<string>();
    for (let seed = 0; seed < 64; seed += 1) {
      const action = randomBot('random', `walker-${String(seed)}`).decide({
        state: observeState(state, 0, 'test/agent-seam.test.ts:124'),
        player: 0,
        decision,
      });
      expect(validateAction(state, action)).toBeNull();
      if (action.type !== 'declareAttackers') throw new Error('random bot did not attack');
      const defender = action.attackers[0]?.defender;
      if (defender !== undefined) kinds.add(typeof defender === 'number' ? 'player' : defender.kind);
    }
    expect(kinds).toEqual(new Set(['player', 'planeswalker']));
  });

  // #301: a coin flip per creature ignored CR 508.1d and 509.1c, and the kernel
  // refused 12 of 400 random games on reduced M11 and RTR for it.
  it('sends a creature that attacks each combat if able, on every seed', () => {
    const state = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        {
          card: creatureWithStatic('Berserk Runt', 2, 2, { kind: 'attacksEachCombatIfAble' }),
          controller: 0,
          summoningSick: false,
        },
        { card: creature('Idle Squire', 1, 1), controller: 0, summoningSick: false },
      ],
    }).state;
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack decision');
    for (let seed = 0; seed < 32; seed += 1) {
      const action = randomBot('random', `runt-${String(seed)}`).decide({
        state: observeState(state, 0, 'test/agent-seam.test.ts:runt'),
        player: 0,
        decision,
      });
      expect(validateAction(state, action)).toBeNull();
    }
  });

  it('puts every able blocker in front of a must-be-blocked attacker, on every seed', () => {
    const board = scenario({
      active: 1,
      step: 'declareAttackers',
      battlefield: [
        { card: creatureWithStatic('Lure Colossus', 6, 6, { kind: 'mustBeBlockedIfAble' }), controller: 1 },
        { card: creature('Whelp A', 1, 1), controller: 0 },
        { card: creature('Whelp B', 1, 1), controller: 0 },
      ],
    }).state;
    const lure = Object.keys(board.objects).find((oid) => board.objects[oid]?.card.name === 'Lure Colossus');
    if (lure === undefined) throw new Error('missing lure');
    let state = reduce(board, {
      type: 'declareAttackers',
      player: 1,
      attackers: [{ oid: lure, defender: 0 }],
    }).state;
    for (let guard = 0; guard < 16; guard += 1) {
      const pending = pendingDecision(state);
      if (pending === null || pending.kind !== 'priority') break;
      state = reduce(state, { type: 'passPriority', player: pending.player }).state;
    }
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'declareBlockers') throw new Error('no block decision');
    for (let seed = 0; seed < 32; seed += 1) {
      const action = randomBot('random', `lure-${String(seed)}`).decide({
        state: observeState(state, 0, 'test/agent-seam.test.ts:lure'),
        player: 0,
        decision,
      });
      expect(validateAction(state, action)).toBeNull();
    }
  });
});

describe('custom policies through agentFactory', () => {
  it('hands registry bots the concrete game seed separately from the seat seed', () => {
    const seen: string[] = [];
    const recordingFactory: AgentFactory = function (spec, seed, seat, gameSeed) {
      seen.push(gameSeed);
      return createBot(greedySpec(spec.name), seed, seat, gameSeed);
    };
    runMatchSerial(
      {
        runSeed: 'seam/concrete-game-seed',
        games: 1,
        decks,
        rolloutPool: FIXTURE_FORMAT_POOL,
        bots: [rolloutSpec('rollout'), greedySpec('greedy')],
      },
      { agentFactory: recordingFactory },
    );
    expect(seen).toEqual(['seam/concrete-game-seed/game/0', 'seam/concrete-game-seed/game/0']);
  });

  it('accepts a policy the registry has never heard of', () => {
    /** A deliberately terrible policy: never attack, never block, never cast. */
    const pacifist: AgentFactory = (spec, seed, seat, gameSeed) => {
      const fallback = createBot(spec, seed, seat, gameSeed);
      return {
        name: `pacifist-${spec.name}`,
        decide(view: AgentView): Action {
          switch (view.decision.kind) {
            case 'priority':
              return { type: 'passPriority', player: view.player };
            case 'declareAttackers':
              return { type: 'declareAttackers', player: view.player, attackers: [] };
            case 'declareBlockers':
              return { type: 'declareBlockers', player: view.player, blocks: [] };
            default:
              return fallback.decide(view);
          }
        },
      };
    };

    const baseline = runMatchSerial({
      runSeed: 'seam/custom',
      games: 8,
      decks,
      bots: [greedySpec('greedy'), greedySpec('greedy')],
    });
    const withPacifist = runMatchSerial(
      { runSeed: 'seam/custom', games: 8, decks, bots: [greedySpec('greedy'), greedySpec('greedy')] },
      {
        agentFactory: (spec, seed, seat, gameSeed) =>
          seat === 1 ? pacifist(spec, seed, seat, gameSeed) : createBot(spec, seed, seat, gameSeed),
      },
    );
    expect(withPacifist.aggregate.wins[0]).toBe(8);
    expect(aggregateFingerprint(withPacifist.aggregate)).not.toBe(aggregateFingerprint(baseline.aggregate));
  });
});

/**
 * Two claims about the config, one baseline between them.
 *
 * Both cases say the same kind of thing — a profile change moves the run's
 * fingerprint — and each was building its own 24-game `[default, default]`
 * baseline under a run seed of its own, so the block played 96 games to compare
 * 48. What a fingerprint comparison needs is that the two arms share a seed, not
 * that the seed is unused elsewhere, so the baseline is built once and each case
 * still runs its own tuned arm against it.
 *
 * Neither claim is weakened by that: each case still contrasts a tuned profile
 * with an untuned one over 24 seeded games and still fails if the config section
 * it names stops reaching the bots. Setting the tuned arm equal to the default
 * fails both cases, which is the check being a check.
 *
 * Measured on a contended box, three other lanes running, at a 1-minute load
 * average of 14-16 on 16 cores: 1978ms and 1519ms before, 982ms and 499ms after,
 * against vitest's 5s default — the first of those was 40% of the budget on a
 * machine that was merely busy. That halving is why the block plays 48 games
 * instead of 96, and it is not enough on its own: the case that pays for the
 * shared baseline takes 3337ms on a quiet box, so it carries the file's 20s
 * budget for the reason the header gives.
 */
describe('heuristic profiles are load-bearing', { timeout: 20_000 }, () => {
  const base: MatchSpec = {
    runSeed: 'seam/profile',
    games: 24,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    bots: [greedySpec('default'), greedySpec('default')],
  };
  let untuned: string | null = null;

  /** The baseline fingerprint, paid inside whichever case runs first. */
  function baseline(): string {
    untuned ??= aggregateFingerprint(runMatchSerial(base).aggregate);
    return untuned;
  }

  it('a different profile produces a different run', () => {
    const tuned: MatchSpec = {
      ...base,
      bots: [
        greedySpec(
          'reckless',
          greedyConfig({
            attack: { acceptableTradeLoss: 100, defensiveThreatRatio: Number.POSITIVE_INFINITY },
            block: { chumpWhenLethal: false },
          }),
        ),
        greedySpec('default'),
      ],
    };
    expect(aggregateFingerprint(runMatchSerial(tuned).aggregate)).not.toBe(baseline());
  });

  it('overrides the race section per bot, not only the per-decision ones', () => {
    // Race awareness switched off on one seat only, which is the claim: the two
    // seats of one match run different race profiles rather than sharing a
    // module-level default.
    const grinder = greedyConfig({
      race: { holdBackWhileWinning: true, racingTradeLoss: 0, racingBlockPremium: 0, threatWeight: 0 },
    });
    const tuned: MatchSpec = { ...base, bots: [greedySpec('grinder', grinder), greedySpec('default')] };
    expect(aggregateFingerprint(runMatchSerial(tuned).aggregate)).not.toBe(baseline());
  });
});
