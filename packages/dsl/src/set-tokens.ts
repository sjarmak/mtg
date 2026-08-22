/**
 * The tokens a list of cards declares, enumerated once.
 *
 * A `TokenSpec` is buried in whichever effect list happens to create it — a
 * spell's own `effects`, or the effects of a permanent's triggered or activated
 * ability — so "which tokens does this set create" is a walk, and everything
 * that needs the answer was doing the walk itself or not at all. The art
 * pipeline was the second kind: it planned a set's *cards*, so no token in The
 * flagship set ever had an illustration and the governance check that exists
 * to make an unpainted surface impossible reported the set clean.
 *
 * The card each token becomes is not derived here. `tokenCard` is the one place
 * that record is built (`token.ts`), and this file is the one place the walk
 * lives; a caller gets both without repeating either.
 *
 * No recursion: a token's own abilities cannot create a token, which
 * `TokenEffectSchema` enforces so the schema stays finite and the Forge export
 * can finish declaring a card's tokens.
 */
import type { Card } from './card';
import { hasAbilityEffects } from './abilities';
import type { Effect } from './effects';
import { tokenCard } from './token';
import type { Violation } from './violations';
import { violation } from './violations';

/** One token a set creates, and the cards that create it. */
export interface SetToken {
  /** The card the kernel puts on the battlefield for it. */
  readonly card: Card;
  /** Ids of the cards whose effects declare it, in the order they were given. */
  readonly createdBy: readonly string[];
}

/**
 * Every effect printed on a card, wherever it is printed — including every
 * mode of a modal spell, not just whichever one a game would choose.
 *
 * `card.modes` walks in full rather than through `effectsFor`: that function
 * resolves *one* chosen mode for a game in progress, but a set-wide token or
 * art-surface walk has no game and no choice to resolve — every mode a card
 * could print is a surface the art pipeline and the kernel's token registry
 * must know about before the card is ever cast, or a token created only
 * inside an unpicked mode would never appear in `setTokens`'s output at all.
 */
export function printedEffects(card: Card): readonly Effect[] {
  return [
    ...card.effects,
    ...(card.modes ?? []).flatMap((mode) => mode.effects),
    ...card.abilities.filter(hasAbilityEffects).flatMap((ability) => ability.effects),
  ];
}

/**
 * The tokens these cards create, deduplicated by the card a token becomes.
 *
 * Keyed by the token's *name*, not by `tokenCard(...).id`. The two used to be
 * treated as the same key, and they are not: `tokenSlug` lowercases a name and
 * folds every run of characters outside its admitted alphabet to one hyphen, so
 * two DISTINCT names can build one id — `"Trophy-Horn Construct"` and `"Saber
 * Horn Construct"` both slug to `trophy-horn-construct`, and so do a name and its
 * all-caps twin. Keying this dedup by that id merged such a pair into one
 * surface with nothing said about the second name a card had actually printed
 * (`mtg-ry1q`). Keying by name instead means two specs are one surface only
 * when a card repeats a name the set already used, which is what "the same
 * token" means; first appearance wins and sets the order, so two runs over one
 * set agree.
 *
 * That still leaves the id collision itself unreported: two entries in the list
 * this returns can carry the same `card.id` when their names collide under
 * `tokenSlug`, which is exactly the case the art manifest, the kernel's
 * registry and the Forge token script cannot tell apart. `tokenSlugCollisions`
 * below is the walk that catches it, over this function's own output.
 *
 * Folding two specs under one *name* into one surface is only sound on a list
 * where every card meant the same token by that name, and this walk cannot
 * tell. `validateTokenNames` below is what tells, and `validateSetUniqueness`
 * runs it on every list, so a caller that validated before walking is entitled
 * to the surfaces this returns. The 249-card flagship is the set that proves the
 * entitlement has to be checked rather than assumed: it declares 24 distinct
 * payloads under 22 names, and until the uniqueness pass carried the token walk,
 * this function handed the art pipeline 22 surfaces without a word about the two
 * it had thrown away.
 */
export function setTokens(cards: readonly Card[]): readonly SetToken[] {
  const found = new Map<string, { readonly card: Card; readonly createdBy: string[] }>();
  for (const card of cards) {
    for (const effect of printedEffects(card)) {
      if (effect.kind !== 'createToken') continue;
      const built = tokenCard(effect.token);
      const seen = found.get(built.name);
      if (seen === undefined) {
        found.set(built.name, { card: built, createdBy: [card.id] });
        continue;
      }
      if (!seen.createdBy.includes(card.id)) seen.createdBy.push(card.id);
    }
  }
  return [...found.values()].map((entry) => ({ card: entry.card, createdBy: [...entry.createdBy] }));
}

/** Just the cards, for callers that do not need to know who makes what. */
export function setTokenCards(cards: readonly Card[]): readonly Card[] {
  return setTokens(cards).map((entry) => entry.card);
}

/** A creature token's body, or the fixed description of a bodiless one. */
function describeToken(card: Card): string {
  return card.kind === 'creature' ? `a ${card.power}/${card.toughness} creature` : 'a bodiless artifact';
}

