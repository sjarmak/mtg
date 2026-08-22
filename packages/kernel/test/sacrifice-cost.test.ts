/**
 * Sacrifice as an activation cost, driven through the reducer (`mtg-bc2.132.11`).
 *
 * The load-bearing fact this file exists to pin is a timing one. Costs are paid
 * on activation, not on resolution (CR 602.2b routes an activation through CR
 * 601.2's steps and 601.2h pays the costs there), so a permanent that
 * sacrifices itself is *already in its owner's graveyard* while its own ability
 * sits on the stack. Every other activated ability in this checkout resolves
 * with its source still on the battlefield, so that is the case most likely to
 * break a kernel that assumed one, and it is the case the flagship set's Fuse
 * is entirely made of.
 *
 * The assertions read the enumeration, the zone the source is in, the stack and
 * the event log rather than only the effect's outcome, because "the creature
 * took 2 damage" is also what a spell does. What is being proved is which
 * machinery answered.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  eventsOfType,
  IllegalActionError,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { artifact, creature, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

/** `{1}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.` */
const BOMB: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, sacrificeSelf: true },
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
};

/** `{1}, {T}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.` */
const TAP_AND_BOMB: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true, sacrificeSelf: true },
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
};

/**
 * `Sacrifice CARDNAME: Target creature gets +2/+2 until end of turn.`
 *
 * Fuse's shape, with the payload DSL v1 has. A part token spends itself to put
 * a counter on a creature its controller chose; this spends itself to put a
 * layer 7c effect on a creature its controller chose. The counter kind and the
 * effect that places one are a separate bead, so what this fixture proves is
 * the half that is here: a cost of nothing but the permanent, a target chosen
 * at activation, and a payload that lands on that target after the source is
 * gone.
 */
const FUSE_SHAPED: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, sacrificeSelf: true },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } }],
};

function bombBag(ability: AbilityInput = BOMB): Card {
  return artifact('Bomb Bag', { generic: 2 }, [ability]);
}

function lands(count: number, controller: 0 | 1): { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const found: Extract<Action, { type: 'activateAbility' }>[] = [];
  for (const option of legalActions(state)) {
    if (option.type === 'activateAbility') found.push(option);
  }
  return found;
}

function zoneOf(state: GameState, oid: ObjectId): string | undefined {
  return state.objects[oid]?.zone;
}

/** Passes priority back and forth until the stack is empty again. */
function letItResolve(start: ReduceResult, limit = 8): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

