/**
 * The set's own color signature: what a color does *not* do, in this set.
 *
 * `pie.ts` already rules every card against the mechanical color pie, and that
 * table is the right default — it is Magic's, it is shipped in
 * `@mtg/design-data`, and a set that states nothing is judged by it alone.
 * What it cannot say is the narrower thing a *set* decides. Real Magic lets red
 * draw cards and lets white tap creatures; the flagship set decided that red's
 * card draw is nobody's and that white's answer to a creature is exile rather
 * than destroy. Both statements are true of this set and false of the pie, so
 * neither belongs in code.
 *
 * So the policy is data and the enforcement is here (ZFC: which color may draw
 * cards is a design judgment; comparing a printed subject against a stated list
 * is not). The brief carries `colorSignatures`, one entry per color, each
 * naming the subjects that color does not print. An empty list — the state of
 * every brief in this tree — means the set states nothing and this gate reports
 * nothing, leaving `checkCardPie` exactly as authoritative as it was.
 *
 * A signature *narrows* the pie and never widens it: naming a subject absent can
 * only add a finding, and naming nothing can only remove one. A set cannot
 * license an off-pie card by writing it down, because `checkCardPie` still runs.
 *
 * Multicolor reads like the pie reads: a gold card is on-signature if any one
 * of its colors may print the subject, the same "best placement among the
 * card's colors wins" rule `bestVerdict` applies. A colorless card names no
 * color and so no signature rules on it; the colorless allowance in `pie.ts`
 * is the check that does.
 */
import type { Card, Color } from '@mtg/dsl';
import type { ColorPieSubject } from '@mtg/design-data';
import type { ColorSignature } from '../brief';
import type { Entry } from './composition';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { cardSubjects } from './pie';

/** A card printing a subject its colors all declare absent. */
export interface OffSignature {
  readonly card: Card;
  readonly subject: ColorPieSubject;
  /** The colors that declared it absent: every color the card is. */
  readonly colors: readonly Color[];
}

function absentIndex(signatures: readonly ColorSignature[]): ReadonlyMap<Color, ReadonlySet<string>> {
  const index = new Map<Color, ReadonlySet<string>>();
  for (const signature of signatures) index.set(signature.color, new Set(signature.absent));
  return index;
}

/**
 * Every subject a card prints that none of its colors may print.
 *
 * A color the set states nothing about permits everything, which is what makes
 * a partial signature usable: a brief can pin down black's gloom without having
 * to write out all five colors first.
 */
export function offSignatureSubjects(
  cards: readonly Card[],
  signatures: readonly ColorSignature[],
): OffSignature[] {
  if (signatures.length === 0) return [];
  const absent = absentIndex(signatures);
  const found: OffSignature[] = [];
  for (const card of cards) {
    if (card.colors.length === 0) continue;
    const seen = new Set<string>();
    for (const { subject } of cardSubjects(card)) {
      if (seen.has(subject)) continue;
      const forbidden = card.colors.every((color) => absent.get(color)?.has(subject) === true);
      if (!forbidden) continue;
      seen.add(subject);
      found.push({ card, subject, colors: card.colors });
    }
  }
  return found;
}

export function signatureFindings(
  cards: readonly Card[],
  signatures: readonly ColorSignature[],
  slotIdFor: (card: Card) => readonly string[] = () => [],
): SetFinding[] {
  return offSignatureSubjects(cards, signatures).map((item) =>
    finding(
      'OFF_SIGNATURE',
      'error',
      `"${item.card.name}" is ${item.colors.join('')} and prints ${item.subject}, which this set's color signature places absent from ${item.colors.join(' and ')}`,
      slotIdFor(item.card),
    ),
  );
}

export function checkColorSignature(
  entries: readonly Entry[],
  signatures: readonly ColorSignature[],
): SetFinding[] {
  const slotByCardId = new Map<string, string>();
  for (const entry of entries) slotByCardId.set(entry.card.id, entry.slot.id);
  return signatureFindings(
    entries.map((entry) => entry.card),
    signatures,
    (card) => {
      const slotId = slotByCardId.get(card.id);
      return slotId === undefined ? [] : [slotId];
    },
  );
}
