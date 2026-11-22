/** Measures how much of the installed Forge library the reviewed syntax table closes, per edition. */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  FORGE_EDITIONS_PATH,
  FORGE_SCRIPT_ARCHIVE_PATH,
  readForgeEditionTexts,
  readForgeScriptArchive,
} from '../src/printed-card/forge-install';
import {
  FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH,
  buildForgeSyntaxClosureReport,
  forgeSyntaxClosureSnapshot,
  type ForgeSyntaxClosureReport,
} from '../src/printed-card/forge-syntax-closure';
import { loadForgeSyntaxReview } from '../src/printed-card/forge-syntax-review';

const { values } = parseArgs({
  options: {
    'forge-scripts': { type: 'string', default: FORGE_SCRIPT_ARCHIVE_PATH },
    editions: { type: 'string', default: FORGE_EDITIONS_PATH },
    edition: { type: 'string', multiple: true, default: [] },
    'missing-limit': { type: 'string', default: '10' },
    out: { type: 'string' },
    'write-snapshot': { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});

const missingLimit = Number.parseInt(values['missing-limit'], 10);
if (!Number.isInteger(missingLimit) || missingLimit < 1)
  throw new Error('--missing-limit must be a positive integer');
if (values.out !== undefined && existsSync(resolve(values.out))) {
  throw new Error(`Output already exists: ${resolve(values.out)}`);
}

function printReport(report: ForgeSyntaxClosureReport, codes: readonly string[]): void {
  const { library } = report;
  const pct = (closed: number, total: number): string =>
    `${((100 * closed) / Math.max(total, 1)).toFixed(1)}%`;
  process.stdout.write(
    `Forge ${report.forge.version}: ${library.closed}/${library.scripts} scripts closed (${pct(library.closed, library.scripts)}) over ${report.reviewedTokens} reviewed tokens; ${library.unreviewedTokens} unreviewed tokens, ${library.blockedByOne} scripts blocked by exactly one.\n`,
  );
  process.stdout.write('Top unreviewed tokens by library scripts blocked:\n');
  for (const entry of library.missing)
    process.stdout.write(`  ${String(entry.scripts).padStart(6)} ${entry.token}\n`);
  const selected =
    codes.length === 0 ? report.editions : report.editions.filter((edition) => codes.includes(edition.code));
  for (const code of codes) {
    if (!selected.some((edition) => edition.code === code))
      throw new Error(`Unknown Forge edition code: ${code}`);
  }
  process.stdout.write('\ncode        cards  scripted  closed    pct  top missing\n');
  for (const edition of selected) {
    process.stdout.write(
      `${edition.code.padEnd(10)} ${String(edition.cards).padStart(6)} ${String(edition.scripted).padStart(9)} ${String(edition.closed).padStart(7)} ${pct(edition.closed, edition.scripted).padStart(6)}  ${edition.missing
        .slice(0, 3)
        .map((entry) => `${entry.token}(${entry.cards})`)
        .join(' ')}\n`,
    );
  }
}

const report = buildForgeSyntaxClosureReport({
  review: loadForgeSyntaxReview(),
  scripts: readForgeScriptArchive(resolve(values['forge-scripts'])),
  editions: readForgeEditionTexts(resolve(values.editions)),
  missingLimit,
});
printReport(report, values.edition);
if (values.out !== undefined) {
  writeFileSync(resolve(values.out), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`\nFull report: ${resolve(values.out)}\n`);
}
if (values['write-snapshot']) {
  writeFileSync(
    FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH,
    `${JSON.stringify(forgeSyntaxClosureSnapshot(report), null, 2)}\n`,
  );
  process.stdout.write(`Snapshot written: ${FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH}\n`);
}
