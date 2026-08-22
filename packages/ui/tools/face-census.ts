/**
 * Every full face of a set, as static HTML a browser can measure.
 *
 * The same arrangement `board-crowding.ts` uses and for the same reason: jsdom
 * lays nothing out, so no vitest test can say how tall a card's art window came
 * out or whether its rules box overflowed. This writes the real `Shell` around
 * the real `CardsRoute` over a real set, and hands the page a measuring function
 * so the driver is a navigate and one `Runtime.evaluate` rather than a script
 * that has to know the class names.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/face-census.ts out/verify \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `face-census.html` and call `window.mtgFaceCensus()`.
 *
 * What it answers, per card: the art window's box, the face's box and its trim
 * ratio, whether the rules box overflows the room it was given, and the size the
 * rules text was actually set at beside the step the face asked for. The last
 * pair is the whole of `mtg-ceq`'s auto-fit: a step published in the markup
 * and a size resolved by the sheet are two different facts, and only the browser
 * holds the second one.
 *
 * The title bar is measured the same way and for the same reason. `nameClientW`
 * is the room the cost run left the name — four values over the flagship set,
 * 196px for a land and 137 for a three-pip cost — and `nameScrollW` is what the
 * name needed, so `nameCut` is a title cut mid-word rather than fitted. Those
 * two numbers are where `../src/card/anatomy.ts`'s `NAME_COLUMN` comes from, and
 * `namesCut` is the list the name ladder has to keep empty.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASIC_LANDS, EXAMPLE_SET, parseCards } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Shell } from '../src/app/Shell';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');
const setPath = process.argv[3];

/**
 * The cards the page draws. A set that fails to parse stops the run.
 *
 * The five basics join the set's own list, because they are faces the lab draws
 * and the set document does not name: `@mtg/deckbuild` mints them at build time,
 * which is the same blind spot the art pipeline's governance check had until `artSurfaces`
 * started walking them. A census that measured only the printed list would say
 * nothing about the face a Swamp draws.
 */
function cards(): readonly DslCard[] {
  if (setPath === undefined) return [...EXAMPLE_SET, ...BASIC_LANDS];
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  return [...parseCards(listed), ...BASIC_LANDS];
}

/**
 * What a browser reads off the page, per face.
 *
 * `scrollHeight > clientHeight` is asked of the rules box directly rather than
 * inferred from a font size, because that is the defect: a box whose text does
 * not fit is a box that scrolls, whatever anybody believes about the ladder.
 *
 * **Read the difference as lines, not as pixels.** `scrollHeight` counts the top
 * padding and not the bottom one, and `overflow: clip` clips at the padding box,
 * so the comparison is exactly "is a glyph sliced" — but the shortfall it prints
 * is the amount past the *clip line*, and the line above that shortfall is
 * already gone. The three faces `mtg-4mw` found read 106 against 99, which is
 * seven pixels and looks like slack; what a reader saw was the bottom half of a
 * sentence cut off, because a line box is 18.85px and only the first 11 of the
 * last one were drawn. A shortfall under one line box still costs a whole line.
 */
const MEASURE = `
window.mtgFaceCensus = function () {
  var round = function (value) { return Math.round(value * 100) / 100; };
  var faces = [];
  var cards = document.querySelectorAll(".mtg-gallery > .mtg-card[data-size='full']");
  for (var i = 0; i < cards.length; i += 1) {
    var card = cards[i];
    var faceBox = card.getBoundingClientRect();
    var art = card.querySelector('.mtg-art');
    var rules = card.querySelector('.mtg-card__text');
    var name = card.querySelector('.mtg-card__name');
    var pip = card.querySelector(".mtg-card__bar .mtg-pip");
    var seal = card.querySelector('.mtg-card__seal');
    var artBox = art === null ? null : art.getBoundingClientRect();
    var nameStyle = name === null ? null : getComputedStyle(name);
    faces.push({
      id: card.getAttribute('data-card-id'),
      rarity: card.getAttribute('data-rarity'),
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      trim: Math.round((faceBox.width / faceBox.height) * 1000) / 1000,
      artW: artBox === null ? null : round(artBox.width),
      artH: artBox === null ? null : round(artBox.height),
      rulesStep: rules === null ? null : rules.getAttribute('data-fit'),
      rulesFontPx: rules === null ? null : round(parseFloat(getComputedStyle(rules).fontSize)),
      rulesClientH: rules === null ? null : rules.clientHeight,
      rulesScrollH: rules === null ? null : rules.scrollHeight,
      rulesOverflowY: rules === null ? null : getComputedStyle(rules).overflowY,
      overflows: rules === null ? false : rules.scrollHeight > rules.clientHeight + 0.5,
      nameChars: name === null ? null : name.textContent.length,
      nameStep: name === null ? null : name.getAttribute('data-fit'),
      nameFontPx: nameStyle === null ? null : round(parseFloat(nameStyle.fontSize)),
      nameLineH: nameStyle === null ? null : round(parseFloat(nameStyle.lineHeight)),
      nameClientW: name === null ? null : name.clientWidth,
      nameScrollW: name === null ? null : name.scrollWidth,
      nameCut: name === null ? false : name.scrollWidth > name.clientWidth + 0.5,
      pipH: pip === null ? null : round(pip.getBoundingClientRect().height),
      pipW: pip === null ? null : round(pip.getBoundingClientRect().width),
      sealFill: seal === null ? null : getComputedStyle(seal.querySelector('path') || seal).fill
    });
  }
  var unique = function (key) {
    var seen = {};
    for (var j = 0; j < faces.length; j += 1) seen[String(faces[j][key])] = (seen[String(faces[j][key])] || 0) + 1;
    return seen;
  };
  return {
    count: faces.length,
    artW: unique('artW'),
    artH: unique('artH'),
    faceH: unique('faceH'),
    trim: unique('trim'),
    steps: unique('rulesStep'),
    fontPx: unique('rulesFontPx'),
    pipH: unique('pipH'),
    nameLineH: unique('nameLineH'),
    nameSteps: unique('nameStep'),
    overflowing: faces.filter(function (face) { return face.overflows; }),
    namesCut: faces.filter(function (face) { return face.nameCut; }),
    faces: faces
  };
};
`;

function page(list: readonly DslCard[]): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: list,
        route: { mode: 'cards', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Face census</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const list = cards();
const file = join(out, 'face-census.html');
writeFileSync(file, page(list), 'utf8');
console.log(`wrote ${file} with ${String(list.length)} cards`);
