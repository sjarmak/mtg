/**
 * One class, one sheet that owns it.
 *
 * `mtg-aqxi.7`. `../../src/styles/panel.ts` arrived with a rule for
 * `.mtg-status`, which `../../src/styles/board/status.ts` had owned since long
 * before it — a player's vitals read across, drawn by
 * `../../src/board/PlayerStatus.ts`. Two bare single-class selectors tie on
 * specificity and the later sheet wins, and `../../src/styles/index.ts` joins
 * the panel sheet after the board's, so the replay timeline's status line
 * silently took a draft screen's wrap and gaps. Nothing failed; it just drew
 * wrong on a surface nobody was looking at.
 *
 * The check is derived rather than listed: it reads the sheets, extracts every
 * class each one declares a *bare* rule for — a selector that is the class
 * itself, with attributes or pseudo-classes but no ancestor and no combinator,
 * which is the shape that says "this sheet decides what this thing is" — and
 * fails when two sheets claim one. A descendant rule (`.mtg-thumbs .mtg-card`)
 * is not a claim of ownership and is not counted; that is how a sheet is
 * supposed to reach into another's vocabulary.
 *
 * `SHARED` is the exceptions, and each is a route sheet deliberately extending
 * a component sheet it is loaded after. Adding to it is a decision to make;
 * arriving in the diff by accident is what this test exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { BASE_CSS } from '../../src/styles/base';
import { CARD_CSS } from '../../src/styles/card';
import { SYMBOL_CSS } from '../../src/styles/symbols';
import { BOARD_CSS } from '../../src/styles/board';
import { VIEWS_CSS } from '../../src/styles/views';
import { PANEL_CSS } from '../../src/styles/panel';
import { DECK_CARD_CSS } from '../../src/styles/deck-card';
import { DECK_CSS } from '../../src/styles/deck';
import { REPLAY_CSS } from '../../src/styles/replay';
import { DESIGN_CSS } from '../../src/styles/design';
import { WORKBENCH_CSS } from '../../src/styles/workbench';

/**
 * The component and route sheets, by the name they carry in `index.ts`.
 *
 * `TOKEN_CSS` and its two scoped blocks are not here because they declare no
 * component, and `TOUCH_CSS` and `MOBILE_CSS` are not here because re-answering
 * another sheet's rule is the whole of what they do — `index.ts` puts them last
 * for exactly that reason.
 */
const SHEETS: Readonly<Record<string, string>> = {
  BASE_CSS,
  CARD_CSS,
  SYMBOL_CSS,
  BOARD_CSS,
  VIEWS_CSS,
  PANEL_CSS,
  DECK_CARD_CSS,
  DECK_CSS,
  REPLAY_CSS,
  DESIGN_CSS,
  WORKBENCH_CSS,
};

/**
 * A sheet extending another on purpose, and which pair it is.
 *
 * Three route sheets adding to a component sheet they are loaded after, and one
 * that reaches back up to the shell: the panel sheet's `.mtg-shell:has(
 * .mtg-screen)` is what turns a scrolling document into a page that fits the
 * viewport once, and the shell is the only element high enough to say it on.
 */
const SHARED: Readonly<Record<string, readonly string[]>> = {
  'mtg-deck-card': ['CARD_CSS', 'DECK_CSS'],
  // The design route colors a refused field's border, on the two form controls
  // the component sheets own. State only, and only on `[data-refused='true']`.
  'mtg-input': ['BASE_CSS', 'DESIGN_CSS'],
  'mtg-pip': ['CARD_CSS', 'SYMBOL_CSS'],
  'mtg-replay': ['VIEWS_CSS', 'REPLAY_CSS'],
  'mtg-select': ['VIEWS_CSS', 'DESIGN_CSS'],
  'mtg-shell': ['BASE_CSS', 'PANEL_CSS'],
};

