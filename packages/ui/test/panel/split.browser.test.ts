// @vitest-environment node
/**
 * What a dragged divider is allowed to do to the two panes under it.
 *
 * `mtg-rgc.19`. the playtester, 2026-08-29: "the different panes should be
 * resizable". `./split.test.ts` beside this one holds the arithmetic; the
 * question here is the one only a browser answers, and it is the question the
 * whole feature turns on: a share is a number, and what a *layout* does with a
 * number it dislikes is either to honor the floors both panes were given or to
 * quietly draw a pane with nothing in it.
 *
 * Three sentences, at both consumers:
 *
 * 1. **The divider is drawn where it can be used and nowhere else.** It is a
 *    control that divides a frame, and below the frame gates there is no frame
 *    to divide -- the draft's column scrolls and the builder's panes stack --
 *    so a handle there would move a property no rule reads.
 * 2. **A share moves the split**, monotonically: a bigger share is a bigger
 *    first pane. This is the one claim that fails if a consumer wires the
 *    property to a rule that is not the one sizing that pane, which is a
 *    mistake no type can catch and no unit test can see.
 * 3. **Neither pane goes under its floor, at either limit and past them.** The
 *    limits in `../../src/panel/split.ts` are what a *handle* may be dragged to;
 *    the floors are the stylesheet's, and they are the ones that have to hold,
 *    because a stored share outlives the build that wrote it and a hand-edited
 *    store is one line of JavaScript away. So the shares swept here go outside
 *    the limits on purpose: at 0.02 and 0.98 nothing but the stylesheet is left
 *    between a person and a pane they cannot see.
 *
 * The two consumers enforce those floors by different means and that is the
 * reason both are measured. The draft's panes are flex items whose
 * `min-block-size` beats the basis they were handed. The builder's are grid
 * tracks, which do not grow for what is in them, so its floors are clamped into
 * the value itself (`BUILDER_SPLIT_FLOORS`) -- and a `clamp` that named the
 * wrong lengths would still produce a perfectly valid track.
 *
 * The value is not written out here: each subject hands over the style object
 * its own surface renders with, so what is measured is every property this
 * repository actually ships and not a restatement of one of them. The builder
 * writes two (`builderSplitStyle`) because its stylesheet lets an empty deck
 * pane size to its content, and a rig that applied only the pool's track would
 * be asking the layout a question no drag can put to it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam } from '../../src/routes/deck/open';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { builderSplitStyle } from '../../src/routes/deck/builder-split';
import { railSplitStyle } from '../../src/routes/draft/rail-split';
import { splitStyle } from '../../src/panel/split';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

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

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

function document_(title: string, markup: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/** A draft mid-round: a full pack over a pool with something in it to squeeze. */
function draftPage(): string {
  const cards = Array.from(
    { length: 15 },
    (_, index) => EXAMPLE_CARDS[(index * 3) % EXAMPLE_CARDS.length] as Card,
  );
  const pool = Array.from(
    { length: 15 },
    (_, index) => EXAMPLE_CARDS[(index * 5) % EXAMPLE_CARDS.length] as Card,
  );
  const next: HumanDraftChoice = { round: 1, pickNumber: 1, packSize: 15, openedBy: 0, cards };
  const draft: HumanDraftProgress = {
    seed: 'ui/split',
    humanSeat: 0,
    picks: pool.map((card) => card.id),
    seats: [],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: next,
    result: null,
  };
  return document_(
    'Draft split',
    renderToStaticMarkup(
      h(Shell, {
        mode: 'play',
        sub: 'draft',
        onSelectMode: () => undefined,
        title: 'MTG Lab',
        children: h(DraftPack, {
          draft,
          next,
          pool,
          onPick: () => undefined,
          onNewDraft: () => undefined,
        }),
      }),
    ),
  );
}

/** The Constructed builder, compact, which is the density its panes divide in. */
function builderPage(cards: readonly Card[]): string {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? 'compact' : null),
    setItem: (): void => undefined,
  };
  return document_(
    'Builder split',
    renderToStaticMarkup(
      h(Shell, {
        mode: 'customize',
        sub: 'decks',
        onSelectMode: (): void => undefined,
        children: h(DeckRoute, {
          state: { status: 'absent' },
          cards,
          open: deckOpenParam({ kind: 'build' }),
        }),
      }),
    ),
  );
}

