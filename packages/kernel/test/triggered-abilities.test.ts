/**
 * CR 603 triggered abilities, driven through the reducer.
 *
 * Every assertion here reads the event log or the stack rather than the effect's
 * outcome, because "the life total went up" is also what a spell does. What is
 * being proved is which machinery answered: an object with an `ab` id appeared
 * on the stack, somebody got priority, and that object resolved.
 *
 * The log says all of that with the events the kernel already had, and since
 * `mtg-dao` it also says the thing none of them said: a trigger fired.
 * `abilityTriggered` was deferred out of the lane that built this file because
 * `@mtg/ui`'s replay schema mirrors `GameEvent` under a compile-time guard and
 * that lane could not edit the package; it arrives here with the schema change,
 * in one commit, the way that note asked for. `abilityResolved` is still not
 * here — `resolutionBegan` already names the ability object.
 *
 * Why it had to arrive: `packages/metrics/src/ability-usage.ts` gates on the
 * activated half of the ability model and abstains on the triggered half,
 * because a measure counted off no event reports zero forever. That is the same
 * defect `activated-abilities.test.ts` documents for CR 602, one condition
 * over, and 16 of the flagship set's 80 cards were sitting behind it.
 *
 * The replay viewer owes something larger than two events, and it is worth
 * naming precisely because the obvious guess is wrong. `StackEntrySchema` is
 * not what rejects an ability: it is a strict object over `oid`, `controller`
 * and `targets`, its `oid` is `z.string().min(1)`, and the recorder
 * (`packages/ui/test/replay/support/record.ts`) projects exactly those three
 * fields, so an entry for `ab7` parses today and adding an `ability` field to
 * the schema would change nothing. What rejects it is `checkSnapshotIds` in
 * `packages/ui/src/routes/replay/read-log.ts`: every oid a snapshot names must
 * appear in the game record's object table, that table is built by walking
 * `state.objects`, and an ability on the stack has no `GameObject` — so a
 * recorded game containing one fails to load with "snapshot names unknown
 * object ab7". Past that, `frame.ts`'s `stackItems` skips any entry whose card
 * it cannot find, so the ability would be invisible rather than drawn. The fix
 * is an object record (or an exemption) for `ab<n>` plus a stack row that can
 * draw a cardless object, and it is the UI lane's.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult, StackEntry } from '@mtg/kernel';
import { eventsOfType, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { creature, instant, ISLAND, MOUNTAIN, PLAINS } from './cards';
import { apply, handOidOf, oidOf, playCombat } from './helpers';

const GAIN_TWO: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

const DRAW_ONE_ON_ENTER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

const GAIN_ONE_ON_ATTACK: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
};

const MILL_ON_DEATH: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  effects: [{ kind: 'millCards', count: 1, target: { kind: 'noTarget' } }],
};

const DRAW_ON_DEATH: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

/** Stack entries that are abilities rather than spells. */
function abilitiesOnStack(state: GameState): readonly StackEntry[] {
  return state.stack.filter((entry) => entry.ability !== null);
}

function lands(
  count: number,
  controller: 0 | 1,
): { readonly card: typeof PLAINS; readonly controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller }));
}

/** Passes priority with whoever holds it until somebody owes a real decision. */
function passUntilQuiet(start: ReduceResult, limit = 12): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && current.state.turn.step !== 'precombatMain') return current;
    if (current.state.stack.length === 0 && guard > 1) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function castFromHand(start: GameState, player: 0 | 1, name: string): ReduceResult {
  const oid = handOidOf(start, player, name);
  const card = start.objects[oid]?.card;
  const targets = card === undefined ? [] : card.effects.map(() => null);
  return reduce(start, { type: 'castSpell', player, oid, targets });
}

