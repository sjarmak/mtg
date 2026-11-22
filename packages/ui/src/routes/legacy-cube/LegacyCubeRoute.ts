/** Official printed-card Legacy Cube adapted into the shared draft, build and play journey. */
import { createElement, Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { DeckRef, GameBackend, SessionSpec } from '@mtg/engine';
import type { CanonicalBasicName, LimitedDeck } from '@mtg/limited';
import {
  addBasic,
  addPhysicalCard,
  cutBasic,
  cutPhysicalCard,
  suggestLimitedBasics,
  toDeckRef,
  validateLimitedDeck,
} from '@mtg/limited';
import type { PrintedCardCatalog, PrintedCardCatalogEntry, PrintedTokenPrinting } from '@mtg/printed-card';
import { evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL, validateAdvisorMetadata } from '@mtg/draft-export';
import type { ObservedDraft } from '@mtg/draft-export';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import { renderCopy } from '../../copy';
import { cubeResume } from './resume-offer';
import { DraftChooser } from '../draft/DraftChooser';
import type { DraftOffer } from '../draft/DraftChooser';
import { DraftPackSurface } from '../draft/DraftPack';
import type { DraftCardPresentation, DraftPackSurfaceProps } from '../draft/DraftPack';
import { AdvisorCardDetail, AdvisorPaths, AdvisorSummary } from './Advisor';
import { BackendGame } from '../play/BackendGame';
import { PhysicalLimitedBuilder } from '../play/SealedBuilder';
import type { LimitedCardPresentation } from '../play/SealedBuilder';
import { newSeed } from '../play/seed';
import { ObservedSeat, OBSERVED_SUBMIT_DECK_LABEL, observedSeatLink } from '../play/ObservedSeat';
import type { ObservedSeatLink } from '../play/ObservedSeat';
import { DEFAULT_TABLE_BASE } from '../PlayRoute';
import {
  clearLegacyCubeSession,
  readLegacyCubeMatchSeed,
  readLegacyCubeSession,
  restoreCompletedLegacyCubePool,
  restoreLegacyCubeDeck,
  writeLegacyCubeMatchSeed,
  writeLegacyCubeSession,
} from './session';
import {
  LEGACY_CUBE_HUMAN_SEAT,
  LEGACY_CUBE_OPPONENT_SEAT,
  buildLegacyCubeDeck,
  suggestLegacyCubeDeck,
  decodeLegacyCubePicks,
  encodeLegacyCubePicks,
  legacyCubeDraftPool,
  legacyCubeForgeOpeningChoiceSeat,
  legacyCubeSessionSpec,
  runLegacyCubeDraft,
} from './model';
import type { LegacyCubeDraftPool, LegacyCubeForgeReadyPool } from './model';
import type { AdvisorCalibrationState } from './calibration';

export type LegacyCubeCatalogState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly catalog: PrintedCardCatalog;
      /** Token art for the board; absent, every token a game makes draws the pending frame. */
      readonly tokens?: readonly PrintedTokenPrinting[];
    }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export type LegacyCubeForgeReadyState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly pool: LegacyCubeForgeReadyPool }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export const LEGACY_CUBE_LOADING_NOTE = 'The draft opens after its checksum-pinned artifact is verified.';
export const LEGACY_CUBE_ABSENT_NOTE = 'Run `npm run play` to stage the portable Legacy Cube catalog.';
export const LEGACY_CUBE_DECK_NOT_SAVED = 'Deck changes are not saved in this browser.';
export const PLAY_FRESH_LEGACY_CUBE_GAME_LABEL = 'Play a new game';
export const REPLAY_LEGACY_CUBE_GAME_LABEL = 'Replay last game';

export function LEGACY_CUBE_SHORT_DECK_LABEL(missing: number): string {
  return missing === 1
    ? 'One card short of a legal 40-card deck. Add one from the sideboard or a basic land.'
    : `${String(missing)} cards short of a legal 40-card deck. Add them from the sideboard or as basic lands.`;
}

