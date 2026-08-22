/**
 * The proof sheet: every card in a set, as a real face, on one self-contained page.
 *
 * This is the surface a designer reviews a set on, and it is deliberately not
 * the running lab. The lab is a *player's* view — it opens one tab at a time,
 * it needs a server, and it needs the art and the symbol registry staged into
 * `public/` beside it. A reviewer is somewhere else, on someone else's machine,
 * looking at the whole set at once and writing down which cards are wrong. So
 * the output is one file with the pictures inside it: art arrives already
 * encoded as a data URI (`thumbs`), and the brace tokens are drawn with the
 * lab's own glyphs (`symbols: 'original'`) rather than referenced from a host
 * this page will never be able to reach. `render-set.ts` made both of those
 * choices first and for the same reason; this file is that argument applied to
 * a gallery instead of a print sheet.
 *
 * Two things it publishes that the lab does not. First, a **score** per card,
 * from `@mtg/deckbuild`'s own evaluator rather than a second opinion written
 * here — the review question that keeps recurring is "is this card worth a
 * slot", and the answer already exists in the code that drafts with it. A
 * review that disagreed with the drafter about which cards are weak would be a
 * review of the wrong set. Second, a **flag** per card that survives no
 * reload and reaches no server: the reviewer marks faces, types a line against
 * each, and copies the lot out as text. Persistence would need a backend, a
 * backend would need a host, and the reason this page exists is that it needs
 * neither.
 *
 * Pure: it takes documents and returns a string, so `test/design-review.test.ts`
 * can hold it to its promises without writing a file. The IO lives next door in
 * `design-review.ts`, the same split `frame-review-faces.ts` makes.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS } from '@mtg/deckbuild';
import { evaluateCard } from '@mtg/deckbuild';
import { Card } from '../src/card/Card';
import { cardColorIdentity } from '../src/card/identity';
import { uiStyleSheet } from '../src/styles/index';
import type { CardArt } from '../src/card/ArtSlot';

/** One art thumbnail, already encoded as a `data:` URI by the caller. */
export interface Thumb {
  readonly src: string;
  readonly alt: string;
}

/** How a piece of round-one feedback stands after the work done since. */
export type ChangeState = 'done' | 'partly' | 'open';

export interface ChangeNote {
  readonly note: string;
  readonly state: ChangeState;
  /** What the reviewer asked for, in the reviewer's own terms. */
  readonly asked: string;
  /** What is in the set now, in numbers taken from the set itself. */
  readonly now: string;
}

export interface ReviewPageInput {
  readonly title: string;
  readonly setName: string;
  readonly document: unknown;
  readonly thumbs: ReadonlyMap<string, Thumb>;
  readonly changes: readonly ChangeNote[];
}

interface Row {
  readonly card: DslCard;
  readonly art: CardArt | null;
  readonly score: number;
  readonly identity: string;
  readonly manaValue: number;
}

/**
 * Every card of `document`, in collector order, with its evaluation attached.
 *
 * Collector order rather than score order or color order, because a reviewer
 * reads a set the way it is printed and because the filter chips can reorder
 * a stable list but cannot recover one that arrived shuffled.
 */
export function reviewRows(document: unknown, thumbs: ReadonlyMap<string, Thumb>): readonly Row[] {
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error('not a set document: no "cards"');
  }
  const { cards } = document as { cards: unknown };
  if (!Array.isArray(cards)) throw new Error('not a set document: "cards" is not an array');
  const rows = cards.map((raw): Row => {
    const card = parseCard(raw);
    const thumb = thumbs.get(card.id);
    const evaluation = evaluateCard(card, DEFAULT_SCORE_WEIGHTS);
    return {
      card,
      art: thumb === undefined ? null : { src: thumb.src, alt: thumb.alt },
      score: evaluation.score,
      identity: cardColorIdentity(card),
      manaValue: evaluation.manaValue,
    };
  });
  return [...rows].sort((a, b) => a.card.set.collectorNumber - b.card.set.collectorNumber);
}

