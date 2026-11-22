/**
 * Every class the markup uses is drawn by some sheet, or is declared a marker.
 *
 * `mtg-21s0`. The deck workbench shipped with `.mtg-button` on every one of its
 * buttons, a class no sheet in this workspace draws; the rest of the app writes
 * `.mtg-btn`. Measured on the running lab, all four rendered as raw user-agent
 * controls — Arial 13.33px, 2px outset border, no radius, 21px tall — so the
 * primary action of the screen was a 361x21px system button and `--primary`,
 * `--quiet` and the default variant were pixel-identical. It also escaped
 * `../../src/styles/touch.ts`, which floors `.mtg-btn` and friends at 44px under
 * a coarse pointer and knows nothing about `.mtg-button`, so a stated 44px
 * target was 21px. Nothing failed. It drew wrong.
 *
 * `sheet-ownership.test.ts` checks that no two sheets claim one class, and
 * `../touch-sheet.test.ts` checks that every selector the touch sheet *names* is
 * drawn by some sheet. Neither checks this direction, which is the one that
 * catches a class the markup invents.
 *
 * # Why the markup is read rather than the render
 *
 * A rendering test sees one screen in one state. `.mtg-button` was on a screen
 * that had tests, and they passed: nothing about a raw user-agent button is
 * wrong to `getByRole`. Reading the class names out of the source covers every
 * surface, including the ones only a game in progress can reach.
 *
 * # Why there is an exceptions list at all
 *
 * A class with no rule is not automatically a bug. Three shapes are legitimate:
 * a second class beside a drawn one, narrowing it for a rule that may come
 * later; a marker naming the segment of a row that never moves, so the segments
 * that *do* move can be its siblings; and a hook a test drives the page by. Each
 * entry below carries which of those it is, and the reason is checked by nothing
 * but a reader — so a new class arriving in this list is a decision somebody
 * made in a diff, which is the whole point.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uiStyleSheet } from '../../src/styles/index';
import { ANALYSIS_CSS } from '../../src/routes/analysis/styles';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * Classes the markup uses that no sheet draws, on purpose.
 *
 * Keyed by class, valued by why. Sorted by key so a diff to it is one line.
 */
const MARKERS: Readonly<Record<string, string>> = {
  'mtg-card__type-kind':
    'The middle segment of the type line, and the one that never drops. Its two ' +
    'siblings are hidden by name at small sizes (styles/card.ts hides ' +
    '.mtg-card__type-super and .mtg-card__type-sub per fit band); this one is ' +
    'what is left, so it needs a name and no rule.',
  'mtg-cast':
    'A test hook. Four suites drive the cast panel by it; the drawing is ' +
    '.mtg-picker, which it rides beside.',
  'mtg-cast__aim':
    'A list item inside .mtg-cast__aims, which is the flex column that lays the ' +
    'items out and resets the marker. The item adds nothing of its own.',
  'mtg-deck__group-label':
    'The spoken half of the grouping control, inline inside its own label. ' +
    '.mtg-deck__group is the layout.',
  'mtg-deck__group-select': 'A narrower handle beside .mtg-select, which draws it.',
  'mtg-fixtures-picker':
    'The dev fixture harness, which styles itself inline (PICKER_STYLE) rather ' +
    'than through the app sheet, because it is not the app.',
  'mtg-gamemenu__head': 'A narrower handle beside .mtg-btn, which draws it.',
  'mtg-log__head': 'A narrower handle beside .mtg-browser__head, which draws it.',
  'mtg-log__turn':
    'A list item inside .mtg-log__turns, which is the flex column that lays the ' +
    'items out and resets the marker.',
  'mtg-log__turn-no':
    'The turn number inside .mtg-log__turn-title, which is the row. Its sibling ' +
    '.mtg-log__turn-owner is drawn because it is the muted half; this is the ' +
    'plain half.',
  'mtg-seat-rail__poison-label':
    'The word beside the figure. .mtg-seat-rail__poison is the row and carries ' +
    'the size, the faint color and the three data-tone recolorings; ' +
    '.mtg-seat-rail__poison-amount is drawn because it is the tabular half. ' +
    'This is the plain half.',
  'mtg-setpick--only':
    'The one-set case, where the picker is a static span rather than a select. ' +
    '.mtg-setpick does the layout and there is no control to restyle.',
};

