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
import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card, Color } from '@mtg/dsl';
import { buildPrecon } from '@mtg/deckbuild';
import type { PreconFile } from '@mtg/deckbuild';
import { LiveGame } from '../play/LiveGame';
import { dealConstructedGame } from '../play/deal';
import type { OpponentKind } from '../play/deal';
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
  resuggestBasics,
} from './build';
import type { ConstructedBuild } from './build';

export interface ConstructedGameProps {
  /** Every card the kernel can run: the pool this deck is cut from. */
  readonly pool: readonly Card[];
  /** The set's written decks, offered as starting points. */
  readonly precons?: PreconFile;
  readonly seed?: string;
  readonly artFor?: PositionArt;
  /** Lets the tab's own chrome step aside once this child becomes a table. */
  readonly onPlayingChange?: (playing: boolean) => void;
}

export function ConstructedGame(props: ConstructedGameProps): ReactElement {
  const [seed] = useState<string>(() => props.seed ?? newSeed('lab/constructed'));
  const [build, setBuild] = useState<ConstructedBuild>(() => emptyBuild(props.pool));
  const [playing, setPlaying] = useState<PlayConfig | null>(null);

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
  const onPlay = useCallback(
    (opponent: OpponentKind): void => {
      const dealt = dealConstructedGame(deck.deck, { seed, opponent });
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
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
  });
}
