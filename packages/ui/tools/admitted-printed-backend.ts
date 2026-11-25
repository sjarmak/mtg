/** Node-only admission/launch seam. No route is registered and no evidence is inferred here. */
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import {
  PrintedAdmissionRuntimeMismatchError,
  verifyPrintedFormatPlayAdmission,
} from '@mtg/printed-card/node';
import { createForgeRuntimeSnapshot, measureForgeRuntime } from '@mtg/forge-export';
import type {
  ForgeGeneratedObjectPolicy,
  ForgeRuntimeIdentityOptions,
  ForgeRuntimeSnapshot,
  InstalledForgeBackendOptions,
} from '@mtg/forge-export';
import { parsePrintedCardCatalog, parsePrintedFormat, PrintedPlayAdmissionSchema } from '@mtg/printed-card';
import type { PrintedAdmissionReason, PrintedPlaySubject } from '@mtg/printed-card';
import { isolatedObservedBackend, SNAPSHOT_FORGE_REMOVED_MESSAGE } from './isolated-observed-backend';

export interface PrintedBackendAdmissionInput {
  readonly format: unknown;
  readonly catalogs: readonly unknown[];
  readonly evidence: { readonly body: string; readonly read: (path: string) => string | Uint8Array } | null;
}

interface Options extends PrintedBackendAdmissionInput {
  readonly runtime: ForgeRuntimeIdentityOptions;
  readonly outputParent: string;
}
export interface AdmittedPrintedBackend {
  readonly admitted: true;
  readonly subject: PrintedPlaySubject;
  readonly backend: ObservedBackend;
}

export type RefusedPrintedBackend = {
  readonly admitted: false;
  readonly reasons: readonly (
    | PrintedAdmissionReason
    | { readonly code: 'missing-evidence' }
    | { readonly code: 'runtime-mismatch'; readonly detail: string }
  )[];
};

type Result = RefusedPrintedBackend | AdmittedPrintedBackend;

interface VerifiedPrintedBackend {
  readonly admitted: true;
  readonly subject: PrintedPlaySubject;
  readonly formatId: string;
  readonly admittedCardNames: ReadonlySet<string>;
  readonly generatedObjectPolicy?: ForgeGeneratedObjectPolicy;
}

function confineFormat(backend: ObservedBackend, format: string): ObservedBackend {
  const accepts = (table: SessionSpec): boolean =>
    table.content.kind === 'printed' && table.content.format === format;
  const message = `Printed backend is admitted only for ${format}.`;
  return {
    ...backend,
    supports: (table) => (accepts(table) ? backend.supports(table) : Promise.resolve([message])),
    open: (table) =>
      accepts(table)
        ? backend.open(table)
        : Promise.resolve({
            ok: false,
            error: { kind: 'content-unsupported', backend: backend.id, reasons: [message], message },
          }),
  };
}

async function loadOwnedBackend(
  snapshot: ForgeRuntimeSnapshot,
  format: string,
  admittedCardNames: ReadonlySet<string>,
  generatedObjectPolicy: ForgeGeneratedObjectPolicy | undefined,
  release: () => void,
  unreviewedChoices: 'computer' | undefined,
): Promise<ObservedBackend> {
  const adapter = await import(/* @vite-ignore */ pathToFileURL(snapshot.inputs.adapterBundlePath).href);
  if (typeof adapter.installedForgeAdmittedBackend !== 'function')
    throw new Error('Snapshot adapter has no installedForgeAdmittedBackend export.');
  const load = adapter.installedForgeAdmittedBackend as (
    admittedCardNames: ReadonlySet<string>,
    input: InstalledForgeBackendOptions,
    generatedObjectPolicy?: ForgeGeneratedObjectPolicy,
  ) => ObservedBackend | null;
  if (admittedCardNames.size === 0) throw new Error('Snapshot runtime has no admitted card-name inventory.');
  const create = (): ObservedBackend | null =>
    load(
      admittedCardNames,
      {
        forgeHome: snapshot.inputs.forgeHome,
        compiledBridgeClasses: snapshot.inputs.bridge.path,
        ...(unreviewedChoices === undefined ? {} : { unreviewedChoices }),
      },
      generatedObjectPolicy,
    );
  const probe = create();
  if (probe === null) throw new Error('Snapshot Forge is absent.');
  const backend = isolatedObservedBackend(probe, create, SNAPSHOT_FORGE_REMOVED_MESSAGE);
  let closing: Promise<void> | null = null;
  return confineFormat(
    {
      ...backend,
      shutdown: () => {
        closing ??= (async () => {
          await backend.shutdown?.();
          release();
        })();
        return closing;
      },
    },
    format,
  );
}

