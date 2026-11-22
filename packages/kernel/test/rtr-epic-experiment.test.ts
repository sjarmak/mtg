/** Native top-X exile, optional free-cast window, and exact cleanup for RTR #159. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, instant, ISLAND, lands, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const EPIC_EXPERIMENT = parseCard({
  kind: 'sorcery',
  id: 'rtr-159-epic-experiment-kernel',
  name: 'Epic Experiment',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 159 },
  manaCost: { hasX: true, U: 1, R: 1 },
  colors: ['R', 'U'],
  effects: [
    {
      kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
      topXOriginalsProfile: true,
    },
  ],
} as CardInput);

const CHEAP_INSTANT = instant(
  'Epic Cheap Instant',
  [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
  { generic: 1, U: 1 },
);
const CHEAP_SORCERY = sorcery(
  'Epic Cheap Sorcery',
  [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  { R: 1 },
);
const EXPENSIVE_SORCERY = sorcery(
  'Epic Expensive Sorcery',
  [{ kind: 'gainLife', amount: 7, target: { kind: 'noTarget' } }],
  { generic: 4, R: 1 },
);
const CREATURE = creature('Epic Creature', 3, 3);
const FODDER = creature('Epic Additional Cost Fodder', 3, 3);
const ADDITIONAL_COST = parseCard({
  kind: 'instant',
  id: 'epic-additional-cost-probe',
  name: 'Epic Additional Cost Probe',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 9159 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  additionalCost: { sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'paidSacrificePower' },
      target: { kind: 'anyTarget' },
    },
  ],
} as CardInput);

function opening(library: readonly Card[], x = 3, permanents: readonly Card[] = []): ReduceResult {
  const start = scenario({
    battlefield: [
      ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
      ...lands(MOUNTAIN, 4).map((card) => ({ card, controller: 0 as const })),
      ...permanents.map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[EPIC_EXPERIMENT], []],
    libraries: [library, []],
  });
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, EPIC_EXPERIMENT.name),
    targets: [null],
    x,
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function freeCast(state: GameState, oid: ObjectId): Extract<Action, { type: 'castSpell' }> {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === oid,
  );
  if (action?.type !== 'castSpell') throw new Error(`Epic Experiment did not offer ${oid}`);
  return action;
}

function objectOid(state: GameState, name: string): ObjectId {
  const match = Object.values(state.objects).find((object) => object.card.name === name);
  if (match === undefined) throw new Error(`no object named ${name}`);
  return match.oid;
}

describe('Epic Experiment in the kernel', () => {
  it('exiles exactly the top X and offers only qualifying instant and sorcery cards', () => {
    const start = opening([CHEAP_INSTANT, CREATURE, EXPENSIVE_SORCERY, CHEAP_SORCERY], 3);
    const cheap = objectOid(start.state, CHEAP_INSTANT.name);
    const options = legalActions(start.state);

    expect(pendingDecision(start.state)).toMatchObject({ kind: 'freeCast', optional: true });
    expect(options.filter((action) => action.type === 'castSpell').map((action) => action.oid)).toEqual([
      cheap,
    ]);
    expect(start.state.players[0].library.map((oid) => start.state.objects[oid]?.card.name)).toEqual([
      CHEAP_SORCERY.name,
    ]);
    expect(start.state.objects[cheap]?.zone).toBe('exile');
    expect(start.state.objects[objectOid(start.state, CREATURE.name)]?.zone).toBe('exile');
    expect(start.state.objects[objectOid(start.state, EXPENSIVE_SORCERY.name)]?.zone).toBe('exile');
  });

  it('moves every uncast member of the exact batch to its owner graveyard on decline', () => {
    const paused = opening([CHEAP_INSTANT, CREATURE, EXPENSIVE_SORCERY, CHEAP_SORCERY], 3);
    const decline = legalActions(paused.state).find((action) => action.type === 'declineFreeCast');
    if (decline?.type !== 'declineFreeCast') throw new Error('Epic Experiment was not optional');
    const done = apply(paused, decline);

    expect(done.state.pendingFreeCast).toBeUndefined();
    expect(done.state.players[0].graveyard.map((oid) => done.state.objects[oid]?.card.name)).toEqual(
      expect.arrayContaining([
        EPIC_EXPERIMENT.name,
        CHEAP_INSTANT.name,
        CREATURE.name,
        EXPENSIVE_SORCERY.name,
      ]),
    );
    expect(done.state.objects[objectOid(done.state, CHEAP_SORCERY.name)]?.zone).toBe('library');
  });

  it('casts eligible originals in either order and cleans only the uncast remainder', () => {
    const paused = opening([CHEAP_INSTANT, CHEAP_SORCERY, CREATURE], 3);
    const instantOid = objectOid(paused.state, CHEAP_INSTANT.name);
    const sorceryOid = objectOid(paused.state, CHEAP_SORCERY.name);
    const creatureOid = objectOid(paused.state, CREATURE.name);
    const first = apply(paused, freeCast(paused.state, sorceryOid));
    const second = apply(first, freeCast(first.state, instantOid));

    expect(second.state.pendingFreeCast).toBeUndefined();
    expect(second.state.stack.map((entry) => entry.oid)).toEqual([sorceryOid, instantOid]);
    expect(second.state.objects[creatureOid]?.zone).toBe('graveyard');
    expect(second.state.objects[instantOid]?.zone).toBe('stack');
    expect(second.state.objects[sorceryOid]?.zone).toBe('stack');
  });

  it('does nothing and opens no decision for X equals zero', () => {
    const done = opening([CHEAP_INSTANT], 0);
    expect(done.state.pendingFreeCast).toBeUndefined();
    expect(done.state.objects[objectOid(done.state, CHEAP_INSTANT.name)]?.zone).toBe('library');
  });

  it('keeps ordinary targets and mandatory additional costs on each free cast', () => {
    const unpayable = opening([ADDITIONAL_COST], 3);
    expect(unpayable.state.pendingFreeCast).toBeUndefined();
    expect(unpayable.state.objects[objectOid(unpayable.state, ADDITIONAL_COST.name)]?.zone).toBe('graveyard');

    const payable = opening([ADDITIONAL_COST], 3, [FODDER]);
    const spell = objectOid(payable.state, ADDITIONAL_COST.name);
    const fodder = objectOid(payable.state, FODDER.name);
    const cast = legalActions(payable.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === spell &&
        action.sacrifices?.includes(fodder) === true &&
        action.targets[0]?.kind === 'player' &&
        action.targets[0].player === 1,
    );
    if (cast?.type !== 'castSpell') throw new Error('Epic Experiment lost a complete free-cast declaration');
    const done = apply(payable, cast);

    expect(done.state.objects[fodder]?.zone).toBe('graveyard');
    expect(done.state.objects[spell]?.zone).toBe('stack');
    expect(done.state.pendingFreeCast).toBeUndefined();
  });
});
