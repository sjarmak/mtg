/** Node-only lifecycle shared by the embedded launcher and independent service. */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ObservedBackend } from '@mtg/engine';
import { compileInstalledForgeBridge, installedForgeBackend } from '@mtg/forge-export';
import { serveBackendGateway, serveStartingBackendGateway } from '@mtg/netplay';
import type { GameplayRecorder, RunningBackendGateway } from '@mtg/netplay';
import { LEGACY_CUBE_FORMAT } from '../src/routes/legacy-cube/model';
import { discoverForgeHome } from './forge-home';
import { isolatedObservedBackend } from './isolated-observed-backend';
import { admitPrintedBackends } from './admitted-printed-backend';
import { recordUnreviewedChoices } from './unreviewed-choices';
import type { PrintedBackendAdmissionInput, RefusedPrintedBackend } from './admitted-printed-backend';
import { formatObservedBackend } from './format-observed-backend';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';
import { createPlayAdmissionRoot } from './play-admission-root';

export interface BackendService {
  readonly gateway: RunningBackendGateway;
  readonly message: string;
  /**
   * The same composite the gateway serves, for a LAN table to open a game on,
   * with the formats it routes. Null when nothing observed was installed, which
   * is the state the health probe reports as no observed arm.
   */
  readonly observed: ObservedFormats | null;
  /**
   * Every requested printed format this service did not admit, with the
   * sentence a player reads in place of the Play button. The registry says a
   * format is supported when an admission is installed; only this verdict says
   * whether the runtime that started can honor it (#16, #89).
   */
  readonly withheld: readonly WithheldPrintedFormat[];
  readonly close: () => Promise<void>;
}

export interface WithheldPrintedFormat {
  readonly formatId: string;
  readonly reason: string;
}

export interface ObservedFormats {
  readonly backend: ObservedBackend;
  readonly formats: readonly string[];
}

/** Standalone service ports are explicit; port zero is only for embedded use. */
export function readBackendPort(args: readonly string[]): number {
  if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/u.test(args[1] ?? '')) {
    throw new Error('usage: npm run backend -- --port <1-65535>');
  }
  const port = Number(args[1]);
  assertPort(port, 1);
  return port;
}

function assertPort(port: number, minimum: number): void {
  if (!Number.isInteger(port) || port < minimum || port > 65535) {
    throw new Error(`backend port must be an integer from ${String(minimum)} to 65535`);
  }
}

type PrintedAdmissionResult = Awaited<ReturnType<typeof admitPrintedBackends>>[number];

function describeAdmission(admission: PrintedAdmissionResult, formatId: string): string {
  return admission.admitted
    ? `\nPrinted format ${admission.subject.formatId}: verified runtime admission loaded.`
    : `\nPrinted format ${formatId} admission refused: ${JSON.stringify(admission.reasons)}`;
}

export const RUNTIME_UNAVAILABLE_REASON =
  'Play is off: this lab started without the installed Forge runtime and compiled bridge.';
export const RUNTIME_MISMATCH_REASON =
  'Play is off: the installed admission was built against a different Forge build, bridge or adapter than this lab is running.';
export const MISSING_EVIDENCE_REASON = 'Play is off: no admission evidence is installed for this format.';

/** The player-facing sentence for a refusal; the codes stay in the launcher log. */
export function withheldReason(refused: RefusedPrintedBackend): string {
  if (refused.reasons.some((reason) => reason.code === 'runtime-mismatch')) return RUNTIME_MISMATCH_REASON;
  if (refused.reasons.some((reason) => reason.code === 'missing-evidence')) return MISSING_EVIDENCE_REASON;
  const codes = [...new Set(refused.reasons.map((reason) => reason.code))].join(', ');
  return `Play is off: the installed admission does not verify (${codes}).`;
}

export interface StartBackendServiceOptions {
  readonly repoRoot: string;
  readonly port: number;
  /**
   * Trusted local inputs only; the service verifies each before adding its route.
   * `formatId` is the registry's id, so a refusal can say which format it withheld.
   */
  readonly printedAdmissions?: readonly (PrintedBackendAdmissionInput & { readonly formatId: string })[];
  /** Where a finished gateway session is recorded; absent, nothing is. */
  readonly recorder?: GameplayRecorder | undefined;
  /**
   * Where the computer's answers to unreviewed choices are logged (#66). Present, a
   * Commander or Momir game lets Forge's AI answer a choice the bridge has no reviewed
   * screen for, and logs it here; absent, such a choice ends the game.
   */
  readonly unreviewedChoiceLog?: string | undefined;
}

export async function startBackendService(options: StartBackendServiceOptions): Promise<BackendService> {
  assertPort(options.port, 0);
  const starting = await serveStartingBackendGateway({ host: '127.0.0.1', port: options.port });
  try {
    return await buildReadyBackendService(options, starting);
  } catch (cause) {
    await starting.close();
    throw cause;
  }
}

