import { createElement as h } from 'react';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { ObservedBackend } from '@mtg/engine';
import akh from '../../../data/data/akh-hou/akh-printed-catalog-v1.json';
import hou from '../../../data/data/akh-hou/hou-printed-catalog-v1.json';
import mp2 from '../../../data/data/akh-hou/mp2-printed-catalog-v1.json';
import format from '../../../data/data/akh-hou/akh-hou-limited-format-v1.json';
import { sha256Text } from '../../src/routes/analysis/calibration-read';
import { PrintedDraftRoute } from '../../src/routes/printed/PrintedDraftRoute';
import { mount } from '../../src/mount';
import { ROUTE_SCOPE_ATTRIBUTE, SUB_SCOPE_ATTRIBUTE } from '../../src/styles/tokens';

const backend: ObservedBackend = {
  id: 'akh-hou-draft-browser-fixture',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'backend-failure', message: 'Browser layout fixture does not start Forge.' },
    }),
};

void preparePrintedLimitedFormat(format, [akh, hou, mp2], sha256Text).then(
  (prepared) =>
    mount(
      'root',
      h(
        'div',
        {
          className: 'mtg-shell',
          // `mtg-a982g.1` folded Draft into Play as a section rather than a mode
          // of its own, so the shell this fixture hand-builds has to stamp the
          // pair production stamps (`section-views.ts`: `route.mode === 'play'`,
          // `route.sub === 'draft'`) rather than the retired top-level `draft`
          // route. A stale `draft` route never matched `board/geometry.ts`'s
          // `TABLE` scope, so `.mtg-shell__main` kept the desktop page's
          // `overflow: visible` on a phone and the bottom of the pack was
          // clipped by the shell's own `overflow: hidden` with no way to reach it.
          [ROUTE_SCOPE_ATTRIBUTE]: 'play',
          [SUB_SCOPE_ATTRIBUTE]: 'draft',
        },
        h(
          'main',
          { className: 'mtg-shell__main' },
          h(PrintedDraftRoute, {
            prepared,
            seed: 'browser-draft',
            backend,
            printedCards: [],
            playAvailability: {
              status: 'supported',
              reason: 'Verified full-card and match interaction admission is installed.',
            },
            onNewDraft: () =>
              (globalThis as unknown as { location: { reload: () => void } }).location.reload(),
          }),
        ),
      ),
    ),
  (cause: unknown) => mount('root', h('p', { role: 'alert' }, String(cause))),
);
