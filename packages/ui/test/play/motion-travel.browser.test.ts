// @vitest-environment node
/**
 * The travel path, watched in a browser that is running the real component.
 *
 * Every other test on this lane stops one step short of the thing a player
 * notices. `motion-plan.test.ts` proves the cue exists, `motion-runner.test.ts`
 * drives the runner against a hand-built fake DOM, and `motion.browser.test.ts`
 * measures the mark's box-shadow on a page whose markup was rendered to a string
 * and never hydrated. None of the three can fail when the hook never gets a
 * board, and that is exactly what shipped: `useBoardMotion` handed React a fresh
 * callback ref on every render, React answered by detaching it — `ref(null)`,
 * then `ref(node)` — before every commit, the teardown dropped the snapshot of
 * where each card had been, and `sync` took its nothing-to-compare-with path
 * forever. A whole game, no animation, no error.
 *
 * So this file mounts the real `PlayView` with `react-dom/client` into a real
 * page, clicks a real land in a real hand, and asks the browser what it is
 * animating. It is bundled with esbuild rather than served by Vite because a
 * test must not depend on a dev server somebody happens to have running.
 *
 * Two readings, and both are load-bearing. Under `no-preference` the clicked
 * card must be running an animation that starts somewhere else and ends at
 * `none` — that is FLIP, and it is the assertion the shipped defect fails.
 * Under `reduce` the same click must animate nothing at all, which is the
 * promise `../../src/motion/reduced-motion.ts` makes and the reason `measurePage`
 * grew its own switch: a rig that only ever emulates `reduce` would have called
 * the broken build green.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { browserIt, cleanupTarget, launchChrome, reason, shutdownChrome } from '../support/chrome';
import type { CdpClient } from '../support/chrome';

const UI = new URL('../../src/', import.meta.url).pathname;
const ROOT = new URL('../../../../', import.meta.url).pathname;

/**
 * The page's whole script: a session with a land in hand, the shipped view, and
 * one state hook standing in for `use-session.ts`.
 *
 * Written as a string and bundled rather than imported, because it has to run in
 * the browser and this file runs in node. It imports the same modules the app
 * imports, through the same workspace names.
 */
