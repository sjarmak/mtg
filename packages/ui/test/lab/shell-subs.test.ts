// @vitest-environment jsdom
/**
 * The row of sections under the bar.
 *
 * `mtg-a982g.1`. Four modes, and under each a second row of the same shape for
 * its sections: Play has its four formats, Customize its two makers, Cards its
 * two galleries and Analysis its two readers. What is pinned here is the row's
 * contract with the router and the sheet rather than its look: one anchor per
 * section, the current one announced, every href carrying the mode's params so
 * the source survives a section change, and the shell stamping both the mode
 * and the section so `viewScope` in `../../src/styles/tokens.ts` has something
 * to key on. The old per-route `.mtg-subnav` is gone, and its absence is pinned
 * too, because a second row in a second shape is what this replaced.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Shell, subsLabel } from '../../src/app/Shell';
import type { ShellAt } from '../../src/app/Shell';
import { DEFAULT_SUBS, SUB_LABELS, UI_MODES, UI_SUBS, modeParams, routeHash } from '../../src/app/router';
import type { UiMode } from '../../src/app/router';
import { ROUTE_SCOPE_ATTRIBUTE, SUB_SCOPE_ATTRIBUTE, viewScope } from '../../src/styles/tokens';
import { SHORT_VIEWPORT_QUERY, TABLE } from '../../src/styles/board/geometry';
import { uiStyleSheet } from '../../src/styles/index';
import { SCREEN_QUERY } from '../../src/styles/panel';

interface ElementLike {
  querySelector(selector: string): ElementLike | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  readonly textContent: string | null;
}

afterEach(cleanup);

/** The shell's root, read structurally: the workspace tsconfig has no `lib: dom`. */
function mount(at: ShellAt, params: Readonly<Record<string, string>> = {}): ElementLike {
  const { container } = render(
    h(Shell, { ...at, modeParams: params, onSelectMode: () => undefined, children: 'body' }),
  );
  const shell = (container as unknown as ElementLike).querySelector('.mtg-shell');
  if (shell === null) throw new Error('the shell did not render');
  return shell;
}

function subsRow(shell: ElementLike, mode: UiMode): ElementLike {
  const row = shell.querySelector(`nav.mtg-subs[aria-label='${subsLabel(mode)}']`);
  if (row === null) throw new Error(`no section row for ${mode}`);
  return row;
}

describe('the section row', () => {
  it.each(UI_MODES)('draws one anchor per section of %s, in the order the router lists them', (mode) => {
    const row = subsRow(mount({ mode }), mode);
    const items = Array.from(row.querySelectorAll('a.mtg-subs__item'));
    expect(items.map((item) => item.textContent)).toEqual(UI_SUBS[mode].map((sub) => SUB_LABELS[sub]));
  });

  it('announces the current section and no other', () => {
    const row = subsRow(mount({ mode: 'play', sub: 'sealed' }), 'play');
    const current = Array.from(row.querySelectorAll("a.mtg-subs__item[aria-current='page']"));
    expect(current.map((item) => item.textContent)).toEqual([SUB_LABELS.sealed]);
  });

  it.each(UI_MODES)('lands on the default section of %s when none is named', (mode) => {
    const row = subsRow(mount({ mode }), mode);
    const current = row.querySelector("a.mtg-subs__item[aria-current='page']");
    expect(current?.textContent).toBe(SUB_LABELS[DEFAULT_SUBS[mode]]);
  });

  it('carries the mode params on every section link, so the source survives', () => {
    const params = { source: 'tgr' };
    const row = subsRow(mount({ mode: 'play', sub: 'draft' }, params), 'play');
    const hrefs = Array.from(row.querySelectorAll('a.mtg-subs__item')).map((item) =>
      item.getAttribute('href'),
    );
    expect(hrefs).toEqual(UI_SUBS.play.map((sub) => routeHash({ mode: 'play', sub, params })));
    expect(hrefs[0]).toBe('#/play/constructed?source=tgr');
  });

  /**
   * `mtg-a982g.5`. The row carries what the router hands it, and what the router
   * hands it is the set and the opponent: everything else in the hash names
   * something inside the page being left. A seed carried to the next section
   * names a pool that section never dealt, and `vs` dropped reopened the bot
   * column every time somebody changed section with the network column open.
   */
  it('carries the source and the opponent across a section change, and nothing inside the page', () => {
    const params = modeParams({
      mode: 'play',
      sub: 'draft',
      params: { source: 'xmp', vs: 'lan', seed: 'legacy-ui/one', picks: 'aa', deck: 'b', room: 'r' },
    });
    expect(params).toEqual({ source: 'xmp', vs: 'lan' });
    const row = subsRow(mount({ mode: 'play', sub: 'draft' }, params), 'play');
    const hrefs = Array.from(row.querySelectorAll('a.mtg-subs__item')).map((item) =>
      item.getAttribute('href'),
    );
    expect(hrefs[1]).toBe('#/play/draft?source=xmp&vs=lan');
  });

  /** The older spelling of the same param, which a draft bookmark still carries. */
  it('normalizes the cube alias to the source every link is built from', () => {
    expect(modeParams({ mode: 'play', sub: 'draft', params: { cube: 'legacy-cube-2021-08' } })).toEqual({
      source: 'legacy-cube-2021-08',
    });
  });

  it('stamps the mode and the section on the shell root, which is what a sheet keys on', () => {
    const shell = mount({ mode: 'analysis', sub: 'replay' });
    expect(shell.getAttribute(ROUTE_SCOPE_ATTRIBUTE)).toBe('analysis');
    expect(shell.getAttribute(SUB_SCOPE_ATTRIBUTE)).toBe('replay');
    expect(shell.matches(viewScope('analysis', 'replay'))).toBe(true);
    expect(shell.matches(viewScope('analysis', 'explorer'))).toBe(false);
  });

  it('draws no per-route sub-navigation of its own beside the row', () => {
    for (const mode of UI_MODES) expect(mount({ mode }).querySelector('.mtg-subnav')).toBeNull();
  });
});

