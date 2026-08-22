/**
 * `tsx packages/draft-export/src/cli.ts <out-file> [cards.json]`
 *
 * Writes the Draftmancer custom-set file for a card list, or for the DSL's own
 * fixture set when no file is given — which is what a local smoke check wants.
 *
 * The collation report is printed rather than swallowed, and a set that cannot
 * fill a pack exits non-zero: the file would still be written and would still
 * look right, and Draftmancer would be the one to discover it could not build a
 * booster. An unreachable sheet stays a warning rather than a failure, but this
 * command no longer produces one on its own: the pack is `boosterRecipeFor` of
 * the cards it was handed, so every rarity the set prints has a slot. Only a
 * library caller stating its own recipe can strand a sheet now.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_SET, parseCardsDocumentJson } from '@mtg/dsl';
import { formatCollationReport } from './collation';
import { exportDraftmancerSet } from './emit';

/**
 * Either spelling of a card list on disk: a bare JSON array, or the set
 * document `@mtg/setgen` writes. This command read only the first and exited 1
 * on every `set.json` the rest of the workspace opens without comment.
 */
function loadCards(path: string | undefined): readonly Card[] {
  if (path === undefined) return EXAMPLE_SET;
  return parseCardsDocumentJson(readFileSync(path, 'utf8'));
}

export function main(argv: readonly string[]): number {
  const [outFile, cardsFile] = argv;
  if (outFile === undefined) {
    console.error('usage: cli.ts <out-file> [cards.json]');
    return 2;
  }

  const result = exportDraftmancerSet(loadCards(cardsFile));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, result.text, 'utf8');
  console.log(outFile);
  for (const line of formatCollationReport(result.report)) console.error(line);

  return result.report.shortSlots.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
const invokedDirectly = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
