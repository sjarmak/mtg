/**
 * Renderer parity: two card renderers, one face specification.
 *
 * ADR-0002 keeps `@mtg/ui`'s DOM face and this package's printed SVG face
 * separate, on the condition that a change to how a card looks cannot land in
 * one of them and be forgotten in the other. This file is that condition.
 *
 * It renders the *same* DSL card through both and compares what came out. Every
 * property checked below is one both faces are supposed to agree on; anything
 * the medium decides — row heights against a fixed trim, font sizes, button
 * semantics, the compact thumbnail — is deliberately absent, and the ADR says
 * why. A property that drifts fails here rather than in somebody's screenshot.
 *
 * The SVG is parsed with regular expressions, the way `overflow.ts` is, and the
 * DOM face through `renderToStaticMarkup`: the point is to read what each
 * renderer emitted, not to ask it what it thinks it emitted.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Ability, Card as DslCard, CardInput, Rarity } from '@mtg/dsl';
import {
  ABILITY_KINDS,
  BASIC_LANDS,
  EXAMPLE_CARDS,
  RARITIES,
  formatManaCost,
  isArtifact,
  isCastable,
  isCreature,
  isPlaneswalker,
  loyaltyCostText,
  mana,
  parseCard,
  renderAbility,
  renderOracleText,
  renderTypeLine,
} from '@mtg/dsl';
import {
  ART_PENDING_LABEL,
  ART_WINDOW,
  BOARD_SURFACE_TOKEN,
  CARD_REGIONS,
  CARD_TRIM_MM,
  COLOR_IDENTITIES,
  COMPACT_REGIONS,
  Card,
  FACE_REGIONS,
  LOYALTY_BADGE_POINTS,
  LOYALTY_FIT_STEPS,
  LOYALTY_SHIELD_POINTS,
  MAT_TOKEN_CSS,
  NAME_FIT_STEPS,
  PIP_GLYPH_SCALE,
  PIP_GLYPH_UNITS,
  PLANESWALKER_ART_WINDOW,
  RARITY_SEAL_INK,
  RULES_FIT_STEPS,
  SCREEN_SEAL,
  TITLE_PIP_TO_TEXT,
  cardColorIdentity,
  cardColors,
  collectorLine,
  costPips,
  nameFitScale,
  nameFitStep,
  outlineClipPath,
  outlinePoints,
  pipArt,
  rulesFitScale,
  rulesFitStep,
  setSealPath,
  textBoxBlocks,
  uiStyleSheet,
} from '@mtg/ui';
import type { FaceRegion, Outline } from '@mtg/ui';
import {
  CARD_CSS,
  CARD_GEOMETRY,
  TITLE_MAX_SIZE,
  cardGeometry,
  cardStyleSheet,
  renderCardSvg,
  typeBarSeal,
} from '@mtg/card-render';
import type { SealPlacement } from '@mtg/card-render';
import {
  abilityCards,
  activatedCards,
  equipmentCards,
  generatedSet,
  planeswalkerCards,
  triggerCards,
} from './fixtures/cards';

const GENERATED_SET = generatedSet();
const ABILITY_CARDS = [
  ...abilityCards(),
  ...triggerCards(),
  ...activatedCards(),
  ...equipmentCards(),
  ...planeswalkerCards(),
];

/**
 * Every card the repository commits: the DSL's 16 hand-written examples, the
 * five basic lands, and the 90-card `tideglass-reach` set the balance gate
 * simulates. A divergence that shows on one card is caught only if that card is
 * rendered — a length or a type line that trips one face and not the other is
 * exactly what a handful of cards misses — and both renderers are pure
 * functions of a card, so sweeping all of it costs half a second. The examples
 * lead, which is where `everyColorCost` finds its castable base.
 *
 * The ability fixtures join it because nothing the repository commits carries
 * an ability yet, of any of the four kinds: both faces get their rules text from
 * `renderOracleText` (`@mtg/ui`'s `Card.ts` and this package's `regions.ts`),
 * so ability text reaches both with no renderer change — and a claim nothing
 * renders is a claim nothing checks. The fourth kind is the equip ability,
 * whose single record prints two lines, and it is the one shape neither face
 * had ever drawn.
 *
 * The planeswalker fixture joins the same bucket for the same reason: the
 * flagship's `xmp-vessari-hero-of-hours` is the first card in the repository of
 * that kind, and its starting loyalty draws through the corner badge both
 * faces already had for a creature's power/toughness. A claim the badge draws
 * loyalty is a claim nothing checked before one flowed through this sweep.
 */
const ALL_CARDS: readonly DslCard[] = [...EXAMPLE_CARDS, ...BASIC_LANDS, ...GENERATED_SET, ...ABILITY_CARDS];

/**
 * A card whose one rules sentence carries reminder text, which is what a
 * counter with a declared meaning prints (`@mtg/dsl`'s `counterReminderText`)
 * and what no card in either corpus does. One effect and no keywords, so the
 * block under test is the first line of the box and the whole of it.
 */
function glossedRules(): DslCard {
  const base = ALL_CARDS.find((card) => card.kind === 'sorcery' && card.keywords.length === 0);
  if (base === undefined) throw new Error('the parity corpus has no keywordless sorcery');
  return {
    ...base,
    effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } }],
  };
}

/** A card carrying every mana symbol at once: no committed card is one. */
function everyColorCost(): DslCard {
  const base = ALL_CARDS.find(isCastable);
  if (base === undefined) throw new Error('the parity corpus has no castable card');
  return { ...base, manaCost: mana({ generic: 4, W: 1, U: 1, B: 1, R: 1, G: 1 }) };
}

/** The card with the most rules text: the overflow case, whichever one it is. */
function wordiest(): DslCard {
  const [first, ...rest] = ALL_CARDS;
  if (first === undefined) throw new Error('the parity corpus is empty');
  return rest.reduce(
    (worst, card) => (renderOracleText(card).length > renderOracleText(worst).length ? card : worst),
    first,
  );
}

/**
 * The symbol set both faces are rendered with here.
 *
 * Stated rather than left to each face's default, because the two defaults are
 * deliberately different — the web face paints whatever a launcher staged onto
 * its own origin, the printed file names a host outright — and a comparison
 * that let each side pick would be reading that difference rather than the
 * face specification. `symbols.test.ts` is where the sets themselves are
 * checked, across both faces, one set at a time.
 *
 * `original` specifically, and that is a decision rather than a convenience.
 * It is the set a published artifact prints (`tools/render-set.ts --symbols
 * original`), so it is the set in which "the printed sheet draws real pip
 * artwork rather than falling back to text" is a claim worth holding — which is
 * what the `drawn > 0` premise below is for. In a referenced set both faces
 * would correctly draw no outline at all and that premise would be vacuous.
 *
 * Naming a set also fixes the reason these patterns have to be scoped. Each
 * medium prints a *rules-text* symbol its own way — generated content on the
 * web face, a `<text>` on the printed one — so a pattern loose enough to sweep
 * a whole face would feed the cost-line comparisons symbols that are not
 * cost-line pips. `costPipMarkup` and `printedCostMarkup` below cut the face
 * down to the run these assertions are actually about.
 */
const PARITY_SYMBOLS = 'original';

function domFace(card: DslCard): string {
  return renderToStaticMarkup(h(Card, { card, symbols: PARITY_SYMBOLS }));
}

function svgFace(card: DslCard): string {
  return renderCardSvg(card, { embedStyles: false, symbols: PARITY_SYMBOLS }).svg;
}

