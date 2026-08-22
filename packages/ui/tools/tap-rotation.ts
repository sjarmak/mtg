/**
 * A table holding the same card tapped and untapped, as static HTML a browser
 * can measure.
 *
 * `mtg-bz2.2` asks for one thing no vitest test in this checkout can answer:
 * *tapped permanents are drawn rotated*. jsdom performs no layout, so a test
 * there can say the sheet declares `rotate: 90deg` and cannot say whether any
 * card on any board ever turned. The two are different claims — a rule that
 * loses the cascade, a slot that never gets `data-tapped`, or an ancestor that
 * flattens the transform each leave the declaration in the sheet and the card
 * upright. This writes the page a browser answers it on, and
 * `window.mtgTapRotation()` is the same answer as numbers.
 *
 * Both permanent faces are drawn, because they rotate through two different
 * rules and either can regress alone: a creature wears the `board` face
 * (`styles/board/slot.ts`), and a land in the mana band wears the `art` tile,
 * whose own scale is written beside it in `styles/board/lands.ts`.
 *
 * The same arrangement as `board-crowding.ts` and `land-variants.ts`, and
 * Node-only like both: it writes a file and opens no browser.
 *
 * **One page is not enough, because where a tapped card sits in the row changes
 * what its overhang lands on.** A rotated face grows symmetrically about the
 * slot's center, so at the start of a row half of the excess goes into the
 * well's padding and half onto the neighbor to the right; at the end it is the
 * mirror of that; in the middle it covers a card on each side. `mtg-bm1` was
 * measured on an alternating row, where nothing is tapped at position zero. So
 * this writes a second page with the tapped permanents at the first, a middle
 * and the last position, and both are driven at every viewport.
 *
 * ## What it reported, chrome-headless-shell 151.0.7922.47, 2026-08-16
 *
 * Both pages, six a side, after `styles/board/slot.ts` stopped sizing a tapped
 * card off its slot's width alone. Worst of the group, in CSS px:
 *
 *   viewport   upright face   tapped face   tapped slot   oX / oY / clipY
 *   1440x900   124 x 173.2    173.2 x 124   173.2 x 173.2   0 / 0 / 0
 *   1280x800   100 x 139.7    139.7 x 100   139.7 x 139.7   0 / 0 / 0
 *   1024x768   100 x 139.7    139.7 x 100   139.7 x 139.7   0 / 0 / 0
 *   1440x560   52.6 x 73.5    100.5 x 72    100.6 x 73.5    0 / 0 / 0
 *   1440x480   25.2 x 35.2    49.1 x 35.2   100.6 x 35.2    0 / 0 / 0
 *
 * The bottom two rows are the ones worth reading. A slot capped on the block
 * axis is no longer square, and the tapped face is drawn from the height it has
 * rather than the width it used to keep. The two states stop being the same size
 * there, which is the answer a squash deserves rather than a regression - a card
 * lying down fits its 63 into the height an upright one has to fit its 88 into.
 * The before-and-after pair for the same change is in
 * `test/play/table-allocation.browser.test.ts`, on a twelve-a-side table.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/tap-rotation.ts out/verify
 *
 * then navigate a browser to `tap-rotation.html` or
 * `tap-rotation-edges.html` and call `window.mtgTapRotation()`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');

const CREATURE = exampleCard('slc-emberflow-raider');
const LAND = exampleCard('slc-mountain');

/**
 * How many of each go on the table, half of them tapped.
 *
 * Three a side of each kind, because the comparison being measured is between
 * neighbors in one row: an upright face and a rotated one drawn under the same
 * width constraint, so a difference in their boxes is the rotation and not the
 * layout.
 */
const COPIES = 3;

/**
 * Which of the six positions in a row are tapped, per page.
 *
 * `alternating` is the row this rig has always written and the one `mtg-bm1`
 * was measured on: a tapped face always has an upright neighbor, and nothing is
 * tapped at position zero. `edges` puts one at the first position, one in the
 * middle and one at the last, which is the arrangement that says whether the
 * overhang at a row's ends is different from the overhang in its middle.
 */
const PATTERNS: Readonly<Record<string, readonly boolean[]>> = {
  alternating: [false, true, false, true, false, true],
  edges: [true, false, true, false, false, true],
};

function permanents(
  controller: PlayerId,
  pattern: readonly boolean[],
): readonly {
  readonly card: ReturnType<typeof exampleCard>;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
}[] {
  return [CREATURE, LAND].flatMap((card) =>
    Array.from({ length: COPIES * 2 }, (_unused, index) => ({
      card,
      controller,
      tapped: pattern[index] === true,
      summoningSick: false,
    })),
  );
}

