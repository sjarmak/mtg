/** Resolves the downloaded Forge 2.0.14 artifact into an isolated bridge process. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObservedBackend } from '@mtg/engine';
import { findForgeInstall, forgeJvmCommand, materializeForgeProfile } from '../install';
import type { ForgeInstall } from '../install';
import {
  forgeObservedAdmittedBackend,
  forgeObservedBackend,
  forgeObservedDiagnosticBackend,
} from './backend';
import type { ForgeCustomSetResolver, ForgeObservedBackendOptions } from './backend';
import type { ForgeGeneratedObjectPolicy } from './backend';
import { ForgeScenarioStateSchema } from './scenario-state';
import type { ForgeScenarioState } from './scenario-state';

export interface InstalledForgeBackendOptions {
  /** Overrides FORGE_HOME and the default read-only artifact location. */
  readonly forgeHome?: string;
  /** Time allowed for initialization or one submitted move. */
  readonly timeoutMs?: number;
  /** Resolves each custom set named by mixed content before Forge is started. */
  readonly resolveCustomSet?: ForgeCustomSetResolver;
  /** Explicit companion source path for packaged callers outside the source workspace. */
  readonly bridgeSource?: string;
  /** Precompiled companion classes shared read-only across otherwise isolated runtimes. */
  readonly compiledBridgeClasses?: string;
  /** Parent for the private runtime root; defaults to the operating-system temp directory. */
  readonly runtimeParent?: string;
  /** Test/deployment override for the installation's complete printed-name inventory. */
  readonly printedCardNames?: ReadonlySet<string>;
  /** Verification-only switch for exercising Forge's pre-2025 combat-order callbacks. */
  readonly forceLegacyCombatOrderingForTest?: boolean;
}

export interface CompileInstalledForgeBridgeOptions {
  /** Overrides FORGE_HOME and the default read-only artifact location. */
  readonly forgeHome?: string;
  /** Explicit companion source path for packaged callers outside the source workspace. */
  readonly bridgeSource?: string;
  /** Parent for the owned compilation root; defaults to the operating-system temp directory. */
  readonly outputParent?: string;
}

export interface CompiledInstalledForgeBridge {
  /** Directory containing ForgeBridge.class and its companion inner classes. */
  readonly classDirectory: string;
  /** Deletes only this compilation's owned temporary root. */
  readonly dispose: () => void;
}

class ProfileMutex {
  #tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let openGate = (): void => undefined;
    const gate = new Promise<void>((resolveGate) => {
      openGate = resolveGate;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => gate);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      openGate();
    };
  }
}

const PROFILE_MUTEXES = new Map<string, ProfileMutex>();
const PRINTED_NAMES = new Map<string, ReadonlySet<string>>();

function mutexFor(userDir: string): ProfileMutex {
  const key = resolve(userDir);
  const existing = PROFILE_MUTEXES.get(key);
  if (existing !== undefined) return existing;
  const created = new ProfileMutex();
  PROFILE_MUTEXES.set(key, created);
  return created;
}

/** A writable program/profile root whose large Forge inputs remain read-only symlinks. */
function runtimeInstall(source: ForgeInstall, parent: string): ForgeInstall {
  const home = mkdtempSync(join(parent, 'mtg-forge-runtime-'));
  try {
    const jar = join(home, basename(source.jar));
    symlinkSync(source.jar, jar, 'file');
    const sourceResources = join(source.home, 'res');
    if (existsSync(sourceResources)) symlinkSync(sourceResources, join(home, 'res'), 'dir');
    const userDir = join(home, 'userdata');
    return {
      home,
      jar,
      version: source.version,
      userDir,
      customDir: join(userDir, 'custom'),
      decksDir: join(userDir, 'decks', 'constructed'),
    };
  } catch (cause) {
    rmSync(home, { recursive: true, force: true });
    throw cause;
  }
}

function bridgeSourcePath(explicit: string | undefined): string {
  if (explicit !== undefined) {
    const source = resolve(explicit);
    if (!existsSync(source)) throw new Error(`Forge bridge source does not exist: ${source}`);
    return source;
  }
  const moduleDirectory = new URL('.', import.meta.url);
  if (moduleDirectory.protocol === 'file:') {
    return resolve(fileURLToPath(moduleDirectory), '..', '..', 'bridge', 'ForgeBridge.java');
  }
  const workspaceSource = resolve(process.cwd(), 'packages', 'forge-export', 'bridge', 'ForgeBridge.java');
  if (existsSync(workspaceSource)) return workspaceSource;
  throw new Error(
    'Forge bridge source cannot be inferred outside a file-backed module; pass bridgeSource explicitly',
  );
}

