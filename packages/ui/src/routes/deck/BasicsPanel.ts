/**
 * The mana base as five counts a person can move.
 *
 * All five colors are always shown, including the ones at zero: a splash starts
 * as a basic that is not there yet, and a panel that hid the empty colors would
 * be a panel that could not add one. The note says which base is on screen,
 * because "17 lands" reads the same whether it was apportioned or counted out
 * and only one of those is undoable.
 *
 * Shared by the sealed builder and the Constructed one. It was the sealed
 * screen's private function until Constructed needed the identical control, and
 * the two would have had to keep the same five labels right in two files —
 * which is the same reason `BASIC_FOR_COLOR` below is read off the DSL's
 * vocabulary rather than listed again.
 *
 * # One row, not a panel
 *
 * The playtester's UI pass: "replace the large mana base panel with a compact
 * control: `Lands 24  W 5 U 5 B 5 R 5 G 4`". A bordered box with a title, a
 * note and a sentence of explanation was three lines of chrome around five
 * numbers, on a screen whose subject is the cards beside it. What survives is
 * the five counts, their two buttons each, and the one word that says whose
 * count is on screen; the shared mana glyph carries the color at a glance and
 * its accessible label names the basic land outright.
 *
 * Distinct from `./ManaBasePanel`, which reports a finished artifact's mana base
 * and edits nothing.
 */
import { createElement, useId } from 'react';
import type { ReactElement } from 'react';
import type { BasicLandType, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES, COLORS } from '@mtg/dsl';
import { symbolElement } from '../../card/SymbolText';
import { DEFAULT_SYMBOL_SET } from '../../card/symbols';
import type { SymbolSet } from '../../card/symbols';
import { withArticle } from './article';

export const MANA_BASE_LABEL = 'Mana base';

/** The mana base's own suggest affordance, the twin of "Suggest a build". */
export const SUGGEST_BASICS_LABEL = 'Suggest a mana base';

/**
 * The caption beside the counts, which is also why Suggest is or is not live.
 *
 * `mtg-0j5aw4`. The caption used to be the single word `suggested`, next to a
 * Suggest button that was disabled with nothing saying why: a control that
 * refuses a press owes the reason, and here the reason is that the counts on
 * screen already are the suggestion, so there is nothing for it to restore.
 * The disabled button names this caption as its accessible description, so a
 * screen reader hears the same reason a sighted reader sees.
 */
export const BASICS_CAPTION = { chosen: 'your count', suggested: 'already the suggestion' } as const;

/** Accessible names for the per-color controls, so a test can click one by name. */
export function addBasicLabel(type: BasicLandType): string {
  return `Add ${withArticle(type)}`;
}

export function cutBasicLabel(type: BasicLandType): string {
  return `Cut ${withArticle(type)}`;
}

const BASIC_FOR_COLOR: Readonly<Record<Color, BasicLandType>> = Object.fromEntries(
  BASIC_LAND_TYPES.map((type) => [BASIC_LAND_COLOR[type], type]),
) as Record<Color, BasicLandType>;

export interface BasicsPanelProps {
  readonly deck: {
    readonly lands: { readonly length: number };
    readonly manaBase: { readonly landsByColor: Readonly<Record<Color, number>> };
  };
  /** True when the counts on screen are the person's rather than the suggestion. */
  readonly chosen: boolean;
  /** Adds (+1) or cuts (-1) one basic of a color. */
  readonly onAdjustBasics: (color: Color, delta: number) => void;
  /** Hands the deck back to the mana base the picks apportion. */
  readonly onSuggestBasics: () => void;
  /** The same staged/offline symbol selection used by card faces. */
  readonly symbols?: SymbolSet;
}

function basicControl(
  color: Color,
  count: number,
  onAdjust: (color: Color, delta: number) => void,
  symbols: SymbolSet,
): ReactElement {
  const type = BASIC_FOR_COLOR[color];
  const glyph = symbolElement(`basic-${color}`, color, symbols);
  if (glyph === null) throw new Error(`BasicsPanel: symbol registry has no {${color}}`);
  return createElement(
    'span',
    { key: color, className: 'mtg-manabar__color', 'data-color': color },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-manabar__step',
        'aria-label': cutBasicLabel(type),
        disabled: count === 0,
        onClick: (): void => {
          onAdjust(color, -1);
        },
      },
      '-',
    ),
    createElement('span', { className: 'mtg-manabar__pip', role: 'img', 'aria-label': type }, glyph),
    createElement('span', { className: 'mtg-manabar__count' }, String(count)),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-manabar__step',
        'aria-label': addBasicLabel(type),
        onClick: (): void => {
          onAdjust(color, 1);
        },
      },
      '+',
    ),
  );
}

export function BasicsPanel(props: BasicsPanelProps): ReactElement {
  const { chosen, deck } = props;
  const symbols = props.symbols ?? DEFAULT_SYMBOL_SET;
  const noteId = useId();
  return createElement(
    'div',
    { className: 'mtg-manabar', role: 'group', 'aria-label': MANA_BASE_LABEL },
    // The word and the number are one box rather than two siblings: on a phone
    // `../../styles/deck-mobile.ts` gives them a row of their own so the five
    // color groups below can line up in columns, and a wrap that can fall
    // between "Lands" and "24" is a row that reads as a stray number.
    createElement(
      'span',
      { className: 'mtg-manabar__lands' },
      createElement('span', { className: 'mtg-manabar__label' }, 'Lands'),
      createElement('span', { className: 'mtg-manabar__total' }, String(deck.lands.length)),
    ),
    ...COLORS.map((color) =>
      basicControl(color, deck.manaBase.landsByColor[color], props.onAdjustBasics, symbols),
    ),
    createElement(
      'span',
      { id: noteId, className: 'mtg-manabar__note' },
      chosen ? BASICS_CAPTION.chosen : BASICS_CAPTION.suggested,
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        disabled: !chosen,
        'aria-label': SUGGEST_BASICS_LABEL,
        ...(chosen ? {} : { 'aria-describedby': noteId }),
        onClick: props.onSuggestBasics,
      },
      'Suggest',
    ),
  );
}
