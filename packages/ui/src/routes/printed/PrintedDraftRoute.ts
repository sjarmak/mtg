import { createElement as h, Fragment, useState } from 'react';
import type { ReactElement } from 'react';
import type { PreparedPrintedLimitedFormat, PrintedBoosterCopy, PrintedCardRoles } from '@mtg/draft-export';
import { communityPickOrderRating, ratingValueOf, resolveCardRating } from '@mtg/draft-export';
import type { GameBackend } from '@mtg/engine';
import type { PrintedFormatRow } from '../../lab/printed-format';
import { findPrintedDraftQuality } from '../../lab/printed-draft-ratings';
import type { PrintedDraftRatings } from '../../lab/printed-draft-ratings';
import { SEVENTEEN_LANDS_RATING_SOURCE, seventeenLandsRatingsFor } from '../../lab/seventeen-lands-ratings';
import { prepareLimitedDeck } from '@mtg/limited';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import type { PrintedTokenPrinting } from '@mtg/printed-card';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { DraftPackSurface } from '../draft/DraftPack';
import { packOrderBy, packOrderByRating } from '../draft/pack-order';
import type { DraftCardPresentation } from '../draft/DraftPack';
import { readStored, writeStored } from '../deck/local-store';
import { PrintedPoolEditor } from './PrintedPoolEditor';
import { printedDeckCalibrationNote } from './deck-evaluation';
import { botForNewPrintedDraft, createPrintedReplayBot } from './draft-bot';
import { printedLimitedFacts } from './limited-facts';
import {
  PRINTED_LOCAL_SEAT,
  restorePrintedSession,
  PrintedLimitedSessionSchema,
} from './printed-limited-session';
import type { PrintedLimitedSession, RestoredPrintedSession } from './printed-limited-session';

