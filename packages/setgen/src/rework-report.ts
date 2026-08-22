/**
 * `npx tsx packages/setgen/src/rework-report.ts <set.json> [rework.json]` —
 * prints the cards named in a rework file with enough of the card to read the
 * judgment without opening either file's JSON by hand.
 *
 * The rework file (`rework-preferences.ts`) is deliberately terse: a card id, a
 * verdict, a note. That is the right shape to write and to diff, and the wrong
 * shape to read cold — a card id names nothing on its own, and a note like "the
 * second ability text is confusing" is unreadable without the ability text
 * beside it. This resolves each `cardId` against the set file the same way
 * the art pipeline's curation tools resolve a digest against a staged index, and
 * prints the four things a redesign pass needs first: name, mana cost, type
 * line, oracle text, then the verdict and the note. Grouped by verdict because
 * `unworkable` and `watch` are different queues with different owners, and a
 * flat list keyed only by card id would make a reader sort them by hand every
 * time.
 *
 * `rework.json` defaults to `data/card-preferences/<set-code-from-file>.rework.json`
 * resolved from the set file's own basename, mirroring how `curate.ts` derives
 * its preferences path from the flagship name rather than asking for it twice.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatManaCost, renderOracleText, renderTypeLine } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { parseSetFile } from './emit';
import { readReworkFile, REWORK_VERDICTS } from './rework-preferences';
import type { ReworkFile, ReworkRequest, ReworkVerdict } from './rework-preferences';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');

function fail(message: string): never {
  process.stderr.write(`\nrework-report: ${message}\n\n`);
  process.exit(1);
}

interface ReportArgs {
  readonly setPath: string;
  readonly reworkPath: string;
}

/**
 * Default rework path for a set file, matching that set file's own basename.
 * Anchored on this module's own location (`REPO_ROOT`) rather than the set
 * file's directory, because a set file may be passed by a relative path or
 * live anywhere under `out/`, and only this module's own path is fixed.
 */
export function defaultReworkPath(setPath: string): string {
  const stem = basename(setPath).replace(/\.set\.json$/, '');
  return join(REPO_ROOT, 'data', 'card-preferences', `${stem}.rework.json`);
}

export function readReportArgs(argv: readonly string[]): ReportArgs {
  const [setPath, reworkPath] = argv;
  if (setPath === undefined) fail('usage: rework-report.ts <set.json> [rework.json]');
  return { setPath, reworkPath: reworkPath ?? defaultReworkPath(setPath) };
}

/**
 * One line per detail, in the order a redesign pass reads a card: name, cost,
 * type, text, and for a creature the body, which the type line does not carry.
 * Most of the judgments this file exists to record are about what a card costs
 * for what it does, and for a creature half of what it does is its power and
 * toughness, so leaving them off would hide the exact number being argued with.
 */
function describeCard(card: Card): string {
  const cost = card.kind === 'land' ? '' : ` ${formatManaCost(card.manaCost)}`;
  const body = card.kind === 'creature' ? ` ${String(card.power)}/${String(card.toughness)}` : '';
  const oracle = renderOracleText(card);
  const text = oracle.length > 0 ? `\n    ${oracle.replace(/\n/g, '\n    ')}` : '';
  return `${card.name}${cost} — ${renderTypeLine(card)}${body}${text}`;
}

function describeRequest(request: ReworkRequest, cardsById: ReadonlyMap<string, Card>): string {
  const card = cardsById.get(request.cardId);
  const body = card === undefined ? `(no card with id ${request.cardId} in this set)` : describeCard(card);
  return `  ${request.cardId}\n    ${body}\n    note: ${request.note}\n`;
}

/** The rework file's requests, printed as a work list grouped by verdict. */
export function formatReworkReport(file: ReworkFile, cardsById: ReadonlyMap<string, Card>): string {
  if (file.requests.length === 0) return 'No cards are flagged for rework in this file.\n';
  const lines: string[] = [];
  for (const verdict of REWORK_VERDICTS) {
    const group = file.requests.filter((request) => request.verdict === verdict);
    if (group.length === 0) continue;
    lines.push(`${headingFor(verdict)} (${String(group.length)})`);
    for (const request of group) lines.push(describeRequest(request, cardsById));
  }
  return lines.join('\n');
}

function headingFor(verdict: ReworkVerdict): string {
  switch (verdict) {
    case 'unworkable':
      return 'UNWORKABLE — cut or replace outright';
    case 'rework':
      return 'REWORK — salvageable, needs a real pass';
    case 'watch':
      return 'WATCH — nothing wrong yet, worth a second look';
  }
}

function main(): void {
  const args = readReportArgs(process.argv.slice(2));
  const set = parseSetFile(JSON.parse(readFileSync(args.setPath, 'utf8')));
  const rework = readReworkFile(args.reworkPath);
  const cardsById = new Map(set.cards.map((card) => [card.id, card]));
  process.stdout.write(formatReworkReport(rework, cardsById));
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('rework-report.ts');
if (invokedDirectly) {
  try {
    main();
  } catch (cause: unknown) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}
