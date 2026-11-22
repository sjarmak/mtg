/** Trostani's live toughness, departure LKI, incarnation, and cohort semantics. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ObjectId, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  moveObjectsToBattlefieldSimultaneously,
  placeCounters,
  putTriggersOnStack,
  resolveTop,
  scenario,
  settle,
} from '@mtg/kernel';
import { answerEntryTimestampNext } from '../src/zones';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const TROSTANI = creature("Trostani, Selesnya's Voice", 2, 5, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'anotherControlledCreatureEnters',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringCreatureToughness' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

const BEAR = creature('Trostani Arrival Bear', 2, 2);
const RHINO = creature('Trostani Arrival Rhino', 4, 4);

function entered(card: Card): {
  readonly trace: Trace;
  readonly source: ObjectId;
  readonly entrant: ObjectId;
} {
  const start = scenario({
    battlefield: [{ card: TROSTANI, controller: 0 }],
    hands: [[card], []],
  }).state;
  const source = oidOf(start, TROSTANI.name);
  const entrant = handOidOf(start, 0, card.name);
  return {
    trace: settle(moveObject(beginTrace(start), entrant, 'battlefield')),
    source,
    entrant,
  };
}

describe("Trostani's entered-creature toughness", () => {
  it('reads current layered toughness when the same incarnation remains', () => {
    const run = entered(BEAR);
    const grown = placeCounters(beginTrace(run.trace.state), run.entrant, 'plusOnePlusOne', 3);

    expect(resolveTop(grown).state.players[0].life).toBe(25);
  });

  it('reads departure LKI when the entered creature leaves before resolution', () => {
    const run = entered(BEAR);
    const grown = placeCounters(beginTrace(run.trace.state), run.entrant, 'plusOnePlusOne', 4);
    const departed = moveObject(grown, run.entrant, 'graveyard');

    expect(resolveTop(departed).state.players[0].life).toBe(26);
  });

  it('resolves after Trostani leaves the battlefield', () => {
    const run = entered(BEAR);
    const departedSource = moveObject(beginTrace(run.trace.state), run.source, 'graveyard');

    expect(resolveTop(departedSource).state.players[0].life).toBe(22);
  });

  it('does not substitute a returned incarnation for the creature that caused the older trigger', () => {
    const run = entered(BEAR);
    const departed = moveObject(beginTrace(run.trace.state), run.entrant, 'graveyard');
    const returned = settle(moveObject(departed, run.entrant, 'battlefield'));
    const enormous = placeCounters(returned, run.entrant, 'plusOnePlusOne', 10);

    const newerResolved = resolveTop(enormous);
    const olderResolved = resolveTop(newerResolved);
    expect(olderResolved.state.players[0].life).toBe(34);
  });

  it('retains departure LKI when entry and departure share one trigger scan', () => {
    const start = scenario({
      battlefield: [{ card: TROSTANI, controller: 0 }],
      hands: [[BEAR], []],
    }).state;
    const entrant = handOidOf(start, 0, BEAR.name);
    const arrived = moveObject(beginTrace(start), entrant, 'battlefield');
    const grown = placeCounters(arrived, entrant, 'plusOnePlusOne', 5);
    const departed = moveObject(grown, entrant, 'graveyard');
    const fired = collectTriggers(departed, 0);

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      condition: 'anotherControlledCreatureEnters',
      triggeringCreature: entrant,
      triggeringCreatureToughness: 7,
    });
    const stacked = putTriggersOnStack(departed, fired);
    expect(resolveTop(stacked).state.players[0].life).toBe(27);
  });

  it('creates one separately bound trigger for each simultaneous entrant', () => {
    const start = scenario({
      battlefield: [{ card: TROSTANI, controller: 0 }],
      hands: [[BEAR, RHINO], []],
    }).state;
    const bear = handOidOf(start, 0, BEAR.name);
    const rhino = handOidOf(start, 0, RHINO.name);
    const choosingOrder = moveObjectsToBattlefieldSimultaneously(beginTrace(start), [
      { oid: bear },
      { oid: rhino },
    ]);
    const enteredTogether = answerEntryTimestampNext(choosingOrder, bear);
    const settled = settle(enteredTogether);

    expect(settled.state.stack).toHaveLength(2);
    expect(
      settled.state.stack.map((entry) =>
        entry.triggerContext !== null && 'triggeringCreature' in entry.triggerContext
          ? {
              oid: entry.triggerContext.triggeringCreature,
              incarnation: entry.triggerContext.triggeringCreatureIncarnation,
            }
          : null,
      ),
    ).toEqual(
      expect.arrayContaining([
        { oid: bear, incarnation: settled.state.objects[bear]?.incarnation ?? 0 },
        { oid: rhino, incarnation: settled.state.objects[rhino]?.incarnation ?? 0 },
      ]),
    );
    const one = resolveTop(settled);
    const both = resolveTop(one);
    expect(both.state.players[0].life).toBe(26);
  });
});
