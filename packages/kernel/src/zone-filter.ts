/**
 * A second, weaker selector for the objects CR 613 does not reach.
 *
 * CR 611.2c: a continuous effect can modify the characteristics of a
 * permanent, or of an object on the stack. Nothing else. `layers.ts`'s own
 * docblock for `characteristicsOf` says as much, and `printedMap`
 * (`layers.ts:128`) builds the whole `CharacteristicMap` from
 * `state.battlefield` alone — a card in a graveyard, a hand, a library or
 * exile has no derived characteristics to look up, because there is no
 * "currently" for a layer walk to compute. It has exactly what is printed on
 * it.
 *
 * `ObjectFilter` (`continuous.ts`) is the *battlefield* answer to "which
 * objects": eight fields evaluated against a `CharacteristicMap` that only
 * exists for permanents, two of which — `oids`/`excludeOids`, aimed at a
 * specific object by identity, and `controller`, layer 2's output — name
 * facts that only mean what they say while a layer walk is backing them.
 * `PrintedFilter` below is the other five fields and nothing else: the
 * predicate CR 611.2c actually leaves a card with, once it is off the
 * battlefield.
 *
 * It is a distinct interface rather than a reuse of `ObjectFilter`, for the
 * reason `@mtg/engine`'s `RecordedBackend` / `ObservedBackend` split is
 * (`determinism.ts`): the two describe objects that answer different
 * questions, and a shared shape would let a caller hand a battlefield filter
 * to a graveyard read (or the reverse) and have it "type-check" while meaning
 * something the callee never promised. Concretely: `PrintedFilter` has no
 * `oids`, `excludeOids` or `controller` field, so passing one where
 * `selectMatching` (`characteristics.ts`) expects an `ObjectFilter` is a
 * missing-property error, not a filter that silently matches every permanent
 * on the battlefield because those three fields came back `undefined`. A
 * discriminant that fails to typecheck is what a shared shape plus a runtime
 * convention cannot offer.
 *
 * The matching logic itself is not duplicated: a `PrintedFilter` converts to
 * an `ObjectFilter` with the three battlefield-only fields forced to `null`
 * (`objectFilter`'s own "don't care" default), and `matchesFilter` does the
 * any/all-of work it already does for the layered path. What differs between
 * the two paths is which `Characteristics` the caller reads — `printedMap`'s
 * derived values here, `printedCharacteristics` alone there — never how a
 * predicate is applied to them.
 *
 * ## Which zones, and why only one today
 *
 * The bare object-id list a caller needs differs by zone: `graveyard`,
 * `hand` and `library` are ordinary per-player arrays on `PlayerState`;
 * `exile` is a single shared array on `GameState` with no per-player split,
 * so "target player's exile" needs an `owner` filter the others do not; the
 * stack is not an array of cards at all. Nothing here generalizes across that
 * split in advance of a card that needs it — `graveyardMembers` (re-exported
 * from `zone-members.ts`) is the one arm this bead's acceptance criteria asks
 * for, the same reason `ComputedAmountSchema` (`@mtg/dsl`) carries one member
 * and says so rather than inventing the second: a word no card exercises is a
 * word nobody has checked.
 */
import type { CardKind, Color, Keyword, Supertype } from '@mtg/dsl';
import { cardManaValue } from '@mtg/dsl';
import { printedCharacteristics, matchesFilter } from './characteristics';
import { objectFilter } from './continuous';
import type { ObjectId } from './ids';
import type { GameState } from './state';

/**
 * Re-exported from `zone-members.ts` unchanged: this module's `PrintedFilter`
 * reads its candidates from the same graveyard id list `characteristics.ts`'s
 * CDA arithmetic reads (`applyPtDefine`'s `graveyardCardTypes` count), and
 * `zone-members.ts` is where both sides can import it from without a cycle
 * (`zone-members.ts`'s own docblock explains why this file cannot define it).
 */
export { graveyardMembers } from './zone-members';

