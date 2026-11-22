/**
 * The art-pending pill's ink, rendered rather than reasoned about.
 *
 * `mtg-bc2.104`. `mtg-90x.4` converged the micro-label's three axes and left
 * one exception standing on the ink axis: `.mtg-art__pending-label` keeps
 * `--mtg-pending` amber where the other nine uppercase labels take faint or
 * muted ink. The argument for it was made from source and semantics — amber is
 * the lab's word for withheld, the pending slot exists to announce itself, and
 * the pill sits on `--mtg-surface-raised` inside a hatched frame where faint
 * ink would disappear. Nobody rendered it. Its sibling decision on the same
 * label, the tracking, *was* rendered both ways before it moved, and DESIGN.md
 * records that; the ink axis had a paragraph and no picture.
 *
 * So this paints the pill three ways in both themes and reads the pixels back:
 *
 *   npx tsx packages/ui/tools/pending-ink.ts
 *
 * # What it measures, and why pixels rather than tokens
 *
 * A token pair's contrast ratio is arithmetic anybody can do from
 * `../src/styles/tokens.ts`, and `../test/support/oklch.ts` already does it.
 * That number is the ceiling, not the reading. This label is drawn at 0.6875rem
 * in 600 weight, and at the board size the clamp takes it to 8px — small enough
 * that a stroke could be one pixel wide and antialiasing never let the glyph
 * reach the declared color. The question the exception turns on is what a
 * *reader* gets, which is the ink the screen actually paints.
 *
 * Two numbers per pill, therefore. The token ratios are taken from probe
 * swatches painted with the same `var()` on the same page, so they are the
 * browser's own OKLCH conversion rather than a second implementation of one.
 * `drawn` is the contrast of the most extreme pixel inside the pill against the
 * pill's modal pixel, which is the darkest ink any stroke of that label
 * achieved. Their ratio is how much of the token the type size gave back.
 *
 * Both surfaces the pill appears on are driven: the Cards gallery, where the
 * face is drawn at its designed width, and the played board through
 * `./combat-board.ts`, where the same pill is drawn at the `art` tile's size
 * and at the board face's clamp floor.
 *
 * # The 2026-08-27 report
 *
 * chrome-headless-shell at 1440x900, four gallery faces and the
 * `crowded-tapped` board, `prefers-color-scheme` emulated both ways.
 *
 *   ink       on raised   on sunken   drawn at 11px   drawn at 8px   stroke
 *   pending      3.33:1      2.85:1      3.33:1         3.33:1       23-31%
 *   faint        3.07:1      2.63:1      3.07:1         3.07:1       23-30%
 *   muted        7.01:1      5.99:1      7.01:1 (*)     7.01:1       24-31%
 *
 *   (*) 6.97:1 on the `art` tile, which is one pill rounding, not a size effect.
 *
 * **1. The theme axis is not there to be measured.** Every registered route
 * pins the paper palette: `tokens.ts`'s `SCOPED_PALETTES` maps each `UI_MODE`
 * to `PAPER_PALETTE` for both light *and* dark, so the shell resolves the same
 * five tokens under either preference and only the document root outside it
 * goes dark. Every row above is identical between the two emulated themes, and
 * the rig proves it rather than assuming it: it reads the tokens at `:root` and
 * inside `.mtg-shell` and prints whether the scope follows or overrides. The
 * bead's premise that dark is the harder case, because `--mtg-pending` is
 * lighter there than `--mtg-ink-faint`, describes a palette no route shows.
 *
 * **2. The amber beats the faint ink, by a little.** 3.33:1 against 3.07:1 on
 * the pill's own ground, and 2.85:1 against 2.63:1 on the window behind it. So
 * moving the pill to faint ink loses contrast; the second half of DESIGN.md's
 * stated reason — that the hatched frame is where faint ink would disappear —
 * overstates a 0.26 difference between two inks that are both under AA.
 *
 * **3. The type size costs nothing.** The strokes reach the declared color at
 * every size drawn, 11px on the full face and the art tile and 8px on the board
 * face, and the stroke share of the sampled band is within eight points across
 * all three inks. Whatever a 600-weight micro-label loses at 8px, it is not
 * ink: the difference between these three arms is the token and only the token.
 *
 * **4. Muted would more than double it**, 7.01:1, and that is the option the
 * bead's two outcomes do not name. It is not this bead's to take: the sheet
 * treats sub-AA micro-labels as a class rather than as a defect
 * (`../src/styles/views.ts` says so where the step bar's ink is priced), so
 * moving this one selector to muted would be a change to the Micro-Label Rule
 * rather than a fix to the exception under it.
 *
 * The verdict is therefore the first of the bead's two edits: the exception
 * stays, DESIGN.md records that it was rendered, and the clause the render
 * contradicts is corrected to the measured numbers.
 *
 * Node-only, like everything under `tools/`. It imports `chrome-driver` and
 * never `chrome.ts`: that module pulls in vitest, which throws outside a run.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { decodePng } from '@mtg/raster';
import { Shell } from '../src/app/Shell';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import {
  browserPresent,
  chromePath,
  cleanupTarget,
  launchChrome,
  shutdownChrome,
} from '../test/support/chrome-driver';
import type { CdpClient } from '../test/support/chrome-driver';
import { COMBAT_BOARDS, combatBoard, combatPage } from './combat-board';

/** The three inks the decision is between, in the order the bead names them. */
const INKS = [
  { key: 'pending', token: '--mtg-pending' },
  { key: 'faint', token: '--mtg-ink-faint' },
  { key: 'muted', token: '--mtg-ink-muted' },
] as const;

