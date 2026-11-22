import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  stateFingerprint,
  type DamageInstance,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN, planeswalker } from './cards';
import {
  abilities,
  damageToPermanent,
  damageToPlayer,
  onlyObject,
  replacement,
  retype,
  setPt,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { apply, damageOn, handOidOf, oidOf } from './helpers';

const FLIER = creature('M13 Cohort Flier', 2, 8, { keywords: ['flying'] });
const GROUND = creature('M13 Cohort Ground', 2, 8);
const WALKER = planeswalker('M13 Cohort Walker', 8, [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 0,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
]);
const HYBRID_WALKER = planeswalker('M13 Hybrid Cohort Walker', 8, []);

const MAGMAQUAKE = instant(
  'Magmaquake',
  [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'noTarget' },
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
      additionalScopeFilter: { cardTypes: ['planeswalker'] },
    } as Effect,
  ],
  { R: 2, hasX: true },
);

const FURY = instant(
  "Chandra's Fury",
  [
    {
      kind: 'dealDamage',
      amount: 4,
      scopeAmount: 1,
      target: { kind: 'targetPlayerOrPlaneswalker' },
      scope: 'targetAndPermanentsItsPlayerControls',
      scopeFilter: { cardTypes: ['creature'] },
    } as Effect,
  ],
  { generic: 4, R: 1 },
);

const THUNDERMAW = creature('Thundermaw Hellkite', 5, 5, {
  cost: { generic: 3, R: 2 },
  keywords: ['flying', 'haste'],
  subtypes: ['Dragon'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'noTarget' },
          scope: 'permanentsOpponentsControl',
          scopeFilter: { cardTypes: ['creature'], keywords: ['flying'] },
          tapScopeGroup: true,
        },
      ],
    },
  ],
});

const LIFELINK_COHORT_SOURCE = creature('Lifelink Cohort Source', 5, 5, {
  cost: { generic: 3, R: 2 },
  keywords: ['flying', 'haste', 'lifelink'],
  abilities: THUNDERMAW.abilities,
});
const LIFELINK_VICTIM = creature('Lifelink Victim', 2, 8, { keywords: ['flying'] });

function mana(card: Card, count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card, controller }));
}

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 30 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`resolution paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function resolveSpell(from: ReduceResult, spell: ObjectId): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 10 && current.state.stack.some((entry) => entry.oid === spell); guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`resolution paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function moved(from: ReduceResult, oid: ObjectId, destination: 'battlefield' | 'graveyard'): ReduceResult {
  const trace = moveObject(beginTrace(from.state), oid, destination);
  return { state: trace.state, events: [...from.events, ...trace.events] };
}

function cast(from: ReduceResult, card: Card, target: Target | null, x?: number): ReduceResult {
  return apply(from, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, card.name),
    targets: card.kind === 'creature' ? [] : [target],
    ...(x === undefined ? {} : { x }),
  });
}

