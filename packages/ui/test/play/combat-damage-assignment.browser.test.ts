import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { livePage } from '../support/live-page';

const entry = fileURLToPath(new URL('./combat-damage-assignment.browser-entry.ts', import.meta.url));
const measure = `(() => {
  const panel = document.querySelector('.mtg-damage-assignment');
  const inputs = [...document.querySelectorAll('.mtg-damage-assignment__amount')];
  const confirm = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Confirm damage');
  const box = (node) => {
    const value = node.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
  };
  return {
    serial: navigator.userAgent,
    viewport: [window.innerWidth, window.innerHeight],
    panel: box(panel),
    inputs: inputs.map(box),
    confirm: box(confirm),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

interface Reading {
  readonly serial: string;
  readonly viewport: readonly number[];
  readonly panel: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly inputs: readonly { readonly width: number; readonly height: number }[];
  readonly confirm: { readonly width: number; readonly height: number };
  readonly horizontalOverflow: number;
}

browserIt(
  'keeps the complete combat damage assignment usable on desktop and a narrow touch shell',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-damage-'));
    const page = join(directory, 'damage.html');
    await writeFile(page, await livePage(entry, 'Combat damage assignment'), 'utf8');
    let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
    try {
      chrome = await launchChrome(join(directory, 'chrome'));
      for (const [name, width, height, pointer] of [
        ['desktop', 1440, 900, 'fine'],
        ['narrow-touch', 375, 667, 'coarse'],
      ] as const) {
        const reading = (await measurePage(
          chrome.client,
          page,
          width,
          height,
          measure,
          name,
          '.mtg-damage-assignment',
          true,
          { pointer, mobile: pointer === 'coarse' },
        )) as unknown as Reading;
        console.log(
          `${name}: ${reading.serial}; panel ${reading.panel.right - reading.panel.left}x${reading.panel.bottom - reading.panel.top}; controls ${reading.inputs.map((input) => `${input.width}x${input.height}`).join(', ')}; confirm ${reading.confirm.width}x${reading.confirm.height}; overflow ${reading.horizontalOverflow}`,
        );
        expect(reading.viewport).toEqual([width, height]);
        expect(reading.horizontalOverflow).toBeLessThanOrEqual(0);
        expect(reading.panel.left).toBeGreaterThanOrEqual(0);
        expect(reading.panel.right).toBeLessThanOrEqual(width);
        expect(reading.inputs).toHaveLength(3);
        if (pointer === 'coarse') {
          expect(reading.inputs.every((input) => input.height >= 44 && input.width >= 44)).toBe(true);
          expect(reading.confirm.height).toBeGreaterThanOrEqual(44);
          expect(reading.confirm.width).toBeGreaterThanOrEqual(44);
        }
      }
    } finally {
      if (chrome !== null) await shutdownChrome(chrome);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
