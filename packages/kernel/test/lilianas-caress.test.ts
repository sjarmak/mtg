/** Native trigger-context proofs for M11 Liliana's Caress. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  eventsOfType,
  pendingDecision,
  playerOf,
  scenario,
  type ReduceResult,
  type StackEntry,
} from '@mtg/kernel';
import { creature, lands, SWAMP, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

function lilianasCaress(): Card {
  return parseCard({
    kind: 'enchantment',
    id: 'm11-103-lilianas-caress-kernel',
    name: "Liliana's Caress",
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 103 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    abilities: [
      {
        kind: 'triggered',
        condition: 'opponentDiscardsCard',
        effects: [{ kind: 'loseLife', amount: 2, target: { kind: 'triggeringPlayer' } }],
      },
    ],
  });
}

function discardSpell(count: number): Card {
  return sorcery(
    `Discard ${String(count)}`,
    [{ kind: 'discardCards', count, target: { kind: 'targetOpponent' } }],
    { B: 1 },
  );
}

function hand(prefix: string, count: number): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index + 1)}`, 1, 1));
}

function castDiscard(from: ReduceResult, caster: 0 | 1, victim: 0 | 1, count: number): ReduceResult {
  let current = apply(from, {
    type: 'castSpell',
    player: caster,
    oid: handOidOf(from.state, caster, `Discard ${String(count)}`),
    targets: [{ kind: 'player', player: victim }],
  });
  current = apply(current, { type: 'passPriority', player: caster });
  return apply(current, { type: 'passPriority', player: victim });
}

function answerDiscard(from: ReduceResult, victim: 0 | 1): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'handDiscard') throw new Error('discard choice was not offered');
  return apply(from, {
    type: 'chooseDiscards',
    player: victim,
    oids: decision.hand.slice(0, decision.count),
  });
}

function resolveAbilities(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'no'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('trigger stack did not resolve');
  return current;
}

function setup(caster: 0 | 1, count: number): ReduceResult {
  const spell = discardSpell(count);
  return scenario({
    battlefield: [
      { card: lilianasCaress(), controller: 0 },
      ...lands(SWAMP, 2).map((card) => ({ card, controller: caster })),
    ],
    hands:
      caster === 0 ? [[spell], hand('Victim card', count + 1)] : [hand('Victim card', count + 1), [spell]],
    libraries: [lands(SWAMP, 6), lands(SWAMP, 6)],
    active: caster,
  });
}

function abilityEntries(state: ReduceResult['state']): readonly StackEntry[] {
  return state.stack.filter((entry) => entry.ability !== null);
}

describe("Liliana's Caress discard trigger", () => {
  it('retains the opponent who discarded without creating a CR 115 target', () => {
    const discarded = answerDiscard(castDiscard(setup(0, 1), 0, 1, 1), 1);
    const [trigger] = abilityEntries(discarded.state);
    expect(trigger?.triggerContext).toEqual({
      kind: 'opponentDiscardsCard',
      triggeringPlayer: 1,
    });
    expect(trigger?.targets).toEqual([]);

    const resolved = resolveAbilities(discarded);
    expect(playerOf(resolved.state, 1).life).toBe(18);
    expect(playerOf(resolved.state, 0).life).toBe(20);
  });

  it('fires once per discarded card from one batch', () => {
    const discarded = answerDiscard(castDiscard(setup(0, 2), 0, 1, 2), 1);
    const source = oidOf(discarded.state, "Liliana's Caress");
    expect(
      eventsOfType(discarded.events, 'abilityTriggered').filter((event) => event.source === source),
    ).toHaveLength(2);
    expect(abilityEntries(discarded.state)).toHaveLength(2);

    const resolved = resolveAbilities(discarded);
    expect(playerOf(resolved.state, 1).life).toBe(16);
  });

  it('does not fire when its controller discards', () => {
    const discarded = answerDiscard(castDiscard(setup(1, 1), 1, 0, 1), 0);
    const source = oidOf(discarded.state, "Liliana's Caress");
    expect(
      eventsOfType(discarded.events, 'abilityTriggered').filter((event) => event.source === source),
    ).toEqual([]);
    expect(abilityEntries(discarded.state)).toEqual([]);
    expect(playerOf(discarded.state, 0).life).toBe(20);
  });
});