/**
 * A declarative "which cards" predicate for a zone CR 613 does not reach.
 *
 * Every field is `T[] | null`, matching `ObjectFilter`'s "don't care"
 * convention for the same reason: `null` keeps the record free of
 * `undefined` so it canonicalizes and clones cleanly, and a list field
 * matches on *any* of its values except `keywords`, which requires *all* of
 * them.
 *
 * `maxManaValue` is the one field that is not a list and the one this file
 * checks itself rather than delegating to `matchesFilter`. Both halves of that
 * follow from where a mana value lives: `Characteristics` does not carry one,
 * so `ObjectFilter` has nothing to compare against, and putting one there would
 * mean deciding what a copy effect and a layer-1 record do to a mana value —
 * a real CR 613 question with real consequences on the battlefield, and one
 * that no card in a library or a graveyard is asking. CR 202.3b reads the mana
 * value off the printed cost, and a card in a zone CR 613 does not reach has
 * nothing but its printed cost, so this predicate is complete where it stands.
 *
 * `names` is the second field checked here rather than through
 * `matchesFilter`, and for the mirror-image reason. `Characteristics` *does*
 * carry a name, but `ObjectFilter` has no field that reads it, and adding one
 * would be a battlefield question — layer 1 copy effects are exactly the rule
 * that makes a permanent's name differ from its card's, so a name filter over
 * the battlefield would have to say which of the two it meant. A card in a
 * library or a graveyard is not being copied by anything, so the printed name
 * on the card is the only name there is, and comparing it here keeps the
 * ambiguity out of a shape that would have to answer it.
 */
export interface PrintedFilter {
  readonly cardTypes: readonly CardKind[] | null;
  /**
   * Card types this filter refuses, checked with `none of`.
   *
   * `ObjectFilter.excludeCardTypes` over a hidden zone, and the argument it
   * makes there carries over unchanged: Duress reads "a noncreature, nonland
   * card", and the positive spelling of that is a list of the other card types
   * that stops meaning what the card says the day a new one is added. The
   * predicate is already written — `matchesFilter` reads this field off the
   * spread `objectFilter` builds — so this line and the `null` below are the
   * whole of the kernel's side of it.
   *
   * `excludeColors` is not here beside it, matching the DSL `CardFilter` it
   * converts from: the color negation is a battlefield clause (Doom Blade) and
   * no clause reaching a library, a graveyard or a revealed hand names a color
   * it refuses. `ObjectFilter` carries it, so the day one does this is one line.
   */
  readonly excludeCardTypes: readonly CardKind[] | null;
  readonly subtypes: readonly string[] | null;
  readonly supertypes: readonly Supertype[] | null;
  readonly colors: readonly Color[] | null;
  readonly keywords: readonly Keyword[] | null;
  /** CR 201.2's exact printed names, matched on any of them; `null` is no constraint. */
  readonly names: readonly string[] | null;
  /** An inclusive upper bound on CR 202.3's mana value; `null` is no bound. */
  readonly maxManaValue: number | null;
}

/** Matches every card, wherever it prints from. */
export const ANY_CARD: PrintedFilter = {
  cardTypes: null,
  excludeCardTypes: null,
  subtypes: null,
  supertypes: null,
  colors: null,
  keywords: null,
  names: null,
  maxManaValue: null,
};

/** A `PrintedFilter` with the unmentioned fields left as "don't care". */
export function printedFilter(patch: Partial<PrintedFilter>): PrintedFilter {
  return { ...ANY_CARD, ...patch };
}

/**
 * Every id in `members` the filter currently matches, in `members` order.
 *
 * "Currently" means against printed values: each candidate's
 * `printedCharacteristics` are computed fresh from its `card`, never looked
 * up in a `CharacteristicMap`, because no such map exists for a card that is
 * not a permanent or an object on the stack.
 */
export function selectPrinted(
  state: GameState,
  members: readonly ObjectId[],
  filter: PrintedFilter,
): readonly ObjectId[] {
  const asObjectFilter = objectFilter(filter);
  return members.filter((oid) => {
    const object = state.objects[oid];
    if (object === undefined) return false;
    // CR 202.3b, checked here rather than inside `matchesFilter`: the cost is
    // on the card and the characteristics record has no field for it. A land
    // has no mana cost at all, and CR 202.3a makes its mana value zero, which
    // is what `cardManaValue` answers for one -- so "with mana value 2 or less"
    // finds a land, exactly as the printed clause does.
    if (filter.maxManaValue !== null && cardManaValue(object.card) > filter.maxManaValue) return false;
    // CR 201.2, checked the same way and for the reason the interface gives:
    // the comparison is on the printed name character for character, which is
    // what "cards named Squadron Hawk" asks for.
    if (filter.names !== null && !filter.names.includes(object.card.name)) return false;
    return matchesFilter(asObjectFilter, oid, printedCharacteristics(object));
  });
}
