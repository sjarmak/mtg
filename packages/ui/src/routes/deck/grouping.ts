/**
 * What the columns are, under one control.
 *
 * `mtg-ar3c` was filed to settle the Sort menu and stalled twice, because the
 * menu is closed in every capture we have — including the three added on
 * 2026-08-29. the playtester settled it directly instead: **one control**, four
 * groupings, and inside a column always by name.
 *
 * One rather than the capture's two. MTGO carries a Group control and a Sort
 * control in the same header bar, and the second one buys almost nothing here: a
 * column holds ten strips, sorting them by power rather than by name changes
 * which of ten rows a reader's eye lands on first, and it costs a permanent
 * second menu in a header that already carries Details and View. So the order
 * inside a column is fixed at name, ascending, and the header keeps one menu.
 *
 * # Why an axis is offered rather than listed
 *
 * Rarity is on a DSL card and is not on a built artifact's entry
 * (`../../lab/deck-artifact.ts`'s `EntrySchema`), because the producer writes
 * down what it selected on and it never selected on rarity. A menu that lists
 * Rarity over a deck whose cards cannot answer it is a control that does nothing
 * when pressed, which is worse than a control that is not there. So the caller
 * hands over the facts and `offeredGroupings` reads them: an axis is offered when
 * every member can answer it, and the artifact pane simply gets three.
 *
 * # Why the caller states the facts rather than passing cards
 *
 * Four panes group, and they hold four different things — an artifact entry, a
 * DSL card out of a Constructed build, a `{ card, count }` pair out of a precon,
 * and a drafted pool's picks — none of which is willing to become one of the
 * others. `./columns.ts` made this argument first and made the grouping generic
 * over the member; the same argument holds one axis further out, so the member
 * stays opaque and the caller says what it knows about it.
 *
 * # Weighing, kept from `./columns.ts`
 *
 * `valueOf` and `weigh` were two functions there for a reason that survives:
 * the number above a column counts **cards**, so a four-of contributes four in
 * the deck pane, while the pool pane lists each playable card once and weighs it
 * as one. The invariant `./columns.ts` spends its length on — the numbers above
 * the columns sum to the number in the pane's own header — is the same invariant
 * here and does not depend on which axis is chosen, because every axis
 * partitions the same members.
 */
import { colorWord } from '../../card/symbols';

/** The axes a pane can group its columns by. */
export const GROUPINGS = ['manaValue', 'color', 'cardType', 'rarity'] as const;

export type Grouping = (typeof GROUPINGS)[number];

/** Mana value, which is what both captures default to and what we shipped. */
export const DEFAULT_GROUPING: Grouping = 'manaValue';

/** How the control names an axis in its menu. */
export function groupingLabel(grouping: Grouping): string {
  if (grouping === 'manaValue') return 'Mana value';
  if (grouping === 'color') return 'Color';
  if (grouping === 'cardType') return 'Card type';
  return 'Rarity';
}

/** Reads a stored or hand-typed value, or `null` when it names no axis. */
export function parseGrouping(raw: string | undefined | null): Grouping | null {
  if (raw === undefined || raw === null) return null;
  return (GROUPINGS as readonly string[]).includes(raw) ? (raw as Grouping) : null;
}

/**
 * What a member has to be able to answer.
 *
 * `rarity` is nullable rather than absent so a pane of mixed provenance is
 * expressible and `offeredGroupings` has something to read. `colorIdentity` is
 * the letters, in any order — this file sorts them — and the empty string is
 * colorless, which is a real answer rather than a missing one.
 */
export interface GroupingFacts {
  /** What a column sorts by inside itself, always. */
  readonly name: string;
  readonly manaValue: number;
  /** WUBRG letters in any order; empty is colorless. */
  readonly colorIdentity: string;
  /** The printed type line, read the way `./type-counts.ts` reads it. */
  readonly typeLine: string;
  /** `null` when the member's source does not record one. See the docblock. */
  readonly rarity: string | null;
}

