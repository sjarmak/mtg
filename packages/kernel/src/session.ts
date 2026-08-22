/**
 * Interactive play: the kernel driven one decision at a time.
 *
 * `playOut` in game.ts asks every agent for an answer and gets one immediately,
 * which is exactly right for bots and is why the balance sweep can play 10,035
 * games in eight seconds. A human cannot answer immediately, and the obvious
 * fix — making `PlayerAgent.decide` return a promise — is the wrong one: it
 * would make the whole driver async, so every sim game would pay an await per
 * decision for the benefit of the one seat in a thousand that is a person.
 *
 * So control is inverted instead. A session drives the kernel rather than the
 * kernel driving the agents: it plays every bot decision itself and stops when
 * a human seat owes one, handing back the pending decision and waiting to be
 * called again. Bots keep the synchronous seam they already use, the UI gets a
 * value it can render, and there is still exactly one enforcement path, because
 * both roads end in the same `reduce`.
 *
 * **A recorded choice is an integer wherever an integer can name the move.**
 * `choices` is what `replaySession` spends, so a played game is still a seed
 * plus a list of recorded choices, and enumeration is still a pure function of
 * state. That is the invariant this file protects and every door below
 * preserves it.
 *
 * **What an integer cannot name is a declaration the enumeration truncated**
 * (`mtg-y1t.2`, 2026-08-14). Blocker declarations are exponential in the board
 * and `enumerate.ts` caps at 512, so two attackers against six untapped
 * creatures is 3^6 = 729 legal declarations of which 512 are listed. An index
 * addresses the list; 217 of those declarations are on no list, and while the
 * recorded value could only be an index they could not be declared through the
 * rail, through a click, or through the API. `Decision.complete` was false and
 * the prompt said "truncated", which is honest and is not a way through.
 *
 * So a recorded choice is a `Choice`: an index into `Decision.options`, or the
 * action itself. The action road is taken only where the index road is closed —
 * the enumeration ran short and does not contain this move — so every position
 * that fits under the cap records exactly the integers it always did and every
 * recording made before this change replays unchanged. What the wider type buys
 * is that `chooseAction` can no longer be handed a legal move it must refuse.
 *
 * A recorded action is if anything the tighter record of the two. An index
 * means whatever `legal.ts` enumerates today, so reordering the enumeration
 * silently reinterprets every log that spends one; an action names the move
 * outright and cannot be reinterpreted. What it costs is bytes and the
 * unrepresentability of an illegal move, and the second of those was already
 * spent (see below) — `choose` validates a recorded action exactly as
 * `chooseAction` validates a constructed one, so an illegal one is refused
 * rather than applied.
 *
 * **What changed is that there are now two doors** (`mtg-bz2`, 2026-08-13).
 * This docblock used to argue the stronger claim — that a human choice is an
 * index and *never* a constructed action, which "makes an illegal action
 * unrepresentable rather than rejected after the fact". That claim is now
 * false, and the reversal is recorded rather than deleted. It bought
 * unrepresentability at a price the MTGO-style surface cannot pay: a staged
 * cast, a click-built block declaration, an interactively chosen target and a
 * chosen mana payment all *construct* a move and then ask what it is, and for
 * combat the alternative is grotesque — `legal.ts` enumerates blocker orderings
 * as a cartesian product of permutations, so a three-blocker double-block is 36
 * options to find yourself in.
 *
 * So `chooseAction` takes a constructed action and `choose` takes a recorded
 * choice. Neither weakens the other:
 *
 *  - `choose` spends a recording. An index is still incapable of naming a move
 *    the kernel did not enumerate, and an action is checked by `validateAction`
 *    before it is reduced, so neither shape can apply an illegal move.
 *  - `chooseAction` is checked before anything is applied by `validateAction`,
 *    which re-derives every condition from state rather than trusting a list
 *    (its header in `legal.ts` argues this case). Then it prefers the
 *    enumeration: the action is resolved to its index in `decision.options` and
 *    *that* is what is recorded where it exists, so a game played entirely
 *    through this door on an ordinary board replays through `replaySession` on
 *    integers like any other.
 *
 * An action that is legal but absent from a *complete* enumeration is an error,
 * not a move: the kernel enumerated everything it believes is legal and this
 * was not among it, which is a disagreement between `validateAction` and
 * `legal.ts` and is a kernel bug rather than a player's. Absent from a
 * truncated one is a move, and is recorded as itself.
 *
 * Sessions are immutable. Every call returns a new one, so holding the previous
 * value is enough to show what just happened.
 *
 * **Undo is not that, and this file used to say it was** (`mtg-bz2.13`,
 * 2026-08-13). Keeping the previous value takes back one call, which is neither
 * the unit a player means nor a thing that is always allowed. `undoTo` and
 * `undo` at the foot of this file are the real feature: they rewind by replaying
 * a prefix of `choices`, and they refuse to cross a commit boundary. `undo.ts`
 * owns which events close one and argues the set; `GameSession.committed` is
 * where the answer is kept, so the refusal is a check rather than a recount.
 */
