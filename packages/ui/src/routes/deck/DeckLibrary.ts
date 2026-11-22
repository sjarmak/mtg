/**
 * The library: every deck this browser can open, and the screen each opens in.
 *
 * `mtg-c52t`. The third and largest of the screens `../DeckRoute.ts` held, and
 * the one that chooses between the other two: a link names a deck, the library
 * shelves the rest, and pressing one hands the whole route to the artifact
 * screen, the written-deck screen or the Constructed builder. `../DeckRoute.ts`
 * is what is left once that choice lives here -- the four states the staged
 * document can be in, and which of them has anything to show.
 */
import { createElement, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { ConstructedGame } from './ConstructedGame';
import { constructedPool, withMintedBasics } from './constructed-pool';
import { counted, DECK_CARD_GRID_CLASS, DeckCard, deckCountsLine, preconCountsLine } from './DeckCard';
import { builderScreen } from './BuilderScreen';
import { DECKS_BACK_LABEL, deckScreen } from './deck-screen';
import { OpenDeck } from './OpenDeckScreen';
import { PreconDeckView } from './PreconDeckScreen';
import { deckFor } from './build';
import { shelveDecks } from './library';
import type { DeckSetRef } from './library';
import { parseDeckOpen } from './open';
import type { DeckRouteProps } from './route-state';
import { SAVED_SOURCE_LABELS, savedCardCount, savedDeckColors, savedDeckSource } from './saved-decks';
import { useDeckKeeping } from './deck-keeping';
import { preconFacts } from '../play/precon-facts';
import { WORKBENCH_TITLE, WorkbenchScreen } from './workbench/WorkbenchScreen';
import { fetchVariation } from './workbench/client';
import type { Variation, VariationSummary } from './workbench/client';
import { useShelf } from './use-shelf';
import { missingNote, reopenVariation } from './workbench/play';
import type { ConstructedBuild } from './build';

/**
 * Which deck the library is showing.
 *
 * `'build'` is the odd one and deliberately sits in the same list: building a
 * deck out of the playable cards is a way of arriving at a deck, so it belongs
 * beside the decks somebody already has rather than on a page of its own. It
 * carries no id because there is one builder and it holds its own state.
 */
type LibrarySelection =
  | { readonly kind: 'artifact' }
  | { readonly kind: 'precon'; readonly id: string }
  | { readonly kind: 'build' }
  // There is one workbench, so this names no workbench. `variationId` is which
  // deck it should arrive showing, and it is absent when the person pressed
  // `Describe a deck` rather than a tile: then the shelf's own newest-first rule
  // applies and which variation stays open after that is the workbench's
  // business.
  | { readonly kind: 'workbench'; readonly variationId?: string };

/** The Decks tab's entry to the Constructed builder, and its primary action. */
export const BUILD_LABEL = 'New deck';

/** The other way in: a decklist somebody already has, as text or as a file. */
export const IMPORT_LABEL = 'Import deck';

/**
 * The third way in, and the only one that writes a decklist for you.
 *
 * `New deck` opens the builder, where a person moves cards one at a time.
 * `Describe a deck` opens the workbench, where they state what they want and a
 * model chooses from the same staged sets. Two entries rather than a mode inside
 * one, because they are different activities with different pacing: the builder
 * answers a click, and a build takes minutes.
 */
export const DESCRIBE_LABEL = 'Describe a deck';

/**
 * The shelf for decks that name no set.
 *
 * `./library.ts` says which three populations land here and why none of
 * them is filed under the staged set instead. The heading states the fact
 * rather than apologizing for it: `@mtg/decklab`'s artifact is a deck of real
 * printings and genuinely belongs to no staged set, and it is the row this shelf
 * holds in a checkout that has run `npm run lab`.
 */
export const DECKS_UNPLACED_LABEL = 'Not from a staged set';

/** What the library says when it holds nothing at all, precons included. */
export const DECKS_EMPTY_NOTE =
  'No decks yet. New deck builds one out of the staged set; Import deck opens a list you already have.';

/** The accessible name of a deck tile in the library: what pressing it does. */
export function openDeckLabel(name: string): string {
  return `Open ${name}`;
}

/**
 * Which deck the library opens on: the one a link named, and otherwise none.
 *
 * A link wins because somebody clicked it. An arrival that asked for nothing
 * lands on the library, and that reverses what this function did until
 * `mtg-nuk3`: it used to pick the staged artifact deck, else the first written
 * deck, so the tab opened on a deck nobody had chosen.
 *
 * The auto-pick was harmless while an open deck was drawn *below* the whole
 * library, because arrival still showed the shelves and the deck was somewhere
 * further down. `mtg-nuk3` makes an open deck take the route the way the builder
 * already does, and at that point the auto-pick decides what the Decks tab *is*
 * on arrival. Landing on a deck the person did not name would mean the shelves
 * are reached by pressing Back out of a deck they never opened, which is also
 * not what the client being copied does: MTGO opens on the collection and the
 * deck editor is where a deck takes you.
 */
function librarySelection(props: DeckRouteProps): LibrarySelection | null {
  const asked = parseDeckOpen(props.open);
  if (asked === null) return null;
  if (asked.kind === 'precon') return { kind: 'precon', id: asked.id };
  if (asked.kind === 'artifact') return { kind: 'artifact' };
  if (asked.kind === 'variation') return { kind: 'workbench', variationId: asked.id };
  return { kind: 'build' };
}

/**
 * What the builder's own heading says.
 *
 * `mtg-dcxg.7`, 2026-08-23. It said *Decks* — the tab's name — over a screen
 * whose whole subject is one deck, so at 390x844 the largest text on the page
 * carried no information the bottom bar did not already have. A saved deck is
 * named; an editor holding a deck nobody has saved yet is a new deck, which is
 * the state the builder opens in and is worth saying rather than leaving the
 * heading generic.
 */
export const NEW_DECK_TITLE = 'New deck';

export function builderTitle(openName: string | null): string {
  return openName ?? NEW_DECK_TITLE;
}

/** The line under the page title: what this library holds, in two counts. */
export function deckLibraryCounts(preconCount: number, savedCount: number): string {
  return `${String(preconCount)} preconstructed · ${String(savedCount)} saved`;
}

/**
 * One deck in the library: the tile that draws it, and the set it files under.
 *
 * The tile is built at the call site rather than described here, because the
 * three kinds fill different regions of it — a written deck states a plan and a
 * centerpiece, a saved deck states neither — and a row type wide enough to hold
 * all of them would be `DeckCardProps` with the differences smuggled back in as
 * optionals.
 */
interface LibraryRow {
  readonly key: string;
  /** `null` when nothing recorded a set. `./library.ts` lists the three cases. */
  readonly set: DeckSetRef | null;
  readonly node: ReactElement;
}

/**
 * Which shelf a built variation belongs on.
 *
 * One set is a set it can be filed under, and the name comes from the deck
 * server rather than from the code, because these shelves are keyed by name.
 * Several sets is genuinely no set — the deck is not the staged set's the way a
 * precon is — and `DECKS_UNPLACED_LABEL` is the shelf that already says so.
 *
 * The origin is the staged set's when the names agree and `custom` otherwise:
 * a generated set is this lab's own, and a reduced reference build is not, so
 * guessing either way for a set this tab has not staged would put a real Magic
 * set under the wrong heading. `../../lab/set-origin.ts` owns that judgment for
 * sets the tab does stage, and this defers to it whenever it can.
 */
function variationSet(
  row: VariationSummary,
  names: ReadonlyMap<string, string>,
  staged: DeckSetRef | null,
): DeckSetRef | null {
  const only = row.sets.length === 1 ? row.sets[0] : undefined;
  if (only === undefined) return null;
  const name = names.get(only);
  if (name === undefined) return null;
  return name === staged?.name ? staged : { name, origin: 'custom' };
}

/** A grid of deck tiles under a name a screen reader can find it by. */
function deckGrid(label: string, rows: readonly LibraryRow[]): ReactElement {
  return createElement(
    'div',
    { className: DECK_CARD_GRID_CLASS, role: 'group', 'aria-label': label },
    ...rows.map((row) => row.node),
  );
}

/**
 * A shelf: a heading over a grid, in the small-caps treatment every short list
 * on this app takes.
 *
 * The heading level is passed in rather than fixed, because the shelves nest:
 * *Custom* is a heading over sets and *the flagship set* is a heading over
 * decks, and drawing both as `h2` would tell a screen-reader user the set is a
 * sibling of the taxonomy it belongs to.
 */
function shelf(tag: 'h2' | 'h3', label: string, body: ReactElement): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-group', key: label, 'aria-label': label },
    createElement(tag, { className: 'mtg-group__title' }, label),
    body,
  );
}

