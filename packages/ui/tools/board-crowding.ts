/**
 * The played table at a stated number of permanents a side, as static HTML a
 * browser can measure.
 *
 * `mtg-bc2.142` is a defect no test in this checkout can see: jsdom lays nothing
 * out, so the only way to say how tall a card's art window came out at twelve
 * permanents a side is to put the real markup and the real stylesheet in a real
 * browser and read the boxes. This writes that page, one per count, and gives it
 * a measuring function so the driver is a navigate and one `Runtime.evaluate`
 * rather than a script that has to know the class names.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser. `packages/ui/tools/frame-review.ts` is the same arrangement for the
 * printed frames.
 *
 * Run it: `npx tsx packages/ui/tools/board-crowding.ts out/board-crowding`.
 * Then point a browser at `crowding-<spells>-<lands>.html` and call
 * `window.mtgBoardCrowding()`.
 *
 * A set and an art manifest may follow the output directory, and then the page
 * is drawn from real cards with real pictures instead of from the DSL example
 * set's art-less fixtures:
 *
 *     npx tsx packages/ui/tools/board-crowding.ts out/board-crowding \
 *       out/art/tideglass-reach/set.json out/art/tideglass-reach/art.json
 *
 * That is optional because both files are build output and neither is in the
 * repository, and it is here because the land band draws nothing *but* art now:
 * a page measured only against the pending frame is a page that never saw the
 * thing it is measuring.
 *
 * The measure carries the strip as well as the mat (`mtg-bz2.1`). The phase bar
 * is thirteen nodes under the board, and how many rows they take is exactly the
 * kind of fact jsdom cannot answer: the vitest suite asserts the cascade
 * declarations, and `strip` is where the browser says what they drew — the
 * strip's height, the bar's, how many of its nodes are fully inside it, and
 * `barLines`, the number of distinct node tops. One line at 1440x900 and two at
 * 1280x800 and 1024x768 is the current answer and the shortfall is where the
 * words are not, which is the trade `styles/views.ts` argues.
 *
 * The mana base is a variable now rather than a fixture. It was fixed at seven
 * while the band was a bounded slice of the row's *width*, where the land count
 * changed the picture and nothing else. A band under the row spends the row's
 * height, so the question "what does a mana base cost the spells" has a land
 * count in it and the page has to carry one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/** The counts the bead measured, so a re-measurement is a like-for-like table. */
export const CROWDING_COUNTS: readonly number[] = [4, 6, 8, 10, 12, 14];

/**
 * How many lands stand beside those permanents.
 *
 * Four numbers rather than one. Seven is the realistic case — a mana base is
 * five to nine permanents and seven is the middle of it — and the other three
 * are the ends: four is a stumbled draw, ten a long game, fourteen a board
 * nobody will actually reach and the count at which a one-line band has to
 * prove it scrolls rather than growing.
 */
export const CROWDING_LANDS: readonly number[] = [4, 7, 10, 14];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'board-crowding');
const setPath = process.argv[3];
const artPath = process.argv[4];

/**
 * The cards the page is drawn from: a named set when one is given, the DSL
 * example set otherwise. A set that fails to parse stops the run rather than
 * falling back, because a silent fallback would produce exactly the art-less
 * page the caller asked to get away from.
 */
function cards(): readonly DslCard[] {
  if (setPath === undefined) return EXAMPLE_SET;
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  return parseCards(listed);
}

/** The manifest's resolver, or null when no manifest was named. */
function artFor(): ArtResolver | null {
  if (artPath === undefined) return null;
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  // The manifest's hrefs are relative to the manifest, and the page is written
  // somewhere else, so they are rebased on the way in rather than copied.
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  // The copy number is forwarded rather than dropped, or a page measuring a
  // fourteen-land band would draw one picture per card and say nothing about
  // the band this set actually paints.
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}

const CARDS = cards();
const ART = artFor();
const SPELLS = CARDS.filter((card) => !isLand(card));

/**
 * The five basics the set is played with, printed where the set prints one and
 * minted where it does not.
 *
 * Filtering the card list for lands is what this used to do, and it made the
 * documented invocation above throw: a generated set prints no basics — the
 * flagship's 75 cards contain not one — and `@mtg/deckbuild` mints them at build
 * time, so the filter came back empty and every page died on `manaBase`. The
 * only rig that can draw a real set's art was therefore the only rig that could
 * not be pointed at a real set. `setBasics` is the same answer `band-panel.ts`,
 * `rail-split.ts` and `hand-scale.ts` already give, and it prefers a printed
 * basic over a minted one, so a set that does print them is unaffected.
 */
const LANDS = setBasics(CARDS);

/** One creature, repeated, so nothing in the row varies but the count. */
function subject(): DslCard {
  const card = SPELLS.find((candidate) => candidate.kind === 'creature');
  if (card === undefined) throw new Error('the example set has no creature to crowd the board with');
  return card;
}