export interface LegacyCubeRouteProps {
  readonly calibration?: AdvisorCalibrationState;
  readonly catalog: LegacyCubeCatalogState;
  readonly forgeReady?: LegacyCubeForgeReadyState;
  readonly params: Readonly<Record<string, string>>;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  readonly backend: GameBackend;
}

function pageHead(): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement('h1', { className: 'mtg-page-title' }, 'Legacy Cube draft'),
    createElement('span', { className: 'mtg-page-note' }, 'Complete official MTGO list'),
  );
}

function empty(title: string, message: string): ReactElement {
  return createElement(
    'div',
    null,
    createElement('div', { className: 'mtg-page-head' }, pageHead()),
    createElement(
      'div',
      { className: 'mtg-empty' },
      createElement('h2', { className: 'mtg-empty__title' }, title),
      createElement('p', { className: 'mtg-empty__body' }, renderCopy(message)),
    ),
  );
}

function cardFacts(card: PrintedCardCatalogEntry) {
  return {
    name: card.name,
    manaValue: card.manaValue,
    colorIdentity: card.colorIdentity.join(''),
    typeLine: card.typeLine,
    rarity: null,
  } as const;
}

const draftPresentation: DraftCardPresentation<PrintedCardCatalogEntry> = {
  keyOf: (card) => card.physicalId,
  nameOf: (card) => card.name,
  groupingFactsOf: cardFacts,
  stripFactsOf: (card, key) => ({
    key,
    name: card.name,
    manaCost: card.manaCost,
    colorIdentity: card.colorIdentity.join(''),
    copies: 1,
  }),
  // Dealt order: the cube catalog states no rarity, so `../draft/pack-order.ts`
  // has nothing to rank by and a cube is a singleton list without a rare slot.
  orderPack: (cards) => cards.map((card, index) => ({ card, index })),
  renderFace: (card, options) =>
    createElement(PrintedCardFace, {
      ...(options.key === undefined ? {} : { key: options.key }),
      card,
      size: options.size,
      ...(options.selected === undefined ? {} : { selected: options.selected }),
      ...(options.autoFocus === undefined ? {} : { autoFocus: options.autoFocus }),
      ...(options.faceIndex === undefined ? {} : { faceIndex: options.faceIndex }),
      ...(options.onSelect === undefined ? {} : { onSelect: options.onSelect }),
      ...(options.onHover === undefined ? {} : { onHover: options.onHover }),
    }),
  facesOf: (card) => card.faces.map((face) => face.name),
};

const builderPresentation: LimitedCardPresentation<PrintedCardCatalogEntry> = {
  nameOf: (card) => card.name,
  groupingFactsOf: cardFacts,
  manaCostOf: (card) => card.manaCost,
  renderFace: (card, options) =>
    createElement(PrintedCardFace, {
      ...(options.physicalId === undefined ? {} : { physicalId: options.physicalId }),
      ...(options.key === undefined ? {} : { key: options.key }),
      card,
      size: options.size,
      ...(options.selected === undefined ? {} : { selected: options.selected }),
      ...(options.deferArt === undefined ? {} : { deferArt: options.deferArt }),
      ...(options.footnote === undefined ? {} : { footnote: options.footnote }),
      ...(options.faceIndex === undefined ? {} : { faceIndex: options.faceIndex }),
      ...(options.onSelect === undefined ? {} : { onSelect: options.onSelect }),
      ...(options.onActivate === undefined ? {} : { onActivate: options.onActivate }),
      ...(options.onMenu === undefined ? {} : { onMenu: options.onMenu }),
      ...(options.onHover === undefined ? {} : { onHover: options.onHover }),
    }),
};

/** What the deck is called on the wire when it goes to a table over the network. */
const LEGACY_CUBE_DECK_NAME = 'Legacy Cube draft deck';

interface LimitedBuildAdapterProps {
  readonly pool: LegacyCubeDraftPool;
  readonly seed: string;
  readonly picks: readonly string[];
  readonly tokens: readonly PrintedTokenPrinting[];
  readonly backend: GameBackend;
  /** Hands the deck to a table over the network; the play button then submits instead of launching. */
  readonly onSubmitDeck?: (deck: DeckRef) => void;
}