import type { Action } from './actions';
import { IllegalActionError } from './actions';
import { canonicalAction, indexOfAction } from './action-identity';
import type { PlayerAgent } from './agent';
import type { AutoPassSettings, YieldBoundary } from './autopass';
import {
  settledChoice,
  canRespond,
  opposingStack,
  passIndex,
  reachedBoundary,
  stopWantsAQuestion,
  unstoppedPassChoice,
} from './autopass';
import type { Beat, BeatSet } from './beats';
import { beatIn, NO_BEATS } from './beats';
import { settledAction } from './damage-order';
import type { GameEvent } from './events';
import type { PlayerId } from './ids';
import type { Decision } from './legal';
import { asksInSteps, pendingDecision, validateAction } from './legal';
import { reduce } from './reduce';
import { createGame } from './setup';
import type { GameSetup } from './setup';
import type { GameResult, GameState } from './state';
import type { CommitReason, Commitment } from './undo';
import { commitmentAfter } from './undo';

/** Who is answering for a seat. */
export type Seat =
  { readonly kind: 'human'; readonly name: string } | { readonly kind: 'bot'; readonly agent: PlayerAgent };

/**
 * One recorded decision: the index of an enumerated option, or the move itself.
 *
 * The action shape exists for the declarations `enumerate.ts` truncates, and is
 * used only where an index cannot name the move (`chooseAction`). The file
 * docblock carries the argument and what the wider type costs.
 */
export type Choice = number | Action;

/** Whether a recorded choice addresses the enumeration rather than naming a move. */
function isIndex(choice: Choice): choice is number {
  return typeof choice === 'number';
}

export function humanSeat(name: string): Seat {
  return { kind: 'human', name };
}

export function botSeat(agent: PlayerAgent): Seat {
  return { kind: 'bot', agent };
}

export function seatName(seat: Seat): string {
  return seat.kind === 'human' ? seat.name : seat.agent.name;
}

export interface GameSession {
  readonly seats: readonly [Seat, Seat];
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly result: GameResult | null;
  /**
   * Non-null exactly when a human seat owes the next decision.
   */
  readonly pending: Decision | null;
  /**
   * Non-null when the settle loop halted to let somebody watch something
   * happen, rather than because a decision is owed. `beats.ts` argues the
   * mechanism and carries the payload rule: a combat beat is a bare tag because
   * the board it hands back is the answer, and a death names what died because
   * by then the board no longer holds it.
   *
   * So a session handed to a UI is in one of four states, and they are mutually
   * exclusive: finished (`result` set), waiting on a decision (`pending` set),
   * paused on a beat (this), or — during a `yieldPriority` or a replay, both of
   * which run the loop themselves — none of the three. **A beat is not a
   * decision**: nothing is appended to `choices`, so seed plus `choices` is the
   * whole record of the game exactly as it was, and the next `advance` picks the
   * loop up where it left off.
   */
  readonly beat: Beat | null;
  /**
   * Every choice a human has made, in order. Seed plus this list is the entire
   * record of a played game.
   */
  readonly choices: readonly Choice[];
  /** Decisions applied so far, human and bot alike. */
  readonly decisions: number;
  /**
   * How far back a rewind may go, and what stops it going further. Null until
   * some choice has produced an event that closed a boundary.
   *
   * Carried rather than recomputed because a UI asks on every render and the
   * recount is a whole replay. It is derived from the log by one rule
   * (`undo.ts`'s `commitmentAfter`), so a replayed session lands on the identical
   * value, and it is not game state: `GameState`, `stateFingerprint` and `fork`
   * never see it.
   */
  readonly committed: Commitment | null;
}

