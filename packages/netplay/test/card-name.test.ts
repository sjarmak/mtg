/** Arbitrary card names across the authenticated seat boundary. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import type { GameSession, GameSetup } from '@mtg/kernel';
import { choose, createSession, humanSeat } from '@mtg/kernel';
import { createTable, readSeatRequest, type SeatRequest } from '@mtg/netplay';

const SPHINX: Card = parseCard({
  kind: 'creature',
  id: 'netplay-conundrum-sphinx',
  name: 'Conundrum Sphinx',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: {},
  colors: [],
  subtypes: ['Sphinx'],
  keywords: ['flying'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'eachPlayerNamesCardThenRevealsTop' }],
    },
  ],
});

const SETUP: GameSetup = {
  seed: 'netplay/card-name',
  decks: [
    { name: 'Sphinx one', cards: Array.from({ length: 40 }, () => SPHINX) },
    { name: 'Sphinx two', cards: Array.from({ length: 40 }, () => SPHINX) },
  ],
  maximumTurns: 6,
};

function advanceToName(): GameSession {
  let session = createSession(SETUP, [humanSeat('One'), humanSeat('Two')]);
  const hasCreature = (player: 0 | 1): boolean =>
    session.state.battlefield.some((oid) => session.state.objects[oid]?.controller === player);
  for (let guard = 0; guard < 500; guard += 1) {
    const decision = session.pending;
    if (decision?.kind === 'cardName') return session;
    if (decision === null) throw new Error('the game ended before a card name was requested');
    let index = -1;
    if (decision.kind === 'mulligan') {
      index = decision.options.findIndex((action) => action.type === 'keepHand');
    } else if (decision.kind === 'priority') {
      index = hasCreature(decision.player)
        ? decision.options.findIndex((action) => action.type === 'passPriority')
        : decision.options.findIndex((action) => action.type === 'castSpell');
      if (index < 0) index = decision.options.findIndex((action) => action.type === 'passPriority');
    } else if (decision.kind === 'declareAttackers') {
      index = decision.options.findIndex(
        (action) => action.type === 'declareAttackers' && action.attackers.length > 0,
      );
      if (index < 0) index = decision.options.findIndex((action) => action.type === 'declareAttackers');
    } else {
      index = 0;
    }
    if (index < 0) throw new Error(`no drive option for ${decision.kind}`);
    session = choose(session, index);
  }
  throw new Error('the game never reached a card-name decision');
}

describe('card-name requests', () => {
  it('validates and trims the arbitrary string at the wire boundary', () => {
    expect(readSeatRequest({ kind: 'nameCard', name: '  Black Lotus  ', at: 7 })).toEqual({
      kind: 'nameCard',
      name: 'Black Lotus',
      at: 7,
    });
    expect(readSeatRequest({ kind: 'nameCard', name: '   ', at: 7 })).toContain('empty');
    expect(readSeatRequest({ kind: 'nameCard', name: 'x'.repeat(257), at: 7 })).toContain('256');
  });

  it('takes the seat from the connection and exposes the earlier APNAP name only to the next chooser', () => {
    const paused = advanceToName();
    const live = createTable({
      id: 'card-name-table',
      setup: SETUP,
      seats: [humanSeat('One'), humanSeat('Two')],
      seating: [
        { name: 'One', token: 'one' },
        { name: 'Two', token: 'two' },
      ],
      choices: paused.choices,
    });
    const chooser = live.snapshotFor(0).awaiting;
    if (chooser === null) throw new Error('the rebuilt table lost the card-name decision');
    const before = live.snapshotFor(chooser);
    const request: SeatRequest = {
      kind: 'nameCard',
      name: 'A Name Outside This Game',
      at: before.decisions,
    };

    expect(live.apply(chooser, request)).toBeNull();
    const next = chooser === 0 ? 1 : 0;
    const pending = live.snapshotFor(next).pending;
    expect(pending).toEqual(
      expect.objectContaining({
        kind: 'cardName',
        player: next,
        chosen: [{ player: chooser, name: 'A Name Outside This Game' }],
      }),
    );
    expect(live.snapshotFor(chooser).pending).toBeNull();
    expect(live.record().choices.at(-1)).toEqual({
      type: 'chooseCardName',
      player: chooser,
      name: 'A Name Outside This Game',
    });
  });
});
