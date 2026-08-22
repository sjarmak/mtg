/**
 * Auto-pass, stops and yields.
 *
 * The load-bearing test in this file is in "the recorded game does not know the
 * structural rule was on": the same seeded game, played by the same driver,
 * records byte-identical events and byte-identical choices with the structural
 * rule on and with it off. Everything else here checks a property that test
 * would not notice if it broke — that the predicate fires on one option and not
 * two, that a stop set both adds and removes questions, that a stop is
 * one-sided, that a stop with nothing to offer asks nothing at all while one
 * with a play in it still asks, that full control means what it says, and that a
 * yield hands the game back the moment the other seat casts something this
 * player could answer.
 *
 * **Three of these blocks turn on how the game is driven, and the drives are not
 * interchangeable.** A player who only ever passes never puts a land on the
 * battlefield, so nearly every priority they reach is a single option and every
 * rule below looks like it is working. A player driven by the mirror bot spends
 * every instant it draws and never holds an answer to anything. The rules about
 * responding are measured against `holdingATrick`, which plays lands and
 * creatures and keeps its instants, because that player has an answer at some
 * opposing spells and none at the others.
 *
 * The measurement at the end is the point of the whole feature and is asserted
 * rather than recorded in prose, so the next change to any of this has a number
 * to be compared against.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { exampleCard, parseCard } from '@mtg/dsl';
import type {
  AutoPassSettings,
  Decision,
  DeckList,
  GameSession,
  GameState,
  PlayerAgent,
  PlayerId,
  SessionOptions,
  Step,
  StopSet,
  TurnSide,
} from '@mtg/kernel';
import {
  advance,
  settledChoice,
  botSeat,
  canRespond,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_BEATS,
  DEFAULT_STOPS,
  driveDeclaration,
  FULL_CONTROL,
  getObject,
  holdsOwnTopOfStack,
  humanSeat,
  hasStop,
  isStopped,
  opposingStack,
  passIndex,
  pendingDecision,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  STOPPABLE_STEPS,
  STEPS,
  stopWantsAQuestion,
  toggleStop,
  unstoppedPassChoice,
  withFullControl,
  yieldPriority,
} from '@mtg/kernel';
import { instant, lands, MOUNTAIN } from './cards';

/**
 * One instant the player can pay for out of two Mountains.
 *
 * The whole of what "the player has a play here" means in the yield block below:
 * an instant is castable in any step, so a hand holding one turns every priority
 * into a window `canRespond` calls live, and an empty hand turns every one of
 * them into a window it calls dead.
 */
const TRICK = instant('Test Trick', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});

function sliceDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP = {
  seed: 'autopass/v0',
  decks: [sliceDeck('Human Red'), sliceDeck('Bot Red')] as const,
  maximumTurns: 40,
};

const seats = () => [humanSeat('the playtester'), botSeat(simpleAgent('greedy'))] as const;

/**
 * Auto-pass with nothing else in the way, so the predicate is what is measured.
 *
 * `passUnstopped` off, because these are the tests of the structural rule — the
 * one that fires only where the kernel enumerated a single option. The
 * stop-driven pass is the other mechanism and has its own block below.
 */
const NO_STOPS: AutoPassSettings = {
  enabled: true,
  passUnstopped: false,
  stops: { yourTurn: new Set<Step>(), theirTurn: new Set<Step>() },
};

/**
 * The stop set from the report that opened this: both of the player's own main
 * phases, and nothing anywhere else.
 *
 * `passUnstopped` is the half of the settings that makes a stop set mean what a
 * player who has ticked two boxes thinks it means. Without it the set can only
 * add questions, never remove one.
 */
const MAIN_PHASES: AutoPassSettings = {
  enabled: true,
  passUnstopped: true,
  stops: {
    yourTurn: new Set<Step>(['precombatMain', 'postcombatMain']),
    theirTurn: new Set<Step>(),
  },
};

const settings = (autoPass: AutoPassSettings): SessionOptions => ({ autoPass });

/** Picks the first enumerated option every time: a player who only ever passes. */
const first = (): number => 0;

/** Clicks whatever the given bot would have clicked; see session.test.ts. */
function asBotWould(agent: PlayerAgent): (session: GameSession) => number {
  return (session: GameSession): number => {
    const decision = session.pending;
    if (decision === null) throw new Error('asBotWould: nothing is pending');
    const wanted = agent.decide({ state: session.state, player: decision.player, decision });
    const key = JSON.stringify(wanted);
    const index = decision.options.findIndex((option) => JSON.stringify(option) === key);
    if (index < 0) throw new Error(`asBotWould: the bot chose a "${wanted.type}" nobody enumerated`);
    return index;
  };
}

/**
 * Plays lands and creatures and never spends an instant.
 *
 * The player the second report is about: mana open, a trick still in hand, and
 * therefore a real answer available at some of the opposing spells and none at
 * the others. A driver that casts everything it draws holds nothing up and would
 * make the distinction below untestable in one direction; one that only ever
 * passes plays no land and would make it untestable in the other.
 */
function holdingATrick(session: GameSession): number {
  const decision = session.pending;
  if (decision === null) throw new Error('holdingATrick: nothing is pending');
  const land = decision.options.findIndex((option) => option.type === 'playLand');
  if (land >= 0) return land;
  if (session.state.stack.length === 0) {
    const creature = decision.options.findIndex(
      (option) =>
        option.type === 'castSpell' && getObject(session.state, option.oid).card.kind === 'creature',
    );
    if (creature >= 0) return creature;
  }
  return 0;
}

/** One question the session actually put to the human, and its shape. */
interface Ask {
  readonly kind: string;
  readonly step: Step;
  /** True when the question arose on the asked player's own turn. */
  readonly yours: boolean;
  readonly options: number;
  /** True when the stack held something the asked player did not put there. */
  readonly facingTheirs: boolean;
  /**
   * True when something other than the pass and the mana abilities was on
   * offer — that is, when the player could actually have answered.
   */
  readonly couldRespond: boolean;
}

