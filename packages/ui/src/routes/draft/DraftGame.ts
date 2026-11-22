/** A finished draft pool through the existing manual builder and Play table. */
import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card, Color } from '@mtg/dsl';
import { buildDeck, buildFromSpells, spellCount } from '@mtg/deckbuild';
import type { HumanDraftProgress } from '@mtg/draft-export';
import { draftedPool } from '@mtg/draft-export';
import { gameplayReport } from '../../net/gameplay';
import { LiveGame } from '../play/LiveGame';
import { PLAY_DRAFTED_DECK_LABEL, SealedBuilder } from '../play/SealedBuilder';
import type { DeckSetRef } from '../deck/library';
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
  /**
   * The set the pod drafted, which is what backs both decks' mana bases.
   *
   * `HumanDraftProgress` carries seats, picks and a seed and no set, so it has
   * to arrive beside the draft. `mtg-aqxi.9`: a drafted pool is 45 cards and a
   * mana base built by hunting a printed Swamp inside 45 cards mints one
   * instead, under an id the set's art manifest has never heard of.
   */
  readonly set: readonly Card[];
  readonly artFor?: PositionArt;
  /**
   * The set the pod drafted, named, so a kept deck shelves under it.
   *
   * The same fact as `set` above said in the words the deck library keeps —
   * a name and where the set came from — and absent where the page cannot
   * name one (`../deck/library.ts`).
   */
  readonly setRef?: DeckSetRef;
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
export function legalBotDraftDeck(
  pool: readonly Card[],
  set: readonly Card[] | null = null,
): readonly Card[] {
  const suggested = buildDeck(pool, { set });
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
  return buildFromSpells(spells, pool, { set }).deck;
}

function initialBuild(draft: HumanDraftProgress, set: readonly Card[]): SealedBuild {
  const pool = seatPool(draft, draft.humanSeat);
  // A drafted pool is a seat's picks rather than a pack of dealt slots: the
  // draft loop hands back cards and keeps no record of which sheet each pick
  // came off. So this build declines the question the way a remote room's does.
  return { pool, chosen: suggestSelection(pool), basics: null, set, foils: null };
}

export function DraftGame(props: DraftGameProps): ReactElement {
  const [build, setBuild] = useState<SealedBuild>(() => initialBuild(props.draft, props.set));
  const [playing, setPlaying] = useState<PlayConfig | null>(null);
  const deck = useMemo(() => deckFor(build), [build]);
  const opponentSeat = props.draft.seats.find((seat) => seat.seat !== props.draft.humanSeat);
  if (opponentSeat === undefined) throw new Error('the draft has no bot seat');
  const opponentDeck = useMemo(
    () => legalBotDraftDeck(draftedPool(opponentSeat), props.set),
    [opponentSeat, props.set],
  );

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
        report: gameplayReport('draft'),
        ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        toolbar: createElement(
          'button',
          { type: 'button', className: 'mtg-btn', onClick: (): void => setPlaying(null) },
          'Back to draft deckbuilding',
        ),
      }),
    );
  }

  return createElement(SealedBuilder, {
    // The head bar the screen frame draws, rather than a bar of its own above
    // it: since `mtg-sk1c` the builder is a `.mtg-screen`, and a screen nested
    // inside a plain wrapper is handed no height to fill.
    // Spoken, not drawn (`mtg-i195`). The shell's tab bar above this already
    // reads Draft and the pane heads say what the two halves are, so the word
    // cost the workspace a row to repeat what three other things on the screen
    // say. The heading stays in the document because a screen without one is a
    // screen a reader cannot name.
    head: createElement('h1', { className: 'mtg-page-title mtg-sr-only' }, 'Draft'),
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
    playLabel: PLAY_DRAFTED_DECK_LABEL,
    source: 'draft',
    ...(props.setRef === undefined ? {} : { setRef: props.setRef }),
    contextNote: `Draft finished from ${String(props.draft.picks.length)} recorded picks. Your picks are ready to build; the other seat uses a legal deck from one of the seven bot-drafted pools.`,
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
  });
}
