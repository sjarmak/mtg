/**
 * Where saved decks are kept, and who is holding them right now.
 *
 * `./saved-decks.ts` holds the document and one browser's copy of it. That copy
 * was the whole store until `mtg-j1rg`, and it states its own costs: clearing
 * site data loses every deck, a second browser sees none of them, a private
 * window refuses the write outright, and nothing on the machine can back it up
 * because nothing on the machine can read it. `@mtg/decklab`'s deck library is
 * the durable half — files under `out/deck-library/`, one per deck, written by a
 * process that survives the tab — and `npm run play` now starts it beside the
 * lab. This module is the page's side of that arrangement.
 *
 * # The server is canonical when it answers, and the browser is the mirror
 *
 * Not the other way around, and not a merge with rules. A machine that keeps
 * files is the thing a person can back up, copy between browsers and look at;
 * the browser copy exists so the first paint is instant and so the decks are
 * still there when the lab is opened without the server. Every read prefers the
 * server; every write goes to both.
 *
 * The one thing that is a merge is the *first* read after the library appears:
 * a deck this browser has and the server has not is uploaded rather than
 * dropped, because that is exactly the deck somebody saved before this existed.
 * The cost of having no tombstones is stated rather than hidden: a deck deleted
 * on the server while this browser still holds a copy comes back on the next
 * refresh. Deleting from this page removes both, so that is a two-browser race
 * rather than the ordinary path, and losing a delete is the cheaper mistake of
 * the two available.
 *
 * # A missing server is a state, not a failure
 *
 * The rule `workbench/client.ts` states for the workbench, restated for the
 * library because the consequence here is louder: the Decks tab must open, list
 * and save with nothing behind the proxy. So every answer is a value, the page
 * says which of the two is keeping the decks, and nothing throws.
 *
 * # A server write that fails is reported
 *
 * `failure` is the one channel this module has for "the browser has it and the
 * machine has not", and the panel draws it. A library that silently drops a save
 * is the bug the lane exists to remove, so it is not allowed to be silent even
 * when the local copy makes it survivable.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { deckApiCall } from './workbench/client';
import {
  SAVED_DECKS_KEY,
  SavedDeckSchema,
  readSavedDecks,
  withSaved,
  withoutSaved,
  writeSavedDecks,
} from './saved-decks';
import type { SavedDeck } from './saved-decks';
import { readStored } from './local-store';

/** Who is holding the decks, and — when it is only this browser — why. */
export type Keeper =
  { readonly kind: 'server' } | { readonly kind: 'browser'; readonly reason: string | null };

export interface Keeping {
  /** Every saved deck, newest first. The list both panels read. */
  readonly decks: readonly SavedDeck[];
  readonly keeper: Keeper;
  /** What the deck library refused, when it refused something. Usually null. */
  readonly failure: string | null;
}

export const KEPT_BY_SERVER_NOTE =
  'Saved decks are kept by this machine, so they survive this browser and can be backed up.';

export const KEPT_BY_BROWSER_NOTE =
  'Saved decks are kept by this browser only: clearing site data loses them and another browser will ' +
  'not see them. Start the lab with `npm run play` to have the machine keep them instead.';

/** Mirrors the `DeckShelf` `@mtg/decklab`'s `workbench/library-store.ts` lists. */
const ShelfSchema = z.object({
  decks: z.array(SavedDeckSchema),
  unreadable: z.array(z.object({ file: z.string(), reason: z.string() })),
});

const SavedSchema = z.object({ saved: z.string() });
const DeletedSchema = z.object({ deleted: z.string() });

const listeners = new Set<() => void>();

/**
 * Null until something asks, so a test that clears `localStorage` and calls
 * `resetDeckKeeping` gets the browser it just made rather than the one the
 * module loaded into. After that it is one object, replaced whole on every
 * change: `useSyncExternalStore` compares snapshots by identity.
 */
let snapshot: Keeping | null = null;

/**
 * The browser's stored list exactly as it was when the snapshot was made.
 *
 * The snapshot is not the only writer of that store: another tab of the lab
 * writes it, and so does anything that calls `writeSavedDecks` directly. So the
 * read below compares the raw text and rebuilds when it has moved, which keeps
 * this store honest about the one thing it does not own without polling and
 * without a new object on every render — `useSyncExternalStore` compares
 * snapshots by identity, so a fresh object per read would never stop rendering.
 */
let storedRaw: string | null = null;

/** The refresh every consumer shares, so mounting three panels reads once. */
let opened: Promise<Keeping> | null = null;

function publish(next: Keeping): Keeping {
  snapshot = next;
  storedRaw = readStored(SAVED_DECKS_KEY);
  for (const listener of listeners) listener();
  return next;
}

