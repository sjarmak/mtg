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
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, AgentView, PlayerAgent } from '@mtg/kernel';
import { pendingDecision, scenario, validateAction } from '@mtg/kernel';
import {
  aggregateFingerprint,
  createBot,
  decidedWinRate,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  greedyConfig,
  greedySpec,
  randomBot,
  randomSpec,
  runMatchSerial,
} from '@mtg/sim';
import type { AgentFactory, MatchSpec } from '@mtg/sim';

const decks: MatchSpec['decks'] = [FIXTURE_DECK_RW, { ...FIXTURE_DECK_RW, name: 'RW Mirror' }];

describe('random-policy bot', () => {
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
      expect(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']).toContain(outcome.reason);
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
      const action = randomBot('random', `walker-${String(seed)}`).decide({ state, player: 0, decision });
      expect(validateAction(state, action)).toBeNull();
      if (action.type !== 'declareAttackers') throw new Error('random bot did not attack');
      const defender = action.attackers[0]?.defender;
      if (defender !== undefined) kinds.add(typeof defender === 'number' ? 'player' : defender.kind);
    }
    expect(kinds).toEqual(new Set(['player', 'planeswalker']));
  });
});

describe('custom policies through agentFactory', () => {
  it('accepts a policy the registry has never heard of', () => {
    /** A deliberately terrible policy: never attack, never block, never cast. */
    const pacifist: AgentFactory = (spec, seed, seat) => {
      const fallback = createBot(spec, seed, seat);
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
        agentFactory: (spec, seed, seat) =>
          seat === 1 ? pacifist(spec, seed, seat) : createBot(spec, seed, seat),
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
 * machine that was merely busy. It reached 2205ms under a five-lane wave
 * (mtg-w45), which is what put the file on the near-limit list; the work that is
 * left is real — 164 seeded games through the kernel — and at a fifth of the
 * budget it needs no clock of its own.
 */
describe('heuristic profiles are load-bearing', () => {
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
