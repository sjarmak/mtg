/** Protean Hydra's X entry, prevention, and delayed source-incarnation growth. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { DamageInstance, GameState, ReplacementEffect, Trace } from '@mtg/kernel';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  counterCount,
  emit,
  eventsOfType,
  hasKeyword,
  moveObject,
  placeCounters,
  putTriggersOnStack,
  removeCounters,
  resolveTop,
  scenario,
  serializeEvents,
  settle,
  stateFingerprint,
  withState,
} from '@mtg/kernel';
import { creature } from './cards';
import { abilities, copies, onlyObject, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';
import { pushSpell } from '../src/stack';

const PROTEAN_HYDRA = parseCard({
  kind: 'creature',
  id: 'm11-194-protean-hydra',
  name: 'Protean Hydra',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 194 },
  manaCost: { hasX: true, G: 1 },
  colors: ['G'],
  subtypes: ['Hydra'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'plusOnePlusOne',
    count: { kind: 'chosenX' },
  },
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: {
        kind: 'preventDamageToSelfAndRemoveCounters',
        counter: 'plusOnePlusOne',
      },
    },
    {
      kind: 'triggered',
      condition: 'selfPlusOnePlusOneCounterRemoved',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'selfPermanent' },
          timing: 'nextEndStep',
        },
      ],
    },
  ],
});

const PRIMORDIAL_HYDRA = parseCard({
  kind: 'creature',
  id: 'm13-primordial-hydra',
  name: 'Primordial Hydra',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 183 },
  manaCost: { hasX: true, G: 2 },
  colors: ['G'],
  subtypes: ['Hydra'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'plusOnePlusOne',
    count: { kind: 'chosenX' },
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'doubleSourceCounters', counter: 'plusOnePlusOne' }],
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: {
        kind: 'selfCounterCountAtLeast',
        counter: 'plusOnePlusOne',
        atLeast: 10,
      },
      modification: { kind: 'grantKeyword', keyword: 'trample' },
    },
  ],
});

const ZERO_COUNTER_DOUBLER = parseCard({
  ...PRIMORDIAL_HYDRA,
  id: 'tst-zero-counter-doubler',
  name: 'Zero Counter Doubler',
  manaCost: { generic: 2, G: 2 },
  power: 1,
  toughness: 1,
  entryReplacement: undefined,
});

const DAMAGE_SOURCE = creature('Hydra Damage Source', 2, 2);
const BLANK_HYDRA = creature('Blank Hydra', 1, 1, { subtypes: ['Hydra'] });

const ZERO_DELAY_HYDRA = parseCard({
  ...PROTEAN_HYDRA,
  id: 'tst-zero-delay-hydra',
  name: 'Zero Delay Hydra',
  abilities: [
    PROTEAN_HYDRA.abilities[0]!,
    {
      kind: 'triggered',
      condition: 'selfPlusOnePlusOneCounterRemoved',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'countMatching', filter: { cardTypes: ['land'] } },
          target: { kind: 'selfPermanent' },
          timing: 'nextEndStep',
        },
      ],
    },
  ],
});

function resolveAll(trace: Trace): Trace {
  let current = trace;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    current = resolveTop(current);
  }
  return current;
}

function triggerFromEvents(trace: Trace): Trace {
  return resolveAll(putTriggersOnStack(trace, collectTriggers(trace, 0)));
}

function beginEndStep(state: GameState): Trace {
  const atEnd = withState(beginTrace(state), {
    ...state,
    turn: { ...state.turn, step: 'end' },
  });
  return emit(atEnd, {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'end',
    active: state.turn.active,
  });
}

function beginUpkeep(state: GameState): Trace {
  const atUpkeep = withState(beginTrace(state), {
    ...state,
    turn: { ...state.turn, step: 'upkeep' },
  });
  return emit(atUpkeep, {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'upkeep',
    active: state.turn.active,
  });
}

function damage(source: string, target: string, amount: number): DamageInstance {
  return {
    sourceOid: source,
    controller: 1,
    recipient: { kind: 'permanent', oid: target },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable: true,
  };
}

function hydraWithCounters(
  count: number,
  card = PROTEAN_HYDRA,
): {
  readonly trace: Trace;
  readonly hydra: string;
  readonly source: string;
} {
  const start = scenario({
    battlefield: [{ card: DAMAGE_SOURCE, controller: 1 }],
    hands: [[card], []],
  });
  const hydra = handOidOf(start.state, 0, card.name);
  const source = oidOf(start.state, DAMAGE_SOURCE.name);
  return {
    trace: moveObject(beginTrace(start.state), hydra, 'battlefield', { chosenX: count }),
    hydra,
    source,
  };
}

describe('Protean Hydra', () => {
  it('carries the spell X into the permanent entry replacement, including zero', () => {
    const resolveX = (x: number): number => {
      const start = scenario({ hands: [[PROTEAN_HYDRA], []] });
      const oid = handOidOf(start.state, 0, PROTEAN_HYDRA.name);
      const resolved = resolveTop(pushSpell(beginTrace(start.state), 0, oid, [], null, x));
      return counterCount(resolved.state.objects[oid]!.counters, 'plusOnePlusOne');
    };

    expect(resolveX(4)).toBe(4);
    expect(resolveX(0)).toBe(0);
  });

  it('prevents all excess damage but removes only the counters actually present', () => {
    const { trace, hydra, source } = hydraWithCounters(3);
    const dealt = applyDamage(trace, [damage(source, hydra, 5)]);

    expect(dealt.state.objects[hydra]?.damage).toBe(0);
    expect(counterCount(dealt.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(eventsOfType(dealt.events, 'damagePrevented').map((event) => event.amount)).toEqual([5]);
    expect(eventsOfType(dealt.events, 'counterRemoved')).toEqual([
      { type: 'counterRemoved', oid: hydra, counter: 'plusOnePlusOne', count: 3 },
    ]);
    expect(collectTriggers(dealt, 0)).toHaveLength(3);
  });

  it('still removes counters when damage cannot be prevented', () => {
    const { trace, hydra, source } = hydraWithCounters(3);
    const dealt = applyDamage(trace, [{ ...damage(source, hydra, 2), preventable: false }]);

    expect(dealt.state.objects[hydra]?.damage).toBe(2);
    expect(counterCount(dealt.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(1);
    expect(eventsOfType(dealt.events, 'damagePrevented')).toEqual([]);
    expect(eventsOfType(dealt.events, 'counterRemoved')).toEqual([
      { type: 'counterRemoved', oid: hydra, counter: 'plusOnePlusOne', count: 2 },
    ]);
    expect(collectTriggers(dealt, 0)).toHaveLength(2);
  });

  it('keeps simultaneous damage instances and multiple Hydras isolated', () => {
    const start = scenario({
      battlefield: [{ card: DAMAGE_SOURCE, controller: 1 }],
      hands: [[PROTEAN_HYDRA, PROTEAN_HYDRA], []],
    });
    const [first, second] = start.state.players[0].hand;
    if (first === undefined || second === undefined) throw new Error('the probe lost a Hydra');
    const source = oidOf(start.state, DAMAGE_SOURCE.name);
    const enteredFirst = moveObject(beginTrace(start.state), first, 'battlefield', { chosenX: 3 });
    const enteredBoth = moveObject(enteredFirst, second, 'battlefield', { chosenX: 4 });
    const dealt = applyDamage(enteredBoth, [damage(source, first, 1), damage(source, second, 2)]);

    expect(counterCount(dealt.state.objects[first]!.counters, 'plusOnePlusOne')).toBe(2);
    expect(counterCount(dealt.state.objects[second]!.counters, 'plusOnePlusOne')).toBe(2);
    expect(eventsOfType(dealt.events, 'counterRemoved').map((event) => [event.oid, event.count])).toEqual([
      [first, 1],
      [second, 2],
    ]);
    expect(collectTriggers(dealt, 0).map((trigger) => trigger.sourceOid)).toEqual([first, second, second]);
  });

  it('does not remove counters when an earlier replacement prevents the damage', () => {
    const { trace, hydra, source } = hydraWithCounters(3);
    const hydraShield = trace.state.replacements.find((effect) => effect.sourceOid === hydra);
    if (hydraShield === undefined) throw new Error('the Hydra registered no prevention effect');
    const prior: ReplacementEffect = {
      id: 'protean-prior-shield',
      sourceOid: source,
      controller: 0,
      timestamp: hydraShield.timestamp - 1,
      duration: 'endOfTurn',
      selfReplacement: false,
      trigger: {
        kind: 'damage',
        toPlayer: null,
        toPermanent: hydra,
        toController: null,
        toPermanentCardType: null,
        fromSource: null,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'preventDamage', amount: 'all' },
    };
    const state = { ...trace.state, replacements: [prior, ...trace.state.replacements] };
    const dealt = applyDamage(beginTrace(state), [damage(source, hydra, 2)]);

    expect(counterCount(dealt.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(3);
    expect(eventsOfType(dealt.events, 'counterRemoved')).toEqual([]);
    expect(eventsOfType(dealt.events, 'replacementApplied').map((event) => event.id)).toEqual([prior.id]);
  });

  it('fires for +1/+1 counters removed by state-based counter annihilation', () => {
    const { trace, hydra } = hydraWithCounters(3);
    const checked = settle(placeCounters(trace, hydra, 'minusOneMinusOne', 1));

    expect(counterCount(checked.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(2);
    expect(counterCount(checked.state.objects[hydra]!.counters, 'minusOneMinusOne')).toBe(0);
    expect(
      eventsOfType(checked.events, 'counterRemoved').map((event) => [event.counter, event.count]),
    ).toEqual([
      ['plusOnePlusOne', 1],
      ['minusOneMinusOne', 1],
    ]);
    expect(eventsOfType(checked.events, 'abilityTriggered')).toHaveLength(1);
  });

  it('does not schedule growth when losing all counters kills the source before its trigger resolves', () => {
    const { trace, hydra, source } = hydraWithCounters(1);
    const checked = settle(applyDamage(trace, [damage(source, hydra, 2)]));
    const resolved = resolveAll(checked);

    expect(resolved.state.objects[hydra]?.zone).toBe('graveyard');
    expect(eventsOfType(resolved.events, 'counterRemoved')).toHaveLength(1);
    expect(eventsOfType(resolved.events, 'delayedCounterPlacementScheduled')).toEqual([]);
    expect(resolved.state.delayedCounterPlacements).toBeUndefined();
  });

  it('does not retain a delayed placement whose resolved counter amount is zero', () => {
    const { trace, hydra, source } = hydraWithCounters(3, ZERO_DELAY_HYDRA);
    const resolved = triggerFromEvents(applyDamage(trace, [damage(source, hydra, 1)]));

    expect(eventsOfType(resolved.events, 'delayedCounterPlacementScheduled')).toEqual([]);
    expect(resolved.state.delayedCounterPlacements).toBeUndefined();
  });

  it('creates one delayed trigger per removed counter and grows at the next end step', () => {
    const { trace, hydra, source } = hydraWithCounters(3);
    const damaged = applyDamage(trace, [damage(source, hydra, 1)]);
    const scheduled = triggerFromEvents(damaged);

    expect(counterCount(scheduled.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(2);
    expect(scheduled.state.delayedCounterPlacements).toHaveLength(1);
    expect(eventsOfType(scheduled.events, 'delayedCounterPlacementScheduled')).toHaveLength(1);

    const due = beginEndStep(scheduled.state);
    const grown = resolveAll(putTriggersOnStack(due, collectTriggers(due, 0)));
    expect(counterCount(grown.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(4);
    expect(grown.state.delayedCounterPlacements).toBeUndefined();
  });

  it('also grows after an unrelated counter-removal action', () => {
    const { trace, hydra } = hydraWithCounters(2);
    const removed = removeCounters(trace, hydra, 'plusOnePlusOne', 1).trace;
    const scheduled = triggerFromEvents(removed);
    expect(scheduled.state.delayedCounterPlacements).toHaveLength(1);
  });

  it('does not put counters on a blinked incarnation', () => {
    const { trace, hydra, source } = hydraWithCounters(3);
    const scheduled = triggerFromEvents(applyDamage(trace, [damage(source, hydra, 1)]));
    const departed = moveObject(beginTrace(scheduled.state), hydra, 'graveyard');
    const returned = moveObject(departed, hydra, 'battlefield', { chosenX: 5 });
    const before = counterCount(returned.state.objects[hydra]!.counters, 'plusOnePlusOne');
    const due = beginEndStep(returned.state);
    const resolved = resolveAll(putTriggersOnStack(due, collectTriggers(due, 0)));

    expect(before).toBe(5);
    expect(counterCount(resolved.state.objects[hydra]!.counters, 'plusOnePlusOne')).toBe(5);
  });

  it('is byte-deterministic for identical damage and delayed-trigger sequences', () => {
    const run = (): Trace => {
      const { trace, hydra, source } = hydraWithCounters(4);
      const damaged = applyDamage(trace, [damage(source, hydra, 2)]);
      return triggerFromEvents(damaged);
    };
    const first = run();
    const second = run();
    expect(serializeEvents(first.events)).toBe(serializeEvents(second.events));
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });
});

describe('Primordial Hydra', () => {
  function entered(card = PRIMORDIAL_HYDRA, chosenX = 5): { trace: Trace; hydra: string } {
    const start = scenario({ hands: [[card], []], active: 0, step: 'precombatMain' });
    const hydra = handOidOf(start.state, 0, card.name);
    return { trace: moveObject(beginTrace(start.state), hydra, 'battlefield', { chosenX }), hydra };
  }

  it('doubles exactly the current +1/+1 counter count at its controller upkeep', () => {
    const start = entered();
    const upkeep = beginUpkeep(start.trace.state);
    const resolved = resolveAll(putTriggersOnStack(upkeep, collectTriggers(upkeep, 0)));

    expect(counterCount(resolved.state.objects[start.hydra]!.counters, 'plusOnePlusOne')).toBe(10);
    expect(hasKeyword(resolved.state, start.hydra, 'trample')).toBe(true);
  });

  it('leaves zero counters at zero and emits no phantom counter change', () => {
    const start = entered(ZERO_COUNTER_DOUBLER, 0);
    const upkeep = beginUpkeep(start.trace.state);
    const resolved = resolveAll(putTriggersOnStack(upkeep, collectTriggers(upkeep, 0)));

    expect(counterCount(resolved.state.objects[start.hydra]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(eventsOfType(resolved.events, 'countersChanged')).toEqual([]);
  });

  it('grants trample at ten counters and removes it immediately below ten', () => {
    const start = entered(PRIMORDIAL_HYDRA, 9);
    expect(hasKeyword(start.trace.state, start.hydra, 'trample')).toBe(false);
    const ten = placeCounters(start.trace, start.hydra, 'plusOnePlusOne', 1);
    expect(hasKeyword(ten.state, start.hydra, 'trample')).toBe(true);
    const nine = removeCounters(ten, start.hydra, 'plusOnePlusOne', 1).trace;
    expect(hasKeyword(nine.state, start.hydra, 'trample')).toBe(false);
  });

  it('does not double a later incarnation after the triggered source leaves', () => {
    const start = entered(PRIMORDIAL_HYDRA, 5);
    const upkeep = beginUpkeep(start.trace.state);
    const stacked = putTriggersOnStack(upkeep, collectTriggers(upkeep, 0));
    const departed = moveObject(beginTrace(stacked.state), start.hydra, 'graveyard');
    const returned = moveObject(departed, start.hydra, 'battlefield', { chosenX: 3 });
    const resolved = resolveAll(returned);

    expect(counterCount(resolved.state.objects[start.hydra]!.counters, 'plusOnePlusOne')).toBe(3);
  });

  it('lets a layer-1 copy double its own counters rather than the printed source counters', () => {
    const start = scenario({ hands: [[PRIMORDIAL_HYDRA, BLANK_HYDRA], []], active: 0 });
    const source = handOidOf(start.state, 0, PRIMORDIAL_HYDRA.name);
    const copy = handOidOf(start.state, 0, BLANK_HYDRA.name);
    const enteredSource = moveObject(beginTrace(start.state), source, 'battlefield', { chosenX: 2 });
    const enteredBoth = moveObject(enteredSource, copy, 'battlefield');
    const copied = withContinuous(enteredBoth.state, [copies(onlyObject(copy), source)]);
    const countedBoth = placeCounters(beginTrace(copied), copy, 'plusOnePlusOne', 4);
    const began = beginUpkeep(countedBoth.state);
    const resolved = resolveAll(putTriggersOnStack(began, collectTriggers(began, 0)));

    expect(counterCount(resolved.state.objects[source]!.counters, 'plusOnePlusOne')).toBe(4);
    expect(counterCount(resolved.state.objects[copy]!.counters, 'plusOnePlusOne')).toBe(8);
  });

  it('loses both the upkeep trigger and threshold grant while all abilities are removed', () => {
    const start = entered(PRIMORDIAL_HYDRA, 10);
    const silenced = withContinuous(start.trace.state, [
      abilities(onlyObject(start.hydra), { removeAll: true }, { ts: start.trace.state.nextId }),
    ]);
    expect(hasKeyword(silenced, start.hydra, 'trample')).toBe(false);

    const began = beginUpkeep(silenced);
    expect(collectTriggers(began, 0).filter((trigger) => trigger.sourceOid === start.hydra)).toEqual([]);
  });
});
