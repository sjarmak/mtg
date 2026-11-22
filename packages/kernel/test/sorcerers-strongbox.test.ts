/** Native deterministic coin-flip resolution for M11 Sorcerer's Strongbox. */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  nextBelow,
  pendingDecision,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

function strongbox(): Card {
  return parseCard({
    kind: 'artifact',
    id: 'm11-213-sorcerers-strongbox-kernel',
    name: "Sorcerer's Strongbox",
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 213 },
    manaCost: { generic: 4 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: true },
        effects: [
          {
            kind: 'flipCoin',
            winEffects: [
              { kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } },
              { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } },
            ],
          },
        ],
      },
    ],
  } as unknown as CardInput);
}

const LIBRARY = [
  creature('Strongbox Draw One', 1, 1),
  creature('Strongbox Draw Two', 2, 2),
  creature('Strongbox Draw Three', 3, 3),
  creature('Strongbox Draw Four', 4, 4),
];

function board(seed: string, library: readonly Card[] = LIBRARY): ReduceResult {
  return scenario({
    seed,
    active: 0,
    step: 'precombatMain',
    battlefield: [
      { card: strongbox(), controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    libraries: [library, LIBRARY],
  });
}

function seedFor(result: 'win' | 'loss'): string {
  for (let index = 0; index < 200; index += 1) {
    const seed = `sorcerers-strongbox/${result}/${String(index)}`;
    const [pick] = nextBelow(board(seed).state.rng, 2);
    if ((pick === 1 ? 'win' : 'loss') === result) return seed;
  }
  throw new Error(`no deterministic ${result} seed found`);
}

function activate(start: ReduceResult): ReduceResult {
  const source = oidOf(start.state, "Sorcerer's Strongbox");
  const action: Action = {
    type: 'activateAbility',
    player: 0,
    oid: source,
    abilityIndex: 0,
    targets: [null],
    sacrifices: [],
  };
  return apply(start, action);
}

function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 24; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && guard > 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Strongbox stack did not settle');
}

function drawNames(result: ReduceResult): readonly string[] {
  return result.state.players[0].hand.map((oid) => result.state.objects[oid]?.card.name ?? oid);
}

describe("Sorcerer's Strongbox coin flip", () => {
  it('pays {2} and taps before a loss, then consumes one random result and does nothing else', () => {
    const start = board(seedFor('loss'));
    const source = oidOf(start.state, "Sorcerer's Strongbox");
    const [expectedPick, expectedRng] = nextBelow(start.state.rng, 2);
    const stacked = activate(start);

    expect(stacked.state.objects[source]?.tapped).toBe(true);
    expect(eventsOfType(stacked.events, 'manaPaid')).toEqual([
      expect.objectContaining({ player: 0, cost: expect.objectContaining({ generic: 2 }) }),
    ]);
    expect(stacked.state.rng).toEqual(start.state.rng);

    const done = settle(stacked);
    expect(expectedPick).toBe(0);
    expect(done.state.rng).toEqual(expectedRng);
    expect(eventsOfType(done.events, 'coinFlipped')).toEqual([
      { type: 'coinFlipped', player: 0, sourceOid: source, result: 'loss' },
    ]);
    expect(done.state.objects[source]?.zone).toBe('battlefield');
    expect(drawNames(done)).toEqual([]);
  });

  it('sacrifices the source and draws three cards on a win, in printed order', () => {
    const start = board(seedFor('win'));
    const source = oidOf(start.state, "Sorcerer's Strongbox");
    const [, expectedRng] = nextBelow(start.state.rng, 2);
    const done = settle(activate(start));

    expect(done.state.rng).toEqual(expectedRng);
    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(drawNames(done)).toEqual(LIBRARY.slice(0, 3).map((card) => card.name));
    const relevant = done.events
      .filter(
        (event) =>
          event.type === 'coinFlipped' || event.type === 'permanentSacrificed' || event.type === 'cardDrawn',
      )
      .map((event) => event.type);
    expect(relevant).toEqual(['coinFlipped', 'permanentSacrificed', 'cardDrawn', 'cardDrawn', 'cardDrawn']);
  });

  it('still draws on a win when the source left before resolution', () => {
    const start = board(seedFor('win'));
    const source = oidOf(start.state, "Sorcerer's Strongbox");
    const stacked = activate(start);
    const removed = moveObject(beginTrace(stacked.state), source, 'graveyard');
    const done = settle({ state: removed.state, events: [...stacked.events, ...removed.events] });

    expect(eventsOfType(done.events, 'permanentSacrificed')).toEqual([]);
    expect(drawNames(done)).toEqual(LIBRARY.slice(0, 3).map((card) => card.name));
  });

  it('attempts all three sequential draws and records empty-library attempts', () => {
    const one = [LIBRARY[0] as Card];
    const done = settle(activate(board(seedFor('win'), one)));

    expect(drawNames(done)).toEqual([one[0]?.name]);
    expect(eventsOfType(done.events, 'cardDrawn')).toHaveLength(1);
    expect(eventsOfType(done.events, 'drawFromEmptyLibrary')).toHaveLength(2);
    expect(done.state.players[0].attemptedDrawFromEmptyLibrary).toBe(true);
  });

  it('replays byte-identically from the same seed and state', () => {
    const seed = seedFor('win');
    const first = settle(activate(board(seed)));
    const second = settle(activate(board(seed)));

    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
  });
});
