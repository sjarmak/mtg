/**
 * Browser entry for `packages/ui/curate.html`.
 *
 * A page of its own rather than a tab in the lab. The lab's shell is six peer
 * modes over one game, and this is a tool for one afternoon's job on one set:
 * putting it in the tab bar would give every player of the flagship a control
 * that writes to a preferences file, and give this page the shell's palette
 * assertions for a layout that is a contact sheet.
 *
 * The index is staged by `npm run curate`; a checkout that has never run it
 * gets the message naming that command rather than an empty grid, which is the
 * same rule every other staged document on this origin follows.
 */
import { createElement as h } from 'react';
import { readCurationIndex } from '../lab/curation-index';
import { CurateApp } from './CurateApp';
import { CURATE_CSS } from './styles';
import { mount } from '../mount';

async function start(): Promise<void> {
  const response = await fetch('curation.json').catch(() => null);
  if (response === null || !response.ok) {
    mount('root', absent('No curation index is staged. Run `npm run curate` to build one.'));
    return;
  }
  const parsed = readCurationIndex(await response.json().catch(() => null), 'curation.json');
  if (!parsed.ok) {
    mount('root', absent(parsed.message));
    return;
  }
  mount('root', h(CurateApp, { index: parsed.index }));
}

/** The two states that are not a grid, drawn with the grid's own sheet. */
function absent(message: string): ReturnType<typeof h> {
  return h('div', null, h('style', null, CURATE_CSS), h('p', { className: 'curate__empty' }, message));
}

void start();
