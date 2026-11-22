/**
 * The development fixtures page: the real surfaces, on stated state.
 *
 * `mtg-aqxi.5`. The redesign has to be validated at a stated density, and two
 * of the three surfaces can already be reached deterministically from the live
 * app — `#/draft?seed=…` replays a draft from its seed and `#/play?seed=…`
 * reopens a sealed pool exactly — while the third cannot: driving a real game
 * to a mid-game board takes a hundred presses and lands somewhere different
 * each time the kernel's enumeration shifts by one.
 *
 * So this page mounts the *shipped* components — the same `Shell`, the same
 * `PlayView`, the same `DraftRoute`, the same `SealedGame`, the same
 * stylesheet — over `./board.ts`'s stated position. Nothing here draws markup
 * of its own beyond the fixture picker, which is why a screenshot of it is
 * evidence about the app rather than about a mock.
 *
 * It is a dev page and not a product surface: `fixtures.html` is not linked
 * from the shell's mode switch and nothing in `src/app/router.ts` knows the
 * word. It ships in the build for one reason — a page only Vite's dev server
 * can serve is a page CI cannot screenshot.
 */
import { createElement, Fragment, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { choose, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import type { AutoPassSettings, Choice, GameSession } from '@mtg/kernel';
import { Shell } from '../../app/Shell';
import { GlobalStyles } from '../../styles/index';
import type { RouteAt } from '../../app/router';
import { DraftRoute } from '../../routes/DraftRoute';
import type { DraftRouteParams } from '../../routes/DraftRoute';
import { SealedGame } from '../../routes/play/SealedGame';
import { PlayView } from '../../routes/play/PlayView';
import { denseBoard, FIXTURE_NAMES, stackedBoard, VIEWER } from './board';

/** Seeds are pinned so two runs of the shot rig capture the same pack and pool. */
const DRAFT_SEED = 'ui/fixtures/draft';
const SEALED_SEED = 'ui/fixtures/sealed';

export interface Fixture {
  readonly name: string;
  readonly title: string;
  /** Which mode and section the shell shows around it. */
  readonly at: RouteAt;
  readonly render: () => ReactElement;
}

/**
 * A played table that answers presses.
 *
 * The state is the session and nothing else, and a press is `choose` with the
 * index the surface handed back — the same one dispatch every other caller on
 * this route uses. A fixture that swallowed the choice would look identical in
 * a screenshot and be useless the moment somebody opened it to try the layout.
 */
function FixtureTable(props: { readonly opening: () => GameSession }): ReactElement {
  const [session, setSession] = useState<GameSession>(props.opening);
  const [autoPass, setAutoPass] = useState<AutoPassSettings>(DEFAULT_AUTO_PASS);
  const onChoose = useCallback(
    (choice: Choice): void => {
      setSession((current) => choose(current, choice, { autoPass }));
    },
    [autoPass],
  );
  // No page title, because the shipped route draws none: `../../routes/PlayRoute.ts`
  // returns `.mtg-play-route` with the view straight inside it, and this page
  // was adding an `h1` that cost the mat 26.9px of column at 1440x900 - a
  // battlefield face of 111.6 here against the app's 124.0. A fixture page that
  // draws furniture the surface does not have is a fixture page about itself.
  return createElement(
    'div',
    { className: 'mtg-play-route' },
    createElement(PlayView, {
      session,
      viewer: VIEWER,
      names: FIXTURE_NAMES,
      onChoose,
      autoPass,
      onAutoPass: setAutoPass,
      onYield: (): void => undefined,
    }),
  );
}

/** The draft surface on a pinned seed, with the pick log held the way the router holds it. */
function FixtureDraft(): ReactElement {
  const [params, setParams] = useState<DraftRouteParams>({ seed: DRAFT_SEED, picks: '' });
  return createElement(DraftRoute, {
    set: { status: 'ready', cards: EXAMPLE_CARDS },
    params,
    onSetParams: (next: Readonly<Record<string, string>>): void => {
      setParams({ seed: next['seed'] ?? DRAFT_SEED, picks: next['picks'] ?? '' });
    },
  });
}

export const FIXTURES: readonly Fixture[] = [
  {
    name: 'play',
    title: 'Dense mid-game board',
    at: { mode: 'play', sub: 'constructed' },
    render: () => createElement(FixtureTable, { opening: denseBoard }),
  },
  {
    name: 'play-stack',
    title: 'Two spells on the stack',
    at: { mode: 'play', sub: 'constructed' },
    render: () => createElement(FixtureTable, { opening: stackedBoard }),
  },
  {
    name: 'draft',
    title: 'A full pack',
    at: { mode: 'play', sub: 'draft' },
    render: () => createElement(FixtureDraft),
  },
  {
    name: 'deck',
    title: 'Building out of a sealed pool',
    at: { mode: 'play', sub: 'sealed' },
    render: () =>
      createElement(
        'div',
        { className: 'mtg-play-route' },
        createElement(SealedGame, { set: EXAMPLE_CARDS, seed: SEALED_SEED }),
      ),
  },
];

/**
 * Where the fixture switch is drawn, and why it is out of flow.
 *
 * `mtg-dcxg.2`. The picker used to be an ordinary block above the route, and a
 * block above the route is charged to the route: `../../styles/views.ts` gives
 * `.mtg-play-route` the column the viewport leaves, and this nav was taking
 * 45px off the top of it. The mat divides what is left between two battlefields
 * and a hand, so the picker came out of the cards. Measured in
 * chrome-headless-shell over the dense board on 2026-08-23, at 1440x900 with
 * four permanents a side: a battlefield face was 101.0 x 141.1 on this page
 * against 124.0 x 173.2 on the shipped `Shell` + `PlayView` page that
 * `../../../test/play/fixture-harness-cost.browser.test.ts` renders beside it —
 * a board drawn 19% narrower than the app draws it, and narrow enough that
 * `../../card/type-line.ts`'s ladder dropped the subtypes off every face. Both
 * readings were then argued about as if they were the app's: `mtg-dcxg.2` was
 * filed off `out/shots/play-dense.desk.png` reporting a board squeezed against
 * an empty row, and the squeeze was this nav.
 *
 * A screenshot rig whose own furniture changes the layout it photographs is
 * evidence about the rig. So the picker is `position: fixed` and costs the
 * column nothing: it is still drawn, still pressed by name by
 * `../../../tools/shots.ts`'s journey, and lands in the empty right-hand end of
 * the shell's own header band at every viewport the rig captures.
 *
 * Inline rather than a rule in the sheet, and not `.mtg-modes` any more, for one
 * reason each. The sheet is the product's and this page is not in it, so a
 * dev-only selector there would ship to every surface; and `.mtg-modes` is the
 * shell's own destination bar, which `../../styles/mobile.ts` re-lays-out as a
 * fixed bottom tab row under 56rem — a second element wearing that class became
 * a second bottom bar on a phone.
 */
const PICKER_STYLE = {
  position: 'fixed',
  // A fixed box still takes its margins, and this one is a later child of
  // `.mtg-shell__main`, so `../../styles/base.ts`'s `* + *` rule pushed it to a
  // measured top of 28.0px on 2026-08-23 - below the shell bar's 39.8px band and
  // over the mat's own side-panel control. Zeroed, it sits at 4.0px and its
  // 30.8px height ends at 34.8, inside the bar.
  marginBlockStart: 0,
  insetBlockStart: '0.25rem',
  insetInlineEnd: '0.5rem',
  zIndex: 5,
  display: 'inline-flex',
  gap: '2px',
  padding: '2px',
  borderRadius: 'var(--mtg-radius-md)',
  background: 'var(--mtg-surface-inset)',
} as const;

function readHash(hash: string): string {
  const name = hash.replace(/^#\/?/, '').trim();
  return name.length === 0 ? 'play' : name;
}

interface LocationLike {
  hash: string;
}
interface HostWindow {
  readonly location: LocationLike;
  addEventListener?: (type: 'hashchange', listener: () => void) => void;
  removeEventListener?: (type: 'hashchange', listener: () => void) => void;
}

function host(): HostWindow | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as { readonly location?: unknown };
  if (typeof partial.location !== 'object' || partial.location === null) return null;
  return candidate as HostWindow;
}

/**
 * What the page draws when the hash names nothing it has.
 *
 * A list rather than a redirect, because the rig that drives this page names
 * its fixture in a URL and a silent fallback would capture the wrong surface
 * under the right filename.
 */
function unknownFixture(name: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('h2', { className: 'mtg-empty__title' }, `No fixture named "${name}"`),
    createElement(
      'p',
      { className: 'mtg-empty__body' },
      `Known fixtures: ${FIXTURES.map((one) => one.name).join(', ')}.`,
    ),
  );
}

export function FixturesApp(): ReactElement {
  const win = host();
  const [name, setName] = useState<string>(() => readHash(win?.location.hash ?? ''));
  const select = useCallback((next: string): void => {
    const location = host()?.location;
    if (location !== undefined) location.hash = `#/${next}`;
    setName(next);
  }, []);
  const fixture = FIXTURES.find((one) => one.name === name) ?? null;
  // The sheet, mounted the way `../../app/App.ts` mounts it. A fixtures page
  // that drew the shipped markup under no stylesheet would be a screenshot of
  // an unstyled document, which is what the first run of the rig produced.
  return createElement(
    Fragment,
    null,
    createElement(GlobalStyles),
    createElement(Shell, {
      ...(fixture?.at ?? { mode: 'play', sub: 'constructed' }),
      onSelectMode: (): void => undefined,
      title: 'Fixtures',
      // The fixture switch is dev chrome, and `PICKER_STYLE` says why it is
      // taken out of flow rather than laid above the surface it selects.
      children: createElement(
        Fragment,
        null,
        fixture === null ? unknownFixture(name) : fixture.render(),
        // Last, and that is layout rather than reading order: `../../styles/base.ts`
        // gives `.mtg-shell__main > * + *` a 24px top margin, so a picker drawn
        // first made the surface the second child and took that margin off the
        // column even out of flow. Nothing follows it now, and a fixed box has
        // no use for a margin of its own.
        createElement(
          'nav',
          { className: 'mtg-fixtures-picker', style: PICKER_STYLE, 'aria-label': 'Fixture' },
          ...FIXTURES.map((one) =>
            createElement(
              'a',
              {
                key: one.name,
                className: 'mtg-modes__item',
                href: `#/${one.name}`,
                ...(one.name === name ? { 'aria-current': 'page' as const } : {}),
                onClick: (): void => {
                  select(one.name);
                },
              },
              one.name,
            ),
          ),
        ),
      ),
    }),
  );
}
