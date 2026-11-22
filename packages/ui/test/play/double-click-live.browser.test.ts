// @vitest-environment node
/**
 * A real double click, driven at a real browser, against a live table.
 *
 * `mtg-42w`. `./gestures.test.ts` holds the rule and `./direct-manip` measured
 * the platform premise on a bare button -- chrome-headless-shell delivers
 * `click` with `detail: 1`, `click` with `detail: 2`, then `dblclick` -- but the
 * gesture was never driven against the table itself. jsdom sends no such
 * sequence of its own, so every existing assertion about it fires the three
 * events by hand, which proves the surface answers *that* sequence and not that
 * the browser sends it here.
 *
 * The gap grew teeth at the `ui/staged-cast` merge. A castable card used to have
 * a double-click default and now has none: `../../src/routes/play/selection.ts`
 * routes it to the staged cast panel instead, because the payment stage is what
 * a submitted aiming would skip. Neither lane could see that branch alone --
 * one did not know about staging, the other did not know about the gesture --
 * and it has had no real-browser coverage at all.
 *
 * So this file drives `Input.dispatchMouseEvent` twice, with `clickCount` 1 then
 * 2, at a coordinate the page itself confirms is over the card, and reads back
 * what the surface did. It asserts the delivered event sequence alongside the
 * outcome, because a rig that accidentally sent two unrelated clicks would
 * otherwise pass the land test for the wrong reason.
 *
 * The page is live React rather than server-rendered markup, which no other rig
 * in this package needs; `../support/live-page.ts` is that machinery and its
 * docblock argues the two constraints that shape it.
 *
 * **Which branch answers is not the one the bead named.** The staged cast opens
 * from `select()`, on the *first* press: that press sets the aim, and from then
 * on `../../src/routes/play/table.ts`'s `onActivate` returns early because it is
 * aiming, so the second press never reaches `selection.ts`'s `activate()` at
 * all. The `castPlans.has(key)` early return inside `activate()` is therefore
 * unreachable through a real double click on a live table -- it is
 * belt-and-braces behind a guard that already refuses -- and this rig should not
 * be read as covering it. What it covers is the pair the player can see: the
 * land plays once, the spell stages and submits nothing.
 *
 * **What is not measured here is iOS Safari**, which treats `dblclick`
 * unreliably and makes `:hover` sticky after a tap. The coarse-pointer run below
 * is Chrome told it is a phone, which answers "does the gesture survive a touch
 * viewport and a 44px touch floor" and does not answer "does an iPad do this".
 * That stays with `mtg-66c` and `mtg-gj7`, which need the device.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import type { CdpClient, EmulatedDevice } from '../support/chrome';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-table-entry.ts');

/**
 * Built once for the whole file. The bundle is about 2.4 MB of unminified
 * JavaScript and takes under two seconds, which is worth paying once and not
 * three times.
 */
let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Live table');
  return pending;
}

interface Session {
  readonly client: CdpClient;
  readonly sessionId: string;
  readonly targetId: string;
}

async function evaluate(session: Session, expression: string): Promise<unknown> {
  const answer = await session.client.call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    session.sessionId,
    30_000,
  );
  const thrown = answer['exceptionDetails'];
  if (thrown !== undefined) throw new Error(`the page threw: ${JSON.stringify(thrown)}`);
  const result = answer['result'] as { readonly value?: unknown } | undefined;
  return result?.value;
}

/**
 * Wait for React to have mounted, then for two frames.
 *
 * `../support/chrome-driver.ts`'s `measurePage` settles a page and evaluates one
 * expression; this rig needs several round trips against one loaded page, so the
 * settle is spelled out rather than that function reused.
 */
