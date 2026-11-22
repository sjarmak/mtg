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
import { createElement, Fragment, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card } from '@mtg/dsl';
import { openSealedPool, SealedPoolError } from '@mtg/deckbuild';
import type { PackCollation, PreconFile } from '@mtg/deckbuild';
import { renderCopy } from '../copy';
import type { StagedCollation } from '../lab/staged-collation';
import { gameplayReport } from '../net/gameplay';
import { LiveGame } from './play/LiveGame';
import { PlayChooser } from './play/PlayChooser';
import type { SealedStart } from './play/PlayChooser';
import type { PlaySource } from './play/sources';
import { LAN_UNWIRED_REASON, READY } from './play/availability';
import type { AvailabilityFacts, Opponent, PlayFormat } from './play/availability';
import type { PositionArt } from './play/position';
import { preconProblem } from './play/precon-facts';
import { constructedPool, withMintedBasics } from './deck/constructed-pool';
import type { PoolSet } from './deck/constructed-pool';
import { unplayableNote, useBuiltDecks } from './play/built-decks';
import type { BuiltDecks } from './play/built-decks';
import type { PlayableDeck } from './play/playable-deck';
import { PreconGame } from './play/PreconGame';
import type { PreconSelection } from './play/PreconGame';
import { RemoteGame } from './play/RemoteGame';
import { RemoteSealed } from './play/RemoteSealed';
import { SealedGame } from './play/SealedGame';
import type { DeckSetRef } from './deck/library';
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
   *
   * What the reduction *cost* those packs is not read here at all: the document
   * still carries it, `@mtg/deckbuild`'s `readCollationReduction` still reads
   * it, and no surface in the lab draws it any more (`mtg-rgc.20`).
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
  /** `#/play?against=`. */
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
  /**
   * Every staged set, so the decks the workbench built can be offered here.
   *
   * `mtg-pxdo`. The same list `./DeckRoute.ts` takes, and for the same two
   * reasons `./deck/constructed-pool.ts` gives: a built deck may name cards from
   * more than one staged set, and a card from another set has its picture in
   * that set's own manifest. Absent is the ordinary state and offers the set's
   * written decks alone.
   */
  readonly poolSets?: readonly PoolSet[];
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
  /**
   * A seat in a *room* on a server, which is the phase before a table.
   *
   * The same kind of link as `table` and a different screen: both players build
   * a deck out of their own sealed pool first, and the game starts when the
   * second deck lands. It is a separate parameter rather than a flag on `table`
   * because the link is what says which of the two it is — a page that probed
   * for a room on every seat link would ask the wrong question of every table
   * dealt before rooms existed.
   */
  readonly room?: string | null;
  /** Where the table answers. Same origin, through Vite's proxy, by default. */
  readonly tableBase?: string;
  /**
   * Seats this page at a table the chooser's LAN section dealt.
   *
   * Written to the hash by the caller, which is where `table` above is read
   * from: one press deals the table and produces the address of the seat, so
   * the game survives a reload. Without it the LAN section is not drawn.
   */
  readonly onTable?: (token: string) => void;
  /** Seats this page in a room the chooser's LAN section opened. See `room`. */
  readonly onRoom?: (token: string) => void;
  /** The same, for the room whose pools are drafted first. Same `?room=`. */
  readonly onDraft?: (token: string) => void;
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
  /**
   * The art of the set this lab's server deals, for the two screens that are
   * not playing this tab's set at all.
   *
   * A table and a room are dealt by the launcher from the set the launcher
   * opened, so the picker moves what this tab browses and moves nothing about
   * what is on the far end of a seat link. `artFor` above is the browsed set's,
   * and over a room's cards it resolves nothing — or worse, resolves an id both
   * sets happen to print (`mtg-5h78`).
   *
   * `null` is an answer and not an absence: the dealt set may have had no art
   * run, and the pending frame is the true statement there. Only `undefined`
   * means nothing was passed, which is the flat-props page with no index.
   */
  readonly dealtArtFor?: PositionArt;
  /**
   * The set this page is showing, for the header over the chooser.
   *
   * `mtg-tewc.5`: "Play answers 'what do I want to play?'", and the first thing
   * that question needs answered is which set the decks and the packs below it
   * are cut from. Optional because a caller with no staged index has no name to
   * give — the chooser draws no header rather than a placeholder one — and read
   * only before a game: page furniture over a board is what the playtester asked to
   * have removed.
   */
  readonly setName?: string;
  /** What kind of set that is, in the words a person reads: `Custom set`. */
  readonly setKind?: string;
  /**
   * Which game the chooser is choosing for: the sub off `#/play/<sub>`.
   *
   * Defaulted to `constructed` here as `DEFAULT_SUBS` defaults it in the hash
   * (`../app/router.ts`), so a caller with no router lands where the bar would.
   */
  readonly sub?: PlayFormat;
  /**
   * What this section can be played with, and which of it is showing.
   *
   * Passed straight through to the chooser, which draws the chips
   * (`./play/SourceChoice.ts`). The list is the lab's to work out
   * (`./play/sources.ts`) because only the lab knows what is staged.
   */
  readonly sources?: readonly PlaySource[];
  readonly selectedSource?: string | null;
  readonly onSource?: (stem: string) => void;
  /** Which opponent column is open, when the hash owns that choice. */
  readonly opponent?: Opponent;
  readonly onOpponent?: (opponent: Opponent) => void;
  /**
   * The draft chooser, drawn as the bot column of the `draft` sub.
   *
   * Handed in rather than imported, because the draft tab's own route
   * (`./DraftRoute.ts`) reads a different slice of the hash and owns the pack it
   * deals; this route only says where on the page it stands.
   */
  readonly draft?: ReactElement;
  /**
   * That same set as the deck library records it, for a deck kept off the
   * sealed build screen. Absent where the page has no index row to read an
   * origin off, and never passed to a room: a room serves its own set.
   */
  readonly setRef?: DeckSetRef;
  /**
   * The count of landing-screen requests off the router (`../app/router.ts`).
   *
   * Passed straight through to the two components that hold a screen of their
   * own — the chooser, which the sealed builder replaces, and `PreconGame`,
   * which becomes a table — because those are the two states the hash cannot
   * describe and therefore cannot leave. Every other branch this route takes is
   * read off the hash and ends by itself when `goTo` clears the params: a table
   * token, a room token, a pinned seed.
   */
  readonly landing?: number;
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
  // Both hooks run on every render, above every branch `body` takes: the union
  // is cheap and the fetch answers nothing when there is no deck server, which
  // is the ordinary state.
  const union = useMemo(() => constructedPool(withMintedBasics(props.poolSets ?? [])), [props.poolSets]);
  const built = useBuiltDecks(union.cards);
  return createElement(
    'div',
    { className: 'mtg-play-route' },
    body(props, { decks: built.decks, unplayable: built.unplayable, artFor: union.artFor }),
  );
}

