// @vitest-environment node
/**
 * A card drawn into an overflowing hand row is scrolled into view, measured in
 * real Chrome.
 *
 * Found on the live lab on the draw: the drawn card is appended at the end of
 * the row, and where the row overflows the end is exactly the part out of
 * sight. At 1024x768 a seven-card hand already needs 664px of a 556px row, so
 * every draw there landed off screen with nothing but a 10px scrollbar to say
 * so. `../../src/board/Hand.ts` now moves the row's own scroll to the newest
 * arrival, and leaves the first render alone so an opening hand starts at its
 * first card.
 *
 * Measured here, chrome-headless-shell, the eighth card after the page's draw:
 *
 *     1024x768   before: row scrollLeft 0, eighth card out of view
 *                after:  row scrolled 237px of 241, eighth card in view
 *     390x844    before: row scrollLeft 0, eighth card out of view
 *                after:  row scrolled 82px of 86, eighth card in view
 *     844x390    the row holds all eight, nothing to scroll either way
 *
 * A mulligan is a new hand rather than a draw: seven more cards, nearly all of
 * them new ids. Before the second change in `Hand.ts` it scrolled to its last
 * arrival like a draw; now it starts at its first card, as the deal does.
 *
 * Cards leaving give the scroll back. On the live lab a draw scrolled the row
 * to its seventh card, that card was played, and the row kept its 83px because
 * the empty slots after the hand keep it as wide as it was: six cards that fit
 * unscrolled were drawn with the first one cut to its last 9px. Here the eighth
 * card is drawn and three are played:
 *
 *     1024x768   before: five held, row still scrolled, first card out of view
 *                after:  row back to 0, all five in view
 *
 * And when three leave and one is drawn in the same render, the row settles
 * before it reveals, so it keeps no scroll past the new last card.
 *
 * The page is a live React mount (`./live-hand-draw-entry.ts`) because the
 * subject is an effect, which static markup never runs. No art, and the neutral
 * example set, so the verdict is about the repository (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { livePage } from '../support/live-page';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-hand-draw-entry.ts');

/** The hand row's scroll and which held cards sit inside its visible width. */
const READ_ROW = `(() => {
  const row = document.querySelector(".mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body");
  const frame = row.getBoundingClientRect();
  const slots = [...row.querySelectorAll(":scope > .mtg-slot[data-slot='hand']:not([data-empty='true'])")];
  const visible = (slot) => { const b = slot.getBoundingClientRect(); return b.left >= frame.left - 1 && b.right <= frame.right + 1; };
  return {
    held: slots.length,
    keys: slots.map((slot) => slot.getAttribute('data-permanent-key')),
    scrollLeft: row.scrollLeft,
    overflow: row.scrollWidth - row.clientWidth,
    firstInView: slots.length > 0 && visible(slots[0]),
    lastInView: slots.length > 0 && visible(slots[slots.length - 1]),
    pageScrollY: window.scrollY,
    pastLast: slots.length === 0 ? 0 : frame.right - slots[slots.length - 1].getBoundingClientRect().right,
  };
})()`;

const MEASURE = `({ before: window.mtgBefore, after: (${READ_ROW}) })`;

interface Row {
  readonly held: number;
  readonly keys: readonly string[];
  readonly scrollLeft: number;
  readonly overflow: number;
  readonly firstInView: boolean;
  readonly lastInView: boolean;
  readonly pageScrollY: number;
  /** Row width in view after the last held card: scroll past the hand when the row is scrolled. */
  readonly pastLast: number;
}

/**
 * A desktop, and a phone held upright and sideways, coarse pointer and all. The
 * sideways phone's row holds all eight, so there it has nothing to scroll and
 * only the drawn card being in view is asserted.
 */
const VIEWPORTS = [
  { width: 1024, height: 768, pointer: 'fine', overflows: true },
  { width: 390, height: 844, pointer: 'coarse', overflows: true },
  { width: 844, height: 390, pointer: 'coarse', overflows: false },
] as const;

