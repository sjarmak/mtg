/**
 * Does every committed printed admission still bind the tree it sits in?
 *
 * An admission pins the Forge bridge and the Node adapter bundle by hash, and
 * the launcher refuses a format on `runtime mismatch` when either moved. That
 * refusal used to surface only at boot, or in an opt-in Forge integration test,
 * so two bridge changes shipped with every printed set silently unplayable.
 * This is the same question answered from bytes alone, with no Forge process
 * and no `javac`, cheap enough for the landing gate.
 *
 * The adapter is measured the way the launcher measures it: one Vite bundle,
 * one SHA-256, compared with `subject.adapterSha256`. The bridge cannot be:
 * `bridgeSha256` covers the compiled class directory. Each admission instead
 * ships the exact `ForgeBridge.java` it was bound against, so the bridge moved
 * exactly when that copy differs from the current source.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { parsePrintedFormatRegistry } from './printed-format-registry';

export const BRIDGE_SOURCE = 'packages/forge-export/bridge/ForgeBridge.java';

const AdmissionSubject = z.object({
  subject: z.object({ bridgeSha256: z.string(), adapterSha256: z.string() }),
});

export interface StaleBinding {
  readonly formatId: string;
  readonly admissionDirectory: string;
  readonly moved: 'bridge' | 'adapter';
  /** What the admission pins (`adapterSha256`) or shipped (the sha of its `ForgeBridge.java` copy). */
  readonly bound: string;
  readonly current: string;
  readonly pinnedSubjectSha256: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every registered format whose installed admission no longer binds the bridge source or the adapter bundle. */
export function staleAdmissionBindings(options: {
  readonly repoRoot: string;
  /** SHA-256 of the adapter bundle built from this tree (`bundleInstalledForgeAdapter`). */
  readonly adapterSha256: string;
}): readonly StaleBinding[] {
  const { repoRoot, adapterSha256 } = options;
  const registry = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'data', 'data', 'printed-formats-v1.json'), 'utf8'),
  ) as unknown;
  const currentBridge = sha256(readFileSync(join(repoRoot, BRIDGE_SOURCE)));
  return parsePrintedFormatRegistry(repoRoot, registry).flatMap((format): readonly StaleBinding[] => {
    const directory = format.admissionDirectory;
    if (directory === undefined) return [];
    const { subject } = AdmissionSubject.parse(
      JSON.parse(readFileSync(join(directory, 'admission.json'), 'utf8')),
    );
    const shipped = sha256(readFileSync(join(directory, BRIDGE_SOURCE)));
    const finding = (
      moved: StaleBinding['moved'],
      bound: string,
      current: string,
      pinned: string,
    ): StaleBinding => ({
      formatId: basename(format.directory),
      admissionDirectory: directory,
      moved,
      bound,
      current,
      pinnedSubjectSha256: pinned,
    });
    return [
      ...(shipped === currentBridge ? [] : [finding('bridge', shipped, currentBridge, subject.bridgeSha256)]),
      ...(subject.adapterSha256 === adapterSha256
        ? []
        : [finding('adapter', subject.adapterSha256, adapterSha256, subject.adapterSha256)]),
    ];
  });
}

export function describeStaleBindings(stale: readonly StaleBinding[]): string {
  return stale
    .map(
      (s) =>
        `${s.formatId}: ${s.moved} moved (admission binds ${s.bound}, tree has ${s.current}; ` +
        `pinned subject ${s.moved === 'bridge' ? 'bridgeSha256' : 'adapterSha256'} ${s.pinnedSubjectSha256})`,
    )
    .join('\n');
}
