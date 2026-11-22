/**
 * One deck, as a tile somebody decides from.
 *
 * The same component wherever a deck is offered: the Play tab's preconstructed
 * grid and the Decks library. the playtester's instruction — "the same `DeckCard`
 * component used in Play and Decks" — is the whole reason it is here rather
 * than inside `../play/PreconPicker.ts`, where it started. The Decks tab used to
 * offer the identical five decks as a row of `Name · preconstructed` pill
 * buttons, so the two screens showed the same thing twice and agreed on nothing.
 *
 * # A button, and only a button
 *
 * It inherits focus, press and disabled behavior from the chrome sheet rather
 * than restating them, and it carries `aria-pressed` as well as the accent fill,
 * because a person choosing between five tiles under WCAG 1.4.1 cannot be asked
 * to see a hue. `actionLabel` is the accessible name and is a verb phrase — *Play
 * The Sky Islands*, *Open Mono-red burn* — since "The Sky Islands" alone
 * announces as a caption and gives a screen-reader user no reason to press it.
 *
 * # Optional regions rather than two components
 *
 * A precon states a plan and a centerpiece; a deck somebody saved this morning
 * states neither. The regions are optional and absent ones are not drawn, so a
 * sparse card is a short card in the same grid rather than a second tile shape
 * with its own spacing.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { COLORS } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import { colorToIdentity } from '../../card/identity';
import { registryPip } from '../../card/ManaPips';
import { colorWord, DEFAULT_SYMBOL_SET } from '../../card/symbols';

/**
 * Where a deck came from, which is the difference a person has to see before
 * they press anything.
 *
 * The kinds behave differently and the difference is not recoverable from the
 * tile's other regions: a `precon` is written into the staged set's decks file
 * and comes and goes with that set, a `saved` deck is in this browser's storage
 * and survives every set swap, an `artifact` is `@mtg/decklab`'s document about
 * real printings out of the card store, which no staged set prints at all, and a
 * `variation` is a deck the workbench built, which lives on the deck server and
 * is gone from this tab the moment that server stops. Deleting the wrong one of
 * those four is four different outcomes, so the tile says which it is rather
 * than leaving the name to carry it.
 */
export const DECK_CARD_KINDS = ['precon', 'saved', 'artifact', 'variation'] as const;
export type DeckCardKind = (typeof DECK_CARD_KINDS)[number];

/**
 * What each kind is called on the tile: what it *is*, in the fewest words that
 * are still true. *Saved here* rather than *Saved*, because the whole content of
 * the distinction is that the deck is on this browser and nowhere else.
 */
export const DECK_CARD_KIND_LABELS: Readonly<Record<DeckCardKind, string>> = {
  precon: 'Preconstructed',
  saved: 'Saved here',
  artifact: 'Built from the card store',
  variation: 'Built from a description',
};

export interface DeckCardProps {
  readonly name: string;
  /** Drawn as a badge, and as the tile's `data-kind` for the sheet to color. */
  readonly kind?: DeckCardKind;
  /**
   * The deck's color identity, as the letters a Magic player reads. Empty draws
   * `colorless`, which is a real identity rather than a missing one.
   */
  readonly colors: readonly string[];
  /** The one-clause archetype description. A precon's plan; a saved deck has none. */
  readonly plan?: string;
  /** The card the deck is built around, drawn as a sentence. */
  readonly centerpiece?: string;
  /** The secondary counts, already composed into one line. */
  readonly counts?: string;
  readonly selected?: boolean;
  /** The accessible name, which is what pressing the tile does. */
  readonly actionLabel: string;
  readonly onSelect: () => void;
}

/** The class the grid of these takes. Named here so no caller spells it twice. */
export const DECK_CARD_GRID_CLASS = 'mtg-deckcards';

/** What a deck with no colored mana in its base is called, rather than nothing. */
export const COLORLESS_LABEL = 'colorless';

const KNOWN_COLORS = new Set<string>(COLORS);

/**
 * A deck's colors, narrowed to the letters the mana registry actually draws.
 *
 * `colors` arrives as `readonly string[]` rather than `readonly Color[]`
 * because one source (`VariationSummary`, the workbench shelf) defaults a
 * missing field to `[]` rather than enumerating it, so an older server has
 * somewhere to land. Every value this tile has ever been handed is a real
 * WUBRG letter; an unrecognized one is dropped rather than drawn as a pip the
 * registry has no art for.
 */
