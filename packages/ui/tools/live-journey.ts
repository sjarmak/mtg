/**
 * Prove every set a running `npm run play` launcher offers is playable from a
 * real browser: printed formats through the Forge gateway, staged kernel sets
 * through the in-browser kernel, and the Legacy Cube through its own smoke.
 *
 *   npm run verify:live -- --url http://127.0.0.1:5310 [--artifacts <directory>] [--only <id,id>] [--skip-cube]
 *
 * The subjects are discovered from the launcher, never from a list in this file:
 * `formats/index.json` names the printed formats whose play is supported,
 * `sets/index.json` names the staged kernel sets, and the Legacy Cube is present
 * when its Forge-ready projection is served. A set the launcher stages that this
 * tool does not know how to play is therefore a failure, not a silent skip.
 *
 * Every transition is condition-based and every control is found by its
 * accessible name. Each subject leaves machine-readable evidence and a
 * screenshot per step; a failing subject also leaves the final HTML. One
 * subject's failure does not stop the others, and the exit code is non-zero if
 * any failed.
 *
 * `--max-usd <dollars>` arms the Stagehand prototype path (`mtg-onjme`,
 * `docs/research/stagehand-jev-seam.md`). No default and no environment
 * variable, the same as `--backend fal`: omit it and this runs exactly as
 * above, with no `@browserbasehq/stagehand` import, no key read and no file
 * opened. Armed, it makes two kinds of call: Jev's choice, direct on
 * `TYPESAFE_API_KEY` (from the environment, or from the file `--env-file`
 * names), and the `observe()` model call through `@mtg/llm` (the `claude`
 * binary unless `MTG_LLM_PROVIDER` says otherwise), both under one
 * `--max-usd` ceiling (`mtg-onjme.2`). A missing key or an unrunnable
 * provider refuses to start, naming what it looked for, before discovery and
 * before Chrome, rather than failing mid-journey. Armed, it also launches
 * full Chromium instead of the chrome-headless-shell every other subject
 * uses, with Stagehand's bundled extension preloaded (`mtg-jiusn`:
 * chrome-headless-shell has no `Extensions.loadUnpacked`, so it cannot load
 * Stagehand's extension at all).
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { cleanupTarget, launchChrome, shutdownChrome } from '../test/support/chrome-driver';
import type { CdpClient, CdpRecording } from '../test/support/chrome-driver';
import {
  chromiumPresent,
  discoverStagehandExtensionId,
  launchStagehandChromium,
  StagehandChromiumMissingError,
} from './stagehand-chromium';
import { gatewayResponsesOf } from './legacy-cube-live-evidence';
import type { GatewayResponse } from './legacy-cube-live-evidence';
import { FACE_FLIP_LABEL_SOURCE, playHash, sectionForPrecon } from './live-journey-routes';
import { LAND_TYPE_LINE_SOURCE, MAX_MULLIGANS, MIN_LANDS_TO_KEEP } from './live-journey-mulligan';
import { LAND_DROP_LABEL_PREFIX } from './live-journey-land-drop';
import { MANA_ABILITY_LINE_SOURCE } from './live-journey-mana-source';
import { PRECON_BACK_LABEL } from '../src/routes/printed/PrintedPreconRoute';
import { requireStagehandKey } from './stagehand-key';
import type { StagehandProvider } from './stagehand-provider';
import { spendLine } from './stagehand-report';
import { readArgs } from './live-journey-args';
import { transitionStallOutcome } from './live-journey-transition-recovery';

const REPO_ROOT = resolve(new URL('../../../', import.meta.url).pathname);
/** How long the armed path waits for Chromium to finish loading Stagehand's extension before refusing. */
const STAGEHAND_EXTENSION_DEADLINE_MS = 10_000;
const OPEN_TIMEOUT_MS = 180_000;
const MOVE_TIMEOUT_MS = 120_000;
// A Forge seat that keeps drawing under three lands mulligans up to twice, each
// round costing one more Opening-hand wait plus one bottom-choice wait, so the
// outer call has to outlive that whole chain rather than the single keep it
// used to cover.
const OPEN_AND_KEEP_TIMEOUT_MS = OPEN_TIMEOUT_MS * 5 + MOVE_TIMEOUT_MS * 3 + 10_000;
const MAX_DECISIONS = 30;
// A commander costs mana, so its cast waits on land drops across several turns
// of two-seat priority passing; a game against a bot that is never blocked ends
// within a few hundred decisions more.
const MAX_COMMANDER_DECISIONS = 400;
const MAX_GAME_DECISIONS = 1500;
const MAX_PICKS = 60;

interface Step {
  readonly name: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly detail: unknown;
}

interface SubjectEvidence {
  readonly kind: 'printed' | 'kernel' | 'legacy-cube';
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly failure: string | null;
  readonly steps: readonly Step[];
  readonly gateway: readonly GatewayResponse[];
}

const PrintedIndexSchema = z.object({
  formats: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(['limited', 'constructed']),
      availability: z.object({ play: z.object({ status: z.string() }) }),
    }),
  ),
});
const SetIndexSchema = z.object({
  sets: z.array(z.object({ stem: z.string().min(1), name: z.string().min(1) })),
});

/** Page-side helpers, installed after every navigation. */
const HELPERS = `(() => {
  const label = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
  const controls = () => Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const named = (wanted) => controls().find((node) => label(node) === wanted);
  const describe = () => controls().map(label).filter(Boolean).slice(0, 40);
  const errorText = () => {
    const live = document.querySelector('[data-session-phase="error"]');
    const alert = live?.querySelector('[role="alert"]') ?? document.querySelector('[role="alert"]');
    return alert?.textContent?.trim() ?? '';
  };
  const waitFor = async (description, predicate, ms = 30000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('timed out waiting for ' + description + '; alert=' + JSON.stringify(errorText()) + '; controls=' + JSON.stringify(describe()) + '; text=' + JSON.stringify(document.body.innerText.slice(0, 600)));
  };
  const click = (wanted) => {
    const node = named(wanted);
    if (!node) throw new Error('no control named ' + JSON.stringify(wanted) + '; controls=' + JSON.stringify(describe()));
    if (node.disabled) throw new Error('control is disabled: ' + wanted);
    node.click();
    return wanted;
  };
  const legalMoves = () => document.querySelector('[data-play-frame="shared"] [aria-label="Legal moves"]');
  const decisionTitle = () => legalMoves()?.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim() ?? '';
  const decisionLabels = () => Array.from(legalMoves()?.querySelectorAll('button') ?? []).map(label);
  const phaseBand = () => document.querySelector('[aria-label="Phases and stops"]');
  const tally = () => Array.from(document.querySelectorAll('.mtg-play-meta')).map((n) => (n.textContent ?? '').trim()).find((t) => t.endsWith(' choices made')) ?? '';
  const turn = () => document.querySelector('.mtg-turnstops__head')?.textContent?.trim() ?? '';
  const handSlots = () => Array.from(document.querySelectorAll('.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="hand"][data-permanent-key]'));
  const playSlots = () => Array.from(document.querySelectorAll('.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="play"][data-permanent-key]'));
  const loadedArt = () => Array.from(document.querySelectorAll('[data-region="art"] img')).filter((img) => img.complete && img.naturalWidth > 0).length;
  const failIfError = () => { const r = errorText(); if (r) throw new Error(r); };
  // The one control that opens a game, under the three names the builders give it.
  const startControl = () => named('Start the game') ?? named('Play drafted deck') ?? named('Play this deck');
  window.__j = { label, controls, named, describe, errorText, waitFor, click, startControl, legalMoves, decisionTitle, decisionLabels, phaseBand, tally, turn, handSlots, playSlots, loadedArt, failIfError };
  return true;
})()`;

