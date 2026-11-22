/**
 * The armed (`--max-usd`) Stagehand path's journey steps: `observe()` candidates,
 * one Jev `choice` per step, the chosen candidate executed by its own selector
 * (`docs/research/stagehand-jev-seam.md`). `mtg-onjme` (`7dd6d874e`) built the
 * arming flag and the keyless refusal in `live-journey.ts`; this is the follow-up
 * (`mtg-onjme.1`) that fills the stub those left behind.
 *
 * Two halves, deliberately split so the orchestration is testable with fakes and
 * no network:
 *
 * - `runStagehandJourney` drives an already-open `StagehandSession` — an
 *   interface, not the real `@browserbasehq/stagehand` types — through the
 *   converted steps, the meter, and the report. It imports nothing from the
 *   Stagehand package and nothing from `live-journey.ts` (a static import from
 *   there would pull the launcher's own `discover()`/`Subject` machinery into
 *   this file's graph, and `live-journey.ts`'s AC1 gate reads this file's
 *   source text for exactly that kind of accidental reach; a small duplicated
 *   `discoverPrintedFormats` below is the deliberate cost of keeping the two
 *   files independent).
 * - `runLiveStagehandJourney` is the one function that touches the real SDK: it
 *   builds the `Stagehand` instance (loopback telemetry, the metered
 *   `ClientLLM` bridge, no `cache`/`apiUrl`), reuses the already-launched full
 *   Chromium via `localBrowser.connect({cdpUrl, extensionId})` (`mtg-jiusn`:
 *   chrome-headless-shell has no `Extensions.loadUnpacked`, so
 *   `live-journey.ts`'s armed branch launches Chromium with the extension
 *   preloaded and passes its id here instead), runs the runtime preflight,
 *   and adapts that instance to `StagehandSession` before handing off to
 *   `runStagehandJourney`. Only `live-journey.ts`'s armed branch calls this,
 *   through a dynamic `import()`, so the no-flag path never loads
 *   `@browserbasehq/stagehand`.
 */
import { z } from 'zod';
import type { Stagehand, Action as RealStagehandAction } from '@browserbasehq/stagehand';
import { localBrowser } from '@browserbasehq/stagehand';
import { ZERO_USAGE } from '@mtg/llm';
import type { BudgetGuard } from '@mtg/llm';
import { createJevDirectClient, JEV_DIRECT_MODEL } from '../../draft-export/tools/jev-label/jev-client';
import type {
  JevClient,
  EvaluateRequest,
  EvaluateResult,
} from '../../draft-export/tools/jev-label/jev-client';
import { chooseCandidate } from './stagehand-candidates';
import type { StagehandAction } from './stagehand-candidates';
import { createMeteredGenerate } from './stagehand-model-bridge';
import { StagehandMeter } from './stagehand-meter';
import { priceOf } from './stagehand-price-table';
import type { ModelPrice } from './stagehand-price-table';
import type { StagehandProvider } from './stagehand-provider';
import { loopbackTelemetryEndpoint } from './stagehand-telemetry';
import { guardProcessCrash, withRuntimePreflight } from './stagehand-runtime';
import { spendOf, writeReport } from './stagehand-report';
import type { CandidateSummary, RunReport, StepReport } from './stagehand-report';
import { playHash, sectionForPrecon } from './live-journey-routes';

/** One page opened for one step, and the two calls a step makes against it. */
export interface StagehandCandidateSource {
  observe(instruction: string): Promise<readonly StagehandAction[]>;
  act(action: StagehandAction): Promise<void>;
}

/**
 * The armed path's dependency on Stagehand, narrowed to what `runStagehandJourney`
 * needs. The real adapter (`liveStagehandSession`, below) wraps an actual
 * `Stagehand` instance; a test hands in a fake that never imports the SDK.
 */
export interface StagehandSession {
  openStep(url: string): Promise<StagehandCandidateSource>;
  close(): Promise<void>;
}

export interface JourneyStepDefinition {
  readonly name: string;
  readonly url: string;
  readonly instruction: string;
}

