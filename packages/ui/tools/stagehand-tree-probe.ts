/**
 * `mtg-nkfd2`: tells apart the two remaining causes of the paid run's
 * zero-candidate `observe()` calls (`mtg-5a89i` ruled out suspect 1, the
 * model-bridge mapping) — at $0, against a real running lab, with no key.
 *
 * Suspect 2: the model named elementIds absent from Stagehand's own
 * accessibility snapshot, so Stagehand's own candidate filter dropped every
 * one of them. Suspect 3: the snapshot handed to the model was empty or
 * near-empty because the page had not rendered when `observe()` ran.
 *
 * The two are told apart by replacing Stagehand's model with a stub that
 * never leaves this process: it reads the same accessibility tree text the
 * real model would have been asked to read (`parseElementIds`, matching the
 * `[frame-node]` bracket format Stagehand's own system prompt documents,
 * `service-worker.js`'s `buildObserveUserMessage`/`ObservationSchema`), and
 * answers with one id taken directly from that tree. If the tree names no
 * ids, the page had nothing to observe (suspect 3). If it does and the stub's
 * answer still comes back as a real candidate, the observe-to-candidate path
 * works end to end and the paid run's zero candidates were the model naming
 * ids the tree never listed (suspect 2).
 *
 * This never imports Jev, a `BudgetGuard`, or `@mtg/llm`: the stub is the
 * entire model, so there is nothing to meter and nothing to spend. It opens
 * the real Chromium + Stagehand extension path (`stagehand-chromium.ts`) and
 * needs a launcher already running at `--url`; it is a dev script, not a
 * default suite member, for exactly that reason.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverStagehandExtensionId, launchStagehandChromium } from './stagehand-chromium';
import { shutdownChrome } from '../test/support/chrome-driver';
import { guardProcessCrash, withRuntimePreflight } from './stagehand-runtime';
import { contentToText } from './stagehand-model-bridge';
import type { GenerateRequest, GenerateResult } from './stagehand-model-bridge';
import { buildJourneySteps, discoverPrintedFormats } from './stagehand-runner';
import type { JourneyStepDefinition } from './stagehand-runner';
import { loopbackTelemetryEndpoint } from './stagehand-telemetry';

/**
 * `stagehand-model-bridge.ts` and `stagehand-runner.ts` are the only files
 * outside the runner allowed a static `@browserbasehq/stagehand` import
 * (`live-journey.ts: the no-flag path never loads @browserbasehq/stagehand`
 * in `stagehand-runner.test.ts`), so `GenerateRequest`/`GenerateResult` come
 * from the bridge's own re-export rather than the package directly.
 */
type StubGenerate = (request: GenerateRequest) => Promise<GenerateResult>;

const STAGEHAND_EXTENSION_DEADLINE_MS = 10_000;
/** Enough to judge tree size and read a few real element lines; never enough to be the whole tree. */
const TREE_EXCERPT_LIMIT = 2_000;
const ELEMENT_ID_PATTERN = /\[(\d+-\d+)\]/g;

/**
 * The user message text only, never the system prompt: Stagehand's own
 * system prompt gives `[0-18372]` as a worked example of the bracket format,
 * which would otherwise get counted as a real element (`buildObserveUserMessage`
 * in the shipped extension's `service-worker.js` puts the actual tree in the
 * user message, under a literal "Accessibility Tree:" line).
 */
function userMessageTextOf(request: GenerateRequest): string {
  return request.messages.map((message) => contentToText(message.content)).join('\n\n');
}

/**
 * Every elementId the accessibility tree text names, in the `[frame-node]`
 * bracket form Stagehand's own system prompt tells the model to copy
 * verbatim (`docs/research/stagehand-jev-seam.md` doesn't cover this; found
 * directly in the shipped extension's `service-worker.js`). Order preserved,
 * duplicates kept, so the count is the tree's own candidate count.
 */
export function parseElementIds(prompt: string): readonly string[] {
  return [...prompt.matchAll(ELEMENT_ID_PATTERN)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined);
}

export interface StubObserveCall {
  readonly promptLength: number;
  readonly elementIds: readonly string[];
  readonly treeExcerpt: string;
  readonly answeredElementId: string | null;
}

/**
 * A `ClientLLM['generate']` that never calls a model: it reads the prompt
 * Stagehand actually sent, records what the tree told it, and answers with
 * one real id from that tree (or an empty candidate list when the tree named
 * none, which is itself the suspect-3 finding). Matches the schema
 * `ObservationSchema` in the shipped extension requires: `{ elements: [{
 * elementId, description, method, arguments }] }`.
 */
export function createStubObserveGenerate(onCall: (call: StubObserveCall) => void): StubGenerate {
  return (request: GenerateRequest): Promise<GenerateResult> => {
    const prompt = userMessageTextOf(request);
    const elementIds = parseElementIds(prompt);
    const chosen = elementIds[0] ?? null;
    onCall({
      promptLength: prompt.length,
      elementIds,
      treeExcerpt: prompt.length <= TREE_EXCERPT_LIMIT ? prompt : `${prompt.slice(0, TREE_EXCERPT_LIMIT)}…`,
      answeredElementId: chosen,
    });
    const structuredContent =
      chosen === null
        ? { elements: [] }
        : {
            elements: [
              {
                elementId: chosen,
                description: 'stub: the first element named in the accessibility tree',
                method: 'click',
                arguments: [],
              },
            ],
          };
    return Promise.resolve({
      role: 'assistant',
      content: { type: 'text', text: JSON.stringify(structuredContent) },
      outputFormat: 'json_schema',
      structuredContent,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
    } as GenerateResult);
  };
}

