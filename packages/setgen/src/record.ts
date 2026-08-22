/**
 * Resumable recording.
 *
 * A full 90-card run is a couple of dozen live calls and takes tens of minutes.
 * The plain record-mode fixture transport re-calls the backend for every
 * request, so an interrupted run (a timeout, a budget ceiling, a laptop lid)
 * has to pay for everything again from the top. This transport records only
 * what is missing: any request whose fixture already exists on disk is replayed
 * for free, and only the new ones reach the live backend.
 *
 * That makes a recording session restartable and idempotent. Delete the
 * fixtures directory to force a genuinely fresh recording.
 */
import { existsSync } from 'node:fs';
import {
  buildFixture,
  createBudgetGuard,
  createClaudeCliTransport,
  createFixtureTransport,
  createProvider,
  fixturePath,
  keyForRequest,
  writeFixture,
} from '@mtg/llm';
import type { BudgetGuard, LlmProvider, LlmTransport, RawRequest, RawResponse } from '@mtg/llm';

export interface RecorderOptions {
  /** Directory holding `<key>.json` fixtures. */
  readonly dir: string;
  /** The backend new requests go to. Defaults to the local `claude` binary. */
  readonly live?: LlmTransport;
  /** Called with the fixture key each time a request is answered. */
  readonly onCall?: (event: RecorderEvent) => void;
}

export interface RecorderEvent {
  readonly key: string;
  readonly source: 'replayed' | 'recorded';
}

export function createResumableRecorderTransport(options: RecorderOptions): LlmTransport {
  const live = options.live ?? createClaudeCliTransport();
  const replay = createFixtureTransport({ dir: options.dir, record: false });

  return {
    name: 'fixture',
    model: live.model,
    async send(request: RawRequest): Promise<RawResponse> {
      const key = keyForRequest({
        system: request.system,
        prompt: request.prompt,
        jsonSchema: request.jsonSchema,
      });
      if (existsSync(fixturePath(options.dir, key))) {
        options.onCall?.({ key, source: 'replayed' });
        return replay.send(request);
      }
      const response = await live.send(request);
      writeFixture(fixturePath(options.dir, key), buildFixture(key, live.name, request, response));
      options.onCall?.({ key, source: 'recorded' });
      return response;
    },
  };
}

export interface ResumableRecorderOptions extends RecorderOptions {
  readonly budget?: BudgetGuard;
  readonly maxUsd?: number;
}

export function createResumableRecorder(options: ResumableRecorderOptions): LlmProvider {
  const budget =
    options.budget ??
    (options.maxUsd === undefined ? undefined : createBudgetGuard({ maxUsd: options.maxUsd }));
  return createProvider(createResumableRecorderTransport(options), {
    ...(budget === undefined ? {} : { budget }),
  });
}