const THEMES = ['light', 'dark'] as const;

/** Four faces is a gallery; more only lengthens the page past the viewport. */
const GALLERY_CARDS = EXAMPLE_CARDS.slice(0, 4);

/** The crowded board draws the most pending pills at the clamp's floor. */
const BOARD = 'crowded-tapped';

const VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * Every token the report resolves from rendered pixels.
 *
 * `--mtg-surface-sunken` is here for a claim it is not the subject of: the ART
 * docblock in `../src/styles/card.ts` prices the amber at 2.9:1 on the sunken
 * window, which is the ground *behind* the pill rather than the pill's own, and
 * a number quoted beside the one being measured should come out of the same
 * frame rather than out of a different afternoon.
 */
const PROBE_TOKENS = [...INKS.map((ink) => ink.token), '--mtg-surface-raised', '--mtg-surface-sunken'];

function galleryPage(extraCss: string): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: GALLERY_CARDS,
        route: { mode: 'cards', sub: 'gallery', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  const sheet = `${uiStyleSheet()}html,body{margin:0;padding:0}${extraCss}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pending ink</title><style>${sheet}</style></head><body>${markup}</body></html>`;
}

function boardPage(extraCss: string): string {
  const spec = COMBAT_BOARDS.get(BOARD);
  if (spec === undefined) throw new Error(`combat-board.ts no longer defines ${BOARD}`);
  return combatPage(combatBoard(spec), { title: 'Pending ink', extraCss });
}

/**
 * The pill boxes, and a strip of probe swatches for the tokens themselves.
 *
 * The probes are `position: fixed` in the corner so nothing reflows around
 * them, and each is painted with the same `var()` the sheet writes — reading
 * their pixels off the same frame is what makes `declared` the browser's own
 * conversion rather than a second one written here.
 */
