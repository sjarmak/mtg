/**
 * The library and graveyard vocabulary: shuffle, reveal, tuck, reanimate to
 * hand, empty a graveyard, and the one that has to stop mid-resolution to ask.
 *
 * `searchLibrary` is the reason this file exists and the reason it sits beside
 * `scry.test.ts` rather than inside it. A search is the second effect in this
 * kernel that suspends a resolution to ask its controller a question, and it
 * reuses `scry`'s runner rather than growing a second one — so the assertions
 * that matter are the ones `scry.test.ts` makes about *continuation*: the
 * effects after the pause still run, the triggers from before it still fire in
 * APNAP order, and the seat that is not being asked never sees the window.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameSession, GameSetup, ObjectId, ReduceResult, Seat, Target } from '@mtg/kernel';
import {
  choose,
  createSession,
  eventsOfType,
  humanSeat,
  pendingDecision,
  replaySession,
  scenario,
  seatState,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import { artifact, creature, FOREST, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

function namedLibrary(count = 6) {
  return Array.from({ length: count }, (_, index) => creature(`Library ${String(index + 1)}`, 1, 1));
}

/**
 * Casts `card` from player 0's hand and resolves it with both seats passing.
 *
 * The default target list is one empty slot, because `castSpell` wants one slot
 * per printed effect and every spell here prints one. A spell with two says so.
 */
function resolveSpell(start: ReduceResult, name: string, targets: readonly (Target | null)[] = [null]) {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [...targets],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

describe('shuffleLibrary', () => {
  const SHUFFLE = sorcery('Reorder the Deep', [{ kind: 'shuffleLibrary' }], { U: 1 });

  it('reorders the controller library from the seeded stream and reports it', () => {
    const start = scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[SHUFFLE], []],
      libraries: [namedLibrary(6), namedLibrary(6)],
      seed: 'library/shuffle',
    });
    const before = start.state.players[0].library;
    const done = resolveSpell(start, SHUFFLE.name);

    expect(eventsOfType(done.events, 'libraryShuffled').at(-1)).toEqual({
      type: 'libraryShuffled',
      player: 0,
      cards: 6,
    });
    expect([...done.state.players[0].library].sort()).toEqual([...before].sort());
    expect(done.state.players[0].library).not.toEqual(before);
    expect(done.state.players[1].library).toEqual(start.state.players[1].library);
  });

  it('draws the same order from the same seed and a different one from another', () => {
    const run = (seed: string) => {
      const start = scenario({
        battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
        hands: [[SHUFFLE], []],
        libraries: [namedLibrary(6), namedLibrary(6)],
        seed,
      });
      const done = resolveSpell(start, SHUFFLE.name);
      return done.state.players[0].library.map((oid) => done.state.objects[oid]?.card.name);
    };
    expect(run('library/shuffle')).toEqual(run('library/shuffle'));
    expect(run('library/shuffle')).not.toEqual(run('library/other'));
  });
});

describe('revealTopCards', () => {
  const REVEAL = sorcery('Show the Deep', [{ kind: 'revealTopCards', count: 3 }], { U: 1 });

  it('names the top cards to both seats and leaves them where they were', () => {
    const start = scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[REVEAL], []],
      libraries: [namedLibrary(6), namedLibrary(6)],
    });
    const top = start.state.players[0].library.slice(0, 3);
    const done = resolveSpell(start, REVEAL.name);

    expect(eventsOfType(done.events, 'libraryTopRevealed').at(-1)).toEqual({
      type: 'libraryTopRevealed',
      player: 0,
      oids: top,
    });
    expect(done.state.players[0].library).toEqual(start.state.players[0].library);
  });

  it('reveals the short library rather than inventing cards', () => {
    const start = scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[REVEAL], []],
      libraries: [namedLibrary(2), namedLibrary(6)],
    });
    const done = resolveSpell(start, REVEAL.name);
    expect(eventsOfType(done.events, 'libraryTopRevealed').at(-1)?.oids).toHaveLength(2);
  });
});

describe('putOnLibrary', () => {
  it.each([
    ['top', 0],
    ['bottom', 6],
  ] as const)('puts the target on the %s of its owner library', (position, index) => {
    const victim = creature('Tucked Beast', 2, 2);
    const spell = sorcery(
      `Tuck ${position}`,
      [{ kind: 'putOnLibrary', position, target: { kind: 'targetCreature' } }],
      { U: 1 },
    );
    const start = scenario({
      battlefield: [
        ...lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
        { card: victim, controller: 1 as const },
      ],
      hands: [[spell], []],
      libraries: [namedLibrary(6), namedLibrary(6)],
    });
    const victimOid = oidOf(start.state, victim.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, spell.name),
      targets: [{ kind: 'permanent', oid: victimOid }],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    const done = apply(current, { type: 'passPriority', player: 1 });

    expect(done.state.objects[victimOid]?.zone).toBe('library');
    expect(done.state.players[1].library[index]).toBe(victimOid);
    expect(done.state.players[1].library).toHaveLength(7);
  });
});

