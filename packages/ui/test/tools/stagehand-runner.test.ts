/**
 * `runStagehandJourney` orchestrates the converted steps over an abstract
 * `StagehandSession`, never the real `@browserbasehq/stagehand` types, so
 * every case here runs with fakes, no network and no browser: a ceiling
 * refusal stops the whole run (not just the failing step) and the report
 * names where it stopped, a no-candidate step fails with its (empty)
 * candidate list recorded, and a passing step's report names the exact
 * selector Jev's answer chose.
 *
 * The ceiling is a real `@mtg/llm` `BudgetGuard` (`mtg-onjme.2`): Jev is
 * metered by `meterJev` against it, so the refusal in these tests is the
 * guard's own, not a thrown stand-in.
 *
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBudgetGuard, LlmBudgetExceededError } from '@mtg/llm';
import type {
  EvaluateRequest,
  EvaluateResult,
  JevClient,
} from '../../../draft-export/tools/jev-label/jev-client';
import {
  buildJourneySteps,
  jevCharge,
  meterJev,
  NoPrintedSubjectError,
  runLiveStagehandJourney,
  runStagehandJourney,
  waitForRender,
} from '../../tools/stagehand-runner';
import type {
  DiscoveredPrintedFormat,
  JourneyStepDefinition,
  StagehandCandidateSource,
  StagehandSession,
} from '../../tools/stagehand-runner';
import type { StagehandAction } from '../../tools/stagehand-candidates';
import { StagehandMeter } from '../../tools/stagehand-meter';
import { priceOf } from '../../tools/stagehand-price-table';
import type { StagehandProvider } from '../../tools/stagehand-provider';
import type * as StagehandSdk from '@browserbasehq/stagehand';

/**
 * `runLiveStagehandJourney` is the one function in `stagehand-runner.ts` that
 * touches the real SDK (see the module doc), so exercising its own
 * construction/preflight/close ordering — as opposed to `runStagehandJourney`,
 * tested above with a fake `StagehandSession` and no SDK involved at all —
 * needs the package itself mocked rather than reimplemented as a fake
 * interface. `Stagehand.create` is stubbed per test via `stagehandCreateMock`;
 * `localBrowser.connect` is stubbed once since no case here depends on what it
 * returns beyond a truthy `browser` handle.
 */
const stagehandCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@browserbasehq/stagehand', async () => {
  const actual = await vi.importActual<typeof StagehandSdk>('@browserbasehq/stagehand');
  return {
    ...actual,
    localBrowser: { connect: vi.fn(async () => ({})) },
    Stagehand: { create: stagehandCreateMock },
  };
});

const STEPS: readonly JourneyStepDefinition[] = [
  { name: 'printed-gallery-face-toggle', url: 'http://127.0.0.1:1/gallery', instruction: 'flip the card' },
  { name: 'precon-your-deck-select', url: 'http://127.0.0.1:1/precon', instruction: 'open your deck' },
  { name: 'printed-draft-first-pick', url: 'http://127.0.0.1:1/draft', instruction: 'pick the first card' },
];

const CANDIDATE: StagehandAction = { selector: 'xpath=//button[1]', description: 'a candidate' };

function artifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'stagehand-runner-test-'));
}

/** A session whose `openStep` is scripted per URL, so each of the 3 steps behaves independently. */
function fakeSession(
  perUrl: Record<string, () => Promise<StagehandCandidateSource>>,
): StagehandSession & { readonly openedUrls: string[]; readonly closed: { value: boolean } } {
  const openedUrls: string[] = [];
  const closed = { value: false };
  return {
    openedUrls,
    closed,
    async openStep(url) {
      openedUrls.push(url);
      const factory = perUrl[url];
      if (factory === undefined) throw new Error(`fakeSession: no script for ${url}`);
      return factory();
    },
    async close() {
      closed.value = true;
    },
  };
}

function passingSource(
  candidate: StagehandAction,
  acted: { action?: StagehandAction },
): () => Promise<StagehandCandidateSource> {
  return async () => ({
    async observe() {
      return [candidate];
    },
    async act(action) {
      acted.action = action;
    },
  });
}

