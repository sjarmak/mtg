import { createElement as h, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DeckRef, GameBackend, SessionSpec } from '@mtg/engine';
import { checkCommanderDeck, checkStandardDeck } from '@mtg/printed-card';
import type { CommanderDeckVerdict, PrintedConstructedDeck, StandardDeckVerdict } from '@mtg/printed-card';
import type { UiRoute } from '../../app/router';
import type { LoadedPrintedConstructedFormat } from '../../lab/printed-constructed-format';
import { BackendGame } from '../play/BackendGame';
import { ObservedSeat, OBSERVED_SUBMIT_DECK_LABEL } from '../play/ObservedSeat';
import type { ObservedSeatLink } from '../play/ObservedSeat';
import { newSeed } from '../play/seed';
import { PrintedCardsGallery } from './PrintedCardsGallery';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import { PrintedPairingPanel } from './PrintedPairingPanel';
import { printedPlayPage } from './page';
import type { PrintedPage } from './page';
import { preconDeckRef, preconMatchRules, preparePreconMatch } from './precon-match';
import { PrintedPreconDeckView, viewDeckLabel } from './PrintedPreconDeckView';
import { deckScreen } from '../deck/deck-screen';
import type { PreconLanPlay } from './lan-precon';
import { FORGE_LOADING_MESSAGE } from '../../net/gateway-readiness';
import type { GatewayReadiness } from '../../net/gateway-readiness';
import { printedPlayAvailabilityCopy } from './play-availability-copy';
import { PLAY_DECKS_LABEL } from '../play/PlayChooser';
import { playSection } from '../play/PlayLanding';
import { PrintedPreconPicker, printedMatchup } from './PrintedPreconPicker';
import { printedPreconFacts } from './printed-precon-facts';
import { momirFormatCopy } from './momir-format-copy';

interface Props {
  readonly loaded: LoadedPrintedConstructedFormat;
  readonly title: string;
  readonly sourceCode: string | undefined;
  readonly page: PrintedPage;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  readonly backend?: GameBackend;
  /**
   * Told when a match takes the page and when it gives it back.
   *
   * `mtg-a982g.5`. The Commander section draws this route as the bot column of
   * the landing (`../play/PlayLanding.ts`), and the landing's furniture -- the
   * set's name, the chips, the two cells -- does not belong over a board. The
   * table is state here rather than a hash param, so nothing above it can read
   * it off the route; this is how it is said.
   */
  readonly onPlayingChange?: (playing: boolean) => void;
  /** The seat at a Forge table over the network the hash names, when it names one. */
  readonly observed?: ObservedSeatLink;
  /** Hands the chosen deck to that table; the play button then submits instead of seating a bot. */
  readonly onSubmitDeck?: (deck: DeckRef) => void;
  /**
   * The second press: a Forge table two people reach over the network.
   *
   * `mtg-r9vgk`. It is a value the lab builds rather than a section this route
   * mounts (`./lan-precon.ts`), because what it needs -- the address, the
   * format the lab advertises, and whether its Forge serves it -- are the lab's
   * facts and not this format's. Absent on every host that cannot seat one, and
   * the button is then not drawn at all.
   */
  readonly lanPlay?: PreconLanPlay;
  readonly gatewayReadiness?: GatewayReadiness;
}

const printedCardsOf = (
  catalogs: LoadedPrintedConstructedFormat['catalogs'],
  rarities: LoadedPrintedConstructedFormat['rarities'],
) =>
  catalogs.flatMap((source) =>
    source.catalog.cards.map((card) => ({
      ...card,
      setCode: source.code,
      ...(rarities[card.physicalId] === undefined ? {} : { rarity: rarities[card.physicalId] }),
    })),
  );

/**
 * The way out of an opened Commander deck.
 *
 * `mtg-r9vgk`. `../deck/deck-screen.ts` says `All decks` by default, which is
 * the shelf the deck library and the Constructed builder came from; this route
 * came from the Commander section's picker, and the button has to name it.
 * Exported so the test reads one spelling rather than a second copy of it.
 */
export const PRECON_BACK_LABEL = 'Back to Commander decks';
export const CONSTRUCTED_BACK_LABEL = 'Back to Constructed decks';

/** The route parameter naming the deck you play, and the one across the table. */
export const PRECON_DECK_PARAM = 'deck';
export const PRECON_OPPONENT_PARAM = 'against';

