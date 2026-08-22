// @vitest-environment node
/**
 * The near seat's creature row does not clip a card below its content height.
 *
 * `mtg-z1h8`. `.mtg-board__spells` (`styles/board/fit.ts`) used to carry
 * `flex: 1 1 auto; min-height: 0` with nothing else on the column able to
 * shrink: the mana band under it is `flex: none; height: 3.5rem`
 * (`styles/board/lands.ts`), and the phase bar and hand are unshrinkable too.
 * So the creature row was the only band that could donate vertical space, and
 * it donated all of it — measured on `main` at 1024x768 with combat open and
 * the real route's own page furniture above the mat, a card's face went to 4px
 * of visible height against 16px of slot content.
 *
 * `Shell` is that furniture, the same as every committed browser test in this
 * file's directory (`./battlefield-geometry.browser.test.ts`,
 * `./page-overlap.browser.test.ts`) renders it: the header bar is what
 * `.mtg-play-route`'s budget is computed against, and a bare `PlayView` with no
 * `Shell` around it has the whole viewport rather than the leftover of one. The
 * The fixture set's own long names are load-bearing here too — a card whose name
 * wraps to three lines is a taller *content* height for the same slot, which is
 * exactly the shape that donated row could not pay for.
 *
 * The fix floors the row at `BOARD_FACE_MIN_REM` (`styles/board/hand.ts`), the
 * same readable-face height `MIN_SLOT_REM` and the slot floor already use, and
 * lets the row scroll vertically once it is squeezed past that floor rather
 * than clip.
 *
 * **Measurement, not a literal.** `getBoundingClientRect` ignores
 * `overflow: hidden`, so what is actually visible is each element's rect
 * intersected with the padding box of every clipping ancestor on the axis it
 * clips — `.mtg-board__spells`, `.mtg-zone__body` and `.mtg-shell__main` are
 * all `overflow: auto` — and then with the viewport. The assertion is the
 * property the fix buys: no card's visible height is less than its own content
 * height, not a fixed pixel count.
 *
 * **The mana band pays for the floor, and it pays by drawing smaller.**
 * `mtg-bduq`. The floor above stopped the row donating without saying where the
 * height was to come from instead, so it came out of the band under it, which
 * was the next unshrinkable thing on the lane: on this same page the near seat's
 * mana tiles hung 40.9px past the lane's bottom edge at 1024x768 and 9.9px at
 * 1280x800, cut by the lane's own scroller. `fit.ts` now caps the band at what
 * the row's floor leaves of the lane, and the tile follows its band down instead
 * of being cut by it, so this file measures both halves of the same budget:
 * every face whole, and every tile inside the lane that holds it. Measured, not
 * a literal — a tile's rect against the lane's rect, which is what a viewer sees
 * clipped.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const setPath = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);
const setDocument = JSON.parse(readFileSync(setPath, 'utf8')) as { readonly cards: readonly unknown[] };
const cards = parseCards(setDocument.cards);

function named(name: string): DslCard {
  const card = cards.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the fixture set is missing ${name}`);
  return card;
}

const HARROWER = named('Harrower of the Deep Shelf');
const SKYKNIGHT = named('Squall-Sworn Skyknight');
const basics = setBasics(cards);

function basicNamed(name: string): DslCard {
  const card = basics.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the fixture set did not mint ${name}`);
  return card;
}

const PLAINS = basicNamed('Plains');
const ISLAND = basicNamed('Island');
const SWAMP = basicNamed('Swamp');
const MOUNTAIN = basicNamed('Mountain');

function session(
  battlefield: readonly {
    readonly card: DslCard;
    readonly controller: PlayerId;
    readonly tapped?: boolean;
    readonly summoningSick?: boolean;
  }[],
  seed: string,
): GameSession {
  const built = scenario({ seed, battlefield, active: 0, turn: 6 });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * Near seat (controller 1, viewed): two creatures and five lands. Far seat
 * (controller 0): one creature, declared as an attacker directly in `combat`
 * the way `./battlefield-geometry.browser.test.ts`'s `screenshotSession` does,
 * rather than walked through the kernel's own turn machinery — the point of
 * this position is the geometry of an open combat, not the path to one.
 */