export interface SessionOptions {
  /**
   * Safety valve against a bot that never advances the game, counted across the
   * whole session rather than per `advance` call.
   */
  readonly maxDecisions?: number | undefined;
  /**
   * Which priorities a human seat is asked about; absent asks about all of them.
   *
   * Here rather than in `GameState` because it is a fact about the interface,
   * not about the position — `autopass.ts` carries the whole argument. Absent by
   * default so every caller that predates it keeps today's behavior, which
   * includes the sim, the balance sweep and the replay fixtures.
   */
  readonly autoPass?: AutoPassSettings | undefined;
  /**
   * The same preference, one per seat, for a game whose two humans are not
   * looking at the same interface.
   *
   * `autoPass` is a single value applied to whichever seat the loop is standing
   * in front of, which is exactly right while both seats share one screen and
   * therefore one set of controls. Two people on two machines have two, and
   * spending one seat's settings on the other seat's priority is not a display
   * bug: `unstoppedPassChoice` passes for real and records the pass, so the
   * player whose stops were never consulted is never asked. `@mtg/netplay` is
   * the caller that has two.
   *
   * Takes precedence over `autoPass` where both are set, seat by seat, so a
   * caller can give a pair and nothing else. Cleared by `replaySession` along
   * with `autoPass` and for the same reason: a recording is spent at full
   * control whatever the settings say.
   */
  readonly seatAutoPass?: readonly [AutoPassSettings, AutoPassSettings] | undefined;
  /**
   * Which moments the settle loop halts at so they can be seen.
   *
   * Absent runs the loop to the next decision, which is what every caller that
   * predates it wants and gets: the sim, the balance sweep, the replay fixtures
   * and `@mtg/netplay` all leave it off. `beats.ts` argues why this is a pause
   * and not a stop, and why it belongs here rather than in `GameState`.
   *
   * Session-wide rather than per seat, unlike `autoPass`: a pause asks nobody
   * anything, so there is no seat whose settings it could be spent on. Two
   * people on two machines are the case it is deliberately not offered to —
   * halting a shared server would make one player's pacing the other player's
   * wait.
   */
  readonly watchBeats?: BeatSet | undefined;
}

/**
 * The auto-pass preference that applies to one seat.
 *
 * One function rather than a read at each call site, because "the pair wins,
 * seat by seat" is the whole of the rule and a second spelling of it is a second
 * chance to apply the wrong seat's stops.
 */
function settingsFor(options: SessionOptions, player: PlayerId): AutoPassSettings | undefined {
  return options.seatAutoPass?.[player] ?? options.autoPass;
}

/**
 * What a surface needs in order to draw a game, and no more.
 *
 * `GameSession` is assignable to it, so a component typed against this takes a
 * live session unchanged. What it leaves out is what cannot cross a wire or must
 * not: `seats` holds a bot's `decide` function, and `committed` belongs to undo,
 * which a two-player game has no agreement protocol for.
 *
 * It exists so that a view can be handed a position that arrived over a network
 * without anyone having to fabricate the fields it does not use. `@mtg/ui`'s
 * `PlayView` takes this; `@mtg/netplay` builds one per seat out of a concealed
 * position (`visibility.ts`).
 */
export interface SessionView {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly result: GameResult | null;
  readonly pending: Decision | null;
  readonly decisions: number;
  /** Only the recorded count is consumed by a surface; values stay authoritative. */
  readonly choices: Pick<readonly Choice[], 'length'>;
}

const DEFAULT_MAX_DECISIONS = 200_000;

/** Starts a game and plays it up to the first human decision. */
export function createSession(
  setup: GameSetup,
  seats: readonly [Seat, Seat],
  options: SessionOptions = {},
): GameSession {
  const created = createGame(setup);
  const opened: GameSession = {
    seats,
    state: created.state,
    events: created.events,
    result: created.state.result,
    pending: null,
    beat: null,
    choices: [],
    decisions: 0,
    committed: null,
  };
  return advance(opened, options);
}

/**
 * Plays bot decisions — and the human priorities there is nothing to decide at —
 * until a human owes a real one or the game ends.
 *
 * Called for you by `createSession` and `choose`, and exported because a UI that
 * has just swapped a seat, or just changed its stop set, needs to re-settle the
 * session without submitting a choice.
 *
 * **A priority passed for the player is a choice, and it is recorded as one.**
 * Whichever of the two predicates took it, it goes through the same `reduce` as
 * a pressed button, emits the same `passPriority` event at the same point in the
 * log, and appends the same index to `choices`. That is what makes every game
 * this drives a game that replays: `replaySession` spends the integers at full
 * control and lands in the same position, byte for byte.
 *
 * The two are asked in order and the order is the claim they make. First
 * `settledChoice`, which fires only where the kernel enumerated a single legal
 * option — those are not decisions whatever kind of decision they are asked as,
 * and a game played with it on records the identical log to the same game played
 * with it off. Then
 * `unstoppedPassChoice`, which fires because the player's stop set does not name
 * this step — that one *is* a decision, it is visible in the log as the pass it
 * is, and it makes no claim about a full-control player's recording, because
 * that player was offered plays this one asked not to be offered. `autopass.ts`
 * carries the argument for keeping them separate.
 *
 * **The events a bot plays here belong to the human choice that let it play
 * them**, which is what `commitmentAfter` folds as the loop runs. Rewinding to
 * the prefix that choice ended would discard the bot's answer along with it, so
 * a boundary the bot closed has to refuse that rewind exactly as one the human
 * closed does. `undo.ts` carries the set and the argument.
 *
 * **It also halts on a beat, and calling it again is how the game
 * resumes.** `options.watchBeats` names the moments (`beats.ts`); a halt
 * appends nothing to `choices` and asks nobody anything, so it is invisible to
 * the recording and to `stateFingerprint`. Every return path below states
 * `beat` outright, which is what makes re-entry the resume: the session that
 * comes back in carries the beat it stopped on, and the first thing this does is
 * stop carrying it.
 */
