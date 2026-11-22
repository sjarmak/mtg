/** Executable and hostile contract for RTR Vraska the Unseen. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  legalActions,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type Action,
  type DamageInstance,
  type GameState,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { beginTurn } from '../src/turn';
import { describe, expect, it } from 'vitest';
import { creature, FOREST } from './cards';
import { apply, oidOf } from './helpers';

const VRASKA = parseCard({
  kind: 'planeswalker',
  id: 'rtr-208-vraska-the-unseen-kernel',
  name: 'Vraska the Unseen',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 208 },
  manaCost: { generic: 3, B: 1, G: 1 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Vraska'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [],
      retaliateForCombatDamageUntilYourNextTurn: true,
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -7,
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            quoteAbilities: true,
            inlineQuotedAbilities: true,
            name: 'Assassin',
            colors: ['B'],
            subtypes: ['Assassin'],
            power: 1,
            toughness: 1,
            keywords: [],
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDealsCombatDamageToPlayer',
                effects: [{ kind: 'loseGame', target: { kind: 'triggeringPlayer' } }],
              },
            ],
          },
        },
      ],
    },
  ],
} as CardInput);

const ATTACKER = creature('Vraska Attacker', 1, 3);
const VICTIM = creature('Vraska Victim', 2, 2);
const BASIC = FOREST;

function activations(
  state: GameState,
  index: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.abilityIndex === index,
  );
}

function passStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stack paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function activate(state: GameState, index: number): ReduceResult {
  const action = activations(state, index)[0];
  if (action === undefined) throw new Error(`Vraska offered no ability ${String(index)}`);
  return passStack(apply({ state, events: [] }, action));
}

function dealToVraska(state: GameState, combat: boolean): Trace {
  const sourceOid = oidOf(state, ATTACKER.name);
  const recipient = oidOf(state, VRASKA.name);
  const damage: DamageInstance = {
    sourceOid,
    controller: 1,
    recipient: { kind: 'permanent', oid: recipient },
    amount: 1,
    deathtouch: false,
    lifelink: false,
    combat,
    preventable: true,
  };
  return applyDamage(beginTrace(state), [damage]);
}

function resolveDamageTriggers(trace: Trace): Trace {
  let current = putTriggersOnStack(trace, collectTriggers(trace, 0));
  while (current.state.stack.length > 0) current = resolveTop(current);
  return current;
}

describe('Vraska temporary combat retaliation', () => {
  it('registers on resolution and destroys the creature after combat damage', () => {
    const start = scenario({
      battlefield: [
        { card: VRASKA, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
    });
    const attacker = oidOf(start.state, ATTACKER.name);
    const protectedState = activate(start.state, 0).state;
    expect(protectedState.damageRetaliations).toHaveLength(1);
    const done = resolveDamageTriggers(dealToVraska(protectedState, true));
    expect(done.state.objects[attacker]?.zone).toBe('graveyard');
  });

  it('ignores noncombat damage, a new Vraska incarnation, and an expired duration', () => {
    const start = scenario({
      battlefield: [
        { card: VRASKA, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
    });
    const protectedState = activate(start.state, 0).state;
    expect(collectTriggers(dealToVraska(protectedState, false), 0)).toEqual([]);

    const vraska = oidOf(protectedState, VRASKA.name);
    const left = moveObject(beginTrace(protectedState), vraska, 'graveyard');
    const returned = moveObject(left, vraska, 'battlefield', { controller: 0 });
    expect(collectTriggers(dealToVraska(returned.state, true), 0)).toEqual([]);

    const opponentTurn = beginTurn(beginTrace(protectedState), 1);
    expect(opponentTurn.state.damageRetaliations).toHaveLength(1);
    const ownTurn = beginTurn(beginTrace(opponentTurn.state), 0);
    expect(ownTurn.state.damageRetaliations).toEqual([]);
  });

  it('does not destroy a creature that changed zones before the trigger resolves', () => {
    const start = scenario({
      battlefield: [
        { card: VRASKA, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
    });
    const protectedState = activate(start.state, 0).state;
    const dealt = dealToVraska(protectedState, true);
    const stacked = putTriggersOnStack(dealt, collectTriggers(dealt, 0));
    const attacker = oidOf(stacked.state, ATTACKER.name);
    const left = moveObject(stacked, attacker, 'graveyard');
    const returned = moveObject(left, attacker, 'battlefield', { controller: 1 });
    const done = resolveTop(returned);
    expect(done.state.objects[attacker]?.zone).toBe('battlefield');
  });
});

describe('Vraska remaining loyalty abilities', () => {
  it('offers the -3 for a nonland permanent and never for a land', () => {
    const start = scenario({
      battlefield: [
        { card: VRASKA, controller: 0 },
        { card: VICTIM, controller: 1 },
        { card: BASIC, controller: 1 },
      ],
    });
    const victim = oidOf(start.state, VICTIM.name);
    const basic = oidOf(start.state, BASIC.name);
    const targets = activations(start.state, 1).map((action) => action.targets[0]);
    expect(targets).toContainEqual({ kind: 'permanent', oid: victim });
    expect(targets).not.toContainEqual({ kind: 'permanent', oid: basic });
  });

  it('creates three Assassins whose combat-damage trigger makes that player lose', () => {
    const start = scenario({ battlefield: [{ card: VRASKA, controller: 0, loyalty: 7 }] });
    const created = activate(start.state, 2);
    const assassins = created.state.battlefield.filter(
      (oid) => created.state.objects[oid]?.card.name === 'Assassin',
    );
    expect(assassins).toHaveLength(3);
    const damage: DamageInstance = {
      sourceOid: assassins[0]!,
      controller: 0,
      recipient: { kind: 'player', player: 1 },
      amount: 1,
      deathtouch: false,
      lifelink: false,
      combat: true,
      preventable: true,
    };
    const dealt = applyDamage(beginTrace(created.state), [damage]);
    const done = resolveDamageTriggers(dealt);
    expect(done.state.result?.loser).toBe(1);
  });
});