function combatOpen(): GameSession {
  const game = session(
    [
      { card: HARROWER, controller: 1, tapped: false, summoningSick: false },
      { card: HARROWER, controller: 1, tapped: false, summoningSick: false },
      { card: PLAINS, controller: 1, tapped: true, summoningSick: false },
      { card: ISLAND, controller: 1, tapped: true, summoningSick: false },
      { card: SWAMP, controller: 1, tapped: false, summoningSick: false },
      { card: MOUNTAIN, controller: 1, tapped: false, summoningSick: false },
      { card: PLAINS, controller: 1, tapped: false, summoningSick: false },
      { card: SKYKNIGHT, controller: 0, tapped: false, summoningSick: false },
    ],
    'ui/spells-row-floor',
  );
  const attacker = game.state.battlefield.find((oid) => {
    const object = game.state.objects[oid];
    return object?.controller === 0 && object.card.id === SKYKNIGHT.id;
  });
  if (attacker === undefined) throw new Error('the position has no opposing attacker');
  return {
    ...game,
    state: {
      ...game.state,
      combat: {
        ...game.state.combat,
        attacks: [{ oid: attacker, defender: 1 as PlayerId }],
      },
    },
  };
}

/**
 * The Shell bar plus the played table, exactly the pattern every committed
 * browser test in this directory renders it: `Shell`'s header — the title and
 * the mode nav — is the page furniture above `.mtg-play-route`'s `main`, and
 * it is what a naive `PlayView`-only render omits.
 */
/**
 * The route furniture the bead measured above the mat, on top of `Shell`'s own
 * header: a page title, the precon/sealed switch, and the collapsed turn badge
 * (`routes/play/BuilderSwitch.ts`, `routes/play/toolbar.ts`'s `playDetails`).
 * `PlayRoute` only draws the switch on the builder screen and the turn badge is
 * folded into `PlayView`'s own strip once a game is dealt, so a live-table
 * capture never carries every one of these three at once through this
 * package's own component wiring — the bead's own screenshots
 * (`references/UI_issues/`) are what show them stacked together. Reproduced
 * here as real markup with the classes those three components render (a
 * `role="group"` pair of buttons, an `h1.mtg-page-title`, a `.mtg-badge` turn
 * line) rather than a bare placeholder box, so the harness is squeezing the
 * mat with the shapes production actually draws, sized to what they measure.
 */
function routeFurniture(): ReactElement {
  return h(
    Fragment,
    null,
    h('h1', { className: 'mtg-page-title' }, 'Play'),
    h(
      'div',
      { className: 'mtg-toolbar', role: 'group', 'aria-label': 'How to play' },
      h(
        'button',
        { type: 'button', className: 'mtg-btn', 'aria-pressed': true, 'data-variant': 'primary' },
        'Preconstructed decks',
      ),
      h('button', { type: 'button', className: 'mtg-btn', 'aria-pressed': false }, 'Open a sealed pool'),
    ),
    h('span', { className: 'mtg-badge' }, 'Turn 6: You'),
    ...Array.from({ length: 6 }, (_unused, index) =>
      h('p', { className: 'mtg-page-note', key: `pad-${String(index)}` }, `padding note ${String(index)}`),
    ),
  );
}

