/**
 * Prove the ordinary attacker gesture through a real browser and installed Forge.
 *
 * The fixture is served by the already-running `npm run play` process. It uses
 * the production BackendGame, HTTP backend gateway, and isolated Forge process,
 * but a controlled legal singleton deck rather than a random draft so reaching
 * the first combat is deterministic.
 *
 *   npm run verify:legacy-cube-attack-live
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserPresent,
  chromePath,
  cleanupTarget,
  launchChrome,
  reason,
  shutdownChrome,
} from '../test/support/chrome-driver';
import type { CdpClient } from '../test/support/chrome-driver';
import { gatewayLifecycleProblem, gatewayResponsesOf } from './legacy-cube-live-evidence';

const DEFAULT_URL = 'http://127.0.0.1:5282/test/play/installed-forge-attack-live.html';
const JOURNEY_TIMEOUT_MS = 300_000;

interface AttackEvidence {
  readonly humanFirst: boolean;
  readonly castCreature: string;
  readonly stackCard: string;
  readonly stackResolveVisible: boolean;
  readonly stackCardInspectable: boolean;
  readonly stackCardOpened: boolean;
  readonly staleCastVisible: boolean;
  readonly initialConfirmation: string;
  readonly stagedConfirmation: string;
  readonly stagedCard: boolean;
  readonly currentAskVisible: boolean;
  readonly waitingFallbackVisible: boolean;
  readonly attackBeat: boolean;
  readonly declaredCard: boolean;
  readonly declaredCardTapped: boolean;
  readonly passDisabledDuringBeat: boolean;
  readonly committed: boolean;
}

function journeyExpression(): string {
  return `(async () => {
    const deadlineAfter = (milliseconds) => Date.now() + milliseconds;
    const label = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
    const controls = () => Array.from(document.querySelectorAll('button, [role="button"]'));
    const named = (wanted) => controls().find((node) => label(node) === wanted);
    const waitFor = async (description, predicate, milliseconds = 120000) => {
      const deadline = deadlineAfter(milliseconds);
      while (Date.now() < deadline) {
        const setupFailure = window.__mtgInstalledForgeAttackFailure;
        if (setupFailure) throw new Error(setupFailure);
        const alert = document.querySelector('[data-session-phase="error"] [role="alert"]');
        if (alert?.textContent?.trim()) throw new Error(alert.textContent.trim());
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('timed out waiting for ' + description);
    };
    const phaseBand = () => document.querySelector('[aria-label="Phases and stops"]')?.textContent ?? '';
    const legalMoves = () => document.querySelector('[data-play-frame="shared"] [aria-label="Legal moves"]');
    const tally = () => Array.from(document.querySelectorAll('.mtg-play-meta')).map((node) =>
      (node.textContent ?? '').trim(),
    ).find((text) => text.endsWith(' choices made')) ?? '';
    const fingerprint = () => JSON.stringify({
      phase: document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase') ?? '',
      band: phaseBand(),
      moves: legalMoves()?.textContent ?? '',
      tally: tally(),
    });
    const clickAndWait = async (control, description) => {
      const before = fingerprint();
      if (control.disabled) throw new Error(description + ' is disabled');
      control.click();
      await waitFor(description + ' response', () => fingerprint() !== before);
    };
    const handSlots = () => Array.from(document.querySelectorAll(
      '.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="hand"][data-permanent-key]',
    ));
    const battlefieldSlots = () => Array.from(document.querySelectorAll(
      '.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="play"][data-permanent-key]',
    ));
    const cardButton = (slot) => slot.querySelector(':scope > button.mtg-card');
    const cardName = (slot) => label(cardButton(slot) ?? slot).split('.')[0].trim();

    await waitFor('controlled fixture setup', () => window.__mtgInstalledForgeAttackReady === true);
    const opening = await waitFor('ordinary opening hand', () => {
      const group = legalMoves();
      const title = group?.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim();
      return title === 'Opening hand' ? group : null;
    });
    const openingLabels = Array.from(opening.querySelectorAll('button')).map(label);
    if (openingLabels.some((text) => text === 'Play first' || text === 'Choose to play first')) {
      throw new Error('play-first choice leaked into the controlled shared UI');
    }
    const keep = Array.from(opening.querySelectorAll('button')).find((button) => label(button) === 'Keep this hand');
    if (!keep) throw new Error('opening hand exposed no Keep this hand action');
    await clickAndWait(keep, 'Keep this hand');
    const firstTurn = await waitFor('human-owned first turn', () => {
      const active = document.querySelector('.mtg-board__side[data-seat="you"][data-active="true"]');
      const turn = document.querySelector('.mtg-turnstops__head')?.textContent?.trim() ?? '';
      return active !== null && turn === 'Turn 1: You' ? turn : null;
    });

    const plains = await waitFor('playable Plains', () => handSlots().find((slot) => {
      const button = cardButton(slot);
      return cardName(slot) === 'Plains' && button !== null && !button.disabled;
    }));
    await clickAndWait(cardButton(plains), 'play Plains');

    const oneDrops = ${JSON.stringify([
      'Giver of Runes',
      'Usher of the Fallen',
      'Mother of Runes',
      'Student of Warfare',
      'Thraben Inspector',
      'Esper Sentinel',
    ])};
    const creature = await waitFor('castable one-mana creature', () => handSlots().find((slot) => {
      const button = cardButton(slot);
      return oneDrops.includes(cardName(slot)) && button !== null && !button.disabled;
    }));
    const creatureOid = creature.getAttribute('data-permanent-key');
    const castCreature = cardName(creature);
    if (!creatureOid) throw new Error('castable creature has no permanent key');
    await clickAndWait(cardButton(creature), 'cast ' + castCreature);

    const stackEntry = await waitFor(castCreature + ' on the shared stack', () =>
      Array.from(document.querySelectorAll('.mtg-stack__entry')).find((entry) =>
        (entry.textContent ?? '').includes(castCreature),
      ),
    );
    const resolve = Array.from(stackEntry.querySelectorAll('button')).find(
      (button) => label(button) === 'Let it resolve',
    );
    const stackCard = (stackEntry.querySelector('.mtg-stack__name')?.textContent ?? '')
      .trim()
      .replace(/^[0-9]+[.] */u, '');
    const inspect = stackEntry.querySelector('[data-inspect-card]');
    const staleCastVisible = controls().some((control) => label(control) === 'Cast ' + castCreature);
    if (!(inspect instanceof HTMLElement)) throw new Error('stack card exposed no full-card inspection control');
    inspect.click();
    const openedStackCard = await waitFor('exact full card in the shared Info rail', () => {
      const info = document.querySelector('[role="group"][aria-label="Info"]');
      const face = info?.querySelector('.mtg-card[data-presentation="printed-card"]');
      const name = face?.querySelector('.mtg-card__name')?.textContent?.trim() ?? '';
      return name === castCreature ? face : null;
    });

    for (let guard = 0; guard < 80; guard += 1) {
      const landed = battlefieldSlots().find((slot) => slot.getAttribute('data-permanent-key') === creatureOid);
      if (landed) break;
      const pass = named('Pass');
      if (pass && !pass.disabled) {
        await clickAndWait(pass, 'resolve ' + castCreature);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await waitFor(castCreature + ' on the battlefield', () =>
      battlefieldSlots().find((slot) => slot.getAttribute('data-permanent-key') === creatureOid),
    );

    let initial = null;
    for (let guard = 0; guard < 120 && initial === null; guard += 1) {
      const noAttacks = named('No attacks');
      if (noAttacks && !noAttacks.disabled) {
        initial = noAttacks;
        break;
      }
      const pass = named('Pass');
      if (pass && !pass.disabled) {
        await clickAndWait(pass, 'advance toward first attack');
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (initial === null) throw new Error('first declare-attackers confirmation did not appear');
    const attacker = await waitFor('eligible battlefield attacker', () => {
      const slot = battlefieldSlots().find((candidate) =>
        candidate.getAttribute('data-permanent-key') === creatureOid,
      );
      const button = slot ? cardButton(slot) : null;
      return button !== null && !button.disabled ? button : null;
    });
    await clickAndWait(attacker, 'stage ' + castCreature + ' as attacker');
    const staged = await waitFor('ordinary Attack with 1 confirmation', () => {
      const control = named('Attack with 1');
      return control && !control.disabled ? control : null;
    });
    const stagedCard = document.querySelector(
      '[data-permanent-key="' + CSS.escape(creatureOid) + '"] [data-mark="staged-attack"]',
    ) !== null;
    const currentAskVisible = document.querySelector('[role="region"][aria-label="Current ask"]') !== null;
    const waitingFallbackVisible = controls().some((node) => label(node).startsWith('Waiting '));
    const beforeCommit = fingerprint();
    staged.click();
    await waitFor('settled committed attacker transition', () => {
      const phase = document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase');
      return phase === 'awaiting' && fingerprint() !== beforeCommit && named('Attack with 1') === undefined;
    });
    const beat = await waitFor('ordinary Attackers declared beat', () => {
      const title = Array.from(document.querySelectorAll('.mtg-panel__title')).find(
        (node) => node.textContent?.trim() === 'Attackers declared',
      );
      const next = named('Continue');
      return title && next && !next.disabled ? { title, next } : null;
    });
    const declared = await waitFor('declared attacker in the combat lane', () =>
      document.querySelector('[aria-label="Combat"] [data-state="declared"]'),
    );
    const declaredSlot = declared.querySelector(
      '[data-permanent-key="' + CSS.escape(creatureOid) + '"]',
    );
    const passDuringBeat = named('Pass');
    const held = fingerprint();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (fingerprint() !== held) throw new Error('combat advanced while the Attackers declared beat was held');
    await clickAndWait(beat.next, 'continue from declared attackers');
    const stillDeclaring = named('Attack with 1') !== undefined;
    return {
      humanFirst: firstTurn === 'Turn 1: You',
      castCreature,
      stackCard,
      stackResolveVisible: resolve !== undefined && !resolve.disabled,
      stackCardInspectable: inspect !== null,
      stackCardOpened: openedStackCard !== null,
      staleCastVisible,
      initialConfirmation: label(initial),
      stagedConfirmation: label(staged),
      stagedCard,
      currentAskVisible,
      waitingFallbackVisible,
      attackBeat: beat.title.textContent?.trim() === 'Attackers declared',
      declaredCard: declaredSlot !== null,
      declaredCardTapped: declared.querySelector('[data-tapped="true"]') !== null,
      passDisabledDuringBeat: passDuringBeat !== undefined && passDuringBeat.disabled,
      committed: !stillDeclaring,
    };
  })()`;
}

async function unmount(client: CdpClient, sessionId: string): Promise<void> {
  await client.call(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const release = window.__mtgInstalledForgeAttackUnmount;
        window.__mtgInstalledForgeAttackUnmount = undefined;
        release?.();
      })()`,
    },
    sessionId,
    15_000,
  );
}

