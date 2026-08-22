/**
 * Does a card face on either board still carry its own name, and does it say so
 * when it cannot?
 *
 * `mtg-6hrz`, `mtg-5f9`, `mtg-9f0e` are one defect from three angles: a board
 * face shrinks until it is not a card, and what it does at the bottom is break a
 * word inside its letter run and then clip it vertically with no mark. This rig
 * is what the claim is measured with, and it measures **both** boards, because
 * the replay is where the defect became visible and the play route is where it
 * lives.
 *
 * Three things it counts, and each of them is a word out of the complaint rather
 * than a proxy for one:
 *
 *  - **Letters cut.** A `Range` over the name's own text node gives one rect per
 *    character; a character whose rect falls outside the name's own box is a
 *    character the player cannot read. `drawnText` is what is left, so a reading
 *    says what the player could read rather than "13 of 15".
 *  - **Words broken inside their letters.** For each whitespace-separated word,
 *    the distinct line-box tops its characters sit on. Two tops is a word split
 *    across lines with no hyphen, which is the thing the playtester read off the
 *    screen: a word that ends five letters in and resumes on the line below,
 *    so both halves read as words the card does not have.
 *  - **Rules lines clipped.** The rules box is `overflow-y: clip`, so
 *    `scrollHeight` is not a reliable statement of what the content wanted; a
 *    `Range` over the box's contents reports the laid-out height whatever the
 *    box then does with it, and dividing by the box's own line height gives
 *    lines wanted against lines shown.
 *
 * Two boards, one measuring function. The play page renders `PlayView` the way
 * `board-crowding.ts` does. The replay page renders `ReplayViewer` over a log
 * this file **writes** — header, game and step records through the real
 * `readEventLog` — because a recorded game reaches whatever permanent count it
 * reaches and the question is asked at a stated count. Everything else on that
 * page is the route's own: `Shell` in `replay` mode, so `styles/replay.ts`'s
 * scope applies and both hands are drawn face up out of the same lane budget.
 *
 * Node-only, like `card-uniformity.ts` and `corner-marks.ts`: it writes files and
 * opens no browser. Drive the pages with chrome-headless-shell over CDP and call
 * `window.mtgFaceFloor()`.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/face-floor.ts out/face-floor \
 *       out/XMP/set.json out/art/xmp-variants/art.json
 *
 * The set is **required**. A rig on this project defaulted its set argument and
 * measured the DSL example set for a night while reporting numbers about a
 * flagship board, so a page here has to be able to name the set it drew.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { EVENT_LOG_SCHEMA_VERSION, ReplayViewer, readEventLog } from '../src/routes/replay';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many permanents a side each page draws.
 *
 * The three counts the beads are written in. Four is what a driven game reaches
 * and is where the face is largest; eight is a long game; twelve is the built
 * position `mtg-5f9` measured, and is past what a played game reaches at the two
 * larger viewports and not past it at the smallest.
 */
export const FLOOR_COUNTS: readonly number[] = [4, 8, 12];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'face-floor');
const named = process.argv[3];
if (named === undefined) {
  throw new Error('name the set to deal from: face-floor.ts <out-dir> <set.json> [art.json]');
}
const setPath: string = named;
const artPath = process.argv[4];

const CARDS = ((): readonly DslCard[] => {
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  return parseCards(listed);
})();

/** The manifest's resolver, rebased on the page's own directory, or null. */
function artFor(): ArtResolver | null {
  if (artPath === undefined) return null;
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}

const ART = artFor();

/**
 * The permanents a page deals, longest name first.
 *
 * Longest first is `corner-marks.ts`'s rule and the reason carries: the deal is
 * a function of the set rather than of the order its document lists cards in,
 * and the name most at risk is on every board however few slots it has. Distinct
 * cards rather than one repeated, because the count being asked for is names
 * that do not fit and one name repeated twelve times answers that question about
 * one name.
 */
const PERMANENTS_ALL: readonly DslCard[] = CARDS.filter((card) => card.kind === 'creature' && !isLand(card));

const PERMANENTS = ((): readonly DslCard[] => {
  const listed = PERMANENTS_ALL;
  if (listed.length === 0) throw new Error(`${setPath} has no creatures to stand on a board`);
  return [...listed].sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));
})();

