/** Destroy the Evidence's exact destruction, reveal prefix, and graveyard move. */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import type { Action, ReduceResult } from '@mtg/kernel';
import { eventsOfType, legalActions, pendingDecision, scenario } from '@mtg/kernel';
import { creature, FOREST, ISLAND, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const NONLAND_ONE = creature('Evidence One', 2, 2);
const NONLAND_TWO = creature('Evidence Two', 3, 3);
const SPELL = sorcery(
  'Destroy the Evidence',
  [
    {
      kind: 'destroyPermanent',
      controllerLibraryFollowup: 'revealUntilLandToGraveyard',
      target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } },
    } as unknown as Effect,
  ],
  { generic: 4, B: 1 },
);

function board(library: readonly (typeof NONLAND_ONE)[]): ReduceResult {
  return scenario({
    hands: [[SPELL], []],
    battlefield: [
      ...lands(SWAMP, 5).map((card) => ({ card, controller: 0 as const })),
      { card: ISLAND, controller: 1 as const },
    ],
    libraries: [lands(FOREST, 6), library],
    seed: `destroy-the-evidence/${library.map((card) => card.name).join('-')}`,
  });
}

function resolve(start: ReduceResult): ReduceResult {
  const spellOid = handOidOf(start.state, 0, SPELL.name);
  const targetOid = oidOf(start.state, ISLAND.name);
  const cast = legalActions(start.state).find(
    (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
      candidate.type === 'castSpell' &&
      candidate.oid === spellOid &&
      candidate.targets[0]?.kind === 'permanent' &&
      candidate.targets[0].oid === targetOid,
  );
  if (cast === undefined) throw new Error('Destroy the Evidence was not offered against the land');
  let current = apply(start, cast);
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

describe('Destroy the Evidence', () => {
  it('destroys the land, reveals through the first land inclusive, and mills the whole prefix', () => {
    const start = board([NONLAND_ONE, NONLAND_TWO, FOREST, NONLAND_ONE]);
    const target = oidOf(start.state, ISLAND.name);
    const prefix = start.state.players[1].library.slice(0, 3);
    const untouched = start.state.players[1].library[3];
    const done = resolve(start);

    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'libraryTopRevealed').at(-1)).toMatchObject({
      player: 1,
      oids: prefix,
    });
    expect(prefix.map((oid) => done.state.objects[oid]?.zone)).toEqual([
      'graveyard',
      'graveyard',
      'graveyard',
    ]);
    expect(done.state.objects[untouched!]?.zone).toBe('library');
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('reveals and mills the entire remaining library when it contains no land', () => {
    const start = board([NONLAND_ONE, NONLAND_TWO]);
    const library = [...start.state.players[1].library];
    const done = resolve(start);

    expect(eventsOfType(done.events, 'libraryTopRevealed').at(-1)?.oids).toEqual(library);
    expect(done.state.players[1].library).toEqual([]);
    expect(library.map((oid) => done.state.objects[oid]?.zone)).toEqual(['graveyard', 'graveyard']);
  });

  it('destroys the target and emits no empty reveal for an empty library', () => {
    const start = board([]);
    const target = oidOf(start.state, ISLAND.name);
    const done = resolve(start);

    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'libraryTopRevealed')).toEqual([]);
    expect(done.state.players[1].library).toEqual([]);
  });
});
