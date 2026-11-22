/**
 * Picking a preconstructed deck and playing it, in one component.
 *
 * The same two-phase shape `SealedGame` has, and for the same reason: choosing
 * and playing are one activity, and a reload that landed on a board with no
 * deck behind it would be worse than landing back on the choice.
 *
 * # The selection is a deal input, so it lives where the seed lives
 *
 * A game here is a pure function of (seed, your deck id, their deck id) plus
 * the choice list, because neither deck is opened from a pool — the lists are
 * fixed. That triple is therefore the whole name of a table, and it goes in the
 * hash: `#/play?deck=…&against=…&seed=…` reopens the exact game, which is the same
 * bargain `#/analysis/replay?seq=` makes. Nothing about the selection reaches
 * `GameState`; it decides which `DeckList` values `dealPreconGame` builds and
 * stops there.
 *
 * # A seed in the hash means pinned; no seed means a fresh deal
 *
 * That split is the fix this file exists for. Pressing Play used to write the
 * seed back beside the two deck ids, so the link the picker produced was a link
 * to *one shuffle* — reloading it, or coming back to it tomorrow, replayed the
 * identical opening hand, and there was no control anywhere that dealt a
 * different one. A precon is a deck you play repeatedly; every game of it being
 * the same game is the defect.
 *
 * So Play publishes `deck` and `against` and **no seed**: the hash names a table, a
 * mount draws a fresh seed for it, and coming back deals a new game with the
 * same two decks. Determinism is not weakened anywhere — the seed is still
 * fixed once per deal, still total over the game, and now on screen for the
 * whole of it rather than only on the picker. What a player gains is the
 * choice: `Kaelen to this game` writes the seed into the hash and that link
 * reproduces that exact deal, `Reshuffle` draws a new seed and clears it. The
 * hash therefore always describes what a reload gives you.
 *
 * Props name the decks and `onSelect` publishes them. The selection is *also*
 * held in state, because a person clicking around the picker has not chosen
 * anything yet — the hash is written when they press Play, not on every press.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { gameplayReport } from '../../net/gameplay';
import { LiveGame } from './LiveGame';
import { dealDeckMatch } from './deal';
import type { PositionArt } from './position';
import { playablePrecon } from './playable-deck';
import type { PlayableDeck } from './playable-deck';
import { PreconPicker } from './PreconPicker';
import { PreconStrip } from './precon-strip';
import { newSeed } from './seed';
import type { PlayConfig } from './use-session';

/**
 * What `#/play?deck=&against=&seed=` carries, and what a caller writes back to it.
 *
 * `seed` is optional because its presence is the whole meaning of the
 * parameter: present, the hash pins one deal and a reload reproduces it;
 * absent, the hash names a table and a reload deals a fresh game of it. A
 * caller writes the parameter away — `router.setParams` deletes a key given an
 * empty string — rather than leaving a stale seed under a new deal.
 */
export interface PreconSelection {
  readonly deck: string;
  readonly against: string;
  readonly seed?: string;
}

export interface PreconGameProps {
  readonly file: PreconFile;
  /** The set the ids resolve against. Already checked by `preconProblem`. */
  readonly set: readonly Card[];
  /**
   * Decks that are not in the set's written file, offered beside the ones that
   * are.
   *
   * `mtg-pxdo`. the playtester: *"I just want to be able to do a selectable deck like
   * from the play tab the same way we can easily play a paired game of sky
   * islands vs down in the gloom."* The decks the workbench built are finished,
   * designed sixties of cards this kernel runs — the same thing a precon is,
   * arrived at differently — so they belong in this picker rather than behind a
   * builder on another tab. Resolved by the caller, which is the layer that
   * knows how to reach the deck server.
   */
  readonly alsoPlayable?: readonly PlayableDeck[];
  /** From `#/play?seed=`. Present only for a link somebody pinned. */
  readonly seed?: string;
  /** From the hash. An id the file does not hold falls back to the first deck. */
  readonly deckId?: string;
  readonly opponentDeckId?: string;
  /**
   * Publishes the table when it opens, and again whenever what a reload would
   * deal changes — a reshuffle clears the seed, pinning writes it.
   *
   * Optional so the component is usable without a router — a test and an
   * embedder both want to drive it directly — and the game is identical either
   * way. What a caller loses by omitting it is the shareable link, not the
   * reproducibility: the seed is still fixed at each deal and still on screen.
   */
  readonly onSelect?: (selection: PreconSelection) => void;
  readonly artFor?: PositionArt;
  readonly note?: string;
  /** Lets the setup switch disappear once this child becomes a table. */
  readonly onPlayingChange?: (playing: boolean) => void;
  /**
   * The count of landing-screen requests off the router (`../../app/router.ts`).
   *
   * A table is state here rather than in the hash — the hash names the two
   * decks, and clearing it does not end a game that is already dealt — so a
   * press of the mark in the corner had no way to reach this component and left
   * a board on screen under a bar that had stopped naming it. A change in this
   * number is that press, and the answer to it is the picker.
   */
  readonly landing?: number;
}