describe('activating a sacrifice cost', () => {
  it('offers it in the enumeration once the mana is there', () => {
    const start = scenario({
      battlefield: [{ card: bombBag(), controller: 0 }, ...lands(1, 0)],
    });
    const offered = activations(start.state);
    expect(offered.length).toBeGreaterThan(0);
    for (const option of offered) expect(validateAction(start.state, option)).toBeNull();
  });

  /**
   * Acceptance 2: the permanent lands in its owner's graveyard *and* the
   * ability lands on the stack, in the same reduction.
   */
  it('puts the source in its owner graveyard and the ability on the stack', () => {
    const start = scenario({
      battlefield: [
        { card: bombBag(), controller: 0 },
        { card: creature('Thornwood Scrub', 1, 1), controller: 1 },
        ...lands(1, 0),
      ],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const victim = oidOf(start.state, 'Thornwood Scrub');
    const option = activations(start.state).find(
      (entry) => entry.oid === source && entry.targets[0]?.kind === 'permanent',
    );
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    expect(zoneOf(activated.state, source)).toBe('graveyard');
    expect(activated.state.players[0].graveyard).toContain(source);
    expect(activated.state.battlefield).not.toContain(source);
    expect(activated.state.stack).toHaveLength(1);
    expect(activated.state.stack[0]?.ability).toEqual({ sourceOid: source, index: 0 });
    expect(activated.state.stack[0]?.targets).toEqual([{ kind: 'permanent', oid: victim }]);
  });

  /**
   * Acceptance 3: it resolves with its own source already in the graveyard.
   *
   * `resolveAbility` reads the printed text off the object record rather than
   * off the battlefield, which is what makes this work — the object survives
   * the zone change, so the ability text is still there to read.
   */
  it('resolves with its source already in the graveyard', () => {
    const start = scenario({
      battlefield: [
        { card: bombBag(), controller: 0 },
        { card: creature('Thornwood Scrub', 1, 1), controller: 1 },
        ...lands(1, 0),
      ],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const victim = oidOf(start.state, 'Thornwood Scrub');
    const option = activations(start.state).find(
      (entry) => entry.oid === source && entry.targets[0]?.kind === 'permanent',
    );
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    expect(zoneOf(activated.state, source)).toBe('graveyard');
    const resolved = letItResolve(activated);

    // The ability did its work from the graveyard: 2 damage killed a 1/1.
    expect(resolved.state.stack).toHaveLength(0);
    expect(zoneOf(resolved.state, victim)).toBe('graveyard');
    expect(eventsOfType(resolved.events, 'resolutionBegan').map((event) => event.oid)).toContain(
      activated.state.stack[0]?.oid,
    );
    expect(eventsOfType(resolved.events, 'effectSkipped')).toEqual([]);
  });

  /**
   * Fuse's own shape, end to end: a free sacrifice, a target chosen when it was
   * activated, and a payload that lands on that target with the source gone.
   */
  it('plays a Fuse-shaped ability: spend the permanent, land the effect on a creature', () => {
    const start = scenario({
      battlefield: [
        { card: artifact('Bomb Part', { generic: 1 }, [FUSE_SHAPED]), controller: 0 },
        { card: creature('Bramble Sprout', 1, 1), controller: 0 },
      ],
    });
    const part = oidOf(start.state, 'Bomb Part');
    const carrier = oidOf(start.state, 'Bramble Sprout');
    const option = activations(start.state).find((entry) => entry.oid === part);
    expect(option).toBeDefined();
    if (option === undefined) return;
    expect(option.targets).toEqual([{ kind: 'permanent', oid: carrier }]);

    const resolved = letItResolve(apply(start, option));
    expect(zoneOf(resolved.state, part)).toBe('graveyard');
    const added = eventsOfType(resolved.events, 'continuousEffectAdded');
    expect(added).toHaveLength(1);
    expect(added[0]?.targetOid).toBe(carrier);
    expect(added[0]?.power).toBe(2);
  });
});

describe('legality', () => {
  /**
   * Acceptance 4, enumeration side. The sacrifice is available exactly while
   * the source is a permanent this player controls, which is what
   * `activationBlocker` already asks — so paying it once takes the ability away
   * from the enumeration for the rest of the game.
   */
  it('stops offering the ability once the source has been sacrificed', () => {
    const start = scenario({
      battlefield: [{ card: bombBag(), controller: 0 }, ...lands(3, 0)],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const option = activations(start.state)[0];
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    expect(zoneOf(activated.state, source)).toBe('graveyard');
    expect(activations(activated.state)).toEqual([]);
    // Mana is not what ran out: untapped lands are still there.
    expect(
      activated.state.battlefield.filter((oid) => activated.state.objects[oid]?.tapped === false).length,
    ).toBeGreaterThan(0);
  });

  /** Acceptance 4, validator side: a hand-built repeat is rejected, not applied. */
  it('rejects a hand-built activation whose source is already sacrificed', () => {
    const start = scenario({
      battlefield: [{ card: bombBag(), controller: 0 }, ...lands(3, 0)],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const option = activations(start.state)[0];
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    const repeat: Action = { ...option };
    expect(validateAction(activated.state, repeat)).toBe('source is not on the battlefield');
    expect(() => reduce(activated.state, repeat)).toThrow(IllegalActionError);
    expect(activated.state.players[0].graveyard.filter((oid) => oid === source)).toHaveLength(1);
  });

  /**
   * CR 302.6 restricts `{T}` and `{Q}`, not a sacrifice. A creature that
   * arrived this turn cannot tap for an ability and *can* sacrifice itself for
   * one, so the summoning-sickness check must stay inside the tap branch.
   */
  it('lets a summoning-sick creature sacrifice itself', () => {
    const start = scenario({
      battlefield: [
        {
          card: creature('Bomb Flower', 1, 1, { abilities: [FUSE_SHAPED] }),
          controller: 0,
          summoningSick: true,
        },
        { card: creature('Bramble Sprout', 1, 1), controller: 0 },
      ],
    });
    const flower = oidOf(start.state, 'Bomb Flower');
    expect(activations(start.state).some((entry) => entry.oid === flower)).toBe(true);

    const sick = creature('Sick Beacon', 1, 1, {
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const tapCase = scenario({ battlefield: [{ card: sick, controller: 0, summoningSick: true }] });
    expect(activations(tapCase.state)).toEqual([]);
  });
});

describe('cost payment', () => {
  /**
   * Acceptance 5. The three halves of the cost are one atomic act: they are
   * paid inside a single reduction, in mana-tap-sacrifice order, and the
   * ability does not exist on the stack until all of them are paid (CR 601.2h
   * then 601.2i).
   *
   * The order is load-bearing rather than cosmetic. `moveObject` resets a
   * permanent's battlefield status, so sacrificing before tapping would tap a
   * card that is already in the graveyard — a permanent turned sideways in a
   * zone where being tapped means nothing, reported to every replay as a real
   * `permanentTapped`.
   */
  it('pays mana, then the tap symbol, then the sacrifice, before the ability exists', () => {
    const start = scenario({
      battlefield: [{ card: bombBag(TAP_AND_BOMB), controller: 0 }, ...lands(1, 0)],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const option = activations(start.state).find((entry) => entry.oid === source);
    expect(option).toBeDefined();
    if (option === undefined) return;

    const step = reduce(start.state, option);
    const order = step.events.map((event) => event.type);
    const sacrificed = step.events.findIndex(
      (event) => event.type === 'zoneChanged' && event.oid === source && event.to === 'graveyard',
    );
    const tappedSource = step.events.findIndex(
      (event) => event.type === 'permanentTapped' && event.oid === source,
    );

    expect(order).toContain('manaPaid');
    expect(tappedSource).toBeGreaterThanOrEqual(0);
    expect(sacrificed).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('manaPaid')).toBeLessThan(tappedSource);
    expect(tappedSource).toBeLessThan(sacrificed);
    expect(sacrificed).toBeLessThan(order.indexOf('abilityActivated'));
  });

  /** The sacrificed card is not sitting tapped in the graveyard (CR 400.7). */
  it('leaves the sacrificed card untapped in the graveyard', () => {
    const start = scenario({
      battlefield: [{ card: bombBag(TAP_AND_BOMB), controller: 0 }, ...lands(1, 0)],
    });
    const source = oidOf(start.state, 'Bomb Bag');
    const option = activations(start.state).find((entry) => entry.oid === source);
    expect(option).toBeDefined();
    if (option === undefined) return;

    const activated = apply(start, option);
    expect(zoneOf(activated.state, source)).toBe('graveyard');
    expect(activated.state.objects[source]?.tapped).toBe(false);
  });

  /**
   * No half-paid cost: an activation whose mana cannot be paid is refused
   * before any of it happens, so there is no state in which the permanent has
   * been sacrificed and the mana has not.
   */
  it('sacrifices nothing when the mana half cannot be paid', () => {
    const start = scenario({ battlefield: [{ card: bombBag(), controller: 0 }] });
    const source = oidOf(start.state, 'Bomb Bag');
    expect(activations(start.state)).toEqual([]);

    const forced: Action = {
      type: 'activateAbility',
      player: 0,
      oid: source,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    };
    expect(validateAction(start.state, forced)).toBe('cannot pay the mana cost');
    expect(() => reduce(start.state, forced)).toThrow(IllegalActionError);
    expect(zoneOf(start.state, source)).toBe('battlefield');
    expect(start.state.players[0].graveyard).toEqual([]);
  });
});
