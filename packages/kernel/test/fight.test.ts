/**
 * CR 701.12, driven through the reducer.
 *
 * A fight is the only effect in the vocabulary that damages the permanent it is
 * printed on, and every assertion here is about one of the three sentences in
 * that rule.
 *
 * CR 701.12a — *each* creature deals damage equal to its power to the other. So
 * the interesting boards are the ones where the two answers differ: a 3/3 into
 * a 3/3 trades, a 4/4 into a 2/2 does not, and deathtouch on either side wins
 * regardless of the numbers. Reading only the target's damage would pass on a
 * kernel that had implemented a burn spell.
 *
 * CR 120.3 — damage dealt at the same time is dealt simultaneously, which is
 * what makes the trade a trade. Two `applyDamage` calls instead of one would
 * kill the target and then look for a creature that is no longer there, so the
 * fighter would survive every fight it won and the mutual kill would never
 * happen. `packages/kernel/src/effects.ts` builds both instances and hands them
 * over together for exactly this.
 *
 * CR 701.12c — if either creature has left the battlefield or stopped being a
 * creature, *neither* is dealt damage. The target half is the ordinary CR
 * 608.2b recheck every targeted effect gets. The source half is not: the source
 * is not a target and nothing rechecks it, so the arm that asks about it is the
 * one branch here that no other primitive exercises, and the last describe is
 * that branch.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, Keyword } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario } from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { apply, damageOn, inGraveyard, oidOf } from './helpers';

/** `When CARDNAME enters the battlefield, it fights target creature you don't control.` */
const FIGHT_ON_ENTER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
};

/** `Destroy target creature.`, held by the opponent so the source can be answered. */
const VERDICT: Card = instant(
  'Mortal Verdict',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { generic: 1 },
);

function fighter(power: number, toughness: number, keywords: readonly Keyword[] = []): Card {
  return creature('Grasping Bramble', power, toughness, {
    cost: { generic: 2, G: 1 },
    keywords,
    abilities: [FIGHT_ON_ENTER],
  });
}

/**
 * The fighter in hand with lands to cast it, one creature across the table, and
 * one of this seat's own on the battlefield.
 *
 * The ally is the negative control on the enumeration: a board with enemies
 * alone would pass on a kernel that had ignored the target kind and offered
 * every creature it could find.
 */
function board(
  source: Card,
  enemies: readonly Card[],
  options: { readonly opponentHolds?: readonly Card[] } = {},
): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: creature('Thornwood Scrub', 1, 1), controller: 0 },
      ...enemies.map((card) => ({ card, controller: 1 as const })),
      ...lands(FOREST, 3).map((card) => ({ card, controller: 0 as const })),
      ...lands(FOREST, 2).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[source], [...(options.opponentHolds ?? [])]],
  });
  return { state: start.state, events: [...start.events] };
}

/** Casts the one card in this seat's hand, which is always the fighter. */
function cast(current: ReduceResult, player: 0 | 1): ReduceResult {
  const inHand = current.state.players[player].hand[0];
  if (inHand === undefined) throw new Error(`player ${player} has nothing to cast`);
  return apply(current, { type: 'castSpell', player, oid: inHand, targets: [] });
}

/** Passes priority until somebody is asked something that is not priority. */
function passUntilAsked(from: ReduceResult, limit = 40): ReduceResult {
  let current = from;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('passUntilAsked: nothing but priority was ever asked');
}

/** The permanents the pending trigger is offering to fight. */
function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
  return decision.options.flatMap((option) =>
    option.type === 'chooseTriggerTargets' && option.targets[0]?.kind === 'permanent'
      ? [option.targets[0].oid]
      : [],
  );
}

/** Aims the pending trigger at this permanent. */
function aimAt(current: ReduceResult, victim: ObjectId): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
  const option = decision.options.find(
    (entry) =>
      entry.type === 'chooseTriggerTargets' &&
      entry.targets[0]?.kind === 'permanent' &&
      entry.targets[0].oid === victim,
  );
  if (option === undefined) throw new Error('that permanent was not offered');
  return apply(current, option);
}

interface FoughtGame {
  readonly done: ReduceResult;
  /** Captured before the fight, because a dead body leaves the battlefield. */
  readonly bramble: ObjectId;
  readonly victim: ObjectId;
}

/** Cast, resolve, aim the trigger at `enemyName`, and let the fight resolve. */
function fightOnEntry(source: Card, enemies: readonly Card[], enemyName: string): FoughtGame {
  const opened = passUntilAsked(cast(board(source, enemies), 0));
  const victim = oidOf(opened.state, enemyName);
  const bramble = oidOf(opened.state, 'Grasping Bramble');
  return { done: passUntilAsked(aimAt(opened, victim)), bramble, victim };
}

describe('what a fight is aimed at', () => {
  it('offers the creatures across the table and neither its own nor itself', () => {
    const asked = passUntilAsked(cast(board(fighter(3, 3), [creature('Marauder', 3, 3)]), 0));
    const state = asked.state;

    expect(offered(state)).toEqual([oidOf(state, 'Marauder')]);
    expect(offered(state)).not.toContain(oidOf(state, 'Thornwood Scrub'));
    expect(offered(state)).not.toContain(oidOf(state, 'Grasping Bramble'));
  });
});