const MEASURE = `(() => {
  const strip = document.createElement('div');
  strip.style.cssText = 'position:fixed;inset-block-end:0;inset-inline-start:0;z-index:9999;display:flex;';
  const tokens = ${JSON.stringify(PROBE_TOKENS)};
  const probes = tokens.map((token) => {
    const swatch = document.createElement('div');
    swatch.style.cssText = 'width:12px;height:12px;background:var(' + token + ');';
    strip.append(swatch);
    return { token, swatch };
  });
  // Inside the shell, because that is the scope the pill lives in: every route
  // is registered in SCOPED_PALETTES and every registration is the paper
  // palette, so a probe on <body> reads the document palette instead and
  // answers for a surface the app never shows.
  const scope = document.querySelector('.mtg-shell');
  if (scope === null) throw new Error('no .mtg-shell on the page to scope the probes to');
  scope.append(strip);
  void document.documentElement.offsetHeight;
  const rect = (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  };
  const inView = (box) =>
    box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0 &&
    box.x + box.w <= window.innerWidth && box.y + box.h <= window.innerHeight;
  const pills = [...document.querySelectorAll('.mtg-art__pending-label')].map((pill) => {
    const face = pill.closest('.mtg-card');
    const style = getComputedStyle(pill);
    const box = rect(pill);
    return {
      size: face === null ? 'none' : (face.getAttribute('data-size') ?? 'none'),
      fontPx: Math.round(parseFloat(style.fontSize) * 100) / 100,
      color: style.color,
      box,
      inView: inView(box),
    };
  });
  const declaredIn = (el) => {
    const style = getComputedStyle(el);
    return tokens.map((token) => style.getPropertyValue(token).trim()).join(' ');
  };
  return {
    scheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    rootPalette: declaredIn(document.documentElement),
    scopePalette: declaredIn(scope),
    probes: probes.map((probe) => ({ token: probe.token, box: rect(probe.swatch) })),
    pills,
    page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
  };
})()`;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface PillReading {
  readonly size: string;
  readonly fontPx: number;
  /** The used value of the ink, so an arm that failed to override says so. */
  readonly color: string;
  readonly box: Box;
  readonly inView: boolean;
}

interface Frame {
  readonly scheme: string;
  /** The token values at `:root`, which no registered route ever shows. */
  readonly rootPalette: string;
  /** The same tokens inside `.mtg-shell`, which is what the pill resolves. */
  readonly scopePalette: string;
  readonly probes: readonly { readonly token: string; readonly box: Box }[];
  readonly pills: readonly PillReading[];
  readonly page: { readonly width: number; readonly height: number };
}

type Rgb = readonly [number, number, number];

/**
 * WCAG relative luminance from 8-bit sRGB.
 *
 * `../test/support/oklch.ts` computes the same quantity from an OKLCH triple,
 * which is the space the palette is authored in; this one starts from the
 * pixels a screenshot carries and there is no OKLCH left in them. Two entry
 * points into one formula rather than a shared helper, because the shared part
 * is three coefficients and the conversion in front of it is the whole of each.
 */
function luminance([r, g, b]: Rgb): number {
  const linear = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function pixelAt(image: Raster, x: number, y: number): Rgb {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0];
}

/** Every pixel inside a box, inset past the border and the corner radius. */
function pixelsIn(image: Raster, box: Box, inset: number, blockInset = inset): readonly Rgb[] {
  const left = Math.max(0, Math.round(box.x) + inset);
  const top = Math.max(0, Math.round(box.y) + blockInset);
  const right = Math.min(image.width, Math.round(box.x + box.w) - inset);
  const bottom = Math.min(image.height, Math.round(box.y + box.h) - blockInset);
  const pixels: Rgb[] = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) pixels.push(pixelAt(image, x, y));
  }
  return pixels;
}