/**
 * The permanents the art manifest actually covers, for the art half of
 * `mtg-6hrz`.
 *
 * A separate deal rather than a filter on the one above, because the two
 * questions want opposite pools. Legibility wants the longest names in the set,
 * which is a fact about the set; art wants the cards a manifest has pictures
 * for, which is a fact about a manifest. Dealing one pool for both would have
 * answered whichever question the intersection happened to be big enough for --
 * and on this set the intersection is empty, so the art reading would have been
 * a row of pending frames reported as "no art" while the wire worked.
 *
 * Sorted by id and dealt round-robin, so a count past the pool size puts a
 * second and third object of the same card on the board and the *copy number*
 * has something to round-robin over. That is the reading that matters: a replay
 * has to paint the board its game painted, and a card with three illustrations
 * is where painting it a second way would show.
 */
const ART_PERMANENTS: readonly DslCard[] =
  ART === null
    ? []
    : [...PERMANENTS_ALL].filter((card) => ART(card, 0) !== null).sort((a, b) => a.id.localeCompare(b.id));

/** The mana base: the set's own basics, which a generated set mints. */
function manaBase(count: number): readonly DslCard[] {
  const basics = setBasics(CARDS);
  return Array.from({ length: count }, (_unused, index) => {
    const land = basics[index % basics.length];
    if (land === undefined) throw new Error('setBasics returned nothing to build a mana base from');
    return land;
  });
}

function dealt(count: number, pool: readonly DslCard[] = PERMANENTS): readonly DslCard[] {
  return Array.from({ length: count }, (_unused, index) => {
    const card = pool[index % pool.length];
    if (card === undefined) throw new Error('no permanent to deal');
    return card;
  });
}

