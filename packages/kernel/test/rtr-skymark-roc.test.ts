import { describe, expect, it } from 'vitest';
import { parseCard, type AbilityInput, type Card } from '@mtg/dsl';
import type { CombatDefender, GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import { beginTrace, moveObject, pendingDecision, scenario } from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { onlyObject, pump, withContinuous } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  printedSourceReference: 'thisCreature',
  optional: true,
  effects: [
    {
      kind: 'returnToHand',
      target: {
        kind: 'targetCreatureDefendingPlayerControls',
        restriction: { kind: 'maxToughness', toughness: 2 },
      },
    },
  ],
};

const ROC = creature('Skymark Roc', 3, 3, {
  cost: { generic: 2, W: 1, U: 1 },
  keywords: ['flying'],
  subtypes: ['Bird'],
  abilities: [TRIGGER],
});
const ALLY = creature('Azorius Ally', 1, 1);
const LEGAL = creature('Low Defender', 2, 2);
const TOO_TOUGH = creature('Tall Defender', 1, 3);

function board(extra: readonly { readonly card: Card; readonly controller: 0 | 1 }[] = []): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: ROC, controller: 0 },
      { card: ALLY, controller: 0 },
      { card: LEGAL, controller: 1 },
      { card: TOO_TOUGH, controller: 1 },
      ...extra,
    ],
    active: 0,
    turn: 4,
    step: 'declareAttackers',
  });
  return { state: start.state, events: [...start.events] };
}

function attack(start: ReduceResult, defender: CombatDefender = 1): ReduceResult {
  return apply(start, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: oidOf(start.state, ROC.name), defender }],
  });
}

function targetOptions(state: GameState): readonly Target[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Skymark Roc did not ask for a target');
  return decision.options.flatMap((option) =>
    option.type === 'chooseTriggerTargets' ? option.targets.filter((target) => target !== null) : [],
  );
}

function aim(start: ReduceResult, target: ObjectId): ReduceResult {
  const decision = pendingDecision(start.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Skymark Roc did not ask for a target');
  const option = decision.options.find(
    (candidate) =>
      candidate.type === 'chooseTriggerTargets' &&
      candidate.targets[0]?.kind === 'permanent' &&
      candidate.targets[0].oid === target,
  );
  if (option?.type !== 'chooseTriggerTargets') throw new Error('the requested Roc target was not offered');
  return apply(start, option);
}

function passUntilQuestion(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Skymark Roc did not settle');
}

function answer(start: ReduceResult, accept: boolean): ReduceResult {
  const asked = passUntilQuestion(start);
  const decision = pendingDecision(asked.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('Skymark Roc was not optional');
  return apply(asked, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

function battle(): Card {
  return parseCard({
    kind: 'battle',
    id: 'tst-skymark-battle',
    name: 'Defended Plaza',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 196 },
    manaCost: { generic: 3 },
    colors: [],
    defense: 4,
  });
}

describe("RTR #196 Skymark Roc's attack trigger", () => {
  it('offers only a defending-player creature with current toughness 2 or less', () => {
    const declared = attack(board());
    expect(targetOptions(declared.state)).toEqual([
      { kind: 'permanent', oid: oidOf(declared.state, LEGAL.name) },
    ]);
  });

  it('returns the chosen creature when accepted and leaves it when declined', () => {
    const declared = attack(board());
    const victim = oidOf(declared.state, LEGAL.name);

    const accepted = answer(aim(declared, victim), true);
    expect(accepted.state.objects[victim]?.zone).toBe('hand');
    expect(accepted.state.players[1].hand).toContain(victim);

    const secondDeclared = attack(board());
    const secondVictim = oidOf(secondDeclared.state, LEGAL.name);
    const declined = answer(aim(secondDeclared, secondVictim), false);
    expect(declined.state.objects[secondVictim]?.zone).toBe('battlefield');
  });

  it('fizzles when the target grows above the ceiling before resolution', () => {
    const declared = attack(board());
    const victim = oidOf(declared.state, LEGAL.name);
    const aimed = aim(declared, victim);
    const grown: ReduceResult = {
      state: withContinuous(aimed.state, [pump(onlyObject(victim), 0, 1)]),
      events: aimed.events,
    };
    const settled = passUntilQuestion(grown);

    expect(settled.state.objects[victim]?.zone).toBe('battlefield');
    expect(settled.state.stack).toHaveLength(0);
    expect(pendingDecision(settled.state)?.kind).not.toBe('optionalTrigger');
  });

  it('fizzles when the target leaves before resolution', () => {
    const declared = attack(board());
    const victim = oidOf(declared.state, LEGAL.name);
    const aimed = aim(declared, victim);
    const removed = moveObject(beginTrace(aimed.state), victim, 'graveyard');
    const settled = passUntilQuestion({ state: removed.state, events: [...aimed.events, ...removed.events] });

    expect(settled.state.objects[victim]?.zone).toBe('graveyard');
    expect(settled.state.stack).toHaveLength(0);
    expect(pendingDecision(settled.state)?.kind).not.toBe('optionalTrigger');
  });

  it.each([
    ['planeswalker', planeswalker('Defended Arbiter', 4, [])],
    ['battle', battle()],
  ] as const)('derives the defending player when attacking a %s', (_kind, defended) => {
    const opened = board([{ card: defended, controller: 1 }]);
    const defenderOid = oidOf(opened.state, defended.name);
    const defender: CombatDefender =
      defended.kind === 'planeswalker'
        ? { kind: 'planeswalker', oid: defenderOid }
        : { kind: 'battle', oid: defenderOid };
    const declared = attack(opened, defender);

    expect(targetOptions(declared.state)).toEqual([
      { kind: 'permanent', oid: oidOf(declared.state, LEGAL.name) },
    ]);
  });
});