/** Entity-decoded markup text. React and `svg.ts` escape differently; the words are the same. */
function decode(markup: string): string {
  return markup
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Regions the printed face lays out and the web face does not.
 *
 * The collector bar, and only that. `mtg-ceq` took it off the DOM face and
 * gave its height to the rules box, putting the line in every face's `title`
 * instead; paper has no hover, so the printed face keeps drawing it. ADR-0002
 * §2.2 already has this shape — the multicolor border ramp is print-only for
 * the same kind of reason — and `FACE_REGIONS` is what *both* faces lay out
 * rather than everything either one draws.
 *
 * Written as an addition to the specification's list rather than as a second
 * literal list, so a printed face that dropped a shared region still fails.
 */
const PRINT_ONLY_REGIONS: readonly FaceRegion[] = ['footer'];

/** Region names in the order the document first mentions them. */
function regionOrder(markup: string): readonly string[] {
  const seen: string[] = [];
  for (const match of markup.matchAll(/data-region="([a-zA-Z]+)"/g)) {
    const region = match[1];
    if (region === undefined || seen.includes(region)) continue;
    seen.push(region);
  }
  return seen;
}

/**
 * Only the regions the specification names, so the printed face's P/T badge
 * does not join the list.
 *
 * Filtered against `CARD_REGIONS` — the whole vocabulary — rather than against
 * `FACE_REGIONS`, which is one size's list. Filtering by the list under test is
 * the shape that cannot fail: it would have quietly accepted a compact face
 * that dropped its footer, because `footer` is not in `FACE_REGIONS` any more
 * and so would have been filtered out of the answer before the comparison.
 */
function faceRegionOrder(markup: string): readonly string[] {
  const wanted: readonly string[] = CARD_REGIONS;
  return regionOrder(markup).filter((region) => wanted.includes(region));
}

/**
 * Everything a full face's text box prints, as one newline-joined string.
 *
 * The shared specification (`@mtg/ui`'s `textBoxBlocks`) rather than
 * `renderOracleText`, because the box is the rules text *plus* the reminder text
 * its keywords print *plus* the flavor text when the card has room, and the two
 * strings genuinely differ (`mtg-6mx`). Both faces build from this one function,
 * so comparing each of them against it is still a check against a specification
 * and not a check of one renderer against the other.
 */
function boxText(card: DslCard): string {
  return textBoxBlocks(card)
    .map((block) => block.text)
    .join('\n');
}

/**
 * One ability as the *box* sets it, which for a loyalty ability is not what
 * `renderAbility` returns.
 *
 * `renderAbility` writes the whole record as one string, cost and all
 * (`[+1]: Put a +1/+1 counter…`), because that string is the oracle line and an
 * oracle line names its cost inline. The box does not: `oracleRows` splits the
 * cost off into a badge the face draws to the left of the sentence, so the
 * block text is the sentence alone. Stripping the prefix here keeps the check
 * comparing the words of the ability rather than deleting the ability from the
 * sweep, and the strip is asserted rather than assumed: an ability that stops
 * printing its cost fails here instead of quietly matching.
 */
function printedAbilityText(ability: Ability, cardName: string): string {
  const printed = renderAbility(ability, cardName);
  if (ability.kind !== 'activated' || ability.loyaltyCost === undefined) return printed;
  const prefix = `[${loyaltyCostText(ability.loyaltyCost)}]: `;
  expect(printed, `${cardName} loyalty ability prefix`).toContain(prefix);
  return printed.slice(prefix.length);
}

/** Words, whitespace-normalized, so a line break is not a difference of opinion. */
function words(text: string): readonly string[] {
  const trimmed = decode(text).replace(/\s+/g, ' ').trim();
  return trimmed.length === 0 ? [] : trimmed.split(' ');
}

/**
 * The rules text each renderer actually set, gathered from its own pieces.
 *
 * A line is no longer one piece on either face: a brace token is drawn rather
 * than set, so a line is runs of text with painted symbols between them. Both
 * helpers walk the pieces in document order and put the token back where the
 * face put the symbol, which is the point of both faces carrying the token as
 * `data-symbol` and as the abbreviation's own content — the words on the card
 * are still readable off the markup, and still comparable between the two.
 */
const DOM_RULES_OPEN = '<span class="mtg-card__text" data-region="rules"';

/** The earliest of several markers in a string, or -1 when none is present. */
function firstOf(text: string, markers: readonly string[]): number {
  const found = markers.map((marker) => text.indexOf(marker)).filter((at) => at !== -1);
  return found.length === 0 ? -1 : Math.min(...found);
}

function domRulesWords(markup: string): readonly string[] {
  const at = markup.indexOf(DOM_RULES_OPEN);
  if (at === -1) return [];
  // The opening tag carries `data-fit` after `data-region`, so the box starts
  // at the tag's own close rather than a fixed number of characters in.
  const rest = markup.slice(markup.indexOf('>', at) + 1);
  // The rules box is the last region of a full face, and the two things that
  // can follow it are the abbreviated faces' footer and the full face's
  // out-of-flow P/T badge. Either ends the box; neither is rules text.
  const foot = firstOf(rest, ['<span class="mtg-card__foot"', '<span class="mtg-card__stats"']);
  // Split at the line spans, then every tag dropped: what is left is the set
  // text and the abbreviations' own token text, in the order they were written
  // and nothing else, because nothing painted on a symbol is a text node
  // (`@mtg/ui`'s `SymbolText.ts`). Split first because a line break stands
  // where a space did, exactly as it does on the printed sheet.
  const box = foot === -1 ? rest : rest.slice(0, foot);
  // The loyalty cost badge is dropped rather than read, and so is the printed
  // face's (its run carries no `data-line`, so `SVG_RULES_PIECE` never sees
  // it). A `+1` is not a word of the sentence it sits beside: leaving it in
  // would compare `+1Put a +1/+1 counter…` against the block text, which is the
  // sentence alone, and the two faces would agree only by both being wrong. The
  // costs get their own comparison below, read structurally off both faces.
  const set = box.replace(/<span class="mtg-card__loyalty">[\s\S]*?<\/span>/g, ' ');
  return words(set.replace(/<span class="mtg-card__line/g, ' $&').replace(/<[^>]*>/g, ''));
}

const SVG_RULES_PIECE =
  /<text[^>]*\bdata-region="rules"[^>]*\bdata-line="(\d+)"[^>]*>([\s\S]*?)<\/text>|<g class="sym"[^>]*\bdata-line="(\d+)"[^>]*\bdata-symbol="([^"]*)"[^>]*>/g;

function svgRulesWords(markup: string): readonly string[] {
  // Pieces of one line join with nothing — the spaces between words are inside
  // the text runs, which is why those are emitted whole — and the lines join
  // with a space, because a wrapped break stands where a space did.
  const lines = new Map<string, string>();
  const order: string[] = [];
  for (const piece of markup.matchAll(SVG_RULES_PIECE)) {
    const line = piece[1] ?? piece[3] ?? '';
    const text = piece[2] ?? piece[4] ?? '';
    if (!lines.has(line)) order.push(line);
    lines.set(line, `${lines.get(line) ?? ''}${text}`);
  }
  return words(order.map((line) => lines.get(line) ?? '').join(' '));
}

/** One run of set text in the printed rules box, as the file declares it. */
interface PrintedRun {
  readonly className: string;
  readonly x: number;
  readonly y: number;
  /** The width the run was committed to, which is where the next one starts. */
  readonly width: number;
  readonly line: string;
  readonly text: string;
}

const PRINTED_RUN =
  /<text class="(rules-text[^"]*)" x="([-\d.]+)" y="([-\d.]+)"[^>]*textLength="([\d.]+)"[^>]*data-line="(\d+)"[^>]*>([\s\S]*?)<\/text>/g;

function printedRulesRuns(markup: string): readonly PrintedRun[] {
  return [...markup.matchAll(PRINTED_RUN)].map((match) => ({
    className: match[1] ?? '',
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    line: match[5] ?? '',
    text: match[6] ?? '',
  }));
}

/** The `data-pip` run, in document order. */
function pipRun(markup: string): readonly string[] {
  return [...markup.matchAll(/data-pip="([a-z]+)"/g)].map((match) => match[1] ?? '');
}

/**
 * Where each renderer mounts a drawn mana symbol. The outlines themselves must
 * be identical: both faces mount the same authoring square, so unlike the seal
 * there is no per-medium box to allow for, and the two path lists compare
 * directly.
 */
const DOM_GLYPH = /class="mtg-pip__glyph-(?:fill|line)" d="([^"]+)"/g;
const SVG_GLYPH = /class="pip-glyph(?:-line)?" d="([^"]+)"/g;

/**
 * The cost run of a web face, as the markup inside its pips.
 *
 * Scoped because a *drawn* rules-text symbol mounts the same outline classes
 * the cost pips do — one registry, one drawing, which is the point — so a
 * pattern run over the whole face would compare a cost line against a cost line
 * plus a rules box. `.mtg-pip` is the cost line's alone; a symbol in the rules
 * box is `.mtg-symbol`.
 */
function costPipMarkup(markup: string): string {
  return [...markup.matchAll(/<span class="mtg-pip"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => match[1] ?? '')
    .join('');
}

/**
 * The same run on the printed face: everything before its rules box.
 *
 * The printed pip and the printed rules symbol both emit `pip-glyph` and
 * `pip-digit`, and neither carries a class that separates them, so the cut is
 * positional — the face emits its regions in `FACE_REGIONS` order and the title
 * bar precedes the rules box. The callers assert the slice still holds a cost,
 * so a reordering fails here rather than quietly comparing nothing.
 */
function printedCostMarkup(markup: string): string {
  return markup.split('data-region="rules"')[0] ?? '';
}

function glyphPaths(markup: string, pattern: RegExp): readonly string[] {
  return [...markup.matchAll(pattern)].map((match) => match[1] ?? '');
}

/** The numeral each face prints in a generic pip, in document order. */
const DOM_NUMERAL = /<span class="mtg-pip" data-pip="generic"[^>]*>(\d+)<\/span>/g;
const SVG_NUMERAL = /<text class="pip-digit"[^>]*>(\d+)<\/text>/g;

function pipNumerals(markup: string, pattern: RegExp): readonly string[] {
  return [...markup.matchAll(pattern)].map((match) => match[1] ?? '');
}

function sealPath(markup: string, pattern: RegExp): string {
  const match = pattern.exec(markup);
  const found = match === null ? null : (match[1] ?? null);
  if (found === null) throw new Error('parity: no rarity seal in the rendered face');
  return decode(found);
}

/**
 * A seal outline in units of its own box: every coordinate re-expressed as a
 * multiple of the radius, measured from the center it was drawn around.
 *
 * The assertions below it re-derive each face's path from the shared function,
 * which catches a renderer that switched to a shape of its own but says nothing
 * if the shared function is itself asked two different questions by the two
 * faces. This asks the question off the rendered markup alone: strip the
 * placement each medium chose and what is left has to be the same drawing. A
 * mark registry only one face read fails here without either face being asked
 * what it thinks it drew.
 */
function unitSeal(path: string, placement: SealPlacement): readonly (string | number)[] {
  let axis: 'x' | 'y' = 'x';
  return path
    .split(' ')
    .filter((token) => token !== '')
    .map((token) => {
      const value = Number(token);
      if (!Number.isFinite(value)) {
        axis = 'x';
        return token;
      }
      const centered = axis === 'x' ? value - placement.cx : value - placement.cy;
      axis = axis === 'x' ? 'y' : 'x';
      return centered / placement.radius;
    });
}

/** Where each renderer mounts the seal. The outline itself must be identical. */
const DOM_SEAL = /class="mtg-card__seal"[\s\S]*?<path d="([^"]+)"/;
const SVG_SEAL = /<path class="seal"[^>]*\bd="([^"]+)"/;