describe('returnFromGraveyard to hand', () => {
  it('returns every creature card in the named graveyard to its owner hand', () => {
    const spell = sorcery(
      'Call the Fallen',
      [
        {
          kind: 'returnFromGraveyard',
          scope: 'creatureCardsInPlayerGraveyard',
          destination: 'hand',
          target: { kind: 'targetPlayer' },
        },
      ],
      { U: 1 },
    );
    const buried = [creature('Buried One', 1, 1), creature('Buried Two', 2, 2)];
    const start = scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      graveyards: [[...buried, sorcery('Spent Spell', [{ kind: 'shuffleLibrary' }], { U: 1 })], []],
      libraries: [namedLibrary(6), namedLibrary(6)],
    });
    const done = resolveSpell(start, spell.name, [{ kind: 'player', player: 0 }]);

    const hand = done.state.players[0].hand.map((oid) => done.state.objects[oid]?.card.name);
    expect(hand).toEqual(expect.arrayContaining(['Buried One', 'Buried Two']));
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      'Spent Spell',
      'Call the Fallen',
    ]);
  });
});

describe('exileGraveyard', () => {
  function graveyardScenario(whose: 'you' | 'opponent' | 'each') {
    const spell = sorcery(`Empty the ${whose}`, [{ kind: 'exileGraveyard', whose }], { U: 1 });
    return scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      graveyards: [[creature('Mine', 1, 1)], [creature('Theirs', 1, 1)]],
      libraries: [namedLibrary(6), namedLibrary(6)],
    });
  }

  it.each([
    ['you', ['Theirs'], 1],
    ['opponent', ['Mine'], 1],
    ['each', [], 2],
  ] as const)('exiles the %s graveyard', (whose, remaining, exiled) => {
    const start = graveyardScenario(whose);
    const done = resolveSpell(start, `Empty the ${whose}`);
    const survivors = [...done.state.players[0].graveyard, ...done.state.players[1].graveyard]
      .map((oid) => done.state.objects[oid]?.card.name)
      // The spell itself lands in its controller's graveyard on the way out.
      .filter((name) => name !== `Empty the ${whose}`);
    expect(survivors).toEqual([...remaining]);
    expect(done.state.exile).toHaveLength(exiled);
  });
});

const BORDERLAND = sorcery(
  'Borderland Errand',
  [{ kind: 'searchLibrary', filter: { cardTypes: ['land'], supertypes: ['basic'] }, destination: 'hand' }],
  { G: 1 },
);

function searchScenario(seed = 'library/search') {
  return scenario({
    battlefield: lands(FOREST, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[BORDERLAND], []],
    libraries: [[...namedLibrary(4), ...lands(FOREST, 2)], namedLibrary(6)],
    seed,
  });
}

