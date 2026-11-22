/**
 * The technical name of a game, folded shut.
 *
 * Three surfaces carry the same fact and, before this file, carried it three
 * ways: the sealed builder printed `seed lab/sealed/…` inline in its primary
 * toolbar, the replay toolbar folded it away under *Game details* but called it
 * *Seed*, and the precon table's `Game` menu called it *Game ID*. the playtester's
 * interface pass names the first outright — "`seed lab/sealed/...` should not
 * appear in the normal player UI; put technical information under Game details"
 * — and the other two are the consistency half of the same instruction: one
 * label for one fact, wherever it is read.
 *
 * The value stays whole rather than being trimmed to the token after the slash.
 * It is what `#/play?seed=` takes, and this project's bargain is that seed plus
 * the choice list is the entire record of a game
 * (`packages/engine/src/determinism.ts`); a name that no longer reproduces the
 * game is a name for nothing.
 *
 * A `<details>` rather than a menu, because none of this is a control: the
 * precon table keeps its own sheet (`./play/precon-strip.ts`), which is a menu
 * because Reshuffle and Kaelen to this game are moves and live beside it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

export const GAME_DETAILS_LABEL = 'Game details';

/** What a seed is called wherever a person reads one. */
export const GAME_ID_LABEL = 'Game ID';

/**
 * What a builder calls the sentence describing the pool it was handed.
 *
 * `mtg-i195`. It was a paragraph over the panes -- "Six packs, one deck to
 * build." -- which is a fact you read once and then scroll past on every pick
 * after that. Folded in here it is still one keystroke away and costs the
 * workspace nothing.
 */
export const GAME_SETUP_LABEL = 'Setup';

export interface GameDetail {
  readonly term: string;
  readonly value: string;
}

/** The disclosure, or `null` when there is nothing to put in it. */
export function GameDetails(props: { readonly details: readonly GameDetail[] }): ReactElement | null {
  if (props.details.length === 0) return null;
  return createElement(
    'details',
    { className: 'mtg-gamedetails' },
    createElement('summary', null, GAME_DETAILS_LABEL),
    createElement(
      'dl',
      { className: 'mtg-gamedetails__list' },
      ...props.details.flatMap((detail) => [
        createElement('dt', { key: `${detail.term}-term` }, detail.term),
        createElement('dd', { key: `${detail.term}-value` }, detail.value),
      ]),
    ),
  );
}
