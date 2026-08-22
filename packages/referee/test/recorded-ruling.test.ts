/**
 * The one real ruling, replayed.
 *
 * `fixtures/llm/` holds a single request/response pair from a live `claude-cli`
 * call on the blocking position in `src/example.ts`: the frame that was sent,
 * and the ruling that came back. Replaying it costs nothing and is the only
 * evidence in this package that the framing elicits a schema-valid ruling from
 * a model rather than from a stub a person wrote.
 *
 * A fixture is keyed by `hash(system, prompt, schema)`, so any change to the
 * frame, the system prompt or the ruling schema makes this fail with a missing
 * key rather than quietly passing on a stale recording. Re-record it with
 * `npx tsx packages/referee/tools/record-ruling.ts`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAttemptPrompt, createFixtureProvider, keyForRequest, toJsonSchema } from '@mtg/llm';
import { simpleAgent, validateAction } from '@mtg/kernel';
import {
  createReferee,
  exampleBlockingPosition,
  frameDecision,
  REFEREE_SYSTEM,
  renderFrame,
  RulingSchema,
} from '@mtg/referee';
import { viewFor } from './positions';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm');

describe('the recorded ruling', () => {
  it('is the only fixture, and is keyed by the request the referee makes', () => {
    expect(existsSync(FIXTURE_DIR), `no recorded fixture at ${FIXTURE_DIR}`).toBe(true);
    const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(1);

    const view = viewFor(exampleBlockingPosition().state);
    const jsonSchema = toJsonSchema(RulingSchema);
    // The bytes a transport sees are the frame plus the shared output contract,
    // which is what `@mtg/llm` keys on.
    const key = keyForRequest({
      system: REFEREE_SYSTEM,
      prompt: buildAttemptPrompt({
        prompt: renderFrame(frameDecision(view)),
        jsonSchema,
        previous: [],
      }),
      jsonSchema,
    });
    expect(files).toEqual([`${key}.json`]);
  });

  it('replays into a legal action the kernel accepts', async () => {
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });
    const view = viewFor(exampleBlockingPosition().state);

    const outcome = await referee.rule(view);

    expect(outcome.record.rejection).toBeNull();
    expect(outcome.record.source).toBe('model');
    expect(outcome.record.chosenIndex).not.toBeNull();
    expect(validateAction(view.state, outcome.action)).toBeNull();
    expect(outcome.record.rationale ?? '').not.toHaveLength(0);
    expect(outcome.record.costUsd).toBeGreaterThan(0);
  });
});
