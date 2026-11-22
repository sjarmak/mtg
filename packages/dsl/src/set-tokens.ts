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
 * `printedCardSurface` owns the finite token descent, including the nested tier
 * used by Mitotic Slime, so every caller receives the same complete list.
 */
import type { Card } from './card';
import { printedCardSurface } from './printed-surface';
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
 * The tokens these cards create, deduplicated by the card a token becomes.
 *
 * Keyed by both token identity and printed name. Identity alone is not enough:
 * `tokenSlug` can fold two distinct names onto one default id, and retaining
 * both entries is what lets `tokenSlugCollisions` report that mistake. Name
 * alone is not enough either: Mitotic Slime legitimately creates 2/2 and 1/1
 * tokens both named Ooze, with explicit identities that keep their game cards
 * and art surfaces separate. The pair preserves both cases while still folding
 * repeated declarations of the same token. First appearance sets the order.
 *
 * That still leaves the id collision itself unreported: two entries in the list
 * this returns can carry the same `card.id` when their names collide under
 * `tokenSlug`, which is exactly the case the art manifest, the kernel's
 * registry and the Forge token script cannot tell apart. `tokenSlugCollisions`
 * below is the walk that catches it, over this function's own output.
 *
 * Folding two specs under one pair is sound only when they build the same card;
 * `validateTokenNames` reports incompatible shapes that share the pair, and
 * `validateSetUniqueness` runs that pass before consumers rely on the walk.
 */
export function setTokens(cards: readonly Card[]): readonly SetToken[] {
  const found = new Map<string, SetToken>();
  for (const card of cards) {
    for (const token of printedCardSurface(card).tokens) {
      const built = tokenCard(token);
      const key = `${built.id}\u0000${built.name}`;
      const seen = found.get(key);
      if (seen === undefined) {
        found.set(key, { card: built, createdBy: [card.id] });
        continue;
      }
      if (!seen.createdBy.includes(card.id)) {
        found.set(key, { card: seen.card, createdBy: [...seen.createdBy, card.id] });
      }
    }
  }
  return [...found.values()];
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

/** A name-and-identity pair whose declarations disagree about the shape. */
export interface TokenNameConflict {
  readonly name: string;
  /** Every distinct definition seen for this name, in encounter order. */
  readonly shapes: readonly TokenNameShape[];
}

/**
 * A token identity is a key. By default `tokenCard` derives it from the printed
 * name; a hand-authored token may state a separate identity when Magic prints
 * several token definitions under one name. Folding is correct only when every
 * declaration under one name-and-identity pair means the same token.
 * Two cards can print `createToken` payloads that share a name but disagree on
 * shape — one a 0/1 creature, the other a bodiless artifact; one a 0/1, another
 * a 1/1 — and nothing before this walk noticed: the second definition was
 * discarded silently, one art surface and one Forge script served two
 * different game objects under one label. This walk groups by name and built
 * `Card`, then reports only incompatible shapes that still share an id. Two
 * same-named shapes with distinct explicit identities are separate, valid
 * token surfaces.
 */
export function tokenNameConflicts(cards: readonly Card[]): readonly TokenNameConflict[] {
  const byName = new Map<string, readonly TokenNameShape[]>();
  for (const card of cards) {
    for (const token of printedCardSurface(card).tokens) {
      const built = tokenCard(token);
      const shapes = byName.get(built.name) ?? [];
      const matchIndex = shapes.findIndex((shape) => JSON.stringify(shape.card) === JSON.stringify(built));
      if (matchIndex === -1) {
        byName.set(built.name, [...shapes, { card: built, createdBy: [card.id] }]);
        continue;
      }
      const match = shapes[matchIndex];
      if (match !== undefined && !match.createdBy.includes(card.id)) {
        byName.set(
          built.name,
          shapes.map((shape, index) =>
            index === matchIndex ? { card: shape.card, createdBy: [...shape.createdBy, card.id] } : shape,
          ),
        );
      }
    }
  }
  const conflicts: TokenNameConflict[] = [];
  for (const [name, shapes] of byName) {
    const incompatible = shapes.filter((shape, index) =>
      shapes.some((other, otherIndex) => otherIndex !== index && other.card.id === shape.card.id),
    );
    if (incompatible.length > 1) {
      conflicts.push({
        name,
        shapes: incompatible.map((shape) => ({ card: shape.card, createdBy: [...shape.createdBy] })),
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
      `"${conflict.name}" and one token identity describe ${conflict.shapes.length} incompatible tokens: ${parts.join(' vs ')}; give distinct printed token definitions distinct hand-authored identities`,
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
  const byId = new Map<string, readonly string[]>();
  for (const token of setTokens(cards)) {
    const names = byId.get(token.card.id) ?? [];
    if (!names.includes(token.card.name)) byId.set(token.card.id, [...names, token.card.name]);
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
