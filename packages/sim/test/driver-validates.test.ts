/**
 * A bot cannot desync a sim game with a move the rules refuse.
 *
 * The driver reduces whatever the agent returns and checks only that the answer
 * is for the seat that was asked (`driver.ts`), so the guarantee lives one layer
 * down: `reduce` re-derives legality from the position through `validateAction`
 * and throws `IllegalActionError` rather than applying the move. Pinned here
 * because the policy layer builds declarations by hand — `decideGreedy` returns
 * a constructed `declareAttackers` rather than an enumerated option — and this
 * is the boundary that catches a policy that builds a wrong one.
 */
import { describe, expect, it } from 'vitest';
import type { Action, PlayerAgent } from '@mtg/kernel';
import { hasCardType } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { greedyBot } from '../src/greedy-bot';
import { FIXTURE_DECK_RW } from '../src/fixtures';

/** Plays greedily, except that its first attack is declared with a land. */
function landAttacker(name: string): PlayerAgent {
  const greedy = greedyBot(name);
  let swung = false;
  return {
    name,
    decide(view): Action {
      if (view.decision.kind === 'declareAttackers' && !swung) {
        const land = view.state.battlefield.find(
          (oid) =>
            view.state.objects[oid]?.controller === view.player && hasCardType(view.state, oid, 'land'),
        );
        if (land !== undefined) {
          swung = true;
          return {
            type: 'declareAttackers',
            player: view.player,
            attackers: [{ oid: land, defender: view.player === 0 ? 1 : 0 }],
          };
        }
      }
      return greedy.decide(view);
    },
  };
}

describe('the sim driver', () => {
  it('refuses an agent action the rules refuse instead of reducing it', () => {
    expect(() =>
      playSimGame({
        index: 0,
        seed: 'driver-validates',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_RW],
        startingPlayer: 0,
        agents: [landAttacker('land attacker'), greedyBot('greedy')],
      }),
    ).toThrow(/cannot attack/);
  });
});
