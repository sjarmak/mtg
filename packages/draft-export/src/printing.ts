/**
 * A printing's own collation, compiled into Draftmancer's sheets and layouts.
 *
 * `mtg-rbw6`. `buildSheets` partitions a set by DSL rarity, which is the only
 * thing a generated set offers. A reduced reference set carries something
 * better: `reduction.collation`, the sheets the printing was really collated
 * on, reweighted over the positions the translation kept. The lab already deals
 * from those on both the Play tab and the Draft tab, and an exported file that
 * still dealt nine commons and a rare would have been a file that quietly
 * differs from the lab it came out of.
 *
 * Both halves map onto the format (tooling §1.1) without inventing anything:
 * a sheet line is `[Count] CardName`, so a weight is a repeat count, and
 * `[Settings].layouts` is already a set of weighted per-slot sheet counts, which
 * is what a booster configuration is. Weights are divided by their common
 * factor, which is exact, and by nothing else: a cap would be a file that deals
 * a distribution nobody chose.
 *
 * # The one thing this cannot promise, and it is said rather than assumed
 *
 * Our sampler draws distinct *cards* off a sheet, without replacement. A
 * Draftmancer sheet in the default `random` mode holds one line per copy, and
 * whether it refuses to put two copies of one card in a pack is a fact about
 * Draftmancer, not about this file — ADR-0003 §3 is the list of exactly these
 * guesses, and the first real import is what closes them. It only bites on a
 * sheet that is both weighted and dealt more than one card per pack, so
 * `printingNotes` names those sheets and leaves every other one unqualified.
 * The reduced M11 has none: its multi-card slots are its flat sheets, and its
 * weighted sheets deal one card each.
 *
 * # A printing prints one card several times, and the file has one line for it
 *
 * M11 prints four Plains at four collector numbers, and Draftmancer keys custom
 * cards by name: four entries would keep one, which is why `assertDraftable`
 * refuses a set with two cards of one name outright. On a sheet those four are
 * four slots on the same card, so they collapse into one line whose weight is
 * their sum, which is what the sheet meant. It is a collapse only where the
 * cards really are the same card — everything a printed face carries, compared
 * — and two different cards under one name are still refused, because that is
 * the case where keeping one loses the other.
 */
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import type { DraftmancerLayouts } from './collation';
import { DraftError } from './errors';

/** Everything a Draftmancer entry carries about a card, so two of one name can be compared. */
function printedFace(card: Card): string {
  const { id: _id, set: _set, ...face } = card as Card & Record<string, unknown>;
  return JSON.stringify(face, Object.keys(face).sort());
}

/**
 * One line per name, weighted by every printing of it.
 *
 * The representative is the first in collector order, so the file names the same
 * printing whatever order the sheet was written in.
 */
function collapseByName(
  sheetName: string,
  rows: readonly (readonly [Card, number])[],
): readonly (readonly [Card, number])[] {
  const byName = new Map<string, { card: Card; weight: number; face: string }>();
  for (const [card, weight] of rows) {
    const seen = byName.get(card.name);
    if (seen === undefined) {
      byName.set(card.name, { card, weight, face: printedFace(card) });
      continue;
    }
    if (seen.face !== printedFace(card)) {
      throw new DraftError(
        `sheet ${sheetName} deals two different cards named "${card.name}"; ` +
          'Draftmancer keys custom cards by name and would keep one',
      );
    }
    seen.weight += weight;
  }
  return [...byName.values()].map((entry) => [entry.card, entry.weight] as const);
}

/** One sheet as the file writes it: a card and how many lines it gets. */
export interface PrintedSheet {
  readonly name: string;
  readonly entries: readonly (readonly [Card, number])[];
}

function greatestCommonDivisor(a: number, b: number): number {
  let [high, low] = [Math.max(a, b), Math.min(a, b)];
  while (low > 0) [high, low] = [low, high % low];
  return high;
}

/**
 * The collation's sheets against this card list, in collector order, with every
 * sheet's weights reduced by their common factor.
 */
export function printedSheets(cards: readonly Card[], collation: PackCollation): readonly PrintedSheet[] {
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  return collation.sheets.map((sheet) => {
    const rows = Object.entries(sheet.weights).map(([id, weight]) => {
      const card = byId.get(id);
      if (card === undefined) {
        throw new DraftError(`sheet ${sheet.name} names ${id}, which this set does not print`);
      }
      return [card, weight] as const;
    });
    if (rows.length === 0) throw new DraftError(`sheet ${sheet.name} deals no card at all`);
    const collapsed = collapseByName(sheet.name, rows);
    const factor = collapsed.reduce((common, [, weight]) => greatestCommonDivisor(common, weight), 0);
    return {
      name: sheet.name,
      entries: collapsed
        .map(([card, weight]) => [card, weight / (factor > 0 ? factor : 1)] as const)
        .sort(
          ([a], [b]) => a.set.code.localeCompare(b.set.code) || a.set.collectorNumber - b.set.collectorNumber,
        ),
    };
  });
}

/**
 * One named layout per booster configuration, weighted as the printing weights
 * them. Named by position, because a configuration has no other name: M11's two
 * are "ten commons" and "nine commons and a foil", which is their contents.
 */
export function printedLayouts(collation: PackCollation): DraftmancerLayouts {
  return Object.fromEntries(
    collation.boosters.map((booster, index) => [
      `Booster ${String(index + 1)}`,
      { weight: booster.weight, slots: { ...booster.contents } },
    ]),
  );
}

/**
 * Every card the collation names, once per name, in the order the sheets list
 * them. Once per *name* rather than per id for `collapseByName`'s reason, and
 * with the same refusal: two sheets naming two different cards one name is a
 * file that would keep one of them.
 */
export function printedCards(sheets: readonly PrintedSheet[]): readonly Card[] {
  const seen = new Map<string, string>();
  const cards: Card[] = [];
  for (const sheet of sheets) {
    for (const [card] of sheet.entries) {
      const face = printedFace(card);
      const already = seen.get(card.name);
      if (already === undefined) {
        seen.set(card.name, face);
        cards.push(card);
        continue;
      }
      if (already !== face) {
        throw new DraftError(
          `this collation deals two different cards named "${card.name}"; ` +
            'Draftmancer keys custom cards by name and would keep one',
        );
      }
    }
  }
  return cards;
}

/**
 * What this file cannot promise deals the way the lab deals it.
 *
 * A weighted sheet that fills more than one slot in a pack: the lab draws
 * distinct cards off it and a Draftmancer sheet holds one line per copy, so the
 * two agree on the odds of the first card and are not known to agree on the
 * second. Empty is the ordinary case and means the file deals what the lab
 * deals, up to Draftmancer's own collation mode.
 */
export function printingNotes(collation: PackCollation, sheets: readonly PrintedSheet[]): readonly string[] {
  const widest = new Map<string, number>();
  for (const booster of collation.boosters) {
    for (const [name, count] of Object.entries(booster.contents)) {
      widest.set(name, Math.max(widest.get(name) ?? 0, count));
    }
  }
  return sheets
    .filter((sheet) => (widest.get(sheet.name) ?? 0) > 1 && sheet.entries.some(([, count]) => count > 1))
    .map(
      (sheet) =>
        `sheet ${sheet.name} is weighted and deals ${String(widest.get(sheet.name) ?? 0)} cards a pack: ` +
        'the lab draws distinct cards off it, and whether Draftmancer does the same over repeated ' +
        'lines is not settled here (ADR-0003 §3)',
    );
}