function adjustedBasic(
  deck: LimitedDeck<PrintedCardCatalogEntry>,
  name: CanonicalBasicName,
  delta: number,
): LimitedDeck<PrintedCardCatalogEntry> {
  return delta > 0 ? addBasic(deck, name, delta) : cutBasic(deck, name, -delta);
}

function LegacyCubeLimitedBuildAdapter(props: LimitedBuildAdapterProps): ReactElement {
  const draft = useMemo(
    () => runLegacyCubeDraft(props.pool, props.seed, props.picks),
    [props.pool, props.picks, props.seed],
  );
  if (draft.result === null) throw new Error('a Legacy Cube limited build needs a finished draft');
  const initialHuman = useMemo(
    () => buildLegacyCubeDeck(draft.result!, LEGACY_CUBE_HUMAN_SEAT).deck,
    [draft.result],
  );
  const opponent = useMemo(
    () => buildLegacyCubeDeck(draft.result!, LEGACY_CUBE_OPPONENT_SEAT).deck,
    [draft.result],
  );
  const encodedPicks = useMemo(
    () => encodeLegacyCubePicks(props.pool.catalog, props.picks),
    [props.picks, props.pool.catalog],
  );
  const [deck, setDeck] = useState<LimitedDeck<PrintedCardCatalogEntry>>(() => {
    const stored = readLegacyCubeSession();
    return stored === null
      ? initialHuman
      : (restoreLegacyCubeDeck(stored, props.pool, props.seed, encodedPicks, initialHuman) ?? initialHuman);
  });
  const [deckSaved, setDeckSaved] = useState(true);
  const [table, setTable] = useState<SessionSpec | null>(null);
  const [matchFailure, setMatchFailure] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [matchSeed, setMatchSeed] = useState(
    () => readLegacyCubeMatchSeed(props.pool, props.seed, encodedPicks) ?? `${props.seed}/game`,
  );
  const report = validateLimitedDeck(deck);
  useEffect(() => {
    setDeckSaved(writeLegacyCubeSession(props.pool, props.seed, encodedPicks, deck));
  }, [deck, encodedPicks, props.pool, props.seed]);

  if (table !== null) {
    return createElement(
      'div',
      { className: 'mtg-play-route' },
      createElement(BackendGame, {
        backend: props.backend,
        table,
        printedCards: [...props.pool.catalog.cards, ...props.tokens],
        toolbar: createElement(
          'button',
          { type: 'button', className: 'mtg-btn', onClick: (): void => setTable(null) },
          'Back to draft deckbuilding',
        ),
        onClose: (): void => setTable(null),
        onOpenFailure: (message): void => {
          setMatchFailure(message);
          setTable(null);
        },
      }),
    );
  }

  const launch = (nextMatchSeed: string): void => {
    if (opening) return;
    setOpening(true);
    setMatchFailure(null);
    setMatchSeed(nextMatchSeed);
    writeLegacyCubeMatchSeed(props.pool, props.seed, encodedPicks, nextMatchSeed);
    void legacyCubeForgeOpeningChoiceSeat(nextMatchSeed, props.pool.catalog.forgeVersion, [
      report.cards,
      validateLimitedDeck(opponent).cards,
    ])
      .then((humanSeat) => {
        setOpening(false);
        setTable(legacyCubeSessionSpec(props.pool.catalog, deck, opponent, nextMatchSeed, humanSeat));
      })
      .catch((error: unknown) => {
        setOpening(false);
        setMatchFailure(error instanceof Error ? error.message : String(error));
      });
  };
  const submit = props.onSubmitDeck;
  const submitDeck = (): void => {
    if (submit === undefined) return;
    try {
      setMatchFailure(null);
      submit(toDeckRef(deck, LEGACY_CUBE_DECK_NAME));
    } catch (error: unknown) {
      setMatchFailure(error instanceof Error ? error.message : String(error));
    }
  };

  return createElement(PhysicalLimitedBuilder<PrintedCardCatalogEntry>, {
    physicalDeck: deck,
    report,
    presentation: builderPresentation,
    seed: props.seed,
    contextNote: `Draft finished from ${String(props.picks.length)} recorded picks.`,
    poolLabel: 'Drafted pool',
    playLabel: submit === undefined ? PLAY_FRESH_LEGACY_CUBE_GAME_LABEL : OBSERVED_SUBMIT_DECK_LABEL,
    playDisabled: opening,
    illegalNote: LEGACY_CUBE_SHORT_DECK_LABEL(report.missingCards),
    head: createElement('h1', { className: 'mtg-page-title mtg-sr-only' }, 'Draft'),
    banner:
      matchFailure !== null
        ? createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, matchFailure)
        : deckSaved
          ? null
          : createElement(
              'p',
              { className: 'mtg-prompt__warning', role: 'alert' },
              LEGACY_CUBE_DECK_NOT_SAVED,
            ),
    toolbarExtras:
      submit !== undefined
        ? null
        : createElement(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              disabled: !report.legal || opening,
              title: `Replay exact game ${matchSeed}`,
              onClick: (): void => launch(matchSeed),
            },
            REPLAY_LEGACY_CUBE_GAME_LABEL,
          ),
    onToggle: (physicalId): void => {
      setDeck((current) =>
        current.selectedPhysicalIds.includes(physicalId)
          ? cutPhysicalCard(current, physicalId)
          : addPhysicalCard(current, physicalId),
      );
    },
    onSuggest: (): void => setDeck((current) => suggestLegacyCubeDeck(current)),
    onClear: (): void =>
      setDeck((current) => ({
        ...current,
        selectedPhysicalIds: [],
        basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
      })),
    onAdjustBasic: (name, delta): void => setDeck((current) => adjustedBasic(current, name, delta)),
    onSuggestBasics: (): void => setDeck((current) => suggestLimitedBasics(current)),
    onPlay: submit === undefined ? (): void => launch(newSeed(`${props.seed}/game`)) : submitDeck,
  });
}

