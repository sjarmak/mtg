// @vitest-environment jsdom
/**
 * What the play surface actually shows: the set that was staged, and that set's
 * own art.
 *
 * Both of the bugs this file pins were about data reaching a component already
 * built to receive it, so nothing here asserts that a prop was passed. The set
 * arrives the way `npm run play` delivers it, through `LabApp`'s fetch, and the
 * art arrives the way the launcher stages it, through `stageSetArt` over a
 * temporary directory, so the `src` each face renders is a served path whose
 * file this test finds on disk.
 *
 * `mtg-c4h`: `SealedGame` opens its pool in a lazy state initializer, which runs
 * before the fetch resolves, so the route dealt sealed packs from whatever stood
 * in for the set that was on its way. The set now reaches the route as a
 * four-state union and the builder is not mounted until that state says which
 * cards it would be dealing, so the first pool anybody sees is the staged one.
 * The states before `ready` are tested here because this is the file that has
 * the fetch; what a real browser does with a real one is measured over CDP and
 * named in the first test below.
 *
 * `mtg-bc2.70`: the table draws an art window on every face now, and the
 * resolver reaches it from `LabApp` through `PlayRoute`. Nothing pinned that
 * wire, and its one visible symptom was the pool above: the example cards carry
 * no id the manifest knows, so every face hatched even with art staged.
 *
 * Markup assertions go through `renderToStaticMarkup`, and element queries go by
 * role and label, because the workspace tsconfig has no `lib: dom` and
 * `getAttribute` is not typed here (see `card.test.ts`). Where an attribute is
 * the assertion, `srcOf` below narrows the element by hand, the way
 * `board.test.ts` does.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EXAMPLE_CARDS, isCreature, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { Action, ActionType, GameSession, GameState } from '@mtg/kernel';
import { choose, createSession } from '@mtg/kernel';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { Board } from '../../src/board/Board';
import { ART_PENDING_LABEL } from '../../src/card/ArtSlot';
import { LabApp } from '../../src/dev/LabApp';
import { ART_MANIFEST_VERSION, artResolver, readArtManifest } from '../../src/lab/art-manifest';
import type { ArtManifest, ArtManifestEntry, ArtResolver } from '../../src/lab/art-manifest';
import { seatPossessive } from '../../src/seat';
import { LOADING_TITLE, PlayRoute, UNREADABLE_TITLE } from '../../src/routes/PlayRoute';
import { SEALED_POOL_LABEL } from '../../src/routes/play/SealedBuilder';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { hashSource } from '../../src/app/router';
import { ART_DIR } from '../../tools/stage-art';
import { stageSetArt } from '../../tools/stage-set-art';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * `path.join` rather than `new URL(literal, import.meta.url)`: Vite rewrites
 * that pattern into an asset URL, which under jsdom resolves against the
 * document's `http://localhost` base instead of the file system.
 */
const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

const SET_DOCUMENT: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));

function loadSet(): readonly Card[] {
  const { cards } = SET_DOCUMENT as { cards: readonly unknown[] };
  return cards.map((card) => parseCard(card));
}

/** The staged set: the same bytes `npm run play` writes to `public/set.json`. */
const STAGED = loadSet();
const NAMES: SeatNames = ['You', 'Bot'];

const STAGED_NAMES = new Set(STAGED.map((card) => card.name));
const FALLBACK_NAMES = new Set(EXAMPLE_CARDS.map((card) => card.name));
/** Names that tell the two pools apart, so neither list can pass for the other. */
const ONLY_STAGED = [...STAGED_NAMES].filter((name) => !FALLBACK_NAMES.has(name));
const ONLY_FALLBACK = [...FALLBACK_NAMES].filter((name) => !STAGED_NAMES.has(name));

/**
 * Which of `names` the page is showing, in one pass over the document.
 *
 * A query per name is the obvious spelling and it is what made this the slowest
 * file in the package. `queryAllByText` walks every element, and there are 90
 * distinct names here against a rendered 72-card pool: ~7ms a query, ~760ms for
 * one census, and `waitFor` pays it again on every poll. The first test of this
 * file took 1.7s, nearly all of it re-reading a DOM that had not changed, which
 * left it about 3x from vitest's 5s default on a quiet box and inside it on a
 * loaded one.
 *
 * A matcher function is called once per element with that element's own text,
 * so one set lookup inside it answers for every name at once. Same census,
 * ~11ms. The two tests that pay for it went 1696ms to 192ms and 859ms to 68ms,
 * and the file's slowest test is now 1465ms with two full suites sharing the
 * box, which is the oversubscription vitest.config.ts says it supports.
 *
 * The matcher always returns false: it is a visitor here, not a filter, and a
 * matcher that matched would make `queryAllByText` assemble an element list
 * this has no use for.
 */
