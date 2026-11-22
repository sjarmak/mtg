/** CR 103 pregame actions, through the same decision seam as every game move. */
import { describe, expect, it } from 'vitest';
import { openingHandActionOf, parseCard, type Card } from '@mtg/dsl';
import {
  createGame,
  eventsOfType,
  pendingDecision,
  reduce,
  stateFingerprint,
  toughnessOf,
  validateAction,
  type Action,
  type Decision,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';

function openingCard(name: string, abilities: Card['abilities'] = []): Card {
  return parseCard({
    kind: 'enchantment',
    id: name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-'),
    name,
    rarity: 'rare',
    set: { code: 'OHA', collectorNumber: 1 },
    manaCost: { generic: 2, G: 2 },
    colors: ['G'],
    openingHandAction: { kind: 'beginOnBattlefield' },
    abilities,
  });
}

const LEYLINE = openingCard('Opening Hand Leyline');
const ORDINARY = parseCard({
  kind: 'enchantment',
  id: 'ordinary-enchantment',
  name: 'Ordinary Enchantment',
  rarity: 'common',
  set: { code: 'OHA', collectorNumber: 2 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
});
const ZERO = parseCard({
  kind: 'creature',
  id: 'opening-zero',
  name: 'Opening Zero',
  rarity: 'rare',
  set: { code: 'OHA', collectorNumber: 3 },
  manaCost: { generic: 1 },
  power: 1,
  toughness: 1,
  openingHandAction: { kind: 'beginOnBattlefield' },
});
const WITHERING = openingCard('Opening Withering', [
  {
    kind: 'static',
    scope: 'creaturesYouControl',
    subtype: null,
    modification: { kind: 'statBonus', power: -1, toughness: -1 },
  },
]);
const VITALITY = openingCard('Opening Vitality', [
  {
    kind: 'static',
    scope: 'creaturesYouControl',
    subtype: null,
    modification: { kind: 'statBonus', power: 0, toughness: 1 },
  },
]);
const ARRIVAL = openingCard('Opening Arrival', [
  {
    kind: 'triggered',
    condition: 'selfEnters',
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
]);

function deck(name: string, cards: readonly Card[]) {
  return { name, cards };
}

function asked(state: GameState): Decision {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the kernel is waiting on nobody');
  return decision;
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const step = reduce(current.state, action);
  return { state: step.state, events: [...current.events, ...step.events] };
}

function keep(current: ReduceResult): ReduceResult {
  const decision = asked(current.state);
  if (decision.kind !== 'mulligan') throw new Error(`asked for ${decision.kind}, not a mulligan`);
  return apply(current, {
    type: 'keepHand',
    player: decision.player,
    bottom: decision.hand.slice(0, decision.count),
  });
}

function afterKeeps(
  cards: readonly [readonly Card[], readonly Card[]],
  seed = 'opening-actions/v1',
  openingHandSize = cards[0].length,
) {
  return keep(
    keep(
      createGame({
        seed,
        openingHandSize,
        decks: [deck('one', cards[0]), deck('two', cards[1])],
      }),
    ),
  );
}

function openingDecision(state: GameState): Extract<Decision, { kind: 'openingHandAction' }> {
  const decision = asked(state);
  if (decision.kind !== 'openingHandAction') {
    throw new Error(`asked for ${decision.kind}, not an opening-hand action`);
  }
  return decision;
}

function choose(current: ReduceResult, oid: ObjectId | null): ReduceResult {
  const decision = openingDecision(current.state);
  return apply(current, { type: 'chooseOpeningHandAction', player: decision.player, oid });
}

describe('opening-hand actions begin only after mulligans', () => {
  it('asks the starting player after both seats keep, before turn 1 begins', () => {
    const current = afterKeeps([
      [LEYLINE, LEYLINE],
      [LEYLINE, LEYLINE],
    ]);
    const decision = openingDecision(current.state);

    expect(decision.player).toBe(current.state.config.startingPlayer);
    expect(decision.cards).toEqual(current.state.players[decision.player].hand);
    expect(decision.options.map((option) => option.type)).toEqual([
      'chooseOpeningHandAction',
      'chooseOpeningHandAction',
      'chooseOpeningHandAction',
    ]);
    expect(decision.options.at(-1)).toEqual({
      type: 'chooseOpeningHandAction',
      player: decision.player,
      oid: null,
    });
    expect(current.state.turn.number).toBe(0);
  });

  it('skips the phase entirely when neither opening hand has an eligible card', () => {
    const current = afterKeeps([
      [ORDINARY, ORDINARY],
      [ORDINARY, ORDINARY],
    ]);
    expect(current.state.turn.number).toBe(1);
    expect(asked(current.state).kind).toBe('priority');
  });
});

describe('each player takes every chosen action in their own order', () => {
  it('moves two copies one at a time, then asks the opponent', () => {
    let current = afterKeeps([
      [LEYLINE, LEYLINE],
      [LEYLINE, LEYLINE],
    ]);
    const first = openingDecision(current.state);
    const reversed = [...first.cards].reverse();

    current = choose(current, reversed[0] ?? null);
    expect(openingDecision(current.state).player).toBe(first.player);
    current = choose(current, reversed[1] ?? null);

    const opponent = openingDecision(current.state);
    expect(opponent.player).not.toBe(first.player);
    expect(current.state.battlefield).toEqual(reversed);
    for (const oid of reversed) {
      expect(current.state.objects[oid]).toEqual(
        expect.objectContaining({ zone: 'battlefield', owner: first.player, controller: first.player }),
      );
    }
  });

  it('lets a player finish while eligible cards remain and starts turn 1 after both finish', () => {
    let current = afterKeeps([
      [LEYLINE, LEYLINE],
      [LEYLINE, LEYLINE],
    ]);
    const first = openingDecision(current.state);
    current = choose(current, null);
    expect(openingDecision(current.state).player).not.toBe(first.player);
    current = choose(current, null);

    expect(current.state.turn.number).toBe(1);
    expect(asked(current.state).kind).toBe('priority');
    expect(current.state.battlefield).toEqual([]);
  });
});

describe('opening-hand actions validate current state', () => {
  it('rejects a library card, an opponent card, an ordinary card, and the wrong seat', () => {
    const current = afterKeeps(
      [
        [LEYLINE, ORDINARY, LEYLINE, ORDINARY],
        [ORDINARY, ORDINARY, ORDINARY, ORDINARY],
      ],
      'opening-actions/hostile',
      3,
    );
    const decision = openingDecision(current.state);
    const player = decision.player;
    const libraryCard = current.state.players[player].library[0];
    const opponentCard = current.state.players[player === 0 ? 1 : 0].hand[0];
    const ordinary = current.state.players[player].hand.find((oid) => {
      const card = current.state.objects[oid]?.card;
      return card !== undefined && openingHandActionOf(card) === undefined;
    });
    if (libraryCard === undefined || opponentCard === undefined || ordinary === undefined) {
      throw new Error('hostile opening did not contain every probe object');
    }

    expect(
      validateAction(current.state, { type: 'chooseOpeningHandAction', player, oid: libraryCard }),
    ).toMatch(/opening hand|hand/iu);
    expect(
      validateAction(current.state, { type: 'chooseOpeningHandAction', player, oid: opponentCard }),
    ).toMatch(/opening hand|your hand/iu);
    expect(validateAction(current.state, { type: 'chooseOpeningHandAction', player, oid: ordinary })).toMatch(
      /opening-hand action|eligible/iu,
    );
    expect(
      validateAction(current.state, {
        type: 'chooseOpeningHandAction',
        player: player === 0 ? 1 : 0,
        oid: decision.cards[0] ?? null,
      }),
    ).toContain(`player ${String(player)}`);
  });

  it('cannot take an opening-hand action after the phase ends', () => {
    let current = afterKeeps([
      [LEYLINE, LEYLINE],
      [ORDINARY, ORDINARY],
    ]);
    const card = openingDecision(current.state).cards[0];
    if (card === undefined) throw new Error('missing Leyline');
    current = choose(current, null);
    expect(current.state.turn.number).toBe(1);
    expect(validateAction(current.state, { type: 'chooseOpeningHandAction', player: 0, oid: card })).toMatch(
      /opening-hand|different decision/iu,
    );
  });
});

describe('pregame actions defer game processing until the game begins', () => {
  it('does not check state-based actions between two choices by one player', () => {
    let current = afterKeeps(
      [
        [WITHERING, ZERO, VITALITY],
        [ORDINARY, ORDINARY, ORDINARY],
      ],
      'opening-actions/sba',
    );
    const decision = openingDecision(current.state);
    const withering = decision.cards.find((oid) => current.state.objects[oid]?.card.id === WITHERING.id);
    const zero = decision.cards.find((oid) => current.state.objects[oid]?.card.id === ZERO.id);
    const vitality = decision.cards.find((oid) => current.state.objects[oid]?.card.id === VITALITY.id);
    if (withering === undefined || zero === undefined || vitality === undefined) {
      throw new Error('missing pregame permanents');
    }

    current = choose(current, withering);
    current = choose(current, zero);
    expect(current.state.objects[zero]?.zone).toBe('battlefield');
    expect(toughnessOf(current.state, zero)).toBe(0);
    current = choose(current, vitality);

    expect(current.state.turn.number).toBe(1);
    expect(current.state.objects[zero]?.zone).toBe('battlefield');
    expect(toughnessOf(current.state, zero)).toBe(1);
  });

  it('defers an entry trigger and releases it exactly once at the first priority window', () => {
    let current = afterKeeps(
      [
        [ARRIVAL, LEYLINE],
        [ORDINARY, ORDINARY],
      ],
      'opening-actions/trigger',
    );
    const arrival = openingDecision(current.state).cards.find(
      (oid) => current.state.objects[oid]?.card.id === ARRIVAL.id,
    );
    if (arrival === undefined) throw new Error('missing arrival');

    current = choose(current, arrival);
    expect(openingDecision(current.state).kind).toBe('openingHandAction');
    expect(eventsOfType(current.events, 'abilityTriggered')).toHaveLength(0);
    current = choose(current, null);

    expect(current.state.turn.number).toBe(1);
    expect(eventsOfType(current.events, 'abilityTriggered').map((event) => event.source)).toEqual([arrival]);
  });

  it('replays the same ordered choices to the same state fingerprint', () => {
    function run(): GameState {
      let current = afterKeeps(
        [
          [LEYLINE, LEYLINE],
          [ORDINARY, ORDINARY],
        ],
        'opening-actions/replay',
      );
      for (const oid of [...openingDecision(current.state).cards].reverse()) current = choose(current, oid);
      return current.state;
    }

    expect(stateFingerprint(run())).toBe(stateFingerprint(run()));
  });
});
