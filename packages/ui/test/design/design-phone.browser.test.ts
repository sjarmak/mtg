// @vitest-environment node
/**
 * The brief editor on a phone, measured in a real browser rather than described.
 *
 * `mtg-yddw.2`. `./design-route.test.ts` is jsdom and answers what the editor
 * *says*: which fields it draws, which refusals reach which field, what the run
 * button offers. jsdom performs no layout, so it cannot answer the question a
 * two-column form on a 390px screen actually raises — whether the thing fits.
 * This rig does, on the same phone metrics `../lab/bottom-nav.browser.test.ts`
 * uses, because a designer with a laptop closed is exactly the person a
 * seventh destination on the phone bar was added for.
 *
 * The server is stubbed inside the page, but its answers are not invented: they
 * are computed here in node by `@mtg/setgen`'s own vocabulary, validator and
 * planner over a brief this repository ships, and inlined into the bundle. A
 * hand-written vocabulary would have laid out a form of the wrong width.
 *
 * Three sentences:
 *
 * 1. The page does not scroll sideways, and no control hangs off the edge.
 * 2. Every control a finger has to hit is finger-sized.
 * 3. The skeleton the server planned is on the screen, so what is measured is
 *    the full form rather than an empty one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect } from 'vitest';
import { designVocabulary, planSkeleton, validateBrief } from '@mtg/setgen';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { DRAFT_STORAGE_KEY } from '../../src/routes/design/draft-store';

const UI = new URL('../../src/', import.meta.url).pathname;
const ROOT = new URL('../../../../', import.meta.url).pathname;
const BRIEF_DIR = fileURLToPath(new URL('../../../setgen/briefs/', import.meta.url));

/** A brief this repository ships, read from the directory rather than named. */
function someBriefText(): string {
  const name = readdirSync(BRIEF_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort()[0];
  if (name === undefined) throw new Error('no brief in this repository to open');
  return readFileSync(`${BRIEF_DIR}${name}`, 'utf8');
}

const BRIEF_TEXT = someBriefText();
const BRIEF: unknown = JSON.parse(BRIEF_TEXT);

/** The server's three read answers, in the shapes `client.ts` parses. */
function answers(): { readonly vocabulary: unknown; readonly validation: unknown; readonly plan: unknown } {
  const validation = validateBrief(BRIEF);
  if (!validation.ok) {
    throw new Error(`a shipped brief no longer validates: ${JSON.stringify(validation.issues)}`);
  }
  // The server plans the *validated* brief rather than the file, because
  // `allocateSlots` takes a `SetBrief` and a file is not one until the schema
  // has filled its defaults in. This stub follows it.
  const planned = planSkeleton(validation.brief);
  if (!planned.ok) throw new Error(`the planner refused a shipped brief: ${planned.reason}`);
  return {
    vocabulary: designVocabulary(),
    validation: { ok: true, derived: validation.derived },
    plan: { ok: true, plan: planned.plan },
  };
}

const ANSWERS = answers();

/**
 * The page's whole script: the real route inside the real shell, with `fetch`
 * standing in for the loopback server and the draft already in storage.
 *
 * The draft is seeded rather than typed because what is being measured is a
 * full form; an empty one is narrower than any form a person ends up with, and
 * would pass a width assertion the real thing fails.
 */
const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from '${UI}app/Shell';
import { DesignRoute } from '${UI}routes/design/DesignRoute';
import { uiStyleSheet } from '${UI}styles/index';

const ANSWERS = ${JSON.stringify(ANSWERS)};

window.fetch = (input) => {
  const path = String(input);
  const body =
    path.indexOf('/vocabulary') >= 0 ? ANSWERS.vocabulary
    : path.indexOf('/validate') >= 0 ? ANSWERS.validation
    : path.indexOf('/plan') >= 0 ? ANSWERS.plan
    : null;
  if (body === null) return Promise.resolve(new Response('{}', { status: 404 }));
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
};

localStorage.setItem(${JSON.stringify(DRAFT_STORAGE_KEY)}, ${JSON.stringify(BRIEF_TEXT)});

const style = document.createElement('style');
style.textContent = uiStyleSheet() + 'html,body{margin:0;padding:0}';
document.head.appendChild(style);
const host = document.createElement('div');
document.body.appendChild(host);
createRoot(host).render(
  h(Shell, {
    mode: 'customize',
    sub: 'sets',
    onSelectMode: () => undefined,
    children: h(DesignRoute, { quietMs: 1 }),
  }),
);
`;

/**
 * What is read off the laid-out page.
 *
 * `worst` is the widest right edge any control reaches, so one field that hangs
 * off the screen fails the assertion even when the page itself does not scroll
 * (a control can overflow a clipped container without moving the document).
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const controls = Array.from(document.querySelectorAll('.mtg-design input, .mtg-design select, .mtg-design textarea, .mtg-design button'));
  const boxes = controls.map((node) => node.getBoundingClientRect());
  const visible = boxes.filter((box) => box.width > 0 && box.height > 0);
  return {
    controls: visible.length,
    worstRight: round(visible.reduce((widest, box) => Math.max(widest, box.right), 0)),
    shortest: round(visible.reduce((least, box) => Math.min(least, box.height), Infinity)),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    skeletonRows: document.querySelectorAll('.mtg-design table tbody tr').length,
    columns: document.querySelectorAll('.mtg-design__column').length,
  };
})()`;

interface Reading {
  readonly controls: number;
  readonly worstRight: number;
  readonly shortest: number;
  readonly pageOverflowX: number;
  readonly skeletonRows: number;
  readonly columns: number;
}

const SLACK_PX = 0.5;
const PHONE = { width: 390, height: 844 } as const;

describe('the brief editor on a phone', () => {
  browserIt(
    'fits the screen it is drawn on, with every control finger-sized',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-design-phone-'));
      const entry = join(directory, 'entry.ts');
      const bundle = join(directory, 'bundle.js');
      const file = join(directory, 'design.html');
      try {
        await writeFile(entry, ENTRY, 'utf8');
        await build({
          entryPoints: [entry],
          bundle: true,
          outfile: bundle,
          format: 'iife',
          platform: 'browser',
          absWorkingDir: '/',
          alias: { 'node:crypto': join(UI, 'shims', 'node-crypto.ts') },
          nodePaths: [join(ROOT, 'node_modules')],
          logLevel: 'silent',
          define: { 'process.env.NODE_ENV': '"development"' },
        });
        const script = await readFile(bundle, 'utf8');
        await writeFile(
          file,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design</title></head><body><script>${script}</script></body></html>`,
          'utf8',
        );

        const chrome = await launchChrome(directory);
        try {
          const seen = (await measurePage(
            chrome.client,
            file,
            PHONE.width,
            PHONE.height,
            MEASURE,
            `${String(PHONE.width)}x${String(PHONE.height)}`,
            '.mtg-design table tbody tr',
            true,
            { mobile: true, pointer: 'coarse' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error('the editor never drew a planned skeleton');

          // The skeleton is on the screen, so the form below was measured full.
          expect(seen.skeletonRows, 'the server plan never reached the page').toBeGreaterThan(0);
          expect(seen.columns, 'the editor drew no columns').toBeGreaterThan(0);
          expect(seen.controls, 'the editor drew almost no controls').toBeGreaterThan(10);
          // 1. Nothing hangs off the right edge, and the page does not scroll.
          expect(seen.pageOverflowX, 'the editor makes the page scroll sideways').toBeLessThanOrEqual(
            SLACK_PX,
          );
          expect(seen.worstRight, 'a control hangs off the right edge').toBeLessThanOrEqual(
            PHONE.width + SLACK_PX,
          );
          // 2. Every control a finger has to hit is finger-sized.
          expect(seen.shortest, 'a control is shorter than a finger').toBeGreaterThanOrEqual(
            TOUCH_TARGET_PX - SLACK_PX,
          );
        } finally {
          await shutdownChrome(chrome);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
