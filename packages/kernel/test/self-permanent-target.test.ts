/**
 * `selfPermanent` through the reducer: a counter placed on the artifact whose
 * ability placed it (`mtg-rji`).
 *
 * `self-creature-target.test.ts` drives the sibling kind and argues the shape
 * a retained referent has here — filled from `StackEntry.ability.sourceOid`
 * rather than from `StackEntry.targets`, offered as the `[null]` placeholder
 * `noTarget` uses so `cartesian` still yields a tuple for an activation, and
 * dropped silently when the source has left the battlefield (CR 608.2b). None
 * of that machinery reads the source's card type, which is the finding this
 * suite pins: `planResolution`'s branch, `matchesTargetKind`'s arm and
 * `placeCounters` were already type-agnostic, and the walls this bead removed
 * were both in the DSL validator.
 *
 * What is genuinely new is the counter itself. A `trisigil` counter declares
 * no modification, so it reaches no layer at all (`packages/dsl/src/counters.ts`,
 * and the source gate in `packages/dsl/test/counters.test.ts`) — the assertions
 * below are that it survives on a non-creature permanent, is countable, and
 * moves neither power nor toughness of anything.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import { counterCount, eventsOfType, legalActions, pendingDecision, scenario } from '@mtg/kernel';
import { artifact, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

/** "At the beginning of your upkeep, put a Trisigil counter on this permanent." */
const UPKEEP_ACCRUAL: AbilityInput = {
  kind: 'triggered',
  condition: 'beginningOfYourUpkeep',
  effects: [{ kind: 'putCounters', counter: 'trisigil', count: 1, target: { kind: 'selfPermanent' } }],
};

/** "{2}: Put a Trisigil counter on this permanent." — the same referent, activated. */
const ACTIVATED_ACCRUAL: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 2 }, tapSelf: false },
  effects: [{ kind: 'putCounters', counter: 'trisigil', count: 1, target: { kind: 'selfPermanent' } }],
};

/** Passes priority with whoever holds it until the stack is empty or a real decision is owed. */
function settlePriority(start: ReduceResult, limit = 20): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && guard > 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('settlePriority: stack did not settle');
}

/** A counter tally omits zero-valued kinds, so a missing Trisigil is none. */
function trisigilOn(state: GameState, oid: string): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`no object ${oid}`);
  return counterCount(object.counters, 'trisigil');
}

/**
 * Idles forward to a turn number, `grant-keyword-until-end-of-turn.test.ts`'s
 * `passUntilTurn` under a name that says what it does to a board with nothing
 * to decide: it takes the first option of any decision it is offered, which on
 * a board of one artifact is always "pass".
 */
function idleUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${turn}`);
}

describe('a triggered ability putting a counter on its own artifact ("selfPermanent")', () => {
  it('accrues one counter on the artifact when the upkeep trigger resolves, with no target asked', () => {
    const relic = artifact('Trisigil of Power', { generic: 3 }, [UPKEEP_ACCRUAL]);
    const opened = scenario({
      battlefield: [{ card: relic, controller: 1 }],
      active: 0,
      step: 'upkeep',
    });
    const relicOid = oidOf(opened.state, 'Trisigil of Power');

    // `upkeep` sits before `precombatMain`, so reaching it walks into the next
    // turn — the artifact's controller is the active player by then, which is
    // what makes "your upkeep" fire at all (`step-triggers.test.ts`).
    expect(opened.state.turn.active).toBe(1);
    const fired = eventsOfType(opened.events, 'abilityTriggered').filter(
      (event) => event.source === relicOid,
    );
    expect(fired.map((event) => event.condition)).toEqual(['beginningOfYourUpkeep']);
    // No target owed: the referent is the ability's own source, so the ability
    // goes on the stack with an empty `targets` list.
    expect(opened.state.stack[0]?.targets).toEqual([]);

    const resolved = settlePriority(opened);
    expect(trisigilOn(resolved.state, relicOid)).toBe(1);
  });

  it('accrues a second counter when its controller takes another turn, so the cycle can count to three', () => {
    const relic = artifact('Trisigil of Power', { generic: 3 }, [UPKEEP_ACCRUAL]);
    const first = settlePriority(
      scenario({ battlefield: [{ card: relic, controller: 1 }], active: 0, step: 'upkeep' }),
    );
    const relicOid = oidOf(first.state, 'Trisigil of Power');
    expect(trisigilOn(first.state, relicOid)).toBe(1);

    // Two turns on, which is one more of this player's upkeeps and one of the
    // opponent's — the opponent's is the half that matters, because
    // "beginningOfYourUpkeep" has to skip it and a counter that accrued on it
    // would show up here as three.
    const later = idleUntilTurn(first, first.state.turn.number + 3);
    expect(trisigilOn(later.state, relicOid)).toBe(2);
  });
});

describe('an activated ability putting a counter on its own artifact ("selfPermanent")', () => {
  it('is offered with a placeholder target and lands the counter on the source', () => {
    const relic = artifact('Trisigil of Power', { generic: 2 }, [ACTIVATED_ACCRUAL]);
    const start = scenario({
      battlefield: [
        { card: relic, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
    }).state;
    const relicOid = oidOf(start, 'Trisigil of Power');

    const offered: Extract<Action, { type: 'activateAbility' }>[] = [];
    for (const option of legalActions(start)) {
      if (option.type === 'activateAbility' && option.oid === relicOid) offered.push(option);
    }
    expect(offered).toHaveLength(1);
    expect(offered[0]?.targets).toEqual([null]);

    const resolved = settlePriority(apply({ state: start, events: [] }, offered[0] as Action));
    expect(trisigilOn(resolved.state, relicOid)).toBe(1);
    // A marker counter reaches no layer, so nothing about the board's
    // characteristics moved with it: `countersChanged` reports the +1/+1 and
    // -1/-1 totals alone and has nothing to say about this kind.
    expect(eventsOfType(resolved.events, 'countersChanged')).toHaveLength(0);
  });
});
