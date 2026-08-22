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
 * Distinct from `./ManaBasePanel`, which reports a finished artifact's mana base
 * and edits nothing.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BasicLandType, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES, COLORS } from '@mtg/dsl';
import type { ManualDeck } from '@mtg/deckbuild';

export const MANA_BASE_LABEL = 'Mana base';

/** The mana base's own suggest affordance, the twin of "Suggest a build". */
export const SUGGEST_BASICS_LABEL = 'Suggest a mana base';

/** Accessible names for the per-color controls, so a test can click one by name. */
export function addBasicLabel(type: BasicLandType): string {
  return `Add a ${type}`;
}

export function cutBasicLabel(type: BasicLandType): string {
  return `Cut a ${type}`;
}

const BASIC_FOR_COLOR: Readonly<Record<Color, BasicLandType>> = Object.fromEntries(
  BASIC_LAND_TYPES.map((type) => [BASIC_LAND_COLOR[type], type]),
) as Record<Color, BasicLandType>;

export interface BasicsPanelProps {
  readonly deck: ManualDeck;
  /** True when the counts on screen are the person's rather than the suggestion. */
  readonly chosen: boolean;
  /** Adds (+1) or cuts (-1) one basic of a color. */
  readonly onAdjustBasics: (color: Color, delta: number) => void;
  /** Hands the deck back to the mana base the picks apportion. */
  readonly onSuggestBasics: () => void;
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`;
}

function basicControl(
  color: Color,
  count: number,
  onAdjust: (color: Color, delta: number) => void,
): ReactElement {
  const type = BASIC_FOR_COLOR[color];
  return createElement(
    'span',
    { key: color, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, type),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-label': cutBasicLabel(type),
        disabled: count === 0,
        onClick: (): void => {
          onAdjust(color, -1);
        },
      },
      '-',
    ),
    createElement('span', { className: 'mtg-fact__value' }, String(count)),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
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
  return createElement(
    'div',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, MANA_BASE_LABEL),
      createElement(
        'span',
        { className: 'mtg-panel__note' },
        `${plural(deck.lands.length, 'land')} · ${chosen ? 'your count' : 'apportioned from your picks'}`,
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'p',
        { className: 'mtg-prompt__explain' },
        chosen
          ? 'Your own count stands until you ask for the suggestion back.'
          : 'Add or cut a basic and your count stands from then on.',
      ),
      createElement(
        'div',
        { className: 'mtg-toolbar', role: 'group', 'aria-label': MANA_BASE_LABEL },
        ...COLORS.map((color) =>
          basicControl(color, deck.manaBase.landsByColor[color], props.onAdjustBasics),
        ),
        createElement('span', { className: 'mtg-toolbar__spacer' }),
        createElement(
          'button',
          { type: 'button', className: 'mtg-btn', disabled: !chosen, onClick: props.onSuggestBasics },
          SUGGEST_BASICS_LABEL,
        ),
      ),
    ),
  );
}
