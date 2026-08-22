// @vitest-environment jsdom
/**
 * Every route is paper, for every viewer.
 *
 * `docs/mockups/direction-b-playmat.html` is hard-stamped `data-theme="light"`,
 * so the surface that was reviewed and chosen is the paper one. The app has no
 * theme control, so a viewer whose system prefers dark used to get the dark half
 * of a palette pair nobody had looked at. `mtg-bc2.46` fixed that for the play
 * route alone and left the other four following the system, which is what a
 * person looking at the running app saw: some tabs still dark, and the UI
 * requirements applied to one tab in five. `styles/tokens.ts` now registers a
 * scope for every mode in `UI_MODES`, and this file is what holds it to that.
 *
 * The claim is about *resolution*, not about text: what a token is worth on an
 * element inside a route, after the cascade has run, under a dark system
 * preference and under a pinned dark theme. jsdom resolves custom properties
 * through the cascade (specificity, order and inheritance all apply), which is
 * what makes that observable here. It evaluates no `@media` condition at all, so
 * a dark *preference* is applied the only way available: by unwrapping the
 * `prefers-color-scheme: dark` blocks, which is exactly what a browser that
 * matched the query would do with them.
 *
 * Which tokens are checked is not a list kept by hand. It is read off each
 * route: the rendered route is matched against every rule in the shipped sheet,
 * and every token those rules reference is a token that route draws with. A
 * scope that pins the mat and forgets the cards fails here, because the cards'
 * tokens are in that set and would still resolve dark.
 *
 * Nor is which *declarations* count as tokens. The set is read off the palette
 * blocks declaration by declaration, so `color-scheme` is checked like any
 * other: it is the one declaration in them that is not a custom property, the
 * browser draws the scrollbar and every native control from it, and a
 * `--mtg-*`-shaped matcher excluded it from this whole file. A paper page with a
 * near-black scrollbar down its right edge is what that cost, and the last
 * describe below is the part of the claim the scopes cannot carry.
 *
 * Which *routes* are checked is not a list kept by hand either. `ROUTE_MARKUP`
 * is a `Record<UiMode, ...>`, so a sixth mode added to `UI_MODES` does not
 * typecheck until it renders here, and `SCOPED_PALETTES` is built from
 * `UI_MODES` rather than written out, so the scope cannot be the half somebody
 * forgot.
 *
 * What replaced "leaves the analysis route dark". Two tests used to assert the
 * analysis route stayed dark, as the contrast case proving the play route's
 * scope was scoped rather than global. Once every route is paper no route can
 * play that part, but the property is real and still needs holding: a scope
 * applies where it is registered and nowhere else. The ground outside every
 * shell plays it now, in `describe('outside every route scope')`. That is not a
 * contrivance invented to keep a test alive: `packages/card-render/src/palette.ts`
 * embeds `TOKEN_CSS` verbatim in a standalone SVG that has no shell and no route
 * in it, and the document palette is what that file resolves against.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Shell } from '../src/app/Shell';
import { UI_MODES } from '../src/app/router';
import type { UiMode, UiRoute } from '../src/app/router';
import { readDeckArtifact } from '../src/lab/deck-artifact';
import type { DeckArtifact } from '../src/lab/deck-artifact';
import { readReplayLog } from '../src/replay/timeline';
import { AnalysisRoute } from '../src/routes/AnalysisRoute';
import { CardsRoute } from '../src/routes/CardsRoute';
import { DeckRoute } from '../src/routes/DeckRoute';
import { DraftRoute } from '../src/routes/DraftRoute';
import { PlayRoute } from '../src/routes/PlayRoute';
import { ReplayRoute } from '../src/routes/ReplayRoute';
import { dealMirrorGame } from '../src/routes/play/deal';
import { uiStyleSheet } from '../src/styles/index';
import {
  DARK_TOKENS,
  MAT_DARK_TOKENS,
  MAT_LIGHT_TOKENS,
  LIGHT_TOKENS,
  routeScope,
} from '../src/styles/tokens';
import { fixtureText } from './support/replay-fixture';

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface NodeListLike {
  readonly length: number;
  readonly item: (index: number) => ElementLike | null;
}

interface ElementLike {
  innerHTML: string;
  readonly matches: (selector: string) => boolean;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => NodeListLike;
  readonly setAttribute: (name: string, value: string) => void;
  readonly removeAttribute: (name: string) => void;
  readonly appendChild: (child: ElementLike) => void;
  textContent: string;
}

interface DocumentLike {
  readonly documentElement: ElementLike;
  readonly head: ElementLike;
  readonly body: ElementLike;
  readonly createElement: (tag: string) => ElementLike;
}

interface WindowLike {
  readonly document: DocumentLike;
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/**
 * The jsdom window, reached structurally rather than through global types: the
 * workspace tsconfig has no `lib: dom`, which is the same reason `src/mount.ts`
 * and `test/board.test.ts` declare their own shapes.
 */
