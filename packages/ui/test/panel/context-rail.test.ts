// @vitest-environment jsdom
/**
 * The shared rail's contract, held here rather than at each of its call sites.
 *
 * `mtg-aqxi`. Three surfaces are meant to grow this furniture once; what makes
 * that true is that the promises live with the component. Four of them:
 *
 * - A section with nothing in it stays reachable and says so, because a control
 *   that disappears when its subject empties moves every control beside it.
 * - The counts are drawn whether or not the section is showing, which is the
 *   reason the sections are never removed: "Stack 2" is the fact a player needs
 *   while they are reading the log.
 * - Exactly one section is pressed, and the body is labeled with its name, so a
 *   screen reader that jumps to the region is told what it landed in.
 * - Nothing claims `role="tab"`. `../../src/panel/ContextRail.ts` argues that at
 *   length: a tablist without roving focus announces "tab 2 of 3" and then the
 *   arrow keys do nothing.
 */
import { createElement as h, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextRail } from '../../src/panel/ContextRail';
import type { RailSection } from '../../src/panel/ContextRail';

afterEach(cleanup);

/**
 * The narrow shape this file reads off the DOM.
 *
 * This package compiles without `lib: dom` on purpose (`../../AGENTS.md`), so a
 * test says which three members it touches rather than importing the whole
 * browser to touch them.
 */
interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly closest: (selector: string) => ElementLike | null;
}

const at = (element: unknown): ElementLike => element as ElementLike;

const SECTIONS: readonly RailSection[] = [
  { name: 'Card', render: () => h('p', null, 'the chosen face'), empty: 'Nothing chosen.' },
  { name: 'Pool', count: 2, render: () => h('p', null, 'two cards') },
  { name: 'Log', count: 0, render: () => null, empty: 'No events yet.' },
];

function Rail(props: { readonly foot?: string }): ReturnType<typeof ContextRail> {
  const [active, setActive] = useState('Card');
  return h(ContextRail, {
    label: 'Draft context',
    sections: SECTIONS,
    active,
    onSelect: setActive,
    ...(props.foot === undefined ? {} : { foot: h('button', { type: 'button' }, props.foot) }),
  });
}

describe('the contextual rail', () => {
  it('shows one section, presses one control, and labels the region with its name', () => {
    render(h(Rail));

    expect(at(screen.getByRole('button', { name: /^Card/ })).getAttribute('aria-pressed')).toBe('true');
    expect(at(screen.getByRole('button', { name: /^Pool/ })).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: 'Card' })).toBeTruthy();
    expect(screen.getByText('the chosen face')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Pool/ }));

    expect(at(screen.getByRole('button', { name: /^Pool/ })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Pool' })).toBeTruthy();
    expect(screen.queryByText('the chosen face')).toBeNull();
  });

  it('keeps an empty section reachable, counted, and speaking for itself', () => {
    render(h(Rail));

    const log = screen.getByRole('button', { name: /^Log/ });
    expect(at(log).textContent).toContain('0');

    fireEvent.click(log);

    expect(screen.getByText('No events yet.')).toBeTruthy();
    // Still three controls in the same order: nothing moved under the finger.
    expect(screen.getAllByRole('button').map((one) => at(one).textContent?.replace(/\d+$/, ''))).toEqual([
      'Card',
      'Pool',
      'Log',
    ]);
  });

  it('does not claim the ARIA tab pattern it does not implement', () => {
    render(h(Rail));

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(0);
  });

  it('pins the foot outside the scrolling body', () => {
    const { container } = render(h(Rail, { foot: 'Pick Skywatch Sentinel' }));

    const foot = at(container).querySelector('.mtg-rail__foot');
    expect(foot).not.toBeNull();
    expect(foot?.querySelector('button')?.textContent).toBe('Pick Skywatch Sentinel');
    expect(foot?.closest('.mtg-rail__body')).toBeNull();
  });

  it('refuses a rail with nothing to show rather than drawing an empty strip', () => {
    expect(() =>
      render(h(ContextRail, { label: 'Empty', sections: [], active: '', onSelect: () => undefined })),
    ).toThrow(/no sections/);
  });
});
