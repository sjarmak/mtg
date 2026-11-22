/**
 * The deck page at both densities, as static HTML a browser can measure.
 *
 * The question the density control exists to answer is "how many cards can I see
 * at once", and that is a layout question. jsdom performs no layout — every
 * `getBoundingClientRect` there is zeros — so `../test/lab/deck-route.test.ts`
 * can assert which regions a tile builds and cannot assert a single pixel of
 * what they came out as. This writes the page a real browser can, one file per
 * mode, and gives it a measuring function so the driver is a navigate and one
 * `Runtime.evaluate` rather than a script that has to know the class names. It
 * is the arrangement `./board-crowding.ts` already uses for the played table.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/deck-density.ts out/deck-density
 *     npx tsx packages/ui/tools/deck-density.ts out/deck-density path/to/deck.json
 *
 * **It names the deck it read, on stdout and in the page's own heading.** A rig
 * in this tree was once run with no argument and silently measured a different
 * fixture than the one its numbers were reported against, and a night of
 * readings was wrong that way. The deck path defaults to the committed
 * `boros-aggro` artifact — the same one the unit suite reads — but a default is
 * only safe when the output says which one it was, so every run prints the
 * resolved absolute path and the deck's own prompt, and `window.mtgDeckDensity()`
 * returns them beside the counts. A reading that cannot name its deck is not a
 * reading.
 *
 * ## What it counts, and why "visible" is defined the way it is
 *
 * A card is counted visible when its tile's border box lies **entirely** inside
 * the box being measured. Entirely rather than intersecting, because a tile
 * sliced by the fold is a tile you have to scroll to read, and counting it would
 * let a mode win by clipping more cards rather than by fitting more.
 *
 * There are two such boxes and both are reported, because they answer different
 * questions and the first one's answer is startling.
 *
 *  * `onArrival` measures the unscrolled viewport — what is on screen when the
 *    page opens. It is frequently **zero** at every viewport and in every mode,
 *    and that is not a bug in the measure: the mana-base table is drawn above
 *    the cards and is taller than a screen, so a person arriving at this route
 *    sees no cards at all until they scroll. That is a genuine finding about the
 *    page's information architecture and it is what the MTGO capture's split
 *    panes fix, so it is filed rather than papered over.
 *  * `inOneScreen` measures a viewport-tall window starting at the pane's own
 *    grid top — how many cards of this pane you can see at once, having scrolled
 *    to it. This is the number the density control exists to move, and it is the
 *    one the before/after table is about.
 *
 * The clipping question is asked separately and per tile: `clipped` counts tiles
 * whose scroll width exceeds their client width, which is the shape a name that
 * does not fit its strip takes. The compact tile truncates its name deliberately
 * (`../src/styles/deck.ts`), so this counts the *box* overflowing rather than the
 * text inside it, and a nonzero reading is a tile the layout could not hold.
 *
 * ## The page is the real page, bar and all
 *
 * This wrapped the route in a bare `div.mtg-shell` when it was written, which is
 * the shell's class without the shell's markup, and two numbers came out of that
 * wrong in the same direction. `.mtg-shell__main` carries the page's inline
 * padding, so every tile was measured about 80px wider than a person gets. And
 * `.mtg-shell__bar` is `position: sticky; top: 0; z-index: 2` (`../src/styles/base.ts`),
 * so a page without it cannot answer any question about a second sticky layer
 * underneath it — which is exactly what `mtg-n4d3` is about. So the route is
 * rendered inside the real `Shell`, and `barHeight` is reported beside the rest:
 * a sticky offset stated in the sheet is only as good as the number it was
 * measured against, and this is where that number comes from.
 *
 * ## The page names no host, so any driver can drive it
 *
 * The deck is a deck of real printings and its entries carry absolute Scryfall
 * URLs. A page built straight out of them cannot be measured by
 * `../test/support/chrome-driver.ts`'s `measurePage`, which settles on
 * `document.readyState === 'complete'`: on a machine with no route to that host
 * the requests are not refused, they are dropped, so `readyState` stays
 * `interactive` for the life of a page that is fully laid out and sitting there.
 * Nothing is animating and every pane is drawn; the wait is on images. Every
 * driver written for this file therefore hand-rolled its own settle, and the
 * tool's acceptance-criteria role (`mtg-ybrn` named it) depended on a network
 * the measurement does not need.
 *
 * `mtg-hznd` is that fixed, and at this end rather than at `measurePage`'s:
 * `complete` is what stops the other rigs measuring an unsized image mid-load,
 * and a settle relaxed for one page is relaxed for all of them. So the art is
 * staged beside the pages the way `npm run lab` stages it beside the dev server
 * -- through the shared cache at `data/images/`, copied into `<out>/art/`, with
 * every `src` rewritten to a relative path.
 *
 * **What could not be staged is dropped rather than kept.** That is the one way
 * this differs from `./stage-art.ts`'s own decision, and the difference is what
 * the two pages are for: a served deck keeps a failed illustration's absolute
 * URL because a viewer who *can* reach Scryfall should still see it, while a
 * measured page that keeps one is a page that cannot be measured on the machine
 * that could not fetch it. Dropping it draws the labeled pending frame, which
 * reserves its box from `@mtg/card-geometry` rather than from the raster, so no
 * number below moves. The run says how many it dropped and why.
 *
 * `../test/deck/deck-density-offline.browser.test.ts` holds that: it runs this
 * program, reads the emitted files for anything pointing off the machine, and
 * drives them through `measurePage` unchanged in a browser whose every host name
 * resolves into a blackhole -- because the machine writing this fix can reach
 * Scryfall and the machine that found the bead could not, and a rig that merely
 * ran here would go green on a page still full of remote URLs.
 *
 * ## Reaching a pane's own controls, having scrolled into it
 *
 * `window.mtgDeckHeadReach()` is the `mtg-n4d3` measurement and it is separate
 * because it moves the page. For each pane it scrolls the pane's grid midpoint to
 * the middle of the viewport — a person reading the middle of a long list — and
 * asks whether that pane's header is on screen and clear of the app bar that is
 * stuck over it. `visible` is false in both failure modes, and `coveredByBar` says
 * which: a header that scrolled away entirely and a header stuck under an opaque
 * bar are the same experience and different bugs. Scroll is restored to zero
 * afterward so the two functions can be called in either order.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Shell } from '../src/app/Shell';
import type { DeckArtifact, DeckArtifactEntry } from '../src/lab/deck-artifact';
import { readDeckArtifact } from '../src/lab/deck-artifact';
import { DeckRoute } from '../src/routes/DeckRoute';
import { deckOpenParam } from '../src/routes/deck/open';
import { DECK_VIEW_MODES, DEFAULT_DECK_VIEW_MODE, deckViewStoreKey } from '../src/routes/deck/view-mode';
import type { DeckViewMode } from '../src/routes/deck/view-mode';
import { uiStyleSheet } from '../src/styles/index';
import { ART_DIR, stageDeckArt } from './stage-art';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/** The committed deck the unit suite also reads, so the two agree on the subject. */
const DEFAULT_DECK = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