export function advance(session: GameSession, options: SessionOptions = {}): GameSession {
  const limit = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const beats = options.watchBeats ?? NO_BEATS;
  let state = session.state;
  let events = session.events;
  let choices = session.choices;
  let decisions = session.decisions;
  let committed = session.committed;

  for (;;) {
    const decision = pendingDecision(state);
    if (decision === null) {
      return {
        ...session,
        state,
        events,
        result: state.result,
        pending: null,
        beat: null,
        choices,
        decisions,
        committed,
      };
    }
    const seat = session.seats[decision.player];
    let action: Action;
    if (seat.kind === 'human') {
      if (decision.options.length === 0) {
        throw new Error(
          `session: the kernel asked player ${decision.player} for a "${decision.kind}" decision with no legal options`,
        );
      }
      // Looked up per decision rather than once per call: with a seat pair in
      // hand, the settings that apply change every time the question crosses the
      // table, and reading them outside the loop is how one seat's stops get
      // spent on the other seat's priority.
      const autoPass = settingsFor(options, decision.player);
      const taken =
        autoPass === undefined
          ? null
          : (settledChoice(decision, autoPass) ?? unstoppedPassChoice(state, decision, autoPass));
      if (taken === null) {
        return {
          ...session,
          state,
          events,
          result: null,
          pending: decision,
          beat: null,
          choices,
          decisions,
          committed,
        };
      }
      action = decision.options[taken] as Action;
      choices = [...choices, taken];
    } else {
      action = seat.agent.decide({ state, player: decision.player, decision });
      if (action.player !== decision.player) {
        throw new Error(
          `agent ${seat.agent.name} answered for player ${action.player} but player ${decision.player} was asked`,
        );
      }
    }
    if (decisions >= limit) {
      throw new Error(`session: exceeded ${limit} decisions without finishing the game`);
    }
    const step = reduce(state, action);
    state = step.state;
    events = [...events, ...step.events];
    committed = commitmentAfter(committed, step.events, choices.length);
    decisions += 1;
    // A finished game is not paused on the way out: the board is drawn with the
    // result beside it, so the lethal damage is on screen either way and a
    // "keep going" over a game that has ended would be a control that lies.
    const beat = state.result === null ? beatIn(step.events, beats) : null;
    if (beat !== null) {
      return {
        ...session,
        state,
        events,
        result: null,
        pending: null,
        beat,
        choices,
        decisions,
        committed,
      };
    }
  }
}

/**
 * Applies the human's choice and plays on to the next one.
 *
 * An integer addresses `session.pending.options`. Anything outside that range is
 * a caller bug rather than an illegal move, and says so: the options were handed
 * out by the kernel one call ago.
 *
 * An action is a recorded declaration the enumeration did not contain, which
 * `chooseAction` writes only where the enumeration ran short. It is checked by
 * `validateAction` here rather than trusted, so spending a recording is exactly
 * as safe as making the move was: a log that was tampered with off the wire
 * cannot smuggle an illegal declaration in through the shape that carries one.
 *
 * **The player's own move is checked for a beat before the loop runs at all**,
 * and that is the first of the three: an attack declaration lands here, not in
 * `advance`, so a click on "attack with both" that then swept through blocks and
 * damage would have shown the attack for no frames whatever. The check is the
 * same `beatIn` on the same events; `advance` picks it up from the next reduce
 * onward.
 */
export function choose(session: GameSession, choice: Choice, options: SessionOptions = {}): GameSession {
  const decision = session.pending;
  if (decision === null) {
    throw new Error(
      session.result === null
        ? 'session: choose was called while no human decision was pending'
        : 'session: choose was called after the game ended',
    );
  }
  let action: Action;
  if (isIndex(choice)) {
    if (!Number.isInteger(choice) || choice < 0 || choice >= decision.options.length) {
      throw new Error(
        `session: choice ${String(choice)} is outside the ${decision.options.length} options offered for "${decision.kind}"`,
      );
    }
    action = decision.options[choice] as Action;
  } else {
    const reason = validateAction(session.state, choice);
    if (reason !== null) throw new IllegalActionError(choice, reason);
    action = choice;
  }
  const step = reduce(session.state, action);
  const choices = [...session.choices, choice];
  const applied: GameSession = {
    ...session,
    state: step.state,
    events: [...session.events, ...step.events],
    result: step.state.result,
    pending: null,
    beat: null,
    choices,
    decisions: session.decisions + 1,
    committed: commitmentAfter(session.committed, step.events, choices.length),
  };
  const beat = step.state.result === null ? beatIn(step.events, options.watchBeats ?? NO_BEATS) : null;
  if (beat !== null) return { ...applied, beat };
  return advance(applied, options);
}

