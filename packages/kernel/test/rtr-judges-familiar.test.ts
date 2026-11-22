/** Judge's Familiar routes an activated counter through the CR 118.8 decision. */
import { parseCard } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, instant, lands } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const FAMILIAR = parseCard({
  kind: 'creature',
  id: 'rtr-218-judges-familiar-kernel',
  name: "Judge's Familiar",
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 218 },
  manaCost: { hybrid: { 'W/U': 1 } },
  colors: ['W', 'U'],
  subtypes: ['Bird'],
  power: 1,
  toughness: 1,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeSelf: true },
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'counterSpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } }],
      counterTargetSpellUnless: { cost: { generic: 1 } },
    },
  ],
});
const TARGET = instant(
  'Familiar Target',
  [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  {},
);

function untilUnless(current: ReduceResult): ReduceResult {
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'unless') return current;
    if (decision?.kind !== 'priority') throw new Error(`expected priority, got ${decision?.kind ?? 'none'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('activated counter never offered its toll');
}

function activatedBoard(payerLands = 1): {
  readonly activated: ReduceResult;
  readonly target: string;
  readonly familiar: string;
} {
  const start = scenario({
    battlefield: [
      { card: FAMILIAR, controller: 0 },
      ...lands(FOREST, payerLands).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[], [TARGET]],
  });
  const familiar = oidOf(start.state, FAMILIAR.name);
  const handedOver = apply(start, { type: 'passPriority', player: 0 });
  const target = handOidOf(handedOver.state, 1, TARGET.name);
  const cast = apply(handedOver, { type: 'castSpell', player: 1, oid: target, targets: [null] });
  const response = apply(cast, { type: 'passPriority', player: 1 });
  const activated = apply(response, {
    type: 'activateAbility',
    player: 0,
    oid: familiar,
    abilityIndex: 0,
    targets: [{ kind: 'spell', oid: target }],
    sacrifices: [],
  });
  return { activated, target, familiar };
}

function board(): { readonly pending: ReduceResult; readonly target: string; readonly familiar: string } {
  const { activated, target, familiar } = activatedBoard();
  return { pending: untilUnless(activated), target, familiar };
}

describe("Judge's Familiar activated counter toll", () => {
  it("asks the targeted spell's controller after sacrificing the source", () => {
    const { pending, familiar } = board();
    const decision = pendingDecision(pending.state);
    if (decision?.kind !== 'unless') throw new Error('missing Familiar toll');
    expect(decision.player).toBe(1);
    expect(decision.cost.generic).toBe(1);
    expect(pending.state.objects[familiar]?.zone).toBe('graveyard');
  });

  it('leaves the targeted spell on the stack when paid and counters it when declined', () => {
    const paidBoard = board();
    const paidDecision = pendingDecision(paidBoard.pending.state);
    if (paidDecision?.kind !== 'unless') throw new Error('missing paid Familiar toll');
    const paid = apply(paidBoard.pending, {
      type: 'answerUnless',
      player: 1,
      oid: paidDecision.oid,
      pay: true,
    });
    expect(paid.state.stack.map((entry) => entry.oid)).toEqual([paidBoard.target]);

    const declinedBoard = board();
    const declinedDecision = pendingDecision(declinedBoard.pending.state);
    if (declinedDecision?.kind !== 'unless') throw new Error('missing declined Familiar toll');
    const declined = apply(declinedBoard.pending, {
      type: 'answerUnless',
      player: 1,
      oid: declinedDecision.oid,
      pay: false,
    });
    expect(declined.state.objects[declinedBoard.target]?.zone).toBe('graveyard');
    expect(eventsOfType(declined.events, 'spellCountered').map((event) => event.oid)).toContain(
      declinedBoard.target,
    );
  });

  it('counters without asking when the targeted spell controller cannot pay', () => {
    const unaffordable = activatedBoard(0);
    let current = unaffordable.activated;
    let offeredToll = false;
    for (
      let guard = 0;
      guard < 20 && current.state.objects[unaffordable.target]?.zone === 'stack';
      guard += 1
    ) {
      const decision = pendingDecision(current.state);
      if (decision?.kind === 'unless') {
        offeredToll = true;
        break;
      }
      if (decision?.kind !== 'priority')
        throw new Error(`expected priority, got ${decision?.kind ?? 'none'}`);
      current = apply(current, { type: 'passPriority', player: decision.player });
    }

    expect(offeredToll).toBe(false);
    expect(current.state.objects[unaffordable.target]?.zone).toBe('graveyard');
    expect(eventsOfType(current.events, 'spellCountered').map((event) => event.oid)).toContain(
      unaffordable.target,
    );
  });
});
