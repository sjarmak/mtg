/**
 * Records the one live ruling this package replays.
 *
 * Usage:
 *   npx tsx packages/referee/tools/record-ruling.ts
 *
 * Sends the framed blocking position from `src/example.ts` to the local
 * authenticated `claude` binary and writes the response into `fixtures/llm/`,
 * keyed by `hash(system, prompt, schema)`. Tests replay that file and never
 * call a model; `fixture` is the only provider CI may use.
 *
 * Re-run it after any change to the frame, the system prompt, the ruling schema
 * or the example position — all four are part of the key, so the replay test
 * starts failing with a missing key rather than passing on a recording of a
 * question nobody asks any more. Delete the stale file yourself: this writes the
 * new key and leaves the old one alone.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleAgent } from '@mtg/kernel';
import { pendingDecision } from '@mtg/kernel';
import { createBudgetGuard, createClaudeCliTransport, createFixtureProvider } from '@mtg/llm';
import { compileDownBacklog, createReferee, exampleBlockingPosition, formatBacklog } from '../src/index';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'llm');

async function main(): Promise<number> {
  const { state } = exampleBlockingPosition();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('record-ruling: the example position asks nothing');

  const provider = createFixtureProvider({
    dir: FIXTURE_DIR,
    record: true,
    delegate: () => createClaudeCliTransport(),
    // One recording, one call, with a ceiling that makes a runaway loop cheap.
    // It belongs to the provider because that is where the attempts are billed:
    // a retry that never validates still costs, and this stops that too.
    budget: createBudgetGuard({ maxCalls: 2, maxUsd: 0.5 }),
  });
  const referee = createReferee({ provider, fallback: simpleAgent('fallback') });

  const { action, record } = await referee.rule({ state, player: decision.player, decision });

  console.log(`decision      ${record.decision} for player ${String(record.player)}`);
  console.log(
    `options       ${String(record.optionCount)} (complete: ${String(record.enumerationComplete)})`,
  );
  console.log(`ruled by      ${record.source} (${record.provider}, ${record.model})`);
  console.log(`chose         ${String(record.chosenIndex)} → ${action.type}`);
  console.log(`rationale     ${record.rationale ?? '(none)'}`);
  console.log(`rejection     ${record.rejection ?? '(none)'}`);
  console.log(`cost          $${record.costUsd.toFixed(6)} (${record.costSource})`);
  console.log(`latency       ${String(record.latencyMs)} ms`);
  console.log(formatBacklog(compileDownBacklog(referee.records())));
  console.log(`fixtures      ${existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).join(', ') : '(none)'}`);

  if (record.source !== 'model') {
    console.error('the model did not produce a usable ruling; nothing worth committing was recorded');
    return 1;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
