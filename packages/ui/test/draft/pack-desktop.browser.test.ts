// @vitest-environment node
/**
 * The pack you are picking from, measured on a desktop window and on a phone.
 *
 * Two beads, and the second amends the first.
 *
 * `mtg-aqxi.15`. the playtester, off the web version: "in the desktop version while
 * drafting the cards shouldn't be so small that you need to click them to read
 * them, that's only acceptable on mobile." What she was looking at, read off a
 * real Chrome at 1440x900 on a thirteen-card pack: a face 205.19px wide whose
 * rules box was set at 12px and clamped to three line boxes, so a card with four
 * lines of text ended in an ellipsis and the only way to finish the sentence was
 * to tap the card and read it in the rail.
 *
 * `mtg-rgc.18`. the playtester again: "the cards should be sized while drafting so
 * they're all easily seen on one screen." Those two asks met a wall, and the
 * wall was arithmetic: an un-clamped face ran about 250px tall, the pack's box
 * at 1440x900 was 445px, and fifteen of them would not go. So the readable face
 * was rationed by a count -- six cards, the most that could afford one -- and a
 * full booster was read in the rail beside it.
 *
 * `mtg-2rmf` and `mtg-ao52` between them take the wall down. The box is no
 * longer 445px: it grows to the height the faces ask for. And the thing a
 * reading face actually demanded was never height but the 4rem picture under its
 * text, which is now a floor that yields. Both counts are gone; the width of the
 * column the grid gave the card decides alone.
 *
 * The three sentences this rig holds:
 *
 * 1. **A full pack at 1440x900 uses readable deckbuilder-scale cards.** The
 *    pack pane scrolls vertically when that scale needs more rows; it never
 *    compresses cards into thumbnails merely to keep all picks above the fold.
 * 2. **And it prints its own rules text.** The full pack, not a short one:
 *    clipping nothing, at or above `DESK_RULES_MIN_PX`, with a picture still
 *    under it. A short pack is measured beside it, because the face a last-picks
 *    pack draws is the widest this surface has and the rule has to hold at both
 *    ends of the range rather than at the end it was written for.
 * 3. **At 844x390 the phone grid is exactly the grid it was.** The same number
 *    of faces are drawn and the same number are wholly inside the scrolling
 *    region, and the rules box is still the small clamped one -- a desktop rule
 *    that leaked onto the phone would be a pack of four tall cards where ten
 *    used to be readable.
 *
 * The illustration is measured on the readable arm for the reason
 * `./rail-card-phone.browser.test.ts` gives about its own art floor: a rules box
 * allowed to take every pixel it wants reduces the window to a line, and a card
 * whose picture is gone is a different failure of the same panel.
 *
 * **The pointer is stated rather than derived.** A landscape phone is 844 CSS px
 * wide, which is a desktop width to every media query on this surface, so the
 * only thing separating the two arms is the emulated device -- the same trade the
 * phone rig beside this one makes.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftRoute } from '../../src/routes/DraftRoute';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(DraftRoute, {
        set: { status: 'ready', cards: EXAMPLE_CARDS },
        params: { seed: 'ui/draft-pack-desktop' },
        onSetParams: () => undefined,
      }),
    }),
  );
  return document(markup);
}

function document(markup: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pack</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The other pack this file is about: one that fits on a single row.
 *
 * `mtg-rgc.18`. `DraftPack` rather than the route, because the route deals pack
 * 1 pick 1 and a full booster is the arm above. Every rule here is keyed to
 * `.mtg-draft`, which this component is the element carrying, so the two pages
 * are the same arrangement with different numbers of cards in it.
 */
function shortPackPage(size: number): string {
  const cards = EXAMPLE_CARDS.slice(0, size);
  const next: HumanDraftChoice = {
    round: 3,
    pickNumber: 16 - size,
    packSize: size,
    openedBy: 0,
    cards,
  };
  const draft: HumanDraftProgress = {
    seed: 'ui/draft-pack-desktop',
    humanSeat: 0,
    picks: [],
    seats: [],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: next,
    result: null,
  };
  return document(
    renderToStaticMarkup(
      h(Shell, {
        mode: 'play',
        sub: 'draft',
        onSelectMode: () => undefined,
        title: 'MTG Lab',
        children: h(DraftPack, {
          draft,
          next,
          pool: [],
          onPick: () => undefined,
          onNewDraft: () => undefined,
        }),
      }),
    ),
  );
}