async function main(): Promise<void> {
  if (!browserPresent) throw new Error(`installed Forge attacker proof needs Chrome at ${chromePath}`);
  const url = process.argv[2] ?? DEFAULT_URL;
  const profile = await mkdtemp(join(tmpdir(), 'mtg-installed-forge-attack-'));
  const chrome = await launchChrome(profile);
  let targetId = '';
  let sessionId: string | null = null;
  const network = chrome.client.record('Network.requestWillBeSent', 'Network.responseReceived');
  try {
    const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
    targetId = String(target['targetId']);
    const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await chrome.client.call('Page.enable', {}, sessionId);
    await chrome.client.call('Network.enable', {}, sessionId);
    await chrome.client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    const navigation = await chrome.client.call('Page.navigate', { url }, sessionId, 15_000);
    if (navigation['errorText'] !== undefined) {
      throw new Error(`could not load ${url}: ${String(navigation['errorText'])}`);
    }
    const evaluated = await chrome.client.call(
      'Runtime.evaluate',
      { expression: journeyExpression(), awaitPromise: true, returnByValue: true },
      sessionId,
      JOURNEY_TIMEOUT_MS,
    );
    if (evaluated['exceptionDetails'] !== undefined) {
      const details = evaluated['exceptionDetails'] as {
        readonly exception?: { readonly description?: string };
        readonly text?: string;
      };
      throw new Error(details.exception?.description ?? details.text ?? 'attacker browser journey failed');
    }
    const evidence = (evaluated['result'] as { readonly value?: AttackEvidence } | undefined)?.value;
    if (evidence === undefined) throw new Error('attacker browser journey returned no evidence');
    if (
      !evidence.humanFirst ||
      evidence.stackCard !== evidence.castCreature ||
      !evidence.stackResolveVisible ||
      !evidence.stackCardInspectable ||
      !evidence.stackCardOpened ||
      evidence.staleCastVisible ||
      evidence.initialConfirmation !== 'No attacks' ||
      evidence.stagedConfirmation !== 'Attack with 1' ||
      !evidence.stagedCard ||
      evidence.currentAskVisible ||
      evidence.waitingFallbackVisible ||
      !evidence.attackBeat ||
      !evidence.declaredCard ||
      !evidence.declaredCardTapped ||
      !evidence.passDisabledDuringBeat ||
      !evidence.committed
    ) {
      throw new Error(`attacker gesture evidence failed: ${JSON.stringify(evidence)}`);
    }
    await unmount(chrome.client, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const gateway = gatewayResponsesOf(network.events);
    const lifecycle = gatewayLifecycleProblem(gateway, 1);
    if (lifecycle !== null) throw new Error(lifecycle);
    const failed = gateway.filter((entry) => entry.status < 200 || entry.status >= 300);
    if (failed.length > 0) {
      throw new Error(`installed Forge gateway recorded failed responses: ${JSON.stringify(failed)}`);
    }
    const opens = gateway.filter(
      (entry) => entry.method === 'POST' && new URL(entry.url).pathname === '/engine-api/sessions',
    ).length;
    const moves = gateway.filter(
      (entry) => entry.method === 'POST' && new URL(entry.url).pathname.startsWith('/engine-api/sessions/'),
    ).length;
    const closes = gateway.filter(
      (entry) => entry.method === 'DELETE' && new URL(entry.url).pathname.startsWith('/engine-api/sessions/'),
    ).length;
    if (opens !== 1 || closes !== 1) {
      throw new Error(
        `expected one isolated Forge session, recorded ${String(opens)} opens and ${String(closes)} closes`,
      );
    }
    console.log(
      JSON.stringify({ ok: true, url, evidence, gateway: { opens, moves, closes, failed: 0 } }, null, 2),
    );
  } catch (error) {
    if (sessionId !== null) await unmount(chrome.client, sessionId).catch(() => undefined);
    throw error;
  } finally {
    network.stop();
    if (targetId.length > 0) await cleanupTarget(chrome.client, targetId, sessionId).catch(() => undefined);
    await shutdownChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(reason(error));
  process.exitCode = 1;
});
