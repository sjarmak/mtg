/** Executable and hostile contract for RTR Jace, Architect of Thought. */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  emit,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  putTriggersOnStack,
  resolveTop,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { beginTurn } from '../src/turn';
import { describe, expect, it } from 'vitest';
import { creature, instant, ISLAND, MOUNTAIN, sorcery } from './cards';
import { apply, oidOf } from './helpers';

const JACE = parseCard({
  kind: 'planeswalker',
  id: 'rtr-44-jace-architect-of-thought-kernel',
  name: 'Jace, Architect of Thought',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 44 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'],
  supertypes: ['legendary'],
  subtypes: ['Jace'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [],
      jaceArchitectProfile: 'attackDebuff',
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [],
      jaceArchitectProfile: 'piles',
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [],
      jaceArchitectProfile: 'searchAndCast',
    },
  ],
} as CardInput);

const FIRST = instant('Jace First', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const SECOND = creature('Jace Second', 2, 2);
const THIRD = sorcery('Jace Third', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }]);
const FOURTH = creature('Jace Fourth', 4, 4);
const ATTACKER_A = creature('Jace Attacker A', 3, 3);
const ATTACKER_B = creature('Jace Attacker B', 2, 2);

function activations(
  state: GameState,
  index: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.abilityIndex === index,
  );
}

function activateUntilDecision(state: GameState, index: number): ReduceResult {
  const action = activations(state, index)[0];
  if (action === undefined) throw new Error(`Jace offered no ability ${String(index)}`);
  let current = apply({ state, events: [] }, action);
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'priority' && current.state.stack.length === 0) return current;
    if (decision?.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error(`Jace ability ${String(index)} did not resolve`);
}

function declaredAttack(state: GameState, player: 0 | 1, attackers: readonly ObjectId[]): Trace {
  return emit(beginTrace(state), {
    type: 'attackersDeclared',
    player,
    attacks: attackers.map((oid) => ({ oid, defender: player === 0 ? 1 : 0 })),
  });
}

function resolveTriggers(trace: Trace, since = 0): Trace {
  let current = putTriggersOnStack(trace, collectTriggers(trace, since));
  while (current.state.stack.length > 0) current = resolveTop(current);
  return current;
}

function objectOid(state: GameState, name: string): ObjectId {
  const match = Object.values(state.objects).find((object) => object.card.name === name);
  if (match === undefined) throw new Error(`no object named ${name}`);
  return match.oid;
}

function freeCast(state: GameState, oid: ObjectId): Extract<Action, { type: 'castSpell' }> {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === oid,
  );
  if (action?.type !== 'castSpell') throw new Error(`Jace did not offer ${oid} as a free cast`);
  return action;
}

describe("Jace's +1", () => {
  it('debuffs every opposing attacker once and lasts until the controller next turns', () => {
    const start = scenario({
      battlefield: [
        { card: JACE, controller: 0 },
        { card: ATTACKER_A, controller: 1 },
        { card: ATTACKER_B, controller: 1 },
      ],
    });
    const protectedState = activateUntilDecision(start.state, 0).state;
    const a = oidOf(protectedState, ATTACKER_A.name);
    const b = oidOf(protectedState, ATTACKER_B.name);

    expect(protectedState.attackDebuffs).toHaveLength(1);
    const declared = declaredAttack(protectedState, 1, [a, b]);
    expect(collectTriggers(declared, 0)).toHaveLength(2);
    const resolved = resolveTriggers(declared);
    expect([powerOf(resolved.state, a), powerOf(resolved.state, b)]).toEqual([2, 1]);

    const opponentTurn = beginTurn(beginTrace(protectedState), 1);
    expect(opponentTurn.state.attackDebuffs).toHaveLength(1);
    const ownTurn = beginTurn(beginTrace(opponentTurn.state), 0);
    expect(ownTurn.state.attackDebuffs).toEqual([]);
  });

  it('ignores the controller attackers and survives Jace leaving the battlefield', () => {
    const start = scenario({
      battlefield: [
        { card: JACE, controller: 0 },
        { card: ATTACKER_A, controller: 0 },
        { card: ATTACKER_B, controller: 1 },
      ],
    });
    const protectedState = activateUntilDecision(start.state, 0).state;
    const own = oidOf(protectedState, ATTACKER_A.name);
    const opposing = oidOf(protectedState, ATTACKER_B.name);
    expect(collectTriggers(declaredAttack(protectedState, 0, [own]), 0)).toEqual([]);

    const jace = oidOf(protectedState, JACE.name);
    const withoutJace = moveObject(beginTrace(protectedState), jace, 'graveyard');
    const resolved = resolveTriggers(declaredAttack(withoutJace.state, 1, [opposing]));
    expect(powerOf(resolved.state, opposing)).toBe(1);
  });

  it('does not debuff a new incarnation of an attacker that left before resolution', () => {
    const start = scenario({
      battlefield: [
        { card: JACE, controller: 0 },
        { card: ATTACKER_A, controller: 1 },
      ],
    });
    const protectedState = activateUntilDecision(start.state, 0).state;
    const attacker = oidOf(protectedState, ATTACKER_A.name);
    const declared = declaredAttack(protectedState, 1, [attacker]);
    const stacked = putTriggersOnStack(declared, collectTriggers(declared, 0));
    const left = moveObject(stacked, attacker, 'graveyard');
    const returned = moveObject(left, attacker, 'battlefield', { controller: 1 });
    const done = resolveTop(returned);
    expect(powerOf(done.state, attacker)).toBe(3);
  });
});

