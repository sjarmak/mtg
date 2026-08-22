/** A finished draft pool through the existing manual builder and Play table. */
import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card, Color } from '@mtg/dsl';
import { buildDeck, buildFromSpells, spellCount } from '@mtg/deckbuild';
import type { HumanDraftProgress } from '@mtg/draft-export';
import { draftedPool } from '@mtg/draft-export';
import { LiveGame } from '../play/LiveGame';
import { SealedBuilder } from '../play/SealedBuilder';
import { dealDraftGame } from '../play/deal';
import type { PositionArt } from '../play/position';
import {
  adjustBasics,
  clearSelection,
  deckFor,
  resuggest,
  resuggestBasics,
  suggestSelection,
  toggle,
} from '../play/sealed';
import type { SealedBuild } from '../play/sealed';
import type { PlayConfig } from '../play/use-session';

export interface DraftGameProps {
  readonly draft: HumanDraftProgress;
  readonly artFor?: PositionArt;
}

function seatPool(draft: HumanDraftProgress, seat: number): readonly Card[] {
  const found = draft.seats[seat];
  if (found === undefined) throw new Error(`the draft has no seat ${String(seat)}`);
  return draftedPool(found);
}

/**
 * A bot always registers a legal list when its pool holds 23 cards.
 * `buildDeck` supplies its judgment; if that judgment chose a shallow pair,
 * the remaining drafted cards fill only the empty spell slots before the
 * ordinary manual builder validates and supplies basics.
 */
export function legalBotDraftDeck(pool: readonly Card[]): readonly Card[] {
  const suggested = buildDeck(pool);
  if (suggested.complete) return suggested.deck;
  const spells = [...suggested.spells];
  const used = new Set<number>();
  for (const spell of spells) {
    const index = pool.findIndex((card, at) => !used.has(at) && card.id === spell.id);
    if (index >= 0) used.add(index);
  }
  for (const [index, card] of pool.entries()) {
    if (spells.length >= spellCount(suggested.config)) break;
    if (!used.has(index)) spells.push(card);
  }
  return buildFromSpells(spells, pool).deck;
}

function initialBuild(draft: HumanDraftProgress): SealedBuild {
  const pool = seatPool(draft, draft.humanSeat);
  return { pool, chosen: suggestSelection(pool), basics: null };
}

export function DraftGame(props: DraftGameProps): ReactElement {
  const [build, setBuild] = useState<SealedBuild>(() => initialBuild(props.draft));
  const [playing, setPlaying] = useState<PlayConfig | null>(null);
  const deck = useMemo(() => deckFor(build), [build]);
  const opponentSeat = props.draft.seats.find((seat) => seat.seat !== props.draft.humanSeat);
  if (opponentSeat === undefined) throw new Error('the draft has no bot seat');
  const opponentDeck = useMemo(() => legalBotDraftDeck(draftedPool(opponentSeat)), [opponentSeat]);

  const onToggle = useCallback((index: number): void => setBuild((current) => toggle(current, index)), []);
  const onSuggest = useCallback((): void => setBuild(resuggest), []);
  const onClear = useCallback((): void => setBuild(clearSelection), []);
  const onAdjustBasics = useCallback(
    (color: Color, delta: number): void => setBuild((current) => adjustBasics(current, color, delta)),
    [],
  );
  const onSuggestBasics = useCallback((): void => setBuild(resuggestBasics), []);
  const onPlay = useCallback((): void => {
    setPlaying(dealDraftGame(deck.deck, opponentDeck, { seed: `${props.draft.seed}/game` }).config);
  }, [deck.deck, opponentDeck, props.draft.seed]);

  if (playing !== null) {
    return createElement(
      'div',
      { className: 'mtg-play-route' },
      createElement(LiveGame, {
        config: playing,
        ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        toolbar: createElement(
          'button',
          { type: 'button', className: 'mtg-btn', onClick: (): void => setPlaying(null) },
          'Back to draft deckbuilding',
        ),
      }),
    );
  }

  return createElement(
    'div',
    null,
    createElement(
      'div',
      { className: 'mtg-page-head' },
      createElement('h1', { className: 'mtg-page-title' }, 'Draft'),
    ),
    createElement(SealedBuilder, {
      build,
      deck,
      onToggle,
      onSuggest,
      onClear,
      onAdjustBasics,
      onSuggestBasics,
      onPlay,
      seed: props.draft.seed,
      poolLabel: 'Drafted pool',
      playLabel: 'Play drafted deck',
      showHotseat: false,
      contextNote: `Draft finished from ${String(props.draft.picks.length)} recorded picks. Your picks are ready to build; the other seat uses a legal deck from one of the seven bot-drafted pools.`,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    }),
  );
}
