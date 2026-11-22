/** Native hostile probes for RTR #63's opponent sacrifice at each combat. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  advanceToStep,
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const DEMON = parseCard({
  kind: 'creature',
  id: 'rtr-063-desecration-demon-kernel',
  name: 'Desecration Demon',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 63 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEndStep',
      optional: true,
      printedSourceReference: 'thisCreature',
      opponentMaySacrificeCreatureThenTapAndCounterSelf: true,
      effects: [
        {
          kind: 'sacrificePermanent',
          filter: { cardTypes: ['creature'] },
          target: { kind: 'triggeringPlayer' },
        },
        { kind: 'tapPermanent', target: { kind: 'selfPermanent' } },
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

const FIRST = creature('First Offering', 1, 1);
const SECOND = creature('Second Offering', 2, 2);

function combat(
  opponentCreatures: readonly Card[] = [FIRST, SECOND],
  active: 0 | 1 = 0,
  token = false,
): ReduceResult {
  return advanceToStep(
    scenario({
      active,
      battlefield: [
        { card: DEMON, controller: 0 },
        ...opponentCreatures.map((card) => ({ card, controller: 1 as const, token })),
      ],
    }),
    'beginCombat',
  );
}

function untilOptional(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Desecration Demon never asked its opponent');
}

function answer(from: ReduceResult, accept: boolean): ReduceResult {
  const offered = untilOptional(from);
  const decision = pendingDecision(offered.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('optional sacrifice is not pending');
  return apply(offered, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

describe('RTR Desecration Demon in the kernel', () => {
  it('asks the opponent in both players combats and gates both source updates on sacrifice', () => {
    for (const active of [0, 1] as const) {
      const started = combat([FIRST, SECOND], active);
      const demon = oidOf(started.state, DEMON.name);
      const offered = untilOptional(started);
      const optional = pendingDecision(offered.state);
      expect(optional?.player).toBe(1);

      const choosing = answer(started, true);
      const decision = pendingDecision(choosing.state);
      if (decision?.kind !== 'permanentSacrifice') {
        throw new Error('opponent sacrifice choice is not pending');
      }
      expect(decision.player).toBe(1);
      expect(decision.permanents.map((oid) => choosing.state.objects[oid]?.card.name)).toEqual([
        FIRST.name,
        SECOND.name,
      ]);

      const done = apply(choosing, {
        type: 'sacrificePermanent',
        player: 1,
        oid: oidOf(choosing.state, SECOND.name),
      });
      expect(done.state.objects[demon]?.tapped).toBe(true);
      expect(done.state.objects[demon]?.counters.plusOnePlusOne).toBe(1);
      expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.player)).toEqual([1]);
    }
  });

  it('decline and an empty opposing board leave the source untapped and unchanged', () => {
    for (const done of [answer(combat(), false), answer(combat([]), true)]) {
      const demon = oidOf(done.state, DEMON.name);
      expect(done.state.objects[demon]?.tapped).toBe(false);
      expect(done.state.objects[demon]?.counters.plusOnePlusOne).toBe(0);
      expect(eventsOfType(done.events, 'permanentSacrificed')).toEqual([]);
    }
  });

  it('still offers the opponent sacrifice after source departure but cannot update the departed incarnation', () => {
    const offered = untilOptional(combat([FIRST]));
    const demon = oidOf(offered.state, DEMON.name);
    const offering = oidOf(offered.state, FIRST.name);
    const departed = moveObject(beginTrace(offered.state), demon, 'graveyard');
    const accepted = answer({ state: departed.state, events: [...offered.events, ...departed.events] }, true);
    expect(accepted.state.objects[offering]?.zone).toBe('graveyard');
    expect(accepted.state.objects[demon]?.counters.plusOnePlusOne).toBe(0);
  });

  it('counts a sacrificed token before state-based cessation and still updates the source', () => {
    const started = combat([FIRST], 0, true);
    const demon = oidOf(started.state, DEMON.name);
    const token = oidOf(started.state, FIRST.name);
    const done = answer(started, true);

    expect(done.state.objects[token]?.zone).toBe('exile');
    expect(done.state.battlefield).not.toContain(token);
    expect(done.state.objects[demon]?.tapped).toBe(true);
    expect(done.state.objects[demon]?.counters.plusOnePlusOne).toBe(1);
    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.oid)).toEqual([token]);
  });
});