describe("Jace's -2", () => {
  function opening(): ReduceResult {
    return activateUntilDecision(
      scenario({
        battlefield: [{ card: JACE, controller: 0 }],
        libraries: [[FIRST, SECOND, THIRD, FOURTH], [ISLAND]],
      }).state,
      1,
    );
  }

  it('has the opponent partition three revealed cards, then hands one pile and bottoms the other in order', () => {
    const asked = opening();
    const decision = pendingDecision(asked.state);
    expect(decision?.kind).toBe('topLibraryPartition');
    if (decision?.kind !== 'topLibraryPartition') throw new Error('Jace did not ask for a partition');
    expect(decision.player).toBe(1);
    expect(decision.options).toHaveLength(4);
    expect(eventsOfType(asked.events, 'libraryTopRevealed').at(-1)?.oids).toEqual(decision.cards);

    const partition = decision.options.find(
      (action) => action.type === 'separateTopLibraryPiles' && action.first.length === 1,
    );
    if (partition?.type !== 'separateTopLibraryPiles') throw new Error('no one-and-two partition');
    const choosing = apply(asked, partition);
    expect(pendingDecision(choosing.state)?.kind).toBe('topLibraryPile');
    const ordering = apply(choosing, { type: 'chooseTopLibraryPile', player: 0, pile: 0 });
    const orderDecision = pendingDecision(ordering.state);
    expect(orderDecision?.kind).toBe('topLibraryOrder');
    if (orderDecision?.kind !== 'topLibraryOrder') throw new Error('Jace did not ask for bottom order');
    const reversed = [...orderDecision.cards].reverse();
    const done = apply(ordering, { type: 'orderTopLibrary', player: 0, cards: reversed });

    for (const oid of partition.first) expect(done.state.objects[oid]?.zone).toBe('hand');
    expect(done.state.players[0].library.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      FOURTH.name,
      ...reversed.map((oid) => done.state.objects[oid]?.card.name),
    ]);
  });

  it('rejects incomplete, duplicate, foreign, and wrong-player partitions', () => {
    const asked = opening();
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'topLibraryPartition') throw new Error('Jace did not ask for a partition');
    const [first, second, third] = decision.cards;
    const foreign = asked.state.players[0].library[3];
    if ([first, second, third, foreign].some((oid) => oid === undefined)) throw new Error('short library');
    const invalid: readonly Extract<Action, { type: 'separateTopLibraryPiles' }>[] = [
      { type: 'separateTopLibraryPiles', player: 1, first: [first!], second: [second!] },
      { type: 'separateTopLibraryPiles', player: 1, first: [first!, first!], second: [second!, third!] },
      { type: 'separateTopLibraryPiles', player: 1, first: [first!], second: [second!, foreign!] },
      { type: 'separateTopLibraryPiles', player: 0, first: [first!], second: [second!, third!] },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });
});

describe("Jace's -8", () => {
  function opening(
    libraries: readonly [readonly Card[], readonly Card[]] = [
      [ISLAND, FIRST],
      [MOUNTAIN, SECOND],
    ],
  ): ReduceResult {
    return activateUntilDecision(
      scenario({ battlefield: [{ card: JACE, controller: 0, loyalty: 8 }], libraries }).state,
      2,
    );
  }

  it('searches each owned library for a nonland, shuffles each, and offers both exact cards in either order', () => {
    let current = opening();
    let decision = pendingDecision(current.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('Jace did not search its controller library');
    expect(current.state.pendingSearch?.libraryOwner).toBe(0);
    expect(decision.cards.map((oid) => current.state.objects[oid]?.card.name)).toEqual([FIRST.name]);
    current = apply(current, { type: 'searchLibrary', player: 0, found: decision.cards[0]! });

    decision = pendingDecision(current.state);
    if (decision?.kind !== 'searchLibrary') throw new Error('Jace did not search the opponent library');
    expect(current.state.pendingSearch?.libraryOwner).toBe(1);
    expect(decision.player).toBe(0);
    expect(decision.cards.map((oid) => current.state.objects[oid]?.card.name)).toEqual([SECOND.name]);
    current = apply(current, { type: 'searchLibrary', player: 0, found: decision.cards[0]! });

    const first = objectOid(current.state, FIRST.name);
    const second = objectOid(current.state, SECOND.name);
    expect(eventsOfType(current.events, 'libraryShuffled').map((event) => event.player)).toEqual([0, 1]);
    expect([current.state.objects[first]?.zone, current.state.objects[second]?.zone]).toEqual([
      'exile',
      'exile',
    ]);
    expect(
      legalActions(current.state)
        .filter((action) => action.type === 'castSpell')
        .map((action) => action.oid),
    ).toEqual(expect.arrayContaining([first, second]));

    current = apply(current, freeCast(current.state, second));
    expect(current.state.objects[second]?.zone).toBe('stack');
    expect(pendingDecision(current.state)?.kind).toBe('freeCast');
    expect(freeCast(current.state, first).oid).toBe(first);
    const decline = legalActions(current.state).find((action) => action.type === 'declineFreeCast');
    if (decline?.type !== 'declineFreeCast') throw new Error('Jace free cast was not optional');
    current = apply(current, decline);
    expect(current.state.objects[first]?.zone).toBe('exile');
    expect(current.state.objects[second]?.zone).toBe('stack');
  });

  it('permits both searches to fail while still shuffling both libraries', () => {
    let current = opening([[ISLAND], [MOUNTAIN]]);
    for (const owner of [0, 1] as const) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'searchLibrary') throw new Error(`Jace did not search player ${String(owner)}`);
      expect(current.state.pendingSearch?.libraryOwner).toBe(owner);
      expect(decision.cards).toEqual([]);
      current = apply(current, { type: 'searchLibrary', player: 0, found: null });
    }
    expect(eventsOfType(current.events, 'libraryShuffled').map((event) => event.player)).toEqual([0, 1]);
    expect(pendingDecision(current.state)?.kind).not.toBe('freeCast');
  });
});
