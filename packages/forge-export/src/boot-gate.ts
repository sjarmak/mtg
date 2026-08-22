/**
 * The conformance boot gate.
 *
 * Standing check the thin slice runs over every generated set: transpile it,
 * hand it to a real Forge, and confirm that (a) every card loads and (b) a
 * game of it actually plays. It is the second, 15-year-hardened opinion on the
 * co-design invariant — a card our DSL claims to enforce but Forge refuses to
 * load is a divergence worth failing a build over.
 *
 * Degradation is explicit. When Forge is absent, or the environment cannot
 * start it, the gate returns `skipped` with the reason spelled out. It never
 * returns `passed` for a check it did not run.
 */
import type { Card } from '@mtg/dsl';
import type { ForgeDeck } from './deck';
import { coverageDecks } from './deck';
import type { ForgeEditionOptions } from './edition';
import type { ForgeInstall, ForgeInstallOptions } from './install';
import { ensureForgeProfile, findForgeInstall, forgeMissingReason } from './install';
import type { TranspileRejection } from './rejection';
import { rejection } from './rejection';
import { runForge } from './run';
import {
  describeStartupFailure,
  diagnoseStartupFailure,
  parseSimOutput,
  problemCardNames,
} from './sim-output';
import { transpileSet } from './transpile';
import { writeDecks, writeForgeSet } from './write-set';

export type BootGateStatus = 'passed' | 'failed' | 'skipped';

