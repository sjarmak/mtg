/**
 * Real-browser containment for the played table on a phone.
 *
 * jsdom cannot prove any pixel in this file. The test starts this package's
 * Vite app, serves the largest committed XMP build and its precons, and then
 * drives chrome-headless-shell over CDP through `@mtg/ui`'s browser harness.
 *
 * The harness is the point of this arrangement rather than a convenience.
 * `browserIt` is what `MTG_REQUIRE_BROWSER=1` reaches: this file used to carry
 * its own `existsSync(chromePath) ? it : it.skip`, so a CI image with a broken
 * browser cache got a loud red from every other rig and a silent skip from this
 * one, and the duplicated default path drifted the moment the harness's moved.
 * `CdpClient`, `launchChrome`, `cleanupTarget` and `shutdownChrome` come from
 * the same place, so the named deadlines and the SIGTERM-then-SIGKILL
 * escalation are the ones every rig gets rather than the weaker copies this
 * file grew before that harness existed.
 *
 * `measurePage` is the one export this rig does not take, and the reason is in
 * its contract: it navigates to a `file:` URL, waits on a settle predicate that
 * wants a drawn play face, and evaluates one synchronous expression. This rig
 * navigates to a live server twice — once at `127.0.0.1` and once at a hostname
 * mapped to it, because the claim is about a plain-HTTP origin not being a
 * secure context — and reaches the played table only by playing: pick a precon,
 * pick an opponent, start the hotseat, keep two hands, and pass through however
 * many privacy handoffs the shuffle produced. None of that is expressible as a
 * settle selector, and inventing a second `measurePage` shape for one caller
 * would put the drift back where it was taken out of.
 *
 * The CDP call bounds below are explicit for the same reason. The harness
 * defaults to four seconds, which is right for a synchronous read and wrong for
 * an `awaitPromise` evaluate whose in-page loop polls for eight.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createServer, type Plugin } from 'vite';
import { describe, expect } from 'vitest';
import { SHORT_TABLE_ASK_SHUT_REM, SHORT_TABLE_RAIL_SHUT_PX } from '../../ui/src/styles/board/rail';
import {
  browserIt,
  cleanupTarget,
  launchChrome,
  shutdownChrome,
  type CdpClient,
} from '../../ui/test/support/chrome';

const packageDir = fileURLToPath(new URL('../../ui/', import.meta.url));

/**
 * How long a CDP `Runtime.evaluate` that awaits an in-page promise is given.
 *
 * Both in-page loops poll eighty times at a hundred milliseconds, so eight
 * seconds is the longest either can legitimately run before throwing its own
 * named error — which is the error worth reading, because it names the step and
 * lists the visible buttons. These bounds sit above that so the in-page failure
 * wins the race, and below the test budget so a wedged socket still fails as a
 * socket rather than as a suite timeout.
 */
const JOURNEY_CALL_TIMEOUT_MS = 20_000;
const PREVIEW_CALL_TIMEOUT_MS = 12_000;

/**
 * The final read scrolls and waits two animation frames. That is fast on an
 * idle machine and not instant on a loaded one: `requestAnimationFrame` in a
 * headless browser competing for CPU with the rest of the suite has been seen
 * to stall for whole seconds, and the harness default would call that a dead
 * socket.
 */
const MEASURE_CALL_TIMEOUT_MS = 10_000;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The committed fixture this gate serves, chosen by what it is rather than how
 * big it is.
 *
 * `accepts` used to carry `cards.length === 253` for the set, which stopped
 * being true the first time somebody authored a card and took the whole file
 * out of collection with it: a selector keyed to a number that legitimately
 * moves does not fail the assertion it guards, it deletes the test. So the
 * predicate states identity and `rank` breaks the tie, highest first, ties
 * going to the first name in sorted order.
 */
