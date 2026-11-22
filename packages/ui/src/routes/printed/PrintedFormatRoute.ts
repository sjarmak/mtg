/**
 * A printed limited format's pages: its cards, its decks, its draft, its sealed.
 *
 * `mtg-a982g.5`. The draft and sealed landings used to be written out here --
 * an `<h1>`, a paragraph, a saved-session list and a bare *Start draft* or
 * *Open sealed pool* -- so a printed format's landing looked like a different
 * program from the staged set's, which is the report this bead answers. Both
 * are now the components every landing draws (`../draft/DraftChooser.ts`,
 * `../play/SealedChooser.ts`) inside the frame the section puts around them
 * (`../play/PlayLanding.ts`), and what is left here is what differs: the line
 * over the button, and the saved sessions under it.
 *
 * A `table=` token in the hash makes the sealed page a seat at a Forge table
 * over the network instead (`../play/ObservedSeat.ts`): the pool is the one the
 * table dealt rather than one this page seeded, and the deck goes to the table.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import type { UiRoute } from '../../app/router';
import { DraftChooser } from '../draft/DraftChooser';
import { SealedChooser } from '../play/SealedChooser';
import { PrintedCardsGallery } from './PrintedCardsGallery';
import type { PrintedFormatState } from './use-printed-format';
import { PrintedSealedRoute } from './PrintedSealedRoute';
import { PrintedDraftRoute } from './PrintedDraftRoute';
import { newSeed } from '../play/seed';
import { PrintedDeckLibrary } from './PrintedDeckLibrary';
import { PrintedSavedSessions } from './PrintedSavedSessions';
import type { DeckRef, GameBackend } from '@mtg/engine';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { ObservedSeat } from '../play/ObservedSeat';
import type { ObservedSeatLink } from '../play/ObservedSeat';
import { botForNewPrintedDraft, printedBotCalibrationNote, printedBotLabel } from './draft-bot';
import type { PrintedPage } from './page';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { printedPlayAvailabilityCopy } from './play-availability-copy';

/** What a limited format says when a page asks it for decks it does not print. */
export const PRINTED_NO_DECKS_TITLE = 'This format ships no decks';
export const PRINTED_NO_DECKS_BODY =
  'Draft or seal a pool to build one, or open the Commander tab for the decks that are staged.';

/** A refusal with nothing to press: the shape the empty states use. */
function refusal(message: string): ReactElement {
  return h('section', null, h('p', { role: 'status' }, message));
}

/** The sets a sealed pool of this format is opened from, in the order it opens them. */
function boosterCodes(format: PreparedPrintedLimitedFormat['format']): string {
  return format.sealed.boosters
    .map((id) => format.products.find((product) => product.id === id)?.setCode ?? id)
    .join(' / ');
}

interface Props {
  readonly state: PrintedFormatState;
  readonly title: string;
  readonly sourceCode: string | undefined;
  readonly page: PrintedPage;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  readonly backend?: GameBackend;
  /** The seat at a Forge table over the network the hash names, when it names one. */
  readonly observed?: ObservedSeatLink;
}

type Loaded = Extract<PrintedFormatState, { readonly status: 'ready' }>['value'];

/**
 * The sealed page: a landing that opens a pool, the pool once a seed names one,
 * or the seat at a table over the network, whose pool is the seed the table dealt.
 */
