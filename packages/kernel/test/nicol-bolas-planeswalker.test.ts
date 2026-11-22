/** Native and hostile execution proofs for all three M13 Nicol Bolas abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  controllerOf,
  counterCount,
  legalActions,
  moveObject,
  objectFilter,
  pendingDecision,
  scenario,
  type Action,
  type ControlEffect,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { artifact, creature, planeswalker } from './cards';
import { apply, oidOf } from './helpers';

const BOLAS = parseCard({
  kind: 'planeswalker',
  id: 'm13-199-nicol-bolas-planeswalker-kernel',
  name: 'Nicol Bolas, Planeswalker',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 199 },
  colors: ['U', 'B', 'R'],
  manaCost: { generic: 4, U: 1, B: 2, R: 1 },
  supertypes: ['legendary'],
  subtypes: ['Bolas'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['creature'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'gainControl', target: { kind: 'targetCreature' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -9,
      effects: [
        { kind: 'dealDamage', amount: 7, target: { kind: 'targetPlayerOrPlaneswalker' } },
        {
          kind: 'discardCards',
          count: 7,
          target: { kind: 'thatPlayerOrPlaneswalkerController' },
        },
        {
          kind: 'sacrificePermanent',
          count: 7,
          filter: {},
          target: { kind: 'thatPlayerOrPlaneswalkerController' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const TARGET_WALKER = planeswalker('Borrowed Walker', 20, []);

function activations(
  state: GameState,
  abilityIndex: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const source = oidOf(state, BOLAS.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source && action.abilityIndex === abilityIndex,
  );
}

function activate(start: ReduceResult, abilityIndex: number, target: ObjectId | 0 | 1): ReduceResult {
  const chosen = activations(start.state, abilityIndex).find((action) => {
    const actual = action.targets[0];
    return typeof target === 'string'
      ? actual?.kind === 'permanent' && actual.oid === target
      : actual?.kind === 'player' && actual.player === target;
  });
  if (chosen === undefined) throw new Error(`Bolas ability ${String(abilityIndex)} was not offered`);
  return apply(start, chosen);
}

function passPriority(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error(`expected priority, got ${decision?.kind ?? 'none'}`);
  return apply(current, { type: 'passPriority', player: decision.player });
}

function resolveWithoutChoices(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 8 && next.state.stack.length > 0; guard += 1) next = passPriority(next);
  if (next.state.stack.length > 0) throw new Error('Bolas ability did not finish resolving');
  return next;
}

describe('Nicol Bolas targeted loyalty abilities', () => {
  it('offers +3 only at noncreature permanents and destroys the chosen artifact', () => {
    const relic = artifact('Bolas Relic');
    const body = creature('Bolas Body', 2, 2);
    const start = scenario({
      battlefield: [
        { card: BOLAS, controller: 0, loyalty: 9 },
        { card: relic, controller: 1 },
        { card: body, controller: 1 },
      ],
    });
    const relicOid = oidOf(start.state, relic.name);
    const bodyOid = oidOf(start.state, body.name);
    const offered = activations(start.state, 0).flatMap((action) => action.targets);
    expect(offered).toContainEqual({ kind: 'permanent', oid: relicOid });
    expect(offered).not.toContainEqual({ kind: 'permanent', oid: bodyOid });

    const done = resolveWithoutChoices(activate(start, 0, relicOid));
    expect(done.state.objects[relicOid]?.zone).toBe('graveyard');
    expect(done.state.objects[bodyOid]?.zone).toBe('battlefield');
  });

  it('keeps -2 control on the chosen incarnation and not a later one', () => {
    const body = creature('Bolas Captive', 3, 3);
    const start = scenario({
      battlefield: [
        { card: BOLAS, controller: 0, loyalty: 9 },
        { card: body, controller: 1 },
      ],
    });
    const target = oidOf(start.state, body.name);
    const controlled = resolveWithoutChoices(activate(start, 1, target));
    expect(controllerOf(controlled.state, target)).toBe(0);

    const left = moveObject(beginTrace(controlled.state), target, 'graveyard');
    const returned = moveObject(left, target, 'battlefield', { controller: 1 });
    expect(controllerOf(returned.state, target)).toBe(1);
  });
});

describe('Nicol Bolas linked ultimate', () => {
  it("damages a planeswalker and makes that planeswalker's non-owner controller discard and sacrifice", () => {
    const sacrifices = Array.from({ length: 7 }, (_, index) => artifact(`Bolas Tribute ${String(index)}`));
    const secrets = Array.from({ length: 7 }, (_, index) => creature(`Bolas Secret ${String(index)}`, 1, 1));
    const start = scenario({
      battlefield: [
        { card: BOLAS, controller: 0, loyalty: 12 },
        { card: TARGET_WALKER, controller: 0 },
        ...sacrifices.map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[], secrets],
    });
    const walker = oidOf(start.state, TARGET_WALKER.name);
    const tributeOids = sacrifices.map((card) => oidOf(start.state, card.name));
    const control: ControlEffect = {
      id: 'borrowed-walker-control',
      kind: 'control',
      layer: '2',
      affects: objectFilter({ oids: [walker] }),
      controller: 1,
      duration: 'permanent',
      timestamp: start.state.nextId,
      sourceOid: walker,
      enabledWhile: null,
    };
    let current = activate(
      { ...start, state: { ...start.state, continuous: [...start.state.continuous, control] } },
      2,
      walker,
    );
    current = passPriority(passPriority(current));
    expect(current.state.players[1].hand).toHaveLength(0);

    for (let picked = 0; picked < 7; picked += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'permanentSacrifice') throw new Error('linked seat was not asked to sacrifice');
      expect(decision.player).toBe(1);
      const option = decision.options.find(
        (candidate) => candidate.type === 'sacrificePermanent' && candidate.oid !== walker,
      );
      if (option?.type !== 'sacrificePermanent') throw new Error('no tribute sacrifice was offered');
      current = apply(current, option);
    }

    expect(counterCount(current.state.objects[walker]!.counters, 'loyalty')).toBe(13);
    expect(current.state.objects[walker]?.zone).toBe('battlefield');
    expect(tributeOids.every((oid) => current.state.objects[oid]?.zone === 'graveyard')).toBe(true);
  });

  it('uses as many cards and permanents as available and survives source departure', () => {
    const secret = creature('Only Bolas Secret', 1, 1);
    const tribute = artifact('Only Bolas Tribute');
    const start = scenario({
      battlefield: [
        { card: BOLAS, controller: 0, loyalty: 12 },
        { card: tribute, controller: 1 },
      ],
      hands: [[], [secret]],
    });
    const source = oidOf(start.state, BOLAS.name);
    const tributeOid = oidOf(start.state, tribute.name);
    const paid = activate(start, 2, 1);
    const departed = moveObject(beginTrace(paid.state), source, 'graveyard');
    const current = resolveWithoutChoices({
      state: departed.state,
      events: [...paid.events, ...departed.events],
    });

    expect(current.state.players[1].life).toBe(13);
    expect(current.state.players[1].hand).toHaveLength(0);
    expect(current.state.objects[tributeOid]?.zone).toBe('graveyard');
    expect(current.state.objects[source]?.zone).toBe('graveyard');
  });
});
