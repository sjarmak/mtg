/**
 * Defects in what the kernel stops to ask about.
 *
 * Four entries, all in `autopass.ts`, and they are one argument arriving in
 * four steps: `ec93a00` made the stop set authoritative so an absent stop could
 * subtract a question; `1bced2d` qualified the opposing-stack rule by whether
 * the player had an answer; `f17d6d5` qualified the stop rule the same way; and
 * `a8656b5` widened the structural rule past `kind !== 'priority'` so a forced
 * blocker declaration is taken rather than pressed.
 *
 * Every one of them is a question that was asked and should not have been, and
 * the failure mode is silent in the worst way: the game underneath stays legal,
 * so nothing crashes and no assertion about the board can see it. What can see
 * it is a census of the questions a driven game put to a seat, which is what
 * these replays take. `autopass.test.ts` is the fuller treatment and holds the
 * byte-identity claims; the properties here are the ones that go red when the
 * pre-fix line is put back.
 */
import { expect } from 'vitest';
import type { Card } from '@mtg/dsl';
import { exampleCard, parseCard } from '@mtg/dsl';
import type {
  AutoPassSettings,
  Decision,
  DeckList,
  GameSession,
  GameState,
  SessionOptions,
  Step,
} from '@mtg/kernel';
import {
  advance,
  botSeat,
  canRespond,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_STOPS,
  driveDeclaration,
  getObject,
  hasStop,
  humanSeat,
  isStopped,
  opposingStack,
  pendingDecision,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  settledChoice,
  simpleAgent,
  stateFingerprint,
  stopWantsAQuestion,
  unstoppedPassChoice,
} from '@mtg/kernel';
import { instant, lands, MOUNTAIN } from '../../cards';
import { replay } from '../bank';

/** One instant the player can pay for out of two Mountains. */
const TRICK = instant('Test Trick', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});

function sliceDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => TRICK),
  ];
  return { name, cards };
}

const SETUP = {
  seed: 'regression/asking',
  decks: [sliceDeck('Human Red'), sliceDeck('Bot Red')] as const,
  maximumTurns: 40,
};

const seats = (): readonly [ReturnType<typeof humanSeat>, ReturnType<typeof botSeat>] => [
  humanSeat('the playtester'),
  botSeat(simpleAgent('greedy')),
];

const settings = (autoPass: AutoPassSettings): SessionOptions => ({ autoPass });

/** No stop anywhere, and the absent stops are authoritative. */
const UNSTOPPED: AutoPassSettings = {
  enabled: true,
  passUnstopped: true,
  stops: { yourTurn: new Set<Step>(), theirTurn: new Set<Step>() },
};

/** Both of the player's own main phases and nothing else: the reported set. */
const MAIN_PHASES: AutoPassSettings = {
  enabled: true,
  passUnstopped: true,
  stops: {
    yourTurn: new Set<Step>(['precombatMain', 'postcombatMain']),
    theirTurn: new Set<Step>(),
  },
};

/**
 * Plays lands and creatures and never spends an instant.
 *
 * The player all four defects are about: mana open, a trick still in hand, so a
 * real answer available at some opposing spells and none at the others. A
 * driver that casts everything it draws holds nothing up, and one that only
 * ever passes never puts a land down; either makes these properties untestable
 * from one side.
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

/** One question a session put to a seat, and the shape of the position it came from. */
interface Ask {
  readonly kind: string;
  readonly step: Step;
  /** True when the question arose on the asked player's own turn. */
  readonly yours: boolean;
  /** True when the stack held something the asked player did not put there. */
  readonly facingTheirs: boolean;
  /** True when something other than the pass and the mana abilities was on offer. */
  readonly couldRespond: boolean;
}

interface Played {
  readonly session: GameSession;
  readonly asks: readonly Ask[];
}

function playRecordingAsks(options: SessionOptions): Played {
  let session = createSession(SETUP, seats(), options);
  const asks: Ask[] = [];
  for (let guard = 0; guard < 10_000; guard += 1) {
    const decision = session.pending;
    if (decision === null) return { session, asks };
    asks.push({
      kind: decision.kind,
      step: session.state.turn.step,
      yours: session.state.turn.active === decision.player,
      facingTheirs: opposingStack(session.state, decision.player).size > 0,
      couldRespond: canRespond(decision),
    });
    session = choose(session, holdingATrick(session), options);
  }
  throw new Error('playRecordingAsks: the session never stopped asking');
}