/** True when a stop set names the step this question was asked at. */
function stoppedAt(stops: StopSet, ask: Ask): boolean {
  return stops[ask.yours ? 'yourTurn' : 'theirTurn'].has(ask.step);
}

function playRecordingAsks(
  options: SessionOptions,
  pick: (session: GameSession) => number = first,
): { readonly session: GameSession; readonly asks: readonly Ask[] } {
  let session = createSession(SETUP, seats(), options);
  const asks: Ask[] = [];
  for (let guard = 0; guard < 10_000; guard += 1) {
    const decision = session.pending;
    if (decision === null) return { session, asks };
    asks.push({
      kind: decision.kind,
      step: session.state.turn.step,
      yours: session.state.turn.active === decision.player,
      options: decision.options.length,
      facingTheirs: opposingStack(session.state, decision.player).size > 0,
      couldRespond: decision.options.some(
        (option) => option.type !== 'passPriority' && option.type !== 'activateManaAbility',
      ),
    });
    session = choose(session, pick(session), options);
  }
  throw new Error('playRecordingAsks: the session never stopped asking');
}

/**
 * Every question a full-control game put to the human, with the position it was
 * asked from, so the predicate can be read against real enumerations rather than
 * against a hand-built one. Driven by a bot's own choices, which is what puts
 * lands on the battlefield and therefore mana abilities in the option lists.
 */
function everyDecision(
  pick: (session: GameSession) => number = asBotWould(simpleAgent('mirror')),
): readonly { readonly state: GameState; readonly decision: Decision }[] {
  const seen: { readonly state: GameState; readonly decision: Decision }[] = [];
  let session = createSession(SETUP, seats());
  for (let guard = 0; guard < 10_000; guard += 1) {
    const decision = session.pending;
    if (decision === null) return seen;
    seen.push({ state: session.state, decision });
    session = choose(session, pick(session));
  }
  throw new Error('everyDecision: the session never stopped asking');
}

describe('the settled-decision predicate', () => {
  const asked = everyDecision();

  it('fires on exactly the decisions the kernel enumerated one option for', () => {
    // Neither the stack nor the stop set appears in this condition and neither
    // can: the kernel puts `passPriority` in every priority it enumerates, so a
    // single-option priority is the pass alone and `canRespond` is false at
    // every one of them. That is why the predicate takes no state — the two
    // rules that would have read it are both gated on an answer being
    // available, and there is never one here.
    for (const { state, decision } of asked) {
      const alone = decision.options.length === 1 && decision.complete;
      expect(
        settledChoice(decision, NO_STOPS),
        `${decision.kind} with ${String(decision.options.length)} options in ${state.turn.step}`,
      ).toBe(alone ? 0 : null);
    }
  });

  it('fires at nothing the player could have answered, which is what lets it ignore both', () => {
    // The enumeration fact the paragraph above rests on, asserted rather than
    // argued: every priority enumerated with one option is one `canRespond`
    // calls dead, so no stop and no stack can want a question at it.
    const single = asked.filter(
      (entry) => entry.decision.kind === 'priority' && entry.decision.options.length === 1,
    );
    expect(single.length, 'no single-option priority arose').toBeGreaterThan(0);
    for (const { state, decision } of single) {
      expect(canRespond(decision), `${state.turn.step}`).toBe(false);
      expect(stopWantsAQuestion(state, decision, DEFAULT_STOPS)).toBe(false);
    }
  });

  it('is measured against a sample that would catch the obvious relaxation', () => {
    // The mutation this file exists to survive: changing the predicate to fire
    // at `<= 2` options has to go RED. It can only do that if the sample above
    // contains a priority enumerated with exactly two — the pass and one play.
    const priorities = asked.filter((entry) => entry.decision.kind === 'priority');
    const counts = new Set(priorities.map((entry) => entry.decision.options.length));
    expect(counts, 'no single-option priority arose, so the predicate is untested').toContain(1);
    expect(counts, 'no two-option priority arose, so the mutation would not be caught').toContain(2);
  });

  /**
   * `mtg-y1t.3`. The rule used to end at `kind !== 'priority'`, and the argument
   * above never says "priority" anywhere: two attacking fliers over a board with
   * nothing that flies or reaches enumerate one blocker declaration, and the
   * player was made to press it. What the rule asks is how many continuations
   * the position has.
   */
  it('settles a combat declaration with one legal answer, and asks about one with two', () => {
    const others = asked.filter((entry) => entry.decision.kind !== 'priority');
    const kinds = new Set(others.map((entry) => entry.decision.kind));
    expect(kinds).toContain('declareAttackers');
    expect(kinds).toContain('declareBlockers');
    for (const { decision } of others) {
      const settled = settledChoice(decision, NO_STOPS);
      expect(settled).toBe(decision.options.length === 1 && decision.complete ? 0 : null);
    }
    // The sample must hold a declaration with a real choice in it, or the line
    // above is one branch asserted twice. The forced one it does not reach on
    // its own is built below.
    const counts = new Set(others.map((entry) => entry.decision.options.length));
    expect(counts, 'no real declaration arose, so the mutation would not be caught').toContain(2);
  });

  /** The bug's own board: two fliers over a board that cannot reach them. */
  it('settles the blocker declaration the flying attack left one answer to', () => {
    const { state, decision } = flyingAttack();
    // The enumeration first, because the whole argument rests on it being one
    // rather than 2^3 assignments a legality filter never removed.
    if (decision.kind !== 'declareBlockers') throw new Error('the flying board asked something else');
    // Three creatures able to block something, and nothing they can block.
    expect(decision.eligible).toHaveLength(3);
    expect(decision.options).toHaveLength(1);
    expect(decision.complete).toBe(true);
    expect(settledChoice(decision, NO_STOPS)).toBe(0);

    // And the session takes it rather than stopping, which is the defect: the
    // player was asked to declare no blocks by hand. Note the stop set does name
    // `declareBlockers` on the opponent's turn — a stop is about the priorities
    // in a step and has never had a say over a declaration, which is why the
    // settled rule is what decides here and why it is read first in `advance`.
    expect(hasStop(DEFAULT_STOPS, 'theirTurn', 'declareBlockers')).toBe(true);
    const parked = parkedOn(state, decision);
    const settled = advance(parked, { autoPass: DEFAULT_AUTO_PASS });
    expect(settled.pending?.kind).not.toBe('declareBlockers');
    // Recorded, not skipped: the first integer it wrote is the declaration's
    // own index, and the rest are the priorities it ran on through afterwards.
    expect(settled.choices[0]).toBe(0);
    expect(settled.choices.length).toBeGreaterThan(0);

    // The information is not lost with the question: the beat still fires, and
    // that is the whole distinction the codebase draws — a beat pauses to show
    // you something and records nothing, a stop is a place you are asked to act.
    // A player who cannot block still watches the block happen.
    const watched = advance(parked, { autoPass: DEFAULT_AUTO_PASS, watchBeats: DEFAULT_BEATS });
    expect(watched.beat).toEqual({ kind: 'blockers' });

    // Full control still asks, and that is what keeps every recorded game valid:
    // `replaySession` clears the settings, so the integer this appended is spent
    // on the question it was appended for.
    const asked = advance(parked, {});
    expect(asked.pending?.kind).toBe('declareBlockers');
    expect(asked.choices).toEqual([]);
  });

  /**
   * The one way widening this could have gone wrong. `blockerDecision` falls
   * back to a lone empty declaration when the 512-option cap left nothing valid,
   * so a truncated enumeration can present one option and mean the opposite of
   * forced.
   */
  it('refuses a truncated enumeration however few options survived it', () => {
    const truncated: Decision = {
      kind: 'declareBlockers',
      player: 1,
      attackers: [],
      eligible: [],
      candidates: [],
      options: [{ type: 'declareBlockers', player: 1, blocks: [] }],
      complete: false,
    };
    expect(settledChoice(truncated, NO_STOPS)).toBeNull();
    expect(settledChoice({ ...truncated, complete: true }, NO_STOPS)).toBe(0);
  });
});

