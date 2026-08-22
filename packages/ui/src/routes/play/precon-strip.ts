/**
 * The controls a dealt precon table owns: its seed, a reshuffle, and a link.
 *
 * `LiveGame` takes a `toolbar` node from whatever dealt the game and puts it at
 * the end of the one strip above the table, which is where these belong: they
 * are not legal moves and the kernel enumerates none of them, so they take the
 * button vocabulary rather than the rail's (the same rule `rail.ts` states for
 * its "New game" button).
 *
 * # Three controls, and why each one exists
 *
 * **The seed fact** is requirement two of `mtg` precon reshuffling: a game that
 * cannot be named cannot be reported, argued about, or measured, and the whole
 * engine's bargain is that seed plus the choice list is the entire record of a
 * game (`packages/engine/src/determinism.ts`). The picker printed it and then
 * the table swallowed it; now it is on screen for the whole game.
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
 * Playing writes `#/play?deck=&vs=` and no seed, so a reload deals a new game —
 * that is the defect this lane fixes. A player who wants *this* deal back
 * presses this, the seed goes into the hash, and the link reproduces it. The
 * hash therefore always describes what a reload would give you, which is the
 * invariant worth holding on to: a seed in it means pinned, no seed means
 * fresh.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';

export const PRECON_TABLE_SEED_LABEL = 'seed';
export const PRECON_RESHUFFLE_LABEL = 'Reshuffle';
export const PRECON_RESHUFFLE_CONFIRM_LABEL = 'Discard this game and reshuffle';
export const PRECON_PIN_LABEL = 'Kaelen to this game';
export const PRECON_PINNED_LABEL = 'Linked';

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
   * the reproducibility, since the seed is on screen either way.
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
    Fragment,
    null,
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
  );
}
