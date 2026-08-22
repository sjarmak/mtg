/** Terminal rendering helpers for the data CLI. */
import type { CardRow, PrintingRow, RulingRow } from '../query/rows';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'GB'}`;
}

export function formatCardLine(card: CardRow): string {
  const cost = card.manaCost ?? '—';
  const body = card.oracleText === null ? '' : ` | ${card.oracleText.replace(/\n/g, ' / ')}`;
  const stats = card.power !== null && card.toughness !== null ? ` ${card.power}/${card.toughness}` : '';
  const tag = card.source === 'lab' ? ' [lab]' : '';
  return `${card.name}${tag}  ${cost}  ${card.typeLine}${stats}${body}`;
}

/**
 * One line of an ambiguity list: the oracle id first, because that is what the
 * reader must copy, then enough to tell same-named cards apart — 31 oracle cards
 * are named `Elemental` and only their stats differ.
 */
export function formatCardChoice(card: CardRow): string {
  const stats = card.power !== null && card.toughness !== null ? ` ${card.power}/${card.toughness}` : '';
  return `  ${card.oracleId}  ${card.name}  ${card.typeLine}${stats}`;
}

export function formatCardDetail(card: CardRow, printings: readonly PrintingRow[]): string {
  const lines = [
    `${card.name}   ${card.manaCost ?? '—'}   (mv ${card.manaValue})`,
    `${card.typeLine}`,
    card.oracleText ?? '(no rules text)',
  ];
  if (card.power !== null && card.toughness !== null) lines.push(`${card.power}/${card.toughness}`);
  if (card.loyalty !== null) lines.push(`loyalty ${card.loyalty}`);
  lines.push(
    `colors=${card.colors === '' ? 'C' : card.colors}  identity=${card.colorIdentity === '' ? 'C' : card.colorIdentity}  layout=${card.layout}`,
  );
  if (card.keywords.length > 0) lines.push(`keywords: ${card.keywords.join(', ')}`);
  lines.push(`oracle_id=${card.oracleId}  source=${card.source}  ingested=${card.ingestedAt}`);
  if (printings.length > 0) {
    lines.push(`printings (${printings.length}):`);
    for (const printing of printings.slice(0, 10)) {
      lines.push(
        `  ${printing.setCode} #${printing.collectorNumber} ${printing.rarity}` +
          `${printing.artist === null ? '' : ` — ${printing.artist}`}`,
      );
    }
    if (printings.length > 10) lines.push(`  … ${printings.length - 10} more`);
  }
  return lines.join('\n');
}

export function formatRuling(ruling: RulingRow): string {
  return `${ruling.publishedAt} (${ruling.rulingSource}) ${ruling.comment}`;
}
