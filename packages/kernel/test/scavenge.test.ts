/** Scavenge timing, payment, source movement, targeting, and resolution. */
import { describe, expect, it } from 'vitest';
import { mana, parseCard, scavengeAbility } from '@mtg/dsl';
import {
  beginTrace,
  getObject,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';

const GOLIATH = parseCard({
  kind: 'creature',
  id: 'rtr-120-deadbridge-goliath',
  name: 'Deadbridge Goliath',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 120 },
  colors: ['G'],
  manaCost: { generic: 2, G: 2 },
  subtypes: ['Insect'],
  power: 5,
  toughness: 5,
  abilities: [scavengeAbility(mana({ generic: 4, G: 2 }), 5)],
});

const BEAR = creature('Scavenge Bear', 2, 2);
const HOLD = instant('Hold the Stack', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }], {});
type Activation = Extract<Action, { type: 'activateAbility' }>;

function graveyardOid(state: GameState, player: 0 | 1): ObjectId {
  const oid = state.players[player].graveyard.find(
    (candidate) => state.objects[candidate]?.card.name === GOLIATH.name,
  );
  if (oid === undefined) throw new Error(`player ${String(player)} lost the scavenge source`);
  return oid;
}

function battlefieldOid(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`battlefield lost ${name}`);
  return oid;
}

function scavengeAction(state: GameState, source: ObjectId): Activation | undefined {
  return legalActions(state).find(
    (action): action is Activation => action.type === 'activateAbility' && action.oid === source,
  );
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 6 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('scavenge lost its priority window');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

function opened(): { readonly current: ReduceResult; readonly source: ObjectId; readonly target: ObjectId } {
  const current = scenario({
    battlefield: [
      { card: BEAR, controller: 0 },
      ...lands(FOREST, 6).map((card) => ({ card, controller: 0 as const })),
    ],
    graveyards: [[GOLIATH], [GOLIATH]],
    hands: [[HOLD], []],
  });
  return {
    current,
    source: graveyardOid(current.state, 0),
    target: battlefieldOid(current.state, BEAR.name),
  };
}

describe('scavenge activation', () => {
  it('is offered only from its owner graveyard at sorcery speed', () => {
    const { current, source, target } = opened();
    const action = scavengeAction(current.state, source);
    expect(action?.targets).toEqual([{ kind: 'permanent', oid: target }]);

    const opponentSource = graveyardOid(current.state, 1);
    const submitted: Activation = {
      type: 'activateAbility',
      player: 0,
      oid: opponentSource,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: target }],
      sacrifices: [],
    };
    expect(validateAction(current.state, submitted)).toBe('source is not in your graveyard');

    const combat = { ...current.state, turn: { ...current.state.turn, step: 'declareAttackers' as const } };
    expect(scavengeAction(combat, source)).toBeUndefined();
    expect(validateAction(combat, { ...submitted, oid: source })).toBe(
      'this ability can be activated only as a sorcery',
    );

    const opponentTurn = {
      ...current.state,
      turn: { ...current.state.turn, active: 1 as const, priority: 0 as const },
    };
    expect(scavengeAction(opponentTurn, source)).toBeUndefined();
    expect(validateAction(opponentTurn, { ...submitted, oid: source })).toBe(
      'this ability can be activated only as a sorcery',
    );

    const withoutPriority = {
      ...current.state,
      turn: { ...current.state.turn, priority: 1 as const },
    };
    expect(scavengeAction(withoutPriority, source)).toBeUndefined();
    expect(validateAction(withoutPriority, { ...submitted, oid: source })).toBe("it is player 1's decision");

    const held = reduce(current.state, {
      type: 'castSpell',
      player: 0,
      oid: current.state.players[0].hand[0]!,
      targets: [null],
    });
    const occupiedStack = held.state;
    expect(scavengeAction(occupiedStack, source)).toBeUndefined();
  });

  it('pays exact mana and exiles the source before creating a responsive stack entry', () => {
    const { current, source } = opened();
    const action = scavengeAction(current.state, source);
    if (action === undefined) throw new Error('scavenge was not offered');

    const poor = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        ...lands(FOREST, 5).map((card) => ({ card, controller: 0 as const })),
      ],
      graveyards: [[GOLIATH], []],
    });
    expect(scavengeAction(poor.state, graveyardOid(poor.state, 0))).toBeUndefined();

    const activated = apply(current, action);
    expect(getObject(activated.state, source).zone).toBe('exile');
    expect(activated.state.exile).toContain(source);
    expect(activated.state.stack).toHaveLength(1);
    expect(pendingDecision(activated.state)).toMatchObject({ kind: 'priority', player: 0 });
    expect(scavengeAction(activated.state, source)).toBeUndefined();
    expect(activated.state.battlefield.filter((oid) => getObject(activated.state, oid).tapped)).toHaveLength(
      6,
    );
    expect(
      activated.events.filter(
        (event) => event.type === 'zoneChanged' && event.oid === source && event.to === 'exile',
      ),
    ).toHaveLength(1);
  });

  it('puts the exact counters on resolution and keeps the paid exile on target loss', () => {
    const { current, source, target } = opened();
    const action = scavengeAction(current.state, source);
    if (action === undefined) throw new Error('scavenge was not offered');

    const resolved = resolveTop(apply(current, action));
    expect(getObject(resolved.state, target).counters.plusOnePlusOne).toBe(5);
    expect(powerOf(resolved.state, target)).toBe(7);
    expect(toughnessOf(resolved.state, target)).toBe(7);

    const second = opened();
    const secondAction = scavengeAction(second.current.state, second.source);
    if (secondAction === undefined) throw new Error('second scavenge was not offered');
    const activated = apply(second.current, secondAction);
    const gone = moveObject(beginTrace(activated.state), second.target, 'graveyard');
    const fizzled = resolveTop({
      state: gone.state,
      events: [...activated.events, ...gone.events],
    });
    expect(getObject(fizzled.state, second.source).zone).toBe('exile');
    expect(getObject(fizzled.state, second.target).counters.plusOnePlusOne ?? 0).toBe(0);
  });
});