export function deckKeeping(): Keeping {
  const raw = readStored(SAVED_DECKS_KEY);
  if (snapshot === null) {
    storedRaw = raw;
    snapshot = { decks: readSavedDecks(), keeper: { kind: 'browser', reason: null }, failure: null };
    return snapshot;
  }
  if (raw !== storedRaw) {
    storedRaw = raw;
    snapshot = { ...snapshot, decks: readSavedDecks() };
  }
  return snapshot;
}

export function subscribeDeckKeeping(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the server, the snapshot and the one-refresh latch. */
export function resetDeckKeeping(): void {
  snapshot = null;
  storedRaw = null;
  opened = null;
}

function newestFirst(decks: readonly SavedDeck[]): readonly SavedDeck[] {
  return [...decks].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

/**
 * Reads the library, and reconciles this browser against it.
 *
 * Safe to call again: the upload is driven by what the server is missing, so a
 * second refresh with nothing new sends nothing.
 */
export async function refreshDeckKeeping(): Promise<Keeping> {
  const answer = await deckApiCall('/decks', ShelfSchema);
  if (answer.kind !== 'ok') {
    return publish({
      decks: readSavedDecks(),
      keeper: { kind: 'browser', reason: answer.message },
      failure: null,
    });
  }

  const remote = answer.value.decks;
  const known = new Set(remote.map((entry) => entry.id));
  const onlyHere = readSavedDecks().filter((entry) => !known.has(entry.id));
  const merged = newestFirst([...remote, ...onlyHere]);
  // A refused local write is not a failure here: the server is holding these.
  writeSavedDecks(merged);
  const keeping = publish({ decks: merged, keeper: { kind: 'server' }, failure: null });
  for (const deck of onlyHere) void keepOnServer(deck);
  return keeping;
}

/**
 * Saves a deck, and answers whether anything kept it.
 *
 * False means neither store took it, which is a private window with no deck
 * server: the deck is on screen and nothing else. True with the server holding
 * it and the browser refusing is still true — the deck survives the tab, which
 * is the promise the panel makes — and a server that then refuses lands in
 * `failure` rather than in this return, because it happens after the answer.
 */
export function keepDeck(deck: SavedDeck): boolean {
  const current = deckKeeping();
  const onServer = current.keeper.kind === 'server';
  // Read the store rather than the snapshot: two tabs of the lab share one
  // `localStorage`, and writing a list read at mount drops whatever the other
  // tab saved since. `./SavedDecksPanel.ts` has always done this.
  const next = withSaved(readSavedDecks(), deck);
  const kept = writeSavedDecks(next);
  if (!kept && !onServer) return false;
  publish({ ...current, decks: kept ? next : withSaved(current.decks, deck), failure: null });
  if (onServer) void keepOnServer(deck);
  return true;
}

/** Removes a deck from both stores. False means neither store changed. */
export function dropDeck(id: string): boolean {
  const current = deckKeeping();
  const onServer = current.keeper.kind === 'server';
  const next = withoutSaved(readSavedDecks(), id);
  const kept = writeSavedDecks(next);
  if (!kept && !onServer) return false;
  publish({ ...current, decks: kept ? next : withoutSaved(current.decks, id), failure: null });
  if (onServer) void dropOnServer(id);
  return true;
}

async function keepOnServer(deck: SavedDeck): Promise<void> {
  const answer = await deckApiCall(`/decks/${encodeURIComponent(deck.id)}`, SavedSchema, {
    method: 'PUT',
    body: deck,
  });
  report(answer.kind === 'ok' ? null : answer.message);
}

async function dropOnServer(id: string): Promise<void> {
  const answer = await deckApiCall(`/decks/${encodeURIComponent(id)}`, DeletedSchema, { method: 'DELETE' });
  report(answer.kind === 'ok' ? null : answer.message);
}

/**
 * What a finished server write did to the state of the library.
 *
 * A failure demotes the keeper as well as naming itself: the machine did not
 * take that deck, so saying it is kept there is a claim the page cannot make
 * about the next one either. A success after a failure says so by clearing it.
 */
function report(failure: string | null): void {
  const current = deckKeeping();
  if (failure === null) {
    if (current.failure !== null) publish({ ...current, failure: null });
    return;
  }
  publish({ ...current, keeper: { kind: 'browser', reason: failure }, failure });
}

/**
 * The library, for a component: the list, who keeps it, and one refresh.
 *
 * Every consumer shares the one refresh and the one snapshot, which is the whole
 * reason this is a module store rather than state in `./DeckLibrary.ts`: the
 * tile grid and the save panel are in different subtrees of the Decks tab and
 * both have to see a deck the moment it is saved.
 */
export function useDeckKeeping(): Keeping {
  useEffect(() => {
    opened ??= refreshDeckKeeping();
    void opened;
  }, []);
  return useSyncExternalStore(subscribeDeckKeeping, deckKeeping, deckKeeping);
}
