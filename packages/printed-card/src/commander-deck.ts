/**
 * Whether a deck is a Commander deck, read off the catalog entries it names.
 *
 * A precon list is data from disk and a pasted list will be data from a text
 * box, so the check lives here beside the format schema rather than on the
 * page that draws either: one commander (two with partner), a hundred cards,
 * one of each except basics, every card inside the commander's color
 * identity. It reads the printed catalog and nothing else; the schema has
 * already said each slot is a printing the catalog carries.
 */
import type { PrintedCardCatalogEntry } from './artifact';
import type { PrintedConstructedDeck } from './constructed-format';

export type CommanderDeckFindingKind =
  'commander-count' | 'commander-ineligible' | 'deck-size' | 'duplicate' | 'off-color' | 'unresolved';

export interface CommanderDeckFinding {
  readonly kind: CommanderDeckFindingKind;
  readonly detail: string;
}

export interface CommanderDeckVerdict {
  readonly legal: boolean;
  /** The colors the commanders span, as `W U B R G` letters in that order. */
  readonly colorIdentity: readonly string[];
  readonly cards: number;
  readonly findings: readonly CommanderDeckFinding[];
}

export const COMMANDER_DECK_SIZE = 100;

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

function isBasic(entry: PrintedCardCatalogEntry): boolean {
  return /\bBasic\b/u.test(entry.typeLine);
}

/** Relentless Rats and its kin: the card itself lifts the singleton rule. */
function anyNumber(entry: PrintedCardCatalogEntry): boolean {
  return (entry.oracleText ?? '').includes('any number of cards named');
}

function canCommand(entry: PrintedCardCatalogEntry): boolean {
  const front = entry.faces[0] ?? entry;
  const text = front.oracleText ?? '';
  if (text.includes('can be your commander')) return true;
  return /\bLegendary\b/u.test(front.typeLine) && /\bCreature\b/u.test(front.typeLine);
}

function hasPartner(entry: PrintedCardCatalogEntry): boolean {
  const text = (entry.faces[0] ?? entry).oracleText ?? '';
  return /(^|\n)Partner\b/u.test(text) || text.includes('Partner with');
}

export function checkCommanderDeck(
  deck: PrintedConstructedDeck,
  printings: ReadonlyMap<string, PrintedCardCatalogEntry>,
): CommanderDeckVerdict {
  const findings: CommanderDeckFinding[] = [];
  const resolve = (slot: { physicalId: string; name: string }) => {
    const entry = printings.get(slot.physicalId);
    if (entry === undefined) {
      findings.push({ kind: 'unresolved', detail: `${slot.name} is not a printing this catalog carries` });
    }
    return entry;
  };
  const commanders = deck.commanders.map(resolve).filter((entry) => entry !== undefined);
  if (commanders.length === 0) {
    findings.push({ kind: 'commander-count', detail: 'no commander' });
  } else if (commanders.length === 2) {
    if (!commanders.every(hasPartner)) {
      findings.push({
        kind: 'commander-count',
        detail: `two commanders, and not both have partner: ${commanders.map((c) => c.correctedName).join(', ')}`,
      });
    }
  } else if (commanders.length > 2) {
    findings.push({ kind: 'commander-count', detail: `${String(commanders.length)} commanders` });
  }
  for (const commander of commanders) {
    if (!canCommand(commander)) {
      findings.push({
        kind: 'commander-ineligible',
        detail: `${commander.correctedName} is not a legendary creature and does not say it can be your commander`,
      });
    }
  }
  const identity = new Set(commanders.flatMap((commander) => commander.colorIdentity));
  const colorIdentity = COLOR_ORDER.filter((color) => identity.has(color));

  const seen = new Map<string, number>();
  let cards = deck.commanders.reduce((sum, slot) => sum + slot.count, 0);
  for (const slot of deck.cards) {
    cards += slot.count;
    const entry = resolve(slot);
    if (entry === undefined) continue;
    const name = entry.correctedName;
    const copies = (seen.get(name) ?? 0) + slot.count;
    seen.set(name, copies);
    if (copies > 1 && !isBasic(entry) && !anyNumber(entry)) {
      findings.push({ kind: 'duplicate', detail: `${name} appears ${String(copies)} times` });
    }
    const outside = entry.colorIdentity.filter((color) => !identity.has(color));
    if (outside.length > 0 && commanders.length > 0) {
      findings.push({
        kind: 'off-color',
        detail: `${name} has identity {${entry.colorIdentity.join('')}}, outside the commander's {${colorIdentity.join('')}}`,
      });
    }
  }
  for (const commander of commanders) {
    if (seen.has(commander.correctedName)) {
      findings.push({
        kind: 'duplicate',
        detail: `${commander.correctedName} is the commander and also in the deck`,
      });
    }
  }
  if (cards !== COMMANDER_DECK_SIZE) {
    findings.push({
      kind: 'deck-size',
      detail: `${String(cards)} cards including the commander; a Commander deck is ${String(COMMANDER_DECK_SIZE)}`,
    });
  }
  return { legal: findings.length === 0, colorIdentity, cards, findings };
}