/**
 * Waits for a Forge or kernel table to reach its first decision, then keeps
 * the opening hand -- taking a London mulligan first when Forge offers one
 * (labeled 'Take a mulligan') and the hand holds fewer than three lands. A
 * kernel table never offers that exact label (its own mulligan reads
 * 'Mulligan'), so the loop below never fires there and the kernel journeys'
 * seeded pools are untouched.
 *
 * Bounded to two mulligans so a screwed run cannot loop forever; a hand still
 * short of three lands after both is kept anyway; whichever hand is kept is
 * the one returned in `hand`. Forge bottoms cards immediately after each
 * mulligan rather than at the final keep, as a decision titled outside
 * 'Opening hand', so each round answers that one too -- by bottoming whichever
 * combination leaves the most of the fresh draw's lands in hand.
 */
const OPEN_AND_KEEP = `(async () => {
  const MIN_LANDS = ${String(MIN_LANDS_TO_KEEP)};
  const MAX_MULLIGANS = ${String(MAX_MULLIGANS)};
  await __j.waitFor('Game table', () => { __j.failIfError(); const region = document.querySelector('[aria-label="Game table"]'); return region && region.querySelector('.mtg-board') ? true : null; }, ${String(OPEN_TIMEOUT_MS)});
  const first = await __j.waitFor('first decision', () => { __j.failIfError(); const g = __j.legalMoves(); return g && g.querySelector('button:not(:disabled)') ? { title: __j.decisionTitle(), labels: __j.decisionLabels() } : null; }, ${String(OPEN_TIMEOUT_MS)});
  let dieRoll = null;
  if (first.labels.includes('Play first')) {
    dieRoll = first.title;
    Array.from(__j.legalMoves().querySelectorAll('button')).find((b) => __j.label(b) === 'Play first').click();
  }
  // A hand card's label is 'Name. <type line>. ...' (\`faceAccessibleName\`);
  // every land's type line carries the word 'Land', so cutting the name off
  // before testing keeps a card named e.g. 'Land Tax' from matching itself.
  // The regex source is \`../tools/live-journey-mulligan\`'s, tested there.
  const isLand = (cardLabel) => { const cut = cardLabel.indexOf('. '); return new RegExp(${JSON.stringify(LAND_TYPE_LINE_SOURCE)}).test(cut === -1 ? cardLabel : cardLabel.slice(cut + 2)); };
  const currentHand = () => __j.handSlots().map((s) => __j.label(s.querySelector('.mtg-card') ?? s));
  const waitOpeningHand = (description) => __j.waitFor(description, () => { __j.failIfError(); const g = __j.legalMoves(); return g && __j.decisionTitle() === 'Opening hand' && g.querySelector('button:not(:disabled)') ? __j.decisionLabels() : null; }, ${String(OPEN_TIMEOUT_MS)});
  let opening = await waitOpeningHand('Opening hand decision');
  let hand = currentHand();
  let mulligans = 0;
  while (opening.includes('Take a mulligan') && hand.filter(isLand).length < MIN_LANDS && mulligans < MAX_MULLIGANS) {
    Array.from(__j.legalMoves().querySelectorAll('button')).find((b) => __j.label(b) === 'Take a mulligan').click();
    mulligans += 1;
    await __j.waitFor('mulligan bottom choice', () => { __j.failIfError(); const g = __j.legalMoves(); return g && __j.decisionTitle() !== 'Opening hand' && g.querySelector('button:not(:disabled)') ? true : null; }, ${String(MOVE_TIMEOUT_MS)});
    const landNames = currentHand().filter(isLand).map((cardLabel) => cardLabel.split('. ')[0]);
    const options = Array.from(__j.legalMoves().querySelectorAll('button:not(:disabled)'));
    const landsBottomed = (option) => landNames.filter((name) => __j.label(option).includes(name)).length;
    options.sort((left, right) => landsBottomed(left) - landsBottomed(right));
    options[0].click();
    opening = await waitOpeningHand('Opening hand decision after mulligan');
    hand = currentHand();
  }
  const handArt = __j.handSlots().filter((s) => { const img = s.querySelector('[data-region="art"] img'); return img && img.complete && img.naturalWidth > 0; }).length;
  const phaseSteps = __j.phaseBand()?.querySelectorAll('[data-step]').length ?? 0;
  const keep = Array.from(__j.legalMoves().querySelectorAll('button')).find((b) => __j.label(b) === 'Keep this hand');
  if (!keep) throw new Error('no Keep this hand among ' + JSON.stringify(opening));
  keep.click();
  const turn = await __j.waitFor('turn one after keep', () => { __j.failIfError(); const t = __j.turn(); return t.startsWith('Turn 1') ? t : null; }, ${String(MOVE_TIMEOUT_MS)});
  return { dieRoll, first, opening, hand, handArt, phaseSteps, turn, mulligans };
})()`;

/**
 * One decision: a basic land from the hand when the rail offers it, then --
 * with `landDrops` -- any other land drop the rail offers (a starter
 * Commander deck's mana base is mostly nonbasics: `mtg-rdtno`), then a move
 * whose label starts with `prefer` when the caller named one, else the least
 * eventful legal move. A paused halt (the rail's Continue, shown with no legal
 * move while combat damage is dealt) counts as a decision and is continued.
 */