describe('each creature deals damage equal to its power to the other (CR 701.12a)', () => {
  it('trades when the two are the same size, because the damage is simultaneous', () => {
    const { done, bramble, victim } = fightOnEntry(fighter(3, 3), [creature('Marauder', 3, 3)], 'Marauder');

    expect(inGraveyard(done.state, victim)).toBe(true);
    // The half a second `applyDamage` call would lose: by the time the target
    // is dead the source has already been dealt its damage (CR 120.3), so the
    // state-based check that kills one kills both.
    expect(inGraveyard(done.state, bramble)).toBe(true);
  });

  it('kills the smaller creature and survives, marked with what it took', () => {
    const { done, bramble, victim } = fightOnEntry(fighter(4, 4), [creature('Marauder', 2, 2)], 'Marauder');

    expect(inGraveyard(done.state, victim)).toBe(true);
    expect(inGraveyard(done.state, bramble)).toBe(false);
    expect(damageOn(done.state, bramble)).toBe(2);
  });

  it('dies to the larger creature and leaves it standing', () => {
    const { done, bramble, victim } = fightOnEntry(fighter(2, 2), [creature('Marauder', 5, 5)], 'Marauder');

    expect(damageOn(done.state, victim)).toBe(2);
    expect(inGraveyard(done.state, victim)).toBe(false);
    expect(inGraveyard(done.state, bramble)).toBe(true);
  });

  it('deals nothing at all from a zero-power fighter, and still takes damage back', () => {
    const { done, bramble, victim } = fightOnEntry(fighter(0, 5), [creature('Marauder', 3, 3)], 'Marauder');

    expect(damageOn(done.state, victim)).toBe(0);
    expect(damageOn(done.state, bramble)).toBe(3);
  });
});

describe('the keywords each fighter brings to its own damage', () => {
  it('lets the target deathtouch kill a fighter that survived the arithmetic', () => {
    const { done, bramble, victim } = fightOnEntry(
      fighter(5, 5),
      [creature('Thornwood Baba', 1, 1, { keywords: ['deathtouch'] })],
      'Thornwood Baba',
    );

    expect(inGraveyard(done.state, victim)).toBe(true);
    // One damage on a 5/5, and it is lethal because of where it came from
    // (CR 702.2b): the instance carries the keyword of the body that dealt it,
    // not of the body the effect was printed on.
    expect(inGraveyard(done.state, bramble)).toBe(true);
  });

  it('lets the fighter deathtouch kill a creature its power could not', () => {
    const { done, bramble, victim } = fightOnEntry(
      fighter(1, 6, ['deathtouch']),
      [creature('Marauder', 4, 8)],
      'Marauder',
    );

    expect(inGraveyard(done.state, victim)).toBe(true);
    expect(inGraveyard(done.state, bramble)).toBe(false);
    expect(damageOn(done.state, bramble)).toBe(4);
  });

  it('gains life once for the fighter lifelink and not for the damage it took', () => {
    const { done } = fightOnEntry(fighter(3, 6, ['lifelink']), [creature('Marauder', 2, 2)], 'Marauder');
    const opening = done.state.players[1].life;

    expect(done.state.players[0].life).toBe(opening + 3);
  });
});

describe('neither creature is dealt damage when one has left (CR 701.12c)', () => {
  /**
   * The source half, and the only branch in the fight arm that no other
   * primitive reaches: the source is not a target, so `isTargetStillLegal` has
   * nothing to say about it and the arm asks the board itself.
   *
   * The opponent answers the fighter *after* the trigger has chosen its target
   * and *before* the trigger resolves, which is the window CR 603.3 opens and
   * the whole reason the sentence is in the rule.
   */
  it('deals no damage to the target once the source has been answered in response', () => {
    const opened = passUntilAsked(
      cast(board(fighter(3, 3), [creature('Marauder', 1, 4)], { opponentHolds: [VERDICT] }), 0),
    );
    const aimed = aimAt(opened, oidOf(opened.state, 'Marauder'));

    const bramble = oidOf(aimed.state, 'Grasping Bramble');
    const marauder = oidOf(aimed.state, 'Marauder');

    // Player 0 holds priority with the trigger on the stack; passing it is what
    // opens the window the opponent answers in.
    const offeredTo = pendingDecision(aimed.state);
    if (offeredTo?.kind !== 'priority') throw new Error('nobody has priority with the trigger up');
    const passed = apply(aimed, { type: 'passPriority', player: offeredTo.player });
    const verdict = passed.state.players[1].hand[0];
    if (verdict === undefined) throw new Error('the opponent holds no answer');
    const answered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: verdict,
      targets: [{ kind: 'permanent', oid: bramble } satisfies Target],
    });
    const done = passUntilAsked(answered);

    expect(inGraveyard(done.state, bramble)).toBe(true);
    expect(damageOn(done.state, marauder)).toBe(0);
    expect(inGraveyard(done.state, marauder)).toBe(false);
    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
  });
});
