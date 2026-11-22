/** General mechanical fallback for printed cards without an authored strategic profile. */
import type { LimitedCardFacts } from '@mtg/limited';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { planLimitedPool, projectedPoolValue } from './deck';
import { COLORS, DECK_MODEL_VERSION } from './model';
import type { Color, EvaluationCard } from './model';

export const STRUCTURAL_PRINTED_EVALUATION_POLICY = `${DECK_MODEL_VERSION}/printed-structural-v1`;

function structuralType(card: PrintedCardCatalogEntry): EvaluationCard['type'] {
  if (/\bLand\b/u.test(card.typeLine)) return 'nonbasic-land';
  return /\bCreature\b/u.test(card.typeLine) ? 'creature' : 'noncreature-spell';
}

/** Curve and broad card type only; this is explicitly not semantic card understanding. */
export function structuralPrintedScore(card: PrintedCardCatalogEntry): number {
  const curve = Math.max(0, 8 - Math.abs(card.manaValue - 3));
  const type = structuralType(card);
  return curve * 10 + (type === 'creature' ? 8 : type === 'nonbasic-land' ? 5 : 0);
}

export function structuralPrintedFacts(card: PrintedCardCatalogEntry): LimitedCardFacts {
  return {
    name: card.correctedName,
    colors: card.colors,
    manaValue: card.manaValue,
    type: structuralType(card),
    score: structuralPrintedScore(card),
  };
}

function structuralPrintedPips(cost: string | null): Partial<Record<Color, number>> {
  const pips: Partial<Record<Color, number>> = {};
  if (cost === null || cost === '') return pips;
  const tokens = cost.match(/\{[^{}]+\}/gu) ?? [];
  if (tokens.join('') !== cost) throw new Error(`Unsupported mana cost: ${cost}`);
  for (const token of tokens) {
    const symbol = token.slice(1, -1);
    const modes = symbol.split('/');
    if (!modes.every((mode) => COLORS.includes(mode as Color) || /^(?:[0-9]+|[CPSXYZ])$/u.test(mode))) {
      throw new Error(`Unsupported mana symbol: ${symbol}`);
    }
    // The current pip schema represents simultaneous requirements. A hybrid,
    // Phyrexian, or two-brid symbol is an alternative, so leave it flexible
    // instead of falsely requiring every colored mode at once.
    if (modes.length !== 1 || !COLORS.includes(symbol as Color)) continue;
    const color = symbol as Color;
    pips[color] = (pips[color] ?? 0) + 1;
  }
  return pips;
}

/** Convert rules-level printed fields without consulting a set-specific profile table. */
export function evaluateStructuralPrintedCard(card: PrintedCardCatalogEntry, id: string): EvaluationCard {
  const face = card.faces[0]!;
  const type = structuralType(card);
  const pips = structuralPrintedPips(face.manaCost ?? card.manaCost);
  return {
    id,
    colors: card.colors,
    manaValue: card.manaValue,
    type,
    pips,
    sources:
      type === 'nonbasic-land' ? COLORS.filter((color) => card.producedMana?.includes(color) === true) : [],
    quality: structuralPrintedScore(card) / 20,
    roles: [],
    tags: [],
    payoffs: [],
  };
}

/** Score a visible pick by its marginal contribution to the best projected deck. */
export function structuralPrintedPickValue(card: EvaluationCard, picked: readonly EvaluationCard[]): number {
  const flexibility = 0.05 * Math.max(0, 1 - picked.length / 23) * card.quality;
  return projectedPoolValue([...picked, card]) + flexibility;
}

/** Build a complete structural fallback deck from physical-copy evaluations. */
export function planStructuralPrintedPool(cards: readonly EvaluationCard[]) {
  return planLimitedPool(cards);
}
