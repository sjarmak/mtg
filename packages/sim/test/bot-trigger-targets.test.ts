/**
 * The bot has to aim a trigger, and it has to aim it somewhere useful.
 *
 * Risk 3 of `docs/design/dsl-v1-ability-model.md` is the failure this file
 * measures rather than argues: a decision kind the kernel can pose, the bot can
 * technically answer, and no seeded game is any better for. `bot-triggers.test.ts`
 * makes the same argument one layer up, about whether a printed trigger is worth
 * casting; this one is about the two stops CR 603.3 adds after it is cast.
 *
 * Three things have to hold, and each is an assertion here rather than a
 * paragraph:
 *
 * 1. The bot picks by what the aim is worth, not by enumeration order. A pump
 *    goes on its own creature and damage goes at the opponent's, from the same
 *    policy, on the same board.
 * 2. Declining an optional trigger is reachable. A "you may" whose only legal
 *    target is the opponent's creature is a trigger this seat should let go, and
 *    a bot that always accepts would never show the difference.
 * 3. Both stops are reached in a real seeded game through `playSimGame`, at the
 *    decision budget the balance gate runs under, and the actions the bot
 *    submitted are counted. A policy exercised only from `scenario()` is a
 *    policy the balance sweep may never reach.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, Effect } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, AgentView, DeckList, GameState, ObjectId, PlayerAgent, PlayerId } from '@mtg/kernel';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import {
  DEFAULT_GREEDY_CONFIG,
  agentSeed,
  createBot,
  decideGreedy,
  gameSeed,
  greedySpec,
  playSimGame,
  FIXTURE_DECK_RW,
} from '@mtg/sim';
import { creature, instant, FOREST } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

const PUMP_TARGET: Effect = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: 1,
  target: { kind: 'targetCreature' },
};

const BURN_TARGET: Effect = { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } };

function deathTrigger(effect: Effect, optional: boolean): AbilityInput {
  const ability: AbilityInput = { kind: 'triggered', condition: 'selfDies', effects: [effect] };
  return optional ? { ...ability, optional: true } : ability;
}

let collectorNumber = 700;

/** A 2/2 whose only text is one death trigger, so nothing else can move a score. */
function dier(name: string, effect: Effect, optional = false): Card {
  collectorNumber += 1;
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
    abilities: [deathTrigger(effect, optional)],
  };
  return parseCard(input);
}

const PUMPER = dier('Rooted Sprout', PUMP_TARGET);
const BURNER = dier('Ember Sprout', BURN_TARGET);
const MAY_PUMPER = dier('Choosy Sprout', PUMP_TARGET, true);

const KILL: readonly Effect[] = [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }];
const VERDICT = instant('Mortal Verdict', KILL, { generic: 1 }, []);

/**
 * A creature whose enters trigger fights, which is the only shape a fight is
 * legal in (`checkSourceBodyEffectInTrigger`) and the only aim in this file
 * whose score reads the trigger's *source* rather than only its target.
 */
function fighter(name: string, power: number, toughness: number): Card {
  collectorNumber += 1;
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { G: 1 },
    colors: ['G'],
    power,
    toughness,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
      },
    ],
  } satisfies CardInput);
}

function oidOf(state: GameState, name: string): ObjectId {
  const found = Object.entries(state.objects).find(([, object]) => object.card.name === name);
  if (found === undefined) throw new Error(`no object named ${name}`);
  return found[0];
}

/** Pass priority until the kernel asks something that is not a priority. */
function passUntilStop(from: GameState): GameState {
  let state = from;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state, 512);
    if (decision === null) throw new Error('the game ended before the trigger was asked about');
    if (decision.kind !== 'priority') return state;
    if (state.stack.length === 0) throw new Error('the stack emptied without a trigger stop');
    state = step(state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('no trigger stop in 20 decisions');
}

/**
 * Kill `victim` with the removal in seat 0's hand, then pass until the kernel
 * stops for the trigger the death put on the stack.
 */
function untilTriggerStop(board: { state: GameState }, victim: string): { state: GameState } {
  const inHand = board.state.players[0].hand[0];
  if (inHand === undefined) throw new Error('no removal in hand');
  const cast = step(board.state, {
    type: 'castSpell',
    player: 0,
    oid: inHand,
    targets: [{ kind: 'permanent', oid: oidOf(board.state, victim) }],
  });
  return { state: passUntilStop(cast) };
}

/** Every test action goes through `validateAction` first, as the driver's does. */
function step(state: GameState, action: Action): GameState {
  const violation = validateAction(state, action);
  if (violation !== null) throw new Error(`illegal test action: ${violation}`);
  return reduce(state, action).state;
}