/** The most common exact color in a sample: a pill's ground, or a probe's fill. */
function modal(pixels: readonly Rgb[]): Rgb {
  const counts = new Map<string, { color: Rgb; count: number }>();
  for (const pixel of pixels) {
    const key = pixel.join(',');
    const entry = counts.get(key) ?? { color: pixel, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { color: Rgb; count: number } | null = null;
  for (const entry of counts.values()) {
    if (best === null || entry.count > best.count) best = entry;
  }
  if (best === null) throw new Error('a sampled region held no pixels');
  return best.color;
}

interface PillMeasurement {
  readonly size: string;
  readonly fontPx: number;
  /** The contrast the extreme pixel inside the pill reached against its ground. */
  readonly drawn: number;
  /** The share of the sampled band within half that distance of the extreme. */
  readonly coverage: number;
}

/**
 * The contrast a pill's strokes actually reached, and how much of it is stroke.
 *
 * `drawn` is the extreme pixel rather than the mean, because a reader
 * identifies a letterform from its core and the mean over a box that is mostly
 * ground would answer a question nobody asked. `coverage` is the share of the
 * box within half that distance of the extreme, which is the width of the
 * stroke in the only unit that matters at 8px: how many pixels got there.
 */
function measurePill(image: Raster, pill: PillReading): PillMeasurement | null {
  // Proportional rather than a flat two pixels, and the flat one is why: the
  // pill is a 1px `--mtg-line` border on a radius, and at the `art` size the
  // box is 15px tall, so two pixels of inset still caught the ring at the
  // corners. That ring is darker than both the amber and the faint ink, so it
  // won the "furthest from the ground" search and reported one number for two
  // different inks. The middle band cannot contain a border pixel and does
  // contain the cap height of an uppercase line.
  const inset = Math.max(2, Math.round(pill.box.w * 0.1));
  const blockInset = Math.max(2, Math.round(pill.box.h * 0.2));
  const pixels = pixelsIn(image, pill.box, inset, blockInset);
  if (pixels.length === 0) return null;
  const ground = modal(pixels);
  const groundLuminance = luminance(ground);
  let extreme = ground;
  let furthest = 0;
  for (const pixel of pixels) {
    const distance = Math.abs(luminance(pixel) - groundLuminance);
    if (distance > furthest) {
      furthest = distance;
      extreme = pixel;
    }
  }
  const near = pixels.filter(
    (pixel) => Math.abs(luminance(pixel) - groundLuminance) >= furthest * 0.5,
  ).length;
  return {
    size: pill.size,
    fontPx: pill.fontPx,
    drawn: contrast(extreme, ground),
    coverage: near / pixels.length,
  };
}

async function captureFrame(
  client: CdpClient,
  file: string,
  dark: boolean,
  settleSelector: string,
  label: string,
): Promise<{ frame: Frame; image: Raster }> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await client.call(
      'Emulation.setEmulatedMedia',
      {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
        ],
      },
      sessionId,
    );
    const navigation = await client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    if (navigation['errorText'] !== undefined) {
      throw new Error(`Chrome could not load ${label}: ${String(navigation['errorText'])}`);
    }
    const settled = await client.call(
      'Runtime.evaluate',
      {
        expression: `new Promise((resolve) => {
          const check = () => {
            const faces = document.querySelectorAll(${JSON.stringify(settleSelector)}).length;
            const moving = document.getAnimations().filter((animation) =>
              animation.playState === 'pending' || animation.playState === 'running').length;
            if (document.readyState === 'complete' && faces > 0 && moving === 0) {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(faces)));
              return;
            }
            requestAnimationFrame(check);
          };
          check();
        })`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      8_000,
    );
    if (settled['exceptionDetails'] !== undefined) {
      throw new Error(`${label} never settled: ${JSON.stringify(settled['exceptionDetails'])}`);
    }
    const measured = await client.call(
      'Runtime.evaluate',
      { expression: MEASURE, returnByValue: true },
      sessionId,
    );
    if (measured['exceptionDetails'] !== undefined) {
      throw new Error(`${label} measurement failed: ${JSON.stringify(measured['exceptionDetails'])}`);
    }
    const frame = (measured['result'] as { readonly value?: Frame } | undefined)?.value;
    if (frame === undefined) throw new Error(`${label} returned no reading`);
    const shot = await client.call('Page.captureScreenshot', { format: 'png' }, sessionId, 15_000);
    const image = decodePng(Buffer.from(String(shot['data']), 'base64'));
    return { frame, image };
  } finally {
    await cleanupTarget(client, targetId, sessionId);
  }
}

