/**
 * Playing game `index` of a match.
 *
 * Isolated from the runner so the serial path and every worker execute exactly
 * the same function on exactly the same inputs. A game's outcome depends only
 * on (run seed, index, spec) — never on how many games ran before it, or in
 * which thread — which is what makes the sharded run reproduce the serial one.
 */
import type { GameOutcome, LogRequest, PlayGameOptions } from './driver';
import { playSimGame } from './driver';
import type { AgentFactory } from './bots';
import { createBot } from './bots';
import type { ResolvedMatchSpec } from './match';
import { agentSeed, gameSeed, startingPlayerFor } from './seeds';

export function playIndex(
  spec: ResolvedMatchSpec,
  index: number,
  factory: AgentFactory = createBot,
): GameOutcome {
  const seed = gameSeed(spec.runSeed, index);
  const log: LogRequest | null = spec.collectLogs
    ? {
        runSeed: spec.runSeed,
        expansion: spec.expansion,
        eventType: spec.eventType,
        gameTime: spec.gameTime,
        botNames: [spec.bots[0].name, spec.bots[1].name],
      }
    : null;

  const options: PlayGameOptions = {
    index,
    seed,
    decks: spec.decks,
    agents: [
      factory(spec.bots[0], agentSeed(spec.runSeed, index, 0), 0),
      factory(spec.bots[1], agentSeed(spec.runSeed, index, 1), 1),
    ],
    startingPlayer: startingPlayerFor(index, spec.alternatePlayFirst),
    maximumTurns: spec.maximumTurns,
    ...(spec.budget === undefined ? {} : { budget: spec.budget }),
    ...(spec.caps === undefined ? {} : { caps: spec.caps }),
    log,
    collectEvents: spec.collectEvents,
    censusAbilities: spec.censusAbilities,
  };
  return playSimGame(options);
}
