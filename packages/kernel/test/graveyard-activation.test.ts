/** Native enumeration, payment, and source identity for graveyard activations. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { lands, MOUNTAIN, SWAMP } from './cards';

const SKELETON = parseCard({
  kind: 'creature',
  id: 'tst-reassembling-skeleton',
  name: 'Reassembling Skeleton',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 112 },
  colors: ['B'],
  manaCost: { generic: 1, B: 1 },
  subtypes: ['Skeleton', 'Warrior'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      activationZone: 'graveyard',
      cost: { mana: { generic: 1, B: 1 } },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'battlefieldTapped' }],
    },
  ],
});

const PHOENIX = parseCard({
  kind: 'creature',
  id: 'tst-firewing-phoenix',
  name: 'Firewing Phoenix',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 131 },
  colors: ['R'],
  manaCost: { generic: 3, R: 1 },
  subtypes: ['Phoenix'],
  keywords: ['flying'],
  power: 4,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      activationZone: 'graveyard',
      cost: { mana: { generic: 1, R: 3 } },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
});

type Activation = Extract<Action, { type: 'activateAbility' }>;

function graveyardOids(state: GameState, player: 0 | 1, name: string): readonly ObjectId[] {
  return state.players[player].graveyard.filter((oid) => state.objects[oid]?.card.name === name);
}

function activations(state: GameState, source?: ObjectId): readonly Activation[] {
  return legalActions(state).filter(
    (action): action is Activation =>
      action.type === 'activateAbility' && (source === undefined || action.oid === source),
  );
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('ability lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

describe('activating the source card from its owner graveyard', () => {
  it('offers each exact owned source, never a battlefield or opposing copy', () => {
    const start = scenario({
      battlefield: [
        { card: SKELETON, controller: 0 },
        ...lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      graveyards: [[SKELETON], [SKELETON]],
    }).state;
    const own = graveyardOids(start, 0, SKELETON.name)[0];
    const opposing = graveyardOids(start, 1, SKELETON.name)[0];
    if (own === undefined || opposing === undefined) throw new Error('fixture lost a graveyard source');

    expect(activations(start).map((action) => action.oid)).toEqual([own]);
    expect(
      validateAction(start, {
        type: 'activateAbility',
        player: 0,
        oid: opposing,
        abilityIndex: 0,
        targets: [null],
        sacrifices: [],
      }),
    ).toBe('source is not in your graveyard');
  });

  it('keeps the source in the graveyard on the stack, then returns that exact card tapped', () => {
    let current = scenario({
      battlefield: lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
      graveyards: [[SKELETON, SKELETON], []],
    });
    const [source, decoy] = graveyardOids(current.state, 0, SKELETON.name);
    if (source === undefined || decoy === undefined) throw new Error('fixture lost a Skeleton');
    const action = activations(current.state, source)[0];
    if (action === undefined) throw new Error('graveyard activation was not offered');

    current = apply(current, action);
    expect(current.state.objects[source]?.zone).toBe('graveyard');
    expect(current.state.stack).toHaveLength(1);

    current = resolveTop(current);
    expect(current.state.objects[source]).toMatchObject({
      zone: 'battlefield',
      owner: 0,
      controller: 0,
      tapped: true,
    });
    expect(current.state.objects[decoy]?.zone).toBe('graveyard');
  });

  it('returns Firewing Phoenix to hand and does nothing if its source left before resolution', () => {
    const board = () =>
      scenario({
        battlefield: lands(MOUNTAIN, 4).map((card) => ({ card, controller: 0 as const })),
        graveyards: [[PHOENIX], []],
      });

    let returned = board();
    const source = graveyardOids(returned.state, 0, PHOENIX.name)[0];
    if (source === undefined) throw new Error('fixture lost Firewing Phoenix');
    const action = activations(returned.state, source)[0];
    if (action === undefined) throw new Error('Phoenix activation was not offered');
    returned = resolveTop(apply(returned, action));
    expect(returned.state.objects[source]?.zone).toBe('hand');

    let interrupted = board();
    const movedSource = graveyardOids(interrupted.state, 0, PHOENIX.name)[0];
    if (movedSource === undefined) throw new Error('fixture lost the second Phoenix');
    const movedAction = activations(interrupted.state, movedSource)[0];
    if (movedAction === undefined) throw new Error('second Phoenix activation was not offered');
    interrupted = apply(interrupted, movedAction);
    const moved = moveObject(beginTrace(interrupted.state), movedSource, 'exile');
    interrupted = { state: moved.state, events: [...interrupted.events, ...moved.events] };
    interrupted = resolveTop(interrupted);
    expect(interrupted.state.objects[movedSource]?.zone).toBe('exile');
  });
});
