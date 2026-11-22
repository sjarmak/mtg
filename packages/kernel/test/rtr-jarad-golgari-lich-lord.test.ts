/** Live graveyard sizing and both exact Jarad activation payments. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  scenario,
  toughnessOf,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST, instant, lands, MOUNTAIN, SWAMP } from './cards';
import { withCounters } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const JARAD = parseCard({
  kind: 'creature',
  id: 'rtr-174-jarad-kernel',
  name: 'Jarad, Golgari Lich Lord',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 174 },
  manaCost: { B: 2, G: 2 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Zombie', 'Elf'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      printedSubjectReference: 'cardNameBeforeComma',
      modification: {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: {
          kind: 'countMatching',
          filter: { cardTypes: ['creature'] },
          whose: 'you',
          zone: 'controllerGraveyard',
        },
      },
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 1, B: 1, G: 1 },
        sacrificeMatching: {
          count: 1,
          excludeSource: true,
          filter: { cardTypes: ['creature'] },
        },
      },
      effects: [
        {
          kind: 'loseLife',
          amount: { kind: 'paidSacrificePower' },
          players: 'eachOpponent',
          target: { kind: 'noTarget' },
        },
      ],
    },
    {
      kind: 'activated',
      activationZone: 'graveyard',
      printedSourceReference: 'thisCard',
      cost: { mana: {}, sacrificeLandSubtypePair: ['Swamp', 'Forest'] },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
} as CardInput);

const BODY = creature('Golgari Body', 3, 3);
const NONCREATURE = instant('Graveyard Note', [
  { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
]);

const OVERGROWN_TOMB = parseCard({
  kind: 'land',
  id: 'tst-overgrown-tomb',
  name: 'Overgrown Tomb',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 174 },
  colors: [],
  subtypes: ['Swamp', 'Forest'],
});

type Activation = Extract<Action, { type: 'activateAbility' }>;

function jaradActivations(state: GameState, abilityIndex: number): readonly Activation[] {
  return legalActions(state).filter(
    (action): action is Activation =>
      action.type === 'activateAbility' &&
      state.objects[action.oid]?.card.name === JARAD.name &&
      action.abilityIndex === abilityIndex,
  );
}

function resolveStack(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 8 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error(`Jarad paused at ${decision?.kind ?? 'nothing'}`);
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

describe("Jarad's live characteristic bonus", () => {
  it('counts only creature cards in its current controller graveyard and recomputes live', () => {
    const opened = scenario({
      battlefield: [
        { card: JARAD, controller: 0 },
        { card: BODY, controller: 0 },
      ],
      graveyards: [[BODY, NONCREATURE], [BODY]],
    });
    const jarad = oidOf(opened.state, JARAD.name);
    const battlefieldBody = opened.state.battlefield.find(
      (oid) => oid !== jarad && opened.state.objects[oid]?.card.name === BODY.name,
    );
    if (battlefieldBody === undefined) throw new Error('fixture lost its battlefield body');

    expect([powerOf(opened.state, jarad), toughnessOf(opened.state, jarad)]).toEqual([3, 3]);
    const moved = moveObject(opened, battlefieldBody, 'graveyard');
    expect([powerOf(moved.state, jarad), toughnessOf(moved.state, jarad)]).toEqual([4, 4]);
  });
});

describe("Jarad's sacrifice-another-creature activation", () => {
  it('retains layered paid power and makes each opponent lose exactly that much life', () => {
    const opened = scenario({
      battlefield: [
        { card: JARAD, controller: 0 },
        { card: BODY, controller: 0 },
        ...lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
      ],
      graveyards: [[BODY], []],
    });
    const body = opened.state.battlefield.find((oid) => opened.state.objects[oid]?.card.name === BODY.name);
    if (body === undefined) throw new Error('fixture lost its paid creature');
    const poweredState = withCounters(opened.state, body, 'plusOnePlusOne', 1);
    const action = jaradActivations(poweredState, 1).find((candidate) => candidate.sacrifices[0] === body);
    if (action === undefined) throw new Error('missing Jarad life-loss activation');

    const paid = apply({ state: poweredState, events: opened.events }, action);
    expect(paid.state.objects[body]?.zone).toBe('graveyard');
    expect(paid.state.stack.at(-1)?.paidSacrificePower).toBe(4);
    expect(resolveStack(paid).state.players.map((player) => player.life)).toEqual([20, 16]);
  });
});

describe("Jarad's graveyard return payment", () => {
  it('requires two distinct lands that collectively satisfy Swamp and Forest', () => {
    const loneDual = scenario({
      battlefield: [{ card: OVERGROWN_TOMB, controller: 0 }],
      graveyards: [[JARAD], []],
    }).state;
    expect(jaradActivations(loneDual, 2)).toEqual([]);

    const source = loneDual.players[0].graveyard[0];
    const dual = loneDual.battlefield[0];
    if (source === undefined || dual === undefined) throw new Error('fixture lost Jarad or the dual land');
    expect(
      validateAction(loneDual, {
        type: 'activateAbility',
        player: 0,
        oid: source,
        abilityIndex: 2,
        targets: [null],
        sacrifices: [dual, dual],
      }),
    ).toMatch(/needs one Swamp and one Forest/u);

    const payable = scenario({
      battlefield: [
        { card: OVERGROWN_TOMB, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
      graveyards: [[JARAD], []],
    }).state;
    const payableSource = payable.players[0].graveyard[0];
    const payableDual = payable.battlefield[0];
    if (payableSource === undefined || payableDual === undefined)
      throw new Error('payable fixture lost an object');
    expect(
      validateAction(payable, {
        type: 'activateAbility',
        player: 0,
        oid: payableSource,
        abilityIndex: 2,
        targets: [null],
        sacrifices: [payableDual, payableDual],
      }),
    ).toMatch(/offered twice/u);
  });

  it('sacrifices one land of each subtype before returning the exact graveyard source', () => {
    const opened = scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: OVERGROWN_TOMB, controller: 0 },
      ],
      graveyards: [[JARAD], [JARAD]],
    });
    const source = opened.state.players[0].graveyard[0];
    if (source === undefined) throw new Error('fixture lost owned Jarad');
    const actions = jaradActivations(opened.state, 2);
    expect(actions).toHaveLength(3);
    const paid = apply(opened, actions[0]!);
    for (const oid of actions[0]!.sacrifices) expect(paid.state.objects[oid]?.zone).toBe('graveyard');
    expect(paid.state.objects[source]?.zone).toBe('graveyard');

    const resolved = resolveStack(paid);
    expect(resolved.state.objects[source]?.zone).toBe('hand');
    expect(resolved.state.players[1].graveyard).toHaveLength(1);
  });
});