function knownColors(colors: readonly string[]): readonly Color[] {
  return colors.filter((color): color is Color => KNOWN_COLORS.has(color));
}

/**
 * A deck's color identity, drawn as the same mana-registry pips a card face
 * draws rather than as bare letters — `mtg-aay2k`. Everything else on screen
 * that shows a mana symbol reads `@mtg/render-spec`'s registry; this was the
 * one place still spelling a color out, because it predates `../../card/ManaPips.ts`
 * taking a bare token instead of a full `ManaCost`.
 */
export function deckColorPips(colors: readonly string[]): ReactElement {
  const known = knownColors(colors);
  return createElement(
    'span',
    {
      className: 'mtg-deckcard__colors',
      role: 'img',
      'aria-label':
        known.length === 0 ? COLORLESS_LABEL : known.map((color) => colorWord(color) ?? color).join(', '),
    },
    known.length === 0
      ? COLORLESS_LABEL
      : known.map((color) => registryPip(color, color, colorToIdentity(color), DEFAULT_SYMBOL_SET, color)),
  );
}

/** The counts line every deck card writes, so two callers cannot punctuate it differently. */
export function deckCountsLine(parts: readonly string[]): string {
  return parts.join(' · ');
}

/**
 * A count and the thing it counts, agreeing.
 *
 * Every noun on this line is regular, so the rule is the `s`. It is a function
 * rather than four literals because the literals were written plural and one of
 * them was written singular: the shipped tile read "19 creatures · 36 spells ·
 * 24 lands · 14 rare".
 */
export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a deck tile counts, which is the same four numbers wherever it is drawn. */
export interface DeckCardCounts {
  readonly creatures: number;
  readonly spells: number;
  readonly lands: number;
  /** Rare *or better*; `../play/precon-facts.ts` says why the word covers mythics. */
  readonly rares: number;
}

/**
 * The four numbers under a preconstructed deck's plan.
 *
 * One function because there is one line: the Play landing and the Decks library
 * draw the same tile from the same facts, and building the parts at each call
 * site is how they came to disagree about anything at all.
 *
 * The second number is `spells` minus `creatures`, and the noun says so. The
 * tile used to print `spells` whole, which is every nonland card, so Wield the
 * Obliterator read "19 creatures · 36 spells · 24 lands" — 79 cards for a deck
 * of 60, with the 19 counted twice. The deck the tile opens has always said
 * "17 noncreature spells" in its own summary (`../DeckRoute.ts` subtracts there
 * and has since it was written), so the two screens contradicted each other two
 * clicks apart. Subtracting here rather than adding a fifth number keeps the
 * line four wide and makes it sum to the deck size, which is the arithmetic a
 * reader actually does with it.
 */
export function preconCountsLine(counts: DeckCardCounts): string {
  return deckCountsLine([
    counted(counts.creatures, 'creature'),
    counted(counts.spells - counts.creatures, 'noncreature spell'),
    counted(counts.lands, 'land'),
    counted(counts.rares, 'rare'),
  ]);
}

export function DeckCard(props: DeckCardProps): ReactElement {
  const selected = props.selected === true;
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-deckcard',
      'aria-pressed': selected,
      'data-selected': selected ? 'true' : undefined,
      'data-kind': props.kind,
      'aria-label': props.actionLabel,
      onClick: props.onSelect,
    },
    createElement(
      'span',
      { className: 'mtg-deckcard__head' },
      createElement('span', { className: 'mtg-deckcard__name' }, props.name),
      props.kind === undefined
        ? null
        : createElement('span', { className: 'mtg-deckcard__kind' }, DECK_CARD_KIND_LABELS[props.kind]),
      deckColorPips(props.colors),
    ),
    props.plan === undefined ? null : createElement('span', { className: 'mtg-deckcard__plan' }, props.plan),
    props.centerpiece === undefined
      ? null
      : createElement('span', { className: 'mtg-deckcard__payoff' }, `Built around ${props.centerpiece}.`),
    props.counts === undefined
      ? null
      : createElement('span', { className: 'mtg-deckcard__counts' }, props.counts),
  );
}
