/** Incite through casting, layer 5, declaration legality, and cleanup. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  characteristicsOf,
  legalActions,
  pendingDecision,
  scenario,
  validateAction,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const INCITE = parseCard({
  kind: 'instant',
  id: 'tst-incite',
  name: 'Incite',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 145 },
  colors: ['R'],
  manaCost: { R: 1 },
  effects: [
    { kind: 'setColorsUntilEndOfTurn', colors: ['R'], target: { kind: 'targetCreature' } },
    { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
  ],
});

const BLUE_SCOUT = creature('Blue Scout', 2, 2, { cost: { U: 1 } });

function settleStack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 8; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('Incite stack stalled');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Incite did not resolve');
}

function advanceTo(current: ReduceResult, wanted: GameState['turn']['step']): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 80; guard += 1) {
    if (walked.state.turn.step === wanted) return walked;
    const decision = pendingDecision(walked.state);
    if (decision === null) throw new Error(`Incite ended before ${wanted}`);
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`Incite has no ${decision.kind} option before ${wanted}`);
    walked = apply(walked, option);
  }
  throw new Error(`Incite never reached ${wanted}`);
}

function attackTargets(state: GameState, source: ObjectId): readonly string[] {
  const answers = new Set<string>();
  for (const action of legalActions(state)) {
    if (action.type !== 'declareAttackers') continue;
    const attack = action.attackers.find((candidate) => candidate.oid === source);
    answers.add(attack === undefined ? 'home' : JSON.stringify(attack.defender));
  }
  return [...answers].sort();
}

describe('Incite', () => {
  it('sets red in layer 5, compels an attack without naming its defender, and expires both at cleanup', () => {
    const opened = scenario({
      turn: 2,
      battlefield: [
        { card: BLUE_SCOUT, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[INCITE], []],
    });
    const scout = oidOf(opened.state, BLUE_SCOUT.name);
    const cast = apply(opened, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, INCITE.name),
      targets: [{ kind: 'permanent', oid: scout }, null],
    });
    const resolved = settleStack(cast);

    expect(characteristicsOf(resolved.state, scout).colors).toEqual(['R']);
    expect(resolved.state.turnCombatRules).toEqual([
      { rule: 'attacksThisTurnIfAble', sourceOid: expect.any(String), subject: scout },
    ]);

    const combat = advanceTo(resolved, 'declareAttackers');
    expect(attackTargets(combat.state, scout)).toEqual(['1']);
    expect(validateAction(combat.state, { type: 'declareAttackers', player: 0, attackers: [] })).toBe(
      `${scout} attacks this turn if able and must attack`,
    );

    const nextTurn = advanceTo(combat, 'precombatMain');
    expect(nextTurn.state.turn.number).toBeGreaterThan(2);
    expect(characteristicsOf(nextTurn.state, scout).colors).toEqual(['U']);
    expect(nextTurn.state.turnCombatRules).toEqual([]);
  });
});