type BudgetEntry = Parameters<BudgetGuard['record']>[0];

/**
 * What one Jev answer cost: its reported tokens times the price table. Jev
 * reports no dollars, so there is nothing to corroborate the figure against and
 * it is recorded as unchecked. An answer with no usage at all is recorded as
 * contradicted, which is what makes `unreconciledCalls` count it: the call
 * billed something and nobody measured what.
 */
export function jevCharge(result: EvaluateResult, price: ModelPrice): BudgetEntry {
  const reported = result.response.usage;
  if (reported?.inputTokens === undefined || reported.outputTokens === undefined) {
    return {
      costUsd: 0,
      usage: ZERO_USAGE,
      costCheck: {
        reportedUsd: null,
        pricedUsd: null,
        usageMeasured: false,
        agreement: 'contradicted',
        detail: `${price.modelId} answered with no usage block, so its cost is unknown`,
      },
    };
  }
  const costUsd =
    reported.inputTokens * price.inputUsdPerToken + reported.outputTokens * price.outputUsdPerToken;
  return {
    costUsd,
    usage: { ...ZERO_USAGE, inputTokens: reported.inputTokens, outputTokens: reported.outputTokens },
    costCheck: {
      reportedUsd: null,
      pricedUsd: costUsd,
      usageMeasured: true,
      agreement: 'unchecked',
      detail: `${price.modelId} reports tokens only; priced from ${price.source}`,
    },
  };
}

/**
 * A metered `JevClient`: refused by the run's `BudgetGuard` before each call
 * once the ceiling is met, and recorded against that same guard after.
 */
export function meterJev(jev: JevClient, meter: StagehandMeter, modelId = JEV_DIRECT_MODEL): JevClient {
  const price = priceOf(modelId);
  return {
    evaluate(request: EvaluateRequest): Promise<EvaluateResult> {
      return meter.track(modelId, async () => {
        meter.budget.assertAvailable();
        const result = await jev.evaluate(request);
        meter.budget.record(jevCharge(result, price));
        return result;
      });
    },
  };
}

function candidateSummariesOf(candidates: readonly StagehandAction[]): readonly CandidateSummary[] {
  return candidates.map((candidate) => ({
    selector: candidate.selector,
    description: candidate.description,
  }));
}

/**
 * Runs the converted steps against an already-open session, in order, stopping
 * the whole run (not just the current step) on a ceiling refusal — the report
 * then names the ceiling and the step it stopped after, per acceptance
 * criterion 2. Any other per-step failure (zero candidates, an unmatched Jev
 * answer, or the step's own error) fails that step alone and the run continues
 * to the next one, recording the candidates it did see.
 */
export async function runStagehandJourney(options: {
  readonly session: StagehandSession;
  readonly jev: JevClient;
  readonly meter: StagehandMeter;
  readonly maxUsd: number;
  readonly artifactsDir: string;
  readonly steps: readonly JourneyStepDefinition[];
}): Promise<{ readonly report: RunReport; readonly reportPath: string; readonly failed: boolean }> {
  const stepReports: StepReport[] = [];
  let stoppedAtCeiling = false;
  let stoppedAfterStep: string | null = null;

  try {
    for (const step of options.steps) {
      options.meter.setStep(step.name);
      let candidates: readonly StagehandAction[] = [];
      try {
        const source = await options.session.openStep(step.url);
        candidates = await guardProcessCrash(() =>
          withRuntimePreflight(() => source.observe(step.instruction)),
        );
        const choice = await chooseCandidate(options.jev, { step: step.name }, step.instruction, candidates);
        await guardProcessCrash(() => source.act(choice.chosen));
        stepReports.push({
          step: step.name,
          instruction: step.instruction,
          candidates: candidateSummariesOf(candidates),
          probabilities: choice.probabilities,
          chosenSelector: choice.chosen.selector,
          status: 'pass',
          detail: null,
        });
      } catch (error) {
        // Read off the meter, not the error: a refusal inside observe() arrives
        // rewrapped by Stagehand, and one it swallowed arrives as zero candidates.
        if (options.meter.refusal() !== null) {
          stoppedAtCeiling = true;
          stoppedAfterStep = stepReports.at(-1)?.step ?? null;
          break;
        }
        const detail = error instanceof Error ? error.message : String(error);
        stepReports.push({
          step: step.name,
          instruction: step.instruction,
          candidates: candidateSummariesOf(candidates),
          probabilities: {},
          chosenSelector: null,
          status: 'fail',
          detail,
        });
      }
    }
  } finally {
    await options.session.close();
  }

  const report: RunReport = {
    maxUsd: options.maxUsd,
    ...spendOf(options.meter.snapshot()),
    stoppedAtCeiling,
    stoppedAfterStep,
    steps: stepReports,
    calls: options.meter.callLog(),
  };
  const reportPath = await writeReport(options.artifactsDir, report);
  const failed = stoppedAtCeiling || stepReports.some((entry) => entry.status === 'fail');
  return { report, reportPath, failed };
}