/**
 * The measuring function, shipped into the page as text.
 *
 * A string rather than a module because the page has no bundler: it is one file
 * with one inline `<script>`, opened over `file://`, which is what
 * `--allow-file-access-from-files` is for.
 */
const MEASURE = `
window.mtgDeckBarHeight = function () {
  var bar = document.querySelector('.mtg-shell__bar');
  return bar === null ? 0 : Math.round(bar.getBoundingClientRect().height * 10) / 10;
};
window.mtgDeckDensity = function () {
  window.scrollTo(0, 0);
  var panes = [];
  var sections = document.querySelectorAll('.mtg-deck__pane');
  for (var s = 0; s < sections.length; s += 1) {
    // The pane's body, whichever of the two a density draws: 'mtg-rgc.21'
    // retired the flat '.mtg-deck__grid' this used to name, so a full pane is
    // now the curve's columns and a compact one is the strips region. The
    // tile counts below are a full pane's reading -- a compact pane holds
    // strips rather than tiles and reports zero of them, which is right.
    var grid = sections[s].querySelector('.mtg-builder-curve, .mtg-strips');
    if (grid === null) continue;
    var title = sections[s].querySelector('.mtg-deck__pane-title');
    var tiles = grid.querySelectorAll('.mtg-deck-card');
    var gridTop = grid.getBoundingClientRect().top;
    var onArrival = 0;
    var inOneScreen = 0;
    var clipped = 0;
    var tallest = 0;
    var widest = 0;
    var cards = 0;
    for (var t = 0; t < tiles.length; t += 1) {
      var box = tiles[t].getBoundingClientRect();
      var acrossOk = box.left >= 0 && box.right <= window.innerWidth;
      if (acrossOk && box.top >= 0 && box.bottom <= window.innerHeight) onArrival += 1;
      if (acrossOk && box.top - gridTop >= 0 && box.bottom - gridTop <= window.innerHeight) {
        inOneScreen += 1;
      }
      if (tiles[t].scrollWidth > tiles[t].clientWidth) clipped += 1;
      if (box.height > tallest) tallest = box.height;
      if (box.width > widest) widest = box.width;
      var badge = tiles[t].querySelector('.mtg-deck-card__count');
      cards += badge === null ? 0 : parseInt(badge.textContent, 10);
    }
    var heads = grid.querySelectorAll('.mtg-deck__column-count');
    var counts = [];
    for (var c = 0; c < heads.length; c += 1) counts.push(parseInt(heads[c].textContent, 10));
    panes.push({
      pane: title === null ? '(unnamed)' : title.textContent,
      total: tiles.length,
      cards: cards,
      onArrival: onArrival,
      inOneScreen: inOneScreen,
      clipped: clipped,
      tileHeight: Math.round(tallest * 10) / 10,
      tileWidth: Math.round(widest * 10) / 10,
      columns: window.getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      columnCounts: counts,
    });
  }
  return {
    deck: window.mtgDeckSubject,
    mode: document.documentElement.getAttribute('data-density-mode'),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    barHeight: window.mtgDeckBarHeight(),
    panes: panes,
  };
};
window.mtgDeckHeadReach = function () {
  var barBottom = window.mtgDeckBarHeight();
  var out = [];
  var sections = document.querySelectorAll('.mtg-deck__pane');
  for (var s = 0; s < sections.length; s += 1) {
    var grid = sections[s].querySelector('.mtg-builder-curve, .mtg-strips');
    var head = sections[s].querySelector('.mtg-deck__pane-head');
    if (grid === null || head === null) continue;
    var title = sections[s].querySelector('.mtg-deck__pane-title');
    window.scrollTo(0, 0);
    var gridBox = grid.getBoundingClientRect();
    var middle = window.scrollY + gridBox.top + gridBox.height / 2;
    window.scrollTo(0, Math.max(0, middle - window.innerHeight / 2));
    // The header's *content* edge, not its border box. A sticky header is pinned
    // by its border box and deliberately tucks its padding under the app bar
    // (../src/styles/deck.ts says why), so measuring the border box would
    // report a working header as covered.
    var headBox = head.getBoundingClientRect();
    var padTop = parseFloat(window.getComputedStyle(head).paddingTop) || 0;
    var contentTop = headBox.top + padTop;
    var onScreen = headBox.bottom > 0 && contentTop < window.innerHeight;
    out.push({
      pane: title === null ? '(unnamed)' : title.textContent,
      scrolledTo: Math.round(window.scrollY),
      headTop: Math.round(contentTop * 10) / 10,
      coveredByBar: onScreen && contentTop < barBottom,
      visible: onScreen && contentTop >= barBottom,
    });
  }
  window.scrollTo(0, 0);
  return { deck: window.mtgDeckSubject, barHeight: barBottom, panes: out };
};
`;

