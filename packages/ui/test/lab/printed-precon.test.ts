// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeckRef, ObservedBackend, SessionSpec } from '@mtg/engine';
import type { RouteAt, UiRoute } from '../../src/app/router';
import {
  PRECON_BACK_LABEL,
  PRECON_DECK_PARAM,
  PrintedPreconRoute,
} from '../../src/routes/printed/PrintedPreconRoute';
import { LAN_PRECON_LABEL, preconLanPlay } from '../../src/routes/printed/lan-precon';
import type { PreconLanPlay } from '../../src/routes/printed/lan-precon';
import type { startObservedTable } from '../../src/net/observed-table';
import type { PrintedPage } from '../../src/routes/printed/page';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import type { LoadedPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import * as BackendGameModule from '../../src/routes/play/BackendGame';
import { playPrintedPage } from '../../src/dev/section-views';

const read = (name: string): unknown => JSON.parse(readFileSync(`packages/data/data/scd/${name}`, 'utf8'));
const row = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed',
  variant: 'commander',
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  displayMetadataUrl: 'formats/scd/scd-display-metadata-v1.json',
  catalogs: [
    { code: 'SCD', name: 'Starter Commander Decks 2022', url: 'formats/scd/scd-printed-catalog-v1.json' },
  ],
  availability: {
    browse: 'available',
    draft: 'unavailable',
    sealed: 'unavailable',
    play: { status: 'supported', reason: 'Verified admission is installed.' },
  },
};
let loaded: LoadedPrintedConstructedFormat;
beforeAll(async () => {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: {
      digest: async (_algorithm: string, data: ArrayBuffer) =>
        createHash('sha256').update(Buffer.from(data)).digest().buffer,
    },
    getRandomValues: (array: Uint8Array) => array.fill(7),
  });
  loaded = await loadPrintedConstructedFormat(row, async (url) => read(url.split('/').at(-1)!));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
/** The jsdom element behind a rendered container; the test types carry no DOM lib. */
interface Queryable {
  readonly querySelector: (
    selector: string,
  ) => { readonly getAttribute: (name: string) => string | null } | null;
  readonly querySelectorAll: (
    selector: string,
  ) => Iterable<{ readonly getAttribute: (name: string) => string | null }>;
}
const scope = (node: unknown): Queryable => node as Queryable;

const text = (node: unknown): string => (node as { textContent: string | null }).textContent ?? '';

/** The page the tab would say it is on at this route, the way `LabApp` does. */
function pageOf(at: RouteAt): PrintedPage {
  if (at.mode === 'play') return playPrintedPage(at.sub);
  return at.mode === 'cards' ? 'gallery' : 'decks';
}

function props(at: RouteAt, params: Record<string, string> = {}) {
  const setParams = vi.fn();
  return {
    setParams,
    props: {
      loaded,
      title: row.name,
      sourceCode: undefined,
      page: pageOf(at),
      route: { ...at, params } as UiRoute,
      onSetParams: setParams,
    },
  };
}

/**
 * A backend for the page to draw a seated table with.
 *
 * `mtg-r9vgk`. The route refuses a match with no backend connected, and since
 * that refusal darkens the LAN press too -- the seat that press opens is drawn
 * through this same object -- a case about any other refusal has to hand one
 * over, or it proves the button is dark for the wrong reason. It never opens
 * anything here: every case that presses LAN goes through `startObservedTable`,
 * and the one case that presses Forge builds its own recording backend.
 */
const SEAT_BACKEND: ObservedBackend = {
  id: 'forge-seat',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () =>
    Promise.resolve({ ok: false, error: { kind: 'backend-failure', message: 'not seated in this case' } }),
};

function lanPlay(
  refusal: string | null,
  answer: string | null = null,
): PreconLanPlay & {
  readonly pressed: readonly { readonly hostDeckId: string; readonly guestDeck: DeckRef }[];
} {
  const pressed: { readonly hostDeckId: string; readonly guestDeck: DeckRef }[] = [];
  return {
    label: LAN_PRECON_LABEL,
    refusal,
    pressed,
    onPress: (hostDeckId, guestDeck) => {
      pressed.push({ hostDeckId, guestDeck });
      return Promise.resolve(answer);
    },
  };
}

