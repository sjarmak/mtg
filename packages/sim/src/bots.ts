/**
 * The bot registry: a serializable description of a seat's policy.
 *
 * `PlayerAgent` is a closure, so it cannot cross a worker boundary. A `BotSpec`
 * is plain data that can, and `createBot` turns one into an agent inside the
 * worker. In-process callers that want a policy the registry does not know
 * about pass their own `AgentFactory` instead — that is the seam an MCTS tier,
 * an LLM pilot, or a one-off scripted bot plugs into.
 */
import type { PlayerAgent, PlayerId } from '@mtg/kernel';
import type { GreedyBotConfig } from './config';
import { DEFAULT_GREEDY_CONFIG } from './config';
import { greedyBot } from './greedy-bot';
import { randomBot } from './random-bot';

export type BotSpec =
  | { readonly kind: 'greedy'; readonly name: string; readonly config: GreedyBotConfig }
  | { readonly kind: 'random'; readonly name: string };

export type BotKind = BotSpec['kind'];

/** Builds a seat's agent. `seed` is per game and per seat, never the game RNG's. */
export type AgentFactory = (spec: BotSpec, seed: string, seat: PlayerId) => PlayerAgent;

export function greedySpec(name = 'greedy', config: GreedyBotConfig = DEFAULT_GREEDY_CONFIG): BotSpec {
  return { kind: 'greedy', name, config };
}

export function randomSpec(name = 'random'): BotSpec {
  return { kind: 'random', name };
}

export const createBot: AgentFactory = (spec, seed) => {
  switch (spec.kind) {
    case 'greedy':
      return greedyBot(spec.name, spec.config);
    case 'random':
      return randomBot(spec.name, `${spec.name}:${seed}`);
  }
};
