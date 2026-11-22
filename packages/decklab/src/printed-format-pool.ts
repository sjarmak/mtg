import type { PrintedCardCatalog, PrintedCardCatalogEntry, PrintedConstructedDeck } from '@mtg/printed-card';
import { BASIC_LAND_FOR_COLOR, COLORS, type Color } from '@mtg/dsl';
import type { CandidateCard } from './candidates';
import { normalizeName } from './candidates';
import type { DeckCriteria } from './criteria';
import { parseManaCost } from './mana-cost';
import type { PrintedFormatPool } from './pool';
import type { Inclusion } from './verify';

export interface PrintedPoolCatalog {
  readonly code: string;
  readonly catalog: PrintedCardCatalog;
}

function candidateFromPrintedCard(card: PrintedCardCatalogEntry): CandidateCard {
  return {
    oracleId: card.oracleId,
    name: card.correctedName,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    power: card.power,
    toughness: card.toughness,
    colorIdentity: card.colorIdentity.join(''),
    keywords: [],
    priceUsd: null,
    parsedCost: parseManaCost(card.manaCost),
    producedMana: (card.producedMana ?? []).filter((mana): mana is Color => COLORS.includes(mana as Color)),
  };
}

function withinColors(card: PrintedCardCatalogEntry, colors: readonly Color[]): boolean {
  return card.colorIdentity.every((color) => colors.includes(color));
}

export function printedFormatDeckPool(
  formatId: string,
  catalogs: readonly PrintedPoolCatalog[],
  criteria: DeckCriteria,
): PrintedFormatPool {
  if (criteria.format !== undefined)
    throw new Error('a printed draft format pool does not use format legality');
  if (criteria.budget !== undefined) throw new Error('a printed draft format catalog carries no card prices');
  if (catalogs.length === 0) throw new Error(`printed format ${formatId} has no catalogs`);

  const sourceCodes = catalogs.map((entry) => entry.code);
  if (criteria.sets === undefined || criteria.sets.join('\0') !== sourceCodes.join('\0')) {
    throw new Error(`printed format ${formatId} criteria must name its catalogs: ${sourceCodes.join(', ')}`);
  }

  const cards: CandidateCard[] = [];
  const byName = new Map<string, CandidateCard>();
  const knownNames = new Set<string>();
  const printings = new Map<string, PrintedCardCatalogEntry>();
  const basics = new Map<string, PrintedCardCatalogEntry>();

  for (const { catalog } of catalogs) {
    for (const printing of catalog.cards) {
      const key = normalizeName(printing.correctedName);
      if (printing.typeLine.startsWith('Basic Land')) {
        if (!basics.has(key)) basics.set(key, printing);
        continue;
      }
      knownNames.add(key);
      if (byName.has(key)) continue;
      if (criteria.colors.length > 0 && !withinColors(printing, criteria.colors)) continue;
      if (criteria.maxManaValue !== undefined && printing.manaValue > criteria.maxManaValue) continue;
      const candidate = candidateFromPrintedCard(printing);
      cards.push(candidate);
      byName.set(key, candidate);
      printings.set(candidate.oracleId, printing);
    }
  }

  const filters = [`printed in ${formatId} (${sourceCodes.join(', ')})`];
  if (criteria.colors.length > 0) filters.push(`color identity within {${criteria.colors.join('')}}`);
  if (criteria.maxManaValue !== undefined) filters.push(`mana value <= ${criteria.maxManaValue}`);
  filters.push(`no card outside the ${formatId} printed format pool exists`);

  return {
    kind: 'printed-format',
    formatId,
    sourceCodes,
    universe: { cards, byName, filters },
    knownNames,
    printings,
    basics,
  };
}

export function toPrintedConstructedDeck(
  id: string,
  name: string,
  inclusions: readonly Inclusion[],
  basicCounts: Readonly<Record<Color, number>>,
  pool: PrintedFormatPool,
): PrintedConstructedDeck {
  const cards: PrintedConstructedDeck['cards'][number][] = inclusions.map((inclusion) => {
    const printing = pool.printings.get(inclusion.card.oracleId);
    if (printing === undefined) throw new Error(`no printing resolved for ${inclusion.card.name}`);
    return { physicalId: printing.physicalId, name: printing.correctedName, count: inclusion.count };
  });

  for (const color of COLORS) {
    const count = basicCounts[color];
    if (count === 0) continue;
    const basicName = BASIC_LAND_FOR_COLOR[color];
    const printing = pool.basics.get(normalizeName(basicName));
    if (printing === undefined) throw new Error(`printed format ${pool.formatId} has no ${basicName}`);
    cards.push({ physicalId: printing.physicalId, name: printing.correctedName, count });
  }

  return { id, name, commanders: [], cards };
}
