import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { PrintedConstructedDeck, PrintedConstructedFormat } from '@mtg/printed-card';
import {
  ensureForgeProfile,
  findForgeInstall,
  forgeCommandArgs,
  problemCardNames,
  type ForgeInstall,
} from '@mtg/forge-export';
import { forgeDeckFileName, renderCommanderDeckFile } from './deck-file';
import { killProcessGroup, trackProcessGroup } from './process-group';
import { recordGames } from './tally';
import { parseGameOutcomes, sinceSimulationStart } from './transcript';
import { pairingSeed } from './seed';
import type { CommanderHeadToHeadDeck, CommanderHeadToHeadGameRecord } from './schema';

export interface PairingRunResult {
  readonly forgeVersion: string;
  readonly commands: readonly [string, string];
  readonly seeds: readonly [number, number];
  readonly records: readonly CommanderHeadToHeadGameRecord[];
  readonly decks: readonly [CommanderHeadToHeadDeck, CommanderHeadToHeadDeck];
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function quoteArg(arg: string): string {
  return /[\s"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

interface ForgeInvocationResult {
  readonly command: string;
  readonly output: string;
}

function buildForgeCommand(
  jar: string,
  home: string,
  args: readonly string[],
  timeoutMs: number,
): { readonly xvfbArgs: readonly string[]; readonly command: string } {
  const javaArgs = forgeCommandArgs({ jar, args, cwd: home, timeoutMs });
  const xvfbArgs = ['-a', 'java', ...javaArgs];
  const command = ['xvfb-run', ...xvfbArgs].map(quoteArg).join(' ');
  return { xvfbArgs, command };
}

interface ForgeCloseOutcome {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly command: string;
  readonly output: string;
  readonly timeoutMs: number;
}

function settleForgeResult(
  resolvePromise: (result: ForgeInvocationResult) => void,
  rejectPromise: (error: Error) => void,
  outcome: ForgeCloseOutcome,
): void {
  if (outcome.timedOut) {
    rejectPromise(new Error(`Forge timed out after ${String(outcome.timeoutMs)} ms: ${outcome.command}`));
    return;
  }
  if (outcome.code !== 0) {
    rejectPromise(new Error(`Forge exited ${String(outcome.code)}: ${outcome.command}\n${outcome.output}`));
    return;
  }
  resolvePromise({ command: outcome.command, output: outcome.output });
}

function spawnForgeSim(
  jar: string,
  home: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ForgeInvocationResult> {
  const { xvfbArgs, command } = buildForgeCommand(jar, home, args, timeoutMs);

  return new Promise<ForgeInvocationResult>((resolvePromise, rejectPromise) => {
    const child = spawn('xvfb-run', xvfbArgs, {
      cwd: home,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackProcessGroup(child.pid);
    let output = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      settleForgeResult(resolvePromise, rejectPromise, { code, timedOut, command, output, timeoutMs });
    });
  });
}

export interface RunPairingOptions {
  readonly format: PrintedConstructedFormat;
  readonly deckA: PrintedConstructedDeck;
  readonly deckB: PrintedConstructedDeck;
  readonly gamesPerPairing: number;
  readonly clockSeconds: number;
  readonly baseSeed: number;
}

interface PreparedForgeHome {
  readonly privateHome: string;
  readonly install: ForgeInstall;
  readonly fileA: string;
  readonly fileB: string;
}

function prepareForgeHome(
  sharedInstall: ForgeInstall,
  format: PrintedConstructedFormat,
  deckA: PrintedConstructedDeck,
  deckB: PrintedConstructedDeck,
): PreparedForgeHome {
  const privateHome = mkdtempSync(join(tmpdir(), 'mtg-commander-h2h-'));
  symlinkSync(sharedInstall.jar, join(privateHome, basename(sharedInstall.jar)));
  symlinkSync(join(sharedInstall.home, 'res'), join(privateHome, 'res'));
  const install = findForgeInstall({ forgeHome: privateHome, userDir: join(privateHome, 'userdata') });
  if (install === null) {
    throw new Error(`failed to resolve a private Forge install under ${privateHome}`);
  }
  ensureForgeProfile(install);
  const commanderDecksDir = join(install.userDir, 'decks', 'commander');
  mkdirSync(commanderDecksDir, { recursive: true });

  const fileA = renderCommanderDeckFile(deckA, format.sources);
  const fileB = renderCommanderDeckFile(deckB, format.sources);
  writeFileSync(join(commanderDecksDir, forgeDeckFileName(deckA)), fileA, 'utf8');
  writeFileSync(join(commanderDecksDir, forgeDeckFileName(deckB)), fileB, 'utf8');

  return { privateHome, install, fileA, fileB };
}

function validateInvocationGames(
  parsed: ReturnType<typeof parseGameOutcomes>,
  deckA: PrintedConstructedDeck,
  deckB: PrintedConstructedDeck,
  listedFirst: 'a' | 'b',
  half: number,
  rawOutput: string,
): void {
  const numberedInOrder = parsed.every((game, index) => game.game === index + 1);
  const everyGameHasPlayOrder = parsed.every((game) => game.firstSeat !== null);
  if (parsed.length === half && numberedInOrder && everyGameHasPlayOrder) return;

  const tail = rawOutput.split(/\r?\n/).slice(-40).join('\n');
  throw new Error(
    `pairing ${deckA.id} vs ${deckB.id} (${listedFirst} listed first) expected ${String(half)} ` +
      `correctly-numbered games with recorded play order, found ${String(parsed.length)}; last 40 lines:\n${tail}`,
  );
}

interface InvocationOutcome {
  readonly command: string;
  readonly seed: number;
  readonly records: readonly CommanderHeadToHeadGameRecord[];
}

async function runInvocation(
  install: ForgeInstall,
  privateHome: string,
  deckA: PrintedConstructedDeck,
  deckB: PrintedConstructedDeck,
  listedFirst: 'a' | 'b',
  half: number,
  clockSeconds: number,
  timeoutMs: number,
  baseSeed: number,
): Promise<InvocationOutcome> {
  const [first, second] = listedFirst === 'a' ? [deckA, deckB] : [deckB, deckA];
  const seed = pairingSeed(baseSeed, deckA.id, deckB.id, listedFirst);
  const args = [
    'sim',
    '-d',
    forgeDeckFileName(first),
    forgeDeckFileName(second),
    '-f',
    'Commander',
    '-n',
    String(half),
    '-c',
    String(clockSeconds),
    '-s',
    String(seed),
  ];
  const result = await spawnForgeSim(install.jar, privateHome, args, timeoutMs);
  const since = sinceSimulationStart(result.output);
  const problems = problemCardNames(since);
  if (problems.length > 0) {
    throw new Error(
      `Forge could not load ${problems.join(', ')} for pairing ${deckA.id} vs ${deckB.id} (${listedFirst} listed first)`,
    );
  }
  const parsed = parseGameOutcomes(since);
  validateInvocationGames(parsed, deckA, deckB, listedFirst, half, result.output);
  return { command: result.command, seed, records: recordGames(parsed, listedFirst) };
}

export async function runPairing(options: RunPairingOptions): Promise<PairingRunResult> {
  const { format, deckA, deckB, gamesPerPairing, clockSeconds, baseSeed } = options;
  if (gamesPerPairing <= 0 || gamesPerPairing % 2 !== 0) {
    throw new Error(`gamesPerPairing must be a positive even number, got ${String(gamesPerPairing)}`);
  }
  const sharedInstall = findForgeInstall();
  if (sharedInstall === null) {
    throw new Error('no Forge install found under tools/forge/dist; set FORGE_HOME or install it there');
  }

  const half = gamesPerPairing / 2;
  const timeoutMs = half * clockSeconds * 1000 + 60_000;
  const { privateHome, install, fileA, fileB } = prepareForgeHome(sharedInstall, format, deckA, deckB);
  try {
    const commands: string[] = [];
    const seeds: number[] = [];
    const records: CommanderHeadToHeadGameRecord[] = [];
    for (const listedFirst of ['a', 'b'] as const) {
      const outcome = await runInvocation(
        install,
        privateHome,
        deckA,
        deckB,
        listedFirst,
        half,
        clockSeconds,
        timeoutMs,
        baseSeed,
      );
      commands.push(outcome.command);
      seeds.push(outcome.seed);
      records.push(...outcome.records);
    }

    return {
      forgeVersion: sharedInstall.version,
      commands: [commands[0]!, commands[1]!],
      seeds: [seeds[0]!, seeds[1]!],
      records,
      decks: [
        { id: deckA.id, name: deckA.name, deckFileSha256: sha256(fileA) },
        { id: deckB.id, name: deckB.name, deckFileSha256: sha256(fileB) },
      ],
    };
  } finally {
    rmSync(privateHome, { recursive: true, force: true });
  }
}