function newDraft(props: LegacyCubeRouteProps, pool: LegacyCubeDraftPool): void {
  clearLegacyCubeSession();
  props.onSetParams({
    pool: pool.mode,
    seed: newSeed(`legacy-cube/${pool.mode}-draft`),
    picks: '',
  });
}

function AdvisedPack(
  props: DraftPackSurfaceProps<PrintedCardCatalogEntry> & {
    readonly observed: ObservedDraft;
    readonly catalog: PrintedCardCatalog;
    readonly calibration?: AdvisorCalibrationState;
    readonly pinned: string | null;
    readonly onPin: (id: string | null) => void;
  },
): ReactElement {
  const validation = useMemo(() => validateAdvisorMetadata(props.catalog), [props.catalog]);
  const model = useMemo(
    () =>
      props.calibration?.status === 'ready'
        ? { ...LEGACY_CUBE_ADVISOR_MODEL, weights: props.calibration.snapshot.weights }
        : LEGACY_CUBE_ADVISOR_MODEL,
    [props.calibration],
  );
  const calibrationNote =
    props.calibration?.status === 'ready'
      ? 'Provisional local calibration; model-reviewed, not independent human validation.'
      : props.calibration?.status === 'failed'
        ? `Authored baseline. Local calibration could not be used: ${props.calibration.message}`
        : 'Authored baseline.';
  const advice = useMemo(
    () =>
      validation.ok && props.calibration?.status !== 'loading'
        ? evaluateDraft(props.observed, model, props.pinned)
        : null,
    [props.observed, props.pinned, props.calibration?.status, validation, model],
  );
  return createElement(DraftPackSurface<PrintedCardCatalogEntry>, {
    ...props,
    advice:
      advice === null
        ? {
            summary: createElement(
              'p',
              { role: 'status' },
              props.calibration?.status === 'loading'
                ? 'Checking local calibration. Drafting remains available.'
                : `Advice unavailable: ${validation.errors.join('; ')}. Drafting remains available.`,
            ),
            card: () => null,
            sections: [],
          }
        : {
            summary: createElement(AdvisorSummary, { advice, calibrationNote }),
            card: (card) => {
              const assessment = advice.cards.find((a) => a.card.physicalId === card.physicalId);
              return assessment === undefined
                ? null
                : createElement(AdvisorCardDetail, {
                    assessment,
                    model,
                    pinned: props.pinned,
                  });
            },
            sections: [
              {
                name: 'Paths',
                render: () =>
                  createElement(AdvisorPaths, {
                    advice,
                    model,
                    onPin: props.onPin,
                  }),
              },
            ],
          },
  });
}

