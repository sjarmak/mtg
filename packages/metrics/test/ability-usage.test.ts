/**
 * The usage floor: `docs/design/dsl-v1-ability-model.md` §9 risk 3.
 *
 * The case that matters most here is the first one — a pool full of activated
 * abilities, a sweep in which none of them ever fired, and every other gate in
 * the report green. That is the confident wrong answer this gate exists to
 * refuse, and it is asserted directly rather than through the balance run,
 * which takes ninety seconds and cannot be made to produce it on demand.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard, withRenderedOracleText } from '@mtg/dsl';
import { abilityPool, abilityUsage, evaluateGates, formatHealth, metricsConfig, report } from '@mtg/metrics';
import type { AbilityPool, GateResult } from '@mtg/metrics';
import { distinctGames } from './helpers/log';

const config = metricsConfig({ floors: { abilityUsage: 4 } });

/** A pool shape, without needing a hundred parsed cards to state one. */
function pool(cards: number, activated: number, triggered = 0): AbilityPool {
  return { cards, withActivatedAbility: activated, withTriggeredAbility: triggered };
}

function usageGate(logs: ReturnType<typeof distinctGames>, composition: AbilityPool): GateResult {
  const health = formatHealth(logs, { config, pool: composition });
  const gate = health.gates.find((candidate) => candidate.id === 'abilities.usage');
  expect(gate, 'the pool was supplied, so the gate must exist').toBeDefined();
  if (gate === undefined) throw new Error('unreachable');
  return gate;
}

/**
 * A minimal DSL creature. Built through `parseCard` rather than cast into
 * shape, so a card this test calls ability-bearing is one the pipeline would
 * accept, and `withRenderedOracleText` supplies the printed line the parser
 * insists on rendering rather than reading.
 */
function creature(name: string, abilities: readonly unknown[]): Card {
  return parseCard(
    withRenderedOracleText({
      id: `metrics-${name.toLowerCase()}`,
      name,
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      colors: ['W'],
      supertypes: [],
      subtypes: ['Human'],
      keywords: [],
      effects: [],
      abilities,
      power: 2,
      toughness: 2,
      kind: 'creature',
      manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
      artifact: false,
      oracleText: '',
    } as unknown as Card),
  );
}

const ACTIVATED = {
  kind: 'activated',
  cost: { mana: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0 }, tapSelf: true, sacrificeSelf: false },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } }],
};

const TRIGGERED = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

describe('abilityPool', () => {
  it('counts the two ability kinds apart, because only one of them is countable in play', () => {
    const cards: readonly Card[] = [
      creature('Vanilla', []),
      creature('Tapper', [ACTIVATED]),
      creature('Herald', [TRIGGERED]),
    ];
    expect(abilityPool(cards)).toEqual({ cards: 3, withActivatedAbility: 1, withTriggeredAbility: 1 });
  });

  it('reads an empty pool as empty rather than throwing', () => {
    expect(abilityPool([])).toEqual({ cards: 0, withActivatedAbility: 0, withTriggeredAbility: 0 });
  });
});

describe('ability usage floor', () => {
  it('fails a pool whose abilities never fired, however healthy everything else is', () => {
    // The risk-3 scenario exactly: 20 of 80 cards carry an activated ability,
    // 200 games of ordinary-looking play, not one activation.
    const gate = usageGate(distinctGames(200, { playerTurns: 16 }), pool(80, 20));
    expect(gate.status).toBe('fail');
    expect(gate.observed).toBe(0);
    expect(gate.detail).toContain('0 activations');
  });

  it('passes the same pool once the abilities are being used', () => {
    const gate = usageGate(distinctGames(200, { playerTurns: 16, activationsPerTurn: 1 }), pool(80, 20));
    expect(gate.status).toBe('pass');
    expect(gate.observed).toBeGreaterThan(0);
  });

  it('scales the floor with the pool, so a thin pool is asked for less', () => {
    const rich = abilityUsage(distinctGames(200, { playerTurns: 16 }), pool(80, 20), config);
    const thin = abilityUsage(distinctGames(200, { playerTurns: 16 }), pool(80, 2), config);
    expect(rich.floorPerCardDrawn).not.toBeNull();
    expect(thin.floorPerCardDrawn).not.toBeNull();
    if (rich.floorPerCardDrawn === null || thin.floorPerCardDrawn === null) return;
    expect(thin.floorPerCardDrawn).toBeCloseTo(rich.floorPerCardDrawn / 10, 12);
  });

  it('is not applicable, rather than green, on a pool with no activated ability', () => {
    const gate = usageGate(distinctGames(200, { playerTurns: 16 }), pool(90, 0, 12));
    expect(gate.status).toBe('notApplicable');
    expect(gate.observed).toBeNull();
    // The pool line has to survive into the report: "nothing fired" and "there
    // was nothing to fire" are different findings, and a pool of pure triggers
    // is the case where a reader would otherwise conflate them.
    expect(gate.detail).toContain('12 carry a triggered one');
  });

  it('abstains rather than judging when the run is too thin to measure', () => {
    const gate = usageGate(distinctGames(3, { playerTurns: 16 }), pool(80, 20));
    expect(gate.status).toBe('underSampled');
    expect(gate.observed).toBeNull();
  });

  it('counts activations from both seats', () => {
    const logs = distinctGames(200, { playerTurns: 16, activationsPerTurn: 1 });
    const value = abilityUsage(logs, pool(80, 20), config).usage.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    // One activation on each of the 16 turns of each game, owner's side only.
    expect(value.activations).toBe(200 * 16);
    expect(value.gamesWithActivationShare).toBe(1);
    expect(value.perCardDrawn).toBeCloseTo(value.activations / value.cardsDrawn, 12);
  });

  it('emits no gate at all when the caller cannot say what the pool was', () => {
    const health = formatHealth(distinctGames(200, { playerTurns: 16 }), { config });
    expect(health.abilityUsage).toBeNull();
    expect(health.gates.filter((gate) => gate.id.startsWith('abilities.'))).toEqual([]);
  });

  it('prints the pool beside the count, so a reader never has to infer one from the other', () => {
    const played = report(
      formatHealth(distinctGames(200, { playerTurns: 16, activationsPerTurn: 1 }), {
        config,
        pool: pool(80, 20, 5),
      }),
    );
    expect(played).toContain('## Ability usage');
    expect(played).toContain('20 of 80 cards carry an activated ability');
    expect(played).toContain('5 carry a triggered one');

    const empty = report(formatHealth(distinctGames(200, { playerTurns: 16 }), { config }));
    expect(empty).not.toContain('## Ability usage');
  });

  it('does not let a not-applicable gate read as a failure or an abstention', () => {
    const gates = evaluateGates({
      length: { value: null, samples: 0, distinctSamples: 0, floor: 1, underSampled: true },
      onPlay: { value: null, samples: 0, distinctSamples: 0, floor: 1, underSampled: true },
      mana: [],
      decisiveness: { value: null, samples: 0, distinctSamples: 0, floor: 1, underSampled: true },
      colorPairs: { records: [], mirrorGames: 0, spread: null },
      dominance: { dominant: [], outOfBand: [], evaluated: [], underSampled: [], spread: null },
      abilityUsage: abilityUsage([], pool(90, 0), config),
      config,
    });
    const usage = gates.filter((gate) => gate.id === 'abilities.usage');
    expect(usage.map((gate) => gate.status)).toEqual(['notApplicable']);
  });
});