/** The built decks this page can offer, and the resolver that draws them. */
interface BuiltOffer {
  readonly decks: readonly PlayableDeck[];
  readonly unplayable: BuiltDecks['unplayable'];
  /** The union's resolver, which covers the browsed set's cards too. */
  readonly artFor: PositionArt;
}

function body(props: PlayRouteProps, built: BuiltOffer): ReactElement {
  // `??` would be the bug: `null` is a resolver-shaped answer meaning the dealt
  // set has no art, and collapsing it into the browsed set's resolver is how one
  // set's pictures land on another set's ids.
  const dealtArt = props.dealtArtFor === undefined ? props.artFor : props.dealtArtFor;
  const table = props.table;
  if (table !== null && table !== undefined && table.length > 0) {
    return createElement(RemoteGame, {
      base: props.tableBase ?? DEFAULT_TABLE_BASE,
      token: table,
      ...(dealtArt === undefined ? {} : { artFor: dealtArt }),
    });
  }
  // A room wins over a set for the reason a table does, and needs nothing from
  // this page's set: the pool crosses as ids and the room serves the set they
  // are printed in (`mtg-77i6`). This used to hand over whatever the tab had
  // open, which made *which set this reader is browsing* a term in whether a
  // LAN pool would resolve; it is not one.
  const room = props.room;
  if (room !== null && room !== undefined && room.length > 0) {
    return createElement(RemoteSealed, {
      base: props.tableBase ?? DEFAULT_TABLE_BASE,
      token: room,
      ...(dealtArt === undefined ? {} : { artFor: dealtArt }),
    });
  }
  const hint = props.sourceHint ?? EMPTY_SET_HINT;
  // A ready-made game wins over a set: a caller who passed one wants that exact
  // game, not an invitation to build a different deck.
  if (props.config !== null && props.config !== undefined) {
    return createElement(LiveGame, {
      config: props.config,
      report: gameplayReport('constructed'),
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
      return builder(props, built, set.cards, hint, hint, { kind: 'none' });
    case 'ready':
      return builder(props, built, set.cards, hint, null, set.collation ?? { kind: 'none' });
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
/**
 * What the network column can do on this page: nothing, until the route that
 * mounts this one has said where a seat token would go.
 *
 * Read off the seat callbacks rather than off `tableBase`, because the base is
 * defaulted and the callbacks are not: a test rendering this route alone has a
 * base and nowhere to put the seat, and the column has to say so rather than
 * draw a press that goes nowhere (`./play/availability.ts`).
 */
function lanFacts(props: PlayRouteProps, sub: PlayFormat): AvailabilityFacts {
  const seat =
    sub === 'constructed'
      ? props.onTable
      : sub === 'sealed'
        ? props.onRoom
        : sub === 'draft'
          ? props.onDraft
          : undefined;
  return { lan: seat === undefined ? { status: 'unavailable', reason: LAN_UNWIRED_REASON } : READY };
}

function builder(
  props: PlayRouteProps,
  built: BuiltOffer,
  cards: readonly Card[],
  /** Where a real set comes from; the empty state is nothing but this. */
  hint: string,
  /** The same line, drawn over the pool, when these cards are not a staged set. */
  standingInFor: string | null,
  /** The printing's sheets, absent, or present and undealable. */
  collation: StagedCollation,
): ReactElement {
  const sub = props.sub ?? 'constructed';
  // The Draft section's bot column is its own chooser, and it draws its own
  // loading, absent and failed states off the set it was handed: the two
  // refusals below are about the pool this page would deal, and Draft deals none.
  const dealsHere = !(sub === 'draft' && props.draft !== undefined);
  if (cards.length === 0 && dealsHere) return emptyState(hint);
  const offer = preconOffer(props, cards, built);
  const sheets: PackCollation | null = collation.kind === 'ready' ? collation.collation : null;
  // Both notes travel with whatever is drawn below, including the empty state:
  // "the decks you staged are for another set" is the *explanation* of an empty
  // page, and dropping it there is exactly the case that would send somebody
  // looking for a bug in the launcher.
  // A collation this document carries but cannot deal is *said*, not swallowed.
  // The page still deals — the rarity recipe below opens a playable pool from any
  // set — but a person who staged a printing and got the lab's own packs would
  // have no way to tell, and the packs are the reason they staged it.
  // What the reduction cost the packs is *not* said here. It was, folded behind
  // one row, until the playtester read it above a table: "there's no reason for this
  // to be showing up at the top of the screen where you play the game, it eats
  // into too much of that view, we don't need any disclosures like that in the
  // UI." The evidence did not go anywhere -- the launcher prints it on stdout
  // and `reduced.json` holds it card by card -- and the screen that opens a
  // pack is now the screen that opens a pack.
  //
  // What stands is the shorter list: a collation this document carries and
  // cannot deal is an error about the pool below, not provenance about it.
  // A built deck the staged sets cannot deal is said rather than dropped: it is
  // on the shelf, its absence from this row is a fact about the staging, and the
  // repair is named. `mtg-pxdo`.
  const unplayable = unplayableNote(built.unplayable);
  const notes = [
    ...(offer.kind === 'note' ? [offer.message] : []),
    ...(collation.kind === 'unusable' ? [`${COLLATION_UNUSABLE_TITLE}: ${collation.message}`] : []),
    ...(unplayable === null ? [] : [unplayable]),
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
  //
  // Said inside the section rather than instead of the page. `mtg-a982g.5`: the
  // set this section is showing is now chosen on the page (`./play/SourceChoice.ts`)
  // and the shell no longer carries a picker, so a page replaced wholesale by
  // its own refusal is a page with nothing on it to choose a set that can deal.
  // `./play/SealedChooser.ts` draws the sentence where the buttons would go.
  const problem = sheets === null && dealsHere ? sealedProblem(cards) : null;
  // The seed off the hash names one exact pool, so it governs the fresh deal: a
  // link to `#/play?seed=…` opens that pool. A resume is the one thing it does
  // not govern, and the spread order says so — the resumed build *is* the pool
  // its own seed dealt, and handing it a seed that would deal a different one
  // stores a session whose ids no re-deal can match. The next resume would then
  // be refused as a set that changed, which is both a lost pool and a wrong
  // reason for losing it.
  const sealed = (start: SealedStart, onPlayingChange: (playing: boolean) => void): ReactElement =>
    createElement(SealedGame, {
      set: cards,
      onPlayingChange,
      ...(sheets === null ? {} : { collation: sheets }),
      ...(props.seed === undefined ? {} : { seed: props.seed }),
      ...(start.kind === 'resume' ? { resume: start.build, seed: start.seed } : {}),
      ...(props.setRef === undefined ? {} : { setRef: props.setRef }),
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  return createElement(StagingNotes, {
    notes,
    render: (report) =>
      createElement(PlayChooser, {
        set: cards,
        sub,
        facts: lanFacts(props, sub),
        sealed,
        onPlayingChange: report,
        tableBase: props.tableBase ?? DEFAULT_TABLE_BASE,
        ...(props.opponent === undefined ? {} : { opponent: props.opponent }),
        ...(props.onOpponent === undefined ? {} : { onOpponent: props.onOpponent }),
        ...(props.draft === undefined ? {} : { draft: props.draft }),
        ...(props.landing === undefined ? {} : { landing: props.landing }),
        ...(props.onTable === undefined ? {} : { onTable: props.onTable }),
        ...(props.onRoom === undefined ? {} : { onRoom: props.onRoom }),
        ...(props.onDraft === undefined ? {} : { onDraft: props.onDraft }),
        ...(sheets === null ? {} : { collation: sheets }),
        ...(problem === null ? {} : { sealedProblem: problem }),
        ...(offer.kind === 'decks' ? { decks: offer.render } : {}),
        ...(props.setName === undefined ? {} : { setName: props.setName }),
        ...(props.setKind === undefined ? {} : { setKind: props.setKind }),
        ...(props.sources === undefined ? {} : { sources: props.sources }),
        ...(props.selectedSource === undefined ? {} : { selectedSource: props.selectedSource }),
        ...(props.onSource === undefined ? {} : { onSource: props.onSource }),
      }),
  });
}

interface StagingNotesProps {
  readonly notes: readonly string[];
  readonly render: (onPlayingChange: (playing: boolean) => void) => ReactElement;
}

/**
 * The lines about the staged documents, and the surface they belong to.
 *
 * `mtg-aqxi.16`. These notes are setup: which decks would not resolve, which
 * collation could not be dealt, that these cards are the DSL's examples rather
 * than a set. They are read once, before a game, by somebody deciding what to
 * open — and they were drawn above the board for the whole game after that, on
 * a phone where the board has 390 pixels of height and on a desktop where a
 * paragraph over the table is just as useless.
 *
 * So they stand while the page is a builder and go when it is a table, which is
 * the rule `PlayChooser` applies to its own two headings. Nothing is lost on the
 * way in: a section that cannot deal says so inside the section
 * (`./play/SealedChooser.ts`), with these lines above it.
 */
function StagingNotes(props: StagingNotesProps): ReactElement {
  const [playing, setPlaying] = useState(false);
  return createElement(Fragment, null, ...(playing ? [] : noteLines(props.notes)), props.render(setPlaying));
}

function noteLines(notes: readonly string[]): readonly ReactElement[] {
  return notes.map((line, index) =>
    createElement(
      'p',
      { key: `note-${String(index)}`, className: 'mtg-page-note', role: 'status' },
      renderCopy(line),
    ),
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

function preconOffer(props: PlayRouteProps, cards: readonly Card[], built: BuiltOffer): PreconOffer {
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
        ...(props.landing === undefined ? {} : { landing: props.landing }),
        ...(built.decks.length === 0 ? {} : { alsoPlayable: built.decks }),
        ...(props.seed === undefined ? {} : { seed: props.seed }),
        ...(precons.deckId === undefined ? {} : { deckId: precons.deckId }),
        ...(precons.opponentDeckId === undefined ? {} : { opponentDeckId: precons.opponentDeckId }),
        ...(precons.onSelect === undefined ? {} : { onSelect: precons.onSelect }),
        // The union's resolver rather than the browsed set's, for the reason
        // `./deck/constructed-pool.ts` gives (`mtg-pzpz`): a built deck may hold
        // a card from another staged set, and drawing it with this set's
        // resolver puts the pending frame on a card whose picture is one
        // manifest over. It covers this set's cards identically, so a game of
        // two precons draws exactly what it drew.
        ...(built.artFor !== null
          ? { artFor: built.artFor }
          : props.artFor === undefined
            ? {}
            : { artFor: props.artFor }),
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