/**
 * Where each renderer puts its seal, asked of the renderer rather than copied
 * out of it: the placement is each medium's business, the outline is not.
 *
 * Asked per card rather than once, because the type bar is no longer at one
 * height for every card: a planeswalker's bar sits where the shorter art window
 * left it, and the seal rides the bar. A single constant here would have
 * compared a walker's seal against the ordinary bar's y and failed on a
 * placement that is correct.
 */
function printedSeal(card: DslCard): SealPlacement {
  return typeBarSeal(cardGeometry(card).type);
}

/**
 * A planeswalker fixture by id. By id rather than by position, because the
 * fixtures are a list a later card can be appended to, and a test that means
 * "the one with an uncosted row" should say so rather than say "the second".
 */
function onlyWalker(id: string): DslCard {
  const found = ALL_CARDS.find((card) => card.id === id);
  if (found === undefined) throw new Error(`parity: no planeswalker fixture ${id}`);
  return found;
}

/** The costs each face published, in the order the rows are set. */
function domRowCosts(markup: string): readonly string[] {
  return [...markup.matchAll(/<span class="mtg-card__line"[^>]*\bdata-loyalty="([^"]*)"/g)].map((match) =>
    decode(match[1] ?? ''),
  );
}

function domBadgeCosts(markup: string): readonly string[] {
  return [...markup.matchAll(/<span class="mtg-card__loyalty">([\s\S]*?)<\/span>/g)].map((match) =>
    decode(match[1] ?? ''),
  );
}

function svgBadgeCosts(markup: string): readonly string[] {
  return [...markup.matchAll(/<text class="loyalty-cost"[^>]*\bdata-loyalty="([^"]*)"/g)].map((match) =>
    decode(match[1] ?? ''),
  );
}

function domShield(markup: string): string {
  return decode(/<span class="mtg-card__shield">([\s\S]*?)<\/span>/.exec(markup)?.[1] ?? '');
}

function svgShield(markup: string): string {
  return decode(/<text class="loyalty-ink"[^>]*>([\s\S]*?)<\/text>/.exec(markup)?.[1] ?? '');
}

/** The left edge of the printed rules box, off the region group's own record. */
function rulesBoxX(markup: string): number {
  const found = /<g class="region" data-region="rules"[^>]*\bdata-box-x="([-\d.]+)"/.exec(markup);
  if (found === null) throw new Error('parity: the printed face declares no rules box');
  return Number(found[1]);
}

/** Coordinates rounded to the grid `outlinePoints` and `outlineClipPath` write on. */
function rounded(outline: Outline): Outline {
  return outline.map(([x, y]) => [round3(x), round3(y)] as const);
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * A drawn outline mapped back onto the unit square it was authored on.
 *
 * The printed face writes user units and the sheet writes percentages of an
 * element, so the two are never the same numbers even when they are the same
 * shape. Normalizing by each drawing's own extent compares what a reader sees:
 * a silhouette. It is only meaningful for an outline that touches all four
 * sides of its box, which both of these do by construction.
 */
function unitOutline(points: string): Outline {
  const pairs = points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .map(([x, y]) => [x ?? Number.NaN, y ?? Number.NaN] as const);
  return normalize(pairs);
}

/** The same, read out of a `clip-path: polygon(…)` declaration in a stylesheet. */
function clipUnitOutline(sheet: string, selector: string): Outline {
  const at = sheet.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`parity: no rule for ${selector}`);
  const found = /clip-path: polygon\(([^)]*)\)/.exec(sheet.slice(at, sheet.indexOf('}', at)));
  if (found === null) throw new Error(`parity: no clip-path on ${selector}`);
  const pairs = (found[1] ?? '')
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(parseFloat))
    .map(([x, y]) => [x ?? Number.NaN, y ?? Number.NaN] as const);
  return normalize(pairs);
}

function normalize(pairs: readonly (readonly [number, number])[]): Outline {
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width === 0 || height === 0) throw new Error('parity: an outline with no extent');
  return pairs.map(
    ([x, y]) => [round3((x - Math.min(...xs)) / width), round3((y - Math.min(...ys)) / height)] as const,
  );
}

/** The page size the printed face declares on its root element. */
function printedTrim(markup: string): readonly [string, string] {
  const width = /<svg[^>]*\swidth="([^"]+)"/.exec(markup)?.[1];
  const height = /<svg[^>]*\sheight="([^"]+)"/.exec(markup)?.[1];
  if (width === undefined || height === undefined) {
    throw new Error('parity: the printed face declares no trim');
  }
  return [width, height];
}

