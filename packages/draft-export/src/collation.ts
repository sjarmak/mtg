/**
 * Sheets and pack layouts: how a set becomes boosters.
 *
 * Draftmancer's format (tooling §1.1) puts each pool of cards in a named sheet
 * section and describes a pack in `[Settings].layouts` as a weighted set of
 * per-slot sheet counts. Our sheets are the rarities, one per rarity the set
 * actually prints, and the layout is whatever `BoosterRecipe` the caller
 * drafts with — `boosterRecipeFor(cards)` by default, the same recipe
 * `openSealedPool` opens the same set's packs from, so a drafted pack and a
 * sealed pack hold the same mix.
 *
 * Basic lands sit in the Common sheet, because that is their DSL rarity and
 * `openSealedPool` already puts them in the common slot. They rate 0 (the deck
 * builder scores every land 0), so bots take them last. A dedicated land slot
 * is a change to the recipe, not to this file.
 *
 * Two ways a legal-looking file fails to draft, both invisible in the text:
 * a sheet no layout draws from, and a slot asking for more distinct cards than
 * its sheet holds. `collationReport` names both.
 */
import { boosterSlotRarityWeights, type BoosterRecipe } from '@mtg/deckbuild';
import type { Card, Rarity } from '@mtg/dsl';
import { RARITIES } from '@mtg/dsl';

export interface DraftmancerSheet {
  readonly name: string;
  readonly rarity: Rarity;
  readonly cards: readonly Card[];
}

export interface DraftmancerLayout {
  readonly weight: number;
  /** Sheet name -> cards drawn from it per pack. */
  readonly slots: Readonly<Record<string, number>>;
}

export type DraftmancerLayouts = Readonly<Record<string, DraftmancerLayout>>;

/**
 * The layout name for a fixed recipe. A source-weighted rarity slot expands to
 * one named layout per alternative sheet instead.
 */
export const DEFAULT_LAYOUT_NAME = 'Default';

/** Sheet name for a rarity: `common` -> `Common`. */
export function sheetName(rarity: Rarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

/**
 * Partitions a set into one sheet per rarity, each in collector-number order.
 * A rarity the set does not print gets no sheet at all rather than an empty one.
 */
export function buildSheets(cards: readonly Card[]): readonly DraftmancerSheet[] {
  return RARITIES.map((rarity) => ({
    name: sheetName(rarity),
    rarity,
    cards: cards
      .filter((card) => card.rarity === rarity)
      .sort((a, b) => a.set.collectorNumber - b.set.collectorNumber),
  })).filter((sheet) => sheet.cards.length > 0);
}

/**
 * Turns a booster recipe into Draftmancer layouts. Fixed slots stay together;
 * a source-weighted rarity slot expands into weighted alternative layouts.
 */
export function buildLayouts(
  recipe: BoosterRecipe,
  sheets: readonly DraftmancerSheet[] = [],
): DraftmancerLayouts {
  interface PendingLayout {
    readonly names: readonly string[];
    readonly weight: number;
    readonly slots: Readonly<Record<string, number>>;
  }

  const sheetSizes = new Map(sheets.map((sheet) => [sheet.rarity, sheet.cards.length]));
  let pending: readonly PendingLayout[] = [{ names: [], weight: 1, slots: {} }];
  for (const slot of recipe) {
    const weights = boosterSlotRarityWeights(slot);
    if (weights.length === 1) {
      const name = sheetName(slot.rarity);
      pending = pending.map((layout) => ({
        ...layout,
        slots: { ...layout.slots, [name]: (layout.slots[name] ?? 0) + slot.count },
      }));
      continue;
    }
    if (sheets.length === 0) {
      throw new Error('weighted booster layouts need the set sheets to calculate source weights');
    }
    pending = pending.flatMap((layout) =>
      weights.map((entry) => {
        const name = sheetName(entry.rarity);
        const weight = layout.weight * entry.weight * (sheetSizes.get(entry.rarity) ?? 0);
        if (!Number.isSafeInteger(weight) || weight <= 0) {
          throw new Error(`weighted booster layout ${name} has no safe positive source weight`);
        }
        return {
          names: [...layout.names, name],
          weight,
          slots: { ...layout.slots, [name]: (layout.slots[name] ?? 0) + slot.count },
        };
      }),
    );
  }
  return Object.fromEntries(
    pending.map((layout) => [
      layout.names.length === 0 ? DEFAULT_LAYOUT_NAME : layout.names.join('+'),
      { weight: layout.weight, slots: layout.slots },
    ]),
  );
}

/** A slot that asks for more distinct cards than its sheet can supply. */
export interface ShortSlot {
  readonly sheet: string;
  readonly need: number;
  readonly have: number;
}

export interface CollationReport {
  /** Sheets no layout draws from: their cards can never be picked. */
  readonly unreachableSheets: readonly string[];
  /** Slots whose sheet is too thin to fill them; a pack cannot be built. */
  readonly shortSlots: readonly ShortSlot[];
}

function slotCounts(layouts: DraftmancerLayouts): ReadonlyMap<string, number> {
  const highest = new Map<string, number>();
  for (const layout of Object.values(layouts)) {
    for (const [sheet, count] of Object.entries(layout.slots)) {
      highest.set(sheet, Math.max(highest.get(sheet) ?? 0, count));
    }
  }
  return highest;
}

/** Everything about a set-and-recipe pairing that would draft badly or not at all. */
export function collationReport(
  sheets: readonly DraftmancerSheet[],
  layouts: DraftmancerLayouts,
): CollationReport {
  const needed = slotCounts(layouts);
  const available = new Map(sheets.map((sheet) => [sheet.name, sheet.cards.length]));
  return {
    unreachableSheets: sheets.filter((sheet) => !needed.has(sheet.name)).map((sheet) => sheet.name),
    shortSlots: [...needed.entries()]
      .filter(([sheet, need]) => (available.get(sheet) ?? 0) < need)
      .map(([sheet, need]) => ({ sheet, need, have: available.get(sheet) ?? 0 })),
  };
}

/** Human-readable report lines; empty when the pairing drafts as written. */
export function formatCollationReport(report: CollationReport): readonly string[] {
  return [
    ...report.unreachableSheets.map(
      (sheet) => `sheet ${sheet} is in no pack slot: its cards can never be picked`,
    ),
    ...report.shortSlots.map(
      (slot) =>
        `slot ${slot.sheet} needs ${String(slot.need)} cards per pack but its sheet holds ${String(slot.have)}`,
    ),
  ];
}
