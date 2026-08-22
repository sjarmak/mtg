/**
 * A mana ability that is not a land, and a ritual that is not a permanent.
 *
 * The kernel had exactly one mana source before this: `produceMana` tapped a
 * land for one mana of one printed color, and `manaAbilityOptions` enumerated
 * nothing else. Everything a core set builds its curve on — Llanowar Elves, a
 * Sol Ring, a dual mana ability, Dark Ritual — was outside the engine.
 *
 * The assertions here are about the *pool*, not about validation. A test that
 * proves the effect parses proves nothing about whether a player can spend what
 * it added, and spending it is the whole feature: every one of these ends
 * either with a count in `playerOf(state, player).pool` or with a spell paid for
 * out of it.
 *
 * Two structural claims are asserted alongside the arithmetic, because both are
 * rules rather than conveniences. CR 605.3a: a mana ability does not use the
 * stack, so it is never offered as an `activateAbility` — the enumeration and
 * `validateAction` both refuse that route and `activateManaAbility` is the only
 * door. CR 302.6: the `{T}` in the cost is a tap symbol like any other, so
 * summoning sickness stops a creature's mana ability exactly as it stops its
 * attack.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Amount } from '@mtg/dsl';
import type { Action, GameState, ManaPool } from '@mtg/kernel';
import { legalActions, playerOf, reduce, reduceAll, scenario, validateAction } from '@mtg/kernel';
import { artifact, creature, instant, MOUNTAIN, sorcery, SWAMP } from './cards';
import { handOidOf, oidOf } from './helpers';

const SWAMP_COUNT: Amount = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' };

/** `{T}: Add {G}.` */
const TAP_FOR_GREEN: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
};

/** `{T}: Add {C}{C}.` — one tap, two mana. */
const TAP_FOR_TWO: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['C'], amount: 2 }],
};

/** `{T}: Add {W} or {U}.` — the color is chosen as the ability is activated. */
const TAP_FOR_EITHER: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['W', 'U'], amount: 1 }],
};

/** `{2}, {T}: Add {B} for each Swamp you control.` */
const COFFERS: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 2 }, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['B'], amount: SWAMP_COUNT }],
};

function mystic(): ReturnType<typeof creature> {
  return creature('Thicket Mystic', 1, 1, { cost: { G: 1 }, abilities: [TAP_FOR_GREEN] });
}

function pool(state: GameState, player: 0 | 1): ManaPool {
  return playerOf(state, player).pool;
}

function manaActions(state: GameState): readonly Extract<Action, { type: 'activateManaAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateManaAbility' }> =>
      action.type === 'activateManaAbility',
  );
}

function passBoth(state: GameState): GameState {
  return reduceAll(state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]).state;
}

describe('a creature that taps for mana', () => {
  it('puts the mana in its controller pool and pays a spell out of it', () => {
    const gift = instant('Verdant Gift', [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }], {
      G: 1,
    });
    const start = scenario({
      battlefield: [{ card: mystic(), controller: 0 }],
      hands: [[gift], []],
    }).state;

    const oid = oidOf(start, 'Thicket Mystic');
    const tapped = reduce(start, { type: 'activateManaAbility', player: 0, oid, color: 'G' });
    expect(pool(tapped.state, 0).G).toBe(1);
    expect(tapped.state.objects[oid]?.tapped).toBe(true);

    const spell = handOidOf(tapped.state, 0, 'Verdant Gift');
    const cast = reduce(tapped.state, { type: 'castSpell', player: 0, oid: spell, targets: [null] });
    expect(pool(cast.state, 0).G).toBe(0);
    expect(playerOf(passBoth(cast.state), 0).life).toBe(23);
  });

  it('is offered as a mana ability and never as a spell on the stack', () => {
    const start = scenario({ battlefield: [{ card: mystic(), controller: 0 }] }).state;
    const oid = oidOf(start, 'Thicket Mystic');

    expect(manaActions(start)).toContainEqual({
      type: 'activateManaAbility',
      player: 0,
      oid,
      color: 'G',
    });
    const stacked = legalActions(start).filter((action) => action.type === 'activateAbility');
    expect(stacked).toEqual([]);
    expect(
      validateAction(start, {
        type: 'activateAbility',
        player: 0,
        oid,
        abilityIndex: 0,
        targets: [],
        sacrifices: [],
      }),
    ).not.toBeNull();
  });

  it('is stopped by summoning sickness, the way an attack is', () => {
    const start = scenario({
      battlefield: [{ card: mystic(), controller: 0, summoningSick: true }],
    }).state;
    const oid = oidOf(start, 'Thicket Mystic');

    expect(manaActions(start)).toEqual([]);
    expect(validateAction(start, { type: 'activateManaAbility', player: 0, oid, color: 'G' })).not.toBeNull();
  });

  it('is not stopped by summoning sickness when the creature has haste', () => {
    const hasty = creature('Hasty Mystic', 1, 1, {
      cost: { G: 1 },
      keywords: ['haste'],
      abilities: [TAP_FOR_GREEN],
    });
    const start = scenario({
      battlefield: [{ card: hasty, controller: 0, summoningSick: true }],
    }).state;
    const oid = oidOf(start, 'Hasty Mystic');
    const tapped = reduce(start, { type: 'activateManaAbility', player: 0, oid, color: 'G' });
    expect(pool(tapped.state, 0).G).toBe(1);
  });
});

