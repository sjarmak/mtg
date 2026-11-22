/**
 * Constructed deckbuilding state.
 *
 * The sealed builder next door selects by *index*, because six boosters open
 * the same common three times and each of those three is a separate object the
 * builder includes or cuts. Constructed is the other shape entirely: the pool is
 * every card in the set, each listed once, and playing a card four times is a
 * *count* rather than four positions. So this state is keyed by card id and
 * holds a number, and the two modules share their vocabulary rather than their
 * representation. Collapsing them onto one would have meant either pushing four
 * duplicate entries into a 368-card pool or teaching the sealed screen a copy
 * count it can never use.
 *
 * What is shared is everything underneath: `buildFromSpells` builds the deck,
 * the mana base is suggested and overridable exactly as it is in sealed, and the
 * legality rules come from `@mtg/deckbuild`'s `constructedConfig` rather than
 * from anything typed here.
 *
 * Basics are never picked here. `addCopy` refuses a Basic land and `selectable`
 * keeps them out of what the pool pane lists, because the mana base panel is
 * where lands are counted and a Swamp added twice through two different controls
 * is a deck nobody can reason about — CR 100.4 exempts Basic lands from the copy
 * limit, so the two routes would not even agree on what a fifth copy means. They
 * are still allowed to sit in `pool`, which is handed to `buildFromSpells`
 * whole: `setBasics` prefers the set's own printing of a Swamp when the set
 * ships one and synthesizes the canonical id when it does not, and it is the one
 * derivation of that id, so either pool prints the card the art manifest is
 * keyed by.
 */
import type { Card, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, formatManaCost, isBasicLand, isCastable, manaValue } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT, buildFromSpells, constructedConfig } from '@mtg/deckbuild';
import type { BasicLandCounts, ManualDeck } from '@mtg/deckbuild';
import { cardColors } from '../../card/identity';
import { typeLinePieces } from '../../card/type-line';
import type { GroupingFacts } from './grouping';
import type { StripFacts } from './strips';

export interface ConstructedBuild {
  /** Every card that can be played, each listed once. */
  readonly pool: readonly Card[];
  /** Copies played, by card id. A card absent from the record is played zero times. */
  readonly counts: Readonly<Record<string, number>>;
  /** The basics the builder counted out, or null while the computed base stands. */
  readonly basics: BasicLandCounts | null;
  /**
   * The printings the mana base mints its basics from, or null to read them off
   * the pool.
   *
   * `BasicLandCounts` is five numbers by color, so it cannot say *which* Plains,
   * and the pool this builder holds is the union of every staged set. Whichever
   * Plains that union offers first is the one `setBasics` finds, so a deck built
   * from the flagship set alone came back holding M11 Plains: the deck played
   * was not the deck recorded, and every land on the board drew the pending
   * frame, because the XMP art manifest has no key for `m11-plains`
   * (`mtg-ac0h`).
   *
   * This is `DeckBuildConfig.set`, which exists for the same failure one surface
   * over — a sealed pool minting basics its own set prints (`mtg-aqxi.9`) — and
   * carries the same rule: a caller that knows the printings says so, and one
   * that does not leaves it null and gets the best answer a pool alone affords.
   * A builder started from nothing knows nothing; a variation being reopened
   * has the ids written down.
   */
  readonly set: readonly Card[] | null;
}

/** An empty deck over a pool. A Constructed build starts from nothing chosen. */
export function emptyBuild(pool: readonly Card[]): ConstructedBuild {
  return { pool, counts: {}, basics: null, set: null };
}

/**
 * The same build over a wider pool.
 *
 * The Constructed pool is the union of every staged set and the sets are fetched
 * one document at a time, so a builder opened before they land holds the pool
 * that existed at the time (`mtg-nwn1`). Re-seating keeps the copies played
 * rather than starting the deck over: a card the new pool no longer holds loses
 * its copies, for `buildFromCards`'s reason — a deck whose pool does not hold
 * its own cards cannot be edited, since cutting a copy would make it
 * unrecoverable.
 */
export function restage(build: ConstructedBuild, pool: readonly Card[]): ConstructedBuild {
  const ids = new Set(pool.map((card) => card.id));
  const counts = Object.fromEntries(Object.entries(build.counts).filter(([id]) => ids.has(id)));
  return { ...build, pool, counts };
}

/** The cards the pool pane lists: everything a person picks, which is not a basic. */
export function selectable(pool: readonly Card[]): readonly Card[] {
  return pool.filter((card) => !isBasicLand(card));
}