function fixture(
  directory: string,
  suffix: string,
  accepts: (document: Readonly<Record<string, unknown>>) => boolean,
  rank: (document: Readonly<Record<string, unknown>>) => number = () => 0,
): Buffer {
  let best: Buffer | undefined;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith(suffix))
    .sort()) {
    const body = readFileSync(join(directory, name));
    const document = JSON.parse(body.toString('utf8')) as unknown;
    if (!record(document) || !accepts(document)) continue;
    const scored = rank(document);
    if (scored <= bestRank) continue;
    best = body;
    bestRank = scored;
  }
  if (best === undefined)
    throw new Error(`no committed ${suffix} fixture satisfied the phone browser contract`);
  return best;
}

const setBody = fixture(
  fileURLToPath(new URL('../../setgen/fixtures/sets/', import.meta.url)),
  '.set.json',
  (document) => {
    const metadata = document['set'];
    return (
      record(metadata) &&
      metadata['code'] === 'XMP' &&
      Array.isArray(document['cards']) &&
      document['cards'].length > 0
    );
  },
  (document) => (Array.isArray(document['cards']) ? document['cards'].length : 0),
);
const preconBody = fixture(
  fileURLToPath(new URL('../../setgen/fixtures/decks/', import.meta.url)),
  '.precons.json',
  (document) =>
    document['setCode'] === 'XMP' && Array.isArray(document['decks']) && document['decks'].length === 5,
);

function stagedFixtures(): Plugin {
  return {
    name: 'phone-scroll-staged-fixtures',
    configureServer(server): void {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const body = pathname === '/set.json' ? setBody : pathname === '/precons.json' ? preconBody : null;
        if (body === null) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(body);
      });
    },
  };
}

/**
 * The hostname the plain-HTTP half of this rig navigates to, and the switch
 * that makes it resolve to the Vite server the test just started.
 *
 * A phone reaching this app over a tailnet gets `http://`, not `https://`, and
 * a plain-HTTP origin is not a secure context: `crypto.subtle` is undefined
 * there. The page has to load and list its five precons anyway, and the only
 * way to assert that is to be on such an origin, which `127.0.0.1` is not —
 * loopback is trusted and secure whatever the scheme.
 */
const PLAIN_HTTP_HOST = 'mtg-tailnet-test.ts.net';
const HOST_RESOLVER_SWITCH = `--host-resolver-rules=MAP ${PLAIN_HTTP_HOST} 127.0.0.1`;