/**
 * Two attacking creatures with flying against three ground creatures, parked at
 * the blocker declaration. `mtg-y1t.3`'s board, in the smallest form that keeps
 * the property: every pair fails `canBlock`, so `cartesian` offers each blocker
 * only `null` and the product is the empty declaration alone.
 */
function flyingAttack(): { readonly state: GameState; readonly decision: Decision } {
  let minted = 0;
  const mint = (name: string, flying: boolean): Card =>
    parseCard({
      kind: 'creature',
      id: `slc-settled-${String((minted += 1))}`,
      name,
      rarity: 'common',
      set: { code: 'SLC', collectorNumber: minted },
      manaCost: { generic: 2 },
      colors: [],
      power: 2,
      toughness: 2,
      ...(flying ? { keywords: ['flying' as const] } : {}),
    });
  let state = scenario({
    seed: 'test/autopass/flying',
    battlefield: [
      { card: mint('Cliff Kite', true), controller: 0, summoningSick: false },
      { card: mint('Ash Kite', true), controller: 0, summoningSick: false },
      { card: mint('Pit Warden', false), controller: 1, summoningSick: false },
      { card: mint('Gate Warden', false), controller: 1, summoningSick: false },
      { card: mint('Road Warden', false), controller: 1, summoningSick: false },
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  }).state;
  // Driven to the end of the attack declaration rather than reduced once: past
  // the enumeration cap the kernel asks about one creature at a time
  // (`mtg-tb7v`), so `driveDeclaration` is what "everything attacking" means
  // however many steps that takes (`mtg-y16d`).
  state = driveDeclaration(state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state);
    if (decision === null) break;
    if (decision.kind === 'declareBlockers') return { state, decision };
    const option = decision.options[decision.options.length - 1];
    if (option === undefined) throw new Error('a decision on the way to blockers was empty');
    state = reduce(state, option).state;
  }
  throw new Error('flyingAttack: the board never reached a blocker declaration');
}