/** One column: what it is, how many cards, and the members in drawing order. */
export interface Group<T> {
  /** Stable across renders and across axes, so a selection survives a regroup. */
  readonly key: string;
  /** What the column is, without its count. `Mana value 3`, `White`, `Creature`. */
  readonly label: string;
  /** Cards, not members: the sum of what `weigh` said each member is worth. */
  readonly cards: number;
  /** Sorted by name, ascending, per the decision this file's docblock records. */
  readonly members: readonly T[];
  /**
   * Present only under `manaValue`, so a head can draw the pip `./columns.ts`
   * argues for and every other axis draws a word instead.
   */
  readonly manaValue: number | null;
  /**
   * The mana symbol this bucket *is*, where it is one, so a head can draw the
   * pip instead of the word.
   *
   * `mtg-84703`. A pool grouped by color drew `White`, `Blue`, `Black` over its
   * columns, and the playtester read that as space the cards could have had: "no need
   * to put White , Blue , Black etc text labels but just a small indicator of
   * the count for each color would be sufficient". A pip is the indicator this
   * app already has, the pool's own facet buttons are built out of it
   * (`./PoolFacets.ts`), and a column of white cards under `{W}` is the same
   * sentence four fifths narrower.
   *
   * `null` on every bucket that is not one symbol, which is `Multicolor` and
   * every card-type and rarity bucket. Multicolor collects many identities and
   * the registry prints no token for the idea, so it keeps its word rather than
   * being given an invented glyph.
   */
  readonly symbol: string | null;
}

const COLOR_ORDER = 'WUBRG';

/**
 * A column head is a heading, and `colorWord` answers a different question.
 *
 * It exists so the only spelling of "white" on this surface is the one the rules
 * text uses (`./deck-counts.ts` takes it for that reason), and rules text says
 * "white" mid-sentence. A head sits beside `Multicolor` and `Colorless`, so it
 * is cased here rather than a second spelling being introduced there.
 *
 * Exported because a chip is the same question as a head: `./workbench/
 * CriteriaForm.ts` had grown a fourth table of color words, and a fourth table
 * is a fourth chance for this surface to spell "white" a way the rules text does
 * not.
 */
