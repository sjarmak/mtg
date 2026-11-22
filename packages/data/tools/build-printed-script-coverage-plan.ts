/** Deterministic plan producer; writes only to stdout and never infers semantics. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PrintedScriptCoveragePlanSchema } from '@mtg/printed-card';
import { buildPrintedScriptCoveragePlan } from '@mtg/printed-card/node';

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', multiple: true },
    'forge-scripts': { type: 'string' },
    reviews: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.catalog?.length || !values['forge-scripts'] || !values.reviews) {
  throw new Error(
    'Usage: build-printed-script-coverage-plan --catalog <catalog.json> [--catalog <catalog.json>] --forge-scripts <cardsfolder.zip> --reviews <partial-plan.json>',
  );
}
const archive = resolve(values['forge-scripts']);
const reviews = PrintedScriptCoveragePlanSchema.parse(
  JSON.parse(readFileSync(resolve(values.reviews), 'utf8')),
).scripts;
const plan = buildPrintedScriptCoveragePlan(
  values.catalog.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown),
  (member) => execFileSync('unzip', ['-p', archive, member], { timeout: 30_000, maxBuffer: 1024 * 1024 }),
  reviews,
);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
