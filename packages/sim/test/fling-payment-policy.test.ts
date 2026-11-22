/**
 * `mtg-sejo`, reported from a played game: "I was at 21 life with a 4/2 in play
 * and they had a creature and a 2/3 flying first strike and they cast Fling
 * sacrificing their flyer to do 2 damage to me."
 *
 * Two defects meet in that line. The kernel enumerates one cast option per
 * legal sacrifice set and nothing else about the option changes with it, so an
 * unpriced payment left the policy keeping whichever option was enumerated
 * first. And `paidSacrificePower` scored zero, so the whole of Fling's payload
 * was invisible to the scorer that was choosing between them.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId } from '@mtg/kernel';
import { legalActions, scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { bestTargetingPerCard, chooseCast } from '../src/policies/cast';

const FLING = parseCard({
  kind: 'instant',
  id: 'm11-139-fling-policy',
  name: 'Fling',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 139 },
  colors: ['R'],
  manaCost: { generic: 1, R: 1 },
  additionalCost: { sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
  effects: [{ kind: 'dealDamage', amount: { kind: 'paidSacrificePower' }, target: { kind: 'anyTarget' } }],
} as unknown as CardInput);

const FLIER = parseCard({
  kind: 'creature',
  id: 'policy-flier',
  name: 'Wind Sergeant',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  power: 2,
  toughness: 3,
  keywords: ['flying', 'firstStrike'],
} as unknown as CardInput);

const SPARE = parseCard({
  kind: 'creature',
  id: 'policy-spare',
  name: 'Village Hand',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  colors: ['R'],
  manaCost: { generic: 1, R: 1 },
  power: 2,
  toughness: 1,
} as unknown as CardInput);

const MOUNTAIN = parseCard({
  kind: 'land',
  id: 'policy-mountain',
  name: 'Mountain',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 3 },
  basicLandType: 'Mountain',
  supertypes: ['basic'],
  producesMana: ['R'],
} as unknown as CardInput);

const ATTACKER = parseCard({
  kind: 'creature',
  id: 'policy-attacker',
  name: 'Opposing Brute',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 4 },
  colors: ['G'],
  manaCost: { generic: 3, G: 1 },
  power: 4,
  toughness: 2,
} as unknown as CardInput);

/**
 * The bot's own profile with the instant-holding timing rule off, so every test
 * here is about the payment rather than about whether a main-phase instant is
 * cast at all. `castTimingAllows` is `cast.ts`'s other heuristic and has its
 * own tests.
 */
const CONFIG = {
  ...DEFAULT_GREEDY_CONFIG,
  cast: { ...DEFAULT_GREEDY_CONFIG.cast, holdInstants: false },
};

/** The reported board, from the bot's seat: it is player 0, the person is 1. */
function board(bodies: readonly ReturnType<typeof parseCard>[]): GameState {
  return scenario({
    life: [20, 21],
    battlefield: [
      ...bodies.map((card) => ({ card, controller: 0 as const })),
      { card: MOUNTAIN, controller: 0 as const },
      { card: MOUNTAIN, controller: 0 as const },
      { card: ATTACKER, controller: 1 as const },
    ],
    hands: [[FLING], []],
  }).state;
}

function viewOf(state: GameState): AgentView {
  const options = legalActions(state).filter(
    (action) => action.type !== 'passPriority' && action.type !== 'concede',
  );
  return {
    state: observeState(state, 0, 'test/fling-payment-policy.test.ts:106'),
    player: 0,
    decision: { kind: 'priority', player: 0, options, complete: true },
  };
}

function oidNamed(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no ${name} on the battlefield`);
  return found;
}

function flingCandidate(state: GameState): { readonly action: Action; readonly value: number } {
  const candidate = bestTargetingPerCard(viewOf(state), CONFIG).find((entry) => entry.card.name === 'Fling');
  if (candidate === undefined) throw new Error('the policy offered no Fling candidate');
  return candidate;
}

describe('paying Fling', () => {
  it('enumerates a cast option per creature and per target, so the choice is the policy&apos;s', () => {
    const state = board([FLIER, SPARE]);
    const flings = legalActions(state).filter(
      (action) => action.type === 'castSpell' && state.objects[action.oid]?.card.name === 'Fling',
    );
    expect(flings.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The reported line, exactly: two damage at a player on 21 life, paid for
   * with the better of two bodies, while a 4/2 that the same two damage kills
   * stands across the table. Both halves came from `paidSacrificePower`
   * predicting zero — a Fling that deals nothing kills nothing, so removal and
   * face scored alike, and the two payment options scored alike too.
   */
  it('kills the 4/2 rather than sending two damage at a player on 21 life', () => {
    const state = board([FLIER, SPARE]);
    const chosen = flingCandidate(state).action;
    if (chosen.type !== 'castSpell') throw new Error('the policy chose something other than a cast');
    expect(chosen.targets).toEqual([{ kind: 'permanent', oid: oidNamed(state, 'Opposing Brute') }]);
  });

  it('scores the damage the payment will deal rather than zero', () => {
    // One power of difference between the two payments is one point of damage,
    // and the scorer has to see it: it read zero for every option before, which
    // is what made the two payments and the two targets indistinguishable.
    const spare = flingCandidate(board([SPARE])).value;
    const flier = flingCandidate(board([FLIER])).value;
    expect(flier).not.toBe(spare);
  });

  it('pays with the cheaper body when either one does the job', () => {
    // The 2/1 and the 2/3 flier each deal the two damage that kills the 4/2, so
    // the payment is decided by what it gives up. Enumeration order offers the
    // flier first, which is the order the reported game took it in.
    const state = board([FLIER, SPARE]);
    const chosen = flingCandidate(state).action;
    if (chosen.type !== 'castSpell') throw new Error('the policy chose something other than a cast');
    expect(chosen.sacrifices).toEqual([oidNamed(state, 'Village Hand')]);
  });

  it('holds the card when the only body that pays is worth more than the play', () => {
    // Nothing to remove: the whole payload is two damage at a player on 21, and
    // a 2/3 flying first striker is worth more than that.
    const state = scenario({
      life: [20, 21],
      battlefield: [
        { card: FLIER, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[FLING], []],
    }).state;
    expect(chooseCast(viewOf(state), CONFIG)).toBeNull();
  });
});
