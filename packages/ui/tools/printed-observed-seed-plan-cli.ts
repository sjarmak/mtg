/** Plans a bounded sweep that maximizes residual deck and pool printing coverage. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import { samplePrintedLimitedDecks } from './printed-limited-decks';
import { selectCoverageSeeds } from './printed-observed-seed-plan';

const PriorReportSchema = z.object({
  coverage: z.object({
    poolPrintingIds: z.array(z.string()),
    deckPrintingIds: z.array(z.string()),
  }),
});

const { values } = parseArgs({
  options: {
    format: { type: 'string' },
    catalog: { type: 'string', multiple: true },
    mode: { type: 'string' },
    'seed-start': { type: 'string' },
    'candidate-count': { type: 'string' },
    'select-count': { type: 'string' },
    'prior-report': { type: 'string', multiple: true },
    output: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (
  !values.format ||
  !values.catalog?.length ||
  !values.mode ||
  !values['seed-start'] ||
  !values['candidate-count'] ||
  !values['select-count'] ||
  !values.output
) {
  throw new Error(
    'Usage: printed-observed-seed-plan --format <format.json> --catalog <catalog.json> [--catalog <catalog.json>] --mode <draft|sealed> --seed-start <n> --candidate-count <n> --select-count <n> [--prior-report <report.json>] --output <plan.json>',
  );
}
if (values.mode !== 'draft' && values.mode !== 'sealed')
  throw new Error('Seed-plan mode must be draft or sealed');
const seedStart = Number(values['seed-start']);
const candidateCount = Number(values['candidate-count']);
const selectCount = Number(values['select-count']);
if (
  !Number.isSafeInteger(seedStart) ||
  seedStart < 0 ||
  !Number.isInteger(candidateCount) ||
  candidateCount < 1 ||
  candidateCount > 100_000 ||
  !Number.isInteger(selectCount) ||
  selectCount < 1 ||
  selectCount > Math.min(candidateCount, 100)
) {
  throw new Error('Seed-plan bounds are invalid');
}
const output = resolve(values.output);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);

const format = JSON.parse(readFileSync(resolve(values.format), 'utf8')) as unknown;
const catalogs = values.catalog.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown);
const prepared = await preparePrintedLimitedFormat(format, catalogs, async (text) =>
  createHash('sha256').update(text).digest('hex'),
);
const prior = (values['prior-report'] ?? []).map((path) =>
  PriorReportSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8'))),
);
const baseline = {
  poolPrintingIds: [...new Set(prior.flatMap((report) => report.coverage.poolPrintingIds))].sort(),
  deckPrintingIds: [...new Set(prior.flatMap((report) => report.coverage.deckPrintingIds))].sort(),
};
const candidates = Array.from({ length: candidateCount }, (_, index) => seedStart + index).map((seed) => {
  const decks = samplePrintedLimitedDecks(prepared, values.mode as 'draft' | 'sealed', seed);
  return {
    seed,
    poolPrintingIds: [...new Set(decks.flatMap((deck) => deck.poolPrintingIds))].sort(),
    deckPrintingIds: [...new Set(decks.flatMap((deck) => deck.selectedPrintingIds))].sort(),
  };
});
const selected = selectCoverageSeeds(candidates, baseline, selectCount);
const result = {
  schemaVersion: 1 as const,
  kind: 'printed-observed-seed-plan' as const,
  policy: 'greedy-new-deck-then-pool-printings/v1' as const,
  formatId: prepared.format.id,
  formatFingerprint: prepared.fingerprint,
  mode: values.mode,
  candidateRange: { start: seedStart, count: candidateCount },
  priorReports: values['prior-report'] ?? [],
  baseline: {
    poolPrintings: baseline.poolPrintingIds.length,
    deckPrintings: baseline.deckPrintingIds.length,
  },
  selected,
  projected: {
    poolPrintings: new Set([
      ...baseline.poolPrintingIds,
      ...selected.flatMap((candidate) => candidate.poolPrintingIds),
    ]).size,
    deckPrintings: new Set([
      ...baseline.deckPrintingIds,
      ...selected.flatMap((candidate) => candidate.deckPrintingIds),
    ]).size,
  },
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ output, selected: selected.map(({ seed }) => seed), projected: result.projected })}\n`,
);
