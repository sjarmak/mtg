/**
 * `targetCreatureDefendingPlayerControls`: an attack trigger that can only
 * reach across the table.
 *
 * CR 506.2's defending player is a role that exists only inside the combat the
 * source is attacking in, which is why the DSL refuses the kind anywhere but a
 * `selfAttacks` trigger (`packages/dsl/src/validate/abilities.ts`) and why the
 * kernel can derive who that player is without being told
 * (`target-choices.ts`). What is asserted here is the narrowing itself, off the
 * enumeration the kernel offers rather than off the outcome: a shrink aimed at
 * the attacker's own board is a legal move the card does not have, and the only
 * place that is visible is the option list.
 *
 * The negative control is a creature on each side. A test with enemies alone
 * would pass on a kernel that had ignored the kind entirely and offered every
 * creature on the battlefield.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { GameState, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, opponentOf, pendingDecision, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

/** `Whenever CARDNAME attacks, target creature defending player controls gets -2/-2 until end of turn.` */
const WITHERING_ATTACK: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: -2,
      target: { kind: 'targetCreatureDefendingPlayerControls' },
    },
  ],
};

/** The same trigger reaching the whole board, as the control on the narrowing. */
const UNRESTRICTED_ATTACK: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [{ kind: 'pumpUntilEndOfTurn', power: -2, toughness: -2, target: { kind: 'targetCreature' } }],
};

function attacker(ability: AbilityInput): Card {
  return creature('Withering Reach', 2, 2, { cost: { generic: 2, B: 1 }, abilities: [ability] });
}

const ALLY: Card = creature('Shieldbearer', 2, 2);
const FIRST_ENEMY: Card = creature('Marsh Lurker', 3, 3);
const SECOND_ENEMY: Card = creature('Bog Sentry', 1, 4);

/** One creature of the attacker's beside the attacker, two across the table. */
function board(ability: AbilityInput): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: attacker(ability), controller: 0 },
      { card: ALLY, controller: 0 },
      { card: FIRST_ENEMY, controller: 1 },
      { card: SECOND_ENEMY, controller: 1 },
    ],
    active: 0,
    turn: 4,
    step: 'declareAttackers',
  });
  return { state: start.state, events: [...start.events] };
}

/** Declares the one attack, which is what puts the trigger on the stack. */
function attack(current: ReduceResult): ReduceResult {
  const active = current.state.turn.active;
  const source = oidOf(current.state, 'Withering Reach');
  return apply(current, {
    type: 'declareAttackers',
    player: active,
    attackers: [{ oid: source, defender: opponentOf(active) }],
  });
}

function offeredTargets(state: GameState): readonly (Target | null)[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
  return decision.options.map((option) =>
    option.type === 'chooseTriggerTargets' ? (option.targets[0] ?? null) : null,
  );
}

function permanents(state: GameState, ...names: readonly string[]): readonly Target[] {
  return names.map((name): Target => ({ kind: 'permanent', oid: oidOf(state, name) }));
}

describe('an attack trigger that names the defending player', () => {
  it('offers the defending player creatures and nothing of the attacker own', () => {
    const declared = attack(board(WITHERING_ATTACK));
    const state = declared.state;

    expect(offeredTargets(state)).toEqual(permanents(state, 'Marsh Lurker', 'Bog Sentry'));
  });

  /**
   * The control, on the identical board: the wider kind offers all four bodies,
   * so the two assertions differ in the printed target kind and in nothing else.
   */
  it('is narrower than the kind that names any creature, on the same board', () => {
    const declared = attack(board(UNRESTRICTED_ATTACK));
    const state = declared.state;

    expect(offeredTargets(state)).toEqual(
      permanents(state, 'Withering Reach', 'Shieldbearer', 'Marsh Lurker', 'Bog Sentry'),
    );
  });

  /** The chosen target is the one that shrinks, so the narrowing is not cosmetic. */
  it('lands the shrink on the defending player creature it was aimed at', () => {
    const declared = attack(board(WITHERING_ATTACK));
    const victim = oidOf(declared.state, 'Marsh Lurker');
    const decision = pendingDecision(declared.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');
    const option = decision.options.find(
      (entry) =>
        entry.type === 'chooseTriggerTargets' &&
        entry.targets[0]?.kind === 'permanent' &&
        entry.targets[0].oid === victim,
    );
    if (option === undefined) throw new Error('the victim was not offered');
    const aimed = apply(declared, option);

    let current = aimed;
    for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision === null || decision.kind !== 'priority') break;
      current = apply(current, { type: 'passPriority', player: decision.player });
    }

    const added = eventsOfType(current.events, 'continuousEffectAdded');
    expect(added.map((event) => event.targetOid)).toEqual([victim]);
    expect(added[0]?.power).toBe(-2);
  });
});