const oneDecision = (prefer: string | null, landDrops = false): string => `(async () => {
  const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const prefer = ${JSON.stringify(prefer)};
  const halt = () => { const b = __j.named('Continue'); return b && !b.disabled ? b : null; };
  const group = await __j.waitFor('enabled legal move or halt', () => { __j.failIfError(); const g = __j.legalMoves(); if (g && g.querySelector('button:not(:disabled)')) return g; return halt() ? 'halt' : null; }, ${String(MOVE_TIMEOUT_MS)});
  if (group === 'halt') { const b = halt(); const band = __j.phaseBand()?.textContent ?? ''; b.click(); return { kind: 'halt', label: 'Continue', band }; }
  const buttons = Array.from(group.querySelectorAll('button:not(:disabled)'));
  const labels = buttons.map(__j.label);
  for (const name of basics) {
    const panelMove = buttons.find((b) => __j.label(b).startsWith('Play ' + name));
    const slots = __j.handSlots().filter((s) => __j.label(s.querySelector('.mtg-card') ?? s).startsWith(name + '.'));
    const card = slots.length >= 1 ? slots[0].querySelector(':scope > button.mtg-card') : null;
    if (panelMove && card) {
      const oid = slots[0].getAttribute('data-permanent-key');
      card.click();
      return { kind: 'land', name, oid, label: __j.label(panelMove), labels };
    }
  }
  const drop = ${String(landDrops)} ? buttons.find((b) => __j.label(b).startsWith(${JSON.stringify(LAND_DROP_LABEL_PREFIX)})) : undefined;
  if (drop) { const name = __j.label(drop).slice(${String(LAND_DROP_LABEL_PREFIX.length)}); drop.click(); return { kind: 'land', name, label: __j.label(drop), labels }; }
  const wanted = prefer === null ? undefined : buttons.find((b) => __j.label(b).startsWith(prefer));
  if (wanted) { wanted.click(); return { kind: 'panel', label: __j.label(wanted), labels }; }
  // \`prefer\` names the goal (e.g. the commander) and is unmet here, so before
  // passing, cast an affordable mana-producing nonland permanent: a hand card
  // whose rules text (its \`title\`, never its accessible name -- only a land's
  // own output is spelled into that) carries a tap-for-mana ability and is
  // offered as a legal move. The regex source is
  // \`../tools/live-journey-mana-source\`'s, tested there.
  if (prefer !== null) {
    const isManaSource = (detail) => {
      const [, typeLine = '', ...rest] = detail.split('\\n');
      return !/\\bLand\\b/.test(typeLine) && new RegExp(${JSON.stringify(MANA_ABILITY_LINE_SOURCE)}).test(rest.join('\\n'));
    };
    const manaSource = __j.handSlots()
      .map((s) => s.querySelector('.mtg-card'))
      .filter(Boolean)
      .map((card) => ({ name: __j.label(card).split('.')[0], detail: card.getAttribute('title') ?? '' }))
      .find((card) => isManaSource(card.detail) && buttons.some((b) => __j.label(b).startsWith(card.name + ':')));
    if (manaSource) {
      const move = buttons.find((b) => __j.label(b).startsWith(manaSource.name + ':'));
      move.click();
      return { kind: 'panel', label: __j.label(move), labels };
    }
  }
  // A combat prompt re-offers its declared creatures as 'Stop X from ...' ahead of the finishing option, so the first button would undo the declaration it just made, forever.
  const preferred = ['Keep this hand', 'Pass priority', 'Done', 'Confirm', 'Finish declaring attackers', 'Finish declaring blockers'].map((w) => buttons.find((b) => __j.label(b) === w)).find(Boolean);
  const pass = __j.named('Pass');
  const fixedPass = pass && !pass.disabled ? pass : undefined;
  const fallback = buttons.find((b) => !__j.label(b).startsWith('Concede'));
  const move = preferred ?? fixedPass ?? fallback;
  if (!move) throw new Error('only concession offered: ' + JSON.stringify(labels));
  move.click();
  return { kind: 'panel', label: __j.label(move), labels };
})()`;

const BEFORE_DECISION = `({ moves: __j.legalMoves()?.textContent ?? '', band: __j.phaseBand()?.textContent ?? '', tally: __j.tally(), turn: __j.turn(), halt: (() => { const b = __j.named('Continue'); return b !== undefined && !b.disabled; })() })`;

interface Decision {
  readonly kind: 'land' | 'panel' | 'halt';
  readonly label: string;
  readonly name?: string;
  readonly oid?: string;
  readonly labels?: readonly string[];
}
interface Before {
  readonly moves: string;
  readonly band: string;
  readonly tally: string;
  readonly turn: string;
  readonly halt: boolean;
}

class Page {
  private sessionId: string | null = null;
  private readonly loads: CdpRecording;
  readonly network: CdpRecording;
  readonly steps: Step[] = [];

  constructor(
    private readonly client: CdpClient,
    private readonly targetId: string,
    private readonly base: string,
    private readonly directory: string,
  ) {
    this.network = client.record('Network.requestWillBeSent', 'Network.responseReceived');
    this.loads = client.record('Page.loadEventFired');
  }

