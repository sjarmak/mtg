/**
 * Set-level validation: everything that only makes sense across a card list.
 *
 * The set generator emits ~90 cards at a time; duplicate ids break the kernel's
 * card registry, duplicate collector numbers break exports, and duplicate
 * mechanical fingerprints are the cheapest signal of a generator stuck in a
 * rut — except for the five Basic lands, which a real printing mints at
 * several collector positions on purpose (`isBasicLand` below says exactly
 * which structural fact tells the two apart).
 *
 * A token name is the fourth of those keys and joined the list late. `tokenCard`
 * derives a token's card id from its name alone, so a name two cards define
 * differently is one id serving two game objects — one art surface, one Forge
 * token script, one entry in the kernel's registry, and whichever definition the
 * walk reached first. `validateTokenNames` decided that correctly from the day it
 * was written and had no production caller: the only check that ran it needed an
 * allocation and a slot-keyed card map, which exist only inside a live
 * generation run, so a set already on disk was never asked. The 249-card
 * flagship shipped two Keys and two Vorn Spare Parts and read back clean
 * through every consumer of a committed set file, because they all arrive here.
 *
 * A token id is the fifth: two DIFFERENT names can derive the SAME id, because
 * `tokenCard` builds it by running the name through `tokenSlug`, which is not
 * injective over the alphabet a token name is allowed to use — case folds, and
 * every run of space, hyphen or apostrophe collapses to one separator
 * (`"Trophy-Horn Construct"` and `"Trophy Horn Construct"` both slug to
 * `trophy-horn-construct`). `validateTokenNames` cannot see this: it groups by
 * name, and these are two names. `validateTokenSlugCollisions` is the pass that
 * groups by the id instead (`mtg-ry1q`).
 */
import type { Card } from '../card';
import { isBasicLand } from '../card';
import { mechanicalFingerprint } from '../fingerprint';
import { validateTokenNames, validateTokenSlugCollisions } from '../set-tokens';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { validateCard } from './index';

/** Validates each card, prefixing every path with `cards[i]`. */
export function validateCards(inputs: readonly unknown[]): Violation[] {
  return inputs.flatMap((input, index) =>
    validateCard(input).map((v) => ({
      ...v,
      path: v.path.length > 0 ? `cards[${index}].${v.path}` : `cards[${index}]`,
    })),
  );
}

function firstDuplicateIndexes<T>(values: readonly T[]): Map<T, number> {
  const first = new Map<T, number>();
  for (const [index, value] of values.entries()) {
    if (!first.has(value)) first.set(value, index);
  }
  return first;
}

/**
 * Whether `card` is a Basic land — the one card a real Magic printing mints
 * more than once on purpose. A booster set prints Forest at several
 * consecutive collector positions, one per art, and every position shares a
 * single Scryfall Oracle id; `@mtg/data`'s `buildExecutableReferenceSet` turns
 * each into its own `Card` with a distinct id and collector number, so the
 * mechanical fingerprint is the only field left that still matches across
 * them. `basicLandType` is the structural fact that separates that case from
 * a generator bug: it is set exactly on the five Basic lands and on nothing
 * else, so it names the reprint rather than the card's name, its rarity or
 * even the fact that it is a land — a nonbasic land (or anything else)
 * reprinted under a new name is still exactly the duplicate this check exists
 * to catch.
 */
// `isBasicLand` lives in `../card`, because a deck-legality rule needs the same
// fact and two derivations of it is how a set check and a deck check come to
// disagree about what a Swamp is.

/**
 * Cross-card uniqueness over already-parsed cards. Run alongside
 * `validateCards`; this pass assumes each record is individually legal.
 */
export function validateSetUniqueness(cards: readonly Card[]): Violation[] {
  const found: Violation[] = [];
  const idFirst = firstDuplicateIndexes(cards.map((card) => card.id));
  const numberFirst = firstDuplicateIndexes(
    cards.map((card) => `${card.set.code}#${card.set.collectorNumber}`),
  );
  const printFirst = firstDuplicateIndexes(cards.map(mechanicalFingerprint));

  for (const [index, card] of cards.entries()) {
    if ((idFirst.get(card.id) ?? index) !== index) {
      found.push(
        violation(
          'DUPLICATE_CARD_ID',
          `cards[${index}].id`,
          `card id "${card.id}" is already used by an earlier card`,
        ),
      );
    }
    const printing = `${card.set.code}#${card.set.collectorNumber}`;
    if ((numberFirst.get(printing) ?? index) !== index) {
      found.push(
        violation(
          'DUPLICATE_COLLECTOR_NUMBER',
          `cards[${index}].set.collectorNumber`,
          `collector number ${printing} is already used by an earlier card`,
        ),
      );
    }
    const fingerprint = mechanicalFingerprint(card);
    const twinIndex = printFirst.get(fingerprint);
    if (twinIndex !== undefined && twinIndex !== index) {
      const twin = cards[twinIndex];
      const isReprintPair = twin !== undefined && isBasicLand(card) && isBasicLand(twin);
      if (!isReprintPair) {
        found.push(
          violation(
            'DUPLICATE_FINGERPRINT',
            `cards[${index}]`,
            `"${card.name}" is mechanically identical to "${twin?.name ?? '?'}" at index ${twinIndex}`,
          ),
        );
      }
    }
  }
  // Last, and pathed by token name (or token id) rather than by card index: a
  // conflict is a fact about the list, and no single card in it is the one that
  // is wrong.
  found.push(...validateTokenNames(cards));
  found.push(...validateTokenSlugCollisions(cards));
  return found;
}
