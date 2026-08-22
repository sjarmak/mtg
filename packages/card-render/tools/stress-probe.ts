/**
 * Renders the stress fixtures and prints the fitted size of each region.
 *
 * Usage: npx tsx packages/card-render/tools/stress-probe.ts [out-dir]
 *
 * This is the measurement behind the "auto-fit actually shrinks" claim: the
 * generated set never needs it, so the numbers that prove the fit works across
 * the length range come from here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOracleText } from '@mtg/dsl';
import { formatFitReport, renderSet } from '../src/index';
import { stressCards } from '../test/fixtures/cards';

const outDir = process.argv[2];
const cards = stressCards();
const result = renderSet(cards);

for (const card of cards) {
  process.stdout.write(`${card.id}: oracle ${renderOracleText(card).length} chars\n`);
}
process.stdout.write(`${formatFitReport(result.report)}\n`);
for (const render of result.renders) {
  const sizes = render.fits
    .map((fit) => `${fit.region}=${fit.fontSize}${fit.lines > 1 ? `x${fit.lines}` : ''}`)
    .join(' ');
  process.stdout.write(`${render.cardId}: ${sizes}\n`);
}
if (outDir !== undefined) {
  mkdirSync(outDir, { recursive: true });
  for (const render of result.renders) {
    writeFileSync(join(outDir, `${render.cardId}.svg`), render.svg, 'utf8');
  }
  process.stdout.write(`wrote ${result.renders.length} files to ${outDir}\n`);
}
process.exitCode = result.report.ok ? 0 : 1;
