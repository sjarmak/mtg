/**
 * Play route: a live game, or an honest explanation of what is missing.
 *
 * The route owns the session and nothing else. It exists so `PlayView` can stay
 * a pure function of a session, which is what lets the tests drive a whole game
 * without a browser.
 *
 * # A pool is dealt, so the route waits before it deals one (`mtg-c4h`)
 *
 * The set arrives over a fetch and the first render beats it. Everything else on
 * this page recovers from that on its own, because everything else is a function
 * of its props: a card gallery handed the real set one frame late simply draws
 * the real set. A sealed pool is not that. It is *dealt* — `SealedGame` opens it
 * once, in a lazy state initializer, because re-opening it under somebody
 * mid-cut throws their build away — so a pool opened from a stand-in is a pool
 * that has to be destroyed, along with the seed printed above it, which is the
 * one string that promises this exact table can be come back to.
 *
 * So the set reaches this route as a four-state union rather than a nullable
 * array, the shape `DeckRoute` and `ReplayViewer` already take for the same
 * reason, and the builder is not mounted until the state says which cards it
 * would be dealing. Waiting is the whole fix: there is no identity key on
 * `SealedGame` any more, because a key is the other answer to this question and
 * it is the answer that silently destroys a build every time the set prop moves
 * for any reason at all.
 *
 * `absent` is the one state that still deals from cards that are not a staged
 * set, and it is a real state rather than a fallback: a checkout that has never
 * run `npm run play` has no set, and the lab is still worth opening. What it
 * does not do is pass for `ready`. It draws `sourceHint` over the builder, so
 * the person is *told* which cards these are and what to run for a set of their
 * own, which is the difference between a legitimate stand-in and the bug.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';
import type { Card } from '@mtg/dsl';
import { openSealedPool, SealedPoolError } from '@mtg/deckbuild';
import type { PackCollation, PreconFile } from '@mtg/deckbuild';
import { renderCopy } from '../copy';
import type { StagedCollation } from '../lab/staged-collation';
import { BuilderSwitch } from './play/BuilderSwitch';
import { LiveGame } from './play/LiveGame';
import type { PositionArt } from './play/position';
import { preconProblem } from './play/precon-facts';
import { PreconGame } from './play/PreconGame';
import type { PreconSelection } from './play/PreconGame';
import { RemoteGame } from './play/RemoteGame';
import { SealedGame } from './play/SealedGame';
import type { PlayConfig } from './play/use-session';

/**
 * What this route knows about the set it is being asked to deal.
 *
 * The same four words `DeckState` and `ReplayState` use, because they are the
 * same four answers and a reader who has met one has met all three. The split
 * that matters here is `loading` against `absent`: one means "ask me again in a
 * moment" and must deal nothing, the other means "there is no set and there is
 * not going to be one" and may deal the cards it carries.
 *
 * `absent` carries its own stand-in rather than the route reaching for one,
 * because who stands in for a missing set is the caller's decision — the lab
 * uses the DSL example cards, and a caller with nothing to offer passes an empty
 * list and gets the empty state.
 */
export type PlaySetState =
  | { readonly status: 'loading' }
  /**
   * A staged set, read and parsed.
   *
   * `collation` is the printing's own sheets when the document carried them —
   * `npm run reference:reduced` writes them and a generated set has none. It sits
   * on `ready` alone because it is a fact about *this* document: the stand-in
   * cards of `absent` are not a printing and have no collation to read.
   */
  | {
      readonly status: 'ready';
      readonly cards: readonly Card[];
      readonly collation?: StagedCollation;
    }
  /** No set is staged; these cards stand in for one, and the route says so. */
  | { readonly status: 'absent'; readonly cards: readonly Card[] }
  /** A staged set that could not be read. The message names what was wrong. */
  | { readonly status: 'failed'; readonly message: string };

/**
 * What this route knows about the preconstructed decks it could offer.
 *
 * The same four words again, for the same reason: a precon file is fetched, and
 * the state before it lands must not read as "this set has no decks". `absent`
 * is the ordinary state of a checkout whose set has no precons written for it,
 * and it is not a failure — the sealed builder is the whole page then, exactly
 * as it was before any of this existed.
 */