/** Compiles the bridge once so each match can still receive a fresh JVM without recompiling it. */
export function compileInstalledForgeBridge(
  options: CompileInstalledForgeBridgeOptions = {},
): CompiledInstalledForgeBridge | null {
  const located = findForgeInstall(options.forgeHome === undefined ? {} : { forgeHome: options.forgeHome });
  if (located === null) return null;
  const source = bridgeSourcePath(options.bridgeSource);
  const root = mkdtempSync(join(resolve(options.outputParent ?? tmpdir()), 'mtg-forge-bridge-'));
  const classDirectory = join(root, 'classes');
  try {
    mkdirSync(classDirectory);
    execFileSync('javac', ['-encoding', 'UTF-8', '-classpath', located.jar, '-d', classDirectory, source], {
      cwd: located.home,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!existsSync(join(classDirectory, 'ForgeBridge.class'))) {
      throw new Error('javac completed without producing ForgeBridge.class');
    }
  } catch (cause) {
    rmSync(root, { recursive: true, force: true });
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not compile the installed Forge bridge: ${detail}`, { cause });
  }
  let disposed = false;
  return {
    classDirectory,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function installedPrintedCardNames(install: ForgeInstall): ReadonlySet<string> | undefined {
  const archive = join(install.home, 'res', 'cardsfolder', 'cardsfolder.zip');
  if (!existsSync(archive)) return undefined;
  const cached = PRINTED_NAMES.get(archive);
  if (cached !== undefined) return cached;
  const scripts = execFileSync('unzip', ['-p', archive], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const names = new Set<string>();
  for (const match of scripts.matchAll(/^Name:(.+)$/gmu)) {
    const name = match[1]?.trim();
    if (name !== undefined && name.length > 0) names.add(name);
  }
  if (names.size === 0) {
    throw new Error(`Forge printed-card archive contains no Name records: ${archive}`);
  }
  PRINTED_NAMES.set(archive, names);
  return names;
}

/** Returns null when the downloaded artifact is absent; absence is never a pass. */
export function installedForgeBackend(options: InstalledForgeBackendOptions = {}): ObservedBackend | null {
  if ('scenarioForTest' in options)
    throw new Error('Scenario state requires the verification-only constructor');
  return createInstalledForgeBackend(options);
}

/**
 * Offline catalog failure discovery. The supplied inventory is an allow-list
 * for diagnostics only and never changes ordinary format admission.
 */
export function installedForgeDiagnosticBackend(
  diagnosticCardNames: ReadonlySet<string>,
  options: InstalledForgeBackendOptions = {},
): ObservedBackend | null {
  if (diagnosticCardNames.size === 0) throw new Error('Diagnostic card inventory must be non-empty');
  return createInstalledForgeBackend(options, undefined, new Set(diagnosticCardNames), 'catalog-discovery');
}

/** A verified admission supplies the complete card-name inventory; this function does not verify it. */
export function installedForgeAdmittedBackend(
  admittedCardNames: ReadonlySet<string>,
  options: InstalledForgeBackendOptions = {},
  generatedObjectPolicy?: ForgeGeneratedObjectPolicy,
): ObservedBackend | null {
  if (admittedCardNames.size === 0) throw new Error('Admitted card inventory must be non-empty');
  return createInstalledForgeBackend(
    options,
    undefined,
    new Set(admittedCardNames),
    'admitted-format',
    generatedObjectPolicy,
  );
}

/** Isolated rules scenarios, never format or whole-card admission evidence.
 * Deliberately not exported from the package's public entrypoint.
 */
export function installedForgeScenarioBackend(
  state: unknown,
  options: InstalledForgeBackendOptions = {},
): ObservedBackend | null {
  return createInstalledForgeBackend(options, ForgeScenarioStateSchema.parse(state));
}

/** Catalog-scoped scenario evidence; unlike ordinary scenarios, this enables audited format contracts. */
export function installedForgeDiagnosticScenarioBackend(
  state: unknown,
  diagnosticCardNames: ReadonlySet<string>,
  options: InstalledForgeBackendOptions = {},
): ObservedBackend | null {
  if (diagnosticCardNames.size === 0) throw new Error('Diagnostic card inventory must be non-empty');
  return createInstalledForgeBackend(
    options,
    ForgeScenarioStateSchema.parse(state),
    new Set(diagnosticCardNames),
    'catalog-discovery',
  );
}

function createInstalledForgeBackend(
  options: InstalledForgeBackendOptions,
  scenario?: ForgeScenarioState,
  scopedCardNames?: ReadonlySet<string>,
  validationPurpose?: 'catalog-discovery' | 'admitted-format',
  generatedObjectPolicy?: ForgeGeneratedObjectPolicy,
): ObservedBackend | null {
  const located = findForgeInstall(options.forgeHome === undefined ? {} : { forgeHome: options.forgeHome });
  if (located === null) return null;
  const compiledBridgeClasses =
    options.compiledBridgeClasses === undefined ? undefined : resolve(options.compiledBridgeClasses);
  if (compiledBridgeClasses !== undefined && !existsSync(join(compiledBridgeClasses, 'ForgeBridge.class'))) {
    throw new Error(`compiled Forge bridge does not contain ForgeBridge.class: ${compiledBridgeClasses}`);
  }
  const bridgeEntrypoint =
    compiledBridgeClasses === undefined ? bridgeSourcePath(options.bridgeSource) : 'ForgeBridge';
  const printedCardNames = options.printedCardNames ?? installedPrintedCardNames(located);
  const install = runtimeInstall(located, resolve(options.runtimeParent ?? tmpdir()));
  const scenarioPath = join(install.home, 'verification-state.json');
  const profileMutex = mutexFor(install.userDir);
  const jvm = forgeJvmCommand([
    'java',
    '-Xmx4096m',
    '-Dio.netty.tryReflectionSetAccessible=true',
    '-Dfile.encoding=UTF-8',
    ...(scenario === undefined ? [] : [`-Dmtg.forge.test.scenario=${scenarioPath}`]),
    ...(options.forceLegacyCombatOrderingForTest === true
      ? ['-Dmtg.forge.test.forceLegacyCombatOrdering=true']
      : []),
    '--class-path',
    compiledBridgeClasses === undefined ? install.jar : `${install.jar}${delimiter}${compiledBridgeClasses}`,
    bridgeEntrypoint,
  ]);
  const delegateOptions: ForgeObservedBackendOptions = {
    command: jvm.command,
    args: [...jvm.args],
    cwd: install.home,
    timeoutMs: options.timeoutMs ?? 60_000,
    backendId: `forge-${install.version}${
      scenario !== undefined
        ? '-verification-scenario'
        : validationPurpose === 'catalog-discovery'
          ? '-catalog-discovery'
          : ''
    }`,
    expectedForgeVersionPrefix: install.version,
    ...(options.resolveCustomSet === undefined ? {} : { resolveCustomSet: options.resolveCustomSet }),
    ...(printedCardNames === undefined ? {} : { printedCardNames }),
    acquireProfile: () => profileMutex.acquire(),
    beforeSpawn: (exports) => {
      materializeForgeProfile(install, exports);
      if (scenario !== undefined) writeFileSync(scenarioPath, JSON.stringify(scenario), { mode: 0o600 });
    },
  };
  const delegate =
    validationPurpose === 'catalog-discovery'
      ? forgeObservedDiagnosticBackend(delegateOptions, scopedCardNames!)
      : validationPurpose === 'admitted-format'
        ? forgeObservedAdmittedBackend(delegateOptions, scopedCardNames!, generatedObjectPolicy)
        : forgeObservedBackend(delegateOptions);
  let state: 'open' | 'shutting-down' | 'shut-down' = 'open';
  let openings = 0;
  let drain: Promise<void> | null = null;
  let drainDone: (() => void) | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const openingFinished = (): void => {
    openings -= 1;
    if (openings === 0) {
      drainDone?.();
      drain = null;
      drainDone = null;
    }
  };
  const openingsDrained = (): Promise<void> => {
    if (openings === 0) return Promise.resolve();
    drain ??= new Promise<void>((resolveDrain) => {
      drainDone = resolveDrain;
    });
    return drain;
  };

  return {
    ...delegate,
    open: async (table) => {
      if (state !== 'open') {
        return {
          ok: false,
          error: {
            kind: 'backend-failure',
            message: `Forge backend ${delegate.id} has shut down`,
          },
        };
      }
      openings += 1;
      try {
        return await delegate.open(table);
      } finally {
        openingFinished();
      }
    },
    shutdown: (): Promise<void> => {
      if (shutdownPromise !== null) return shutdownPromise;
      state = 'shutting-down';
      shutdownPromise = (async (): Promise<void> => {
        await openingsDrained();
        const release = await profileMutex.acquire();
        try {
          rmSync(install.home, { recursive: true, force: true });
          PROFILE_MUTEXES.delete(resolve(install.userDir));
          state = 'shut-down';
        } finally {
          release();
        }
      })();
      return shutdownPromise;
    },
  };
}
