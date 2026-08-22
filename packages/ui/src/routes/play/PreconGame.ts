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
 * hash: `#/play?deck=…&vs=…&seed=…` reopens the exact game, which is the same
 * bargain `#/replay?seq=` makes. Nothing about the selection reaches
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
 * So Play publishes `deck` and `vs` and **no seed**: the hash names a table, a
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
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card } from '@mtg/dsl';
import type { PreconDeck, PreconFile } from '@mtg/deckbuild';
import { LiveGame } from './LiveGame';
import { dealPreconGame } from './deal';
import type { OpponentKind } from './deal';
import type { PositionArt } from './position';
import { preconFacts } from './precon-facts';
import { PreconPicker } from './PreconPicker';
import { PreconStrip } from './precon-strip';
import { newSeed } from './seed';
import type { PlayConfig } from './use-session';

/**
 * What `#/play?deck=&vs=&seed=` carries, and what a caller writes back to it.
 *
 * `seed` is optional because its presence is the whole meaning of the
 * parameter: present, the hash pins one deal and a reload reproduces it;
 * absent, the hash names a table and a reload deals a fresh game of it. A
 * caller writes the parameter away — `router.setParams` deletes a key given an
 * empty string — rather than leaving a stale seed under a new deal.
 */
export interface PreconSelection {
  readonly deck: string;
  readonly vs: string;
  readonly seed?: string;
}

export interface PreconGameProps {
  readonly file: PreconFile;
  /** The set the ids resolve against. Already checked by `preconProblem`. */
  readonly set: readonly Card[];
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
}

/** The deck that id names, or the file's first deck when it names none. */
function deckOr(file: PreconFile, deckId: string | undefined, fallbackIndex: number): PreconDeck {
  const named = deckId === undefined ? undefined : file.decks.find((deck) => deck.id === deckId);
  if (named !== undefined) return named;
  const fallback = file.decks[Math.min(fallbackIndex, file.decks.length - 1)];
  if (fallback === undefined) throw new Error('a precon file with no decks reached PreconGame');
  return fallback;
}

export function PreconGame(props: PreconGameProps): ReactElement {
  // A fresh seed per mount when the caller names none, held in state for the
  // reason `SealedGame` documents: a seed regenerated on render would rename
  // the table under somebody who is still reading it. It is settable rather
  // than fixed because a reshuffle is a new deal, and a new deal is a new name.
  const [seed, setSeed] = useState<string>(() => props.seed ?? newSeed('lab/precon'));
  const [yourDeckId, setYourDeckId] = useState<string>(() => deckOr(props.file, props.deckId, 0).id);
  const [opponentDeckId, setOpponentDeckId] = useState<string>(
    () => deckOr(props.file, props.opponentDeckId, 1).id,
  );
  // Who is holding the other deck, remembered so a reshuffle deals the game
  // that is being played rather than always dealing a bot game. A table opened
  // straight from a link has never been asked, and a bot is the answer that
  // needs nobody else in the room.
  const [opponent, setOpponent] = useState<OpponentKind>('bot');
  // A hash that already names both decks is a link to a table, so it opens the
  // table rather than the picker. Lazy, so it happens once: re-dealing on a
  // later render would restart the game underneath the person playing it.
  const [playing, setPlaying] = useState<PlayConfig | null>(() => {
    const yours = props.deckId === undefined ? undefined : deckOr(props.file, props.deckId, 0);
    const theirs =
      props.opponentDeckId === undefined ? undefined : deckOr(props.file, props.opponentDeckId, 1);
    if (yours === undefined || theirs === undefined) return null;
    return dealPreconGame(yours, theirs, props.set, { seed }).config;
  });
  // First press of Reshuffle arms it, second deals. See `precon-strip.ts`: the
  // game on screen is somebody's afternoon and there is no undo across a deal.
  const [armed, setArmed] = useState(false);

  const facts = useMemo(
    () => props.file.decks.map((deck) => preconFacts(deck, props.set)),
    [props.file, props.set],
  );

  useEffect(() => {
    if (playing !== null) props.onPlayingChange?.(true);
  }, [playing, props.onPlayingChange]);

  const onPlay = useCallback(
    (kind: OpponentKind): void => {
      const yours = deckOr(props.file, yourDeckId, 0);
      const theirs = deckOr(props.file, opponentDeckId, 1);
      setOpponent(kind);
      setPlaying(dealPreconGame(yours, theirs, props.set, { seed, opponent: kind }).config);
      props.onPlayingChange?.(true);
      // No seed: this link is to a table, and opening it again deals a new game
      // of it. Pressing `Kaelen to this game` is what pins one.
      props.onSelect?.({ deck: yours.id, vs: theirs.id });
    },
    [props, yourDeckId, opponentDeckId, seed],
  );

  const onReshuffle = useCallback((): void => {
    const next = newSeed('lab/precon');
    const yours = deckOr(props.file, yourDeckId, 0);
    const theirs = deckOr(props.file, opponentDeckId, 1);
    setSeed(next);
    setArmed(false);
    setPlaying(dealPreconGame(yours, theirs, props.set, { seed: next, opponent }).config);
    // The old seed in the hash would now name a game nobody is playing, so it
    // goes; a reload lands on a fresh deal, which is what the screen shows.
    props.onSelect?.({ deck: yours.id, vs: theirs.id });
  }, [props, yourDeckId, opponentDeckId, opponent]);

  const onPin = useCallback((): void => {
    props.onSelect?.({ deck: yourDeckId, vs: opponentDeckId, seed });
  }, [props, yourDeckId, opponentDeckId, seed]);

  const onArm = useCallback((): void => setArmed(true), []);

  if (playing !== null) {
    return createElement(LiveGame, {
      config: playing,
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
    facts,
    yourDeckId,
    opponentDeckId,
    onChooseYours: setYourDeckId,
    onChooseTheirs: setOpponentDeckId,
    onPlay,
    seed,
    ...(props.note === undefined ? {} : { note: props.note }),
  });
}
