// @vitest-environment jsdom
/**
 * The mark in the corner (`MTG Lab` by default) is the way back to Play, and
 * it is deliberately a different kind of link than a mode tab: a tab's click
 * carries the current source/opponent forward on purpose (`./shell-subs.test.ts`
 * pins that), but the mark is the one link whose job is to land on Play's own
 * default, not on whatever set the page happened to be browsing.
 *
 * The playtester, 2026-09-27: pressing it while browsing a specific set was landing
 * back on Play still pinned to that set instead of its plain default.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Shell } from '../../src/app/Shell';
import type { ShellAt } from '../../src/app/Shell';
import { routeHash } from '../../src/app/router';
import type { UiMode } from '../../src/app/router';

interface ElementLike {
  querySelector(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
}

afterEach(cleanup);

function mount(
  at: ShellAt,
  params: Readonly<Record<string, string>>,
  onSelectMode: (mode: UiMode, params?: Readonly<Record<string, string>>) => void,
): ElementLike {
  const { container } = render(h(Shell, { ...at, modeParams: params, onSelectMode, children: 'body' }));
  const mark = (container as unknown as ElementLike).querySelector('a.mtg-shell__mark');
  if (mark === null) throw new Error('the mark did not render');
  return mark;
}

describe('the mark', () => {
  it('carries no source or opponent in its href, even while browsing a specific set', () => {
    const mark = mount({ mode: 'cards' }, { source: 'xmp', vs: 'lan' }, () => undefined);
    expect(mark.getAttribute('href')).toBe(routeHash({ mode: 'play', params: {} }));
    expect(mark.getAttribute('href')).toBe('#/play');
  });

  it('drops the source and opponent on a plain click too, rather than falling back to the current params', () => {
    const onSelectMode = vi.fn();
    const mark = mount({ mode: 'cards' }, { source: 'xmp', vs: 'lan' }, onSelectMode);
    fireEvent.click(mark as unknown as Element, { button: 0 });
    expect(onSelectMode).toHaveBeenCalledWith('play', {});
  });

  it('still announces the current page when already on Play', () => {
    const mark = mount({ mode: 'play' }, {}, () => undefined);
    expect(mark.getAttribute('aria-current')).toBe('page');
  });
});