/**
 * One reading of the pack, face by face.
 *
 * `overflow` is the rules box hiding content it is shorter than, which is what a
 * `-webkit-line-clamp` does when the text is longer than its budget; `clamped`
 * reads the budget itself, because a box whose text happens to fit three lines
 * would report no overflow while still being a box that cuts the next card's
 * fourth line. Both, so the assertion is about the rule and not about which
 * cards the seed dealt.
 *
 * `readable` counts a face only when the whole of it is inside the region that
 * scrolls, which is the count `./pack-phone.browser.test.ts` states its before
 * and after in.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.mtg-work__scroll');
  if (scroll === null) return null;
  const box = scroll.getBoundingClientRect();
  const faces = [...scroll.querySelectorAll('.mtg-card')];
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    packCount: faces.length,
    packScroll: round(scroll.scrollHeight - scroll.clientHeight),
    packInlineScroll: round(scroll.scrollWidth - scroll.clientWidth),
    readable: faces.filter((face) => {
      const rect = face.getBoundingClientRect();
      return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
    }).length,
    faces: faces.map((face) => {
      const rules = face.querySelector('[data-region="rules"]');
      const art = face.querySelector('[data-region="art"]');
      const rect = face.getBoundingClientRect();
      const style = rules === null ? null : getComputedStyle(rules);
      return {
        label: face.getAttribute('aria-label'),
        size: face.getAttribute('data-size'),
        width: round(rect.width),
        height: round(rect.height),
        rulesFontPx: style === null ? null : round(parseFloat(style.fontSize)),
        rulesLines: style === null ? null : style.webkitLineClamp,
        rulesOverflow: rules === null ? null : round(rules.scrollHeight - rules.clientHeight),
        rulesText: rules === null ? '' : rules.textContent,
        artHeight: art === null ? null : round(art.getBoundingClientRect().height),
      };
    }),
  };
})()`;

interface Face {
  readonly label: string | null;
  readonly size: string | null;
  readonly width: number;
  readonly height: number;
  readonly rulesFontPx: number | null;
  readonly rulesLines: string | null;
  readonly rulesOverflow: number | null;
  readonly rulesText: string;
  readonly artHeight: number | null;
}

interface Reading {
  readonly coarse: boolean;
  readonly packCount: number;
  readonly packScroll: number;
  readonly packInlineScroll: number;
  readonly readable: number;
  readonly faces: readonly Face[];
}

/**
 * The smallest type the pack may print its rules text at on a desktop window.
 *
 * 12px rather than 13 since `mtg-ao52`, and the reason is that the claim now
 * covers the full pack. The box is set in `cqw` off the column the grid gave the
 * card, so it reaches `--mtg-text-sm` only where the column is wide: measured at
 * 1440x900, a 179px face from a six-card pack sets 13px and a 152px face from
 * the thirteen-card booster sets 12.36px. Both are a card being read; the number
 * this bead was filed against is the 11px the clamped box drew.
 */
const DESK_RULES_MIN_PX = 11;

/** The 214px full-card column used by the deckbuilding view and fit census. */
const DECKBUILDER_CARD_MIN_PX = 214;

/**
 * And the largest it may print it at on a landscape phone, which is where the
 * dense grid is the right trade. `--mtg-text-xs` is 12px at a 16px root and is
 * the ceiling the board face has always clamped to.
 */
const PHONE_RULES_MAX_PX = 12;

/**
 * What the phone grid drew before this bead touched anything: eight of the
 * thirteen dealt faces wholly inside the region that scrolls, and eight after.
 * Read off this page rather than borrowed from `./pack-phone.browser.test.ts`,
 * whose ten is measured on a page carrying a set notice and a picker this one
 * does not compose; a count is only comparable against itself.
 */
const PHONE_READABLE = 8;

/** The height below which the pack's art window has stopped being a picture. */
const ART_STRIP_MIN_PX = 24;

const SLACK_PX = 0.5;

/**
 * The short pack drawn beside the full one: one row of the widest faces this
 * surface draws, which is the other end of the range the reading rule covers.
 */
const SHORT_PACK = 6;

const SIZES = [
  { width: 1440, height: 900, coarse: false },
  { width: 844, height: 390, coarse: true },
] as const;

