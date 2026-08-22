/**
 * The three back-references, run rather than read (`mtg-nhyv.75`).
 *
 * `targetChoicesForEffects` is an `effects.map`, so before the referent kinds
 * every effect on a card chose its target independently and a card that printed
 * "that creature" carried a second, unrelated `targetCreature` slot. Those
 * cards validated clean and played wrong, which is the failure this vocabulary
 * exists to refuse — so what has to be asserted here is the *shape of the
 * enumeration*, not the shape of the DSL. Every case below counts the cast
 * option-sets `legalActions` actually offers and then resolves one of them
 * against real life totals and a real tap, because a kernel that offers one
 * option-set and then aims it at the wrong player passes any test that only
 * counts.
 *
 * Each probe is a printed M11 card's structure under a test name, and the
 * boards are built so that a kernel that ignored the referent could not pass by
 * luck: the Chandra's Outrage board gives the opponent the only creature, so
 * "2 damage to that creature's controller" and "2 damage to whoever the caster
 * points at" disagree; the Stabbing Pain board carries one creature per seat,
 * so a split choice is available if the enumeration still allows one.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '@mtg/kernel';
import { legalActions, pendingDecision, scenario } from '@mtg/kernel';
import type { ReduceResult } from '@mtg/kernel';
import { validateCards } from '@mtg/dsl';
import { MOUNTAIN, SWAMP, creature, instant, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/** `Chandra's Outrage` (M11 #128), structurally. */
const OUTRAGE = instant(
  'Outrage Probe',
  [
    { kind: 'dealDamage', amount: 4, target: { kind: 'targetCreature' } },
    { kind: 'dealDamage', amount: 2, target: { kind: 'thatCreaturesController' } },
  ],
  { R: 1 },
);

/** The removal a responding player uses to make the referent's chooser fizzle. */
const MURDER = instant('Murder Probe', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
  B: 1,
});

/** `Stabbing Pain` (M11 #118), structurally. */
const STABBING = instant(
  'Stabbing Probe',
  [
    { kind: 'pumpUntilEndOfTurn', power: -1, toughness: -1, target: { kind: 'targetCreature' } },
    { kind: 'tapPermanent', target: { kind: 'thatCreature' } },
  ],
  { B: 1 },
);

/** `Sign in Blood` (M11 #117), structurally. */
const SIGN = sorcery(
  'Sign Probe',
  [
    { kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } },
    { kind: 'loseLife', amount: 2, target: { kind: 'thatPlayer' } },
  ],
  { B: 1 },
);

function casts(result: ReduceResult): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(result.state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> => action.type === 'castSpell',
  );
}

/** Passes back and forth until the stack is empty. */
function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 16; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

