/**
 * Saying out loud on stdout that the set about to open is a reduced one, and
 * which cards are not in it.
 *
 * A reduced set that looks like the printing is a trap. An M11 that kept 123 of the
 * printing's 249 collector positions (the count once was; a complete build now drops
 * none and is not called reduced at all), the missing half is not a random half — most of the
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
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { readReduction } from '../src/lab/reduced-notice';
import type { ReductionDrop, SetReduction } from '../src/lab/reduced-notice';
import { readStagedCollation } from '../src/lab/staged-collation';
import type { StagedCollation } from '../src/lab/staged-collation';
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

/**
 * The packs this set will actually deal, read through the reader that deals them.
 *
 * Since `mtg-5of3` the printing's pack and the lab's pack are two different
 * packs: the document records the 2010 booster, `@mtg/deckbuild`'s
 * `withoutBasicLands` takes the basic lands out at the dealing seam, and M11,
 * M13 and RTR each collate fifteen and deal fourteen. So a launcher that wants
 * to say what a pack holds has to ask the same reader the page asks
 * (`readStagedCollation`) rather than derive a second pack size of its own.
 *
 * `none` covers every ordinary generated set and every text this cannot read at
 * all, which is the state `readSetReduction` is already silent in.
 */
export function readDealtCollation(set: ResolvedSet): StagedCollation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(set.json);
  } catch {
    return { kind: 'none' };
  }
  const raw = typeof parsed === 'object' && parsed !== null ? (parsed as { cards?: unknown }).cards : null;
  if (!Array.isArray(raw)) return { kind: 'none' };
  let cards: readonly Card[];
  try {
    cards = raw.map((card) => parseCard(card));
  } catch {
    // `resolveSet` already refused a set holding a card the DSL rejects, so this
    // is unreachable from the launcher and is here for the callers that build a
    // document by hand. A collation cannot be checked against a card list that
    // does not parse, and the sentence below is the one thing that goes quiet.
    return { kind: 'none' };
  }
  return readStagedCollation(parsed, cards);
}

/** How many refused positions the launcher names one at a time before summarizing. */
export const REDUCTION_DROPS_SHOWN = 10;

function tally(rows: readonly (readonly [string, number])[]): string {
  return rows.length === 0 ? 'none' : rows.map(([label, count]) => `${label} ${String(count)}`).join(', ');
}

/** "14", "14 or 15" — the sizes as the sentence wants to read them. */
function sizes(counts: readonly number[]): string {
  return counts.map(String).join(' or ');
}

/**
 * What this printing's packs are, and what the lab deals off them.
 *
 * The size is read off the booster configurations rather than written in: this
 * line said "a 15-card pack still fills" for every reduced printing, and fifteen
 * is M11's number, not a fact about reductions. A document whose collation names
 * no configuration is the one written before the configurations were carried, and
 * it says so — the lab deals its own rarity-derived packs from a set like that,
 * and a person told a pack size that nothing collated would be told a fiction.
 *
 * **The second clause was the same fiction one size down** (`mtg-1wk9`). Since
 * `mtg-5of3` the lab deals these sheets without their basic lands, so M11, M13
 * and RTR each collate fifteen and deal fourteen, and "the lab deals them from
 * these sheets" was false by one card. Both numbers are printed when they
 * differ, and the dealt one comes from `readStagedCollation` — the reader that
 * deals it — rather than from a second subtraction here.
 *
 * This is now the only place either number is said. The page said it too, above
 * the packs, until `mtg-rgc.20` took the whole disclosure off the play and draft
 * screens; stdout keeps it because stdout is not the screen anybody plays on.
 */
function packSentence(reduction: SetReduction, dealt: StagedCollation): string {
  if (!reduction.fillsAPack) return 'No pack configuration fills.';
  if (reduction.packSizes.length === 0) {
    return 'A pack still fills, but this document carries no booster configuration, so the lab deals its own.';
  }
  const printed = `${sizes(reduction.packSizes)}-card packs still fill`;
  // A block the dealing reader refuses is a block the lab will not deal from at
  // all, and the route says so above the pool it dealt instead. Stdout gets the
  // same sentence rather than the claim it used to make either way.
  if (dealt.kind === 'unusable') return `${printed}, but the lab cannot deal them: ${dealt.message}`;
  const dealtSizes = dealt.kind === 'ready' ? sizes(dealt.basicLands.dealtPackSizes) : '';
  if (dealtSizes === '' || dealtSizes === sizes(reduction.packSizes)) {
    return `${printed}, and the lab deals them from these sheets.`;
  }
  return (
    `${printed}, and the lab deals them from these sheets at ` + `${dealtSizes}, without the basic lands.`
  );
}

/**
 * The reduction, as the sentences a person needs before they deal a pool.
 *
 * The full refused list is in the staged document and the first few are printed
 * here: a hundred-plus lines of stdout is a list nobody reads, and a count with
 * no examples is a claim nobody can check.
 */
export function describeReduction(reduction: SetReduction | null, dealt: StagedCollation): string {
  if (reduction === null) return '';
  const sheetDepth = `  Sheet depth: ${reduction.sheets
    .map(([name, cards, sourceCards]) => `${name} ${String(cards)}/${String(sourceCards)}`)
    .join(', ')}. ${packSentence(reduction, dealt)}`;
  // A build that refused nothing is the whole printing (`mtg-uzacz`): the packs
  // are still worth saying, the refusal tallies would be a column of zeros.
  if (reduction.dropped === 0) {
    return [
      `This is a complete build of ${reduction.sourceName}: all ${String(reduction.sourcePositions)} collector positions are in this file.`,
      sheetDepth,
    ].join('\n');
  }
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
    sheetDepth,
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

/**
 * The whole block for a resolved set, or nothing at all.
 *
 * One entry point so the launcher makes one decision. The two reads underneath
 * answer different questions — what is missing from this set, and what its packs
 * hold — and only the first of them decides whether there is anything to say, so
 * an ordinary generated set costs the parse it always cost and no more.
 */
export function describeSetReduction(set: ResolvedSet): string {
  const reduction = readSetReduction(set);
  if (reduction === null) return '';
  return describeReduction(reduction, readDealtCollation(set));
}
