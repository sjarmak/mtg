/**
 * Tier 1.5: a one-ply lookahead over the greedy bot.
 *
 * The greedy bot is depth-0. Thirteen policy modules score one option with
 * hand-written arithmetic and take the maximum, and nothing ever applies an
 * action and looks at the board it produces. That is why a bug like `mtg-4aaw`
 * — the bot enchanting its own flier with a -1/-1 aura — is a bug about Auras
 * at all: the effect-walking target policy finds no effect to score, every legal
 * host ties at zero, and enumeration order picks. A search does not need to be
 * taught what an Aura is. It attaches the thing, reads the board, sees its own
 * creature dead, and takes the other line.
 *
 * The whole search is: for each option the kernel enumerated, `reduce` it, score
 * the resulting position with `evaluateState`, take the maximum. Rollback is
 * free because `reduce` is pure — there is no state to restore, only a state not
 * kept. Determinism comes for free with it, which is what `mtg-y4gw` records
 * The playtester asking for.
 *
 * Three things it deliberately is not:
 *
 *  - It is not deeper than one ply. `reduce` settles the game forward to the
 *    next decision rather than taking a single step, so each option costs a real
 *    slice of a game (278.5 us measured, `mtg-46go`), and depth compounds that.
 *  - It is not stronger than the bot it refines, and the head-to-head above is
 *    the evidence: parity, at 4.34x the wall clock. What it buys is a class of
 *    decisions it gets right without being taught the rule — `test/search-bot.
 *    test.ts` drives it from a policy deliberately skewed to enchant its own
 *    creature and it still refuses the play. Strength was never the argument in
 *    `mtg-y4gw`; not having to teach it was.
 *  - It is not the sweep bot. `mtg-y4gw`'s acceptance criterion says so outright:
 *    every baseline in `@mtg/metrics`'s format-health gate was measured with the
 *    greedy bot, and changing the sweep's bot re-baselines the whole gate in one
 *    commit. This is built for the lab, where one person waits on one decision.
 *  - It is not a replacement for the policies. Greedy decides every option this
 *    bot cannot see, and greedy's own answer is always one of the candidates, so
 *    a search that finds nothing better plays exactly the game greedy plays.
 *
 * That last point is the design: this is a *refinement* of the greedy bot, not a
 * rival to it. `decideGreedy` constructs the declarations the kernel does not
 * enumerate exhaustively — an attack, a block, a discard — and a capped
 * enumeration (`decision.complete === false`) can be missing the best of them
 * entirely. Scoring greedy's answer alongside the enumerated ones costs one more
 * `reduce` and means the search can only ever move a decision it can price
 * better.
 */
import type { Action, AgentView, GameState, PlayerAgent, PlayerId } from '@mtg/kernel';
import { IllegalActionError, pendingDecision, reduce } from '@mtg/kernel';
import type { GreedyBotConfig, StateEvalConfig } from './config';
import { DEFAULT_GREEDY_CONFIG, DEFAULT_STATE_EVAL_CONFIG } from './config';
import { evaluateState } from './evaluate-state';
import { decideGreedy } from './greedy-bot';

/** What a search seat is tuned by: the policies it refines, and the position weights. */
export interface SearchBotConfig {
  /** The depth-0 bot underneath: it answers what the search declines to. */
  readonly greedy: GreedyBotConfig;
  /** The weights `evaluateState` prices a resulting position against. */
  readonly state: StateEvalConfig;
}

export const DEFAULT_SEARCH_CONFIG: SearchBotConfig = {
  greedy: DEFAULT_GREEDY_CONFIG,
  state: DEFAULT_STATE_EVAL_CONFIG,
};

/**
 * How many priority passes a line may be settled through before it is scored.
 *
 * A stack this deep does not occur in a two-bot game; the cap is here so a
 * kernel state that somehow never empties its stack costs one bounded loop
 * rather than hanging the sweep.
 */
const QUIESCENCE_CAP = 64;

