/**
 * Own only services started by this launcher, including partial startup.
 *
 * The backend starts first and the tables second, because the table server is
 * handed the backend: a LAN Forge table opens its game on the same composite
 * the gateway serves, and `serveTable` reads that dealer at construction. A
 * table server that started before the backend existed would have nothing to
 * seat a Forge table on.
 */
interface Closable {
  close(): Promise<void>;
}
interface DeckChild {
  kill(): boolean;
}

async function closeServices(
  decks: DeckChild | null,
  tables: Closable | null,
  backend: Closable | null,
): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => {
      decks?.kill();
    }),
    Promise.resolve().then(() => tables?.close()),
    Promise.resolve().then(() => backend?.close()),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, 'play service shutdown failed');
}

export async function startPlayServices<T extends Closable | null, B extends Closable>(options: {
  readonly startDecks: () => DeckChild | null;
  readonly startBackend: () => Promise<B>;
  /** Given the started backend, so a LAN table can open its game on it. */
  readonly startTables: (backend: B) => Promise<T>;
}): Promise<{ readonly tables: T; readonly backend: B; readonly close: () => Promise<void> }> {
  const decks = options.startDecks();
  let backend: B | null = null;
  let tables: T;
  try {
    backend = await options.startBackend();
    tables = await options.startTables(backend);
  } catch (cause) {
    try {
      await closeServices(decks, null, backend);
    } catch (cleanup) {
      const failures = cleanup instanceof AggregateError ? (cleanup.errors as unknown[]) : [cleanup];
      throw new AggregateError([cause, ...failures], 'play service startup and cleanup failed');
    }
    throw cause;
  }
  let closing: Promise<void> | null = null;
  const started = backend;
  return {
    tables,
    backend: started,
    close: () => {
      closing ??= closeServices(decks, tables, started);
      return closing;
    },
  };
}
