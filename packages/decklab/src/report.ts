/**
 * The deck as something a human can argue with.
 *
 * The acceptance criterion for this feature is that every inclusion traces to a
 * criterion the user actually stated, so the report is not decoration — it is
 * where that property becomes visible. Each card prints the ids it cited, the
 * arithmetic prints its own inputs, and anything unmet prints as a shortfall
 * rather than being rounded away.
 */
import { assertNever, BASIC_LAND_FOR_COLOR, COLORS } from '@mtg/dsl';
import { CURVE_BUCKETS, curveBucketLabel } from '@mtg/deckbuild';
import type { AssembledDeck } from './assemble';
import type { DeckCriteria } from './criteria';
import { enumerateCriteria } from './criteria';
import type { LandPlan } from './land-plan';
import { describeLandCount } from './land-plan';
import type { SelectionStop } from './select';
import type { Rejection } from './verify';
import { deckPrice } from './verify';

export interface DeckReportInput {
  readonly criteria: DeckCriteria;
  readonly deck: AssembledDeck;
  /** The land count and its provenance, printed above the mana base. */
  readonly landPlan: LandPlan;
  readonly plan: string;
  readonly rejections: readonly Rejection[];
  /** Spells the selection loop never filled; 0 when it met the spell target. */
  readonly shortBy: number;
  /** Which bound ended card selection; the shortfall line names that one. */
  readonly stop: SelectionStop;
  readonly universeSize: number;
}

