/**
 * Regenerates the committed replay fixture.
 *
 *   npx tsx packages/ui/test/replay/support/write-fixture.ts
 *
 * The output is deterministic in the seeds pinned in `fixture-games.ts`, and
 * `record.test.ts` asserts a fresh recording is byte-identical to the committed
 * file — so running this after an intentional kernel change is how the fixture
 * moves, and running it after an unintentional one is how you find out.
 */
import { writeFileSync } from 'node:fs';
import { FIXTURE_GAMES, FIXTURE_SOURCE } from './fixture-games';
import { FIXTURE_PATH } from './log-fixture';
import { recordGame, writeEventLog } from '../../../tools/record-replay';

const recorded = FIXTURE_GAMES.map((options) => recordGame(options));
const text = writeEventLog(FIXTURE_SOURCE, recorded);
writeFileSync(FIXTURE_PATH, text, 'utf8');

for (const game of recorded) {
  const { result } = game.game;
  const outcome = result.winner === null ? 'draw' : `seat ${result.winner} wins`;
  console.log(
    `game ${game.game.game} (${game.game.seed}): ${game.steps.length} steps, ` +
      `${result.endedOnTurn} turns, ${outcome} by ${result.reason}`,
  );
}
console.log(`wrote ${text.length} bytes to ${FIXTURE_PATH}`);
