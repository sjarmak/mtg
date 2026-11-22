/** Palisade Giant's live controller-relative CR 614 damage redirection. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  moveObject,
  scenario,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReplacementEffect,
} from '@mtg/kernel';
import { abilities, controlledBy, onlyObject, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { oidOf } from './helpers';

const PALISADE_GIANT = parseCard({
  kind: 'creature',
  id: 'rtr-015-palisade-giant',
  name: 'Palisade Giant',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 15 },
  manaCost: { generic: 4, W: 2 },
  colors: ['W'],
  subtypes: ['Giant', 'Soldier'],
  power: 2,
  toughness: 7,
  redirectControllerAndOtherPermanentsDamageToSelf: true,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'preventCombatDamage' },
    },
  ],
});

const BEAR = creature('Palisade Bear', 2, 2);
const OPPOSING_BEAR = creature('Opposing Bear', 2, 2);

function damage(sourceOid: ObjectId, recipient: DamageInstance['recipient'], amount: number): DamageInstance {
  return {
    sourceOid,
    controller: 1,
    recipient,
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable: true,
  };
}

function marked(state: GameState, oid: ObjectId): number {
  return state.objects[oid]?.damage ?? 0;
}

describe('Palisade Giant damage redirection', () => {
  it('redirects damage from its controller and each other controlled permanent to itself', () => {
    const start = scenario({
      battlefield: [
        { card: PALISADE_GIANT, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
    });
    const giant = oidOf(start.state, PALISADE_GIANT.name);
    const bear = oidOf(start.state, BEAR.name);
    const done = applyDamage(beginTrace(start.state), [
      damage('player-hit', { kind: 'player', player: 0 }, 3),
      damage('bear-hit', { kind: 'permanent', oid: bear }, 2),
    ]);

    expect(done.state.players[0].life).toBe(20);
    expect(marked(done.state, bear)).toBe(0);
    expect(marked(done.state, giant)).toBe(5);
    expect(eventsOfType(done.events, 'replacementApplied')).toHaveLength(2);
  });

  it('does not redirect damage already aimed at itself or damage to opposing recipients', () => {
    const start = scenario({
      battlefield: [
        { card: PALISADE_GIANT, controller: 0 },
        { card: OPPOSING_BEAR, controller: 1 },
      ],
    });
    const giant = oidOf(start.state, PALISADE_GIANT.name);
    const opposing = oidOf(start.state, OPPOSING_BEAR.name);
    const done = applyDamage(beginTrace(start.state), [
      damage('giant-hit', { kind: 'permanent', oid: giant }, 1),
      damage('opponent-hit', { kind: 'player', player: 1 }, 2),
      damage('opposing-hit', { kind: 'permanent', oid: opposing }, 1),
    ]);

    expect(marked(done.state, giant)).toBe(1);
    expect(done.state.players[1].life).toBe(18);
    expect(marked(done.state, opposing)).toBe(1);
    expect(eventsOfType(done.events, 'replacementApplied')).toEqual([]);
  });

  it('reads current control, current abilities, and source presence for every event', () => {
    const start = scenario({
      battlefield: [
        { card: PALISADE_GIANT, controller: 1 },
        { card: BEAR, controller: 0 },
      ],
    });
    const giant = oidOf(start.state, PALISADE_GIANT.name);
    const bear = oidOf(start.state, BEAR.name);
    const controlled = withContinuous(start.state, [controlledBy(onlyObject(giant), 0)]);
    expect(
      marked(
        applyDamage(beginTrace(controlled), [damage('controlled-hit', { kind: 'permanent', oid: bear }, 2)])
          .state,
        giant,
      ),
    ).toBe(2);

    const silenced = withContinuous(controlled, [
      abilities(onlyObject(giant), { removeAll: true }, { source: bear, ts: controlled.nextId }),
    ]);
    expect(
      marked(
        applyDamage(beginTrace(silenced), [damage('silenced-hit', { kind: 'permanent', oid: bear }, 2)])
          .state,
        bear,
      ),
    ).toBe(2);

    const gone = moveObject(beginTrace(controlled), giant, 'graveyard').state;
    expect(
      marked(
        applyDamage(beginTrace(gone), [damage('gone-hit', { kind: 'permanent', oid: bear }, 2)]).state,
        bear,
      ),
    ).toBe(2);
  });

  it('rechecks its live scope after an earlier CR 616 redirection', () => {
    const start = scenario({
      battlefield: [
        { card: PALISADE_GIANT, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
    });
    const giant = oidOf(start.state, PALISADE_GIANT.name);
    const bear = oidOf(start.state, BEAR.name);
    const redirectIntoScope: ReplacementEffect = {
      id: 'redirect-into-palisade-scope',
      sourceOid: 'outside-redirect',
      controller: 1,
      timestamp: -1,
      duration: 'permanent',
      selfReplacement: false,
      trigger: {
        kind: 'damage',
        toPlayer: 1,
        toPermanent: null,
        toController: null,
        toPermanentCardType: null,
        fromSource: null,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'redirectDamage', to: { kind: 'permanent', oid: bear } },
    };
    const state = { ...start.state, replacements: [redirectIntoScope] };
    const done = applyDamage(beginTrace(state), [
      damage('scope-changing-hit', { kind: 'player', player: 1 }, 3),
    ]);

    expect(done.state.players[1].life).toBe(20);
    expect(marked(done.state, bear)).toBe(0);
    expect(marked(done.state, giant)).toBe(3);
    expect(eventsOfType(done.events, 'replacementApplied').map((event) => event.id)).toEqual([
      'redirect-into-palisade-scope',
      expect.stringMatching(/^static-palisade:/u),
    ]);
  });
});
