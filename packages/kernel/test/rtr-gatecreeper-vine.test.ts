/** Gatecreeper Vine searches one card through two disjoint printed qualities. */
import { parseCard } from '@mtg/dsl';
import {
  eventsOfType,
  pendingDecision,
  scenario,
  validateAction,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST } from './cards';
import { apply, handOidOf } from './helpers';

const VINE = parseCard({
  kind: 'creature',
  id: 'rtr-124-gatecreeper-vine-kernel',
  name: 'Gatecreeper Vine',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 124 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  subtypes: ['Plant'],
  power: 0,
  toughness: 2,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      optional: true,
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'searchLibrary',
          filter: {
            anyOf: [{ cardTypes: ['land'], supertypes: ['basic'] }, { subtypes: ['Gate'] }],
          },
          destination: 'hand',
          reveal: true,
        },
      ],
    },
  ],
});
const GATE = parseCard({
  kind: 'land',
  id: 'rtr-124-test-gate',
  name: 'Gatecreeper Guildgate',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 1241 },
  colors: [],
  supertypes: [],
  subtypes: ['Gate'],
  abilities: [],
});
const NONBASIC = parseCard({
  kind: 'land',
  id: 'rtr-124-test-nonbasic',
  name: 'Gatecreeper Nonbasic',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 1242 },
  colors: [],
  supertypes: [],
  subtypes: [],
  abilities: [],
});
const CREATURE = creature('Gatecreeper Nonland', 1, 1);

function passToOptional(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') throw new Error('Gatecreeper did not reach its optional trigger');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Gatecreeper trigger did not resolve');
}

function opened() {
  return scenario({
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
    hands: [[VINE], []],
    libraries: [[CREATURE, NONBASIC, GATE, FOREST], [CREATURE]],
    seed: 'rtr/gatecreeper-vine',
  });
}

function offered(): { readonly current: ReduceResult; readonly cards: readonly ObjectId[] } {
  const start = opened();
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, VINE.name),
    targets: [],
  });
  const optional = passToOptional(cast);
  const choice = pendingDecision(optional.state);
  if (choice?.kind !== 'optionalTrigger') throw new Error('Gatecreeper optional trigger disappeared');
  const accepted = apply(optional, {
    type: 'answerOptionalTrigger',
    player: choice.player,
    oid: choice.oid,
    accept: true,
  });
  const search = pendingDecision(accepted.state);
  if (search?.kind !== 'searchLibrary') throw new Error('Gatecreeper search was not offered');
  return { current: accepted, cards: search.cards };
}

describe("Gatecreeper Vine's optional search", () => {
  it('offers a basic land and a Gate while refusing both hostile near-misses', () => {
    const { current, cards } = offered();
    expect(cards.map((oid) => current.state.objects[oid]?.card.name)).toEqual([GATE.name, FOREST.name]);
    const nonbasic = current.state.players[0].library.find(
      (oid) => current.state.objects[oid]?.card.name === NONBASIC.name,
    );
    const nonland = current.state.players[0].library.find(
      (oid) => current.state.objects[oid]?.card.name === CREATURE.name,
    );
    if (nonbasic === undefined || nonland === undefined) throw new Error('Gatecreeper near-miss vanished');
    expect(
      validateAction(current.state, { type: 'searchLibrary', player: 0, found: nonbasic }),
    ).not.toBeNull();
    expect(
      validateAction(current.state, { type: 'searchLibrary', player: 0, found: nonland }),
    ).not.toBeNull();
  });

  it('reveals the chosen branch, puts it into hand, and shuffles exactly once', () => {
    const { current, cards } = offered();
    const gate = cards.find((oid) => current.state.objects[oid]?.card.name === GATE.name);
    if (gate === undefined) throw new Error('Gatecreeper did not offer the Gate');
    const done = apply(current, { type: 'searchLibrary', player: 0, found: gate });
    expect(done.state.objects[gate]?.zone).toBe('hand');
    expect(eventsOfType(done.events, 'librarySearchRevealed')).toEqual([
      { type: 'librarySearchRevealed', player: 0, oids: [gate] },
    ]);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('may decline the trigger and may fail to find without moving a card', () => {
    const start = opened();
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, VINE.name),
      targets: [],
    });
    const optional = passToOptional(cast);
    const choice = pendingDecision(optional.state);
    if (choice?.kind !== 'optionalTrigger') throw new Error('Gatecreeper optional trigger disappeared');
    const declined = apply(optional, {
      type: 'answerOptionalTrigger',
      player: choice.player,
      oid: choice.oid,
      accept: false,
    });
    expect(pendingDecision(declined.state)?.kind).not.toBe('searchLibrary');

    const { current } = offered();
    const before = current.state.players[0].library;
    const failed = apply(current, { type: 'searchLibrary', player: 0, found: null });
    expect([...failed.state.players[0].library].sort()).toEqual([...before].sort());
    expect(eventsOfType(failed.events, 'librarySearched').at(-1)).toEqual({
      type: 'librarySearched',
      player: 0,
      found: false,
    });
  });
});