describe('Magmaquake cohorts', () => {
  it('enumerates both M13 damage instants during an opponent-turn priority window', () => {
    const start = scenario({
      active: 1,
      battlefield: [...mana(MOUNTAIN, 5, 0)],
      hands: [[MAGMAQUAKE, FURY], []],
    });
    const offered = apply(start, { type: 'passPriority', player: 1 });
    const names = legalActions(offered.state)
      .filter((action) => action.type === 'castSpell')
      .map((action) => offered.state.objects[action.oid]?.card.name)
      .filter((name): name is string => name !== undefined);

    expect(names).toContain(MAGMAQUAKE.name);
    expect(names).toContain(FURY.name);
  });

  it('uses live without-flying plus the planeswalker branch in one sweep', () => {
    const start = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 5, 0),
        { card: FLIER, controller: 0 },
        { card: creature('Friendly Ground', 2, 8), controller: 0 },
        { card: GROUND, controller: 1 },
        { card: WALKER, controller: 1 },
      ],
      hands: [[MAGMAQUAKE], []],
    });
    const flier = oidOf(start.state, FLIER.name);
    const ground = oidOf(start.state, GROUND.name);
    const friendlyGround = oidOf(start.state, 'Friendly Ground');
    const walker = oidOf(start.state, WALKER.name);
    const after = resolveStack(cast(start, MAGMAQUAKE, null, 3));

    expect(damageOn(after.state, flier)).toBe(0);
    expect(damageOn(after.state, ground)).toBe(3);
    expect(damageOn(after.state, friendlyGround)).toBe(3);
    expect(after.state.objects[walker]?.counters.loyalty).toBe(5);
    expect(playerOf(after.state, 0).life).toBe(20);
    expect(playerOf(after.state, 1).life).toBe(20);
    expect(
      eventsOfType(after.events, 'damageDealt').map((event) =>
        event.target.kind === 'permanent' ? event.target.oid : null,
      ),
    ).toEqual([friendlyGround, ground, walker]);
  });

  it('reads flying gains and losses from live layer-derived characteristics at resolution', () => {
    const gainStart = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: GROUND, controller: 1 }],
      hands: [[MAGMAQUAKE], []],
    });
    const gainGround = oidOf(gainStart.state, GROUND.name);
    const gainCast = cast(gainStart, MAGMAQUAKE, null, 3);
    const gained: ReduceResult = {
      state: withContinuous(gainCast.state, [abilities(onlyObject(gainGround), { add: ['flying'] })]),
      events: gainCast.events,
    };
    expect(damageOn(resolveStack(gained).state, gainGround)).toBe(0);

    const lossStart = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: FLIER, controller: 1 }],
      hands: [[MAGMAQUAKE], []],
    });
    const lossFlier = oidOf(lossStart.state, FLIER.name);
    const lossCast = cast(lossStart, MAGMAQUAKE, null, 3);
    const lost: ReduceResult = {
      state: withContinuous(lossCast.state, [abilities(onlyObject(lossFlier), { remove: ['flying'] })]),
      events: lossCast.events,
    };
    expect(damageOn(resolveStack(lost).state, lossFlier)).toBe(3);
  });

  it('hits a flying creature-planeswalker through the additional branch', () => {
    const start = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: WALKER, controller: 1 }],
      hands: [[MAGMAQUAKE], []],
    });
    const walker = oidOf(start.state, WALKER.name);
    const layered: ReduceResult = {
      state: withContinuous(start.state, [
        retype(onlyObject(walker), { addTypes: ['creature'] }),
        abilities(onlyObject(walker), { add: ['flying'] }),
        setPt(onlyObject(walker), 4, 4),
      ]),
      events: start.events,
    };
    const after = resolveStack(cast(layered, MAGMAQUAKE, null, 3));

    expect(after.state.objects[walker]?.counters.loyalty).toBe(5);
    expect(
      eventsOfType(after.events, 'damageDealt').filter(
        (event) => event.target.kind === 'permanent' && event.target.oid === walker,
      ),
    ).toHaveLength(1);
  });

  it('dedupes true branch overlap and restores battlefield order after the union', () => {
    const start = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 5, 0),
        { card: WALKER, controller: 1 },
        { card: GROUND, controller: 1 },
        { card: HYBRID_WALKER, controller: 1 },
      ],
      hands: [[MAGMAQUAKE], []],
    });
    const additionalOnly = oidOf(start.state, WALKER.name);
    const primaryOnly = oidOf(start.state, GROUND.name);
    const overlap = oidOf(start.state, HYBRID_WALKER.name);
    const layered: ReduceResult = {
      state: withContinuous(start.state, [
        retype(onlyObject(overlap), { addTypes: ['creature'] }),
        setPt(onlyObject(overlap), 4, 4),
      ]),
      events: start.events,
    };
    const after = resolveStack(cast(layered, MAGMAQUAKE, null, 3));
    const recipients = eventsOfType(after.events, 'damageDealt').map((event) =>
      event.target.kind === 'permanent' ? event.target.oid : null,
    );

    expect(recipients).toEqual([additionalOnly, primaryOnly, overlap]);
    expect(recipients.filter((oid) => oid === overlap)).toHaveLength(1);
    expect(after.state.objects[additionalOnly]?.counters.loyalty).toBe(5);
    expect(after.state.objects[overlap]?.counters.loyalty).toBe(5);
  });

  it('accepts X=0 without manufacturing damage events', () => {
    const start = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 2, 0),
        { card: GROUND, controller: 1 },
        { card: WALKER, controller: 1 },
      ],
      hands: [[MAGMAQUAKE], []],
    });
    const after = resolveStack(cast(start, MAGMAQUAKE, null, 0));
    expect(after.events.filter((event) => event.type === 'damageDealt')).toEqual([]);
  });
});