/**
 * One reading, with the share already applied.
 *
 * The property is set on the container the surface sets it on and then the
 * layout is forced, because React never mounts on this rig
 * (`../support/chrome.ts`): a drag is unreachable here, and what a drag does is
 * write exactly this string to exactly this element.
 *
 * Transitions are stopped first, and that is not tidiness. `../../src/styles/
 * base.ts` clamps *every* element on the page to a 1ms transition under
 * `prefers-reduced-motion`, which this harness emulates by default, and the
 * initial value of `transition-property` is `all` -- so a track size written and
 * read in one task reads back the value it was leaving rather than the one it
 * was given. Measured before this was found: every share drew identical panes,
 * to the hundredth of a pixel, on a layout that was in fact responding
 * perfectly.
 */
/** Which dimension the divider moves; see `Subject.axis`. */
type SplitAxis = 'block' | 'inline';

function measure(
  container: string,
  first: string,
  second: string,
  style: Readonly<Record<string, string>> | null,
  axis: SplitAxis,
): string {
  const set =
    style === null
      ? ''
      : Object.entries(style)
          .map(
            ([property, value]) =>
              `box.style.setProperty(${JSON.stringify(property)}, ${JSON.stringify(value)});`,
          )
          .join('') + ' void document.documentElement.offsetHeight;';
  return `(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(still);
    const box = document.querySelector(${JSON.stringify(container)});
    const a = document.querySelector(${JSON.stringify(first)});
    const b = document.querySelector(${JSON.stringify(second)});
    if (box === null || a === null || b === null) return null;
    ${set}
    const handle = box.querySelector(':scope > .mtg-split');
    const outer = box.getBoundingClientRect();
    const one = a.getBoundingClientRect();
    const two = b.getBoundingClientRect();
    const along = ${JSON.stringify(axis)} === 'block'
      ? { size: (r) => r.height, far: (r) => r.bottom, thick: (r) => r.height }
      : { size: (r) => r.width, far: (r) => r.right, thick: (r) => r.width };
    return {
      container: round(along.size(outer)),
      first: round(along.size(one)),
      second: round(along.size(two)),
      overhang: round(along.far(two) - along.far(outer)),
      handleHeight: handle === null ? 0 : round(along.thick(handle.getBoundingClientRect())),
      handleShown: handle === null ? 'absent' : getComputedStyle(handle).display,
    };
  })()`;
}

interface Reading {
  readonly container: number;
  readonly first: number;
  readonly second: number;
  readonly overhang: number;
  readonly handleHeight: number;
  readonly handleShown: string;
}

const SLACK_PX = 0.5;

/**
 * The shares swept, in order, so a bigger share can be checked against the one
 * before it. The two on the ends are outside `DEFAULT_SPLIT_LIMITS` and are the
 * point: they ask the stylesheet the question with the handle's own clamp taken
 * away.
 */
const SHARES = [0.02, 0.15, 0.35, 0.6, 0.85, 0.98] as const;

interface Subject {
  readonly name: string;
  /**
   * Which way the divider shares the container out.
   *
   * The draft and the sealed builder divide height; the Constructed builder
   * divides width since `mtg-x6xq`. Every claim below is about "the first pane's
   * size along the split", so the axis is read once here rather than the file
   * assuming one and measuring a dimension the divider does not move.
   */
  readonly axis: SplitAxis;
  /** The element carrying `--split-a`. */
  readonly container: string;
  /** The pane the share sizes, and the pane that takes the rest. */
  readonly first: string;
  readonly second: string;
  /** The least each may be drawn at, measured off its own rules. */
  readonly firstFloor: number;
  readonly secondFloor: number;
  /** Exactly what this surface writes on the container when it is dragged. */
  style(share: number): Readonly<Record<string, string>> | undefined;
  page(cards: readonly Card[]): string;
}

/**
 * The two floors per surface, restated here in pixels at this rig's root size.
 *
 * Draft: the pack keeps `--pack-row-min` (8.5rem) plus the box's own padding,
 * and the pool keeps `DRAFT_POOL_COLUMN_FLOOR_PX` plus the count row and the
 * sideways scrollbar its region grows -- 240 + 32 + 15. Builder: both panes keep
 * `BUILDER_SPLIT_FLOORS`, which is 12rem each.
 *
 * A pixel under each, because a border rounds and a floor met exactly is a floor
 * met.
 */
