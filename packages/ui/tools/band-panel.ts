/**
 * The two bands, as static HTML a browser can measure: does the table say which
 * half is yours, and does it say whose turn it is, at the same time?
 *
 * `mtg-rgc.3` and `mtg-1nc` both land on the ground under the cards, so the only
 * way to know whether either reads is to resolve the colors a browser actually
 * paints and compare them. jsdom resolves `var()` chains but performs no layout
 * and gives every element the same zero-sized box, so nothing in the vitest
 * suite can answer "how much of the screen is this tone" or "what is the
 * measured ratio between the band and the card on it". `test/play/band.test.ts`
 * asks the palette; this asks the page.
 *
 * Two pages, one per turn, because the failure worth catching is a board that
 * looks the same whoever is to move — and its mirror, a board whose ownership
 * tones swap with the turn, which would make the near half unrecognizable every
 * time priority changed. Reading the same six numbers off both pages is what
 * separates the two.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/band-panel.ts out/band-panel \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `band-<seat>-active.html` and call
 * `window.mtgBandPanel()`.
 *
 * What it answers, per page: the resolved background of each seat's band and of
 * the wells inside it, the seam's color and height, the WCAG ratio of each band
 * against the seam and against every card face standing on it, and the rings the
 * active seat and the playable cards are drawn with. The acceptance evidence is
 * that `bands.opponent.background` and `bands.you.background` differ on both
 * pages and differ the same way round, that the active seat's is lighter than
 * its own value on the other page, and that `worstCardOnBand` clears the
 * `wellBaseline` the same numbers were taken against.
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
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'band-panel');
const setPath = process.argv[3];

/** How many permanents a side each page draws: an ordinary mid-game board. */
const PERMANENTS_A_SIDE = 5;

/**
 * The cards the page is dealt from. A named set when one is given, the DSL
 * example set otherwise; a set that fails to parse stops the run rather than
 * falling back, because a silent fallback would report a clean board that
 * nobody's set produced.
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

const CARDS = cards();

/**
 * The permanents a page deals, spread over as many color identities as the set
 * has.
 *
 * Spread rather than sorted, and that is the whole point of this page: a card's
 * outermost surface is its identity border, so a board of one color measures one
 * ratio against the band and says nothing about the six it did not draw. The
 * white face is the one that matters most on paper, since `--mtg-color-w` is the
 * identity the well used to sit on top of.
 */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0) {
    throw new Error(`${setPath ?? 'the example set'} has no permanents to stand on a board`);
  }
  const byIdentity = new Map<string, DslCard[]>();
  for (const card of [...listed].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = [...card.colors].sort().join('') || 'c';
    const bucket = byIdentity.get(key) ?? [];
    bucket.push(card);
    byIdentity.set(key, bucket);
  }
  // One from each identity first, then a second from each, so a small set still
  // fills the row and a large one still shows every color before it repeats.
  const spread: DslCard[] = [];
  for (let round = 0; spread.length < PERMANENTS_A_SIDE && round < 8; round += 1) {
    for (const bucket of byIdentity.values()) {
      const card = bucket[round];
      if (card !== undefined && spread.length < PERMANENTS_A_SIDE) spread.push(card);
    }
  }
  return spread;
}

const PERMANENTS = permanents();

/** The mana base: the set's own basics, which are minted rather than printed. */
function manaBase(count: number): readonly DslCard[] {
  const basics = setBasics(CARDS);
  return Array.from({ length: count }, (_unused, index) => {
    const land = basics[index % basics.length];
    if (land === undefined) throw new Error('setBasics returned nothing to build a mana base from');
    return land;
  });
}