/** Every position a full-control game reached, so a predicate can be read against real ones. */
function everyDecision(): readonly { readonly state: GameState; readonly decision: Decision }[] {
  const seen: { readonly state: GameState; readonly decision: Decision }[] = [];
  let session = createSession(SETUP, seats());
  for (let guard = 0; guard < 10_000; guard += 1) {
    const decision = session.pending;
    if (decision === null) return seen;
    seen.push({ state: session.state, decision });
    session = choose(session, holdingATrick(session));
  }
  throw new Error('everyDecision: the session never stopped asking');
}

/** A session parked on a stated position, so `advance` can be asked what it does with it. */
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

/**
 * Two attacking creatures with flying against three ground creatures, parked at
 * the blocker declaration: `mtg-y1t.3`'s board in the smallest form that keeps
 * the property. Every pair fails `canBlock`, so the product is the empty
 * declaration alone.
 */
function flyingAttack(): { readonly state: GameState; readonly decision: Decision } {
  let minted = 0;
  const mint = (name: string, flying: boolean): Card =>
    parseCard({
      kind: 'creature',
      id: `slc-forced-${String((minted += 1))}`,
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
    seed: 'regression/forced-blockers',
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

export const ASKING_REPLAYS = [
  replay(
    'a8656b5',
    'a decision with one complete option is taken rather than asked about, whatever kind of decision it is',
    () => {
      const { state, decision } = flyingAttack();
      if (decision.kind !== 'declareBlockers') throw new Error('the flying board asked something else');

      // The enumeration first, because the argument rests on it: three
      // creatures able to block something, nothing they can block, one
      // declaration, complete. The pre-fix rule ended at `kind !== 'priority'`
      // and returned null here, so the player pressed "no blocks" by hand.
      expect(decision.eligible).toHaveLength(3);
      expect(decision.complete).toBe(true);
      expect(decision.options).toHaveLength(1);
      expect(settledChoice(decision, DEFAULT_AUTO_PASS)).toBe(0);

      // The session takes it, and the stop set has no say: `declareBlockers` on
      // the opponent's turn is named by the defaults, and the settled rule is
      // still what decides. A stop has never had an opinion about a declaration.
      expect(hasStop(DEFAULT_STOPS, 'theirTurn', 'declareBlockers')).toBe(true);
      const parked = parkedOn(state, decision);
      const settled = advance(parked, { autoPass: DEFAULT_AUTO_PASS });
      expect(settled.pending?.kind).not.toBe('declareBlockers');
      // Taken, not skipped: the index went into `choices` exactly as a pressed
      // button's would, which is what keeps the recording replayable.
      expect(settled.choices[0]).toBe(0);

      // Non-vacuity, from both directions. Full control still asks, and a
      // truncated enumeration is never settled however few options survived the
      // cap: `blockerDecision` falls back to a lone empty declaration, so one
      // option can mean the opposite of forced.
      expect(advance(parked, {}).pending?.kind).toBe('declareBlockers');
      const truncated: Decision = { ...decision, complete: false };
      expect(settledChoice(truncated, DEFAULT_AUTO_PASS)).toBeNull();
    },
  ),
  replay(
    'f17d6d5',
    'a stop raises no question at a priority whose whole content is the pass and a land',
    () => {
      const asked = everyDecision();
      const priorities = asked.filter((entry) => entry.decision.kind === 'priority');
      expect(priorities.length, 'the drive reached no priority at all').toBeGreaterThan(0);

      // The rule: being stopped is necessary and no longer sufficient. Every
      // priority the player could not have answered wants no question, however
      // the stop set reads. The pre-fix `advance` consulted `isStopped` alone.
      for (const { state, decision } of priorities) {
        if (canRespond(decision)) continue;
        expect(
          stopWantsAQuestion(state, decision, DEFAULT_STOPS),
          `a dead priority in ${state.turn.step} still wanted a question`,
        ).toBe(false);
      }

      // Non-vacuity in the direction that matters: the sample holds priorities
      // the defaults do name and the player could not act at, which are exactly
      // the prompts the fix removed. Without one of these the loop above is
      // vacuous and the pre-fix line would pass it.
      const removed = priorities.filter(
        (entry) =>
          isStopped(entry.state, entry.decision.player, DEFAULT_STOPS) && !canRespond(entry.decision),
      );
      expect(removed.length, 'no stopped-but-dead priority arose, so nothing was subtracted').toBeGreaterThan(
        0,
      );

      // And the other direction: a stop with a play in it still fires, so the
      // qualification subtracts the dead windows and no others.
      const kept = priorities.filter(
        (entry) => isStopped(entry.state, entry.decision.player, DEFAULT_STOPS) && canRespond(entry.decision),
      );
      expect(kept.length, 'no live stopped priority arose').toBeGreaterThan(0);
      for (const { state, decision } of kept) {
        expect(stopWantsAQuestion(state, decision, DEFAULT_STOPS)).toBe(true);
      }
    },
  ),
  replay(
    '1bced2d',
    'a spell the other seat cast hands the game back only where the player could have answered it',
    () => {
      // Read as a predicate over real positions rather than as a census of a
      // driven game, because the two directions of this rule need two different
      // populations and one game cannot be replayed into both. Every stop is
      // off in `UNSTOPPED`, so the only thing that can stop `unstoppedPassChoice`
      // from passing is the opposing-stack rule itself.
      const facing = everyDecision().filter(
        (entry) =>
          entry.decision.kind === 'priority' && opposingStack(entry.state, entry.decision.player).size > 0,
      );
      expect(facing.length, 'the drive never faced the other seat stack').toBeGreaterThan(0);

      const answerable = facing.filter((entry) => canRespond(entry.decision));
      const unanswerable = facing.filter((entry) => !canRespond(entry.decision));
      expect(answerable.length, 'nothing on the stack was ever answerable').toBeGreaterThan(0);
      expect(unanswerable.length, 'nothing on the stack was ever unanswerable').toBeGreaterThan(0);

      // The qualification. The pre-fix rule was `opposingStack(...).size > 0`
      // with no `canRespond` beside it, so it refused to pass here and the
      // player pressed a button whose only content was "let it resolve".
      for (const { state, decision } of unanswerable) {
        expect(
          unstoppedPassChoice(state, decision, UNSTOPPED),
          `asked at a ${state.turn.step} spell with nothing to answer it with`,
        ).not.toBeNull();
      }

      // And qualified rather than repealed, which is the direction a later
      // simplification would break: a player who could have answered is never
      // passed through the other seat's spell, whatever the settings say.
      for (const { state, decision } of answerable) {
        expect(
          unstoppedPassChoice(state, decision, UNSTOPPED),
          `passed through a ${state.turn.step} spell the player could have answered`,
        ).toBeNull();
      }
    },
  ),
  replay(
    'ec93a00',
    'a stop set subtracts as well as adds, and the passes it makes are recorded decisions',
    () => {
      const played = playRecordingAsks(settings(MAIN_PHASES));
      const priorities = played.asks.filter((ask) => ask.kind === 'priority');
      expect(priorities.length, 'the stopped game asked no priority at all').toBeGreaterThan(0);

      // The set is authoritative: a priority no stop names is passed even with
      // plays legal in it. The two safety rules survive, so a window over the
      // other seat's stack the player could answer is still asked at.
      for (const ask of priorities) {
        const named = ask.yours && (ask.step === 'precombatMain' || ask.step === 'postcombatMain');
        expect(
          named || (ask.facingTheirs && ask.couldRespond),
          `asked at an unnamed ${ask.step} the stop set said nothing about`,
        ).toBe(true);
      }

      // Non-vacuity, and the defect itself: the same drive at full control is
      // asked at unnamed steps with real plays on offer. Before this, a stop
      // set could only ever add a question — one untapped land puts a mana
      // ability in every enumeration, so the structural rule had nothing left
      // to fire at and the set went inert.
      const control = playRecordingAsks({});
      const inert = control.asks.filter(
        (ask) =>
          ask.kind === 'priority' &&
          ask.couldRespond &&
          !(ask.yours && (ask.step === 'precombatMain' || ask.step === 'postcombatMain')),
      );
      expect(inert.length, 'full control asked nothing the set should have removed').toBeGreaterThan(0);
      expect(played.asks.length).toBeLessThan(control.asks.length);

      // The passes it made are decisions, written into `choices` as the indices
      // they are, so the recording replays at full control byte for byte.
      const replayed = replaySession(SETUP, seats(), played.session.choices, settings(MAIN_PHASES));
      expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.session.events));
      expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.session.state));
    },
  ),
];
