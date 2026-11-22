/** One physical-copy deck editor for both printed draft and sealed sessions. */
import { createElement as h, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  PreparedPrintedLimitedFormat,
  PrintedBoosterPayload,
  PrintedLimitedDraftOptions,
} from '@mtg/draft-export';
import type { DeckRef, GameBackend, SessionSpec } from '@mtg/engine';
import {
  validateLimitedDeck,
  addPhysicalCard,
  cutPhysicalCard,
  addBasic,
  cutBasic,
  toDeckRef,
} from '@mtg/limited';
import { suggestPrintedDeck, suggestPrintedBasics } from './deck-evaluation';
import type { LimitedDeck } from '@mtg/limited';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import type { PrintedTokenPrinting } from '@mtg/printed-card';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { writeStored } from '../deck/local-store';
import { PhysicalLimitedBuilder } from '../play/SealedBuilder';
import type { LimitedCardPresentation } from '../play/SealedBuilder';
import type { PrintedLimitedSession } from './printed-limited-session';
import type { PrintedFormatRow } from '../../lab/printed-format';
import { BackendGame } from '../play/BackendGame';
import { OBSERVED_SUBMIT_DECK_LABEL } from '../play/ObservedSeat';
import { newSeed } from '../play/seed';
import { preparePrintedMatch } from './printed-match';
import type { PrintedDraftRatings } from '../../lab/printed-draft-ratings';
import { printedPlayAvailabilityCopy } from './play-availability-copy';

function presentationFor(
  printedCards: readonly PrintedCardPresentation[],
): LimitedCardPresentation<PrintedBoosterPayload> {
  const byId = new Map(printedCards.map((card) => [card.physicalId, card]));
  const printing = (payload: PrintedBoosterPayload): PrintedCardPresentation =>
    byId.get(payload.printing.physicalId) ?? payload.printing;
  return {
    nameOf: ({ printing: card }) => card.name,
    manaCostOf: ({ printing: card }) => card.manaCost,
    groupingFactsOf: ({ printing: card }) => ({
      name: card.name,
      manaValue: card.manaValue,
      colorIdentity: card.colorIdentity.join(''),
      typeLine: card.typeLine,
      rarity: byId.get(card.physicalId)?.rarity ?? null,
    }),
    renderFace: (payload, options) => h(PrintedCardFace, { ...options, card: printing(payload) }),
    facesOf: (payload) => printing(payload).faces.map((face) => face.name),
  };
}

/**
 * What is worth a band above the panes, which is only what has gone wrong.
 *
 * `mtg-84703`. This row printed three standing sentences on every screen -- the
 * deck is saved, the deck holds forty cards, Forge play is installed -- and
 * The playtester named all three: "'Deck saved in browser 40 cards in deck verified
 * full-card and match interaction admission is installed' doesnt need to be
 * there". None of the three is news. The save is the expected outcome of every
 * click, the count is `builderCountsLine` on the deck pane's own heading one
 * band below, and whether Forge is installed is a fact about the machine that
 * does not change while somebody builds a deck.
 *
 * So the two failures keep the band and nothing else does: a deck that is *not*
 * being saved is a warning worth a row of the window, and a match that refused
 * to open is the answer to a button somebody just pressed. Both are already
 * `role='alert'`. The play sentence moves under `Game details` on the bar
 * (`../game-details.ts`), where the setup and the seed already live, so the
 * reason a disabled button is disabled is one keystroke away rather than
 * deleted -- which is what `PLAY_AVAILABILITY_LABEL` is for.
 *
 * Exported so `../../../test/deck/live-builder-density-entry.ts` composes the
 * editor's own banner rather than a copy of it; a rig measuring how tall this
 * row is has to be measuring this row.
 */
export const PLAY_AVAILABILITY_LABEL = 'Forge play';

export interface PrintedPoolStatusProps {
  readonly saved: boolean;
  readonly playError: string | null;
}

export function printedPoolStatus(props: PrintedPoolStatusProps): ReactElement | null {
  const problems = [
    props.saved ? null : 'Deck changes are not saved in this browser.',
    props.playError,
  ].filter((problem): problem is string => problem !== null);
  if (problems.length === 0) return null;
  return h(
    'div',
    { className: 'mtg-printed-pool-status' },
    ...problems.map((problem) => h('span', { key: problem, role: 'alert' }, problem)),
  );
}

