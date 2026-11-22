/** Hostile execution proof for RTR #162, Firemind's Foresight. */
import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario } from '@mtg/kernel';
import { instant, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const FIREMINDS_FORESIGHT = instant(
  "Firemind's Foresight",
  [
    {
      kind: 'searchLibrary',
      filterQuotas: [3, 2, 1].map((manaValue) => ({
        filter: { cardTypes: ['instant'], manaValue },
        count: 1,
      })),
      destination: 'hand',
      reveal: true,
    } as unknown as Effect,
  ],
  {},
);

function cast(start: ReduceResult): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, FIREMINDS_FORESIGHT.name),
    targets: [null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'searchLibrary') throw new Error('a library search is not pending');
  return decision.cards;
}

function names(state: GameState, oids: readonly ObjectId[]): readonly string[] {
  return oids.map((oid) => state.objects[oid]?.card.name ?? 'concealed');
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

function oidNamed(state: GameState, card: Card): ObjectId {
  const oid = state.players[0].library.find((candidate) => state.objects[candidate]?.card.name === card.name);
  if (oid === undefined) throw new Error(`${card.name} is absent from the library`);
  return oid;
}

describe("Firemind's Foresight execution", () => {
  const draw = [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] as const;
  const firstThree = instant('First Three', draw, { generic: 3 });
  const secondThree = instant('Second Three', draw, { generic: 2, U: 1 });
  const two = instant('Exact Two', draw, { generic: 2 });
  const one = instant('Exact One', draw, { U: 1 });
  const zero = instant('Wrong Zero', draw, {});
  const four = instant('Wrong Four', draw, { generic: 4 });
  const sorceryThree = sorcery('Sorcery Three', draw, { generic: 3 });

  it('asks exact instant quotas in order, reveals the choices, and shuffles once at the end', () => {
    const asked = cast(
      scenario({
        hands: [[FIREMINDS_FORESIGHT], []],
        libraries: [[zero, firstThree, sorceryThree, two, four, secondThree, one], []],
      }),
    );
    expect(names(asked.state, offered(asked.state))).toEqual(['First Three', 'Second Three']);
    const threeOid = offered(asked.state)[1];
    if (threeOid === undefined) throw new Error('the mana-value-three quota has no answer');

    const twoQuestion = take(asked, threeOid);
    expect(names(twoQuestion.state, offered(twoQuestion.state))).toEqual(['Exact Two']);
    expect(offered(twoQuestion.state)).not.toContain(threeOid);
    const twoOid = offered(twoQuestion.state)[0];
    if (twoOid === undefined) throw new Error('the mana-value-two quota has no answer');

    const oneQuestion = take(twoQuestion, twoOid);
    expect(names(oneQuestion.state, offered(oneQuestion.state))).toEqual(['Exact One']);
    const oneOid = offered(oneQuestion.state)[0];
    if (oneOid === undefined) throw new Error('the mana-value-one quota has no answer');
    const done = take(oneQuestion, oneOid);

    expect([threeOid, twoOid, oneOid].map((oid) => done.state.objects[oid]?.zone)).toEqual([
      'hand',
      'hand',
      'hand',
    ]);
    for (const hostile of [zero, four, sorceryThree, firstThree]) {
      expect(done.state.objects[oidNamed(done.state, hostile)]?.zone).toBe('library');
    }
    expect(eventsOfType(done.events, 'librarySearchRevealed').at(-1)?.oids).toEqual([
      threeOid,
      twoOid,
      oneOid,
    ]);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('may decline one quota and still asks each later exact value', () => {
    const asked = cast(
      scenario({ hands: [[FIREMINDS_FORESIGHT], []], libraries: [[firstThree, two, one], []] }),
    );
    const twoQuestion = take(asked, null);
    expect(names(twoQuestion.state, offered(twoQuestion.state))).toEqual(['Exact Two']);
    const twoOid = offered(twoQuestion.state)[0];
    if (twoOid === undefined) throw new Error('the later mana-value-two quota has no answer');
    const oneQuestion = take(twoQuestion, twoOid);
    expect(names(oneQuestion.state, offered(oneQuestion.state))).toEqual(['Exact One']);
    const oneOid = offered(oneQuestion.state)[0];
    if (oneOid === undefined) throw new Error('the later mana-value-one quota has no answer');
    const done = take(oneQuestion, oneOid);

    expect(done.state.pendingSearch).toBeUndefined();
    expect(done.state.objects[twoOid]?.zone).toBe('hand');
    expect(done.state.objects[oneOid]?.zone).toBe('hand');
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });
});