describe('an enters-the-battlefield trigger', () => {
  const herald = creature('Tide Herald', 2, 2, { cost: { generic: 1, W: 1 }, abilities: [GAIN_TWO] });

  function cast(): ReduceResult {
    const start = scenario({ battlefield: lands(2, 0), hands: [[herald], []] }).state;
    return castFromHand(start, 0, 'Tide Herald');
  }

  it('goes on the stack as its own object once the permanent has entered', () => {
    const cast0 = cast();
    // Both players pass, the creature spell resolves, and settle runs.
    const resolved = apply(apply(cast0, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });

    const abilities = abilitiesOnStack(resolved.state);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.oid.startsWith('ab')).toBe(true);
    expect(abilities[0]?.controller).toBe(0);
    expect(abilities[0]?.ability?.sourceOid).toBe(oidOf(resolved.state, 'Tide Herald'));
    expect(abilities[0]?.ability?.index).toBe(0);
    // CR 117.3b: somebody has priority with the ability waiting on the stack.
    expect(resolved.state.turn.priority).not.toBeNull();
    expect(resolved.state.players[0].life).toBe(20);
  });

  it('resolves as an ability object, and the log names the object that resolved', () => {
    const cast0 = cast();
    const onStack = apply(apply(cast0, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    const abilityOid = abilitiesOnStack(onStack.state)[0]?.oid ?? '';

    const resolved = apply(apply(onStack, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });

    expect(abilitiesOnStack(resolved.state)).toEqual([]);
    expect(resolved.state.players[0].life).toBe(22);
    const resolutions = eventsOfType(resolved.events, 'resolutionBegan').map((event) => event.oid);
    expect(resolutions).toContain(abilityOid);
    const gained = eventsOfType(resolved.events, 'lifeChanged').filter(
      (event) => event.reason === 'gainLife',
    );
    expect(gained.map((event) => [event.player, event.delta])).toEqual([[0, 2]]);
    // The ability object is gone rather than moved: nothing carries its id.
    expect(resolved.state.objects[abilityOid]).toBeUndefined();
  });

  it('resolves even when the source is killed in response (CR 608.2)', () => {
    const bolt = instant('Snuff', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const start = scenario({
      battlefield: [...lands(2, 0), ...lands(2, 1)],
      hands: [[herald], [bolt]],
    }).state;
    const onStack = apply(apply(castFromHand(start, 0, 'Tide Herald'), { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    const source = oidOf(onStack.state, 'Tide Herald');

    // The active player holds priority with the trigger on the stack, so the
    // answer comes after they pass — which is the window CR 117.3b opened.
    const passed = apply(onStack, { type: 'passPriority', player: 0 });
    const answer = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(passed.state, 1, 'Snuff'),
      targets: [{ kind: 'permanent', oid: source }],
    });
    const settled = passUntilQuiet(answer, 8);

    expect(settled.state.objects[source]?.zone).toBe('graveyard');
    expect(settled.state.players[0].life).toBe(22);
  });
});

/**
 * The event a firing trigger emits.
 *
 * Every assertion here is about the record rather than the effect, because the
 * effect was already observable and the record was not. A trigger that gains
 * two life shows up as `lifeChanged`, which is also what a life-gain spell
 * emits; nothing in the log distinguished "an ability triggered" from "an
 * ability was activated" from "a spell resolved" except the shape of the id on
 * the stack, and a metrics column cannot read a stack it never saw.
 */
describe('the event a firing trigger emits', () => {
  const herald = creature('Tide Herald', 2, 2, { cost: { generic: 1, W: 1 }, abilities: [GAIN_TWO] });

  /** Casts the herald and lets the creature spell resolve, so the trigger fires. */
  function heraldEntered(): ReduceResult {
    const start = scenario({ battlefield: lands(2, 0), hands: [[herald], []] }).state;
    const cast = castFromHand(start, 0, 'Tide Herald');
    return apply(apply(cast, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
  }

  it('names the source, the printed index, the controller and the condition', () => {
    const entered = heraldEntered();
    const fired = eventsOfType(entered.events, 'abilityTriggered');
    expect(fired).toHaveLength(1);
    expect(fired[0]?.source).toBe(oidOf(entered.state, 'Tide Herald'));
    expect(fired[0]?.index).toBe(0);
    expect(fired[0]?.player).toBe(0);
    expect(fired[0]?.condition).toBe('selfEnters');
  });

  it('names the ability object, so the log joins the firing to the resolution', () => {
    const entered = heraldEntered();
    const abilityOid = abilitiesOnStack(entered.state)[0]?.oid ?? '';
    expect(abilityOid).not.toBe('');
    expect(eventsOfType(entered.events, 'abilityTriggered').map((event) => event.oid)).toEqual([abilityOid]);

    const resolved = apply(apply(entered, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    expect(eventsOfType(resolved.events, 'resolutionBegan').map((event) => event.oid)).toContain(abilityOid);
  });

  it('emits one per fired trigger, in the order they went on the stack', () => {
    const twice = creature('Twin Herald', 2, 2, {
      cost: { generic: 1, W: 1 },
      abilities: [GAIN_TWO, DRAW_ONE_ON_ENTER],
    });
    const start = scenario({ battlefield: lands(2, 0), hands: [[twice], []] }).state;
    const onStack = apply(apply(castFromHand(start, 0, 'Twin Herald'), { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });

    const fired = eventsOfType(onStack.events, 'abilityTriggered');
    expect(fired.map((event) => event.index)).toEqual([0, 1]);
    expect(fired.map((event) => event.oid)).toEqual(
      abilitiesOnStack(onStack.state).map((entry) => entry.oid),
    );
  });

  /**
   * The condition is the one field a trigger has that an activation does not,
   * and it is not derivable from the rest of the event: `source` and `index`
   * name a printed ability, and reading which watch fired off them means
   * holding the card. A death and an arrival are the same event otherwise.
   */
  it('says which condition fired, so a death is not read as an arrival', () => {
    const sentry = creature('Ash Sentry', 2, 2, { abilities: [MILL_ON_DEATH] });
    const snuff = instant('Snuff', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const start = scenario({
      battlefield: [{ card: sentry, controller: 0 }, ...lands(2, 0)],
      hands: [[snuff], []],
    }).state;
    const source = oidOf(start, 'Ash Sentry');
    const killed = passUntilQuiet(
      reduce(start, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(start, 0, 'Snuff'),
        targets: [{ kind: 'permanent', oid: source }],
      }),
      10,
    );

    const fired = eventsOfType(killed.events, 'abilityTriggered');
    expect(fired.map((event) => [event.source, event.condition])).toEqual([[source, 'selfDies']]);
  });

  it('attributes an attack trigger to the attacking permanent', () => {
    const raider = creature('Ember Raider', 2, 2, { abilities: [GAIN_ONE_ON_ATTACK] });
    const start = scenario({
      battlefield: [{ card: raider, controller: 0 }, ...lands(1, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, 'Ember Raider');

    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });

    const fired = eventsOfType(declared.events, 'abilityTriggered');
    expect(fired.map((event) => [event.source, event.condition])).toEqual([[attacker, 'selfAttacks']]);
  });

  /**
   * The half that makes the rest evidence. An event emitted on every arrival
   * would satisfy every assertion above and would report a set with no
   * triggered ability in it as a set whose triggers fire constantly.
   */
  it('stays silent when a permanent with no trigger enters', () => {
    const plain = creature('Reach Drifter', 2, 2, { cost: { generic: 1, W: 1 } });
    const start = scenario({ battlefield: lands(2, 0), hands: [[plain], []] }).state;
    const entered = apply(
      apply(castFromHand(start, 0, 'Reach Drifter'), { type: 'passPriority', player: 0 }),
      { type: 'passPriority', player: 1 },
    );

    expect(eventsOfType(entered.events, 'permanentEntered')).toHaveLength(1);
    expect(eventsOfType(entered.events, 'abilityTriggered')).toEqual([]);
  });
});

describe('trigger ordering', () => {
  it('resolves the last trigger put on the stack first (CR 603.3b, one controller)', () => {
    const twice = creature('Twin Herald', 2, 2, {
      cost: { generic: 1, W: 1 },
      abilities: [GAIN_TWO, DRAW_ONE_ON_ENTER],
    });
    const start = scenario({ battlefield: lands(2, 0), hands: [[twice], []] }).state;
    const onStack = apply(apply(castFromHand(start, 0, 'Twin Herald'), { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });

    // Printed order goes on the stack in printed order, so index 1 is on top.
    const indices = abilitiesOnStack(onStack.state).map((entry) => entry.ability?.index);
    expect(indices).toEqual([0, 1]);

    const resolved = passUntilQuiet(onStack, 10);
    const order = resolved.events
      .filter((event) => event.type === 'cardDrawn' || event.type === 'lifeChanged')
      .map((event) => event.type);
    expect(order).toEqual(['cardDrawn', 'lifeChanged']);
  });

  it('puts the active player first, so the non-active player resolves first (APNAP)', () => {
    const mine = creature('Ash Sentry', 2, 2, { abilities: [MILL_ON_DEATH] });
    const theirs = creature('Dusk Sentry', 2, 2, { abilities: [DRAW_ON_DEATH] });
    // The non-active player's creature is listed *first*, and that placement is
    // the whole fixture. Both 2/2s die to one damage event, and the deaths are
    // emitted in battlefield order, so listing the active player's creature
    // first hands the scan an order that is already APNAP order and lets
    // `apnapOrder` be the identity function with this test still green. This
    // way round the incidental order is the wrong one, and CR 603.3b is the
    // only thing that can put it right.
    const start = scenario({
      battlefield: [{ card: theirs, controller: 1 }, { card: mine, controller: 0 }, ...lands(1, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;

    const fought = playCombat(
      { state: start, events: [] },
      {
        attackers: [oidOf(start, 'Ash Sentry')],
        blocks: [{ attacker: oidOf(start, 'Ash Sentry'), blocker: oidOf(start, 'Dusk Sentry') }],
      },
    );

    // Both 2/2s died to the same damage event, so both triggers were waiting
    // together. The active player's went on the stack first, so the defender's
    // resolved first — which is what the log shows, two ability objects
    // resolving in that order.
    const resolutions = eventsOfType(fought.events, 'resolutionBegan')
      .map((event) => event.oid)
      .filter((oid) => oid.startsWith('ab'));
    expect(resolutions).toHaveLength(2);
    const order = fought.events
      .filter((event) => event.type === 'cardDrawn' || event.type === 'cardsMilled')
      .map((event) => event.type);
    expect(order).toEqual(['cardDrawn', 'cardsMilled']);
  });

  /**
   * The same fixture with the seats swapped, and it is the one that reads
   * `state.turn.active`.
   *
   * The test above proves that a reordering happens; it cannot prove what the
   * reordering keys on, because player 0 is the active player there and
   * `const active = 0` produces exactly the same stack. Here player 1 is
   * active and player 0's creature is listed first, so the incidental order is
   * again the wrong one and the constant is again the wrong answer. This time
   * the wrong answer is the *other* order, and the two tests together
   * leave `apnapOrder` no constant it can be written with.
   */
  it('reads the active player off the turn rather than assuming player 0', () => {
    const mine = creature('Ash Sentry', 2, 2, { abilities: [MILL_ON_DEATH] });
    const theirs = creature('Dusk Sentry', 2, 2, { abilities: [DRAW_ON_DEATH] });
    const start = scenario({
      battlefield: [{ card: mine, controller: 0 }, { card: theirs, controller: 1 }, ...lands(1, 1)],
      active: 1,
      step: 'declareAttackers',
    }).state;
    expect(start.turn.active).toBe(1);

    const fought = playCombat(
      { state: start, events: [] },
      {
        attackers: [oidOf(start, 'Dusk Sentry')],
        blocks: [{ attacker: oidOf(start, 'Dusk Sentry'), blocker: oidOf(start, 'Ash Sentry') }],
      },
    );

    const resolutions = eventsOfType(fought.events, 'resolutionBegan')
      .map((event) => event.oid)
      .filter((oid) => oid.startsWith('ab'));
    expect(resolutions).toHaveLength(2);
    // Player 1 is active, so player 1's draw went on the stack first and player
    // 0's mill resolved first. Reading player 0 as active gives the order the
    // test above expects, which is why that one alone pins nothing.
    const order = fought.events
      .filter((event) => event.type === 'cardDrawn' || event.type === 'cardsMilled')
      .map((event) => event.type);
    expect(order).toEqual(['cardsMilled', 'cardDrawn']);
  });
});

describe('the id an ability object is minted with', () => {
  it('advances the shared counter, so no later object can be given it again', () => {
    const herald = creature('Tide Herald', 2, 2, { cost: { generic: 1, W: 1 }, abilities: [GAIN_TWO] });
    const start = scenario({ battlefield: lands(4, 0), hands: [[herald, herald], []] }).state;

    const first = apply(apply(castFromHand(start, 0, 'Tide Herald'), { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    const firstOid = abilitiesOnStack(first.state)[0]?.oid ?? '';
    expect(firstOid).not.toBe('');
    // The counter moved by exactly the one id this ability took. Leaving it
    // where it was costs nothing until the next mint, and then hands out an id
    // that is already in play.
    expect(first.state.nextId).toBe(start.nextId + 1);

    const settled = apply(apply(first, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    expect(abilitiesOnStack(settled.state)).toEqual([]);

    const second = apply(
      apply(castFromHand(settled.state, 0, 'Tide Herald'), { type: 'passPriority', player: 0 }),
      { type: 'passPriority', player: 1 },
    );
    const secondOid = abilitiesOnStack(second.state)[0]?.oid ?? '';
    expect(secondOid).not.toBe('');
    expect(secondOid).not.toBe(firstOid);
    expect(second.state.nextId).toBe(settled.state.nextId + 1);
  });
});

describe('an attack trigger', () => {
  it('fires when attackers are declared, and the attack still happens', () => {
    const raider = creature('Ember Raider', 2, 2, { abilities: [GAIN_ONE_ON_ATTACK] });
    const start = scenario({
      battlefield: [{ card: raider, controller: 0 }, ...lands(1, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, 'Ember Raider');

    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });

    const waiting = abilitiesOnStack(declared.state);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.ability?.sourceOid).toBe(attacker);
    expect(declared.state.combat.attacks.map((attack) => attack.oid)).toEqual([attacker]);
  });
});

describe('what a triggered ability is not', () => {
  it('cannot be countered: "counter target spell" never offers an ability', () => {
    const herald = creature('Tide Herald', 2, 2, { cost: { generic: 1, W: 1 }, abilities: [GAIN_TWO] });
    const counter = instant('Refuse', [{ kind: 'counterSpell' }], { generic: 1, U: 1 });
    const start = scenario({
      battlefield: [...lands(2, 0), { card: ISLAND, controller: 1 }, { card: ISLAND, controller: 1 }],
      hands: [[herald], [counter]],
    }).state;
    // With the creature spell itself on the stack the counter is offered, and
    // it names that spell. This half is what makes the other half evidence
    // rather than an enumeration that happens to be empty.
    const spellOnStack = apply(castFromHand(start, 0, 'Tide Herald'), {
      type: 'passPriority',
      player: 0,
    });
    const spellOid = spellOnStack.state.stack[0]?.oid ?? '';
    const againstSpell = legalActions(spellOnStack.state).flatMap((option: Action) =>
      option.type === 'castSpell' ? option.targets : [],
    );
    expect(againstSpell.some((target) => target !== null && 'oid' in target && target.oid === spellOid)).toBe(
      true,
    );

    const onStack = apply(spellOnStack, { type: 'passPriority', player: 1 });
    const abilityOid = abilitiesOnStack(onStack.state)[0]?.oid ?? '';
    expect(abilityOid).not.toBe('');

    const offered = apply(onStack, { type: 'passPriority', player: 0 });
    expect(offered.state.turn.priority).toBe(1);
    expect(abilitiesOnStack(offered.state).map((entry) => entry.oid)).toEqual([abilityOid]);
    const options = legalActions(offered.state);
    const targeted = options.flatMap((option: Action) => (option.type === 'castSpell' ? option.targets : []));
    expect(targeted.some((target) => target !== null && 'oid' in target && target.oid === abilityOid)).toBe(
      false,
    );
    // "Counter target spell" with nothing but an ability on the stack has no
    // legal target, so it is not castable at all.
    expect(options.some((option: Action) => option.type === 'castSpell')).toBe(false);
  });

  it('does not fire for a board a scenario states, because nothing entered', () => {
    const herald = creature('Stated Herald', 2, 2, { abilities: [GAIN_TWO] });
    const start = scenario({ battlefield: [{ card: herald, controller: 0 }, ...lands(1, 0)] });
    expect(abilitiesOnStack(start.state)).toEqual([]);
    expect(start.state.players[0].life).toBe(20);
  });
});

/**
 * A death trigger watches a zone change with two endpoints, and only one of
 * them is about the battlefield.
 *
 * `conditionsFrom` reads a `zoneChanged` out of the battlefield *into a
 * graveyard*, and the second half is the half nothing held: deleting
 * `event.to === 'graveyard'` left the whole repository green while every
 * printed "when this dies" ability also fired on a bounce. `returnToHand` is a
 * DSL effect kind today, so the wrong reading is reachable from a card the
 * generator could already print, and it is the mechanism the flagship set's
 * boss death-transforms and monster-part drops are built on
 * (the set design document, decisions 6 and 17): a Silver Direhorn
 * that drops its Trophy Horn when an opponent bounces it is the mechanic
 * inverted.
 *
 * Both halves are asserted together, because the bounce alone is also passed by
 * a `conditionsFrom` that never fires a death trigger at all.
 */
describe('what counts as dying', () => {
  const sentry = creature('Ash Sentry', 2, 2, { abilities: [MILL_ON_DEATH] });
  const undertow = instant('Undertow', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
    generic: 1,
  });

  function bounceOwnSentry(): ReduceResult {
    const start = scenario({
      battlefield: [{ card: sentry, controller: 0 }, ...lands(2, 0)],
      hands: [[undertow], []],
    }).state;
    const source = oidOf(start, 'Ash Sentry');
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start, 0, 'Undertow'),
      targets: [{ kind: 'permanent', oid: source }],
    });
    return passUntilQuiet(cast, 10);
  }

  it('does not fire when the creature leaves the battlefield for a hand', () => {
    const settled = bounceOwnSentry();
    const source = Object.keys(settled.state.objects).find(
      (oid) => settled.state.objects[oid]?.card.name === 'Ash Sentry',
    );
    expect(settled.state.objects[source ?? '']?.zone).toBe('hand');
    // The zone change happened, so the scan saw an event with the battlefield
    // as its origin; the trigger is silent because of where it ended.
    expect(eventsOfType(settled.events, 'zoneChanged').map((event) => [event.from, event.to])).toContainEqual(
      ['battlefield', 'hand'],
    );
    expect(abilitiesOnStack(settled.state)).toEqual([]);
    expect(eventsOfType(settled.events, 'cardsMilled')).toEqual([]);
  });

  it('fires when the same creature leaves the battlefield for a graveyard', () => {
    const snuff = instant('Snuff', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const start = scenario({
      battlefield: [{ card: sentry, controller: 0 }, ...lands(2, 0)],
      hands: [[snuff], []],
    }).state;
    const source = oidOf(start, 'Ash Sentry');
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start, 0, 'Snuff'),
      targets: [{ kind: 'permanent', oid: source }],
    });
    const settled = passUntilQuiet(cast, 10);

    expect(settled.state.objects[source]?.zone).toBe('graveyard');
    expect(eventsOfType(settled.events, 'cardsMilled')).toHaveLength(1);
  });
});

describe('a token entering', () => {
  it('emits its own arrival, and carries no ability to fire from it', () => {
    const maker = creature('Spark Warden', 2, 2, {
      cost: { generic: 1, R: 1 },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Spark',
                power: 1,
                toughness: 1,
                colors: ['R'],
                subtypes: ['Elemental'],
                keywords: [],
              },
            },
          ],
        },
      ],
    });
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[maker], []],
    }).state;
    const onStack = apply(
      apply(castFromHand(start, 0, 'Spark Warden'), { type: 'passPriority', player: 0 }),
      {
        type: 'passPriority',
        player: 1,
      },
    );
    const resolved = passUntilQuiet(onStack, 10);

    const tokens = resolved.state.battlefield.filter(
      (oid: ObjectId) => resolved.state.objects[oid]?.card.name === 'Spark',
    );
    expect(tokens).toHaveLength(1);
    // The token entered through the shared arrival path, so it emitted the
    // entry event — and it carries no ability, so nothing fired from it.
    expect(eventsOfType(resolved.events, 'permanentEntered').map((event) => event.oid)).toContain(
      tokens[0] ?? '',
    );
    expect(abilitiesOnStack(resolved.state)).toEqual([]);
  });
});

/**
 * One condition, two events, and the count that makes it a disjunction rather
 * than a double.
 *
 * `selfEntersOrAttacks` is the M11 Titan cycle's watch (CR 603.6e for the
 * arrival half, CR 508.1 for the attack half), and `conditionsFrom` answers it
 * from two different arms: the `permanentEntered` arm returns it beside
 * `selfEnters`, the `attackersDeclared` arm beside `selfAttacks`. The failure
 * that shape invites is a second match on one event — returning the disjunctive
 * condition twice from the arrival arm, or leaving the entering permanent in
 * the attack arm's list — and it is invisible to a test that only asks whether
 * the trigger fired. So every assertion here is a length or an array of
 * conditions, never a `toContain`.
 */
describe('a trigger that watches an arrival or an attack', () => {
  const ENTERS_OR_ATTACKS: AbilityInput = {
    kind: 'triggered',
    condition: 'selfEntersOrAttacks',
    effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
  };

  const colossus = creature('Dawn Colossus', 2, 2, {
    cost: { generic: 1, W: 1 },
    abilities: [ENTERS_OR_ATTACKS],
  });

  function colossusEntered(): ReduceResult {
    const start = scenario({ battlefield: lands(2, 0), hands: [[colossus], []] }).state;
    const cast = castFromHand(start, 0, 'Dawn Colossus');
    return apply(apply(cast, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
  }

  it('fires exactly once when the permanent enters, not once per matching condition', () => {
    const entered = colossusEntered();
    const fired = eventsOfType(entered.events, 'abilityTriggered');
    expect(fired.map((event) => [event.source, event.condition])).toEqual([
      [oidOf(entered.state, 'Dawn Colossus'), 'selfEntersOrAttacks'],
    ]);
    expect(abilitiesOnStack(entered.state)).toHaveLength(1);
  });

  it('fires exactly once when the permanent attacks, and the attack still happens', () => {
    const start = scenario({
      battlefield: [{ card: colossus, controller: 0 }, ...lands(1, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, 'Dawn Colossus');

    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });

    expect(
      eventsOfType(declared.events, 'abilityTriggered').map((event) => [event.source, event.condition]),
    ).toEqual([[attacker, 'selfEntersOrAttacks']]);
    expect(abilitiesOnStack(declared.state)).toHaveLength(1);
    expect(declared.state.combat.attacks.map((attack) => attack.oid)).toEqual([attacker]);
  });

  /**
   * The arrival arm still answers `selfEnters`, and the attack arm still
   * answers `selfAttacks`: a card printing both watches gets both, once each,
   * which is the reading that separates "a new condition was added" from "the
   * old conditions were rerouted through it".
   */
  it('leaves the narrow conditions alone: a card printing both gets both, once each', () => {
    const twin = creature('Twin Colossus', 2, 2, {
      cost: { generic: 1, W: 1 },
      abilities: [GAIN_TWO, ENTERS_OR_ATTACKS],
    });
    const start = scenario({ battlefield: lands(2, 0), hands: [[twin], []] }).state;
    const entered = apply(
      apply(castFromHand(start, 0, 'Twin Colossus'), { type: 'passPriority', player: 0 }),
      {
        type: 'passPriority',
        player: 1,
      },
    );

    expect(eventsOfType(entered.events, 'abilityTriggered').map((event) => event.condition)).toEqual([
      'selfEnters',
      'selfEntersOrAttacks',
    ]);
  });

  /**
   * The half that makes the two above evidence. A condition that matched every
   * event would pass both of them and would also fire on a death, a block and
   * a bounce.
   */
  it('stays silent on a death, and on a board a scenario states', () => {
    const stated = scenario({ battlefield: [{ card: colossus, controller: 0 }, ...lands(2, 0)] });
    expect(eventsOfType(stated.events, 'abilityTriggered')).toEqual([]);
    expect(abilitiesOnStack(stated.state)).toEqual([]);

    const snuff = instant('Snuff', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const withRemoval = scenario({
      battlefield: [{ card: colossus, controller: 0 }, ...lands(2, 0)],
      hands: [[snuff], []],
    }).state;
    const source = oidOf(withRemoval, 'Dawn Colossus');
    const killed = passUntilQuiet(
      reduce(withRemoval, {
        type: 'castSpell',
        player: 0,
        oid: handOidOf(withRemoval, 0, 'Snuff'),
        targets: [{ kind: 'permanent', oid: source }],
      }),
      10,
    );

    expect(killed.state.objects[source]?.zone).toBe('graveyard');
    expect(eventsOfType(killed.events, 'abilityTriggered')).toEqual([]);
  });
});