describe('the draft pack at the size the window allows', () => {
  browserIt(
    'uses deckbuilder-scale cards on a roomy desktop and keeps the phone grid',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-desk-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-desk-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const full = join(directory, 'draft.html');
      const short = join(directory, 'draft-short.html');
      await writeFile(full, page(), 'utf8');
      await writeFile(short, shortPackPage(SHORT_PACK), 'utf8');
      const read = async (file: string, size: (typeof SIZES)[number]): Promise<Reading> => {
        const at = `${String(size.width)}x${String(size.height)}`;
        const seen = (await measurePage(
          chrome.client,
          file,
          size.width,
          size.height,
          MEASURE,
          at,
          '.mtg-work__scroll',
          true,
          size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
        )) as unknown as Reading | null;
        if (seen === null) throw new Error(`${at}: the page drew no draft workspace`);
        expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(size.coarse);
        expect(seen.packCount, `${at}: the pack drew no faces`).toBeGreaterThan(0);
        return seen;
      };
      try {
        const desk = await read(full, SIZES[0]);
        const phone = await read(full, SIZES[1]);
        const oneRow = await read(short, SIZES[0]);

        // 1. Every card in a full pack keeps the same readable scale as a full
        //    card in the deckbuilder. Vertical scrolling is the explicit price
        //    of readability; horizontal clipping is not.
        expect(
          desk.packCount,
          '1440x900: the rig dealt a pack short enough to widen its own faces',
        ).toBeGreaterThan(SHORT_PACK);
        expect(
          desk.packInlineScroll,
          '1440x900: readable cards leave the pack horizontally',
        ).toBeLessThanOrEqual(SLACK_PX);
        for (const face of desk.faces) {
          expect(face.size, '1440x900: the pack substituted a battlefield face').toBe('full');
          expect(
            face.width,
            '1440x900: the pack compressed a card below deckbuilder scale',
          ).toBeGreaterThanOrEqual(DECKBUILDER_CARD_MIN_PX);
          expect(face.height / face.width, '1440x900: the pack distorted a card to fit its pane').toBeCloseTo(
            88 / 63,
            2,
          );
        }

        // 2. And both ends of the range read on the pack: the full booster,
        //    which is the narrowest column this surface draws, and the
        //    last-picks pack, which is the widest.
        expect(oneRow.readable, '1440x900: a short pack is not wholly on screen').toBe(oneRow.packCount);
        for (const [what, reading] of [
          ['the full pack', desk],
          ['a short pack', oneRow],
        ] as const) {
          const withRules = reading.faces.filter((face) => face.rulesText.trim() !== '');
          expect(withRules.length, `1440x900: no face in ${what} printed any rules text`).toBeGreaterThan(0);
          for (const face of withRules) {
            expect(
              face.rulesFontPx ?? 0,
              `1440x900: a ${String(face.width)}px face in ${what} sets its rules text at ${String(face.rulesFontPx)}px`,
            ).toBeGreaterThanOrEqual(DESK_RULES_MIN_PX);
            expect(
              face.rulesOverflow ?? 0,
              `1440x900: ${face.label ?? 'a card'} at ${String(face.width)}px in ${what} hides rules text it is shorter than`,
            ).toBeLessThanOrEqual(SLACK_PX);
            expect(face.rulesLines, `1440x900: ${what} still cuts its rules box at a line budget`).toBe(
              'none',
            );
            expect(
              face.artHeight ?? -1,
              `1440x900: the art window in ${what} collapsed to a line under the rules box`,
            ).toBeGreaterThanOrEqual(ART_STRIP_MIN_PX);
          }
        }

        // 3. The phone keeps the grid it was measured with.
        expect(phone.packCount, '844x390: the phone lost faces from the pack').toBe(desk.packCount);
        expect(
          phone.readable,
          '844x390: fewer faces are wholly on screen than the phone grid drew',
        ).toBeGreaterThanOrEqual(PHONE_READABLE);
        for (const face of phone.faces) {
          expect(face.size, '844x390: the pack substituted a second card anatomy').toBe('full');
          if (face.rulesFontPx === null) continue;
          expect(
            face.rulesFontPx,
            `844x390: the desktop type size leaked onto the phone grid`,
          ).toBeLessThanOrEqual(PHONE_RULES_MAX_PX);
          expect(face.rulesLines, `844x390: the pack no longer uses the complete card face`).toBe('none');
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
