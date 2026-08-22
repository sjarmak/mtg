// @vitest-environment node
/**
 * The zoom panel opens for the card that was just tapped, and for no other.
 *
 * The playtester, 2026-08-22, playing on a phone: "currently when I select a card to
 * play it it shows a big view of another card next to it which is annoying",
 * and then, later the same day: "when you click a card you should be able to
 * see the full version of its card text". Those read as opposites and are not.
 * `../../src/card/ZoomPanel.ts` is drawn by the slot it belongs to and has never
 * drawn any card but that slot's own; what she was looking at was the *previous*
 * card's panel, still up beside the one she was playing.
 *
 * **Chrome leaves a tapped element `:hover` until something else is touched.**
 * That is the whole mechanism. The old rule opened on `:hover` or
 * `:focus-within`, so the first tap raised a panel and nothing took it down —
 * a second tap moved focus but not the stale hover, and at 844x390 the result
 * was a 320 x 447px face, taller than the screen, parked over the table. So the
 * coarse arm suppresses a hover that is not also this slot's focus, and opens on
 * the focus itself, which is the one signal that moves when the finger does.
 *
 * **This file drives real input**, and that is why it lives at the CDP layer
 * rather than in jsdom. Chrome's `:focus-visible` heuristic reads the input that
 * caused the focus and it does not read `dispatchEvent`: a probe that calls
 * `element.focus()` reports `:focus-visible` true on a phone, which is the
 * opposite of what a finger gets. `Input.dispatchTouchEvent`,
 * `Input.dispatchKeyEvent` and `Input.dispatchMouseEvent` are the three that
 * tell the truth, and the two-tap case below is only a case at all because the
 * hover it depends on is a real one.
 *
 * **What the rig cannot say**, stated because the CSS is written around it:
 * chrome-headless-shell has no mouse, so it answers `(hover: none)` and
 * `(pointer: none)` at every viewport, and `Emulation.setEmulatedMedia`
 * overrides neither back — only the narrowing to `coarse` takes. A rule gated on
 * `(pointer: fine)` or `(hover: hover)` would be dead in every rig here and its
 * desktop half untestable, which is why `../../src/styles/card.ts` writes the
 * desktop path as the unconditional rule and the phone as the exception. The
 * third and fourth cases below are the guard on that choice: they run on the
 * default rig, which is not coarse, and the desktop behavior is unchanged.
 *
 * **And the panel has to fit**, which is the other half of her second sentence:
 * a card whose bottom 73px are off the top of the screen is not the full version
 * of its text. The size is asserted here rather than in a second file because it
 * is the same gesture being measured — what a tap produces is a panel, and a
 * panel that does not fit is the same defect as one that draws the wrong card.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { CardSlot } from '../../src/board/CardSlot';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, shutdownChrome } from '../support/chrome';

/** The two faces, named so a reading can say which panel it is looking at. */
const FIRST_CARD = 'slc-skywatch-sentinel';
const SECOND_CARD = 'slc-windrider-drake';
/** The third slot draws no button at all; the cases below say why that matters. */
const INERT_CARD = 'slc-lifebound-cleric';

/**
 * Two cards in hand, because one of the four cases is about the second tap.
 *
 * Different cards on purpose: the panel is read back by the name printed on it,
 * so "exactly one panel and it is the second card's" is a claim the reading can
 * actually make rather than a count that two identical faces would satisfy
 * either way.
 */
