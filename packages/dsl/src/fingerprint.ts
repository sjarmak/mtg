/**
 * Deterministic card hashing for dedup.
 *
 * Two fingerprints, two questions:
 *  - `cardFingerprint` — "is this the same printed card?" (ignores printing
 *    metadata: id, set, collector number, cached oracle text).
 *  - `mechanicalFingerprint` — "is this a functional reprint?" (additionally
 *    ignores name and rarity), which is how the set generator catches itself
 *    emitting the same card twice with different flavor.
 */
import { createHash } from 'node:crypto';
import { sortAbilities } from './abilities';
import { canonicalJson } from './canonical-json';
import type { Card } from './card';
import { sortColors, sortKeywords } from './vocabulary';

/**
 * Printing metadata never contributes to any fingerprint.
 *
 * `flavorText` is in the list rather than out of it, and the reason is the one
 * `mechanicalFingerprint` below is named for. Two cards with the same mechanics
 * and different flavor are the same printed card design, so leaving the field in
 * would let the generator emit one card twice and slip past
 * `DUPLICATE_FINGERPRINT` on nothing but a re-worded piece of prose — which is
 * the exact failure the dedup gate exists to catch. A card whose flavor text
 * changes also keeps the fingerprint it had before the field existed, so no
 * committed set re-hashes.
 */
const ALWAYS_OMITTED = ['id', 'set', 'oracleText', 'flavorText'] as const;

function normalize(card: Card, alsoOmitted: readonly string[]): Record<string, unknown> {
  const omit = new Set<string>([...ALWAYS_OMITTED, ...alsoOmitted, 'keywordAbilities']);
  const kept = Object.entries(card as Record<string, unknown>).filter(([key]) => !omit.has(key));
  return {
    ...Object.fromEntries(kept),
    colors: sortColors(card.colors),
    supertypes: [...card.supertypes].sort(),
    subtypes: [...card.subtypes].sort(),
    keywords: sortKeywords(card.keywords),
    ...(card.keywordAbilities === undefined || card.keywordAbilities.length === 0
      ? {}
      : {
          keywordAbilities: [...card.keywordAbilities].sort((left, right) => {
            const a = canonicalJson(left);
            const b = canonicalJson(right);
            return a < b ? -1 : a > b ? 1 : 0;
          }),
        }),
    // `canonicalJson` preserves array order by design, so two cards carrying
    // the same abilities in a different authored order would fingerprint
    // differently and slip past `DUPLICATE_FINGERPRINT`. Abilities are a set on
    // the printed card, not a sequence, so they are ordered here.
    abilities: sortAbilities(card.abilities),
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable hash of the printed card, ignoring id/set/collector/oracle cache. */
export function cardFingerprint(card: Card): string {
  return sha256(canonicalJson(normalize(card, [])));
}

/** Stable hash of the card's mechanics only, ignoring name and rarity. */
export function mechanicalFingerprint(card: Card): string {
  return sha256(canonicalJson(normalize(card, ['name', 'rarity'])));
}
