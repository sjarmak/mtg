/**
 * The card a token is.
 *
 * CR 111.1: a token is a marker that is not a card but is treated as one on the
 * battlefield. This kernel takes that literally — `createToken` puts a real
 * `GameObject` on the battlefield with a real `Card` in it — and this function
 * is the one place that card is built.
 *
 * One owner, for the reason `isArtifact` has one. The kernel enumerates a
 * token's activated ability off `GameObject.card.abilities`, the renderer prints
 * the token's reminder text off the same record, the Forge transpiler writes its
 * token script from it, and the validators check it before any of them see it.
 * Four readers deriving "what type is this token, and what does it say" from the
 * spec independently is four chances to disagree; here it is decided once.
 *
 * The type rule is that sentence: a token that states a power and a toughness is
 * a creature token, and a token that states neither is an artifact token. A part
 * in the flagship set is the second kind — "an artifact whose only ability is
 * Fuse" — and giving it a body would mean a 0/0 the state-based actions bury on
 * arrival. Stating exactly one of the two is a `TOKEN_STATS_INCOMPLETE`
 * violation (`validate/effects.ts`) rather than a shape decided here.
 */
import type { Card } from './card';
import type { TokenSpec } from './effects';
import { isCreatureTokenSpec, tokenAbilities } from './effects';
import { ZERO_MANA_COST } from './mana';

/** Every token card carries this set code, which is Forge's convention too. */
export const TOKEN_SET_CODE = 'TKN';

/**
 * `Trophy Horn` -> `trophy-horn`; a name with no word characters falls back.
 *
 * Not injective: case folds, and every run of characters outside `[a-z0-9]`
 * collapses to one hyphen, so distinct names admitted by `TOKEN_NAME_PATTERN`
 * can slug to the same string (`"Trophy-Horn Construct"` and `"Trophy Horn
 * Construct"` both land on `trophy-horn-construct`). This function stays
 * many-to-one on purpose — an injective slug is a wider change than a bug fix
 * needs — and `set-tokens.ts`'s `validateTokenSlugCollisions` is what turns a
 * collision into a violation instead of a silently shared id (`mtg-ry1q`).
 */
export function tokenSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'token';
}

/**
 * The card record for one token spec.
 *
 * A token has no mana cost (CR 111.4 gives it none) and no rarity of its own;
 * `common` and `TKN 0` are bookkeeping the `Card` shape requires rather than
 * claims about the token. Supertypes are empty and `TokenSpec` has no field to
 * fill them from, which `packages/kernel/src/sba.ts` relies on when it explains
 * why the legend rule passes a token over.
 */
export function tokenCard(spec: TokenSpec): Card {
  const shared = {
    id: `token-${tokenSlug(spec.name)}`,
    rarity: 'common' as const,
    name: spec.name,
    set: { code: TOKEN_SET_CODE, collectorNumber: 0 },
    colors: [...spec.colors],
    supertypes: [],
    subtypes: [...spec.subtypes],
    keywords: [...spec.keywords],
    effects: [],
    abilities: [...tokenAbilities(spec)],
    manaCost: ZERO_MANA_COST,
    costReduction: null,
  };
  if (isCreatureTokenSpec(spec)) {
    return { ...shared, kind: 'creature', artifact: false, power: spec.power, toughness: spec.toughness };
  }
  return { ...shared, kind: 'artifact' };
}

/**
 * The name a creating card prints to point at a token.
 *
 * Derived from `tokenCard`, deliberately and not from `spec.name` directly: a
 * creating card that says "named Trophy Horn" is making a claim about the card
 * `tokenCard` builds, and the moment the two derive that name apart the pointer
 * points at nothing. Same reason `tokenCard` owns the id the art manifest and
 * the renderer both key on.
 */
export function tokenReferenceName(spec: TokenSpec): string {
  return tokenCard(spec).name;
}