function windowLike(): WindowLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  return { document, getComputedStyle: candidate.getComputedStyle };
}

/**
 * One spelling for a color, so the two sides of every comparison are about the
 * value. jsdom re-serializes a computed custom property — the space around a
 * slash and after a comma both go — and a shadow declaration carries several of
 * each.
 */
function normalize(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([,/])\s*/g, '$1')
    .trim();
}

/** The declared value of one token in a palette block. */
function valueIn(block: string, token: string): string {
  const found = new RegExp(`${token}:([^;]*);`).exec(block);
  if (found === null) throw new Error(`${token} is declared in neither palette block`);
  return normalize(found[1] ?? '');
}

function paperValue(token: string): string {
  const block = LIGHT_TOKENS.includes(`${token}:`) ? LIGHT_TOKENS : MAT_LIGHT_TOKENS;
  return valueIn(block, token);
}

function darkValue(token: string): string {
  const block = DARK_TOKENS.includes(`${token}:`) ? DARK_TOKENS : MAT_DARK_TOKENS;
  return valueIn(block, token);
}

/** Every property name a palette block declares, custom or not. */
function declaredIn(block: string): readonly string[] {
  return block
    .split(';')
    .map((chunk) => chunk.split(':')[0]?.trim() ?? '')
    .filter((name) => name !== '');
}

/**
 * Every declaration either palette themes. Scale tokens are one value and never
 * move.
 *
 * Read off the blocks declaration by declaration rather than by `--mtg-*` name,
 * which is the hole this file shipped with. `color-scheme` is declared in both
 * palettes and is not a custom property, so a name-shaped matcher excluded it
 * from every assertion here: flipping `LIGHT_TOKENS`' `color-scheme: light` to
 * `dark` gives every paper route a dark scrollbar and dark native controls, and
 * all 490 tests in this package stayed green through it. A palette narrowed to a
 * chosen subset cannot drop a declaration past this either, because nothing here
 * is a list of names.
 */
const THEMED: readonly string[] = [...new Set(declaredIn(`${LIGHT_TOKENS}${MAT_LIGHT_TOKENS}`))].sort();

/** The custom properties among them: the palette the sheet paints through. */
const THEMED_PROPERTIES: readonly string[] = THEMED.filter((name) => name.startsWith('--'));

/**
 * The rest: what the *browser* paints from rather than what the sheet does.
 *
 * `color-scheme` is the whole of this set today. No rule in the sheet mentions
 * it in a `var()` and no rule of ours draws a scrollbar or the ground under a
 * `<select>`, so it is drawn wherever it is inherited — which is every element
 * under the block declaring it — rather than by the rules that happen to match.
 */
const NATIVE: readonly string[] = THEMED.filter((name) => !name.startsWith('--'));

/**
 * A browser whose system prefers dark, expressed as a sheet.
 *
 * jsdom applies no `@media` block whatever its condition, so the preference
 * cannot be set on the window. Lifting the `prefers-color-scheme: dark` blocks
 * out of their wrapper is what a browser that matched the query does with them,
 * and it leaves every other media block alone — including the width breakpoints,
 * which jsdom would not have applied either way.
 */