async function buildReadyBackendService(
  options: StartBackendServiceOptions,
  starting: RunningBackendGateway,
): Promise<BackendService> {
  const requested = options.printedAdmissions ?? [];
  const forgeHome = discoverForgeHome(options.repoRoot);
  const forgeOptions = forgeHome === undefined ? {} : { forgeHome };
  const compiled = compileInstalledForgeBridge(forgeOptions);
  const admissionRuntimeReady = requested.length > 0 && compiled !== null && forgeHome !== undefined;
  let admissionRoot: string | null;
  try {
    admissionRoot = admissionRuntimeReady ? createPlayAdmissionRoot(options.repoRoot) : null;
  } catch (cause) {
    compiled?.dispose();
    throw cause;
  }
  const disposeRuntime = (removeAdmissionRoot: boolean): void => {
    process.off('exit', disposeCompiled);
    compiled?.dispose();
    if (removeAdmissionRoot && admissionRoot !== null)
      rmSync(admissionRoot, { recursive: true, force: true });
  };
  const disposeCompiled = (): void => disposeRuntime(true);
  process.once('exit', disposeCompiled);
  const forgeFactory = (): ReturnType<typeof installedForgeBackend> =>
    installedForgeBackend({
      ...forgeOptions,
      ...(compiled === null ? {} : { compiledBridgeClasses: compiled.classDirectory }),
    });
  let forge: ObservedBackend | null = null;
  let owners: readonly ObservedBackend[] = [];
  let admissionMessage =
    requested.length > 0 && !admissionRuntimeReady
      ? '\nPrinted format admission unavailable: the installed Forge runtime and compiled bridge are required. `npm run forge:install` installs Forge; the bridge compiles at launch.'
      : '';
  let gateway: RunningBackendGateway;
  let observed: ObservedFormats | null = null;
  let withheld: readonly WithheldPrintedFormat[] = admissionRuntimeReady
    ? []
    : requested.map((admission) => ({ formatId: admission.formatId, reason: RUNTIME_UNAVAILABLE_REASON }));
  try {
    forge = forgeFactory();
    const legacy = forge === null ? null : isolatedObservedBackend(forge, forgeFactory);
    // Before the gateway starts there are no sessions; retain the original
    // probe cleanup contract instead of nesting an isolated-owner error.
    owners = forge === null ? [] : [forge];
    let admissions: readonly PrintedAdmissionResult[] = [];
    if (compiled !== null && forgeHome !== undefined && admissionRoot !== null) {
      const outputParent = join(admissionRoot, 'snapshots');
      mkdirSync(outputParent);
      const adapterBundlePath = await bundleInstalledForgeAdapter(
        options.repoRoot,
        join(admissionRoot, 'adapter'),
      );
      const runtime = {
        forgeHome,
        bridge: { kind: 'compiled' as const, path: compiled.classDirectory },
        adapterBundlePath,
      };
      admissions = await admitPrintedBackends({
        runtime,
        outputParent,
        admissions: requested,
        ...(options.unreviewedChoiceLog === undefined ? {} : { unreviewedChoices: 'computer' as const }),
      });
      const admittedOwners = admissions.flatMap((admission) =>
        admission.admitted ? [admission.backend] : [],
      );
      owners = [...owners, ...admittedOwners];
      if (
        admissions.some(
          (admission) => admission.admitted && admission.subject.formatId === LEGACY_CUBE_FORMAT,
        )
      )
        throw new Error('Printed admission cannot replace the Legacy Cube route.');
    }
    const admitted = admissions.flatMap((admission) => (admission.admitted ? [admission] : []));
    const entries = [
      ...(legacy === null ? [] : [{ format: LEGACY_CUBE_FORMAT, backend: legacy }]),
      ...admitted.map((admission) => ({
        format: admission.subject.formatId,
        backend:
          options.unreviewedChoiceLog === undefined
            ? admission.backend
            : recordUnreviewedChoices(admission.backend, options.unreviewedChoiceLog),
      })),
    ];
    // Rejects a duplicate format route and a backend identity mismatch.
    const composite = entries.length === 0 ? null : formatObservedBackend(entries);
    const installed = composite === null ? [] : [composite];
    observed =
      composite === null ? null : { backend: composite, formats: entries.map((entry) => entry.format) };
    // `admitPrintedBackends` answers in the order it was asked.
    admissionMessage += admissions
      .map((admission, index) => describeAdmission(admission, requested[index]!.formatId))
      .join('');
    withheld = admissions.flatMap((admission, index) =>
      admission.admitted ? [] : [{ formatId: requested[index]!.formatId, reason: withheldReason(admission) }],
    );
    await starting.close();
    gateway = await serveBackendGateway({
      port: starting.port,
      host: '127.0.0.1',
      installed,
      recorder: options.recorder,
      routes: {
        generated: 'kernel',
        printed: {
          [LEGACY_CUBE_FORMAT]: forge?.id ?? 'forge-2.0.14',
          ...Object.fromEntries(
            admitted.map((admission) => [admission.subject.formatId, admission.backend.id]),
          ),
        },
      },
    });
  } catch (cause) {
    const results = await Promise.allSettled(
      owners.map(async (owner) => {
        await owner.shutdown?.();
      }),
    );
    const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    disposeRuntime(failures.length === 0);
    if (failures.length > 0)
      throw new AggregateError([cause, ...failures], 'backend startup and cleanup failed');
    throw cause;
  }
  let closing: Promise<void> | null = null;
  return {
    gateway,
    observed,
    withheld,
    message:
      (forge === null
        ? 'Legacy Cube backend: Forge 2.0.14 is not installed; matches will refuse explicitly. Run `npm run forge:install`, or set FORGE_HOME to an existing install.'
        : `Legacy Cube backend: ${forge.id} is installed, precompiled, and ready from ${forgeHome ?? 'tools/forge/dist'}.`) +
      admissionMessage,
    close: (): Promise<void> => {
      closing ??= gateway.close().then(
        () => disposeRuntime(true),
        (cause: unknown) => {
          disposeRuntime(false);
          throw cause;
        },
      );
      return closing;
    },
  };
}
