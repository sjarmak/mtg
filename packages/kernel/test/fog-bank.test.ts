/** Fog Bank's live, permanent-scoped CR 615 combat-damage prevention. */
import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  moveObject,
  objectFilter,
  onlyObject,
  scenario,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReplacementEffect,
} from '@mtg/kernel';
import { abilities, controlledBy, copies, withContinuous } from './continuous-helpers';
import { creature } from './cards';
import { damageOn, inGraveyard, oidOf, playCombat } from './helpers';

const FOG_BANK = creature('Fog Bank', 0, 2, {
  cost: { generic: 1, U: 1 },
  keywords: ['flying'],
  keywordAbilities: [{ kind: 'defender' }],
  subtypes: ['Wall'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'preventCombatDamage' },
    },
  ],
});

const MIRROR_BANK = creature('Mirror Bank', 2, 4, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'preventCombatDamage' },
    },
  ],
});

const BRUTE = creature('Test Brute', 5, 5, {
  keywords: ['trample', 'lifelink', 'deathtouch'],
});
const BEAR = creature('Runeclaw Bear', 2, 2);
const BLANK = creature('Blank Wall', 0, 4);

function damage(
  sourceOid: ObjectId,
  recipient: DamageInstance['recipient'],
  combat: boolean,
  preventable = true,
): DamageInstance {
  return {
    sourceOid,
    controller: 0,
    recipient,
    amount: 2,
    deathtouch: false,
    lifelink: false,
    combat,
    preventable,
  };
}

function bankBoard(card = MIRROR_BANK): {
  readonly state: GameState;
  readonly bank: ObjectId;
  readonly bear: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card, controller: 0 },
      { card: BEAR, controller: 1 },
    ],
  });
  return {
    state: start.state,
    bank: oidOf(start.state, card.name),
    bear: oidOf(start.state, BEAR.name),
  };
}

function redirectDamage(
  sourceOid: ObjectId,
  trigger: Extract<ReplacementEffect['trigger'], { kind: 'damage' }>,
  to: Extract<ReplacementEffect['modification'], { kind: 'redirectDamage' }>['to'],
): ReplacementEffect {
  return {
    id: 'fog-bank-test-redirect',
    sourceOid,
    controller: 0,
    timestamp: 0,
    duration: 'permanent',
    selfReplacement: false,
    trigger,
    modification: { kind: 'redirectDamage', to },
  };
}