/** A table that always opens, answering the two seat links a real one answers with. */
const opens: typeof startObservedTable = () =>
  Promise.resolve({ ok: true, table: 'tbl', host: 'obs-host', guest: 'obs-guest' });

/**
 * The press the lab builds, wired to a params writer the way `LabApp` wires it.
 *
 * `mtg-ei4n5`. The route, the press and the seat write are three files, and the
 * thing worth proving is what they do together: a press on this band has to end
 * as one write naming both the table and the deck the band was showing. The
 * table is injected so nothing here reaches a network.
 */
function livePress(
  setParams: (params: Readonly<Record<string, string>>) => void,
  start: typeof startObservedTable = opens,
): PreconLanPlay {
  return preconLanPlay({
    base: '/api',
    format: 'commander',
    rules: { variant: 'commander', startingLife: 40 },
    availability: { status: 'ready' },
    seat: (token, hostDeckId) => {
      setParams({ table: token, [PRECON_DECK_PARAM]: hostDeckId });
    },
    start,
  });
}

it('lists every shipped deck with its commander, color identity and card count', () => {
  const { props: view } = props({ mode: 'customize', sub: 'decks' });
  render(h(PrintedPreconRoute, view));
  const decks = screen.getByRole('list', { name: 'Decks' });
  expect(text(decks)).toContain('Chaos IncarnateKardur, Doomscourge · BR · 100 cards');
  expect(text(decks)).toContain('First FlightIsperia, Supreme Judge · WU · 100 cards');
  expect(text(decks)).toContain('Token TriumphEmmara, Soul of the Accord · WG · 100 cards');
  expect(screen.queryByRole('alert')).toBeNull();
  // `mtg-r9vgk`. The deck opens rather than sitting open, and what it opens
  // into is the pane every other deck in the lab is read in.
  expect(screen.queryByRole('region', { name: 'Chaos Incarnate list' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View Chaos Incarnate' }));
  expect(screen.getByRole('region', { name: 'Chaos Incarnate list' })).toBeDefined();
  expect(screen.getByText('Commander')).toBeDefined();
  expect(screen.getByRole('group', { name: 'Chaos Incarnate cards' })).toBeDefined();
  expect(screen.getByRole('heading', { name: 'Chaos Incarnate' })).toBeDefined();
  expect(screen.queryByRole('button', { name: /Forge/ })).toBeNull();
  // And back out to the page it was opened from, which this route names rather
  // than calling it the shelf of every deck in the lab (`mtg-r9vgk`).
  fireEvent.click(screen.getByRole('button', { name: PRECON_BACK_LABEL }));
  expect(screen.queryByRole('region', { name: 'Chaos Incarnate list' })).toBeNull();
});

it('shows both seated commanders with their deck plans and opens either list', () => {
  const { props: view, setParams } = props(
    { mode: 'play', sub: 'constructed' },
    { deck: 'grave-danger', against: 'first-flight' },
  );
  const { container } = render(h(PrintedPreconRoute, view));
  expect((screen.getByLabelText('Your deck') as unknown as { value: string }).value).toBe('grave-danger');
  expect((screen.getByLabelText('Across the table') as unknown as { value: string }).value).toBe(
    'first-flight',
  );
  const yourDeck = screen.getByRole('region', { name: 'Your deck: Grave Danger' });
  const theirDeck = screen.getByRole('region', { name: 'Across the table: First Flight' });
  expect(text(yourDeck)).toContain('UB Commander deck led by Gisa and Geralf.');
  expect(text(yourDeck)).toContain(
    'When Gisa and Geralf enters, mill four cards. Once during each of your turns, you may cast a Zombie creature spell from your graveyard.',
  );
  expect(text(theirDeck)).toContain('WU Commander deck led by Isperia, Supreme Judge.');
  expect(text(theirDeck)).toContain(
    'Flying Whenever a creature attacks you or a planeswalker you control, you may draw a card.',
  );
  const commanderFaces = scope(container).querySelectorAll('.mtg-precon-matchup .mtg-card[data-size="full"]');
  expect(commanderFaces).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'View First Flight' }));
  expect(screen.getByRole('region', { name: 'First Flight list' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: PRECON_BACK_LABEL }));
  fireEvent.click(screen.getByRole('button', { name: 'View Grave Danger' }));
  expect(screen.getByRole('region', { name: 'Grave Danger list' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: PRECON_BACK_LABEL }));
  fireEvent.change(screen.getByLabelText('Across the table'), { target: { value: 'token-triumph' } });
  expect(setParams).toHaveBeenCalledWith({ against: 'token-triumph' });
});

