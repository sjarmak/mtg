/** Hostile executable contract for RTR Azor's Elocutors. */
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  counterCount,
  moveObject,
  placeCounters,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type DamageInstance,
  type GameState,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { oidOf } from './helpers';

const ELOCUTORS = parseCard({
  kind: 'creature',
  id: 'rtr-210-azors-elocutors-kernel',
  name: "Azor's Elocutors",
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 210 },
  manaCost: { generic: 3, hybrid: { 'W/U': 2 } },
  colors: ['W', 'U'],
  subtypes: ['Human', 'Advisor'],
  power: 3,
  toughness: 5,
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'putCounters', counter: 'filibuster', count: 1, target: { kind: 'selfPermanent' } }],
      putCounterThenWinAtThreshold: { counter: 'filibuster', atLeast: 5 },
      printedSourceReference: 'thisCreature',
    },
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [],
      controllerDamageRemovesSourceCounter: { counter: 'filibuster' },
      printedSourceReference: 'thisCreature',
    },
  ],
});

const SOURCE = creature('Elocutors Damage Source', 2, 2);

function position(): GameState {
  return scenario({
    battlefield: [
      { card: ELOCUTORS, controller: 0 },
      { card: SOURCE, controller: 1 },
    ],
  }).state;
}

function upkeep(state: GameState, active: 0 | 1): Trace {
  const event = { type: 'stepBegan', turn: state.turn.number, step: 'upkeep', active } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return resolveTop(putTriggersOnStack(beginTrace(state), collectTriggers(trace, 0)));
}

function damage(state: GameState, recipient: DamageInstance['recipient'], amount = 1): Trace {
  return applyDamage(beginTrace(state), [
    {
      sourceOid: oidOf(state, SOURCE.name),
      controller: 1,
      recipient,
      amount,
      preventable: true,
      deathtouch: false,
      lifelink: false,
      combat: false,
    },
  ]);
}

function resolveDamageTriggers(trace: Trace): Trace {
  let current = putTriggersOnStack(trace, collectTriggers(trace, 0));
  while (current.state.stack.length > 0) current = resolveTop(current);
  return current;
}

describe("Azor's Elocutors in the kernel", () => {
  it('places one counter each own upkeep and the newly placed fifth counter wins', () => {
    let current = position();
    const source = oidOf(current, ELOCUTORS.name);
    for (let count = 1; count <= 4; count += 1) {
      current = upkeep(current, 0).state;
      expect(counterCount(current.objects[source]!.counters, 'filibuster')).toBe(count);
      expect(current.result).toBeNull();
    }
    const won = upkeep(current, 0);
    expect(counterCount(won.state.objects[source]!.counters, 'filibuster')).toBe(5);
    expect(won.state.result?.winner).toBe(0);
  });

  it('does not fire on another player upkeep', () => {
    const start = position();
    const source = oidOf(start, ELOCUTORS.name);
    const done = upkeep(start, 1);
    expect(counterCount(done.state.objects[source]!.counters, 'filibuster')).toBe(0);
  });

  it('removes one counter for a damage event regardless of amount and ignores other recipients', () => {
    const start = position();
    const source = oidOf(start, ELOCUTORS.name);
    const seeded = placeCounters(beginTrace(start), source, 'filibuster', 3).state;
    const own = resolveDamageTriggers(damage(seeded, { kind: 'player', player: 0 }, 8));
    expect(counterCount(own.state.objects[source]!.counters, 'filibuster')).toBe(2);

    const opponent = resolveDamageTriggers(damage(own.state, { kind: 'player', player: 1 }));
    expect(counterCount(opponent.state.objects[source]!.counters, 'filibuster')).toBe(2);
    const permanent = resolveDamageTriggers(damage(opponent.state, { kind: 'permanent', oid: source }));
    expect(counterCount(permanent.state.objects[source]!.counters, 'filibuster')).toBe(2);
  });

  it('creates and resolves one counter-removal trigger for each separate damage event', () => {
    const start = position();
    const source = oidOf(start, ELOCUTORS.name);
    const damageSource = oidOf(start, SOURCE.name);
    const seeded = placeCounters(beginTrace(start), source, 'filibuster', 3).state;
    const dealt = applyDamage(beginTrace(seeded), [
      {
        sourceOid: damageSource,
        controller: 1,
        recipient: { kind: 'player', player: 0 },
        amount: 2,
        preventable: true,
        deathtouch: false,
        lifelink: false,
        combat: false,
      },
      {
        sourceOid: damageSource,
        controller: 1,
        recipient: { kind: 'player', player: 0 },
        amount: 3,
        preventable: true,
        deathtouch: false,
        lifelink: false,
        combat: false,
      },
    ]);
    const triggers = collectTriggers(dealt, 0);
    expect(triggers).toHaveLength(2);
    const done = resolveDamageTriggers(dealt);
    expect(counterCount(done.state.objects[source]!.counters, 'filibuster')).toBe(1);
  });

  it('never goes below zero and does not touch a new source incarnation', () => {
    const start = position();
    const source = oidOf(start, ELOCUTORS.name);
    const dealt = damage(start, { kind: 'player', player: 0 });
    const triggers = collectTriggers(dealt, 0);
    const stacked = putTriggersOnStack(dealt, triggers);
    const left = moveObject(stacked, source, 'graveyard');
    const returned = moveObject(left, source, 'battlefield', { controller: 0 });
    const done = resolveTop(returned);
    expect(counterCount(done.state.objects[source]!.counters, 'filibuster')).toBe(0);
  });
});
