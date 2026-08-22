/**
 * `beginningOfYourUpkeep` and `beginningOfYourEndStep`: CR 603.6b's two step
 * triggers.
 *
 * Both read `stepBegan` rather than a source's own event, because the event
 * names the step and the active player and nothing about which permanent
 * might be listening — `conditionsFrom` has to scan every permanent the
 * active player controls and let `collectTriggers`' generic per-object check
 * decide which of them printed the condition. "Your" is the load-bearing
 * word on both members: the active half of `stepBegan` has to match the
 * scanned permanent's controller, not just the step name, which is what the
 * negative arm in each block below pins.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { eventsOfType, scenario, type ObjectId, type ReduceResult } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

function stepWarden(name: string, condition: 'beginningOfYourUpkeep' | 'beginningOfYourEndStep'): Card {
  return creature(name, 2, 2, {
    abilities: [
      {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

describe('at the beginning of your end step', () => {
  it("fires for its own controller and not the opponent's, in the same turn", () => {
    const mine = stepWarden('End Step Sentry (mine)', 'beginningOfYourEndStep');
    const theirs = stepWarden('End Step Sentry (theirs)', 'beginningOfYourEndStep');
    const done = scenario({
      battlefield: [
        // Summoning sick so `declareAttackers`, reached on the way to `end`,
        // has nothing eligible and never raises an attackers decision
        // `advanceToStep` cannot answer.
        { card: mine, controller: 0, summoningSick: true },
        { card: theirs, controller: 1 },
      ],
      active: 0,
      step: 'end',
    });

    const mineOid = oidOf(done.state, 'End Step Sentry (mine)');
    const theirsOid = oidOf(done.state, 'End Step Sentry (theirs)');
    expect(conditionsFiredBy(done, mineOid)).toEqual(['beginningOfYourEndStep']);
    expect(conditionsFiredBy(done, theirsOid)).toEqual([]);
  });

  it('has not fired yet at declare attackers, earlier in the same turn', () => {
    const mine = stepWarden('Early Sentry', 'beginningOfYourEndStep');
    const early = scenario({
      battlefield: [{ card: mine, controller: 0, summoningSick: true }],
      active: 0,
      step: 'declareAttackers',
    });
    const oid = oidOf(early.state, 'Early Sentry');
    expect(conditionsFiredBy(early, oid)).toEqual([]);
  });
});

describe('at the beginning of your upkeep', () => {
  it("fires for its own controller's upkeep once the turn turns over, not for the player whose turn it still was", () => {
    const mine = stepWarden('Upkeep Warden (mine)', 'beginningOfYourUpkeep');
    const theirs = stepWarden('Upkeep Warden (theirs)', 'beginningOfYourUpkeep');
    const done = scenario({
      battlefield: [
        { card: theirs, controller: 0, summoningSick: true },
        { card: mine, controller: 1 },
      ],
      active: 0,
      step: 'upkeep',
    });

    // `upkeep` sits before `precombatMain` in turn order, so reaching it walks
    // all the way through the rest of this turn and into the next one — the
    // sanity check that the wraparound landed where the test's setup assumes.
    expect(done.state.turn.active).toBe(1);

    const mineOid = oidOf(done.state, 'Upkeep Warden (mine)');
    const theirsOid = oidOf(done.state, 'Upkeep Warden (theirs)');
    expect(conditionsFiredBy(done, mineOid)).toEqual(['beginningOfYourUpkeep']);
    expect(conditionsFiredBy(done, theirsOid)).toEqual([]);
  });
});