describe("Chandra's Fury split amount", () => {
  it('deals 4 to the target player and 1 to that player’s creatures in one batch', () => {
    const start = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: GROUND, controller: 1 }, { card: FLIER, controller: 0 }],
      hands: [[FURY], []],
    });
    const theirs = oidOf(start.state, GROUND.name);
    const ours = oidOf(start.state, FLIER.name);
    const after = resolveStack(cast(start, FURY, { kind: 'player', player: 1 }));

    expect(playerOf(after.state, 1).life).toBe(16);
    expect(damageOn(after.state, theirs)).toBe(1);
    expect(damageOn(after.state, ours)).toBe(0);
    expect(after.events.filter((event) => event.type === 'damageDealt')).toHaveLength(2);
  });

  it('uses a planeswalker target’s controller and fizzles if that target leaves', () => {
    const board = (): ReduceResult =>
      scenario({
        battlefield: [
          ...mana(MOUNTAIN, 5, 0),
          { card: WALKER, controller: 1 },
          { card: GROUND, controller: 1 },
        ],
        hands: [[FURY], []],
      });
    const start = board();
    const walker = oidOf(start.state, WALKER.name);
    const ground = oidOf(start.state, GROUND.name);
    const resolved = resolveStack(cast(start, FURY, { kind: 'permanent', oid: walker }));
    expect(resolved.state.objects[walker]?.counters.loyalty).toBe(4);
    expect(damageOn(resolved.state, ground)).toBe(1);

    const fizzleStart = board();
    const fizzleWalker = oidOf(fizzleStart.state, WALKER.name);
    const fizzleGround = oidOf(fizzleStart.state, GROUND.name);
    const gone = moved(
      cast(fizzleStart, FURY, { kind: 'permanent', oid: fizzleWalker }),
      fizzleWalker,
      'graveyard',
    );
    const fizzled = resolveStack(gone);
    expect(damageOn(fizzled.state, fizzleGround)).toBe(0);
    expect(eventsOfType(fizzled.events, 'spellFizzled')).toHaveLength(1);
  });
});