describe('the two renderers draw the same face', () => {
  it('sweeps every card the repository commits, not a handful', () => {
    // The corpus is asserted rather than assumed, because narrowing it is how
    // every check below turns green without anything being fixed. 111 is 16 DSL
    // examples + 5 basic lands + the 90-card `tideglass-reach` fixture.
    const swept = new Set(ALL_CARDS.map((card) => card.id));
    for (const card of GENERATED_SET) {
      expect(swept.has(card.id), `${card.id} is outside the parity sweep`).toBe(true);
    }
    expect(ALL_CARDS.length).toBeGreaterThanOrEqual(111);
  });

  it('lays out the same regions in the same order, and the printed one more', () => {
    for (const card of ALL_CARDS) {
      expect(faceRegionOrder(domFace(card)), `${card.id} DOM`).toEqual([...FACE_REGIONS]);
      expect(faceRegionOrder(svgFace(card)), `${card.id} SVG`).toEqual([
        ...FACE_REGIONS,
        ...PRINT_ONLY_REGIONS,
      ]);
    }
  });

  it('drops exactly the specified regions in the compact face', () => {
    let footed = 0;
    for (const card of ALL_CARDS) {
      const compact = renderToStaticMarkup(h(Card, { card, size: 'compact' }));
      // The footer is the corner badge's home and nothing else's now that the
      // collector line has left every face, so a compact face lays one out
      // exactly when the card carries a badge (power/toughness on a creature,
      // starting loyalty on a planeswalker) and gives that height back when it
      // carries neither.
      const expected = COMPACT_REGIONS.filter(
        (region) => region !== 'footer' || isCreature(card) || isPlaneswalker(card),
      );
      expect(faceRegionOrder(compact), `${card.id} compact regions`).toEqual([...expected]);
      if (isCreature(card)) footed += 1;
    }
    expect(footed, 'creatures in the corpus').toBeGreaterThan(0);
  });

  it('prints the same words on every card in the corpus', () => {
    for (const card of ALL_CARDS) {
      const dom = decode(domFace(card));
      const svg = decode(svgFace(card));
      const printed = [card.name, renderTypeLine(card), collectorLine(card)];
      if (isCreature(card)) printed.push(`${String(card.power)}/${String(card.toughness)}`);
      if (isPlaneswalker(card)) printed.push(String(card.startingLoyalty));
      for (const word of printed) {
        expect(dom, `${card.id} DOM is missing "${word}"`).toContain(word);
        expect(svg, `${card.id} SVG is missing "${word}"`).toContain(word);
      }
    }
  });

  it('sets the same rules text, however each medium breaks the lines', () => {
    // Where a line breaks is the medium's business: the printed face wraps
    // against a measured box, the DOM face lets the browser wrap. Which words
    // are on the card is not the medium's business, and that is what is compared.
    //
    // The expectation is `textBoxBlocks` rather than `renderOracleText`, and the
    // two are different strings on purpose (`mtg-6mx`): the box holds the rules
    // text, the reminder text a keyword prints and the flavor text when there is
    // room, and the oracle string is only the first of those. `@mtg/ui`'s
    // `text-box.ts` is the one composition both renderers build from, so this
    // still compares each face against a shared specification rather than
    // against the other face.
    for (const card of ALL_CARDS) {
      const expected = words(boxText(card));
      expect(domRulesWords(domFace(card)), `${card.id} DOM rules text`).toEqual(expected);
      expect(svgRulesWords(svgFace(card)), `${card.id} SVG rules text`).toEqual(expected);
    }
  });

  /**
   * How a reminder line is *set*, which is a face-specification property and so
   * belongs here rather than in either renderer's own suite.
   *
   * `mtg-vsv`. A printed card sets the keyword in the roman rules face and only
   * the parenthetical in italics, because the keyword is rules text and the
   * parenthetical is a gloss on it; both faces used to set the whole line
   * italic. The two mediums do it with different machinery — the web face nests
   * a span the sheet takes the italics off, the printed face lays two runs on
   * one baseline — and what they must agree on is which words are upright.
   *
   * The printed pair is checked as a pair rather than as a class on a run,
   * because the run that matters is the one *after* it: two runs meeting at the
   * width the first was committed to is the whole of how a mixed line stays a
   * line, and a gloss that started anywhere else would be a second baseline
   * wearing the same `data-line`.
   */
  it('sets a reminder keyword roman and only its gloss italic, in both faces', () => {
    let checked = 0;
    for (const card of ALL_CARDS) {
      for (const block of textBoxBlocks(card)) {
        const keyword = block.roman;
        if (block.kind !== 'reminder' || keyword === undefined) continue;
        expect(domFace(card), `${card.id} DOM keyword`).toContain(
          `data-block="reminder"><span class="mtg-card__reminder-keyword">${keyword} </span>(`,
        );
        // The keyword carries the space that follows it, the rule `symbols.ts`
        // already applies to the space before a drawn symbol.
        const printed = `${keyword} `;
        const runs = printedRulesRuns(svgFace(card));
        const at = runs.findIndex((run, index) => run.text === printed && runs[index + 1]?.line === run.line);
        expect(at, `${card.id} printed keyword run`).toBeGreaterThanOrEqual(0);
        const head = runs[at];
        const gloss = runs[at + 1];
        if (head === undefined || gloss === undefined) throw new Error('parity: no printed reminder pair');
        expect(head.className, `${card.id} printed keyword face`).toBe('rules-text ink');
        expect(gloss.className, `${card.id} printed gloss face`).toBe('rules-text ink italic');
        expect(gloss.y, `${card.id} printed gloss baseline`).toBe(head.y);
        expect(gloss.x, `${card.id} printed gloss origin`).toBeCloseTo(head.x + head.width, 6);
        expect(decode(gloss.text).startsWith('('), `${card.id} printed gloss opens the parenthesis`).toBe(
          true,
        );
        checked += 1;
      }
    }
    // Two faces that print no reminder at all agree about nothing.
    expect(checked, 'reminder lines in the corpus').toBeGreaterThan(0);
    expect(uiStyleSheet()).toContain('.mtg-card__reminder-keyword { font-style: normal; }');
  });

  /**
   * The same boundary inside a line of rules text, which is where the flagship
   * meets it: a counter prints the gloss on what it does in the sentence that
   * puts one on, so the block is roman to the parenthesis and italic after it.
   * No committed card carries such a sentence, which is why the subject is
   * built here the way `everyColorCost` builds its own — a shape both faces can
   * draw and neither corpus contains.
   *
   * Checked as the same pair the reminder line is checked as, and for the same
   * reason: what the two mediums must agree on is which words are upright, and
   * the printed face says it by laying two runs on one baseline.
   */
  it('sets the gloss a rules sentence carries italic, in both faces', () => {
    const card = glossedRules();
    const [block] = textBoxBlocks(card);
    if (block === undefined) throw new Error('parity: the glossed card prints no block');
    const sentence = block.roman;
    if (sentence === undefined) throw new Error('parity: the glossed line declares no boundary');
    expect(block.kind).toBe('rules');
    expect(domFace(card), 'DOM gloss').toContain(
      `data-block="rules">${sentence}<span class="mtg-card__gloss">(`,
    );
    // A sentence is long enough to wrap, so the boundary is found by the run
    // that opens the parenthesis rather than by the whole sentence: the roman
    // run it meets is the tail of the sentence on that line, not all of it.
    const runs = printedRulesRuns(svgFace(card));
    const at = runs.findIndex((run) => decode(run.text).startsWith('('));
    expect(at, 'printed gloss run').toBeGreaterThan(0);
    const head = runs[at - 1];
    const gloss = runs[at];
    if (head === undefined || gloss === undefined) throw new Error('parity: no printed gloss pair');
    expect(head.line, 'printed gloss opens on the line the sentence ends').toBe(gloss.line);
    expect(head.className, 'printed sentence face').toBe('rules-text ink');
    expect(gloss.className, 'printed gloss face').toBe('rules-text ink italic');
    expect(gloss.y, 'printed gloss baseline').toBe(head.y);
    expect(gloss.x, 'printed gloss origin').toBeCloseTo(head.x + head.width, 6);
    expect(sentence.endsWith(decode(head.text)), 'the roman run is the sentence').toBe(true);
    // What the wrap does to it, which is the case a renderer reading the split
    // rather than the block gets wrong: a line the gloss carries onto has no
    // roman run of its own and is italic throughout all the same.
    const wrapped = runs.slice(at + 1);
    expect(wrapped.length, 'the gloss wraps onto another line').toBeGreaterThan(0);
    expect(
      wrapped.every((run) => run.className === 'rules-text ink italic'),
      'every wrapped line of the gloss',
    ).toBe(true);
    expect(uiStyleSheet()).toContain('.mtg-card__gloss { font-style: italic; }');
  });

  it('prints a printed ability on both faces, word for word', () => {
    // Every ability kind is in the corpus. Without this the loop still passes
    // on a corpus that quietly lost its triggers or its activations, which is
    // the failure this file exists to make loud.
    for (const kind of ABILITY_KINDS) {
      const carrying = ABILITY_CARDS.filter((card) =>
        card.abilities.some((ability) => ability.kind === kind),
      );
      expect(carrying.length, `${kind} abilities in the parity corpus`).toBeGreaterThan(0);
    }
    for (const card of ABILITY_CARDS) {
      const expected = boxText(card);
      // The card really is carrying ability text, so a face that printed only
      // the keyword line cannot pass the comparison below by agreeing about
      // nothing. Checked per ability rather than against one fixed phrase,
      // because a scope and a trigger condition word themselves differently and
      // the ceiling card's `self` scope prints no scope phrase at all.
      expect(card.abilities.length).toBeGreaterThan(0);
      for (const ability of card.abilities) {
        expect(expected).toContain(printedAbilityText(ability, card.name));
      }
      const dom = domRulesWords(domFace(card));
      expect(dom, `${card.id} DOM ability text`).toEqual(words(expected));
      expect(svgRulesWords(svgFace(card)), `${card.id} SVG ability text`).toEqual(words(expected));
      // `words()` normalizes whitespace, which erases the line structure both
      // faces are built from, so the DOM face's line count is checked directly:
      // one `<span class="mtg-card__line">` per `'\n'`-separated paragraph.
      const lines = [...domFace(card).matchAll(/<span class="mtg-card__line/g)].length;
      expect(lines, `${card.id} DOM line count`).toBe(expected.split('\n').length);
    }
  });

  it('keeps the wordiest card in the set whole in both faces', () => {
    const card = wordiest();
    const svg = svgFace(card);
    expect(words(boxText(card)).length).toBeGreaterThan(8);
    // The wrap path is genuinely exercised: the printed face needed more than
    // one run for text the DOM face hands to the browser in one span.
    expect([...svg.matchAll(/\bdata-region="rules"/g)].length).toBeGreaterThan(2);
    expect(svgRulesWords(svg)).toEqual(words(boxText(card)));
    expect(domRulesWords(domFace(card))).toEqual(words(boxText(card)));
  });

  it('resolves the same color identity', () => {
    for (const card of ALL_CARDS) {
      const identity = cardColorIdentity(card);
      expect(domFace(card)).toContain(`data-identity="${identity}"`);
      expect(svgFace(card)).toContain(`data-identity="${identity}"`);
    }
  });

  it('runs the same mana pips in the same order', () => {
    for (const card of ALL_CARDS) {
      if (!isCastable(card)) continue;
      const dom = domFace(card);
      const svg = svgFace(card);
      const expected = costPips(card.manaCost).map((pip) =>
        pip.kind === 'color' ? pip.identity : 'generic',
      );
      expect(pipRun(dom), `${card.id} DOM pip run`).toEqual(expected);
      expect(pipRun(svg), `${card.id} SVG pip run`).toEqual(expected);
      expect(decode(dom)).toContain(`Mana cost ${formatManaCost(card.manaCost)}`);
      expect(decode(svg)).toContain(`Mana cost ${formatManaCost(card.manaCost)}`);
    }
  });

  it('draws the same pip artwork, not just the same run', () => {
    // The run being equal only says the two faces agree on how many symbols and
    // in what order. This says they agree on what a symbol *is*: the same
    // outlines in the same order, and the same numeral in a generic pip.
    let drawn = 0;
    for (const card of ALL_CARDS) {
      if (!isCastable(card)) continue;
      const dom = domFace(card);
      const svg = svgFace(card);
      const printedCost = printedCostMarkup(svg);
      expect(printedCost, `${card.id} printed cost run`).toContain('class="mtg-cost"');
      const domPaths = glyphPaths(costPipMarkup(dom), DOM_GLYPH);
      expect(domPaths, `${card.id} pip outlines`).toEqual(glyphPaths(printedCost, SVG_GLYPH));
      expect(pipNumerals(dom, DOM_NUMERAL), `${card.id} generic pips`).toEqual(
        pipNumerals(printedCost, SVG_NUMERAL),
      );
      drawn += domPaths.length;
    }
    // Two faces that both drew nothing agree about nothing.
    expect(drawn).toBeGreaterThan(0);
  });

  it('draws every mana symbol in the specification, in both faces', () => {
    // No card in the corpus carries more than one color, so the run is built
    // from the specification rather than from whichever cards are around — the
    // same reason the seals are rendered explicitly below.
    const card = everyColorCost();
    if (!isCastable(card)) throw new Error('parity: the rainbow fixture is not castable');
    const expected = costPips(card.manaCost).flatMap((spec) => {
      const art = pipArt(spec);
      return art.kind === 'glyph' ? [art.glyph.fill, ...art.glyph.lines] : [];
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(glyphPaths(costPipMarkup(domFace(card)), DOM_GLYPH)).toEqual(expected);
    expect(glyphPaths(printedCostMarkup(svgFace(card)), SVG_GLYPH)).toEqual(expected);
  });

  it('gives a glyph the same share of its pip in both faces', () => {
    // The printed face scales the authoring square into a 15.5-unit disc and
    // the DOM face sizes the same square with CSS. Different mechanisms, one
    // fraction: a glyph that filled its disc on screen and floated in a ring of
    // it on paper would be the same drawing wearing two proportions.
    const scaled = /<g transform="scale\((\d+(?:\.\d+)?)\)"/.exec(
      printedCostMarkup(svgFace(everyColorCost())),
    );
    const scale = Number(scaled?.[1]);
    expect(Number.isFinite(scale)).toBe(true);
    expect((scale * PIP_GLYPH_UNITS) / CARD_GEOMETRY.pipRadius).toBeCloseTo(PIP_GLYPH_SCALE, 2);
    expect(uiStyleSheet()).toContain(`width: ${String(PIP_GLYPH_SCALE * 100)}%`);
  });

  it('draws the same set symbol outline', () => {
    for (const card of ALL_CARDS) {
      const dom = domFace(card);
      const svg = svgFace(card);
      expect(dom).toContain(`data-rarity="${card.rarity}"`);
      expect(svg).toContain(`data-rarity="${card.rarity}"`);
      expect(dom).toContain(`data-set="${card.set.code}"`);
      expect(svg).toContain(`data-set="${card.set.code}"`);
      // Same outline function asked the same question — the card's own set code
      // — so the two paths differ only by the box each is drawn in. Comparing
      // both against the shared source catches either renderer quietly
      // switching to a shape of its own, or to a set of its own.
      expect(sealPath(dom, DOM_SEAL), `${card.id} DOM seal`).toBe(
        setSealPath(card.set.code, SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius),
      );
      const printed = printedSeal(card);
      expect(sealPath(svg, SVG_SEAL), `${card.id} SVG seal`).toBe(
        setSealPath(card.set.code, printed.cx, printed.cy, printed.radius),
      );
    }
  });

  it('draws one shape for every rarity, in both faces', () => {
    // The shape used to be the rarity — a disc, a diamond, a star — and is now
    // the set's, with the rarity carried by the ink. So the claim to check
    // flipped: every rarity must produce the *same* outline on a face, and the
    // corpus cannot say that on its own, because the slice prints no rares
    // (`SLICE_RARITIES` in `@mtg/design-data`). One synthetic card wears each
    // rarity in turn instead.
    const base = wordiest();
    const outlines = new Set<string>();
    for (const rarity of RARITIES) {
      const card: DslCard = { ...base, rarity };
      const dom = sealPath(domFace(card), DOM_SEAL);
      const svg = sealPath(svgFace(card), SVG_SEAL);
      const printed = printedSeal(card);
      expect(dom).toBe(setSealPath(card.set.code, SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius));
      expect(svg).toBe(setSealPath(card.set.code, printed.cx, printed.cy, printed.radius));
      outlines.add(dom);
    }
    expect(outlines.size, 'one set symbol, whatever the rarity').toBe(1);
    // And it is the set's own mark rather than one shape nobody looked at. The
    // flagship's registry entry is a trisigil: three closed subpaths, nine line
    // segments, and the center left empty, at every rarity. The corners are
    // where the geometry is checked (`packages/ui/test/card.test.ts`).
    const flagship: DslCard = { ...base, set: { code: 'XMP', collectorNumber: 1 }, rarity: 'rare' };
    const drawn = sealPath(domFace(flagship), DOM_SEAL);
    expect([...drawn.matchAll(/Z/g)]).toHaveLength(3);
    expect([...drawn.matchAll(/[ML]/g)]).toHaveLength(9);
  });

  it('draws each set its own mark, and the same mark on both faces', () => {
    // The playtester, 2026-08-21: "the set symbol for the M11 cards still shows the
    // trisigil, it should be the M11 set symbol (symbol should be based on
    // set)". The seal took no set argument at all, so the reduced M11 reference
    // set, the reduced M13 beside it and every set the generator will ever emit
    // printed the flagship's mark. The 2026-08-13 decision that one shape
    // serves a whole set stands; what was wrong was its scope, which was the
    // repository rather than the set.
    //
    // The two subjects are the codes she was looking at: `M11` and `M13` are
    // what `npm run reference:reduced` writes into `card.set.code`. They differ
    // in one character, which is the case any mark keyed on something coarser
    // than the code would miss.
    const base = wordiest();
    const m11: DslCard = { ...base, set: { code: 'M11', collectorNumber: 2 } };
    const m13: DslCard = { ...base, set: { code: 'M13', collectorNumber: 2 } };
    const flagship: DslCard = { ...base, set: { code: 'XMP', collectorNumber: 2 } };
    const domSeal = (card: DslCard): string => sealPath(domFace(card), DOM_SEAL);
    const svgSeal = (card: DslCard): string => sealPath(svgFace(card), SVG_SEAL);

    expect(domSeal(m11), 'M11 and M13 share a mark on the DOM face').not.toBe(domSeal(m13));
    expect(svgSeal(m11), 'M11 and M13 share a mark on the printed face').not.toBe(svgSeal(m13));
    expect(domSeal(m11), 'M11 draws the flagship mark').not.toBe(domSeal(flagship));

    // One drawing across the two faces, each in its own box.
    for (const card of [m11, m13, flagship]) {
      const dom = unitSeal(domSeal(card), SCREEN_SEAL);
      const svg = unitSeal(svgSeal(card), printedSeal(card));
      expect(svg.length, `${card.set.code}: the faces drew marks of different lengths`).toBe(dom.length);
      for (const [index, token] of dom.entries()) {
        const other = svg[index];
        const label = `${card.set.code} token ${String(index)}`;
        if (typeof token === 'string') expect(other, label).toBe(token);
        else expect(typeof other === 'number' ? other : Number.NaN, label).toBeCloseTo(token, 2);
      }
    }

    // The flagship keeps the trisigil, out of a registry entry rather than the
    // default arm: three closed subpaths, nine vertices, the center left empty.
    const trisigil = domSeal(flagship);
    expect([...trisigil.matchAll(/Z/g)]).toHaveLength(3);
    expect([...trisigil.matchAll(/[ML]/g)]).toHaveLength(9);
    // An unregistered set draws its code instead, and both faces publish which
    // set that was, so a proof sheet can read the mark back rather than trust it.
    expect([...domSeal(m11).matchAll(/Z/g)].length).toBeGreaterThan(3);
    expect(domFace(m11)).toContain('data-set="M11"');
    expect(svgFace(m11)).toContain('data-set="M11"');
  });

  it('paints the set symbol from the same per-rarity token in both stylesheets', () => {
    // The rarity ramp, asserted as the token each sheet resolves rather than as
    // a color, for the reason the panel channels are below: neither file names a
    // color, both read `RARITY_SEAL_INK`, and an ink that reached one sheet and
    // not the other would leave a printed card and the same card on the table
    // wearing different rarities.
    const web = uiStyleSheet();
    expect(Object.keys(RARITY_SEAL_INK)).toEqual(RARITIES);
    for (const [rarity, token] of Object.entries(RARITY_SEAL_INK)) {
      expect(web, `the web sheet paints no ${rarity} seal`).toContain(
        `.mtg-card__seal[data-rarity='${rarity}'] path { fill: var(${token}); }`,
      );
      expect(CARD_CSS, `the printed sheet paints no ${rarity} seal`).toContain(
        `.seal[data-rarity='${rarity}'] { fill: var(${token}); }`,
      );
    }
    // Every one of them is a name the shared palette values, in both themes.
    for (const token of Object.values(RARITY_SEAL_INK)) {
      // Three, not two: `documentPalette` emits the dark block twice, once
      // under the preference query and once under the pinned attribute.
      expect(cardStyleSheet().match(new RegExp(`${token}:`, 'g')), `${token} in both palettes`).toHaveLength(
        3,
      );
    }
  });

  it('shrinks the rules text by one ladder on both faces', () => {
    // The DOM face cannot measure — jsdom lays nothing out — so the fit is
    // arithmetic over the printed oracle text and both faces read it. The web
    // face publishes the step and keys a size off it; the printed face caps its
    // measured scan at the same step, so print may end up smaller than the step
    // and never larger.
    // There are two ladders now, and the sheet is written off the longer one:
    // `LOYALTY_FIT_STEPS` is `RULES_FIT_STEPS` with two shorter rungs under it,
    // and a rung is a `data-fit` index, so one run of rules serves both. An
    // ordinary card never reaches the last two, which is why the ladder a card
    // is measured against is asked per card below rather than indexed here.
    const web = uiStyleSheet();
    expect(LOYALTY_FIT_STEPS.slice(0, RULES_FIT_STEPS.length)).toEqual([...RULES_FIT_STEPS]);
    LOYALTY_FIT_STEPS.forEach((scale, step) => {
      expect(web, `the web sheet has no rule for step ${String(step)}`).toContain(
        `.mtg-card__text[data-fit='${String(step)}'] { font-size: calc(var(--mtg-text-sm) * ${String(scale)}); }`,
      );
    });
    let capped = 0;
    let deep = 0;
    for (const card of ALL_CARDS) {
      const step = rulesFitStep(card);
      expect(domFace(card), `${card.id} publishes no fit step`).toContain(`data-fit="${String(step)}"`);
      const scale = rulesFitScale(card, step);
      const sizes = [...svgFace(card).matchAll(/class="rules-text ink"[^>]*font-size="([\d.]+)"/g)].map(
        (match) => Number(match[1]),
      );
      for (const size of sizes) {
        expect(size, `${card.id} printed rules text above its step`).toBeLessThanOrEqual(29 * scale + 1e-9);
      }
      if (step > 0) capped += 1;
      if (step >= RULES_FIT_STEPS.length) deep += 1;
    }
    // A ladder nothing in the corpus steps down is a ladder nothing checks, and
    // that goes double for the two rungs only a planeswalker can reach.
    expect(capped, 'cards the ladder actually shrinks').toBeGreaterThan(0);
    expect(deep, 'cards on a rung only the loyalty ladder has').toBeGreaterThan(0);
  });

  it('shrinks the name by one ladder on both faces', () => {
    // The same contract the rules ladder above has, one bar up. The DOM face
    // cannot measure, so the step is arithmetic over the name and both faces
    // read it: the web face publishes it and keys a scale off it, and the
    // printed face caps its measured scan at the same step, so print may end up
    // smaller than the step and never larger. Print keeps what the arithmetic
    // cannot give it — `fitLine` measures against a metrics table and wraps onto
    // a second line rather than cutting a name the DOM face ellipsizes.
    const web = uiStyleSheet();
    NAME_FIT_STEPS.forEach((scale, step) => {
      expect(web, `the web sheet has no name rule for step ${String(step)}`).toContain(
        `.mtg-card__name[data-fit='${String(step)}'] { --name-scale: ${String(scale)}; }`,
      );
    });
    let capped = 0;
    for (const card of ALL_CARDS) {
      const step = nameFitStep(card);
      expect(domFace(card), `${card.id} publishes no name fit step`).toContain(
        `class="mtg-card__name" data-fit="${String(step)}"`,
      );
      const ceiling = TITLE_MAX_SIZE * nameFitScale(step);
      const sizes = [...svgFace(card).matchAll(/class="title-text ink"[^>]*font-size="([\d.]+)"/g)].map(
        (match) => Number(match[1]),
      );
      expect(sizes.length, `${card.id} printed no title`).toBeGreaterThan(0);
      for (const size of sizes) {
        expect(size, `${card.id} printed its name above its step`).toBeLessThanOrEqual(ceiling + 1e-9);
      }
      if (step > 0) capped += 1;
    }
    // A ladder nothing in the corpus steps down is a ladder nothing checks.
    expect(capped, 'cards the name ladder actually shrinks').toBeGreaterThan(0);
  });

  it('sizes a title-row cost pip from the title text, in both faces', () => {
    // One rule — the pip's box is the title's own line box — applied by each
    // medium with its own machinery: the web sheet multiplies two tokens, and
    // the printed geometry multiplies the title band's ceiling. The shared
    // number is the multiplier.
    expect(uiStyleSheet()).toContain('--pip-box: calc(var(--mtg-text-sm) * var(--mtg-leading-tight));');
    expect(uiStyleSheet()).toContain('width: var(--pip-box, 1.05rem)');
    expect(CARD_GEOMETRY.pipRadius * 2).toBeCloseTo(TITLE_MAX_SIZE * TITLE_PIP_TO_TEXT, 6);
  });

  /**
   * The card's interior, which both faces used to paint the same neutral and now
   * both paint the card's own color.
   *
   * Asserted as the token each sheet resolves rather than as a color, because
   * that is the whole mechanism: neither file names a color, both read
   * `--mtg-frame-<identity>-panel` and `-well` off the shared palette, and a
   * change that reached one sheet and not the other would leave a printed card
   * and the same card on the table two different colors inside one border. The
   * pending art window is the stated exception in both, for the reason each
   * sheet's docblock gives: the notice printed on it is amber.
   */
  it('paints the panels and the art window from the same per-identity tokens', () => {
    const web = uiStyleSheet();
    for (const identity of COLOR_IDENTITIES) {
      for (const [channel, token] of [
        ['--panel', `--mtg-frame-${identity}-panel`],
        ['--well', `--mtg-frame-${identity}-well`],
      ] as const) {
        expect(web, `the web sheet resolves no ${channel} for ${identity}`).toContain(
          `${channel}: var(${token})`,
        );
        expect(CARD_CSS, `the printed sheet resolves no ${channel} for ${identity}`).toContain(
          `${channel}: var(${token})`,
        );
      }
    }
    expect(CARD_CSS).toContain('.panel { fill: var(--panel);');
    expect(CARD_CSS).toContain('.well { fill: var(--well);');
    // And the exception, in both, so a face with no art yet keeps the ground its
    // amber label was measured against.
    expect(CARD_CSS).toContain(".art[data-art-state='pending'] .well { fill: var(--mtg-surface-sunken); }");
    expect(web).toContain('background-color: var(--mtg-surface-sunken)');
  });

  it('carries the palette a card needs into the file, and nothing about a table', () => {
    // The shared palette is embedded verbatim, so every name in it is a name
    // every printed card file carries forever. `mtg-bc2.46` added four surfaces
    // and a shadow for the play surface's mat; a mat means nothing inside a
    // 63 x 88 mm card, so they are declared in their own block outside
    // `TOKEN_CSS` and only the page's sheet appends them.
    //
    // Asked of the *names* a card file declares rather than of the block the
    // mat happens to live in, because the mistake worth catching is one of
    // those declarations being moved into `LIGHT_TOKENS`, and a check that
    // reads its list out of the mat block stops asking about a name the moment
    // it leaves. `BOARD_SURFACE_TOKEN` is that rule, and it lives beside the
    // block it describes.
    const printed = cardStyleSheet();
    const embedded = renderCardSvg(wordiest(), { embedStyles: true }).svg;
    for (const sheet of [printed, embedded]) {
      const declared = [...sheet.matchAll(/(--mtg-[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
      // A sheet declaring nothing would pass the loop below saying nothing.
      expect(declared.length).toBeGreaterThan(30);
      expect(declared).toContain('--mtg-surface-raised');
      for (const token of declared) {
        expect(BOARD_SURFACE_TOKEN.test(token), `${token} reached a printed card`).toBe(false);
      }
    }
    // And the mat's own block is covered by that rule, so a surface added to it
    // tomorrow cannot be one the check above would wave through.
    const matTokens = [...MAT_TOKEN_CSS.matchAll(/(--mtg-[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
    expect(matTokens.length).toBeGreaterThan(0);
    for (const token of matTokens) {
      expect(BOARD_SURFACE_TOKEN.test(token), `${token} is outside the naming rule`).toBe(true);
    }
  });

  it('announces pending art the same way, with the card it is pending for', () => {
    for (const card of ALL_CARDS) {
      for (const face of [decode(domFace(card)), decode(svgFace(card))]) {
        expect(face).toContain(ART_PENDING_LABEL);
        expect(face).toContain(`${ART_PENDING_LABEL} for ${card.id}`);
        expect(face).toContain('data-art-state="pending"');
      }
    }
  });

  it('sizes the art window from one ratio', () => {
    const printed = CARD_GEOMETRY.art.width / CARD_GEOMETRY.art.height;
    expect(printed).toBeCloseTo(ART_WINDOW.width / ART_WINDOW.height, 6);
    expect(uiStyleSheet()).toContain(
      `aspect-ratio: ${String(ART_WINDOW.width)} / ${String(ART_WINDOW.height)}`,
    );
  });

  it('gives a planeswalker the shorter art window, on both faces and nowhere else', () => {
    // The one card type whose window gives, and the reason it does is in
    // `@mtg/card-geometry`'s `PLANESWALKER_ART_WINDOW` and in the sheet's
    // `PLANESWALKER` block: three ruled ability rows ask for ten lines where
    // the wordiest creature asks for six, and the alternative to taking the
    // height from the picture is taking it from the words.
    const walker = onlyWalker('planeswalker-ultimate');
    const printed = cardGeometry(walker).art;
    expect(printed.width / printed.height).toBeCloseTo(
      PLANESWALKER_ART_WINDOW.width / PLANESWALKER_ART_WINDOW.height,
      6,
    );
    expect(uiStyleSheet()).toContain(
      `aspect-ratio: ${String(PLANESWALKER_ART_WINDOW.width)} / ${String(PLANESWALKER_ART_WINDOW.height)}`,
    );
    // And nowhere else: a creature keeps the window every other card has, so
    // this is a planeswalker rule rather than a new default that happens to be
    // asserted on a planeswalker.
    expect(cardGeometry(wordiest()).art).toEqual(CARD_GEOMETRY.art);
    expect(PLANESWALKER_ART_WINDOW.height).toBeLessThan(ART_WINDOW.height);
  });

  it('rules a planeswalker into ability rows, one cost badge per costed row, in both faces', () => {
    // The cost is not a word of the sentence: `oracleRows` splits it off into
    // its own column and both faces draw a badge there, so the sequence of
    // costs is a property of the face rather than a substring of the rules
    // text. Read structurally off each face and compared against the shared
    // block list, which is the same specification the words are compared to.
    let ruled = 0;
    for (const card of ALL_CARDS) {
      const expected = textBoxBlocks(card)
        .map((block) => block.loyaltyCost)
        .filter((cost): cost is string => cost !== undefined);
      const dom = domFace(card);
      expect(domRowCosts(dom), `${card.id} DOM row costs`).toEqual(expected);
      expect(domBadgeCosts(dom), `${card.id} DOM badge costs`).toEqual(expected);
      expect(svgBadgeCosts(svgFace(card)), `${card.id} printed badge costs`).toEqual(expected);
      if (expected.length > 0) ruled += 1;
    }
    expect(ruled, 'cards in the corpus that print a cost badge').toBeGreaterThan(0);
  });

  it('sets a planeswalker row that has no cost across the whole box, in both faces', () => {
    // A loyalty ability always states a cost, so an uncosted row cannot come
    // from one: on a walker it is the flavor text, or the second line of an
    // ability that prints two. Either way the row carries no badge and the
    // words start at the left edge of the box rather than in the sentence
    // column. Both faces have to do that, and a face that badged every row
    // would still pass the sequence check above by badging the same rows.
    const walker = onlyWalker('planeswalker-uncosted-row');
    const blocks = textBoxBlocks(walker);
    const bare = blocks.filter((block) => block.loyaltyCost === undefined);
    expect(bare.length, 'uncosted rows on the fixture').toBeGreaterThan(0);
    expect(blocks.length).toBeGreaterThan(bare.length);

    // The DOM face: a row with no cost publishes no `data-loyalty`, so the
    // two-column rule in the sheet does not match it.
    const dom = domFace(walker);
    const rows = [...dom.matchAll(/<span class="mtg-card__line"[^>]*>/g)].map((match) => match[0]);
    expect(rows.length).toBe(blocks.length);
    expect(rows.filter((row) => !row.includes('data-loyalty=')).length).toBe(bare.length);

    // The printed face: the sentence column is inset by the badge column, and
    // an uncosted row is set at the left edge of the box instead. Read off the
    // emitted `x` of each run rather than off the layout that produced it.
    const svg = svgFace(walker);
    const starts = new Set(printedRulesRuns(svg).map((run) => run.x));
    expect(starts.has(rulesBoxX(svg)), 'a printed row set at the left edge of the box').toBe(true);
    expect(starts.size, 'the printed face sets two columns').toBe(2);
  });

  it('draws the cost badge and the loyalty shield from one outline in both faces', () => {
    // Same two arrays, two projections: the printed face multiplies them into a
    // `points` attribute and the sheet turns them into `clip-path` percentages.
    // Both are normalized back onto the unit square here, so the comparison is
    // of silhouettes rather than of coordinates in two different spaces, and a
    // renderer that rounded a corner of its own fails on the shape.
    const walker = onlyWalker('planeswalker-ultimate');
    const svg = svgFace(walker);
    const sheet = uiStyleSheet();

    const badges = [...svg.matchAll(/<polygon class="loyalty-badge" points="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(badges.length, 'printed cost badges').toBe(walker.abilities.length);
    for (const badge of badges) {
      expect(unitOutline(badge)).toEqual(rounded(LOYALTY_BADGE_POINTS));
    }
    expect(sheet).toContain(outlineClipPath(LOYALTY_BADGE_POINTS));
    expect(clipUnitOutline(sheet, '.mtg-card__loyalty')).toEqual(rounded(LOYALTY_BADGE_POINTS));

    const shield = /<polygon class="loyalty-shield" points="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(shield, 'the printed face drew no loyalty shield').not.toBe('');
    expect(unitOutline(shield)).toEqual(rounded(LOYALTY_SHIELD_POINTS));
    expect(sheet).toContain(outlineClipPath(LOYALTY_SHIELD_POINTS));
    expect(clipUnitOutline(sheet, '.mtg-card__shield')).toEqual(rounded(LOYALTY_SHIELD_POINTS));

    // The box the printed shield was drawn in is the geometry's, asked of the
    // package rather than measured off the drawing, so a renderer that put the
    // right shape in the wrong corner fails here too.
    expect(shield).toBe(outlinePoints(LOYALTY_SHIELD_POINTS, cardGeometry(walker).loyalty));
  });

  it('prints the starting loyalty in the shield on both faces, and no P/T anywhere', () => {
    for (const card of ALL_CARDS) {
      const dom = domFace(card);
      const svg = svgFace(card);
      if (!isPlaneswalker(card)) {
        expect(dom, `${card.id} DOM shield`).not.toContain('mtg-card__shield');
        expect(svg, `${card.id} printed shield`).not.toContain('loyalty-shield');
        continue;
      }
      const loyalty = String(card.startingLoyalty);
      expect(domShield(dom), `${card.id} DOM loyalty`).toBe(loyalty);
      expect(svgShield(svg), `${card.id} printed loyalty`).toBe(loyalty);
      // A walker has no power or toughness to print, and the badge that prints
      // one is a different badge in a different place. Neither face may reach
      // for it.
      expect(dom, `${card.id} DOM P/T`).not.toContain('mtg-card__pt');
      expect(svg, `${card.id} printed P/T`).not.toContain('data-region="powerToughness"');
    }
  });

  it('gives the printed trim and the on-screen card the same silhouette', () => {
    // Read off the emitted root element, not off the constant the emitter is
    // supposed to have used: `CARD_WIDTH_MM` is an alias of `CARD_TRIM_MM.width`,
    // so comparing the two would pass whatever `render.ts` actually wrote.
    const svg = svgFace(wordiest());
    expect(printedTrim(svg)).toEqual([`${String(CARD_TRIM_MM.width)}mm`, `${String(CARD_TRIM_MM.height)}mm`]);
    // One user unit is a tenth of a millimeter, so the viewBox is the same trim
    // at ten times scale. Every `CARD_GEOMETRY` box is stated in those units.
    expect(svg).toContain(
      `viewBox="0 0 ${String(CARD_TRIM_MM.width * 10)} ${String(CARD_TRIM_MM.height * 10)}"`,
    );
    // The DOM face states the trim as its shape. It used to state it as a
    // `min-height` floor, which this assertion accepted and which is not the
    // same fact: a floor let a talkative card grow past the silhouette this test
    // exists to pin, and the flagship set drew at three heights because of it
    // (`packages/ui/src/styles/card.ts`, `FACE_TRIM`).
    expect(uiStyleSheet()).toContain(
      `.mtg-card[data-size='full'] {\n  aspect-ratio: ${String(CARD_TRIM_MM.width)} / ${String(CARD_TRIM_MM.height)};`,
    );
  });
});

/**
 * The frame treatment: what each face publishes about the card, and what each
 * one then paints with it.
 *
 * The cases are built from the specification rather than lifted from a
 * committed set, for the reason the seals are: no set in the repository
 * contains a multicolor artifact, and that is precisely the card the two faces
 * were free to disagree about. Every case goes through `parseCard`, so none of
 * them is a card the generator could not emit.
 *
 * The expectations are written out rather than recomputed. Asserting that a
 * root carries `faceAttributes(card, treatment)` would pass whatever
 * `faceAttributes` happened to return; the table below says what a blue-red
 * artifact creature is supposed to publish, in letters.
 */
interface TreatmentCase {
  readonly label: string;
  readonly input: CardInput;
  readonly identity: string;
  readonly colors: string;
  readonly artifact: string;
}

function monoCase(letter: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): TreatmentCase {
  return {
    label: `mono ${letter}`,
    identity: letter,
    colors: letter,
    artifact: 'false',
    input: {
      id: `parity-mono-${letter}`,
      name: `Parity Mono ${color}`,
      kind: 'creature',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 1 },
      colors: [color],
      manaCost: { generic: 1, [color]: 1 },
      power: 2,
      toughness: 2,
    },
  };
}

const TREATMENT_CASES: readonly TreatmentCase[] = [
  monoCase('w', 'W'),
  monoCase('u', 'U'),
  monoCase('b', 'B'),
  monoCase('r', 'R'),
  monoCase('g', 'G'),
  {
    label: 'colorless creature',
    identity: 'c',
    colors: '',
    artifact: 'false',
    input: {
      id: 'parity-colorless',
      name: 'Parity Wanderer',
      kind: 'creature',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 2 },
      colors: [],
      manaCost: { generic: 3 },
      power: 3,
      toughness: 3,
    },
  },
  {
    label: 'two colors',
    identity: 'm',
    colors: 'ur',
    artifact: 'false',
    input: {
      id: 'parity-two-colors',
      name: 'Parity Crosscurrent',
      kind: 'instant',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 3 },
      colors: ['U', 'R'],
      manaCost: { U: 1, R: 1 },
      effects: [{ kind: 'counterSpell' }],
    },
  },
  {
    label: 'three colors',
    identity: 'm',
    colors: 'wub',
    artifact: 'false',
    input: {
      id: 'parity-three-colors',
      name: 'Parity Concord',
      kind: 'sorcery',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 4 },
      colors: ['W', 'U', 'B'],
      manaCost: { W: 1, U: 1, B: 1 },
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    },
  },
  {
    label: 'colorless artifact',
    identity: 'c',
    colors: '',
    artifact: 'true',
    input: {
      id: 'parity-artifact-colorless',
      name: 'Parity Lens',
      kind: 'artifact',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 5 },
      subtypes: ['Equipment'],
      manaCost: { generic: 2 },
    },
  },
  {
    label: 'mono-color artifact creature',
    identity: 'u',
    colors: 'u',
    artifact: 'true',
    input: {
      id: 'parity-artifact-mono',
      name: 'Parity Automaton',
      kind: 'creature',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 6 },
      colors: ['U'],
      subtypes: ['Construct'],
      manaCost: { generic: 3, U: 1 },
      artifact: true,
      power: 3,
      toughness: 4,
    },
  },
  {
    label: 'multicolor artifact creature',
    identity: 'm',
    colors: 'ur',
    artifact: 'true',
    input: {
      id: 'parity-artifact-two-colors',
      name: 'Parity Forgeling',
      kind: 'creature',
      rarity: 'common',
      set: { code: 'PAR', collectorNumber: 7 },
      colors: ['U', 'R'],
      subtypes: ['Construct'],
      manaCost: { U: 1, R: 1 },
      artifact: true,
      power: 2,
      toughness: 3,
    },
  },
];

/**
 * What each basic land is supposed to read as, written out. A land declares no
 * color at all — the DSL forbids it — so its frame comes from what it taps
 * for, and this row is what pins that fallback in both faces.
 */
const LAND_IDENTITY: Readonly<Record<string, string>> = {
  Plains: 'w',
  Island: 'u',
  Swamp: 'b',
  Mountain: 'r',
  Forest: 'g',
};

interface TreatmentRow {
  readonly label: string;
  readonly card: DslCard;
  readonly identity: string;
  readonly colors: string;
  readonly artifact: string;
}

function landRow(land: DslCard, rarity: Rarity): TreatmentRow {
  if (land.kind !== 'land') throw new Error('parity: not a land');
  if (land.basicLandType === undefined) throw new Error('parity: expected a Basic land');
  const letter = LAND_IDENTITY[land.basicLandType];
  if (letter === undefined) throw new Error(`parity: no expectation for ${land.basicLandType}`);
  return {
    label: `${land.basicLandType}, ${rarity}`,
    card: { ...land, rarity },
    identity: letter,
    colors: letter,
    artifact: 'false',
  };
}

/** Every treatment crossed with every rarity: rarity rides on the same record. */
const TREATMENT_ROWS: readonly TreatmentRow[] = [
  ...TREATMENT_CASES.flatMap((entry) =>
    RARITIES.map((rarity) => ({
      label: `${entry.label}, ${rarity}`,
      card: parseCard({ ...entry.input, rarity }),
      identity: entry.identity,
      colors: entry.colors,
      artifact: entry.artifact,
    })),
  ),
  ...BASIC_LANDS.flatMap((land) => RARITIES.map((rarity) => landRow(land, rarity))),
];

/** The vocabulary a face root publishes. Both roots write all five. */
const PUBLISHED = ['data-identity', 'data-colors', 'data-artifact', 'data-rarity', 'data-card-id'] as const;

/**
 * Attributes of the root element only. Both faces mention `data-identity` deep
 * inside themselves — the token sheet in its selectors, the DOM face on its
 * pips — so this is scoped to the opening tag the way `render.test.ts` scopes
 * its theme check.
 */
function rootAttrs(markup: string): Readonly<Record<string, string>> {
  const open = markup.slice(0, markup.indexOf('>'));
  const attrs: Record<string, string> = {};
  for (const match of open.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attrs[match[1] ?? ''] = match[2] ?? '';
  }
  return attrs;
}

/**
 * The frame group, which is where the printed plate is. The pending-art window
 * fills itself from the same hatch pattern, so a document-wide search for the
 * pattern id finds nearly every card in a set with no art yet.
 */
function frameLayersOf(markup: string): string {
  const found = /<g class="frame-layers">[\s\S]*?<\/g>/.exec(markup);
  if (found === null) throw new Error('parity: the printed face drew no frame layers');
  return found[0];
}

/**
 * The argument list of every CSS gradient in a sheet, one entry per gradient.
 *
 * Brace-walked rather than split on a delimiter, because a stop list holds
 * `var(…)` calls and one declaration may hold several gradients.
 */
function gradientStops(sheet: string): readonly string[] {
  const found: string[] = [];
  const marker = 'gradient(';
  for (let at = sheet.indexOf(marker); at !== -1; at = sheet.indexOf(marker, at + 1)) {
    const open = at + marker.length;
    let depth = 1;
    let end = open;
    while (end < sheet.length && depth > 0) {
      const char = sheet[end];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      end += 1;
    }
    found.push(sheet.slice(open, end - 1));
  }
  return found;
}

/** The ramp's stops, as color letters in the order the document declares them. */
function rampStops(markup: string): readonly string[] {
  const block = /<linearGradient\b[\s\S]*?<\/linearGradient>/.exec(markup);
  if (block === null) return [];
  return [...block[0].matchAll(/stop-color="var\(--mtg-color-([a-z])\)"/g)].map((match) => match[1] ?? '');
}

describe('the two renderers treat the same frame', () => {
  it('publishes the same vocabulary on both roots', () => {
    for (const row of TREATMENT_ROWS) {
      const dom = rootAttrs(domFace(row.card));
      const svg = rootAttrs(svgFace(row.card));
      for (const name of PUBLISHED) {
        expect(dom[name], `${row.label} DOM publishes no ${name}`).toBeDefined();
        expect(svg[name], `${row.label} SVG ${name}`).toBe(dom[name]);
      }
      // The three the frame is painted from, against the written expectation.
      for (const face of [dom, svg]) {
        expect(face['data-identity'], `${row.label} identity`).toBe(row.identity);
        expect(face['data-colors'], `${row.label} colors`).toBe(row.colors);
        expect(face['data-artifact'], `${row.label} artifact`).toBe(row.artifact);
      }
      expect(dom['data-rarity'], `${row.label} rarity`).toBe(row.card.rarity);
      expect(dom['data-card-id'], `${row.label} id`).toBe(row.card.id);
    }
  });

  it('runs the printed ramp across the card colors, in order, and nowhere else', () => {
    for (const row of TREATMENT_ROWS) {
      const svg = svgFace(row.card);
      const layers = frameLayersOf(svg);
      if (row.colors.length > 1) {
        expect(rampStops(svg), `${row.label} ramp`).toEqual([...row.colors]);
        expect(layers, `${row.label} ring`).toContain(`stroke="url(#${row.card.id}-border)"`);
      } else {
        expect(svg, `${row.label} declares a ramp it should not`).not.toContain('<linearGradient');
        expect(layers, `${row.label} ring`).toContain('stroke="var(--edge)"');
      }
    }
  });

  it('plates an artifact in print, and only an artifact', () => {
    for (const row of TREATMENT_ROWS) {
      const plated = frameLayersOf(svgFace(row.card)).includes(`url(#${row.card.id}-plate)`);
      expect(plated, `${row.label} plate`).toBe(row.artifact === 'true');
    }
  });

  it('carries a multicolor card colors in the DOM pip run rather than a ring', () => {
    // The difference is deliberate and ADR-0002 §2.2 states it: the printed
    // ring is a decision about a 63 mm card in a draft pile, and the DOM face
    // has no inset element to run one across. What holds the abstention honest
    // is that the color is still on screen — one pip per color in the title
    // bar, at both sizes, which is what this asserts. A redesign that drops the
    // pips from the face fails here, which is when the abstention would stop
    // being safe.
    let checked = 0;
    for (const row of TREATMENT_ROWS) {
      if (row.colors.length < 2) continue;
      for (const size of ['full', 'compact'] as const) {
        const run = new Set(pipRun(renderToStaticMarkup(h(Card, { card: row.card, size }))));
        for (const letter of row.colors) {
          expect(run.has(letter), `${row.label} ${size} pip run is missing ${letter}`).toBe(true);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('declares no identity gradient in the DOM sheet', () => {
    // DESIGN.md bans gradient accents; the ones the sheet does declare are
    // hard-stop textures on a neutral. A ramp arriving here would be the DOM
    // quietly copying the printed ring instead of amending the ADR.
    //
    // Read as each gradient's own stop list, balanced-paren aware. The first
    // version of this scan took the text between a `gradient(` and the next
    // semicolon, which stopped being the right thing when the playmat's weave
    // put two gradients in one `background-image` (`mtg-bc2.46`): the first of
    // the pair had no semicolon of its own, so the scan could not see either.
    const stops = gradientStops(uiStyleSheet());
    expect(stops.length).toBeGreaterThan(0);
    for (const declaration of stops) {
      expect(declaration).not.toContain('--mtg-color-');
      expect(declaration).not.toContain('--mtg-frame-');
    }
  });

  it('covers every identity, every color count and both artifact values', () => {
    expect([...new Set(TREATMENT_ROWS.map((row) => row.identity))].sort()).toEqual(
      [...COLOR_IDENTITIES].sort(),
    );
    expect([...new Set(TREATMENT_ROWS.map((row) => row.colors.length))].sort()).toEqual([0, 1, 2, 3]);
    expect([...new Set(TREATMENT_ROWS.map((row) => row.artifact))].sort()).toEqual(['false', 'true']);
    expect([...new Set(TREATMENT_ROWS.map((row) => row.card.rarity))].sort()).toEqual([...RARITIES].sort());
    // The crossing that made the matrix necessary: an artifact that is also
    // multicolored exercises the plate and the ramp on one card, and nothing
    // committed to the repository is one.
    expect(TREATMENT_ROWS.some((row) => row.artifact === 'true' && row.colors.length > 1)).toBe(true);
    expect(ALL_CARDS.some((card) => isArtifact(card) && cardColors(card).length > 1)).toBe(false);
  });
});