/**
 * A minimal, local duplicate of `live-journey.ts`'s `PrintedIndexSchema`/`discover()`,
 * kept deliberately independent of that file (see the module comment). Only
 * what the three converted steps need: one printed format id per kind.
 */
const LocalPrintedIndexSchema = z.object({
  formats: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(['limited', 'constructed']),
      variant: z.enum(['commander', 'momir']).optional(),
      availability: z.object({ play: z.object({ status: z.string() }) }),
    }),
  ),
});

export interface DiscoveredPrintedFormat {
  readonly id: string;
  readonly name: string;
  readonly kind: 'limited' | 'constructed';
  readonly variant?: 'commander' | 'momir';
}

export class NoPrintedSubjectError extends Error {
  constructor(kind: 'limited' | 'constructed') {
    super(
      `no supported printed format of kind "${kind}" is offered at this launcher; the Stagehand journey needs one`,
    );
    this.name = 'NoPrintedSubjectError';
  }
}

export async function discoverPrintedFormats(base: string): Promise<readonly DiscoveredPrintedFormat[]> {
  const response = await fetch(`${base}/formats/index.json`).catch(() => null);
  if (response === null || !response.ok) return [];
  const parsed = LocalPrintedIndexSchema.parse(await response.json());
  return parsed.formats
    .filter((format) => format.availability.play.status === 'supported')
    .map((format) => ({
      id: format.id,
      name: format.name,
      kind: format.kind,
      ...(format.variant === undefined ? {} : { variant: format.variant }),
    }));
}

function firstOfKind(
  formats: readonly DiscoveredPrintedFormat[],
  kind: 'limited' | 'constructed',
): DiscoveredPrintedFormat {
  const found = formats.find((format) => format.kind === kind);
  if (found === undefined) throw new NoPrintedSubjectError(kind);
  return found;
}

function firstPreconConstructed(formats: readonly DiscoveredPrintedFormat[]): DiscoveredPrintedFormat {
  const found = formats.find((format) => format.kind === 'constructed' && format.variant !== 'momir');
  if (found === undefined) throw new NoPrintedSubjectError('constructed');
  return found;
}

/**
 * The three steps converted from the CDP journeys, chosen for carrying the
 * most hand-written selector work there (named in the `mtg-onjme.1` bead
 * comment and in `docs/research/stagehand-jev-seam.md`'s new section):
 *
 * - the printed gallery's face-flip toggle (`FACE_FLIP_LABEL_SOURCE`'s regex
 *   match over every button's accessible name, `printedJourney`),
 * - the precon "your deck" selector walk (`printedPreconJourney`'s
 *   `SELECT`/`CHOOSE` label search), and
 * - a printed draft's first pack pick (`Page.draftToCompletion`'s pack-card
 *   selector chain).
 *
 * Each opens its own directly-navigable URL and asks Stagehand to `observe()`
 * one instruction, rather than replaying the CDP steps that precede it in the
 * full journey, because the point of this conversion is the observe-choose-act
 * pipeline on one control, not a second implementation of the whole journey.
 */
