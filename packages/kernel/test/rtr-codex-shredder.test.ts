import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  pendingDecision,
  playerOf,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, ISLAND } from './cards';
import { apply, oidOf } from './helpers';

const CODEX_SHREDDER = parseCard({
  kind: 'artifact',
  id: 'rtr-228-codex-shredder-kernel',
  name: 'Codex Shredder',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 228 },
  manaCost: { generic: 1 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } }],
    },
    {
      kind: 'activated',
      printedSourceReference: 'thisArtifact',
      cost: { mana: { generic: 5 }, tapSelf: true, sacrificeSelf: true },
      effects: [{ kind: 'returnToHand', target: { kind: 'targetCardInYourGraveyard' } }],
    },
  ],
} satisfies CardInput);

const BURIED = creature('Codex Buried Card', 2, 2);
const THEIR_BURIED = creature('Codex Opposing Card', 3, 3);

function activation(
  state: ReduceResult['state'],
  source: string,
  abilityIndex: number,
  target: (action: Extract<Action, { type: 'activateAbility' }>) => boolean,
): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === source &&
      action.abilityIndex === abilityIndex &&
      target(action),
  );
  if (found === undefined) throw new Error('Codex Shredder activation was not offered');
  return found;
}

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; current.state.stack.length > 0 && guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Codex Shredder test lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Codex Shredder stack did not resolve');
  return current;
}

function deck(prefix: string, count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 1, 1));
}

describe('RTR #228 Codex Shredder', () => {
  it('targets either player and mills exactly the chosen player top card', () => {
    const opened = scenario({
      battlefield: [{ card: CODEX_SHREDDER, controller: 0 }],
      libraries: [deck('Codex Own Library', 2), deck('Codex Other Library', 2)],
    });
    const source = oidOf(opened.state, CODEX_SHREDDER.name);
    const action = activation(opened.state, source, 0, (candidate) =>
      candidate.targets.some((target) => target?.kind === 'player' && target.player === 1),
    );
    const done = resolveStack(apply(opened, action));

    expect(playerOf(done.state, 0).library).toHaveLength(2);
    expect(playerOf(done.state, 0).graveyard).toHaveLength(0);
    expect(playerOf(done.state, 1).library).toHaveLength(1);
    expect(playerOf(done.state, 1).graveyard).toHaveLength(1);
  });

  it('offers only its controller graveyard and sacrifices before returning the chosen card', () => {
    const opened = scenario({
      battlefield: [
        { card: CODEX_SHREDDER, controller: 0 },
        ...Array.from({ length: 5 }, () => ({ card: ISLAND, controller: 0 as const })),
      ],
      graveyards: [[BURIED], [THEIR_BURIED]],
    });
    const source = oidOf(opened.state, CODEX_SHREDDER.name);
    const action = activation(
      opened.state,
      source,
      1,
      (candidate) =>
        candidate.targets[0]?.kind === 'card' &&
        opened.state.objects[candidate.targets[0].oid]?.card.name === BURIED.name,
    );
    const activated = apply(opened, action);

    expect(activated.state.objects[source]?.zone).toBe('graveyard');
    expect(activated.state.stack).toHaveLength(1);

    const done = resolveStack(activated);
    expect(playerOf(done.state, 0).hand.map((oid) => done.state.objects[oid]?.card.name)).toContain(
      BURIED.name,
    );
    expect(playerOf(done.state, 1).graveyard.map((oid) => done.state.objects[oid]?.card.name)).toContain(
      THEIR_BURIED.name,
    );
  });
});
