/**
 * `CardFilter.names`: the one characteristic a card does not share with its
 * neighbors by construction.
 *
 * Squadron Hawk is the printed reason ("search your library for up to three
 * cards named Squadron Hawk"), and the claim under test is narrower than the
 * card. Every other field on a `CardFilter` selects a *class* — a type, a
 * subtype, a color, a cost bound — so a rig that proved a name filter over a
 * library of assorted cards would prove nothing a `cardTypes` filter could not
 * have proved by accident. Both boards below therefore hold decoys that agree
 * with the named card on every other field and differ only in the name, which
 * is the only board on which "matched by name" and "matched by type" are
 * distinguishable answers.
 *
 * Both zones, in one file, because `asPrintedFilter` is one conversion serving
 * two callers: a field wired into the search and not into the graveyard read
 * would make the graveyard clause looser than the card printed, which is the
 * hazard that conversion's own docblock names.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { pendingDecision, scenario } from '@mtg/kernel';
import { creature, lands, sorcery, PLAINS, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

/** Squadron Hawk's clause without its bird: three of one name, revealed, to hand. */
const CALL_THE_FLOCK = sorcery(
  'Call the Flock',
  [
    {
      kind: 'searchLibrary',
      filter: { names: ['Flock Sentinel'] },
      count: 3,
      reveal: true,
      destination: 'hand',
    },
  ],
  { generic: 1, W: 1 },
);

/** A graveyard clause aimed by name, over the same decoys. */
const CALL_THE_FALLEN = sorcery(
  'Call the Fallen',
  [{ kind: 'chooseFromGraveyard', whose: 'you', filter: { names: ['Flock Sentinel'] }, destination: 'hand' }],
  { generic: 1, B: 1 },
);

/**
 * A decoy that agrees with the named card on every field a `CardFilter` has
 * except the name: same kind, same stats, same cost, same colorless cost, so a
 * kernel matching on anything but the name takes it.
 */
function sentinel(name: string) {
  return creature(name, 1, 1, { cost: { W: 1 } });
}

function searchBoard(): ReduceResult {
  return scenario({
    battlefield: lands(PLAINS, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[CALL_THE_FLOCK], []],
    libraries: [
      [
        sentinel('Flock Sentinel'),
        sentinel('Fen Sentinel'),
        sentinel('Flock Sentinel'),
        sentinel('Flock Sentinels'),
        sentinel('flock sentinel'),
        sentinel('Flock Sentinel'),
      ],
      [creature('Their Deck', 1, 1)],
    ],
    seed: 'filter-names/search',
  });
}

function graveyardBoard(): ReduceResult {
  return scenario({
    battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[CALL_THE_FALLEN], []],
    graveyards: [[sentinel('Fen Sentinel'), sentinel('Flock Sentinel')], [sentinel('Flock Sentinel')]],
    libraries: [[creature('Deck', 1, 1)], [creature('Their Deck', 1, 1)]],
    seed: 'filter-names/graveyard',
  });
}

function resolveSpell(start: ReduceResult, name: string): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function offeredNames(state: GameState, kind: 'searchLibrary' | 'graveyardChoice'): readonly string[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== kind) throw new Error(`a ${kind} was not pending`);
  return decision.cards.map((oid) => state.objects[oid]?.card.name ?? '?');
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

describe('a filter that names the card it wants', () => {
  it('offers only the exact name, over decoys that match on every other field', () => {
    const asked = resolveSpell(searchBoard(), CALL_THE_FLOCK.name);
    expect(offeredNames(asked.state, 'searchLibrary')).toEqual([
      'Flock Sentinel',
      'Flock Sentinel',
      'Flock Sentinel',
    ]);
  });

  it('reads CR 201.2 as a string comparison, so a plural and a lowercasing are other cards', () => {
    const asked = resolveSpell(searchBoard(), CALL_THE_FLOCK.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const spared = asked.state.players[0].library.filter((oid) => !decision.cards.includes(oid));
    expect(spared.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      'Fen Sentinel',
      'Flock Sentinels',
      'flock sentinel',
    ]);
  });

  it('takes every card the name matches and leaves the near misses in the library', () => {
    const asked = resolveSpell(searchBoard(), CALL_THE_FLOCK.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const wanted = [...decision.cards];
    let current = asked;
    for (const oid of wanted) current = take(current, oid);

    expect(wanted.map((oid) => current.state.objects[oid]?.zone)).toEqual(['hand', 'hand', 'hand']);
    expect(current.state.players[0].library).toHaveLength(3);
    expect(pendingDecision(current.state)?.kind).not.toBe('searchLibrary');
  });

  it('narrows the graveyard read the same way, in the caster own graveyard only', () => {
    const asked = resolveSpell(graveyardBoard(), CALL_THE_FALLEN.name);
    expect(offeredNames(asked.state, 'graveyardChoice')).toEqual(['Flock Sentinel']);
  });
});