export function buildJourneySteps(
  base: string,
  formats: readonly DiscoveredPrintedFormat[],
): readonly JourneyStepDefinition[] {
  const limited = firstOfKind(formats, 'limited');
  const constructed = firstPreconConstructed(formats);

  const gallerySource = `printed:${limited.id}`;
  const draftSeed = `live-journey-stagehand/${limited.id}`;

  return [
    {
      name: 'printed-gallery-face-toggle',
      url: `${base}/#/cards/gallery?source=${encodeURIComponent(gallerySource)}`,
      instruction: 'Find the button on a card that shows the other face of a double-faced or modal card',
    },
    {
      name: 'precon-your-deck-select',
      url: `${base}/#${playHash(sectionForPrecon('commander'), { source: `printed:${constructed.id}` })}`,
      instruction: 'Find the control that lets you choose or open "Your deck" for this precon pairing',
    },
    {
      name: 'printed-draft-first-pick',
      url: `${base}/#/play/draft?seed=${encodeURIComponent(draftSeed)}&source=${encodeURIComponent(gallerySource)}`,
      instruction: 'Find the first pickable card in the current draft pack',
    },
  ];
}

/**
 * Normalizes a real Stagehand `Action` to this file's own `StagehandAction`
 * shape (a `readonly arguments` array) and back (Stagehand's own `act()` wants
 * a mutable one), so `stagehand-candidates.ts` never needs to import the SDK.
 */
function fromRealAction(action: RealStagehandAction): StagehandAction {
  return {
    selector: action.selector,
    description: action.description,
    ...(action.method === undefined ? {} : { method: action.method }),
    ...(action.arguments === undefined ? {} : { arguments: action.arguments }),
  };
}

function toRealAction(action: StagehandAction): RealStagehandAction {
  return {
    selector: action.selector,
    description: action.description,
    ...(action.method === undefined ? {} : { method: action.method }),
    ...(action.arguments === undefined ? {} : { arguments: [...action.arguments] }),
  };
}

/**
 * `mtg-nkfd2`: `newPage` starts navigation but does not wait for the SPA to
 * render, so an `observe()` fired immediately after saw only the pre-hydration
 * shell (`RootWebArea` + one `scrollable, html`, confirmed against the real
 * lab with a stub model reading the raw accessibility tree text) — the
 * zero-candidate paid run's actual cause, not a model/bridge mismatch
 * (`mtg-5a89i` already ruled that mapping out). `networkidle` is what turns
 * that into the full rendered tree.
 */
export async function waitForRender(page: {
  waitForLoadState(state: 'networkidle', timeout?: number): Promise<void>;
}): Promise<void> {
  await page.waitForLoadState('networkidle', 10_000);
}

/** Adapts a live `Stagehand` instance (already `create()`d, browser attached) to `StagehandSession`. */
function liveStagehandSession(stagehand: Stagehand): StagehandSession {
  return {
    async openStep(url) {
      const page = await stagehand.browser.context.newPage(url);
      await waitForRender(page);
      return {
        async observe(instruction) {
          const result = await stagehand.observe(instruction, { page });
          return result.data.map(fromRealAction);
        },
        async act(action) {
          await stagehand.act(toRealAction(action), { page });
        },
      };
    },
    async close() {
      await stagehand.close();
    },
  };
}

export interface LiveStagehandJourneyOptions {
  readonly url: string;
  readonly artifactsDir: string;
  /** The direct Jev key, `TYPESAFE_API_KEY`, already read by `stagehand-key.ts`. */
  readonly jevKey: string;
  /** The `observe()` provider and the run's one `BudgetGuard`, resolved before Chrome launched. */
  readonly provider: StagehandProvider;
  readonly maxUsd: number;
  readonly cdpUrl: string;
  /** The extension id `stagehand-chromium.ts` found on this Chromium, so `connect` skips `Extensions.loadUnpacked`. */
  readonly extensionId: string;
}

