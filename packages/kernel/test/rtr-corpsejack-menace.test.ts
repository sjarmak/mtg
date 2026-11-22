/** Corpsejack Menace's live counter-placement replacement across every placement path. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  counterCount,
  getObject,
  moveObject,
  placeCounters,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type Target,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { artifact, creature, FOREST, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const CORPSEJACK = parseCard({
  kind: 'creature',
  id: 'rtr-152-corpsejack-menace',
  name: 'Corpsejack Menace',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 152 },
  manaCost: { generic: 2, B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Fungus'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'doublePlusOnePlusOneCountersOnCreaturesYouControl' },
    },
  ],
});

const BEAR = creature('Corpsejack Bear', 2, 2);
const RELIC = artifact('Corpsejack Relic');
const GRAFT = sorcery(
  'Corpsejack Graft',
  [{ kind: 'putCounters', counter: 'plusOnePlusOne', count: 2, target: { kind: 'targetCreature' } }],
  { generic: 3, G: 1 },
);

const ENTERS_WITH_COUNTERS = parseCard({
  kind: 'creature',
  id: 'tst-corpsejack-entry',
  name: 'Corpsejack Entrant',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 152 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  subtypes: ['Beast'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 },
});

function field(cards: readonly { readonly card: Card; readonly controller: 0 | 1 }[]): GameState {
  return scenario({ battlefield: [...cards] }).state;
}

function counters(state: GameState, oid: ObjectId, kind: 'plusOnePlusOne' | 'minusOneMinusOne'): number {
  return counterCount(getObject(state, oid).counters, kind);
}

function pass(state: GameState): Action {
  const player = state.turn.priority;
  if (player === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player };
}

function castAndResolve(start: GameState, target: Target): GameState {
  const oid = playerOf(start, 0).hand.find((candidate) => start.objects[candidate]?.card.name === GRAFT.name);
  if (oid === undefined) throw new Error('Graft is not in hand');
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets: [target] });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

describe('Corpsejack Menace counter replacement', () => {
  it('doubles one and many +1/+1 counters before direct placement', () => {
    const start = field([
      { card: CORPSEJACK, controller: 0 },
      { card: BEAR, controller: 0 },
    ]);
    const bear = oidOf(start, BEAR.name);
    const one = placeCounters(beginTrace(start), bear, 'plusOnePlusOne', 1);
    const many = placeCounters(one, bear, 'plusOnePlusOne', 3);

    expect(counters(many.state, bear, 'plusOnePlusOne')).toBe(8);
  });

  it('composes two live replacements once each', () => {
    const start = field([
      { card: CORPSEJACK, controller: 0 },
      { card: CORPSEJACK, controller: 0 },
      { card: BEAR, controller: 0 },
    ]);
    const bear = oidOf(start, BEAR.name);

    expect(
      counters(placeCounters(beginTrace(start), bear, 'plusOnePlusOne', 2).state, bear, 'plusOnePlusOne'),
    ).toBe(8);
  });

  it('does not change another counter type, an opponent creature, or a noncreature permanent', () => {
    const start = field([
      { card: CORPSEJACK, controller: 0 },
      { card: BEAR, controller: 0 },
      { card: BEAR, controller: 1 },
      { card: RELIC, controller: 0 },
    ]);
    const ownBear = start.battlefield.find(
      (oid) => start.objects[oid]?.card.name === BEAR.name && start.objects[oid]?.controller === 0,
    );
    const opposingBear = start.battlefield.find(
      (oid) => start.objects[oid]?.card.name === BEAR.name && start.objects[oid]?.controller === 1,
    );
    if (ownBear === undefined || opposingBear === undefined) throw new Error('missing bear fixture');
    const relic = oidOf(start, RELIC.name);
    const minus = placeCounters(beginTrace(start), ownBear, 'minusOneMinusOne', 2);
    const opponent = placeCounters(minus, opposingBear, 'plusOnePlusOne', 2);
    const noncreature = placeCounters(opponent, relic, 'plusOnePlusOne', 2);

    expect(counters(noncreature.state, ownBear, 'minusOneMinusOne')).toBe(2);
    expect(counters(noncreature.state, opposingBear, 'plusOnePlusOne')).toBe(2);
    expect(counters(noncreature.state, relic, 'plusOnePlusOne')).toBe(2);
  });

  it('stops applying as soon as its source leaves the battlefield', () => {
    const start = field([
      { card: CORPSEJACK, controller: 0 },
      { card: BEAR, controller: 0 },
    ]);
    const corpsejack = oidOf(start, CORPSEJACK.name);
    const bear = oidOf(start, BEAR.name);
    const departed = moveObject(beginTrace(start), corpsejack, 'graveyard');

    expect(counters(placeCounters(departed, bear, 'plusOnePlusOne', 2).state, bear, 'plusOnePlusOne')).toBe(
      2,
    );
  });

  it('routes resolving putCounters effects through the same replacement', () => {
    const start = scenario({
      battlefield: [
        { card: CORPSEJACK, controller: 0 },
        { card: BEAR, controller: 0 },
        ...Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 as const })),
      ],
      hands: [[GRAFT], []],
    }).state;
    const bear = oidOf(start, BEAR.name);

    expect(counters(castAndResolve(start, { kind: 'permanent', oid: bear }), bear, 'plusOnePlusOne')).toBe(4);
  });

  it("doubles intrinsic entry counters from another creature but not Corpsejack's own future ability", () => {
    const withSource = scenario({
      battlefield: [{ card: CORPSEJACK, controller: 0 }],
      hands: [[ENTERS_WITH_COUNTERS], []],
    }).state;
    const entrant = handOidOf(withSource, 0, ENTERS_WITH_COUNTERS.name);
    const arrived = moveObject(beginTrace(withSource), entrant, 'battlefield');
    expect(counters(arrived.state, entrant, 'plusOnePlusOne')).toBe(4);

    const alone = scenario({ hands: [[CORPSEJACK], []] }).state;
    const corpsejack = handOidOf(alone, 0, CORPSEJACK.name);
    const entered = moveObject(beginTrace(alone), corpsejack, 'battlefield');
    expect(counters(entered.state, corpsejack, 'plusOnePlusOne')).toBe(0);
  });
});