export interface BootGameReport {
  readonly deckA: string;
  readonly deckB: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly gamesPlayed: number;
  readonly outcomes: readonly string[];
  /**
   * Loose card files Forge said it read, our set's among them; `null` when it
   * printed no such line. Evidence that a card database was actually loaded,
   * not a count of the set (see `SimOutput.cardFilesRead`).
   */
  readonly cardFilesRead: number | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface BootGateResult {
  readonly status: BootGateStatus;
  /** Why the gate skipped or failed; empty when it passed. */
  readonly reason: string;
  readonly setCode: string;
  readonly cardCount: number;
  /** Constructs with no Forge mapping; non-empty means `failed`. */
  readonly rejections: readonly TranspileRejection[];
  /** Set cards Forge complained about while loading. */
  readonly problemCards: readonly string[];
  /** Every Forge invocation, verbatim, so a failure is reproducible by hand. */
  readonly commands: readonly string[];
  readonly games: readonly BootGameReport[];
  readonly forgeVersion: string | null;
  readonly durationMs: number;
}

export interface BootGateOptions extends ForgeInstallOptions {
  /** Edition metadata; defaults to a dated `Custom` edition named after the set. */
  readonly edition?: Partial<ForgeEditionOptions>;
  /** Games per deck pairing. One is enough to prove a set boots and plays. */
  readonly gamesPerPair?: number;
  /** Wall clock per Forge invocation. */
  readonly timeoutMs?: number;
  /** Environment for the JVM; `DISPLAY` must reach an X server. */
  readonly env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Transpiles `cards`, boots them in Forge, and plays a smoke game.
 *
 * Resolution order matters: transpile rejections fail the gate *before* Forge
 * is consulted, because an unmappable construct is a defect in the set
 * whether or not an engine is installed.
 */
export async function bootGate(
  cards: readonly Card[],
  options: BootGateOptions = {},
): Promise<BootGateResult> {
  const started = Date.now();
  const setCode = cards[0]?.set.code ?? '';
  const base = {
    setCode,
    cardCount: cards.length,
    problemCards: [] as readonly string[],
    commands: [] as readonly string[],
    games: [] as readonly BootGameReport[],
  };

  if (cards.length === 0) {
    return {
      ...base,
      status: 'failed',
      reason: 'the card list is empty; there is nothing to boot',
      rejections: [rejection('DSL_VIOLATION', '', '', 'empty card list')],
      forgeVersion: null,
      durationMs: Date.now() - started,
    };
  }

  const exported = transpileSet(cards, editionOptions(setCode, options));
  if (!exported.ok) {
    return {
      ...base,
      status: 'failed',
      reason: `${exported.rejections.length} construct(s) have no Forge mapping`,
      rejections: exported.rejections,
      forgeVersion: null,
      durationMs: Date.now() - started,
    };
  }

  const install = findForgeInstall(options);
  if (install === null) {
    return {
      ...base,
      status: 'skipped',
      reason: `Forge is not installed: ${forgeMissingReason(options)}`,
      rejections: [],
      forgeVersion: null,
      durationMs: Date.now() - started,
    };
  }

  ensureForgeProfile(install);
  writeForgeSet(install.customDir, exported.value);

  const decks = coverageDecks(cards, `bootgate-${setCode.toLowerCase()}`);
  if (decks.length === 0) {
    return {
      ...base,
      status: 'failed',
      reason: 'the set has no castable cards, so no deck can be built to boot it',
      rejections: [],
      forgeVersion: install.version,
      durationMs: Date.now() - started,
    };
  }
  writeDecks(install.decksDir, decks);

  const report = await playPairs(install, decks, cards, options);
  return {
    ...base,
    ...report,
    setCode,
    cardCount: cards.length,
    rejections: [],
    forgeVersion: install.version,
    durationMs: Date.now() - started,
  };
}

function editionOptions(setCode: string, options: BootGateOptions): ForgeEditionOptions {
  const edition = options.edition ?? {};
  return {
    name: edition.name ?? `${setCode} boot gate`,
    date: edition.date ?? new Date().toISOString().slice(0, 10),
    ...(edition.type === undefined ? {} : { type: edition.type }),
    ...(edition.booster === undefined ? {} : { booster: edition.booster }),
    ...(edition.creatureTypes === undefined ? {} : { creatureTypes: edition.creatureTypes }),
  };
}

interface PlayReport {
  readonly status: BootGateStatus;
  readonly reason: string;
  readonly problemCards: readonly string[];
  readonly commands: readonly string[];
  readonly games: readonly BootGameReport[];
}

/** Plays each consecutive deck pair, so every card in the set reaches a game. */
async function playPairs(
  install: ForgeInstall,
  decks: readonly ForgeDeck[],
  cards: readonly Card[],
  options: BootGateOptions,
): Promise<PlayReport> {
  const cardNames = new Set(cards.map((card) => card.name));
  const games: BootGameReport[] = [];
  const commands: string[] = [];
  const problems = new Set<string>();

  for (let index = 0; index + 1 < Math.max(decks.length, 2); index += 2) {
    const deckA = decks[index];
    const deckB = decks[index + 1] ?? decks[0];
    if (deckA === undefined || deckB === undefined) continue;

    const args = [
      'sim',
      '-D',
      install.decksDir,
      '-d',
      `${deckA.name}.dck`,
      `${deckB.name}.dck`,
      '-n',
      String(options.gamesPerPair ?? 1),
    ];
    const result = await runForge({
      jar: install.jar,
      args,
      cwd: install.home,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    commands.push(result.command);

    // A process that died before saying anything cannot be read as a verdict on
    // the cards either way, so it skips. The reason claims only what was
    // actually observed, and the display the *child* was handed is part of
    // that: `env` replaces `process.env` outright when a caller passes one, so
    // reading this process's DISPLAY would diagnose the wrong environment.
    const startupFailure = diagnoseStartupFailure(result, (options.env ?? process.env)['DISPLAY']);
    if (startupFailure !== null) {
      return {
        status: 'skipped',
        reason: describeStartupFailure(startupFailure),
        problemCards: [],
        commands,
        games,
      };
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    for (const name of problemCardNames(combined)) {
      if (cardNames.has(name)) problems.add(name);
    }
    const parsed = parseSimOutput(combined);
    games.push({
      deckA: deckA.name,
      deckB: deckB.name,
      command: result.command,
      exitCode: result.exitCode,
      gamesPlayed: parsed.games.length,
      outcomes: parsed.games.map((game) => game.outcome),
      cardFilesRead: parsed.cardFilesRead,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    });

    if (result.timedOut) {
      return {
        status: 'failed',
        reason: `Forge exceeded its ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms budget on ${deckA.name} vs ${deckB.name}`,
        problemCards: [...problems],
        commands,
        games,
      };
    }
    if (result.exitCode !== 0) {
      return {
        status: 'failed',
        reason: `Forge exited ${String(result.exitCode)} on ${deckA.name} vs ${deckB.name}: ${lastLines(combined)}`,
        problemCards: [...problems],
        commands,
        games,
      };
    }
    if (parsed.games.length === 0) {
      return {
        status: 'failed',
        reason: `Forge ran but reported no completed game for ${deckA.name} vs ${deckB.name}`,
        problemCards: [...problems],
        commands,
        games,
      };
    }
    // Forge exits 0 even when a card script blows up mid-game, so the exit
    // code alone is not evidence that the set is sound.
    if (parsed.exceptions.length > 0) {
      return {
        status: 'failed',
        reason: `Forge threw while running ${deckA.name} vs ${deckB.name}: ${parsed.exceptions.slice(0, 3).join(' / ')}`,
        problemCards: [...problems],
        commands,
        games,
      };
    }
  }

  if (problems.size > 0) {
    return {
      status: 'failed',
      reason: `Forge could not load ${problems.size} card(s) of the set: ${[...problems].join(', ')}`,
      problemCards: [...problems],
      commands,
      games,
    };
  }
  return { status: 'passed', reason: '', problemCards: [], commands, games };
}

function lastLines(text: string, count = 5): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-count)
    .join(' / ');
}
