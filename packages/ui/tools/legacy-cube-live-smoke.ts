/**
 * Prove the Forge-ready Legacy Cube journey against a running `npm run play`.
 *
 * This is intentionally outside Vitest. The ordinary UI suite owns deterministic
 * component and browser behavior; this environment-dependent check owns the seam
 * from a real browser, through the launcher's HTTP gateway, to the installed Forge
 * subprocess. It never imports or exercises the admission implementation. The
 * staged Forge-ready projection is the browser's read-only input.
 *
 *   npm run verify:legacy-cube-live -- --url http://127.0.0.1:5282/#/play/draft?cube=legacy-cube-2021-08
 *
 * Controls are found by accessible names and every transition is condition-based.
 * A failed run leaves a screenshot and the final HTML in a diagnostic directory;
 * a passing run removes its temporary browser state and prints machine-readable
 * evidence, including the gateway responses that opened and advanced the match.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  browserPresent,
  chromePath,
  cleanupTarget,
  launchChrome,
  reason,
  shutdownChrome,
} from '../test/support/chrome-driver';
import type { CdpClient, CdpEvent, CdpRecording } from '../test/support/chrome-driver';
import { LEGACY_CUBE_SESSION_VERSION } from '../src/routes/legacy-cube/session';
import {
  gatewayLifecycleProblem,
  gatewayResponsesOf,
  matchOpeningBudgetProblem,
} from './legacy-cube-live-evidence';
import type { GatewayResponse } from './legacy-cube-live-evidence';
import { waitForLegacyCubeDecision } from './legacy-cube-live-decision';

const DEFAULT_URL = 'http://127.0.0.1:5282/#/play/draft?cube=legacy-cube-2021-08';
const JOURNEY_TIMEOUT_MS = 300_000;
const SMOKE_SEED = 'legacy-cube-live-smoke/v1';

interface Args {
  readonly url: string;
  readonly artifacts: string | null;
  readonly maximumMatchOpenMs: number | null;
}

interface JourneyEvidence {
  readonly acceptedProjection: {
    readonly cards: number;
    readonly seats: number;
    readonly rounds: number;
    readonly packSize: number;
    readonly contentSha256: string;
    readonly catalogContentSha256: string;
    readonly decisionLedgerContentSha256: string;
    readonly decisionLedgerFileSha256: string;
  };
  readonly draftStatus: string;
  readonly deckStatus: string;
  readonly resumedCompletedDraft: boolean;
  readonly savedDraftVersion: number;
  readonly savedDraftSourceCards: number;
  readonly firstPrompt: string;
  /** Wall time from pressing Play a new game through the first opening-hand ask. */
  readonly matchOpenMs: number;
  /** The first post-mulligan turn is visibly owned by the local seat. */
  readonly humanPlaysFirst: boolean;
  readonly firstTurnLabel: string;
  readonly openingPhaseSteps: number;
  readonly openingCurrentSteps: number;
  readonly openingLegacyTurnBand: boolean;
  readonly submittedMove: string;
  readonly nextPrompt: string;
  readonly transitions: readonly string[];
  readonly phaseBand: string;
  readonly phaseSteps: number;
  readonly manualMana: {
    readonly source: string;
    readonly symbol: string;
    readonly tapped: boolean;
    readonly pooled: boolean;
    readonly undoVisible: boolean;
    readonly restored: boolean;
  };
  readonly fixedPass: boolean;
  readonly fixedPassSubmitted: boolean;
  readonly playedBasic: {
    readonly name: string;
    readonly oid: string;
    readonly artSrc: string;
    readonly manaSymbol: string;
    readonly manaInUpperRight: boolean;
    readonly imageLoaded: boolean;
    readonly reachedBattlefield: boolean;
    readonly inLandRow: boolean;
  };
  readonly sharedBoard: boolean;
  readonly sharedPlayFrame: boolean;
  readonly sharedContextRail: boolean;
  readonly sharedHandSeam: boolean;
  readonly choiceTally: string;
  readonly framedOfficialCards: number;
  readonly wholeCardImages: number;
  readonly hash: string;
  readonly reloadedSavedDeck: ReloadedSavedDeckEvidence;
  readonly closed: boolean;
}

interface ReloadedSavedDeckEvidence {
  readonly hash: string;
  readonly exactHash: boolean;
  readonly savedDraftVersion: number;
  readonly deckStatus: string;
  readonly firstPrompt: string;
  readonly matchOpenMs: number;
  readonly sharedBoard: boolean;
  readonly sharedPlayFrame: boolean;
  readonly phaseSteps: number;
  readonly legacyTurnBand: boolean;
}

type InitialJourneyEvidence = Omit<JourneyEvidence, 'reloadedSavedDeck'>;

function usage(message?: string): string {
  const command =
    'usage: npm run verify:legacy-cube-live -- [--url http://127.0.0.1:5282/#/play/draft?cube=legacy-cube-2021-08] [--artifacts <directory>] [--max-open-ms <milliseconds>]';
  return message === undefined ? command : `${message}\n${command}`;
}

function readArgs(argv: readonly string[]): Args | string {
  let url = DEFAULT_URL;
  let artifacts: string | null = null;
  let maximumMatchOpenMs: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--url') {
      if (value === undefined) return usage('--url needs a value');
      url = value;
      index += 1;
      continue;
    }
    if (flag === '--artifacts') {
      if (value === undefined) return usage('--artifacts needs a value');
      artifacts = resolve(value);
      index += 1;
      continue;
    }
    if (flag === '--max-open-ms') {
      if (value === undefined) return usage('--max-open-ms needs a value');
      maximumMatchOpenMs = Number(value);
      if (!Number.isSafeInteger(maximumMatchOpenMs) || maximumMatchOpenMs <= 0) {
        return usage(`--max-open-ms must be a positive integer, not ${JSON.stringify(value)}`);
      }
      index += 1;
      continue;
    }
    return usage(`unknown flag ${String(flag)}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return usage(`invalid URL ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return usage(`URL must use http or https, not ${parsed.protocol}`);
  }
  if (artifacts !== null && !isAbsolute(artifacts)) {
    return usage(`artifact directory did not resolve absolutely: ${artifacts}`);
  }
  return { url: parsed.href, artifacts, maximumMatchOpenMs };
}

