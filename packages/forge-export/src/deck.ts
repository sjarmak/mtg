/**
 * Forge deck files (`.dck`) and the coverage decks the boot gate plays.
 *
 * Format verified against `res/cube/*.dck`:
 *
 *   [metadata]
 *   Name=<deck name>
 *   [main]
 *   <count> <Card Name>|<SET>
 *
 * The gate's decks exist to make Forge *load every card in the set*: a card
 * whose script fails to parse never reaches a deck, so a deck that references
 * every card turns "does this script compile" into an observable outcome.
 */
import type { Card, Color, LandCard } from '@mtg/dsl';
import { BASIC_LAND_COLOR, isLand, sortColors } from '@mtg/dsl';
import { isStockCard } from './transpile';

export interface DeckEntry {
  readonly count: number;
  readonly cardName: string;
  /** Edition code; omitted lets Forge pick any printing. */
  readonly setCode?: string;
}

export interface ForgeDeck {
  readonly name: string;
  readonly entries: readonly DeckEntry[];
}

/** Renders a `.dck` file. */
export function renderDeck(deck: ForgeDeck): string {
  const lines = ['[metadata]', `Name=${deck.name}`, '[main]'];
  for (const entry of deck.entries) {
    const suffix = entry.setCode === undefined ? '' : `|${entry.setCode}`;
    lines.push(`${entry.count} ${entry.cardName}${suffix}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Total card count of a deck. */
export function deckSize(deck: ForgeDeck): number {
  return deck.entries.reduce((sum, entry) => sum + entry.count, 0);
}

const DECK_SIZE = 60;
const MAX_SPELLS_PER_DECK = 24;

/** File name Forge looks up under its decks directory. */
export function deckFileName(deck: ForgeDeck): string {
  return `${deck.name}.dck`;
}

/**
 * Splits a set into 60-card decks that between them play every nonland card.
 *
 * Each deck takes up to 24 distinct nonland cards (one copy each, so a single
 * mis-scripted card cannot hide behind its duplicates) and fills the rest with
 * basics in the colors those cards need.
 */
export function coverageDecks(cards: readonly Card[], namePrefix: string): ForgeDeck[] {
  const lands: readonly LandCard[] = cards.filter(isLand);
  const spells = cards.filter((card) => !isLand(card));
  if (spells.length === 0) return [];

  const chunks: Card[][] = [];
  for (let index = 0; index < spells.length; index += MAX_SPELLS_PER_DECK) {
    chunks.push(spells.slice(index, index + MAX_SPELLS_PER_DECK));
  }
  // A single-deck set still needs an opponent; play the chunk against itself.
  if (chunks.length === 1) chunks.push(chunks[0] ?? []);

  return chunks.map((chunk, index) => ({
    name: `${namePrefix}-${index + 1}`,
    entries: [...spellEntries(chunk), ...landEntries(chunk, lands, DECK_SIZE - chunk.length)],
  }));
}

function spellEntries(chunk: readonly Card[]): DeckEntry[] {
  return chunk.map((card) => ({ count: 1, cardName: card.name, setCode: card.set.code }));
}

/**
 * Basics for the colors the chunk actually uses, split as evenly as the
 * remaining slots allow. A colorless-only chunk still needs lands to reach a
 * legal deck size, so it gets Plains.
 *
 * A land Forge already ships (a basic named after its own type) is referenced
 * without a set code so any printing satisfies it; a custom-named land must
 * carry the set code because only our edition has it.
 */
function landEntries(chunk: readonly Card[], lands: readonly LandCard[], slots: number): DeckEntry[] {
  if (slots <= 0) return [];
  const used = sortColors([...new Set(chunk.flatMap((card) => card.colors))]);
  const colors: Color[] = used.length > 0 ? used : ['W'];

  const entries: DeckEntry[] = [];
  let remaining = slots;
  for (const [index, color] of colors.entries()) {
    const share = Math.floor(remaining / (colors.length - index));
    remaining -= share;
    if (share === 0) continue;
    const land = lands.find(
      (candidate) =>
        candidate.basicLandType !== undefined && BASIC_LAND_COLOR[candidate.basicLandType] === color,
    );
    if (land === undefined) {
      entries.push({ count: share, cardName: DEFAULT_BASIC_NAMES[color] });
    } else if (isStockCard(land)) {
      entries.push({ count: share, cardName: land.name });
    } else {
      entries.push({ count: share, cardName: land.name, setCode: land.set.code });
    }
  }
  return entries;
}

/** Forge's stock basics, used when the set ships no land of that color. */
const DEFAULT_BASIC_NAMES: Readonly<Record<Color, string>> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};
