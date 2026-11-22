/** Bounded private top-library decisions used by M13 Index, Augur, and Sphinx. */
import { describe, expect, it } from 'vitest';
import type { Action, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  seatState,
  validateAction,
} from '@mtg/kernel';
import { creature, instant, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const INDEX = sorcery('Index', [{ kind: 'reorderTopLibrary', count: 5 }], { U: 1 });
const AUGUR = creature('Augur of Bolas', 1, 3, {
  cost: { generic: 1, U: 1 },
  subtypes: ['Merfolk', 'Wizard'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'selectFromTopLibrary',
          count: 3,
          filter: { cardTypes: ['instant', 'sorcery'] },
          optional: true,
          reveal: true,
          destination: 'hand',
          rest: 'bottom',
        },
      ],
    },
  ],
});
const SPHINX = creature('Sphinx of Uthuun', 5, 6, {
  cost: { generic: 5, U: 2 },
  keywords: ['flying'],
  subtypes: ['Sphinx'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'separateTopLibraryIntoPiles', count: 5 }],
    },
  ],
});

const FIRST = instant('First Spell', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const SECOND = creature('Second Creature', 2, 2);
const THIRD = sorcery('Third Spell', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const FOURTH = creature('Fourth Creature', 4, 4);
const FIFTH = creature('Fifth Creature', 5, 5);
const SIXTH = creature('Sixth Creature', 6, 6);
const LIBRARY = [FIRST, SECOND, THIRD, FOURTH, FIFTH, SIXTH] as const;

function castUntilChoice(card: typeof INDEX | typeof AUGUR | typeof SPHINX): ReduceResult {
  let current = scenario({
    battlefield: lands(ISLAND, 8).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[card], []],
    libraries: [LIBRARY, LIBRARY],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, card.name),
    targets: card.kind === 'sorcery' ? card.effects.map(() => null) : [],
  });
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error(`${card.name} did not reach its top-library choice`);
}

function option<T extends Action['type']>(
  result: ReduceResult,
  type: T,
  predicate: (action: Extract<Action, { type: T }>) => boolean,
): Extract<Action, { type: T }> {
  const found = pendingDecision(result.state)?.options.find(
    (action): action is Extract<Action, { type: T }> =>
      action.type === type && predicate(action as Extract<Action, { type: T }>),
  );
  if (found === undefined) throw new Error(`no ${type} option matched`);
  return found as Extract<Action, { type: T }>;
}

describe('Index', () => {
  it('enumerates all 120 orders deterministically without exposing the private window', () => {
    const asked = castUntilChoice(INDEX);
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('topLibraryOrder');
    expect(decision?.complete).toBe(true);
    expect(decision?.options).toHaveLength(120);
    expect(pendingDecision(castUntilChoice(INDEX).state)?.options).toEqual(decision?.options);
    if (decision?.kind !== 'topLibraryOrder') throw new Error('Index did not ask for an order');
    expect(new Set(decision.options.map((action) => JSON.stringify(action))).size).toBe(120);

    const mine = seatState(asked.state, 0, 'index-controller');
    const theirs = seatState(asked.state, 1, 'index-opponent');
    expect(mine.pendingTopLibrary?.cards).toEqual(decision.cards);
    expect(theirs.pendingTopLibrary).toBeUndefined();
    for (const oid of decision.cards) {
      expect(mine.objects[oid]?.card.name).toBeDefined();
      expect(theirs.objects[oid]).toBeUndefined();
    }

    const reversed = [...decision.cards].reverse();
    const done = apply(
      asked,
      option(asked, 'orderTopLibrary', (action) => JSON.stringify(action.cards) === JSON.stringify(reversed)),
    );
    expect(done.state.players[0].library.slice(0, 5)).toEqual(reversed);
  });

  it('rejects omissions, duplicates, cards below the window, and the wrong chooser', () => {
    const asked = castUntilChoice(INDEX);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'topLibraryOrder') throw new Error('Index did not ask for an order');
    const [first, second, third, fourth, fifth] = decision.cards;
    const below = asked.state.players[0].library[5];
    if ([first, second, third, fourth, fifth, below].some((oid) => oid === undefined)) {
      throw new Error('Index fixture has a short library');
    }
    const complete = [first!, second!, third!, fourth!, fifth!];
    const actions: readonly Extract<Action, { type: 'orderTopLibrary' }>[] = [
      { type: 'orderTopLibrary', player: 0, cards: complete.slice(0, 4) },
      { type: 'orderTopLibrary', player: 0, cards: [first!, first!, third!, fourth!, fifth!] },
      { type: 'orderTopLibrary', player: 0, cards: [first!, second!, third!, fourth!, below!] },
      { type: 'orderTopLibrary', player: 1, cards: complete },
    ];
    for (const action of actions) expect(validateAction(asked.state, action)).not.toBeNull();
  });
});