/** The deck that id names, or the list's own fallback when it names none. */
function deckOr(
  decks: readonly PlayableDeck[],
  deckId: string | undefined,
  fallbackIndex: number,
): PlayableDeck {
  const named = deckId === undefined ? undefined : decks.find((deck) => deck.id === deckId);
  if (named !== undefined) return named;
  const fallback = decks[Math.min(fallbackIndex, decks.length - 1)];
  if (fallback === undefined) throw new Error('a picker with no decks reached PreconGame');
  return fallback;
}

export function PreconGame(props: PreconGameProps): ReactElement {
  // Every deck the picker offers, written ones first. The order is what decides
  // the two fallbacks below, so the set's own decks stay the pair a hashless
  // arrival lands on: the built decks are an addition to this screen, not a
  // change to what it opens on.
  const decks = useMemo<readonly PlayableDeck[]>(
    () => [
      ...props.file.decks.map((deck) => playablePrecon(deck, props.set, props.file.setCode)),
      ...(props.alsoPlayable ?? []),
    ],
    [props.file, props.set, props.alsoPlayable],
  );

  // A fresh seed per mount when the caller names none, held in state for the
  // reason `SealedGame` documents: a seed regenerated on render would rename
  // the table under somebody who is still reading it. It is settable rather
  // than fixed because a reshuffle is a new deal, and a new deal is a new name.
  const [seed, setSeed] = useState<string>(() => props.seed ?? newSeed('lab/precon'));
  const [yourDeckId, setYourDeckId] = useState<string>(() => deckOr(decks, props.deckId, 0).id);
  const [opponentDeckId, setOpponentDeckId] = useState<string>(
    () => deckOr(decks, props.opponentDeckId, 1).id,
  );
  // A hash that already names both decks is a link to a table, so it opens the
  // table rather than the picker. Lazy, so it happens once: re-dealing on a
  // later render would restart the game underneath the person playing it.
  const [playing, setPlaying] = useState<PlayConfig | null>(() => {
    const yours = props.deckId === undefined ? undefined : deckOr(decks, props.deckId, 0);
    const theirs = props.opponentDeckId === undefined ? undefined : deckOr(decks, props.opponentDeckId, 1);
    if (yours === undefined || theirs === undefined) return null;
    return dealDeckMatch(yours, theirs, { seed }).config;
  });
  // First press of Reshuffle arms it, second deals. See `precon-strip.ts`: the
  // game on screen is somebody's afternoon and there is no undo across a deal.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (playing !== null) props.onPlayingChange?.(true);
  }, [playing, props.onPlayingChange]);

  // Somebody asked for the Play tab's landing screen while a game was on. The
  // deal is not kept for a return: this component's whole state *is* the game,
  // and a table nobody is looking at is not a thing to hold. What survives is
  // what always survived a reload — the two deck ids and the seed, which the
  // hash carries and `Kaelen to this game` pins.
  const landing = props.landing;
  const asked = useRef(landing);
  const { onPlayingChange } = props;
  useEffect(() => {
    if (landing === asked.current) return;
    asked.current = landing;
    setPlaying(null);
    setArmed(false);
    onPlayingChange?.(false);
  }, [landing, onPlayingChange]);

  const onPlay = useCallback((): void => {
    const yours = deckOr(decks, yourDeckId, 0);
    const theirs = deckOr(decks, opponentDeckId, 1);
    setPlaying(dealDeckMatch(yours, theirs, { seed }).config);
    props.onPlayingChange?.(true);
    // No seed: this link is to a table, and opening it again deals a new game
    // of it. Pressing `Kaelen to this game` is what pins one.
    props.onSelect?.({ deck: yours.id, against: theirs.id });
  }, [props, decks, yourDeckId, opponentDeckId, seed]);

  const onReshuffle = useCallback((): void => {
    const next = newSeed('lab/precon');
    const yours = deckOr(decks, yourDeckId, 0);
    const theirs = deckOr(decks, opponentDeckId, 1);
    setSeed(next);
    setArmed(false);
    setPlaying(dealDeckMatch(yours, theirs, { seed: next }).config);
    // The old seed in the hash would now name a game nobody is playing, so it
    // goes; a reload lands on a fresh deal, which is what the screen shows.
    props.onSelect?.({ deck: yours.id, against: theirs.id });
  }, [props, decks, yourDeckId, opponentDeckId]);

  const onPin = useCallback((): void => {
    props.onSelect?.({ deck: yourDeckId, against: opponentDeckId, seed });
  }, [props, yourDeckId, opponentDeckId, seed]);

  const onArm = useCallback((): void => setArmed(true), []);

  if (playing !== null) {
    return createElement(LiveGame, {
      config: playing,
      report: gameplayReport('constructed'),
      toolbar: createElement(PreconStrip, {
        seed,
        armed,
        onArm,
        onReshuffle,
        // The hash carries this deal only when it names this seed, which is
        // exactly what the button would write, so the state is read off the
        // props rather than remembered here and allowed to drift.
        pinned: props.seed === seed,
        ...(props.onSelect === undefined ? {} : { onPin }),
      }),
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }
  return createElement(PreconPicker, {
    decks,
    yourDeckId,
    opponentDeckId,
    onChooseYours: setYourDeckId,
    onChooseTheirs: setOpponentDeckId,
    onPlay,
    ...(props.note === undefined ? {} : { note: props.note }),
  });
}
