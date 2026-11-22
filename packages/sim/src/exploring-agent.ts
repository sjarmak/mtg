/**
 * A reference agent that deviates from itself at a stated rate, deterministically.
 *
 * This exists to give an outcome-trained evaluator something to learn from.
 * `learnedExamplesFromEpisode` labels the action a game actually took by what
 * that game went on to produce, and `trainLearnedModel` regresses a score onto
 * those labels. Both are correct and both are useless on greedy-versus-greedy
 * self-play, because such a run visits only the actions greedy would pick: the
 * fitted score has no coverage of the alternatives its own argmax ranges over,
 * so the alternatives are scored by extrapolation. Exploration is the coverage,
 * and it is the whole difference between an objective that can exceed the
 * reference policy and one that can only copy it (mtg-bw8z.1).
 *
 * DETERMINISM. Every deviation is drawn from a generator seeded by its own
 * position - the stream seed, the seat, and the ordinal of that seat's decision
 * in the game - and never from a generator carried between decisions. A game
 * therefore replays bit-exactly under the same stream seed, which is what
 * `packages/engine/src/determinism.ts` requires of anything a seeded run
 * reproduces, and it is the property mtg-5ar0 asks of the opponent draw for the
 * same reason. The ordinal is a counter, and it is the one piece of mutable
 * state here: it is the decision's position, recomputed from zero by every
 * replay of the same game, not a sequence shared across games or seats.
 *
 * The wrapper deviates only where a learned candidate would own the decision,
 * so it never generates a label for a decision that candidate delegates to its
 * greedy fallback.
 */
import {
  actionKey,
  createRng,
  nextBelow,
  nextFloat,
  type Action,
  type AgentView,
  type PlayerAgent,
} from '@mtg/kernel';
import { candidateOwnsDecision } from './policy-agreement';

export interface ExploringAgentOptions {
  /** Probability of taking a uniformly drawn alternative instead of the reference's action. */
  readonly epsilon: number;
  /** Names the stream. Two runs sharing it draw the same deviations. */
  readonly streamSeed: string;
}

export interface ExploringAgentCensus {
  readonly owned: number;
  readonly explored: number;
}

export interface ExploringAgent extends PlayerAgent {
  /** How many decisions this seat could have deviated on, and how many it did. */
  census(): ExploringAgentCensus;
}

function validate(options: ExploringAgentOptions): void {
  if (!Number.isFinite(options.epsilon) || options.epsilon < 0 || options.epsilon > 1) {
    throw new Error('exploring agent epsilon must be between 0 and 1');
  }
  if (options.streamSeed.length === 0) throw new Error('exploring agent streamSeed must be non-empty');
}

/**
 * Wrap a reference agent so that it deviates at `epsilon`.
 *
 * The deviation is drawn uniformly over the decision's options, the reference's
 * own action included: at epsilon 1 the seat plays uniformly at random, and the
 * observed deviation rate is therefore below epsilon by the chance the draw
 * lands on what the reference would have done anyway. That is deliberate - it
 * keeps the exploring distribution a clean mixture of the reference and the
 * uniform policy, which is what makes a label from it interpretable.
 */
export function exploringAgent(reference: PlayerAgent, options: ExploringAgentOptions): ExploringAgent {
  validate(options);
  let ordinal = 0;
  let owned = 0;
  let explored = 0;
  return {
    name: `${reference.name}+explore`,
    census: () => ({ owned, explored }),
    decide(view: AgentView): Action {
      const chosen = reference.decide(view);
      if (!candidateOwnsDecision(view)) return chosen;
      const position = ordinal;
      ordinal += 1;
      owned += 1;
      if (options.epsilon === 0) return chosen;
      const rng = createRng(`${options.streamSeed}:${String(view.player)}:${String(position)}`);
      const [roll, advanced] = nextFloat(rng);
      if (roll >= options.epsilon) return chosen;
      const [index] = nextBelow(advanced, view.decision.options.length);
      const drawn = view.decision.options[index];
      if (drawn === undefined) throw new Error('exploring agent drew an option outside the decision');
      // Compared by key, not by identity: the reference constructs its combat
      // declarations rather than returning one of the enumerated objects, so a
      // reference check would call an identical action a deviation.
      if (actionKey(drawn) !== actionKey(chosen)) explored += 1;
      return drawn;
    },
  };
}
