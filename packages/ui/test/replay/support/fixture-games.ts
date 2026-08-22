/**
 * The games in the committed replay fixture, described once.
 *
 * The generator writes them and `record.test.ts` re-records them, so the two
 * can never disagree about what the fixture is supposed to contain. Seeds and
 * turn caps are pinned: game 1 exists to hold a draw, which the kernel produces
 * by running a game into its turn cap (a simultaneous loss under CR 104.4b is
 * the other route, and both land as `winner: null`).
 *
 * Two games, not ten. A full recorded game is a few hundred kilobytes of board
 * snapshots, and a fixture is something every future contributor clones.
 */
import { greedyBot, FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '@mtg/sim';
import type { RecordGameOptions } from '../../../tools/record-replay';

export const FIXTURE_SOURCE = 'packages/ui/test/replay/support/write-fixture.ts';

export const FIXTURE_GAMES: readonly RecordGameOptions[] = [
  {
    index: 0,
    seed: 'replay/v0/RW-UB/1',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    agents: [greedyBot('greedy-rw'), greedyBot('greedy-ub')],
    startingPlayer: 0,
    maximumTurns: 40,
  },
  {
    index: 1,
    seed: 'replay/v0/RW-UB/draw',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    agents: [greedyBot('greedy-rw'), greedyBot('greedy-ub')],
    startingPlayer: 0,
    maximumTurns: 5,
  },
];
