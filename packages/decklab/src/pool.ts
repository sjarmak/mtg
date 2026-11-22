/**
 * The two places a deck's cards can come from, behind one interface.
 *
 * `build.ts` touched `@mtg/data` in exactly two calls — the universe query and
 * the known-name set — and both of them are the same question asked of a
 * different world. So the store stops being an argument to the build and
 * becomes one of two answers to "what may go in this deck", and nothing
 * downstream of here learns which one it was handed. `@mtg/cube` made this
 * split one layer up and for the same reason; this file is the same shape,
 * moved down to the package that owns `CandidateCard` in the first place.
 *
 * ## Why the second source exists at all
 *
 * The store holds 38,623 real printings and our kernel cannot run one of them:
 * a printed card's rules text is not a DSL card, which is `docs/adr/
 * 0004-drop-translation-goal.md`'s settled finding. A deck built out of the
 * store is therefore a deck you can price, validate and read, and never play
 * here. A deck built out of a staged set is DSL cards throughout, so the same
 * pipeline that explains it also produces something the kernel deals a game
 * from. That is the whole reason for the second source, and it is why
 * `playable` is on the pool rather than derived later: the map from a chosen
 * candidate back to the card the kernel runs exists in one source and cannot
 * exist in the other.
 *
 * ## A criterion the pool cannot carry is refused, not ignored
 *
 * Both directions, and both for the same reason. A price ceiling over cards
 * that were never printed is a criterion nothing can enforce, and the prompt
 * would then tell the model that every card in the pool is already under it —
 * a false statement to the model and a line in the report nothing checked. A
 * format over the same cards is the same failure with a different field: a
 * generated set is neither legal nor illegal in Modern. And a store build that
 * states no format has no legality filter at all, which silently widens the
 * pool from one format to every card ever printed.
 *
 * So `format` and `sets` are exactly-one rather than both-optional, and each
 * source refuses what it cannot honor by name.
 *
 * ## Open world and closed world, which is why this is a union
 *
 * The two sources are not one shape with a flag, because the thing that differs
 * is what the model can be asked. `candidates.ts` argues at length that the
 * store's universe must never reach the prompt: "modern, Boros, mana value <= 3"
 * is 5,581 cards, nothing that size fits, and any cap imposed to make it fit is
 * a ranking made in code over exactly the cards the model was supposed to judge.
 * So a store build inverts — the model proposes from what it knows and code
 * checks each name against the universe.
 *
 * That inversion depends on the model already knowing the cards, and over a
 * staged set it does not. The set was generated; its names exist nowhere in any
 * training corpus. Asked to propose from memory, the model returns fluent,
 * plausible, entirely invented names and every one is correctly rejected — which
 * is what the first end-to-end run against the flagship set did, 39 spells
 * short with a full page of `unknown-card`. A closed pool has to be *stated*.
 *
 * It is affordable for the same reason it is necessary: a set is a set, hundreds
 * of cards rather than tens of thousands, so the whole pool fits in a prompt
 * with room to spare. There is deliberately no size cap on the listing, because
 * a cap would be the ranking `candidates.ts` refuses, one package over.
 *
 * A union rather than a boolean, following `@mtg/engine`'s determinism split:
 * `SetPool` carries `playable` and `StorePool` cannot, so a surface that wants
 * to deal a game from a built deck names `SetPool` in its signature and an
 * open-world pool fails to typecheck rather than failing a runtime check.
 */
import type { DataStore } from '@mtg/data';
import type { Card, Color } from '@mtg/dsl';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import {
  cardFingerprint,
  cardManaValue,
  formatManaCost,
  isCastable,
  KEYWORD_PRINT_NAMES,
  renderOracleText,
  renderTypeLine,
  setBasics,
  sortColors,
} from '@mtg/dsl';
import type { CandidateCard, CandidateUniverse } from './candidates';
import { loadKnownNames, normalizeName, selectUniverse } from './candidates';
import type { DeckCriteria } from './criteria';
import { parseManaCost } from './mana-cost';

/**
 * What may go in the deck, and what counts as a card that exists.
 *
 * `knownNames` is not `universe.cards` and the difference is the whole point of
 * the field. Over the store it is every real card name, so a proposal missing
 * from the universe splits into two failures with two different repairs — a
 * card that does not exist ("stop making cards up") and a real card the
 * criteria exclude ("that one is illegal here, pick another"). Over a set those
 * two collapse into one, because the set is the only world there is.
 */
interface PoolCommon {
  readonly universe: CandidateUniverse;
  readonly knownNames: ReadonlySet<string>;
}