function verifyAdmission(
  options: PrintedBackendAdmissionInput,
  identity: ForgeRuntimeSnapshot['identity'],
): RefusedPrintedBackend | VerifiedPrintedBackend {
  if (options.evidence === null) return { admitted: false, reasons: [{ code: 'missing-evidence' }] };
  const format = parsePrintedFormat(options.format);
  const artifact = PrintedPlayAdmissionSchema.parse(JSON.parse(options.evidence.body));
  try {
    const verdict = verifyPrintedFormatPlayAdmission(
      options.evidence.body,
      format,
      options.catalogs,
      identity,
      options.evidence.read,
    );
    if (!verdict.admitted) return { admitted: false, reasons: verdict.reasons };
    return {
      admitted: true,
      subject: {
        ...identity,
        formatId: format.id,
        formatSha256: format.contentSha256,
        catalogs: Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
      },
      formatId: format.id,
      admittedCardNames: new Set(
        options.catalogs.flatMap((catalog) =>
          parsePrintedCardCatalog(catalog).cards.map((card) => card.correctedName),
        ),
      ),
      ...(artifact.generatedObjectPolicy === undefined
        ? {}
        : { generatedObjectPolicy: artifact.generatedObjectPolicy }),
    };
  } catch (cause) {
    if (cause instanceof PrintedAdmissionRuntimeMismatchError)
      return { admitted: false, reasons: [{ code: 'runtime-mismatch', detail: cause.message }] };
    throw cause;
  }
}

function sharedRelease(snapshot: ForgeRuntimeSnapshot, ownerCount: number): () => void {
  let remaining = ownerCount;
  return () => {
    if (remaining === 0) return;
    remaining -= 1;
    if (remaining === 0) snapshot.dispose();
  };
}

export async function admitPrintedBackends(options: {
  readonly runtime: ForgeRuntimeIdentityOptions;
  readonly outputParent: string;
  readonly admissions: readonly PrintedBackendAdmissionInput[];
  /** The lab's choice (#66): on Commander and Momir tables Forge's AI answers an unreviewed choice. */
  readonly unreviewedChoices?: 'computer';
}): Promise<readonly Result[]> {
  if (options.admissions.every((admission) => admission.evidence === null))
    return options.admissions.map(() => ({ admitted: false, reasons: [{ code: 'missing-evidence' }] }));
  if (options.runtime.bridge.kind !== 'compiled')
    throw new Error('Printed admission requires a compiled bridge.');
  const snapshot = createForgeRuntimeSnapshot({ ...options.runtime, outputParent: options.outputParent });
  let verified: readonly (RefusedPrintedBackend | VerifiedPrintedBackend)[];
  try {
    verified = options.admissions.map((admission) => verifyAdmission(admission, snapshot.identity));
    if (!isDeepStrictEqual(measureForgeRuntime(snapshot.inputs), snapshot.identity))
      throw new Error('Printed admission runtime changed during evidence verification.');
  } catch (cause) {
    snapshot.dispose();
    throw cause;
  }
  const prepared = verified.flatMap((result) => (result.admitted ? [result] : []));
  if (prepared.length === 0) {
    snapshot.dispose();
    return verified.flatMap((result) => (result.admitted ? [] : [result]));
  }
  const release = sharedRelease(snapshot, prepared.length);
  let loaded: readonly ObservedBackend[] = [];
  try {
    let results: readonly Result[] = [];
    for (const result of verified) {
      if (!result.admitted) {
        results = [...results, result];
        continue;
      }
      const backend = await loadOwnedBackend(
        snapshot,
        result.formatId,
        result.admittedCardNames,
        result.generatedObjectPolicy,
        release,
        options.unreviewedChoices,
      );
      loaded = [...loaded, backend];
      results = [...results, { admitted: true, subject: result.subject, backend }];
    }
    return results;
  } catch (cause) {
    for (let index = loaded.length; index < prepared.length; index += 1) release();
    const settlements = await Promise.allSettled(loaded.map((backend) => backend.shutdown?.()));
    const failures = settlements.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (failures.length > 0)
      throw new AggregateError([cause, ...failures], 'printed admission and cleanup failed');
    throw cause;
  }
}

export async function admitPrintedBackend(options: Options): Promise<Result> {
  const [result] = await admitPrintedBackends({
    runtime: options.runtime,
    outputParent: options.outputParent,
    admissions: [options],
  });
  if (result === undefined) throw new Error('Printed admission produced no result.');
  return result;
}
