/**
 * CR 701.17: a sacrifice is not a destruction (`mtg-nhyv.30`).
 *
 * The rule is one sentence and the whole lane turns on it. Sacrificing a
 * permanent moves it to its owner's graveyard without destroying it, so
 * indestructible (CR 702.12b) does not apply and a regeneration shield
 * (CR 701.15) is neither used nor consumed — a shield replaces a *destroy*
 * event, and this path never raises one.
 *
 * `destroyPermanent` in `destruction.ts` honors both, and it must stay that
 * way, so `sacrificePermanent` is a sibling beside it rather than a call into
 * it. The two runs below that put an indestructible creature and a shielded
 * creature through the same end step are what hold that apart: if the sacrifice
 * ever routes through the destruction path again, both fail and neither is
 * ambiguous about why.
 *
 * `beginningOfEndStep` is the other half. `beginningOfYourEndStep` already
 * shipped and filters `stepBegan` down to the active player's own permanents;
 * Arc Runner's printed line says "the end step", which is every permanent on
 * the battlefield whoever controls it. The first block is that difference,
 * measured in one turn.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  advanceToStep,
  eventsOfType,
  pendingDecision,
  scenario,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, FOREST } from './cards';
import { apply, oidOf } from './helpers';

/** A creature whose end-step trigger sacrifices it, in whichever of the two spellings. */
function sacrificer(
  name: string,
  condition: 'beginningOfEndStep' | 'beginningOfYourEndStep',
  options: { readonly indestructible?: boolean; readonly regenerates?: boolean } = {},
): Card {
  return creature(name, 5, 1, {
    ...(options.indestructible === true ? { keywordAbilities: [{ kind: 'indestructible' as const }] } : {}),
    abilities: [
      {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
      },
      ...(options.regenerates === true
        ? [
            {
              kind: 'activated' as const,
              cost: { mana: { G: 1 } },
              regenerateSelf: true as const,
              effects: [],
            },
          ]
        : []),
    ],
  });
}

/** Passes back and forth until nothing is waiting on the stack. */
function settleStack(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 16; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

function firedBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

describe('at the beginning of the end step', () => {
  it('fires for both seats\' permanents in one end step, where "your" fires for one', () => {
    const mine = sacrificer('End Step Runner (mine)', 'beginningOfEndStep');
    const theirs = sacrificer('End Step Runner (theirs)', 'beginningOfEndStep');
    const filtered = sacrificer('End Step Warden (theirs)', 'beginningOfYourEndStep');
    const reached = scenario({
      battlefield: [
        { card: mine, controller: 0, summoningSick: true },
        { card: theirs, controller: 1 },
        { card: filtered, controller: 1 },
      ],
      active: 0,
      step: 'end',
    });

    expect(firedBy(reached, oidOf(reached.state, 'End Step Runner (mine)'))).toEqual(['beginningOfEndStep']);
    expect(firedBy(reached, oidOf(reached.state, 'End Step Runner (theirs)'))).toEqual([
      'beginningOfEndStep',
    ]);
    expect(firedBy(reached, oidOf(reached.state, 'End Step Warden (theirs)'))).toEqual([]);
  });
});

describe('the sacrificeSelf effect', () => {
  it('puts the source in the graveyard as a sacrifice, never as a destruction', () => {
    const subject = sacrificer('Ordinary Runner', 'beginningOfEndStep');
    const bystander = creature('Ordinary Bystander', 2, 2);
    const reached = scenario({
      battlefield: [
        { card: subject, controller: 0, summoningSick: true },
        { card: bystander, controller: 0, summoningSick: true },
      ],
      active: 0,
      step: 'end',
    });
    const oid = oidOf(reached.state, 'Ordinary Runner');
    const other = oidOf(reached.state, 'Ordinary Bystander');
    const done = settleStack(reached);

    expect(done.state.objects[oid]?.zone).toBe('graveyard');
    expect(done.state.objects[other]?.zone).toBe('battlefield');
    expect(
      eventsOfType(done.events, 'permanentSacrificed').map((event) => ({
        oid: event.oid,
        player: event.player,
      })),
    ).toEqual([{ oid, player: 0 }]);
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('kills an indestructible permanent, because CR 701.17 is not CR 701.7', () => {
    const subject = sacrificer('Unbreakable Runner', 'beginningOfEndStep', { indestructible: true });
    const reached = scenario({
      battlefield: [{ card: subject, controller: 0, summoningSick: true }],
      active: 0,
      step: 'end',
    });
    const oid = oidOf(reached.state, 'Unbreakable Runner');
    const done = settleStack(reached);

    expect(done.state.objects[oid]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentSacrificed')).toHaveLength(1);
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('is not stopped by a regeneration shield, and does not spend one', () => {
    const subject = sacrificer('Shielded Runner', 'beginningOfEndStep', { regenerates: true });
    const opened = scenario({
      battlefield: [
        { card: subject, controller: 0, summoningSick: true },
        { card: FOREST, controller: 0 },
      ],
      active: 0,
    });
    const oid = oidOf(opened.state, 'Shielded Runner');
    let current = apply(opened, {
      type: 'activateManaAbility',
      player: 0,
      oid: oidOf(opened.state, 'Forest'),
      color: 'G',
    });
    current = apply(current, {
      type: 'activateAbility',
      player: 0,
      oid,
      abilityIndex: 1,
      targets: [],
      sacrifices: [],
    });
    current = settleStack(current);
    expect(current.state.replacements).toHaveLength(1);

    const done = settleStack(advanceToStep(current, 'end'));
    expect(done.state.objects[oid]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentSacrificed')).toHaveLength(1);
    expect(eventsOfType(done.events, 'permanentRegenerated')).toEqual([]);
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });
});