/**
 * Settles a line to a quiet position: the same board, with the stack empty.
 *
 * Without this the lookahead is worthless in this engine, and the reason is
 * specific rather than general. `reduce` runs forward to the next *decision*,
 * and the decision after casting a spell is priority with that spell still on
 * the stack — so "cast Quag Sickness on my own creature" and "cast it on
 * theirs" reduce to two boards that differ by nothing an evaluator can read.
 * Measured on `test/search-bot.test.ts`'s position, both scored -7.2.
 *
 * So each candidate is settled by passing priority until the stack is empty,
 * which is the only thing a bot with nothing to respond with would do anyway.
 * It stops at the first decision that is not a priority pass, because a trigger
 * choosing targets is a real decision and answering it here would be searching
 * a second ply under the guise of settling one.
 *
 * This is not the opponent playing well. They pass, so a line is scored as if
 * it goes unanswered, which flatters every play that could be responded to.
 * That is the honest limit of one ply against a live opponent and is a reason
 * to keep the sweep on greedy, not a reason to model a reply the search has no
 * budget to search.
 */
export function quiesce(state: GameState): GameState {
  let current = state;
  for (let step = 0; step < QUIESCENCE_CAP; step += 1) {
    if (current.result !== null || current.stack.length === 0) return current;
    const decision = pendingDecision(current, 1);
    if (decision === null || decision.kind !== 'priority') return current;
    current = reduce(current, { type: 'passPriority', player: decision.player }).state;
  }
  return current;
}

/**
 * Scores one candidate, or returns `null` when the kernel refuses it.
 *
 * The refusal is not swallowed as a zero. An option the kernel enumerated is
 * legal by construction and one greedy constructed is checked as hard, so a
 * throw here is a real defect somewhere — but it belongs to the policy that
 * produced the action, and a lookahead that crashed the whole sweep on it would
 * report as a search failure. Dropping the candidate keeps the game running
 * with every other candidate still priced, and there is always at least one:
 * greedy's own answer is scored first.
 */
function scoreAction(config: SearchBotConfig, view: AgentView, me: PlayerId, action: Action): number | null {
  try {
    if (view.previewSettled === undefined) return null;
    return evaluateState(config.greedy.cast, config.state, view.previewSettled(action), me);
  } catch (error) {
    if (error instanceof IllegalActionError) return null;
    throw error;
  }
}

/**
 * The candidates: greedy's answer, and every option that shares its horizon.
 *
 * Greedy's answer comes first because ties go to whichever candidate was seen
 * first, and a tie should be greedy's game. The rest is the correction that
 * makes this bot worth running at all, and it took a head-to-head to find.
 *
 * Scoring every enumerated option against every other compares positions taken
 * at DIFFERENT POINTS IN TIME. `reduce` runs forward to the next decision, so a
 * cast is scored on the board it makes right now, while `passPriority` is scored
 * on the board after the opponent has had a whole turn — untapped, attacked and
 * cast into. The pass therefore reads as a disaster next to any play at all, and
 * the play reads as free. Measured over 400 seeded games on the flagship set,
 * a search that compared them took 41.0% against the greedy bot it was built on
 * top of; holding the candidates to one horizon took the same seed to 50.3%,
 * against a 48.3% greedy-in-both-seats control that measures the seat bias
 * (`tools/search-head-to-head.ts --games 40 --seed sim/search/h2h/v1`).
 *
 * So the search decides WHICH play, not WHETHER to play. If greedy passes, this
 * bot passes. Otherwise it ranks the options that do the same kind of thing —
 * which host for the Aura, which body pays for the Fling, which block to make —
 * and those all stop the clock in the same place. Deciding whether to act at all
 * is a question about the future and belongs to a deeper search than one ply.
 */
function candidates(config: SearchBotConfig, view: AgentView): readonly Action[] {
  const greedy = decideGreedy(view, config.greedy);
  if (greedy.type === 'passPriority') return [greedy];
  return [greedy, ...view.decision.options.filter((option) => option.type === greedy.type)];
}

/** One decision, decided by looking at each option's resulting board. */
export function decideSearch(view: AgentView, config: SearchBotConfig): Action {
  const me = view.player;
  const options = candidates(config, view);
  const first = options[0];
  if (first === undefined) throw new Error('search bot: no candidate action');
  // One candidate is not a decision, and the reduce it would cost is the
  // largest single saving available: 42.9% of decisions in a measured game have
  // exactly one legal option (`mtg-y4gw`), and every pass is now one too.
  if (options.length === 1) return first;

  let best = first;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const action of options) {
    const score = scoreAction(config, view, me, action);
    if (score === null) continue;
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}

/** A tier-1.5 bot: the greedy policies, refined by one ply of lookahead. */
export function searchBot(name: string, config: SearchBotConfig = DEFAULT_SEARCH_CONFIG): PlayerAgent {
  return {
    name,
    decide(view: AgentView): Action {
      return decideSearch(view, config);
    },
  };
}