const SUBJECTS: readonly Subject[] = [
  {
    name: 'the draft, pack over pool',
    axis: 'block',
    container: '.mtg-work__main',
    first: '.mtg-work__scroll',
    second: '.mtg-draft__poolbox',
    firstFloor: 151,
    secondFloor: 286,
    style: (share) => splitStyle('--split-a', share),
    page: () => draftPage(),
  },
  {
    name: 'the builder, collection beside deck',
    axis: 'inline',
    container: '.mtg-builder__panes',
    first: '[data-pane="pool"]',
    second: '[data-pane="deck"]',
    firstFloor: 191,
    secondFloor: 191,
    style: (share) => builderSplitStyle(share),
    page: (cards) => builderPage(cards),
  },
  {
    name: 'the draft, workspace beside rail',
    axis: 'inline',
    container: '.mtg-work',
    first: '.mtg-work__main',
    second: '.mtg-rail',
    firstFloor: 312,
    secondFloor: 255,
    style: (share) => railSplitStyle(share),
    page: () => draftPage(),
  },
];

/** A desk, and a phone, which is the size with no frame to divide. */
const SIZES = [
  { width: 1440, height: 900, divides: true },
  { width: 1600, height: 1000, divides: true },
  { width: 390, height: 844, divides: false },
] as const;

describe('a divider the player drags', () => {
  browserIt(
    'moves the split and keeps both panes off the floor, at every share and past the limits',
    async () => {
      const cards = loadSet();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-split-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-split-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        for (const subject of SUBJECTS) {
          const file = join(directory, `${subject.container.replace(/\W/g, '')}.html`);
          await writeFile(file, subject.page(cards), 'utf8');
          for (const size of SIZES) {
            const where = `${subject.name} at ${String(size.width)}x${String(size.height)}`;
            const read = async (share: number | null): Promise<Reading> => {
              const style = share === null ? undefined : subject.style(share);
              const seen = (await measurePage(
                chrome.client,
                file,
                size.width,
                size.height,
                measure(subject.container, subject.first, subject.second, style ?? null, subject.axis),
                `${where}, share ${share === null ? 'unset' : share.toFixed(2)}`,
                subject.container,
              )) as unknown as Reading | null;
              if (seen === null) throw new Error(`${where}: the page drew no panes to divide`);
              return seen;
            };

            // 1. Drawn where there is a frame to divide, and not otherwise.
            const undragged = await read(null);
            if (size.divides) {
              expect(undragged.handleShown, `${where}: no divider between the panes`).not.toBe('none');
              expect(undragged.handleHeight, `${where}: the divider is too thin to grab`).toBeGreaterThan(4);
            } else {
              expect(undragged.handleShown, `${where}: a divider on a surface with no frame`).toBe('none');
              continue;
            }

            let previous = 0;
            for (const share of SHARES) {
              const at = `${where}, share ${share.toFixed(2)}`;
              const seen = await read(share);

              // 3. Both panes survive every share, including the two the handle
              //    would never hand over.
              expect(seen.first, `${at}: the first pane went under its floor`).toBeGreaterThanOrEqual(
                subject.firstFloor,
              );
              expect(seen.second, `${at}: the second pane went under its floor`).toBeGreaterThanOrEqual(
                subject.secondFloor,
              );
              expect(
                seen.overhang,
                `${at}: the second pane runs past the bottom of the frame`,
              ).toBeLessThanOrEqual(SLACK_PX);

              // 2. A bigger share is a bigger first pane, or the floors have
              //    taken over -- which is the only reason it may stand still.
              expect(seen.first, `${at}: a bigger share drew a smaller pane`).toBeGreaterThanOrEqual(
                previous - SLACK_PX,
              );
              previous = seen.first;
            }

            // And the sweep moved something: a property wired to a rule nobody
            // reads passes every assertion above without ever redrawing.
            const low = await read(0.15);
            const high = await read(0.85);
            expect(high.first - low.first, `${where}: the divider moved nothing`).toBeGreaterThan(40);
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
