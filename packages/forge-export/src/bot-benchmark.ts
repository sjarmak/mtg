/** Installed Forge only. No Forge classes or card implementations enter the JS runtime. */
import { execFileSync, spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureForgeProfile, findForgeInstall, forgeJvmCommand } from './install';
import type { ForgeInstall } from './install';
import { fingerprintBotFiles } from './bot-fingerprint';
import { killProcessGroup, trackProcessGroup } from './process-group';
import { botCommandArgs, parseRequestedBotReport, validateBotRun } from './bot-benchmark-protocol';
import type { BotBenchmarkReport, BotRun, BotRunInput } from './bot-benchmark-protocol';

// Resolved lazily (not at module scope): import.meta.url is not a real
// file:// URL in every environment that ends up importing this module (e.g.
// a jsdom-environment test pulling it in transitively), and this module's
// exports are only used where Forge itself is installed and reachable.
function sourcePath(): string {
  return fileURLToPath(new URL('../bridge/ForgeBotBenchmark.java', import.meta.url));
}
function probesPath(): string {
  return fileURLToPath(new URL('../bridge/LegacyCubeBotProbes.java', import.meta.url));
}
function fixturesPath(): string {
  return fileURLToPath(new URL('../bridge/legacy-cube-bot-probes.json', import.meta.url));
}
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export interface InstalledBotResult {
  readonly status: 'completed' | 'incomplete';
  readonly report: BotBenchmarkReport | null;
  readonly botFingerprint: string;
  readonly forgeVersion: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

function fingerprint(install: ForgeInstall, aiMode: string, classes: string): string {
  const runtime = execFileSync('java', ['--version'], { encoding: 'utf8', timeout: 10000 });
  const compiler = execFileSync('javac', ['--version'], { encoding: 'utf8', timeout: 10000 });
  return fingerprintBotFiles(`forge-bot/v1/${aiMode}/Default/isolated-profile/${runtime}/${compiler}`, [
    { name: 'forge.jar', path: install.jar },
    { name: 'source.java', path: sourcePath() },
    { name: 'probes.java', path: probesPath() },
    { name: 'classes', path: classes },
    ...['ai', 'cardsfolder', 'tokenscripts', 'editions', 'effects', 'defaults'].map((name) => ({
      name: `res/${name}`,
      path: join(install.home, 'res', name),
    })),
  ]);
}

function isolatedInstall(source: ForgeInstall): ForgeInstall {
  const home = mkdtempSync(join(tmpdir(), 'mtg-forge-bot-profile-'));
  try {
    const jar = join(home, basename(source.jar));
    symlinkSync(source.jar, jar, 'file');
    symlinkSync(join(source.home, 'res'), join(home, 'res'), 'dir');
    const userDir = join(home, 'userdata');
    const install = {
      ...source,
      home,
      jar,
      userDir,
      customDir: join(userDir, 'custom'),
      decksDir: join(userDir, 'decks', 'constructed'),
    };
    ensureForgeProfile(install);
    return install;
  } catch (error) {
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

function runProcess(
  install: ForgeInstall,
  classes: string,
  run: BotRun,
  botFingerprint: string,
): Promise<InstalledBotResult> {
  return new Promise((resolveResult) => {
    const jvm = forgeJvmCommand([
      'java',
      `-Dmtg.bot.probes=${join(classes, 'probes.json')}`,
      ...botCommandArgs(install.jar, classes, run),
    ]);
    const child = spawn(jvm.command, jvm.args, {
      cwd: install.home,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackProcessGroup(child.pid);
    let stdout = '';
    let stderr = '';
    let failure: string | null = null;
    const stop = (message: string) => {
      failure = message;
      try {
        killProcessGroup(child.pid);
      } catch (error) {
        failure += `; cleanup: ${String(error)}`;
      }
    };
    const timer = setTimeout(() => stop(`Forge bot exceeded ${String(run.timeoutMs)}ms`), run.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT_BYTES)
        stop('Forge output exceeded limit');
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT_BYTES)
        stop('Forge output exceeded limit');
      else stderr += chunk;
    });
    child.on('error', (error) => {
      failure = `Could not launch Forge: ${error.message}`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      let report: BotBenchmarkReport | null = null;
      try {
        report = parseRequestedBotReport(stdout, run);
      } catch (error) {
        failure ??= error instanceof Error ? error.message : String(error);
      }
      if (code !== 0) failure ??= `Forge exited with ${String(code)}`;
      resolveResult({
        status: failure === null ? 'completed' : 'incomplete',
        report,
        botFingerprint,
        forgeVersion: install.version,
        stdout,
        stderr,
        error: failure,
      });
    });
  });
}

/** Compile once; each game still gets a fresh JVM, RNG, and writable profile. */
export function createInstalledForgeBotRunner(
  options: { readonly forgeHome?: string; readonly aiMode?: 'hybrid' | 'full' } = {},
) {
  const install = findForgeInstall(options);
  if (!install) throw new Error('Forge is not installed; bot calibration cannot run');
  const aiMode = options.aiMode ?? 'hybrid';
  const root = mkdtempSync(join(tmpdir(), 'mtg-forge-bot-classes-'));
  const classes = join(root, 'classes');
  mkdirSync(classes);
  let botFingerprint: string;
  try {
    copyFileSync(fixturesPath(), join(classes, 'probes.json'));
    execFileSync(
      'javac',
      ['-encoding', 'UTF-8', '-classpath', install.jar, '-d', classes, sourcePath(), probesPath()],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      },
    );
    botFingerprint = fingerprint(install, aiMode, classes);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`Forge bot companion compilation failed: ${String(error)}`, { cause: error });
  }
  let disposed = false;
  let active = false;
  return {
    botFingerprint,
    forgeVersion: install.version,
    run: async (input: BotRunInput): Promise<InstalledBotResult> => {
      if (disposed || active) throw new Error('Forge runner disposed or already active');
      const run = validateBotRun({ ...input, aiMode });
      for (const path of [run.deckA, run.deckB])
        if (!existsSync(path)) throw new Error(`Deck does not exist: ${path}`);
      const runtime = isolatedInstall(install);
      active = true;
      try {
        return await runProcess(
          runtime,
          classes,
          { ...run, deckA: resolve(run.deckA), deckB: resolve(run.deckB) },
          botFingerprint,
        );
      } finally {
        active = false;
        rmSync(runtime.home, { recursive: true, force: true });
      }
    },
    dispose: () => {
      if (active) throw new Error('Cannot dispose an active Forge runner');
      if (!disposed) {
        disposed = true;
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