  async attach(): Promise<void> {
    const attached = await this.client.call('Target.attachToTarget', {
      targetId: this.targetId,
      flatten: true,
    });
    this.sessionId = String(attached['sessionId']);
    await this.client.call('Page.enable', {}, this.sessionId);
    await this.client.call('Network.enable', {}, this.sessionId);
    await this.client.call('Runtime.enable', {}, this.sessionId);
    await this.client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      this.sessionId,
    );
  }

  async evaluate(expression: string, timeoutMs = 60_000): Promise<unknown> {
    let response: Record<string, unknown>;
    try {
      response = await this.client.call(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        this.sessionId ?? undefined,
        timeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} while evaluating: ${expression.replace(/\s+/gu, ' ').slice(0, 160)}`);
    }
    const details = response['exceptionDetails'] as
      { readonly exception?: { readonly description?: string }; readonly text?: string } | undefined;
    if (details !== undefined) {
      throw new Error(details.exception?.description ?? details.text ?? JSON.stringify(details));
    }
    return (response['result'] as { readonly value?: unknown }).value;
  }

  /** A hash-only change fires no load event, so every navigation goes through about:blank. */
  async navigate(hash: string): Promise<void> {
    const blank = this.loads.next(30_000);
    await this.client.call('Page.navigate', { url: 'about:blank' }, this.sessionId ?? undefined, 30_000);
    await blank;
    const loaded = this.loads.next(30_000);
    await this.client.call(
      'Page.navigate',
      { url: `${this.base}/${hash}` },
      this.sessionId ?? undefined,
      30_000,
    );
    await loaded;
    await this.evaluate(HELPERS);
  }

  async screenshot(name: string): Promise<void> {
    const shot = await this.client.call(
      'Page.captureScreenshot',
      { format: 'png' },
      this.sessionId ?? undefined,
      30_000,
    );
    await writeFile(join(this.directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
  }

  async step(name: string, run: () => Promise<unknown>): Promise<void> {
    const started = Date.now();
    const shot = `${String(this.steps.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
    try {
      const detail = await run();
      await this.screenshot(shot);
      this.steps.push({ name, ok: true, ms: Date.now() - started, detail });
      console.log(`  ok   ${name} (${String(Date.now() - started)}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.steps.push({ name, ok: false, ms: Date.now() - started, detail: message });
      console.log(`  FAIL ${name}: ${message}`);
      throw error;
    }
  }

  async captureFailure(): Promise<void> {
    try {
      await this.screenshot('99-failure');
      const html = await this.evaluate('document.documentElement.outerHTML', 30_000);
      await writeFile(join(this.directory, 'failure.html'), String(html));
    } catch (captureError) {
      console.log(`  capture failed: ${String(captureError)}`);
    }
  }

  gateway(): readonly GatewayResponse[] {
    return gatewayResponsesOf(this.network.events);
  }

  async close(): Promise<void> {
    this.network.stop();
    this.loads.stop();
    await cleanupTarget(this.client, this.targetId, this.sessionId);
  }

  /**
   * Keeps deciding until a land reaches the battlefield, basic or not (a
   * starter Commander deck's mana base is mostly nonbasics: `mtg-rdtno`), and
   * proves it landed in the land row.
   */
  async playUntilLand(): Promise<unknown> {
    const transitions: string[] = [];
    for (let index = 1; index <= MAX_DECISIONS; index += 1) {
      const before = (await this.evaluate(BEFORE_DECISION)) as Before;
      const decision = (await this.evaluate(oneDecision(null, true), MOVE_TIMEOUT_MS + 10_000)) as Decision;
      transitions.push(`${decision.kind}: ${decision.label}`);
      await this.evaluate(
        `__j.waitFor('transition after ' + ${JSON.stringify(decision.label)}, () => { __j.failIfError(); const phase = document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase'); const now = ${BEFORE_DECISION}; return phase !== 'submitting' && (phase === 'finished' || now.moves !== ${JSON.stringify(before.moves)} || now.band !== ${JSON.stringify(before.band)} || now.tally !== ${JSON.stringify(before.tally)} || now.turn !== ${JSON.stringify(before.turn)} || now.halt !== ${JSON.stringify(before.halt)}) ? true : null; }, ${String(MOVE_TIMEOUT_MS)})`,
        MOVE_TIMEOUT_MS + 10_000,
      );
      if (decision.kind === 'land') {
        const landed = await this.evaluate(
          `__j.waitFor(${JSON.stringify(decision.name)} + ' on battlefield', () => { const slot = __j.playSlots().find((s) => s.getAttribute('data-permanent-key') === ${JSON.stringify(decision.oid)}) ?? __j.playSlots().find((s) => __j.label(s.querySelector('.mtg-card') ?? s).startsWith(${JSON.stringify(decision.name)} + '.')); return slot ? { inLandRow: slot.closest('.mtg-lands') !== null, art: slot.querySelector('[data-region="art"] img')?.getAttribute('src') ?? '' } : null; }, 60000)`,
        );
        const tally = await this.evaluate('__j.tally()');
        const turn = await this.evaluate('__j.turn()');
        return {
          transitions,
          landed: { name: decision.name, oid: decision.oid, ...(landed as object) },
          tally,
          turn,
        };
      }
    }
    throw new Error(
      `no land became playable in ${String(MAX_DECISIONS)} decisions: ${transitions.join(' | ')}`,
    );
  }

  /**
   * Keeps deciding until `goal`, evaluated in the page, answers something other
   * than null, preferring any legal move whose label starts with `prefer`. A
   * game that finishes before the goal is met is a failure, because the goal
   * was the point; a game that finishes when the goal is the finish is the
   * ordinary end.
   *
   * A stalled post-decision UI transition re-checks `goal` before it is
   * treated as a failure (`mtg-8x0u1`): the wait is a proxy for the decision
   * having landed, and the goal is the thing that actually matters.
   */
  async playUntil(
    what: string,
    goal: string,
    options: { readonly prefer: string | null; readonly maxDecisions: number },
  ): Promise<{
    readonly reached: unknown;
    readonly decisions: number;
    readonly transitions: readonly string[];
  }> {
    const transitions: string[] = [];
    for (let index = 0; index <= options.maxDecisions; index += 1) {
      const reached = await this.evaluate(`(() => { __j.failIfError(); return ${goal}; })()`);
      if (reached !== null && reached !== undefined) return { reached, decisions: index, transitions };
      const phase = await this.evaluate(
        `document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase') ?? ''`,
      );
      if (phase === 'finished')
        throw new Error(`the game finished before ${what}: ${transitions.slice(-40).join(' | ')}`);
      if (index === options.maxDecisions) break;
      const before = (await this.evaluate(BEFORE_DECISION)) as Before;
      const decision = (await this.evaluate(
        oneDecision(options.prefer, true),
        MOVE_TIMEOUT_MS + 10_000,
      )) as Decision;
      transitions.push(
        `${before.turn} ${decision.kind}: ${decision.label} of [${(decision.labels ?? []).join(', ')}]`,
      );
      try {
        await this.evaluate(
          `__j.waitFor('transition after ' + ${JSON.stringify(decision.label)}, () => { __j.failIfError(); const phase = document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase'); const now = ${BEFORE_DECISION}; return phase !== 'submitting' && (phase === 'finished' || now.moves !== ${JSON.stringify(before.moves)} || now.band !== ${JSON.stringify(before.band)} || now.tally !== ${JSON.stringify(before.tally)} || now.turn !== ${JSON.stringify(before.turn)} || now.halt !== ${JSON.stringify(before.halt)}) ? true : null; }, ${String(MOVE_TIMEOUT_MS)})`,
          MOVE_TIMEOUT_MS + 10_000,
        );
      } catch (transitionError) {
        // The page can sit on 'Submitting move' past the wait budget even
        // though the decision it was waiting on already resolved
        // (mtg-8x0u1). The goal, not this wait, is the source of truth.
        const reachedDespiteStall = await this.evaluate(`(() => { __j.failIfError(); return ${goal}; })()`);
        const outcome = transitionStallOutcome(
          reachedDespiteStall !== null && reachedDespiteStall !== undefined,
          transitionError instanceof Error ? transitionError.message : String(transitionError),
          decision.label,
        );
        if (outcome.ok) {
          transitions.push(outcome.note);
          return { reached: reachedDespiteStall, decisions: index + 1, transitions };
        }
        throw new Error(`${what}: ${outcome.message}`);
      }
    }
    throw new Error(
      `${what} did not happen in ${String(options.maxDecisions)} decisions: ${transitions.slice(-12).join(' | ')}`,
    );
  }

  /** Picks the first card of every pack until the draft completes; returns the pick count. */
  async draftToCompletion(afterPick?: (index: number) => Promise<void>): Promise<number> {
    let picks = 0;
    for (let index = 0; index < MAX_PICKS; index += 1) {
      // The printed route titles the end 'Draft complete'; the kernel route
      // keeps its 'Draft finished' sentence inside a collapsed details panel,
      // so the control it offers once nothing is left to pick is the signal.
      // The wait inside the page is shorter than the CDP wait around it so its
      // message, not a timeout, is the error.
      const state = (await this.evaluate(
        `__j.waitFor('pack or completion', () => { __j.failIfError(); const text = document.body.innerText; if (text.includes('Draft complete') || __j.named('Play drafted deck')) return 'complete'; const m = text.match(/Pack \\d+ · Pick \\d+/); return m ? m[0] : null; }, 45000)`,
      )) as string;
      if (state === 'complete') return picks;
      await this.evaluate(
        `(() => { const pack = document.querySelector('[role="group"][aria-label^="Draft pack"]'); const b = pack?.querySelector('button.mtg-card') ?? pack?.querySelector('button'); if (!b) throw new Error('no pack card'); b.click(); return true; })()`,
      );
      await this.evaluate(
        `__j.waitFor('Pick button', () => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Pick ') && !b.disabled); return b ? b.textContent : null; })`,
      );
      await this.evaluate(
        `[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Pick ')).click()`,
      );
      await this.evaluate(
        `__j.waitFor('pick advanced', () => !document.body.innerText.includes(${JSON.stringify(state)}) ? true : null, 60000)`,
      );
      picks += 1;
      if (afterPick !== undefined) await afterPick(index);
    }
    throw new Error(`draft did not complete within ${String(MAX_PICKS)} picks`);
  }
}

function countOpens(page: Page): number {
  return page
    .gateway()
    .filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/engine-api/sessions').length;
}

async function closeGame(page: Page): Promise<number> {
  const before = page.gateway().filter((r) => r.method === 'DELETE').length;
  await page.evaluate(`__j.click('Close game')`);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const count = page.gateway().filter((r) => r.method === 'DELETE').length;
    if (count > before) return count - before;
    if (Date.now() > deadline) throw new Error('Close game sent no DELETE to the gateway within 60s');
    await new Promise((done) => setTimeout(done, 200));
  }
}

/**
 * How many cards the built deck holds, read off the deck pane's own heading.
 *
 * `mtg-84703` took the standing `40 cards in deck` band out of the printed pool
 * editor: it was the deck pane's note said a second time, one band above it, on
 * a screen whose complaint was that too little of the window was cards. The
 * remaining statement is `builderCountsLine`'s, so this pulls the count back out
 * of it and keeps saying it the way every step below already asks for.
 */
const SEALED_COUNT = `(() => {
  const note = document.querySelector('[data-pane="deck"] .mtg-deck__pane-note')?.textContent ?? '';
  const found = /^(\\d+) of \\d+ cards\\b/.exec(note);
  return found === null ? '' : found[1] + ' cards in deck';
})()`;

async function printedGallery(page: Page, source: string, name: string): Promise<void> {
  await page.step('gallery renders the printings with live art and a working face toggle', async () => {
    await page.navigate(`#/cards/gallery?source=${source}`);
    const heading = await page.evaluate(
      `__j.waitFor('gallery heading', () => { const h1 = document.querySelector('h1'); return h1 && h1.textContent.includes(${JSON.stringify(name)}) ? h1.textContent : null; }, 60000)`,
    );
    const status = await page.evaluate(
      `__j.waitFor('gallery loaded', () => { const s = document.querySelector('[role="status"]')?.textContent ?? ''; return /^\\d+ of \\d+ shown$/.test(s) && document.querySelector('[aria-label="Search cards"]') ? s : null; }, 60000)`,
    );
    const cards = await page.evaluate(`document.querySelectorAll('[data-physical-id]').length`);
    const art = await page.evaluate(
      `__j.waitFor('art loaded', () => __j.loadedArt() > 0 ? __j.loadedArt() : null, 60000)`,
    );
    const face = await page.evaluate(
      `(async () => { const faceFlip = new RegExp(${JSON.stringify(FACE_FLIP_LABEL_SOURCE)}); const b = [...document.querySelectorAll('button')].find((b) => faceFlip.test(b.getAttribute('aria-label') ?? '')); if (!b) return null; const before = b.getAttribute('aria-label'); b.click(); const after = await __j.waitFor('face toggled', () => { const n = [...document.querySelectorAll('button')].find((b) => faceFlip.test(b.getAttribute('aria-label') ?? '') && b.getAttribute('aria-label') !== before); return n ? n.getAttribute('aria-label') : null; }); return { before, after }; })()`,
    );
    return { heading, status, cards, art, face };
  });
}

async function printedJourney(page: Page, id: string, name: string): Promise<void> {
  const source = `printed%3A${encodeURIComponent(id)}`;
  const sealedSeed = `live-journey-sealed/${id}`;
  const draftSeed = `live-journey-draft/${id}`;

  await printedGallery(page, source, name);

  await page.step('sealed pool opens and a suggested build reaches 40 cards', async () => {
    await page.navigate(`#/play/sealed?seed=${encodeURIComponent(sealedSeed)}&source=${source}`);
    await page.evaluate(
      `__j.waitFor('0 cards in deck', () => ${SEALED_COUNT} === '0 cards in deck' ? true : null, 60000)`,
    );
    const pool = await page.evaluate(`document.querySelectorAll('[data-physical-id]').length`);
    await page.evaluate(`__j.click('Suggest a build')`);
    await page.evaluate(
      `__j.waitFor('40 cards in deck', () => ${SEALED_COUNT} === '40 cards in deck' ? true : null, 60000)`,
    );
    await page.evaluate(
      `__j.waitFor('Play Forge match enabled', () => { const b = __j.named('Play Forge match'); return b && !b.disabled ? true : null; }, 60000)`,
    );
    return { pool, deck: 40 };
  });

  await page.step('Forge match opens, keeps the hand and plays a land', async () => {
    const started = Date.now();
    const opensBefore = countOpens(page);
    await page.evaluate(`__j.click('Play Forge match')`);
    const opened = await page.evaluate(OPEN_AND_KEEP, OPEN_AND_KEEP_TIMEOUT_MS);
    const played = await page.playUntilLand();
    return { openMs: Date.now() - started, sessionOpens: countOpens(page) - opensBefore, opened, played };
  });

  await page.step(
    'closing the table releases the gateway session and the deck survives a reload',
    async () => {
      const closes = await closeGame(page);
      await page.evaluate(`__j.waitFor('pool after Close game', () => ${SEALED_COUNT} ? true : null, 60000)`);
      await page.navigate(`#/play/sealed?seed=${encodeURIComponent(sealedSeed)}&source=${source}`);
      await page.evaluate(
        `__j.waitFor('40 cards after reload', () => ${SEALED_COUNT} === '40 cards in deck' ? true : null, 60000)`,
      );
      const playEnabled = await page.evaluate(
        `(() => { const b = __j.named('Play Forge match'); return b ? !b.disabled : null; })()`,
      );
      return { closes, playEnabled };
    },
  );

  await page.step(
    'an eight-seat draft runs to completion, survives a reload, and builds a deck',
    async () => {
      await page.navigate(`#/play/draft?seed=${encodeURIComponent(draftSeed)}&source=${source}`);
      let resumed: unknown = null;
      const picks = await page.draftToCompletion(async (index) => {
        if (index !== 5) return;
        await page.navigate(`#/play/draft?seed=${encodeURIComponent(draftSeed)}&source=${source}`);
        resumed = await page.evaluate(
          `__j.waitFor('draft resumes at pick 7', () => document.body.innerText.includes('Pack 1 · Pick 7') ? 'Pack 1 · Pick 7' : null, 60000)`,
        );
      });
      await page.evaluate(
        `(() => { const b = __j.named('Suggest a build'); if (b && !b.disabled) b.click(); return true; })()`,
      );
      await page.evaluate(
        `__j.waitFor('40 cards after draft', () => ${SEALED_COUNT} === '40 cards in deck' ? true : null, 60000)`,
      );
      await page.evaluate(
        `__j.waitFor('Play Forge match enabled after draft', () => { const b = __j.named('Play Forge match'); return b && !b.disabled ? true : null; }, 60000)`,
      );
      return { picks, resumed };
    },
  );

  await page.step('the drafted deck opens a Forge match too', async () => {
    const started = Date.now();
    await page.evaluate(`__j.click('Play Forge match')`);
    const opened = await page.evaluate(OPEN_AND_KEEP, OPEN_AND_KEEP_TIMEOUT_MS);
    const closes = await closeGame(page);
    return { openMs: Date.now() - started, opened, closes };
  });
}

const LIFE = `[...document.querySelectorAll('[title="life total"]')].map((n) => n.textContent ?? '')`;

/**
 * A constructed printed format ships decks rather than packs, so its journey
 * seats two of them: the first deck yours, the second across the table. They
 * are offered on the Commander section and nowhere else
 * (`./live-journey-routes.ts`), which is where this opens them. The
 * Commander table is proven by the life totals the board draws, which are the
 * format's starting life rather than twenty, and by the same open-keep-land
 * sequence every other Forge subject walks.
 */
async function printedPreconJourney(page: Page, id: string, name: string): Promise<void> {
  const source = `printed%3A${encodeURIComponent(id)}`;
  // The bar above every tab carries the launcher's set picker, itself a select,
  // so the deck selects are found through their labels rather than by position.
  const SELECT = (label: string) =>
    `[...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').startsWith(${JSON.stringify(label)}))?.querySelector('select')`;
  const CHOOSE = (label: string, index: number) =>
    `(() => { const s = ${SELECT(label)}; if (!s) throw new Error('no ' + ${JSON.stringify(label)} + ' select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[${String(index)}].value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  const SELECT_YOURS = SELECT('Your deck');
  const PAIRING = `[${SELECT_YOURS}, ${SELECT('Across the table')}].map((s) => s ? s.options[s.selectedIndex]?.textContent ?? '' : null)`;
  // `48a3b6eae` (2026-09-17) took the `[aria-label="Decks"]` census off the play
  // page (`../src/routes/printed/PrintedPreconRoute.ts`): a constructed table's
  // page draws only the two selects and the seated pair's own findings now.
  // Every shipped deck's name comes off the select's options instead, and
  // whether it is legal comes off `seatedFindings`' alert list, read once per
  // deck by pairing it against its neighbor in turn so every shipped deck
  // takes the `Your deck` seat at least once.
  const DECK_NAMES = `[...${SELECT_YOURS}.options].map((o) => o.textContent ?? '')`;
  const FINDINGS = `[...document.querySelectorAll('[role="alert"] > li')].map((li) => li.textContent ?? '')`;
  // The commander census went with the `Decks` list, and the play page names a
  // commander nowhere else either -- only the opposing deck's facts line names
  // one. `View <deck>` opens the same deck screen every other printed route
  // reads a deck from, and its commander card carries the same `Name. ...`
  // accessible label every other card on this board does.
  const COMMANDER = `(() => { const el = document.querySelector('.mtg-printed-precon-commander .mtg-card'); return el ? __j.label(el).split('.')[0] : null; })()`;
  let commander = '';

  await printedGallery(page, source, name);

  await page.step('every shipped deck is legal and a pairing of two enables Play Forge match', async () => {
    await page.navigate(playHash(sectionForPrecon('commander'), { source: `printed:${id}` }));
    await page.evaluate(
      `__j.waitFor('shipped decks', () => { const s = ${SELECT_YOURS}; return s && s.options.length > 1 ? true : null; }, 60000)`,
    );
    const deckNames = (await page.evaluate(DECK_NAMES)) as readonly string[];
    if (deckNames.length < 2)
      throw new Error(`this format ships fewer than two decks: ${deckNames.join(', ')}`);
    const illegal: string[] = [];
    for (let index = 0; index < deckNames.length; index += 1) {
      const deckName = deckNames[index]!;
      const across = (index + 1) % deckNames.length;
      await page.evaluate(CHOOSE('Your deck', index));
      await page.evaluate(CHOOSE('Across the table', across));
      await page.evaluate(
        `__j.waitFor('deck seated', () => { const p = ${PAIRING}; return p[0] === ${JSON.stringify(deckName)} ? true : null; }, 60000)`,
      );
      const findings = (await page.evaluate(FINDINGS)) as readonly string[];
      if (findings.some((line) => line.startsWith(`${deckName}: `))) illegal.push(deckName);
    }
    if (illegal.length > 0) throw new Error(`decks fail the Commander check: ${illegal.join(', ')}`);
    const humanName = deckNames[0]!;
    await page.evaluate(CHOOSE('Your deck', 0));
    await page.evaluate(CHOOSE('Across the table', 1));
    const pairing = await page.evaluate(
      `__j.waitFor('distinct pairing', () => { const p = ${PAIRING}; return p[0] && p[1] && p[0] !== p[1] ? p : null; }, 60000)`,
    );
    await page.evaluate(
      `__j.waitFor('Play Forge match enabled', () => { const b = __j.named('Play Forge match'); return b && !b.disabled ? true : null; }, 60000)`,
    );
    const route = await page.evaluate('location.hash');
    await page.evaluate(`__j.click(${JSON.stringify(`View ${humanName}`)})`);
    commander = (await page.evaluate(`__j.waitFor('commander card', () => ${COMMANDER}, 15000)`)) as string;
    await page.evaluate(`__j.click(${JSON.stringify(PRECON_BACK_LABEL)})`);
    return { decks: deckNames, pairing, commander, route };
  });

  await page.step(
    "the Commander table opens at the format's starting life, keeps the hand and plays a land",
    async () => {
      const started = Date.now();
      const opensBefore = countOpens(page);
      await page.evaluate(`__j.click('Play Forge match')`);
      const opened = await page.evaluate(OPEN_AND_KEEP, OPEN_AND_KEEP_TIMEOUT_MS);
      const life = (await page.evaluate(
        `__j.waitFor('life totals', () => { const l = ${LIFE}; return l.length >= 2 ? l : null; }, 60000)`,
      )) as readonly string[];
      if (life.some((total) => total === '20'))
        throw new Error(`a seat opened at twenty life on a Commander table: ${life.join(', ')}`);
      const played = await page.playUntilLand();
      return {
        openMs: Date.now() - started,
        sessionOpens: countOpens(page) - opensBefore,
        opened,
        life,
        played,
      };
    },
  );

  await page.step(
    'the commander is cast from the command zone and resolves onto the battlefield',
    async () => {
      // The command zone panel sits beside the battlefield with the commander in
      // it and its ledger reading no cast yet; after the cast the card has left
      // and the zone's empty sentence carries the one cast the engine counted.
      const LEDGER = `(() => { const zone = document.querySelector('.mtg-board__side[data-seat="you"] > .mtg-command'); if (!zone) throw new Error('no command zone panel beside your battlefield'); const card = zone.querySelector('.mtg-card'); return { card: card ? __j.label(card).split('.')[0] : null, ledger: zone.querySelector('.mtg-command__casts')?.textContent ?? null, empty: zone.querySelector('.mtg-zone__empty')?.textContent ?? null }; })()`;
      const before = (await page.evaluate(LEDGER)) as { card: string | null; ledger: string | null };
      if (before.card !== commander || before.ledger !== 'not yet cast')
        throw new Error(`the command zone does not hold ${commander} uncast: ${JSON.stringify(before)}`);
      const onBattlefield = `(() => { const slot = __j.playSlots().find((s) => __j.label(s.querySelector('.mtg-card') ?? s).startsWith(${JSON.stringify(commander)} + '.')); return slot ? { oid: slot.getAttribute('data-permanent-key'), inLandRow: slot.closest('.mtg-lands') !== null, turn: __j.turn() } : null; })()`;
      const cast = await page.playUntil(`casting ${commander}`, onBattlefield, {
        prefer: `${commander}:`,
        maxDecisions: MAX_COMMANDER_DECISIONS,
      });
      const casts = cast.transitions.filter((move) => move.includes(` panel: ${commander}:`));
      if (casts.length === 0)
        throw new Error(
          `${commander} reached the battlefield without a cast move: ${cast.transitions.slice(-8).join(' | ')}`,
        );
      const after = (await page.evaluate(LEDGER)) as { card: string | null; empty: string | null };
      if (after.card !== null || after.empty !== 'commander in play · cast 1× · tax {2}')
        throw new Error(`the command zone did not record the cast: ${JSON.stringify(after)}`);
      return {
        commander,
        ...cast,
        transitions: cast.transitions.slice(-12),
        casts: casts.length,
        before,
        after,
      };
    },
  );

  await page.step('the game runs to an end and the board says who won and why', async () => {
    const finished = `(() => { const live = document.querySelector('[data-session-phase="finished"]'); if (!live) return null; const result = [...live.querySelectorAll('p[role="status"]')].map((n) => n.textContent ?? '').find((t) => /wins|drawn|finished/u.test(t)) ?? ''; return { result, life: ${LIFE}, turn: __j.turn() }; })()`;
    const end = await page.playUntil('the end of the game', finished, {
      prefer: null,
      maxDecisions: MAX_GAME_DECISIONS,
    });
    return { ...end, transitions: end.transitions.slice(-12) };
  });

  await page.step(
    'closing the table releases the gateway session and the pairing survives a reload',
    async () => {
      const closes = await closeGame(page);
      const route = (await page.evaluate('location.hash')) as string;
      await page.navigate(route);
      const pairing = await page.evaluate(
        `__j.waitFor('pairing after reload', () => { const p = ${PAIRING}; return p[0] && p[1] && p[0] !== p[1] ? p : null; }, 60000)`,
      );
      const playEnabled = await page.evaluate(
        `__j.waitFor('Play Forge match after reload', () => { const b = __j.named('Play Forge match'); return b ? !b.disabled : null; }, 60000)`,
      );
      return { closes, pairing, playEnabled };
    },
  );
}

async function kernelJourney(page: Page, stem: string): Promise<void> {
  const source = encodeURIComponent(stem);
  const sealedSeed = `live-journey-sealed/${stem}`;
  // The suggestion is a two-color build, and a thin drafted pool can leave it
  // short of forty: the reduced Return to Ravnica did, at twenty-nine. A person
  // then adds from the pool until the play control wakes, so the journey does
  // the same and records how many it added.
  const fillFromPool = `(async () => { let added = 0; for (;;) { const b = __j.startControl(); if (b && !b.disabled) return added; const card = document.querySelector('[data-pane="pool"] button.mtg-card[aria-pressed="false"]'); if (!card) throw new Error('deck is short and the pool has nothing left to add; text=' + JSON.stringify(document.body.innerText.slice(0, 400))); if (added >= 60) throw new Error('added 60 pool cards without reaching a legal deck'); card.click(); added += 1; await new Promise((done) => setTimeout(done, 50)); } })()`;
  const startGame = `__j.waitFor('a start control', () => { const b = __j.startControl(); return b && !b.disabled ? b : null; }, 60000).then((b) => { const l = __j.label(b); b.click(); return l; })`;

  await page.step('gallery renders the staged set', async () => {
    await page.navigate(`#/cards/gallery?source=${source}`);
    const status = await page.evaluate(
      `__j.waitFor('gallery loaded', () => { const s = [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? '').find((t) => /\\d+ of \\d+/.test(t)); return s || null; }, 60000)`,
    );
    const cards = await page.evaluate(`document.querySelectorAll('.mtg-card').length`);
    if (cards === 0) throw new Error('gallery drew no card faces');
    const art = await page.evaluate('__j.loadedArt()');
    return { status, cards, art };
  });

  await page.step('a sealed pool is dealt, built, and played to a land drop in the kernel', async () => {
    await page.navigate(`#/play/sealed?seed=${encodeURIComponent(sealedSeed)}&source=${source}`);
    await page.evaluate(
      `__j.waitFor('sealed chooser', () => __j.named('Generate sealed pool') ? true : null, 60000)`,
    );
    await page.evaluate(`__j.click('Generate sealed pool')`);
    await page.evaluate(
      `__j.waitFor('builder', () => { const b = __j.named('Suggest a build'); return b && !b.disabled ? true : null; }, 60000)`,
    );
    await page.evaluate(`__j.click('Suggest a build')`);
    const addedFromPool = await page.evaluate(fillFromPool);
    const start = await page.evaluate(startGame, 70_000);
    const opened = await page.evaluate(OPEN_AND_KEEP, OPEN_AND_KEEP_TIMEOUT_MS);
    const played = await page.playUntilLand();
    return { start, addedFromPool, opened, played };
  });

  await page.step('a draft runs to completion and the drafted deck opens a game', async () => {
    // The chooser is the human path: New draft invents the seed, so the seed
    // is read back off the route and recorded rather than chosen here.
    await page.navigate(`#/play/draft?source=${source}`);
    await page.evaluate(
      `__j.waitFor('draft chooser', () => __j.named('New draft') && !document.querySelector('[role="group"][aria-label^="Draft pack"]') ? true : null, 60000)`,
    );
    await page.evaluate(`__j.click('New draft')`);
    const route = await page.evaluate(
      `__j.waitFor('first pack', () => document.querySelector('[role="group"][aria-label^="Draft pack"]') ? location.hash : null, 60000)`,
    );
    const picks = await page.draftToCompletion();
    await page.evaluate(
      `(() => { const b = __j.named('Suggest a build'); if (b && !b.disabled) b.click(); return true; })()`,
    );
    const addedFromPool = await page.evaluate(fillFromPool);
    const start = await page.evaluate(startGame, 70_000);
    const opened = await page.evaluate(OPEN_AND_KEEP, OPEN_AND_KEEP_TIMEOUT_MS);
    return { route, picks, addedFromPool, start, opened };
  });
}

interface Subject {
  readonly kind: 'printed' | 'kernel';
  readonly format?: 'limited' | 'constructed';
  readonly id: string;
  readonly name: string;
}

async function readJson(url: string): Promise<unknown | null> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok) return null;
  return (await response.json()) as unknown;
}