export type PreconState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly file: PreconFile }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * The precon half of this route: the decks, which one is being played, and the
 * one callback that publishes that choice.
 *
 * Grouped rather than spread across five props because they are one feature and
 * a caller either has all of it or none of it. `deckId` and `opponentDeckId`
 * come off the hash and are *deal inputs* — with both set, the route opens that
 * exact table instead of the picker, which is what makes a link to a game a
 * link to the same game tomorrow.
 */
export interface PlayPrecons {
  readonly state: PreconState;
  /** `#/play?deck=`. An id the file does not hold falls back to the first deck. */
  readonly deckId?: string;
  /** `#/play?vs=`. */
  readonly opponentDeckId?: string;
  /** Writes the selected table to the hash when play begins. */
  readonly onSelect?: (selection: PreconSelection) => void;
}

export interface PlayRouteProps {
  /**
   * A set to open sealed packs from. The primary path: a person arrives with a
   * set and leaves having played a game.
   */
  readonly set?: PlaySetState | null;
  /**
   * Preconstructed decks cut from that set. When they are ready the route opens
   * on them, with the sealed builder one press away; without them nothing on
   * this page changes.
   */
  readonly precons?: PlayPrecons | null;
  /** A ready-made game, which skips deckbuilding. `null` when there is none. */
  readonly config?: PlayConfig | null;
  /**
   * A seat at a table on a server, which skips everything else.
   *
   * The link one player was given by whoever started the table. It wins over
   * both a ready-made game and a set, because a person who followed a link to a
   * game already in progress wants that game, not an invitation to build a deck
   * for a different one.
   */
  readonly table?: string | null;
  /** Where the table answers. Same origin, through Vite's proxy, by default. */
  readonly tableBase?: string;
  readonly seed?: string;
  /**
   * Where a real set would come from.
   *
   * Read in the two states that are about a set the caller does not have: with
   * nothing to play at all it is the whole of the empty state, and over an
   * `absent` pool it is the line that says these cards are standing in.
   */
  readonly sourceHint?: string;
  /**
   * Resolves a card's illustration for the played table. The battlefield and
   * the hand always draw their art window now, so without this every permanent
   * in play wears the pending frame.
   */
  readonly artFor?: PositionArt;
}

/**
 * Where a networked table answers by default.
 *
 * Relative, so the page talks to the origin it was served from and nothing else.
 * `packages/ui/vite.config.ts` proxies this path to the game server on loopback,
 * which is what keeps exactly one listener on the network — the one that was
 * designed to be there — and is why nothing in `@mtg/netplay` sets a CORS header.
 */
export const DEFAULT_TABLE_BASE = '/api';

/**
 * The title over the state where a set is still on its way.
 *
 * Named because two tests and one launcher note read it, and because it is the
 * one string that has to stay distinguishable from `EMPTY_TITLE` — "no set yet"
 * and "no set at all" are different sentences to the person waiting.
 */
export const LOADING_TITLE = 'Opening the set';

/** The title over every state with no game and no prospect of one. */
export const EMPTY_TITLE = 'No game loaded';

/** The title over a staged set document that could not be read. */
export const UNREADABLE_TITLE = 'Could not read the staged set';

/** What a caller who named no better source is told to run. */
const EMPTY_SET_HINT =
  'Run `npm run slice` to generate a set, then point this view at it to open a sealed pool.';

/**
 * `role="status"` on the body, the way `RemoteGame`'s connecting notice does it:
 * this block is replaced by a whole deckbuilder the moment the fetch lands, and
 * a screen reader that was told nothing about the wait is told nothing about the
 * arrival either.
 */
function notice(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body', role: 'status' }, renderCopy(body)),
  );
}

function emptyState(hint: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, EMPTY_TITLE),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(hint)),
  );
}

/**
 * Named, because the route is a column with a height budget rather than a page
 * that grows: `styles/views.ts` hands the leftover of the viewport down this
 * chain, and an unclassed wrapper in the middle of it is a link the budget
 * cannot pass through.
 */
export function PlayRoute(props: PlayRouteProps): ReactElement {
  return createElement('div', { className: 'mtg-play-route' }, body(props));
}

