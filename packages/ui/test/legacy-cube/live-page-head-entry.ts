/**
 * The browser entry for `./page-head.browser.test.ts`: the cube's page head, live.
 *
 * The head is a title and one note in a `.mtg-page-head` baseline row, and the
 * only questions worth asking about it are questions about layout -- which of
 * the two is drawn first, whether they share a row at a desk width, and whether
 * the note stays inside the window when the row has to wrap. jsdom answers none
 * of them, so this page exists.
 *
 * The catalog is `absent` on purpose. That state draws the head and one empty
 * block and nothing else, so the rig measures two rectangles rather than
 * bundling six hundred printed cards to look at a heading.
 */
import { createElement as h } from 'react';
import type { ObservedBackend } from '@mtg/engine';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import { mount } from '../../src/mount';

const backend: ObservedBackend = {
  id: 'none',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'unsupported', capability: 'printed-card coverage', message: 'no backend here' },
    }),
};

mount(
  'root',
  h(LegacyCubeRoute, {
    catalog: { status: 'absent' },
    params: {},
    onSetParams: (): void => undefined,
    backend,
  }),
);
