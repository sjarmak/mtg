/** Per-attacking-Dragon multiplicity and controller filtering for RTR Utvara Hellkite. */
import { parseCard } from '@mtg/dsl';
import { pendingDecision, reduce, scenario, type ReduceResult } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const DRAGON_TOKEN = {
  name: 'Dragon',
  power: 6,
  toughness: 6,
  colors: ['R'] as const,
  subtypes: ['Dragon'],
  keywords: ['flying'] as const,
};

const UTVARA_HELLKITE = parseCard({
  kind: 'creature',
  id: 'rtr-110-utvara-hellkite-kernel',
  name: 'Utvara Hellkite',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 110 },
  manaCost: { generic: 6, R: 2 },
  colors: ['R'],
  subtypes: ['Dragon'],
  keywords: ['flying'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      attackingCreatureSubtype: 'Dragon',
      effects: [{ kind: 'createToken', count: 1, token: DRAGON_TOKEN }],
    },
  ],
});

const ALLY_DRAGON = creature('Utvara Ally Dragon', 3, 3, { subtypes: ['Dragon'] });
const SECOND_DRAGON = creature('Utvara Second Dragon', 2, 2, { subtypes: ['Dragon'] });
const GOBLIN = creature('Utvara Goblin', 2, 2, { subtypes: ['Goblin'] });

function resolveAll(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 30 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`Utvara paused at ${decision?.kind ?? 'none'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Utvara triggers did not resolve');
  return current;
}

function dragonTokens(result: ReduceResult): readonly string[] {
  return result.state.battlefield.filter((oid) => {
    const object = result.state.objects[oid];
    return object?.token === true && object.card.name === 'Dragon';
  });
}

describe('RTR #110 Utvara Hellkite kernel execution', () => {
  it('fires once for another controlled Dragon and not for a controlled non-Dragon', () => {
    const opened = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: UTVARA_HELLKITE, controller: 0, summoningSick: false },
        { card: ALLY_DRAGON, controller: 0, summoningSick: false },
        { card: GOBLIN, controller: 0, summoningSick: false },
      ],
    });
    const declared = reduce(opened.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [
        { oid: oidOf(opened.state, ALLY_DRAGON.name), defender: 1 },
        { oid: oidOf(opened.state, GOBLIN.name), defender: 1 },
      ],
    });

    expect(declared.events.filter((event) => event.type === 'abilityTriggered')).toHaveLength(1);
    expect(dragonTokens(resolveAll(declared))).toHaveLength(1);
  });

  it('fires independently for itself and each other controlled Dragon', () => {
    const opened = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: UTVARA_HELLKITE, controller: 0, summoningSick: false },
        { card: ALLY_DRAGON, controller: 0, summoningSick: false },
        { card: SECOND_DRAGON, controller: 0, summoningSick: false },
      ],
    });
    const declared = reduce(opened.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [UTVARA_HELLKITE, ALLY_DRAGON, SECOND_DRAGON].map((card) => ({
        oid: oidOf(opened.state, card.name),
        defender: 1 as const,
      })),
    });

    expect(declared.events.filter((event) => event.type === 'abilityTriggered')).toHaveLength(3);
    expect(dragonTokens(resolveAll(declared))).toHaveLength(3);
  });

  it("ignores Dragons that don't share the source controller", () => {
    const opened = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: UTVARA_HELLKITE, controller: 1, summoningSick: false },
        { card: ALLY_DRAGON, controller: 0, summoningSick: false },
      ],
    });
    const declared = reduce(opened.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: oidOf(opened.state, ALLY_DRAGON.name), defender: 1 }],
    });

    expect(declared.events.filter((event) => event.type === 'abilityTriggered')).toEqual([]);
  });
});