/**
 * Thrown when a constructed action is legal but is not in the enumeration.
 *
 * A separate error from `IllegalActionError` because it is a separate fault
 * with a separate owner. An illegal action is the caller's: they built a move
 * the rules do not allow. This one says the rules *do* allow it and the kernel
 * did not offer it, which is either a caller that constructed a shape the
 * enumeration spells differently, or the kernel truncating the list.
 *
 * **It now means one thing, and it used to mean two** (`mtg-y1t.2`). The kernel
 * enumerated everything it believes is legal and this was not among it, which is
 * a disagreement between `validateAction` and `legal.ts` and should be reported
 * as a kernel bug. The other case it used to cover — the enumeration was capped
 * before the move was reached — was the caller being refused a legal move
 * because the recording could only hold an index, and is now recorded as the
 * action it is. `complete` is therefore always true here; it is kept on the
 * error because it is the fact that distinguishes the two, and a reader who
 * remembers the old meaning should be able to see which one this is.
 *
 * A sequenced decision is complete too, and never reaches this. `complete` says
 * the backend ran out of legal moves rather than stopped listing, and a
 * one-step-at-a-time question runs out honestly — the moves it did not list are
 * reached through the moves it did, not left off the end.
 */
export class ActionNotEnumeratedError extends Error {
  readonly action: Action;
  /** Whether the decision's own enumeration ran to completion. */
  readonly complete: boolean;

  constructor(action: Action, decision: Decision) {
    super(
      `session: ${action.type} is legal but the "${decision.kind}" enumeration does not contain it, so the kernel disagrees with itself about what is legal`,
    );
    this.name = 'ActionNotEnumeratedError';
    this.action = action;
    this.complete = decision.complete;
  }
}

/**
 * Applies a constructed action and plays on to the next decision.
 *
 * The ergonomic door. A surface that builds a move out of clicks — an attack
 * declaration, a block, a target, a payment — reaches this one; a replay reaches
 * `choose`. The file docblock carries why both exist and what the reversal cost.
 *
 * Three refusals, in order, and none of them reduces anything:
 *
 *  1. Nothing is pending, which is the same caller bug `choose` reports.
 *  2. `validateAction` says why not, raised as `IllegalActionError`. This is the
 *     real guard: it re-derives legality from `session.state` rather than
 *     trusting a list, so a constructed action is checked exactly as hard as an
 *     agent's own declaration is.
 *  3. The action is legal, the enumeration is complete, and it is still not on
 *     the list, raised as `ActionNotEnumeratedError`. That is the kernel
 *     disagreeing with itself and belongs to nobody but the kernel.
 *
 * `asksInSteps` is the exception to the third, and the only one. A sequenced
 * decision lists the moves that answer its *next* step and is complete about
 * them, so a caller who hands over the whole answer at once — which every bot
 * and both play surfaces do for a damage assignment order — is legal, off the
 * list, and not a kernel disagreement. It records itself, exactly as a capped
 * enumeration's overflow used to.
 *
 * Past all three it is `choose`, so there is one enforcement path and one
 * recording path whichever door the game was played through.
 *
 * **The index is preferred and the action is the fallback**, which is what keeps
 * this change invisible to every board that fits under the cap. An enumerated
 * move records the integer it always did; a move the truncation left off records
 * itself.
 *
 * What is applied is what is recorded, and the two shapes reach that the same
 * way. An enumerated move applies the *enumeration's* copy, because a caller may
 * legitimately spell a declaration list in another order and only one of those
 * spellings has an index. A move with no index applies its canonical spelling
 * for the same reason: `canonicalAction` puts the lists the rules treat as sets
 * in one order, so two players who clicked the same block in different orders
 * record the same bytes.
 *
 * `settledAction` is the half of that spelling rule the board has to answer.
 * `canonicalAction` can put a set in one order without looking at the game, but
 * whether two blockers are one slot in a damage assignment order is a fact about
 * the position (`damage-order.ts`), and the enumeration folds the spellings it
 * cannot tell apart. Settling first is what keeps the third refusal honest: a
 * folded spelling finds the index of the option it was folded into instead of
 * being reported as the kernel disagreeing with itself.
 */