async function discover(
  base: string,
): Promise<{ subjects: readonly Subject[]; cube: boolean; unsupported: readonly string[] }> {
  const printed = await readJson(`${base}/formats/index.json`);
  const sets = await readJson(`${base}/sets/index.json`);
  const cube =
    (await fetch(`${base}/legacy-cube-2021-forge-ready-v1.json`, { method: 'HEAD' }).catch(() => null))?.ok ??
    false;
  const subjects: Subject[] = [];
  const unsupported: string[] = [];
  if (printed !== null) {
    for (const format of PrintedIndexSchema.parse(printed).formats) {
      if (format.availability.play.status === 'supported')
        subjects.push({ kind: 'printed', format: format.kind, id: format.id, name: format.name });
      else unsupported.push(`${format.id} (${format.availability.play.status})`);
    }
  }
  if (sets !== null) {
    for (const row of SetIndexSchema.parse(sets).sets)
      subjects.push({ kind: 'kernel', id: row.stem, name: row.name });
  }
  return { subjects, cube, unsupported };
}

function runLegacyCubeSmoke(base: string, directory: string): SubjectEvidence {
  const started = Date.now();
  const result = spawnSync(
    'npx',
    [
      'tsx',
      join(REPO_ROOT, 'packages', 'ui', 'tools', 'legacy-cube-live-smoke.ts'),
      '--url',
      `${base}/#/play/draft?cube=legacy-cube-2021-08`,
      '--artifacts',
      directory,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const ok = result.status === 0;
  const tail = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-12).join('\n');
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} verify:legacy-cube-live exited ${String(result.status)} (${String(Date.now() - started)}ms)`,
  );
  return {
    kind: 'legacy-cube',
    id: 'legacy-cube-2021',
    name: 'Legacy Cube 2021',
    passed: ok,
    failure: ok ? null : tail,
    steps: [{ name: 'verify:legacy-cube-live', ok, ms: Date.now() - started, detail: tail }],
    gateway: [],
  };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    process.exit(2);
  }
  if (args.maxUsd !== null) {
    // Checked before anything else opens: acceptance criterion 3 is "refuses
    // to start ... rather than failing part-way through a journey", so this
    // runs ahead of `discover()` and ahead of launching Chrome. The dynamic
    // `import()` below is the only place this file reaches
    // `@browserbasehq/stagehand` (through `stagehand-runner.ts`), and it is
    // reached only after the key and the `@mtg/llm` provider both check out,
    // so the no-`--max-usd` path above never evaluates it
    // (`stagehand-runner.test.ts`'s static-analysis gate holds that).
    let key: string;
    let provider: StagehandProvider;
    try {
      key = requireStagehandKey(process.env, args.envFile);
      const { resolveStagehandProvider } = await import('./stagehand-provider');
      provider = resolveStagehandProvider({ env: process.env, maxUsd: args.maxUsd });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }
    // Checked before the profile dir exists: `launchStagehandChromium` throws
    // this same error, but only after `mkdtemp` below, and that throw sits
    // outside any try/finally, so a missing binary would leak the directory.
    if (!chromiumPresent) {
      console.error(new StagehandChromiumMissingError().message);
      process.exit(2);
    }
    const profile = await mkdtemp(join(tmpdir(), 'mtg-live-journey-stagehand-chrome-'));
    const chrome = await launchStagehandChromium(profile);
    let exitCode: number;
    try {
      const extensionId = await discoverStagehandExtensionId(chrome.client, STAGEHAND_EXTENSION_DEADLINE_MS);
      const { runLiveStagehandJourney } = await import('./stagehand-runner');
      const { report, reportPath, failed } = await runLiveStagehandJourney({
        url: args.url,
        artifactsDir: args.artifacts,
        jevKey: key,
        provider,
        maxUsd: args.maxUsd,
        cdpUrl: chrome.debuggerUrl,
        extensionId,
      });
      console.log(JSON.stringify(report, null, 2));
      console.log(`stagehand report: ${reportPath}`);
      console.log(spendLine(report));
      if (report.stoppedAtCeiling) {
        console.error(
          `--max-usd ${String(args.maxUsd)} reached after step ${JSON.stringify(report.stoppedAfterStep)}; ` +
            `spent $${report.spentUsd.toFixed(4)}.`,
        );
      }
      exitCode = failed ? 1 : 0;
    } finally {
      await shutdownChrome(chrome);
      await rm(profile, { recursive: true, force: true });
    }
    // Exiting inside the `try` would skip the `finally`, leaving Chrome
    // running and its profile on disk.
    process.exit(exitCode);
  }
  const { subjects, cube, unsupported } = await discover(args.url);
  const chosen = subjects.filter((subject) => args.only === null || args.only.includes(subject.id));
  if (chosen.length === 0 && (args.skipCube || !cube)) {
    console.error(`nothing to prove at ${args.url}: is a launcher running there?`);
    process.exit(2);
  }
  await mkdir(args.artifacts, { recursive: true });
  console.log(
    `launcher ${args.url}: ${String(chosen.length)} subject(s)${cube && !args.skipCube ? ' + Legacy Cube' : ''}; artifacts in ${args.artifacts}`,
  );
  for (const entry of unsupported) console.log(`  skipping ${entry}: play is not registered as supported`);

  const profile = await mkdtemp(join(tmpdir(), 'mtg-live-journey-chrome-'));
  const chrome = await launchChrome(profile);
  const evidence: SubjectEvidence[] = [];
  try {
    for (const subject of chosen) {
      console.log(`${subject.kind} ${subject.id}: ${subject.name}`);
      const directory = join(args.artifacts, `${subject.kind}-${subject.id}`);
      await mkdir(directory, { recursive: true });
      const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
      const page = new Page(chrome.client, String(target['targetId']), args.url, directory);
      let failure: string | null = null;
      try {
        await page.attach();
        if (subject.kind !== 'printed') await kernelJourney(page, subject.id);
        else if (subject.format === 'constructed') await printedPreconJourney(page, subject.id, subject.name);
        else await printedJourney(page, subject.id, subject.name);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        await page.captureFailure();
      }
      const record: SubjectEvidence = {
        kind: subject.kind,
        id: subject.id,
        name: subject.name,
        passed: failure === null,
        failure,
        steps: page.steps,
        gateway: page.gateway(),
      };
      evidence.push(record);
      await writeFile(join(directory, 'evidence.json'), JSON.stringify(record, null, 2));
      try {
        await page.close();
      } catch (closeError) {
        console.log(`  cleanup: ${String(closeError)}`);
      }
    }
  } finally {
    await shutdownChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
  if (cube && !args.skipCube && (args.only === null || args.only.includes('legacy-cube-2021'))) {
    console.log('legacy-cube legacy-cube-2021: Legacy Cube 2021');
    const directory = join(args.artifacts, 'legacy-cube-2021');
    await mkdir(directory, { recursive: true });
    evidence.push(runLegacyCubeSmoke(args.url, directory));
  }
  const failed = evidence.filter((entry) => !entry.passed);
  const summary = {
    url: args.url,
    at: new Date().toISOString(),
    passed: failed.length === 0,
    subjects: evidence.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      name: entry.name,
      passed: entry.passed,
      failure: entry.failure,
      steps: entry.steps.length,
    })),
    unsupported,
  };
  await writeFile(join(args.artifacts, 'journey-evidence.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    failed.length === 0
      ? 'LIVE JOURNEY PASSED'
      : `LIVE JOURNEY FAILED: ${failed.map((entry) => entry.id).join(', ')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
