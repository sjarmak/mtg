import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmTransport, RawRequest, RawResponse } from '@mtg/llm';
import { createResumableRecorderTransport } from '@mtg/setgen';
import { runManifestPath } from '@mtg/llm';
import { buildRunManifest, RUN_MANIFEST_DIR } from '../src/cli';

function countingTransport(): LlmTransport & { calls: number } {
  const transport = {
    name: 'claude-cli' as const,
    model: 'test-model',
    calls: 0,
    send(request: RawRequest): Promise<RawResponse> {
      transport.calls += 1;
      return Promise.resolve({
        text: JSON.stringify({ echo: request.prompt }),
        usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        costUsd: 0.5,
        costSource: 'reported',
        model: 'test-model',
      });
    },
  };
  return transport;
}

const request = (prompt: string): RawRequest => ({
  system: 'system',
  prompt,
  jsonSchema: { type: 'object' },
  maxTokens: 100,
});

describe('resumable recording', () => {
  it('records a new request once and replays it for free afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setgen-record-'));
    const live = countingTransport();
    const transport = createResumableRecorderTransport({ dir, live });

    const first = await transport.send(request('design a white two-drop'));
    expect(live.calls).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);

    const second = await transport.send(request('design a white two-drop'));
    expect(live.calls, 'a recorded request must never reach the backend again').toBe(1);
    expect(second.text).toBe(first.text);
    expect(second.costUsd).toBe(first.costUsd);
  });

  it('only pays for the requests it has never seen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setgen-record-'));
    const live = countingTransport();
    const transport = createResumableRecorderTransport({ dir, live });

    await transport.send(request('one'));
    await transport.send(request('two'));
    expect(live.calls).toBe(2);

    // A fresh recorder over the same directory: the interrupted run resumes.
    const resumed = createResumableRecorderTransport({ dir, live });
    await resumed.send(request('one'));
    await resumed.send(request('two'));
    await resumed.send(request('three'));
    expect(live.calls).toBe(3);
    expect(readdirSync(dir)).toHaveLength(3);
  });

  it('reports whether each call was replayed or recorded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setgen-record-'));
    const events: string[] = [];
    const transport = createResumableRecorderTransport({
      dir,
      live: countingTransport(),
      onCall: (event) => events.push(event.source),
    });
    await transport.send(request('one'));
    await transport.send(request('one'));
    expect(events).toStrictEqual(['recorded', 'replayed']);
  });
});

/**
 * The manifest is built from the keys the recorder reported, so a paid run
 * writes down what it served on the way out.
 *
 * The two runs already in `fixtures/llm/` predate this and had their manifests
 * reconstructed by hand, which took an archaeology pass over a fixture cache
 * that had stopped replaying. Nobody should have to do that twice.
 */
describe('the manifest a recorded run leaves behind', () => {
  const brief = '/repo/packages/setgen/briefs/proving-ground.json';

  it('names the run for its brief and lists the keys in first-call order', () => {
    const manifest = buildRunManifest(brief, ['bbb', 'aaa', 'ccc'], '2026-08-13T16:00:00.000Z');
    expect(manifest.run).toBe('proving-ground');
    expect(manifest.recordedAt).toBe('2026-08-13T16:00:00.000Z');
    expect(manifest.keys).toStrictEqual(['bbb', 'aaa', 'ccc']);
  });

  it('counts requests as calls and distinct fixtures as keys', () => {
    // A resumable recording replays a repeated request from the file it already
    // wrote, so two calls can be one fixture. Summing a bill over `keys` is
    // right and summing it over `calls` would double-count; saying both is what
    // lets a reader tell that the run had a repeat at all.
    const manifest = buildRunManifest(brief, ['aaa', 'bbb', 'aaa']);
    expect(manifest.calls).toBe(3);
    expect(manifest.keys).toStrictEqual(['aaa', 'bbb']);
  });

  it('refuses to describe a run that served nothing', () => {
    expect(() => buildRunManifest(brief, [])).toThrow(/served no fixtures/);
  });

  it('names the file for the run and not for the brief, so two runs are two files', () => {
    // The whole of the previous scheme's failure in one assertion: recording a
    // brief twice used to resolve to one path, and the second write destroyed
    // the first run's record.
    const first = buildRunManifest(brief, ['aaa'], '2026-08-13T16:01:42.253Z');
    const second = buildRunManifest(brief, ['bbb'], '2026-08-13T17:25:06.188Z');
    expect(first.id).toBe('proving-ground-2026-08-13T16-01-42Z');
    expect(second.id).toBe('proving-ground-2026-08-13T17-25-06Z');
    expect(runManifestPath(RUN_MANIFEST_DIR, first.id)).not.toBe(
      runManifestPath(RUN_MANIFEST_DIR, second.id),
    );
    expect(RUN_MANIFEST_DIR.endsWith(join('fixtures', 'runs'))).toBe(true);
  });
});
