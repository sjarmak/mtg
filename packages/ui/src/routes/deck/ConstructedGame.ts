/**
 * Constructed, end to end: build sixty cards out of everything playable, then
 * play them, without leaving the Decks tab.
 *
 * Two phases in one component for `SealedGame`'s reason: they are one activity,
 * and the phase lives in state rather than in the hash because a half-built
 * deck is not something a URL can carry.
 *
 * The starting points are the set's own written decks. `buildPrecon` resolves
 * one against the staged cards and `buildFromCards` turns the result back into
 * counts, which is what makes "open this precon and change six cards" a gesture
 * rather than a rebuild.
 */
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card, Color } from '@mtg/dsl';
import { buildPrecon } from '@mtg/deckbuild';
import type { PreconFile } from '@mtg/deckbuild';
import { gameplayReport } from '../../net/gameplay';
import { LiveGame } from '../play/LiveGame';
import { dealConstructedGame, dealDeckMatch } from '../play/deal';
import type { MatchDeck } from '../play/deal';
import type { PositionArt } from '../play/position';
import type { PlayConfig } from '../play/use-session';
import { newSeed } from '../play/seed';
import { ConstructedBuilder } from './ConstructedBuilder';
import {
  addCopy,
  adjustBasics,
  buildFromCards,
  clearDeck,
  cutCopy,
  deckFor,
  emptyBuild,
  restage,
  resuggestBasics,
} from './build';
import type { ConstructedBuild } from './build';
import type { DeckSetRef } from './library';

export interface ConstructedGameProps {
  /** Every card the kernel can run: the pool this deck is cut from. */
  readonly pool: readonly Card[];
  /** The set's written decks, offered as starting points. */
  readonly precons?: PreconFile;
  readonly seed?: string;
  /**
   * A saved deck to open on arrival, named by a link off the landing page.
   * Handed down rather than loaded here: the panel owns the list, the refusal
   * and which deck *Save changes* writes to.
   */
  readonly openSavedDeckId?: string;
  /**
   * Which staged set each pool card came from, so a deck saved here records the
   * set its own cards were cut from rather than the one the header names.
   * Passed straight through: this component owns the build, and the panel that
   * writes the document is two levels down.
   */
  readonly setOf?: ReadonlyMap<string, DeckSetRef>;
  /** Arrived by *Import deck*: open with the decklist box already on screen. */
  readonly openFiles?: boolean;
  /**
   * A deck to open on rather than an empty one.
   *
   * A whole build for the reason `onLoad` takes one: a deck reopened against the
   * pool arrives already assembled or not at all, and the caller is the one that
   * decides what a card the pool no longer holds means. The workbench hands one
   * over when somebody plays a built variation
   * (`./workbench/play.ts`); everything else still starts from nothing chosen,
   * which is what a Constructed build is.
   */
  readonly openBuild?: ConstructedBuild;
  /**
   * The deck on the other side of the table, when somebody chose one.
   *
   * Absent is the mirror `../play/deal.ts` has always dealt, and it is still the
   * right game for a deck built here with nothing behind it. Present is another
   * finished deck, which is what the workbench's shelf made possible: the playtester
   * asked to play the Alaric deck against the Vessari deck.
   *
   * Already reopened against the pool by the caller, for `openBuild`'s reason —
   * a deck the pool no longer holds every card of is the caller's refusal to
   * make, and it is the caller that knows which deck to name in it.
   */
  readonly opponentDeck?: MatchDeck;
  /** Reports the open saved deck's name to the route, which titles itself with it. */
  readonly onOpenDeckChange?: (name: string | null) => void;
  readonly artFor?: PositionArt;
  /** The pool pane's note, when the pool is more than one staged set. */
  readonly poolNote?: string;
  /** Lets the tab's own chrome step aside once this child becomes a table. */
  readonly onPlayingChange?: (playing: boolean) => void;
  /**
   * What the builder calls itself, and the way back to the shelf.
   *
   * Both are the route's, and both are drawn by the builder's own toolbar rather
   * than by a page head above it (`mtg-i8xl`). Passed through here because this
   * component owns the build and the toolbar is one level down.
   */
  readonly title?: string;
  readonly onBack?: () => void;
}

