/**
 * Acceptance criterion 3 of `mtg-onjme.2`: nothing on the armed (`--max-usd`)
 * Stagehand path reaches the Vercel AI Gateway. Two halves, because either
 * alone can be fooled:
 *
 * - statically, no Stagehand-path source names the gateway host, its base-URL
 *   constant, or the gateway Jev client;
 * - at run time, the three steps run with the real direct Jev client over a
 *   recording `fetch` and the real model bridge over a scripted `@mtg/llm`
 *   transport, and every request that leaves goes to TypeSafe's host while the
 *   global `fetch` is never touched.
 *
 * No request leaves the process: the recording `fetch` answers every call.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createBudgetGuard, createProvider, UNCHECKED_COST } from '@mtg/llm';
import type { LlmTransport } from '@mtg/llm';
import { createJevDirectClient } from '../../../draft-export/tools/jev-label/jev-client';
import { createMeteredGenerate } from '../../tools/stagehand-model-bridge';
import { StagehandMeter } from '../../tools/stagehand-meter';
import { meterJev, runStagehandJourney } from '../../tools/stagehand-runner';
import type { JourneyStepDefinition, StagehandSession } from '../../tools/stagehand-runner';

const TOOLS_DIR = fileURLToPath(new URL('../../tools/', import.meta.url));
const GATEWAY_HOST = ['ai-gateway', 'vercel', 'sh'].join('.');

function armedPathSources(): readonly string[] {
  return readdirSync(TOOLS_DIR)
    .filter((entry) => entry === 'live-journey.ts' || /^stagehand-.*\.ts$/.test(entry))
    .sort();
}

describe('the armed Stagehand path names no gateway', () => {
  it('covers the files it claims to', () => {
    expect(armedPathSources()).toEqual(
      expect.arrayContaining([
        'live-journey.ts',
        'stagehand-key.ts',
        'stagehand-meter.ts',
        'stagehand-model-bridge.ts',
        'stagehand-provider.ts',
        'stagehand-runner.ts',
      ]),
    );
  });

  it.each(armedPathSources())('%s names neither the gateway host nor the gateway client', (entry) => {
    const source = readFileSync(join(TOOLS_DIR, entry), 'utf8');
    expect(source).not.toContain(GATEWAY_HOST);
    expect(source).not.toMatch(/\bGATEWAY_BASE_URL\b/);
    expect(source).not.toMatch(/\bcreateJevClient\b/);
    expect(source).not.toMatch(/\bAI_GATEWAY_API_KEY\b/);
  });
});

const STEPS: readonly JourneyStepDefinition[] = [
  { name: 'printed-gallery-face-toggle', url: 'http://127.0.0.1:1/gallery', instruction: 'flip the card' },
  { name: 'precon-your-deck-select', url: 'http://127.0.0.1:1/precon', instruction: 'open your deck' },
  { name: 'printed-draft-first-pick', url: 'http://127.0.0.1:1/draft', instruction: 'pick the first card' },
];

const OBSERVATION = { elements: [{ elementId: '1-1', description: 'the control' }] };

const observeTransport: LlmTransport = {
  name: 'claude-cli',
  model: 'scripted-model',
  send() {
    return Promise.resolve({
      text: JSON.stringify(OBSERVATION),
      usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUsd: 0.001,
      costSource: 'reported',
      costCheck: UNCHECKED_COST,
      model: 'scripted-model',
    });
  },
};

/** Answers every Jev request in the documented direct shape, recording where each one went. */
function recordingFetch(urls: string[]): typeof fetch {
  return (input, init) => {
    urls.push(String(input));
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    const questionId = Object.keys(body.questions)[0] as string;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            [questionId]: { type: 'choice', choice: 'candidate-0', probabilities: { 'candidate-0': 1 } },
          },
          usage: { input_tokens: 50, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
}

describe('the armed Stagehand path reaches no gateway at run time', () => {
  it('sends every Jev call to TypeSafe and every observe() call through the provider', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    try {
      const budget = createBudgetGuard({ maxUsd: 1 });
      const meter = new StagehandMeter(budget);
      const generate = createMeteredGenerate({ llm: createProvider(observeTransport, { budget }), meter });
      const jevUrls: string[] = [];
      const jev = meterJev(
        createJevDirectClient({ apiKey: 'made-up-test-value', fetchImpl: recordingFetch(jevUrls) }),
        meter,
      );
      const session: StagehandSession = {
        openStep() {
          return Promise.resolve({
            async observe(instruction) {
              const result = await generate({
                messages: [{ role: 'user', content: { type: 'text', text: instruction } }],
                responseFormat: { type: 'json_schema', name: 'Observation', schema: { type: 'object' } },
              });
              expect(result.outputFormat).toBe('json_schema');
              return [{ selector: 'xpath=//button[1]', description: 'the control' }];
            },
            act() {
              return Promise.resolve();
            },
          });
        },
        close() {
          return Promise.resolve();
        },
      };

      const { report, failed } = await runStagehandJourney({
        session,
        jev,
        meter,
        maxUsd: 1,
        artifactsDir: mkdtempSync(join(tmpdir(), 'stagehand-no-gateway-')),
        steps: STEPS,
      });

      expect(failed).toBe(false);
      expect(jevUrls).toHaveLength(3);
      for (const url of jevUrls) expect(new URL(url).host).toBe('api.typesafe.ai');
      expect(globalFetch).not.toHaveBeenCalled();
      // Three observe() calls and three Jev calls, all on the one guard.
      expect(report.callCount).toBe(6);
      expect(report.unreconciledCalls).toBe(0);
    } finally {
      globalFetch.mockRestore();
    }
  });
});