/** The type word a reviewer filters on, which is the card's kind and nothing finer. */
function typeWord(card: DslCard): string {
  return card.kind;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A score printed to one decimal, with its sign, because the interesting reading
 * is the distance from zero and a bare `0.4` next to a bare `-0.4` hides it.
 */
function scoreText(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

function tile(row: Row, index: number): string {
  const { card } = row;
  const face = renderToStaticMarkup(
    createElement(Card, { card, art: row.art, size: 'full', symbols: 'original' }),
  );
  const number = String(card.set.collectorNumber).padStart(3, '0');
  const stats = card.kind === 'creature' ? `${String(card.power)}/${String(card.toughness)}` : '—';
  const search = `${card.name} ${card.oracleText} ${card.subtypes.join(' ')}`.toLowerCase();
  return `<article class="rev-tile" id="card-${number}"
  data-identity="${row.identity}" data-rarity="${card.rarity}" data-type="${typeWord(card)}"
  data-mv="${String(row.manaValue)}" data-score="${row.score.toFixed(3)}" data-index="${String(index)}"
  data-number="${number}" data-name="${escapeHtml(card.name)}"
  data-search="${escapeHtml(search)}">
  <div class="rev-tile__face">${face}</div>
  <footer class="rev-tile__foot">
    <span class="rev-tile__no">${number}</span>
    <span class="rev-tile__stat">MV ${String(row.manaValue)}</span>
    <span class="rev-tile__stat">${stats}</span>
    <span class="rev-tile__score" data-sign="${row.score > 0 ? 'up' : row.score < 0 ? 'down' : 'flat'}">${scoreText(row.score)}</span>
    <button type="button" class="rev-flag" aria-pressed="false"
      aria-label="Flag ${escapeHtml(card.name)}">Flag</button>
  </footer>
  <label class="rev-tile__note">
    <span class="rev-sr">Note on ${escapeHtml(card.name)}</span>
    <input type="text" placeholder="What's wrong with it?" autocomplete="off">
  </label>
</article>`;
}

const STATE_WORD: Readonly<Record<ChangeState, string>> = {
  done: 'Addressed',
  partly: 'Partly',
  open: 'Still open',
};

function changeCard(change: ChangeNote): string {
  return `<li class="rev-change" data-state="${change.state}">
  <p class="rev-change__asked">${escapeHtml(change.asked)}</p>
  <p class="rev-change__state"><span class="rev-pill">${STATE_WORD[change.state]}</span><span class="rev-change__now">${escapeHtml(change.now)}</span></p>
  <p class="rev-change__note">${escapeHtml(change.note)}</p>
</li>`;
}

function counts(rows: readonly Row[]): string {
  const byKind = new Map<string, number>();
  for (const row of rows) byKind.set(row.card.kind, (byKind.get(row.card.kind) ?? 0) + 1);
  const order = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'];
  return order
    .filter((kind) => byKind.has(kind))
    .map((kind) => `<div class="rev-count"><dt>${kind}</dt><dd>${String(byKind.get(kind) ?? 0)}</dd></div>`)
    .join('');
}

const CHIP_IDENTITIES: readonly (readonly [string, string])[] = [
  ['w', 'White'],
  ['u', 'Blue'],
  ['b', 'Black'],
  ['r', 'Red'],
  ['g', 'Green'],
  ['m', 'Multicolor'],
  ['c', 'Colorless'],
];

function chips(name: string, entries: readonly (readonly [string, string])[]): string {
  return entries
    .map(
      ([value, label]) =>
        `<button type="button" class="rev-chip" data-facet="${name}" data-value="${value}" aria-pressed="false">${label}</button>`,
    )
    .join('');
}

/**
 * The page's own palette, kept entirely in `--rev-*` so that nothing here can
 * collide with the card faces' `--mtg-*` tokens.
 *
 * The chrome is deliberately quiet. Two hundred and eighty pieces of full-color
 * illustration are already on this page; a chrome with an opinion about color
 * would be competing with the thing it exists to display. So the ground is a
 * pale slate-green stone, the neutrals are biased the same way rather than left
 * gray, and the single warm note is a brass that carries every control the
 * reviewer touches. The faces themselves never change: `data-mtg-mode='cards'`
 * on the grid is how the lab already registers the paper palette in both
 * themes (`SCOPED_PALETTES` in `../src/styles/tokens.ts`), so a card is printed
 * paper whether the reviewer's machine is set to light or dark, which is the
 * only honest way to show a printed object.
 */
const REVIEW_CSS = `
:root {
  --rev-ground: #e4e7e2; --rev-surface: #f2f4f0; --rev-raise: #ffffff;
  --rev-ink: #1b211d; --rev-muted: #5d675f; --rev-rule: #c6ccc5;
  --rev-brass: #8c5f26; --rev-brass-soft: #ece0ca; --rev-teal: #1d5c58;
  --rev-up: #2f6b3c; --rev-down: #8e3b2e;
  --rev-display: 'Newsreader', Georgia, 'Times New Roman', serif;
  --rev-body: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --rev-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --rev-ground: #131712; --rev-surface: #1b201a; --rev-raise: #232922;
    --rev-ink: #e5eae3; --rev-muted: #93a096; --rev-rule: #2c332c;
    --rev-brass: #c69350; --rev-brass-soft: #3a2f1d; --rev-teal: #4ea79d;
    --rev-up: #7fb98a; --rev-down: #d98a78;
  }
}
:root[data-theme='dark'] {
  --rev-ground: #131712; --rev-surface: #1b201a; --rev-raise: #232922;
  --rev-ink: #e5eae3; --rev-muted: #93a096; --rev-rule: #2c332c;
  --rev-brass: #c69350; --rev-brass-soft: #3a2f1d; --rev-teal: #4ea79d;
  --rev-up: #7fb98a; --rev-down: #d98a78;
}
body {
  margin: 0; background: var(--rev-ground); color: var(--rev-ink);
  font-family: var(--rev-body); font-size: 15px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.rev-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
:focus-visible { outline: 2px solid var(--rev-brass); outline-offset: 2px; }

.rev-wrap { max-width: 1560px; margin: 0 auto; padding: 0 clamp(16px, 3vw, 40px) 120px; }

.rev-masthead {
  display: grid; gap: 18px; padding: clamp(32px, 6vw, 68px) 0 28px;
  border-bottom: 1px solid var(--rev-rule);
}
.rev-masthead__eyebrow {
  margin: 0; font-family: var(--rev-mono); font-size: 12px; letter-spacing: 0.13em;
  text-transform: uppercase; color: var(--rev-brass);
}
.rev-masthead h1 {
  margin: 0; font-family: var(--rev-display); font-weight: 500;
  font-size: clamp(38px, 6vw, 66px); line-height: 1.03; letter-spacing: -0.015em;
  text-wrap: balance;
}
.rev-masthead__lede {
  margin: 0; max-width: 62ch; color: var(--rev-muted); font-size: 17px;
}
.rev-counts { display: flex; flex-wrap: wrap; gap: 0; margin: 6px 0 0; }
.rev-count {
  display: flex; align-items: baseline; gap: 7px; padding: 0 18px 0 0; margin: 0 18px 0 0;
  border-right: 1px solid var(--rev-rule);
}
.rev-count:last-child { border-right: 0; margin-right: 0; padding-right: 0; }
.rev-count dt { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rev-muted); }
.rev-count dd {
  margin: 0; font-family: var(--rev-mono); font-variant-numeric: tabular-nums;
  font-size: 19px; font-weight: 500;
}

.rev-section { padding: 44px 0 10px; }
.rev-section h2 {
  margin: 0 0 6px; font-family: var(--rev-display); font-weight: 500;
  font-size: clamp(24px, 3vw, 32px); letter-spacing: -0.01em;
}
.rev-section p.rev-standfirst { margin: 0 0 26px; max-width: 66ch; color: var(--rev-muted); }

.rev-changes { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px;
  background: var(--rev-rule); border: 1px solid var(--rev-rule); border-radius: 3px; overflow: hidden; }
.rev-change {
  display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 4px 28px;
  padding: 18px 20px; background: var(--rev-surface);
}
.rev-change__asked { grid-column: 1; margin: 0; font-size: 16px; font-weight: 500; }
.rev-change__note { grid-column: 1; margin: 0; color: var(--rev-muted); font-size: 14px; max-width: 60ch; }
.rev-change__state { grid-column: 2; grid-row: 1 / span 2; margin: 0; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.rev-change__now { font-family: var(--rev-mono); font-size: 13px; color: var(--rev-ink); font-variant-numeric: tabular-nums; }
.rev-pill {
  font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; font-weight: 600;
  padding: 3px 9px; border-radius: 2px; border: 1px solid currentColor;
}
.rev-change[data-state='done'] .rev-pill { color: var(--rev-teal); }
.rev-change[data-state='partly'] .rev-pill { color: var(--rev-brass); }
.rev-change[data-state='open'] .rev-pill { color: var(--rev-down); }
@media (max-width: 720px) {
  .rev-change { grid-template-columns: minmax(0, 1fr); }
  .rev-change__state { grid-column: 1; grid-row: auto; flex-direction: row; align-items: center; gap: 12px; }
}

.rev-bar {
  position: sticky; top: 0; z-index: 20; margin: 34px 0 0;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
  padding: 12px 0; background: var(--rev-ground);
  border-bottom: 1px solid var(--rev-rule);
}
.rev-bar__group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rev-bar__label {
  font-family: var(--rev-mono); font-size: 11px; letter-spacing: 0.11em;
  text-transform: uppercase; color: var(--rev-muted); margin-right: 2px;
}
.rev-search {
  flex: 1 1 190px; min-width: 150px; padding: 7px 11px; font: inherit; font-size: 14px;
  color: var(--rev-ink); background: var(--rev-raise);
  border: 1px solid var(--rev-rule); border-radius: 3px;
}
.rev-chip, .rev-toggle, .rev-select, .rev-action {
  font: inherit; font-size: 13px; color: var(--rev-ink); background: var(--rev-raise);
  border: 1px solid var(--rev-rule); border-radius: 3px; padding: 6px 11px; cursor: pointer;
}
.rev-chip[aria-pressed='true'], .rev-toggle[aria-pressed='true'] {
  background: var(--rev-brass); border-color: var(--rev-brass); color: #fbf7ef; font-weight: 500;
}
.rev-chip[data-facet='identity'][data-value='w'] { border-left: 4px solid var(--mtg-identity-w, #d9d2bd); }
.rev-chip[data-facet='identity'][data-value='u'] { border-left: 4px solid var(--mtg-identity-u, #3d6ea8); }
.rev-chip[data-facet='identity'][data-value='b'] { border-left: 4px solid var(--mtg-identity-b, #4a4348); }
.rev-chip[data-facet='identity'][data-value='r'] { border-left: 4px solid var(--mtg-identity-r, #b04a37); }
.rev-chip[data-facet='identity'][data-value='g'] { border-left: 4px solid var(--mtg-identity-g, #4a7c52); }
.rev-chip[data-facet='identity'][data-value='m'] { border-left: 4px solid var(--mtg-identity-m, #c2a33f); }
.rev-chip[data-facet='identity'][data-value='c'] { border-left: 4px solid var(--mtg-identity-c, #9a958c); }

.rev-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
  gap: 26px 20px; padding: 30px 0 0; align-items: start;
}
.rev-tile {
  display: grid; gap: 8px; content-visibility: auto; contain-intrinsic-size: 460px;
}
.rev-tile[hidden] { display: none; }
.rev-tile__face { display: flex; justify-content: center; }
.rev-tile__face .mtg-card { --card-w: 15.5rem; }
.rev-tile__foot {
  display: flex; align-items: center; gap: 9px;
  font-family: var(--rev-mono); font-size: 12px; font-variant-numeric: tabular-nums;
  color: var(--rev-muted);
}
.rev-tile__no { color: var(--rev-ink); font-weight: 500; }
.rev-tile__score { margin-left: auto; font-weight: 600; }
.rev-tile__score[data-sign='up'] { color: var(--rev-up); }
.rev-tile__score[data-sign='down'] { color: var(--rev-down); }
.rev-flag {
  font: inherit; font-family: var(--rev-body); font-size: 12px; padding: 3px 10px;
  color: var(--rev-muted); background: transparent; cursor: pointer;
  border: 1px solid var(--rev-rule); border-radius: 2px;
}
.rev-flag[aria-pressed='true'] {
  background: var(--rev-brass); border-color: var(--rev-brass); color: #fbf7ef; font-weight: 600;
}
.rev-tile__note { display: none; }
.rev-tile[data-flagged='true'] .rev-tile__note { display: block; }
.rev-tile__note input {
  width: 100%; box-sizing: border-box; padding: 6px 9px; font: inherit; font-size: 13px;
  color: var(--rev-ink); background: var(--rev-raise);
  border: 1px solid var(--rev-brass); border-radius: 3px;
}
.rev-tile[data-flagged='true'] .rev-tile__face .mtg-card {
  box-shadow: 0 0 0 3px var(--rev-brass), var(--mtg-shadow-card);
}

.rev-empty { padding: 60px 0; color: var(--rev-muted); font-size: 16px; }
.rev-empty[hidden] { display: none; }

.rev-dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 11px clamp(16px, 3vw, 40px);
  background: var(--rev-surface); border-top: 1px solid var(--rev-rule);
}
.rev-dock__count { font-family: var(--rev-mono); font-size: 13px; font-variant-numeric: tabular-nums; }
.rev-dock__hint { color: var(--rev-muted); font-size: 13px; margin-right: auto; }
.rev-action { background: var(--rev-brass); border-color: var(--rev-brass); color: #fbf7ef; font-weight: 500; }
.rev-action[disabled] { opacity: 0.45; cursor: default; }
.rev-out {
  position: absolute; left: -9999px; top: 0; width: 1px; height: 1px;
}
`;

/**
 * The reviewer's controls, written as one script with no dependency and no
 * network. Filtering, sorting and flagging are all view state over a DOM that
 * already holds every card, which is why the page can afford to be static: no
 * request re-renders anything, so there is nothing to serve.
 *
 * The flags are the point. They live in memory, they are copied out as text,
 * and they are never stored — a page that promised to remember them would need
 * a backend, and a review that cannot leave the machine it was written on is
 * worse than one that ends in a paste.
 */
const REVIEW_JS = `
(function () {
  var grid = document.getElementById('rev-grid');
  var tiles = Array.prototype.slice.call(grid.querySelectorAll('.rev-tile'));
  var empty = document.getElementById('rev-empty');
  var dockCount = document.getElementById('rev-count');
  var copyButton = document.getElementById('rev-copy');
  var clearButton = document.getElementById('rev-clear');
  var searchBox = document.getElementById('rev-search');
  var sortBox = document.getElementById('rev-sort');
  var onlyButton = document.getElementById('rev-only');
  var facets = { identity: [], rarity: [], type: [] };
  var onlyFlagged = false;
  var query = '';

  function has(list, value) { return list.indexOf(value) !== -1; }

  function matches(tile) {
    if (onlyFlagged && tile.dataset.flagged !== 'true') return false;
    for (var name in facets) {
      var chosen = facets[name];
      if (chosen.length > 0 && !has(chosen, tile.dataset[name])) return false;
    }
    if (query !== '' && tile.dataset.search.indexOf(query) === -1
        && tile.dataset.number.indexOf(query) === -1) return false;
    return true;
  }

  function apply() {
    var shown = 0;
    for (var i = 0; i < tiles.length; i += 1) {
      var visible = matches(tiles[i]);
      tiles[i].hidden = !visible;
      if (visible) shown += 1;
    }
    empty.hidden = shown > 0;
    empty.textContent = 'No card matches those filters. ' + String(tiles.length) + ' cards in the set.';
  }

  function order() {
    var mode = sortBox.value;
    var sorted = tiles.slice();
    if (mode === 'weakest') {
      sorted.sort(function (a, b) { return Number(a.dataset.score) - Number(b.dataset.score); });
    } else if (mode === 'strongest') {
      sorted.sort(function (a, b) { return Number(b.dataset.score) - Number(a.dataset.score); });
    } else if (mode === 'mana') {
      sorted.sort(function (a, b) {
        var byMana = Number(a.dataset.mv) - Number(b.dataset.mv);
        return byMana !== 0 ? byMana : Number(a.dataset.index) - Number(b.dataset.index);
      });
    } else {
      sorted.sort(function (a, b) { return Number(a.dataset.index) - Number(b.dataset.index); });
    }
    for (var i = 0; i < sorted.length; i += 1) grid.appendChild(sorted[i]);
  }

  function flagged() {
    return tiles.filter(function (tile) { return tile.dataset.flagged === 'true'; });
  }

  function refreshDock() {
    var marked = flagged();
    dockCount.textContent = marked.length === 0
      ? 'Nothing flagged yet'
      : String(marked.length) + (marked.length === 1 ? ' card flagged' : ' cards flagged');
    copyButton.disabled = marked.length === 0;
  }

  function reportText() {
    return flagged().map(function (tile) {
      var note = tile.querySelector('.rev-tile__note input').value.trim();
      return tile.dataset.number + '  ' + tile.dataset.name + (note === '' ? '' : '  -  ' + note);
    }).join('\\n');
  }

  grid.addEventListener('click', function (event) {
    var button = event.target.closest('.rev-flag');
    if (button === null) return;
    var tile = button.closest('.rev-tile');
    var next = tile.dataset.flagged !== 'true';
    tile.dataset.flagged = next ? 'true' : 'false';
    button.setAttribute('aria-pressed', next ? 'true' : 'false');
    button.textContent = next ? 'Flagged' : 'Flag';
    if (next) tile.querySelector('.rev-tile__note input').focus();
    refreshDock();
    if (onlyFlagged) apply();
  });

  document.addEventListener('click', function (event) {
    var chip = event.target.closest('.rev-chip');
    if (chip === null) return;
    var name = chip.dataset.facet;
    var value = chip.dataset.value;
    var chosen = facets[name];
    var at = chosen.indexOf(value);
    if (at === -1) { chosen.push(value); } else { chosen.splice(at, 1); }
    chip.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
    apply();
  });

  searchBox.addEventListener('input', function () {
    query = searchBox.value.trim().toLowerCase();
    apply();
  });

  sortBox.addEventListener('change', order);

  onlyButton.addEventListener('click', function () {
    onlyFlagged = !onlyFlagged;
    onlyButton.setAttribute('aria-pressed', onlyFlagged ? 'true' : 'false');
    apply();
  });

  clearButton.addEventListener('click', function () {
    facets = { identity: [], rarity: [], type: [] };
    onlyFlagged = false;
    query = '';
    searchBox.value = '';
    onlyButton.setAttribute('aria-pressed', 'false');
    var chips = document.querySelectorAll('.rev-chip');
    for (var i = 0; i < chips.length; i += 1) chips[i].setAttribute('aria-pressed', 'false');
    apply();
  });

  copyButton.addEventListener('click', function () {
    var text = reportText();
    var say = function (word) {
      copyButton.textContent = word;
      window.setTimeout(function () { copyButton.textContent = 'Copy flagged cards'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say('Copied'); },
        function () { fallback(text, say); });
    } else {
      fallback(text, say);
    }
  });

  function fallback(text, say) {
    var box = document.getElementById('rev-out');
    box.value = text;
    box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    say(ok ? 'Copied' : 'Press Ctrl+C');
  }

  refreshDock();
  apply();
})();
`;

/** The whole review, as one self-contained document. */
export function reviewPage(input: ReviewPageInput): string {
  const rows = reviewRows(input.document, input.thumbs);
  const grid = rows.map((row, index) => tile(row, index)).join('\n');
  const rarities: readonly (readonly [string, string])[] = [
    ['common', 'Common'],
    ['uncommon', 'Uncommon'],
    ['rare', 'Rare'],
    ['mythic', 'Mythic'],
  ];
  const types: readonly (readonly [string, string])[] = [
    ['creature', 'Creature'],
    ['instant', 'Instant'],
    ['sorcery', 'Sorcery'],
    ['artifact', 'Artifact'],
    ['enchantment', 'Enchantment'],
    ['planeswalker', 'Planeswalker'],
  ];
  const weak = rows.filter((row) => row.score <= 0).length;
  return `<title>${escapeHtml(input.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">
<style>${uiStyleSheet()}</style>
<style>${REVIEW_CSS}</style>
<div class="rev-wrap">
  <header class="rev-masthead">
    <p class="rev-masthead__eyebrow">Design review, round two</p>
    <h1>${escapeHtml(input.setName)}</h1>
    <p class="rev-masthead__lede">Every card in the set, printed as it will play. Read it in
      collector order, or sort the weakest to the front. Flag anything that is wrong, write a line
      against it, and copy the whole list out at the bottom.</p>
    <dl class="rev-counts">${counts(rows)}<div class="rev-count"><dt>total</dt><dd>${String(rows.length)}</dd></div></dl>
  </header>

  <section class="rev-section">
    <h2>What changed since your last pass</h2>
    <p class="rev-standfirst">Your eight notes, each with what is in the set now. The numbers are
      counted from this build, not remembered. Three of them are still open, and they are the ones
      worth your time.</p>
    <ol class="rev-changes">${input.changes.map((change) => changeCard(change)).join('\n')}</ol>
  </section>

  <section class="rev-section">
    <h2>The set</h2>
    <p class="rev-standfirst">The score beside each card is the drafter's own valuation, the same
      number the deck builder picks with. Zero is a card the drafter would not take;
      ${String(weak)} cards in the set are at or below it.</p>
  </section>

  <div class="rev-bar">
    <input type="search" id="rev-search" class="rev-search" placeholder="Search name, text or number" aria-label="Search cards">
    <div class="rev-bar__group"><span class="rev-bar__label">Color</span>${chips('identity', CHIP_IDENTITIES)}</div>
    <div class="rev-bar__group"><span class="rev-bar__label">Rarity</span>${chips('rarity', rarities)}</div>
    <div class="rev-bar__group"><span class="rev-bar__label">Type</span>${chips('type', types)}</div>
    <div class="rev-bar__group">
      <label class="rev-bar__label" for="rev-sort">Sort</label>
      <select id="rev-sort" class="rev-select">
        <option value="collector">Collector order</option>
        <option value="weakest">Weakest first</option>
        <option value="strongest">Strongest first</option>
        <option value="mana">Mana value</option>
      </select>
      <button type="button" id="rev-only" class="rev-toggle" aria-pressed="false">Flagged only</button>
      <button type="button" id="rev-clear" class="rev-toggle">Reset</button>
    </div>
  </div>

  <div class="rev-grid" id="rev-grid" data-mtg-mode="cards">${grid}</div>
  <p class="rev-empty" id="rev-empty" hidden></p>
</div>

<div class="rev-dock">
  <span class="rev-dock__count" id="rev-count">Nothing flagged yet</span>
  <span class="rev-dock__hint">Flags live in this tab only. Copy them out before you close it.</span>
  <button type="button" class="rev-action" id="rev-copy" disabled>Copy flagged cards</button>
</div>
<textarea class="rev-out" id="rev-out" aria-hidden="true" tabindex="-1"></textarea>
<script>${REVIEW_JS}</script>
`;
}