function journeyExpression(): string {
  return `(async () => {
    try {
    const waitForLegacyCubeDecision = ${waitForLegacyCubeDecision.toString()};
    const deadlineAfter = (milliseconds) => Date.now() + milliseconds;
    const label = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
    const controls = () => Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const named = (wanted) => controls().find((node) => label(node) === wanted);
    const namedStarting = (wanted) => controls().find((node) => label(node).startsWith(wanted));
    const describe = () => controls().map(label).filter(Boolean).slice(0, 30);
    const waitFor = async (description, predicate, milliseconds = 30000) => {
      const deadline = deadlineAfter(milliseconds);
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((done) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearTimeout(timer);
            done();
          };
          const observer = new MutationObserver(finish);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          const timer = setTimeout(finish, 250);
          requestAnimationFrame(finish);
        });
      }
      throw new Error('timed out waiting for ' + description + '; controls: ' + JSON.stringify(describe()));
    };
    const clickNamed = async (wanted) => {
      const target = await waitFor('control named ' + JSON.stringify(wanted), () => named(wanted));
      if (target.disabled) throw new Error('control named ' + JSON.stringify(wanted) + ' is disabled');
      target.click();
    };
    const clickNamedStarting = async (wanted) => {
      const target = await waitFor(
        'control whose name starts with ' + JSON.stringify(wanted),
        () => namedStarting(wanted),
      );
      if (target.disabled) {
        throw new Error('control whose name starts with ' + JSON.stringify(wanted) + ' is disabled');
      }
      target.click();
    };
    const errorText = () => {
      const live = document.querySelector('[data-session-phase="error"]');
      return live?.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
    };

    const projectionResponse = await fetch('/legacy-cube-2021-forge-ready-v1.json');
    if (!projectionResponse.ok) {
      throw new Error('Forge-ready projection returned HTTP ' + String(projectionResponse.status));
    }
    const projection = await projectionResponse.json();
    if (
      projection?.kind !== 'legacy-cube-forge-ready-pool' ||
      projection.cards !== 600 ||
      projection.cards !== projection.positions?.length ||
      projection.draft?.seats !== 8 ||
      projection.draft?.rounds !== 3 ||
      projection.draft?.packSize !== 15 ||
      projection.positions.some((position, index) => position !== index + 1)
    ) {
      throw new Error('Forge-ready projection is malformed or is not the complete 600-position eight-seat cube');
    }

    const catalogResponse = await fetch('/legacy-cube-2021-card-catalog-v1.json');
    if (!catalogResponse.ok) {
      throw new Error('Legacy Cube catalog returned HTTP ' + String(catalogResponse.status));
    }
    const catalog = await catalogResponse.json();
    const cubePhysicalIds = new Set(
      Array.isArray(catalog?.cards) ? catalog.cards.map((card) => card?.physicalId) : [],
    );
    if (
      catalog?.kind !== 'printed-card-catalog' ||
      catalog?.contentSha256 !== projection.catalogContentSha256 ||
      cubePhysicalIds.size !== projection.cards ||
      cubePhysicalIds.has(undefined)
    ) {
      throw new Error('Legacy Cube catalog does not match the Forge-ready projection');
    }
    const renderedCubePack = () =>
      Array.from(document.querySelectorAll('[role="group"][aria-label^="Draft pack "]')).find((pack) => {
        const physicalIds = Array.from(pack.querySelectorAll('[data-physical-id]')).map((node) =>
          node.getAttribute('data-physical-id'),
        );
        return physicalIds.length > 0 && physicalIds.every((physicalId) => cubePhysicalIds.has(physicalId));
      });

    await clickNamed('New draft');
    await waitFor('Forge-ready draft route', () => location.hash.includes('pool=forge-ready'));
    const route = new URLSearchParams(location.hash.split('?')[1] ?? '');
    route.set('cube', 'legacy-cube-2021-08');
    route.set('pool', 'forge-ready');
    route.set('seed', ${JSON.stringify(SMOKE_SEED)});
    route.set('picks', '');
    location.hash = '#/play/draft?' + route.toString();
    await waitFor('pinned Forge-ready draft route', () =>
      new URLSearchParams(location.hash.split('?')[1] ?? '').get('seed') === ${JSON.stringify(SMOKE_SEED)},
    );
    for (let pick = 1; pick <= 45; pick += 1) {
      const pack = await waitFor(
        'shared draft pack for pick ' + String(pick),
        renderedCubePack,
      );
      const choice = pack.querySelector('button');
      if (choice === null) throw new Error('shared draft pack for pick ' + String(pick) + ' has no card button');
      const choiceName = choice.querySelector('.mtg-card__name')?.textContent?.trim() ?? '';
      if (choiceName === '') {
        throw new Error('shared draft card for pick ' + String(pick) + ' has no visible title');
      }
      const beforeHash = location.hash;
      const beforePackLabel = pack.getAttribute('aria-label');
      choice.click();
      // The shared rail confirms with the physical card's complete printed
      // name. A modal double-faced card's visible front title is shorter (for
      // example, “Emeria's Call”), so the semantic locator follows the stable
      // action prefix instead of incorrectly requiring both surfaces to expose
      // the same title.
      await clickNamedStarting('Pick ');
      await waitFor(
        'draft transition after pick ' + String(pick),
        () => {
          const next = renderedCubePack();
          return location.hash !== beforeHash &&
            (next === undefined || next.getAttribute('aria-label') !== beforePackLabel);
        },
      );
    }

    const completedDraftHash = location.hash;
    location.hash = '#/play/draft?cube=legacy-cube-2021-08';
    await waitFor('draft chooser after leaving the completed draft', () => named('New draft'));
    location.hash = completedDraftHash;
    const status = await waitFor('legal deck count after reopening the saved draft URL', () => {
      const node = document.querySelector('[data-pane="deck"] .mtg-deck__pane-note');
      return (node?.textContent ?? '').includes('40 of 40 cards') ? node : null;
    });
    await waitFor('finished draft provenance after reopening its saved URL', () =>
      Array.from(document.querySelectorAll('.mtg-gamedetails dd')).find((node) =>
        (node.textContent ?? '').includes('Draft finished from 45 recorded picks'),
      ),
    );
    const resumedCompletedDraft = location.hash === completedDraftHash;
    const savedDraft = JSON.parse(localStorage.getItem('mtg.legacy-cube.session') ?? 'null');
    const savedDraftVersion = savedDraft?.version ?? 0;
    const savedDraftSourceCards = savedDraft?.source?.positions?.length ?? 0;
    if (
      savedDraftVersion !== ${JSON.stringify(LEGACY_CUBE_SESSION_VERSION)} ||
      savedDraftSourceCards !== projection.cards
    ) {
      throw new Error(
        'finished draft did not retain its verified source snapshot: ' +
        JSON.stringify({ savedDraftVersion, savedDraftSourceCards, projectionCards: projection.cards }),
      );
    }
    const start = await waitFor('enabled Play a new game', () => {
      const node = named('Play a new game');
      return node !== undefined && !node.disabled ? node : null;
    });
    const draftStatus = status.textContent?.trim() ?? '';
    if (!draftStatus.includes('40 of 40 cards')) {
      throw new Error('finished draft did not build a legal 40-card deck: ' + draftStatus);
    }
    const matchOpeningAt = performance.now();
    start.click();

    await waitFor(
      'Forge game table or explicit refusal',
      () => {
        const refusal = errorText();
        if (refusal !== '') throw new Error(refusal);
        const region = document.querySelector('[aria-label="Game table"]');
        return region !== null && region.querySelector('.mtg-board') !== null ? region : null;
      },
      120000,
    );
    const basicNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const playFrame = () => document.querySelector('[data-play-frame="shared"]');
    const legalMoves = () => playFrame()?.querySelector('[aria-label="Legal moves"]') ?? null;
    const phaseBandNode = () => document.querySelector('[aria-label="Phases and stops"]');
    const handSlots = () => Array.from(document.querySelectorAll(
      '.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="hand"][data-permanent-key]',
    ));
    const battlefieldSlots = () => Array.from(document.querySelectorAll(
      '.mtg-board__side[data-seat="you"] .mtg-slot[data-slot="play"][data-permanent-key]',
    ));
    const slotNamed = (slots, name) => slots.filter((slot) =>
      label(slot.querySelector('.mtg-card') ?? slot).startsWith(name + '.'),
    );
    const waitForDecisionTransition = async (before, index) => {
      await waitFor(
        'Forge response to move ' + String(index),
        () => {
          const refusal = errorText();
          if (refusal !== '') throw new Error(refusal);
          const phase = document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase');
          const moves = legalMoves();
          const band = phaseBandNode()?.textContent ?? '';
          const tally = Array.from(document.querySelectorAll('.mtg-play-meta')).map((node) =>
            (node.textContent ?? '').trim(),
          ).find((text) => text.endsWith(' choices made')) ?? '';
          return phase !== 'submitting' &&
            (phase === 'finished' || moves?.textContent !== before.moves || band !== before.band || tally !== before.tally);
        },
        120000,
      );
    };

    const decisionHeadline = (group) =>
      group?.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim();
    // The die roll is a decision the winner takes, never an automatic move
    // (packages/ui/src/routes/play/backend-auto-move.ts), so a won roll is
    // answered here the way a person answers it, and the opening hand follows.
    const firstDecision = await waitFor(
      'starting-seat or opening-hand decision after the match opened',
      () => {
        const refusal = errorText();
        if (refusal !== '') throw new Error(refusal);
        const group = legalMoves();
        const headline = decisionHeadline(group);
        return group !== null &&
          (headline === 'Opening hand' || headline === 'You won the die roll') &&
          group.querySelector('button:not(:disabled)') !== null
          ? group
          : null;
      },
      120000,
    );
    const dieRoll = decisionHeadline(firstDecision) === 'You won the die roll' ? 'won' : 'lost';
    if (dieRoll === 'won') {
      const playFirst = Array.from(firstDecision.querySelectorAll('button')).find((button) => label(button) === 'Play first');
      if (playFirst === undefined) throw new Error('the won die roll offers no Play first choice');
      playFirst.click();
    }
    const initialMoves = await waitFor(
      'ordinary opening-hand decision',
      () => {
        const refusal = errorText();
        if (refusal !== '') throw new Error(refusal);
        const group = legalMoves();
        return group !== null &&
          decisionHeadline(group) === 'Opening hand' &&
          group.querySelector('button:not(:disabled)') !== null
          ? group
          : null;
      },
      120000,
    );
    const initialLabels = Array.from(initialMoves.querySelectorAll('button')).map(label);
    const matchOpenMs = Math.round(performance.now() - matchOpeningAt);
    if (initialLabels.includes('Play first') || initialLabels.includes('Play second')) {
      throw new Error('the starting-seat choice is still offered on the opening-hand decision');
    }
    const gameDetails = named('Game details');
    if (gameDetails?.getAttribute('aria-expanded') !== 'true') {
      throw new Error('opening-hand decision was hidden behind the Game details control');
    }
    const openingPhaseBand = await waitFor('opening shared thirteen-step phase band', () => phaseBandNode(), 120000);
    const openingPhaseSteps = openingPhaseBand.querySelectorAll('[data-step]').length;
    const openingCurrentSteps = openingPhaseBand.querySelectorAll('[aria-current="step"]').length;
    const openingLegacyTurnBand = document.querySelector('[aria-label="Turn, phase, and priority"]') !== null;
    if (openingPhaseSteps !== 13 || openingCurrentSteps !== 0 || openingLegacyTurnBand) {
      throw new Error(
        'Forge opening decision did not use the ordinary neutral thirteen-step band: ' +
        JSON.stringify({ openingPhaseSteps, openingCurrentSteps, openingLegacyTurnBand }),
      );
    }
    window.__mtgLegacyCubeOpeningReady = true;
    await new Promise((resume) => {
      window.__mtgLegacyCubeResumeJourney = resume;
    });
    const prompt = initialMoves.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim() ?? '';
    const transitions = [];
    let playedBasic = null;
    let submittedMove = '';
    let humanPlaysFirst = false;
    let firstTurnLabel = '';
    for (let index = 1; index <= 50 && playedBasic === null; index += 1) {
      const moves = await waitForLegacyCubeDecision(
        waitFor,
        () => {
          const refusal = errorText();
          if (refusal !== '') throw new Error(refusal);
          return legalMoves();
        },
        () => named('Continue'),
        'enabled legal move ' + String(index),
        120000,
      );
      const moveButtons = Array.from(moves.querySelectorAll('button:not(:disabled)'));
      const moveLabels = moveButtons.map(label);
      const basic = basicNames.map((name) => {
        const panelMove = moveButtons.find((button) => label(button).startsWith('Play ' + name));
        const matchingSlots = slotNamed(handSlots(), name);
        const cardButton = matchingSlots.length === 1
          ? matchingSlots[0].querySelector(':scope > button.mtg-card')
          : null;
        return panelMove === undefined || cardButton === null
          ? null
          : { name, panelMove, slot: matchingSlots[0], cardButton };
      }).find((candidate) => candidate !== null);
      const before = {
        moves: moves.textContent ?? '',
        band: phaseBandNode()?.textContent ?? '',
        tally: Array.from(document.querySelectorAll('.mtg-play-meta')).map((node) =>
          (node.textContent ?? '').trim(),
        ).find((text) => text.endsWith(' choices made')) ?? '',
      };

      if (basic !== undefined && basic !== null) {
        const oid = basic.slot.getAttribute('data-permanent-key') ?? '';
        const image = basic.slot.querySelector(
          '.mtg-card[data-presentation="printed-card"] [data-region="art"][data-art-state="ready"] img',
        );
        const artSrc = image?.getAttribute('src') ?? '';
        if (
          oid === '' ||
          artSrc === '' ||
          !artSrc.includes('cards.scryfall.io') ||
          !artSrc.includes('/art_crop/')
        ) {
          throw new Error('playable ' + basic.name + ' did not carry official illustration-crop art');
        }
        await waitFor(
          basic.name + ' illustration load',
          () => image.complete && image.naturalWidth > 0,
          30000,
        );
        submittedMove = label(basic.panelMove);
        transitions.push('board: ' + submittedMove);
        basic.cardButton.click();
        await waitForDecisionTransition(before, index);
        const landed = await waitFor(
          basic.name + ' on the battlefield',
          () => {
            const exact = battlefieldSlots().find((slot) => slot.getAttribute('data-permanent-key') === oid);
            if (exact !== undefined) return exact;
            const stillHeld = handSlots().some((slot) => slot.getAttribute('data-permanent-key') === oid);
            const sameName = slotNamed(battlefieldSlots(), basic.name);
            return !stillHeld && sameName.length > 0 ? sameName[sameName.length - 1] : null;
          },
          30000,
        );
        const landedImage = landed.querySelector(
          '.mtg-card[data-presentation="printed-card"] [data-region="art"][data-art-state="ready"] img',
        );
        await waitFor(
          basic.name + ' battlefield illustration load',
          () => landedImage !== null && landedImage.complete && landedImage.naturalWidth > 0,
          30000,
        );
        const landedCard = landed.querySelector('.mtg-card');
        const manaOverlay = landed.querySelector('.mtg-card__mana');
        const manaSymbol = manaOverlay?.querySelector('[data-symbol]')?.getAttribute('data-symbol') ?? '';
        const expectedMana = {
          Plains: '{W}',
          Island: '{U}',
          Swamp: '{B}',
          Mountain: '{R}',
          Forest: '{G}',
        }[basic.name] ?? '';
        const cardBounds = landedCard?.getBoundingClientRect();
        const manaBounds = manaOverlay?.getBoundingClientRect();
        const manaInUpperRight = cardBounds !== undefined && manaBounds !== undefined &&
          manaBounds.top < cardBounds.top + cardBounds.height / 2 &&
          manaBounds.left > cardBounds.left + cardBounds.width / 2 &&
          manaBounds.top >= cardBounds.top &&
          manaBounds.right <= cardBounds.right;
        if (manaSymbol !== expectedMana || !manaInUpperRight) {
          throw new Error(
            basic.name + ' did not show its ' + expectedMana + ' symbol in the upper-right: ' +
            JSON.stringify({ manaSymbol, manaInUpperRight }),
          );
        }
        playedBasic = {
          name: basic.name,
          oid,
          artSrc,
          manaSymbol,
          manaInUpperRight,
          imageLoaded: true,
          reachedBattlefield: true,
          inLandRow: landed.closest('.mtg-lands') !== null && landed.closest('.mtg-board__spells') === null,
        };
        if (!playedBasic.inLandRow) {
          throw new Error(basic.name + ' reached the battlefield outside the ordinary land row');
        }
        break;
      }

      const duplicateBasic = basicNames
        .map((name) => moveButtons.find((button) => label(button).startsWith('Play ' + name)))
        .find((button) => button !== undefined);
      const preferred = [
        'Keep this hand',
        'Pass priority',
        'Done',
        'Confirm',
      ].map((wanted) => moveButtons.find((button) => label(button) === wanted)).find((button) => button !== undefined);
      const fixedPass = named('Pass');
      const availableFixedPass = fixedPass !== undefined && !fixedPass.disabled ? fixedPass : undefined;
      const fallback = moveButtons.find((button) => !label(button).startsWith('Concede'));
      // The shared play surface deliberately keeps priority pass outside the
      // legal-move rail. Prefer that universal control before an arbitrary
      // spell, or the smoke can cast an instant during the bot's turn and loop
      // through a target/payment cancellation instead of reaching our main.
      const move = duplicateBasic ?? availableFixedPass ?? preferred ?? fallback;
      if (move === undefined) {
        throw new Error('Forge decision offered only concession before a basic land became playable');
      }
      transitions.push('panel: ' + label(move));
      const submittedLabel = label(move);
      move.click();
      await waitForDecisionTransition(before, index);
      if (submittedLabel === 'Keep this hand') {
        const localTurn = await waitFor(
          'human-owned first turn after keeping the opening hand',
          () => {
            const opponentActive = document.querySelector(
              '.mtg-board__side[data-seat="opponent"][data-active="true"]',
            );
            const turn = document.querySelector('.mtg-turnstops__head')?.textContent?.trim() ?? '';
            if (opponentActive !== null && turn.startsWith('Turn 1:')) {
              throw new Error('Forge bot became active on turn one after the local Play first move: ' + turn);
            }
            const localActive = document.querySelector(
              '.mtg-board__side[data-seat="you"][data-active="true"]',
            );
            return localActive !== null && turn === 'Turn 1: You' ? turn : null;
          },
          120000,
        );
        humanPlaysFirst = true;
        firstTurnLabel = localTurn;
      }
    }
    if (playedBasic === null) {
      throw new Error('no basic land became directly playable from the shared hand in 50 decisions');
    }
    const phaseBand = await waitFor('shared thirteen-step phase band', () => phaseBandNode(), 120000);
    const phaseSteps = phaseBand.querySelectorAll('[data-step]').length;
    if (phaseSteps !== 13 || phaseBand.querySelector('[aria-current="step"]') === null) {
      throw new Error('shared phase band did not expose thirteen steps and one current step');
    }
    const manaSource = await waitFor('played basic mana action', () => {
      const slot = battlefieldSlots().find(
        (candidate) => candidate.getAttribute('data-permanent-key') === playedBasic.oid,
      );
      const card = slot?.querySelector(':scope > button.mtg-card');
      return slot !== undefined && card !== null ? { slot, card } : null;
    }, 120000);
    manaSource.card.click();
    const expectedPoolPip = {
      Plains: 'w',
      Island: 'u',
      Swamp: 'b',
      Mountain: 'r',
      Forest: 'g',
    }[playedBasic.name] ?? '';
    const pooledMana = await waitFor('manual basic-land mana in the shared player status', () => {
      const slot = battlefieldSlots().find(
        (candidate) => candidate.getAttribute('data-permanent-key') === playedBasic.oid,
      );
      const pool = document.querySelector(
        '.mtg-board__side[data-seat="you"] [aria-label="Mana pool: 1 floating"]',
      );
      return slot?.getAttribute('data-tapped') === 'true' &&
        pool?.querySelector('[data-pip="' + expectedPoolPip + '"]') !== null
        ? { slot, pool }
        : null;
    }, 120000);
    const takeBack = await waitFor('shared mana take-back control', () => {
      const control = named('Take back');
      return control !== undefined && !control.disabled ? control : null;
    }, 120000);
    const manaWasTapped = pooledMana.slot.getAttribute('data-tapped') === 'true';
    transitions.push('board: Add ' + playedBasic.manaSymbol);
    takeBack.click();
    await waitFor('manual mana take-back to restore the land and pool', () => {
      const slot = battlefieldSlots().find(
        (candidate) => candidate.getAttribute('data-permanent-key') === playedBasic.oid,
      );
      const pool = document.querySelector(
        '.mtg-board__side[data-seat="you"] [aria-label^="Mana pool:"]',
      );
      return slot?.getAttribute('data-tapped') === 'false' && pool === null ? slot : null;
    }, 120000);
    transitions.push('fixed: Take back');
    const manualMana = {
      source: playedBasic.name,
      symbol: playedBasic.manaSymbol,
      tapped: manaWasTapped,
      pooled: true,
      undoVisible: true,
      restored: true,
    };
    const fixedPassControl = await waitFor('fixed enabled Pass control', () => {
      const node = named('Pass');
      return node !== undefined && !node.disabled ? node : null;
    }, 120000);
    fixedPassControl.click();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await waitFor(
      'settled position after the fixed Pass control',
      () => document.querySelector('[data-session-phase]')?.getAttribute('data-session-phase') !== 'submitting',
      120000,
    );
    transitions.push('fixed: Pass');
    const finalTable = document.querySelector('[aria-label="Game table"]');
    const nextMoves = legalMoves();
    const sharedBoard = finalTable !== null && finalTable.querySelector('.mtg-board') !== null;
    const sharedPlayFrame = playFrame() !== null;
    const contextRail = document.querySelector('section[aria-label="Game context"]');
    const sharedContextRail = contextRail !== null &&
      ['Stack', 'Info', 'Log'].every((name) =>
        Array.from(contextRail.querySelectorAll('button')).some((button) => label(button).startsWith(name)),
      );
    const sharedHandSeam = document.querySelector(
      '[role="separator"][aria-label^="Resize the table and "][aria-label$=" hand"]',
    ) !== null;
    const choiceTally = Array.from(document.querySelectorAll('.mtg-play-meta')).map((node) =>
      (node.textContent ?? '').trim(),
    ).find((text) => text.endsWith(' choices made')) ?? '';
    const legacyWrapper = document.querySelector('[role="region"][aria-label="Forge match"]');
    const framedOfficialCards = finalTable?.querySelectorAll(
      '.mtg-card[data-presentation="printed-card"]:has([data-region="title"]):has([data-region="art"]):has([data-region="type"])',
    ).length ?? 0;
    const wholeCardImages = finalTable?.querySelectorAll(
      '.mtg-printed-card-image, img[src*="/normal/"], img[src*="/large/"], img[src*="/png/"]',
    ).length ?? 0;
    if (
      !sharedBoard ||
      !sharedPlayFrame ||
      !sharedContextRail ||
      !sharedHandSeam ||
      choiceTally === '' ||
      legacyWrapper !== null ||
      framedOfficialCards === 0 ||
      wholeCardImages !== 0
    ) {
      throw new Error(
        'Legacy Cube did not finish its first move in the complete shared play surface: ' +
        JSON.stringify({
          sharedBoard,
          sharedPlayFrame,
          sharedContextRail,
          sharedHandSeam,
          choiceTally,
          legacyWrapper: legacyWrapper !== null,
          framedOfficialCards,
          wholeCardImages,
        }),
      );
    }
    return {
      acceptedProjection: {
        cards: projection.cards,
        seats: projection.draft.seats,
        rounds: projection.draft.rounds,
        packSize: projection.draft.packSize,
        contentSha256: projection.contentSha256,
        catalogContentSha256: projection.catalogContentSha256,
        decisionLedgerContentSha256: projection.decisionLedgerContentSha256,
        decisionLedgerFileSha256: projection.decisionLedgerFileSha256,
      },
      draftStatus,
      deckStatus: status.textContent?.trim() ?? '',
      resumedCompletedDraft,
      savedDraftVersion,
      savedDraftSourceCards,
      firstPrompt: prompt,
      matchOpenMs,
      humanPlaysFirst,
      firstTurnLabel,
      openingPhaseSteps,
      openingCurrentSteps,
      openingLegacyTurnBand,
      submittedMove,
      transitions,
      nextPrompt:
        nextMoves?.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim() ?? '',
      phaseBand: phaseBandNode()?.textContent?.trim() ?? '',
      phaseSteps,
      manualMana,
      fixedPass: fixedPassControl !== null,
      fixedPassSubmitted: true,
      playedBasic,
      sharedBoard,
      sharedPlayFrame,
      sharedContextRail,
      sharedHandSeam,
      choiceTally,
      framedOfficialCards,
      wholeCardImages,
      hash: location.hash,
      closed: false,
    };
    } catch (error) {
      window.__mtgLegacyCubeJourneyFailure = error?.stack ?? String(error);
      throw error;
    }
  })()`;
}

