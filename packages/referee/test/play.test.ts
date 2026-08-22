/**
 * A refereed game, driven end to end.
 *
 * `playOut` in the kernel is synchronous by design — the balance sweep plays
 * 10,035 games and must never pay an await per decision — so a seat that has to
 * ask a model needs its own driver. This is that driver, and the test is that a
 * refereed game is an ordinary kernel game: same `reduce`, same events, same
 * result, with the rulings recorded beside it.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '@mtg/kernel';
import { functionAgent, opponentOf, pendingDecision, simpleAgent } from '@mtg/kernel';
import { agentSeat, createReferee, playRefereed, refereeSeat } from '@mtg/referee';
import { lethalBlockingPosition } from './positions';
import { stubProvider } from './stub-provider';

describe('a refereed game', () => {
  it('plays to a result and records one ruling per refereed decision', async () => {
    const provider = stubProvider({
      // Option 0 of a blocking decision is the empty block, so the defender
      // takes six and dies on this combat step.
      answers: [{ value: { optionIndex: 0, rationale: 'Nothing blocks profitably.' } }],
      repeat: true,
    });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });

    const run = await playRefereed(lethalBlockingPosition().state, [
      agentSeat(simpleAgent('attacker')),
      refereeSeat(referee),
    ]);

    expect(run.result?.winner).toBe(0);
    expect(run.rulings.length).toBeGreaterThan(0);
    expect(run.rulings).toEqual(referee.records());
    expect(run.rulings.every((ruling) => ruling.player === 1)).toBe(true);
    expect(run.decisions).toBeGreaterThanOrEqual(run.rulings.length);
    expect(run.events.length).toBeGreaterThan(0);
  });

  it('refuses a seat that answers for the other player', async () => {
    // The kernel would take this one: `concede` is legal for either player, so
    // `reduce` would end the game in favor of whoever asked. The driver's own
    // check is what stops a seat deciding for its opponent, and it has to hold
    // for a plain agent as much as for a referee.
    const rogue = functionAgent('rogue', (view): Action => ({
      type: 'concede',
      player: opponentOf(view.player),
    }));
    const provider = stubProvider({
      answers: [{ value: { optionIndex: 0, rationale: 'pass' } }],
      repeat: true,
    });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });
    const { state } = lethalBlockingPosition();
    expect(pendingDecision(state)?.player).toBe(0);

    await expect(playRefereed(state, [agentSeat(rogue), refereeSeat(referee)])).rejects.toThrow(
      'answered for player 1',
    );
  });

  it('stops rather than looping forever when a driver bug stalls the game', async () => {
    const provider = stubProvider({
      answers: [{ value: { optionIndex: 0, rationale: 'pass' } }],
      repeat: true,
    });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });

    await expect(
      playRefereed(
        lethalBlockingPosition().state,
        [agentSeat(simpleAgent('attacker')), refereeSeat(referee)],
        { maxDecisions: 1 },
      ),
    ).rejects.toThrow('1 decisions');
  });
});
