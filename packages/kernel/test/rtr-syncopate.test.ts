import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { FOREST, instant, ISLAND, lands } from './cards';
import { apply, handOidOf } from './helpers';

const SYNCOPATE = parseCard({
  kind: 'instant',
  id: 'rtr-54-syncopate-kernel',
  name: 'Syncopate',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 54 },
  manaCost: { hasX: true, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'counterSpell', unlessCost: { kind: 'chosenX' }, destination: 'exile' }],
});

const STUDY = instant('Syncopate Target', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }], {
  generic: 1,
});

function passUntilDecision(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority' || current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Syncopate stack did not settle');
}

function counterBoard(
  x: number,
  payerLands: number,
): {
  readonly atToll: ReduceResult;
  readonly syncopateOid: string;
  readonly targetOid: string;
} {
  const start = scenario({
    battlefield: [
      ...lands(FOREST, payerLands + 1).map((card) => ({ card, controller: 0 as const })),
      ...lands(ISLAND, x + 1).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[STUDY], [SYNCOPATE]],
  });
  const targetOid = handOidOf(start.state, 0, STUDY.name);
  const syncopateOid = handOidOf(start.state, 1, SYNCOPATE.name);
  const targetCast = apply(start, { type: 'castSpell', player: 0, oid: targetOid, targets: [null] });
  const offered = apply(targetCast, { type: 'passPriority', player: 0 });
  const cast = apply(offered, {
    type: 'castSpell',
    player: 1,
    oid: syncopateOid,
    targets: [{ kind: 'spell', oid: targetOid }],
    x,
  });
  return { atToll: passUntilDecision(cast), syncopateOid, targetOid };
}

describe('RTR #54 Syncopate', () => {
  it('offers the targeted spell controller exactly the X announced by the caster', () => {
    const { atToll, syncopateOid } = counterBoard(3, 3);
    const decision = pendingDecision(atToll.state);
    if (decision?.kind !== 'unless') throw new Error('Syncopate did not pause for its toll');
    expect(decision).toMatchObject({ player: 0, oid: syncopateOid, cost: { generic: 3 } });
  });

  it('leaves the target spell on the stack when its controller pays X', () => {
    const { atToll, syncopateOid, targetOid } = counterBoard(2, 2);
    const paid = apply(atToll, { type: 'answerUnless', player: 0, oid: syncopateOid, pay: true });
    expect(paid.state.objects[targetOid]?.zone).toBe('stack');
    expect(paid.state.objects[syncopateOid]?.zone).toBe('graveyard');
    expect(eventsOfType(paid.events, 'unlessPaid')).toHaveLength(1);
  });

  it('exiles the target on decline and when X is unaffordable', () => {
    const affordable = counterBoard(2, 2);
    const declined = apply(affordable.atToll, {
      type: 'answerUnless',
      player: 0,
      oid: affordable.syncopateOid,
      pay: false,
    });
    expect(declined.state.objects[affordable.targetOid]?.zone).toBe('exile');

    const unaffordable = counterBoard(2, 1);
    expect(pendingDecision(unaffordable.atToll.state)?.kind).toBe('priority');
    expect(unaffordable.atToll.state.objects[unaffordable.targetOid]?.zone).toBe('exile');
  });
});
