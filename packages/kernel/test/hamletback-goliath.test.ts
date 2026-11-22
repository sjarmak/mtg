/** Event-retained live power and LKI for M13 Hamletback Goliath. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ObjectId, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  placeCounters,
  putTriggersOnStack,
  resolveAnswered,
  resolveTop,
  scenario,
  settle,
} from '@mtg/kernel';
import { artifact, creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const HAMLETBACK = creature('Hamletback Goliath', 6, 6, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'anotherCreatureEnters',
      optional: true,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'triggeringCreaturePower' },
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

const BEAR = creature('Arrival Bear', 2, 2);

function entered(
  card: Card,
  controller: 0 | 1,
): {
  readonly trace: Trace;
  readonly source: ObjectId;
  readonly entrant: ObjectId;
} {
  const start = scenario({
    battlefield: [{ card: HAMLETBACK, controller: 0 }],
    hands: controller === 0 ? [[card], []] : [[], [card]],
  }).state;
  const source = oidOf(start, HAMLETBACK.name);
  const entrant = handOidOf(start, controller, card.name);
  return {
    trace: settle(moveObject(beginTrace(start), entrant, 'battlefield')),
    source,
    entrant,
  };
}

function accept(trace: Trace): Trace {
  const asked = resolveTop(trace);
  expect(asked.state.turn.awaiting).toBe('optionalTrigger');
  return resolveAnswered(asked, true);
}

function counters(trace: Trace, source: ObjectId): number {
  return trace.state.objects[source]?.counters.plusOnePlusOne ?? 0;
}

describe('whenever another creature enters', () => {
  it.each([0, 1] as const)('fires once for a creature controlled by player %s', (controller) => {
    const run = entered(BEAR, controller);
    expect(run.trace.state.stack).toHaveLength(1);
    expect(counters(accept(run.trace), run.source)).toBe(2);
  });

  it('does not fire for a noncreature or for the source entering itself', () => {
    expect(entered(artifact('Arrival Relic', { generic: 2 }), 0).trace.state.stack).toHaveLength(0);

    const start = scenario({ hands: [[HAMLETBACK], []] }).state;
    const source = handOidOf(start, 0, HAMLETBACK.name);
    const arrived = settle(moveObject(beginTrace(start), source, 'battlefield'));
    expect(arrived.state.stack).toHaveLength(0);
  });

  it('records a declined optional trigger without changing the source', () => {
    const run = entered(BEAR, 0);
    const asked = resolveTop(run.trace);
    expect(asked.state.turn.awaiting).toBe('optionalTrigger');
    const declined = resolveAnswered(asked, false);

    expect(counters(declined, run.source)).toBe(0);
    expect(declined.state.stack).toHaveLength(0);
  });
});

describe("that creature's power", () => {
  it('reads current layered power when the same incarnation remains', () => {
    const run = entered(BEAR, 0);
    const pumped = placeCounters(beginTrace(run.trace.state), run.entrant, 'plusOnePlusOne', 3);

    expect(counters(accept(pumped), run.source)).toBe(5);
  });

  it('reads departure LKI after the triggering creature leaves', () => {
    const run = entered(BEAR, 0);
    const pumped = placeCounters(beginTrace(run.trace.state), run.entrant, 'plusOnePlusOne', 4);
    const departed = moveObject(pumped, run.entrant, 'graveyard');

    expect(counters(accept(departed), run.source)).toBe(6);
  });

  it('does not substitute a blinked incarnation for the creature that triggered', () => {
    const run = entered(BEAR, 0);
    const departed = moveObject(beginTrace(run.trace.state), run.entrant, 'graveyard');
    const returned = moveObject(departed, run.entrant, 'battlefield');
    const enormous = placeCounters(returned, run.entrant, 'plusOnePlusOne', 10);

    expect(counters(accept(enormous), run.source)).toBe(2);
  });

  it('retains departure LKI when entry and departure share one trigger scan', () => {
    const start = scenario({
      battlefield: [{ card: HAMLETBACK, controller: 0 }],
      hands: [[BEAR], []],
    }).state;
    const source = oidOf(start, HAMLETBACK.name);
    const entrant = handOidOf(start, 0, BEAR.name);
    const arrived = moveObject(beginTrace(start), entrant, 'battlefield');
    const pumped = placeCounters(arrived, entrant, 'plusOnePlusOne', 5);
    const departed = moveObject(pumped, entrant, 'graveyard');
    const fired = collectTriggers(departed, 0);

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      condition: 'anotherCreatureEnters',
      triggeringCreature: entrant,
      triggeringCreaturePower: 7,
    });
    const stacked = putTriggersOnStack(departed, fired);
    expect(counters(accept(stacked), source)).toBe(7);
  });
});
