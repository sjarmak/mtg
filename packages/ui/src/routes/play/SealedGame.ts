/**
 * Sealed, end to end: open six packs, build, play, without touching a terminal.
 *
 * One activity, so one component, and the phase lives in state rather than in
 * the hash: a half-built deck is not something a URL can carry, and a reload
 * landing on "play" with no deck would be worse than landing back on the
 * builder.
 *
 * One way into the game: `Play this deck` deals immediately and seats a bot on
 * a second pool opened from the same set under `opponentPoolSeed`, built by
 * `buildDeck`. A second person building their own pool at the same screen was
 * a route here once; it left with the shared-screen arm, and two human seats
 * now exist only as a test fixture.
 */
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import { gameplayReport } from '../../net/gameplay';
import { LiveGame } from './LiveGame';
import { SealedBuilder } from './SealedBuilder';
import type { DeckSetRef } from '../deck/library';
import { dealSealedGame } from './deal';
import type { PositionArt } from './position';
import {
  adjustBasics,
  clearSelection,
  deckFor,
  openSealed,
  resuggest,
  resuggestBasics,
  toggle,
} from './sealed';
import { newSeed } from './seed';
import { writeSealedSession } from './sealed-session';
import type { SealedBuild } from './sealed';
import type { PlayConfig } from './use-session';

/** What the builder says about the one button under it: who the opponent is and where its deck comes from. */
const BUILDER_NOTE =
  'Play the deck against a bot, which opens its own six packs of this set and builds from them.';

export interface SealedGameProps {
  readonly set: readonly Card[];
  readonly seed?: string;
  readonly youName?: string;
  readonly opponentName?: string;
  /**
   * The printing's own sheets, when the staged set carried them.
   *
   * Both openings here read it — the person's six packs and the seat across the
   * table — because a sealed game is one format, and dealing one side from the
   * printing's collation and the other from the rarity recipe would be two.
   */
  readonly collation?: PackCollation;
  /** Reaches the table, never the builder: a compact face has no art window. */
  readonly artFor?: PositionArt;
  /** Lets the setup switch disappear once this child becomes a table. */
  readonly onPlayingChange?: (playing: boolean) => void;
  /**
   * A pool already opened and already cut from, put back the way it was.
   *
   * `mtg-tewc.5`. Passed by the Play chooser's Resume control, which re-deals
   * the stored pool from this set and this seed before mounting; passing it
   * skips the opening below, because opening a second pool is precisely what
   * resuming is for not doing. `props.seed` must be the seed that dealt it, and
   * `./sealed-session.ts` returns the two together for that reason.
   */
  readonly resume?: SealedBuild;
  /**
   * The set these packs were dealt from, recorded on a deck kept off this screen.
   *
   * Absent where the page cannot name one, and passed no further than the
   * builder: it says where a *saved deck* came from and nothing about the deal.
   */
  readonly setRef?: DeckSetRef;
}

export function SealedGame(props: SealedGameProps): ReactElement {
  // A fresh seed per mount when the caller names none, held in state so it
  // survives re-renders: the pool is dealt once, and a seed regenerated on
  // render would re-deal it under someone mid-cut. The old fallback here was
  // the constant `'lab/sealed/v0'`, which is why every session of the lab
  // opened the identical six packs and drew the identical opening hand. The
  // shuffle underneath was never the problem — `setup.ts` has always shuffled
  // from the seeded RNG — the seed was simply pinned.
  //
  // `props.seed` still wins and is still exact, which is what keeps the tests
  // fixed games and lets `#/play?seed=…` reproduce a table.
  const [seed] = useState<string>(() => props.seed ?? newSeed('lab/sealed'));
  const [build, setBuild] = useState<SealedBuild>(
    () =>
      props.resume ??
      openSealed(props.set, seed, props.collation === undefined ? {} : { collation: props.collation }),
  );
  const [playing, setPlaying] = useState<PlayConfig | null>(null);

  const deck = useMemo(() => deckFor(build), [build]);

  // Every edit is the session, so leaving the page and coming back is a resume
  // rather than a re-deal. Written from an effect rather than from each of the
  // five handlers: there is one thing being kept and it is the build, and five
  // call sites is five chances for the next handler to forget.
  //
  // What a failed write means is not decided here. `writeStored` reports one and
  // this reads it, because a private window declines the store outright and a
  // Resume control that then offers nothing is the surface's problem to explain,
  // not something to throw.
  const collated = props.collation !== undefined;
  useEffect((): void => {
    writeSealedSession(build, seed, collated);
  }, [build, seed, collated]);

  const edit = useCallback((change: (current: SealedBuild) => SealedBuild): void => {
    setBuild(change);
  }, []);

  const onToggle = useCallback(
    (index: number): void => {
      edit((current) => toggle(current, index));
    },
    [edit],
  );
  const onSuggest = useCallback((): void => {
    edit(resuggest);
  }, [edit]);
  const onClear = useCallback((): void => {
    edit(clearSelection);
  }, [edit]);
  const onAdjustBasics = useCallback(
    (color: Color, delta: number): void => {
      edit((current) => adjustBasics(current, color, delta));
    },
    [edit],
  );
  const onSuggestBasics = useCallback((): void => {
    edit(resuggestBasics);
  }, [edit]);
  // The deal: `dealSealedGame` opens the opponent's pool from the derived seed
  // and builds out of it, so one seed is the whole account of the match.
  const start = useCallback((): void => {
    const dealt = dealSealedGame(deck.deck, props.set, {
      seed,
      ...(props.youName === undefined ? {} : { youName: props.youName }),
      ...(props.opponentName === undefined ? {} : { opponentName: props.opponentName }),
      ...(props.collation === undefined ? {} : { collation: props.collation }),
    });
    setPlaying(dealt.config);
    props.onPlayingChange?.(true);
  }, [deck.deck, props, seed]);

  if (playing !== null) {
    return createElement(LiveGame, {
      config: playing,
      report: gameplayReport('sealed'),
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  }

  return createElement(SealedBuilder, {
    build,
    deck,
    onToggle,
    onSuggest,
    onClear,
    onAdjustBasics,
    onSuggestBasics,
    onPlay: start,
    seed,
    contextNote: BUILDER_NOTE,
    source: 'sealed',
    ...(props.setRef === undefined ? {} : { setRef: props.setRef }),
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
  });
}
