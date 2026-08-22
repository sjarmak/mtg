/**
 * `npm run slice` — the thin end-to-end loop, unattended.
 *
 * Exit codes are the contract, and they distinguish the two ways a run can be
 * unhappy:
 *
 *   0  every stage completed and no metrics band failed
 *   1  every stage completed but the format-health verdict is no-go
 *   2  a stage broke; the pipeline itself is the problem
 *
 * That split is what lets CI assert the pipeline (a broken stage is always red)
 * while the balance bands are asserted where they belong, over a run sized for
 * them. `--metrics-gate advisory` collapses 1 into 0 for that job; the verdict
 * is still printed and still written to `summary.json`.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { formatStageFailure } from './format';
import { isSliceStageError } from './errors';
import { USAGE, parseSliceArgs } from './args';
import { runSlice } from './run';

export const EXIT_OK = 0;
export const EXIT_VERDICT_FAILED = 1;
export const EXIT_STAGE_FAILED = 2;

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseSliceArgs(argv);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_STAGE_FAILED;
  }
  if (parsed.help) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const { options } = parsed;
  console.log(
    `slice: seed ${options.runSeed}, ${options.gamesPerMatchup} games/matchup, provider ${options.provider}, out ${options.outDir}`,
  );

  try {
    const result = await runSlice(options);
    console.log('');
    console.log(result.memo);
    console.log('');
    console.log(`summary: ${result.summaryPath}`);
    return result.summary.status === 'green' ? EXIT_OK : EXIT_VERDICT_FAILED;
  } catch (error: unknown) {
    if (isSliceStageError(error)) {
      console.error('');
      console.error(formatStageFailure(error.stage, error.reason));
      if (error.cause instanceof Error && error.cause.stack !== undefined) {
        console.error(`  cause: ${error.cause.stack}`);
      }
      return EXIT_STAGE_FAILED;
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return EXIT_STAGE_FAILED;
  }
}

const entry = process.argv[1];
const invokedDirectly = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = EXIT_STAGE_FAILED;
    });
}