async function readPlainHttpPreview(client: CdpClient, origin: string): Promise<Record<string, unknown>> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.navigate', { url: `${origin}/#/play` }, sessionId);
    const read = await client.call(
      'Runtime.evaluate',
      {
        expression: `(async () => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          // Optional, because this runs immediately after Page.navigate and a
          // document that has not parsed its first tag yet has no body. The
          // loop below is what waits for the page; an unguarded read throws on
          // attempt zero and escapes the wait it was written to perform.
          const text = document.body?.textContent ?? '';
          const precons = [...document.querySelectorAll('button')]
            .filter((button) => /^Play /.test(button.getAttribute('aria-label') ?? ''));
          const error = text.includes('Could not read the staged set');
          if (precons.length === 5 || error) {
            return {
              isSecureContext,
              hasSubtleCrypto: typeof crypto.subtle === 'object',
              preconCount: precons.length,
              stagedSetError: error ? text : null,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('plain HTTP preview did not load five precons or report a staged-set error');
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      PREVIEW_CALL_TIMEOUT_MS,
    );
    if (read['exceptionDetails'] !== undefined) {
      throw new Error(`plain HTTP preview failed: ${JSON.stringify(read['exceptionDetails'])}`);
    }
    return (read['result'] as { readonly value?: Record<string, unknown> } | undefined)?.value ?? {};
  } finally {
    await cleanupTarget(client, targetId, sessionId);
  }
}

async function measure(
  client: CdpClient,
  origin: string,
  width: number,
  height: number,
  /**
   * Whether Chrome is told this is a touch device, which it otherwise derives
   * from the width.
   *
   * A landscape phone is 844px wide and desktop by that rule, and the difference
   * is not cosmetic: under `pointer: coarse` a control in the strip above the
   * mat is 44px, the touch floor `../../ui/src/styles/touch.ts` sets, and on a
   * fine pointer it is 28.84. A rig that does not say so measures furniture 15px
   * shorter than a phone draws. Defaulted from the width so the three viewports
   * that were here before this argument existed read exactly what they read.
   */
  phone = width < 500,
): Promise<Record<string, unknown>> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: phone },
      sessionId,
    );
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 }, sessionId);
    if (phone) {
      await client.call(
        'Emulation.setEmulatedMedia',
        {
          features: [
            { name: 'pointer', value: 'coarse' },
            { name: 'any-pointer', value: 'coarse' },
          ],
        },
        sessionId,
      );
    }
    await client.call('Page.navigate', { url: `${origin}/#/play` }, sessionId);
    const journey = await client.call(
      'Runtime.evaluate',
      {
        expression: `(async () => {
        const waitFor = async (label, find) => {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const found = find();
            if (found) return found;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const buttons = [...document.querySelectorAll('button')]
            .filter((button) => button.getBoundingClientRect().height > 0)
            .map((button) => button.getAttribute('aria-label') ?? button.textContent.trim())
            .filter(Boolean);
          throw new Error(
            'phone scroll browser journey did not reach ' + label
            + '; route=' + location.hash
            + '; visible buttons=' + JSON.stringify(buttons),
          );
        };
        const click = async (label, find) => {
          const control = await waitFor(label, find);
          control.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          return control;
        };
        const buttonNamed = (name) => [...document.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === name);
        const buttonWithLabel = (name) => [...document.querySelectorAll('button')]
          .find((button) => button.getAttribute('aria-label') === name);
        const handoff = () => [...document.querySelectorAll('button')]
          .find((button) => /^I am /.test(button.textContent.trim()));
        await click('Wield the Obliterator', () => buttonWithLabel('Play Wield the Obliterator'));
        await click('The Sky Islands opponent', () => buttonWithLabel('Opponent plays The Sky Islands'));
        await click('hotseat start', () => buttonNamed('Two players, one screen'));
        // A short table shuts the ask column and puts the panel behind the
        // strip's own alert (../../ui/src/routes/play/ask-collapse.ts, and
        // ask-flyout.ts for the box it opens). So every press on a panel control
        // opens the flyout first where there is one to open, which is a no-op on
        // the three viewports tall enough to draw the column outright.
        const openAsk = async () => {
          if (buttonNamed('Keep this hand')) return;
          const alert = document.querySelector('.mtg-ask-alert__button');
          if (alert) {
            alert.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        await waitFor('player one board', () => document.querySelector('.mtg-board'));
        await openAsk();
        await click('player one Keep', () => buttonNamed('Keep this hand'));
        await click('player two privacy handoff', handoff);
        await openAsk();
        const playerTwoKeep = await click('player two Keep', () => buttonNamed('Keep this hand'));
        await waitFor('player two Keep to settle', () => !playerTwoKeep.isConnected);
        // A shuffled game may start with either player. P1 starting adds one
        // more handoff; P2 starting correctly returns straight to the board.
        const turnOne = await waitFor(
          'turn one board or privacy handoff',
          () => handoff() ?? document.querySelector('.mtg-board'),
        );
        let handoffs = 1;
        if (turnOne.tagName === 'BUTTON') {
          turnOne.click();
          handoffs += 1;
          await waitFor('turn one privacy handoff to settle', () => !turnOne.isConnected);
        }
        await waitFor('turn one board', () => document.querySelector('.mtg-board'));
        return { handoffs };
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      JOURNEY_CALL_TIMEOUT_MS,
    );
    if (journey['exceptionDetails'] !== undefined) {
      throw new Error(`phone scroll browser journey failed: ${JSON.stringify(journey['exceptionDetails'])}`);
    }
    const journeyResult = journey['result'] as { readonly value?: unknown } | undefined;
    if (
      !record(journeyResult?.value) ||
      (journeyResult.value['handoffs'] !== 1 && journeyResult.value['handoffs'] !== 2)
    ) {
      throw new Error('phone scroll browser journey did not complete');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const measured = await client.call(
      'Runtime.evaluate',
      {
        expression: `(async () => {
        const scrolling = document.scrollingElement;
        const main = document.querySelector('.mtg-shell__main');
        const board = document.querySelector('.mtg-board');
        const beforeY = window.scrollY;
        window.scrollTo(0, 500);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          viewport: [window.innerWidth, window.innerHeight],
          documentClientHeight: scrolling.clientHeight,
          documentScrollHeight: scrolling.scrollHeight,
          documentClientWidth: scrolling.clientWidth,
          documentScrollWidth: scrolling.scrollWidth,
          beforeY,
          afterY: window.scrollY,
          mainClientHeight: main.clientHeight,
          mainScrollHeight: main.scrollHeight,
          mainOverflowY: getComputedStyle(main).overflowY,
          boardColumns: getComputedStyle(board).gridTemplateColumns,
          matHeight: Math.round(board.getBoundingClientRect().height * 100) / 100,
          furniture: (() => {
            // Everything drawn above the mat, found by walking from the mat up
            // to the shell and listing what precedes it at each level. A rect
            // sweep would also collect the mat's own contents; the previous
            // siblings of its ancestors are exactly the furniture.
            const above = [];
            for (let node = board; node !== null && node !== document.body; node = node.parentElement) {
              for (let prior = node.previousElementSibling; prior !== null; prior = prior.previousElementSibling) {
                const bounds = prior.getBoundingClientRect();
                if (bounds.height === 0) continue;
                above.push([
                  prior.tagName.toLowerCase() + '.' + [...prior.classList].join('.'),
                  Math.round(bounds.height * 100) / 100,
                  Math.round(bounds.top * 100) / 100,
                ]);
              }
            }
            return above.sort((left, right) => left[2] - right[2]);
          })(),
          verticalScrollers: [...document.querySelectorAll('body *')]
            .filter((element) => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return bounds.width > 0 && bounds.height > 0
                && (style.overflowY === 'auto' || style.overflowY === 'scroll')
                && element.scrollHeight > element.clientHeight;
            })
            .map((element) => [element.tagName.toLowerCase(), [...element.classList].sort()]),
        };
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      MEASURE_CALL_TIMEOUT_MS,
    );
    if (measured['exceptionDetails'] !== undefined) {
      throw new Error(`phone scroll measurement failed: ${JSON.stringify(measured['exceptionDetails'])}`);
    }
    return (measured['result'] as { readonly value?: Record<string, unknown> } | undefined)?.value ?? {};
  } finally {
    await cleanupTarget(client, targetId, sessionId);
  }
}

/**
 * What this rig is given, and why it is not the thirty seconds it used to be.
 *
 * It plays four games, one per viewport, through a live Vite dev server. Thirty
 * was a round number rather than a measured one, and it timed out in one run of
 * five under a load average between 25 and 54, which made this file the browser
 * project's only flake source.
 *
 * Measured on this machine (16 cores) on 2026-08-21, three runs each:
 *
 * • load 7.7–9.7, the suite's own background: 5.82s, 5.86s, 5.93s
 * • load 49–60, forty busy workers pinned against it: 21.75s, 23.27s, 25.51s
 *
 * So the worst case a deliberately overloaded machine produced is 25.5s, and
 * the old budget sat six percent above it. Ninety is three and a half times
 * that worst case, which is the headroom a number like this is for. The CDP
 * bounds above are what actually diagnose a wedged run — they name the socket,
 * the step and the buttons that were on screen — so this outer budget only has
 * to be large enough that a slow machine reads their errors instead of this one.
 */
const PHONE_SCROLL_BUDGET_MS = 90_000;

describe('the real played table owns phone scrolling', () => {
  browserIt(
    'keeps the document fixed while the main region remains the sole vertical scroller',
    async () => {
      const server = await createServer({
        configFile: fileURLToPath(new URL('../../ui/vite.config.ts', import.meta.url)),
        root: packageDir,
        logLevel: 'silent',
        clearScreen: false,
        plugins: [stagedFixtures()],
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-phone-scroll-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      try {
        await server.listen();
        const address = server.httpServer?.address() as AddressInfo | null;
        if (address === null) throw new Error('Vite did not publish a listening address');
        chrome = await launchChrome(userDataDir, [HOST_RESOLVER_SWITCH]);
        const plainHttp = await readPlainHttpPreview(
          chrome.client,
          `http://${PLAIN_HTTP_HOST}:${String(address.port)}`,
        );
        expect(plainHttp['isSecureContext']).toBe(false);
        expect(plainHttp['hasSubtleCrypto']).toBe(false);
        expect(plainHttp['preconCount']).toBe(5);
        expect(plainHttp['stagedSetError']).toBeNull();
        // The third column is the log, and its two widths are the two answers
        // `../../ui/src/routes/play/rail-collapse.ts` gives a player who has
        // never pressed the control: 44px, the shut strip, on a table the query
        // in `../../ui/src/styles/board/geometry.ts` calls cramped, and 272px
        // open on one that is not. 810 is under that query's 901px, so this rig
        // reads the shut strip there and the mat reads 228px wider than it did
        // before `mtg-l4w0`; 1440 is over it and is unchanged.
        for (const [width, height, expectedColumns] of [
          [390, 844, null],
          [430, 932, null],
          [810, 1080, '99.8281px 608.172px 44px'],
          [844, 390, 'landscape'],
          [1440, 900, '176px 934px 272px'],
        ] as const) {
          const result = await measure(
            chrome.client,
            `http://127.0.0.1:${String(address.port)}`,
            width,
            height,
            expectedColumns === 'landscape' ? true : undefined,
          );
          expect(result['viewport']).toEqual([width, height]);
          if (expectedColumns === 'landscape') {
            console.log(
              `${String(width)}x${String(height)}: mat ${String(result['matHeight'])}, columns ${String(result['boardColumns'])}, furniture ${JSON.stringify(result['furniture'])}`,
            );
            // Nothing at all is drawn above the mat, which is the whole of what
            // The playtester asked for on 2026-08-21: "I want the table to basically
            // take up the full landscape screen, you should need to return to
            // portrait mode if you want to click any of the tabs at the top".
            // This list is the assertion that carries it, and it used to hold
            // exactly the two bands she named — a 57px shell bar and a 44px
            // dealer strip, 101 of 390 — plus the 35.84px reduced-build notice
            // on a set that has one. `../../ui/src/styles/mobile.ts` takes all
            // three out of the drawing while a board is on the screen.
            expect(result['furniture']).toEqual([]);
            // So the mat gets essentially the whole screen: 382 of 390 when this
            // was written, against 273 before it and 194 before `mtg-l4w0`. 95%
            // is the floor, and what is under it is the mat's own padding.
            expect(Number(result['matHeight'])).toBeGreaterThanOrEqual(height * 0.95);
            // Both side columns are strips, and neither was pressed shut: a
            // short table is the unanswered default for the ask column
            // (`../../ui/src/routes/play/ask-collapse.ts`) as well as for the
            // log. Both strips then narrow again on a short table — 48px and
            // 24px rather than 80 and 44 — so the lanes get 738px of 844
            // against the 637.75 they had before either column collapsed.
            expect(String(result['boardColumns']).split(' ')).toHaveLength(3);
            expect(String(result['boardColumns'])).toMatch(
              new RegExp(
                `^${String(SHORT_TABLE_ASK_SHUT_REM * 16)}px .* ${String(SHORT_TABLE_RAIL_SHUT_PX)}px$`,
              ),
            );
            expect(result['mainScrollHeight']).toBe(result['mainClientHeight']);
            continue;
          }
          expect(result['documentScrollHeight']).toBe(result['documentClientHeight']);
          expect(result['documentScrollWidth']).toBe(result['documentClientWidth']);
          expect(result['beforeY']).toBe(0);
          expect(result['afterY']).toBe(0);
          expect(result['mainOverflowY']).toBe('auto');
          if (expectedColumns === null) {
            expect(Number(result['mainScrollHeight'])).toBeGreaterThan(Number(result['mainClientHeight']));
            expect(result['verticalScrollers']).toEqual([['main', ['mtg-shell__main']]]);
          } else {
            expect(result['boardColumns']).toBe(expectedColumns);
            expect(result['mainScrollHeight']).toBe(result['mainClientHeight']);
          }
        }
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await server.close();
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    PHONE_SCROLL_BUDGET_MS,
  );
});
