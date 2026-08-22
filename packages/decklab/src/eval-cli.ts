/**
 * `decklab-eval` — run the informed pipeline against the generic-agent baseline.
 *
 * ```
 * npx tsx packages/decklab/src/eval-cli.ts --only modern-burn
 * npx tsx packages/decklab/src/eval-cli.ts --skip-judge
 * ```
 *
 * Exits non-zero when the baseline matched or beat the informed pipeline on
 * deterministic conformance, because that is the result that would invalidate
 * the whole approach and it should be impossible to overlook.
 *
 * Two more results are held to the same standard. A scenario the informed
 * pipeline never built is not a result it won: an empty deck breaks no rule, so
 * a failed build scores zero violations and passes the conformance test for
 * having produced nothing. And a card that cites no stated criterion breaks the
 * clause the report is built around. Both are the pipeline's own failures, so
 * both fail the run; a baseline that cannot answer is a fact about the baseline
 * and is reported without failing anything.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeStore, openStore, DEFAULT_DB_PATH } from '@mtg/data';
import { resolveProvider } from '@mtg/llm';
import { formatEvalReport, runEval, type EvalSummary } from './eval';
import { DEFAULT_SCENARIOS } from './scenarios';

/**
 * The gate described above, read from a finished summary alone.
 *
 * Split out of `main` so the gate is testable without paying for a run:
 * `runEval` makes live model calls and this function makes none, so
 * `eval-cli.test.ts` drives it over a constructed `EvalSummary` instead of a
 * real scenario. Before this split the decision lived inline in `main` and
 * nothing exercised it except an actual, paid run — the gate that makes "a
 * trace finding fails the run" true rather than decorative was itself
 * untested (mtg-bc2.24.3).
 */
export function evalPassed(summary: EvalSummary): boolean {
  const informedBetter =
    summary.informedViolations < summary.baselineViolations &&
    summary.informedCleanDecks >= summary.baselineCleanDecks;
  const held = summary.informedFailures === 0 && summary.tracing.findings === 0;
  return informedBetter && held;
}

export async function main(argv: readonly string[]): Promise<number> {
  const only = valueOf(argv, '--only');
  const seed = valueOf(argv, '--seed');
  const skipJudge = argv.includes('--skip-judge');

  const scenarios =
    only === undefined ? DEFAULT_SCENARIOS : DEFAULT_SCENARIOS.filter((scenario) => scenario.id === only);

  if (scenarios.length === 0) {
    process.stderr.write(
      `no scenario named ${String(only)}; available: ${DEFAULT_SCENARIOS.map((s) => s.id).join(', ')}\n`,
    );
    return 2;
  }

  const store = openStore(valueOf(argv, '--db') ?? DEFAULT_DB_PATH, { readonly: true });
  try {
    const result = await runEval({
      store,
      provider: resolveProvider(),
      scenarios,
      ...(seed === undefined ? {} : { seed }),
      skipJudge,
    });
    process.stdout.write(`${formatEvalReport(result)}\n`);

    return evalPassed(result.summary) ? 0 : 1;
  } finally {
    closeStore(store);
  }
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

// Guarded the way `cli.ts` and `packages/cube/src/cli.ts` guard their own entry
// points: importing this module (as `eval-cli.test.ts` does, for `evalPassed`)
// must not fire off a real run against the live provider.
const entry = process.argv[1];
const invokedDirectly = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