function identityLabel(identity: readonly string[]): string {
  return identity.length === 0 ? 'colorless' : identity.join('');
}

function commanderNames(deck: PrintedConstructedDeck): string {
  return deck.commanders.map((slot) => slot.name).join(' and ');
}

type DeckVerdict = CommanderDeckVerdict | StandardDeckVerdict;

function commanderCards(
  deck: PrintedConstructedDeck,
  cards: ReturnType<typeof printedCardsOf>,
): ReturnType<typeof printedCardsOf> {
  return deck.commanders.map((slot) => {
    const card = cards.find((candidate) => candidate.physicalId === slot.physicalId);
    if (card === undefined)
      throw new Error(`${deck.name} commander ${slot.name} is missing from its catalog`);
    return card;
  });
}

function matchupDeck(
  seat: string,
  deck: PrintedConstructedDeck,
  verdict: CommanderDeckVerdict,
  cards: ReturnType<typeof printedCardsOf>,
  open: () => void,
): ReactElement {
  const commanders = commanderCards(deck, cards);
  const plan = commanders
    .map((card) => card.oracleText?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((text) => text.length > 0)
    .join(' ');
  return h(
    'section',
    { className: 'mtg-precon-matchup__deck', 'aria-label': `${seat}: ${deck.name}` },
    h('span', { className: 'mtg-precon-matchup__seat' }, seat),
    h(
      'div',
      { className: 'mtg-precon-matchup__faces' },
      commanders.map((card) =>
        h(PrintedCardFace, { key: card.physicalId, card, size: 'full', deferArt: true }),
      ),
    ),
    h(
      'div',
      { className: 'mtg-precon-matchup__details' },
      h('h2', { className: 'mtg-precon-matchup__name' }, deck.name),
      h(
        'p',
        { className: 'mtg-precon-matchup__summary' },
        `${identityLabel(verdict.colorIdentity)} Commander deck led by ${commanderNames(deck)}.`,
      ),
      plan.length === 0 ? null : h('p', { className: 'mtg-precon-matchup__plan' }, plan),
      h('button', { type: 'button', className: 'mtg-btn', onClick: open }, viewDeckLabel(deck)),
    ),
  );
}

function deckFacts(deck: PrintedConstructedDeck, verdict: DeckVerdict, commander: boolean): ReactElement {
  return h(
    'li',
    { key: deck.id },
    h('strong', null, deck.name),
    h(
      'p',
      { className: 'mtg-fact__value' },
      commander && 'colorIdentity' in verdict
        ? `${commanderNames(deck)} · ${identityLabel(verdict.colorIdentity)} · ${String(verdict.cards)} cards`
        : `${String(verdict.cards)} cards`,
    ),
    verdict.legal
      ? null
      : h(
          'ul',
          { role: 'alert' },
          verdict.findings.map((finding, index) => h('li', { key: index }, finding.detail)),
        ),
  );
}

/**
 * Every finding against the decks at the table, or nothing at all.
 *
 * `mtg-r9vgk`. A legal deck says nothing here: the play page's band names the
 * refusal in one sentence and this is the detail behind it, so a table with
 * nothing wrong draws no row rather than a row saying so.
 */
function seatedFindings(
  seated: readonly PrintedConstructedDeck[],
  verdicts: ReadonlyMap<string, DeckVerdict>,
): ReactElement | null {
  const rows = [...new Map(seated.map((deck) => [deck.id, deck])).values()].flatMap((deck) =>
    verdicts
      .get(deck.id)!
      .findings.map((finding, index) =>
        h('li', { key: `${deck.id}/${String(index)}` }, `${deck.name}: ${finding.detail}`),
      ),
  );
  return rows.length === 0 ? null : h('ul', { role: 'alert' }, rows);
}

function deckSelect(
  label: string,
  value: string,
  decks: readonly PrintedConstructedDeck[],
  change: (value: string) => void,
): ReactElement {
  return h(
    'label',
    { className: 'mtg-field' },
    label,
    h(
      'select',
      { value, onChange: (event: { target: { value: string } }) => change(event.target.value) },
      decks.map((deck) => h('option', { key: deck.id, value: deck.id }, deck.name)),
    ),
  );
}

/** The page, or the seat at a table over the network with the page as its deck chooser. */
export function PrintedPreconRoute(props: Props): ReactElement {
  const { observed, ...page } = props;
  if (observed === undefined || !printedPlayPage(props.page)) return h(PreconPage, page);
  const { catalogs, format, rarities, presentations = [], tokens } = props.loaded;
  return h(ObservedSeat, {
    key: observed.token,
    base: observed.base,
    token: observed.token,
    printedCards: [...printedCardsOf(catalogs, rarities), ...tokens, ...presentations],
    rules: preconMatchRules(format),
    builder: (_seating, submitDeck) => h(PreconPage, { ...page, onSubmitDeck: submitDeck }),
    onLeave: () => props.onSetParams({ table: '' }),
  });
}

function PreconPage(props: Props): ReactElement {
  const { availability, catalogs, format, presentations = [], printings, rarities, tokens } = props.loaded;
  const [table, setTable] = useState<SessionSpec | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  // Which deck is open for reading, or none. `mtg-r9vgk`: transient, for the
  // reason `../deck/PreconDeckScreen.ts` keeps its selection transient -- a
  // reload that reopened a card list nobody asked for is a page that did not
  // come back where it was left.
  const [openDeckId, setOpenDeck] = useState<string | null>(null);
  const { onPlayingChange } = props;
  const openTable = (spec: SessionSpec | null): void => {
    setTable(spec);
    onPlayingChange?.(spec !== null);
  };
  const commanderTable = format.rules.variant === 'commander';
  const momirTable = format.rules.variant === 'momir';
  const verdicts = useMemo(() => {
    const check = commanderTable ? checkCommanderDeck : checkStandardDeck;
    return new Map(format.decks.map((deck) => [deck.id, check(deck, printings)]));
  }, [commanderTable, format, printings]);
  const facts = useMemo(
    () =>
      commanderTable || momirTable
        ? null
        : new Map(format.decks.map((deck) => [deck.id, printedPreconFacts(deck, printings, rarities)])),
    [commanderTable, momirTable, format, printings, rarities],
  );
  const printedCards = useMemo(() => printedCardsOf(catalogs, rarities), [catalogs, rarities]);
  const presentedCards = useMemo(() => [...printedCards, ...presentations], [printedCards, presentations]);
  const presentedRarities = useMemo(
    () => ({
      ...rarities,
      ...Object.fromEntries(presentations.map((card) => [card.physicalId, card.rarity])),
    }),
    [presentations, rarities],
  );
  if (props.page === 'gallery') {
    return h(PrintedCardsGallery, {
      cards: presentedCards.filter(
        (card) => props.sourceCode === undefined || card.setCode === props.sourceCode,
      ),
      rarities: presentedRarities,
      title: props.title,
      description: `Printed source cards · Preconstructed decks name which cards are played · ${availability.play.reason}`,
      route: props.route,
      onSetParams: props.onSetParams,
    });
  }
  if (props.page === 'draft') {
    return h(
      'section',
      null,
      h('h1', null, `${format.name} draft`),
      h('p', { role: 'status' }, 'Draft is not available for this printed format.'),
    );
  }
  const deckOf = (param: string, fallback: number): PrintedConstructedDeck | undefined => {
    const id = props.route.params[param];
    return format.decks.find((deck) => deck.id === id) ?? format.decks[fallback] ?? format.decks[0];
  };
  const human = deckOf(PRECON_DECK_PARAM, 0);
  const opponent = deckOf(PRECON_OPPONENT_PARAM, 1);
  if (human === undefined || opponent === undefined) {
    return h(
      'section',
      null,
      h('h1', null, format.name),
      h('p', { role: 'status' }, 'This format ships no decks.'),
    );
  }
  if (table !== null && props.backend !== undefined) {
    const newMatch = (): void => {
      openTable(
        preparePreconMatch(
          format,
          { human, opponent },
          { seed: newSeed(`${format.id}/match`), humanSeat: 0 },
        ),
      );
    };
    return h(BackendGame, {
      key: table.seed,
      backend: props.backend,
      table,
      printedCards: [...presentedCards, ...tokens],
      onNewGame: newMatch,
      onClose: () => {
        openTable(null);
      },
      onOpenFailure: (message) => {
        setPlayError(message);
        openTable(null);
      },
    });
  }
  const humanVerdict = verdicts.get(human.id)!;
  const opponentVerdict = verdicts.get(opponent.id)!;
  const submit = props.onSubmitDeck;
  const illegal = (submit === undefined ? [human, opponent] : [human]).filter(
    (deck) => !verdicts.get(deck.id)!.legal,
  );
  const sharedPlayRefusal =
    submit === undefined && availability.play.status === 'unavailable'
      ? availability.play.reason
      : illegal.length > 0
        ? `${illegal.map((deck) => deck.name).join(' and ')} ${illegal.length === 1 ? 'is' : 'are'} not a legal ${commanderTable ? 'Commander' : 'constructed'} deck.`
        : submit === undefined && props.backend === undefined
          ? 'No Forge backend is connected.'
          : null;
  const playRefusal =
    sharedPlayRefusal ??
    (submit === undefined && props.gatewayReadiness?.status === 'loading' ? FORGE_LOADING_MESSAGE : null);
  const playEnabled = playRefusal === null;
  const playAvailabilityCopy = printedPlayAvailabilityCopy(availability.play);
  const playLabel =
    submit !== undefined
      ? OBSERVED_SUBMIT_DECK_LABEL
      : availability.play.status === 'supported'
        ? 'Play Forge match'
        : availability.play.status === 'experimental'
          ? 'Try experimental Forge match'
          : 'Forge play unavailable';
  const play = (): void => {
    if (!playEnabled) {
      setPlayError(playRefusal ?? availability.play.reason);
      return;
    }
    try {
      setPlayError(null);
      if (submit !== undefined) submit(preconDeckRef(human));
      else
        openTable(
          preparePreconMatch(
            format,
            { human, opponent },
            { seed: newSeed(`${format.id}/match`), humanSeat: 0 },
          ),
        );
    } catch (cause) {
      setPlayError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const choose = (param: string) => (value: string) => props.onSetParams({ [param]: value });
  const lan = props.lanPlay;
  const lanEnabled = lan !== undefined && lan.refusal === null && sharedPlayRefusal === null;
  const lanPlay =
    submit === undefined && lan !== undefined
      ? h(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            'data-variant': 'primary',
            disabled: !lanEnabled,
            onClick: () => {
              setPlayError(null);
              void lan.onPress(human.id, preconDeckRef(opponent)).then((message) => {
                if (message !== null) setPlayError(message);
              });
            },
          },
          lan.label,
        )
      : null;
  // Drawn in the Forge refusal's own channel, so the reason why a dark button
  // is dark keeps its one place on the band.
  const lanRefusal = lanPlay === null || lan === undefined ? null : lan.refusal;
  /**
   * Who sits where, and the button that seats them.
   *
   * `mtg-r9vgk`. It is a value rather than an expression in the tree because the
   * open deck draws it too: the playtester asked that reading a deck not cost the way
   * back to starting a match with it ("a back button of some kind that doesnt
   * require you to click away from the tab and back to the commander tab"), and
   * that the two opponent cells above "resolve to the play forge match or play
   * over network options for that selected deck". Both are the same answer --
   * the band that chooses an opponent and seats the table travels with the deck
   * into its own screen, so the screen is a place to play from and not only a
   * place to read.
   */
  const controls: readonly ReactNode[] = [
    h(
      'button',
      {
        key: 'play',
        type: 'button',
        className: 'mtg-btn',
        'data-variant': 'primary',
        disabled: !playEnabled,
        onClick: play,
      },
      playLabel,
    ),
    lanPlay,
    availability.play.status === 'unavailable' ? null : h('span', { key: 'copy' }, playAvailabilityCopy),
    playRefusal === null ? null : h('span', { key: 'refusal' }, playRefusal),
    playRefusal === FORGE_LOADING_MESSAGE && props.gatewayReadiness?.status === 'loading'
      ? h(
          'button',
          { key: 'retry', type: 'button', className: 'mtg-btn', onClick: props.gatewayReadiness.retry },
          'Retry',
        )
      : null,
    lanRefusal === null ? null : h('span', { key: 'lan-refusal' }, lanRefusal),
    playError === null ? null : h('span', { key: 'error', role: 'alert' }, playError),
  ];
  const viewButton = (deck: PrintedConstructedDeck): ReactElement =>
    h(
      'button',
      { key: 'view', type: 'button', className: 'mtg-btn', onClick: () => setOpenDeck(deck.id) },
      viewDeckLabel(deck),
    );
  const playBand = (extra: readonly ReactNode[]): ReactElement =>
    !printedPlayPage(props.page)
      ? deckSelect('Deck', human.id, format.decks, choose(PRECON_DECK_PARAM))
      : momirTable
        ? h('div', { className: 'mtg-printed-pool-status' }, ...controls, ...extra)
        : facts === null
          ? h(
              'div',
              { className: 'mtg-printed-pool-status' },
              deckSelect('Your deck', human.id, format.decks, choose(PRECON_DECK_PARAM)),
              submit === undefined
                ? deckSelect('Across the table', opponent.id, format.decks, choose(PRECON_OPPONENT_PARAM))
                : null,
              ...controls,
            )
          : printedMatchup(human.name, submit === undefined ? opponent.name : null, [...controls, ...extra]);
  const openDeck = openDeckId === null ? null : (format.decks.find((deck) => deck.id === openDeckId) ?? null);
  if (openDeck !== null) {
    return deckScreen(
      openDeck.name,
      h(PrintedPreconDeckView, { deck: openDeck, printings: printedCards }),
      () => {
        setOpenDeck(null);
      },
      playBand([]),
      undefined,
      commanderTable ? PRECON_BACK_LABEL : CONSTRUCTED_BACK_LABEL,
    );
  }
  const commanderVerdicts =
    commanderTable && 'colorIdentity' in humanVerdict && 'colorIdentity' in opponentVerdict
      ? { human: humanVerdict, opponent: opponentVerdict }
      : null;
  if (!printedPlayPage(props.page)) {
    return h(
      'section',
      { style: { overflowWrap: 'anywhere' } },
      h('h1', { className: 'mtg-page-title' }, format.name),
      h(
        'ul',
        { 'aria-label': 'Decks' },
        format.decks.map((deck) => deckFacts(deck, verdicts.get(deck.id)!, commanderTable)),
      ),
      playBand([]),
      viewButton(human),
    );
  }
  if (momirTable) {
    return h(
      'section',
      { style: { overflowWrap: 'anywhere' } },
      props.page === 'commander' ? null : h('h1', { className: 'mtg-page-title' }, format.name),
      momirFormatCopy(format.rules, human).map((line, index) =>
        h('p', { key: index, className: 'mtg-playsection__blurb' }, line),
      ),
      playBand([viewButton(human)]),
      seatedFindings([human, opponent], verdicts),
    );
  }
  if (facts !== null) {
    return h(
      'section',
      { style: { overflowWrap: 'anywhere' } },
      h('h1', { className: 'mtg-page-title' }, format.name),
      playSection(
        { label: PLAY_DECKS_LABEL, titled: true, boxed: false },
        h(PrintedPreconPicker, {
          decks: format.decks,
          facts,
          yourDeckId: human.id,
          opponentDeckId: submit === undefined ? opponent.id : null,
          onChooseYours: choose(PRECON_DECK_PARAM),
          onChooseTheirs: choose(PRECON_OPPONENT_PARAM),
        }),
        playBand([viewButton(human)]),
      ),
      seatedFindings([human, opponent], verdicts),
    );
  }
  if (commanderVerdicts === null)
    throw new Error(`${format.name} is a Commander format without Commander verdicts`);
  return h(
    'section',
    { style: { overflowWrap: 'anywhere' } },
    // The Commander section's landing names the format above this
    // (`../play/PlayLanding.ts`); every other page that draws this route has no
    // title but this one.
    props.page === 'commander' ? null : h('h1', { className: 'mtg-page-title' }, format.name),
    playBand([]),
    // The `Decks` census is off the play page, so the one thing it carried that
    // the selects do not -- why a deck the checker refused is illegal -- is
    // drawn here for the decks actually seated, and nowhere else.
    seatedFindings([human, opponent], verdicts),
    props.loaded.winRates === undefined
      ? null
      : h(PrintedPairingPanel, {
          table: props.loaded.winRates,
          ...(props.loaded.headToHead === undefined ? {} : { headToHead: props.loaded.headToHead }),
          decks: format.decks,
          mine: human,
          opponent: submit === undefined ? opponent : null,
          onChooseOpponent: choose(PRECON_OPPONENT_PARAM),
        }),
    h(
      'div',
      { className: 'mtg-precon-matchup', 'data-seats': submit === undefined ? 'two' : 'one' },
      matchupDeck('Your deck', human, commanderVerdicts.human, printedCards, () => setOpenDeck(human.id)),
      submit === undefined
        ? matchupDeck('Across the table', opponent, commanderVerdicts.opponent, printedCards, () =>
            setOpenDeck(opponent.id),
          )
        : null,
    ),
  );
}