/** A Jev that always picks `candidate-0`, reporting `inputTokens` of usage (or none, when null). */
function fakeJev(inputTokens: number | null = 100): JevClient & { readonly calls: { value: number } } {
  const calls = { value: 0 };
  return {
    calls,
    evaluate(request: EvaluateRequest): Promise<EvaluateResult> {
      calls.value += 1;
      const questionId = Object.keys(request.questions)[0] as string;
      return Promise.resolve({
        response: {
          answers: { [questionId]: { type: 'choice', choice: 'candidate-0' } },
          ...(inputTokens === null ? {} : { usage: { inputTokens, outputTokens: 1 } }),
        },
        raw: null,
        latencyMs: 0,
      });
    },
  };
}

function meterOf(maxUsd: number): StagehandMeter {
  return new StagehandMeter(createBudgetGuard({ maxUsd }));
}

describe('runStagehandJourney: a ceiling refusal stops the whole run', () => {
  it("runs the steps before the ceiling, stops at the guard's refusal, and never opens the steps after", async () => {
    const acted: { action?: StagehandAction } = {};
    const session = fakeSession({
      [STEPS[0]!.url]: passingSource(CANDIDATE, acted),
      // Step 2's own observe() succeeds; its Jev call is what the guard refuses.
      // Step 3 has no script at all and must never be opened.
      [STEPS[1]!.url]: passingSource(CANDIDATE, acted),
    });
    // Step 1's Jev answer reports 1,000 input tokens at $0.042/Mtok, which is
    // over this ceiling, so the guard refuses step 2's call before it is made.
    const maxUsd = 0.00001;
    const meter = meterOf(maxUsd);
    const jev = fakeJev(1_000);

    const { report, reportPath, failed } = await runStagehandJourney({
      session,
      jev: meterJev(jev, meter),
      meter,
      maxUsd,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(failed).toBe(true);
    expect(jev.calls.value).toBe(1);
    expect(report.stoppedAtCeiling).toBe(true);
    expect(report.stoppedAfterStep).toBe('printed-gallery-face-toggle');
    expect(report.steps.map((entry) => entry.step)).toEqual(['printed-gallery-face-toggle']);
    expect(meter.refusal()).toMatchObject({ maxUsd, step: 'precon-your-deck-select' });
    expect(session.openedUrls).toEqual([STEPS[0]!.url, STEPS[1]!.url]);
    expect(session.closed.value).toBe(true);
    // The report is written even though the run stopped.
    const written = JSON.parse(readFileSync(reportPath, 'utf8')) as { stoppedAtCeiling: boolean };
    expect(written.stoppedAtCeiling).toBe(true);
  });

  it('recognizes the refusal when observe() hands it back rewrapped as a plain Error', async () => {
    const meter = meterOf(1);
    const refusingObserve: () => Promise<StagehandCandidateSource> = () =>
      Promise.resolve({
        async observe() {
          // What the bridge does on a refused call, then Stagehand's rewrap of it.
          await meter
            .track('observe-model', () => Promise.reject(new LlmBudgetExceededError('usd', 1, 1)))
            .catch(() => undefined);
          throw new Error('observe failed: internal error');
        },
        async act() {
          throw new Error('must not be called');
        },
      });
    const session = fakeSession({ [STEPS[0]!.url]: refusingObserve });

    const { report } = await runStagehandJourney({
      session,
      jev: meterJev(fakeJev(), meter),
      meter,
      maxUsd: 1,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(report.stoppedAtCeiling).toBe(true);
    expect(report.stoppedAfterStep).toBeNull();
    expect(report.steps).toEqual([]);
  });
});

describe('runStagehandJourney: an uncaught rejection from the session is a recorded step failure', () => {
  it('does not crash the process; the report is still written with the failure recorded', async () => {
    const session: StagehandSession = {
      async openStep() {
        return {
          async observe() {
            // What Stagehand's extension RPC does on a provider error: it
            // rejects a pending-call promise nobody is awaiting, which Node
            // reports as an unhandled rejection rather than as this call's
            // own rejection. The call's own returned promise never settles.
            queueMicrotask(() => {
              void Promise.reject(
                new Error('claude-cli: claude exited with code 1, "OAuth session expired"'),
              );
            });
            return new Promise<StagehandAction[]>(() => {});
          },
          async act() {
            throw new Error('must not be called: observe() never returned a candidate');
          },
        };
      },
      async close() {},
    };
    const meter = meterOf(1);

    const { report, failed } = await runStagehandJourney({
      session,
      jev: meterJev(fakeJev(), meter),
      meter,
      maxUsd: 1,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(failed).toBe(true);
    expect(report.spentUsd).toBe(0);
    expect(report.callCount).toBe(0);
    expect(report.stoppedAtCeiling).toBe(false);
    expect(report.steps[0]!.status).toBe('fail');
    expect(report.steps[0]!.detail).toContain('OAuth session expired');
  });
});

describe('runStagehandJourney: the report carries the guard totals', () => {
  it('reports dollars, call count, token usage and unreconciled calls from one snapshot', async () => {
    const acted: { action?: StagehandAction } = {};
    const session = fakeSession({
      [STEPS[0]!.url]: passingSource(CANDIDATE, acted),
      [STEPS[1]!.url]: passingSource(CANDIDATE, acted),
      [STEPS[2]!.url]: passingSource(CANDIDATE, acted),
    });
    const meter = meterOf(10);
    // Two answers report usage, one reports none: that one is unreconciled.
    let answered = 0;
    const withUsage = fakeJev(1_000);
    const without = fakeJev(null);
    const jev: JevClient = {
      evaluate(request) {
        answered += 1;
        return (answered === 2 ? without : withUsage).evaluate(request);
      },
    };

    const { report, failed } = await runStagehandJourney({
      session,
      jev: meterJev(jev, meter),
      meter,
      maxUsd: 10,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(failed).toBe(false);
    expect(report.callCount).toBe(3);
    expect(report.unreconciledCalls).toBe(1);
    expect(report.usage.inputTokens).toBe(2_000);
    expect(report.usage.outputTokens).toBe(2);
    expect(report.spentUsd).toBeCloseTo(2_000 * (0.042 / 1_000_000), 12);
    expect(report.calls.map((call) => call.step)).toEqual(STEPS.map((step) => step.name));
  });
});

describe('jevCharge', () => {
  const price = priceOf('jev-latest');
  const answer = (usage?: { inputTokens: number; outputTokens: number }): EvaluateResult => ({
    response: { answers: {}, ...(usage === undefined ? {} : { usage }) },
    raw: null,
    latencyMs: 0,
  });

  it('prices reported tokens and marks the figure unchecked', () => {
    const entry = jevCharge(answer({ inputTokens: 1_000_000, outputTokens: 50 }), price);
    expect(entry.costUsd).toBeCloseTo(0.042, 12);
    expect(entry.usage.inputTokens).toBe(1_000_000);
    expect(entry.costCheck?.agreement).toBe('unchecked');
  });

  it('marks an answer with no usage as contradicted, at zero dollars', () => {
    const entry = jevCharge(answer(), price);
    expect(entry.costUsd).toBe(0);
    expect(entry.costCheck?.agreement).toBe('contradicted');
  });
});

describe('runStagehandJourney: a no-candidate step fails with its candidates recorded', () => {
  it('records the zero candidates it saw, fails only that step, and continues to the next', async () => {
    const acted: { action?: StagehandAction } = {};
    const session = fakeSession({
      [STEPS[0]!.url]: async () => ({
        async observe() {
          return [];
        },
        async act() {
          throw new Error('must not be called: there was nothing to choose');
        },
      }),
      [STEPS[1]!.url]: passingSource(CANDIDATE, acted),
      [STEPS[2]!.url]: passingSource(CANDIDATE, acted),
    });
    const meter = meterOf(10);

    const { report, failed } = await runStagehandJourney({
      session,
      jev: meterJev(fakeJev(), meter),
      meter,
      maxUsd: 10,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(failed).toBe(true);
    expect(report.stoppedAtCeiling).toBe(false);
    const first = report.steps[0]!;
    expect(first.status).toBe('fail');
    expect(first.candidates).toEqual([]);
    expect(first.detail).toContain('zero candidates');
    // The run continued past the failed step to the other two.
    expect(report.steps.map((entry) => entry.step)).toEqual(STEPS.map((step) => step.name));
    expect(report.steps[1]!.status).toBe('pass');
    expect(report.steps[2]!.status).toBe('pass');
  });
});

describe("runStagehandJourney: Jev's chosen option maps to the executed selector", () => {
  it("acts on exactly the candidate Jev's answer named, and the report names its selector", async () => {
    const distinctive: StagehandAction = {
      selector: 'xpath=//button[7]',
      description: 'the one Jev should pick',
    };
    const decoy: StagehandAction = { selector: 'xpath=//button[3]', description: 'a decoy candidate' };
    const acted: { action?: StagehandAction } = {};
    const session = fakeSession({
      [STEPS[0]!.url]: async () => ({
        async observe() {
          return [decoy, distinctive];
        },
        async act(action) {
          acted.action = action;
        },
      }),
      [STEPS[1]!.url]: passingSource(CANDIDATE, acted),
      [STEPS[2]!.url]: passingSource(CANDIDATE, acted),
    });
    const jev: JevClient = {
      async evaluate(request) {
        const questionId = Object.keys(request.questions)[0] as string;
        return {
          response: { answers: { [questionId]: { type: 'choice', choice: 'candidate-1' } } },
          raw: null,
          latencyMs: 0,
        };
      },
    };
    const meter = meterOf(10);

    const { report } = await runStagehandJourney({
      session,
      jev: meterJev(jev, meter),
      meter,
      maxUsd: 10,
      artifactsDir: artifactsDir(),
      steps: STEPS,
    });

    expect(acted.action).toEqual(distinctive);
    expect(report.steps[0]!.chosenSelector).toBe(distinctive.selector);
    expect(report.steps[0]!.status).toBe('pass');
  });
});

describe('waitForRender', () => {
  it("waits on the page's networkidle load state before returning (mtg-nkfd2: newPage does not wait for the SPA to render on its own)", async () => {
    const calls: Array<{ state: string; timeout: number | undefined }> = [];
    const page = {
      waitForLoadState: (state: 'networkidle', timeout?: number) => {
        calls.push({ state, timeout });
        return Promise.resolve();
      },
    };

    await waitForRender(page);

    expect(calls).toEqual([{ state: 'networkidle', timeout: 10_000 }]);
  });
});

describe('runLiveStagehandJourney: the Stagehand instance is closed on every exit path', () => {
  function fakeProvider(): StagehandProvider {
    const budget = createBudgetGuard({ maxUsd: 1 });
    return {
      budget,
      llm: {
        name: 'fixture',
        model: 'test-model',
        budget,
        complete: () => {
          throw new Error('must not be called: the preflight probe fails before any generate() call');
        },
      },
    };
  }

  it('closes Stagehand when the pre-journey preflight probe throws, before any step opens', async () => {
    const closed = { count: 0 };
    stagehandCreateMock.mockResolvedValue({
      browser: { context: { newPage: async () => ({}) } },
      observe: async () => {
        throw new Error('extension RPC refused the probe');
      },
      close: async () => {
        closed.count += 1;
      },
    });

    const { report, failed } = await runLiveStagehandJourney({
      url: 'http://127.0.0.1:1',
      artifactsDir: artifactsDir(),
      jevKey: 'test-jev-key',
      provider: fakeProvider(),
      maxUsd: 1,
      cdpUrl: 'http://127.0.0.1:9222',
      extensionId: 'test-extension-id',
    });

    expect(failed).toBe(true);
    expect(report.steps).toEqual([
      expect.objectContaining({
        step: 'preflight',
        detail: expect.stringContaining('extension RPC refused the probe'),
      }),
    ]);
    expect(closed.count).toBe(1);
  });
});

describe("buildJourneySteps' precon pick skips a momir-variant constructed format", () => {
  const limited: DiscoveredPrintedFormat = { id: 'akh-hou', name: 'Amonkhet', kind: 'limited' };
  const momir: DiscoveredPrintedFormat = {
    id: 'momir-basic',
    name: 'Momir Basic',
    kind: 'constructed',
    variant: 'momir',
  };
  const commander: DiscoveredPrintedFormat = {
    id: 'scd',
    name: 'Starter Commander Decks 2022',
    kind: 'constructed',
    variant: 'commander',
  };

  it('picks the commander-variant constructed format over an earlier-listed momir one', () => {
    const steps = buildJourneySteps('http://localhost', [limited, momir, commander]);
    const preconStep = steps.find((step) => step.name === 'precon-your-deck-select');
    expect(preconStep?.url).toContain('source=printed%3Ascd');
    expect(preconStep?.url).not.toContain('momir-basic');
  });

  it('throws when every constructed format offered is the momir variant', () => {
    expect(() => buildJourneySteps('http://localhost', [limited, momir])).toThrow(NoPrintedSubjectError);
  });
});