export interface PrintedPoolEditorProps {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly initial: LimitedDeck<PrintedBoosterPayload>;
  readonly session: PrintedLimitedSession;
  readonly storageKey: string;
  readonly seed: string;
  readonly title: string;
  readonly contextNote: string;
  readonly poolLabel?: string;
  readonly backend?: GameBackend;
  readonly printedCards: readonly PrintedCardPresentation[];
  /** Token printings the game may present; never in a pool or a gallery. */
  readonly tokens?: readonly PrintedTokenPrinting[];
  readonly playAvailability: PrintedFormatRow['availability']['play'];
  readonly matchBot: Pick<PrintedLimitedDraftOptions, 'score' | 'botPolicy'>;
  readonly draftRatings?: PrintedDraftRatings;
  /** Hands the deck to a table over the network instead of opening a Forge match here. */
  readonly onSubmitDeck?: (deck: DeckRef) => void;
}

function localMatch(props: PrintedPoolEditorProps, deck: LimitedDeck<PrintedBoosterPayload>): SessionSpec {
  return preparePrintedMatch(
    props.prepared,
    { ...props.session, deck: { selectedPhysicalIds: deck.selectedPhysicalIds, basics: deck.basics } },
    { seed: newSeed(`${props.prepared.format.id}/match`), humanSeat: 0 },
    props.matchBot,
    props.draftRatings,
  );
}

export function PrintedPoolEditor(props: PrintedPoolEditorProps): ReactElement {
  const [deck, setDeck] = useState(props.initial);
  const [saved, setSaved] = useState(true);
  const [playError, setPlayError] = useState<string | null>(null);
  const [table, setTable] = useState<SessionSpec | null>(null);
  useEffect(() => {
    setSaved(
      writeStored(
        props.storageKey,
        JSON.stringify({
          ...props.session,
          deck: { selectedPhysicalIds: deck.selectedPhysicalIds, basics: deck.basics },
        }),
      ),
    );
  }, [deck, props.session, props.storageKey]);
  const report = validateLimitedDeck(deck);
  if (table !== null && props.backend !== undefined) {
    return h(BackendGame, {
      backend: props.backend,
      table,
      printedCards: [...props.printedCards, ...(props.tokens ?? [])],
      onNewGame: () => setTable(null),
      onClose: () => setTable(null),
      onOpenFailure: (message) => {
        setPlayError(message);
        setTable(null);
      },
    });
  }
  const submit = props.onSubmitDeck;
  const playEnabled =
    submit !== undefined || (props.playAvailability.status !== 'unavailable' && props.backend !== undefined);
  const playLabel =
    submit !== undefined
      ? OBSERVED_SUBMIT_DECK_LABEL
      : props.playAvailability.status === 'supported'
        ? 'Play Forge match'
        : props.playAvailability.status === 'experimental'
          ? 'Try experimental Forge match'
          : 'Forge play unavailable';
  return h(PhysicalLimitedBuilder<PrintedBoosterPayload>, {
    physicalDeck: deck,
    report,
    presentation: presentationFor(props.printedCards),
    seed: props.seed,
    ...(props.poolLabel === undefined ? {} : { poolLabel: props.poolLabel }),
    contextNote: props.contextNote,
    title: props.title,
    details: [{ term: PLAY_AVAILABILITY_LABEL, value: printedPlayAvailabilityCopy(props.playAvailability) }],
    banner: printedPoolStatus({ saved, playError }),
    playLabel,
    playDisabled: !playEnabled,
    onPlay: () => {
      if (!playEnabled) {
        setPlayError(props.playAvailability.reason);
        return;
      }
      try {
        setPlayError(null);
        if (submit !== undefined) submit(toDeckRef(deck, props.title));
        else setTable(localMatch(props, deck));
      } catch (cause) {
        setPlayError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    onToggle: (id) =>
      setDeck((current) =>
        current.selectedPhysicalIds.includes(id)
          ? cutPhysicalCard(current, id)
          : addPhysicalCard(current, id),
      ),
    onSuggest: () => setDeck((current) => suggestPrintedDeck(current, props.draftRatings)),
    onClear: () =>
      setDeck((current) => ({
        ...current,
        selectedPhysicalIds: [],
        basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
      })),
    onAdjustBasic: (name, delta) =>
      setDeck((current) => (delta > 0 ? addBasic(current, name, delta) : cutBasic(current, name, -delta))),
    onSuggestBasics: () => setDeck((current) => suggestPrintedBasics(current)),
  });
}