/**
 * Every block the sheet opens under `query`, each cut at its own closing brace.
 * A block nests rules, so the cut walks braces rather than searching for one.
 */
function mediaBlocks(css: string, query: string): string[] {
  const opener = `@media ${query} {`;
  const blocks: string[] = [];
  for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + opener.length)) {
    let depth = 0;
    for (let index = at + opener.length - 1; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(at, index + 1));
        break;
      }
    }
  }
  return blocks;
}

/** The one rule in `block` whose selector list carries `selector`, declarations included. */
function ruleNaming(block: string, selector: string): string {
  const at = block.indexOf(selector);
  if (at === -1) return '';
  const open = block.indexOf('{', at);
  const close = block.indexOf('}', open);
  const start = block.lastIndexOf('}', at);
  return block.slice(start + 1, close + 1);
}

describe('the section row leaves a landscape phone with the bar', () => {
  // The rig behind this pin is `../../../slice/test/ui-phone-scroll.browser.test.ts`:
  // at 844x390 it lists everything drawn above the mat and expects nothing.
  // The phone-width block already takes the row out beside a board, but a
  // landscape phone is 844px wide and reaches only the short-viewport block,
  // where the bar and the notice went and the row, added later, did not: the
  // list came back holding `nav.mtg-subs` at 29.84px. A draft screen makes the
  // same cut under `../../src/styles/panel.ts`'s own height query, which is
  // deliberately not the table's, so each surface is read under its own.
  const css = uiStyleSheet();

  it('opens the short-viewport block more than once, so the pin below is about a block and not the sheet', () => {
    expect(mediaBlocks(css, SHORT_VIEWPORT_QUERY).length).toBeGreaterThan(1);
  });

  it.each([
    ['a played table', `.mtg-shell${TABLE}:has(.mtg-board)`, SHORT_VIEWPORT_QUERY],
    ['a draft screen', '.mtg-shell:has(.mtg-screen)', SCREEN_QUERY],
  ])('hides the row beside %s in the same rule as the bar', (_surface, host, query) => {
    const block = mediaBlocks(css, query).find((candidate) => candidate.includes(`${host} > .mtg-subs`));
    expect(block, `${host} > .mtg-subs under ${query}`).toBeDefined();
    const found = ruleNaming(block ?? '', `${host} > .mtg-subs`);
    expect(found).toContain(`${host} > .mtg-shell__bar`);
    expect(found).toContain('display: none');
  });
});
