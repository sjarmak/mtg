/**
 * CR 603.3d targeted triggers and CR 603.3b optional ones, driven through the
 * reducer.
 *
 * Two rules, one ability, two different moments. Targets are chosen as the
 * ability is *put on the stack*, before anyone can respond to it; the "you may"
 * is answered as it *resolves*, after everyone has. Every assertion here is
 * about which of those two moments a question was asked at and what the log said
 * about it, because "the counter landed" is also what a spell does.
 *
 * The log matters more here than anywhere else in the kernel. A decision variant
 * that is not recorded, or that replays in a different order, silently corrupts
 * every recorded game — so the last describe block plays a seeded game
 * containing both stops, replays it from its choice list, and compares the
 * events, the choices, the fingerprint and the result.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import type { Action, GameSession, GameState, ObjectId, ReduceResult, StackEntry } from '@mtg/kernel';
import {
  botSeat,
  choose,
  createSession,
  eventsOfType,
  humanSeat,
  legalActions,
  pendingDecision,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { apply, oidOf } from './helpers';

/** "When this dies, put a +1/+1 counter on target creature." */
const PUMP_ON_DEATH: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  effects: [{ kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } }],
};

/** The same ability with CR 603.3b's permission on it, which is Fuse's shape. */
const MAY_PUMP_ON_DEATH: AbilityInput = { ...PUMP_ON_DEATH, optional: true };

/** "When this enters, it deals 2 damage to any target." */
const BOLT_ON_ENTER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
};

const KILL: readonly [{ kind: 'destroyPermanent'; target: { kind: 'targetCreature' } }] = [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
];

function abilitiesOnStack(state: GameState): readonly StackEntry[] {
  return state.stack.filter((entry) => entry.ability !== null);
}

/**
 * Passes priority until the stack has emptied or the kernel asks something that
 * is not a priority.
 *
 * Both exits matter. A trigger that owes targets stops the reducer, so the
 * question is what this returns at; a trigger that had no legal target was
 * removed before anyone was asked, so an empty stack is what it returns at
 * instead, and a helper that only knew about the first would hang on the second.
 */
function passUntilQuiet(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('passUntilQuiet: the stack never emptied and nothing else was asked');
}

/** The one object with this card name, in any zone. */
function anyOidOf(state: GameState, name: string): ObjectId {
  const found = Object.values(state.objects).find((object) => object.card.name === name);
  if (found === undefined) throw new Error(`no object named ${name}`);
  return found.oid;
}