/** One distinct token definition printed under a shared name, and who prints it. */
export interface TokenNameShape {
  readonly card: Card;
  /** Ids of the cards whose `createToken` payload builds exactly this shape. */
  readonly createdBy: readonly string[];
}

/** A name two or more cards disagree about the shape of. */
export interface TokenNameConflict {
  readonly name: string;
  /** Every distinct definition seen for this name, in encounter order. */
  readonly shapes: readonly TokenNameShape[];
}

/**
 * A token name is a key: `tokenCard` derives a token's id from its name alone
 * (`token.ts`), and `setTokens` keeps the first spec it meets under that id
 * and folds every later card creating "the same" token into its `createdBy`
 * list. That folding is only correct when every card meant the same token.
 * Two cards can print `createToken` payloads that share a name but disagree on
 * shape — one a 0/1 creature, the other a bodiless artifact; one a 0/1, another
 * a 1/1 — and nothing before this walk noticed: the second definition was
 * discarded silently, one art surface and one Forge script served two
 * different game objects under one label. This walk groups by name and, within
 * a name, by the built `Card` `tokenCard` would emit — so "different" means
 * what the kernel, renderer and art pipeline mean by it, not a shallower
 * reading of the spec — and reports only the names where more than one shape
 * survives.
 */
export function tokenNameConflicts(cards: readonly Card[]): readonly TokenNameConflict[] {
  interface MutableShape {
    readonly card: Card;
    readonly createdBy: string[];
  }
  const byName = new Map<string, MutableShape[]>();
  for (const card of cards) {
    for (const effect of printedEffects(card)) {
      if (effect.kind !== 'createToken') continue;
      const built = tokenCard(effect.token);
      const shapes = byName.get(built.name) ?? [];
      if (shapes.length === 0) byName.set(built.name, shapes);
      const match = shapes.find((shape) => JSON.stringify(shape.card) === JSON.stringify(built));
      if (match === undefined) {
        shapes.push({ card: built, createdBy: [card.id] });
      } else if (!match.createdBy.includes(card.id)) {
        match.createdBy.push(card.id);
      }
    }
  }
  const conflicts: TokenNameConflict[] = [];
  for (const [name, shapes] of byName) {
    if (shapes.length > 1) {
      conflicts.push({
        name,
        shapes: shapes.map((shape) => ({ card: shape.card, createdBy: [...shape.createdBy] })),
      });
    }
  }
  return conflicts;
}

/** `tokenNameConflicts`, reported as `Violation`s for the DSL's own validators. */
export function validateTokenNames(cards: readonly Card[]): Violation[] {
  return tokenNameConflicts(cards).map((conflict) => {
    const parts = conflict.shapes.map(
      (shape) => `${describeToken(shape.card)} (${shape.createdBy.join(', ')})`,
    );
    return violation(
      'DUPLICATE_TOKEN_NAME',
      `tokens["${conflict.name}"]`,
      `"${conflict.name}" names ${conflict.shapes.length} incompatible tokens: ${parts.join(' vs ')}; one name cannot describe two tokens`,
    );
  });
}

/** Two or more distinct token names that `tokenCard` keys under one id. */
export interface TokenSlugCollision {
  /** The id every name in `names` builds. */
  readonly slug: string;
  /** Every distinct name that builds `slug`, in encounter order. */
  readonly names: readonly string[];
}

/**
 * Names `setTokens` correctly kept as separate surfaces, but whose ids collide.
 *
 * `setTokens` above keys by name, so two distinct names are always two entries
 * in its output — that part of `mtg-ry1q` is fixed. What survives is that
 * `tokenCard` derives each entry's `card.id` from its name through `tokenSlug`,
 * which is not injective over the alphabet `TOKEN_NAME_PATTERN` admits: case
 * folds, and every run of space, hyphen, `'` or `’` collapses to one separator.
 * Two entries can therefore leave this walk with equal names in no field except
 * `card.id`, and `card.id` is the only field the art manifest, the kernel's
 * object registry and the Forge token script join on — so two named, printed
 * tokens would still share one art surface and one script downstream, just
 * without the silent merge hiding the second name entirely. Grouping
 * `setTokens`'s own output by `card.id` is what finds that pair.
 */
export function tokenSlugCollisions(cards: readonly Card[]): readonly TokenSlugCollision[] {
  const byId = new Map<string, string[]>();
  for (const token of setTokens(cards)) {
    const names = byId.get(token.card.id) ?? [];
    if (names.length === 0) byId.set(token.card.id, names);
    if (!names.includes(token.card.name)) names.push(token.card.name);
  }
  const collisions: TokenSlugCollision[] = [];
  for (const [slug, names] of byId) {
    if (names.length > 1) collisions.push({ slug, names: [...names] });
  }
  return collisions;
}

/** `tokenSlugCollisions`, reported as `Violation`s for the DSL's own validators. */
export function validateTokenSlugCollisions(cards: readonly Card[]): Violation[] {
  return tokenSlugCollisions(cards).map((collision) => {
    const names = collision.names.map((name) => `"${name}"`).join(' and ');
    return violation(
      'DUPLICATE_TOKEN_ID',
      `tokens["${collision.slug}"]`,
      `${names} are different names that build the same token id "${collision.slug}"; one id cannot serve two art surfaces`,
    );
  });
}
