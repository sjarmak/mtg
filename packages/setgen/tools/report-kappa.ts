/**
 * `tsx packages/setgen/tools/report-kappa.ts` — Cohen's κ between the playtester's
 * adjudication and the critic's verdicts, once both are real.
 *
 * Reads two files that must already exist and never writes either: an
 * `AdjudicationFile` produced by `adjudicate.ts` and a `VerdictsFile` produced
 * by `run-critic.ts` at the same `--seed`/`--size`. Refuses to run at all if
 * the two files disagree on seed or size, since that would join two different
 * draws and publish a number about neither.
 *
 *   tsx packages/setgen/tools/report-kappa.ts \
 *     --adjudication out/critic/adjudication-critic-sample-1.json \
 *     --verdicts out/critic/verdicts-critic-sample-1.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeAgreement } from '../src/critic/agreement';
import { AdjudicationFileSchema, loadVerdictsFile } from '../src/critic/records';

function parseArgs(argv: readonly string[]): { adjudicationPath: string; verdictsPath: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined) continue;
    values.set(arg.slice(2), next);
    index += 1;
  }
  const adjudicationPath = values.get('adjudication');
  const verdictsPath = values.get('verdicts');
  if (adjudicationPath === undefined || verdictsPath === undefined) {
    throw new Error('usage: report-kappa.ts --adjudication <file> --verdicts <file>');
  }
  return {
    adjudicationPath: resolve(process.cwd(), adjudicationPath),
    verdictsPath: resolve(process.cwd(), verdictsPath),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const { adjudicationPath, verdictsPath } = parseArgs(argv);
  const adjudication = AdjudicationFileSchema.parse(
    JSON.parse(readFileSync(adjudicationPath, 'utf8')) as unknown,
  );
  const verdicts = loadVerdictsFile(verdictsPath);

  if (adjudication.seed !== verdicts.seed || adjudication.size !== verdicts.size) {
    console.error(
      `${adjudicationPath} is seed "${adjudication.seed}" size ${adjudication.size}; ` +
        `${verdictsPath} is seed "${verdicts.seed}" size ${verdicts.size}. Refusing to join two different draws.`,
    );
    return 1;
  }

  const summary = summarizeAgreement(adjudication, verdicts);
  console.log(`matched items: ${summary.matchedItems}`);
  if (summary.unmatchedSlotIds.length > 0) {
    console.log(`answered by the rater but not judged by the critic: ${summary.unmatchedSlotIds.join(', ')}`);
  }
  console.log('');
  for (const [criterion, result] of summary.perCriterion) {
    console.log(
      `${criterion.padEnd(20)} kappa=${result.kappa.toFixed(3)}  po=${result.observedAgreement.toFixed(3)}  ` +
        `pe=${result.expectedAgreement.toFixed(3)}  n=${result.n}`,
    );
  }
  console.log('');
  console.log(
    `aggregate            kappa=${summary.aggregate.kappa.toFixed(3)}  po=${summary.aggregate.observedAgreement.toFixed(3)}  ` +
      `pe=${summary.aggregate.expectedAgreement.toFixed(3)}  n=${summary.aggregate.n}`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