const ENTRY = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { exampleCard } from '@mtg/dsl';
import { choose, DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '${UI}app/Shell';
import { PlayView } from '${UI}routes/play/PlayView';
import { uiStyleSheet } from '${UI}styles/index';

const LAND = exampleCard('slc-mountain');
const CREATURE = exampleCard('slc-emberflow-raider');

function opening() {
  const built = scenario({
    seed: 'ui/motion-travel',
    battlefield: [
      { card: CREATURE, controller: 0, tapped: false, summoningSick: false },
      { card: CREATURE, controller: 1, tapped: false, summoningSick: false },
    ],
    hands: [[LAND, CREATURE], [CREATURE]],
    step: 'precombatMain',
    active: 0,
    turn: 4,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function Harness() {
  const [session, setSession] = useState(opening);
  return h(Shell, {
    mode: 'play',
    onSelectMode: () => undefined,
    children: h(PlayView, {
      session,
      viewer: 0,
      names: ['You', 'Bot'],
      onChoose: (choice) => { setSession(choose(session, choice)); },
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
    }),
  });
}

const style = document.createElement('style');
style.textContent = uiStyleSheet() + 'html,body{margin:0;padding:0}';
document.head.appendChild(style);
const host = document.createElement('div');
document.body.appendChild(host);
createRoot(host).render(h(Harness));
`;

/**
 * Click the first hand card whose face starts with `Mountain`, then say what the
 * browser is animating for that exact object.
 *
 * Read in the same evaluation as the click: React flushes a discrete event's
 * state update and its layout effects before the handler returns, so by this
 * point the commit has happened and the runner has either started an animation
 * or has not. Sampling later would let a 240ms cue finish and make a working
 * build indistinguishable from the broken one.
 */
const CLICK_AND_READ = `new Promise((resolve) => {
  const hand = [...document.querySelectorAll(
    ".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='rail'] [data-permanent-key]"
  )];
  const slot = hand.find((el) => (el.textContent ?? '').trim().startsWith('Mountain'));
  if (slot === undefined) { resolve({ error: 'no Mountain in hand' }); return; }
  const key = slot.getAttribute('data-permanent-key');
  const control = [...document.querySelectorAll('button')].find(
    (button) => (button.textContent ?? '').trim().startsWith('Play Mountain'),
  );
  if (control === undefined) { resolve({ error: 'the table offered no way to play the land' }); return; }
  control.click();
  // One frame, and no more. React commits the click's update and runs the
  // layout effect the runner lives in before this callback; a cue is 240ms
  // long, so a build that animates is still animating here and a build that
  // does not never will be.
  requestAnimationFrame(() => {
  const landed = document.querySelector("[data-permanent-key='" + key + "']");
  const mine = document.getAnimations().filter((animation) => {
    const target = animation.effect === null ? null : animation.effect.target;
    return target !== null && target.getAttribute !== undefined
      && target.getAttribute('data-permanent-key') === key;
  });
  const first = mine[0];
  const frames = first === undefined ? [] : first.effect.getKeyframes().map((frame) => String(frame.transform));
  resolve({
    key,
    board: document.querySelector('.mtg-play').getAttribute('data-motion'),
    // The mat, which is where the sheet's fallback arrival looks before it
    // stands down. The runner is handed the wrapper above it.
    mat: document.querySelector('.mtg-board').getAttribute('data-motion'),
    // And the guard itself, asked of the element it is written against, so this
    // cannot pass on an attribute that lands one level away from the selector.
    undriven: document.querySelector(".mtg-board:not([data-motion='on'])") !== null,
    onBattlefield: landed === null
      ? false
      : landed.closest(".mtg-zone__body[data-layout='board']") !== null,
    animations: mine.length,
    states: mine.map((animation) => animation.playState),
    frames,
    duration: first === undefined ? 0 : Math.round(first.effect.getTiming().duration),
  });
  });
})`;

interface Reading {
  readonly error?: string;
  readonly key: string;
  readonly board: string | null;
  readonly mat: string | null;
  readonly undriven: boolean;
  readonly onBattlefield: boolean;
  readonly animations: number;
  readonly states: readonly string[];
  readonly frames: readonly string[];
  readonly duration: number;
}

/** Load the built page at one motion preference and take the reading. */
async function readPage(client: CdpClient, file: string, reducedMotion: boolean): Promise<Reading> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await client.call(
      'Emulation.setEmulatedMedia',
      {
        features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
      },
      sessionId,
    );
    const navigation = await client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    if (navigation['errorText'] !== undefined) {
      throw new Error(`Chrome could not load the motion page: ${String(navigation['errorText'])}`);
    }
    // The board has to be mounted and settled before the click, or the commit
    // the click produces would be the first one the runner ever saw and would
    // legitimately animate nothing.
    await client.call(
      'Runtime.evaluate',
      {
        expression: `new Promise((resolve, reject) => {
          const deadline = Date.now() + 6000;
          const check = () => {
            const hand = document.querySelectorAll(
              ".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='rail'] [data-permanent-key]"
            ).length;
            const moving = document.getAnimations().filter(
              (animation) => animation.playState === 'running' || animation.playState === 'pending'
            ).length;
            if (hand > 0 && moving === 0) { requestAnimationFrame(() => requestAnimationFrame(resolve)); return; }
            if (Date.now() > deadline) { reject(new Error('the played table never settled with a hand on it')); return; }
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
    const measured = await client.call(
      'Runtime.evaluate',
      { expression: CLICK_AND_READ, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (measured['exceptionDetails'] !== undefined) {
      throw new Error(`the motion reading failed: ${JSON.stringify(measured['exceptionDetails'])}`);
    }
    return (measured['result'] as { readonly value: Reading }).value;
  } finally {
    await cleanupTarget(client, targetId, sessionId);
  }
}

describe('a card played from hand, in a browser running the real view', () => {
  browserIt(
    'travels from where it was to where it is, and travels nowhere for a viewer who asked for less motion',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-motion-travel-'));
      const entry = join(directory, 'entry.ts');
      const bundle = join(directory, 'bundle.js');
      const file = join(directory, 'play.html');
      try {
        await writeFile(entry, ENTRY, 'utf8');
        await build({
          entryPoints: [entry],
          bundle: true,
          outfile: bundle,
          format: 'iife',
          platform: 'browser',
          absWorkingDir: '/',
          // The one alias `packages/ui/vite.config.ts` needs for the same
          // reason: `@mtg/dsl`'s barrel reaches `node:crypto` through its
          // fingerprint module, and a browser has no such thing.
          alias: { 'node:crypto': join(UI, 'shims', 'node-crypto.ts') },
          nodePaths: [join(ROOT, 'node_modules')],
          logLevel: 'silent',
          define: { 'process.env.NODE_ENV': '"development"' },
        });
        const script = await readFile(bundle, 'utf8');
        await writeFile(
          file,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Motion travel</title></head><body><script>${script}</script></body></html>`,
          'utf8',
        );

        const chrome = await launchChrome(directory);
        try {
          const moving = await readPage(chrome.client, file, false);
          const still = await readPage(chrome.client, file, true);

          expect(moving.error, `the page could not be driven: ${moving.error ?? ''}`).toBeUndefined();
          // The hook claimed the board it was given, which is the precondition
          // for everything below and the only part the old build got right.
          expect(moving.board).toBe('on');
          expect(moving.mat).toBe('on');
          // The older CSS arrival has stood down, so no permanent wears two
          // motion vocabularies at once.
          expect(moving.undriven).toBe(false);
          // The click really played the land: without this the assertion below
          // could pass on a card that never went anywhere.
          expect(moving.onBattlefield).toBe(true);
          // The card the player clicked is animating, right now.
          expect(moving.animations).toBeGreaterThan(0);
          expect(moving.states.every((state) => state === 'running' || state === 'pending')).toBe(true);
          // FLIP: it starts displaced from where it now sits and ends at none.
          expect(moving.frames.length).toBeGreaterThan(1);
          expect(moving.frames[0]).toMatch(/^translate\(-?\d/);
          expect(moving.frames[0]).not.toBe('none');
          expect(moving.frames[moving.frames.length - 1]).toBe('none');
          expect(moving.duration).toBeGreaterThan(0);

          expect(still.error, `the page could not be driven: ${still.error ?? ''}`).toBeUndefined();
          expect(still.onBattlefield).toBe(true);
          expect(still.animations).toBe(0);
        } finally {
          await shutdownChrome(chrome);
        }
      } catch (error) {
        throw new Error(`the travel reading failed: ${reason(error)}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
