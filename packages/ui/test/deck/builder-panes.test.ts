// @vitest-environment jsdom
/**
 * The pane switch: what each button writes, and what the stylesheet does with it.
 *
 * `mtg-nqms`. The arrangement it produces is measured in a browser
 * (`./builder-drawer.browser.test.ts`); jsdom performs no layout and can prove
 * no pixel. What is answerable here is everything upstream of one: which value
 * a press writes, that the control sits inside the sticky bar it depends on for
 * being reachable, and that the rule which restores both panes on a desk
 * restores the display a pane actually has.
 *
 * That last one is the reason this file exists rather than being three lines in
 * the browser rig. `.mtg-deck__pane` is `display: flex` and the desk rule has to
 * name that value literally, because CSS cannot say "undo the rule above" and
 * the split query is two clauses joined by a comma, which has no negation. A
 * pane restored as `block` would lay out and look almost right, and its
 * scrollport -- which is `flex: 1 1 auto` inside a column -- would quietly stop
 * filling the pane. So the two values are asserted to be the same string.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  BUILDER_FIRST_PANE,
  BUILDER_PANE_SWITCH_LABEL,
  BUILDER_SPLIT_VIEW_LABEL,
  builderPaneExpansionControl,
  builderPaneSwitch,
  useBuilderPane,
} from '../../src/routes/deck/builder-panes';
import { ConstructedBuilder } from '../../src/routes/deck/ConstructedBuilder';
import { deckFor, emptyBuild } from '../../src/routes/deck/build';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor as sealedDeckFor, openSealed } from '../../src/routes/play/sealed';
import { uiStyleSheet } from '../../src/styles/index';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

/**
 * Whether the switch is inside the sticky bar, read off the markup: the bar
 * opens, and the switch appears before the element that closes it. Static
 * markup rather than a DOM walk because the workspace tsconfig has no
 * `lib: dom`, which is the same reason `./deck-panes.test.ts` reads markup.
 */
function insideTheBar(markup: string): boolean {
  const bar = markup.indexOf('mtg-builder__bar');
  const control = markup.indexOf('mtg-builder__switch');
  const panes = markup.indexOf('mtg-builder__panes');
  return bar > -1 && control > bar && panes > control;
}

afterEach(cleanup);

/**
 * No `lib: dom` in this workspace, so the shapes this file reaches for are
 * spelled out, the way `../draft/pack-order.test.ts` spells out its own.
 */
interface ElementLike {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
}

/** Testing Library hands back an `HTMLElement` this workspace has no members for. */
function readable(element: unknown): ElementLike {
  return element as ElementLike;
}

function readableAll(elements: readonly unknown[]): readonly ElementLike[] {
  return elements as readonly ElementLike[];
}

/** A host that draws the switch and reports what the panes would be told. */
function Host(): ReturnType<typeof h> {
  const state = useBuilderPane();
  return h(
    'div',
    { className: 'mtg-builder' },
    h('output', null, `${state.showing}:${state.expanded ?? 'split'}`),
    builderPaneSwitch({ state, deckLabel: 'Your deck', poolLabel: 'Playable cards' }),
    builderPaneExpansionControl({ state, pane: 'deck', label: 'Your deck' }),
    builderPaneExpansionControl({ state, pane: 'pool', label: 'Playable cards' }),
  );
}

function pressed(): readonly (string | null)[] {
  return readableAll(screen.getAllByRole('button'))
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);
}

describe('the switch between a builder’s two panes', () => {
  it('opens on the deck, which is what the panes are written in', () => {
    render(h(Host, null));
    expect(readable(screen.getByRole('status', { hidden: true })).textContent ?? '').toBe(
      `${BUILDER_FIRST_PANE}:split`,
    );
    expect(pressed()).toEqual(['Your deck']);
  });

  it('shows the other pane when its name is pressed, and marks which is showing', () => {
    render(h(Host, null));
    fireEvent.click(screen.getByRole('button', { name: 'Playable cards' }));
    expect(readable(screen.getByRole('status', { hidden: true })).textContent ?? '').toBe('pool:split');
    expect(pressed()).toEqual(['Playable cards']);
    fireEvent.click(screen.getByRole('button', { name: 'Your deck' }));
    expect(readable(screen.getByRole('status', { hidden: true })).textContent ?? '').toBe('deck:split');
  });

  it('carries both names whichever one is showing, so neither pane is a place you cannot leave', () => {
    render(h(Host, null));
    fireEvent.click(screen.getByRole('button', { name: 'Playable cards' }));
    expect(
      readableAll(screen.getAllByRole('button'))
        .filter((button) => button.getAttribute('class')?.includes('mtg-builder__switch-btn') === true)
        .map((button) => button.textContent),
    ).toEqual(['Your deck', 'Playable cards']);
  });

  it('groups the two buttons under one name, so a rig and a reader find them the same way', () => {
    const markup = renderToStaticMarkup(h(Host, null));
    expect(markup).toContain(`aria-label="${BUILDER_PANE_SWITCH_LABEL}"`);
  });
});