async function recordedEvent(
  recording: CdpRecording,
  predicate: (event: CdpEvent) => boolean,
  description: string,
  timeoutMs: number,
): Promise<CdpEvent> {
  const deadline = Date.now() + timeoutMs;
  let inspected = 0;
  while (Date.now() < deadline) {
    while (inspected < recording.events.length) {
      const event = recording.events[inspected];
      inspected += 1;
      if (event !== undefined && predicate(event)) return event;
    }
    const remaining = deadline - Date.now();
    try {
      await recording.next(Math.min(remaining, 1_000));
    } catch (error) {
      if (!reason(error).startsWith('no CDP ')) throw error;
    }
  }
  throw new Error(`no ${description} within ${String(timeoutMs)}ms`);
}

async function waitForGatewayLifecycle(
  recording: CdpRecording,
  minimumOpens: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let problem = gatewayLifecycleProblem(gatewayResponsesOf(recording.events), minimumOpens);
  while (problem !== null && Date.now() < deadline) {
    try {
      await recording.next(Math.min(1_000, deadline - Date.now()));
    } catch (error) {
      if (!reason(error).startsWith('no CDP ')) throw error;
    }
    problem = gatewayLifecycleProblem(gatewayResponsesOf(recording.events), minimumOpens);
  }
  if (problem !== null) throw new Error(problem);
}

