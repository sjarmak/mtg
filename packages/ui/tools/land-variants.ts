/**
 * A board of repeated basics, as static HTML a browser can look at and measure.
 *
 * The feature this exists for is browser-only twice over. jsdom lays nothing
 * out, so no vitest test can say whether five Swamps *look* like five different
 * pictures; and jsdom loads no images, so no vitest test can say whether the
 * three files behind them decode at all. This writes the real `PlayView` over a
 * real kernel position with the real staged manifest, so a screenshot of the
 * page is the evidence and `window.mtgLandVariants()` is the same evidence as
 * numbers.
 *
 * The same arrangement as `board-crowding.ts` and `face-census.ts`, and Node-only
 * like both: it writes a file and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/land-variants.ts out/verify \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json \
 *       out/art/tideglass-reach/art.json
 *
 * The set and the manifest are required, unlike `board-crowding.ts`'s, because
 * a page drawn without them would be twenty identical pending frames — which is
 * a picture of the bug rather than of the fix.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many of each basic stand on the table.
 *
 * Five, because three is the most illustrations any basic has and five is the
 * first count at which round-robin has to wrap — a page built at three could
 * pass with a rule that simply handed out variants until it ran out.
 */
export const COPIES = 5;

function required(value: string | undefined): string {
  if (value === undefined) throw new Error('usage: land-variants.ts <outDir> <set.json> <art.json>');
  return value;
}

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');
const setPath = required(process.argv[3]);
const artPath = required(process.argv[4]);

function cards(): readonly DslCard[] {
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

/**
 * The manifest's resolver with hrefs rebased onto `file://`.
 *
 * The page is written to an output directory and the rasters live beside the
 * manifest, so a relative href would resolve against the wrong directory and
 * every tile would draw a broken image — which the art slot turns into the
 * pending frame, i.e. into a page that looks exactly like the bug.
 */
function artFor(): ArtResolver {
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}

const CARDS = cards();
const BASICS = setBasics(CARDS);
const ART = artFor();

/** The basics each seat plays, in the order they are laid out. */
function seatBasics(seat: PlayerId): readonly DslCard[] {
  const half = Math.ceil(BASICS.length / 2);
  const mine = seat === 0 ? BASICS.slice(0, half) : BASICS.slice(half);
  return mine.flatMap((card) => Array.from({ length: COPIES }, () => card));
}

/**
 * A position that is nothing but repeated basics.
 *
 * No creatures and no spells: every tile on the table is a land, so a reader
 * looking at the screenshot is looking at the thing under test and nothing else.
 */
function landSession(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) =>
    seatBasics(controller).map((card) => ({ card, controller, summoningSick: false })),
  );
  const built = scenario({ seed: 'tools/land-variants', battlefield, active: 0, turn: 6 });
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
 * What a browser reads off the page: which file every land tile actually drew.
 *
 * The `src` rather than the alt, because the claim being checked is that the
 * five tiles are five different *files*; and the alt as well, because the
 * accessibility half of the claim is that each one describes its own picture
 * rather than repeating the card's.
 */
const MEASURE = `
window.mtgLandVariants = function () {
  var tiles = document.querySelectorAll('.mtg-lands .mtg-slot');
  var rows = [];
  for (var i = 0; i < tiles.length; i += 1) {
    var img = tiles[i].querySelector('img.mtg-art__image');
    var name = tiles[i].querySelector('.mtg-card__name');
    rows.push({
      name: name === null ? null : name.textContent,
      src: img === null ? null : img.getAttribute('src').split('/').pop(),
      alt: img === null ? null : img.getAttribute('alt'),
      naturalWidth: img === null ? 0 : img.naturalWidth
    });
  }
  var byName = {};
  for (var j = 0; j < rows.length; j += 1) {
    var key = String(rows[j].name);
    byName[key] = byName[key] || { tiles: 0, files: {}, alts: {}, broken: 0 };
    byName[key].tiles += 1;
    byName[key].files[String(rows[j].src)] = 1;
    byName[key].alts[String(rows[j].alt)] = 1;
    if (rows[j].naturalWidth === 0) byName[key].broken += 1;
  }
  var summary = {};
  for (var key2 in byName) {
    summary[key2] = {
      tiles: byName[key2].tiles,
      distinctFiles: Object.keys(byName[key2].files).length,
      distinctAlts: Object.keys(byName[key2].alts).length,
      broken: byName[key2].broken
    };
  }
  return { tiles: rows.length, perLand: summary, rows: rows };
};
`;

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: landSession(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        artFor: ART,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Land art variants</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const file = join(out, 'land-variants.html');
writeFileSync(file, page(), 'utf8');
console.log(`wrote ${file} with ${String(COPIES)} copies of each of ${String(BASICS.length)} basics`);
