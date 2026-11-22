/** Native resolution and visibility for M11 Dark Tutelage. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  eventsOfType,
  moveObject,
  publiclyIdentified,
  putTriggersOnStack,
  resolveTop,
  scenario,
  seatEvent,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, SWAMP } from './cards';
import { oidOf } from './helpers';

const DARK_TUTELAGE = parseCard({
  kind: 'enchantment',
  id: 'm11-090-dark-tutelage-kernel',
  name: 'Dark Tutelage',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 90 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        { kind: 'revealTopCardToHand' },
        {
          kind: 'loseLife',
          amount: { kind: 'revealedCardManaValueThisResolution' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

const FOUR_VALUE = creature('Tutelage Four', 4, 4, { cost: { generic: 2, B: 2 } });
const NEXT_CARD = creature('Tutelage Next', 1, 1, { cost: { generic: 1 } });

function firedUpkeep(state: GameState): ReturnType<typeof collectTriggers> {
  const event = {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'upkeep',
    active: 0,
  } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function position(library: readonly Card[]): ReduceResult {
  return scenario({
    battlefield: [{ card: DARK_TUTELAGE, controller: 0 }],
    libraries: [library, [NEXT_CARD]],
  });
}

function triggerOnStack(start: ReduceResult): Trace {
  const fired = firedUpkeep(start.state);
  expect(fired.map(({ condition }) => condition)).toEqual(['beginningOfYourUpkeep']);
  return putTriggersOnStack(beginTrace(start.state), fired);
}

function handNames(result: Trace): readonly string[] {
  return result.state.players[0].hand.map((oid) => result.state.objects[oid]?.card.name ?? oid);
}

describe('Dark Tutelage in the kernel', () => {
  it('reveals the actual top card, moves that same card to hand, and loses its mana value', () => {
    const start = position([FOUR_VALUE, NEXT_CARD]);
    const top = start.state.players[0].library[0] as ObjectId;
    const done = resolveTop(triggerOnStack(start));

    expect(eventsOfType(done.events, 'libraryTopRevealed')).toEqual([
      { type: 'libraryTopRevealed', player: 0, oids: [top] },
    ]);
    expect(eventsOfType(done.events, 'zoneChanged')).toContainEqual({
      type: 'zoneChanged',
      oid: top,
      from: 'library',
      to: 'hand',
      owner: 0,
    });
    expect(eventsOfType(done.events, 'cardDrawn')).toEqual([]);
    expect(handNames(done)).toEqual(['Tutelage Four']);
    expect(done.state.players[0].library.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      'Tutelage Next',
    ]);
    expect(done.state.players[0].life).toBe(16);
  });

  it('moves a land and loses zero life', () => {
    const start = position([SWAMP, NEXT_CARD]);
    const done = resolveTop(triggerOnStack(start));

    expect(handNames(done)).toEqual(['Swamp']);
    expect(done.state.players[0].life).toBe(20);
    expect(eventsOfType(done.events, 'lifeChanged')).toEqual([]);
  });

  it('does nothing cleanly with an empty library and does not record a failed draw', () => {
    const done = resolveTop(triggerOnStack(position([])));

    expect(handNames(done)).toEqual([]);
    expect(done.state.players[0].life).toBe(20);
    expect(eventsOfType(done.events, 'libraryTopRevealed')).toEqual([]);
    expect(eventsOfType(done.events, 'drawFromEmptyLibrary')).toEqual([]);
  });

  it('finishes from its retained trigger after the enchantment has left the battlefield', () => {
    const start = position([FOUR_VALUE, NEXT_CARD]);
    const source = oidOf(start.state, 'Dark Tutelage');
    const stacked = triggerOnStack(start);
    const removed = moveObject(stacked, source, 'graveyard');
    const done = resolveTop(removed);

    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(handNames(done)).toEqual(['Tutelage Four']);
    expect(done.state.players[0].life).toBe(16);
  });

  it('publishes only the revealed identity while the later hidden-zone move stays redacted', () => {
    const start = position([FOUR_VALUE, NEXT_CARD]);
    const top = start.state.players[0].library[0] as ObjectId;
    const done = resolveTop(triggerOnStack(start));
    const revealIndex = done.events.findIndex((event) => event.type === 'libraryTopRevealed');
    const moveIndex = done.events.findIndex(
      (event) => event.type === 'zoneChanged' && event.oid === top && event.to === 'hand',
    );
    const reveal = done.events[revealIndex];
    const move = done.events[moveIndex];
    if (reveal === undefined || move === undefined) throw new Error('Dark Tutelage did not reveal and move');

    expect(seatEvent(reveal, 1, 'opponent', revealIndex)).toEqual(reveal);
    expect(publiclyIdentified(reveal)).toEqual([top]);
    expect(seatEvent(move, 1, 'opponent', moveIndex)).not.toEqual(move);
    expect(JSON.stringify(seatEvent(move, 1, 'opponent', moveIndex))).not.toContain(top);
  });
});