async function capturePage(
  client: CdpClient,
  sessionId: string,
  directory: string,
  basename: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const screenshot = await client.call(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    sessionId,
    15_000,
  );
  await writeFile(join(directory, `${basename}.png`), Buffer.from(String(screenshot['data']), 'base64'));
  const html = await client.call(
    'Runtime.evaluate',
    { expression: 'document.documentElement.outerHTML', returnByValue: true },
    sessionId,
  );
  const result = html['result'] as { value?: unknown } | undefined;
  await writeFile(join(directory, `${basename}.html`), String(result?.value ?? ''));
}

async function waitForOpeningCheckpoint(
  client: CdpClient,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evaluated = await client.call(
      'Runtime.evaluate',
      {
        expression: `({
          ready: window.__mtgLegacyCubeOpeningReady === true,
          failure: window.__mtgLegacyCubeJourneyFailure ?? null,
        })`,
        returnByValue: true,
      },
      sessionId,
      15_000,
    );
    const result = evaluated['result'] as
      { value?: { readonly ready?: boolean; readonly failure?: unknown } } | undefined;
    if (result?.value?.failure !== null && result?.value?.failure !== undefined) {
      throw new Error(String(result.value.failure));
    }
    if (result?.value?.ready === true) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`no Forge opening screenshot checkpoint within ${String(timeoutMs)}ms`);
}

