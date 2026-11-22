/** Hostile native execution proofs for all three M11 Liliana Vess abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  controllerOf,
  eventsOfType,
  legalActions,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
  type Action,
  type GameState,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { artifact, creature, planeswalker } from './cards';
import { apply } from './helpers';

const LILIANA = parseCard({
  kind: 'planeswalker',
  id: 'm11-liliana-vess',
  name: 'Liliana Vess',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 102 },
  manaCost: { generic: 3, B: 2 },
  colors: ['B'],
  supertypes: ['legendary'],
  subtypes: ['Liliana'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'searchLibrary', filter: {}, destination: 'libraryTop', count: 1 }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [
        {
          kind: 'returnFromGraveyard',
          scope: 'creatureCardsInAllGraveyards',
          control: 'you',
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
} satisfies CardInput);

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function walkerOid(state: GameState): string {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === LILIANA.name);
  if (oid === undefined) throw new Error('Liliana left the probe board');
  return oid;
}

function activate(start: ReduceResult, abilityIndex: number, target: Target | null): ReduceResult {
  const action = legalActions(start.state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' &&
      candidate.oid === walkerOid(start.state) &&
      candidate.abilityIndex === abilityIndex &&
      JSON.stringify(candidate.targets[0] ?? null) === JSON.stringify(target),
  );
  if (action === undefined) throw new Error(`Liliana ability ${String(abilityIndex)} was not offered`);
  return reduceAll(reduce(start.state, action).state, PASSES);
}

function rig(overrides: Parameters<typeof scenario>[0] = {}): ReduceResult {
  return scenario({
    battlefield: [{ card: LILIANA, controller: 0, loyalty: 12 }],
    libraries: [[], []],
    ...overrides,
  });
}

describe('Liliana Vess loyalty execution', () => {
  it('makes the targeted hand owner choose the discarded card', () => {
    const first = creature('First Secret', 1, 1);
    const second = artifact('Second Secret');
    const asked = activate(rig({ hands: [[], [first, second]] }), 0, { kind: 'player', player: 1 });
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('Liliana did not pause for the discard');
    expect(decision.player).toBe(1);
    expect(decision.owner).toBe(1);
    expect(decision.hand).toHaveLength(2);
    expect(decision.options.every((option) => option.player === 1)).toBe(true);

    const chosen = decision.hand[1];
    if (chosen === undefined) throw new Error('the discard rig had no second card');
    const done = apply(asked, { type: 'chooseDiscards', player: 1, oids: [chosen] });
    expect(done.state.players[1].graveyard).toContain(chosen);
    expect(eventsOfType(done.events, 'cardsDiscarded').at(-1)?.player).toBe(1);
  });

  it('requires an unrestricted find, shuffles, then preserves that card on top', () => {
    const cards = [
      creature('Chosen Future', 2, 2),
      artifact('Buried Future'),
      planeswalker('Walker Future', 3, []),
    ];
    const asked = activate(rig({ seed: 'liliana/tutor', libraries: [cards, []] }), 1, null);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('Liliana did not pause for the tutor');
    expect(decision.cards).toHaveLength(cards.length);
    expect(decision.options.some((option) => option.type === 'searchLibrary' && option.found === null)).toBe(
      false,
    );
    const found = decision.cards[0];
    if (found === undefined) throw new Error('the tutor rig had no card');

    const done = apply(asked, { type: 'searchLibrary', player: 0, found });
    expect(done.state.players[0].library[0]).toBe(found);
    expect(done.state.objects[found]?.zone).toBe('library');
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
    expect(eventsOfType(done.events, 'zoneChanged').some((event) => event.oid === found)).toBe(false);
  });

  it('finishes an empty unrestricted search without inventing a choice', () => {
    const done = activate(rig({ seed: 'liliana/empty-tutor' }), 1, null);
    expect(pendingDecision(done.state)?.kind).not.toBe('searchLibrary');
    expect(done.state.players[0].library).toEqual([]);
    expect(eventsOfType(done.events, 'librarySearched').at(-1)?.found).toBe(false);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('moves every creature card from both graveyards under the activating controller', () => {
    const mine = creature('Mine to Raise', 2, 2);
    const theirs = creature('Theirs to Raise', 4, 4);
    const left = artifact('Relic Left Behind');
    const done = activate(rig({ graveyards: [[mine, left], [theirs]] }), 2, null);
    const raised = done.state.battlefield.filter((oid) =>
      [mine.name, theirs.name].includes(done.state.objects[oid]?.card.name ?? ''),
    );
    expect(raised).toHaveLength(2);
    expect(raised.map((oid) => done.state.objects[oid]?.owner).sort()).toEqual([0, 1]);
    expect(raised.every((oid) => controllerOf(done.state, oid) === 0)).toBe(true);
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toContain(
      left.name,
    );
    expect(done.state.players[1].graveyard).toEqual([]);
  });

  it('replays the all-graveyards movement byte-for-byte', () => {
    const setup = {
      graveyards: [[creature('Replay Mine', 1, 1)], [creature('Replay Theirs', 1, 1)]],
    } as const;
    const first = activate(rig({ seed: 'liliana/reanimation', ...setup }), 2, null);
    const second = activate(rig({ seed: 'liliana/reanimation', ...setup }), 2, null);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });
});
