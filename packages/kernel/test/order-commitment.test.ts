import { describe, expect, it } from 'vitest';
import type {
  Action,
  DeckList,
  Decision,
  GameSession,
  GameSetup,
  GameState,
  PlayerId,
  Seat,
} from '@mtg/kernel';
import {
  asksInSteps,
  choose,
  createSession,
  humanSeat,
  passIndex,
  replaySession,
  serializeEvents,
  stateFingerprint,
  undo,
  undoTo,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { creature, lands, MOUNTAIN } from './cards';

type OrderKind = 'orderBlockers' | 'orderAttackers';

const GANG_SIZE = 6;

const distinctCreatures = (prefix: string, count: number): readonly Card[] =>
  Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 2, 2));

const WALL = creature('Rampart Wall', 1, 9, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'canBlockAnyNumber' } }],
});

const deck = (name: string, spells: readonly Card[]): DeckList => ({
  name,
  cards: [...lands(MOUNTAIN, 40 - spells.length), ...spells],
});

const seats = (): readonly [Seat, Seat] => [humanSeat('One'), humanSeat('Two')];

function creaturesOf(state: GameState, player: PlayerId): number {
  return state.battlefield.filter((oid) => {
    const object = state.objects[oid];
    return object?.controller === player && object.card.kind === 'creature';
  }).length;
}

interface Table {
  readonly kind: OrderKind;
  readonly setup: GameSetup;
  readonly creatureLimit: readonly [number, number];
  readonly attackersWanted: number;
  readonly defendersWanted: number;
}

const GANG_BLOCK: Table = {
  kind: 'orderBlockers',
  setup: {
    seed: 'order-commitment/gang-block',
    decks: [deck('One', distinctCreatures('Bellower', 16)), deck('Two', distinctCreatures('Blocker', 20))],
    maximumTurns: 60,
  },
  creatureLimit: [1, GANG_SIZE],
  attackersWanted: 1,
  defendersWanted: GANG_SIZE,
};

const GANG_ATTACK: Table = {
  kind: 'orderAttackers',
  setup: {
    seed: 'order-commitment/gang-attack',
    decks: [
      deck('One', distinctCreatures('Raider', 20)),
      deck(
        'Two',
        Array.from({ length: 16 }, () => WALL),
      ),
    ],
    maximumTurns: 60,
  },
  creatureLimit: [GANG_SIZE, 1],
  attackersWanted: GANG_SIZE,
  defendersWanted: 1,
};

function attackChoice(table: Table, state: GameState, decision: Decision): number {
  const sizeOf = (option: Action): number =>
    option.type === 'declareAttackers' ? option.attackers.length : -1;
  const held = decision.options.findIndex((option) => sizeOf(option) === 0);
  if (decision.player !== 0 || creaturesOf(state, 1) < table.defendersWanted) return held;
  const swing = decision.options.findIndex((option) => sizeOf(option) === table.attackersWanted);
  return swing < 0 ? held : swing;
}

function blockChoice(decision: Decision): number {
  let widest = 0;
  let at = 0;
  for (const [index, option] of decision.options.entries()) {
    const blocks = option.type === 'declareBlockers' ? option.blocks.length : 0;
    if (blocks > widest) {
      widest = blocks;
      at = index;
    }
  }
  return at;
}

function nextChoice(table: Table, session: GameSession, decision: Decision): number {
  if (decision.kind === 'mulligan') {
    const keep = decision.options.findIndex((option) => option.type === 'keepHand');
    return keep < 0 ? 0 : keep;
  }
  if (decision.kind === 'declareAttackers') return attackChoice(table, session.state, decision);
  if (decision.kind === 'declareBlockers') return blockChoice(decision);
  if (decision.kind !== 'priority')
    return decision.options.findLastIndex((option) => option.type !== 'concede');
  const land = decision.options.findIndex((option) => option.type === 'playLand');
  if (land >= 0) return land;
  const cast = decision.options.findIndex((option) => option.type === 'castSpell');
  const limit = table.creatureLimit[decision.player];
  if (cast >= 0 && creaturesOf(session.state, decision.player) < limit) return cast;
  return passIndex(decision) ?? 0;
}

function settledPositions(kind: OrderKind, state: GameState): number {
  const marker = kind === 'orderBlockers' ? state.combat.ordered : state.combat.attackersOrdered;
  return Object.values(marker ?? {}).reduce((total, count) => total + count, 0);
}

function announcedOrders(kind: OrderKind, session: GameSession): number {
  const announcement = kind === 'orderBlockers' ? 'blockerOrderChosen' : 'attackerOrderChosen';
  return session.events.filter((event) => event.type === announcement).length;
}

