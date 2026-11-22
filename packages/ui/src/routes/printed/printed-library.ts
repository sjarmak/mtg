/** Discover the existing replay-backed saves; no index or copied catalog to drift. */
import { PrintedLimitedSessionSchema } from './printed-limited-session';

interface SessionStore {
  readonly length: number;
  readonly key: (index: number) => string | null;
  readonly getItem: (key: string) => string | null;
}
export interface PrintedLibraryEntry {
  readonly key: string;
  readonly mode: 'draft' | 'sealed';
  readonly seed: string;
  readonly cards: number | null;
  readonly picks: number | null;
  readonly issue: string | null;
}
export interface PrintedLibrary {
  readonly entries: readonly PrintedLibraryEntry[];
  readonly error: string | null;
}

function readEntry(
  store: SessionStore,
  key: string,
  mode: PrintedLibraryEntry['mode'],
  seed: string,
  formatId: string,
  fingerprint: string,
): PrintedLibraryEntry {
  const base = { key, mode, seed, cards: null, picks: null };
  // Storage failures belong to the library, not to the saved document.
  const raw = store.getItem(key);
  if (raw === null) return { ...base, issue: 'Saved session is no longer available.' };
  try {
    const session = PrintedLimitedSessionSchema.parse(JSON.parse(raw));
    const identity = session.mode === 'draft' ? session.transcript : session;
    if (session.mode !== mode || identity.formatId !== formatId || identity.seed !== seed) {
      return { ...base, issue: 'Saved session identity does not match its storage key.' };
    }
    if (identity.fingerprint !== fingerprint) {
      return { ...base, issue: 'Saved format fingerprint differs from the staged format.' };
    }
    const cards =
      session.deck === undefined
        ? null
        : session.deck.selectedPhysicalIds.length +
          Object.values(session.deck.basics).reduce((total, count) => total + count, 0);
    const picks = session.mode === 'draft' ? (session.transcript.picks['seat-1']?.length ?? 0) : null;
    return { ...base, cards, picks, issue: null };
  } catch {
    return { ...base, issue: 'Saved session is unreadable. Its stored contents are unchanged.' };
  }
}

/** Listing is cheap; reopening still replays and validates every pick and owned copy. */
export function readPrintedLibrary(formatId: string, fingerprint: string): PrintedLibrary {
  try {
    const store = (globalThis as { readonly localStorage?: SessionStore }).localStorage;
    if (store === undefined) throw new Error('Storage unavailable');
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    const entries = keys.flatMap((key): readonly PrintedLibraryEntry[] => {
      if (key === null) return [];
      for (const mode of ['draft', 'sealed'] as const) {
        const prefix = `mtg.printed.${mode}:${formatId}:`;
        if (key.startsWith(prefix)) {
          return [readEntry(store, key, mode, key.slice(prefix.length), formatId, fingerprint)];
        }
      }
      return [];
    });
    return { entries: [...entries].sort((a, b) => a.key.localeCompare(b.key)), error: null };
  } catch {
    return { entries: [], error: 'Saved sessions could not be read from this browser.' };
  }
}