function tappedSession(pattern: readonly boolean[]): GameSession {
  const built = scenario({
    seed: 'tools/tap-rotation',
    battlefield: [...permanents(0, pattern), ...permanents(1, pattern)],
    hands: [[CREATURE, LAND], []],
    active: 0,
    turn: 5,
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
    beat: null,
    committed: null,
  };
}

/**
 * What a browser reads off the page, per battlefield slot.
 *
 * The aspect is the claim: an upright face is taller than it is wide (the
 * printed 63:88), and `getBoundingClientRect` reports the box a transform
 * actually produced, so a face that turned reports the reciprocal and a face
 * that did not reports the same number as its upright neighbor. The computed
 * `rotate` is read as well, because the two can disagree in exactly one
 * interesting way — a declaration that resolved on an element nothing draws.
 *
 * The slot's own box comes with it, since the reserve the rotation is paid out
 * of is the other half of the design (`styles/board/slot.ts`): a rotated face
 * that grew its slot would push its neighbors along the row.
 *
 * `insideSlot` is the pass/fail claim and the three overhang numbers are how
 * badly it fails, in CSS px: `overhang` is the furthest any face in the group
 * reaches past its own slot's left or right edge, `overhangY` the same past the
 * top or bottom, and `clipY` how far past the row's own edges it went, which is
 * the part the reader loses because the row scrolls sideways and clips.
 *
 * **The block axis is here because it is the one that broke.** Until 2026-08-16
 * this rig read the inline axis alone, so it reported a clean table at every
 * viewport while a tapped face on a slot the row had squashed hung out of the
 * top of it and had its leading edge cut — the `...dgeland Barracuda` in
 * `references/UI_issues/view_issue3.png`. An instrument that measures one of two
 * axes reports a pass on the axis it does not measure. The viewport is the
 * driver's to pick and half of the same lesson: the squash only happens where
 * `BOARD_FACE_MAX_SHARE` binds, so drive these pages at 1440x560 and 1440x480
 * as well as the three tall ones, or the block axis reads zero for the same
 * reason it always did.
 *
 * A group entirely inside its slots reports zero on all three, and that is still
 * not "nothing paints on a neighbor" — a face inside its slot can be overlapped
 * by the *next* slot's face, which is what `overlappingPairs` counts, split by
 * row because the two rows size a tapped permanent through different rules.
 */
const MEASURE = `
window.mtgTapRotation = function () {
  var rows = [];
  var slots = document.querySelectorAll(".mtg-slot[data-slot='play']");
  for (var i = 0; i < slots.length; i += 1) {
    var slot = slots[i];
    var card = slot.querySelector('.mtg-card');
    if (card === null) continue;
    var faceBox = card.getBoundingClientRect();
    var slotBox = slot.getBoundingClientRect();
    var rowBox = slot.parentElement.getBoundingClientRect();
    if (faceBox.height === 0) continue;
    var style = getComputedStyle(card);
    rows.push({
      name: (slot.querySelector('.mtg-card__name') || { textContent: null }).textContent,
      size: card.getAttribute('data-size'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      faceW: Math.round(faceBox.width * 10) / 10,
      faceH: Math.round(faceBox.height * 10) / 10,
      aspect: Math.round((faceBox.width / faceBox.height) * 1000) / 1000,
      slotW: Math.round(slotBox.width * 10) / 10,
      slotH: Math.round(slotBox.height * 10) / 10,
      overhang: Math.round(Math.max(0, slotBox.left - faceBox.left, faceBox.right - slotBox.right) * 10) / 10,
      overhangY: Math.round(Math.max(0, slotBox.top - faceBox.top, faceBox.bottom - slotBox.bottom) * 10) / 10,
      clipY: Math.round(Math.max(0, rowBox.top - faceBox.top, faceBox.bottom - rowBox.bottom) * 10) / 10,
      rotate: style.rotate,
      scale: style.scale,
      transform: style.transform
    });
  }
  var group = function (size, tapped) {
    var picked = rows.filter(function (row) { return row.size === size && row.tapped === tapped; });
    if (picked.length === 0) return null;
    var worst = 0;
    var worstY = 0;
    var worstClip = 0;
    for (var p = 0; p < picked.length; p += 1) {
      worst = Math.max(worst, picked[p].overhang);
      worstY = Math.max(worstY, picked[p].overhangY);
      worstClip = Math.max(worstClip, picked[p].clipY);
    }
    return {
      count: picked.length,
      aspect: picked[0].aspect,
      faceW: picked[0].faceW,
      faceH: picked[0].faceH,
      slotW: picked[0].slotW,
      slotH: picked[0].slotH,
      rotate: picked[0].rotate,
      widerThanTall: picked.filter(function (row) { return row.faceW > row.faceH; }).length,
      insideSlot: picked.filter(function (row) { return row.overhang <= 0.5 && row.overhangY <= 0.5; }).length,
      overhang: Math.round(worst * 10) / 10,
      overhangY: Math.round(worstY * 10) / 10,
      clipY: Math.round(worstClip * 10) / 10
    };
  };
  var pairs = function (selector) {
    var overlaps = 0;
    var faces = document.querySelectorAll(selector);
    for (var a = 0; a < faces.length; a += 1) {
      for (var b = a + 1; b < faces.length; b += 1) {
        var one = faces[a].getBoundingClientRect();
        var two = faces[b].getBoundingClientRect();
        if (one.width === 0 || two.width === 0) continue;
        if (one.left < two.right - 0.5 && two.left < one.right - 0.5 &&
            one.top < two.bottom - 0.5 && two.top < one.bottom - 0.5) overlaps += 1;
      }
    }
    return overlaps;
  };
  return {
    slots: rows.length,
    board: { upright: group('board', false), tapped: group('board', true) },
    land: { upright: group('art', false), tapped: group('art', true) },
    overlappingPairs: pairs(".mtg-slot[data-slot='play'] .mtg-card"),
    boardPairs: pairs(".mtg-board__spells > .mtg-slot[data-slot='play'] .mtg-card"),
    landPairs: pairs(".mtg-lands > .mtg-slot[data-slot='play'] .mtg-card"),
    all: rows
  };
};
`;

function page(pattern: readonly boolean[]): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: tappedSession(pattern),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tapped permanents, rotated</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const [name, pattern] of Object.entries(PATTERNS)) {
  const file = join(out, name === 'alternating' ? 'tap-rotation.html' : `tap-rotation-${name}.html`);
  writeFileSync(file, page(pattern), 'utf8');
  const tapped = pattern.filter((slot) => slot).length;
  console.log(`wrote ${file} with ${String(tapped)} tapped of ${String(COPIES * 2)} of each face`);
}