/** The flying board as a session sitting on its blocker declaration. */
function parkedOn(state: GameState, decision: Decision): GameSession {
  return {
    seats: [humanSeat('One'), humanSeat('Two')],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

describe('the recorded game does not know the structural rule was on', () => {
  /**
   * The invariant, and the one that matters. Auto-pass changes what the player
   * is asked, so a driver only ever sees the questions that survived it; the
   * claim is that the game underneath is the same game down to the byte, because
   * every priority auto-pass answered had one legal answer anyway.
   *
   * Measured with `passUnstopped` off, which is what scopes the claim to the
   * mechanism that can make it. The stop-driven pass answers priorities that had
   * other answers, so a game it drove is a different game from the one a
   * full-control player would have recorded, and saying otherwise would be
   * asserting something false about a real configuration. What that mechanism
   * does promise is one block down: every pass it makes is in the recording, and
   * the recording replays byte for byte.
   *
   * Driven by a bot's own choices rather than by a passive one, so the game
   * being compared has combat, casts and a discard in it.
   */
  const driver = (): ((session: GameSession) => number) => asBotWould(simpleAgent('mirror'));

  const STRUCTURAL_ONLY: AutoPassSettings = { ...DEFAULT_AUTO_PASS, passUnstopped: false };

  it('records identical events and identical choices with auto-pass on and off', () => {
    const off = playRecordingAsks({}, driver());
    const on = playRecordingAsks(settings(STRUCTURAL_ONLY), driver());

    expect(on.session.choices).toEqual(off.session.choices);
    expect(serializeEvents(on.session.events)).toBe(serializeEvents(off.session.events));
    expect(stateFingerprint(on.session.state)).toBe(stateFingerprint(off.session.state));
    expect(on.session.decisions).toBe(off.session.decisions);
    expect(on.session.result).toEqual(off.session.result);
    // Not vacuous: the whole point is that the human was asked far less often.
    expect(on.asks.length).toBeLessThan(off.asks.length);
  });

  it('replays a game played under auto-pass, at full control, into the same game', () => {
    const played = playRecordingAsks(settings(DEFAULT_AUTO_PASS), driver()).session;
    const replayed = replaySession(SETUP, seats(), played.choices, settings(DEFAULT_AUTO_PASS));

    // `replaySession` drops auto-pass on purpose: the auto-passed priorities are
    // already integers in the list, so replaying them again would spend the list
    // one question late. Passing the settings in anyway is the check that it does.
    expect(replayed.choices).toEqual(played.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
  });
});

describe('stops', () => {
  /**
   * Both main phases plus `beginCombat` on one named side of the table.
   *
   * `beginCombat` is still the step under test, for the reason it always was:
   * nothing else in this game produces a question there, so an ask at the
   * beginning of combat came from the stop and from nothing else. What changed
   * with `mtg-hmy` is the rest of the set and the driver. A stop only fires
   * where the player has a play, so the position it is measured at has to be one
   * the player could act in; the two mains keep them being offered their own
   * turn, and `holdingATrick` spends those offers on lands and creatures and
   * keeps its instants, which is what makes the beginning of combat a live
   * window rather than a pass with a Mountain beside it. Driven by a player who
   * only ever passes, this whole block would measure a set of empty games — that
   * player is never offered a turn, never plays a land, and has nothing castable
   * anywhere on the board.
   */
  const plusCombat = (side: TurnSide): AutoPassSettings => toggleStop(MAIN_PHASES, side, 'beginCombat');

  /** The questions asked at the beginning of combat on one side of the table. */
  const atCombat = (asks: readonly Ask[], yours: boolean): readonly Ask[] =>
    asks.filter((ask) => ask.kind === 'priority' && ask.step === 'beginCombat' && ask.yours === yours);

  it('forces a prompt at its step on the turn side it names', () => {
    const { asks } = playRecordingAsks(settings(plusCombat('yourTurn')), holdingATrick);
    expect(atCombat(asks, true).length).toBeGreaterThan(0);
    // Not vacuous, and the stop is the whole of the difference: the same set
    // without it asks nothing at the beginning of combat at all.
    const without = playRecordingAsks(settings(MAIN_PHASES), holdingATrick).asks;
    expect(atCombat(without, true)).toEqual([]);
  });

  it('does not force one on the other side of the table', () => {
    const { asks } = playRecordingAsks(settings(plusCombat('yourTurn')), holdingATrick);
    expect(atCombat(asks, false).filter((ask) => !ask.facingTheirs)).toEqual([]);
  });

  it('is one-sided in the other direction too', () => {
    const { asks } = playRecordingAsks(settings(plusCombat('theirTurn')), holdingATrick);
    expect(atCombat(asks, false).length).toBeGreaterThan(0);
    expect(atCombat(asks, true).filter((ask) => !ask.facingTheirs)).toEqual([]);
  });

  it('asks at no step outside the set that auto-pass would have taken', () => {
    const stops = plusCombat('yourTurn');
    const { asks } = playRecordingAsks(settings(stops), holdingATrick);
    for (const ask of asks) {
      if (ask.kind !== 'priority' || ask.facingTheirs) continue;
      expect(stoppedAt(stops.stops, ask), `${ask.yours ? 'own' : "opponent's"} ${ask.step}`).toBe(true);
    }
  });

  it('offers a stop only on steps that grant priority', () => {
    // Untap and cleanup grant none, so a stop on either would be a control that
    // does nothing. The subtraction is checked against a real game rather than
    // against `turn.ts` being read correctly.
    expect(STOPPABLE_STEPS).not.toContain('untap');
    expect(STOPPABLE_STEPS).not.toContain('cleanup');
    expect(STEPS.length - STOPPABLE_STEPS.length).toBe(2);

    const { asks } = playRecordingAsks({}, asBotWould(simpleAgent('mirror')));
    const priorities = asks.filter((ask) => ask.kind === 'priority');
    expect(priorities.length).toBeGreaterThan(50);
    for (const ask of priorities) expect(STOPPABLE_STEPS).toContain(ask.step);
  });
});

describe('the stop-driven pass', () => {
  /**
   * Driven by a bot's own choices rather than by a player who only ever passes,
   * and the whole block turns on that. A passive player never gets a land onto
   * the battlefield, so the kernel enumerates one option at nearly every
   * priority and the structural rule alone looks like it is honoring the stop
   * set. One untapped land puts a mana ability in every enumeration; from that
   * point on nothing is single-option and the stop set stops removing anything.
   */
  const drive = (): ((session: GameSession) => number) => asBotWould(simpleAgent('mirror'));

  /** One ask, in a form a failure message can be read out of. */
  const describeAsk = (ask: Ask): string =>
    `${ask.yours ? 'own' : "opponent's"} ${ask.step}, ${String(ask.options)} legal`;

  /** Asks the player did not ask for: a priority at a step no stop of theirs names. */
  const outsideTheSet = (asks: readonly Ask[]): readonly string[] =>
    asks
      .filter(
        (ask) =>
          ask.kind === 'priority' &&
          !ask.facingTheirs &&
          !(ask.yours && MAIN_PHASES.stops.yourTurn.has(ask.step)),
      )
      .map(describeAsk);

  it('asks at no priority the stop set does not name', () => {
    const { asks } = playRecordingAsks(settings(MAIN_PHASES), drive());
    expect(outsideTheSet(asks)).toEqual([]);
  });

  it('is the only thing that can skip a priority the player holds a play at', () => {
    // Not vacuous, and the defect in one line: the same stop set with the
    // structural rule alone leaves every one of those questions standing,
    // because two legal options mean it declines to fire.
    const alone: AutoPassSettings = { ...MAIN_PHASES, passUnstopped: false };
    const left = outsideTheSet(playRecordingAsks(settings(alone), drive()).asks);
    expect(left.length).toBeGreaterThan(0);
    expect(left.some((ask) => !ask.endsWith('1 legal'))).toBe(true);
  });

  it('records every pass it makes, so the game replays byte for byte', () => {
    // The invariant a stop-driven pass can keep. It cannot keep the one the
    // block above it keeps — a pass made because no stop named the step is a
    // different game from the one where the player was asked and cast something
    // — but it is a decision, it is written down as the index it is, and a
    // replay at full control spends those integers and lands in the same
    // position.
    const played = playRecordingAsks(settings(MAIN_PHASES), drive()).session;
    const replayed = replaySession(SETUP, seats(), played.choices, settings(MAIN_PHASES));

    expect(replayed.choices).toEqual(played.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
  });

  it('writes down more passes than it asked questions', () => {
    // The skipped priorities are in the recording rather than missing from it,
    // which is what the replay above is spending.
    const { session, asks } = playRecordingAsks(settings(MAIN_PHASES), drive());
    expect(session.choices.length).toBeGreaterThan(asks.length);
  });

  // The opposing-stack rule this pass may not override is measured in "a spell
  // the player cannot answer" below, in both directions and against a player who
  // sometimes holds one. The mirror bot spends every instant it draws, so a game
  // it drove can only ever show one of the two.
});

describe('a spell the player cannot answer', () => {
  /**
   * The second report, in the player's words: "you shouldn't have to do a 'let
   * it resolve' for everything if you've yielded priority ... vs if you have a
   * card in your hand and mana open and would realistically want to respond to
   * something".
   *
   * The opposing-stack rule used to hand the game back at every spell the other
   * seat cast, whatever the player could do about it, so one untapped land
   * bought a prompt whose only content was the pass. What the rule protects is a
   * player who could have answered; a player who could not is being asked to
   * watch, and watching is what the stop set is for.
   */
  const asked = (): readonly Ask[] => playRecordingAsks(settings(DEFAULT_AUTO_PASS), holdingATrick).asks;

  const facing = (asks: readonly Ask[]): readonly Ask[] =>
    asks.filter((ask) => ask.kind === 'priority' && ask.facingTheirs && !stoppedAt(DEFAULT_STOPS, ask));

  const describeAsk = (ask: Ask): string =>
    `${ask.yours ? 'own' : "opponent's"} ${ask.step}, ${String(ask.options)} legal`;

  it('is not put in front of them', () => {
    const helpless = facing(asked()).filter((ask) => !ask.couldRespond);
    expect(helpless.map(describeAsk)).toEqual([]);
  });

  it('is still put in front of them at every spell they could have answered', () => {
    // The half of the rule that stays, and the reason this is a refinement
    // rather than a repeal: mana open and a trick in hand is exactly the
    // position the player named as the one worth being asked about.
    const answerable = facing(asked()).filter((ask) => ask.couldRespond);
    expect(answerable.length).toBeGreaterThan(0);
  });

  /**
   * The same rule one level down, read off real enumerations rather than off the
   * questions that survived them. Driven by the same held-up player, because the
   * mirror bot spends every instant it draws and a game it drove contains no
   * priority where an opposing spell and an answer to it are both present — the
   * half of this rule that must not move would be untestable.
   */
  const sample = everyDecision(holdingATrick);
  const facingDecisions = sample.filter(
    (entry) =>
      entry.decision.kind === 'priority' && opposingStack(entry.state, entry.decision.player).size > 0,
  );
  const stopsOnly: AutoPassSettings = { ...NO_STOPS, passUnstopped: true };

  it('arises in both shapes in this game, so neither half of the rule is vacuous', () => {
    const answerable = facingDecisions.filter((entry) => canRespond(entry.decision));
    expect(facingDecisions.length, 'nothing was ever cast at this player').toBeGreaterThan(0);
    expect(answerable.length, 'the player never held an answer').toBeGreaterThan(0);
    expect(facingDecisions.length - answerable.length, 'the player always held an answer').toBeGreaterThan(0);
  });

  it('is passed by the stop-driven pass, and an answerable one never is', () => {
    for (const { state, decision } of facingDecisions) {
      expect(
        unstoppedPassChoice(state, decision, stopsOnly),
        `${state.turn.step} with ${String(decision.options.length)} legal`,
      ).toBe(canRespond(decision) ? null : passIndex(decision));
    }
  });

  it('is what the kernel means by an answer: not the pass, and not a mana ability', () => {
    // `canRespond` is the kernel's definition and this is the only place the
    // test states its own, so the two cannot drift without this failing.
    for (const { decision } of sample) {
      const byHand = decision.options.some(
        (option) => option.type !== 'passPriority' && option.type !== 'activateManaAbility',
      );
      expect(canRespond(decision)).toBe(byHand);
    }
    const manaOnly = sample.filter(
      (entry) => entry.decision.kind === 'priority' && !canRespond(entry.decision),
    );
    expect(manaOnly.some((entry) => entry.decision.options.length > 1)).toBe(true);
  });
});

describe('a stop with nothing to offer', () => {
  /**
   * `mtg-hmy`, in the playtester's words: "I want an option to not have to 'let it
   * resolve' when I have no other actions that I can do that would not let it
   * resolve, e.g. when I tap out for a creature."
   *
   * The stop set was what was doing it to her. `stackWantsAnAnswer` had already
   * been qualified by `canRespond` and the stops had not, so a step in the set
   * asked whatever the kernel had enumerated there — including a step where it
   * had enumerated the pass and a Mountain. On this seeded game, driven by the
   * player who holds their instants, the default stops asked 65 priorities and
   * 25 of them had nothing in them but the pass, or the pass and tapping a land.
   * Now they ask 40 and none of them do: the questions that went away are
   * exactly the 25, and the game underneath is the same game.
   */
  const played = (): { readonly session: GameSession; readonly asks: readonly Ask[] } =>
    playRecordingAsks(settings(DEFAULT_AUTO_PASS), holdingATrick);

  const describeAsk = (ask: Ask): string =>
    `${ask.yours ? 'own' : "opponent's"} ${ask.step}, ${String(ask.options)} legal`;

  it('is not put in front of the player', () => {
    const dead = played().asks.filter((ask) => ask.kind === 'priority' && !ask.couldRespond);
    expect(dead.map(describeAsk)).toEqual([]);
  });

  it('still fires wherever the stop has a play in it', () => {
    // The other half of the acceptance criterion, and the reason this is a
    // qualification rather than a repeal: the two main phases and the three
    // steps of the opponent's turn the defaults name are still where the player
    // is asked, every time there is something there to ask about.
    const live = played().asks.filter((ask) => ask.kind === 'priority' && stoppedAt(DEFAULT_STOPS, ask));
    expect(live.length).toBeGreaterThan(0);
    expect(new Set(live.map((ask) => ask.step)).size).toBeGreaterThan(1);
  });

  /**
   * The same rule one level down, read off real enumerations rather than off the
   * questions that survived them, and against the predicate the session actually
   * calls.
   */
  const sample = everyDecision(holdingATrick);
  const stoppedQuiet = sample.filter(
    ({ state, decision }) =>
      decision.kind === 'priority' &&
      isStopped(state, decision.player, DEFAULT_STOPS) &&
      opposingStack(state, decision.player).size === 0 &&
      !holdsOwnTopOfStack(state, decision),
  );

  it('arises in both shapes in this game, so neither half of the rule is vacuous', () => {
    expect(stoppedQuiet.length, 'no quiet stop arose at all').toBeGreaterThan(0);
    expect(
      stoppedQuiet.filter(({ decision }) => canRespond(decision)).length,
      'every stop this game reached was one the player could only pass at',
    ).toBeGreaterThan(0);
    expect(
      stoppedQuiet.filter(({ decision }) => !canRespond(decision)).length,
      'the player could act at every stop, so the rule was never asked to fire',
    ).toBeGreaterThan(0);
  });

  it('is passed by the stop-driven pass, and one with a play in it never is', () => {
    for (const { state, decision } of stoppedQuiet) {
      expect(
        unstoppedPassChoice(state, decision, DEFAULT_AUTO_PASS),
        `${state.turn.step} with ${String(decision.options.length)} legal`,
      ).toBe(canRespond(decision) ? null : passIndex(decision));
    }
  });

  it('leaves a recording that replays byte for byte at full control', () => {
    // The invariant the whole kernel is built on, and the one a rule that
    // *removes* a question is most at risk of breaking: every priority passed
    // here is written into `choices` as the index it is, so a replay at full
    // control spends those integers and lands in the same position.
    const { session, asks } = played();
    const replayed = replaySession(SETUP, seats(), session.choices, settings(DEFAULT_AUTO_PASS));

    expect(replayed.choices).toEqual(session.choices);
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(session.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    // Not vacuous: the passes it made are in the recording rather than missing
    // from it, which is what that replay is spending.
    expect(session.choices.length).toBeGreaterThan(asks.length);
  });

  it('does not touch the rule that outranks it', () => {
    // `stackWantsAnAnswer` is checked before the stop is, so a spell the player
    // could answer still hands the game back at a step no stop names. Widening
    // the stop rule must not have widened its way past that one.
    const facing = played().asks.filter(
      (ask) => ask.kind === 'priority' && ask.facingTheirs && !stoppedAt(DEFAULT_STOPS, ask),
    );
    expect(facing.length).toBeGreaterThan(0);
    for (const ask of facing) expect(ask.couldRespond).toBe(true);
  });
});

describe('full control', () => {
  it('disables auto-pass at every step, stops or no stops', () => {
    const plain = playRecordingAsks({});
    const full = playRecordingAsks(settings(FULL_CONTROL));
    expect(full.asks).toEqual(plain.asks);
  });

  it('is the enabled flag and nothing else, so the stops survive being switched off', () => {
    const off = withFullControl(DEFAULT_AUTO_PASS, true);
    expect(off.enabled).toBe(false);
    expect(off.stops).toBe(DEFAULT_STOPS);
    expect(withFullControl(off, false)).toEqual(DEFAULT_AUTO_PASS);
  });
});

describe('yield', () => {
  /** Walks, with every priority asked about, to the first position that fits. */
  function walkTo(
    fits: (session: GameSession) => boolean,
    pick: (session: GameSession) => number = first,
  ): GameSession {
    let session = createSession(SETUP, seats());
    for (let guard = 0; guard < 2000; guard += 1) {
      if (session.pending === null) throw new Error('the game ended before the position arose');
      if (fits(session)) return session;
      session = choose(session, pick(session));
    }
    throw new Error('never reached the position');
  }

  /**
   * The human's own end step on turn 1.
   *
   * Turn 1 rather than any later one, and that is not arbitrary: a player who
   * only ever passes never spends a card, so from turn 2 their own cleanup owes
   * a discard, and a yield that ran into one would be measuring the
   * not-a-priority rule instead of its boundary.
   */
  const atOwnEndStep = (): GameSession =>
    walkTo(({ state }) => state.turn.active === 0 && state.turn.step === 'end' && state.turn.number === 1);

  /**
   * The human's priority in the opponent's upkeep, late enough that the opponent
   * has mana to spend. Their first turn has one land and nothing they can pay
   * for, so a yield aimed through it would find an empty stack.
   *
   * Walked by the player who holds its instants, because what the two tests
   * below separate is whether the human has an answer when the spell lands, and
   * a player who only ever passes never has one — nor even a land to tap.
   */
  const atTheirUpkeep = (minTurn: number): GameSession =>
    walkTo(
      ({ state }) => state.turn.active === 1 && state.turn.step === 'upkeep' && state.turn.number >= minTurn,
      holdingATrick,
    );

  /** How many spells the other seat cast over a stretch of the game. */
  const castsBy = (session: GameSession, player: PlayerId, since: number): number =>
    session.events.slice(since).filter((event) => event.type === 'spellCast' && event.player === player)
      .length;

  it('hands the game back at a spell the player can answer', () => {
    // Pressed at the top of the opponent's turn and aimed at the end of it. It
    // gets as far as their first cast and no further, which is the difference
    // between a yield and a way to lose to a spell nobody saw. Turn 12 because
    // that is where this seeded game first puts a castable instant in the
    // human's hand while the opponent still has something to spend mana on.
    const before = atTheirUpkeep(12);
    const yielded = yieldPriority(before, 'endOfTurn', {});

    expect(yielded.state.turn.number).toBe(before.state.turn.number);
    expect(opposingStack(yielded.state, 0).size).toBeGreaterThan(0);
    expect(yielded.pending?.kind).toBe('priority');
    expect(yielded.pending?.player).toBe(0);
    expect(canRespond(yielded.pending as Decision)).toBe(true);
    // It really did pass on the way there rather than stopping on the spot.
    expect(yielded.choices.length).toBeGreaterThan(before.choices.length);
  });

  it('runs straight past one they cannot', () => {
    // The second report: "you shouldn't have to do a 'let it resolve' for
    // everything if you've yielded priority". On turn 4 the human holds no
    // instant they can pay for, so the opponent's spells are things to watch
    // rather than things to answer, and a yield that stopped at each of them
    // would be asking for a press that could only say "let it resolve".
    const before = atTheirUpkeep(4);
    const yielded = yieldPriority(before, 'endOfTurn', {});

    expect(yielded.state.turn.number).toBe(before.state.turn.number + 1);
    // Not vacuous: the opponent really did cast into the yield, and it ran on.
    expect(castsBy(yielded, 1, before.events.length)).toBeGreaterThan(0);
  });

  it('runs to the end of the turn it was pressed in', () => {
    const before = atOwnEndStep();
    const yielded = yieldPriority(before, 'endOfTurn', {});
    expect(yielded.state.turn.number).toBe(before.state.turn.number + 1);
    expect(yielded.state.turn.active).toBe(1);
  });

  it('composes with auto-pass rather than fighting it', () => {
    // With auto-pass on, the boundary is where the yield stops asking and
    // auto-pass takes over, not where the game stops moving. Both controls say
    // "do not ask me about this", so the session settles at the first thing
    // either of them would have stopped for — here the player's own next turn.
    const before = atOwnEndStep();
    const yielded = yieldPriority(before, 'endOfTurn', settings(NO_STOPS));
    expect(yielded.state.turn.number).toBeGreaterThan(before.state.turn.number + 1);
    expect(yielded.pending).not.toBeNull();
  });

  /**
   * A stop set with auto-pass switched off, which is what makes the two tests
   * below say something exact: the yield is then the only thing deciding where
   * the game stops, rather than sharing that with an auto-pass that would have
   * carried it further. It is also a real configuration — a stop set survives
   * full control, and a yield honors it either way.
   */
  const onlyStops = (side: TurnSide, step: Step): AutoPassSettings =>
    withFullControl(toggleStop(NO_STOPS, side, step), true);

  /**
   * Player 0 at the beginning of their own combat, two Mountains untapped, and
   * whatever hand is stated. Nothing on the battlefield attacks, so the yield
   * runs from here to the end of the turn without meeting a question that is not
   * a priority.
   *
   * A stated position rather than a walked one, because what the two tests below
   * separate is whether the player could act at the step the stop names, and
   * they are the only tests here that need to state a hand exactly. Walking a
   * seeded game to a turn where the stopped step happens to hold a castable
   * instant would be measuring the shuffle.
   */
  function ownCombat(hand: readonly Card[]): GameSession {
    const state = scenario({
      active: 0,
      step: 'beginCombat',
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[...hand], []],
    }).state;
    return advance(
      {
        // The other seat is a bot for the reason `SETUP` seats one: a yield runs
        // only for the player who pressed it and hands back the moment priority
        // crosses the table, so a second human seat would end every one of these
        // yields in the step it started in.
        seats: [humanSeat('You'), botSeat(simpleAgent('mirror'))],
        state,
        events: [],
        result: state.result,
        pending: null,
        choices: [],
        decisions: 0,
        beat: null,
        committed: null,
      },
      {},
    );
  }

  it('honors a stop the player has a play at', () => {
    const before = ownCombat([TRICK]);
    const stopped = yieldPriority(before, 'endOfTurn', settings(onlyStops('yourTurn', 'postcombatMain')));

    expect(stopped.state.turn.step).toBe('postcombatMain');
    expect(stopped.state.turn.number).toBe(before.state.turn.number);
    expect(canRespond(stopped.pending as Decision), 'it broke at a window with no play in it').toBe(true);
  });

  it('runs past one the player could only pass at', () => {
    // `mtg-hmy` at the yield: a stop that stopped a yield where the player has
    // nothing to do would hand back exactly the prompt `advance` no longer
    // produces, so the two read one predicate. The hand is empty and the two
    // Mountains are the whole of the offer.
    const before = ownCombat([]);
    const ran = yieldPriority(before, 'endOfTurn', settings(onlyStops('yourTurn', 'postcombatMain')));

    expect(ran.state.turn.number).toBe(before.state.turn.number + 1);
  });

  it('does not re-honor the stop it was pressed inside', () => {
    // A stop has already done its job by the time somebody is looking at the
    // window and reaching for the yield. Re-honoring it there would make the
    // button do nothing at the position it is most often pressed from, and do it
    // silently.
    const before = atOwnEndStep();
    const yielded = yieldPriority(before, 'endOfTurn', settings(onlyStops('yourTurn', 'end')));
    expect(yielded).not.toBe(before);
    expect(yielded.state.turn.number).toBe(before.state.turn.number + 1);
  });

  it('hands back at the next stop rather than at the first priority of the turn', () => {
    // The second half of the report: a yield aimed at the player's own next turn
    // came back in their upkeep, which is the first priority of that turn and
    // not a step they had stopped in. A boundary is where a yield stops running,
    // not where the game stops asking — the stop set decides that, here and
    // everywhere else.
    //
    // Played rather than passed to the position, for the reason the stop-driven
    // block gives: with a land on the battlefield the player's upkeep enumerates
    // a mana ability beside the pass, so nothing structural carries them out of
    // it. Turn 1 so the yield crosses the opponent's first turn, where they hold
    // one land and can cast nothing that would end the yield early.
    const before = walkTo(
      ({ state }) => state.turn.active === 0 && state.turn.step === 'end' && state.turn.number === 1,
      asBotWould(simpleAgent('mirror')),
    );
    const yielded = yieldPriority(before, 'yourNextTurn', settings(MAIN_PHASES));

    expect(yielded.state.turn.active).toBe(0);
    expect(yielded.state.turn.step).toBe('precombatMain');
    expect(yielded.state.turn.number).toBeGreaterThan(before.state.turn.number);
  });

  it('does nothing when the pending decision is not a priority', () => {
    let session = createSession(SETUP, seats(), settings(DEFAULT_AUTO_PASS));
    const pick = asBotWould(simpleAgent('mirror'));
    for (let guard = 0; guard < 2000; guard += 1) {
      const decision = session.pending;
      if (decision === null) break;
      if (decision.kind !== 'priority') {
        expect(yieldPriority(session, 'endOfTurn', settings(DEFAULT_AUTO_PASS))).toBe(session);
        return;
      }
      session = choose(session, pick(session), settings(DEFAULT_AUTO_PASS));
    }
    throw new Error('the game never asked anything but a priority');
  });
});

describe('the measurement the bead asked for', () => {
  /**
   * Clicks to turn 24 in a seeded game, driven by a player who only ever passes.
   * The bead recorded 252 before any of this existed; the numbers this asserts
   * are what the same drive costs now, and they are pinned so the next change to
   * auto-pass has something to be compared against rather than a feeling.
   *
   * Measured on this seed: 109 clicks at full control and 18 with the default
   * stop set, which is a sixth of them. It was 37 until `mtg-hmy` — a player who
   * only ever passes never plays a land, so from the second turn on their two
   * stopped main phases and the three stopped steps of the opponent's turn were
   * all windows whose whole content was the pass, and the stop set asked about
   * every one of them. The 18 that are left are the ones that are actually a
   * decision.
   *
   * Pinned as bounds rather than as exact equalities: the drive is seeded and
   * deterministic, but an unrelated change to the enumeration would move it by
   * one or two and a test that fails on that is a test people delete.
   */
  function clicksToTurn24(options: SessionOptions): number {
    let session = createSession(SETUP, seats(), options);
    let clicks = 0;
    for (let guard = 0; guard < 10_000; guard += 1) {
      if (session.pending === null || session.state.turn.number >= 24) return clicks;
      session = choose(session, 0, options);
      clicks += 1;
    }
    throw new Error('clicksToTurn24: the game never got there');
  }

  it('costs a fraction of what it did', () => {
    const before = clicksToTurn24({});
    const after = clicksToTurn24(settings(DEFAULT_AUTO_PASS));

    expect(before).toBeGreaterThan(100);
    expect(after).toBeLessThan(before / 5);
    expect(after).toBeLessThan(25);
  });
});

/**
 * One preference per seat, which is what two people on two machines have.
 *
 * `SessionOptions.autoPass` is a single value, applied to whichever seat the
 * settle loop is standing in front of. On a shared screen that is exactly right,
 * because both seats share the interface the setting is a fact about. Across a
 * network they do not, and getting it wrong is not a display bug: a stop-driven
 * pass is a real choice that reaches `reduce` and is recorded, so a seat whose
 * own stops were never consulted is never asked at all.
 *
 * The two directions are asserted separately, because a pair that ignored its
 * index would pass one of them by accident.
 */
describe('one auto-pass setting per seat', () => {
  /** Passes every priority that is not a decision the kernel forces. */
  const ALWAYS_PASS: AutoPassSettings = {
    enabled: true,
    passUnstopped: true,
    stops: { yourTurn: new Set<Step>(), theirTurn: new Set<Step>() },
  };

  const twoHumans = () => [humanSeat('One'), humanSeat('Two')] as const;

  /** Which seat each priority question was put to, for a bounded run. */
  function prioritiesAskedOf(options: SessionOptions, steps: number): readonly PlayerId[] {
    let session = createSession(SETUP, twoHumans(), options);
    const asked: PlayerId[] = [];
    for (let guard = 0; guard < steps; guard += 1) {
      const decision = session.pending;
      if (decision === null) return asked;
      if (decision.kind === 'priority') asked.push(decision.player);
      session = choose(session, 0, options);
    }
    return asked;
  }

  it('asks only the seat that did not ask to be passed for', () => {
    const asked = prioritiesAskedOf({ seatAutoPass: [ALWAYS_PASS, FULL_CONTROL] }, 400);
    expect(asked.length).toBeGreaterThan(20);
    expect(asked.filter((player) => player === 0)).toEqual([]);
  });

  it('reads the pair by seat rather than taking whichever came first', () => {
    const asked = prioritiesAskedOf({ seatAutoPass: [FULL_CONTROL, ALWAYS_PASS] }, 400);
    expect(asked.length).toBeGreaterThan(20);
    expect(asked.filter((player) => player === 1)).toEqual([]);
  });

  it('is a preference and not a position: the pair loses to nothing on replay', () => {
    const options: SessionOptions = { seatAutoPass: [ALWAYS_PASS, FULL_CONTROL] };
    let session = createSession(SETUP, twoHumans(), options);
    for (let guard = 0; guard < 200 && session.pending !== null; guard += 1) {
      session = choose(session, 0, options);
    }
    const replayed = replaySession(SETUP, twoHumans(), session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toEqual(serializeEvents(session.events));
  });

  it('takes the pair over the shared setting, seat by seat', () => {
    const shared = prioritiesAskedOf({ autoPass: FULL_CONTROL }, 400);
    const overridden = prioritiesAskedOf(
      { autoPass: FULL_CONTROL, seatAutoPass: [ALWAYS_PASS, FULL_CONTROL] },
      400,
    );
    expect(shared.filter((player) => player === 0).length).toBeGreaterThan(0);
    expect(overridden.filter((player) => player === 0)).toEqual([]);
  });
});