export function formatConstructedDeckReport(input: DeckReportInput): string {
  const { criteria, deck } = input;
  const lines: string[] = [];

  lines.push(`# Deck: ${criteria.prompt}`, '');
  lines.push(
    `Format ${criteria.format} · ${deck.totalCards} cards · $${deckPrice([...deck.spells, ...deck.lands]).toFixed(2)}`,
  );
  lines.push(`Chosen from ${input.universeSize} cards the criteria allow.`, '');

  if (input.plan !== '') lines.push('## Plan', '', input.plan, '');

  lines.push('## Criteria', '');
  for (const criterion of enumerateCriteria(criteria)) {
    lines.push(`- \`${criterion.id}\` (${criterion.kind}) — ${criterion.statement}`);
  }
  lines.push('');

  lines.push('## Spells', '');
  for (const entry of [...deck.spells].sort(byCurveThenName)) {
    const cost = entry.card.manaCost ?? '—';
    const price = entry.card.priceUsd === null ? 'unpriced' : `$${entry.card.priceUsd.toFixed(2)}`;
    lines.push(`- **${entry.count}x ${entry.card.name}** ${cost} · ${price}`);
    lines.push(`  - cites: ${entry.criteria.map((id) => `\`${id}\``).join(', ')}`);
    lines.push(`  - ${entry.reason}`);
  }
  lines.push('');

  // A nonbasic land is chosen the same way a spell is and carries the same
  // citations, so it prints them the same way. Printing the reason alone left
  // half the deck's choices looking untraced in the one place the clause is
  // supposed to be visible.
  if (deck.lands.length > 0) {
    lines.push('## Nonbasic lands', '');
    for (const entry of deck.lands) {
      lines.push(`- **${entry.count}x ${entry.card.name}**`);
      lines.push(`  - cites: ${entry.criteria.map((id) => `\`${id}\``).join(', ')}`);
      lines.push(`  - ${entry.reason}`);
    }
    lines.push('');
  }

  // Where the count came from is part of the deck's argument, not a footnote: a
  // count nobody can trace is how twenty-four lands ended up in a burn deck.
  lines.push('## Mana base', '', describeLandCount(input.landPlan), '');
  for (const color of COLORS) {
    const count = deck.manaBase.basics[color];
    if (count > 0) lines.push(`- ${count} ${BASIC_LAND_FOR_COLOR[color]}`);
  }
  lines.push('');
  // Sources are split by where they come from: "18 sources" reads the same for
  // eighteen Mountains and for ten plus eight duals, and those are very
  // different mana bases.
  // The percentage is the one that produced the "needs" beside it: the check
  // that set the color's floor, which for a double-pip card is that card and
  // not the color's cheapest one. Quoting the cheapest card's number here
  // would print a row that says "needs 16, castable 94%" of a color the
  // shortfalls below call short. Rounded down for the same reason.
  lines.push('| color | pips | weighted demand | basics | nonbasic | sources | needs | castable on curve |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const report of deck.manaBase.reports) {
    lines.push(
      `| ${report.color} | ${report.pipCount.toFixed(1)} | ${report.weightedDemand.toFixed(1)} | ${report.basicSources} | ${report.nonBasicSources} | ${report.sources} | ${report.sourceFloor} | ${Math.floor(report.castability * 100)}% |`,
    );
  }
  lines.push('');

  lines.push('## Curve', '');
  lines.push(
    CURVE_BUCKETS.map((bucket) => `${curveBucketLabel(bucket)}: ${deck.curve.histogram[bucket]}`).join(' · '),
  );
  lines.push(`Average mana value ${deck.curve.averageManaValue.toFixed(2)}.`, '');

  // The assembled deck reports its own size against the target; what it cannot
  // know is whether the model was still filling it. A build that ends short owes
  // the reader both halves: how many cards short, and what stood in the way.
  const unfilled = describeUnfilled(input.shortBy, input.stop, input.rejections);
  const shortfalls = unfilled === null ? deck.shortfalls : [...deck.shortfalls, unfilled];
  if (shortfalls.length > 0) {
    lines.push('## Shortfalls', '');
    for (const shortfall of shortfalls) lines.push(`- ${shortfall}`);
    lines.push('');
  }

  if (input.rejections.length > 0) {
    lines.push('## Rejected proposals', '');
    for (const rejection of input.rejections) {
      lines.push(`- \`${rejection.code}\` ${rejection.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The line that answers "short by how much, and because of what".
 *
 * The constraint comes from the selection loop rather than being inferred from
 * what happens to be lying around at the end. Inferring it gets both answers
 * wrong when the loop ran out of rounds: it blames whichever rejection rode
 * along on the final round, though a repeated typo can cost the deck nothing,
 * and with no rejections at all it asserts the model stopped proposing cards
 * when the model proposed a fresh one on every round including the last. Either
 * sends the reader hunting for a problem that is not there.
 */
function describeUnfilled(
  shortBy: number,
  stop: SelectionStop,
  rejections: readonly Rejection[],
): string | null {
  if (shortBy <= 0 || stop.kind === 'filled') return null;
  const short = `card selection ended ${shortBy} spell${shortBy === 1 ? '' : 's'} short of the target`;

  switch (stop.kind) {
    case 'stalled': {
      const codes = [...new Set(rejections.map((rejection) => rejection.code))];
      return codes.length > 0
        ? `${short}; the last round added no new spells and is still blocked by: ${codes.join(', ')}`
        : `${short}; the last round proposed nothing the deck did not already have`;
    }
    case 'idle': {
      // The same outstanding problems the stall names, because the reader needs
      // them either way; what differs is why the loop stopped where it did.
      const codes = [...new Set(rejections.map((rejection) => rejection.code))];
      const blocked = codes.length > 0 ? `; still blocked by: ${codes.join(', ')}` : '';
      return `${short}; a round added nothing and surfaced no problem the round before it did not already have, so the next round would have asked an identical question${blocked}`;
    }
    case 'spend':
      return `${short}; the build reached the $${stop.limit.toFixed(2)} it was allowed to spend on model calls, at $${stop.spentUsd.toFixed(2)}, so only a larger stated spend buys more rounds`;
    case 'budget':
      return stop.limit === 0
        ? `${short}; the stated round budget was 0, so no cards were ever asked for`
        : `${short}; the stated budget of ${stop.limit} round${stop.limit === 1 ? '' : 's'} ran out while rounds were still adding spells`;
    case 'ceiling':
      return `${short}; selection hit its own ${stop.limit}-round ceiling while rounds were still adding spells, so only a larger stated round budget buys more`;
    default:
      return assertNever(stop, 'describeUnfilled');
  }
}

function byCurveThenName(
  a: { readonly card: { readonly manaValue: number; readonly name: string } },
  b: { readonly card: { readonly manaValue: number; readonly name: string } },
): number {
  if (a.card.manaValue !== b.card.manaValue) return a.card.manaValue - b.card.manaValue;
  return a.card.name.localeCompare(b.card.name);
}