interface Props {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly seed: string;
  readonly onNewDraft: () => void;
  readonly backend?: GameBackend;
  readonly printedCards: readonly PrintedCardPresentation[];
  /** Token printings the game may present; never in a pool or a gallery. */
  readonly tokens?: readonly PrintedTokenPrinting[];
  readonly playAvailability: PrintedFormatRow['availability']['play'];
  readonly draftRatings?: PrintedDraftRatings;
  /** Only a saved role-aware policy reads these; a new draft's bot does not. */
  readonly cardRoles?: PrintedCardRoles;
}
const storageKey = (props: Props): string => `mtg.printed.draft:${props.prepared.format.id}:${props.seed}`;
/** The source label a staged Forge Limited ranking is shown under — never a bare number. */
export const PRINTED_DRAFT_RATING_SOURCE = 'Forge Limited ranking';
function presentationFor(
  printedCards: readonly PrintedCardPresentation[],
  draftRatings: PrintedDraftRatings | undefined,
  sourceCodes: readonly string[],
): DraftCardPresentation<PrintedBoosterCopy> {
  const byId = new Map(printedCards.map((card) => [card.physicalId, card]));
  const printing = (card: PrintedBoosterCopy): PrintedCardPresentation =>
    byId.get(card.payload.printing.physicalId) ?? card.payload.printing;
  // ADR-0005 rung 1: a set with a staged 17lands artifact (KTK today) is
  // rated from measured human play before anything else in the ladder is
  // consulted. Unioned across a format's source sets, because a format can
  // draw from more than one printed set and a card belongs to exactly one.
  const seventeenLandsMaps = sourceCodes
    .map((code) => seventeenLandsRatingsFor(code))
    .filter((map): map is NonNullable<typeof map> => map !== undefined);
  const hasSeventeenLands = seventeenLandsMaps.length > 0;
  const hasAnyRanking = draftRatings !== undefined || hasSeventeenLands;
  // `null` is a format with no staged ranking and a card the staged ranking
  // misses alike; the rail tells the two apart from `hasAnyRanking`, the
  // order treats both as unranked. Resolved through `resolveCardRating`
  // (ADR-0005 section 2's ladder), so a printed format's rating is decided by
  // the one shared ladder rather than by this lane inventing its own
  // precedence.
  const ratingFor = (card: PrintedBoosterCopy): ReturnType<typeof resolveCardRating> => {
    const physicalId = card.payload.printing.physicalId;
    const seventeenLands = seventeenLandsMaps
      .map((map) => map.get(physicalId))
      .find((rating) => rating !== undefined);
    const quality = draftRatings === undefined ? null : findPrintedDraftQuality(draftRatings, physicalId);
    return resolveCardRating({
      seventeenLands,
      communityPickOrder: quality === null ? undefined : communityPickOrderRating(physicalId, quality),
    });
  };
  // A card the top rung's map does not cover still reads under the top
  // rung's label ("not ranked for this card"), rather than silently falling
  // to whatever a lower rung says: the label names the source the rail is
  // consulting for this set, and a missing card is a gap in that source, not
  // a switch to a different one.
  const sourceLabelFor = (): string =>
    hasSeventeenLands ? SEVENTEEN_LANDS_RATING_SOURCE : PRINTED_DRAFT_RATING_SOURCE;
  const qualityOf = (card: PrintedBoosterCopy): number | null => {
    const resolved = ratingFor(card);
    return resolved === undefined ? null : ratingValueOf(resolved);
  };
  const rarityOfBoosterCopy = (card: PrintedBoosterCopy): string | null =>
    byId.get(card.payload.printing.physicalId)?.rarity ?? null;
  // dec-adi1: with the ratings switch off, a printed pack deals rarest-first
  // (option (a), the recommended default while the playtester's ruling is open),
  // never `qualityOf`. This is the one branch point; option (b), which keeps
  // the pack best-rated first with the number hidden, is a one-line change to
  // the ternary below.
  const orderPack = (
    cards: readonly PrintedBoosterCopy[],
    { ratingsShown }: { readonly ratingsShown: boolean },
  ): ReturnType<typeof packOrderBy<PrintedBoosterCopy>> =>
    ratingsShown
      ? packOrderByRating(cards, qualityOf, rarityOfBoosterCopy)
      : packOrderBy(cards, rarityOfBoosterCopy);
  return {
    keyOf: (card) => card.physicalId,
    nameOf: (card) => card.payload.printing.name,
    groupingFactsOf: ({ payload: { printing: card } }) => ({
      name: card.name,
      manaValue: card.manaValue,
      colorIdentity: card.colorIdentity.join(''),
      typeLine: card.typeLine,
      rarity: byId.get(card.physicalId)?.rarity ?? null,
    }),
    stripFactsOf: ({ payload: { printing: card } }, key) => ({
      key,
      name: card.name,
      manaCost: card.manaCost,
      colorIdentity: card.colorIdentity.join(''),
      copies: 1,
    }),
    // Best rated first when the switch is on, with rarity (from the display
    // metadata the booster copy does not carry) breaking a tie and a card the
    // ranking misses last; a format with no ranking draws rarest first either
    // way. `../draft/pack-order.ts` says why the dealt index travels with the
    // card; `orderPack` above says why the switch decides which order.
    orderPack,
    renderFace: (card, options) =>
      h(PrintedCardFace, { ...options, card: printing(card), physicalId: card.physicalId }),
    facesOf: (card) => printing(card).faces.map((face) => face.name),
    ratingOf: (card) => (hasAnyRanking ? { value: qualityOf(card), source: sourceLabelFor() } : null),
  };
}
type DraftBot = ReturnType<typeof createPrintedReplayBot>;
type State =
  | { readonly bot: DraftBot; readonly restored: RestoredPrintedSession; readonly error: string | null }
  | { readonly bot: null; readonly restored: null; readonly error: string };