export function ConstructedGame(props: ConstructedGameProps): ReactElement {
  const [seed] = useState<string>(() => props.seed ?? newSeed('lab/constructed'));
  const [build, setBuild] = useState<ConstructedBuild>(() => props.openBuild ?? emptyBuild(props.pool));
  const [playing, setPlaying] = useState<PlayConfig | null>(null);

  // The pool can widen after this component mounts: the staged sets are fetched
  // one document at a time and the union arrives when they all have. Re-seating
  // keeps the deck somebody has already started (`./build.ts`'s `restage`).
  useEffect(() => {
    setBuild((current) => (current.pool === props.pool ? current : restage(current, props.pool)));
  }, [props.pool]);

  const deck = useMemo(() => deckFor(build), [build]);
  const starters = useMemo(
    () => (props.precons?.decks ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
    [props.precons],
  );

  const onAdd = useCallback((cardId: string): void => {
    setBuild((current) => addCopy(current, cardId));
  }, []);
  const onCut = useCallback((cardId: string): void => {
    setBuild((current) => cutCopy(current, cardId));
  }, []);
  const onClear = useCallback((): void => {
    setBuild(clearDeck);
  }, []);
  const onAdjustBasics = useCallback((color: Color, delta: number): void => {
    setBuild((current) => adjustBasics(current, color, delta));
  }, []);
  const onSuggestBasics = useCallback((): void => {
    setBuild(resuggestBasics);
  }, []);
  // A whole build rather than a delta: a saved deck is reopened against the pool
  // by `./saved-decks.ts` and arrives already assembled or not at all.
  const onLoad = useCallback((restored: ConstructedBuild): void => {
    setBuild(restored);
  }, []);
  const onStart = useCallback(
    (id: string): void => {
      const written = props.precons?.decks.find((entry) => entry.id === id);
      if (written === undefined) return;
      setBuild(buildFromCards(props.pool, buildPrecon(written, props.pool).deck));
    },
    [props.pool, props.precons],
  );
  const onPlay = useCallback((): void => {
    // Two dealers rather than one with a flag, which is how `deal.ts` keeps
    // them: a mirror asks whether this deck is any good, and a match asks
    // which of two decks is better.
    const dealt =
      props.opponentDeck === undefined
        ? dealConstructedGame(deck.deck, { seed })
        : dealDeckMatch({ name: props.title ?? 'Your deck', cards: deck.deck }, props.opponentDeck, { seed });
    setPlaying(dealt.config);
    props.onPlayingChange?.(true);
  }, [deck.deck, props, seed]);

  if (playing !== null) {
    return createElement(LiveGame, {
      config: playing,
      report: gameplayReport('constructed'),
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }
  return createElement(ConstructedBuilder, {
    build,
    deck,
    onAdd,
    onCut,
    onClear,
    onAdjustBasics,
    onSuggestBasics,
    onLoad,
    onPlay,
    starters,
    onStart,
    ...(props.openSavedDeckId === undefined ? {} : { openSavedDeckId: props.openSavedDeckId }),
    ...(props.setOf === undefined ? {} : { setOf: props.setOf }),
    ...(props.openFiles === undefined ? {} : { openFiles: props.openFiles }),
    ...(props.onOpenDeckChange === undefined ? {} : { onOpenDeckChange: props.onOpenDeckChange }),
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    ...(props.poolNote === undefined ? {} : { poolNote: props.poolNote }),
    ...(props.title === undefined ? {} : { title: props.title }),
    // A deck this screen was opened *on* rather than one filled in here. The
    // saved-decks bar reads a full deck as a reason to open itself, which turns
    // "play this deck" into a prompt to name it.
    ...(props.openBuild === undefined ? {} : { arrivedWithDeck: true }),
    // So the toolbar's note over the play buttons says who the other seat is
    // rather than that both seats play this deck, which stops being true here.
    ...(props.opponentDeck === undefined ? {} : { opponentName: props.opponentDeck.name }),
    ...(props.onBack === undefined ? {} : { onBack: props.onBack }),
  });
}