/** Every class a mounted sheet draws a rule for, bare or as a descendant. */
function drawnClasses(): ReadonlySet<string> {
  const drawn = new Set<string>();
  // Both sheets the app mounts: `styles/index.ts`'s and the analysis lane's own,
  // which `routes/analysis/chart.ts` mounts as its own <style> element. Reading
  // only the first is how the first count of this came out at 83 undrawn, with
  // every charting class in the analysis lane wrongly among them.
  for (const sheet of [uiStyleSheet(), ANALYSIS_CSS]) {
    for (const match of sheet.matchAll(/\.(mtg-[A-Za-z0-9_-]+)/g)) drawn.add(match[1] ?? '');
  }
  return drawn;
}

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * The source with its comments blanked out and its string bodies left alone.
 *
 * Bead ids share the `mtg-` prefix and this codebase writes them in markdown
 * backticks, which read as template literals to any regex. Scanning the comments
 * is how a first pass counted `mtg-bc2` among the classes.
 */
function withoutComments(text: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < text.length) {
    const here = text[index] ?? '';
    const next = text[index + 1];
    if (quote !== null) {
      out += here;
      if (here === '\\') {
        out += text[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (here === quote) quote = null;
      index += 1;
      continue;
    }
    if (here === "'" || here === '"' || here === '`') {
      quote = here;
      out += here;
      index += 1;
      continue;
    }
    if (here === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (here === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    out += here;
    index += 1;
  }
  return out;
}

/**
 * The source text of every `className` value in the file.
 *
 * Reading class-shaped literals anywhere would read element ids too: this app
 * pairs a label to its control with `htmlFor: 'mtg-design-name'` and an `id` to
 * match, and neither of those is a class. So the expression after each
 * `className` is taken whole, from its colon to whatever ends it at depth zero.
 */
function classNameExpressions(text: string): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\bclassName\s*:/g)) {
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    let depth = 0;
    let quote: string | null = null;
    while (index < text.length) {
      const here = text[index] ?? '';
      if (quote !== null) {
        if (here === '\\') index += 1;
        else if (here === quote) quote = null;
        index += 1;
        continue;
      }
      if (here === "'" || here === '"' || here === '`') quote = here;
      else if (here === '(' || here === '[' || here === '{') depth += 1;
      else if (here === ')' || here === ']' || here === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (here === ',' && depth === 0) break;
      index += 1;
    }
    out.push(text.slice(start, index));
  }
  return out;
}

const CLASS_TOKEN = /^mtg-[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*$/;

/** Every class the markup writes, and the first file that writes it. */
function usedClasses(): ReadonlyMap<string, string> {
  const used = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    // The sheets themselves name every class they draw, which would make the
    // check tautological.
    if (file.includes('/styles') || file.endsWith('styles.ts')) continue;
    const text = classNameExpressions(withoutComments(readFileSync(file, 'utf8'))).join('\n');
    for (const match of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      const literal = match[1] ?? match[2] ?? match[3] ?? '';
      for (const token of literal.split(/\s+/)) {
        if (!CLASS_TOKEN.test(token)) continue;
        if (!used.has(token)) used.set(token, file.slice(file.indexOf('packages/')));
      }
    }
  }
  return used;
}

describe('every class the markup uses', () => {
  it('is drawn by a sheet, or is a declared marker', () => {
    const drawn = drawnClasses();
    const undrawn = [...usedClasses()]
      .filter(([name]) => !drawn.has(name) && MARKERS[name] === undefined)
      .map(([name, file]) => `${name} <- ${file}`)
      .sort();

    // The list, not the count: a failure has to name the class, because the
    // repair is either a rule or an entry in MARKERS and only the name says
    // which surface to go and look at.
    expect(undrawn).toStrictEqual([]);
  });

  it('reads enough of the markup to be worth trusting', () => {
    // A scan that silently stopped matching would pass this file forever. The
    // floor is the reading taken when it was written (599 classes over both
    // sheets), less a margin for classes a later diff removes.
    expect(usedClasses().size).toBeGreaterThan(500);
    expect(drawnClasses().size).toBeGreaterThan(500);
  });

  it('declares no marker that a sheet has since started drawing', () => {
    // The other direction, and the one that makes the list shrink on its own: a
    // marker that got a rule is no longer a marker, and leaving it here would
    // hide the next class that arrives under the same name.
    const drawn = drawnClasses();
    expect(Object.keys(MARKERS).filter((name) => drawn.has(name))).toStrictEqual([]);
  });

  it('declares no marker the markup no longer uses', () => {
    const used = usedClasses();
    expect(Object.keys(MARKERS).filter((name) => !used.has(name))).toStrictEqual([]);
  });
});
