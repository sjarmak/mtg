/**
 * The Constructed pool, when the lab has staged more than one set.
 *
 * The builder was handed `set.json`'s card list, which is one set, while the
 * set filter in its pool pane was already written for several — the row is drawn
 * only when the pool names more than one code, and it never was. `mtg-nwn1`
 * proposed staging a second document, `pool.json`, carrying every set. There is
 * no need for one: `../../lab/set-index.ts` already stages every set the
 * launcher found, the Cards route already reads all of them, and a second
 * document listing the same cards is a second thing to keep in step with the
 * first.
 *
 * So the pool is the union of the staged sets, in the index's own order, and
 * this module is the union and the one hazard in it.
 *
 * # Why an id can be refused
 *
 * A card id is unique inside a set and nothing makes it unique across sets. The
 * builder counts copies by id (`./build.ts`), so two cards sharing one would be
 * one card with two faces: adding a copy of either would add a copy of both, and
 * a four-of would be reached twice as fast. The staged sets do not collide today
 * — every id carries its set as a prefix — and that is a convention rather than
 * a guarantee, which is exactly the kind of thing that holds until a set is
 * staged from somewhere else.
 *
 * A refused card is therefore refused *and said*, never dropped quietly: the
 * first set that prints an id keeps it, and the pool pane's note states how many
 * were left out. A person who cannot find a card they know is staged is owed the
 * reason on the same screen.
 */
import { setBasics, setTokenCards } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { ArtResolver } from '../../lab/art-manifest';
import type { DeckSetRef } from './library';

/** One staged set, as a pool needs it: its name for a message and its cards. */
export interface PoolSet {
  readonly name: string;
  readonly cards: readonly DslCard[];
  /**
   * Which group this set is shelved under, when the page can say.
   *
   * Absent on a page opened on a flat set document with no index row behind it,
   * and then a deck built here records no set at all — `./saved-decks.ts` argues
   * why that is the right answer rather than the staged set's name.
   */
  readonly origin?: DeckSetRef['origin'];
  /**
   * This set's own illustrations, when it has any.
   *
   * `mtg-pzpz`. The builder used to be handed the *header* set's resolver over
   * a pool that is the union of every staged set, so with the picker on Return
   * to Ravnica the pool painted Azorius Guildgate and drew the labeled pending
   * frame on Arbor Elf, Serra Angel and Ajani -- cards whose pictures were
   * staged, keyed by ids that manifest does not hold. `../CardsRoute.ts` had
   * already answered the same question for the gallery: a card is painted by the
   * set that owns it, never by the set the header happens to be on.
   *
   * Absent is an ordinary state and means this set has had no art run.
   */
  readonly artFor?: ArtResolver;
}

export interface ConstructedPool {
  readonly cards: readonly DslCard[];
  /** The pool pane's note: what the pool is, and what it could not take. */
  readonly note: string;
  /** Cards left out because an earlier set already prints their id. */
  readonly refused: number;
  /**
   * Which staged set each card came from, keyed by card id.
   *
   * Only the sets that named an origin are in it: a set the page cannot shelve
   * has nothing to record, and a card of one is a card whose set is unknown,
   * which is a state `./library.ts` already draws.
   */
  readonly setOf: ReadonlyMap<string, DeckSetRef>;
  /**
   * The union's own art lookup, or `null` when no staged set staged any.
   *
   * Keyed by card id, which is the key the union already refuses a collision on:
   * the first set to print an id keeps the card, so it keeps the picture, and
   * the two decisions cannot disagree. `null` rather than a resolver that always
   * answers `null`, so a caller can tell "no art anywhere" from "no art for this
   * card" and hand the builder nothing at all.
   *
   * It covers more ids than the pool holds cards, and has to: a table drawn by
   * this resolver puts tokens on the battlefield, and a token is in no set's
   * card list. See `constructedPool` below.
   */
  readonly artFor: ArtResolver | null;
}

/** The copy rule, said the way somebody building a deck says it. */
export const POOL_COPIES_NOTE = 'Up to four copies of each';

/**
 * Every staged set, plus the basics it is played with.
 *
 * A set document prints no basic lands — `@mtg/dsl`'s `setBasics` mints the five
 * for it, which is the one place a set's own Plains is decided — so a pool built
 * from the documents alone holds no `xmp-plains`. A deck that recorded one then
 * resolves to nothing, which is why **Alaric-v1 was missing from the Play tab's
 * picker while every Vessari deck was there**: Vessari's lands are M11 printings and
 * are in that set's card list, and Alaric's are the flagship's own minted Plains.
 *
 * It lives here rather than beside either caller because both unions need it and
 * for a while only one had it (`mtg-ac0h`). The Play tab minted, the deck
 * library did not, so the same variation resolved its Plains on one route and
 * was dealt M11's on the other — a deck built from the flagship set alone,
 * holding a land the set's art manifest has no key for. A rule two surfaces have
 * to agree on is a rule that belongs to neither of them.
 *
 * Minted through the same function the manifest and the renderer key on, so the
 * id a variation recorded, the id resolved here and the id the art is filed
 * under cannot be derived three ways.
 */