/**
 * The library: every deck this browser can open, shelved by the set it came
 * from under the Custom/Magic taxonomy.
 *
 * `mtg-tewc.6`. It was two grids, *Preconstructed* over *My decks*, which sorted
 * the decks by who wrote them — and who wrote a deck is a property of one deck,
 * not a place to look for it. The question somebody arrives with is which set
 * they were playing, so the set is the shelf and the taxonomy is the heading
 * over it; `./library.ts` does the grouping and reuses
 * `../../lab/set-origin.ts`, so this page cannot invent a third order for the same
 * two groups or spell the word behind *Magic* on screen.
 *
 * A deck's kind moved onto the tile, where it says what it is in a word and a
 * stripe (`./DeckCard.ts`). That is the distinction the shelves used to
 * carry and it is the only thing lost by dropping them, so it is the thing put
 * back.
 *
 * **Two ways in, both primary and both at the top.** *New deck* opens the
 * builder empty and *Import deck* opens the same builder with the decklist box
 * on screen. There is one builder and one `open` param behind it (`./open.ts`
 * argues why), so importing is a state the builder opens in rather than a second
 * mode beside it.
 */
export function DeckLibrary(props: DeckRouteProps): ReactElement {
  const [selected, setSelected] = useState<LibrarySelection | null>(() => librarySelection(props));
  // Only on arrival: once the builder is open, which saved deck it holds is the
  // panel's business, and re-applying the link's id on every render would undo
  // every load the person made after it.
  const [openSavedId] = useState<string | undefined>(() => {
    const asked = parseDeckOpen(props.open);
    return asked?.kind === 'build' ? asked.savedId : undefined;
  });
  /**
   * Whether the builder was opened to take a list rather than to build one. Not
   * in `LibrarySelection`, because it is not a different selection: the same
   * builder holding the same empty deck, with the box that accepts a paste
   * already open.
   */
  const [importing, setImporting] = useState(false);
  /**
   * The name of the saved deck the builder has open, reported up by
   * `./SavedDecksPanel.ts`. Held here because the heading it titles is
   * this component's, and it is `null` until a deck is saved or opened.
   */
  const [openName, setOpenName] = useState<string | null>(null);
  // The workbench's own decks and the set names they shelve under; `./use-shelf.ts`
  // says why an unreachable server reads as an empty shelf.
  const { variations, setNames } = useShelf();
  /**
   * Whether the builder has handed its screen to a game.
   *
   * `ConstructedGame` swaps `LiveGame` in for the builder in place and reports
   * it here, because the two want different pages: a builder is a frame of
   * panes that scroll inside a window that does not, and a board is a document.
   * One-way, like every other reader of `onPlayingChange` — there is no route
   * from a live game back to the deck it was dealt from — so nothing sets it
   * false and nothing here needs to.
   */
  const [playingInBuilder, setPlayingInBuilder] = useState(false);
  /**
   * A workbench variation reopened against the staged pool, on its way to a
   * table. Held here rather than inside the workbench because playing takes the
   * whole route the way the builder does, and the workbench is one pane of it.
   */
  const [playingVariation, setPlayingVariation] = useState<{
    readonly build: ConstructedBuild;
    readonly name: string;
    /**
     * The deck on the other side, when one was chosen. Absent is the mirror.
     * The playtester asked to play the Alaric deck against the Vessari deck, and the
     * shelf is the pool of second decks `../play/deal.ts` said did not exist.
     */
    readonly opponent?: { readonly name: string; readonly cards: readonly DslCard[] };
  } | null>(null);
  // Reported once per change rather than on every render: the shell reads it
  // to keep its notice off a table, and the tab is on a table under either.
  const seated = playingInBuilder || playingVariation !== null;
  const { onPlayingChange } = props;
  useEffect(() => {
    onPlayingChange?.(seated);
  }, [seated, onPlayingChange]);
  /**
   * Why a variation could not be dealt: the staged sets no longer hold cards it
   * names. Held here because this is where the pool it was checked against is.
   */
  const [workbenchRefusal, setWorkbenchRefusal] = useState<string | null>(null);
  const preconDecks = props.precons?.status === 'ready' ? props.precons.file.decks : [];
  const artifactReady = props.state.status === 'ready';
  // The one list this tab has, shared with the save panel inside the builder:
  // `./deck-keeping.ts` holds it, prefers the machine's deck library when one is
  // running, and falls back to this browser's own copy when none is.
  const saved = useDeckKeeping().decks;
  const selectedPrecon =
    selected?.kind === 'precon' ? preconDecks.find((deck) => deck.id === selected.id) : undefined;
  // The union of the staged sets when there is an index, and the header's own
  // set when there is not. One set either way produces exactly the pool and the
  // note this builder had before the index existed. Memoized because the
  // builder re-seats an open build when its pool changes identity, and a fresh
  // array every render would be a fresh pool every render.
  const poolSets = props.poolSets;
  const routeCards = props.cards;
  const setName = props.set?.name;
  const setOrigin = props.set?.origin;
  const routeArt = props.artFor;
  // Through `withMintedBasics`, for the reason it states: a set document prints
  // no basics, so a pool of documents alone cannot resolve the `xmp-plains` a
  // variation recorded, and the deck came back holding whichever Plains the
  // union offered first (`mtg-ac0h`). The Play tab's union already minted them.
  const pool = useMemo(
    () =>
      constructedPool(
        withMintedBasics(
          poolSets === undefined || poolSets.length === 0
            ? [
                {
                  name: setName ?? 'the staged set',
                  cards: routeCards ?? [],
                  ...(setOrigin === undefined ? {} : { origin: setOrigin }),
                  // The one set there is, so the header's resolver is its own
                  // resolver. On the indexed path each row carries its own and
                  // this branch is not taken (`./constructed-pool.ts`, mtg-pzpz).
                  ...(routeArt === undefined || routeArt === null ? {} : { artFor: routeArt }),
                },
              ]
            : poolSets,
        ),
      ),
    [poolSets, routeCards, setName, setOrigin, routeArt],
  );
  const buildable = props.cards !== undefined && props.cards.length > 0;
  const building = selected?.kind === 'build' && props.cards !== undefined;
  const stagedSet = props.set ?? null;

  const enterBuilder = (asImport: boolean): void => {
    setImporting(asImport);
    setSelected({ kind: 'build' });
  };

  const head = createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Decks'),
    createElement(
      'span',
      { className: 'mtg-page-note' },
      deckLibraryCounts(preconDecks.length + (artifactReady ? 1 : 0), saved.length),
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    ...(buildable
      ? [
          createElement(
            'button',
            {
              key: 'build',
              type: 'button',
              className: 'mtg-btn',
              'data-variant': 'primary',
              'aria-pressed': selected?.kind === 'build' && !importing,
              onClick: (): void => {
                enterBuilder(false);
              },
            },
            BUILD_LABEL,
          ),
          createElement(
            'button',
            {
              key: 'import',
              type: 'button',
              className: 'mtg-btn',
              'aria-pressed': selected?.kind === 'build' && importing,
              onClick: (): void => {
                enterBuilder(true);
              },
            },
            IMPORT_LABEL,
          ),
          createElement(
            'button',
            {
              key: 'workbench',
              type: 'button',
              className: 'mtg-btn',
              'aria-pressed': selected?.kind === 'workbench',
              onClick: (): void => {
                setSelected({ kind: 'workbench' });
              },
            },
            DESCRIBE_LABEL,
          ),
        ]
      : []),
  );

  // A variation handed over to be played: the workbench builds decks out of
  // cards this kernel can run, and this is where that stops being a claim. The
  // builder is reused rather than a second table written, so a deck arrives in
  // the same screen a hand-built one is played from and can be edited first.
  if (playingVariation !== null && props.cards !== undefined) {
    const variationGame = createElement(ConstructedGame, {
      pool: pool.cards,
      poolNote: pool.note,
      openBuild: playingVariation.build,
      title: playingVariation.name,
      ...(playingVariation.opponent === undefined ? {} : { opponentDeck: playingVariation.opponent }),
      onBack: (): void => {
        setPlayingVariation(null);
      },
      onPlayingChange: setPlayingInBuilder,
      ...(props.precons?.status === 'ready' ? { precons: props.precons.file } : {}),
      // The union's map, the same one the hand-built branch below passes and for
      // the same reason (`mtg-6nqs`): which set a deck was cut from is a fact
      // about the cards somebody chose, not about the set the header names. A
      // variation saved after being played recorded the header's set without it.
      setOf: pool.setOf,
      ...(props.artFor === undefined || props.artFor === null ? {} : { artFor: props.artFor }),
    });
    // One `builderScreen` across both states rather than two trees, because two
    // trees remount what is inside them: `ConstructedGame` holds the dealt table
    // in its own state, and a swap at the moment it reports the game started
    // threw that state away in the same commit. See `./BuilderScreen.ts`.
    //
    // Framed while building. Returned bare, this was the one path into the
    // builder that escaped `mtg-nuk3`'s frame: measured on the running lab, the
    // route became a 24,850px document at a 1000px viewport, with a 24,676px
    // pool pane whose scrollport did not scroll. Unframed while playing, because
    // the frame's contract is a true sentence about two panes and a false one
    // about a board.
    return builderScreen({
      screen: 'mtg-builder-screen',
      framed: !playingInBuilder,
      head: playingInBuilder
        ? [
            // Both decks, because the board names neither: the seats read You
            // and Bot, which is `../play/deal.ts`'s deliberate choice and right
            // there — a seat is not a deck — but it leaves "who am I playing?"
            // unanswered on the one screen that exists to be a specific second
            // deck. Only while a game is on; the builder's own toolbar carries
            // the name while there is only one deck to name.
            createElement(
              'h1',
              { key: 'title', className: 'mtg-page-title' },
              playingVariation.opponent === undefined
                ? playingVariation.name
                : `${playingVariation.name} vs ${playingVariation.opponent.name}`,
            ),
            createElement('span', { key: 'spacer', className: 'mtg-toolbar__spacer' }),
            createElement(
              'button',
              {
                key: 'back',
                type: 'button',
                className: 'mtg-btn',
                onClick: (): void => {
                  setPlayingVariation(null);
                },
              },
              DECKS_BACK_LABEL,
            ),
          ]
        : null,
      body: variationGame,
    });
  }

  // The workbench is a workspace and takes the whole route, for the reason the
  // builder does: a library above it would be a second page of decks over the
  // one being described, and its own shelf is already that list.
  if (selected?.kind === 'workbench') {
    return deckScreen(
      WORKBENCH_TITLE,
      createElement(WorkbenchScreen, {
        // Offered only when there is a pool to resolve the deck's card ids
        // against. Its absence is a real state rather than a missing wire, and
        // the workbench draws no play button rather than one that cannot work.
        ...(pool.cards.length === 0
          ? {}
          : {
              onPlay: (variation: Variation, opponentId: string | null): void => {
                const reopened = reopenVariation(pool.cards, variation);
                if (reopened.build === null) {
                  setWorkbenchRefusal(missingNote(reopened.missing));
                  return;
                }
                const mine = { build: reopened.build, name: variation.name };
                if (opponentId === null) {
                  setWorkbenchRefusal(null);
                  setPlayingVariation(mine);
                  return;
                }
                // The opponent is fetched here rather than in the workbench,
                // because this is where the pool it has to be reopened against
                // is and where the refusal already lives. The shelf row that
                // named it carries no decklist: a shelf of thirty variations
                // does not send thirty decks to draw itself.
                void fetchVariation(opponentId).then((answer) => {
                  if (answer.kind !== 'ok') {
                    setWorkbenchRefusal(answer.message);
                    return;
                  }
                  const theirs = reopenVariation(pool.cards, answer.value);
                  if (theirs.build === null) {
                    setWorkbenchRefusal(missingNote(theirs.missing));
                    return;
                  }
                  setWorkbenchRefusal(null);
                  setPlayingVariation({
                    ...mine,
                    opponent: { name: answer.value.name, cards: deckFor(theirs.build).deck },
                  });
                });
              },
            }),
        ...(workbenchRefusal === null ? {} : { refusal: workbenchRefusal }),
        ...(selected.variationId === undefined ? {} : { openVariationId: selected.variationId }),
      }),
      () => {
        setSelected(null);
      },
    );
  }

  // The builder is a workspace and takes the whole route: a library above it
  // would be a second page of decks over the one being built, and the pool it
  // draws from already fills the screen.
  //
  // Through `deckScreen`, so it is the same frame of boxes an open deck is
  // (`mtg-pmpu`). It drew its own page head and left the body a document, which
  // on a 1440x900 desk made the builder 13,436px tall: reaching the pool took
  // the deck you were cutting from off the top of the screen, on the one screen
  // whose whole activity is moving cards between the two. `./DeckPane.ts`
  // is the other half of that change.
  //
  // Not while a game is on. `ConstructedGame` swaps the builder for `LiveGame`
  // in place, and the frame's contract is that nothing inside it scrolls except
  // a pane — a true sentence about two panes of cards and a false one about a
  // board. So the play surface keeps the document it has always had, and says
  // which it is through the callback that exists for exactly this question.
  if (building && props.cards !== undefined) {
    const game = createElement(ConstructedGame, {
      pool: pool.cards,
      poolNote: pool.note,
      onOpenDeckChange: setOpenName,
      onPlayingChange: setPlayingInBuilder,
      ...(openSavedId === undefined ? {} : { openSavedDeckId: openSavedId }),
      ...(props.precons?.status === 'ready' ? { precons: props.precons.file } : {}),
      // The map rather than the header's set: the pool spans every staged set,
      // so which one a deck was cut from is a fact about the cards somebody
      // chose (`./constructed-pool.ts`, `mtg-6nqs`).
      setOf: pool.setOf,
      ...(importing ? { openFiles: true } : {}),
      // The union's resolver rather than the header's, for the reason the map
      // above is the union's: a pool card from another staged set drew the
      // labeled pending frame while its picture sat in that set's own manifest
      // (`./constructed-pool.ts`, `mtg-pzpz`).
      ...(pool.artFor === null ? {} : { artFor: pool.artFor }),
      // The name of the build and the way out of it, drawn by the builder's own
      // toolbar rather than by a page head above it (`mtg-i8xl`): a 59px band
      // holding a title and one button, over a 66px band holding the counts and
      // the rest of the buttons, is two bands saying one thing.
      title: builderTitle(openName),
      onBack: (): void => setSelected(null),
    });
    // One `builderScreen` across both states, for the reason the variation path
    // above gives: two trees remount the child, and the child is holding the
    // game. While building there is no page head at all — the builder's own
    // toolbar is the head — and while playing there is, because the toolbar is
    // gone with the builder.
    return builderScreen({
      screen: 'mtg-builder-screen',
      framed: !playingInBuilder,
      head: playingInBuilder
        ? [
            createElement('h1', { key: 'title', className: 'mtg-page-title' }, builderTitle(openName)),
            createElement('span', { key: 'spacer', className: 'mtg-toolbar__spacer' }),
            createElement(
              'button',
              {
                key: 'back',
                type: 'button',
                className: 'mtg-btn',
                onClick: (): void => setSelected(null),
              },
              DECKS_BACK_LABEL,
            ),
          ]
        : null,
      body: game,
    });
  }

  // An open deck is a workspace and takes the whole route, on the same argument
  // the builder above makes: a library over a deck is a second page of decks
  // above the one being read. `deckScreen` is where the frame is described.
  if (selected?.kind === 'artifact' && artifactReady) {
    return createElement(OpenDeck, {
      deck: props.state.deck,
      onBack: () => {
        setSelected(null);
      },
    });
  }
  if (selectedPrecon !== undefined && props.cards !== undefined) {
    return deckScreen(
      selectedPrecon.name,
      createElement(PreconDeckView, {
        deck: selectedPrecon,
        cards: props.cards,
        ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
      }),
      () => setSelected(null),
    );
  }

  const tile = (key: string, set: DeckSetRef | null, node: ReactElement): LibraryRow => ({
    key,
    set,
    node,
  });

  const rows: readonly LibraryRow[] = [
    // The written decks are the staged set's own: they are in a file beside it
    // and they name its card ids, so they file under it and nowhere else.
    ...preconDecks.map((deck) => {
      const facts = props.cards === undefined ? null : preconFacts(deck, props.cards);
      return tile(
        deck.id,
        stagedSet,
        createElement(DeckCard, {
          key: deck.id,
          kind: 'precon' as const,
          name: deck.name,
          colors: facts?.colors ?? [],
          plan: deck.plan,
          ...(facts === null ? {} : { centerpiece: facts.payoffName }),
          ...(facts === null ? {} : { counts: preconCountsLine(facts) }),
          selected: selected?.kind === 'precon' && selected.id === deck.id,
          actionLabel: openDeckLabel(deck.name),
          onSelect: (): void => setSelected({ kind: 'precon', id: deck.id }),
        }),
      );
    }),
    // `@mtg/decklab`'s artifact is chosen out of the 38,623-card store rather
    // than out of a set, so it has no set to shelve under and says so.
    ...(props.state.status === 'ready'
      ? [
          tile(
            'artifact',
            null,
            createElement(DeckCard, {
              key: 'artifact',
              kind: 'artifact' as const,
              name: props.state.deck.prompt,
              colors: props.state.deck.colors,
              counts: deckCountsLine([counted(props.state.deck.totalCards, 'card'), props.state.deck.format]),
              selected: selected?.kind === 'artifact',
              actionLabel: openDeckLabel(props.state.deck.prompt),
              onSelect: (): void => setSelected({ kind: 'artifact' }),
            }),
          ),
        ]
      : []),
    // The workbench's own decks. They name the sets they were cut from, so a
    // one-set variation shelves under that set the way a precon does; a
    // multi-set one names several and belongs under none of them, which is the
    // case `DECKS_UNPLACED_LABEL` already exists for.
    ...variations.map((row) =>
      tile(
        `variation:${row.id}`,
        variationSet(row, setNames, stagedSet),
        createElement(DeckCard, {
          key: `variation:${row.id}`,
          kind: 'variation' as const,
          name: row.name,
          colors: row.colors,
          plan: row.prompt,
          counts: deckCountsLine([
            counted(row.totalCards, 'card'),
            row.sets.join(', '),
            ...(row.shortfallCount === 0 ? [] : [counted(row.shortfallCount, 'shortfall')]),
          ]),
          // No `selected`: pressing one hands the whole route to the workbench,
          // so there is no library underneath for a selected tile to be on.
          // The type says so too -- `selected` is narrowed past `workbench` by
          // the early return above, and a comparison that cannot be true is a
          // claim about a state this screen does not have.
          actionLabel: openDeckLabel(row.name),
          onSelect: (): void => {
            setSelected({ kind: 'workbench', variationId: row.id });
          },
        }),
      ),
    ),
    ...saved.map((deck) =>
      tile(
        deck.id,
        deck.set ?? null,
        createElement(DeckCard, {
          key: deck.id,
          kind: 'saved' as const,
          name: deck.name,
          colors: savedDeckColors(deck, props.cards),
          // Where the deck came from, beside how big it is. Until `mtg-j1rg`
          // the Constructed panel was the only surface that could save one, so
          // the badge above said everything there was to say; Sealed and Draft
          // keep decks now and three histories were filing under one word. A
          // deck saved before this reads as Constructed rather than as blank,
          // because that panel is where every one of them came from.
          counts: deckCountsLine([
            counted(savedCardCount(deck), 'card'),
            SAVED_SOURCE_LABELS[savedDeckSource(deck)],
          ]),
          actionLabel: openDeckLabel(deck.name),
          // A saved deck opens in the builder, which is the only surface
          // that can show one: it is a list of ids this browser holds, not a
          // staged document with art and criteria.
          onSelect: (): void => {
            enterBuilder(false);
          },
        }),
      ),
    ),
  ];

  const { groups, unplaced } = shelveDecks(rows);
  const shelves = [
    ...groups.map((group) =>
      shelf(
        'h2',
        group.label,
        createElement(
          'div',
          { className: 'mtg-decklib__sets' },
          ...group.rows.map((set) => shelf('h3', set.setName, deckGrid(set.setName, set.rows))),
        ),
      ),
    ),
    ...(unplaced.length === 0
      ? []
      : [shelf('h2', DECKS_UNPLACED_LABEL, deckGrid(DECKS_UNPLACED_LABEL, unplaced))]),
  ];

  return createElement(
    'div',
    null,
    head,
    // Every shelf is drawn only when it holds something, so a library holding
    // nothing would otherwise be a page title over a blank. The sentence names
    // the two buttons above it, which are the two things that change the state.
    shelves.length === 0 ? createElement('p', { className: 'mtg-page-note' }, DECKS_EMPTY_NOTE) : null,
    ...shelves,
  );
}