function readyRoute(
  props: LegacyCubeRouteProps,
  catalog: PrintedCardCatalog,
  tokens: readonly PrintedTokenPrinting[],
): ReactElement {
  if (props.forgeReady?.status !== 'ready') {
    const reason =
      props.forgeReady?.status === 'failed'
        ? props.forgeReady.message
        : props.forgeReady?.status === 'loading'
          ? 'The complete Forge admission projection is still being verified.'
          : 'Run `npm run play` to stage the complete Forge admission projection.';
    return empty('Playable Legacy Cube is unavailable', reason);
  }
  const observed = observedSeatLink(props.params, DEFAULT_TABLE_BASE);
  if (observed !== undefined) return observedDraft(props, catalog, tokens, props.forgeReady.pool, observed);
  const requestedMode = props.params['pool'] ?? 'forge-ready';
  if (requestedMode !== 'full' && requestedMode !== 'forge-ready') {
    return empty(
      'The Legacy Cube draft link is invalid',
      `Unknown Legacy Cube pool ${JSON.stringify(requestedMode)}`,
    );
  }
  const currentPool = legacyCubeDraftPool(catalog, requestedMode, props.forgeReady.pool);
  const seed = props.params['seed'];
  if (seed === undefined)
    return draftLanding(props, currentPool, cubeResume(catalog, props.forgeReady.pool, props.onSetParams));
  return draftRoute(props, catalog, tokens, currentPool, seed, undefined);
}

/** The seat this page holds at a table over the network, and what its build screen does with the deck. */
interface DraftSeat {
  readonly onSubmitDeck: (deck: DeckRef) => void;
  readonly restart: () => void;
}

/**
 * A draft for a seat at a table over the network: the pool is the Forge-ready
 * one, since Forge plays the match, and the seed is the one the table dealt
 * this seat rather than anything in the hash, so the other seat drafts a
 * different pool and neither can read the other's off the link.
 */
function observedDraft(
  props: LegacyCubeRouteProps,
  catalog: PrintedCardCatalog,
  tokens: readonly PrintedTokenPrinting[],
  forgeReady: LegacyCubeForgeReadyPool,
  observed: ObservedSeatLink,
): ReactElement {
  const pool = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
  return createElement(ObservedSeat, {
    key: observed.token,
    base: observed.base,
    token: observed.token,
    printedCards: [...catalog.cards, ...tokens],
    builder: (seating, submitDeck): ReactElement =>
      draftRoute(props, catalog, tokens, pool, seating.poolSeed, {
        onSubmitDeck: submitDeck,
        restart: (): void => {
          clearLegacyCubeSession();
          props.onSetParams({ picks: '' });
        },
      }),
    onLeave: (): void => props.onSetParams({ table: '' }),
  });
}

