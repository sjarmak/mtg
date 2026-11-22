import { COLORS } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import type { PrintedCardCatalogEntry, PrintedConstructedDeck, PrintedRarity } from '@mtg/printed-card';
import { counted, deckCountsLine } from '../deck/DeckCard';

export interface PrintedPreconFacts {
  readonly colors: readonly Color[];
  readonly creatures: number;
  readonly spells: number;
  readonly lands: number;
  readonly rares: number | null;
}

interface CountedPrinting {
  readonly entry: PrintedCardCatalogEntry;
  readonly count: number;
}

const supertypes = (typeLine: string): readonly string[] => (typeLine.split('—')[0] ?? '').split(/\s+/);
const isLand = (slot: CountedPrinting): boolean => supertypes(slot.entry.typeLine).includes('Land');
const isCreature = (slot: CountedPrinting): boolean => supertypes(slot.entry.typeLine).includes('Creature');
const total = (slots: readonly CountedPrinting[]): number => slots.reduce((sum, slot) => sum + slot.count, 0);

export function printedPreconFacts(
  deck: PrintedConstructedDeck,
  printings: ReadonlyMap<string, PrintedCardCatalogEntry>,
  rarities: Readonly<Record<string, PrintedRarity>>,
): PrintedPreconFacts {
  const slots = deck.cards.map((slot): CountedPrinting => {
    const entry = printings.get(slot.physicalId);
    if (entry === undefined) throw new Error(`${deck.name} card ${slot.name} is missing from its catalog`);
    return { entry, count: slot.count };
  });
  const lands = slots.filter(isLand);
  const identity = new Set(slots.flatMap((slot) => slot.entry.colorIdentity));
  const rated = slots.map((slot) => ({ slot, rarity: rarities[slot.entry.physicalId] }));
  const rares = rated.every((card) => card.rarity !== undefined)
    ? total(
        rated.filter((card) => card.rarity === 'rare' || card.rarity === 'mythic').map((card) => card.slot),
      )
    : null;
  return {
    colors: COLORS.filter((color) => identity.has(color)),
    creatures: total(slots.filter(isCreature)),
    spells: total(slots) - total(lands),
    lands: total(lands),
    rares,
  };
}

export function printedCountsLine(facts: PrintedPreconFacts): string {
  return deckCountsLine([
    counted(facts.creatures, 'creature'),
    counted(facts.spells - facts.creatures, 'noncreature spell'),
    counted(facts.lands, 'land'),
    ...(facts.rares === null ? [] : [counted(facts.rares, 'rare')]),
  ]);
}