function underDarkPreference(sheet: string): string {
  const marker = '@media (prefers-color-scheme: dark) {';
  let out = sheet;
  for (;;) {
    const start = out.indexOf(marker);
    if (start === -1) return out;
    let depth = 1;
    let end = start + marker.length;
    while (end < out.length && depth > 0) {
      if (out[end] === '{') depth += 1;
      else if (out[end] === '}') depth -= 1;
      end += 1;
    }
    out = `${out.slice(0, start)}${out.slice(start + marker.length, end - 1)}${out.slice(end)}`;
  }
}

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/**
 * Flattens the sheet to selector/declaration pairs, at-rules included. Comments
 * come out first: these sheets carry long ones, and the text before a `{` is a
 * selector to everything downstream of here.
 */
function rulesOf(source: string): readonly Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open === -1) return rules;
    const selector = css.slice(cursor, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') depth -= 1;
      end += 1;
    }
    const body = css.slice(open + 1, end - 1);
    if (selector.startsWith('@')) rules.push(...rulesOf(body));
    else rules.push({ selector, body });
    cursor = end;
  }
  return rules;
}

/**
 * State pseudo-classes dropped so a rule that only applies on hover, on focus or
 * while disabled is still counted. Those states are reachable on the route by
 * pointing at it, and a palette that abandoned them would flash dark mid-click.
 */
function matchable(selector: string): string {
  return selector
    .replace(/:not\(\s*:[a-z-]+\s*\)/g, '')
    .replace(/::?(hover|active|focus-visible|focus|before|after|disabled|checked)\b/g, '');
}

/**
 * Every `--mtg-*` token a rule matching something under `root` references.
 *
 * Takes the parsed rules rather than the sheet text. Five routes are measured
 * against one sheet of some eighty kilobytes per paint, and reparsing it per
 * route was most of the cost of this file.
 */
/**
 * A selector list split into the selectors it holds, on its own commas only.
 *
 * `String.split(',')` was what this used, and `mtg-ryix` broke it: the mat's
 * rules are emitted under `styles/board/geometry.ts`'s `TABLE`, which is an
 * `:is()` of two route scopes, and a plain split breaks that into two halves
 * that are each a syntax error. Depth counting is the whole fix — a comma inside
 * any bracket belongs to the function it is in, not to the list.
 */