/**
 * The card store: more cards than a prompt can hold, all of them cards the model
 * already knows, none of them cards this kernel can run.
 */
export interface StorePool extends PoolCommon {
  readonly kind: 'store';
}

/**
 * One or more staged sets: few enough to state in full, unknown to the model
 * until they are, and DSL cards throughout.
 */
export interface SetPool extends PoolCommon {
  readonly kind: 'set';
  /**
   * The DSL card behind each candidate, keyed the way `CandidateCard.oracleId`
   * is keyed, plus the five basics.
   *
   * Required on this arm and absent from the other, which is the whole reason
   * the pool is a union: a deck of real printings has no playable card behind
   * it, so a surface that wants to deal a game from a built deck narrows to
   * `SetPool` and cannot reach one by accident.
   *
   * The basics are in here and deliberately not in `universe`. They must not be
   * choosable — the mana base is computed, so a basic in the universe would let
   * the model spend a spell slot on a Plains — and they must be resolvable,
   * because the finished deck plays twenty-one of them and something has to deal
   * them. Two different questions, two different places.
   */
  readonly playable: ReadonlyMap<string, Card>;
  /**
   * The five basics this set is played with, in WUBRG order.
   *
   * Built through `@mtg/dsl`'s `setBasics`, which is the one function that
   * decides what that card is: it takes the set's own printed basic when there
   * is one and mints `<code>-<type>` when there is not. Deriving an id a second
   * way here would be a second chance to key the manifest differently from the
   * renderer, which is the blind spot the art pipeline's governance check was widened to close.
   */
  readonly basics: readonly Card[];
}

export interface PrintedFormatPool extends PoolCommon {
  readonly kind: 'printed-format';
  readonly formatId: string;
  readonly sourceCodes: readonly string[];
  readonly printings: ReadonlyMap<string, PrintedCardCatalogEntry>;
  readonly basics: ReadonlyMap<string, PrintedCardCatalogEntry>;
}

export type DeckPool = StorePool | SetPool | PrintedFormatPool;

/** A generated set as a pool needs it: the cards, and which set to say they are from. */
export interface PoolSet {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly Card[];
}

export class UnpricedPoolError extends Error {
  constructor(readonly maxCardUsd: number | undefined) {
    super(
      'a generated set carries no prices, so a dollar budget cannot be applied to it; ' +
        'drop the budget, or build this deck over the card store',
    );
    this.name = 'UnpricedPoolError';
  }
}

export class FormatOverSetPoolError extends Error {
  constructor(readonly format: string) {
    super(
      `a generated set has no format legality, so "${format}" cannot be enforced over it; ` +
        'drop the format, or build this deck over the card store',
    );
    this.name = 'FormatOverSetPoolError';
  }
}

export class FormatlessStoreBuildError extends Error {
  constructor() {
    super(
      'a deck built over the card store must state a format: without one the pool is every card ' +
        'ever printed rather than a legal one',
    );
    this.name = 'FormatlessStoreBuildError';
  }
}

export class SetsOverStorePoolError extends Error {
  constructor(readonly sets: readonly string[]) {
    super(
      `the card store is not made of staged sets, so "${sets.join(', ')}" cannot be enforced over it; ` +
        'drop the sets, or build this deck over a staged set',
    );
    this.name = 'SetsOverStorePoolError';
  }
}

/**
 * Two cards in *one* set sharing one name.
 *
 * Both a deck and a cube count copies by name, so one name over two cards is one
 * card with two faces: a proposal naming it would be ambiguous and a four-of
 * would be reached twice as fast. `@mtg/cube` re-exports this rather than
 * declaring its own — one rule, one class, and `packages/slice/test/
 * package-surfaces.test.ts` fails two declarations wearing one label.
 *
 * Within one set this is an authoring defect and stays an error: it is the
 * generator emitting one card twice, which is what its own `DUPLICATE_FINGERPRINT`
 * gate exists to catch, and collapsing it here would hide it. Across two sets it
 * is not this error at all — see `ConflictingReprintError`.
 */
export class DuplicateSetCardError extends Error {
  constructor(readonly cardName: string) {
    super(`the pool names ${cardName} twice; copies are counted by name, so two cards cannot share one`);
    this.name = 'DuplicateSetCardError';
  }
}

