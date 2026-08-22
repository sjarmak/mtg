/**
 * The step-10 life vocabulary in the kernel: a drain, a life total set outright,
 * a Fog, and the damage doubler that is a CR 614 replacement rather than a CR
 * 613 static.
 *
 * Four claims, one per describe, and each is a thing the DSL could not say
 * before this lane:
 *
 *  1. Life loss reaches the seat the card names and no other, and reports a
 *     reason of its own rather than borrowing damage's.
 *  2. A life total set to N moves from above and from below, and the reason it
 *     reports is the decision the effect made rather than an accident of which
 *     helper it called.
 *  3. A prevented combat damage step is still a combat step: the attacker is
 *     declared, tapped and unblocked, and only the damage is missing.
 *  4. Two damage doublers quadruple, which is CR 614.5 rather than a bug.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { eventsOfType, pendingDecision, reduce, reduceAll, scenario, type ReduceResult } from '@mtg/kernel';
import { creature, enchantment, instant, MOUNTAIN, sorcery } from './cards';
import { apply, handOidOf, oidOf, playCombat } from './helpers';

/**
 * "Each opponent loses 2 life", in the vocabulary this kernel has.
 *
 * `mtg-vobp` scoped this lane as "each opponent loses N", and the DSL spells it
 * `targetOpponent` instead — CR 115.1's targeting rather than CR 109.5's
 * "each". In a two-player kernel (`PlayerId = 0 | 1`) the two phrases pick out
 * the same seat every time, so what the tests below can prove is the reach:
 * the loss lands on the opponent, it lands once, and it does not land on the
 * caster. What they cannot prove is the difference, and the difference is
 * real — a targeted drain is countered by shroud and by an empty legality
 * check, and "each opponent" is neither. `renderStaticAbility`'s sibling
 * `renderEffect` prints "Target opponent loses 2 life." for exactly this
 * reason: a card that reads "each" and enforces "target" says one thing and
 * does another.
 */
const DRAIN: Card = sorcery('Test Drain', [
  { kind: 'loseLife', amount: 2, target: { kind: 'targetOpponent' } },
]);

const SELF_DRAIN: Card = sorcery('Test Self Drain', [
  { kind: 'loseLife', amount: 2, target: { kind: 'noTarget' } },
]);

const BECOME_TEN: Card = sorcery('Test Balance Point', [{ kind: 'setLife', amount: 10 }]);