function inkRule(token: string): string {
  return `.mtg-art__pending-label { color: var(${token}); }`;
}

interface Surface {
  readonly name: string;
  readonly page: (extraCss: string) => string;
  readonly settle: string;
}

const SURFACES: readonly Surface[] = [
  { name: 'gallery', page: galleryPage, settle: '.mtg-card' },
  { name: 'board', page: boardPage, settle: ".mtg-slot[data-slot='play'] > .mtg-card" },
];

function format(value: number, places: number): string {
  return value.toFixed(places);
}

async function main(): Promise<void> {
  if (!browserPresent) {
    console.error(`no chrome-headless-shell at ${chromePath}`);
    process.exitCode = 1;
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'mtg-pending-ink-'));
  const profile = await mkdtemp(join(tmpdir(), 'mtg-pending-ink-profile-'));
  const chrome = await launchChrome(profile);
  try {
    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        console.log(`\n${surface.name} / ${theme}`);
        for (const ink of INKS) {
          const file = join(dir, `${surface.name}-${theme}-${ink.key}.html`);
          await writeFile(file, surface.page(inkRule(ink.token)), 'utf8');
          const label = `${surface.name} ${theme} ${ink.key}`;
          const { frame, image } = await captureFrame(
            chrome.client,
            file,
            theme === 'dark',
            surface.settle,
            label,
          );
          if (frame.scheme !== theme) {
            throw new Error(`${label} rendered under ${frame.scheme}, not ${theme}`);
          }
          if (ink === INKS[0]) {
            console.log(
              `  palette  shell ${frame.scopePalette === frame.rootPalette ? 'follows' : 'overrides'} root; shell [${frame.scopePalette}]`,
            );
          }
          const swatch = new Map(
            frame.probes.map((probe) => [probe.token, modal(pixelsIn(image, probe.box, 2))]),
          );
          const raised = swatch.get('--mtg-surface-raised');
          const declaredInk = swatch.get(ink.token);
          if (raised === undefined || declaredInk === undefined) {
            throw new Error(`${label} lost a probe swatch`);
          }
          const sunken = swatch.get('--mtg-surface-sunken');
          if (sunken === undefined) throw new Error(`${label} lost the sunken probe`);
          const declared = contrast(declaredInk, raised);
          const onWindow = contrast(declaredInk, sunken);
          const inks = new Set(frame.pills.map((pill) => pill.color));
          if (inks.size !== 1) {
            throw new Error(`${label} drew ${String(inks.size)} inks: ${[...inks].join(', ')}`);
          }
          const rows = frame.pills
            .filter((pill) => pill.inView)
            .map((pill) => measurePill(image, pill))
            .filter((row): row is PillMeasurement => row !== null);
          const bySize = new Map<string, PillMeasurement[]>();
          for (const row of rows) {
            const bucket = bySize.get(row.size) ?? [];
            bucket.push(row);
            bySize.set(row.size, bucket);
          }
          const parts = [...bySize].map(([size, bucket]) => {
            const worst = bucket.reduce((low, row) => (row.drawn < low.drawn ? row : low));
            const coverage = bucket.reduce((sum, row) => sum + row.coverage, 0) / bucket.length;
            return `${size} n${String(bucket.length)} ${format(worst.fontPx, 1)}px drawn ${format(worst.drawn, 2)}:1 (${format((worst.drawn / declared) * 100, 0)}% of token) stroke ${format(coverage * 100, 1)}%`;
          });
          console.log(
            `  ${ink.key.padEnd(8)} on raised ${format(declared, 2)}:1  on sunken ${format(onWindow, 2)}:1  ${parts.join('  |  ')}`,
          );
        }
      }
    }
  } finally {
    await shutdownChrome(chrome);
    await rm(dir, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
}

await main();
