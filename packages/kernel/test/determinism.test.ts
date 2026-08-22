import { describe, expect, it } from 'vitest';
import type { Action, DeckList } from '@mtg/kernel';
import {
  createGame,
  playGame,
  reduce,
  reduceAll,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { creature, instant, lands, MOUNTAIN } from './cards';

function burnDeck(): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 12 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 11 }, () => exampleCard('slc-lightning-lash')),
  ];
  return { name: 'Burn', cards };
}

describe('determinism', () => {
  it('replays a whole game byte-identically from the same seed', () => {
    const setup = {
      seed: 'determinism-1',
      decks: [burnDeck(), burnDeck()] as [DeckList, DeckList],
      maximumTurns: 40,
    };
    const first = playGame(setup, [simpleAgent('a'), simpleAgent('b')]);
    const second = playGame(setup, [simpleAgent('a'), simpleAgent('b')]);
    expect(serializeEvents(first.events)).toBe(serializeEvents(second.events));
    expect(first.result).toEqual(second.result);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
    expect(first.result?.winner).not.toBeNull();
  });

  it('produces a different game from a different seed', () => {
    const decks = [burnDeck(), burnDeck()] as [DeckList, DeckList];
    const a = playGame({ seed: 'seed-a', decks, maximumTurns: 40 }, [simpleAgent('a'), simpleAgent('b')]);
    const b = playGame({ seed: 'seed-b', decks, maximumTurns: 40 }, [simpleAgent('a'), simpleAgent('b')]);
    expect(serializeEvents(a.events)).not.toBe(serializeEvents(b.events));
  });

  it('shuffles the same opening position for the same seed', () => {
    const decks = [burnDeck(), burnDeck()] as [DeckList, DeckList];
    const a = createGame({ seed: 'opening', decks });
    const b = createGame({ seed: 'opening', decks });
    expect(serializeEvents(a.events)).toBe(serializeEvents(b.events));
    expect(a.state.players[0].hand).toEqual(b.state.players[0].hand);
    const different = createGame({ seed: 'other-opening', decks });
    expect(different.state.players[0].hand).not.toEqual(a.state.players[0].hand);
  });

  it('replays a scripted choice sequence byte-identically', () => {
    const bear = creature('Script Bear', 2, 2, { cost: { generic: 1, R: 1 } });
    const bolt = instant('Script Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
      generic: 1,
      R: 1,
    });
    const build = () =>
      scenario({
        seed: 'scripted',
        battlefield: [
          { card: MOUNTAIN, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
        ],
        hands: [[bear, bolt], []],
      });

    const start = build();
    const bearOid = start.state.players[0].hand[0] ?? '';
    const boltOid = start.state.players[0].hand[1] ?? '';
    const script: Action[] = [
      { type: 'castSpell', player: 0, oid: bearOid, targets: [] },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'castSpell', player: 0, oid: boltOid, targets: [{ kind: 'player', player: 1 }] },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ];

    const first = reduceAll(build().state, script);
    const second = reduceAll(build().state, script);
    expect(serializeEvents(first.events)).toBe(serializeEvents(second.events));
    expect(first.state.players[1].life).toBe(17);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });

  it('leaves the input state untouched: reduce is pure', () => {
    const bolt = instant('Pure Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
      generic: 1,
      R: 1,
    });
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const before = stateFingerprint(start.state);
    const oid = start.state.players[0].hand[0] ?? '';
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(stateFingerprint(start.state)).toBe(before);
    expect(stateFingerprint(cast.state)).not.toBe(before);

    // The same reduction applied twice to the same input gives the same output.
    const again = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(stateFingerprint(again.state)).toBe(stateFingerprint(cast.state));
    expect(serializeEvents(again.events)).toBe(serializeEvents(cast.events));
  });
});