it('lights the play button only with a backend and a supported format, and seats the table it hands over', async () => {
  const opened: SessionSpec[] = [];
  const backend: ObservedBackend = {
    id: 'forge-test',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: () => Promise.resolve([]),
    open: (table) => {
      opened.push(table);
      return Promise.resolve({
        ok: false,
        error: { kind: 'backend-failure', message: 'refused for the test' },
      });
    },
  };
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  const withoutBackend = render(h(PrintedPreconRoute, view));
  const disabled = screen.getByRole('button', { name: 'Play Forge match' }) as unknown as {
    disabled: boolean;
  };
  expect(disabled.disabled).toBe(true);
  expect(screen.getByText('No Forge backend is connected.')).toBeDefined();
  withoutBackend.unmount();

  render(h(PrintedPreconRoute, { ...view, backend }));
  const play = screen.getByRole('button', { name: 'Play Forge match' }) as unknown as {
    disabled: boolean;
    getAttribute: (name: string) => string | null;
  };
  expect(play.disabled).toBe(false);
  // `mtg-r9vgk`, the playtester 2026-09-17. The band is the page's own control bar
  // now, and the press it exists for is filled rather than outlined; a refused
  // one still loses its fill, because `../../src/styles/base.ts` orders the
  // disabled rule after the variant rule.
  expect(play.getAttribute('data-variant')).toBe('primary');
  fireEvent.click(play);
  await waitFor(() => expect(text(screen.getByRole('alert'))).toContain('refused for the test'));
  expect(opened).toHaveLength(1);
  expect(opened[0]!.rules).toEqual({ variant: 'commander', startingLife: 40 });
  expect(opened[0]!.seats[0].deck.commanders).toEqual([{ name: 'Kardur, Doomscourge', count: 1 }]);
  expect(opened[0]!.seats[1].deck.name).toBe('Draconic Destruction');
  expect(opened[0]!.seed?.startsWith('scd/match/')).toBe(true);
});

it('keeps bot play dark while Forge loads the format and retries the readiness probe', () => {
  const retry = vi.fn();
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      gatewayReadiness: { status: 'loading', retry },
    }),
  );

  const play = screen.getByRole('button', { name: 'Play Forge match' }) as unknown as {
    disabled: boolean;
  };
  expect(play.disabled).toBe(true);
  expect(screen.getByText('Forge is still loading this format')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(retry).toHaveBeenCalledOnce();
});

it('preserves bot play when an external gateway has no readiness answer', () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      gatewayReadiness: { status: 'unknown' },
    }),
  );

  const play = screen.getByRole('button', { name: 'Play Forge match' }) as unknown as {
    disabled: boolean;
  };
  expect(play.disabled).toBe(false);
  expect(screen.queryByText('Forge is still loading this format')).toBeNull();
});

it('keeps both presses dark and says why when the format is not admitted to play', () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      // `mtg-r9vgk`. The lab's own probe is happy: what refuses here is the
      // format's admission, which the probe has no opinion about, so this is
      // the case that says the LAN press reads the page's refusal and not only
      // the probe's.
      lanPlay: lanPlay(null),
      loaded: {
        ...loaded,
        availability: {
          ...loaded.availability,
          play: { status: 'unavailable', reason: 'Commander play is not yet admitted.' },
        },
      },
    }),
  );
  const button = screen.getByRole('button', { name: 'Forge play unavailable' }) as unknown as {
    disabled: boolean;
  };
  expect(button.disabled).toBe(true);
  expect(screen.getByText('Commander play is not yet admitted.')).toBeDefined();
  const overNetwork = screen.getByRole('button', { name: LAN_PRECON_LABEL }) as unknown as {
    disabled: boolean;
  };
  expect(overNetwork.disabled).toBe(true);
  // And the sentence about the other seat's deck is not drawn beside a press
  // nobody can make; the refusal above answers both buttons.
  expect(screen.queryByText('Over this network the other player picks their own deck.')).toBeNull();
});

