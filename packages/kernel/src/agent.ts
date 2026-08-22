/**
 * The player-choice seam.
 *
 * The kernel owns all state. An agent receives a read-only view plus the
 * enumerated legal options and returns one action. It cannot mutate anything,
 * cannot see anything the state does not expose, and cannot advance the game —
 * `reduce` re-validates whatever comes back.
 *
 * This is the interface the greedy bots use today and the one a framed LLM
 * referee plugs into later: the referee gets a decision it can serialize, and
 * hands back a structured action the kernel applies as events. Nothing about
 * that path lets a model own state.
 */
import type { Action } from './actions';
import type { PlayerId } from './ids';
import type { Decision } from './legal';
import type { GameState } from './state';

export interface AgentView {
  readonly state: GameState;
  readonly player: PlayerId;
  readonly decision: Decision;
}

export interface PlayerAgent {
  readonly name: string;
  decide(view: AgentView): Action;
}

/** Wraps a plain function as an agent. */
export function functionAgent(name: string, decide: (view: AgentView) => Action): PlayerAgent {
  return { name, decide };
}

/**
 * Replays a fixed action list. Used by determinism tests and by scripted
 * scenarios; throws when the script runs out or diverges from what the kernel
 * is asking, which is what makes a scripted test a real assertion.
 */
export function scriptedAgent(name: string, script: readonly Action[]): PlayerAgent {
  let index = 0;
  return {
    name,
    decide(view: AgentView): Action {
      const action = script[index];
      if (action === undefined) {
        throw new Error(`${name}: script exhausted at decision "${view.decision.kind}"`);
      }
      index += 1;
      if (action.player !== view.player) {
        throw new Error(
          `${name}: script step ${index - 1} is for player ${action.player}, but player ${view.player} was asked`,
        );
      }
      return action;
    },
  };
}

/**
 * Picks uniformly from the enumerated options using its own seeded generator,
 * kept separate from the game RNG so an agent's randomness never perturbs
 * shuffles.
 */
export function randomAgent(name: string, seed: string): PlayerAgent {
  let rng = createAgentRng(seed);
  return {
    name,
    decide(view: AgentView): Action {
      const options = view.decision.options;
      const first = options[0];
      if (first === undefined) throw new Error(`${name}: no legal options were offered`);
      const [index, advanced] = nextAgentIndex(rng, options.length);
      rng = advanced;
      return options[index] ?? first;
    },
  };
}

interface AgentRng {
  readonly value: number;
}

function createAgentRng(seed: string): AgentRng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { value: hash >>> 0 };
}

function nextAgentIndex(rng: AgentRng, bound: number): readonly [number, AgentRng] {
  const next = (Math.imul(rng.value ^ (rng.value >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
  return [next % bound, { value: next }];
}

/**
 * Chooses the highest-scoring option, breaking ties by enumeration order so the
 * agent stays deterministic.
 */
export function scoringAgent(name: string, score: (action: Action, view: AgentView) => number): PlayerAgent {
  return {
    name,
    decide(view: AgentView): Action {
      let best: Action | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const option of view.decision.options) {
        const value = score(option, view);
        if (value > bestScore) {
          bestScore = value;
          best = option;
        }
      }
      if (best === undefined) throw new Error(`${name}: no legal options were offered`);
      return best;
    },
  };
}