function page(): string {
  const markup = renderToStaticMarkup(
    h(
      'div',
      // Held off the origin on purpose: Chrome parks its cursor at 0,0, so a
      // slot drawn there is `:hover` before any input is dispatched and the
      // desktop case below cannot tell an idle page from a hovered one.
      //
      // A row rather than the default stack, which is how a table draws them
      // and, here, the difference between a gesture and a no-op: stacked, the
      // three slots run 697px down a 390px-tall phone, so the third one's
      // center was at y=591 and the tap that was supposed to land on it landed
      // on nothing at all. Measured, not assumed — `document.elementFromPoint`
      // at that center returned null.
      { style: { padding: '60px', display: 'flex', gap: '12px' } },
      h(CardSlot, {
        kind: 'hand',
        card: exampleCard(FIRST_CARD),
        onSelect: () => undefined,
      }),
      h(CardSlot, {
        kind: 'hand',
        card: exampleCard(SECOND_CARD),
        onSelect: () => undefined,
      }),
      // No `onSelect`, which is most of the cards on a played table most of the
      // time: `../../src/card/Card.ts` draws that face as a `div` with
      // `role="group"`, and carries `tabIndex={-1}` on it precisely so a
      // pointer can still focus it. Last on purpose, so the two button indices
      // above keep meaning what they meant.
      h(CardSlot, { kind: 'play', card: exampleCard(INERT_CARD) }),
    ),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zoom triggers</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Every panel currently drawn: the name printed on it, its face box, and how
 * much of that box is off the top or bottom of the screen.
 *
 * The name is what makes "the wrong card's panel" a thing this file can say. The
 * off-screen figure is signed the way it matters: the panel is pinned to the
 * bottom, so an oversized one runs off the *top*, which a bottom-edge check
 * alone would have called clean.
 */
const ZOOMS = `[...document.querySelectorAll('.mtg-zoom')]
  .filter((z) => getComputedStyle(z).display !== 'none')
  .map((z) => {
    const face = z.querySelector('.mtg-card');
    const name = z.querySelector('.mtg-card__name');
    const box = face === null ? null : face.getBoundingClientRect();
    return {
      name: name === null ? null : name.textContent,
      face: box === null ? null : [Math.round(box.width), Math.round(box.height)],
      offScreen:
        box === null
          ? null
          : Math.round(Math.max(0, -box.top) + Math.max(0, box.bottom - window.innerHeight)),
    };
  })`;

const FOCUS = `[document.activeElement.tagName, document.activeElement.matches(':focus-visible')]`;

/** How long Chrome is given to settle a layout or a hover after an input event. */
const SETTLE_MS = 150;

/** How long a freshly navigated page is given before its first reading. */
const LOAD_MS = 1200;

/**
 * Five gestures, each on its own page, against a 5s default they did not fit
 * in. A page per gesture rather than one page for all five, because hover and
 * focus are both sticky and a reading taken after an earlier gesture would be
 * measuring the pair — which is the very thing the two-tap case exists to catch,
 * so it has to be the deliberate case rather than the ambient state.
 */
const BUDGET_MS = 90_000;

type Gesture = 'tap' | 'tapTwice' | 'tab' | 'hover' | 'clickAway' | 'tapInert' | 'tapInertThenCard';

interface Panel {
  readonly name: string | null;
  readonly face: readonly [number, number] | null;
  readonly offScreen: number | null;
}

interface Reading {
  readonly idle: readonly Panel[];
  readonly focus: readonly [string, boolean];
  readonly zooms: readonly Panel[];
}

describe('the zoom panel answers the card that was just pressed', () => {
  browserIt(
    'opens on the tapped card, moves to the next one, and fits the screen it is drawn on',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-zoom-touch-'));
      const file = join(directory, 'page.html');
      await writeFile(file, page(), 'utf8');
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-zoom-touch-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const client = chrome.client;
      const read = async (coarse: boolean, gesture: Gesture): Promise<Reading> => {
        const target = await client.call('Target.createTarget', { url: 'about:blank' });
        const targetId = String(target['targetId']);
        const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
        const sid = String(attached['sessionId']);
        try {
          await client.call('Page.enable', {}, sid);
          await client.call(
            'Emulation.setDeviceMetricsOverride',
            { width: coarse ? 844 : 1440, height: coarse ? 390 : 900, deviceScaleFactor: 1, mobile: coarse },
            sid,
          );
          if (coarse) {
            await client.call(
              'Emulation.setEmulatedMedia',
              {
                features: [
                  { name: 'pointer', value: 'coarse' },
                  { name: 'any-pointer', value: 'coarse' },
                ],
              },
              sid,
            );
            await client.call('Emulation.setTouchEmulationEnabled', { enabled: true }, sid);
          }
          await client.call('Page.navigate', { url: pathToFileURL(file).href }, sid);
          await new Promise((resolve) => setTimeout(resolve, LOAD_MS));
          const evaluate = async (expression: string): Promise<unknown> => {
            const out = await client.call('Runtime.evaluate', { expression, returnByValue: true }, sid);
            return (out['result'] as Record<string, unknown>)['value'];
          };
          const idle = (await evaluate(ZOOMS)) as readonly Panel[];
          const centerOf = async (selector: string, index: number): Promise<readonly [number, number]> =>
            (await evaluate(
              `(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${String(index)}].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
            )) as readonly [number, number];
          const middleOf = async (index: number): Promise<readonly [number, number]> =>
            centerOf('.mtg-slot button', index);
          // The inert slot has no button to aim at, so this one aims at the slot.
          const inertMiddle = async (): Promise<readonly [number, number]> => centerOf('.mtg-slot', 2);
          const touch = async (at: readonly [number, number]): Promise<void> => {
            const touchPoints = [{ x: at[0], y: at[1] }];
            await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }, sid);
            await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
            await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          };
          if (gesture === 'tap') {
            await touch(await middleOf(0));
          } else if (gesture === 'tapTwice') {
            await touch(await middleOf(0));
            await touch(await middleOf(1));
          } else if (gesture === 'tapInert') {
            await touch(await inertMiddle());
          } else if (gesture === 'tapInertThenCard') {
            await touch(await inertMiddle());
            await touch(await middleOf(0));
          } else if (gesture === 'hover') {
            const at = await middleOf(0);
            await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] }, sid);
          } else if (gesture === 'clickAway') {
            const at = await middleOf(0);
            await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] }, sid);
            for (const type of ['mousePressed', 'mouseReleased']) {
              await client.call(
                'Input.dispatchMouseEvent',
                { type, x: at[0], y: at[1], button: 'left', clickCount: 1 },
                sid,
              );
            }
            await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 }, sid);
          } else {
            for (const type of ['rawKeyDown', 'keyUp']) {
              await client.call(
                'Input.dispatchKeyEvent',
                { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
                sid,
              );
            }
          }
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          return {
            idle,
            focus: (await evaluate(FOCUS)) as readonly [string, boolean],
            zooms: (await evaluate(ZOOMS)) as readonly Panel[],
          };
        } finally {
          await client.call('Target.closeTarget', { targetId }, sid);
        }
      };
      const named = (card: string): string => exampleCard(card).name;
      try {
        // A finger, which is the gesture she asked for by name. The tapped card
        // takes focus, as any pressed button does, and the panel it opens is its
        // own — and the whole of it is on the screen. Before
        // `../../src/styles/mobile.ts` capped the face it was 320 x 447px on a
        // 390px-tall viewport, so 73px of card, the bottom of the rules box
        // among them, were off the top edge.
        const tapped = await read(true, 'tap');
        expect(tapped.idle).toEqual([]);
        expect(tapped.focus[0]).toBe('BUTTON');
        expect(tapped.zooms).toHaveLength(1);
        expect(tapped.zooms[0]?.name).toBe(named(FIRST_CARD));
        expect(tapped.zooms[0]?.offScreen).toBe(0);

        // And the second tap, which is the defect itself. Chrome leaves the
        // first card hovered, so before the coarse rule there were two panels up
        // and the older one was the larger surprise: she was playing the second
        // card and reading the first one's face beside it.
        const again = await read(true, 'tapTwice');
        expect(again.zooms).toHaveLength(1);
        expect(again.zooms[0]?.name).toBe(named(SECOND_CARD));
        expect(again.zooms[0]?.offScreen).toBe(0);

        // A card with nothing to do, which is most of what is on a table most
        // of the time and every card on it while the game is paused. the playtester,
        // 2026-08-22, after the two cases above landed: "clicking a card still
        // doesn't show the larger view." A face with no `onSelect` is a `div`
        // with `role="group"`, a `div` cannot take focus, and the coarse arm read
        // focus and nothing else, so the one card class a player taps purely to
        // read was the one class that answered nothing.
        const inert = await read(true, 'tapInert');
        expect(inert.idle).toEqual([]);
        expect(inert.zooms).toHaveLength(1);
        expect(inert.zooms[0]?.name).toBe(named(INERT_CARD));
        expect(inert.zooms[0]?.offScreen).toBe(0);

        // And it is still one panel at a time. Chrome's sticky hover is what
        // carries the case above, and this is the check that it hands the panel
        // over rather than keeping a second one: a tap on a button both moves the
        // hover and takes the focus.
        const handedOver = await read(true, 'tapInertThenCard');
        expect(handedOver.zooms).toHaveLength(1);
        expect(handedOver.zooms[0]?.name).toBe(named(FIRST_CARD));

        // The same phone, reached by keyboard. `:focus-visible` is true for a Tab
        // and false for a tap, and the unconditional rule carries this case on
        // both arms, so a tablet with a keyboard on it keeps the panel.
        const tabbed = await read(true, 'tab');
        expect(tabbed.focus[1]).toBe(true);
        expect(tabbed.zooms).toHaveLength(1);

        // The desktop path is untouched: this rig is not coarse, so neither
        // coarse rule applies and hovering draws the panel as it always has, at
        // the full 20rem.
        const hovered = await read(false, 'hover');
        expect(hovered.idle).toEqual([]);
        expect(hovered.zooms).toHaveLength(1);
        expect(hovered.zooms[0]?.offScreen).toBe(0);

        // And a mouse that clicks a card and then leaves it takes the panel with
        // it. This is the case that keeps `:focus-visible` in the unconditional
        // rule rather than the `:focus-within` the coarse arm uses: on a pointer
        // the click's leftover focus is not a request to keep reading, and a
        // panel answering it would sit over the table until something else was
        // clicked, which is her complaint arriving through the other device.
        const left = await read(false, 'clickAway');
        expect(left.focus[0]).toBe('BUTTON');
        expect(left.focus[1]).toBe(false);
        expect(left.zooms).toEqual([]);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    BUDGET_MS,
  );
});