describe('searchLibrary', () => {
  it('offers every matching card and the option to find nothing', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    expect(decision.player).toBe(0);
    expect(decision.cards.map((oid) => asked.state.objects[oid]?.card.name)).toEqual(['Forest', 'Forest']);
    expect(decision.options).toEqual([
      { type: 'searchLibrary', player: 0, found: decision.cards[0] },
      { type: 'searchLibrary', player: 0, found: decision.cards[1] },
      { type: 'searchLibrary', player: 0, found: null },
    ]);
  });

  it('moves the named card to hand and shuffles what is left', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const found = decision.cards[0];
    if (found === undefined) throw new Error('the search found nothing to offer');
    const before = asked.state.players[0].library;

    const done = apply(asked, { type: 'searchLibrary', player: 0, found });

    expect(done.state.objects[found]?.zone).toBe('hand');
    expect(done.state.players[0].hand).toContain(found);
    expect(done.state.players[0].library).toHaveLength(before.length - 1);
    expect(eventsOfType(done.events, 'libraryShuffled').at(-1)?.player).toBe(0);
    expect(eventsOfType(done.events, 'librarySearched').at(-1)).toEqual({
      type: 'librarySearched',
      player: 0,
      found: true,
    });
  });

  it('accepts finding nothing and leaves the library shuffled but whole', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const before = asked.state.players[0].library;
    const done = apply(asked, { type: 'searchLibrary', player: 0, found: null });

    expect(done.state.players[0].library).toHaveLength(before.length);
    expect([...done.state.players[0].library].sort()).toEqual([...before].sort());
    expect(eventsOfType(done.events, 'librarySearched').at(-1)).toEqual({
      type: 'librarySearched',
      player: 0,
      found: false,
    });
  });

  it('puts the found card onto the battlefield when that is what the card says', () => {
    const spell = sorcery(
      'Errand to the Field',
      [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['land'], supertypes: ['basic'] },
          destination: 'battlefield',
        },
      ],
      { G: 1 },
    );
    const start = scenario({
      battlefield: lands(FOREST, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      libraries: [[...namedLibrary(4), ...lands(FOREST, 2)], namedLibrary(6)],
    });
    const asked = resolveSpell(start, spell.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const found = decision.cards[0];
    if (found === undefined) throw new Error('the search found nothing to offer');

    const done = apply(asked, { type: 'searchLibrary', player: 0, found });
    expect(done.state.objects[found]?.zone).toBe('battlefield');
    expect(done.state.battlefield).toContain(found);
  });

  it('resumes the effects printed after the search', () => {
    const spell = sorcery(
      'Errand and Errand',
      [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['land'], supertypes: ['basic'] },
          destination: 'hand',
        },
        { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      ],
      { G: 1 },
    );
    const start = scenario({
      battlefield: lands(FOREST, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[spell], []],
      libraries: [[...namedLibrary(4), ...lands(FOREST, 2)], namedLibrary(6)],
    });
    const asked = resolveSpell(start, spell.name, [null, null]);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const done = apply(asked, { type: 'searchLibrary', player: 0, found: null });
    expect(done.state.players[0].life).toBe(23);
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      spell.name,
    ]);
  });

  it('refuses a card the filter does not match, one out of the library, and the wrong seat', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const nonLand = asked.state.players[0].library.find(
      (oid) => asked.state.objects[oid]?.card.kind !== 'land',
    );
    const theirs = asked.state.players[1].library[0];
    if (nonLand === undefined || theirs === undefined) throw new Error('the rig was built wrong');
    const invalid: readonly Extract<Action, { type: 'searchLibrary' }>[] = [
      { type: 'searchLibrary', player: 0, found: nonLand },
      { type: 'searchLibrary', player: 0, found: theirs },
      { type: 'searchLibrary', player: 1, found: null },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });
});

describe('search concealment', () => {
  it('shows the searched cards to the searching seat alone', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const mine = seatState(asked.state, 0, 'searcher');
    const theirs = seatState(asked.state, 1, 'opponent');
    for (const oid of decision.cards) {
      expect(mine.objects[oid]?.card.name).toBe('Forest');
      expect(theirs.objects[oid]).toBeUndefined();
    }
    expect(mine.pendingSearch?.cards).toEqual(decision.cards);
    expect(theirs.pendingSearch).toBeUndefined();
  });

  it('keeps the public record of a search down to whether anything was found', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const found = decision.cards[0];
    if (found === undefined) throw new Error('the search found nothing to offer');
    const done = apply(asked, { type: 'searchLibrary', player: 0, found });
    const searched = eventsOfType(done.events, 'librarySearched').at(-1);
    expect(searched).toEqual({ type: 'librarySearched', player: 0, found: true });
    expect(JSON.stringify(searched)).not.toContain(found);
  });
});

const SEARCH_SETUP: GameSetup = {
  seed: 'library/replay',
  decks: [
    {
      name: 'Errands',
      cards: [...Array.from({ length: 12 }, () => BORDERLAND), ...lands(FOREST, 28)],
    },
    { name: 'Forests', cards: lands(FOREST, 40) },
  ],
};
const SEARCH_SEATS: readonly [Seat, Seat] = [humanSeat('A'), humanSeat('B')];

function playedSearchSession(): GameSession {
  let session: GameSession = createSession(SEARCH_SETUP, SEARCH_SEATS);
  for (let step = 0; step < 500; step += 1) {
    const decision = session.pending;
    if (decision === null) throw new Error('replay rig stopped early');
    let pick = 0;
    if (decision.kind === 'mulligan') {
      pick = decision.options.findIndex((action) => action.type === 'keepHand');
    } else if (decision.kind === 'priority') {
      const land = decision.options.findIndex((action) => action.type === 'playLand');
      const spell = decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' && session.state.objects[action.oid]?.card.name === BORDERLAND.name,
      );
      pick = land >= 0 ? land : spell >= 0 ? spell : 0;
    } else if (decision.kind === 'searchLibrary') {
      pick = decision.options.findIndex((action) => action.type === 'searchLibrary' && action.found !== null);
    } else {
      pick = decision.options.findIndex((action) =>
        action.type === 'declareAttackers'
          ? action.attackers.length === 0
          : action.type === 'declareBlockers'
            ? action.blocks.length === 0
            : true,
      );
    }
    if (pick < 0) throw new Error(`no replay option for ${decision.kind}`);
    session = choose(session, pick);
    if (decision.kind === 'searchLibrary') return session;
  }
  throw new Error('replay rig never reached a search');
}