const BARE = /^\.(mtg-[a-z0-9-]+)(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*$/;

/**
 * The same shape as `BARE`, with `_` allowed in the name.
 *
 * `BARE` reads ownership, which lives on the block (`mtg-deck-card`), and an
 * element class carries its block's name as its own prefix so two sheets cannot
 * contest one by accident. The redeclaration check below is the opposite case:
 * `.mtg-workbench__row` was declared twice **inside one sheet**, so the name it
 * has to be able to read is exactly the one with the underscores in it.
 */
const SOLE = /^\.(mtg-[a-z0-9_-]+)(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*$/;

/**
 * Selectors a sheet deliberately declares twice, and which sheet does it.
 *
 * Later rules that *add* to an earlier one are a real pattern here and each is
 * commented where it is written: `BOARD_CSS` is several sub-sheets concatenated
 * (`board/mat.ts` states what a side is, `board/band.ts` rounds it), and
 * `VIEWS_CSS` pins the sealed builder's problem list after describing it. What
 * this map exists to catch is the other kind, which has no comment because
 * nobody knew they were doing it: two rules that both say what a thing *is*,
 * tying on specificity, the later one winning silently. Adding to this list is
 * a decision to make; arriving in the diff by accident is the failure.
 */
const REDECLARED: Readonly<Record<string, readonly string[]>> = {
  BOARD_CSS: ['.mtg-board__divider', '.mtg-board__side'],
  VIEWS_CSS: ['.mtg-play__notes'],
};

/**
 * Every class this sheet declares a bare rule for.
 *
 * Comments come out first, and that is not tidying: a selector's head is the
 * text between the previous rule's closing brace and its own opening one, and
 * these sheets put a paragraph there. Left in, the head of every commented rule
 * is a paragraph plus a selector, which matches nothing — so the first version
 * of this check read three classes out of the panel sheet's six and would have
 * passed the collision it was written for.
 */
function owned(css: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, ' ').split('{')) {
    const head = block.split('}').pop() ?? '';
    for (const selector of head.split(',')) {
      const found = BARE.exec(selector.trim());
      const name = found?.[1];
      if (name !== undefined) out.add(name);
    }
  }
  return out;
}

/**
 * Every top-level rule head in a sheet, in source order.
 *
 * Top-level because a rule inside `@media` is an override of the rule outside
 * it, which is the whole point of writing one; a check that counted those as
 * duplicates would ban the one thing a media query is for. Depth is tracked
 * rather than the at-rule matched, so `@supports` and any future at-rule are
 * covered without naming them.
 */
function topLevelHeads(css: string): readonly string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const heads: string[] = [];
  let depth = 0;
  let head = '';
  for (const character of clean) {
    if (character === '{') {
      if (depth === 0) heads.push(head);
      head = '';
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      head = '';
      continue;
    }
    if (depth === 0) head += character;
  }
  return heads;
}

describe('the stylesheet layer', () => {
  it('gives every class exactly one sheet that decides what it is', () => {
    const claims = new Map<string, string[]>();
    for (const [sheet, css] of Object.entries(SHEETS)) {
      for (const name of owned(css)) {
        claims.set(name, [...(claims.get(name) ?? []), sheet]);
      }
    }
    const contested = [...claims]
      .filter(([, sheets]) => sheets.length > 1)
      .sort(([left], [right]) => left.localeCompare(right));
    expect(Object.fromEntries(contested)).toEqual(SHARED);
  });

  it('gives every class exactly one bare rule inside the sheet that owns it', () => {
    // The sibling of the check above, and the one that would have caught
    // `mtg-yp33`'s: `../../src/styles/workbench.ts` declared
    // `.mtg-workbench__row` twice, once for the form's four number fields and
    // once for a shelf row. Two bare rules on one class tie on specificity and
    // the later one wins, so the number fields were drawn as a bordered,
    // pointer-cursored column and the form grew by 1,200 pixels. One sheet, so
    // the ownership check above could not see it.
    const twice: Record<string, readonly string[]> = {};
    for (const [sheet, css] of Object.entries(SHEETS)) {
      const defined = new Map<string, number>();
      for (const head of topLevelHeads(css)) {
        // The selector alone in its head, which is where a sheet says what a
        // thing *is*. Two other shapes are not this and are not counted: an
        // attribute or pseudo-class qualifier (`.mtg-choice[data-selected]`) is
        // a state of the thing, and a grouped head
        // (`.mtg-play-route, .mtg-live`) is a declaration shared across several
        // things. Two definitions of one thing is what this counts.
        const written = head.trim();
        if (written.includes(',') || !SOLE.test(written)) continue;
        defined.set(written, (defined.get(written) ?? 0) + 1);
      }
      const repeated = [...defined].filter(([, count]) => count > 1).map(([written]) => written);
      if (repeated.length > 0) twice[sheet] = repeated.sort();
    }
    expect(twice).toEqual(REDECLARED);
  });

  it('reads enough of each sheet to be able to fail', () => {
    // A regex that matched nothing would pass the test above forever.
    for (const [sheet, css] of Object.entries(SHEETS)) {
      expect(owned(css).size, `${sheet} declares no class of its own`).toBeGreaterThan(0);
    }
  });
});