async function resumeJourney(client: CdpClient, sessionId: string): Promise<void> {
  await client.call(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const resume = window.__mtgLegacyCubeResumeJourney;
        window.__mtgLegacyCubeResumeJourney = undefined;
        resume?.();
      })()`,
    },
    sessionId,
    15_000,
  );
}

async function closeOpenMatch(client: CdpClient, sessionId: string): Promise<boolean> {
  const closing = client.record('Network.requestWillBeSent', 'Network.responseReceived');
  try {
    const pressed = await client.call(
      'Runtime.evaluate',
      {
        expression: `(() => {
        const button = Array.from(document.querySelectorAll('button')).find((node) =>
          (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === 'Back to draft deckbuilding',
        );
        button?.click();
        return button !== undefined;
      })()`,
        returnByValue: true,
      },
      sessionId,
    );
    const result = pressed['result'] as { value?: unknown } | undefined;
    if (result?.value !== true) return false;
    const request = await recordedEvent(
      closing,
      (event) => {
        if (event.method !== 'Network.requestWillBeSent') return false;
        const fields = event.params['request'];
        if (typeof fields !== 'object' || fields === null) return false;
        const requestFields = fields as Record<string, unknown>;
        return (
          requestFields['method'] === 'DELETE' &&
          typeof requestFields['url'] === 'string' &&
          requestFields['url'].includes('/engine-api/sessions/')
        );
      },
      'Forge session DELETE request',
      75_000,
    );
    const requestId = request.params['requestId'];
    if (typeof requestId !== 'string') throw new Error('Forge session DELETE has no CDP request id');
    const response = await recordedEvent(
      closing,
      (event) => event.method === 'Network.responseReceived' && event.params['requestId'] === requestId,
      'Forge session DELETE response',
      75_000,
    );
    const responseFields = response.params['response'];
    if (typeof responseFields !== 'object' || responseFields === null) {
      throw new Error('Forge session DELETE response has no HTTP fields');
    }
    const status = (responseFields as Record<string, unknown>)['status'];
    if (typeof status !== 'number' || status < 200 || status >= 300) {
      throw new Error(`Forge session DELETE returned HTTP ${String(status)}`);
    }
    return true;
  } finally {
    closing.stop();
  }
}

/** Hard-reload the completed draft, then launch its persisted deck in a new Forge session. */
async function reloadAndLaunchSavedDeck(
  client: CdpClient,
  sessionId: string,
): Promise<ReloadedSavedDeckEvidence> {
  const before = await client.call(
    'Runtime.evaluate',
    { expression: 'location.hash', returnByValue: true },
    sessionId,
  );
  const expectedHash = String((before['result'] as { value?: unknown } | undefined)?.value ?? '');
  if (expectedHash === '') throw new Error('completed draft has no route hash before reload');

  const page = client.record('Page.loadEventFired');
  try {
    const loaded = page.next(15_000);
    await client.call('Page.reload', {}, sessionId, 15_000);
    await loaded;
  } finally {
    page.stop();
  }

  const evaluated = await client.call(
    'Runtime.evaluate',
    {
      expression: `(async () => {
        const label = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
        const named = (wanted) => Array.from(
          document.querySelectorAll('button, a, [role="button"]'),
        ).find((node) => label(node) === wanted);
        const errorText = () => document.querySelector(
          '[data-session-phase="error"] [role="alert"]',
        )?.textContent?.trim() ?? '';
        const waitFor = async (description, predicate, milliseconds = 120000) => {
          const deadline = Date.now() + milliseconds;
          while (Date.now() < deadline) {
            const refusal = errorText();
            if (refusal !== '') throw new Error(refusal);
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error('timed out waiting for ' + description);
        };

        const status = await waitFor('persisted legal deck after hard reload', () => {
          const node = document.querySelector('[data-pane="deck"] .mtg-deck__pane-note');
          return (node?.textContent ?? '').includes('40 of 40 cards') ? node : null;
        });
        const saved = JSON.parse(localStorage.getItem('mtg.legacy-cube.session') ?? 'null');
        if (saved?.version !== ${JSON.stringify(LEGACY_CUBE_SESSION_VERSION)}) {
          throw new Error(
            'hard reload did not retain Legacy Cube saved-draft schema v' +
            ${JSON.stringify(LEGACY_CUBE_SESSION_VERSION)},
          );
        }
        const start = await waitFor('enabled persisted-deck Forge launch', () => {
          const node = named('Play a new game');
          return node !== undefined && !node.disabled ? node : null;
        });
        const matchOpeningAt = performance.now();
        start.click();
        const table = await waitFor('shared table from persisted-deck launch', () => {
          const node = document.querySelector('[aria-label="Game table"]');
          return node !== null && node.querySelector('.mtg-board') !== null ? node : null;
        });
        const frame = await waitFor('shared play frame from persisted-deck launch', () =>
          document.querySelector('[data-play-frame="shared"]'),
        );
        const band = await waitFor('shared phase band from persisted-deck launch', () =>
          document.querySelector('[aria-label="Phases and stops"]'),
        );
        const persistedHeadline = (node) =>
          node?.closest('.mtg-panel')?.querySelector('.mtg-panel__title')?.textContent?.trim();
        const firstPersistedDecision = await waitFor('first persisted-deck legal decision', () => {
          const node = frame.querySelector('[aria-label="Legal moves"]');
          const headline = persistedHeadline(node);
          return node !== null &&
            (headline === 'Opening hand' || headline === 'You won the die roll') &&
            node.querySelector('button:not(:disabled)') !== null
            ? node
            : null;
        });
        if (persistedHeadline(firstPersistedDecision) === 'You won the die roll') {
          const playFirst = Array.from(firstPersistedDecision.querySelectorAll('button')).find(
            (button) => label(button) === 'Play first',
          );
          if (playFirst === undefined) throw new Error('the won die roll offers no Play first choice');
          playFirst.click();
        }
        const moves = await waitFor('persisted-deck opening-hand decision', () => {
          const node = frame.querySelector('[aria-label="Legal moves"]');
          return node !== null &&
            persistedHeadline(node) === 'Opening hand' &&
            node.querySelector('button:not(:disabled)') !== null
            ? node
            : null;
        });
        const matchOpenMs = Math.round(performance.now() - matchOpeningAt);
        const phaseSteps = band.querySelectorAll('[data-step]').length;
        const legacyTurnBand = document.querySelector(
          '[aria-label="Turn, phase, and priority"]',
        ) !== null;
        if (phaseSteps !== 13 || legacyTurnBand) {
          throw new Error('persisted deck did not launch in the ordinary thirteen-step play surface');
        }
        return {
          hash: location.hash,
          exactHash: location.hash === ${JSON.stringify(expectedHash)},
          savedDraftVersion: saved.version,
          deckStatus: status.textContent?.trim() ?? '',
          firstPrompt: moves.closest('.mtg-panel')?.querySelector(
            '.mtg-panel__title',
          )?.textContent?.trim() ?? '',
          matchOpenMs,
          sharedBoard: table.querySelector('.mtg-board') !== null,
          sharedPlayFrame: frame !== null,
          phaseSteps,
          legacyTurnBand,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
    180_000,
  );
  if (evaluated['exceptionDetails'] !== undefined) {
    const details = evaluated['exceptionDetails'] as {
      exception?: { description?: string };
      text?: string;
    };
    throw new Error(details.exception?.description ?? details.text ?? 'persisted-deck relaunch failed');
  }
  const evidence = (evaluated['result'] as { value?: unknown } | undefined)?.value as
    ReloadedSavedDeckEvidence | undefined;
  if (evidence === undefined || !evidence.exactHash) {
    throw new Error('hard reload changed the completed saved-draft route');
  }
  return evidence;
}

async function run(
  client: CdpClient,
  url: string,
): Promise<{
  readonly evidence: JourneyEvidence;
  readonly gateway: readonly GatewayResponse[];
}> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  const network = client.record('Network.requestWillBeSent', 'Network.responseReceived');
  const page = client.record('Page.loadEventFired');
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call('Network.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    const loaded = page.next(15_000);
    const navigation = await client.call('Page.navigate', { url }, sessionId, 15_000);
    if (navigation['errorText'] !== undefined) {
      throw new Error(`could not load ${url}: ${String(navigation['errorText'])}`);
    }
    await loaded;
    const journey = client.call(
      'Runtime.evaluate',
      { expression: journeyExpression(), awaitPromise: true, returnByValue: true },
      sessionId,
      JOURNEY_TIMEOUT_MS,
    );
    await waitForOpeningCheckpoint(client, sessionId, 180_000);
    await capturePage(client, sessionId, currentArtifacts, 'opening-shared-play-surface');
    await resumeJourney(client, sessionId);
    const result = await journey;
    if (result['exceptionDetails'] !== undefined) {
      const details = result['exceptionDetails'] as {
        exception?: { description?: string };
        text?: string;
      };
      throw new Error(details.exception?.description ?? details.text ?? 'browser journey failed');
    }
    const evaluated = result['result'] as { value?: unknown } | undefined;
    const evidence = evaluated?.value as InitialJourneyEvidence;
    await capturePage(client, sessionId, currentArtifacts, 'shared-play-surface');
    if (!(await closeOpenMatch(client, sessionId))) {
      throw new Error('live Legacy Cube match exposed no Back to draft deckbuilding control');
    }
    const reloadedSavedDeck = await reloadAndLaunchSavedDeck(client, sessionId);
    await capturePage(client, sessionId, currentArtifacts, 'reloaded-saved-deck-play-surface');
    if (!(await closeOpenMatch(client, sessionId))) {
      throw new Error('reloaded saved-deck match exposed no Back to draft deckbuilding control');
    }
    // A development StrictMode mount opens a discarded session and its live
    // replacement. The discarded session can finish opening after the visible
    // match has already closed, so wait for every observed capability to be
    // released instead of accepting whichever DELETE happened to arrive first.
    await waitForGatewayLifecycle(network, 2, 75_000);
    return {
      evidence: { ...evidence, reloadedSavedDeck, closed: true },
      gateway: gatewayResponsesOf(network.events),
    };
  } catch (error) {
    if (sessionId !== null) {
      await resumeJourney(client, sessionId).catch(() => undefined);
      const diagnostic = currentArtifacts;
      await capturePage(client, sessionId, diagnostic, 'failure').catch((captureError: unknown) => {
        console.error(`could not capture browser diagnostics: ${reason(captureError)}`);
      });
      await closeOpenMatch(client, sessionId).catch((closeError: unknown) => {
        console.error(`could not close failed browser match: ${reason(closeError)}`);
      });
      console.error(`browser diagnostics: ${diagnostic}`);
    }
    throw error;
  } finally {
    page.stop();
    network.stop();
    await cleanupTarget(client, targetId, sessionId).catch(() => undefined);
  }
}

let currentArtifacts = '';

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    process.exitCode = 1;
    return;
  }
  if (!browserPresent) {
    console.error(`no chrome-headless-shell at ${chromePath}`);
    process.exitCode = 1;
    return;
  }
  const temporaryArtifacts = args.artifacts === null;
  currentArtifacts = args.artifacts ?? (await mkdtemp(join(tmpdir(), 'mtg-legacy-cube-smoke-')));
  const profile = await mkdtemp(join(tmpdir(), 'mtg-legacy-cube-chrome-'));
  const chrome = await launchChrome(profile);
  let passed = false;
  try {
    const result = await run(chrome.client, args.url);
    const lifecycleProblem = gatewayLifecycleProblem(result.gateway, 2);
    if (lifecycleProblem !== null) throw new Error(lifecycleProblem);
    const successfulOpens = result.gateway.filter(
      (entry) =>
        entry.status >= 200 &&
        entry.status < 300 &&
        entry.method === 'POST' &&
        new URL(entry.url).pathname === '/engine-api/sessions',
    ).length;
    if (successfulOpens !== 2) {
      throw new Error(
        `two visible saved-deck launches opened ${String(successfulOpens)} Forge sessions instead of exactly two`,
      );
    }
    if (args.maximumMatchOpenMs !== null) {
      const timingProblem = matchOpeningBudgetProblem(
        result.evidence.matchOpenMs,
        result.evidence.reloadedSavedDeck.matchOpenMs,
        args.maximumMatchOpenMs,
      );
      if (timingProblem !== null) throw new Error(timingProblem);
    }
    passed = true;
    console.log(
      JSON.stringify(
        {
          ok: true,
          url: args.url,
          browser: chromePath,
          maximumMatchOpenMs: args.maximumMatchOpenMs,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await shutdownChrome(chrome).catch((error: unknown) => {
      console.error(`Chrome cleanup failed: ${reason(error)}`);
      process.exitCode = 1;
    });
    await rm(profile, { recursive: true, force: true });
    if (passed && temporaryArtifacts) {
      await rm(currentArtifacts, { recursive: true, force: true });
    }
  }
}

await main().catch((error: unknown) => {
  console.error(`Legacy Cube live smoke failed: ${reason(error)}`);
  process.exitCode = 1;
});
