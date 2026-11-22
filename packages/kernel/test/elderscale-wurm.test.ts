/** Elderscale Wurm's live life-floor replacement and intervening-if entry trigger. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  moveObject,
  objectFilter,
  reduce,
  reduceAll,
  resolveTop,
  scenario,
  settle,
  type DamageInstance,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { abilities, controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { creature, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const ELDERSCALE_WURM: Card = creature('Elderscale Wurm', 7, 7, {
  cost: { generic: 4, G: 3 },
  subtypes: ['Wurm'],
  keywords: ['trample'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      interveningIf: { kind: 'controllerLifeBelow', fewerThan: 7 },
      effects: [{ kind: 'setLife', amount: 7 }],
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'damageCannotReduceControllerLifeBelow', minimum: 7 },
    },
  ],
});

const BLANK = creature('Blank Copy', 1, 1);
const LIFE_LOSS = sorcery(
  'Pure Life Loss',
  [{ kind: 'loseLife', amount: 5, target: { kind: 'targetPlayer' } }],
  {},
);

function damage(sourceOid: ObjectId, player: 0 | 1, amount: number, preventable = true): DamageInstance {
  return {
    sourceOid,
    controller: player === 0 ? 1 : 0,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable,
  };
}

function hit(state: GameState, player: 0 | 1, amount: number, preventable = true) {
  return applyDamage(beginTrace(state), [damage('elderscale-test-source', player, amount, preventable)]);
}

describe('Elderscale Wurm entry', () => {
  it('sets life to seven only when below seven and rechecks on resolution', () => {
    const below = scenario({ life: [5, 20], hands: [[ELDERSCALE_WURM], []] }).state;
    const wurm = handOidOf(below, 0, ELDERSCALE_WURM.name);
    const triggered = settle(moveObject(beginTrace(below), wurm, 'battlefield'));
    expect(triggered.state.stack).toHaveLength(1);
    expect(resolveTop(triggered).state.players[0].life).toBe(7);

    const atSeven = scenario({ life: [7, 20], hands: [[ELDERSCALE_WURM], []] }).state;
    const quiet = settle(
      moveObject(beginTrace(atSeven), handOidOf(atSeven, 0, ELDERSCALE_WURM.name), 'battlefield'),
    );
    expect(quiet.state.stack).toHaveLength(0);

    const raised = {
      ...triggered.state,
      players: [{ ...triggered.state.players[0], life: 8 }, triggered.state.players[1]] as const,
    };
    expect(resolveTop(beginTrace(raised)).state.players[0].life).toBe(8);
  });
});

describe('Elderscale Wurm damage floor', () => {
  it('rewrites only the crossing amount and is not prevention', () => {
    const start = scenario({
      life: [10, 20],
      battlefield: [{ card: ELDERSCALE_WURM, controller: 0 }],
    });
    const done = hit(start.state, 0, 5);

    expect(done.state.players[0].life).toBe(7);
    expect(eventsOfType(done.events, 'damageDealt').map((event) => event.amount)).toEqual([3]);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
    expect(eventsOfType(done.events, 'replacementApplied')).toHaveLength(1);
  });

  it('still floors unpreventable damage but does nothing below the threshold', () => {
    const protectedState = scenario({
      life: [10, 20],
      battlefield: [{ card: ELDERSCALE_WURM, controller: 0 }],
    }).state;
    expect(hit(protectedState, 0, 8, false).state.players[0].life).toBe(7);

    const belowState = scenario({
      life: [6, 20],
      battlefield: [{ card: ELDERSCALE_WURM, controller: 0 }],
    }).state;
    expect(hit(belowState, 0, 2).state.players[0].life).toBe(4);
  });

  it('does not replace ordinary life loss', () => {
    const start = scenario({
      life: [10, 20],
      battlefield: [{ card: ELDERSCALE_WURM, controller: 0 }],
      hands: [[LIFE_LOSS], []],
    });
    const spell = handOidOf(start.state, 0, LIFE_LOSS.name);
    const onStack = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [{ kind: 'player', player: 0 }],
    });
    const done = reduceAll(onStack.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(done.state.players[0].life).toBe(5);
  });

  it('rebuilds each Wurm as an event-local rule instead of registering stale replacements', () => {
    const start = scenario({
      life: [10, 20],
      battlefield: [
        { card: ELDERSCALE_WURM, controller: 0 },
        { card: ELDERSCALE_WURM, controller: 0 },
      ],
    });

    expect(start.state.replacements).toEqual([]);
    const done = hit(start.state, 0, 5);
    expect(done.state.players[0].life).toBe(7);
    expect(eventsOfType(done.events, 'replacementApplied')).toHaveLength(1);
  });

  it('rechecks the live floor independently for each damage instance', () => {
    const start = scenario({
      life: [10, 20],
      battlefield: [{ card: ELDERSCALE_WURM, controller: 0 }],
    });
    const done = applyDamage(beginTrace(start.state), [
      damage('elderscale-first-source', 0, 2),
      damage('elderscale-second-source', 0, 5),
    ]);

    expect(done.state.players[0].life).toBe(7);
    expect(eventsOfType(done.events, 'damageDealt').map((event) => event.amount)).toEqual([2, 1]);
    expect(eventsOfType(done.events, 'replacementApplied')).toHaveLength(1);
  });

  it('tracks current controller, current abilities, layer-one copies, and source departure', () => {
    const start = scenario({
      life: [10, 10],
      battlefield: [
        { card: ELDERSCALE_WURM, controller: 1 },
        { card: BLANK, controller: 1 },
      ],
    });
    const wurm = oidOf(start.state, ELDERSCALE_WURM.name);
    const blank = oidOf(start.state, BLANK.name);

    const controlled = withContinuous(start.state, [controlledBy(onlyObject(wurm), 0)]);
    expect(hit(controlled, 0, 5).state.players[0].life).toBe(7);
    expect(hit(controlled, 1, 5).state.players[1].life).toBe(5);

    const copied = withContinuous(start.state, [copies(objectFilter({ oids: [blank] }), wurm)]);
    expect(hit(copied, 1, 5).state.players[1].life).toBe(7);

    const silenced = withContinuous(start.state, [
      abilities(onlyObject(wurm), { removeAll: true }, { source: blank, ts: start.state.nextId }),
    ]);
    expect(hit(silenced, 1, 5).state.players[1].life).toBe(5);

    const gone = moveObject(beginTrace(start.state), wurm, 'graveyard').state;
    expect(hit(gone, 1, 5).state.players[1].life).toBe(5);
  });
});