describe('a trigger that targets stops the reducer when it goes on the stack', () => {
  /** A doomed creature with a death trigger, and two creatures to aim it at. */
  function board(ability: AbilityInput = PUMP_ON_DEATH) {
    const doomed = creature('Bramble Sprout', 2, 2, { abilities: [ability] });
    const friend = creature('Thornwood Scrub', 1, 1);
    const enemy = creature('Marauder', 3, 3);
    const bolt = instant('Mortal Verdict', KILL, { generic: 1 });
    const start = scenario({
      battlefield: [
        { card: doomed, controller: 0 },
        { card: friend, controller: 0 },
        { card: enemy, controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[bolt], []],
    });
    return { start, doomed, friend, enemy, bolt };
  }

  /** Kills the trigger's source, which fires it. */
  function killTheSource(): ReduceResult {
    const { start } = board();
    const state = start.state;
    const verdict = state.players[0].hand[0];
    if (verdict === undefined) throw new Error('no removal in hand');
    return apply(
      { state, events: [...start.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: verdict,
        targets: [{ kind: 'permanent', oid: oidOf(state, 'Bramble Sprout') }],
      },
    );
  }

  it('asks the controller to aim it, with the ability already on the stack (CR 603.3d)', () => {
    const cast = killTheSource();
    const resolved = passUntilQuiet(cast);
    const decision = pendingDecision(resolved.state);

    expect(decision?.kind).toBe('triggerTargets');
    expect(decision?.player).toBe(0);
    // "Put on the stack, *then* choose targets" is the whole of CR 603.3d, and
    // it is what makes this a stop rather than a field on the trigger.
    expect(abilitiesOnStack(resolved.state).length).toBe(1);
  });

  it('offers every legal target and nothing else', () => {
    const resolved = passUntilQuiet(killTheSource());
    const decision = pendingDecision(resolved.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('no trigger is being aimed');

    const aimed = decision.options.map((option) =>
      option.type === 'chooseTriggerTargets' ? option.targets[0] : null,
    );
    // Both creatures still on the battlefield: the source is in the graveyard,
    // so it is not among them. "Target creature" is any creature, both sides.
    expect(aimed).toEqual([
      { kind: 'permanent', oid: oidOf(resolved.state, 'Thornwood Scrub') },
      { kind: 'permanent', oid: oidOf(resolved.state, 'Marauder') },
    ]);
    expect(decision.complete).toBe(true);
    // The source is in the graveyard by now and the ability resolves anyway
    // (CR 608.2), so the decision names an object the battlefield no longer has.
    expect(decision.source).toBe(anyOidOf(resolved.state, 'Bramble Sprout'));
  });

  it('records the choice on the entry and in the log, then hands priority back', () => {
    const resolved = passUntilQuiet(killTheSource());
    const friend = oidOf(resolved.state, 'Thornwood Scrub');
    const aimed = apply(resolved, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: abilitiesOnStack(resolved.state)[0]?.oid ?? 'missing',
      targets: [{ kind: 'permanent', oid: friend }],
    });

    const entry = abilitiesOnStack(aimed.state)[0];
    expect(entry?.targets).toEqual([{ kind: 'permanent', oid: friend }]);
    const chosen = eventsOfType(aimed.events, 'triggerTargetsChosen');
    expect(chosen.length).toBe(1);
    expect(chosen[0]?.targets).toEqual([{ kind: 'permanent', oid: friend }]);
    // Somebody has priority with the ability on the stack, which is what makes
    // a targeted trigger respondable.
    expect(pendingDecision(aimed.state)?.kind).toBe('priority');
  });

  it('resolves onto the target that was chosen', () => {
    const resolved = passUntilQuiet(killTheSource());
    const friend = oidOf(resolved.state, 'Thornwood Scrub');
    const aimed = apply(resolved, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: abilitiesOnStack(resolved.state)[0]?.oid ?? 'missing',
      targets: [{ kind: 'permanent', oid: friend }],
    });
    const done = passUntilQuiet(aimed);
    expect(done.state.objects[friend]?.counters.plusOnePlusOne).toBe(1);
    expect(abilitiesOnStack(done.state).length).toBe(0);
  });

  it('refuses every other action while the question stands', () => {
    const resolved = passUntilQuiet(killTheSource());
    const entry = abilitiesOnStack(resolved.state)[0]?.oid ?? 'missing';
    const friend = oidOf(resolved.state, 'Thornwood Scrub');
    const aim = (action: Action): string | null => validateAction(resolved.state, action);

    expect(aim({ type: 'passPriority', player: 0 })).toBe('you owe a different decision first');
    expect(aim({ type: 'chooseTriggerTargets', player: 1, oid: entry, targets: [] })).toBe(
      "it is player 0's decision",
    );
    expect(aim({ type: 'chooseTriggerTargets', player: 0, oid: 'ab999', targets: [] })).toContain(
      'is the trigger being aimed',
    );
    // An answer that settles nothing, and one that claims more slots than the
    // ability has. The two are separate messages because the sequenced shape
    // takes any answer in between: `triggerTargetsDecision` may ask this trigger
    // one slot at a time when the board is too wide to list the whole product.
    expect(aim({ type: 'chooseTriggerTargets', player: 0, oid: entry, targets: [] })).toBe(
      'at least one more target slot must be chosen',
    );
    expect(
      aim({
        type: 'chooseTriggerTargets',
        player: 0,
        oid: entry,
        targets: [
          { kind: 'permanent', oid: friend },
          { kind: 'permanent', oid: friend },
        ],
      }),
    ).toBe('one target slot per effect is required');
    expect(
      aim({
        type: 'chooseTriggerTargets',
        player: 0,
        oid: entry,
        targets: [{ kind: 'player', player: 1 }],
      }),
    ).toBe('illegal target for effect 0');
    // The legal one, for contrast: the guard is not simply refusing everything.
    expect(
      aim({
        type: 'chooseTriggerTargets',
        player: 0,
        oid: entry,
        targets: [{ kind: 'permanent', oid: friend }],
      }),
    ).toBeNull();
  });
});

describe('a trigger with no legal target is removed rather than asked (CR 603.3d)', () => {
  it('never raises a decision, and says why in the log', () => {
    // The only creature on the battlefield is the one dying, so by the time the
    // death trigger is put on the stack there is nothing left to put a counter
    // on. CR 603.3d removes it; nobody is asked anything.
    const doomed = creature('Lonely Sprout', 2, 2, { abilities: [PUMP_ON_DEATH] });
    const verdict = instant('Mortal Verdict', KILL, { generic: 1 });
    const start = scenario({
      battlefield: [
        { card: doomed, controller: 0 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[verdict], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no removal in hand');
    const cast = apply(
      { state: start.state, events: [...start.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Lonely Sprout') }],
      },
    );
    const settled = passUntilQuiet(cast);

    expect(pendingDecision(settled.state)?.kind).toBe('priority');
    expect(abilitiesOnStack(settled.state).length).toBe(0);
    const removed = eventsOfType(settled.events, 'triggerRemoved');
    expect(removed.length).toBe(1);
    expect(removed[0]?.why).toBe('no legal targets');
    // Not a fizzle: CR 608.2b is about targets that have gone illegal since
    // they were chosen, and this ability never chose any.
    expect(eventsOfType(settled.events, 'spellFizzled').length).toBe(0);
    expect(eventsOfType(settled.events, 'triggerTargetsChosen').length).toBe(0);
  });

  it('checks every trigger that owes targets, not only the first one that has some', () => {
    // The removal pass walks the stack, and one trigger that can be aimed used
    // to end the walk. Two triggers from one death is the smallest board that
    // tells the difference: the counter finds the survivor, the naturalize
    // finds nothing, and the second is the one CR 603.3d is about.
    //
    // The flagship found this in combat rather than here. Two creatures with
    // `selfAttacks` triggers attacked a player with an empty board; the one
    // aimed at `targetCreature` could point at an attacker, ended the walk, and
    // left the one aimed at `targetCreatureDefendingPlayerControls` on the
    // stack with nothing to choose from. `chooseTriggerTargets` then threw
    // rather than answer a question with no legal answer, which killed a
    // 10,035-game gate in a sim worker.
    const doomed = creature('Twinned Sprout', 2, 2, {
      abilities: [
        PUMP_ON_DEATH,
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
        },
      ],
    });
    const survivor = creature('Thornwood Scrub', 1, 1);
    const verdict = instant('Mortal Verdict', KILL, { generic: 1 });
    const start = scenario({
      battlefield: [
        { card: doomed, controller: 0 },
        { card: survivor, controller: 0 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[verdict], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no removal in hand');
    const cast = apply(
      { state: start.state, events: [...start.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Twinned Sprout') }],
      },
    );

    // The counter trigger is a real question and is asked; the naturalize is
    // removed before anybody is asked anything. What must never happen is the
    // third case: a `triggerTargets` decision carrying no options at all.
    const settled = passUntilQuiet(cast);
    const asked = pendingDecision(settled.state);
    expect(asked?.kind).toBe('triggerTargets');
    if (asked?.kind === 'triggerTargets') expect(asked.options.length).toBeGreaterThan(0);

    const removed = eventsOfType(settled.events, 'triggerRemoved');
    expect(removed.length).toBe(1);
    expect(removed[0]?.why).toBe('no legal targets');
  });
});

describe('an optional trigger is answered as it resolves (CR 603.3b)', () => {
  function board(ability: AbilityInput) {
    const doomed = creature('Bramble Sprout', 2, 2, { abilities: [ability] });
    const friend = creature('Thornwood Scrub', 1, 1);
    const verdict = instant('Mortal Verdict', KILL, { generic: 1 });
    const start = scenario({
      battlefield: [
        { card: doomed, controller: 0 },
        { card: friend, controller: 0 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[verdict], []],
    });
    const inHand = start.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no removal in hand');
    const cast = apply(
      { state: start.state, events: [...start.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Bramble Sprout') }],
      },
    );
    return passUntilQuiet(cast);
  }

  /** Fires the trigger, aims it at the surviving friend, and lets it resolve. */
  function untilAsked(ability: AbilityInput): { readonly run: ReduceResult; readonly friend: ObjectId } {
    const asked = board(ability);
    const friend = oidOf(asked.state, 'Thornwood Scrub');
    const aimed = apply(asked, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: abilitiesOnStack(asked.state)[0]?.oid ?? 'missing',
      targets: [{ kind: 'permanent', oid: friend }],
    });
    return { run: passUntilQuiet(aimed), friend };
  }

  it('chooses targets first and asks the permission second', () => {
    const { run } = untilAsked(MAY_PUMP_ON_DEATH);
    const decision = pendingDecision(run.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('no optional trigger is resolving');

    // Both players have already had priority with the ability on the stack: the
    // question arrives at resolution, not at announcement.
    expect(decision.player).toBe(0);
    expect(decision.targets).toEqual([{ kind: 'permanent', oid: oidOf(run.state, 'Thornwood Scrub') }]);
    expect(decision.options).toEqual([
      { type: 'answerOptionalTrigger', player: 0, oid: decision.oid, accept: true },
      { type: 'answerOptionalTrigger', player: 0, oid: decision.oid, accept: false },
    ]);
    expect(decision.complete).toBe(true);
    // Nothing has resolved yet, and the log says nothing has.
    expect(eventsOfType(run.events, 'resolutionBegan').some((e) => e.oid === decision.oid)).toBe(false);
  });

  it('resolves the ability when it is taken', () => {
    const { run, friend } = untilAsked(MAY_PUMP_ON_DEATH);
    const oid = abilitiesOnStack(run.state)[0]?.oid ?? 'missing';
    const taken = apply(run, { type: 'answerOptionalTrigger', player: 0, oid, accept: true });

    expect(taken.state.objects[friend]?.counters.plusOnePlusOne).toBe(1);
    expect(abilitiesOnStack(taken.state).length).toBe(0);
    expect(eventsOfType(taken.events, 'triggerDeclined').length).toBe(0);
    // One resolution for this ability, and exactly one: stopping to ask must
    // not report the resolution twice.
    expect(eventsOfType(taken.events, 'resolutionBegan').filter((e) => e.oid === oid).length).toBe(1);
    expect(pendingDecision(taken.state)?.kind).toBe('priority');
  });

  it('records a decline as a decision rather than as nothing happening', () => {
    const { run, friend } = untilAsked(MAY_PUMP_ON_DEATH);
    const oid = abilitiesOnStack(run.state)[0]?.oid ?? 'missing';
    const declined = apply(run, { type: 'answerOptionalTrigger', player: 0, oid, accept: false });

    expect(declined.state.objects[friend]?.counters.plusOnePlusOne).toBe(0);
    expect(abilitiesOnStack(declined.state).length).toBe(0);
    const said = eventsOfType(declined.events, 'triggerDeclined');
    expect(said.length).toBe(1);
    expect(said[0]?.oid).toBe(oid);
    // A declined ability never resolved, and the log does not claim it did.
    expect(eventsOfType(declined.events, 'resolutionBegan').some((e) => e.oid === oid)).toBe(false);
    expect(pendingDecision(declined.state)?.kind).toBe('priority');
  });

  it('never asks when every target has gone illegal (CR 608.2b before CR 603.3b)', () => {
    // The chosen target is bounced in response, so by the time the ability
    // resolves there is nothing to put a counter on. A "may" offered here would
    // be a choice between two identical futures.
    const doomed = creature('Bramble Sprout', 2, 2, { abilities: [MAY_PUMP_ON_DEATH] });
    const friend = creature('Thornwood Scrub', 1, 1);
    const verdict = instant('Mortal Verdict', KILL, { generic: 1 });
    const bounce = instant('Undertow Snare', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
      generic: 1,
    });
    const start = scenario({
      battlefield: [
        { card: doomed, controller: 0 },
        { card: friend, controller: 0 },
        ...lands(FOREST, 4).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[verdict, bounce], []],
    });
    const [verdictOid, bounceOid] = start.state.players[0].hand;
    if (verdictOid === undefined || bounceOid === undefined) throw new Error('hand is short');

    const cast = apply(
      { state: start.state, events: [...start.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: verdictOid,
        targets: [{ kind: 'permanent', oid: oidOf(start.state, 'Bramble Sprout') }],
      },
    );
    const asked = passUntilQuiet(cast);
    const scrub = oidOf(asked.state, 'Thornwood Scrub');
    const aimed = apply(asked, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: abilitiesOnStack(asked.state)[0]?.oid ?? 'missing',
      targets: [{ kind: 'permanent', oid: scrub }],
    });
    // In response to its own trigger, take the target away.
    const responded = apply(aimed, {
      type: 'castSpell',
      player: 0,
      oid: bounceOid,
      targets: [{ kind: 'permanent', oid: scrub }],
    });
    const settled = passUntilQuiet(responded);

    expect(pendingDecision(settled.state)?.kind).toBe('priority');
    expect(abilitiesOnStack(settled.state).length).toBe(0);
    expect(eventsOfType(settled.events, 'triggerDeclined').length).toBe(0);
    expect(eventsOfType(settled.events, 'effectSkipped').length).toBeGreaterThan(0);
  });
});

describe('two triggers that fire together are aimed one at a time', () => {
  it('asks about the bottom-most one first, which is the order they went on', () => {
    // One permanent, two different death triggers, so both fire from one event
    // and both owe targets. CR 603.3b puts them on the stack in order and
    // chooses each one's targets as it goes on, so the bottom-most entry is the
    // one being asked about.
    const twice = creature('Twin Sprout', 2, 2, {
      abilities: [
        PUMP_ON_DEATH,
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const verdict = instant('Mortal Verdict', KILL, { generic: 1 });
    const board = scenario({
      battlefield: [
        { card: twice, controller: 0 },
        { card: creature('Marauder', 3, 3), controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[verdict], []],
    });
    const inHand = board.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no removal in hand');
    const cast = apply(
      { state: board.state, events: [...board.events] },
      {
        type: 'castSpell',
        player: 0,
        oid: inHand,
        targets: [{ kind: 'permanent', oid: oidOf(board.state, 'Twin Sprout') }],
      },
    );
    const asked = passUntilQuiet(cast);

    expect(abilitiesOnStack(asked.state).length).toBe(2);
    const first = pendingDecision(asked.state);
    if (first?.kind !== 'triggerTargets') throw new Error('the first trigger was not asked about');
    expect(first.oid).toBe(abilitiesOnStack(asked.state)[0]?.oid);

    const marauder = oidOf(asked.state, 'Marauder');
    const aimedOnce = apply(asked, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: first.oid,
      targets: [{ kind: 'permanent', oid: marauder }],
    });
    // The second question arrives from a settle that never saw the triggers
    // fire, which is why the pending entry is derived from the stack rather
    // than handed along from the push.
    const second = pendingDecision(aimedOnce.state);
    if (second?.kind !== 'triggerTargets') throw new Error('the second trigger was not asked about');
    expect(second.oid).not.toBe(first.oid);
    expect(second.oid).toBe(abilitiesOnStack(aimedOnce.state)[1]?.oid);

    const aimedTwice = apply(aimedOnce, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: second.oid,
      targets: [{ kind: 'permanent', oid: marauder }],
    });
    expect(pendingDecision(aimedTwice.state)?.kind).toBe('priority');
    // Both are on the stack, aimed, and resolve last-on-first-off.
    expect(abilitiesOnStack(aimedTwice.state).every((entry) => entry.targets.length === 1)).toBe(true);
  });
});

describe('the enumeration a bot sees includes both stops', () => {
  it('lists the trigger decisions through `legalActions` like any other', () => {
    const doomed = creature('Bramble Sprout', 2, 2, { abilities: [BOLT_ON_ENTER] });
    const withLands = scenario({
      battlefield: [
        { card: creature('Marauder', 3, 3), controller: 1 },
        ...lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[doomed], []],
    });
    const inHand = withLands.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('nothing in hand');
    const cast = apply(
      { state: withLands.state, events: [...withLands.events] },
      { type: 'castSpell', player: 0, oid: inHand, targets: [] },
    );
    const asked = passUntilQuiet(cast);

    const actions = legalActions(asked.state);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.type === 'chooseTriggerTargets')).toBe(true);
    // "Any target" reaches both players and every creature, the source included
    // — it entered, it did not die.
    expect(actions.length).toBe(4);
  });
});

describe('a recorded game containing both stops replays byte for byte', () => {
  /**
   * The invariant the auto-pass work established, applied to the two new
   * decision variants: a game is a seed plus a list of small integers, so a
   * variant that is not appended to `session.choices`, or that is enumerated in
   * a different order on the way back, corrupts every recording silently.
   *
   * The human seat answers every question by taking the *last* option, which is
   * deliberately not the default: for a "you may" the last option is the
   * decline, so the recording contains declines, and a replay that silently
   * skipped the question would land its integers one answer late.
   *
   * The opening hand is the one question it answers with the first option
   * instead, and the reason is worth stating: a mulligan is enumerated last (CR
   * 103.4, `mulligan.ts`), so "take the last option" there means mulligan again,
   * and the seat would play the whole game from an empty hand and never cast the
   * creature whose trigger this file is about. Index 0 is the keep.
   */
  const SPROUT = creature('Bramble Sprout', 2, 2, {
    cost: { generic: 1 },
    abilities: [MAY_PUMP_ON_DEATH],
  });
  const CHARGER = creature('Marauder Charger', 2, 2, { cost: { generic: 2 }, abilities: [BOLT_ON_ENTER] });

  const deck = (name: string) => ({
    name,
    cards: [
      ...lands(FOREST, 12),
      ...Array.from({ length: 6 }, () => SPROUT),
      ...Array.from({ length: 6 }, () => CHARGER),
    ],
  });

  const SETUP = {
    seed: 'targeted-triggers/v0',
    decks: [deck('Sprouts'), deck('Chargers')] as const,
    maximumTurns: 12,
  };

  const seats = () => [humanSeat('person'), botSeat(simpleAgent('bot'))] as const;

  function playToTheEnd(): GameSession {
    let session: GameSession = createSession(SETUP, seats());
    for (let guard = 0; guard < 20_000; guard += 1) {
      const decision = session.pending;
      if (decision === null) return session;
      session = choose(session, decision.kind === 'mulligan' ? 0 : decision.options.length - 1);
    }
    throw new Error('the session never stopped asking');
  }

  const played = playToTheEnd();

  it('asks both trigger questions during the game', () => {
    // Not vacuous: the whole assertion below is worthless if the game contained
    // no trigger stop at all.
    const targeted = eventsOfType(played.events, 'triggerTargetsChosen');
    const declined = eventsOfType(played.events, 'triggerDeclined');
    expect(targeted.length, 'no trigger was ever aimed').toBeGreaterThan(0);
    expect(declined.length, 'no optional trigger was ever declined').toBeGreaterThan(0);
  });

  it('replays into the same events, choices, position and result', () => {
    const replayed = replaySession(SETUP, seats(), played.choices, {});

    expect(replayed.choices).toEqual(played.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(replayed.result).toEqual(played.result);
    expect(replayed.decisions).toBe(played.decisions);
  });

  it('plays the same game twice from the same seed', () => {
    expect(JSON.stringify(playToTheEnd().choices)).toBe(JSON.stringify(played.choices));
  });
});