describe('expanding either builder pane', () => {
  it('expands the chosen pane and restores the split without changing the mobile pane choice', () => {
    render(h(Host, null));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Playable cards' }));
    expect(readable(screen.getByRole('status', { hidden: true })).textContent ?? '').toBe('pool:pool');
    expect(screen.getByRole('button', { name: BUILDER_SPLIT_VIEW_LABEL })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: BUILDER_SPLIT_VIEW_LABEL }));
    expect(readable(screen.getByRole('status', { hidden: true })).textContent ?? '').toBe('pool:split');
  });

  it('offers a keyboard button for both panes while the split is visible', () => {
    render(h(Host, null));
    expect(screen.getByRole('button', { name: 'Expand Your deck' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Expand Playable cards' })).toBeDefined();
  });
});

/**
 * Where the control is, which is the whole of why it is reachable.
 *
 * `.mtg-builder__bar` is `position: sticky` at the top of the page, and the
 * switch is inside it rather than beside the panes so that it inherits that and
 * nothing else on this screen has to be pinned. A switch that scrolled away with
 * the bar it was under would leave the deck 6,562px above somebody reading the
 * end of the collection, which is the state `mtg-nqms` was filed about.
 */
describe('where each builder keeps the switch', () => {
  const cards = loadSet();

  it('puts the Constructed one inside the sticky counts bar', () => {
    const build = emptyBuild(cards);
    const markup = renderToStaticMarkup(
      h(ConstructedBuilder, {
        build,
        deck: deckFor(build),
        onAdd: () => undefined,
        onCut: () => undefined,
        onClear: () => undefined,
        onAdjustBasics: () => undefined,
        onSuggestBasics: () => undefined,
        onLoad: () => undefined,
        onPlay: () => undefined,
      }),
    );
    expect(insideTheBar(markup), 'the Constructed switch is outside the sticky bar').toBe(true);
  });

  it('puts the sealed one there too, because it is one screen under two names', () => {
    const build = openSealed(cards, 'lab/test/sealed-switch');
    const markup = renderToStaticMarkup(
      h(SealedBuilder, {
        build,
        deck: sealedDeckFor(build),
        onToggle: () => undefined,
        onSuggest: () => undefined,
        onClear: () => undefined,
        onAdjustBasics: () => undefined,
        onSuggestBasics: () => undefined,
        onPlay: () => undefined,
        contextNote: 'A sealed pool, mounted directly by a test.',
        seed: 'lab/test/sealed-switch',
        source: 'sealed' as const,
      }),
    );
    expect(insideTheBar(markup), 'the sealed switch is outside the sticky bar').toBe(true);
  });

  it('tells the panes which one to draw', () => {
    const build = emptyBuild(cards);
    const markup = renderToStaticMarkup(
      h(ConstructedBuilder, {
        build,
        deck: deckFor(build),
        onAdd: () => undefined,
        onCut: () => undefined,
        onClear: () => undefined,
        onAdjustBasics: () => undefined,
        onSuggestBasics: () => undefined,
        onLoad: () => undefined,
        onPlay: () => undefined,
      }),
    );
    expect(markup).toContain(`data-showing="${BUILDER_FIRST_PANE}"`);
    expect(markup).toContain('data-expanded="split"');
    expect(markup).toContain('aria-label="Expand Your deck"');
    expect(markup).toContain('aria-label="Expand Playable cards"');
  });
});

/** The value in a declaration, or `null` where the sheet does not carry the rule. */
function declaration(sheet: string, selector: string, property: string): string | null {
  const at = sheet.indexOf(selector);
  if (at === -1) return null;
  const block = sheet.slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at));
  const found = block
    .split(';')
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${property}:`));
  return found === undefined ? null : found.slice(property.length + 1).trim();
}

describe('what the stylesheet does with the pane the switch names', () => {
  const sheet = uiStyleSheet();

  it('hides the pane that is not showing', () => {
    expect(sheet).toContain(".mtg-builder__panes[data-showing='deck'] > [data-pane='pool']");
    expect(sheet).toContain(".mtg-builder__panes[data-showing='pool'] > [data-pane='deck']");
  });

  it('restores a pane on a desk as the display a pane has', () => {
    const pane = declaration(sheet, '.mtg-deck__pane {', 'display');
    const restored = declaration(
      sheet,
      '.mtg-builder .mtg-builder__panes[data-showing] > [data-pane]',
      'display',
    );
    expect(pane, 'a deck pane no longer states its own display').not.toBeNull();
    expect(restored, 'the desk rule no longer restores a hidden pane').not.toBeNull();
    expect(restored).toBe(pane);
  });

  it('takes the switch off a desk, where both panes are drawn anyway', () => {
    const at = sheet.indexOf('.mtg-builder__switch { display: none; }');
    expect(at, 'the switch is drawn beside two panes that are both already there').toBeGreaterThan(-1);
  });

  it('takes the other pane and divider out of layout in either expanded mode', () => {
    expect(sheet).toContain(".mtg-builder__panes[data-expanded='deck'] > [data-pane='pool']");
    expect(sheet).toContain(".mtg-builder__panes[data-expanded='pool'] > [data-pane='deck']");
    expect(sheet).toContain(".mtg-builder__panes[data-expanded]:not([data-expanded='split']) > .mtg-split");
  });
});
