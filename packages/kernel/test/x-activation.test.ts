/**
 * CR 602.2b: an activation announces X the way a cast does, and the value is
 * paid, banked on the stack entry, and read at resolution.
 *
 * `x-mana.test.ts` is this suite one card type out, and the two are deliberately
 * parallel — the ability's X travels in the same action field, lands in the same
 * `StackEntry.x`, and reaches the same `chosenX` amount. Silklash Spider
 * (`{X}{G}{G}: This creature deals X damage to each creature with flying`) is
 * the printing `mtg-nhyv.17` was opened for; the archer below is the same shape
 * aimed at one target, because a sweep that filters on a keyword is a separate
 * gap in the effect vocabulary and this lane is about the announcement.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ReduceResult } from '@mtg/kernel';
import { eventsOfType, legalActions, MAX_CHOSEN_X, reduce, scenario, stateFingerprint } from '@mtg/kernel';
import { creature, lands, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

/** `{X}{R}, {T}: Emberspine Archer deals X damage to any target.` */
const ARCHER = creature('Emberspine Archer', 2, 2, {
  cost: { generic: 2, R: 1 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { R: 1, hasX: true }, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
    },
  ],
});

/** The same archer with the X taken out of its cost: `{1}{R}, {T}: … 1 damage.` */
const FIXED = creature('Steady Archer', 2, 2, {
  cost: { generic: 2, R: 1 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, R: 1 }, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
  ],
});

function board(card = ARCHER, mountains = 4): ReduceResult {
  return scenario({
    battlefield: [
      { card, controller: 0 },
      ...lands(MOUNTAIN, mountains).map((land) => ({ card: land, controller: 0 as const })),
    ],
  });
}

/**
 * How wide one archer's activation list is on the default board.
 *
 * `oneAbilityOptions` bounds an ability's whole product — announced X by target
 * — with the cap it is given, and it is announced X that this file is about.
 * Four mountains pay X=0 through X=3 while `anyTarget` names both players and
 * the one creature on the board, so twelve is a fact about the fixture. Stated
 * rather than inherited from `DEFAULT_ENUMERATION_CAP`, which is one global
 * constant over every enumeration in the kernel and is set for combat.
 */
const ARCHER_ACTIVATIONS = 4 * 3;

function activations(
  from: ReduceResult,
  cap = ARCHER_ACTIVATIONS,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(from.state, cap).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> => action.type === 'activateAbility',
  );
}

function activate(from: ReduceResult, x: number, name = ARCHER.name): ReduceResult {
  return apply(from, {
    type: 'activateAbility',
    player: 0,
    oid: oidOf(from.state, name),
    abilityIndex: 0,
    targets: [{ kind: 'player', player: 1 }],
    sacrifices: [],
    x,
  });
}

function resolve(from: ReduceResult): ReduceResult {
  return apply(apply(from, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
}

describe('announcing X to activate an ability', () => {
  it('enumerates X=0 through the largest payable value, aimed at each target', () => {
    const aimedAtOpponent = activations(board()).filter(
      (action) => action.targets[0]?.kind === 'player' && action.targets[0].player === 1,
    );
    expect(aimedAtOpponent.map((action) => action.x)).toEqual([0, 1, 2, 3]);
    expect(activations(board())).toEqual(activations(board()));
  });

  it('offers only X=0 when the pips leave nothing over, and nothing at all when they do not fit', () => {
    expect(activations(board(ARCHER, 1)).map((action) => action.x)).toEqual([0, 0, 0]);
    expect(activations(board(ARCHER, 0))).toEqual([]);
  });

  it('charges the announced value: the cost the payment materializes grows with X', () => {
    const paidFor = (x: number): unknown =>
      eventsOfType(activate(board(), x).events, 'manaPaid').at(-1)?.cost;
    expect(paidFor(0)).toMatchObject({ generic: 0, R: 1, hasX: false });
    expect(paidFor(3)).toMatchObject({ generic: 3, R: 1, hasX: false });
  });

  it('banks the announcement on the stack entry and reports it in the event', () => {
    const current = activate(board(), 3);
    expect(current.state.stack.at(-1)?.x).toBe(3);
    expect(eventsOfType(current.events, 'abilityActivated').at(-1)?.chosenX).toBe(3);
  });

  it('resolves two different announcements into two different outcomes', () => {
    expect(resolve(activate(board(), 1)).state.players[1].life).toBe(19);
    expect(resolve(activate(board(), 3)).state.players[1].life).toBe(17);
  });

  it('makes X=0 a real announcement rather than a missing one', () => {
    expect(resolve(activate(board(), 0)).state.players[1].life).toBe(20);
  });

  it('separates two announcements in the state fingerprint', () => {
    expect(stateFingerprint(activate(board(), 1).state)).not.toBe(
      stateFingerprint(activate(board(), 2).state),
    );
  });
});

describe('what an announcement may not be', () => {
  const submit = (x: number | undefined, mountains = 4): (() => unknown) => {
    const start = board(ARCHER, mountains);
    const action: Action = {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(start.state, ARCHER.name),
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
      ...(x === undefined ? {} : { x }),
    };
    return () => reduce(start.state, action);
  };

  it('rejects missing, negative, fractional, over-cap and unaffordable values', () => {
    expect(submit(undefined)).toThrow(/needs an announced X/);
    expect(submit(-1)).toThrow(/X must be an integer/);
    expect(submit(1.5)).toThrow(/X must be an integer/);
    expect(submit(MAX_CHOSEN_X + 1)).toThrow(/X must be an integer/);
    expect(submit(4)).toThrow(/cannot pay the mana cost/);
  });

  it('rejects an announcement on an ability whose cost prints no X', () => {
    expect(() => activate(board(FIXED), 0, FIXED.name)).toThrow(/no X to announce/);
  });
});