describe('search replay', () => {
  it('reproduces the game from the seed and the same choice list', () => {
    const session = playedSearchSession();
    const replayed = replaySession(SEARCH_SETUP, SEARCH_SEATS, session.choices);
    expect(replayed.choices).toEqual(session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
  });

  it('is answered by the simple agent, so a driven game never stalls on it', () => {
    const asked = resolveSpell(searchScenario(), BORDERLAND.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
    const chosen = simpleAgent('finder').decide({ state: asked.state, player: 0, decision });
    expect(chosen).toEqual({ type: 'searchLibrary', player: 0, found: decision.cards[0] });
    expect(apply(asked, chosen).state.turn.awaiting).toBeNull();
  });
});

/**
 * CR 701.22 from both ends: a graveyard emptied back into the library it came
 * from, and the permanent that goes with it.
 *
 * The negative half is the far graveyard, for the reason every other graveyard
 * test in this file stocks one: `shuffleGraveyardIntoLibrary` takes a
 * `PlayerId` and a kernel that reached both seats would pass every affirmative
 * assertion here. The other negative is the spell itself — a sorcery lands in
 * its controller's graveyard *after* it finishes resolving (CR 608.2m), so a
 * card that empties its own graveyard is still in a graveyard when the dust
 * settles, and an implementation that swept it up would be reading the zone one
 * step too late.
 */
describe('shuffleGraveyardIntoLibrary', () => {
  const RECLAIM = sorcery('Reclaim the Fallen', [{ kind: 'shuffleGraveyardIntoLibrary' }], { U: 1 });

  function reclaimScenario() {
    return scenario({
      battlefield: lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
      hands: [[RECLAIM], []],
      graveyards: [
        [creature('Sunk First', 1, 1), creature('Sunk Second', 2, 2)],
        [creature('Their Dead', 3, 3)],
      ],
      libraries: [namedLibrary(6), namedLibrary(6)],
      seed: 'library/shuffle-back',
    });
  }

  function namesIn(done: ReduceResult, oids: readonly ObjectId[]): readonly string[] {
    return oids.map((oid) => done.state.objects[oid]?.card.name ?? '?');
  }

  it('puts every card in the controller graveyard into their library and shuffles it', () => {
    const done = resolveSpell(reclaimScenario(), RECLAIM.name);

    expect(namesIn(done, done.state.players[0].library)).toEqual(
      expect.arrayContaining(['Sunk First', 'Sunk Second']),
    );
    expect(done.state.players[0].library).toHaveLength(8);
    expect(eventsOfType(done.events, 'libraryShuffled').at(-1)).toEqual({
      type: 'libraryShuffled',
      player: 0,
      cards: 8,
    });
  });

  it('leaves the other seat graveyard and library alone', () => {
    const done = resolveSpell(reclaimScenario(), RECLAIM.name);

    expect(namesIn(done, done.state.players[1].graveyard)).toEqual(['Their Dead']);
    expect(done.state.players[1].library).toHaveLength(6);
    expect(eventsOfType(done.events, 'libraryShuffled').map((event) => event.player)).toEqual([0]);
  });

  it('does not sweep up the spell that did it, which is still resolving', () => {
    const done = resolveSpell(reclaimScenario(), RECLAIM.name);

    expect(namesIn(done, done.state.players[0].graveyard)).toEqual([RECLAIM.name]);
  });

  const VIAL = artifact('Vial of Second Chances', { generic: 2 }, [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 }, tapSelf: true },
      effects: [
        { kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } },
        { kind: 'shuffleGraveyardIntoLibrary', includeSelf: true },
      ],
    },
  ]);

  function vialBoard() {
    return scenario({
      battlefield: [
        ...lands(ISLAND, 2).map((land) => ({ card: land, controller: 0 as const })),
        { card: VIAL, controller: 0 as const },
      ],
      graveyards: [[creature('Sunk First', 1, 1)], []],
      libraries: [namedLibrary(6), namedLibrary(6)],
      seed: 'library/shuffle-back-self',
      turn: 4,
    });
  }

  function activateVial(): ReduceResult {
    const start = vialBoard();
    let current = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(start.state, VIAL.name),
      abilityIndex: 0,
      targets: [null, null],
      sacrifices: [],
    });
    current = apply(current, { type: 'passPriority', player: 0 });
    return apply(current, { type: 'passPriority', player: 1 });
  }

  it('takes the source permanent along when the printed line names it', () => {
    const done = activateVial();
    const vial = done.state.players[0].library.find(
      (oid) => done.state.objects[oid]?.card.name === VIAL.name,
    );

    expect(vial).toBeDefined();
    expect(done.state.battlefield.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      'Island',
      'Island',
    ]);
    expect(done.state.players[0].graveyard).toHaveLength(0);
    expect(done.state.players[0].library).toHaveLength(8);
    expect(done.state.players[0].life).toBe(25);
  });
});