/**
 * Two *different* cards printed under one name in two different staged sets.
 *
 * `mtg-1urk`. Real sets reprint, and the reduced M11, M13 and RTR builds are
 * real sets: Pacifism is printed in both M11 and M13, so it arrives twice with
 * two ids and two set codes. Refusing that refused every multi-reference-set
 * pool the picker can offer — measured, 43 of the four staged sets' names are
 * printed in more than one of them, so all but a handful of selections failed on
 * the ordinary case.
 *
 * A reprint is one card, so the pool holds one entry for it and the name rule is
 * satisfied rather than broken. What is *not* a reprint is two sets printing
 * different rules under one name, and that is this error: the copy count could
 * not say which card it was counting, and the game could not say which card it
 * was dealing. Sameness is `@mtg/dsl`'s `cardFingerprint`, which is the function
 * whose whole question is "is this the same printed card?" — it ignores id, set,
 * collector number and the flavor text a reprint is free to change, and keeps
 * everything a game or a deck check reads.
 *
 * It names both sets because the repair is to leave one of them out, and a
 * sentence that named only the card would not say which one.
 */
export class ConflictingReprintError extends Error {
  constructor(
    readonly cardName: string,
    readonly firstSetCode: string,
    readonly secondSetCode: string,
  ) {
    super(
      `${firstSetCode} and ${secondSetCode} both print ${cardName}, but not the same card. Copies are ` +
        'counted by name, so the pool cannot hold both; select one of the two sets',
    );
    this.name = 'ConflictingReprintError';
  }
}

/**
 * Two cards in the staged sets sharing one id.
 *
 * A different fact from either name rule and it gets its own sentence, because
 * the id is a different identity: it is what `maxCopies` counts on, what
 * `playable` is keyed by, and what `@mtg/ui` reopens a built deck against. Two
 * cards under one id would let a deck hold eight copies of a four-of and would
 * deal whichever of them the pool happened to keep.
 *
 * Two staged sets cannot reach this — a card id carries its set code and the
 * launcher already refuses a second set under one code — so in practice this is
 * one set's own authoring defect, found here rather than in a game.
 */
export class DuplicateSetCardIdError extends Error {
  constructor(
    readonly cardId: string,
    readonly cardName: string,
  ) {
    super(
      `the pool holds two cards under the id ${cardId} (${cardName}); a copy limit and a dealt card ` +
        'are both keyed by id, so two cards cannot share one',
    );
    this.name = 'DuplicateSetCardIdError';
  }
}

/**
 * The store as a pool: the legality query, and every real name to check against.
 */
export function storeDeckPool(store: DataStore, criteria: DeckCriteria): DeckPool {
  if (criteria.format === undefined) throw new FormatlessStoreBuildError();
  if (criteria.sets !== undefined && criteria.sets.length > 0) {
    throw new SetsOverStorePoolError(criteria.sets);
  }
  return { kind: 'store', universe: selectUniverse(store, criteria), knownNames: loadKnownNames(store) };
}

/**
 * One or more staged sets as a pool.
 *
 * The color and mana-value criteria are applied here rather than in SQL, and
 * the budget and format ones are refused above. Basic lands are dropped for the
 * reason `selectUniverse` drops them: the mana base is computed, not chosen, so
 * a basic in the pool would let the model spend a spell slot on a Swamp.
 */
