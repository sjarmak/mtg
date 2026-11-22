/** Pinned, offline model judgments; no provider or rules-text classifier at runtime. */
import { z } from 'zod';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { createRng } from '../rng';
import { CardProfileSchema, COLORS, DECK_MODEL, DECK_MODEL_VERSION } from './model';
import type { EvaluationCard } from './model';
import { colorPips } from './mana';
import { projectedPoolValue } from './deck';
import akh from './profiles/akh.json';
import hou from './profiles/hou.json';
import mp2 from './profiles/mp2.json';
import bindings from './profiles/source-bindings.json';

const profiles = z.record(z.string(), CardProfileSchema).parse({ ...akh, ...hou, ...mp2 });
const sourceBindings: Readonly<Record<string, number>> = bindings;
// Also pin data/parameter changes in saved transcripts, independently of format/pack identity.
export const PRINTED_EVALUATION_POLICY = `${DECK_MODEL_VERSION}/${String(createRng(JSON.stringify([profiles, bindings, DECK_MODEL])).state)}`;

/** Noncryptographic drift detector. The catalog loader separately verifies its SHA-256. */
export function printedSourceFingerprint(card: PrintedCardCatalogEntry): number {
  return createRng(
    JSON.stringify([
      card.correctedName,
      card.manaCost,
      card.manaValue,
      card.typeLine,
      card.oracleText,
      card.colors,
      card.producedMana ?? null,
      card.faces,
    ]),
  ).state;
}

export function hasPrintedEvaluation(card: PrintedCardCatalogEntry): boolean {
  return Object.hasOwn(sourceBindings, card.physicalId);
}

export function evaluatePrintedCard(card: PrintedCardCatalogEntry, id: string): EvaluationCard {
  const profile = profiles[card.correctedName];
  if (profile === undefined || sourceBindings[card.physicalId] === undefined)
    throw new Error(`No Limited profile for ${card.correctedName}`);
  if (sourceBindings[card.physicalId] !== printedSourceFingerprint(card))
    throw new Error(`Limited profile is stale for ${card.correctedName}`);
  const face = card.faces[0]!;
  const typeLine = face.typeLine;
  const type = /\bLand\b/u.test(typeLine)
    ? 'nonbasic-land'
    : /\bCreature\b/u.test(typeLine)
      ? 'creature'
      : 'noncreature-spell';
  const cost = profile.planningCost ?? face.manaCost ?? card.manaCost;
  const pips = colorPips(cost);
  const generic = [...(cost ?? '').matchAll(/\{([0-9]+)\}/gu)].reduce((sum, m) => sum + Number(m[1]), 0);
  return {
    ...profile,
    id,
    colors: COLORS.filter((color) => (pips[color] ?? 0) > 0),
    pips,
    type,
    manaValue: generic + Object.values(pips).reduce((sum, n) => sum + n, 0),
    // Only lands count as opening mana sources; conditional nonland ramp stays a role.
    sources:
      type === 'nonbasic-land'
        ? (profile.landSources ?? COLORS.filter((color) => card.producedMana?.includes(color)))
        : [],
  };
}

/** Compare the same observed pool with each candidate added; the unchanged base cancels. */
export function printedPickValue(card: EvaluationCard, picked: readonly EvaluationCard[]): number {
  const flexibility = 0.05 * Math.max(0, 1 - picked.length / 23) * card.quality;
  return projectedPoolValue([...picked, card]) + flexibility;
}