/** A played position with `count` distinct permanents and seven lands a side. */
function dealtSession(count: number, blocking: boolean, pool?: readonly DslCard[]): GameSession {
  const spells = dealt(count, pool);
  const built = scenario({
    seed: `tools/face-floor/${String(count)}`,
    battlefield: [
      ...[0, 1].flatMap((controller) =>
        spells.map((card) => ({
          card,
          controller: controller as PlayerId,
          summoningSick: false,
          blocking: controller === 1 && blocking,
          attacking: controller === 0 && blocking,
        })),
      ),
      ...[0, 1].flatMap((controller) =>
        manaBase(7).map((card, index) => ({
          card,
          controller: controller as PlayerId,
          summoningSick: false,
          tapped: index % 2 === 1,
        })),
      ),
    ],
    hands: [spells.slice(0, 7), spells.slice(0, 7)],
    active: 0,
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
 * A one-frame event log holding the same position, written in the log's own
 * JSONL and read back through the real `readEventLog`.
 *
 * Written rather than recorded, for the reason the counts above are stated: a
 * recorded game reaches whatever board it reaches, and this rig has to ask the
 * same question of the same board on both routes. Everything the reader
 * validates is validated here — the schema version, the card table, the object
 * table, the snapshot — so a page that renders is a page the shipped reader
 * accepted.
 */
function replayLogText(count: number, pool?: readonly DslCard[]): string {
  const spells = dealt(count, pool);
  const lands = manaBase(7);
  const cards: Record<string, unknown> = {};
  const objects: Record<string, { card: string; owner: 0 | 1; token: boolean }> = {};
  const battlefield: unknown[] = [];
  const hands: [string[], string[]] = [[], []];
  let next = 0;
  const put = (card: DslCard, owner: 0 | 1): string => {
    cards[card.id] = card;
    next += 1;
    const oid = `o${String(next)}`;
    objects[oid] = { card: card.id, owner, token: false };
    return oid;
  };
  for (const owner of [0, 1] as const) {
    for (const card of spells) {
      battlefield.push({
        oid: put(card, owner),
        controller: owner,
        tapped: false,
        summoningSick: false,
        damage: 0,
        plusCounters: 0,
        minusCounters: 0,
        power: card.kind === 'creature' ? card.power : null,
        toughness: card.kind === 'creature' ? card.toughness : null,
        attachedTo: null,
        attacking: false,
        blocking: false,
      });
    }
    for (const [index, land] of lands.entries()) {
      battlefield.push({
        oid: put(land, owner),
        controller: owner,
        tapped: index % 2 === 1,
        summoningSick: false,
        damage: 0,
        plusCounters: 0,
        minusCounters: 0,
        power: null,
        toughness: null,
        attachedTo: null,
        attacking: false,
        blocking: false,
      });
    }
    for (const card of spells.slice(0, 7)) hands[owner].push(put(card, owner));
  }
  const seat = (owner: 0 | 1): unknown => ({
    life: 20,
    hand: hands[owner],
    library: 27,
    graveyard: [],
    pool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    lost: false,
  });
  return [
    {
      record: 'header',
      schema: EVENT_LOG_SCHEMA_VERSION,
      source: `face-floor/${basename(setPath)}`,
      games: 1,
    },
    {
      record: 'game',
      game: 0,
      seed: `tools/face-floor/${String(count)}`,
      startingPlayer: 0,
      maximumTurns: 20,
      seats: [
        { bot: 'greedy', deck: 'You' },
        { bot: 'greedy', deck: 'Bot' },
      ],
      cards,
      objects,
      steps: 1,
      result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 6 },
    },
    {
      record: 'step',
      game: 0,
      seq: 0,
      turn: 6,
      step: 'precombatMain',
      active: 0,
      decision: null,
      action: null,
      events: [],
      state: { seats: [seat(0), seat(1)], battlefield, exile: [], stack: [] },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join('\n');
}

/**
 * What a browser reads off either page.
 *
 * Every selector here is shared by the two routes on purpose: a board face is a
 * `.mtg-card[data-size='board']` inside a `.mtg-slot[data-slot='play']` whichever
 * route drew it, so one function measures both and a comparison between them is
 * a comparison rather than two rigs agreeing.
 *
 * A character is counted as *drawn* when its own rect lies inside the name's box
 * on both axes, which is the clip the sheet applies. The DOM text is unchanged by
 * a clip or by a line clamp — the browser draws an ellipsis without touching the
 * text node — so the same measure reads a clipped name and an elided one, and
 * `clamped` says which mechanism is in force.
 */
const MEASURE = `
window.mtgFaceFloor = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var inside = function (a, b) {
    var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > a.width * 0.5 && y > a.height * 0.5;
  };
  var charRects = function (element) {
    var node = element.firstChild;
    while (node !== null && node.nodeType !== 3) node = node.firstChild;
    if (node === null) return { text: '', rects: [] };
    var text = node.nodeValue;
    var rects = [];
    for (var i = 0; i < text.length; i += 1) {
      var range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      rects.push(range.getBoundingClientRect());
    }
    return { text: text, rects: rects };
  };
  var contentHeight = function (element) {
    var range = document.createRange();
    range.selectNodeContents(element);
    var boxes = range.getClientRects();
    if (boxes.length === 0) return 0;
    var top = Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < boxes.length; i += 1) {
      if (boxes[i].width === 0 && boxes[i].height === 0) continue;
      top = Math.min(top, boxes[i].top);
      bottom = Math.max(bottom, boxes[i].bottom);
    }
    return bottom < top ? 0 : bottom - top;
  };
  var faces = [];
  var slots = document.querySelectorAll(".mtg-slot[data-slot='play']");
  for (var s = 0; s < slots.length; s += 1) {
    var slot = slots[s];
    if (slot.parentElement !== null && slot.parentElement.classList.contains('mtg-lands')) continue;
    var card = slot.querySelector(".mtg-card[data-size='board']");
    if (card === null) continue;
    var faceBox = card.getBoundingClientRect();
    if (faceBox.height === 0 || faceBox.width === 0) continue;
    var name = card.querySelector('.mtg-card__name');
    if (name === null) continue;
    var nameBox = name.getBoundingClientRect();
    var read = charRects(name);
    // Whitespace is not counted as a letter lost. The space a line breaks at is
    // collapsed away by the line breaker and its rect lands outside the box, so
    // counting it made every wrapped name read as one character short of whole
    // while the player had lost nothing.
    var drawn = '';
    var cut = 0;
    for (var c = 0; c < read.text.length; c += 1) {
      var ch = read.text.charAt(c);
      if (inside(read.rects[c], nameBox)) drawn += ch;
      else if (!/\\s/.test(ch)) cut += 1;
    }
    // A word split across two line boxes with no hyphen. Whitespace characters
    // are not part of any word, so they are skipped rather than joining two.
    var broken = 0;
    var brokenWords = [];
    var wordStart = -1;
    var finishWord = function (start, end) {
      if (start < 0) return;
      var tops = {};
      var visible = false;
      for (var k = start; k < end; k += 1) {
        tops[Math.round(read.rects[k].top)] = 1;
        if (inside(read.rects[k], nameBox)) visible = true;
      }
      if (Object.keys(tops).length > 1 && visible) {
        broken += 1;
        brokenWords.push(read.text.slice(start, end));
      }
    };
    for (var w = 0; w < read.text.length; w += 1) {
      var isSpace = /\\s/.test(read.text.charAt(w));
      if (isSpace) {
        finishWord(wordStart, w);
        wordStart = -1;
      } else if (wordStart < 0) {
        wordStart = w;
      }
    }
    finishWord(wordStart, read.text.length);

    var nameStyle = getComputedStyle(name);
    var nameLine = parseFloat(nameStyle.lineHeight);
    var nameWanted = contentHeight(name);
    var rules = card.querySelector("[data-region='rules']");
    var rulesDrawn = rules !== null && getComputedStyle(rules).display !== 'none';
    var rulesLine = rulesDrawn ? parseFloat(getComputedStyle(rules).lineHeight) : 0;
    var rulesBox = rulesDrawn ? rules.getBoundingClientRect() : null;
    var rulesWanted = rulesDrawn ? contentHeight(rules) : 0;
    var side = slot.closest('.mtg-board__side');
    faces.push({
      seat: side === null ? 'unknown' : side.getAttribute('data-seat'),
      id: card.getAttribute('data-card-id'),
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      name: read.text,
      drawnText: drawn,
      lettersCut: cut,
      wordsBroken: broken,
      brokenWords: brokenWords,
      nameW: round(nameBox.width),
      nameH: round(nameBox.height),
      nameLines: nameLine > 0 ? Math.round(nameWanted / nameLine) : null,
      nameLinesShown: nameLine > 0 ? Math.round(nameBox.height / nameLine) : null,
      clamped: nameStyle.webkitLineClamp !== undefined && nameStyle.webkitLineClamp !== 'none'
        ? nameStyle.webkitLineClamp
        : 'none',
      rules: rulesDrawn,
      rulesLinesShown: rulesDrawn && rulesLine > 0 ? Math.round(rulesBox.height / rulesLine) : null,
      rulesLinesWanted: rulesDrawn && rulesLine > 0 ? Math.round(rulesWanted / rulesLine) : null,
      onScreen:
        faceBox.right <= document.documentElement.clientWidth + 0.5 &&
        faceBox.bottom <= document.documentElement.clientHeight + 0.5 &&
        faceBox.left >= -0.5 && faceBox.top >= -0.5,
      art: (function () {
        var art = card.querySelector('.mtg-art');
        if (art === null) return null;
        var image = art.querySelector('img');
        var artBox = art.getBoundingClientRect();
        return {
          state: art.getAttribute('data-art-state'),
          painted: image !== null,
          href: image === null ? null : image.getAttribute('src').split('/').pop(),
          w: round(artBox.width),
          h: round(artBox.height),
        };
      })(),
    });
  }
  var rowOf = function (seat) {
    var side = ".mtg-board__side[data-seat='" + seat + "'] ";
    return document.querySelector(side + '.mtg-board__spells') || document.querySelector(side + '.mtg-zone__body');
  };
  var summarize = function (row) {
    var cut = row.filter(function (face) { return face.lettersCut > 0; });
    var brokenFaces = row.filter(function (face) { return face.wordsBroken > 0; });
    var withRules = row.filter(function (face) { return face.rules; });
    var clippedRules = withRules.filter(function (face) { return face.rulesLinesWanted > face.rulesLinesShown; });
    return {
      faces: row.length,
      namesCut: cut.length,
      lettersCutTotal: row.reduce(function (sum, face) { return sum + face.lettersCut; }, 0),
      facesWithBrokenWord: brokenFaces.length,
      facesWithRules: withRules.length,
      rulesClipped: clippedRules.length,
      rulesLinesLost: clippedRules.reduce(function (sum, face) {
        return sum + (face.rulesLinesWanted - face.rulesLinesShown);
      }, 0),
      facesPainted: row.filter(function (face) { return face.art !== null && face.art.painted; }).length,
      drawn: row.map(function (face) { return face.id + '#' + (face.art === null || face.art.href === null ? 'pending' : face.art.href); }),
      offScreen: row.filter(function (face) { return !face.onScreen; }).length,
      faceW: row.length === 0 ? null : row[0].faceW,
      examples: cut.slice(0, 4).map(function (face) { return face.name + ' -> "' + face.drawnText + '"'; }),
    };
  };
  var seats = {};
  for (var k = 0; k < faces.length; k += 1) {
    if (seats[faces[k].seat] === undefined) seats[faces[k].seat] = [];
    seats[faces[k].seat].push(faces[k]);
  }
  var perSeat = {};
  for (var seat in seats) if (Object.prototype.hasOwnProperty.call(seats, seat)) perSeat[seat] = summarize(seats[seat]);
  var scrolls = {};
  ['you', 'opponent'].forEach(function (seat) {
    var row = rowOf(seat);
    scrolls[seat] = row === null ? null : {
      width: round(row.clientWidth),
      scrollWidth: round(row.scrollWidth),
      scrollsX: row.scrollWidth > row.clientWidth + 1,
    };
  });
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    board: document.body.getAttribute('data-board'),
    set: document.body.getAttribute('data-set'),
    count: Number(document.body.getAttribute('data-count')),
    seats: perSeat,
    mat: summarize(faces),
    rows: scrolls,
    pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 1,
    all: faces,
  };
};
`;

function shell(mode: 'play' | 'replay', body: ReturnType<typeof h>): string {
  return renderToStaticMarkup(h(Shell, { mode, onSelectMode: () => undefined, children: body }));
}

function playMarkup(count: number, blocking: boolean, pool?: readonly DslCard[]): string {
  return shell(
    'play',
    h(PlayView, {
      session: dealtSession(count, blocking, pool),
      viewer: 0,
      names: ['You', 'Bot'],
      onChoose: () => undefined,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
      ...(ART === null ? {} : { artFor: ART }),
    }),
  );
}

function replayMarkup(count: number, pool?: readonly DslCard[]): string {
  const log = readEventLog(replayLogText(count, pool));
  return shell(
    'replay',
    h(ReplayViewer, {
      state: { status: 'ready', log },
      route: { mode: 'replay', params: { game: '0', seq: '0' } },
      onSetParams: () => undefined,
      ...(ART === null ? {} : { artFor: ART }),
      // ReplayViewer took this prop for the first time in mtg-6hrz. It was
      // passed here before it existed and TypeScript said nothing, because an
      // object spread is not checked for excess properties -- so the rig read
      // "no art on the replay board" as a fact about the manifest for as long
      // as the prop went nowhere. The `href` this rig now reads back is what
      // makes that failure loud instead of quiet.
    }),
  );
}

function page(board: 'play' | 'replay', count: number, blocking: boolean, markup: string): string {
  const title = `${board} face floor, ${String(count)} permanents a side${blocking ? ', blocking' : ''}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body data-board="${board}" data-set="${basename(setPath)}" data-count="${String(count)}" data-blocking="${String(blocking)}">${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of FLOOR_COUNTS) {
  const play = join(out, `play-${String(count)}.html`);
  writeFileSync(play, page('play', count, false, playMarkup(count, false)), 'utf8');
  console.log(`wrote ${play}`);
  const replay = join(out, `replay-${String(count)}.html`);
  writeFileSync(replay, page('replay', count, false, replayMarkup(count)), 'utf8');
  console.log(`wrote ${replay}`);
}
// The blocking board `mtg-9f0e` read `BLK kob 2/2` off: the same play page with
// every permanent in combat, so the marks row is at its widest over the name.
// The art half of mtg-6hrz, on both boards: the manifest's own cards dealt
// twelve a side so several objects of one card sit on the board at once and the
// copy number has to round-robin. A comparison of the two rows' `drawn` lists is
// the whole acceptance criterion -- same cards, same illustrations, same order.
if (ART_PERMANENTS.length > 0) {
  for (const count of [12]) {
    const playArt = join(out, `play-art-${String(count)}.html`);
    writeFileSync(playArt, page('play', count, false, playMarkup(count, false, ART_PERMANENTS)), 'utf8');
    console.log(`wrote ${playArt}`);
    const replayArt = join(out, `replay-art-${String(count)}.html`);
    writeFileSync(replayArt, page('replay', count, false, replayMarkup(count, ART_PERMANENTS)), 'utf8');
    console.log(`wrote ${replayArt}`);
  }
} else {
  console.log(`no art manifest covers ${basename(setPath)}: the art pages are not written`);
}

const blocked = join(out, 'play-blocking-11.html');
writeFileSync(blocked, page('play', 11, true, playMarkup(11, true)), 'utf8');
console.log(`wrote ${blocked}`);