function page(game: GameSession, title: string): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'the flagship set',
      children: h(
        'div',
        { className: 'mtg-play-route' },
        routeFurniture(),
        h(PlayView, {
          session: game,
          viewer: 1,
          names: ['Bot', 'You'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Every clipping ancestor's overflow mode plus the viewport, folded into each
 * face's rect. Returns, per `.mtg-board__spells` face on the near seat, the
 * content height (`scrollHeight`, what the face wants) against the visible
 * height (what survives every ancestor's clip), so the gap is measured rather
 * than asserted from a constant.
 */
const MEASURE = `(() => {
  const view = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  const clipsOn = (style, axis) => (axis === 'x' ? style.overflowX : style.overflowY) !== 'visible';
  const round = (value) => Math.round(value * 10) / 10;

  const visible = (element) => {
    let box = element.getBoundingClientRect();
    box = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipBox = node.getBoundingClientRect();
      for (const axis of ['x', 'y']) {
        if (!clipsOn(style, axis)) continue;
        const low = axis === 'x' ? 'left' : 'top';
        const high = axis === 'x' ? 'right' : 'bottom';
        box[low] = Math.max(box[low], clipBox[low]);
        box[high] = Math.min(box[high], clipBox[high]);
      }
    }
    box.left = Math.max(box.left, view.left);
    box.top = Math.max(box.top, view.top);
    box.right = Math.min(box.right, view.right);
    box.bottom = Math.min(box.bottom, view.bottom);
    return box;
  };

  const lane = document.querySelector("[data-seat='you'] .mtg-zone__body[data-layout='board']");
  const spellsRow = document.querySelector("[data-seat='you'] .mtg-board__spells");
  if (spellsRow === null || lane === null)
    return { faces: 0, worst: null, rows: [], tiles: 0, tileClips: [], maxTileClipPx: 0 };
  const laneBox = lane.getBoundingClientRect();
  const tileClips = [...lane.querySelectorAll('.mtg-lands > .mtg-slot')].map((tile) => {
    const box = tile.getBoundingClientRect();
    return round(Math.max(0, laneBox.top - box.top, box.bottom - laneBox.bottom));
  });
  const faces = [...spellsRow.querySelectorAll(".mtg-slot[data-slot='play'] > .mtg-card")];
  const rows = faces.map((face) => {
    const box = visible(face);
    const visibleHeight = Math.max(0, box.bottom - box.top);
    const contentHeight = face.scrollHeight;
    return {
      name: (face.querySelector('.mtg-card__name')?.textContent ?? face.className).slice(0, 40),
      contentHeight: round(contentHeight),
      visibleHeight: round(visibleHeight),
      clippedPx: round(Math.max(0, contentHeight - visibleHeight)),
    };
  });
  const worst = rows.reduce((max, row) => (row.clippedPx > (max?.clippedPx ?? -1) ? row : max), null);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    faces: faces.length,
    rows,
    worst,
    maxClippedPx: rows.reduce((max, row) => Math.max(max, row.clippedPx), 0),
    tiles: tileClips.length,
    tileClips,
    maxTileClipPx: tileClips.reduce((max, clip) => Math.max(max, clip), 0),
  };
})()`;

interface Row {
  readonly name: string;
  readonly contentHeight: number;
  readonly visibleHeight: number;
  readonly clippedPx: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly faces: number;
  readonly rows: readonly Row[];
  readonly worst: Row | null;
  readonly maxClippedPx: number;
  readonly tiles: number;
  readonly tileClips: readonly number[];
  readonly maxTileClipPx: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

describe('the near seat creature row does not clip a card below its content height', () => {
  browserIt(
    'floors .mtg-board__spells at BOARD_FACE_MIN_REM and scrolls instead of clipping',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-spells-floor-'));
      const game = combatOpen();
      const file = join(directory, 'combat-open.html');
      await writeFile(file, page(game, 'Combat open'), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const result = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            'combat-open',
          )) as unknown as Reading;
          console.log(
            `${String(width)}x${String(height)}: faces ${String(result.faces)}, maxClippedPx ${String(result.maxClippedPx)}, worst ${JSON.stringify(result.worst)}`,
          );
          expect(
            result.faces,
            `${String(width)}x${String(height)}: no near-seat creature faces measured`,
          ).toBe(2);
          expect(
            result.maxClippedPx,
            `${String(width)}x${String(height)}: ${JSON.stringify(result.rows)}`,
          ).toBe(0);
          expect(result.tiles, `${String(width)}x${String(height)}: no near-seat mana tiles measured`).toBe(
            5,
          );
          expect(
            result.maxTileClipPx,
            `${String(width)}x${String(height)}: mana tile cut by its lane, clips ${JSON.stringify(result.tileClips)}`,
          ).toBe(0);
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `spells row floor Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