export function chooseAction(
  session: GameSession,
  action: Action,
  options: SessionOptions = {},
): GameSession {
  const decision = session.pending;
  if (decision === null) {
    throw new Error(
      session.result === null
        ? 'session: chooseAction was called while no human decision was pending'
        : 'session: chooseAction was called after the game ended',
    );
  }
  const reason = validateAction(session.state, action);
  if (reason !== null) throw new IllegalActionError(action, reason);
  const settled = settledAction(session.state, action);
  const index = indexOfAction(decision.options, settled);
  if (index !== null) return choose(session, index, options);
  if (decision.complete && !asksInSteps(decision)) {
    throw new ActionNotEnumeratedError(action, decision);
  }
  return choose(session, canonicalAction(settled), options);
}

/**
 * Passes every priority up to a boundary, the way Magic Online's F4 and F6 do.
 *
 * The third control auto-pass alone cannot give you: auto-pass stops wherever a
 * legal play exists, and "I have plays and I am not making any of them until my
 * next turn" is the ordinary way a turn ends. Pressing this is a decision, so
 * the passes it makes are recorded exactly as auto-pass's are — it drives
 * `choose`, which drives `reduce`, so a yielded run is indistinguishable in the
 * log from the same run clicked out by hand.
 *
 * It hands the game back for four reasons, and each is a reason a player would
 * want it back. The boundary arrived. The kernel asked something that is not a
 * priority, which is a question no yield may answer for anyone — blockers,
 * ordering, a discard. A step in the stop set came up **with a play in it**,
 * because a yield that ignored the stops would make them a lie, and one that
 * broke at a stop the player can only pass at would hand back the very prompt
 * `advance` stopped producing under `mtg-hmy` — `stopWantsAQuestion` is the one
 * predicate both of them read. Or something the player did not put
 * there went on the stack *and they hold an answer to it*, which is what stops a
 * yield from being a way to lose to a spell nobody saw; a spell already on the
 * stack when the yield was pressed does not count, since pressing it was consent
 * to that one resolving, and neither does one the player could only watch —
 * `canRespond` in `autopass.ts` carries why tapping a land is not an answer.
 *
 * **The step it was pressed in is not one of those stops.** A stop has already
 * done its whole job by the time a player is looking at the window and reaching
 * for the yield, and re-honoring it there would make the button do nothing at
 * exactly the position it is most often pressed from — silently, since a yield
 * that stops immediately is indistinguishable on screen from one nobody
 * pressed. Every stop after that step is honored normally.
 *
 * **A boundary is where the yield stops running, not where the game stops
 * asking.** With the stop set authoritative, the last pass this makes settles
 * through `advance` like any other, so the session comes back at the first
 * priority the player's own settings would have asked about — their next stop —
 * rather than at whatever priority the boundary happens to land on. That is the
 * difference between a yield to your next turn and a yield to your next turn's
 * upkeep, and the second one is not a control anybody asked for. With the stop
 * set inert the boundary is the landing spot again, because then every priority
 * is one the settings would ask about.
 *
 * Returns the session untouched when no priority is pending, so a stray press on
 * a finished game or a blocker prompt costs nothing.
 *
 * **A yield runs past the beats**, which is the one place `watchBeats`
 * is deliberately dropped. A beat is pacing for somebody who is watching; this
 * button is pressed by somebody who has said they are not, and a yield that
 * halted three times in a combat would be a control the player has to press four
 * times to get one press of. What they keep is the harder guarantee: the loop
 * still refuses to answer anything that is not a priority, so a block
 * declaration of their own still hands the game back with the attack on the
 * board in front of them.
 */
export function yieldPriority(
  session: GameSession,
  boundary: YieldBoundary,
  options: SessionOptions = {},
): GameSession {
  const opening = session.pending;
  if (opening === null || opening.kind !== 'priority') return session;
  const player = opening.player;
  const startedOnTurn = session.state.turn.number;
  const startedInStep = session.state.turn.step;
  const alreadyThere = opposingStack(session.state, player);
  const stops = settingsFor(options, player)?.stops ?? null;
  const limit = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const running: SessionOptions = { ...options, watchBeats: undefined };

  let current = session;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = current.pending;
    if (decision === null || decision.kind !== 'priority' || decision.player !== player) return current;
    if (reachedBoundary(current.state, player, boundary, startedOnTurn)) return current;
    const stillWhereItStarted =
      current.state.turn.number === startedOnTurn && current.state.turn.step === startedInStep;
    if (stops !== null && !stillWhereItStarted && stopWantsAQuestion(current.state, decision, stops))
      return current;
    const arrived = [...opposingStack(current.state, player)].some((oid) => !alreadyThere.has(oid));
    if (arrived && canRespond(decision)) return current;
    const index = passIndex(decision);
    if (index === null) return current;
    current = choose(current, index, running);
  }
  throw new Error(`session: a yield made ${limit} passes without reaching its boundary`);
}