/** Builds the page for one case, measures it at one viewport. */
async function measure(
  chrome: Awaited<ReturnType<typeof launchChrome>>,
  directory: string,
  which: 'draw' | 'mulligan' | 'play' | 'swap',
  viewport: (typeof VIEWPORTS)[number],
): Promise<{ readonly before: Row; readonly after: Row }> {
  const file = join(directory, `${which}.html`);
  // The row reader goes in ahead of the bundle, so the page can take its
  // first reading before it changes the hand.
  const live = (await livePage(ENTRY, 'Hand draw scroll')).replace(
    '<div id="root"></div>',
    `<div id="root"></div><script>window.mtgCase = ${JSON.stringify(which)}; window.mtgReadRow = () => ${READ_ROW};</script>`,
  );
  await writeFile(file, live, 'utf8');
  const result = await measurePage(
    chrome.client,
    file,
    viewport.width,
    viewport.height,
    MEASURE,
    `hand ${which}`,
    "body[data-drawn='true'] .mtg-slot[data-slot='hand'] > .mtg-card",
    true,
    { pointer: viewport.pointer },
  );
  return { before: result['before'] as Row, after: result['after'] as Row };
}

describe('a card drawn into an overflowing hand is scrolled into view', () => {
  browserIt(
    'scrolls the row to the drawn card, not on an opening hand or a mulligan, and back as cards leave',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-hand-draw-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const viewport of VIEWPORTS) {
          const where = `${String(viewport.width)}x${String(viewport.height)}`;
          const { before, after } = await measure(chrome, directory, 'draw', viewport);
          // The premise: the row overflows at seven, or a draw has nothing to reveal.
          expect(before.held, where).toBe(7);
          expect(before.overflow > 0, `${where}: whether the seven-card row overflows`).toBe(
            viewport.overflows,
          );
          // An opening hand starts at its first card.
          expect(before.scrollLeft, where).toBe(0);
          expect(before.firstInView, where).toBe(true);
          // The draw brings the eighth card into the row's visible width.
          expect(after.held, where).toBe(8);
          if (viewport.overflows) {
            expect(after.scrollLeft, `${where}: the row did not scroll on the draw`).toBeGreaterThan(0);
          }
          expect(after.lastInView, `${where}: the drawn card is out of view`).toBe(true);
          // And it moved the row, not the page.
          expect(after.pageScrollY, where).toBe(before.pageScrollY);

          // A mulligan deals a new seven, and a new hand starts at its first card.
          const mulligan = await measure(chrome, directory, 'mulligan', viewport);
          const kept = mulligan.after.keys.filter((key) => mulligan.before.keys.includes(key));
          expect(kept.length, `${where}: the mulligan kept most of the hand`).toBeLessThan(4);
          expect(mulligan.after.held, where).toBe(7);
          expect(mulligan.after.scrollLeft, `${where}: the mulligan scrolled like a draw`).toBe(0);
          expect(mulligan.after.firstInView, where).toBe(true);

          // Three cards played after the draw: five held, all of which fit, so
          // the row gives back what the draw took.
          const played = await measure(chrome, directory, 'play', viewport);
          expect(played.before.held, where).toBe(8);
          expect(played.after.held, where).toBe(5);
          expect(played.after.firstInView, `${where}: cards left and the row kept its scroll`).toBe(true);
          expect(played.after.lastInView, where).toBe(true);
          if (viewport.overflows) {
            expect(played.before.scrollLeft, `${where}: the draw left nothing to give back`).toBeGreaterThan(
              0,
            );
          }

          // Three gone and one drawn in one render: the new card is in view and
          // the row keeps no scroll past it.
          const swapped = await measure(chrome, directory, 'swap', viewport);
          expect(swapped.after.held, where).toBe(6);
          expect(swapped.after.lastInView, `${where}: the card drawn with the discard is out of view`).toBe(
            true,
          );
          if (swapped.after.scrollLeft > 0) {
            expect(
              swapped.after.pastLast,
              `${where}: the row kept scroll past its last card`,
            ).toBeLessThanOrEqual(1);
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});