describe('Fog Bank combat-damage prevention', () => {
  it('prevents combat damage both to and by the scoped permanent but not noncombat damage', () => {
    const { state, bank, bear } = bankBoard();
    const done = applyDamage(beginTrace(state), [
      damage(bear, { kind: 'permanent', oid: bank }, true),
      damage(bank, { kind: 'permanent', oid: bear }, true),
      damage(bear, { kind: 'permanent', oid: bank }, false),
      damage(bank, { kind: 'player', player: 1 }, false),
    ]);

    expect(damageOn(done.state, bank)).toBe(2);
    expect(damageOn(done.state, bear)).toBe(0);
    expect(done.state.players[1].life).toBe(18);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(2);
  });

  it('does not prevent combat damage explicitly marked unpreventable', () => {
    const { state, bank, bear } = bankBoard();
    const done = applyDamage(beginTrace(state), [
      damage(bear, { kind: 'permanent', oid: bank }, true, false),
      damage(bank, { kind: 'permanent', oid: bear }, true, false),
    ]);

    expect(damageOn(done.state, bank)).toBe(2);
    expect(damageOn(done.state, bear)).toBe(2);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
  });

  it('prevents only the trample share assigned to Fog Bank and grants lifelink only for damage dealt', () => {
    const start = scenario({
      battlefield: [
        { card: BRUTE, controller: 0 },
        { card: FOG_BANK, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const brute = oidOf(start.state, BRUTE.name);
    const bank = oidOf(start.state, FOG_BANK.name);
    const done = playCombat(start, {
      attackers: [brute],
      blocks: [{ blocker: bank, attacker: brute }],
    });

    // Deathtouch makes one point lethal, so four trample over and lifelink.
    expect(done.state.players[0].life).toBe(24);
    expect(done.state.players[1].life).toBe(16);
    expect(damageOn(done.state, bank)).toBe(0);
    expect(inGraveyard(done.state, bank)).toBe(false);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(1);
  });

  it('reads the current layer-6 ability set instead of retaining an entry-time shield', () => {
    const { state, bank, bear } = bankBoard();
    const silenced = withContinuous(state, [
      abilities(onlyObject(bank), { removeAll: true }, { source: bear, ts: state.nextId }),
    ]);
    const done = applyDamage(beginTrace(silenced), [
      damage(bear, { kind: 'permanent', oid: bank }, true),
      damage(bank, { kind: 'permanent', oid: bear }, true),
    ]);

    expect(damageOn(done.state, bank)).toBe(2);
    expect(damageOn(done.state, bear)).toBe(2);
  });

  it('follows a layer-1 copy without registering a stale replacement on entry', () => {
    const start = scenario({
      battlefield: [
        { card: MIRROR_BANK, controller: 0 },
        { card: BLANK, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
    });
    const source = oidOf(start.state, MIRROR_BANK.name);
    const copy = oidOf(start.state, BLANK.name);
    const bear = oidOf(start.state, BEAR.name);
    const copied = withContinuous(start.state, [copies(objectFilter({ oids: [copy] }), source)]);
    const done = applyDamage(beginTrace(copied), [
      damage(bear, { kind: 'permanent', oid: copy }, true),
      damage(copy, { kind: 'permanent', oid: bear }, true),
    ]);

    expect(damageOn(done.state, copy)).toBe(0);
    expect(damageOn(done.state, bear)).toBe(0);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(2);
  });

  it('reads layer-2 control without losing the self-scoped prevention ability', () => {
    const { state, bank, bear } = bankBoard();
    const changed = withContinuous(state, [controlledBy(onlyObject(bank), 1)]);
    const done = applyDamage(beginTrace(changed), [
      damage(bear, { kind: 'permanent', oid: bank }, true),
      damage(bank, { kind: 'permanent', oid: bear }, true),
    ]);

    expect(damageOn(done.state, bank)).toBe(0);
    expect(damageOn(done.state, bear)).toBe(0);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(2);
  });

  it('rechecks recipient scope after redirects while retaining source-scoped prevention', () => {
    const { state, bank, bear } = bankBoard();
    const damageTrigger = {
      kind: 'damage' as const,
      toPlayer: null,
      toPermanent: bank,
      toController: null,
      toPermanentCardType: null,
      fromSource: null,
      fromSpellSource: null,
      combatOnly: false,
    };
    const redirectedOut = {
      ...state,
      replacements: [
        ...state.replacements,
        redirectDamage(bear, damageTrigger, { kind: 'player', player: 1 }),
      ],
    };
    const external = applyDamage(beginTrace(redirectedOut), [
      damage(bear, { kind: 'permanent', oid: bank }, true),
    ]);
    const sourceScoped = applyDamage(beginTrace(redirectedOut), [
      damage(bank, { kind: 'permanent', oid: bank }, true),
    ]);

    expect(external.state.players[1].life).toBe(18);
    expect(eventsOfType(external.events, 'damagePrevented')).toEqual([]);
    expect(sourceScoped.state.players[1].life).toBe(20);
    expect(eventsOfType(sourceScoped.events, 'damagePrevented')).toHaveLength(1);

    const redirectedIn = {
      ...state,
      replacements: [
        ...state.replacements,
        redirectDamage(
          bear,
          { ...damageTrigger, toPlayer: 1, toPermanent: null },
          { kind: 'permanent', oid: bank },
        ),
      ],
    };
    const incoming = applyDamage(beginTrace(redirectedIn), [
      damage(bear, { kind: 'player', player: 1 }, true),
    ]);
    expect(incoming.state.players[1].life).toBe(20);
    expect(damageOn(incoming.state, bank)).toBe(0);
    expect(eventsOfType(incoming.events, 'damagePrevented')).toHaveLength(1);
  });

  it('retains no entry-time prevention after the source leaves the battlefield', () => {
    const { state, bank, bear } = bankBoard();
    const departed = moveObject(beginTrace(state), bank, 'graveyard');
    const done = applyDamage(departed, [damage(bank, { kind: 'permanent', oid: bear }, true)]);

    expect(damageOn(done.state, bear)).toBe(2);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
  });
});