const SETTLED = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const check = () => {
    const faces = document.querySelectorAll('button.mtg-card').length;
    if (document.readyState === 'complete' && faces > 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(faces)));
      return;
    }
    if (Date.now() > deadline) { reject(new Error('the page mounted no table')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

async function openTable(
  client: CdpClient,
  file: string,
  width: number,
  height: number,
  device: EmulatedDevice,
): Promise<Session> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = String(attached['sessionId']);
  const session: Session = { client, sessionId, targetId };
  await client.call('Page.enable', {}, sessionId);
  await client.call('Runtime.enable', {}, sessionId);
  await client.call(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: device.mobile ?? width < 500 },
    sessionId,
  );
  const pointer =
    device.pointer === undefined
      ? []
      : [
          { name: 'pointer', value: device.pointer },
          { name: 'any-pointer', value: device.pointer },
        ];
  await client.call(
    'Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, ...pointer] },
    sessionId,
  );
  if (device.pointer === 'coarse') {
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  }
  const navigation = await client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
  if (navigation['errorText'] !== undefined) {
    throw new Error(`Chrome could not load the table: ${String(navigation['errorText'])}`);
  }
  await evaluate(session, SETTLED);
  return session;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The middle of a card's pressable face, with the page's own confirmation that
 * the press will land on it.
 *
 * `elementFromPoint` rather than trusting the rectangle: a card under the step
 * bar, or under the ask column on a phone, has a perfectly good rectangle and
 * takes no press at all, and a rig that dispatched into that would report "the
 * gesture submitted nothing" as a fact about the gesture.
 */
async function pressPoint(session: Session, oid: string): Promise<Point> {
  const found = await evaluate(
    session,
    `(() => {
      const face = document.querySelector('[data-permanent-key="${oid}"] button.mtg-card');
      if (face === null) return { error: 'no pressable face' };
      face.scrollIntoView({ block: 'center', inline: 'center' });
      const box = face.getBoundingClientRect();
      const x = Math.round(box.left + box.width / 2);
      const y = Math.round(box.top + box.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (hit === null) return { error: 'nothing is at the middle of the face' };
      if (!face.contains(hit) && hit !== face) {
        return { error: 'the middle of the face is covered by ' + hit.className };
      }
      return { x, y };
    })()`,
  );
  const point = found as { readonly x?: number; readonly y?: number; readonly error?: string };
  if (point.error !== undefined) throw new Error(`${oid}: ${point.error}`);
  if (point.x === undefined || point.y === undefined) throw new Error(`${oid}: no point`);
  return { x: point.x, y: point.y };
}

/**
 * Every click the document sees from here on, as `type:detail:card`.
 *
 * The card is in there because the coordinate is computed once and four input
 * events are then dispatched at it, and the first press changes the layout: a
 * rig whose second press landed on a panel that had opened over the card would
 * report "the gesture submitted nothing" as a fact about the gesture. Reading
 * the card back turns that into a failure.
 */
const RECORD_EVENTS = `(() => {
  const seen = [];
  globalThis.mtgGestureLog = seen;
  for (const type of ['click', 'dblclick']) {
    document.addEventListener(type, (event) => {
      const card = event.target.closest('[data-permanent-key]');
      const key = card === null ? '-' : card.getAttribute('data-permanent-key');
      seen.push(type + ':' + String(event.detail) + ':' + key);
    }, true);
  }
  return true;
})()`;

/**
 * A double click as the platform makes one: press and release at `clickCount`
 * 1, then press and release at `clickCount` 2. Chrome derives `detail` and the
 * synthesized `dblclick` from that count, which is the whole reason this is
 * driven through `Input` rather than through a dispatched `MouseEvent`.
 */
async function doubleClick(session: Session, oid: string): Promise<void> {
  for (const clickCount of [1, 2]) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      const at = await pressPoint(session, oid);
      await session.client.call(
        'Input.dispatchMouseEvent',
        {
          type,
          x: at.x,
          y: at.y,
          button: 'left',
          clickCount,
          buttons: type === 'mousePressed' ? 1 : 0,
        },
        session.sessionId,
      );
    }
  }
  // Two frames for React to have committed whatever the presses started.
  await evaluate(
    session,
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );
}

interface Outcome {
  readonly gestures: readonly string[];
  readonly chosen: readonly unknown[];
  readonly castPanels: readonly (string | null)[];
  readonly menus: readonly (string | null)[];
}

async function readOutcome(session: Session): Promise<Outcome> {
  return (await evaluate(
    session,
    `(() => ({
      gestures: globalThis.mtgGestureLog ?? [],
      chosen: globalThis.mtgLiveTable.chosen,
      castPanels: [...document.querySelectorAll('.mtg-cast')].map((el) => el.getAttribute('aria-label')),
      menus: [...document.querySelectorAll('.mtg-picker:not(.mtg-cast)')].map((el) => el.getAttribute('aria-label')),
    }))()`,
  )) as Outcome;
}

interface Driven {
  readonly outcome: Outcome;
  readonly subject: string;
  readonly landMoves: readonly string[];
  readonly spellMoves: readonly string[];
}

/**
 * Load the table at one viewport and double click one card in hand, reporting
 * what the surface did and what it had been offered.
 */