describe('Augur of Bolas', () => {
  it('offers only spells or no card, reveals the chosen card, and bottoms the ordered remainder', () => {
    const asked = castUntilChoice(AUGUR);
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('topLibrarySelect');
    if (decision?.kind !== 'topLibrarySelect') throw new Error('Augur did not ask for a selection');
    expect(decision.eligible.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      'First Spell',
      'Third Spell',
    ]);
    expect(decision.options).toHaveLength(10);
    expect(decision.complete).toBe(true);

    const chosen = decision.eligible[1];
    if (chosen === undefined) throw new Error('Augur had no second eligible card');
    const rest = decision.cards.filter((oid) => oid !== chosen).reverse();
    const done = apply(
      asked,
      option(
        asked,
        'selectFromTopLibrary',
        (action) => action.chosen === chosen && JSON.stringify(action.rest) === JSON.stringify(rest),
      ),
    );
    expect(done.state.players[0].hand).toContain(chosen);
    expect(done.state.players[0].library.slice(-2)).toEqual(rest);
    expect(eventsOfType(done.events, 'libraryCardsRevealed').at(-1)).toEqual({
      type: 'libraryCardsRevealed',
      player: 0,
      oids: [chosen],
    });
  });

  it('keeps its trigger live after the source leaves before resolution', () => {
    let asked = castUntilChoice(AUGUR);
    const source = oidOf(asked.state, AUGUR.name);
    const removed = moveObject(beginTrace(asked.state), source, 'graveyard');
    asked = { state: removed.state, events: [...asked.events, ...removed.events] };
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'topLibrarySelect') throw new Error('Augur choice disappeared with its source');
    const decline = option(asked, 'selectFromTopLibrary', (action) => action.chosen === null);
    const done = apply(asked, decline);
    expect(done.state.pendingTopLibrary).toBeUndefined();
    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(done.state.players[0].library.slice(-3)).toEqual(decline.rest);
  });
});

describe('Sphinx of Uthuun', () => {
  it('reveals five cards, gives the opponent 16 canonical partitions, then gives its controller both pile choices', () => {
    const asked = castUntilChoice(SPHINX);
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('topLibraryPartition');
    if (decision?.kind !== 'topLibraryPartition') throw new Error('Sphinx did not ask for a partition');
    expect(decision.player).toBe(1);
    expect(decision.options).toHaveLength(16);
    expect(decision.complete).toBe(true);
    expect(eventsOfType(asked.events, 'libraryTopRevealed').at(-1)).toEqual({
      type: 'libraryTopRevealed',
      player: 0,
      oids: decision.cards,
    });
    for (const viewer of [0, 1] as const) {
      const view = seatState(asked.state, viewer, `sphinx-${String(viewer)}`);
      expect(view.pendingTopLibrary?.cards).toEqual(decision.cards);
      for (const oid of decision.cards) expect(view.objects[oid]?.card.name).toBeDefined();
    }

    const partition = option(
      asked,
      'separateTopLibraryPiles',
      (action) => action.first.length === 2 && action.second.length === 3,
    );
    const choosing = apply(asked, partition);
    const pileDecision = pendingDecision(choosing.state);
    expect(pileDecision?.kind).toBe('topLibraryPile');
    expect(pileDecision?.player).toBe(0);
    expect(pileDecision?.options).toEqual([
      { type: 'chooseTopLibraryPile', player: 0, pile: 0 },
      { type: 'chooseTopLibraryPile', player: 0, pile: 1 },
    ]);
    expect(
      validateAction(choosing.state, { type: 'chooseTopLibraryPile', player: 1, pile: 0 }),
    ).not.toBeNull();

    const done = apply(choosing, { type: 'chooseTopLibraryPile', player: 0, pile: 1 });
    for (const oid of partition.second) expect(done.state.objects[oid]?.zone).toBe('hand');
    for (const oid of partition.first) expect(done.state.objects[oid]?.zone).toBe('graveyard');
  });

  it('rejects incomplete, duplicate, and foreign-card partitions', () => {
    const asked = castUntilChoice(SPHINX);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'topLibraryPartition') throw new Error('Sphinx did not ask for a partition');
    const [first, second, third, fourth, fifth] = decision.cards;
    const below = asked.state.players[0].library[5];
    if ([first, second, third, fourth, fifth, below].some((oid) => oid === undefined)) {
      throw new Error('Sphinx fixture has a short library');
    }
    const invalid: readonly Extract<Action, { type: 'separateTopLibraryPiles' }>[] = [
      { type: 'separateTopLibraryPiles', player: 1, first: [first!], second: [second!, third!, fourth!] },
      {
        type: 'separateTopLibraryPiles',
        player: 1,
        first: [first!, first!],
        second: [second!, third!, fourth!],
      },
      {
        type: 'separateTopLibraryPiles',
        player: 1,
        first: [first!, second!],
        second: [third!, fourth!, below!],
      },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });
});
