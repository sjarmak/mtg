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
import { learnedBot, type LearnedModelArtifact } from './learned-evaluator';
import { randomBot } from './random-bot';
import type { SearchBotConfig } from './search-bot';
import { DEFAULT_SEARCH_CONFIG, searchBot } from './search-bot';
import type { RolloutBotConfig } from './rollout-bot';
import { DEFAULT_ROLLOUT_CONFIG, rolloutBot } from './rollout-bot';

export type BotSpec =
  | { readonly kind: 'greedy'; readonly name: string; readonly config: GreedyBotConfig }
  | {
      readonly kind: 'learned';
      readonly name: string;
      readonly model: LearnedModelArtifact;
      readonly dataSha256: string;
      readonly fallbackConfig: GreedyBotConfig;
    }
  | { readonly kind: 'search'; readonly name: string; readonly config: SearchBotConfig }
  | { readonly kind: 'rollout'; readonly name: string; readonly config: RolloutBotConfig }
  | { readonly kind: 'random'; readonly name: string };

export type BotKind = BotSpec['kind'];

/** Builds a seat's agent with both its private stream and the concrete game identity. */
export type AgentFactory = (spec: BotSpec, seed: string, seat: PlayerId, gameSeed: string) => PlayerAgent;

export function greedySpec(name = 'greedy', config: GreedyBotConfig = DEFAULT_GREEDY_CONFIG): BotSpec {
  return { kind: 'greedy', name, config };
}

/**
 * A tier-1.5 seat: the greedy policies refined by one ply of lookahead.
 *
 * A registry kind rather than an `agentFactory` closure, because the seam's own
 * docblock says a closure cannot cross a worker boundary and this config is
 * plain data. That is not permission to put it in the sweep — `mtg-y4gw` holds
 * the sweep on greedy until a head-to-head and a re-baseline say otherwise —
 * but a bot that could only ever run in-process could never be measured against
 * one that does.
 */
export function searchSpec(name = 'search', config: SearchBotConfig = DEFAULT_SEARCH_CONFIG): BotSpec {
  return { kind: 'search', name, config };
}

export function rolloutSpec(name = 'rollout', config: RolloutBotConfig = DEFAULT_ROLLOUT_CONFIG): BotSpec {
  return { kind: 'rollout', name, config };
}

export function learnedSpec(
  name: string,
  model: LearnedModelArtifact,
  dataSha256: string,
  fallbackConfig: GreedyBotConfig = DEFAULT_GREEDY_CONFIG,
): BotSpec {
  if (!/^[0-9a-f]{64}$/u.test(dataSha256)) {
    throw new Error('learned bot training data SHA-256 must be 64 lowercase hexadecimal characters');
  }
  return { kind: 'learned', name, model, dataSha256, fallbackConfig };
}

export function randomSpec(name = 'random'): BotSpec {
  return { kind: 'random', name };
}

export function createBot(
  spec: BotSpec,
  seed: string,
  _seat: PlayerId,
  gameSeed: string = seed,
): PlayerAgent {
  switch (spec.kind) {
    case 'greedy':
      return greedyBot(spec.name, spec.config);
    case 'learned':
      return learnedBot(spec.name, spec.model, spec.fallbackConfig);
    case 'search':
      return searchBot(spec.name, spec.config);
    case 'rollout':
      return rolloutBot(spec.name, gameSeed, spec.config);
    case 'random':
      return randomBot(spec.name, `${spec.name}:${seed}`);
  }
}