/**
 * The seats a human is sitting in, which a UI needs in order to decide whether
 * to render a decision prompt or a spectator view.
 */
export function humanSeats(session: GameSession): readonly PlayerId[] {
  const seated: PlayerId[] = [];
  if (session.seats[0].kind === 'human') seated.push(0);
  if (session.seats[1].kind === 'human') seated.push(1);
  return seated;
}

/**
 * Replays a recorded game from its seed and choice list.
 *
 * This is the determinism assertion the milestone rests on, and it is a real
 * one: a replay that diverges anywhere earlier does not quietly pick a
 * different-but-legal action. A recorded index lands out of range or in a
 * different position with the same integers; a recorded action is validated
 * against the position the replay actually reached and is refused when that
 * position no longer allows it. The bot seats must be the same agents, since
 * their answers are part of the history too.
 *
 * Passing fewer choices than were recorded resumes mid-game rather than
 * failing, which is what makes this double as save-and-continue. Passing more
 * than the game asks for is a divergence and throws.
 *
 * **A replay always runs at full control**, whatever the caller's settings say,
 * and dropping that is the one way to get this wrong. An auto-passed priority is
 * already *in* the recording, so a replay that auto-passed it too would consume
 * the decision without consuming the integer that recorded it, and every choice
 * after that point would land one question late. Replaying at full control asks
 * about every priority and spends the list exactly as it was written, which is
 * also why a recording made under one stop set replays identically under
 * another. Resuming with auto-pass on is `advance` on the finished replay; that
 * is what `@mtg/ui`'s `usePlaySession` does.
 *
 * **The beats are dropped here too, and for a harder reason than
 * tidiness.** A halted `advance` hands back a session with nothing pending, so
 * the next `choose` in the loop below would find no decision and throw rather
 * than spend the next integer. A replay is a machine reading a recording; there
 * is nobody watching it, and it has to run.
 */
export function replaySession(
  setup: GameSetup,
  seats: readonly [Seat, Seat],
  choices: readonly Choice[],
  options: SessionOptions = {},
): GameSession {
  const deterministic: SessionOptions = {
    ...options,
    autoPass: undefined,
    seatAutoPass: undefined,
    watchBeats: undefined,
  };
  let session = createSession(setup, seats, deterministic);
  for (const [step, choice] of choices.entries()) {
    if (session.pending === null) {
      throw new Error(
        `replaySession: the recording has ${choices.length} choices but the game stopped asking after ${step}`,
      );
    }
    session = choose(session, choice, deterministic);
  }
  return session;
}

/**
 * Thrown when a rewind would cross a commit boundary, or when there is no
 * uncommitted decision left to take back.
 *
 * An error rather than a session handed back unchanged, and that is the bead's
 * own acceptance criterion (`mtg-bz2.13`): "undo is refused past it with a stated
 * reason rather than silently doing nothing". A control that quietly does
 * nothing is indistinguishable on screen from one that is broken, and the player
 * who pressed it has learned nothing about why the game will not go back.
 *
 * `reason` is null in exactly one case, which is the one where there is no
 * boundary to name: nothing has been recorded yet, so the request was to take
 * back a decision that was never made.
 */
export class UndoRefusedError extends Error {
  /** The prefix length the caller asked to land on. */
  readonly requested: number;
  /** The shortest prefix the boundary allows. */
  readonly floor: number;
  readonly reason: CommitReason | null;

  constructor(requested: number, floor: number, reason: CommitReason | null) {
    super(refusalMessage(requested, floor, reason));
    this.name = 'UndoRefusedError';
    this.requested = requested;
    this.floor = floor;
    this.reason = reason;
  }
}

function refusalMessage(requested: number, floor: number, reason: CommitReason | null): string {
  if (reason === null) return 'undo: no decision has been taken yet, so there is nothing to take back';
  if (requested >= floor) return `undo: nothing is left to take back, because ${reason.why}`;
  return `undo: rewinding to ${String(requested)} decisions would cross the commit boundary at ${String(floor)}, where ${reason.why}`;
}

/** Whether any recorded decision is still uncommitted, so `undo` would move. */
export function canUndo(session: GameSession): boolean {
  return (session.committed?.floor ?? 0) < session.choices.length;
}

/**
 * Whether this position has part of a combat declaration in and is still being
 * asked for the rest.
 *
 * `mtg-nj6m` states the rule as "owes `declareBlockers` while `combat.blocks` is
 * non-empty". That was written before the count existed, and the count catches
 * one more position than the pairs do: a defender who has declined with its
 * first two creatures has settled two questions and left no pair behind, so the
 * position reads as an undeclared block while two creatures are already out of
 * it. Reading the count says yes to that one too, and it says yes to exactly the
 * positions `reduce` writes it at, which is every interior and nothing else.
 *
 * A discard or a mulligan's bottoming answered one card at a time is the same
 * kind of interior and gets the same answer (`mtg-cs8t`): "I have named three of
 * the five cards I am pitching" is a position the interface produced and the
 * rules do not have, so a rewind that would land on one walks back to the
 * position the discard opened from. `pendingSelection` is present at exactly
 * those positions and absent everywhere else.
 */