/** A mid-game position with `active` to move and both boards populated. */
function dealtSession(active: PlayerId): GameSession {
  const spells = [0, 1].flatMap((controller) =>
    PERMANENTS.map((card) => ({ card, controller: controller as PlayerId, summoningSick: false })),
  );
  const lands = [0, 1].flatMap((controller) =>
    manaBase(6).map((card, index) => ({
      card,
      controller: controller as PlayerId,
      summoningSick: false,
      tapped: index % 3 === 2,
    })),
  );
  const built = scenario({
    seed: `tools/band-panel/${String(active)}`,
    battlefield: [...spells, ...lands],
    hands: [PERMANENTS.slice(0, 5), PERMANENTS.slice(0, 5)],
    active,
    turn: 6,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    beat: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    committed: null,
  };
}

/**
 * What a browser reads off the page.
 *
 * Colors are taken resolved rather than as the tokens that produced them: the
 * question is what a person is looking at, and a `var()` chain that lands on the
 * wrong value resolves silently. WCAG contrast is computed here from those
 * resolved colors for the same reason — a ratio derived from the sheet would be
 * a ratio about the sheet.
 *
 * They are resolved *through a canvas* rather than parsed out of the computed
 * string, and that is not fussiness: this palette is written in OKLCH and a
 * browser now hands `getComputedStyle` the color back in the space it was
 * written in, so a regex expecting `rgb(...)` reads `null` off every surface on
 * the page and reports a clean run with nothing measured. Painting one pixel and
 * reading it back asks the compositor what it actually put on the screen, which
 * is the only answer this file wants, and it covers a gamut clip as well — a
 * color outside sRGB does not fail, it clips, and what lands is paler than the
 * sheet asked for.
 *
 * A card's ratio against its band is measured against the card's *border*, not
 * its interior, because the border is the identity color and the outermost thing
 * a player sees against the ground.
 */
const MEASURE = `
window.mtgBandPanel = function () {
  var round = function (value) { return Math.round(value * 100) / 100; };
  var canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  var ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'copy';
  var parse = function (color) {
    if (color === '' || color === 'transparent' || color === 'none') return null;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    var data = ctx.getImageData(0, 0, 1, 1).data;
    if (data[3] === 0) return null;
    return [data[0], data[1], data[2]];
  };
  var luminance = function (rgb) {
    var channel = function (value) {
      var v = value / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  var ratio = function (a, b) {
    if (a === null || b === null) return null;
    var la = luminance(a), lb = luminance(b);
    return round((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
  };
  var bg = function (element) { return parse(getComputedStyle(element).backgroundColor); };
  var hex = function (rgb) {
    if (rgb === null) return null;
    return '#' + rgb.map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join('');
  };

  var divider = document.querySelector('.mtg-board__divider');
  var dividerBox = divider === null ? null : divider.getBoundingClientRect();
  var seam = divider === null ? null : bg(divider);

  var bands = {};
  var sides = document.querySelectorAll('.mtg-board__side');
  for (var i = 0; i < sides.length; i += 1) {
    var side = sides[i];
    var seat = side.getAttribute('data-seat');
    var band = bg(side);
    var box = side.getBoundingClientRect();
    var wells = [];
    var zones = side.querySelectorAll('.mtg-zone');
    for (var z = 0; z < zones.length; z += 1) {
      wells.push({
        tone: zones[z].getAttribute('data-tone'),
        label: zones[z].getAttribute('aria-label'),
        background: hex(bg(zones[z])),
        borderColor: hex(parse(getComputedStyle(zones[z]).borderTopColor))
      });
    }
    var faces = [];
    var cards = side.querySelectorAll('.mtg-zone:not([data-tone="rail"]) .mtg-card');
    for (var c = 0; c < cards.length; c += 1) {
      var style = getComputedStyle(cards[c]);
      var border = parse(style.borderTopColor);
      faces.push({
        id: cards[c].getAttribute('data-card-id'),
        identity: cards[c].getAttribute('data-identity'),
        border: hex(border),
        vsBand: ratio(band, border)
      });
    }
    var worst = null;
    for (var f = 0; f < faces.length; f += 1) {
      if (faces[f].vsBand !== null && (worst === null || faces[f].vsBand < worst)) worst = faces[f].vsBand;
    }
    bands[seat] = {
      active: side.getAttribute('data-active'),
      background: hex(band),
      rgb: band,
      ring: getComputedStyle(side).boxShadow,
      box: { width: round(box.width), height: round(box.height) },
      wells: wells,
      worstCardOnBand: worst,
      vsSeam: ratio(band, seam),
      faces: faces
    };
  }

  var playable = [];
  var lit = document.querySelectorAll('.mtg-slot > .mtg-card[data-interactive="true"]');
  for (var p = 0; p < lit.length; p += 1) {
    var host = lit[p].closest('.mtg-zone');
    var side2 = lit[p].closest('.mtg-board__side');
    playable.push({
      seat: side2 === null ? null : side2.getAttribute('data-seat'),
      zone: host === null ? null : host.getAttribute('aria-label'),
      ground: host === null ? null : hex(bg(host)),
      ring: getComputedStyle(lit[p]).boxShadow,
      filter: getComputedStyle(lit[p]).filter
    });
  }

  // What the wells were before the bands, resolved the same way everything else
  // on this page is, so "no worse than the well" is a comparison between two
  // measurements rather than between a measurement and a remembered number.
  var wellBaseline = null;
  var board = document.querySelector('.mtg-board');
  if (board !== null) {
    var probe = document.createElement('div');
    probe.style.background = 'var(--mtg-mat-well)';
    board.appendChild(probe);
    var wellRgb = bg(probe);
    board.removeChild(probe);
    var worstOnWell = null;
    var every = document.querySelectorAll('.mtg-board__side .mtg-card');
    for (var w = 0; w < every.length; w += 1) {
      var edge = parse(getComputedStyle(every[w]).borderTopColor);
      var against = ratio(wellRgb, edge);
      if (against !== null && (worstOnWell === null || against < worstOnWell)) worstOnWell = against;
    }
    wellBaseline = { background: hex(wellRgb), worstCardOnWell: worstOnWell };
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    seam: {
      color: hex(seam),
      height: dividerBox === null ? null : round(dividerBox.height),
      width: dividerBox === null ? null : round(dividerBox.width)
    },
    wellBaseline: wellBaseline,
    ownershipRatio: bands.opponent === undefined || bands.you === undefined
      ? null
      : ratio(bands.opponent.rgb, bands.you.rgb),
    bands: bands,
    playable: playable
  };
};
`;

function page(active: PlayerId): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: dealtSession(active),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = `Board banding, ${active === 0 ? 'your' : "the opponent's"} turn`;
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
for (const [active, name] of [
  [0, 'you'],
  [1, 'opponent'],
] as const) {
  const file = join(out, `band-${name}-active.html`);
  writeFileSync(file, page(active), 'utf8');
  console.log(`wrote ${file}`);
}