export function setDeckPool(sets: readonly PoolSet[], criteria: DeckCriteria): SetPool {
  if (criteria.format !== undefined) throw new FormatOverSetPoolError(criteria.format);
  if (criteria.budget !== undefined) throw new UnpricedPoolError(criteria.budget.maxCardUsd);

  const filters: string[] = [`printed in ${sets.map((set) => `${set.name} (${set.code})`).join(', ')}`];
  const byName = new Map<string, CandidateCard>();
  const playable = new Map<string, Card>();
  const cards: CandidateCard[] = [];

  // Every non-basic card the loop has met, before any criteria filter and under
  // its own name and id. Recorded ahead of the filters rather than after them,
  // because two cards sharing a name or an id is a fact about the staged sets
  // and stays one whether or not this build's colors happened to exclude either.
  // The card itself is held rather than a hash of it so that the reprint
  // comparison below costs two fingerprints per collision instead of one per
  // card.
  const printed = new Map<string, { readonly card: Card; readonly setCode: string }>();
  const claimedIds = new Set<string>();
  let reprinted = 0;

  const colors = criteria.colors;
  if (colors.length > 0) filters.push(`color identity within {${colors.join('')}}`);
  if (criteria.maxManaValue !== undefined) filters.push(`mana value <= ${criteria.maxManaValue}`);

  for (const set of sets) {
    for (const card of set.cards) {
      const candidate = candidateFromDslCard(card);

      // Basics take no part in either rule, and are held out of the universe and
      // kept in `playable`: see the field's own note. A set prints four Plains
      // under four ids on purpose and every staged set prints its own five, so
      // "one name, one card" was never a statement about them.
      if (isBasicLand(candidate)) {
        playable.set(candidate.oracleId, card);
        continue;
      }

      const key = normalizeName(candidate.name);
      const earlier = printed.get(key);
      if (earlier !== undefined) {
        if (earlier.setCode === set.code) throw new DuplicateSetCardError(candidate.name);
        if (cardFingerprint(earlier.card) !== cardFingerprint(card)) {
          throw new ConflictingReprintError(candidate.name, earlier.setCode, set.code);
        }
        // The same printed card in a second set. One card, one entry, and the
        // first set's printing is the one a game is dealt — they differ only in
        // the id, the set and the flavor text, which is exactly what
        // `cardFingerprint` just established.
        reprinted += 1;
        continue;
      }
      if (claimedIds.has(candidate.oracleId)) {
        throw new DuplicateSetCardIdError(candidate.oracleId, candidate.name);
      }
      printed.set(key, { card, setCode: set.code });
      claimedIds.add(candidate.oracleId);

      if (colors.length > 0 && !withinColors(candidate.colorIdentity, colors)) continue;
      if (criteria.maxManaValue !== undefined && candidate.manaValue > criteria.maxManaValue) continue;

      cards.push(candidate);
      byName.set(key, candidate);
      playable.set(candidate.oracleId, card);
    }
  }

  // Said in the filters rather than left to be inferred: the listing the model
  // is handed is shorter than the sets it names, and this is the sentence that
  // accounts for the difference. Only when there is one, because a line reading
  // "0 cards are printed in more than one" over a single set is noise.
  if (reprinted > 0) {
    filters.push(
      reprinted === 1
        ? '1 card is printed in more than one of these sets and is listed once: a reprint is one card'
        : `${String(reprinted)} cards are printed in more than one of these sets and are listed once each: ` +
            'a reprint is one card',
    );
  }
  filters.push('a generated set: no format legality and no price applies, and no card outside it exists');

  const basics = setBasics(sets.flatMap((set) => set.cards));
  for (const basic of basics) playable.set(basic.id, basic);

  return {
    kind: 'set',
    universe: { cards, byName, filters },
    basics,
    // The set is the only world there is, so a name outside the pool is one
    // failure rather than two. See `DeckPool.knownNames`.
    knownNames: new Set(byName.keys()),
    playable,
  };
}

function isBasicLand(card: CandidateCard): boolean {
  return card.typeLine.startsWith('Basic Land');
}

function withinColors(identity: string, colors: readonly Color[]): boolean {
  for (const letter of identity) {
    if (!colors.includes(letter as Color)) return false;
  }
  return true;
}

/**
 * A DSL card in the shape the deck's checks read.
 *
 * Every field is derived rather than invented. The card id is the identity a
 * copy limit counts on, because a generated set's ids are unique within it the
 * way an oracle id is unique in the store. `priceUsd` is `null` — the honest
 * value for a card that was never printed — and not a zero that would read as
 * free.
 *
 * Color identity follows rule 903.5d rather than the printed cost: a DSL land
 * declares no colors and taps for one, and that produced color is its identity,
 * which is what makes a generated Mountain red to an archetype the way Scryfall
 * makes the printed one red.
 *
 * It lives here rather than in `@mtg/cube`, where it was written: it builds a
 * `CandidateCard`, which is this package's type, out of a `@mtg/dsl` card, which
 * this package already depends on. Cube depends on decklab and not the reverse,
 * so hosting it there meant the arrow pointed backwards for every caller but
 * cube's own.
 */
export function candidateFromDslCard(card: Card): CandidateCard {
  const manaCost = isCastable(card) ? formatManaCost(card.manaCost) : null;
  const identity =
    card.kind === 'land' ? card.producesMana.filter((mana): mana is Color => mana !== 'C') : card.colors;
  return {
    oracleId: card.id,
    name: card.name,
    manaCost,
    manaValue: cardManaValue(card),
    typeLine: renderTypeLine(card),
    oracleText: renderOracleText(card),
    power: card.power === undefined ? null : String(card.power),
    toughness: card.toughness === undefined ? null : String(card.toughness),
    colorIdentity: sortColors(identity).join(''),
    keywords: card.keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]),
    priceUsd: null,
    parsedCost: parseManaCost(manaCost),
    producedMana: card.kind === 'land' ? card.producesMana.filter((mana): mana is Color => mana !== 'C') : [],
  };
}
