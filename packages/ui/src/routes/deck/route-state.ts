/**
 * What the Decks tab is handed, and the four states the staged deck can be in.
 *
 * `mtg-c52t`. It lived in `../DeckRoute.ts` with the three screens that read it,
 * and every one of those screens now has its own file, so the shape they agree
 * on is stated where none of them owns it. It is types only: nothing here
 * renders, so the library can import it without importing a screen and the
 * arrow between the two never turns around.
 */
import type { Card as DslCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import type { DeckArtifact } from '../../lab/deck-artifact';
import type { PoolSet } from './constructed-pool';
import type { DeckSetRef } from './library';
import type { PositionArt } from '../play/position';

export type DeckState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly deck: DeckArtifact }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface DeckRouteProps {
  readonly state: DeckState;
  readonly precons?:
    | { readonly status: 'loading' | 'absent' }
    | { readonly status: 'failed'; readonly message: string }
    | { readonly status: 'ready'; readonly file: PreconFile };
  readonly cards?: readonly DslCard[];
  readonly artFor?: PositionArt;
  /**
   * The `open` param off the hash: which deck this tab was asked for.
   * `./open.ts` says what it can hold and why an unreadable one is ignored
   * rather than reported.
   */
  readonly open?: string;
  /**
   * The staged set, named and categorized, which is what lets this tab shelve
   * its decks by set instead of by who wrote them.
   *
   * One prop rather than two: a name with no origin has no group to sit in and
   * an origin with no name has no heading, so the pair is never usefully half
   * present. Absent on a page opened on a flat set document with no index row
   * behind it, and then every deck here is drawn as one whose set is unrecorded,
   * which is what is true of it.
   */
  readonly set?: DeckSetRef;
  /**
   * Every staged set, when the lab has an index: the Constructed pool is their
   * union rather than the one set the header names (`./constructed-pool.ts`).
   *
   * Absent on a page with no index behind it, and then the pool is `cards`, the
   * one list this route has always been handed. It is separate from `cards`
   * because the rest of this route is about the header's set — a precon is one
   * set's precon and a deck is shelved under one set — and only the builder's
   * pool spans them.
   */
  readonly poolSets?: readonly PoolSet[];
  /**
   * Whether this tab has handed its screen to a game, reported up.
   *
   * The builder hosts a constructed game of its own, and so does a workbench
   * deck sent to a table, and while either is on the shell's standing notice
   * would stand above a board the way it stood above Play's before
   * `mtg-aqxi.16`. The shell cannot read that off the hash, because the game
   * is component state rather than a route, so the tab says so through this.
   */
  readonly onPlayingChange?: (playing: boolean) => void;
}
