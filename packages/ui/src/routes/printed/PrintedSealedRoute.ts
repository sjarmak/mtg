import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import type { PreparedPrintedLimitedFormat, PrintedBoosterPayload } from '@mtg/draft-export';
import type { DeckRef, GameBackend } from '@mtg/engine';
import type { PrintedTokenPrinting } from '@mtg/printed-card';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import type { PrintedFormatRow } from '../../lab/printed-format';
import type { PrintedDraftRatings } from '../../lab/printed-draft-ratings';
import { prepareLimitedDeck } from '@mtg/limited';
import type { LimitedDeck } from '@mtg/limited';
import { readStored } from '../deck/local-store';
import { PrintedPoolEditor } from './PrintedPoolEditor';
import { printedLimitedFacts } from './limited-facts';
import { restorePrintedSession } from './printed-limited-session';
import type { PrintedLimitedSession } from './printed-limited-session';
import { botForNewPrintedDraft } from './draft-bot';
import { printedDeckCalibrationNote } from './deck-evaluation';

interface Props {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly seed: string;
  readonly backend?: GameBackend;
  readonly printedCards?: readonly PrintedCardPresentation[];
  /** Token printings the game may present; never in a pool or a gallery. */
  readonly tokens?: readonly PrintedTokenPrinting[];
  readonly playAvailability?: PrintedFormatRow['availability']['play'];
  readonly draftRatings?: PrintedDraftRatings;
  /** Hands the built deck to a table over the network; the editor then submits instead of playing. */
  readonly onSubmitDeck?: (deck: DeckRef) => void;
}

function sessionFor(props: Props): PrintedLimitedSession {
  return {
    version: 1,
    mode: 'sealed',
    formatId: props.prepared.format.id,
    fingerprint: props.prepared.fingerprint,
    seed: props.seed,
  };
}
const storageKey = (props: Props): string => `mtg.printed.sealed:${props.prepared.format.id}:${props.seed}`;
type Initial =
  | { readonly ok: true; readonly deck: LimitedDeck<PrintedBoosterPayload> }
  | { readonly ok: false; readonly message: string };

function initialDeck(props: Props): Initial {
  try {
    const raw = readStored(storageKey(props));
    const restored = restorePrintedSession(
      props.prepared,
      raw === null ? sessionFor(props) : JSON.parse(raw),
    );
    if (restored.session.mode !== 'sealed' || restored.session.seed !== props.seed)
      throw new Error('Saved sealed session belongs to another pool.');
    const deck = prepareLimitedDeck(restored.pool, (card) => printedLimitedFacts(card.payload.printing));
    return { ok: true, deck: restored.deck === null ? deck : { ...deck, ...restored.deck } };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Key the editor by source and seed so switching sources cannot carry another pool's edits. */
export function PrintedSealedRoute(props: Props): ReactElement {
  return h(SealedEditor, { ...props, key: `${props.prepared.fingerprint}:${props.seed}` });
}

function SealedEditor(props: Props): ReactElement {
  const [initial] = useState(() => initialDeck(props));
  if (!initial.ok)
    return h(
      'section',
      null,
      h('h1', null, 'Cannot restore sealed pool'),
      h('p', { role: 'alert' }, initial.message),
    );
  return h(PrintedPoolEditor, {
    prepared: props.prepared,
    initial: initial.deck,
    session: sessionFor(props),
    storageKey: storageKey(props),
    seed: props.seed,
    contextNote: `${String(initial.deck.pool.length)} physical cards · ${props.prepared.format.name} · ${printedDeckCalibrationNote(initial.deck, props.draftRatings)}`,
    title: `${props.prepared.format.name} sealed`,
    ...(props.backend === undefined ? {} : { backend: props.backend }),
    printedCards: props.printedCards ?? [],
    ...(props.tokens === undefined ? {} : { tokens: props.tokens }),
    playAvailability: props.playAvailability ?? {
      status: 'unavailable',
      reason: 'Forge interaction validation is still in progress.',
    },
    matchBot: botForNewPrintedDraft(props.prepared, props.draftRatings),
    ...(props.draftRatings === undefined ? {} : { draftRatings: props.draftRatings }),
    ...(props.onSubmitDeck === undefined ? {} : { onSubmitDeck: props.onSubmitDeck }),
  });
}
