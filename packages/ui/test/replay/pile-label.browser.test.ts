// @vitest-environment node
/**
 * The two piles in the replay's seat column, read as words in a 46px box.
 *
 * `mtg-dcxg.10`, 2026-08-23. `../../src/routes/replay/frame.ts` names each pile
 * off its owner — "Wield the Obliterator's graveyard" — and `../../src/board/Board.ts`
 * draws it in that seat's own column, which is the narrowest column on the
 * route. The sweep photographed it clipped to "…GRAVEYAR" on a 1440px desk, on
 * both seats, and the name that fell off the end was the half that says which
 * zone it is.
 *
 * The fix is not a smaller font: the printed word is now the zone alone, and the
 * owner stays in the name the strip is read aloud by, because the pod directly
 * above the pile is what says whose seat it is. Both halves are asserted here —
 * a fix that shortened the word by hiding the owner from a screen reader too
 * would pass the first and fail the second.
 *
 * Which of the two assertions is the reproduction depends on the name: the
 * fixture log's seats are "UB Control" and "RG Aggro", and at 22 characters
 * *UB Control's graveyard* fits the column at both widths below. The sweep was
 * taken on the flagship, whose seat is *Wield the Obliterator*, and that is the
 * name that ran off the end. So the overflow reading is a guard that holds for
 * any name, and the claim that fails on this fixture with the fix removed is
 * the last one — the printed word is shorter than the spoken name, which is the
 * whole of what changed.
 *
 * jsdom performs no layout, so the overflow is unmeasurable there.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/** A frame with cards in both graveyards, so the strips carry their longest head. */
const SEQ = '120';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      sub: 'replay',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ReplayViewer, {
        state: { status: 'ready', log: fixtureLog() },
        route: { mode: 'analysis', sub: 'replay', params: { seq: SEQ } },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Piles</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const piles = [...document.querySelectorAll('.mtg-board__pods .mtg-browser')];
  return piles.map((pile) => {
    const head = pile.querySelector('.mtg-browser__head');
    const printed = pile.querySelector('.mtg-zone__label');
    if (head === null || printed === null) return null;
    const box = printed.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(printed);
    const word = range.getBoundingClientRect();
    return {
      spoken: pile.getAttribute('aria-label') ?? head.getAttribute('aria-label'),
      printed: (printed.textContent ?? '').trim(),
      // A word wider than its box neither wraps at a space it does not have nor
      // clips: it runs past the edge. Both are read, so neither hides the other.
      overflow: round(Math.max(word.right - box.right, box.left - word.left)),
      headOverflow: round(head.scrollWidth - head.clientWidth),
    };
  });
})()`);

interface Pile {
  readonly spoken: string | null;
  readonly printed: string;
  readonly overflow: number;
  readonly headOverflow: number;
}

const SLACK_PX = 0.5;

const SIZES = [
  { width: 1440, height: 900, coarse: false },
  { width: 1024, height: 768, coarse: false },
] as const;

describe('a pile in the seat column', () => {
  browserIt(
    'prints a word that fits and is read aloud by a name that says whose it is',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-pile-label-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-pile-label-chrome-'));
      const file = join(directory, 'replay.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-board',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as readonly (Pile | null)[] | null;
          if (seen === null || seen.length === 0) throw new Error(`${at}: the column drew no pile`);

          for (const [index, pile] of seen.entries()) {
            if (pile === null) throw new Error(`${at}: pile ${String(index)} draws no name`);
            expect(pile.overflow, `${at}: "${pile.printed}" runs past its own box`).toBeLessThanOrEqual(
              SLACK_PX,
            );
            expect(pile.headOverflow, `${at}: the head of "${pile.printed}" overflows`).toBeLessThanOrEqual(
              SLACK_PX,
            );
            expect(pile.spoken ?? '', `${at}: pile ${String(index)} is read aloud by nothing`).not.toBe('');
            expect(
              (pile.spoken ?? '').length,
              `${at}: the spoken name "${pile.spoken ?? ''}" says no more than the printed word`,
            ).toBeGreaterThan(pile.printed.length);
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