describe('Thundermaw retained cohort', () => {
  it('damages and taps only opposing flyers', () => {
    const start = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 5, 0),
        { card: FLIER, controller: 0 },
        { card: GROUND, controller: 1 },
        { card: creature('Opposing Flier', 2, 8, { keywords: ['flying'] }), controller: 1 },
      ],
      hands: [[THUNDERMAW], []],
    });
    const own = oidOf(start.state, FLIER.name);
    const ground = oidOf(start.state, GROUND.name);
    const opposing = oidOf(start.state, 'Opposing Flier');
    const after = resolveStack(cast(start, THUNDERMAW, null));

    expect(damageOn(after.state, opposing)).toBe(1);
    expect(after.state.objects[opposing]?.tapped).toBe(true);
    expect(damageOn(after.state, own)).toBe(0);
    expect(after.state.objects[own]?.tapped).toBe(false);
    expect(damageOn(after.state, ground)).toBe(0);
    expect(after.state.objects[ground]?.tapped).toBe(false);
  });

  it('taps the original flyer when its damage is prevented or redirected', () => {
    const opened = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 5, 0),
        { card: creature('Shielded Flier', 2, 8, { keywords: ['flying'] }), controller: 1 },
        { card: GROUND, controller: 1 },
      ],
      hands: [[THUNDERMAW], []],
    });
    const flier = oidOf(opened.state, 'Shielded Flier');
    const ground = oidOf(opened.state, GROUND.name);

    const prevented = resolveStack(
      cast(
        {
          state: withReplacements(opened.state, [
            replacement(damageToPermanent(flier), { kind: 'preventDamage', amount: 'all' }),
          ]),
          events: opened.events,
        },
        THUNDERMAW,
        null,
      ),
    );
    expect(damageOn(prevented.state, flier)).toBe(0);
    expect(prevented.state.objects[flier]?.tapped).toBe(true);

    const redirected = resolveStack(
      cast(
        {
          state: withReplacements(opened.state, [
            replacement(damageToPermanent(flier), {
              kind: 'redirectDamage',
              to: { kind: 'permanent', oid: ground },
            }),
          ]),
          events: opened.events,
        },
        THUNDERMAW,
        null,
      ),
    );
    expect(damageOn(redirected.state, flier)).toBe(0);
    expect(redirected.state.objects[flier]?.tapped).toBe(true);
    expect(damageOn(redirected.state, ground)).toBe(1);
    expect(redirected.state.objects[ground]?.tapped).toBe(false);
  });

  it('keeps tapping separate from protection while the simultaneous batch retains lifelink', () => {
    const protectedFlier = creature('Protected Flier', 2, 8, {
      keywords: ['flying'],
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
    });
    const protectedStart = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: protectedFlier, controller: 1 }],
      hands: [[THUNDERMAW], []],
    });
    const protectedOid = oidOf(protectedStart.state, protectedFlier.name);
    const protectedAfter = resolveStack(cast(protectedStart, THUNDERMAW, null));
    expect(damageOn(protectedAfter.state, protectedOid)).toBe(0);
    expect(protectedAfter.state.objects[protectedOid]?.tapped).toBe(true);

    const replay = (): ReduceResult => {
      const start = scenario({
        seed: 'm13-lifelink-cohort-replay',
        life: [10, 20],
        battlefield: [...mana(MOUNTAIN, 5, 0), { card: LIFELINK_VICTIM, controller: 1 }],
        hands: [[LIFELINK_COHORT_SOURCE], []],
      });
      return resolveStack(cast(start, LIFELINK_COHORT_SOURCE, null));
    };
    const first = replay();
    const second = replay();
    expect(playerOf(first.state, 0).life).toBe(11);
    expect(first.events).toEqual(second.events);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });

  it('retains a stacked enters trigger after its source leaves', () => {
    const start = scenario({
      battlefield: [
        ...mana(MOUNTAIN, 5, 0),
        { card: creature('Source Departure Flier', 2, 8, { keywords: ['flying'] }), controller: 1 },
      ],
      hands: [[THUNDERMAW], []],
    });
    const flier = oidOf(start.state, 'Source Departure Flier');
    const spell = handOidOf(start.state, 0, THUNDERMAW.name);
    const entered = resolveSpell(cast(start, THUNDERMAW, null), spell);
    const source = oidOf(entered.state, THUNDERMAW.name);
    expect(entered.state.stack).toHaveLength(1);
    expect(entered.state.stack[0]?.ability?.sourceOid).toBe(source);
    expect(damageOn(entered.state, flier)).toBe(0);
    const departed = moved(entered, source, 'graveyard');
    const after = resolveStack(departed);

    expect(damageOn(after.state, flier)).toBe(1);
    expect(after.state.objects[flier]?.tapped).toBe(true);
  });

  it('taps a lethal cohort member before state-based actions move it', () => {
    const victim = creature('Lethal Flier', 1, 1, { keywords: ['flying'] });
    const start = scenario({
      battlefield: [...mana(MOUNTAIN, 5, 0), { card: victim, controller: 1 }],
      hands: [[THUNDERMAW], []],
    });
    const flier = oidOf(start.state, victim.name);
    const after = resolveStack(cast(start, THUNDERMAW, null));
    const tappedAt = after.events.findIndex(
      (event) => event.type === 'permanentTapped' && event.oid === flier,
    );
    const diedAt = after.events.findIndex(
      (event) => event.type === 'zoneChanged' && event.oid === flier && event.to === 'graveyard',
    );
    expect(tappedAt).toBeGreaterThanOrEqual(0);
    expect(diedAt).toBeGreaterThan(tappedAt);
  });

  it('banks taps across CR 615.7 and skips a departed or new incarnation', () => {
    const firstSource = creature('First Prevention Source', 2, 2);
    const secondSource = creature('Second Prevention Source', 2, 2);
    const cohort = creature('Paused Cohort Flier', 2, 8, { keywords: ['flying'] });
    const opened = scenario({
      battlefield: [
        { card: firstSource, controller: 1 },
        { card: secondSource, controller: 1 },
        { card: cohort, controller: 1 },
      ],
    });
    const first = oidOf(opened.state, firstSource.name);
    const second = oidOf(opened.state, secondSource.name);
    const flier = oidOf(opened.state, cohort.name);
    const shielded = withReplacements(opened.state, [
      replacement(damageToPlayer(0), { kind: 'preventDamage', amount: 3 }),
    ]);
    const damage = (sourceOid: ObjectId): DamageInstance => ({
      sourceOid,
      controller: 1,
      recipient: { kind: 'player', player: 0 },
      amount: 2,
      deathtouch: false,
      lifelink: false,
      combat: false,
      preventable: true,
    });
    const paused = applyDamage(beginTrace(shielded), [damage(first), damage(second)]);
    const pending = paused.state.pendingDamagePrevention;
    if (pending === undefined) throw new Error('the prevention allocation did not pause');
    const retained = { oid: flier, incarnation: paused.state.objects[flier]?.incarnation ?? 0 };
    const banked = {
      ...paused.state,
      pendingDamagePrevention: { ...pending, postDamageTaps: [retained] },
    };
    expect(stateFingerprint(structuredClone(banked))).toBe(stateFingerprint(banked));

    const returned = moveObject(moveObject(beginTrace(banked), flier, 'graveyard'), flier, 'battlefield');
    const decision = pendingDecision(returned.state);
    if (decision?.kind !== 'damagePrevention') throw new Error('the allocation decision was lost');
    const answer = decision.options.find(
      (option) => option.type === 'allocateDamagePrevention' && option.amount === 2,
    );
    if (answer === undefined) throw new Error('the allocation offered no two-point choice');
    const completed = reduce(returned.state, answer);

    expect(completed.state.pendingDamagePrevention).toBeUndefined();
    expect(completed.state.objects[flier]?.tapped).toBe(false);
    expect(completed.state.players[0].life).toBe(19);
  });
});
