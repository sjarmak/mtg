import type { PrintedCardCatalogEntry } from './artifact';
import type { PrintedConstructedDeck } from './constructed-format';

type StandardDeckCatalogEntry = Pick<
  PrintedCardCatalogEntry,
  'physicalId' | 'correctedName' | 'typeLine' | 'oracleText'
>;

export type StandardDeckFindingKind = 'deck-size' | 'duplicate' | 'unresolved';

export interface StandardDeckFinding {
  readonly kind: StandardDeckFindingKind;
  readonly detail: string;
}

export interface StandardDeckVerdict {
  readonly legal: boolean;
  readonly cards: number;
  readonly findings: readonly StandardDeckFinding[];
}

export const STANDARD_DECK_SIZE = 60;
export const STANDARD_COPY_LIMIT = 4;

function isBasic(entry: StandardDeckCatalogEntry): boolean {
  return /\bBasic\b/u.test(entry.typeLine);
}

function anyNumber(entry: StandardDeckCatalogEntry): boolean {
  return (entry.oracleText ?? '').includes('any number of cards named');
}

export function checkStandardDeck(
  deck: PrintedConstructedDeck,
  printings: ReadonlyMap<string, StandardDeckCatalogEntry>,
): StandardDeckVerdict {
  const findings: StandardDeckFinding[] = [];
  const seen = new Map<string, number>();
  const cards = deck.cards.reduce((sum, slot) => sum + slot.count, 0);
  for (const slot of deck.cards) {
    const entry = printings.get(slot.physicalId);
    if (entry === undefined) {
      findings.push({ kind: 'unresolved', detail: `${slot.name} is not a printing this catalog carries` });
      continue;
    }
    const copies = (seen.get(entry.correctedName) ?? 0) + slot.count;
    seen.set(entry.correctedName, copies);
    if (copies > STANDARD_COPY_LIMIT && !isBasic(entry) && !anyNumber(entry)) {
      findings.push({
        kind: 'duplicate',
        detail: `${entry.correctedName} appears ${String(copies)} times`,
      });
    }
  }
  if (cards < STANDARD_DECK_SIZE) {
    findings.push({
      kind: 'deck-size',
      detail: `${String(cards)} cards; a constructed deck has at least ${String(STANDARD_DECK_SIZE)}`,
    });
  }
  return { legal: findings.length === 0, cards, findings };
}
