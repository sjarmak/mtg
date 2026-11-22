/** Silence through resolution, casting legality, cleanup and replay-shaped state. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  cleanupTurnEffects,
  legalActions,
  pendingDecision,
  scenario,
  stateFingerprint,
  validateAction,
  type ReduceResult,
} from '@mtg/kernel';
import { instant, ISLAND, PLAINS } from './cards';
import { apply, handOidOf } from './helpers';

const noTarget = { kind: 'noTarget' as const };
const SILENCE: Card = instant('Silence', [{ kind: 'cantCastSpellsThisTurn', players: 'eachOpponent' }], {
  W: 1,
});
const TEST_SPELL: Card = instant('Test Spell', [{ kind: 'drawCards', count: 1, target: noTarget }], { U: 1 });

function cast(current: ReduceResult, player: 0 | 1, card: Card): ReduceResult {
  return apply(current, {
    type: 'castSpell',
    player,
    oid: handOidOf(current.state, player, card.name),
    targets: card.kind === 'instant' || card.kind === 'sorcery' ? card.effects.map(() => null) : [],
  });
}

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Silence probe lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function settleStack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 12; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    walked = pass(walked);
  }
  throw new Error('Silence probe did not settle the stack');
}

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 1 },
    ],
    hands: [[SILENCE, TEST_SPELL], [TEST_SPELL]],
  });
}

function opponentPriorityAfterSilence(): ReduceResult {
  const resolved = settleStack(cast(board(), 0, SILENCE));
  return pass(resolved);
}

describe('Silence in the kernel', () => {
  it('removes every opponent cast while leaving its controller free to cast', () => {
    const resolved = settleStack(cast(board(), 0, SILENCE));
    expect(
      legalActions(resolved.state).some(
        (action) =>
          action.type === 'castSpell' && action.oid === handOidOf(resolved.state, 0, TEST_SPELL.name),
      ),
    ).toBe(true);

    const opponent = pass(resolved);
    const forbiddenOid = handOidOf(opponent.state, 1, TEST_SPELL.name);
    expect(legalActions(opponent.state).some((action) => action.type === 'castSpell')).toBe(false);
    expect(
      validateAction(opponent.state, {
        type: 'castSpell',
        player: 1,
        oid: forbiddenOid,
        targets: [null],
      }),
    ).toContain("can't cast spells this turn");
  });

  it('does not counter or otherwise disturb a spell already on the stack', () => {
    let current = scenario({
      active: 1,
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[SILENCE], [TEST_SPELL]],
    });
    current = cast(current, 1, TEST_SPELL);
    current = pass(current);
    current = cast(current, 0, SILENCE);
    const existingSpell = current.state.stack[0]?.oid;
    current = pass(pass(current));

    expect(current.state.stack).toHaveLength(1);
    expect(current.state.stack[0]?.oid).toBe(existingSpell);
    const handBefore = current.state.players[1].hand.length;
    current = settleStack(current);
    expect(current.state.players[1].hand).toHaveLength(handBefore + 1);
  });

  it('stores the rule in fingerprinted state and clears it at cleanup', () => {
    const opponent = opponentPriorityAfterSilence();
    expect(opponent.state.turnPlayerRules).toEqual([
      { rule: 'cantCastSpells', sourceOid: expect.any(String), player: 1 },
    ]);
    expect(stateFingerprint(opponent.state)).not.toBe(
      stateFingerprint({ ...opponent.state, turnPlayerRules: [] }),
    );

    const cleaned = cleanupTurnEffects({ state: opponent.state, events: [] });
    expect(cleaned.state.turnPlayerRules).toEqual([]);
  });
});