it('refuses to seat a deck the Commander check finds illegal, naming the finding', () => {
  const [first, ...rest] = loaded.format.decks;
  const [duplicated, ...remainingCards] = first!.cards;
  const doubled = {
    ...first!,
    cards: [{ ...duplicated!, count: duplicated!.count + 1 }, ...remainingCards],
  };
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      lanPlay: lanPlay(null),
      loaded: { ...loaded, format: { ...loaded.format, decks: [doubled, ...rest] } },
    }),
  );
  const button = screen.getByRole('button', { name: 'Play Forge match' }) as unknown as { disabled: boolean };
  expect(button.disabled).toBe(true);
  expect(screen.getByText('Chaos Incarnate is not a legal Commander deck.')).toBeDefined();
  expect(text(screen.getByRole('alert'))).toMatch(/appears 2 times|101 cards/);
  // `mtg-r9vgk`. An illegal deck is not seatable over the network either: the
  // table this press opens is the same table, dealt from the same list.
  const overNetwork = screen.getByRole('button', { name: LAN_PRECON_LABEL }) as unknown as {
    disabled: boolean;
  };
  expect(overNetwork.disabled).toBe(true);
});

it('says draft is not offered and browses the catalog on the cards tab', () => {
  const { props: draft } = props({ mode: 'play', sub: 'draft' });
  const view = render(h(PrintedPreconRoute, draft));
  expect(text(screen.getByRole('status'))).toBe('Draft is not available for this printed format.');
  view.unmount();
  const { props: cards } = props({ mode: 'cards', sub: 'gallery' });
  render(h(PrintedPreconRoute, cards));
  expect(screen.getByText(/of \d+ shown/)).toBeDefined();
});

it('includes generated-object presentations in the printed gallery', () => {
  const presentation = {
    ...loaded.catalogs[0]!.catalog.cards[0]!,
    physicalId: 'momir-presentation',
    name: 'Momir Gallery Creature',
    correctedName: 'Momir Gallery Creature',
    observedNames: ['Momir Gallery Creature'],
    setCode: 'SCD',
    rarity: 'common' as const,
    faces: loaded.catalogs[0]!.catalog.cards[0]!.faces.map((face) => ({
      ...face,
      name: 'Momir Gallery Creature',
    })),
  };
  const { props: cards } = props({ mode: 'cards', sub: 'gallery' });
  render(
    h(PrintedPreconRoute, {
      ...cards,
      loaded: { ...loaded, presentations: [presentation] },
    }),
  );
  expect(screen.getByText('Momir Gallery Creature')).toBeDefined();
});

it('supplies generated-object presentations to a local backend game', () => {
  const presentation = {
    ...loaded.catalogs[0]!.catalog.cards[0]!,
    physicalId: 'momir-local-play-presentation',
    observedNames: ['Local Play Creature'],
    setCode: 'SCD',
    rarity: 'common' as const,
  };
  let received: readonly { readonly physicalId: string }[] = [];
  vi.spyOn(BackendGameModule, 'BackendGame').mockImplementation((game) => {
    received = game.printedCards ?? [];
    return h('div');
  });
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      loaded: { ...loaded, presentations: [presentation] },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Play Forge match' }));
  expect(received.some((card) => card.physicalId === presentation.physicalId)).toBe(true);
});

it('starts the same precon matchup again with a fresh seed', () => {
  let nextByte = 7;
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    array.fill(nextByte);
    nextByte += 1;
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
  const tables: SessionSpec[] = [];
  let restart: (() => void) | undefined;
  vi.spyOn(BackendGameModule, 'BackendGame').mockImplementation((game) => {
    tables.push(game.table);
    restart = game.onNewGame;
    return h('button', { onClick: game.onNewGame }, 'New game');
  });
  const { props: view } = props(
    { mode: 'play', sub: 'constructed' },
    { deck: 'grave-danger', against: 'first-flight' },
  );
  render(h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND }));

  fireEvent.click(screen.getByRole('button', { name: 'Play Forge match' }));
  expect(restart).toBeTypeOf('function');
  fireEvent.click(screen.getByRole('button', { name: 'New game' }));

  expect(tables).toHaveLength(2);
  expect(tables[1]!.seats).toEqual(tables[0]!.seats);
  expect(tables[1]!.rules).toEqual(tables[0]!.rules);
  expect(tables[1]!.seed).not.toBe(tables[0]!.seed);
});

