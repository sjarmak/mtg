/**
 * The controls a dealt precon table owns, behind one word: **Game**.
 *
 * `LiveGame` takes a `toolbar` node from whatever dealt the game and puts it at
 * the end of the one strip above the table, which is where these belong: they
 * are not legal moves and the kernel enumerates none of them, so they take the
 * button vocabulary rather than the rail's (the same rule `rail.ts` states for
 * its "New game" button).
 *
 * # A menu, because none of it is a move
 *
 * They were three controls open on the strip — a seed printed in full, a
 * reshuffle, and a link — and the playtester's UI pass named that strip outright:
 * "remove the seed / Reshuffle / Kaelen-to-this-game strip; put technical
 * information under Game details". Every one of them is a thing you go looking
 * for once a game, and they sat across the top of the board for all of it,
 * spending the width the turn and phase state wanted. So they are a `Game`
 * button and a small sheet under it, and what the board keeps is one word.
 *
 * The seed is in that sheet rather than gone. It is requirement two of `mtg`
 * precon reshuffling: a game that cannot be named cannot be reported, argued
 * about, or measured, and the whole engine's bargain is that seed plus the
 * choice list is the entire record of a game
 * (`packages/engine/src/determinism.ts`). What changed is the label — *Game ID*,
 * because "seed" is a word about the shuffler and this is the name of the game
 * — and that a player reads it when they want it. `../game-details.ts` owns
 * that label now: the sealed builder and the replay toolbar say it too.
 *
 * # The three controls, and why each one exists
 *
 * **Reshuffle** draws a fresh seed and deals again. It is here rather than on
 * the picker because the picker cannot be returned to without a mount, and a
 * mount already draws a fresh seed — a reshuffle there would restyle a string
 * nobody has acted on yet. The table is the only place where the game you have
 * is the game you are stuck with.
 *
 * **It asks first, and that is not politeness.** A game in progress is minutes
 * of somebody's decisions and there is no undo across a deal, so the control
 * arms on the first press and deals on the second, saying in its own accessible
 * name what the second press costs. Two presses rather than a dialog: this
 * surface has no modal layer, and a panel drawn over the board would owe
 * `dismiss.ts` an Escape route for one confirmation.
 *
 * **Kaelen to this game** is what keeps the URL honest in the other direction.
 * Playing writes `#/play?deck=&against=` and no seed, so a reload deals a new game —
 * that is the defect this lane fixes. A player who wants *this* deal back
 * presses this, the seed goes into the hash, and the link reproduces it. The
 * hash therefore always describes what a reload would give you, which is the
 * invariant worth holding on to: a seed in it means pinned, no seed means
 * fresh.
 *
 * # The sheet dismisses the way every other panel over this board does
 *
 * `./dismiss.ts` binds Escape and an outside press while it is open, and the
 * ring goes back to the `Game` button when Escape was the way out — the
 * argument for both is in that file, written the day the stops panel covered
 * the opponent's life total for thirty clicks.
 */
import { createElement, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { GAME_ID_LABEL } from '../game-details';
import { useDismissable } from './dismiss';
import { asContainer, asFocusable } from './focus';
import type { ContainerNode, FocusableNode } from './focus';

/** The one word left on the strip, and the sheet it opens. */
export const PRECON_MENU_LABEL = 'Game';
export const PRECON_DETAILS_LABEL = 'Game details';

/** One label for one fact, wherever it is read: `../game-details.ts`. */
export const PRECON_TABLE_SEED_LABEL = GAME_ID_LABEL;
export const PRECON_RESHUFFLE_LABEL = 'Reshuffle';
export const PRECON_RESHUFFLE_CONFIRM_LABEL = 'Discard this game and reshuffle';
export const PRECON_PIN_LABEL = 'Kaelen to this game';
export const PRECON_PINNED_LABEL = 'Linked';

const SHEET_ID = 'mtg-game-menu';

export interface PreconStripProps {
  /** The seed of the deal on screen, which is the name of this game. */
  readonly seed: string;
  /** True once the first press has armed the reshuffle. */
  readonly armed: boolean;
  readonly onArm: () => void;
  readonly onReshuffle: () => void;
  /**
   * Writes the seed into the hash. Absent for a caller with no router, the same
   * way `PreconGame`'s `onSelect` is: what is lost is the shareable link, not
   * the reproducibility, since the seed is in the sheet either way.
   */
  readonly onPin?: (() => void) | undefined;
  /** True once the hash carries this game's seed, so the button says so. */
  readonly pinned: boolean;
}

function seedFact(seed: string): ReactElement {
  return createElement(
    'span',
    { className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, PRECON_TABLE_SEED_LABEL),
    createElement('span', { className: 'mtg-fact__value' }, seed),
  );
}

export function PreconStrip(props: PreconStripProps): ReactElement {
  const [open, setOpen] = useState(false);
  const head = useRef<FocusableNode | null>(null);
  const root = useRef<ContainerNode | null>(null);

  useDismissable({
    open,
    within: (): ContainerNode | null => root.current,
    onDismiss: (via): void => {
      setOpen(false);
      if (via === 'escape') head.current?.focus();
    },
  });

  const reshuffle = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      ...(props.armed ? { 'data-variant': 'primary' } : {}),
      // The armed state is said in the name rather than only in the styling,
      // because a screen reader is the reader most likely to press a button
      // twice and it must be told what the second press does.
      'aria-label': props.armed ? PRECON_RESHUFFLE_CONFIRM_LABEL : PRECON_RESHUFFLE_LABEL,
      onClick: props.armed ? props.onReshuffle : props.onArm,
    },
    props.armed ? PRECON_RESHUFFLE_CONFIRM_LABEL : PRECON_RESHUFFLE_LABEL,
  );

  return createElement(
    'div',
    {
      className: 'mtg-gamemenu',
      'data-open': open,
      ref: (node: unknown): void => {
        root.current = asContainer(node);
      },
    },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-gamemenu__head',
        'aria-expanded': open,
        'aria-controls': SHEET_ID,
        ref: (node: unknown): void => {
          head.current = asFocusable(node);
        },
        onClick: (): void => {
          setOpen(!open);
        },
      },
      PRECON_MENU_LABEL,
      createElement('span', { className: 'mtg-gamemenu__caret', 'aria-hidden': true }, '▾'),
    ),
    open
      ? createElement(
          'div',
          {
            id: SHEET_ID,
            className: 'mtg-gamemenu__sheet',
            role: 'group',
            'aria-label': PRECON_DETAILS_LABEL,
          },
          seedFact(props.seed),
          reshuffle,
          props.onPin === undefined
            ? null
            : createElement(
                'button',
                {
                  type: 'button',
                  className: 'mtg-btn',
                  disabled: props.pinned,
                  'aria-label': props.pinned ? PRECON_PINNED_LABEL : PRECON_PIN_LABEL,
                  onClick: props.onPin,
                },
                props.pinned ? PRECON_PINNED_LABEL : PRECON_PIN_LABEL,
              ),
        )
      : null,
  );
}