function initialState(props: Props): State {
  try {
    const raw = readStored(storageKey(props));
    const session: PrintedLimitedSession = {
      mode: 'draft',
      transcript: {
        version: 1,
        formatId: props.prepared.format.id,
        fingerprint: props.prepared.fingerprint,
        seed: props.seed,
        botPolicy: botForNewPrintedDraft(props.prepared, props.draftRatings).botPolicy,
        humanSeatIds: [PRINTED_LOCAL_SEAT],
        picks: { [PRINTED_LOCAL_SEAT]: [] },
      },
    };
    const input = PrintedLimitedSessionSchema.parse(raw === null ? session : JSON.parse(raw));
    const bot = createPrintedReplayBot(
      input.mode === 'draft' ? input.transcript.botPolicy : undefined,
      props.draftRatings,
      props.cardRoles,
    );
    const restored = restorePrintedSession(props.prepared, input, bot);
    if (restored.session.mode !== 'draft' || restored.session.transcript.seed !== props.seed)
      throw new Error('Saved draft session belongs to another draft.');
    return { bot, restored, error: null };
  } catch (cause) {
    return { bot: null, restored: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function PrintedDraftRoute(props: Props): ReactElement {
  return h(DraftEditor, { ...props, key: `${props.prepared.fingerprint}:${props.seed}` });
}

function DraftEditor(props: Props): ReactElement {
  const [state, setState] = useState(() => initialState(props));
  const restored = state.restored;
  if (restored === null || state.bot === null)
    return h('section', null, h('h1', null, 'Cannot restore draft'), h('p', { role: 'alert' }, state.error));
  if (restored.draft?.complete === true) {
    const deck = prepareLimitedDeck(restored.pool, (card) => printedLimitedFacts(card.payload.printing));
    return h(PrintedPoolEditor, {
      prepared: props.prepared,
      initial: restored.deck === null ? deck : { ...deck, ...restored.deck },
      session: restored.session,
      storageKey: storageKey(props),
      seed: props.seed,
      title: `Draft complete · ${props.prepared.format.name}`,
      poolLabel: 'Drafted pool',
      contextNote: `${String(restored.pool.length)} physical cards · ${printedDeckCalibrationNote(deck, props.draftRatings)}`,
      ...(props.backend === undefined ? {} : { backend: props.backend }),
      printedCards: props.printedCards,
      ...(props.tokens === undefined ? {} : { tokens: props.tokens }),
      playAvailability: props.playAvailability,
      matchBot: state.bot,
      ...(props.draftRatings === undefined ? {} : { draftRatings: props.draftRatings }),
    });
  }
  const choice = restored.draft?.choice;
  if (choice === null || choice === undefined)
    throw new Error('Unfinished printed draft owes no local choice.');
  const pick = (card: PrintedBoosterCopy): void => {
    try {
      if (restored.session.mode !== 'draft') throw new Error('Expected a draft transcript.');
      const transcript = restored.session.transcript;
      const session: PrintedLimitedSession = {
        mode: 'draft',
        transcript: {
          ...transcript,
          picks: {
            ...transcript.picks,
            [PRINTED_LOCAL_SEAT]: [...(transcript.picks[PRINTED_LOCAL_SEAT] ?? []), card.physicalId],
          },
        },
      };
      const next = restorePrintedSession(props.prepared, session, state.bot!);
      const saved = writeStored(storageKey(props), JSON.stringify(session));
      setState({
        bot: state.bot!,
        restored: next,
        error: saved ? null : 'Draft progress is not saved in this browser.',
      });
    } catch (cause) {
      setState({ bot: state.bot!, restored, error: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  // No sentence above the pack. The bot policy and the play admission were
  // stated here, and on a 900px-tall screen that line and its margins cost the
  // pack the top of its first row while saying nothing a picker can act on;
  // the format page says both before the draft starts, and the deck editor
  // says the admission again where play is offered.
  return h(
    Fragment,
    null,
    state.error === null ? null : h('p', { role: 'alert' }, state.error),
    h(DraftPackSurface<PrintedBoosterCopy>, {
      draft: { picks: { length: restored.pool.length } },
      next: choice,
      pool: restored.pool,
      presentation: presentationFor(
        props.printedCards,
        props.draftRatings,
        props.prepared.format.sources.map((source) => source.code),
      ),
      onPick: pick,
      onNewDraft: props.onNewDraft,
    }),
  );
}