function selectorParts(selector: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < selector.length; at += 1) {
    const character = selector[at];
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(selector.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

function tokensDrawnUnder(root: ElementLike, rules: readonly Rule[]): ReadonlySet<string> {
  const drawn = new Set<string>();
  for (const rule of rules) {
    if (!rule.body.includes('var(--mtg-')) continue;
    const applies = selectorParts(matchable(rule.selector))
      .map((part) => part.trim())
      .filter((part) => part !== '' && !part.startsWith(':root') && part !== 'html' && part !== 'body')
      .some((part) => root.matches(part) || root.querySelectorAll(part).length > 0);
    if (!applies) continue;
    for (const match of rule.body.matchAll(/var\((--mtg-[a-z0-9-]+)[),]/g)) drawn.add(match[1] ?? '');
  }
  return drawn;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DECK_FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedDeck(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(DECK_FIXTURE, 'utf8')), DECK_FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const LOG = readReplayLog(fixtureText());

function at(mode: UiMode): UiRoute {
  return { mode, params: {} };
}

function shell(mode: UiMode, child: ReactElement): string {
  return renderToStaticMarkup(h(Shell, { mode, onSelectMode: () => undefined, children: child }));
}

/**
 * One rendered shell per mode, each on a full state rather than an empty one: an
 * empty route paints a fraction of its tokens, and the ones it would have
 * painted are exactly where a missing scope shows up. A `Record<UiMode, ...>`
 * rather than a `Map`, on purpose, because it is the mechanism that makes a new
 * route impossible to forget: adding a mode to `UI_MODES` fails `tsc` here until
 * somebody renders it.
 */
const ROUTE_MARKUP: Readonly<Record<UiMode, () => string>> = {
  play: () =>
    shell(
      'play',
      h(PlayRoute, {
        config: dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' }).config,
      }),
    ),
  draft: () =>
    shell(
      'draft',
      h(DraftRoute, {
        set: { status: 'ready', cards: EXAMPLE_CARDS },
        params: { seed: 'theme/draft' },
        onSetParams: () => undefined,
      }),
    ),
  deck: () => shell('deck', h(DeckRoute, { state: { status: 'ready', deck: committedDeck() } })),
  analysis: () => shell('analysis', h(AnalysisRoute, { state: { status: 'ready', log: LOG } })),
  replay: () =>
    shell('replay', h(ReplayRoute, { log: LOG, route: at('replay'), onSetParams: () => undefined })),
  cards: () =>
    shell('cards', h(CardsRoute, { cards: EXAMPLE_CARDS, route: at('cards'), onSetParams: () => undefined })),
};

/** Every route's shell, rendered once and reused by every paint. */
let renderedOnce: string | null = null;
function renderedRoutes(): string {
  if (renderedOnce === null) renderedOnce = UI_MODES.map((mode) => ROUTE_MARKUP[mode]()).join('');
  return renderedOnce;
}

/**
 * The sheet, its dark-preference form, its parse and the rendered routes, each
 * computed once for the file.
 *
 * All four are pure and none of them depends on the theme: the markup a route
 * produces is the same markup whatever palette it will be measured under, and
 * the cascade is the only thing a paint changes. Recomputing them per paint was
 * this file's whole cost, and vitest.config.ts is explicit that the answer to a
 * CPU-bound test is to state its cost rather than to raise the default ceiling.
 */
const SHEET: string = uiStyleSheet();
const DARK_PREFERENCE_SHEET: string = underDarkPreference(SHEET);
const SHEET_RULES: readonly Rule[] = rulesOf(SHEET);
const DARK_PREFERENCE_RULES: readonly Rule[] = rulesOf(DARK_PREFERENCE_SHEET);

/** The class of the element standing in for everything outside a route. */
const OUTSIDE_CLASS = 'mtg-not-a-route';

interface RoutePaint {
  readonly root: ElementLike;
  /**
   * Where a token is read: the scope root, and the last element in the route's
   * subtree. Custom properties inherit, so a scope that covered the shell and
   * stopped is a scope some leaf still resolves the document's value on.
   */
  readonly probes: readonly ElementLike[];
  /** Tokens this route's own rules reference, read off the rendered route. */
  readonly drawn: ReadonlySet<string>;
}

interface Painted {
  readonly routes: ReadonlyMap<UiMode, RoutePaint>;
  /** In the document, inside no shell: the ground a card file resolves on. */
  readonly outside: ElementLike;
  /**
   * The root element. A route's custom properties reach it by inheriting down
   * from the scope on its shell, but the viewport reads `color-scheme` off the
   * root and nowhere else — one level above every scope — so the scrollbar down
   * the right edge of a scrolling route is decided here rather than there.
   */
  readonly documentRoot: ElementLike;
}

function deepest(root: ElementLike): ElementLike {
  const all = root.querySelectorAll('*');
  const last = all.item(all.length - 1);
  if (last === null) throw new Error('a route rendered no elements below its shell');
  return last;
}

/**
 * Mounts a sheet and every route, and returns the elements to measure on. All
 * five shells share one document so a single cascade decides them all, which is
 * the arrangement the claim is about: one theme, five routes, one answer, plus a
 * sixth element outside them all that has to answer differently.
 */
function mount(sheet: string, theme: 'system' | 'dark', body: string): DocumentLike {
  const { document } = windowLike();
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = sheet;
  document.head.appendChild(style);
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = body;
  return document;
}

/**
 * The same sheet over a document with no shell in it at all: the arrangement
 * `packages/card-render/src/palette.ts` ships, and the contrast case for the
 * root's own declarations. A rule that keys on a route being present has to stop
 * applying when none is.
 */
function paintWithoutRoutes(sheet: string, theme: 'system' | 'dark'): ElementLike {
  return mount(sheet, theme, '').documentElement;
}

function paint(sheet: string, theme: 'system' | 'dark'): Painted {
  const document = mount(sheet, theme, `${renderedRoutes()}<div class="${OUTSIDE_CLASS}"></div>`);
  const rules = sheet === SHEET ? SHEET_RULES : DARK_PREFERENCE_RULES;
  const routes = new Map<UiMode, RoutePaint>();
  for (const mode of UI_MODES) {
    const root = document.body.querySelector(routeScope(mode));
    if (root === null) throw new Error(`the ${mode} shell did not render`);
    routes.set(mode, { root, probes: [root, deepest(root)], drawn: tokensDrawnUnder(root, rules) });
  }
  const outside = document.body.querySelector(`.${OUTSIDE_CLASS}`);
  if (outside === null) throw new Error('the out-of-scope element did not mount');
  return { routes, outside, documentRoot: document.documentElement };
}

/**
 * The two ways a viewer ends up in dark, each painted and measured before the
 * next one is painted.
 *
 * Never two paints into an array first. All paints share one jsdom document, so
 * the second replaces the first's markup and leaves the first's elements
 * detached, and a detached scope root goes on matching its own scope rule with
 * nothing above it: it answers "paper" whether or not the cascade would have
 * said so. That reads as a pass.
 */
function eachDarkPaint(measure: (painted: Painted) => void): void {
  measure(paint(SHEET, 'dark'));
  measure(paint(DARK_PREFERENCE_SHEET, 'system'));
}

function resolve(element: ElementLike, token: string): string {
  return normalize(windowLike().getComputedStyle(element).getPropertyValue(token));
}

function routeOf(painted: Painted, mode: UiMode): RoutePaint {
  const found = painted.routes.get(mode);
  if (found === undefined) throw new Error(`${mode} was never painted`);
  return found;
}

/**
 * The declarations either palette themes that this route draws with.
 *
 * A custom property counts when a rule matching something in the route
 * references it, which is read off the sheet. Everything else counts always:
 * `color-scheme` inherits into every element under the scope, and the browser
 * paints the scrollbar and the native controls from it without any rule of ours
 * naming it, so "which rule references it" is the wrong question to ask of it.
 */
function themedAndDrawn(route: RoutePaint): readonly string[] {
  return THEMED.filter((token) => route.drawn.has(token) || NATIVE.includes(token));
}

/** Every route and token where the route resolved something other than paper. */
function notPaper(painted: Painted): readonly string[] {
  const wrong: string[] = [];
  for (const mode of UI_MODES) {
    const route = routeOf(painted, mode);
    for (const token of themedAndDrawn(route)) {
      for (const probe of route.probes) {
        if (resolve(probe, token) !== paperValue(token)) wrong.push(`${mode}: ${token}`);
      }
    }
  }
  return [...new Set(wrong)];
}

/**
 * Every test below paints: five whole routes into one jsdom document, then a
 * computed custom property per token per probe. That makes this file CPU-bound
 * rather than instant, and vitest.config.ts is explicit about where the cost is
 * paid. `packages/setgen`, `packages/sim`, `packages/slice`, `packages/cube`,
 * `packages/ui/test/play/play.test.ts` and `packages/ui/test/replay/viewer.test.ts`
 * all state a budget at their own call site instead of raising the 5s default,
 * because the 5s ceiling everywhere else is what turns a genuine hang into a
 * fast failure.
 *
 * Measured on a quiet box: the whole file runs in about two seconds. Measured
 * on this one, with sibling worktrees running their own suites and a load
 * average of 135 on 16 cores, the two-paint test below went past 5s and failed.
 * Nothing here loops without a bound, so the budget buys tolerance for a busy
 * machine and not tolerance for a test that never finishes.
 */
const PAINT_BUDGET_MS = 30_000;

describe('what each route draws with', { timeout: PAINT_BUDGET_MS }, () => {
  it('is read off the rendered route rather than listed here', () => {
    const painted = paint(SHEET, 'system');
    // A matcher that quietly stopped matching would make every assertion below
    // vacuous, so each route's set has to be substantial and the union is
    // checked for the four families it must contain: the table, a card's
    // identity, the chrome it sits in, and the ink on it. Measured today:
    // play 28, deck 18, replay 18, cards 36, and analysis thinnest at 11, each
    // of them one more than before `color-scheme` was counted.
    const union = new Set<string>();
    for (const mode of UI_MODES) {
      const drawn = themedAndDrawn(routeOf(painted, mode));
      expect(drawn.length, `${mode} draws with almost nothing`).toBeGreaterThan(8);
      for (const token of drawn) union.add(token);
    }
    expect([...union]).toContain('--mtg-mat');
    expect([...union]).toContain('--mtg-mat-well');
    expect([...union]).toContain('--mtg-color-w');
    expect([...union]).toContain('--mtg-surface-raised');
    expect([...union]).toContain('--mtg-ink');
  });

  it('is measured below the shell as well as on it', () => {
    const painted = paint(SHEET, 'system');
    for (const mode of UI_MODES) {
      const route = routeOf(painted, mode);
      expect(route.probes.length).toBe(2);
      expect(route.probes[1], `${mode} was measured only on its shell`).not.toBe(route.root);
    }
  });
});

describe('every route the app can show', { timeout: PAINT_BUDGET_MS }, () => {
  it('has a token scope in the shipped sheet', () => {
    const selectors = new Set(SHEET_RULES.map((rule) => rule.selector));
    const missing = UI_MODES.filter((mode) => !selectors.has(routeScope(mode)));
    expect(missing).toEqual([]);
  });

  it('resolves every token it draws with to paper under a dark system preference', () => {
    expect(notPaper(paint(DARK_PREFERENCE_SHEET, 'system'))).toEqual([]);
  });

  it('resolves every token it draws with to paper under a pinned dark theme', () => {
    expect(notPaper(paint(SHEET, 'dark'))).toEqual([]);
  });
});

/**
 * The property the two retired "leaves the analysis route dark" tests were
 * protecting: a scope applies where it is registered and nowhere else. No route
 * can be the contrast now that every route is paper, so the contrast is the
 * document itself. `packages/card-render/src/palette.ts` embeds `TOKEN_CSS`
 * verbatim in a standalone SVG with no shell in it, so "the document still
 * themes" is a claim about a file that ships rather than about a hypothetical.
 */
describe('outside every route scope', { timeout: PAINT_BUDGET_MS }, () => {
  it('still follows a dark system preference', () => {
    const painted = paint(DARK_PREFERENCE_SHEET, 'system');
    const wrong = THEMED_PROPERTIES.filter((token) => resolve(painted.outside, token) !== darkValue(token));
    expect(wrong).toEqual([]);
  });

  it('still follows a pinned dark theme', () => {
    const painted = paint(SHEET, 'dark');
    const wrong = THEMED_PROPERTIES.filter((token) => resolve(painted.outside, token) !== darkValue(token));
    expect(wrong).toEqual([]);
  });

  it('is paper when nothing asked for dark', () => {
    const painted = paint(SHEET, 'system');
    const wrong = THEMED_PROPERTIES.filter((token) => resolve(painted.outside, token) !== paperValue(token));
    expect(wrong).toEqual([]);
  });
});

/**
 * The chrome the browser draws rather than the sheet: the bar down the right
 * edge of anything long enough to scroll, and the ground under a `<select>`. All
 * of it comes from `color-scheme`, and the viewport reads that off the root
 * element — one level above `.mtg-shell`, where every route scope lives — so no
 * number of route scopes could ever reach it. That is what shipped: paper pages
 * with a near-black scrollbar, on the routes long enough to have one.
 *
 * The three tests below are the whole claim. The root follows the route on the
 * page, both ways into dark; and with no route on the page it follows the
 * document again, which is what a standalone card file is and what keeps the
 * first two from being satisfied by a sheet that simply pinned the root light.
 *
 * Measured on the routes rather than at the root above, because
 * `THEMED_PROPERTIES` is what the three tests above ask of the ground and this
 * is the rest of the same palette: a declaration is either a custom property the
 * sheet paints through or a property the browser paints from, and both halves
 * are read off the same blocks.
 */
describe("the viewport's own chrome", { timeout: PAINT_BUDGET_MS }, () => {
  it('is drawn from declarations no rule in the sheet references', () => {
    expect(NATIVE).toContain('color-scheme');
    expect(SHEET).not.toContain('var(--mtg-color-scheme');
    for (const property of NATIVE) {
      expect(SHEET, `${property} is referenced through var()`).not.toContain(`var(${property})`);
    }
  });

  it('follows the route on the page, whatever put the viewer in dark', () => {
    expect(NATIVE.length).toBeGreaterThan(0);
    eachDarkPaint((painted) => {
      const wrong = NATIVE.filter(
        (property) => resolve(painted.documentRoot, property) !== paperValue(property),
      );
      expect(wrong).toEqual([]);
    });
  });

  it('follows the document again when no route is on the page', () => {
    for (const root of [
      paintWithoutRoutes(SHEET, 'dark'),
      paintWithoutRoutes(DARK_PREFERENCE_SHEET, 'system'),
    ]) {
      const wrong = NATIVE.filter((property) => resolve(root, property) !== darkValue(property));
      expect(wrong).toEqual([]);
    }
  });
});

/** The declarations of the one rule with exactly this selector. */
function ruleFor(css: string, selector: string): string {
  const rule = rulesOf(css).find((candidate) => candidate.selector === selector);
  if (rule === undefined) throw new Error(`the sheet has no ${selector} rule`);
  return rule.body;
}

/** The themed tokens a rule paints with; scale tokens are never re-valued. */
function themedTokensIn(body: string): readonly string[] {
  const referenced = [...body.matchAll(/var\((--mtg-[a-z0-9-]+)[),]/g)].map((match) => match[1] ?? '');
  return THEMED.filter((token) => referenced.includes(token));
}

describe('the ground the routes are painted on', { timeout: PAINT_BUDGET_MS }, () => {
  /**
   * `body` is outside every route scope: it is the element the document palette
   * resolves on, and the scope attribute sits one level in, on the shell. A
   * paint `body` performs is therefore performed in the *document's* theme and
   * inherited into the route as a finished value — a scoped route would draw
   * paper cards on a dark page, in dark-mode ink, and no token-name check would
   * see it.
   *
   * Read off the two rules rather than listed, so a themed token added to `body`
   * tomorrow is covered without anyone remembering to come back. It is checked
   * as text because it cannot be checked any other way here: jsdom substitutes
   * no `var()`, so the difference between "resolved at `body` in dark" and
   * "resolved at the shell in paper" is invisible to its computed style. The
   * resolution half of the claim is what the test below asserts.
   */
  it('is repainted by the shell for every themed token body uses', () => {
    const onBody = themedTokensIn(ruleFor(SHEET, 'body'));
    const onShell = themedTokensIn(ruleFor(SHEET, '.mtg-shell'));
    expect(onBody.length).toBeGreaterThan(0);
    expect(onBody.filter((token) => !onShell.includes(token))).toEqual([]);
  });

  it('resolves to paper on every route, whatever the theme', ({ task }) => {
    // Reads back the budget the runner applied: drop the describe option above
    // and this is 5000, so the docblock cannot outlive what it describes.
    expect(task.timeout, 'painting five routes twice needs its own budget under load').toBe(PAINT_BUDGET_MS);
    const ground = themedTokensIn(ruleFor(SHEET, 'body'));
    expect(ground.length).toBeGreaterThan(0);
    eachDarkPaint((painted) => {
      const wrong: string[] = [];
      for (const mode of UI_MODES) {
        for (const probe of routeOf(painted, mode).probes) {
          for (const token of ground) {
            if (resolve(probe, token) !== paperValue(token)) wrong.push(`${mode}: ${token}`);
          }
        }
      }
      expect([...new Set(wrong)]).toEqual([]);
      const outside = ground.filter((token) => resolve(painted.outside, token) !== darkValue(token));
      expect(outside).toEqual([]);
    });
  });
});
