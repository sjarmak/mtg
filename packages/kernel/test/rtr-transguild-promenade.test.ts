/** Transguild Promenade's controller-paid entry toll through the real stack. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { FOREST, lands } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const PROMENADE = parseCard({
  kind: 'land',
  id: 'rtr-transguild-promenade',
  name: 'Transguild Promenade',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 249 },
  producesMana: ['W', 'U', 'B', 'R', 'G'],
  entryReplacement: { kind: 'entersTapped' },
  printedEntryReference: 'thisLand',
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
      sacrificeSelfUnlessControllerPays: { cost: { generic: 1 } },
    },
  ],
});

function passUntilStop(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Transguild Promenade did not settle');
}

function playWithForests(count: number): { readonly stopped: ReduceResult; readonly land: string } {
  const start = scenario({
    battlefield: lands(FOREST, count).map((card) => ({ card, controller: 0 as const })),
    hands: [[PROMENADE], []],
  });
  const played = apply(start, {
    type: 'playLand',
    player: 0,
    oid: handOidOf(start.state, 0, PROMENADE.name),
  });
  return { stopped: passUntilStop(played), land: oidOf(played.state, PROMENADE.name) };
}

describe("Transguild Promenade's entry toll", () => {
  it('asks its controller, spends {1}, and preserves the tapped land when paid', () => {
    const { stopped, land } = playWithForests(1);
    const decision = pendingDecision(stopped.state);
    if (decision?.kind !== 'unless') throw new Error('the entry toll was not asked');
    expect(decision.player).toBe(0);
    expect(decision.cost.generic).toBe(1);
    expect(
      validateAction(stopped.state, {
        type: 'answerUnless',
        player: 1,
        oid: decision.oid,
        pay: true,
      }),
    ).not.toBeNull();

    const paid = apply(stopped, {
      type: 'answerUnless',
      player: 0,
      oid: decision.oid,
      pay: true,
    });
    expect(paid.state.objects[land]?.zone).toBe('battlefield');
    expect(paid.state.objects[land]?.tapped).toBe(true);
    expect(eventsOfType(paid.events, 'unlessPaid')).toEqual([
      expect.objectContaining({ oid: decision.oid, player: 0, source: land }),
    ]);
  });

  it('sacrifices the land when its controller declines or cannot pay', () => {
    const payable = playWithForests(1);
    const decision = pendingDecision(payable.stopped.state);
    if (decision?.kind !== 'unless') throw new Error('the entry toll was not asked');
    const declined = apply(payable.stopped, {
      type: 'answerUnless',
      player: 0,
      oid: decision.oid,
      pay: false,
    });
    expect(declined.state.objects[payable.land]?.zone).toBe('graveyard');

    const unaffordable = playWithForests(0);
    expect(pendingDecision(unaffordable.stopped.state)?.kind).toBe('priority');
    expect(unaffordable.stopped.state.objects[unaffordable.land]?.zone).toBe('graveyard');
    expect(eventsOfType(unaffordable.stopped.events, 'unlessPaid')).toHaveLength(0);
  });
});
