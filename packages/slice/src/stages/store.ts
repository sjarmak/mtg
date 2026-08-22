/**
 * Optional persistence: the generated set into the lab's card store.
 *
 * The data lane's ruling is that generated cards live in the *same*
 * `oracle_card`/`printing` shape as real ones under `source = 'lab'`
 * (`prior-art-data-sources.md` §8), so the deck lab and the renderer stay
 * indifferent to card origin. `@mtg/data` deliberately does not know the DSL,
 * so the projection lives here.
 *
 * Off unless `--store` names a database. It is a side effect of the loop, not a
 * step of it: nothing downstream reads back from the store.
 */
import type { Card } from '@mtg/dsl';
import {
  KEYWORD_PRINT_NAMES,
  cardManaValue,
  formatManaCost,
  isCreature,
  renderOracleText,
  renderTypeLine,
} from '@mtg/dsl';
import type { LabCardInput } from '@mtg/data';
import { closeStore, openStore, upsertLabCard } from '@mtg/data';
import { failStage } from '../errors';

export interface StoreStageResult {
  readonly path: string;
  readonly cardsWritten: number;
}

/** Projects a DSL card onto the store's card shape. */
export function toLabCard(card: Card): LabCardInput {
  const printing = {
    printingId: `${card.set.code}-${card.set.collectorNumber}`,
    setCode: card.set.code,
    collectorNumber: String(card.set.collectorNumber),
    rarity: card.rarity,
  };
  return {
    oracleId: card.id,
    name: card.name,
    manaCost: card.kind === 'land' ? null : formatManaCost(card.manaCost),
    manaValue: cardManaValue(card),
    typeLine: renderTypeLine(card),
    oracleText: renderOracleText(card),
    power: isCreature(card) ? String(card.power) : null,
    toughness: isCreature(card) ? String(card.toughness) : null,
    colors: [...card.colors],
    colorIdentity: [
      ...(card.kind === 'land' ? card.producesMana.filter((mana) => mana !== 'C') : card.colors),
    ],
    keywords: card.keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]),
    printing,
  };
}

export function runStoreStage(cards: readonly Card[], path: string): StoreStageResult {
  const store = openStore(path);
  try {
    for (const card of cards) upsertLabCard(store, toLabCard(card));
  } catch (error: unknown) {
    failStage('setgen', `writing the generated set into ${path} failed`, error);
  } finally {
    closeStore(store);
  }
  return { path, cardsWritten: cards.length };
}
