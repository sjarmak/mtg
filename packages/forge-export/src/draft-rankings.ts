/** Installed Forge Limited rankings, read only through a separately executed GPL companion. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintBotFiles } from './bot-fingerprint';
import { killProcessGroup, trackProcessGroup } from './process-group';
import { findForgeInstall, forgeJvmCommand } from './install';

// Resolved lazily (not at module scope): import.meta.url is not a real
// file:// URL in every environment that ends up importing this module (e.g.
// a jsdom-environment test pulling it in transitively).
function sourcePath(): string {
  return fileURLToPath(new URL('../bridge/ForgeDraftRankings.java', import.meta.url));
}
const PREFIX = '@@MTG_FORGE_DRAFT_RANK@@';
const OUTPUT_LIMIT = 4 * 1024 * 1024;

export interface ForgeDraftRankingReader {
  readonly forgeVersion: string;
  readonly fingerprint: string;
  readonly read: (setCode: string, cardNames: readonly string[]) => Promise<readonly (number | null)[]>;
  readonly dispose: () => void;
}

export function parseForgeDraftRankingOutput(stdout: string, expected: number): readonly (number | null)[] {
  const values = new Map<number, number | null>();
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.startsWith(PREFIX)) continue;
    const match = /^(\d+)\|(null|-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)$/u.exec(
      line.slice(PREFIX.length),
    );
    if (match === null) throw new Error('Forge draft ranking companion wrote an invalid result');
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= expected)
      throw new Error('Forge draft ranking result index is out of range');
    if (values.has(index)) throw new Error(`Forge draft ranking result ${String(index)} is duplicate`);
    const ranking = match[2] === 'null' ? null : Number(match[2]);
    if (ranking !== null && (!Number.isFinite(ranking) || ranking < 0 || ranking > 1))
      throw new Error('Forge draft ranking value is out of range');
    values.set(index, ranking);
  }
  if (values.size !== expected)
    throw new Error(
      `Forge draft ranking companion returned ${String(values.size)} results; expected ${String(expected)}`,
    );
  return Array.from({ length: expected }, (_, index) => values.get(index)!);
}

export function createInstalledForgeDraftRankingReader(
  options: { readonly forgeHome?: string; readonly timeoutMs?: number } = {},
): ForgeDraftRankingReader | null {
  const install = findForgeInstall(options);
  if (install === null) return null;
  const root = mkdtempSync(join(tmpdir(), 'mtg-forge-draft-rankings-'));
  const classes = join(root, 'classes');
  mkdirSync(classes);
  try {
    execFileSync('javac', ['-encoding', 'UTF-8', '-classpath', install.jar, '-d', classes, sourcePath()], {
      cwd: install.home,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!existsSync(join(classes, 'ForgeDraftRankings.class')))
      throw new Error('javac completed without producing ForgeDraftRankings.class');
  } catch (cause) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`Could not compile the installed Forge draft ranking companion: ${String(cause)}`, {
      cause,
    });
  }
  const fingerprint = fingerprintBotFiles(`forge-draft-rankings/v1/${install.version}`, [
    { name: 'forge.jar', path: install.jar },
    { name: 'source.java', path: sourcePath() },
  ]);
  let disposed = false;
  let active = false;
  return {
    forgeVersion: install.version,
    fingerprint,
    read: async (setCode, cardNames) => {
      if (disposed || active) throw new Error('Forge draft ranking reader is disposed or already active');
      if (!/^[A-Z0-9]+$/u.test(setCode)) throw new Error(`Invalid Forge draft ranking set code: ${setCode}`);
      if (cardNames.some((name) => name.length === 0 || /[\r\n]/u.test(name)))
        throw new Error('Forge draft ranking card names must be non-empty single lines');
      active = true;
      try {
        return await runRankingProcess(
          install.home,
          install.jar,
          classes,
          setCode,
          cardNames,
          options.timeoutMs ?? 60_000,
        );
      } finally {
        active = false;
      }
    },
    dispose: () => {
      if (disposed) return;
      if (active) throw new Error('Cannot dispose an active Forge draft ranking reader');
      disposed = true;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runRankingProcess(
  cwd: string,
  jar: string,
  classes: string,
  setCode: string,
  cardNames: readonly string[],
  timeoutMs: number,
): Promise<readonly (number | null)[]> {
  return new Promise((resolveResult, rejectResult) => {
    const jvm = forgeJvmCommand([
      'java',
      '-Dfile.encoding=UTF-8',
      '--class-path',
      `${jar}${delimiter}${classes}`,
      'ForgeDraftRankings',
      setCode,
    ]);
    const child = spawn(jvm.command, jvm.args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    trackProcessGroup(child.pid);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let failure: Error | undefined;
    const stop = (error: Error): void => {
      if (failure !== undefined) return;
      failure = error;
      try {
        killProcessGroup(child.pid);
      } catch (cause) {
        failure = new Error(`${error.message}; cleanup failed: ${String(cause)}`, { cause });
      }
    };
    const finish = (result: { readonly values?: readonly (number | null)[]; readonly error?: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.error === undefined) resolveResult(result.values!);
      else rejectResult(result.error);
    };
    const timer = setTimeout(() => {
      stop(new Error(`Forge draft ranking companion exceeded ${String(timeoutMs)} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > OUTPUT_LIMIT)
        stop(new Error('Forge draft ranking companion output exceeded limit'));
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > OUTPUT_LIMIT)
        stop(new Error('Forge draft ranking companion output exceeded limit'));
      else stderr += chunk;
    });
    child.stdin.once('error', (cause) =>
      stop(new Error(`Forge draft ranking stdin failed: ${cause.message}`)),
    );
    child.once('error', (cause) => {
      failure = cause;
    });
    child.once('close', (code) => {
      killProcessGroup(child.pid);
      if (settled) return;
      if (failure !== undefined) {
        finish({ error: failure });
        return;
      }
      if (code !== 0) {
        finish({
          error: new Error(`Forge draft ranking companion exited ${String(code)}: ${stderr.trim()}`),
        });
        return;
      }
      try {
        finish({ values: parseForgeDraftRankingOutput(stdout, cardNames.length) });
      } catch (cause) {
        finish({ error: cause instanceof Error ? cause : new Error(String(cause)) });
      }
    });
    child.stdin.end(cardNames.length === 0 ? '' : `${cardNames.join('\n')}\n`);
  });
}