export function withMintedBasics(sets: readonly PoolSet[]): readonly PoolSet[] {
  return sets.map((set) => {
    // `setBasics` hands back a set's *printed* Plains when it has one, so the
    // five it returns are not all new. Appending them whole would put the
    // reduced M11's `m11-230` in the list twice, and the union below refuses a
    // repeated id and counts it — which would have the pool pane's note report
    // cards left out that were never left out.
    const held = new Set(set.cards.map((card) => card.id));
    const minted = setBasics(set.cards).filter((card) => !held.has(card.id));
    return minted.length === 0 ? set : { ...set, cards: [...set.cards, ...minted] };
  });
}

/**
 * The union, first set wins on a collision.
 *
 * One set is the ordinary case and produces exactly the pool and exactly the
 * note the builder had before there was an index, so a lab with one set staged
 * renders as it always did.
 */
export function constructedPool(sets: readonly PoolSet[]): ConstructedPool {
  const seen = new Set<string>();
  const cards: DslCard[] = [];
  const setOf = new Map<string, DeckSetRef>();
  const artOf = new Map<string, ArtResolver>();
  let refused = 0;
  for (const set of sets) {
    const ref: DeckSetRef | null = set.origin === undefined ? null : { name: set.name, origin: set.origin };
    for (const card of set.cards) {
      if (seen.has(card.id)) {
        refused += 1;
        continue;
      }
      seen.add(card.id);
      cards.push(card);
      if (ref !== null) setOf.set(card.id, ref);
      if (set.artFor !== undefined) artOf.set(card.id, set.artFor);
    }
    // The art map is wider than the pool, because a table is wider than a deck.
    // A token is minted at run time and printed in no `set.json`, so an art map
    // keyed off the pool's cards answers nothing for one — and `../PlayRoute.ts`
    // hands *this* resolver to every game it deals. So every token on every
    // table drew the labeled pending frame while the same permanent in the
    // replay viewer, painted by the set's own resolver, showed its picture.
    // They stay out of `cards`: a token is not a card anybody can put in a deck.
    //
    // `setTokenCards` is the walk the art pipeline's `artSurfaces` keys the manifest
    // by, so the id looked up here and the id the picture is filed under are the
    // same derivation rather than two. First set wins, as it does for a card:
    // the three ids more than one staged set creates (`token-beast`,
    // `token-bird`, `token-zombie`) are the same Magic token reprinted.
    if (set.artFor !== undefined) {
      for (const token of setTokenCards(set.cards)) {
        if (!artOf.has(token.id)) artOf.set(token.id, set.artFor);
      }
    }
  }
  const across =
    sets.length > 1 ? `${POOL_COPIES_NOTE}, across ${String(sets.length)} staged sets` : POOL_COPIES_NOTE;
  const collision =
    refused === 0
      ? ''
      : `. ${String(refused)} ${refused === 1 ? 'card is' : 'cards are'} left out: an earlier set already prints that card id, and the builder counts copies by id`;
  const artFor: ArtResolver | null =
    artOf.size === 0 ? null : (card, copy) => artOf.get(card.id)?.(card, copy) ?? null;
  return { cards, note: `${across}${collision}`, refused, setOf, artFor };
}

/**
 * The one set a list of cards was cut from, or `null` when they do not agree.
 *
 * `mtg-6nqs`. The pool spans every staged set, so the set a deck should be
 * shelved under is a fact about the cards somebody chose rather than about the
 * set the header happens to name. Three answers collapse into `null` on purpose,
 * because all three mean the same thing to a reader: the cards came from two
 * sets, one of them named no origin, or the deck is empty. A deck the page
 * cannot place is drawn as one whose set is not known, which is true of it, and
 * `./library.ts` already has a shelf for exactly that.
 */
export function deckSetOf(setOf: ReadonlyMap<string, DeckSetRef>, ids: readonly string[]): DeckSetRef | null {
  let found: DeckSetRef | null = null;
  for (const id of ids) {
    const owner = setOf.get(id);
    if (owner === undefined) return null;
    if (found === null) found = owner;
    else if (found.name !== owner.name || found.origin !== owner.origin) return null;
  }
  return found;
}
