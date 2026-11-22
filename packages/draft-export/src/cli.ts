/**
 * `tsx packages/draft-export/src/cli.ts <out-file> [cards.json]`
 *
 * Writes the Draftmancer custom-set file for a card list, or for the DSL's own
 * fixture set when no file is given — which is what a local smoke check wants.
 *
 * A set document carrying `reduction.collation` is cut from those sheets rather
 * than from DSL rarities (`mtg-rbw6`), because they are the packs the lab deals
 * from the same file. The command says which of the two it used, and says on
 * stdout anything the printing's sheets are not known to reproduce; a block that
 * is present and cannot be dealt is a failure rather than a quiet fall-through
 * to the rarity recipe, which is the whole defect this replaced.
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
import type { BasicLandRemoval, PackCollation } from '@mtg/deckbuild';
import { readStagedCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_SET, parseCardsDocumentJson } from '@mtg/dsl';
import { formatCollationReport } from './collation';
import { exportDraftmancerSet } from './emit';

/**
 * Either spelling of a card list on disk: a bare JSON array, or the set
 * document `@mtg/setgen` writes. This command read only the first and exited 1
 * on every `set.json` the rest of the workspace opens without comment.
 */
interface LoadedSet {
  readonly cards: readonly Card[];
  /** The printing's sheets, absent, or present and undealable. */
  readonly collation: PackCollation | null;
  readonly refusal: string | null;
  /**
   * What the read changed about the packs, said rather than done quietly.
   *
   * Today that is the basic lands `readStagedCollation` takes out (`mtg-5of3`),
   * which moves M11's pack from fifteen cards to fourteen. The file this writes
   * is the pack Draftmancer will deal, and a document beside it saying fifteen
   * is the disagreement worth one line of stdout.
   */
  readonly notes: readonly string[];
}

/** One line per way the dealt pack differs from the collated one, or none. */
function basicLandLines(removal: BasicLandRemoval): readonly string[] {
  if (removal.droppedSheets.length === 0 && removal.thinnedSheets.length === 0) return [];
  const printed = removal.printedPackSizes.join(' or ');
  const dealt = removal.dealtPackSizes.join(' or ');
  return [
    `basic lands are not dealt: dropped ${removal.droppedSheets.join(', ') || 'no sheet'}, ` +
      `thinned ${removal.thinnedSheets.join(', ') || 'no sheet'}` +
      (printed === dealt ? '' : `, so a pack is ${dealt} cards where the printing collates ${printed}`),
  ];
}

function loadSet(path: string | undefined): LoadedSet {
  if (path === undefined) return { cards: EXAMPLE_SET, collation: null, refusal: null, notes: [] };
  const text = readFileSync(path, 'utf8');
  const cards = parseCardsDocumentJson(text);
  const read = readStagedCollation(JSON.parse(text), cards);
  if (read.kind === 'ready') {
    return { cards, collation: read.collation, refusal: null, notes: basicLandLines(read.basicLands) };
  }
  return {
    cards,
    collation: null,
    refusal: read.kind === 'unusable' ? read.message : null,
    notes: [],
  };
}

export function main(argv: readonly string[]): number {
  const [outFile, cardsFile] = argv;
  if (outFile === undefined) {
    console.error('usage: cli.ts <out-file> [cards.json]');
    return 2;
  }

  const set = loadSet(cardsFile);
  if (set.refusal !== null) {
    console.error(`this set carries a collation that cannot be dealt: ${set.refusal}`);
    return 1;
  }

  const result = exportDraftmancerSet(set.cards, set.collation === null ? {} : { collation: set.collation });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, result.text, 'utf8');
  console.log(outFile);
  console.log(
    result.printing === null
      ? 'cut from the set rarities, which is what a generated set offers'
      : `cut from the printing's own collation: ${String(result.printing.length)} sheets`,
  );
  for (const line of set.notes) console.log(line);
  for (const line of result.notes) console.error(line);
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
