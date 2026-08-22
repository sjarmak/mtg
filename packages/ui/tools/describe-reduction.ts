/**
 * Saying out loud on stdout that the set about to open is a reduced one, and
 * which cards are not in it.
 *
 * A reduced M11 that looks like an M11 is a trap. It prints 123 of the printing's
 * 249 collector positions, the missing half is not a random half — most of the
 * rare sheet is gone while most of the common sheet survived — and a person who
 * deals a pool and cannot find a card has no way to tell whether it was cut, was
 * refused by the translation gate, or never existed. `@mtg/data`'s
 * `reducedReferenceSetDocument` puts the whole record in the document for exactly
 * that reason; this is the launcher reading it back out.
 *
 * **The reader itself moved to `../src/lab/reduced-notice.ts`** (`mtg-h2rj`),
 * because the page needs the same block and stdout is invisible to anybody
 * handed the URL of a server somebody else started. What stayed here is the
 * launcher's own prose — the rarity tallies, the sheet depths and the first ten
 * refused positions by name — which is the half that only a terminal wants. The
 * parse is one implementation in one place: a second structural reader of the
 * same JSON is a second chance to disagree about what counts as malformed, and
 * both directions of that disagreement are silence.
 */
import { readReduction } from '../src/lab/reduced-notice';
import type { ReductionDrop, SetReduction } from '../src/lab/reduced-notice';
import type { ResolvedSet } from './resolve-set';

export type { ReductionDrop, SetReduction };

/**
 * The reduction record a resolved set carries, or `null` for any other set.
 *
 * The launcher holds the document as the text it read off disk rather than as a
 * parsed value, so the parse lives here; text that is not JSON at all is `null`,
 * which is the same silence an ordinary generated set gets.
 */
export function readSetReduction(set: ResolvedSet): SetReduction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(set.json);
  } catch {
    return null;
  }
  return readReduction(parsed);
}

/** How many refused positions the launcher names one at a time before summarizing. */
export const REDUCTION_DROPS_SHOWN = 10;

function tally(rows: readonly (readonly [string, number])[]): string {
  return rows.length === 0 ? 'none' : rows.map(([label, count]) => `${label} ${String(count)}`).join(', ');
}

/**
 * What this printing's packs are, in one clause.
 *
 * The size is read off the booster configurations rather than written in: this
 * line said "a 15-card pack still fills" for every reduced printing, and fifteen
 * is M11's number, not a fact about reductions. A document whose collation names
 * no configuration is the one written before the configurations were carried, and
 * it says so — the lab deals its own rarity-derived packs from a set like that,
 * and a person told a pack size that nothing collated would be told a fiction.
 */
function packSentence(reduction: SetReduction): string {
  if (!reduction.fillsAPack) return 'No pack configuration fills.';
  if (reduction.packSizes.length === 0) {
    return 'A pack still fills, but this document carries no booster configuration, so the lab deals its own.';
  }
  return `${reduction.packSizes.map(String).join(' or ')}-card packs still fill, and the lab deals them from these sheets.`;
}

/**
 * The reduction, as the sentences a person needs before they deal a pool.
 *
 * The full refused list is in the staged document and the first few are printed
 * here: a hundred-plus lines of stdout is a list nobody reads, and a count with
 * no examples is a claim nobody can check.
 */
export function describeReduction(reduction: SetReduction | null): string {
  if (reduction === null) return '';
  const byCode = new Map<string, number>();
  for (const drop of reduction.drops) byCode.set(drop.code, (byCode.get(drop.code) ?? 0) + 1);
  const shown = reduction.drops.slice(0, REDUCTION_DROPS_SHOWN);
  const rest = reduction.drops.length - shown.length;
  const lines = [
    `This is a REDUCED set: ${String(reduction.kept)} of ${reduction.sourceName}'s ` +
      `${String(reduction.sourcePositions)} collector positions. The other ${String(reduction.dropped)} were`,
    'refused by the translation gate and are not in this file, so a card you cannot find here was',
    'most likely refused rather than cut.',
    `  Kept by rarity:    ${tally(reduction.keptByRarity)}`,
    `  Refused by rarity: ${tally(reduction.droppedByRarity)}`,
    `  Sheet depth: ${reduction.sheets
      .map(([name, cards, sourceCards]) => `${name} ${String(cards)}/${String(sourceCards)}`)
      .join(', ')}. ${packSentence(reduction)}`,
    `  Refused by reason: ${tally([...byCode.entries()].sort((left, right) => right[1] - left[1]))}`,
  ];
  for (const drop of shown) {
    const colors = drop.colors.length === 0 ? 'colorless' : drop.colors.join('');
    lines.push(
      `    - #${String(drop.collectorNumber)} ${drop.name} (${drop.rarity}, ${colors}): ${drop.detail}`,
    );
  }
  if (rest > 0) lines.push(`    …and ${String(rest)} more.`);
  lines.push(
    `  All ${String(reduction.drops.length)} refused positions are in the staged document under ` +
      '`reduction.drops`,',
    '  each with its collector number, printed identity and the reason it was refused.',
  );
  return lines.join('\n');
}