/**
 * A build that already plays a list of cards, which is how "start from this
 * precon and edit it" is expressed.
 *
 * The list's basics become the counted mana base rather than being dropped,
 * because a precon's land count is part of the deck somebody tuned; taking the
 * spells and re-suggesting the base would hand back a different deck under the
 * same name. Cards outside the pool are dropped rather than silently widening
 * it: a deck whose pool does not hold its own cards cannot be edited, since
 * cutting a copy would make it unrecoverable.
 */
export function buildFromCards(pool: readonly Card[], cards: readonly Card[]): ConstructedBuild {
  const spells = cards.reduce((build, card) => addCopy(build, card.id), emptyBuild(pool));
  const counted = countBasics(cards);
  return counted.counts === null ? spells : { ...spells, basics: counted.counts, set: counted.printings };
}

/**
 * The basics in a card list, by color and by printing, or null counts when the
 * list holds none.
 *
 * The printings come back beside the counts for `ConstructedBuild.set`'s reason
 * (`mtg-ac0h`): the list handed in holds the deck's own Plains, the counts
 * cannot say which Plains it was, and the pool this build sits over is the union
 * of every staged set. A precon of the flagship set opened for editing was
 * coming back with M11's.
 */
function countBasics(cards: readonly Card[]): {
  readonly counts: BasicLandCounts | null;
  readonly printings: readonly Card[];
} {
  const counts: Partial<Record<Color, number>> = {};
  const printings = new Map<string, Card>();
  for (const card of cards) {
    if (card.kind !== 'land' || card.basicLandType === undefined) continue;
    const color = BASIC_LAND_COLOR[card.basicLandType];
    counts[color] = (counts[color] ?? 0) + 1;
    printings.set(card.id, card);
  }
  return {
    counts: Object.keys(counts).length === 0 ? null : counts,
    printings: [...printings.values()],
  };
}

/**
 * What column a card sorts into: its mana value, and zero for a land.
 *
 * A land has no mana cost at all rather than a cost of nothing, so the rule is
 * stated once here and read by everything that draws a curve. It is the same
 * rule `./columns.ts` keeps for a built artifact, where the producer has already
 * written the number down; here the card is the DSL card and the number is
 * derived, so a second derivation elsewhere would be a second chance to sort a
 * land into a column of its own.
 */
export function cardManaValue(card: Card): number {
  return card.kind === 'land' ? 0 : manaValue(card.manaCost);
}

/**
 * A DSL card, read as the four facts a grouping axis asks about.
 *
 * `./grouping.ts` takes facts rather than cards on purpose — a built artifact's
 * entry is not a `Card` and answers three of the four — so the adapter for the
 * one that answers all four lives here, beside `cardManaValue`, which is the
 * rule it reuses. Each fact is read through the module that already owns it:
 * the colors through `@mtg/render-spec`'s `cardColors`, so a Mountain sorts red
 * the way its frame is drawn red, and the type line through the card face's own
 * `typeLinePieces`, so what the reader sees under `Creature` is what the bar on
 * the card says.
 */
export function cardGroupingFacts(card: Card): GroupingFacts {
  const pieces = typeLinePieces(card);
  return {
    name: card.name,
    manaValue: cardManaValue(card),
    colorIdentity: cardColors(card).join(''),
    typeLine: `${pieces.supertypes}${pieces.types}${pieces.subtypes}`,
    rarity: card.rarity,
  };
}

/**
 * A DSL card, read as what one strip of a column draws.
 *
 * `key` is the caller's because a pane decides what a copy is: the deck pane
 * holds each card once and says how many copies it plays, and a drafted pool
 * holds one member per pick, so two copies of a card there are two members and
 * an id would key them the same. `copies` is the caller's for the same reason.
 *
 * A land has no mana cost at all rather than a cost of nothing, so it draws no
 * cost, which is `cardManaValue`'s rule read at the other end: the capture's
 * leftmost column is 24 strips with nothing printed on the right of any of them.
 */
export function cardStripFacts(card: Card, key: string, copies: number): StripFacts {
  return {
    key,
    name: card.name,
    manaCost: isCastable(card) ? formatManaCost(card.manaCost) : null,
    colorIdentity: cardColors(card).join(''),
    copies,
  };
}

/** One rung of the curve: a mana value and the number of *cards* played at it. */
export interface CurveStep {
  readonly manaValue: number;
  /** Cards, counting copies. A four-of is four, not one. See `./columns.ts`. */
  readonly cards: number;
}