function midDeclaration(session: GameSession): boolean {
  const { combat, pendingSelection } = session.state;
  return (
    combat.attacksSettled !== undefined ||
    combat.blocksSettled !== undefined ||
    pendingSelection !== undefined
  );
}

/**
 * Rewinds to a named prefix of the recording, or refuses to.
 *
 * The general form, and the acceptance criterion needs it to be general: a rule
 * that clamps a request to the boundary can never refuse one, so it can never
 * state a reason. This takes the prefix the caller asked for and either lands on
 * it or says which event makes it unreachable.
 *
 * `keep` outside the recording is a caller bug rather than a refusal, and says
 * so separately: asking to rewind to a decision the game never reached is not a
 * player being told no, it is a surface that has lost count.
 *
 * The rewind itself is `replaySession` on the prefix, so the landed position is
 * byte-identical to the one the game actually stood in — the same state, the
 * same log, the same commitment — rather than merely similar. Then `advance`
 * hands the tail back to the caller's settings, exactly as resuming a recording
 * does (`@mtg/ui`'s `usePlaySession` start path), so the session comes back
 * settled the way every other session that surface holds is.
 *
 * That settling runs past the beats. A beat is a first viewing of
 * something that just happened; a rewind is by definition not one, and landing
 * the player on "here is that combat again" rather than on the decision they
 * pressed undo to get back would be the button doing something other than what
 * it says. Playing the combat forward again produces its beats again, out of
 * `choose`, because that is a first viewing.
 *
 * **A rewind never lands inside a half-declared block** (`mtg-nj6m`, decided in
 * `369b60e8` and implemented here now that stage 2 of `mtg-cs8t` produces the
 * position). The kernel asks a wide block one creature at a time, so a prefix of
 * the recording can replay to a position with three blockers assigned and three
 * still to be asked, which is not a position CR 509.1 has. Undo pops the whole
 * block: a request that lands in the interior walks back to the position the
 * declaration opened from. It is a predicate over the replayed position rather
 * than a marker on the recording — a position that owes `declareBlockers` while
 * `combat.blocks` holds something is mid-sequence by construction — so nothing
 * has to be kept in step with anything.
 *
 * The walk cannot run past the floor: no sub-answer of a declaration emits a
 * boundary event (`undo.ts` argues which seven do), so every landing it steps
 * over is above the same floor the interior was.
 */
export function undoTo(
  setup: GameSetup,
  session: GameSession,
  keep: number,
  options: SessionOptions = {},
): GameSession {
  if (!Number.isInteger(keep) || keep < 0 || keep > session.choices.length) {
    throw new Error(
      `session: undoTo was asked for ${String(keep)}, which is outside the ${session.choices.length} decisions this game has recorded`,
    );
  }
  const floor = session.committed?.floor ?? 0;
  if (keep < floor) throw new UndoRefusedError(keep, floor, session.committed?.reason ?? null);
  const landing: SessionOptions = { ...options, watchBeats: undefined };
  let target = keep;
  let replayed = replaySession(setup, session.seats, session.choices.slice(0, target));
  while (target > floor && midDeclaration(replayed)) {
    target -= 1;
    replayed = replaySession(setup, session.seats, session.choices.slice(0, target));
  }
  return advance(replayed, landing);
}

/**
 * Takes back every decision since the last commit boundary.
 *
 * One press, not one decision, and the argument is that a decision is not a unit
 * the player can see. `choices` records an auto-passed priority as an integer of
 * its own, and one click under a stop set can append several of them through
 * `advance`, so "back one decision" would sometimes take back a pass nobody
 * made and would mean different things under different settings. A boundary is
 * read off the event log, which `autopass.ts` argues is the same log either way,
 * so "back to the boundary" is the one unit that means the same thing to every
 * player. It is also the more useful one: everything it takes back is by
 * definition something no one else has seen.
 *
 * Refused when the boundary is already at the end of the recording, which is the
 * ordinary case one press after a pass.
 */
export function undo(setup: GameSetup, session: GameSession, options: SessionOptions = {}): GameSession {
  const floor = session.committed?.floor ?? 0;
  if (floor >= session.choices.length) {
    throw new UndoRefusedError(session.choices.length, floor, session.committed?.reason ?? null);
  }
  return undoTo(setup, session, floor, options);
}
