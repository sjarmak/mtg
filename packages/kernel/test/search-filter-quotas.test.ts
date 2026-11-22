/** Native search execution for printed keyword unions and heterogeneous quotas. */
import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, seatState, validateAction } from '@mtg/kernel';
import { creature, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const BEAST_SEARCH = sorcery(
  'Beast Search',
  [
    {
      kind: 'searchLibrary',
      filter: {
        cardTypes: ['creature'],
        keywords: ['deathtouch', 'hexproof', 'reach', 'trample'],
      },
      destination: 'libraryTop',
      reveal: true,
    } as unknown as Effect,
  ],
  {},
);

const GEM_SEARCH = sorcery(
  'Gem Search',
  [
    {
      kind: 'searchLibrary',
      filterQuotas: [
        { filter: { subtypes: ['Island'] }, count: 1 },
        { filter: { subtypes: ['Swamp'] }, count: 1 },
        { filter: { subtypes: ['Mountain'] }, count: 1 },
      ],
      destination: 'hand',
      reveal: true,
    } as unknown as Effect,
  ],
  {},
);

const INVALID_TOP_QUOTA_SEARCH = {
  ...sorcery('Gem Search', [{ kind: 'shuffleLibrary' }], {}),
  effects: [
    {
      kind: 'searchLibrary',
      filterQuotas: [
        { filter: { subtypes: ['Island'] }, count: 1 },
        { filter: { subtypes: ['Mountain'] }, count: 1 },
      ],
      destination: 'libraryTop',
    } as unknown as Effect,
  ],
} as Card;

let collector = 300;
function typedLand(name: string, subtypes: readonly string[]): Card {
  collector += 1;
  return parseCard({
    kind: 'land',
    id: `tst-search-land-${String(collector)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    producesMana: ['C'],
    subtypes,
  });
}

function cast(start: ReduceResult, spell: Card): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, spell.name),
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

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

function names(state: GameState, oids: readonly ObjectId[]): readonly string[] {
  return oids.map((oid) => state.objects[oid]?.card.name ?? 'concealed');
}

describe('keyword-OR library search', () => {
  it('offers a creature with any listed printed keyword, including hexproof’s ability record', () => {
    const candidates = [
      creature('Adder', 1, 1, { keywords: ['deathtouch'] }),
      creature('Stalker', 2, 2, { keywordAbilities: [{ kind: 'hexproof' }] }),
      creature('Spider', 1, 4, { keywords: ['reach'] }),
      creature('Rhino', 4, 4, { keywords: ['trample'] }),
      creature('Flier', 2, 2, { keywords: ['flying'] }),
      creature('Plain Bear', 2, 2),
    ];
    const asked = cast(scenario({ hands: [[BEAST_SEARCH], []], libraries: [candidates, []] }), BEAST_SEARCH);
    expect(names(asked.state, offered(asked.state))).toEqual(['Adder', 'Stalker', 'Spider', 'Rhino']);
  });

  it('refuses a card that has every other printed characteristic but none of the alternatives', () => {
    const miss = creature('Keywordless Beast', 3, 3, { subtypes: ['Beast'] });
    const asked = cast(scenario({ hands: [[BEAST_SEARCH], []], libraries: [[miss], []] }), BEAST_SEARCH);
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('searchLibrary');
    expect(decision?.options).toEqual([{ type: 'searchLibrary', player: 0, found: null }]);
  });
});

describe('heterogeneous per-filter quotas', () => {
  const island = typedLand('Island Stand-In', ['Island']);
  const swamp = typedLand('Swamp Stand-In', ['Swamp']);
  const mountain = typedLand('Mountain Stand-In', ['Mountain']);
  const secondMountain = typedLand('Second Mountain Stand-In', ['Mountain']);
  const dual = typedLand('Volcanic Stand-In', ['Island', 'Mountain']);
  const forest = typedLand('Forest Stand-In', ['Forest']);

  it('asks each quota in order, banks the cards, reveals and moves them together, and shuffles once', () => {
    const asked = cast(
      scenario({ hands: [[GEM_SEARCH], []], libraries: [[forest, island, dual, swamp, mountain], []] }),
      GEM_SEARCH,
    );
    expect(names(asked.state, offered(asked.state))).toEqual(['Island Stand-In', 'Volcanic Stand-In']);
    const islandOid = offered(asked.state)[0];
    if (islandOid === undefined) throw new Error('the Island quota has no answer');
    const swampQuestion = take(asked, islandOid);
    expect(names(swampQuestion.state, offered(swampQuestion.state))).toEqual(['Swamp Stand-In']);
    expect(swampQuestion.state.objects[islandOid]?.zone).toBe('library');
    const swampOid = offered(swampQuestion.state)[0];
    if (swampOid === undefined) throw new Error('the Swamp quota has no answer');
    const mountainQuestion = take(swampQuestion, swampOid);
    expect(names(mountainQuestion.state, offered(mountainQuestion.state))).toEqual([
      'Volcanic Stand-In',
      'Mountain Stand-In',
    ]);
    const mountainOid = offered(mountainQuestion.state)[1];
    if (mountainOid === undefined) throw new Error('the Mountain quota has no answer');
    const done = take(mountainQuestion, mountainOid);

    expect([islandOid, swampOid, mountainOid].map((oid) => done.state.objects[oid]?.zone)).toEqual([
      'hand',
      'hand',
      'hand',
    ]);
    expect(done.state.objects[offered(mountainQuestion.state)[0] ?? 'missing']?.zone).toBe('library');
    expect(eventsOfType(done.events, 'librarySearched')).toHaveLength(1);
    expect(eventsOfType(done.events, 'librarySearchRevealed').at(-1)?.oids).toEqual([
      islandOid,
      swampOid,
      mountainOid,
    ]);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('may fail one quality without ending the later quotas and never offers one card twice', () => {
    const asked = cast(scenario({ hands: [[GEM_SEARCH], []], libraries: [[dual, swamp], []] }), GEM_SEARCH);
    const dualOid = offered(asked.state)[0];
    if (dualOid === undefined) throw new Error('the dual land was not offered for Island');
    const swampQuestion = take(asked, dualOid);
    const swampOid = offered(swampQuestion.state)[0];
    if (swampOid === undefined) throw new Error('the Swamp was not offered');
    const mountainQuestion = take(swampQuestion, swampOid);
    expect(offered(mountainQuestion.state)).not.toContain(dualOid);
    const done = take(mountainQuestion, null);
    expect(done.state.objects[dualOid]?.zone).toBe('hand');
    expect(done.state.objects[swampOid]?.zone).toBe('hand');
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('completes after the last quota even when aggregate count remains after an earlier decline', () => {
    const asked = cast(
      scenario({ hands: [[GEM_SEARCH], []], libraries: [[island, swamp, mountain, secondMountain], []] }),
      GEM_SEARCH,
    );
    const swampQuestion = take(asked, null);
    const swampOid = offered(swampQuestion.state)[0];
    if (swampOid === undefined) throw new Error('the Swamp quota has no answer');
    const mountainQuestion = take(swampQuestion, swampOid);
    expect(names(mountainQuestion.state, offered(mountainQuestion.state))).toEqual([
      'Mountain Stand-In',
      'Second Mountain Stand-In',
    ]);
    const firstMountainOid = offered(mountainQuestion.state)[0];
    const secondMountainOid = offered(mountainQuestion.state)[1];
    if (firstMountainOid === undefined || secondMountainOid === undefined) {
      throw new Error('the Mountain quota needs two hostile candidates');
    }

    const done = take(mountainQuestion, firstMountainOid);

    expect(done.state.pendingSearch).toBeUndefined();
    expect(done.state.objects[firstMountainOid]?.zone).toBe('hand');
    expect(done.state.objects[secondMountainOid]?.zone).toBe('library');
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('fails closed at runtime when an unparsed quota search targets the library top', () => {
    expect(() =>
      cast(
        scenario({ hands: [[INVALID_TOP_QUOTA_SEARCH], []], libraries: [[island, mountain], []] }),
        INVALID_TOP_QUOTA_SEARCH,
      ),
    ).toThrow(/library-top search destination places one chosen card on top/u);
  });

  it('rejects a card outside the current quota and reveals only candidates to the searching seat', () => {
    const asked = cast(
      scenario({ hands: [[GEM_SEARCH], []], libraries: [[forest, island, swamp], []] }),
      GEM_SEARCH,
    );
    const forestOid = asked.state.players[0].library.find(
      (oid) => asked.state.objects[oid]?.card.name === forest.name,
    );
    if (forestOid === undefined) throw new Error('the hostile Forest is absent');
    expect(
      validateAction(asked.state, { type: 'searchLibrary', player: 0, found: forestOid }),
    ).not.toBeNull();
    expect(seatState(asked.state, 0, 'searcher').objects[forestOid]).toBeUndefined();
    expect(
      seatState(asked.state, 1, 'opponent').objects[offered(asked.state)[0] ?? 'missing'],
    ).toBeUndefined();
    expect(seatState(asked.state, 0, 'searcher').objects[offered(asked.state)[0] ?? 'missing']).toBeDefined();
  });

  it('shows the searching seat both banked cards and current candidates during a pause', () => {
    const asked = cast(
      scenario({ hands: [[GEM_SEARCH], []], libraries: [[island, swamp, mountain], []] }),
      GEM_SEARCH,
    );
    const islandOid = offered(asked.state)[0];
    if (islandOid === undefined) throw new Error('the Island quota has no answer');
    const swampQuestion = take(asked, islandOid);
    const swampOid = offered(swampQuestion.state)[0];
    if (swampOid === undefined) throw new Error('the Swamp quota has no answer');

    const mine = seatState(swampQuestion.state, 0, 'searcher');
    const theirs = seatState(swampQuestion.state, 1, 'opponent');

    expect(mine.pendingSearch?.taken).toEqual([islandOid]);
    expect(mine.pendingSearch?.cards).toEqual([swampOid]);
    expect(mine.objects[islandOid]).toBeDefined();
    expect(mine.objects[swampOid]).toBeDefined();
    expect(theirs.pendingSearch).toBeUndefined();
    expect(theirs.objects[islandOid]).toBeUndefined();
    expect(theirs.objects[swampOid]).toBeUndefined();
  });
});
