/**
 * Whether the pool draws the foil it can name, and the control that says so.
 *
 * The playtester's phrasing on the parent bead was "enable options for", so this is a
 * setting rather than an always-on treatment. Three decisions were open and the
 * code is where they are recorded.
 *
 * # Where the control lives
 *
 * In the builder's own toolbar, and **only on a pool that measured its slots**.
 * `@mtg/deckbuild`'s `foilPositions` answers `null` for a pool dealt by rarity,
 * which has no foil slot to deal off at all, and for a collation that never
 * stated the flag; a build carries that `null` through as `SealedBuild.foils`.
 * A toggle on such a pool would offer a choice between two identical screens,
 * so there is no toggle there. That also makes the control self-explaining: it
 * appears exactly on the printings that deal foils, which is the same set of
 * pools the treatment can appear on.
 *
 * There is no page of settings in this lab to put it on instead, and inventing
 * one for a single checkbox would put the switch a route away from the only
 * screen it changes.
 *
 * # Why it defaults on
 *
 * `mtg-11yd` exists because a foil arrived as an ordinary duplicate and nothing
 * downstream could tell the two apart. Defaulting the drawing off would leave
 * that true for everybody who never finds this button, which is most people, so
 * the default would quietly keep the defect it was filed to close. The usual
 * argument for defaulting an animation off is answered separately and better:
 * `../../styles/card.ts` holds a static tint under `prefers-reduced-motion`, so
 * a viewer who asked for less motion still gets the distinction.
 *
 * # Why it is stored the way the other view preferences are
 *
 * It is view state, not game state. Nothing here enters a deck, a pool or a
 * fingerprint; the pool deals the same cards in the same order whichever way
 * this is set. `../deck/view-mode.ts` settled the mechanism for exactly this
 * kind of preference and this is that mechanism: one key in `localStorage`
 * through `../deck/local-store.ts`, a stored value that is not one of the two
 * words treated as nothing stored, and a write whose failure is dropped because
 * a preference that cannot be kept behaves like a first visit.
 *
 * Unlike a pane's density it is one setting for the page rather than one per
 * pane. A foil is a fact about a copy, and the copy is the same object whether
 * it is sitting in the pool or in the deck being built; a screen that drew it in
 * one pane and not the other would be saying two different things about one
 * card.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { readStored, writeStored } from '../deck/local-store';

const ON = 'on';
const OFF = 'off';

/** Where the answer is kept. Namespaced like every other key in this lab. */
export const FOIL_STORE_KEY = 'mtg.play.foil';

/** Drawn until somebody says otherwise. The docblock argues the direction. */
export const DEFAULT_DRAW_FOILS = true;

/** What the button is called, and the name a reading looks it up by. */
export const FOIL_CONTROL_LABEL = 'Foil sheen';

/**
 * The stored answer, or the default.
 *
 * Anything other than the two words is nothing stored: the only ways to get one
 * are a hand-edited store or a build that spelled it differently, and in both
 * cases the honest answer is the state a first visit is in.
 */
export function readDrawFoils(): boolean {
  const found = readStored(FOIL_STORE_KEY);
  if (found === ON) return true;
  if (found === OFF) return false;
  return DEFAULT_DRAW_FOILS;
}

export interface FoilPreference {
  readonly draw: boolean;
  readonly setDraw: (draw: boolean) => void;
}

/** The preference, read once per mount and written back on every press. */
export function useDrawFoils(): FoilPreference {
  const [draw, setState] = useState<boolean>(() => readDrawFoils());
  const setDraw = useCallback((next: boolean): void => {
    // The report is dropped for `../deck/view-mode.ts`'s reason: a page in a
    // private window refuses the write, the screen still switches, and the
    // setting forgets across a reload exactly as a first visit does.
    writeStored(FOIL_STORE_KEY, next ? ON : OFF);
    setState(next);
  }, []);
  return { draw, setDraw };
}

/**
 * One pressed-state button, in the sheet's existing toolbar vocabulary.
 *
 * A toggle rather than a pair of buttons, which is where this parts company with
 * `../deck/view-mode.ts`: that control switches between two named densities and
 * showing both names is the point, while this one is on or off and a second
 * button reading "No sheen" would name a state rather than an action.
 * `aria-pressed` carries which it is, which is what a toggle has.
 */
export function FoilControl(props: { readonly state: FoilPreference }): ReactElement {
  const { state } = props;
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      'aria-pressed': state.draw,
      onClick: (): void => {
        state.setDraw(!state.draw);
      },
    },
    FOIL_CONTROL_LABEL,
  );
}