async function drive(
  cardName: string,
  width: number,
  height: number,
  device: EmulatedDevice = {},
): Promise<Driven> {
  const page = await builtPage();
  const directory = await mkdtemp(join(tmpdir(), 'mtg-live-table-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-live-table-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'table.html');
  await writeFile(file, page, 'utf8');
  try {
    const session = await openTable(chrome.client, file, width, height, device);
    const oids = (await evaluate(
      session,
      `({
        land: globalThis.mtgLiveTable.hand('Mountain'),
        spell: globalThis.mtgLiveTable.hand('Lightning Lash'),
        subject: globalThis.mtgLiveTable.hand(${JSON.stringify(cardName)}),
      })`,
    )) as { readonly land: string | null; readonly spell: string | null; readonly subject: string | null };
    if (oids.land === null || oids.spell === null || oids.subject === null) {
      throw new Error('the scenario no longer deals the cards this rig drives');
    }
    const moves = (await evaluate(
      session,
      `({
        land: globalThis.mtgLiveTable.movesOn(${JSON.stringify(oids.land)}),
        spell: globalThis.mtgLiveTable.movesOn(${JSON.stringify(oids.spell)}),
      })`,
    )) as { readonly land: readonly string[]; readonly spell: readonly string[] };
    await evaluate(session, RECORD_EVENTS);
    await doubleClick(session, oids.subject);
    const outcome = await readOutcome(session);
    await cleanupTarget(chrome.client, session.targetId, session.sessionId).catch(() => undefined);
    return { outcome, subject: oids.subject, landMoves: moves.land, spellMoves: moves.spell };
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

/**
 * The sequence the platform makes, asserted rather than assumed. Without it the
 * land test below passes for a rig that sent one click.
 */
function realDoubleClickOn(oid: string): readonly string[] {
  return [`click:1:${oid}`, `click:2:${oid}`, `dblclick:2:${oid}`];
}

describe('a real double click on the live table', () => {
  browserIt(
    "plays a land's obvious move, exactly once, at 1440x900",
    async () => {
      const { outcome, subject, landMoves } = await drive('Mountain', 1440, 900);
      expect(landMoves, 'the land in hand no longer has exactly one legal move').toHaveLength(1);
      expect(outcome.gestures, 'the browser did not deliver a double click to the land').toEqual(
        realDoubleClickOn(subject),
      );

      // One move played by one gesture: the first press plays it and the second
      // is dropped by the `detail >= 2` guard in `../../src/card/Card.ts`.
      // Without that guard the repeat acts against a hand that has already
      // re-flowed under it.
      expect(outcome.chosen, 'a double click on a land did not play it exactly once').toEqual([1]);
      expect(outcome.castPanels, 'a land opened a staged cast').toEqual([]);
    },
    180_000,
  );

  browserIt(
    'opens the staged cast on a castable card and submits nothing, at 1440x900',
    async () => {
      const { outcome, subject, spellMoves } = await drive('Lightning Lash', 1440, 900);
      expect(outcome.gestures, 'the browser did not deliver a double click to the spell').toEqual(
        realDoubleClickOn(subject),
      );

      // The premise: several moves, all of them aims of the same spell. This is
      // the shape `activate()` refuses a default for.
      expect(spellMoves.length, 'the spell no longer has several legal aims').toBeGreaterThan(1);

      // The load-bearing assertion, and the playtester's constraint in one line: a
      // gesture may submit a move the player can name in advance and nothing
      // else, so picking one of three aims is the surface deciding for them.
      expect(outcome.chosen, 'a double click on a castable card submitted a move').toEqual([]);
      expect(outcome.castPanels, 'the staged cast did not open').toEqual(['Casting Lightning Lash']);
      expect(outcome.menus, 'the old pre-multiplied aim menu is back').toEqual([]);
    },
    180_000,
  );

  browserIt(
    'answers the same on a phone-sized coarse-pointer viewport',
    async () => {
      const device: EmulatedDevice = { mobile: true, pointer: 'coarse' };
      const land = await drive('Mountain', 390, 844, device);
      expect(land.outcome.gestures, 'the phone viewport did not deliver a double click').toEqual(
        realDoubleClickOn(land.subject),
      );
      expect(land.outcome.chosen, 'a double click on a land did not play it exactly once').toEqual([1]);

      const spell = await drive('Lightning Lash', 390, 844, device);
      expect(spell.outcome.gestures, 'the phone viewport did not deliver a double click').toEqual(
        realDoubleClickOn(spell.subject),
      );
      expect(spell.outcome.chosen, 'a double click on a castable card submitted a move').toEqual([]);
      expect(spell.outcome.castPanels, 'the staged cast did not open').toEqual(['Casting Lightning Lash']);
    },
    240_000,
  );
});