function body(props: PlayRouteProps): ReactElement {
  const table = props.table;
  if (table !== null && table !== undefined && table.length > 0) {
    return createElement(RemoteGame, {
      base: props.tableBase ?? DEFAULT_TABLE_BASE,
      token: table,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }
  const hint = props.sourceHint ?? EMPTY_SET_HINT;
  // A ready-made game wins over a set: a caller who passed one wants that exact
  // game, not an invitation to build a different deck.
  if (props.config !== null && props.config !== undefined) {
    return createElement(LiveGame, {
      config: props.config,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }
  const set = props.set;
  if (set === null || set === undefined) return emptyState(hint);
  switch (set.status) {
    // Nothing is dealt here, and that is the whole of the fix. The alternative
    // is to deal from something and correct it a frame later, which is what
    // shipped; what it corrects is a pool somebody may already be cutting from.
    case 'loading':
      return notice(LOADING_TITLE, 'Reading the staged set.');
    case 'failed':
      return notice(UNREADABLE_TITLE, set.message);
    // Told, not hidden. The builder is real and the pool is playable; the line
    // above it says these cards are not a set anybody staged.
    case 'absent':
      return builder(props, set.cards, hint, hint, { kind: 'none' });
    case 'ready':
      return builder(props, set.cards, hint, null, set.collation ?? { kind: 'none' });
    default:
      return unhandled(set);
  }
}

function unhandled(state: never): never {
  throw new Error(`PlayRoute: unhandled set state ${JSON.stringify(state)}`);
}

/**
 * The two ways into a game over these cards, with any notes above them.
 *
 * No `key` on `SealedGame`. Its identity is its mount, and its mount is now the
 * moment this route learned which cards it would be dealing. A key derived from
 * the set would re-deal — and so discard a build in progress — every time the
 * set prop moved for any reason, including the several that are not a new set.
 *
 * A pool too thin to open and a set with decks written for it are independent
 * facts, and this function is where that stopped being assumed. Sealed needs
 * nine commons in a booster; a precon needs its own card ids and nothing else,
 * so a set that cannot fill a pack can still have four playable decks. Only
 * when *neither* is available is this the empty state it used to be.
 */
function builder(
  props: PlayRouteProps,
  cards: readonly Card[],
  /** Where a real set comes from; the empty state is nothing but this. */
  hint: string,
  /** The same line, drawn over the pool, when these cards are not a staged set. */
  standingInFor: string | null,
  /** The printing's sheets, absent, or present and undealable. */
  collation: StagedCollation,
): ReactElement {
  if (cards.length === 0) return emptyState(hint);
  const offer = preconOffer(props, cards);
  const sheets: PackCollation | null = collation.kind === 'ready' ? collation.collation : null;
  // Both notes travel with whatever is drawn below, including the empty state:
  // "the decks you staged are for another set" is the *explanation* of an empty
  // page, and dropping it there is exactly the case that would send somebody
  // looking for a bug in the launcher.
  // A collation this document carries but cannot deal is *said*, not swallowed.
  // The page still deals — the rarity recipe below opens a playable pool from any
  // set — but a person who staged a printing and got the lab's own packs would
  // have no way to tell, and the packs are the reason they staged it.
  const notes = [
    ...(offer.kind === 'note' ? [offer.message] : []),
    ...(collation.kind === 'unusable' ? [`${COLLATION_UNUSABLE_TITLE}: ${collation.message}`] : []),
    ...(standingInFor === null ? [] : [standingInFor]),
  ];
  // A set too thin to fill a booster is a real and reachable state (a truncated
  // set document, a rarity that generated empty). Saying which rarity is short
  // beats a blank tab with a console error.
  //
  // Only asked when the rarity recipe is what will deal. It is a probe of *that*
  // recipe — nine commons, three uncommons, one rare — and a printing whose own
  // sheets fill its own packs owes it nothing: M11 deals a fifteen-card pack with
  // ten commons in it, and a reduced printing that lost enough commons to fail
  // this probe would be refused a pool it can in fact open.
  const problem = sheets === null ? sealedProblem(cards) : null;
  if (offer.kind !== 'decks' && problem !== null) return withNotes(notes, emptyState(problem));
  const sealed = (onPlayingChange: (playing: boolean) => void): ReactElement =>
    problem === null
      ? createElement(SealedGame, {
          set: cards,
          onPlayingChange,
          ...(sheets === null ? {} : { collation: sheets }),
          ...(props.seed === undefined ? {} : { seed: props.seed }),
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        })
      : notice(EMPTY_TITLE, problem);
  const game =
    offer.kind === 'decks'
      ? createElement(BuilderSwitch, { precon: offer.render, sealed })
      : sealed(() => undefined);
  return withNotes(notes, game);
}

/**
 * Lines above whatever the route drew, as siblings of it.
 *
 * A fragment rather than a wrapper: `styles/views.ts` hands the leftover of the
 * viewport from `.mtg-play-route` straight to `.mtg-play`, and a box in between
 * is a link the height budget cannot pass through.
 */
function withNotes(notes: readonly string[], body: ReactElement): ReactElement {
  if (notes.length === 0) return body;
  return createElement(
    Fragment,
    null,
    ...notes.map((line, index) =>
      createElement(
        'p',
        { key: `note-${String(index)}`, className: 'mtg-page-note', role: 'status' },
        renderCopy(line),
      ),
    ),
    body,
  );
}

/** What a precon file that does not describe this set is called on the page. */
export const PRECON_MISMATCH_TITLE = 'The staged decks do not match this set';

/**
 * What a collation the staged document carries but cannot deal is called.
 *
 * Named for the same reason `PRECON_MISMATCH_TITLE` is: the tests read it, and
 * it has to stay distinguishable from the sentence about a set that carries no
 * collation at all, which is silence.
 */
export const COLLATION_UNUSABLE_TITLE = 'The staged collation could not be dealt';

/**
 * What, if anything, this route can offer besides a sealed pool.
 *
 * Three answers rather than two, because "no decks" and "decks that will not
 * resolve" want different things on the screen. The mismatch case is the one
 * worth spelling out: a precon file and a set document are staged separately
 * and may carry the same set code, so a file cut from a different build of the
 * same set resolves to nothing and would otherwise deal a deck with cards
 * missing. `preconProblem` names every id, and that message is drawn *instead
 * of* the decks rather than under them — a picker whose tiles cannot be played
 * is worse than not offering one.
 */
type PreconOffer =
  | { readonly kind: 'none' }
  | { readonly kind: 'note'; readonly message: string }
  | {
      readonly kind: 'decks';
      readonly render: (onPlayingChange: (playing: boolean) => void) => ReactElement;
    };

function preconOffer(props: PlayRouteProps, cards: readonly Card[]): PreconOffer {
  const precons = props.precons;
  if (precons === null || precons === undefined) return { kind: 'none' };
  switch (precons.state.status) {
    // Nothing is dealt from either state, so neither holds the page: sealed is
    // the whole surface until the decks land, and a checkout with no precon
    // file stays there.
    case 'loading':
    case 'absent':
      return { kind: 'none' };
    case 'failed':
      return { kind: 'note', message: precons.state.message };
    case 'ready':
      break;
    default:
      return unhandledPrecon(precons.state);
  }
  const file = precons.state.file;
  const mismatch = preconProblem(file, cards);
  if (mismatch !== null) return { kind: 'note', message: `${PRECON_MISMATCH_TITLE}: ${mismatch}` };
  return {
    kind: 'decks',
    render: (onPlayingChange) =>
      createElement(PreconGame, {
        file,
        set: cards,
        onPlayingChange,
        ...(props.seed === undefined ? {} : { seed: props.seed }),
        ...(precons.deckId === undefined ? {} : { deckId: precons.deckId }),
        ...(precons.opponentDeckId === undefined ? {} : { opponentDeckId: precons.opponentDeckId }),
        ...(precons.onSelect === undefined ? {} : { onSelect: precons.onSelect }),
        ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
      }),
  };
}

function unhandledPrecon(state: never): never {
  throw new Error(`PlayRoute: unhandled precon state ${JSON.stringify(state)}`);
}

function sealedProblem(set: readonly Card[]): string | null {
  try {
    openSealedPool(set, { seed: 'probe', boosters: 1 });
    return null;
  } catch (cause: unknown) {
    if (cause instanceof SealedPoolError) {
      return `${cause.message}. Generate a fuller set with \`npm run slice\`.`;
    }
    throw cause;
  }
}
