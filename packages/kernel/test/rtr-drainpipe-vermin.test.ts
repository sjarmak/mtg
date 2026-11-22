/** Native payment and target timing probes for RTR Drainpipe Vermin. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const VERMIN = parseCard({
  kind: 'creature',
  id: 'rtr-066-drainpipe-vermin-kernel',
  name: 'Drainpipe Vermin',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 66 },
  manaCost: { B: 1 },
  colors: ['B'],
  subtypes: ['Rat'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      optional: true,
      optionalControllerPayment: { cost: { B: 1 } },
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
    },
  ],
});
const HELD = creature('Vermin held card', 1, 1);

function untilAsked(withMana: boolean): ReduceResult {
  const opened = scenario({
    battlefield: [
      { card: VERMIN, controller: 0 },
      ...(withMana ? lands(SWAMP, 1).map((card) => ({ card, controller: 0 as const })) : []),
    ],
    hands: [[], [HELD]],
  });
  const dead = settle(moveObject(beginTrace(opened.state), oidOf(opened.state, VERMIN.name), 'graveyard'));
  let current: ReduceResult = { state: dead.state, events: dead.events };
  const target = pendingDecision(current.state);
  if (target?.kind !== 'triggerTargets') throw new Error('Vermin did not choose its target on stacking');
  current = apply(current, {
    type: 'chooseTriggerTargets',
    player: 0,
    oid: target.oid,
    targets: [{ kind: 'player', player: 1 }],
  });
  for (let guard = 0; guard < 4; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') throw new Error(`Vermin stopped on ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Vermin never asked for payment');
}

describe('Drainpipe Vermin in the kernel', () => {
  it('chooses its target before priority, then pays on acceptance and makes that player discard', () => {
    const asked = untilAsked(true);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('Vermin payment was not pending');
    expect(decision.targets).toEqual([{ kind: 'player', player: 1 }]);
    const accepted = apply(asked, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: decision.oid,
      accept: true,
    });
    expect(eventsOfType(accepted.events, 'manaPaid').at(-1)?.player).toBe(0);
    expect(accepted.state.players[1].hand).toEqual([]);
    expect(eventsOfType(accepted.events, 'cardsDiscarded').at(-1)?.player).toBe(1);
  });

  it('offers only decline when the controller cannot pay and changes no hand', () => {
    const asked = untilAsked(false);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('Vermin payment was not pending');
    expect(decision.options).toEqual([
      { type: 'answerOptionalTrigger', player: 0, oid: decision.oid, accept: false },
    ]);
    const declined = apply(asked, decision.options[0]!);
    expect(declined.state.players[1].hand).toHaveLength(1);
    expect(eventsOfType(declined.events, 'triggerDeclined')).toHaveLength(1);
  });
});