/** The mana base, cycling the basics so the band is not one picture repeated. */
function manaBase(lands: number): readonly DslCard[] {
  return Array.from({ length: lands }, (_unused, index) => {
    const card = LANDS[index % LANDS.length];
    if (card === undefined) throw new Error('setBasics returned nothing to build a mana base from');
    return card;
  });
}

/**
 * A position with `count` identical non-land permanents and a mana base under
 * each seat.
 *
 * Built rather than played, which is the regime the bead is about: a driven game
 * reaches six or seven a side and this reaches fourteen.
 */
function crowdedSession(count: number, landCount: number): GameSession {
  const card = subject();
  const spells = Array.from({ length: count * 2 }, (_unused, index) => ({
    card,
    controller: (index % 2) as PlayerId,
    summoningSick: false,
  }));
  // Every other land tapped, because tapped is the one piece of a permanent's
  // state an art tile carries no words for, and a page that never draws it
  // cannot be used to check that it reads.
  const lands = [0, 1].flatMap((controller) =>
    manaBase(landCount).map((land, index) => ({
      card: land,
      controller: controller as PlayerId,
      summoningSick: false,
      tapped: index % 2 === 1,
    })),
  );
  const built = scenario({
    seed: `tools/board-crowding/${String(count)}/${String(landCount)}`,
    battlefield: [...spells, ...lands],
    hands: [SPELLS.slice(0, 5), SPELLS.slice(0, 5)],
    active: 0,
    turn: 4,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    // No choice has been recorded, so nothing has committed and nothing is
    // undoable. `@mtg/kernel`'s `undo.ts` carries what closes a boundary.
    beat: null,
    committed: null,
  };
}

/**
 * What a browser reads off the page, per battlefield slot and summarized.
 *
 * The share is the bead's own measure — the art window's height over the face's
 * height — and the trim is the face's own width over its height against the
 * printed 63:88, because the bead records that the face stops tracking the trim
 * once its width floors and both numbers move together.
 *
 * The spell row is looked up as `.mtg-board__spells` and falls back to the
 * zone body, so one measuring function reads both the band-beside-the-row this
 * replaced and the band-under-it that shipped. Comparing the two is the whole
 * point of the tool, and a measure that only fits the new shape could not.
 */
const MEASURE = `
window.mtgBoardCrowding = function () {
  var seatRow = function (seat) {
    var side = "[data-mtg-mode='play'] .mtg-board__side[data-seat='" + seat + "'] ";
    return document.querySelector(side + '.mtg-board__spells') || document.querySelector(side + '.mtg-zone__body');
  };
  var faces = [];
  var lands = [];
  var slots = document.querySelectorAll(".mtg-slot[data-slot='play']");
  for (var i = 0; i < slots.length; i += 1) {
    var slot = slots[i];
    var inBand = slot.parentElement !== null && slot.parentElement.classList.contains('mtg-lands');
    var card = slot.querySelector('.mtg-card');
    var art = slot.querySelector('.mtg-art');
    if (card === null || art === null) continue;
    var faceBox = card.getBoundingClientRect();
    var artBox = art.getBoundingClientRect();
    if (faceBox.height === 0) continue;
    var typeBar = card.querySelector("[data-region='type']");
    var titleBar = card.querySelector("[data-region='title']");
    (inBand ? lands : faces).push({
      faceW: Math.round(faceBox.width * 10) / 10,
      faceH: Math.round(faceBox.height * 10) / 10,
      windowW: Math.round(artBox.width * 10) / 10,
      windowH: Math.round(artBox.height * 10) / 10,
      share: Math.round((artBox.height / faceBox.height) * 1000) / 10,
      trim: Math.round((faceBox.width / faceBox.height) * 1000) / 1000,
      typeBar: typeBar === null ? 'absent' : getComputedStyle(typeBar).display,
      titleBar: titleBar === null ? 'absent' : getComputedStyle(titleBar).display,
      tapped: slot.getAttribute('data-tapped') === 'true',
      borderPx: getComputedStyle(card).borderTopWidth,
      onScreen:
        faceBox.right <= document.documentElement.clientWidth + 0.5 &&
        faceBox.bottom <= document.documentElement.clientHeight + 0.5,
    });
  }
  var shares = faces.map(function (face) { return face.share; });
  var row = seatRow('you');
  var band = document.querySelector("[data-mtg-mode='play'] .mtg-board__side[data-seat='you'] .mtg-lands");
  var seats = ['opponent', 'you'].map(function (seat) {
    var zone = seatRow(seat);
    if (zone === null) return { seat: seat, missing: true };
    return {
      seat: seat,
      width: Math.round(zone.clientWidth * 10) / 10,
      scrollWidth: Math.round(zone.scrollWidth * 10) / 10,
      scrollsX: zone.scrollWidth > zone.clientWidth + 1,
    };
  });
  var bandLines = null;
  if (band !== null && lands.length > 0) {
    var tops = {};
    var tiles = band.querySelectorAll('.mtg-slot');
    for (var j = 0; j < tiles.length; j += 1) tops[Math.round(tiles[j].getBoundingClientRect().top)] = 1;
    bandLines = Object.keys(tops).length;
  }
  var box = function (node) {
    if (node === null) return null;
    var rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
    };
  };
  var toolbar = document.querySelector("[data-mtg-mode='play'] .mtg-toolbar");
  var phaseBar = document.querySelector("[data-mtg-mode='play'] .mtg-phasebar");
  var badge = document.querySelector("[data-mtg-mode='play'] .mtg-turnstops__head, [data-mtg-mode='play'] .mtg-badge");
  var barNodes = phaseBar === null ? [] : [].slice.call(phaseBar.querySelectorAll('.mtg-phasebar__node'));
  var barLines = null;
  if (barNodes.length > 0) {
    var barTops = {};
    for (var n = 0; n < barNodes.length; n += 1) barTops[Math.round(barNodes[n].getBoundingClientRect().top)] = 1;
    barLines = Object.keys(barTops).length;
  }
  var strip = {
    toolbar: box(toolbar),
    bar: box(phaseBar),
    badge: box(badge),
    nodes: barNodes.length,
    // How many rows the thirteen step nodes occupy, and whether that is more
    // than one. A second row is height off the lane, so the count is what says
    // where the bar spent a shortfall it could not fit sideways.
    //
    // This asked a different question until 2026-08-16 and could no longer get a
    // useful answer: it compared the bar's top against the toolbar badge's, and
    // mtg-rgc.6 moved the bar out of the strip and under the battlefield, so
    // the two tops have differed by construction ever since and the criterion
    // read true at every viewport and every board size. It is measured off the
    // nodes now, the way bandLines above is measured off the tiles, so a bar
    // that fits on one line reports one.
    barLines: barLines,
    wrapped: barLines === null ? null : barLines > 1,
    barScrollsX: phaseBar === null ? null : phaseBar.scrollWidth > phaseBar.clientWidth + 1,
    barOverflowPx: phaseBar === null ? null : Math.round((phaseBar.scrollWidth - phaseBar.clientWidth) * 10) / 10,
    nodesFullyVisible: phaseBar === null ? null : barNodes.filter(function (barNode) {
      var barBox = phaseBar.getBoundingClientRect();
      var nodeBox = barNode.getBoundingClientRect();
      return nodeBox.left >= barBox.left - 0.5 && nodeBox.right <= barBox.right + 0.5;
    }).length,
    shortestNode: barNodes.length === 0 ? null : Math.round(Math.min.apply(null, barNodes.map(function (barNode) {
      return barNode.getBoundingClientRect().height;
    })) * 10) / 10,
  };
  return {
    strip: strip,
    board: box(document.querySelector("[data-mtg-mode='play'] .mtg-board")),
    seats: seats,
    faces: faces.length,
    lands: lands.length,
    worstShare: shares.length === 0 ? null : Math.min.apply(null, shares),
    bestShare: shares.length === 0 ? null : Math.max.apply(null, shares),
    offScreen: faces.concat(lands).filter(function (face) { return !face.onScreen; }).length,
    rowScrollsX: row === null ? null : row.scrollWidth > row.clientWidth + 1,
    rowScrollsY: row === null ? null : row.scrollHeight > row.clientHeight + 1,
    bandScrollsX: band === null ? null : band.scrollWidth > band.clientWidth + 1,
    bandScrollsY: band === null ? null : band.scrollHeight > band.clientHeight + 1,
    bandLines: bandLines,
    bandWidth: band === null ? null : Math.round(band.getBoundingClientRect().width * 10) / 10,
    bandHeight: band === null ? null : Math.round(band.getBoundingClientRect().height * 10) / 10,
    pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 1,
    sample: faces[0] ?? null,
    landSample: lands[0] ?? null,
    tappedLand: lands.filter(function (land) { return land.tapped; })[0] ?? null,
    all: faces,
  };
};
`;

function page(count: number, landCount: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: crowdedSession(count, landCount),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        // The strip a player actually gets. The phase bar and the disclosure are
        // drawn only for a caller that owns the settings (`toolbar.ts`), so a
        // page without these three measured a table nobody sees — and the strip
        // is the one thing above the mat that can take height off it.
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
        ...(ART === null ? {} : { artFor: ART }),
      }),
    }),
  );
  const title = `Board crowding, ${String(count)} spells and ${String(landCount)} lands a side`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of CROWDING_COUNTS) {
  for (const landCount of CROWDING_LANDS) {
    const file = join(out, `crowding-${String(count)}-${String(landCount)}.html`);
    writeFileSync(file, page(count, landCount), 'utf8');
    console.log(`wrote ${file}`);
  }
}