/**
 * The deck's curve: every mana value from its cheapest card to its dearest, with
 * the number of cards at each.
 *
 * Contiguous, which is the one place this parts company with `./columns.ts`'s
 * columns, and the reason is what the two drawings are. A column of *cards* left
 * empty claims a card belongs there; a rung of a curve reading zero states that
 * the deck casts nothing for that much, which is true, is the shape of the
 * curve, and is exactly the gap somebody scanning for their two-drops is looking
 * for. Dropping it would draw a deck of ones and fours as if it curved smoothly.
 *
 * Counted over `chosenCards`, so this is the deck being built rather than the
 * pool being browsed, and the basics the mana base counts out are not in it —
 * they are stated by the mana panel, and a curve is about what the deck casts.
 */
export function manaCurve(build: ConstructedBuild): readonly CurveStep[] {
  return curveFrom(chosenCards(build).map((card) => ({ manaValue: cardManaValue(card), cards: 1 })));
}

export function curveFrom(entries: readonly CurveStep[]): readonly CurveStep[] {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    counts.set(entry.manaValue, (counts.get(entry.manaValue) ?? 0) + entry.cards);
  }
  const values = [...counts.keys()];
  if (values.length === 0) return [];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const steps: CurveStep[] = [];
  for (let value = lowest; value <= highest; value += 1) {
    steps.push({ manaValue: value, cards: counts.get(value) ?? 0 });
  }
  return steps;
}

export function copiesOf(build: ConstructedBuild, cardId: string): number {
  return build.counts[cardId] ?? 0;
}

/**
 * Plays one more copy, up to the Constructed limit.
 *
 * Capped rather than reported, because the pool pane's add control is the wrong
 * place to learn about a rule: a fifth copy that goes in and then fails the deck
 * is a worse explanation of CR 100.2a than an add that stops at four.
 */
export function addCopy(build: ConstructedBuild, cardId: string): ConstructedBuild {
  const card = build.pool.find((entry) => entry.id === cardId);
  if (card === undefined || isBasicLand(card)) return build;
  const played = copiesOf(build, cardId);
  if (played >= CONSTRUCTED_COPY_LIMIT) return build;
  return { ...build, counts: { ...build.counts, [cardId]: played + 1 } };
}

/** Cuts one copy. The last copy removes the entry rather than leaving a zero. */
export function cutCopy(build: ConstructedBuild, cardId: string): ConstructedBuild {
  const played = copiesOf(build, cardId);
  if (played <= 0) return build;
  const counts = { ...build.counts };
  if (played === 1) delete counts[cardId];
  else counts[cardId] = played - 1;
  return { ...build, counts };
}

/** Cuts every copy of one card in a single gesture. */
export function cutAll(build: ConstructedBuild, cardId: string): ConstructedBuild {
  if (copiesOf(build, cardId) === 0) return build;
  const counts = { ...build.counts };
  delete counts[cardId];
  return { ...build, counts };
}

/** Empties the deck, leaving the pool and any counted mana base alone. */
export function clearDeck(build: ConstructedBuild): ConstructedBuild {
  return { ...build, counts: {} };
}

/**
 * Adds or removes one basic of a color.
 *
 * Starts from whatever base is in the deck right now, which on an untouched
 * build is the computed one, for the reason the sealed builder gives: starting
 * from empty because somebody clicked once would throw away twenty-three lands
 * to add one.
 */
export function adjustBasics(build: ConstructedBuild, color: Color, delta: number): ConstructedBuild {
  const current = basicsFor(build);
  return { ...build, basics: { ...current, [color]: Math.max(0, current[color] + delta) } };
}

/** Hands the deck back to the computed mana base. */
export function resuggestBasics(build: ConstructedBuild): ConstructedBuild {
  return { ...build, basics: null };
}

/** The basics in the deck as it stands, chosen or computed, all five colors listed. */
export function basicsFor(build: ConstructedBuild): Readonly<Record<Color, number>> {
  return deckFor(build).manaBase.landsByColor;
}

/**
 * The chosen spells, in pool order, one entry per copy.
 *
 * Pool order rather than the order they were added, so a deck reads the same
 * whichever way it was assembled and two builds of the same list are the same
 * list.
 */
export function chosenCards(build: ConstructedBuild): readonly Card[] {
  return build.pool.flatMap((card) => Array.from({ length: copiesOf(build, card.id) }, () => card));
}

/** How many cards are played, counting copies. */
export function spellCount(build: ConstructedBuild): number {
  return Object.values(build.counts).reduce((sum, played) => sum + played, 0);
}

/** The deck the current counts make, mana base included. */
export function deckFor(build: ConstructedBuild): ManualDeck {
  const spells = chosenCards(build);
  const config = constructedConfig({ set: build.set });
  return build.basics === null
    ? buildFromSpells(spells, build.pool, config)
    : buildFromSpells(spells, build.pool, config, build.basics);
}