/**
 * The triggered half, gated the same way the activated half is.
 *
 * The two floors are deliberately the same shape and the same constant, so the
 * gap between the measured rates is a fact about how the pool is played rather
 * than a consequence of two differently-chosen bands.
 */
describe('trigger usage floor', () => {
  function triggerGate(logs: ReturnType<typeof distinctGames>, composition: AbilityPool): GateResult {
    const health = formatHealth(logs, { config, pool: composition });
    const gate = health.gates.find((candidate) => candidate.id === 'abilities.triggers');
    expect(gate, 'the pool was supplied, so the gate must exist').toBeDefined();
    if (gate === undefined) throw new Error('unreachable');
    return gate;
  }

  it('fails a pool whose triggers never fired, however healthy everything else is', () => {
    const gate = triggerGate(distinctGames(200, { playerTurns: 16 }), pool(80, 0, 20));
    expect(gate.status).toBe('fail');
    expect(gate.observed).toBe(0);
    expect(gate.detail).toContain('0 triggers');
  });

  it('passes the same pool once the triggers are firing', () => {
    const gate = triggerGate(distinctGames(200, { playerTurns: 16, triggersPerTurn: 1 }), pool(80, 0, 20));
    expect(gate.status).toBe('pass');
    expect(gate.observed).toBeGreaterThan(0);
  });

  it('scales the floor with the triggered share of the pool', () => {
    const rich = abilityUsage(distinctGames(200, { playerTurns: 16 }), pool(80, 0, 20), config);
    const thin = abilityUsage(distinctGames(200, { playerTurns: 16 }), pool(80, 0, 2), config);
    expect(rich.floorTriggersPerCardDrawn).not.toBeNull();
    expect(thin.floorTriggersPerCardDrawn).not.toBeNull();
    if (rich.floorTriggersPerCardDrawn === null || thin.floorTriggersPerCardDrawn === null) return;
    expect(thin.floorTriggersPerCardDrawn).toBeCloseTo(rich.floorTriggersPerCardDrawn / 10, 12);
  });

  it('is not applicable, rather than green, on a pool with no triggered ability', () => {
    const gate = triggerGate(distinctGames(200, { playerTurns: 16 }), pool(90, 12, 0));
    expect(gate.status).toBe('notApplicable');
    expect(gate.observed).toBeNull();
    expect(gate.detail).toContain('12 of 90 pool cards carry an activated ability');
  });

  it('abstains rather than judging when the run is too thin to measure', () => {
    const gate = triggerGate(distinctGames(3, { playerTurns: 16 }), pool(80, 0, 20));
    expect(gate.status).toBe('underSampled');
    expect(gate.observed).toBeNull();
  });

  it('counts triggers from both seats and keeps them apart from activations', () => {
    const logs = distinctGames(200, { playerTurns: 16, activationsPerTurn: 2, triggersPerTurn: 1 });
    const value = abilityUsage(logs, pool(80, 20, 20), config).usage.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.triggers).toBe(200 * 16);
    expect(value.activations).toBe(200 * 32);
    expect(value.gamesWithTriggerShare).toBe(1);
    expect(value.triggersPerCardDrawn).toBeCloseTo(value.triggers / value.cardsDrawn, 12);
  });

  it('reports the triggered half rather than disclaiming it', () => {
    const played = report(
      formatHealth(distinctGames(200, { playerTurns: 16, activationsPerTurn: 1, triggersPerTurn: 1 }), {
        config,
        pool: pool(80, 20, 5),
      }),
    );
    expect(played).toContain('- triggers: 3200 over');
    expect(played).not.toContain('nothing downstream can count one');
  });
});