export interface StepFinding {
  readonly step: string;
  readonly instruction: string;
  readonly treeElementCount: number;
  readonly promptLength: number;
  readonly treeExcerpt: string;
  readonly stubAnsweredElementId: string | null;
  readonly observedCandidateCount: number;
  readonly suspect: 'suspect-3-empty-tree' | 'suspect-2-pipeline-ok' | 'stub-id-not-echoed-back';
  readonly error: string | null;
}

export interface TreeProbeReport {
  readonly url: string;
  readonly steps: readonly StepFinding[];
}

/**
 * Runs one step against an already-created `Stagehand` instance whose model
 * is the stub above, and classifies the result. `stagehand` is typed loosely
 * (only the two calls this needs) so this function is testable against a
 * fake with no real SDK import at the call site.
 */
export async function probeStep<
  PageLike extends {
    close(): Promise<void>;
    waitForLoadState?(state: 'networkidle', timeout?: number): Promise<void>;
  },
>(
  stagehand: {
    browser: {
      context: {
        newPage: (url: string) => Promise<PageLike>;
      };
    };
    observe: (instruction: string, options: { page: PageLike }) => Promise<{ data: readonly unknown[] }>;
  },
  step: JourneyStepDefinition,
  lastCall: () => StubObserveCall | null,
): Promise<StepFinding> {
  const page = await stagehand.browser.context.newPage(step.url);
  try {
    await page.waitForLoadState?.('networkidle', 10_000);
    let observedCandidateCount = 0;
    let error: string | null = null;
    try {
      const result = await guardProcessCrash(() =>
        withRuntimePreflight(() => stagehand.observe(step.instruction, { page })),
      );
      observedCandidateCount = result.data.length;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const call = lastCall();
    const treeElementCount = call?.elementIds.length ?? 0;
    const suspect: StepFinding['suspect'] =
      treeElementCount === 0
        ? 'suspect-3-empty-tree'
        : observedCandidateCount > 0
          ? 'suspect-2-pipeline-ok'
          : 'stub-id-not-echoed-back';
    return {
      step: step.name,
      instruction: step.instruction,
      treeElementCount,
      promptLength: call?.promptLength ?? 0,
      treeExcerpt: call?.treeExcerpt ?? '',
      stubAnsweredElementId: call?.answeredElementId ?? null,
      observedCandidateCount,
      suspect,
      error,
    };
  } finally {
    await page.close();
  }
}

function readArgs(argv: readonly string[]): { url: string; artifacts: string } | string {
  let url: string | null = null;
  let artifacts = join('out', 'stagehand-tree-probe');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') url = argv[++index] ?? null;
    else if (arg === '--artifacts') artifacts = argv[++index] ?? artifacts;
    else return `unrecognized argument: ${String(arg)}`;
  }
  if (url === null) return '--url <base> is required (a launcher must already be running there)';
  return { url, artifacts };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    process.exit(2);
  }

  const profile = await mkdtemp(join(tmpdir(), 'mtg-stagehand-tree-probe-'));
  const chrome = await launchStagehandChromium(profile);
  const findings: StepFinding[] = [];
  let exitCode = 0;
  try {
    const extensionId = await discoverStagehandExtensionId(chrome.client, STAGEHAND_EXTENSION_DEADLINE_MS);
    const { Stagehand: StagehandCtor, localBrowser } = await import('@browserbasehq/stagehand');
    const browser = await withRuntimePreflight(() =>
      localBrowser.connect({ cdpUrl: chrome.debuggerUrl, extensionId }),
    );
    let lastCall: StubObserveCall | null = null;
    const stagehand = await StagehandCtor.create({
      browser,
      model: { generate: createStubObserveGenerate((call) => (lastCall = call)) },
      telemetry: { traces: { endpoint: loopbackTelemetryEndpoint().toString() } },
    });
    try {
      const formats = await discoverPrintedFormats(args.url);
      const steps = buildJourneySteps(args.url, formats);
      const probeAdapter = {
        browser: { context: { newPage: stagehand.browser.context.newPage.bind(stagehand.browser.context) } },
        observe: stagehand.observe.bind(stagehand),
      };
      for (const step of steps) {
        const finding = await probeStep(probeAdapter, step, () => lastCall);
        findings.push(finding);
        console.log(
          `${finding.step}: tree=${String(finding.treeElementCount)} elements, ` +
            `observed=${String(finding.observedCandidateCount)} candidates -> ${finding.suspect}` +
            (finding.error === null ? '' : ` (error: ${finding.error})`),
        );
      }
    } finally {
      await stagehand.close();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  } finally {
    await shutdownChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }

  const report: TreeProbeReport = { url: args.url, steps: findings };
  await mkdir(args.artifacts, { recursive: true });
  const reportPath = join(args.artifacts, 'stagehand-tree-probe-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`report: ${reportPath}`);
  process.exit(exitCode);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) void main();
