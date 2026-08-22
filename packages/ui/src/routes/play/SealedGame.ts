/**
 * Sealed, end to end: open six packs, build, play, without touching a terminal.
 *
 * Two phases in one component because they are one activity. The phase lives in
 * state rather than in the hash, since a half-built deck is not something a URL
 * can carry and a reload landing on "play" with no deck would be worse than
 * landing back on the builder.
 *
 * Two ways into the game, because the difference between them is one option on
 * the deal: one seats a bot across the table and one seats a second person at
 * this screen. That second button is the only route from `npm run play` to a
 * two-person game, and without it the seat-following board underneath is
 * reachable from library code and tests but not by anybody playing.
 */
import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import { LiveGame } from './LiveGame';
import { SealedBuilder } from './SealedBuilder';
import { dealSealedGame } from './deal';
import type { OpponentKind } from './deal';
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
import type { SealedBuild } from './sealed';
import type { PlayConfig } from './use-session';

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
  const [build, setBuild] = useState<SealedBuild>(() =>
    openSealed(props.set, seed, props.collation === undefined ? {} : { collation: props.collation }),
  );
  const [playing, setPlaying] = useState<PlayConfig | null>(null);

  const deck = useMemo(() => deckFor(build), [build]);

  const onToggle = useCallback((index: number): void => {
    setBuild((current) => toggle(current, index));
  }, []);
  const onSuggest = useCallback((): void => {
    setBuild(resuggest);
  }, []);
  const onClear = useCallback((): void => {
    setBuild(clearSelection);
  }, []);
  const onAdjustBasics = useCallback((color: Color, delta: number): void => {
    setBuild((current) => adjustBasics(current, color, delta));
  }, []);
  const onSuggestBasics = useCallback((): void => {
    setBuild(resuggestBasics);
  }, []);
  // The opponent kind comes from which button was pressed, which is the whole
  // of the in-app entry to a hotseat game: everything below this line is the
  // same code either way, because a second person seats where the bot would.
  const onPlay = useCallback(
    (opponent: OpponentKind): void => {
      const dealt = dealSealedGame(deck.deck, props.set, {
        seed,
        opponent,
        ...(props.youName === undefined ? {} : { youName: props.youName }),
        ...(props.opponentName === undefined ? {} : { opponentName: props.opponentName }),
        ...(props.collation === undefined ? {} : { collation: props.collation }),
      });
      setPlaying(dealt.config);
      props.onPlayingChange?.(true);
    },
    [deck.deck, props, seed],
  );
  if (playing !== null) {
    return createElement(LiveGame, {
      config: playing,
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
    onPlay,
    seed,
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
  });
}