describe('a spell that damages a creature and its controller', () => {
  function outrageCasts(start: ReduceResult): readonly Extract<Action, { type: 'castSpell' }>[] {
    const oid = handOidOf(start.state, 0, 'Outrage Probe');
    return casts(start).filter((action) => action.oid === oid);
  }

  // 2/5 rather than 2/4: 4 damage has to leave the creature standing, or the
  // state-based check moves it to the graveyard and the damage assertion below
  // would be reading a fresh object rather than a damaged one.
  function board(): ReduceResult {
    return scenario({
      active: 0,
      hands: [[OUTRAGE, MURDER], []],
      battlefield: [
        { card: creature('Referent Sentry', 2, 5), controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
    });
  }

  it('validates', () => {
    expect(validateCards([OUTRAGE])).toEqual([]);
  });

  it('offers exactly one cast when the opponent controls the only creature', () => {
    const start = board();
    expect(outrageCasts(start).length).toBe(1);
  });

  it('leaves the referent slot empty rather than letting the caster aim it', () => {
    const only = outrageCasts(board())[0];
    expect(only?.targets[1]).toBe(null);
  });

  it('sends the second damage to the creature controller and not to the caster', () => {
    const start = board();
    const only = outrageCasts(start)[0];
    if (only === undefined) throw new Error('no cast offered');
    const resolved = settle(apply(start, only));
    expect(resolved.state.players[1].life).toBe(18);
    expect(resolved.state.players[0].life).toBe(20);
    expect(resolved.state.objects[oidOf(start.state, 'Referent Sentry')]?.damage).toBe(4);
  });

  it('fizzles with the creature gone rather than resolving its second half', () => {
    // CR 608.2b, through public actions only: the spell has one target, the
    // creature is destroyed in response, and nothing resolves — including the
    // half that reads the controller, which is not itself a target and would
    // otherwise still have a person to name. `planResolution`'s referent branch
    // inherits the chooser slot's verdict for exactly this.
    const start = board();
    const outrage = outrageCasts(start)[0];
    if (outrage === undefined) throw new Error('no cast offered');
    const onStack = apply(start, outrage);
    const murderOid = handOidOf(onStack.state, 0, 'Murder Probe');
    const response = casts(onStack).find((action) => action.oid === murderOid);
    if (response === undefined) throw new Error('no response offered');
    const resolved = settle(apply(onStack, response));
    expect(resolved.state.objects[oidOf(start.state, 'Referent Sentry')]?.zone).toBe('graveyard');
    expect(resolved.state.players[1].life).toBe(20);
  });
});

describe('a spell that shrinks a creature and taps that creature', () => {
  function board(): ReduceResult {
    return scenario({
      active: 0,
      hands: [[STABBING], []],
      battlefield: [
        { card: creature('Barony Vampire', 3, 2), controller: 1 },
        { card: creature('Bog Wraith', 3, 3), controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
    });
  }

  it('validates', () => {
    expect(validateCards([STABBING])).toEqual([]);
  });

  it('offers one cast per creature rather than one per pair of creatures', () => {
    // Two creatures on the board. The chooser slot has two choices and the
    // referent slot has none, so the product is two — where before the referent
    // kinds it was four, and two of those four shrank one creature and tapped
    // the other.
    expect(casts(board()).length).toBe(2);
  });

  it('taps the creature it shrank', () => {
    const start = board();
    const vampire = oidOf(start.state, 'Barony Vampire');
    const aimed = casts(start).find(
      (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === vampire,
    );
    if (aimed === undefined) throw new Error('no cast aimed at the vampire');
    const resolved = settle(apply(start, aimed));
    expect(resolved.state.objects[vampire]?.tapped).toBe(true);
    expect(resolved.state.objects[oidOf(start.state, 'Bog Wraith')]?.tapped).toBe(false);
  });
});

describe('a spell that draws for a player and drains that player', () => {
  function board(): ReduceResult {
    return scenario({
      active: 0,
      hands: [[SIGN], []],
      libraries: [
        [creature('Child of Night', 2, 1), creature('Child of Night', 2, 1)],
        [creature('Child of Night', 2, 1), creature('Child of Night', 2, 1)],
      ],
      battlefield: [{ card: SWAMP, controller: 0 }],
    });
  }

  it('validates', () => {
    expect(validateCards([SIGN])).toEqual([]);
  });

  it('offers one cast per player and never a cast that splits the two halves', () => {
    // Both seats are legal for the chooser slot (CR 115.4 puts no restriction
    // on "target player"), so two option-sets is the right count. What the
    // referent removes is the third and fourth, which drew for one seat and
    // drained the other.
    const options = casts(board());
    expect(options.length).toBe(2);
    expect(options.every((action) => action.targets[1] === null)).toBe(true);
  });

  it('drains the player it drew for', () => {
    const start = board();
    const atSelf = casts(start).find(
      (action) => action.targets[0]?.kind === 'player' && action.targets[0].player === 0,
    );
    if (atSelf === undefined) throw new Error('no cast aimed at the caster');
    const resolved = settle(apply(start, atSelf));
    expect(resolved.state.players[0].life).toBe(18);
    expect(resolved.state.players[1].life).toBe(20);
    expect(resolved.state.players[0].hand.length).toBe(2);
  });
});