/** Rhox Faithmender's trigger half, used to read which reason `setLife` chose. */
const GAIN_WATCHER: Card = creature('Test Gain Watcher', 2, 2, {
  cost: { generic: 2 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'youGainLife',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const FOG: Card = instant('Test Fog', [{ kind: 'preventCombatDamage' }]);

/** Furnace of Rath, less the "instead" clause the renderer prints for it. */
function furnace(name: string): Card {
  return enchantment(name, { generic: 2, R: 1 }, [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'doubleDamage' } },
  ]);
}

const BOLT: Card = sorcery(
  'Test Bolt',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
  { generic: 1, R: 1 },
);

/** Casts a sorcery-speed spell from player 0's hand and resolves it. */
function castAndResolve(start: ReduceResult, name: string, targets: readonly unknown[]): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: targets as never,
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function lands(count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

/**
 * Passes priority until attackers are being declared.
 *
 * `scenario({ step: 'declareAttackers' })` cannot be used by the Fog tests: the
 * spell has to resolve in a main phase, and by the time the position is at the
 * declare step there is no priority left to cast it in. So the walk is done the
 * way `scenario` itself does it, through the real turn machinery.
 */
function walkToDeclareAttackers(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 50; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('walkToDeclareAttackers: the game ended first');
    if (decision.kind === 'declareAttackers') return current;
    if (decision.kind !== 'priority') {
      throw new Error(`walkToDeclareAttackers: unexpected decision ${decision.kind}`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('walkToDeclareAttackers: never reached the declare step');
}

describe('a drain takes life from the opponent and from nobody else', () => {
  it('moves the named seat and reports one event, with a reason damage never uses', () => {
    const start = scenario({
      battlefield: [...lands(1, 0)],
      hands: [[DRAIN], []],
    });
    const done = castAndResolve(start, 'Test Drain', [{ kind: 'player', player: 1 }]);

    const changes = eventsOfType(done.events, 'lifeChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ player: 1, delta: -2, life: 18, reason: 'lifeLoss' });
    expect(done.state.players[1].life).toBe(18);
    // The half that makes it "each opponent" rather than "each player": the
    // caster's own total is untouched, and no second event landed anywhere.
    expect(done.state.players[0].life).toBe(20);
  });

  it('is not damage, so nothing is marked and no damage event is written', () => {
    const start = scenario({
      battlefield: [...lands(1, 0), { card: creature('Test Wall', 0, 4), controller: 1 }],
      hands: [[DRAIN], []],
    });
    const done = castAndResolve(start, 'Test Drain', [{ kind: 'player', player: 1 }]);

    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
    expect(done.state.objects[oidOf(done.state, 'Test Wall')]?.damage).toBe(0);
  });

  it('aimed at nobody, takes the life from its own controller', () => {
    const start = scenario({ battlefield: [...lands(1, 0)], hands: [[SELF_DRAIN], []] });
    const done = castAndResolve(start, 'Test Self Drain', [null]);

    const changes = eventsOfType(done.events, 'lifeChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ player: 0, delta: -2, reason: 'lifeLoss' });
    expect(done.state.players[0].life).toBe(18);
    expect(done.state.players[1].life).toBe(20);
  });
});

describe('a life total that becomes N', () => {
  it('falls to N from above, and says the fall was a life loss', () => {
    const start = scenario({
      life: [20, 20],
      battlefield: [...lands(1, 0)],
      hands: [[BECOME_TEN], []],
    });
    const done = castAndResolve(start, 'Test Balance Point', [null]);

    const changes = eventsOfType(done.events, 'lifeChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ player: 0, delta: -10, life: 10, reason: 'lifeLoss' });
    expect(done.state.players[0].life).toBe(10);
  });

  it('rises to N from below, and says the rise was a life gain', () => {
    const start = scenario({
      life: [5, 20],
      battlefield: [...lands(1, 0)],
      hands: [[BECOME_TEN], []],
    });
    const done = castAndResolve(start, 'Test Balance Point', [null]);

    const changes = eventsOfType(done.events, 'lifeChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ player: 0, delta: 5, life: 10, reason: 'gainLife' });
    expect(done.state.players[0].life).toBe(10);
  });

  it('emits nothing at all when the total is already N', () => {
    const start = scenario({
      life: [10, 20],
      battlefield: [...lands(1, 0)],
      hands: [[BECOME_TEN], []],
    });
    const done = castAndResolve(start, 'Test Balance Point', [null]);

    expect(eventsOfType(done.events, 'lifeChanged')).toEqual([]);
    expect(done.state.players[0].life).toBe(10);
  });

  /**
   * The reason field is a decision, not a label, and this is the test that
   * makes it one: `youGainLife` reads `lifeChanged.reason`, so the upward arm
   * choosing `'gainLife'` is the difference between a Rhox Faithmender seeing
   * CR 118.5's gain and not seeing it. Both directions are asserted, because a
   * reason that fired on the way down as well would be the same bug wearing the
   * other sign.
   */
  it('fires a life-gain trigger going up and none going down', () => {
    const watcher = { card: GAIN_WATCHER, controller: 0 as const };
    const up = castAndResolve(
      scenario({ life: [5, 20], battlefield: [watcher, ...lands(1, 0)], hands: [[BECOME_TEN], []] }),
      'Test Balance Point',
      [null],
    );
    const down = castAndResolve(
      scenario({ life: [20, 20], battlefield: [watcher, ...lands(1, 0)], hands: [[BECOME_TEN], []] }),
      'Test Balance Point',
      [null],
    );

    const conditions = (result: ReduceResult): readonly string[] =>
      eventsOfType(result.events, 'abilityTriggered').map((event) => event.condition);
    expect(conditions(up)).toEqual(['youGainLife']);
    expect(conditions(down)).toEqual([]);
  });
});

describe('prevented combat damage', () => {
  /**
   * Fog is symmetric — "prevent all combat damage that would be dealt this
   * turn", not "dealt to you" — so the attacking player casting it on their own
   * turn is a legal and much simpler position than holding an instant across
   * the table, and it exercises the same replacement.
   */
  it('leaves both life totals untouched while the attack happens anyway', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(1, 0)],
      hands: [[FOG], []],
    });
    const fogged = castAndResolve(start, 'Test Fog', [null]);
    const attacker = oidOf(fogged.state, 'Test Bear');
    const done = playCombat(walkToDeclareAttackers(fogged), { attackers: [attacker], blocks: [] });

    expect(done.state.players[1].life).toBe(20);
    expect(done.state.players[0].life).toBe(20);
    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
    // The prevention is reported rather than silent, which is what separates a
    // Fog that worked from a combat that never happened.
    const prevented = eventsOfType(done.events, 'damagePrevented');
    expect(prevented).toHaveLength(1);
    expect(prevented[0]).toMatchObject({ sourceOid: attacker, amount: 2 });
  });

  it('leaves the combat step otherwise intact: still declared, still tapped', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(1, 0)],
      hands: [[FOG], []],
    });
    const fogged = castAndResolve(start, 'Test Fog', [null]);
    const attacker = oidOf(fogged.state, 'Test Bear');
    const done = playCombat(walkToDeclareAttackers(fogged), { attackers: [attacker], blocks: [] });

    // CR 508.1f: declaring an attacker taps it, and a prevention effect is not
    // a reason for it to be untapped. This is the assertion that fails if a Fog
    // is ever implemented by skipping the combat phase.
    expect(done.state.objects[attacker]?.tapped).toBe(true);
    const declarations = eventsOfType(done.events, 'attackersDeclared');
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.attacks.map((attack) => attack.oid)).toEqual([attacker]);
    // The damage step ran; it just had nothing to deal.
    expect(eventsOfType(done.events, 'combatDamageStep')).not.toEqual([]);
    expect(done.state.turn.step).toBe('endCombat');
  });
});