/** The shared image cache every other launcher in this tree reads. */
const IMAGE_CACHE = join(REPO_ROOT, 'data', 'images');

/**
 * An illustration the browser would have to leave this machine to get.
 *
 * Asked of the `src` rather than of the staging result, because the result says
 * what this run did and the page is what the next reader loads: an entry
 * `./stage-art.ts` could not fetch keeps its absolute URL, and so would one that
 * arrived in the artifact already pointing somewhere odd.
 */
function isRemote(src: string): boolean {
  return /^[a-z]+:\/\//i.test(src) || src.startsWith('//');
}

function dropRemote(entries: readonly DeckArtifactEntry[]): DeckArtifactEntry[] {
  return entries.map((entry) =>
    entry.art !== null && isRemote(entry.art.src) ? { ...entry, art: null } : entry,
  );
}

/** How many illustrations the page would still have gone off-machine for. */
function remoteCount(deck: DeckArtifact): number {
  return [...deck.spells, ...deck.lands, ...deck.basics, ...(deck.sideboard ?? [])].filter(
    (entry) => entry.art !== null && isRemote(entry.art.src),
  ).length;
}

function onlyLocalArt(deck: DeckArtifact): DeckArtifact {
  return {
    ...deck,
    spells: dropRemote(deck.spells),
    lands: dropRemote(deck.lands),
    basics: dropRemote(deck.basics),
    ...(deck.sideboard === undefined ? {} : { sideboard: dropRemote(deck.sideboard) }),
  };
}

