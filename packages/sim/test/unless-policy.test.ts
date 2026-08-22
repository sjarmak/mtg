/**
 * The greedy bot answering a spell's printed toll (CR 118.8), through
 * `policies/trigger.ts`'s `answerUnless`.
 *
 * `modal-policies.test.ts` is the shape: build the exact position, hand the
 * policy the decision the kernel would hand it, and assert the answer rather
 * than a whole game's outcome. What makes this one worth its own file is that
 * the comparison is unlike the other two questions in that module.
 * `answerOptionalTrigger` and `answerMay` weigh doing a thing against doing
 * nothing, and nothing is free, so zero is the line. A toll weighs two things
 * that both cost, which means the policy needs a real number for what the
 * spell would take — and the obvious way to get one is wrong. Scoring the
 * spell from the payer's own seat returns `-ownGoalPenalty`, a flat sentinel
 * that stops a bot aiming removal at itself and prices every creature on the
 * board the same. The third test below is the one that fails if that reading
 * comes back.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect, ManaCostInput } from '@mtg/dsl';
import { colorsFromCost, mana, parseCard } from '@mtg/dsl';
import type { AgentView, GameState, ReduceResult } from '@mtg/kernel';
import { pendingDecision, reduce, scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { answerUnless } from '../src/policies/trigger';
import { creature, FOREST } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const DESTROY: readonly Effect[] = [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }];

let counter = 0;

/** Removal that offers the creature's controller a price to stop it. */
function tolledRemoval(toll: ManaCostInput): Card {
  counter += 1;
  const manaCost = mana({ generic: 1 });
  return parseCard({
    kind: 'instant',
    id: `tst-toll-${String(counter)}`,
    name: 'Toll of Ruin',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 600 + counter },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: DESTROY,
    unless: { payer: 'targetController', cost: mana(toll) },
  });
}

/**
 * Player 0 aims tolled removal at player 1's creature and passes, leaving the
 * kernel asking player 1 whether to pay. Returns the state at that stop.
 */
function tollAsked(toll: ManaCostInput, victim: Card): GameState {
  const spell = tolledRemoval(toll);
  const start = scenario({
    battlefield: [
      { card: victim, controller: 1 },
      ...Array.from({ length: 2 }, () => ({ card: FOREST, controller: 0 as const })),
      ...Array.from({ length: 6 }, () => ({ card: FOREST, controller: 1 as const })),
    ],
    hands: [[spell], []],
  });
  const inHand = start.state.players[0].hand[0];
  const targetOid = start.state.battlefield.find(
    (oid) => start.state.objects[oid]?.card.name === victim.name,
  );
  if (inHand === undefined || targetOid === undefined) throw new Error('the board did not build');
  let current: ReduceResult = start;
  const step = (action: Parameters<typeof reduce>[1]): void => {
    const next = reduce(current.state, action);
    current = { state: next.state, events: [...current.events, ...next.events] };
  };
  step({ type: 'castSpell', player: 0, oid: inHand, targets: [{ kind: 'permanent', oid: targetOid }] });
  for (let guard = 0; guard < 6; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') break;
    step({ type: 'passPriority', player: decision.player });
  }
  return current.state;
}

/** The decision the kernel is holding, narrowed to the toll it must be. */
function tollDecision(state: GameState): { readonly view: AgentView; readonly oid: string } {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'unless') throw new Error('the kernel is not asking a toll');
  return { view: { state, player: decision.player, decision }, oid: decision.oid };
}

describe('the greedy bot weighs a toll against what it would lose', () => {
  function pays(toll: ManaCostInput, victim: Card): boolean {
    const { view } = tollDecision(tollAsked(toll, victim));
    if (view.decision?.kind !== 'unless') throw new Error('not a toll');
    return answerUnless(view, config, view.decision).pay;
  }

  const NIGHTFLIT = () => creature('Nightflit', 1, 1);
  const BULWARK = () => creature('Emberkin Bulwark', 5, 5);

  it('pays a small toll to keep a large creature', () => {
    expect(pays({ generic: 1 }, BULWARK())).toBe(true);
  });

  it('refuses a toll that costs more than the creature it would save', () => {
    expect(pays({ generic: 5 }, NIGHTFLIT())).toBe(false);
  });

  it('prices the creature rather than the fact that it is ours', () => {
    // The assertion that catches the sentinel reading. `destroyScore` returns a
    // flat -ownGoalPenalty for a permanent the scoring seat controls, so a
    // policy that scored this from the payer's own seat would answer these two
    // identically whatever the toll and whatever the creature.
    expect(pays({ generic: 3 }, BULWARK())).toBe(true);
    expect(pays({ generic: 3 }, NIGHTFLIT())).toBe(false);
  });

  it('answers the spell it was asked about, and nothing else', () => {
    const { view, oid } = tollDecision(tollAsked({ generic: 1 }, BULWARK()));
    if (view.decision?.kind !== 'unless') throw new Error('not a toll');
    const answer = answerUnless(view, config, view.decision);
    expect(answer.oid).toBe(oid);
    expect(answer.player).toBe(view.player);
  });
});
