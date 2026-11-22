import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, type ReduceResult } from '@mtg/kernel';
import { creature, ISLAND, lands } from './cards';
import { replacement, withReplacements } from './continuous-helpers';
import { apply, handOidOf } from './helpers';

const PSYCHIC_SPIRAL = parseCard({
  kind: 'instant',
  id: 'rtr-47-psychic-spiral-kernel',
  name: 'Psychic Spiral',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 47 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [
    { kind: 'shuffleGraveyardIntoLibrary', printedAllCardsFromYourGraveyard: true },
    {
      kind: 'millCards',
      count: { kind: 'cardsShuffledFromGraveyardThisResolution' },
      target: { kind: 'targetPlayer' },
    },
  ],
});

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Psychic Spiral reached an unexpected decision');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Psychic Spiral stack did not settle');
}

function resolveWith(
  graveyardCards: number,
  target: 0 | 1 = 1,
  targetLibraryCards = 8,
  redirectShuffleBack = false,
): ReduceResult {
  const dead = Array.from({ length: graveyardCards }, (_, index) => creature(`Spiral Dead ${index}`, 1, 1));
  const library = Array.from({ length: targetLibraryCards }, (_, index) =>
    creature(`Spiral Mill ${index}`, 1, 1),
  );
  const start = scenario({
    battlefield: lands(ISLAND, 5).map((card) => ({ card, controller: 0 as const })),
    hands: [[PSYCHIC_SPIRAL], []],
    graveyards: [dead, []],
    libraries: [[], library],
  });
  const positioned = redirectShuffleBack
    ? {
        ...start,
        state: withReplacements(start.state, [
          replacement(
            { kind: 'zoneChange', owner: 0, from: 'graveyard', destination: 'library', cardOnly: true },
            { kind: 'moveToZone', destination: 'exile' },
          ),
        ]),
      }
    : start;
  const cast = apply(positioned, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, PSYCHIC_SPIRAL.name),
    targets: [null, { kind: 'player', player: target }],
  });
  return resolveStack(cast);
}

describe('RTR #47 Psychic Spiral', () => {
  it('mills exactly the cards moved from the caster graveyard by the earlier instruction', () => {
    const done = resolveWith(3);
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)?.oids).toHaveLength(3);
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      PSYCHIC_SPIRAL.name,
    ]);
  });

  it('mills zero from an empty graveyard rather than counting the resolving spell', () => {
    const done = resolveWith(0);
    expect(eventsOfType(done.events, 'cardsMilled')).toEqual([]);
  });

  it('mills only the cards available when the target library is shorter than the linked count', () => {
    const done = resolveWith(4, 1, 2);
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)?.oids).toHaveLength(2);
    expect(done.state.players[1].library).toEqual([]);
  });

  it('does not count graveyard cards whose move to the library was replaced', () => {
    const done = resolveWith(3, 1, 8, true);
    expect(done.state.exile).toHaveLength(3);
    expect(eventsOfType(done.events, 'cardsMilled')).toEqual([]);
  });

  it('may target its controller and mill the cards it just shuffled back', () => {
    const done = resolveWith(3, 0);
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)?.oids).toHaveLength(3);
    expect(done.state.players[0].library).toEqual([]);
  });
});
