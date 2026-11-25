import { describe, expect, it } from 'vitest';
import type { AgentView } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import { greedyBot } from '../src/greedy-bot';
import { exploringAgent } from '../src/exploring-agent';

const DECKS = [FIXTURE_DECK_RW, FIXTURE_DECK_GW, FIXTURE_DECK_UB];

/**
 * The kernel asks a block declaration one blocker at a time when the whole
 * enumeration does not fit under the option cap, and then refuses an answer that
 * takes back a block already standing. The greedy bot constructs its declaration
 * from the board, so mid-sequence it has to answer the staged question instead.
 *
 * This game is the one that caught it: a 600-game exploring training run died on
 * `illegal action declareBlockers by player 0: o11 is already blocking and
 * cannot be taken back`.
 */
describe('greedy blocks inside a staged declaration', () => {
  it('finishes the game that the exploring run died on', () => {
    const index = 241;
    const gameId = `native-action-q/train/outcome-v1:${String(index)}`;
    let staged = 0;
    const seat = (name: string) => {
      const inner = exploringAgent(greedyBot(name), { epsilon: 0.25, streamSeed: gameId });
      return {
        name: inner.name,
        decide(view: AgentView) {
          if (view.decision.kind === 'declareBlockers' && view.state.combat.blocksSettled !== undefined) {
            staged += 1;
          }
          return inner.decide(view);
        },
      };
    };

    const outcome = playSimGame({
      index,
      seed: gameId,
      decks: [
        DECKS[index % DECKS.length]!,
        DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length]!,
      ],
      startingPlayer: index % 2 === 0 ? 0 : 1,
      agents: [seat('greedy-left'), seat('greedy-right')],
    });

    expect(outcome.reason).toBeTypeOf('string');
    // Without a staged declaration in the game the assertion above proves nothing.
    expect(staged).toBeGreaterThan(0);
  });
});

/**
 * The attack half of the same staging. A declaration cap of four makes the
 * kernel ask the fixture decks' attacks one creature at a time, which the
 * pinned 512 cap reaches only on wide boards; game 27 then reaches a stage
 * where the exploring seat declared a creature that greedy's own plan leaves
 * home, and a whole constructed declaration was refused with `o17 is already
 * attacking and cannot be taken back`. A combat-only rollout on The Hidden
 * Kingdom died the same way at the default cap.
 */
describe('greedy attacks inside a staged declaration', () => {
  it('finishes a game whose exploring seat departed mid-declaration', () => {
    const index = 27;
    const gameId = `native-action-q/train/outcome-v1:${String(index)}`;
    let staged = 0;
    const seat = (name: string) => {
      const inner = exploringAgent(greedyBot(name), { epsilon: 0.25, streamSeed: gameId });
      return {
        name: inner.name,
        decide(view: AgentView) {
          if (view.decision.kind === 'declareAttackers' && view.state.combat.attacksSettled !== undefined) {
            staged += 1;
          }
          return inner.decide(view);
        },
      };
    };

    const outcome = playSimGame({
      index,
      seed: gameId,
      decks: [
        DECKS[index % DECKS.length]!,
        DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length]!,
      ],
      caps: { priority: 512, declaration: 4 },
      startingPlayer: index % 2 === 0 ? 0 : 1,
      agents: [seat('greedy-left'), seat('greedy-right')],
    });

    expect(outcome.reason).toBeTypeOf('string');
    expect(staged).toBeGreaterThan(0);
  });
});
