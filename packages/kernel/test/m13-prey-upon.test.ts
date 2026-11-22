/** Native two-target fight execution for M13 #181. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  onlyObject,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { controlledBy, pump, withContinuous } from './continuous-helpers';
import { inGraveyard, oidOf } from './helpers';

const PREY_UPON = parseCard({
  kind: 'sorcery',
  id: 'm13-prey-upon',
  name: 'Prey Upon',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 181 },
  manaCost: { G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'fight',
      fighter: { kind: 'targetCreatureYouControl' },
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
} as CardInput);

function forest(count: number): readonly { card: typeof FOREST; controller: 0 }[] {
  return lands(FOREST, count).map((card) => ({ card, controller: 0 as const }));
}

function setup() {
  return scenario({
    battlefield: [
      ...forest(1),
      { card: creature('Chosen Hunter', 3, 3), controller: 0 },
      { card: creature('Other Ally', 1, 1), controller: 0 },
      { card: creature('Chosen Quarry', 3, 3), controller: 1 },
      { card: creature('Other Enemy', 1, 1), controller: 1 },
      {
        card: creature('Untargetable Enemy', 1, 1, {
          keywordAbilities: [{ kind: 'hexproof' }],
        }),
        controller: 1,
      },
    ],
    hands: [[PREY_UPON], []],
  });
}

type TestState = ReturnType<typeof setup>['state'];

function targetKeys(state: TestState): readonly string[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'pluralTargets') throw new Error('Prey Upon did not stage its targets');
  return decision.options.flatMap((action) =>
    action.type === 'choosePluralTarget' && action.target?.kind === 'permanent'
      ? [state.objects[action.target.oid]?.card.name ?? 'missing']
      : [],
  );
}

function castPrey(state: TestState, fighter: string, target: string) {
  const spell = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === PREY_UPON.name);
  if (spell === undefined) throw new Error('Prey Upon is not in hand');
  return reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: spell,
    targets: [null],
    multiTargets: {
      0: [
        { kind: 'permanent', oid: oidOf(state, fighter) },
        { kind: 'permanent', oid: oidOf(state, target) },
      ],
    },
  });
}

function resolveTop(state: TestState) {
  return reduceAll(state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
}

describe('Prey Upon target tuple', () => {
  it('asks first for a creature you control and then for one you do not control', () => {
    const start = setup();
    const spell = start.state.players[0].hand[0];
    if (spell === undefined) throw new Error('Prey Upon is not in hand');
    const begun = reduce(start.state, {
      type: 'beginCastSpell',
      player: 0,
      oid: spell,
      targets: [null],
    });

    expect(targetKeys(begun.state)).toEqual(['Chosen Hunter', 'Other Ally']);
    const first = pendingDecision(begun.state)?.options.find(
      (action) =>
        action.type === 'choosePluralTarget' &&
        action.target?.kind === 'permanent' &&
        begun.state.objects[action.target.oid]?.card.name === 'Chosen Hunter',
    );
    if (first === undefined) throw new Error('the chosen fighter was not offered');
    const choseFighter = reduce(begun.state, first);

    expect(targetKeys(choseFighter.state)).toEqual(['Chosen Quarry', 'Other Enemy']);
  });

  it('validates a replacement quarry in its second ordered target space', () => {
    const start = setup();
    const cast = castPrey(start.state, 'Chosen Hunter', 'Chosen Quarry');
    const entry = cast.state.stack.at(-1);
    if (entry === undefined) throw new Error('Prey Upon was not put on the stack');
    const awaiting: TestState = {
      ...cast.state,
      turn: { ...cast.state.turn, priority: null, awaiting: 'spellTargets', awaitingPlayer: 0 },
      pendingSpellTargets: {
        player: 0,
        spell: entry.oid,
        operation: 'changeSpellTargets',
        sourceOid: entry.oid,
        controller: 0,
        remaining: [],
        x: null,
        objectToGraveyard: null,
        tally: { exiled: 0, exiledPermanents: 0, damage: 0, lifeLost: 0 },
        deferredTriggers: [],
      },
    };

    expect(
      validateAction(awaiting, {
        type: 'chooseSpellTargets',
        player: 0,
        oid: entry.oid,
        targets: [null],
        multiTargets: {
          0: [
            { kind: 'permanent', oid: oidOf(awaiting, 'Chosen Hunter') },
            { kind: 'permanent', oid: oidOf(awaiting, 'Other Enemy') },
          ],
        },
      }),
    ).toBeNull();
    expect(
      validateAction(awaiting, {
        type: 'chooseSpellTargets',
        player: 0,
        oid: entry.oid,
        targets: [null],
        multiTargets: {
          0: [
            { kind: 'permanent', oid: oidOf(awaiting, 'Chosen Quarry') },
            { kind: 'permanent', oid: oidOf(awaiting, 'Chosen Hunter') },
          ],
        },
      }),
    ).toContain('not legal');
  });

  it('deals both current powers simultaneously', () => {
    const start = setup();
    const hunter = oidOf(start.state, 'Chosen Hunter');
    const quarry = oidOf(start.state, 'Chosen Quarry');
    const done = resolveTop(castPrey(start.state, 'Chosen Hunter', 'Chosen Quarry').state);

    expect(eventsOfType(done.events, 'damageDealt').map((event) => event.amount)).toEqual([3, 3]);
    expect(inGraveyard(done.state, hunter)).toBe(true);
    expect(inGraveyard(done.state, quarry)).toBe(true);
  });

  it('reads both current powers once when the fight resolves', () => {
    const start = setup();
    const hunter = oidOf(start.state, 'Chosen Hunter');
    const quarry = oidOf(start.state, 'Chosen Quarry');
    const cast = castPrey(start.state, 'Chosen Hunter', 'Chosen Quarry');
    const changed = withContinuous(cast.state, [
      pump(onlyObject(hunter), 2, 1),
      pump(onlyObject(quarry), 1, 3),
    ]);
    const done = resolveTop(changed);

    expect(eventsOfType(done.events, 'damageDealt').map((event) => event.amount)).toEqual([5, 4]);
    expect(inGraveyard(done.state, hunter)).toBe(true);
    expect(done.state.objects[quarry]?.damage).toBe(5);
  });

  it('rechecks control independently and resolves without a fight when one target changes sides', () => {
    const start = setup();
    const hunter = oidOf(start.state, 'Chosen Hunter');
    const cast = castPrey(start.state, 'Chosen Hunter', 'Chosen Quarry');
    const stolen = withContinuous(cast.state, [controlledBy(onlyObject(hunter), 1)]);
    const done = resolveTop(stolen);

    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
    expect(eventsOfType(done.events, 'spellFizzled')).toEqual([]);
  });

  it('partially fails when one target departs and fizzles only when both are gone', () => {
    const oneStart = setup();
    const oneCast = castPrey(oneStart.state, 'Chosen Hunter', 'Chosen Quarry');
    const quarry = oidOf(oneCast.state, 'Chosen Quarry');
    const oneGone = moveObject(beginTrace(oneCast.state), quarry, 'graveyard');
    const partial = resolveTop(oneGone.state);

    expect(eventsOfType(partial.events, 'damageDealt')).toEqual([]);
    expect(eventsOfType(partial.events, 'spellFizzled')).toEqual([]);

    const bothStart = setup();
    const bothCast = castPrey(bothStart.state, 'Chosen Hunter', 'Chosen Quarry');
    const hunter = oidOf(bothCast.state, 'Chosen Hunter');
    const secondQuarry = oidOf(bothCast.state, 'Chosen Quarry');
    const firstGone = moveObject(beginTrace(bothCast.state), hunter, 'graveyard');
    const bothGone = moveObject(firstGone, secondQuarry, 'graveyard');
    const fizzled = resolveTop(bothGone.state);

    expect(eventsOfType(fizzled.events, 'damageDealt')).toEqual([]);
    expect(eventsOfType(fizzled.events, 'spellFizzled')).toHaveLength(1);
  });
});

describe('Prey Upon damage semantics', () => {
  it('carries deathtouch and lifelink from the targeted fighter', () => {
    const hunter = creature('Venom Hunter', 1, 5, { keywords: ['deathtouch', 'lifelink'] });
    const quarry = creature('Massive Quarry', 3, 8);
    const start = scenario({
      battlefield: [...forest(1), { card: hunter, controller: 0 }, { card: quarry, controller: 1 }],
      hands: [[PREY_UPON], []],
    });
    const done = resolveTop(castPrey(start.state, hunter.name, quarry.name).state);

    expect(inGraveyard(done.state, oidOf(start.state, quarry.name))).toBe(true);
    expect(inGraveyard(done.state, oidOf(start.state, hunter.name))).toBe(false);
    expect(done.state.players[0].life).toBe(21);
  });

  it('lets protection prevent only the damage from the protected color', () => {
    const hunter = creature('Protected Hunter', 2, 5, {
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
    });
    const quarry = creature('Red Quarry', 3, 5, { cost: { R: 1 } });
    const start = scenario({
      battlefield: [...forest(1), { card: hunter, controller: 0 }, { card: quarry, controller: 1 }],
      hands: [[PREY_UPON], []],
    });
    const done = resolveTop(castPrey(start.state, hunter.name, quarry.name).state);
    const hunterOid = oidOf(start.state, hunter.name);
    const quarryOid = oidOf(start.state, quarry.name);

    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([
      expect.objectContaining({ amount: 3, target: { kind: 'permanent', oid: hunterOid } }),
    ]);
    expect(done.state.objects[hunterOid]?.damage).toBe(0);
    expect(done.state.objects[quarryOid]?.damage).toBe(2);
  });

  it('honors a targeted prevention shield without suppressing the other direction', () => {
    const shield = instant('Fight Shield', [
      { kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } },
    ]);
    const hunter = creature('Shielded Hunter', 2, 5);
    const quarry = creature('Shield Quarry', 3, 5);
    const start = scenario({
      battlefield: [...forest(2), { card: hunter, controller: 0 }, { card: quarry, controller: 1 }],
      hands: [[shield, PREY_UPON], []],
    });
    const shieldOid = start.state.players[0].hand.find(
      (oid) => start.state.objects[oid]?.card.name === shield.name,
    );
    if (shieldOid === undefined) throw new Error('the shield is not in hand');
    const hunterOid = oidOf(start.state, hunter.name);
    const quarryOid = oidOf(start.state, quarry.name);
    const shielded = resolveTop(
      reduce(start.state, {
        type: 'castSpell',
        player: 0,
        oid: shieldOid,
        targets: [{ kind: 'permanent', oid: hunterOid }],
      }).state,
    );
    const done = resolveTop(castPrey(shielded.state, hunter.name, quarry.name).state);

    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([
      expect.objectContaining({ amount: 3, target: { kind: 'permanent', oid: hunterOid } }),
    ]);
    expect(done.state.objects[hunterOid]?.damage).toBe(0);
    expect(done.state.objects[quarryOid]?.damage).toBe(2);
  });
});