describe('damage doubling under CR 614.5', () => {
  it('doubles once with one doubler out', () => {
    const start = scenario({
      battlefield: [{ card: furnace('Test Furnace'), controller: 0 }, ...lands(2, 0)],
      hands: [[BOLT], []],
    });
    const done = castAndResolve(start, 'Test Bolt', [{ kind: 'player', player: 1 }]);

    const dealt = eventsOfType(done.events, 'damageDealt');
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.amount).toBe(4);
    expect(done.state.players[1].life).toBe(16);
  });

  /**
   * Two doublers quadruple, and that is the rule rather than an arithmetic
   * slip.
   *
   * CR 614.5: "a replacement effect doesn't apply to an event more than once."
   * Two Furnaces of Rath are two *distinct* replacement effects, so the once-
   * per-effect cap binds each of them separately and neither is the other. The
   * damage event is 2, the first doubler replaces it with 4, and the second
   * doubler then applies to the event as it now stands and replaces it with 8.
   * Wizards' own Furnace of Rath ruling states the outcome in exactly these
   * terms: with two Furnaces on the battlefield, damage is multiplied by four.
   *
   * `applyReplacements` implements the cap as an `applied: string[]` list it
   * filters each pass by, so what is asserted below is both halves at once: 4
   * proves one effect applied once rather than looping, and 8 proves the second
   * effect was not locked out by the first.
   */
  it('quadruples with two doublers out, because each applies once', () => {
    const start = scenario({
      battlefield: [
        { card: furnace('Test Furnace One'), controller: 0 },
        { card: furnace('Test Furnace Two'), controller: 1 },
        ...lands(2, 0),
      ],
      hands: [[BOLT], []],
    });
    const done = castAndResolve(start, 'Test Bolt', [{ kind: 'player', player: 1 }]);

    const dealt = eventsOfType(done.events, 'damageDealt');
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.amount).toBe(8);
    expect(done.state.players[1].life).toBe(12);
    // Two applications, one per effect, and two distinct ids: the same id twice
    // would be the loop CR 614.5 forbids.
    const applied = eventsOfType(done.events, 'replacementApplied').filter(
      (event) => event.event === 'damage',
    );
    expect(applied).toHaveLength(2);
    expect(new Set(applied.map((event) => event.id)).size).toBe(2);
  });

  it('is a replacement rather than a continuous effect, so it registers nowhere else', () => {
    const start = scenario({
      battlefield: [{ card: furnace('Test Furnace'), controller: 0 }],
    });
    // The arrow this lane added: a printed `doubleDamage` reaches
    // `state.replacements` and never `state.continuous`, which is what keeps the
    // CR 613 layer walk from being asked to run a CR 614 effect.
    expect(
      start.state.replacements.filter((effect) => effect.duration === 'whileOnBattlefield'),
    ).toHaveLength(1);
    expect(start.state.continuous).toEqual([]);
  });

  it('stops doubling when the enchantment leaves the battlefield', () => {
    const destroy: Card = sorcery(
      'Test Disenchant',
      [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
      { generic: 1 },
    );
    const start = scenario({
      battlefield: [{ card: furnace('Test Furnace'), controller: 1 }, ...lands(4, 0)],
      hands: [[destroy, BOLT], []],
    });
    const furnaceOid = oidOf(start.state, 'Test Furnace');
    const gone = castAndResolve(start, 'Test Disenchant', [{ kind: 'permanent', oid: furnaceOid }]);
    expect(gone.state.replacements).toEqual([]);

    const done = castAndResolve(gone, 'Test Bolt', [{ kind: 'player', player: 1 }]);
    expect(eventsOfType(done.events, 'damageDealt')[0]?.amount).toBe(2);
    expect(done.state.players[1].life).toBe(18);
  });
});