function onScreen(names: readonly string[]): readonly string[] {
  const wanted = new Set(names);
  const shown = new Set<string>();
  screen.queryAllByText((content: string) => {
    if (wanted.has(content)) shown.add(content);
    return false;
  });
  return names.filter((name) => shown.has(name));
}

function stubFetch(routes: Readonly<Record<string, unknown>>): void {
  vi.stubGlobal('fetch', (url: string) => {
    const body = routes[url];
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(''),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
}

/**
 * What Vite answers for a path with no file behind it: the app's own page, at
 * 200, so a deep link reloads. `public/set.json` is gitignored, so that is the
 * response a checkout which has never run `npm run play` gets for its set.
 */
function stubSpaFallback(): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      json: () => Promise.reject(new Error(`Unexpected token '<', "<!doctype "... is not valid JSON`)),
      text: () => Promise.resolve('<!doctype html><html></html>'),
    }),
  );
}

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

/**
 * How many distinct names of a 90-card set a six-pack pool has to show before it
 * is that set rather than a coincidence. A pool is 72 cards with duplicates, so
 * forty-odd distinct names is the ordinary result and twenty is the floor.
 */
const POOL_EVIDENCE = 20;

/** How many cards of a set's own have to be on screen before a pool exists. */
function poolCardCount(): number {
  const pool = screen.queryByRole('group', { name: SEALED_POOL_LABEL });
  return pool === null ? 0 : within(pool).queryAllByRole('button').length;
}