export function heading(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * The five, then multicolor, then colorless.
 *
 * Magic's own order, which is the order every printed product uses and the order
 * the mana symbols already sit in on a cost. Multicolor before colorless rather
 * than after because a colorless column is usually the artifacts and the lands,
 * and those read as the tail of a deck list rather than its middle.
 */
function colorKey(identity: string): Omit<Bucket, 'manaValue'> {
  const letters = [...new Set(identity.toUpperCase().split(''))]
    .filter((letter) => COLOR_ORDER.includes(letter))
    .sort((left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right));
  if (letters.length === 0) return { key: 'color:C', label: 'Colorless', order: 7, symbol: 'C' };
  if (letters.length > 1) return { key: 'color:M', label: 'Multicolor', order: 6, symbol: null };
  const letter = letters[0] ?? '';
  return {
    key: `color:${letter}`,
    label: heading(colorWord(letter) ?? letter),
    order: COLOR_ORDER.indexOf(letter),
    symbol: letter,
  };
}

/**
 * Land first, then creature, then the rest.
 *
 * The first two and their order are `./type-counts.ts`'s, restated here rather
 * than re-argued: a permanent that taps for mana answers "does this deck have
 * enough lands" whatever else it is, and counting a creature-land as a creature
 * understates the mana base. What is new is the tail, and it is ordered so that
 * a card which is two types lands in the more specific one — an artifact
 * creature is a creature, an enchantment creature is a creature — which falls
 * out of putting `Artifact` and `Enchantment` last rather than out of a rule.
 *
 * `Other` is the complement, for `./type-counts.ts`'s reason: a type nobody has
 * printed yet is grouped truthfully on the day it exists, and the counts above
 * the columns keep summing to the pane's own header.
 */
const TYPE_ORDER = [
  'Land',
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Enchantment',
  'Artifact',
] as const;

function typeKey(typeLine: string): Omit<Bucket, 'manaValue'> {
  for (const [order, type] of TYPE_ORDER.entries()) {
    // Word-bounded for `./type-counts.ts`'s reason: `Land` has to be a type on
    // the line and not the tail of a creature type.
    if (new RegExp(`(?:^|\\s)${type}(?:\\s|$)`, 'u').test(typeLine)) {
      return { key: `type:${type}`, label: type, order, symbol: null };
    }
  }
  return { key: 'type:Other', label: 'Other', order: TYPE_ORDER.length, symbol: null };
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'] as const;

function rarityKey(rarity: string | null): Omit<Bucket, 'manaValue'> {
  const found = RARITY_ORDER.indexOf((rarity ?? '').toLowerCase() as (typeof RARITY_ORDER)[number]);
  if (found < 0)
    return { key: 'rarity:unknown', label: 'Unknown rarity', order: RARITY_ORDER.length, symbol: null };
  const word = RARITY_ORDER[found] ?? '';
  return { key: `rarity:${word}`, label: heading(word), order: found, symbol: null };
}

interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly order: number;
  readonly manaValue: number | null;
  readonly symbol: string | null;
}

function bucketFor(facts: GroupingFacts, grouping: Grouping): Bucket {
  if (grouping === 'color') return { ...colorKey(facts.colorIdentity), manaValue: null };
  if (grouping === 'cardType') return { ...typeKey(facts.typeLine), manaValue: null };
  if (grouping === 'rarity') return { ...rarityKey(facts.rarity), manaValue: null };
  return {
    key: `mv:${String(facts.manaValue)}`,
    label: `Mana value ${String(facts.manaValue)}`,
    order: facts.manaValue,
    manaValue: facts.manaValue,
    symbol: String(facts.manaValue),
  };
}

/**
 * Which axes this pane's members can all answer.
 *
 * Only rarity can go missing today, so this reads as a single test; it is
 * written over the whole fact set anyway because the next axis that cannot be
 * answered by an artifact entry should not need this function rewritten. An
 * empty pane offers everything: there is no member to fail the test, and a menu
 * that shrinks when the deck empties is a control that moves under the reader.
 */
export function offeredGroupings(facts: readonly GroupingFacts[]): readonly Grouping[] {
  const rarityKnown = facts.every((fact) => fact.rarity !== null);
  return GROUPINGS.filter((grouping) => grouping !== 'rarity' || rarityKnown);
}

/**
 * Groups the members onto one axis, present buckets only.
 *
 * Never contiguous: an empty column claims a card belongs there, which is
 * `./columns.ts`'s rule and the reason `./build.ts`'s `manaCurve` is a separate
 * drawing that does want the gaps.
 */
export function groupMembers<T>(
  members: readonly T[],
  factsOf: (member: T) => GroupingFacts,
  weigh: (member: T) => number,
  grouping: Grouping,
): readonly Group<T>[] {
  const buckets = new Map<string, { bucket: Bucket; members: T[] }>();
  for (const member of members) {
    const bucket = bucketFor(factsOf(member), grouping);
    const held = buckets.get(bucket.key);
    if (held === undefined) buckets.set(bucket.key, { bucket, members: [member] });
    else held.members.push(member);
  }
  return [...buckets.values()]
    .sort((left, right) => left.bucket.order - right.bucket.order)
    .map(({ bucket, members: held }) => ({
      key: bucket.key,
      label: bucket.label,
      manaValue: bucket.manaValue,
      symbol: bucket.symbol,
      cards: held.reduce((sum, member) => sum + weigh(member), 0),
      members: [...held].sort((left, right) => factsOf(left).name.localeCompare(factsOf(right).name)),
    }));
}

/**
 * A column head as it is spoken rather than drawn.
 *
 * The visible head is a number, and under `manaValue` a mana pip beside it, for
 * the reason `./columns.ts` gives: a bare `3` above a column of three-drops is
 * ambiguous between the value and the count. A screen reader gets this sentence
 * instead, because a pip's accessible name is the pip and not what a column of
 * them means.
 */
export function groupHeadLabel(group: Group<unknown>): string {
  return `${group.label}, ${String(group.cards)} ${group.cards === 1 ? 'card' : 'cards'}`;
}

/**
 * A column head as it is drawn where the head is text rather than a pip.
 *
 * `./StripColumns.ts` draws the mana value as a pip through the symbol
 * registry, which is the arrangement the captures show. The two builders draw
 * their compact columns as card faces under a text head, and there the value is
 * abbreviated the way it was before the axes existed: `Mana value 3` is four
 * times the width of the column it is heading. Every other axis names itself in
 * a word already short enough to draw, so only this one abbreviates.
 *
 * The spoken form is `groupHeadLabel` in both cases, so the abbreviation never
 * reaches a screen reader.
 */
export function groupHeadText(group: Group<unknown>): string {
  return group.manaValue === null ? group.label : `MV ${String(group.manaValue)}`;
}

/**
 * A column head as a printed mana token, or `null` where it has to stay a word.
 *
 * The one place both head drawings ask the same question. `./StripColumns.ts`
 * has painted the mana value since 2026-08-29 and `./CurveColumns.ts` printed
 * `MV 3`; `mtg-84703` extends the pip to the color axis, and two components
 * deciding separately which buckets have a symbol is two chances to disagree
 * about Multicolor.
 *
 * The token is printed in braces because that is the only form
 * `../../card/SymbolText.ts` reads, and both callers hand the result to
 * `symbolizeLine`, whose own rule is that a token the registry does not carry
 * comes back as its own text. So a mana value past `MAX_GENERIC_SYMBOL` draws
 * `{13}` rather than nothing, which is a legible head and not a hole.
 */
export function groupHeadToken(group: Group<unknown>): string | null {
  return group.symbol === null ? null : `{${group.symbol}}`;
}