interface Ordering {
  readonly table: Table;
  readonly before: GameSession;
  readonly interiors: readonly GameSession[];
  readonly finished: GameSession;
}

function reachedOrdering(table: Table): Ordering {
  let session = createSession(table.setup, seats());
  for (let step = 0; step < 6000 && session.pending !== null; step += 1) {
    const decision = session.pending;
    if (decision.kind === table.kind && asksInSteps(decision)) {
      const before = session;
      const interiors: GameSession[] = [];
      let current = session;
      for (let inner = 0; inner < 40 && current.pending?.kind === table.kind; inner += 1) {
        current = choose(current, 0);
        if (current.pending?.kind === table.kind) interiors.push(current);
      }
      return { table, before, interiors, finished: current };
    }
    session = choose(session, nextChoice(table, session, decision));
  }
  throw new Error(`the driven game never reached a stepwise ${table.kind}`);
}

const ORDERINGS: readonly Ordering[] = [reachedOrdering(GANG_BLOCK), reachedOrdering(GANG_ATTACK)];

describe.each(ORDERINGS)('undo around a $table.kind asked one position at a time', (ordering) => {
  const { table, before, interiors, finished } = ordering;
  const { kind, setup } = table;

  it('records an interior: some positions settled, the rest still owed, nothing announced', () => {
    expect(interiors.length).toBeGreaterThanOrEqual(1);
    expect(settledPositions(kind, before.state)).toBe(0);
    expect(settledPositions(kind, finished.state)).toBe(0);
    for (const interior of interiors) {
      expect(interior.choices.length).toBeGreaterThan(before.choices.length);
      expect(interior.choices.length).toBeLessThan(finished.choices.length);
      expect(interior.pending?.kind).toBe(kind);
      expect(settledPositions(kind, interior.state)).toBeGreaterThan(0);
      expect(announcedOrders(kind, interior)).toBe(announcedOrders(kind, before));
      expect(stateFingerprint(interior.state)).not.toBe(stateFingerprint(before.state));
    }
    expect(announcedOrders(kind, finished)).toBeGreaterThan(announcedOrders(kind, before));
  });

  it('has that interior as a prefix of the recording above the commit floor', () => {
    expect(finished.committed?.floor ?? 0).toBeLessThanOrEqual(before.choices.length);
    for (const interior of interiors) {
      const replayed = replaySession(
        setup,
        finished.seats,
        finished.choices.slice(0, interior.choices.length),
      );
      expect(replayed.pending?.kind).toBe(kind);
      expect(settledPositions(kind, replayed.state)).toBeGreaterThan(0);
      expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(interior.state));
    }
  });

  it('pops the whole order from every prefix inside it, landing where the order opened', () => {
    for (const from of [...interiors, finished]) {
      for (let keep = before.choices.length; keep < from.choices.length; keep += 1) {
        const landed = undoTo(setup, from, keep);
        expect(landed.choices).toEqual(before.choices);
        expect(landed.pending?.kind).toBe(kind);
        expect(settledPositions(kind, landed.state)).toBe(0);
        expect(stateFingerprint(landed.state)).toBe(stateFingerprint(before.state));
        expect(serializeEvents(landed.events)).toBe(serializeEvents(before.events));
        expect(landed.committed).toEqual(before.committed);
      }
    }
  });

  it('pops the whole order on a plain undo pressed from inside it', () => {
    for (const interior of interiors) {
      const floor = interior.committed?.floor ?? 0;
      const back = undo(setup, interior);
      expect(settledPositions(kind, back.state)).toBe(0);
      expect(back.choices.length).toBeLessThanOrEqual(before.choices.length);
      expect(back.choices.length).toBeGreaterThanOrEqual(floor);
    }
  });

  it('keeps a finished order when the rewind names it exactly', () => {
    const landed = undoTo(setup, finished, finished.choices.length);
    expect(landed.choices).toEqual(finished.choices);
    expect(stateFingerprint(landed.state)).toBe(stateFingerprint(finished.state));
  });

  it('replays the popped order to the same state and log it reached the first time', () => {
    const answers = finished.choices.slice(before.choices.length);
    for (const interior of interiors) {
      let again = undoTo(setup, finished, interior.choices.length);
      for (const answer of answers) again = choose(again, answer);
      expect(again.choices).toEqual(finished.choices);
      expect(stateFingerprint(again.state)).toBe(stateFingerprint(finished.state));
      expect(serializeEvents(again.events)).toBe(serializeEvents(finished.events));
    }
    const replayed = replaySession(setup, finished.seats, finished.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(finished.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(finished.events));
  });
});
