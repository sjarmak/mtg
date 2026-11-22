/** Load a Legacy Cube backend exclusively from an owned, measured runtime snapshot. */
import { pathToFileURL } from 'node:url';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import type { ForgeRuntimeSnapshot, InstalledForgeBackendOptions } from '@mtg/forge-export';
import { isolatedObservedBackend, SNAPSHOT_FORGE_REMOVED_MESSAGE } from './isolated-observed-backend';

function confineFormat(backend: ObservedBackend, format: string): ObservedBackend {
  const accepts = (table: SessionSpec): boolean =>
    table.content.kind === 'printed' && table.content.format === format;
  const message = `Pinned Forge backend is admitted only for ${format}.`;
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

/** The returned backend owns the snapshot and disposes it only after successful shutdown. */
export async function openPinnedInstalledForgeBackend(
  snapshot: ForgeRuntimeSnapshot,
  format: string,
): Promise<ObservedBackend> {
  if (snapshot.inputs.bridge.kind !== 'compiled') {
    throw new Error('Pinned Forge backend requires a compiled bridge snapshot.');
  }
  const adapter = (await import(
    /* @vite-ignore */ pathToFileURL(snapshot.inputs.adapterBundlePath).href
  )) as Partial<{
    installedForgeBackend: (options: InstalledForgeBackendOptions) => ObservedBackend | null;
  }>;
  if (typeof adapter.installedForgeBackend !== 'function') {
    throw new Error('Snapshot adapter has no installedForgeBackend export.');
  }
  const create = (): ObservedBackend | null =>
    adapter.installedForgeBackend!({
      forgeHome: snapshot.inputs.forgeHome,
      compiledBridgeClasses: snapshot.inputs.bridge.path,
    });
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
          snapshot.dispose();
        })();
        return closing;
      },
    },
    format,
  );
}