function page(markup: string, css: string, mode: DeckViewMode, subject: string): string {
  return [
    '<!doctype html>',
    `<html lang="en" data-density-mode="${mode}">`,
    '<head><meta charset="utf-8">',
    `<title>Deck density · ${mode}</title>`,
    `<style>${css}</style>`,
    '</head><body>',
    markup,
    `<script>window.mtgDeckSubject = ${JSON.stringify(subject)};${MEASURE}</script>`,
    '</body></html>',
  ].join('\n');
}

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'deck-density');
  const deckPath = resolve(process.argv[3] ?? DEFAULT_DECK);
  const parsed = readDeckArtifact(JSON.parse(readFileSync(deckPath, 'utf8')), deckPath);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    process.exitCode = 1;
    return;
  }
  const subject = `${deckPath} — “${parsed.deck.prompt}” (${parsed.deck.format}, ${String(parsed.deck.totalCards)} cards)`;
  const css = uiStyleSheet();
  mkdirSync(out, { recursive: true });

  const staged = await stageDeckArt(parsed.deck, { cacheDir: IMAGE_CACHE, publicDir: join(out, ART_DIR) });
  const dropped = remoteCount(staged.deck);
  const deck = onlyLocalArt(staged.deck);

  // The route reads its density out of the preference store on mount, so this
  // hands Node a store rather than threading a prop in. The markup measured is
  // then exactly what the route produces for a person who pressed the control,
  // not a second arrangement that happens to look like it. The shim is the
  // narrow structural pair `../src/routes/deck/view-mode.ts` runtime-checks for,
  // and nothing else — Node has no `localStorage` and this is the whole of what
  // is missing.
  //
  // **It answers for every pane rather than for a list of them.** This primed a
  // hardcoded three (`spells`, `nonbasic-lands`, `basics`) until the panes were
  // rebuilt as `main-deck` and `sideboard` (`mtg-o5z1`), and a store keyed by
  // names no pane asks for answers nothing: every pane read the default, so the
  // compact page was a second copy of the full one and a night of readings
  // showed the two modes tying at every viewport. A rig that names its subjects
  // reports on the names. So the mode is the answer to *any* deck-view key, and
  // the prefix comes from the key builder itself rather than from a string typed
  // here a second time.
  let mode: DeckViewMode = DEFAULT_DECK_VIEW_MODE;
  const viewKeyPrefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(viewKeyPrefix) ? mode : null),
    setItem: (): void => undefined,
  };

  for (const each of DECK_VIEW_MODES) {
    mode = each;
    const markup = renderToStaticMarkup(
      h(Shell, {
        mode: 'customize',
        sub: 'decks',
        onSelectMode: (): void => undefined,
        // The link that opens the staged deck rather than the bare tab: since
        // `mtg-nuk3` Customize's Decks section lands on the library, so a rig that renders
        // the route with no request measures shelves instead of a deck.
        children: h(DeckRoute, {
          state: { status: 'ready', deck },
          open: deckOpenParam({ kind: 'artifact' }),
        }),
      }),
    );
    const file = join(out, `density-${mode}.html`);
    writeFileSync(file, page(markup, css, mode, subject), 'utf8');
    process.stdout.write(`${file}\n`);
  }
  process.stdout.write(`deck: ${subject}\n`);
  process.stdout.write(
    `art: ${String(staged.fetched)} fetched, ${String(staged.reused)} already cached, ` +
      `${String(dropped)} dropped so the page asks no host\n`,
  );
  for (const failure of staged.failures) process.stdout.write(`  could not stage ${failure}\n`);
}

await main();