/** The draft at `seed`: its next pack, or the build screen once every pick is made. */
function draftRoute(
  props: LegacyCubeRouteProps,
  catalog: PrintedCardCatalog,
  tokens: readonly PrintedTokenPrinting[],
  currentPool: LegacyCubeDraftPool,
  seed: string,
  lanSeat: DraftSeat | undefined,
): ReactElement {
  const encodedPicks = props.params['picks'] ?? '';
  const stored = readLegacyCubeSession();
  let pool = currentPool;
  if (
    stored !== null &&
    stored.catalog === catalog.contentSha256 &&
    stored.mode === currentPool.mode &&
    stored.seed === seed &&
    stored.picks === encodedPicks &&
    stored.pool !== currentPool.fingerprint
  ) {
    const restored = restoreCompletedLegacyCubePool(stored, currentPool, seed, encodedPicks);
    if (restored === null) {
      return empty(
        'The saved Legacy Cube draft belongs to an earlier playable-card projection',
        'Only a finished draft whose entire source remains accepted can cross a Forge-ready pool update. Start a new draft from the current playable cards.',
      );
    }
    pool = restored;
  }

  const decoded = decodeLegacyCubePicks(pool, encodedPicks);
  if (!decoded.ok) return empty('The Legacy Cube draft link is invalid', decoded.message);
  let draft;
  try {
    draft = runLegacyCubeDraft(pool, seed, decoded.picks);
  } catch (cause: unknown) {
    return empty(
      'The Legacy Cube draft transcript does not match its seed',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (draft.result !== null) {
    return createElement(LegacyCubeLimitedBuildAdapter, {
      key: `${pool.fingerprint}/${seed}/${props.params['picks'] ?? ''}`,
      pool,
      seed,
      picks: decoded.picks,
      tokens,
      backend: props.backend,
      ...(lanSeat === undefined ? {} : { onSubmitDeck: lanSeat.onSubmitDeck }),
    });
  }
  const choice = draft.owed[0];
  if (choice === undefined) throw new Error('an unfinished Legacy Cube draft owes no human choice');
  const seat = draft.seats.find((candidate) => candidate.seatId === LEGACY_CUBE_HUMAN_SEAT);
  const requestedPath = props.params['path'] ?? null;
  const pinned = LEGACY_CUBE_ADVISOR_MODEL.archetypes.some((a) => a.id === requestedPath)
    ? requestedPath
    : null;
  return createElement(AdvisedPack, {
    catalog,
    ...(props.calibration === undefined ? {} : { calibration: props.calibration }),
    pinned,
    onPin: (id): void => props.onSetParams({ path: id ?? '' }),
    observed: {
      ...pool.draft,
      picks: decoded.picks,
      observations: draft.observations
        .filter((o) => o.seatId === LEGACY_CUBE_HUMAN_SEAT)
        .map((o) => ({
          round: o.round,
          pickNumber: o.pickNumber,
          cards: o.cards.map((c) => c.payload),
        })),
    },
    draft: { picks: decoded.picks },
    next: {
      round: choice.round,
      pickNumber: choice.pickNumber,
      packSize: choice.packSize,
      cards: choice.cards.map((card) => card.payload),
    },
    pool: seat?.picks.map((pick) => pick.card.payload) ?? [],
    presentation: draftPresentation,
    onNewDraft: lanSeat === undefined ? (): void => newDraft(props, pool) : lanSeat.restart,
    onPick: (card): void => {
      const next = encodeLegacyCubePicks(catalog, [...decoded.picks, card.physicalId]);
      writeLegacyCubeSession(pool, seed, next);
      props.onSetParams({ picks: next });
    },
  });
}

/**
 * The cube's landing: the one every draft has (`../draft/DraftChooser.ts`).
 *
 * `mtg-a982g.5`. It used to be a page head, a facts line and a *New Legacy Cube
 * draft* button written out here, which is the same bargain the staged set
 * offers in different furniture and different words. What is the cube's own is
 * the line of facts and the offer (`./resume-offer.ts`); the shape is shared.
 */
function draftLanding(
  props: LegacyCubeRouteProps,
  pool: LegacyCubeDraftPool,
  resume: DraftOffer,
): ReactElement {
  return createElement(DraftChooser, {
    blurb: `${String(pool.cards.length)} admitted singleton cards, one human, seven deterministic bots, 24 packs of 15.`,
    offer: resume,
    onNew: (): void => newDraft(props, pool),
  });
}

export function LegacyCubeRoute(props: LegacyCubeRouteProps): ReactElement {
  if (props.catalog.status === 'loading')
    return empty('Reading the official cube…', LEGACY_CUBE_LOADING_NOTE);
  if (props.catalog.status === 'absent') return empty('Official cube is not staged', LEGACY_CUBE_ABSENT_NOTE);
  if (props.catalog.status === 'failed')
    return empty('The official cube could not be read', props.catalog.message);
  return readyRoute(props, props.catalog.catalog, props.catalog.tokens ?? []);
}