describe('the staged set reaches the sealed pool', () => {
  /**
   * The whole of `mtg-c4h`, from the side that can be proved here.
   *
   * jsdom settles a stubbed promise in a microtask, so the gap between the first
   * render and the fetch landing is one `await` wide rather than the ~90ms a dev
   * server takes. That is enough to pin the state machine — the assertions before
   * the first `await` run on the synchronous first render, which is the render
   * that used to deal — but it is not enough to claim anything about the order a
   * real browser resolves a real fetch in. That half was measured over CDP in
   * chrome-headless-shell 151.0.7922.34 against `vite dev` on 127.0.0.1 with this
   * project's 79-card flagship fixture staged: before the fix, first paint drew a
   * complete 78-card pool of example cards under its own seed and replaced it
   * 91ms later; after, the first painted pool is the staged one and no example
   * card is ever drawn.
   */
  it('paints no pool at all until the staged set has arrived', async () => {
    stubFetch({ 'set.json': SET_DOCUMENT });
    setHash('#/play');
    render(h(LabApp, { replayUrl: 'missing.jsonl', setUrl: 'set.json', cards: EXAMPLE_CARDS }));

    // The first render, synchronously: the fetch has not resolved, so there is
    // nothing to deal and nothing is dealt. A pool here is the bug, whichever
    // cards it holds.
    expect(poolCardCount()).toBe(0);
    expect(onScreen(ONLY_FALLBACK)).toEqual([]);
    expect(screen.getByText(LOADING_TITLE)).toBeTruthy();

    await waitFor(() => {
      expect(onScreen(ONLY_STAGED).length).toBeGreaterThan(POOL_EVIDENCE);
    });
    // The hash never moves in this test, which is the whole point: a round-trip
    // to another tab and back was the only thing that used to get the set in.
    expect(onScreen(ONLY_FALLBACK)).toEqual([]);
  });

  /**
   * A checkout with no staged set is a real state, and it stays playable.
   *
   * This is the argument the fix rests on: the route waits for a set that is
   * *coming*, and tells you about cards that are *standing in*. Both of those
   * are honest and they are drawn differently, which is the thing the old single
   * fallback could not do.
   */
  it('deals the stand-in pool when nothing is staged, and says that is what it did', async () => {
    stubFetch({});
    setHash('#/play');
    render(h(LabApp, { replayUrl: 'missing.jsonl', setUrl: 'set.json', cards: EXAMPLE_CARDS }));

    await waitFor(() => {
      expect(onScreen(ONLY_FALLBACK).length).toBeGreaterThan(0);
    });
    expect(onScreen(ONLY_STAGED)).toEqual([]);
    // Named, not silent. A pool that cannot be told from the staged one is the
    // half of `mtg-c4h` that a remount would have left in place.
    expect(screen.getByText(/no set is staged/i)).toBeTruthy();
    expect(screen.queryByText(LOADING_TITLE)).toBeNull();
  });

  /**
   * The same state, arriving the way `vite dev` actually delivers it.
   *
   * Measured in chrome-headless-shell against this package's own dev server: a
   * request for a `public/` file that does not exist is answered with
   * `index.html` at status 200, not a 404. Reading the status alone calls that a
   * staged set and then fails the parse on a leading angle bracket, which tells
   * somebody who has never staged anything that their set is broken. The content
   * type is what separates the two.
   */
  it('reads the dev server fallback page as no set staged, not as a broken one', async () => {
    stubSpaFallback();
    setHash('#/play');
    render(h(LabApp, { replayUrl: 'missing.jsonl', setUrl: 'set.json', cards: EXAMPLE_CARDS }));

    await waitFor(() => {
      expect(onScreen(ONLY_FALLBACK).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/no set is staged/i)).toBeTruthy();
    expect(screen.queryByText(UNREADABLE_TITLE)).toBeNull();
  });

  /**
   * A staged set that fails `parseCard` deals nothing, rather than dealing the
   * stand-in under a person who staged a set and would take the game for theirs.
   */
  it('names a staged set it could not read, and deals no pool over it', async () => {
    stubFetch({ 'set.json': { cards: [{ id: 'not-a-card' }] } });
    setHash('#/play');
    render(h(LabApp, { replayUrl: 'missing.jsonl', setUrl: 'set.json', cards: EXAMPLE_CARDS }));

    await waitFor(() => {
      expect(screen.getByText(UNREADABLE_TITLE)).toBeTruthy();
    });
    expect(poolCardCount()).toBe(0);
    expect(onScreen(ONLY_FALLBACK)).toEqual([]);
    expect(onScreen(ONLY_STAGED)).toEqual([]);
  });

  /**
   * Why there is no identity key on the builder, stated as a test.
   *
   * A pool is dealt rather than derived, so the cuts made in it are the one thing
   * a re-deal cannot give back. The fix for `mtg-c4h` was to not mount the
   * builder until the set is known; the fix it replaced was a key derived from
   * the set, which re-deals whenever that prop moves — and a parent that maps its
   * card list every render moves it on every render. So this cuts, then
   * re-renders with a fresh array holding the same cards, which is exactly what
   * such a parent hands down.
   */
  it('keeps a build in progress when the same set arrives as a new array', () => {
    const view = render(h(PlayRoute, { set: { status: 'ready', cards: STAGED } }));
    const suggested = deckSize();
    expect(suggested).toBeGreaterThan(CUTS);
    for (let cut = 0; cut < CUTS; cut += 1) cutFirstCard();
    expect(deckSize()).toBe(suggested - CUTS);

    view.rerender(
      h(PlayRoute, {
        set: { status: 'ready', cards: [...STAGED] },
        sourceHint: 'a hint the builder never reads',
      }),
    );

    // The cuts survived, so what is under them is the pool opened on the first
    // render rather than a second one wearing the same cards.
    expect(deckSize()).toBe(suggested - CUTS);
    // And it is still this set's pool. A builder that had vanished altogether
    // would also have no deck to count.
    expect(onScreen(ONLY_STAGED).length).toBeGreaterThan(POOL_EVIDENCE);
  });
});

/** Enough cuts that no off-by-one could land on the same count by accident. */
const CUTS = 3;

/** The deck panel's gallery, which draws one button per card in the deck. */
const DECK_LABEL = 'Cards in your deck';

function deckSize(): number {
  return within(screen.getByRole('group', { name: DECK_LABEL })).getAllByRole('button').length;
}

function cutFirstCard(): void {
  const cards = within(screen.getByRole('group', { name: DECK_LABEL })).getAllByRole('button');
  const first = cards[0];
  if (first === undefined) throw new Error('the suggested deck is empty, so there is nothing to cut');
  fireEvent.click(first);
}

/** A 1x1 PNG, so the staged rasters are real files rather than empty names. */
const RASTER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface StagedArt {
  readonly resolve: ArtResolver;
  /** The staged manifest itself, which is the body `art.json` serves. */
  readonly document: ArtManifest;
  /** What the dev server would serve `art/…` out of. */
  readonly publicDir: string;
}

/**
 * A set's art, staged the way `npm run play` stages it.
 *
 * Written to a temporary directory and put through the launcher's own
 * `stageSetArt`, so the hrefs asserted below are the rewritten served paths
 * rather than the manifest's relative ones, and the file each names is on disk.
 */
function stageArtFor(cards: readonly Card[]): StagedArt {
  const root = mkdtempSync(join(tmpdir(), 'mtg-play-art-'));
  const manifestDir = join(root, 'out', 'art');
  const publicDir = join(root, 'public');
  mkdirSync(manifestDir, { recursive: true });

  const art: Record<string, ArtManifestEntry[]> = {};
  for (const card of cards) {
    const file = `${card.id}.png`;
    writeFileSync(join(manifestDir, file), RASTER);
    art[card.id] = [{ href: `./${file}`, alt: `illustration of ${card.name}` }];
  }

  const parsed = readArtManifest({ formatVersion: ART_MANIFEST_VERSION, art }, 'staged-play.test');
  if (!parsed.ok) throw new Error(parsed.message);
  const staged = stageSetArt(parsed.manifest, { manifestDir, publicDir: join(publicDir, 'art') });
  expect(staged.missing).toEqual([]);
  return { resolve: artResolver(staged.manifest), document: staged.manifest, publicDir };
}

const ART = stageArtFor(STAGED);

/** The frame a card with no art wears, labeled for the card it is pending for. */
function pendingLabel(cardId: string): string {
  return `${ART_PENDING_LABEL} for ${cardId}`;
}

/**
 * The `src` a rendered face is drawing.
 *
 * Narrowed by hand because the workspace tsconfig has no `lib: dom`, so what
 * testing-library hands back carries no `getAttribute`. `board.test.ts` narrows
 * the same way, and for the same reason.
 */
function srcOf(element: unknown): string {
  const candidate = element as { readonly getAttribute?: (name: string) => string | null };
  if (typeof candidate.getAttribute !== 'function') throw new Error('expected a rendered element');
  return candidate.getAttribute('src') ?? '';
}

/** The kernel actions worth taking to get a creature onto the battlefield. */
const TOWARDS_A_BOARD: readonly ActionType[] = ['playLand', 'activateManaAbility', 'castSpell'];

function preferred(options: readonly Action[]): number {
  for (const type of TOWARDS_A_BOARD) {
    const at = options.findIndex((option) => option.type === type);
    if (at >= 0) return at;
  }
  return 0;
}

function creatureInPlay(state: GameState): boolean {
  return state.battlefield.some((oid) => {
    const object = state.objects[oid];
    return object !== undefined && isCreature(object.card);
  });
}

/**
 * Plays the seeded game far enough that a creature is on the battlefield.
 *
 * Whose creature it is is not steered: `boardPosition` maps both seats through
 * the same resolver, and this is about the art window on a battlefield face
 * rather than about which turn produced it.
 */
function stateWithACreature(): GameState {
  const game = dealMirrorGame(STAGED, { youName: NAMES[0], opponentName: NAMES[1] });
  let session: GameSession = createSession(game.config.setup, game.config.seats);
  for (let step = 0; step < 400; step += 1) {
    if (creatureInPlay(session.state)) return session.state;
    const pending = session.pending;
    if (pending === null) break;
    session = choose(session, preferred(pending.options));
  }
  throw new Error('no creature reached the battlefield in 400 choices');
}

function creatureFace(permanents: readonly BoardPermanent[]): BoardPermanent | undefined {
  return permanents.find((permanent) => isCreature(permanent.card));
}

describe('the staged art manifest reaches the played table', () => {
  it('draws the battlefield and the hand at served paths whose files exist', () => {
    const state = stateWithACreature();
    const position = boardPosition(state, 0, NAMES, ART.resolve);

    const creature =
      creatureFace(position.you.battlefield.permanents) ??
      creatureFace(position.opponent.battlefield.permanents);
    if (creature === undefined) throw new Error('no creature face on the drawn board');
    const onBoard = creature.art ?? null;
    if (onBoard === null) throw new Error('the battlefield creature drew no art');

    const held = position.you.hand?.cards.find((entry) => STAGED_NAMES.has(entry.card.name));
    const inHand = held?.art ?? null;
    if (inHand === null) throw new Error('the hand drew no art');

    // Served paths rather than the manifest's own relative hrefs, and each one
    // names a file the dev server would find under `public/`.
    expect(onBoard.src).toBe(`art/${creature.card.id}.png`);
    expect(existsSync(join(ART.publicDir, onBoard.src))).toBe(true);
    expect(existsSync(join(ART.publicDir, inHand.src))).toBe(true);

    const markup = renderToStaticMarkup(h(Board, position));
    expect(markup).toContain(`src="${onBoard.src}"`);
    expect(markup).toContain(`src="${inHand.src}"`);
    expect(markup).toContain('data-art-state="ready"');
  });

  it('draws every card of the set in hand from the manifest, through the route a person opens', () => {
    const game = dealMirrorGame(STAGED, { youName: NAMES[0], opponentName: NAMES[1] });
    render(h(PlayRoute, { config: game.config, artFor: ART.resolve }));

    const hand = within(screen.getByLabelText(`${seatPossessive(NAMES[0])} hand`));
    expect(hand.getAllByRole('img', { name: /^illustration of / }).length).toBeGreaterThan(0);
    // No card of the set hatches. The basics `buildDeck` synthesized still do,
    // and correctly: they are not cards of the set, and the manifest has no
    // entry for them.
    for (const card of STAGED) {
      expect(hand.queryAllByLabelText(pendingLabel(card.id))).toEqual([]);
    }
  });

  it('draws the labeled pending frame on every face when the set has no art', () => {
    const complaints: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      complaints.push([...args]);
    });
    const game = dealMirrorGame(STAGED, { youName: NAMES[0], opponentName: NAMES[1] });
    render(h(PlayRoute, { config: game.config }));

    const hand = within(screen.getByLabelText(`${seatPossessive(NAMES[0])} hand`));
    expect(hand.queryAllByRole('img', { name: /^illustration of / })).toEqual([]);
    const hatched = STAGED.filter((card) => hand.queryAllByLabelText(pendingLabel(card.id)).length > 0);
    // A set with no art run is an ordinary state, not a failure: the surface
    // says so on the face and says nothing to the console.
    expect(hatched.length).toBeGreaterThan(0);
    expect(complaints).toEqual([]);
    spy.mockRestore();
  });

  it('reaches the table on the path `npm run play` takes, from `art.json` to a drawn face', async () => {
    // The other two tests in this describe hand `PlayRoute` a resolver and a
    // ready-made game, which is not a path the launcher has. `npm run play`
    // stages `set.json` and `art.json`, and the resolver crosses four links to
    // reach a face: `LabApp` reads the manifest, hands it to `PlayRoute`,
    // `PlayRoute` hands it to `SealedGame`, and `SealedGame` hands it to the
    // table it opens when the builder's start button is pressed. Delete either
    // of the middle two and every face on the table hatches, with nothing else
    // in the suite noticing.
    stubFetch({ 'set.json': SET_DOCUMENT, 'art.json': ART.document });
    setHash('#/play');
    render(
      h(LabApp, {
        replayUrl: 'missing.jsonl',
        setUrl: 'set.json',
        artUrl: 'art.json',
        cards: EXAMPLE_CARDS,
      }),
    );
    await waitFor(() => {
      expect(onScreen(ONLY_STAGED).length).toBeGreaterThan(POOL_EVIDENCE);
    });

    // The builder's own start button: the only route from a staged set to a
    // table that does not go through a terminal.
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    const hand = within(screen.getByLabelText(`${seatPossessive(NAMES[0])} hand`));
    const drawn = hand.getAllByRole('img', { name: /^illustration of / });
    expect(drawn.length).toBeGreaterThan(0);
    for (const face of drawn) {
      const src = srcOf(face);
      // The served path the launcher rewrote the manifest to, and a file the
      // dev server would find under `public/`.
      expect(src.startsWith(`${ART_DIR}/`)).toBe(true);
      expect(existsSync(join(ART.publicDir, src))).toBe(true);
    }
    // No card of the set hatches on the table it was dealt onto.
    for (const card of STAGED) {
      expect(hand.queryAllByLabelText(pendingLabel(card.id))).toEqual([]);
    }
  });
});