describe('a mana ability that adds more than one', () => {
  it('adds the printed quantity from a single tap', () => {
    const ring = artifact('Sun Ring', { generic: 1 }, [TAP_FOR_TWO]);
    const start = scenario({ battlefield: [{ card: ring, controller: 0 }] }).state;
    const oid = oidOf(start, 'Sun Ring');
    const tapped = reduce(start, { type: 'activateManaAbility', player: 0, oid, color: 'C' });
    expect(pool(tapped.state, 0).C).toBe(2);
  });

  it('reads a counted amount off the board as it stands', () => {
    const keeper = creature('Coffer Keeper', 1, 3, { cost: { generic: 2, B: 1 }, abilities: [COFFERS] });
    const start = scenario({
      battlefield: [
        { card: keeper, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        // The opponent's Swamps are not counted by `whose: 'you'`.
        { card: SWAMP, controller: 1 },
      ],
    }).state;
    const oid = oidOf(start, 'Coffer Keeper');
    const tapped = reduce(start, { type: 'activateManaAbility', player: 0, oid, color: 'B' });
    // Two of the four Swamps paid the {2}, and four is what the effect counted:
    // the cost is paid before the ability resolves, and a tapped Swamp is still
    // a Swamp you control.
    expect(pool(tapped.state, 0).B).toBe(4);
  });
});

describe('a mana ability that offers a choice of colors', () => {
  it('enumerates one activation per color and adds the one chosen', () => {
    const prism = artifact('Tidal Prism', { generic: 2 }, [TAP_FOR_EITHER]);
    const start = scenario({ battlefield: [{ card: prism, controller: 0 }] }).state;
    const oid = oidOf(start, 'Tidal Prism');

    expect(manaActions(start).map((action) => action.color)).toEqual(['W', 'U']);

    const blue = reduce(start, { type: 'activateManaAbility', player: 0, oid, color: 'U' });
    expect(pool(blue.state, 0).U).toBe(1);
    expect(pool(blue.state, 0).W).toBe(0);
    expect(validateAction(start, { type: 'activateManaAbility', player: 0, oid, color: 'R' })).not.toBeNull();
  });
});

describe('a ritual', () => {
  it('adds several mana as a spell resolves, and the mana is spendable', () => {
    const rite = sorcery('Shadow Rite', [{ kind: 'addMana', produces: ['B'], amount: 3 }], { B: 1 });
    const bomb = sorcery('Grave Bloom', [{ kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } }], {
      B: 3,
    });
    const start = scenario({
      battlefield: [{ card: SWAMP, controller: 0 }],
      hands: [[rite, bomb], []],
    }).state;

    const riteOid = handOidOf(start, 0, 'Shadow Rite');
    const cast = reduce(start, { type: 'castSpell', player: 0, oid: riteOid, targets: [null] });
    const resolved = passBoth(cast.state);
    expect(pool(resolved, 0).B).toBe(3);

    const bombOid = handOidOf(resolved, 0, 'Grave Bloom');
    const paid = reduce(resolved, { type: 'castSpell', player: 0, oid: bombOid, targets: [null] });
    expect(pool(paid.state, 0).B).toBe(0);
    expect(playerOf(passBoth(paid.state), 0).life).toBe(25);
  });
});

describe('an amount counted across the table', () => {
  it('counts what the opponent controls, not the caster', () => {
    const strike = sorcery(
      'Reprisal',
      [
        {
          kind: 'dealDamage',
          amount: { kind: 'countMatchingOpponent', filter: { cardTypes: ['creature'] } },
          target: { kind: 'targetOpponent' },
        },
      ],
      { generic: 1, R: 1 },
    );
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: creature('Ally', 1, 1), controller: 0 },
        { card: creature('Foe One', 1, 1), controller: 1 },
        { card: creature('Foe Two', 2, 2), controller: 1 },
        { card: creature('Foe Three', 3, 3), controller: 1 },
      ],
      hands: [[strike], []],
    }).state;

    const oid = handOidOf(start, 0, 'Reprisal');
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(playerOf(passBoth(cast.state), 1).life).toBe(17);
  });
});