it('draws no format census and no standing admission sentence on the play page', () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(h(PrintedPreconRoute, view));
  // `mtg-r9vgk`. Neither sentence was news: the count of decks is the picker's
  // own option list, the life total is the format's, and that Forge is admitted
  // is a fact about the machine that does not change while somebody picks a
  // deck. What stays is the refusal, which answers a button.
  expect(screen.queryByText(/preconstructed decks/)).toBeNull();
  expect(screen.queryByRole('list', { name: 'Decks' })).toBeNull();
  expect(screen.queryByText(/Verified admission is installed/)).toBeNull();
  expect(screen.getByText('Plays against Forge.')).toBeDefined();
  expect(screen.getByText('No Forge backend is connected.')).toBeDefined();
});

it('lets a player try experimental Forge play and warns that the match may stop', () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, {
      ...view,
      backend: SEAT_BACKEND,
      loaded: {
        ...loaded,
        availability: {
          ...loaded.availability,
          play: { status: 'experimental', reason: 'Partial admission evidence.' },
        },
      },
    }),
  );
  const play = screen.getByRole('button', { name: 'Try experimental Forge match' }) as unknown as {
    disabled: boolean;
  };
  expect(play.disabled).toBe(false);
  expect(screen.getByText('You can try a Forge match, but it may stop.')).toBeDefined();
  expect(screen.queryByText(/Partial admission evidence/)).toBeNull();
});

it('keeps constructed admission evidence on the cards gallery', () => {
  const { props: view } = props({ mode: 'cards', sub: 'gallery' });
  render(h(PrintedPreconRoute, view));
  expect(screen.getByText(/Verified admission is installed/)).toBeDefined();
});

it('keeps the whole-format census on the Customize page, where it is the content', () => {
  const { props: view } = props({ mode: 'customize', sub: 'decks' });
  render(h(PrintedPreconRoute, view));
  expect(screen.getByRole('list', { name: 'Decks' })).toBeDefined();
  expect(screen.queryByText(/preconstructed decks/)).toBeNull();
});

it('draws the opened deck on shared frames and starts LAN play with its selected opponent', async () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' }, { against: 'token-triumph' });
  const lan = lanPlay(null);
  const { container } = render(h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: lan }));
  fireEvent.click(screen.getByRole('button', { name: 'View Chaos Incarnate' }));
  // `mtg-dna4y`. The commander is the full face, not the battlefield thumbnail,
  // whose name bar is designed to wrap over three lines.
  const commander = scope(container).querySelector('.mtg-printed-precon-commander .mtg-card');
  expect(commander?.getAttribute('data-size')).toBe('full');
  // The frames carry the set seal and the rarity seal, which the bare catalog
  // row does not hold: this view takes the route's `printedCardsOf` list, the
  // same one the sealed builder and the printed pool editor take.
  const faces = [...scope(container).querySelectorAll('.mtg-deck .mtg-card[data-rarity]')];
  expect(faces.length).toBeGreaterThan(0);
  expect(faces.every((face) => (face.getAttribute('data-rarity') ?? '').length > 0)).toBe(true);
  // `mtg-r9vgk`. Reading a deck does not cost the way back to seating it: the
  // band that picks an opponent and starts the match travels into the screen.
  expect(screen.getByLabelText('Your deck')).toBeDefined();
  expect(screen.getByLabelText('Across the table')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeDefined();
  // `mtg-r9vgk`, the playtester 2026-09-17. Both presses travel into the screen, and
  // the way out names the place it came from rather than a shelf of every deck
  // in the lab, which this section has not got.
  expect(screen.getByRole('button', { name: LAN_PRECON_LABEL })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: LAN_PRECON_LABEL }));
  await waitFor(() => expect(lan.pressed).toHaveLength(1));
  expect(lan.pressed[0]?.guestDeck.name).toBe('Token Triumph');
  expect(screen.queryByRole('button', { name: 'All decks' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: PRECON_BACK_LABEL }));
  expect(screen.queryByRole('region', { name: 'Chaos Incarnate list' })).toBeNull();
  expect(screen.getByRole('button', { name: 'View Chaos Incarnate' })).toBeDefined();
});

