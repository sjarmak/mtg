/** Haunting Echoes through its public first move and opponent-library search. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, playerOf, scenario } from '@mtg/kernel';
import { creature, lands, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const HAUNTING_ECHOES: Card = parseCard({
  kind: 'sorcery',
  id: 'm11-099',
  name: 'Haunting Echoes',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 99 },
  manaCost: { generic: 3, B: 2 },
  colors: ['B'],
  effects: [
    {
      kind: 'exileNonbasicGraveyardAndMatchingLibrary',
      target: { kind: 'targetPlayer' },
    } as unknown as Effect,
  ],
} as CardInput);

const ECHO = creature('Grave Echo', 2, 2);
const OTHER = creature('Unrelated Witness', 1, 3);

function nonbasicLand(name: string): Card {
  return parseCard({
    kind: 'land',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 299 },
    producesMana: ['B'],
  });
}

const DEPTHS = nonbasicLand('Echoing Depths');

function board(graveyard: readonly Card[] = [ECHO, ECHO, SWAMP, DEPTHS]): ReduceResult {
  return scenario({
    seed: 'haunting-echoes/linked-search',
    battlefield: lands(SWAMP, 5).map((card) => ({ card, controller: 0 as const })),
    hands: [[HAUNTING_ECHOES], []],
    graveyards: [[], graveyard],
    libraries: [[OTHER], [ECHO, OTHER, DEPTHS, ECHO, SWAMP]],
  });
}

function nameOf(result: ReduceResult, oid: string): string | undefined {
  return result.state.objects[oid]?.card.name;
}

function castAndReachSearch(from: ReduceResult): ReduceResult {
  let current = apply(from, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, HAUNTING_ECHOES.name),
    targets: [{ kind: 'player', player: 1 }],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

describe('Haunting Echoes resolution', () => {
  it('exiles nonbasics, offers only derived-name matches to the caster, and permits failing to find', () => {
    let current = castAndReachSearch(board());
    expect(playerOf(current.state, 1).graveyard.map((oid) => nameOf(current, oid))).toEqual(['Swamp']);
    expect(current.state.exile.map((oid) => nameOf(current, oid))).toEqual([
      'Grave Echo',
      'Grave Echo',
      'Echoing Depths',
    ]);

    const first = pendingDecision(current.state);
    expect(first).toEqual(
      expect.objectContaining({
        kind: 'searchLibrary',
        player: 0,
        cards: expect.any(Array),
      }),
    );
    if (first?.kind !== 'searchLibrary') throw new Error('Haunting Echoes did not pause on its search');
    expect(first.cards.map((oid) => nameOf(current, oid))).toEqual([
      'Grave Echo',
      'Echoing Depths',
      'Grave Echo',
    ]);
    expect(current.state.pendingSearch?.libraryOwner).toBe(1);

    current = apply(current, { type: 'searchLibrary', player: 0, found: first.cards[0] ?? null });
    const second = pendingDecision(current.state);
    if (second?.kind !== 'searchLibrary') throw new Error('the multi-card search did not continue');
    current = apply(current, { type: 'searchLibrary', player: 0, found: null });

    expect(
      playerOf(current.state, 1)
        .library.map((oid) => nameOf(current, oid))
        .sort(),
    ).toEqual(['Echoing Depths', 'Grave Echo', 'Swamp', 'Unrelated Witness'].sort());
    expect(current.state.exile.map((oid) => nameOf(current, oid))).toEqual([
      'Grave Echo',
      'Grave Echo',
      'Echoing Depths',
      'Grave Echo',
    ]);
    expect(eventsOfType(current.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);
    expect(playerOf(current.state, 0).library.map((oid) => nameOf(current, oid))).toEqual([
      'Unrelated Witness',
    ]);
  });

  it('moves every chosen match and shuffles once even when no graveyard name seeds the search', () => {
    let chosen = castAndReachSearch(board());
    for (;;) {
      const decision = pendingDecision(chosen.state);
      if (decision?.kind !== 'searchLibrary') break;
      chosen = apply(chosen, {
        type: 'searchLibrary',
        player: decision.player,
        found: decision.cards[0] ?? null,
      });
    }
    expect(
      playerOf(chosen.state, 1)
        .library.map((oid) => nameOf(chosen, oid))
        .sort(),
    ).toEqual(['Swamp', 'Unrelated Witness'].sort());
    expect(eventsOfType(chosen.events, 'libraryShuffled')).toHaveLength(1);

    const basicsOnly = castAndReachSearch(board([SWAMP]));
    expect(pendingDecision(basicsOnly.state)?.kind).not.toBe('searchLibrary');
    expect(playerOf(basicsOnly.state, 1).graveyard.map((oid) => nameOf(basicsOnly, oid))).toEqual(['Swamp']);
    expect(eventsOfType(basicsOnly.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);
  });
});