/**
 * Builds the real `Stagehand` instance against the already-launched full
 * Chromium (`localBrowser.connect({cdpUrl, extensionId})`, `mtg-jiusn`; the
 * "reuse the CDP browser" decision — `docs/research/stagehand-jev-seam.md` —
 * still holds, only the browser it reuses changed from chrome-headless-shell),
 * wires the metered `ClientLLM` bridge and loopback telemetry, runs the
 * runtime preflight before any journey step, and hands off to
 * `runStagehandJourney`. The only function in this file — and, transitively,
 * the only path from `live-journey.ts`'s armed branch — that imports
 * `@browserbasehq/stagehand` for real use.
 */
export async function runLiveStagehandJourney(
  options: LiveStagehandJourneyOptions,
): Promise<{ readonly report: RunReport; readonly reportPath: string; readonly failed: boolean }> {
  const meter = new StagehandMeter(options.provider.budget);
  const jev = meterJev(createJevDirectClient({ apiKey: options.jevKey }), meter);

  // Everything below can fail before a single journey step runs -- a Chrome
  // connect error, a provider error building the Stagehand instance, or a
  // preflight crash from the extension probe. Whatever fails and however it
  // arrives (a normal rejection or one `guardProcessCrash` recovered from a
  // process-level crash), the report and spend ledger still get written: that
  // is the whole point of arming a paid run (`mtg-sh8ej`).
  try {
    const { Stagehand: StagehandCtor } = await import('@browserbasehq/stagehand');
    const browser = await withRuntimePreflight(() =>
      localBrowser.connect({ cdpUrl: options.cdpUrl, extensionId: options.extensionId }),
    );
    const stagehand = await StagehandCtor.create({
      browser,
      model: { generate: createMeteredGenerate({ llm: options.provider.llm, meter }) },
      telemetry: { traces: { endpoint: loopbackTelemetryEndpoint().toString() } },
    });

    try {
      // A throwaway probe, before any of the three named steps, so an
      // `Extensions.loadUnpacked` refusal or a protocol mismatch surfaces here
      // rather than mid-journey (acceptance criterion: "before the first journey
      // step").
      await guardProcessCrash(() =>
        withRuntimePreflight(async () => {
          const probePage = await stagehand.browser.context.newPage('about:blank');
          await stagehand.observe('Confirm the page has loaded', { page: probePage });
          await probePage.close();
        }),
      );

      const formats = await discoverPrintedFormats(options.url);
      const steps = buildJourneySteps(options.url, formats);
      const session = liveStagehandSession(stagehand);

      return await runStagehandJourney({
        session,
        jev,
        meter,
        maxUsd: options.maxUsd,
        artifactsDir: options.artifactsDir,
        steps,
      });
    } finally {
      // `runStagehandJourney`'s own finally closes the session (and so
      // `stagehand`) on the path that reaches it; `Stagehand#close()` caches its
      // promise, so this is a no-op there. On any path that throws before that
      // handoff -- the preflight probe, `discoverPrintedFormats`, or
      // `buildJourneySteps` (`NoPrintedSubjectError`) -- this is what actually
      // closes it, so the extension/socket cleanup still runs even though Chrome
      // and the process exit regardless (`live-journey.ts`'s `shutdownChrome`
      // finally, then `process.exit`).
      await stagehand.close();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const refusal = meter.refusal();
    const report: RunReport = {
      maxUsd: options.maxUsd,
      ...spendOf(meter.snapshot()),
      stoppedAtCeiling: refusal !== null,
      stoppedAfterStep: refusal?.step ?? null,
      steps: [
        {
          step: 'preflight',
          instruction: 'Confirm the page has loaded',
          candidates: [],
          probabilities: {},
          chosenSelector: null,
          status: 'fail',
          detail,
        },
      ],
      calls: meter.callLog(),
    };
    const reportPath = await writeReport(options.artifactsDir, report);
    return { report, reportPath, failed: true };
  }
}