function sealedRoute(
  props: Props,
  loaded: Loaded,
  printedCards: readonly PrintedCardPresentation[],
): ReactElement {
  const { availability, draftRatings, prepared, tokens } = loaded;
  if (availability.sealed === 'unavailable')
    return refusal('Sealed is not available for this printed format.');
  const pool = (seed: string, onSubmitDeck?: (deck: DeckRef) => void): ReactElement =>
    h(PrintedSealedRoute, {
      prepared,
      ...(draftRatings === undefined ? {} : { draftRatings }),
      seed,
      ...(props.backend === undefined || onSubmitDeck !== undefined ? {} : { backend: props.backend }),
      printedCards,
      tokens,
      playAvailability: availability.play,
      ...(onSubmitDeck === undefined ? {} : { onSubmitDeck }),
    });
  if (props.observed !== undefined) {
    return h(ObservedSeat, {
      key: props.observed.token,
      base: props.observed.base,
      token: props.observed.token,
      printedCards: [...printedCards, ...tokens],
      builder: (seating, submitDeck) => pool(seating.poolSeed, submitDeck),
      onLeave: () => props.onSetParams({ table: '' }),
    });
  }
  const seed = props.route.params['seed'];
  return seed === undefined
    ? h(SealedChooser, {
        blurb: `Sealed boosters: ${boosterCodes(prepared.format)}. Basic lands are supplied separately.`,
        onGenerate: () => {
          props.onSetParams({ seed: newSeed(`${prepared.format.id}/sealed`) });
        },
        after: h(PrintedSavedSessions, { prepared, mode: 'sealed', route: props.route }),
      })
    : pool(seed);
}

export function PrintedFormatRoute(props: Props): ReactElement {
  if (props.state.status !== 'ready') {
    return h(
      'section',
      null,
      h('h1', null, props.title),
      h(
        'p',
        { role: 'status' },
        props.state.status === 'loading' ? 'Reading printed format…' : props.state.message,
      ),
    );
  }
  const { availability, catalogs, draftRatings, prepared, rarities, tokens } = props.state.value;
  const printedCards = catalogs.flatMap((source) =>
    source.catalog.cards.map((card) => ({
      ...card,
      setCode: source.code,
      ...(rarities[card.physicalId] === undefined ? {} : { rarity: rarities[card.physicalId] }),
    })),
  );
  if (props.page === 'decks') {
    return h(PrintedDeckLibrary, {
      key: prepared.fingerprint,
      formatId: prepared.format.id,
      fingerprint: prepared.fingerprint,
      title: prepared.format.name,
      route: props.route,
      playAvailability: availability.play,
    });
  }
  if (props.page === 'draft') {
    if (availability.draft === 'unavailable')
      return refusal('Draft is not available for this printed format.');
    const seed = props.route.params['seed'];
    const onNewDraft = (): void => props.onSetParams({ seed: newSeed(`${prepared.format.id}/draft`) });
    const bot = botForNewPrintedDraft(prepared, draftRatings);
    return seed === undefined
      ? h(DraftChooser, {
          blurb: `${printedBotLabel(bot.botPolicy)} bots ${printedBotCalibrationNote(bot.botPolicy)}. ${printedPlayAvailabilityCopy(availability.play)}`,
          offer: { kind: 'none' },
          onNew: onNewDraft,
          after: h(PrintedSavedSessions, { prepared, mode: 'draft', route: props.route }),
        })
      : h(PrintedDraftRoute, {
          prepared,
          ...(draftRatings === undefined ? {} : { draftRatings }),
          seed,
          onNewDraft,
          ...(props.backend === undefined ? {} : { backend: props.backend }),
          printedCards,
          tokens,
          playAvailability: availability.play,
        });
  }
  if (props.page === 'constructed' || props.page === 'commander') {
    return h(
      'div',
      { className: 'mtg-empty' },
      h('h2', { className: 'mtg-empty__title' }, PRINTED_NO_DECKS_TITLE),
      h('p', { className: 'mtg-empty__body' }, PRINTED_NO_DECKS_BODY),
    );
  }
  if (props.page === 'sealed') return sealedRoute(props, props.state.value, printedCards);
  const cards = printedCards.filter(
    (card) => props.sourceCode === undefined || card.setCode === props.sourceCode,
  );
  return h(PrintedCardsGallery, {
    cards,
    rarities: props.state.value.rarities,
    title: props.title,
    description: `Printed source cards · Booster recipes determine which cards can open · ${availability.play.reason}`,
    route: props.route,
    onSetParams: props.onSetParams,
  });
}
