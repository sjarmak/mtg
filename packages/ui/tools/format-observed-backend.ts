/** Dispatch exact formats to their runtime owners without changing session identities. */
import { isDeepStrictEqual } from 'node:util';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';

interface FormatOwner {
  readonly format: string;
  readonly backend: ObservedBackend;
}

/**
 * Owners must already enforce admission and isolate sessions. This wrapper adds
 * no compatibility claims; it only shares their ID in the gateway registry.
 * Ownership transfers on successful construction, never on validation failure.
 */
export function formatObservedBackend(entries: readonly FormatOwner[]): ObservedBackend {
  const first = entries[0]?.backend;
  if (first === undefined) throw new Error('format backend requires at least one owner');
  const routes = new Map<string, ObservedBackend>();
  for (const { format, backend } of entries) {
    if (format.trim() === '') throw new Error('format backend requires a nonempty format');
    if (routes.has(format)) throw new Error(`duplicate format backend route: ${format}`);
    if (backend.id !== first.id) throw new Error('format backend identity mismatch');
    if (!isDeepStrictEqual(backend.capabilities, first.capabilities))
      throw new Error('format backend capabilities mismatch');
    routes.set(format, backend);
  }
  let closing: Promise<void> | null = null;
  const owner = (table: SessionSpec): ObservedBackend | undefined =>
    closing !== null || table.content.kind === 'dsl-set' ? undefined : routes.get(table.content.format);
  const reason = (): string =>
    closing === null
      ? `No exact format owner in backend ${first.id}.`
      : `Format backend ${first.id} has shut down.`;
  return {
    id: first.id,
    determinism: 'observed',
    capabilities: first.capabilities,
    supports: (table) => owner(table)?.supports(table) ?? Promise.resolve([reason()]),
    open: (table) =>
      owner(table)?.open(table) ??
      Promise.resolve({
        ok: false,
        error: { kind: 'content-unsupported', backend: first.id, reasons: [reason()], message: reason() },
      }),
    shutdown: () => {
      // Schedule child callbacks after publishing the closing state, including
      // when a child throws synchronously or re-enters this wrapper.
      closing ??= Promise.resolve().then(async () => {
        const results = await Promise.allSettled(
          [...new Set(routes.values())].map(async (backend) => {
            await backend.shutdown?.();
          }),
        );
        const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (failures.length > 0) throw new AggregateError(failures, 'format backend shutdown failed');
      });
      return closing;
    },
  };
}
