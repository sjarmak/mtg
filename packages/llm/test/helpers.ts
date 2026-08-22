/**
 * Test rig for `@mtg/llm`.
 *
 * Every provider-level test runs through the fixture provider: a scripted
 * in-memory transport supplies the bytes, record mode writes them to a temp
 * directory, replay mode reads them back. No network, no spend, no dependency on
 * a `claude` binary or an API key.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BudgetGuard } from '../src/budget';
import { createFixtureProvider } from '../src/providers/fixture';
import { reconcileCost } from '../src/reconcile';
import type {
  CostSource,
  LlmProvider,
  LlmTransport,
  RawRequest,
  RawResponse,
  TokenUsage,
} from '../src/types';
import { ZERO_USAGE } from '../src/types';

export interface ScriptedResponse {
  readonly text: string;
  readonly structured?: unknown;
  readonly costUsd?: number;
  /** Defaults to `reported`; `unknown` is what a `claude-cli` envelope with no cost gives. */
  readonly costSource?: CostSource;
  readonly usage?: Partial<TokenUsage>;
  readonly model?: string;
}

export interface ScriptedTransport extends LlmTransport {
  /** Every request the provider issued, in order. */
  readonly requests: readonly RawRequest[];
}

/** A transport that hands back a canned sequence and records what it was asked. */
export function scriptedTransport(script: readonly ScriptedResponse[]): ScriptedTransport {
  const requests: RawRequest[] = [];
  let index = 0;

  return {
    name: 'claude-cli',
    model: 'scripted-model',
    requests,
    async send(request: RawRequest): Promise<RawResponse> {
      requests.push(request);
      const next = script[index];
      index += 1;
      if (next === undefined) {
        throw new Error(`scripted transport exhausted after ${script.length} response(s)`);
      }
      const usage = { ...ZERO_USAGE, ...next.usage };
      const costUsd = next.costUsd ?? 0.01;
      const costSource = next.costSource ?? 'reported';
      const model = next.model ?? 'scripted-model';
      return {
        text: next.text,
        ...(next.structured === undefined ? {} : { structured: next.structured }),
        usage,
        costUsd,
        costSource,
        // A real transport reconciles what it was told; a stand-in that did not
        // would make a fixture round trip look lossy when it is the stub, not
        // the store, that is missing a step.
        costCheck: reconcileCost({
          model,
          usage,
          usageMeasured: next.usage !== undefined,
          reportedUsd: costSource === 'unknown' ? null : costUsd,
        }),
        model,
      };
    },
  };
}

export interface ProviderOptions {
  readonly budget?: BudgetGuard;
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
}

export interface RecordingRig {
  readonly provider: LlmProvider;
  readonly transport: ScriptedTransport;
}

/** Fixture provider in record mode, fed by a scripted transport. */
export function recordingProvider(
  dir: string,
  script: readonly ScriptedResponse[],
  options: ProviderOptions = {},
): RecordingRig {
  const transport = scriptedTransport(script);
  const provider = createFixtureProvider({
    dir,
    record: true,
    delegate: transport,
    env: {},
    ...options,
  });
  return { provider, transport };
}

/** Fixture provider in replay mode. A miss is an error, never a live call. */
export function replayProvider(dir: string, options: ProviderOptions = {}): LlmProvider {
  return createFixtureProvider({ dir, record: false, env: {}, ...options });
}

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mtg-llm-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
