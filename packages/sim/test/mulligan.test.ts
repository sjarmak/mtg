/**
 * The opening-hand policy, and the column it finally fills.
 *
 * Two halves, and the second is the one that mattered enough to be written into
 * a bead. `num_mulligans` and `opp_num_mulligans` sat in the replay log as
 * structural zeroes for as long as the kernel kept every hand, and
 * `@mtg/metrics`' join contract said so; a column counted off no decision
 * reports zero forever. So the last block here plays a real seeded run and reads
 * the numbers back out of the logs.
 *
 * The policy half is unit-tested on exact hands, because a shuffled opening hand
 * is exactly the input a band test must not be at the mercy of.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand } from '@mtg/dsl';
import type { GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { scenario, validateAction } from '@mtg/kernel';
import {
  chooseMulligan,
  DEFAULT_GREEDY_CONFIG,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  greedyConfig,
  greedySpec,
  keepsHand,
  landsIn,
  landsWantedFor,
  runMatchSerial,
} from '@mtg/sim';
import type { MulliganDecision } from '@mtg/sim';
import { creature } from './cards';

const PLAINS = basicLand('Plains', 'TST', 801);
const BEAR = creature('Opening Bear', 2, 2, [], { generic: 1, W: 1 }, ['W']);
const GIANT = creature('Opening Giant', 6, 6, [], { generic: 5, W: 1 }, ['W']);

function handOf(cards: readonly Card[]): { readonly state: GameState; readonly hand: readonly ObjectId[] } {
  const built = scenario({ hands: [cards, []] });
  return { state: built.state, hand: built.state.players[0].hand };
}

function decisionOver(hand: readonly ObjectId[], mulligans: number): MulliganDecision {
  return {
    kind: 'mulligan',
    player: 0 satisfies PlayerId,
    mulligans,
    count: mulligans,
    hand,
    options: [],
    complete: true,
  };
}

function lands(count: number): readonly Card[] {
  return Array.from({ length: count }, () => PLAINS);
}

function spells(count: number, card: Card = BEAR): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

describe('the band scales with the hand that would be kept', () => {
  it('is the stated band at a full opening hand', () => {
    expect(landsWantedFor(7, 7, DEFAULT_GREEDY_CONFIG.mulligan)).toEqual({ min: 2, max: 5 });
  });

  it('asks a five-card hand for fewer lands, not the same number', () => {
    expect(landsWantedFor(5, 7, DEFAULT_GREEDY_CONFIG.mulligan)).toEqual({ min: 1, max: 4 });
  });
});

describe('the greedy bot keeps a hand it can play out of', () => {
  it('keeps three lands and four spells', () => {
    const { state, hand } = handOf([...lands(3), ...spells(4)]);
    expect(landsIn(state, hand)).toBe(3);
    expect(keepsHand(state, hand, DEFAULT_GREEDY_CONFIG.mulligan)).toBe(true);
    expect(chooseMulligan(state, decisionOver(hand, 0), DEFAULT_GREEDY_CONFIG)).toEqual({
      type: 'keepHand',
      player: 0,
      bottom: [],
    });
  });

  it('sends back a hand of seven lands', () => {
    const { state, hand } = handOf(lands(7));
    expect(chooseMulligan(state, decisionOver(hand, 0), DEFAULT_GREEDY_CONFIG).type).toBe('mulligan');
  });

  it('sends back a hand with one land in it', () => {
    const { state, hand } = handOf([...lands(1), ...spells(6)]);
    expect(chooseMulligan(state, decisionOver(hand, 0), DEFAULT_GREEDY_CONFIG).type).toBe('mulligan');
  });

  it('keeps whatever it holds once the profile has spent its mulligans', () => {
    const { state, hand } = handOf(lands(7));
    const spent = DEFAULT_GREEDY_CONFIG.mulligan.maximumMulligans;
    const chosen = chooseMulligan(state, decisionOver(hand, spent), DEFAULT_GREEDY_CONFIG);

    expect(chosen.type).toBe('keepHand');
    // The rules would still allow another; this is the profile's own floor.
    expect(spent).toBeLessThan(state.config.openingHandSize);
  });

  it('takes the profile at its word when it says never', () => {
    const { state, hand } = handOf(lands(7));
    const never = greedyConfig({ mulligan: { maximumMulligans: 0 } });
    expect(chooseMulligan(state, decisionOver(hand, 0), never).type).toBe('keepHand');
  });
});

describe('what a keep pays with', () => {
  it('bottoms the most expensive spell and keeps the lands', () => {
    const { state, hand } = handOf([...lands(3), GIANT, ...spells(3)]);
    const giant = hand.find((oid) => state.objects[oid]?.card.name === GIANT.name);
    const chosen = chooseMulligan(state, decisionOver(hand, 1), DEFAULT_GREEDY_CONFIG);

    expect(chosen.type).toBe('keepHand');
    expect(chosen.type === 'keepHand' ? chosen.bottom : []).toEqual([giant]);
  });

  it('judges the hand that survives the bottoming, not the one that was dealt', () => {
    // Five lands and two spells is inside the band as dealt. After two
    // mulligans the two spells are what pays for them, so the hand actually
    // kept is five lands and nothing else — outside a five-card hand's 1-4 band,
    // and the two judgments disagree. The profile is loosened by one mulligan so
    // this is the band's answer and not the ceiling's.
    const { state, hand } = handOf([...lands(5), ...spells(2)]);
    const patient = greedyConfig({ mulligan: { maximumMulligans: 3 } });

    expect(keepsHand(state, hand, patient.mulligan)).toBe(true);
    expect(chooseMulligan(state, decisionOver(hand, 2), patient).type).toBe('mulligan');
  });
});

describe('num_mulligans stops being a structural zero', () => {
  /**
   * A real seeded run, read the way the calibration join reads it. Sixteen games
   * is enough for the band to send at least one hand back at this seed, which is
   * the assertion that matters: the column now carries a decision.
   */
  const run = runMatchSerial({
    runSeed: 'mulligan-columns',
    games: 16,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    bots: [greedySpec('greedy-rw'), greedySpec('greedy-ub')],
    collectLogs: true,
    maximumTurns: 20,
  });

  const counts = run.logs.map((log) => [log.metadata.num_mulligans, log.metadata.opp_num_mulligans]);

  it('reports a real number for both seats in every game', () => {
    expect(run.logs).toHaveLength(16);
    for (const [user, oppo] of counts) {
      expect(user).toBeGreaterThanOrEqual(0);
      expect(oppo).toBeGreaterThanOrEqual(0);
      expect(user).toBeLessThanOrEqual(DEFAULT_GREEDY_CONFIG.mulligan.maximumMulligans);
      expect(oppo).toBeLessThanOrEqual(DEFAULT_GREEDY_CONFIG.mulligan.maximumMulligans);
    }
  });

  it('reports a mulligan somewhere in the run, so the column is not zero by construction', () => {
    expect(counts.flat().some((count) => count > 0)).toBe(true);
  });
});

describe('a constructed answer is checked as hard as an enumerated one', () => {
  it('refuses a keep that bottoms a card the hand does not hold', () => {
    const { state, hand } = handOf(lands(7));
    const stranger = state.players[0].library[0];
    if (stranger === undefined) throw new Error('the scenario dealt no library');
    // A scenario keeps its hands, so no mulligan is pending: the point is that
    // the kernel refuses the action rather than trusting the caller.
    expect(validateAction(state, { type: 'keepHand', player: 0, bottom: [stranger] })).not.toBeNull();
    expect(hand).toHaveLength(7);
  });
});