it('draws the LAN press beside the Forge one, dark with the lab’s sentence beside it when it is refused', async () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  const ready = lanPlay(null);
  const live = render(h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: ready }));
  const button = screen.getByRole('button', { name: LAN_PRECON_LABEL }) as unknown as {
    disabled: boolean;
    getAttribute: (name: string) => string | null;
  };
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('data-variant')).toBe('primary');
  fireEvent.click(button);
  await waitFor(() => expect(ready.pressed).toHaveLength(1));
  live.unmount();

  const refused = 'Forge on this lab does not serve commander over the network; it serves draft.';
  render(h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: lanPlay(refused) }));
  const dark = screen.getByRole('button', { name: LAN_PRECON_LABEL }) as unknown as { disabled: boolean };
  expect(dark.disabled).toBe(true);
  expect(screen.getByText(refused)).toBeDefined();
});

it('says what the lab said when it refuses to open the table', async () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(
    h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: lanPlay(null, 'the lab answered 503') }),
  );
  fireEvent.click(screen.getByRole('button', { name: LAN_PRECON_LABEL }));
  await waitFor(() => expect(text(screen.getByRole('alert'))).toContain('the lab answered 503'));
});

it('offers no LAN press from a seat at a LAN table, which is one already', () => {
  const { props: view } = props({ mode: 'play', sub: 'constructed' });
  render(h(PrintedPreconRoute, { ...view, lanPlay: lanPlay(null), onSubmitDeck: vi.fn() }));
  // `mtg-r9vgk`. This arm is the deck chooser of a seat at a table somebody
  // already opened; a button offering to open a second one from inside the
  // first says nothing true.
  expect(screen.queryByRole('button', { name: LAN_PRECON_LABEL })).toBeNull();
  expect(screen.queryByLabelText('Across the table')).toBeNull();
});

it('seats the host at a LAN table on the deck he chose, in one write', async () => {
  const { props: view, setParams } = props({ mode: 'play', sub: 'constructed' });
  const first = render(
    h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: livePress(setParams) }),
  );
  // Choosing a deck is a write to the route, which the router answers by
  // rendering the page again at the new params; nothing here is a router, so
  // the answer is made by hand.
  fireEvent.change(screen.getByLabelText('Your deck'), { target: { value: 'token-triumph' } });
  expect(setParams).toHaveBeenCalledWith({ deck: 'token-triumph' });
  first.unmount();

  const { props: chosen, setParams: wrote } = props(
    { mode: 'play', sub: 'constructed' },
    { deck: 'token-triumph' },
  );
  render(h(PrintedPreconRoute, { ...chosen, backend: SEAT_BACKEND, lanPlay: livePress(wrote) }));
  expect((screen.getByLabelText('Your deck') as unknown as { value: string }).value).toBe('token-triumph');
  fireEvent.click(screen.getByRole('button', { name: LAN_PRECON_LABEL }));
  // `mtg-ei4n5`. One write carrying both halves of where the page goes: the
  // seat the table answered with, and the deck this band was showing. Written
  // apart, or with the deck left out, the seat page falls back to the format's
  // first deck and the host arrives at the table holding something else.
  await waitFor(() => expect(wrote).toHaveBeenCalledWith({ table: 'obs-host', deck: 'token-triumph' }));
  expect(wrote).toHaveBeenCalledTimes(1);
});

it('leaves the page on the landing when the table refuses to open, saying what it said', async () => {
  const { props: view, setParams } = props({ mode: 'play', sub: 'constructed' });
  const refusing: typeof startObservedTable = () =>
    Promise.resolve({ ok: false, message: 'the lab answered 503' });
  render(h(PrintedPreconRoute, { ...view, backend: SEAT_BACKEND, lanPlay: livePress(setParams, refusing) }));
  fireEvent.click(screen.getByRole('button', { name: LAN_PRECON_LABEL }));
  await waitFor(() => expect(text(screen.getByRole('alert'))).toContain('the lab answered 503'));
  // `mtg-ei4n5`. Nothing is written on a refused open: the page the seat would
  // be written to is the one it is on, so half a write would move the reader's
  // deck under him and seat him at no table.
  expect(setParams).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Your deck')).toBeDefined();
  expect(screen.getByRole('button', { name: LAN_PRECON_LABEL })).toBeDefined();
});
