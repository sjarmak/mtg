/** Ogre Jailbreaker ignores only its own defender while its current controller controls a live Gate. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eligibleAttackers,
  moveObject,
  onlyObject,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { controlledBy, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const JAILBREAKER = parseCard({
  kind: 'creature',
  id: 'rtr-72-ogre-jailbreaker-kernel',
  name: 'Ogre Jailbreaker',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 72 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Ogre', 'Rogue'],
  keywordAbilities: [{ kind: 'defender' }],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'canAttackAsThoughNoDefender' },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Gate', atLeast: 1 },
      printedSubjectReference: 'thisCreature',
    },
  ],
});

const GATE = parseCard({
  kind: 'land',
  id: 'rtr-72-jailbreaker-gate',
  name: 'Jailbreaker Gate',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 993 },
  colors: [],
  supertypes: [],
  subtypes: ['Gate'],
  abilities: [],
});

const BEAR = parseCard({
  kind: 'creature',
  id: 'rtr-72-jailbreaker-bear',
  name: 'Jailbreaker Bear',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 992 },
  manaCost: { generic: 2 },
  colors: [],
  subtypes: ['Bear'],
  power: 2,
  toughness: 2,
});

const ATTACK_LOCK = parseCard({
  kind: 'enchantment',
  id: 'rtr-72-attack-lock',
  name: 'Attack Lock',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 994 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: [],
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Ogre',
      modification: { kind: 'cantAttack' },
    },
  ],
});

function swingWith(oid: ObjectId): Action {
  return { type: 'declareAttackers', player: 0, attackers: [{ oid, defender: 1 }] };
}

function doors(state: GameState, oid: ObjectId): { offered: boolean; refusal: string | null } {
  return {
    offered: eligibleAttackers(state).includes(oid),
    refusal: validateAction(state, swingWith(oid)),
  };
}

function board(gateController?: 0 | 1, summoningSick = false) {
  return scenario({
    battlefield: [
      { card: JAILBREAKER, controller: 0, summoningSick },
      { card: BEAR, controller: 0 },
      ...(gateController === undefined ? [] : [{ card: GATE, controller: gateController }]),
    ],
    step: 'declareAttackers',
  });
}

describe("Ogre Jailbreaker's live Gate permission", () => {
  it('admits it at both attack doors only for a Gate controlled by its controller', () => {
    const absent = board();
    const opposed = board(1);
    const own = board(0);

    for (const blocked of [absent, opposed]) {
      const jailbreaker = oidOf(blocked.state, JAILBREAKER.name);
      expect(doors(blocked.state, jailbreaker)).toEqual({
        offered: false,
        refusal: `${jailbreaker} cannot attack`,
      });
    }

    const jailbreaker = oidOf(own.state, JAILBREAKER.name);
    expect(doors(own.state, jailbreaker)).toEqual({ offered: true, refusal: null });
  });

  it('follows Gate arrival, Gate departure, and the source current controller live', () => {
    const gateInGraveyard = scenario({
      battlefield: [
        { card: JAILBREAKER, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      graveyards: [[GATE], []],
      step: 'declareAttackers',
    });
    const arrivingGate = Object.values(gateInGraveyard.state.objects).find(
      (object) => object.card.id === GATE.id,
    )?.oid;
    expect(arrivingGate).toBeDefined();
    if (arrivingGate === undefined) throw new Error('scenario omitted the Gate in the graveyard');
    const arrived = moveObject(beginTrace(gateInGraveyard.state), arrivingGate, 'battlefield').state;
    expect(doors(arrived, oidOf(arrived, JAILBREAKER.name))).toEqual({ offered: true, refusal: null });

    const own = board(0);
    const gate = oidOf(own.state, GATE.name);
    const ownJailbreaker = oidOf(own.state, JAILBREAKER.name);
    const departed = moveObject(beginTrace(own.state), gate, 'graveyard').state;
    expect(eligibleAttackers(departed)).not.toContain(oidOf(departed, JAILBREAKER.name));

    const stolen = withContinuous(own.state, [controlledBy(onlyObject(ownJailbreaker), 1)]);
    expect(eligibleAttackers(stolen)).not.toContain(ownJailbreaker);
  });

  it('does not bypass summoning sickness or an independent attack restriction', () => {
    const sick = board(0, true);
    const sickJailbreaker = oidOf(sick.state, JAILBREAKER.name);
    expect(doors(sick.state, sickJailbreaker)).toEqual({
      offered: false,
      refusal: `${sickJailbreaker} cannot attack`,
    });

    const locked = scenario({
      battlefield: [
        { card: JAILBREAKER, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: GATE, controller: 0 },
        { card: ATTACK_LOCK, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const lockedJailbreaker = oidOf(locked.state, JAILBREAKER.name);
    expect(doors(locked.state, lockedJailbreaker)).toEqual({
      offered: false,
      refusal: `${lockedJailbreaker} cannot attack`,
    });
  });
});
