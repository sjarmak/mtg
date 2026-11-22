/** Exact five-card reveal/selection routing for RTR #165, Grisly Salvage. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { Action, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature, FOREST, instant, ISLAND, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const SALVAGE = parseCard({
  kind: 'instant',
  id: 'rtr-165-grisly-salvage-kernel',
  name: 'Grisly Salvage',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 165 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [
    {
      kind: 'selectFromTopLibrary',
      count: 5,
      filter: { cardTypes: ['creature', 'land'] },
      optional: true,
      reveal: true,
      revealAll: true,
      grislySalvageProfile: true,
      destination: 'hand',
      rest: 'graveyard',
    },
  ],
});

const SPELL = instant('Salvage Spell', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const CREATURE = creature('Salvage Creature', 2, 2);
const SORCERY = sorcery('Salvage Sorcery', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const SECOND_CREATURE = creature('Second Salvage Creature', 3, 3);
const BELOW = creature('Below Salvage Window', 4, 4);

function castUntilChoice(library = [SPELL, CREATURE, ISLAND, SORCERY, SECOND_CREATURE, BELOW]): ReduceResult {
  let current = scenario({
    battlefield: [
      ...lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
      ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[SALVAGE], []],
    libraries: [library, library],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, SALVAGE.name),
    targets: [null],
  });
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Grisly Salvage did not reach its selection');
}

function choice(
  result: ReduceResult,
  chosen: string | null,
): Extract<Action, { type: 'selectFromTopLibrary' }> {
  const action = pendingDecision(result.state)?.options.find(
    (candidate): candidate is Extract<Action, { type: 'selectFromTopLibrary' }> =>
      candidate.type === 'selectFromTopLibrary' && candidate.chosen === chosen,
  );
  if (action === undefined) throw new Error('Grisly Salvage choice was not offered');
  return action as Extract<Action, { type: 'selectFromTopLibrary' }>;
}

describe('RTR #165 Grisly Salvage in the kernel', () => {
  it('reveals five, offers only creatures and lands, and graves the ordered remainder', () => {
    const asked = castUntilChoice();
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('topLibrarySelect');
    if (decision?.kind !== 'topLibrarySelect') throw new Error('Grisly Salvage did not ask');
    expect(decision.eligible.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      CREATURE.name,
      ISLAND.name,
      SECOND_CREATURE.name,
    ]);
    expect(decision.options).toHaveLength(4);
    expect(eventsOfType(asked.events, 'libraryTopRevealed').at(-1)?.oids).toEqual(decision.cards);

    const island = decision.eligible[1];
    if (island === undefined) throw new Error('the land was not eligible');
    const action = choice(asked, island);
    const done = apply(asked, action);
    expect(done.state.players[0].hand).toContain(island);
    expect(done.state.players[0].graveyard.slice(0, -1)).toEqual(action.rest);
    expect(done.state.objects[done.state.players[0].graveyard.at(-1)!]?.card.name).toBe(SALVAGE.name);
    expect(done.state.players[0].library).toHaveLength(1);
    expect(done.state.objects[done.state.players[0].library[0]!]?.card.name).toBe(BELOW.name);
  });

  it('allows taking nothing, handles a short library, and refuses a reordered remainder', () => {
    const asked = castUntilChoice([SPELL, CREATURE, ISLAND]);
    const decline = choice(asked, null);
    expect(validateAction(asked.state, { ...decline, rest: [...decline.rest].reverse() })).toBe(
      'the graveyard remainder must preserve the revealed order',
    );
    const done = apply(asked, decline);
    expect(done.state.players[0].library).toEqual([]);
    expect(done.state.players[0].graveyard.slice(0, -1)).toEqual(decline.rest);
    expect(done.state.objects[done.state.players[0].graveyard.at(-1)!]?.card.name).toBe(SALVAGE.name);
  });
});