/** The board every aiming test uses: one creature each, and removal in hand. */
function twoBodies(dying: Card): { state: GameState } {
  return scenario({
    seed: 'sim/trigger/aim',
    battlefield: [
      { card: dying, controller: 0 },
      { card: creature('Mine', 2, 2), controller: 0 },
      { card: creature('Theirs', 3, 3), controller: 1 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
    hands: [[VERDICT], []],
  });
}

function ask(state: GameState, player: PlayerId = 0): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = decideGreedy({ state, player, decision }, config);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

describe('where the greedy bot aims a trigger it did not choose to put on the stack', () => {
  it('puts a +1/+1 counter on its own creature', () => {
    const { state } = untilTriggerStop(twoBodies(PUMPER), 'Rooted Sprout');
    const action = ask(state);
    expect(action.type).toBe('chooseTriggerTargets');
    if (action.type !== 'chooseTriggerTargets') return;
    const aim = action.targets[0];
    if (aim?.kind !== 'permanent') throw new Error('the trigger was not aimed at a permanent');
    expect(state.objects[aim.oid]?.card.name).toBe('Mine');
  });

  it('aims damage at the creature the opponent controls, from the same policy on the same board', () => {
    const { state } = untilTriggerStop(twoBodies(BURNER), 'Ember Sprout');
    const action = ask(state);
    expect(action.type).toBe('chooseTriggerTargets');
    if (action.type !== 'chooseTriggerTargets') return;
    const aim = action.targets[0];
    if (aim?.kind !== 'permanent') throw new Error('the trigger was not aimed at a permanent');
    expect(state.objects[aim.oid]?.card.name).toBe('Theirs');
  });

  /**
   * The measurement the risk actually asks for: not "an arm exists" but "the
   * arm changes the answer". A policy that scored every aim the same would
   * return the first option on both boards, and the two names above would be
   * the same name.
   */
  it('does not simply take the first option the kernel enumerated', () => {
    const pump = untilTriggerStop(twoBodies(PUMPER), 'Rooted Sprout');
    const burn = untilTriggerStop(twoBodies(BURNER), 'Ember Sprout');
    const chosen = [ask(pump.state), ask(burn.state)];
    const firsts = [pump, burn].map(({ state }) => {
      const decision = pendingDecision(state, 512);
      return decision?.options[0];
    });
    // At least one of the two aims is not the option in slot zero.
    expect(chosen.some((action, index) => JSON.stringify(action) !== JSON.stringify(firsts[index]))).toBe(
      true,
    );
  });
});

/**
 * The one aim whose score reads the source, and the one that used to crash.
 *
 * `targetValue` had the trigger's *stack entry* id where the source's id
 * belongs. Every other primitive ignores the source, so the two were
 * interchangeable until a fight asked the source for its power and the kernel
 * was handed an id that is not a game object at all: `unknown game object` out
 * of `powerOf`, thrown inside a sim worker, which took down the flagship's
 * whole balance subject rather than one game.
 *
 * Aiming it correctly is the other half. A 3/3 that fights takes the target's
 * power back (CR 701.12a), so the 2/2 is a trade this seat wins and the 5/5 is
 * one it does not survive, and a policy that could not see its own body would
 * have no way to tell those apart.
 */
describe('where the greedy bot aims a fight, which is scored off the body it fights with', () => {
  const FIGHTER = fighter('Bramble Charger', 3, 3);

  function castingTheFighter(): GameState {
    const board = scenario({
      seed: 'sim/trigger/fight',
      battlefield: [
        { card: creature('Weakling', 2, 2), controller: 1 },
        { card: creature('Titan', 5, 5), controller: 1 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[FIGHTER], []],
    });
    const inHand = board.state.players[0].hand[0];
    if (inHand === undefined) throw new Error('no fighter in hand');
    return passUntilStop(step(board.state, { type: 'castSpell', player: 0, oid: inHand, targets: [] }));
  }

  it('asks the kernel for an aim rather than throwing on the trigger it just made', () => {
    const state = castingTheFighter();
    expect(() => ask(state)).not.toThrow();
  });

  it('fights the body it beats rather than the one that kills it back', () => {
    const state = castingTheFighter();
    const action = ask(state);
    expect(action.type).toBe('chooseTriggerTargets');
    if (action.type !== 'chooseTriggerTargets') return;
    const aim = action.targets[0];
    if (aim?.kind !== 'permanent') throw new Error('the fight was not aimed at a permanent');
    expect(state.objects[aim.oid]?.card.name).toBe('Weakling');
  });
});

describe('whether the greedy bot takes an optional trigger', () => {
  it('takes it when the counter can go on its own creature', () => {
    const { state } = untilTriggerStop(twoBodies(MAY_PUMPER), 'Choosy Sprout');
    // Aiming is one stop and the "you may" is another: the ability sits on the
    // stack in between, and both players hold priority over it (CR 603.3d then
    // CR 603.3b).
    const aimed = passUntilStop(step(state, ask(state)));
    const action = ask(aimed);
    expect(action).toEqual({
      type: 'answerOptionalTrigger',
      player: 0,
      oid: aimed.stack[aimed.stack.length - 1]?.oid,
      accept: true,
    });
  });

  /**
   * Declining is reachable, which is the half a bot that always accepts hides.
   * The only creature left when this one dies belongs to the opponent, so the
   * one legal aim makes their board better and this seat says no.
   */
  it('declines when the only legal aim is a creature the opponent controls', () => {
    const board = scenario({
      seed: 'sim/trigger/decline',
      battlefield: [
        { card: MAY_PUMPER, controller: 0 },
        { card: creature('Theirs', 3, 3), controller: 1 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[VERDICT], []],
    });
    const { state } = untilTriggerStop(board, 'Choosy Sprout');
    const aimed = passUntilStop(step(state, ask(state)));
    const action = ask(aimed);
    expect(action.type).toBe('answerOptionalTrigger');
    if (action.type !== 'answerOptionalTrigger') return;
    expect(action.accept).toBe(false);
  });
});

/**
 * The same two stops through `playSimGame`, which is what the balance gate runs.
 *
 * The agent is the real greedy bot with a recorder around it, so the count is of
 * actions the driver actually submitted to the reducer under the decision budget
 * and enumeration caps a sweep uses. A trigger the bot answers only in a
 * hand-built scenario is a trigger the sweep may never reach.
 *
 * At this seed the eight games produce 21 aimed triggers, 18 of them at a
 * creature this seat controls, 13 optional triggers taken and 1 declined. The
 * assertions below are the parts of that which must not regress; the numbers
 * themselves are what a bot that never used the mechanic would report as zeros.
 */
const RUN_SEED = 'sim/trigger/aimed-game';
const GAMES = 8;

function sproutDeck(): DeckList {
  const cards: Card[] = [];
  for (let slot = 0; slot < 12; slot += 1) cards.push(MAY_PUMPER);
  for (let slot = 0; slot < 11; slot += 1) cards.push(PUMPER);
  const forest = basicLand('Forest', 'TST', 799);
  for (let slot = 0; slot < 17; slot += 1) cards.push(forest);
  return { name: 'Sprouts', cards };
}

const DECKS: readonly [DeckList, DeckList] = [sproutDeck(), FIXTURE_DECK_RW];

interface Tally {
  aimed: number;
  accepted: number;
  declined: number;
  aimedAtOwn: number;
}

function recording(inner: PlayerAgent, tally: Tally): PlayerAgent {
  return {
    name: inner.name,
    decide(view: AgentView): Action {
      const action = inner.decide(view);
      if (action.type === 'chooseTriggerTargets') {
        tally.aimed += 1;
        const aim = action.targets[0];
        if (aim?.kind === 'permanent' && view.state.objects[aim.oid]?.controller === view.player) {
          tally.aimedAtOwn += 1;
        }
      }
      if (action.type === 'answerOptionalTrigger') {
        if (action.accept) tally.accepted += 1;
        else tally.declined += 1;
      }
      return action;
    },
  };
}

const TALLY: Tally = { aimed: 0, accepted: 0, declined: 0, aimedAtOwn: 0 };

for (let index = 0; index < GAMES; index += 1) {
  const seed = gameSeed(RUN_SEED, index);
  playSimGame({
    index,
    seed,
    decks: DECKS,
    agents: [
      recording(createBot(greedySpec('greedy-sprout'), agentSeed(RUN_SEED, index, 0), 0), TALLY),
      createBot(greedySpec('greedy-rw'), agentSeed(RUN_SEED, index, 1), 1),
    ],
    startingPlayer: index % 2 === 0 ? 0 : 1,
    log: null,
  });
}

describe('both trigger stops in seeded games under the balance gate budget', () => {
  it('reaches the targeting stop and answers it', () => {
    expect(TALLY.aimed).toBeGreaterThan(0);
  });

  it('reaches the optional stop and answers it', () => {
    expect(TALLY.accepted + TALLY.declined).toBeGreaterThan(0);
  });

  it('aims most of its counters at a creature it controls', () => {
    // Not all: a board where the only creature left is the opponent's leaves
    // one legal aim, and the mandatory trigger has to take it.
    expect(TALLY.aimedAtOwn * 2).toBeGreaterThan(TALLY.aimed);
  });
});
