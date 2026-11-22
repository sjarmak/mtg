/**
 * A deck the library keeps: the document, as the server writes it down.
 *
 * `mtg-j1rg` asks for a durable deck library that survives a browser and a
 * server restart and says outright that `localStorage` must not be the canonical
 * store. `@mtg/ui`'s `routes/deck/saved-decks.ts` is where that store used to
 * be, and it states its own costs: the decks are per browser and per origin,
 * clearing site data wipes them, and nothing syncs. This is the same document,
 * owned by the process that can keep it.
 *
 * # Why this is not `./variation.ts`
 *
 * A `DeckVariation` is the record of a *model build*: it requires the prompt
 * somebody typed, the criteria the build was held to, the model's plan, a
 * per-card reason and a mana-base report with castability per color. A deck
 * cut by clicking cards out of a staged set, or assembled from a sealed pool,
 * or drafted, has none of those. Writing a variation for one would mean
 * inventing a prompt nobody typed and a reason nobody gave for every card — a
 * document that reads like evidence and is fabricated. That is the argument
 * `saved-decks.ts` already makes about `../artifact.ts`, one document further
 * along, and it does not get weaker by being made twice.
 *
 * So the two shelves stay two shapes on one server: a variation is a build, a
 * library deck is a deck.
 *
 * # Why the schema is restated rather than imported
 *
 * The page has its own copy in `saved-decks.ts` and keeps it. This document
 * crosses a network in both directions, so it is checked on arrival at both
 * ends, which is the arrangement every other surface behind this page already
 * uses (`workbench/client.ts` says so about `WorkbenchSet`). Importing the
 * page's copy is also not available: it would put `@mtg/ui` — React, the
 * kernel, the simulator — in this server's graph to gain one zod object.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';

/**
 * Bumped when a field changes meaning or leaves. A stored deck at another
 * version fails the schema and is reported as unreadable rather than half-read:
 * a deck missing three cards under the name of a sixty-card one is found out by
 * losing a game with it.
 *
 * It matches `SAVED_DECK_VERSION` in the page's `saved-decks.ts` and has to: the
 * documents this store holds are the documents that store wrote, and a library
 * that renumbered them on the way through would strand every deck already saved.
 */
export const LIBRARY_DECK_VERSION = 1;

/**
 * One card: what it is, how many, and the name that rides along beside the id.
 *
 * The name is not the key and is not what reopens the deck. It is here because
 * the id is the only thing that can go stale and the name is the only thing a
 * refusal can say out loud — `xmp-emberwake-scout` is not a sentence anybody can
 * act on.
 */
export const LibraryEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  count: z.int().min(1),
});

/**
 * The basics as a list rather than a record, so the document says exactly which
 * colors were counted out. `null` means the build never overrode the computed
 * mana base, which is a state of its own rather than five zeroes.
 */
export const LibraryBasicSchema = z.object({ color: z.enum(COLORS), count: z.int().min(0) });

/**
 * The origins a set can have, restated from `@mtg/ui`'s `lab/set-origin.ts`.
 *
 * Two words rather than an import, for the reason the file's header gives. The
 * server never interprets them — it shelves nothing and labels nothing — but it
 * validates them, because a value this store accepts is a value the page has to
 * draw, and `official` misspelled here is a deck that vanishes from its shelf.
 */
export const LIBRARY_SET_ORIGINS = ['custom', 'official'] as const;

export const LibrarySetSchema = z.object({
  name: z.string().min(1),
  origin: z.enum(LIBRARY_SET_ORIGINS),
});

/**
 * Where the deck came from.
 *
 * `mtg-j1rg` asks for Draft, Sealed and constructed builds to *coexist*, and
 * coexisting means being told apart on the shelf: three decks off the same set
 * with three different histories are three different things to a person looking
 * for one of them. The tile already draws a deck's provenance
 * (`@mtg/ui`'s `routes/deck/library.ts` keeps kind on the tile and the set on
 * the shelf); this is the field it draws it from.
 *
 * Optional, and absent means `constructed`, for the reason the page's `set`
 * field is optional: every deck saved before this existed came out of the
 * constructed builder, which was the only surface that could save one. A version
 * bump would have dropped them all to gain a word.
 */
export const LIBRARY_SOURCES = ['constructed', 'sealed', 'draft'] as const;
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

export const LibraryDeckSchema = z.object({
  version: z.literal(LIBRARY_DECK_VERSION),
  /** Stable across renames, which is why the name is not the key. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** ISO 8601, written by the save. Shown so a shelf of five decks has an order. */
  savedAt: z.string().min(1),
  entries: z.array(LibraryEntrySchema).readonly(),
  basics: z.array(LibraryBasicSchema).readonly().nullable(),
  /** Absent for a deck saved before the library grouped by set, and only then. */
  set: LibrarySetSchema.optional(),
  /** Absent for a deck saved before there was more than one surface to save from. */
  source: z.enum(LIBRARY_SOURCES).optional(),
});

export type LibraryDeck = z.infer<typeof LibraryDeckSchema>;
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type LibraryBasic = z.infer<typeof LibraryBasicSchema>;
export type LibrarySet = z.infer<typeof LibrarySetSchema>;

/** How many cards a library deck plays, counting copies. Basics are not in it. */
export function libraryCardCount(deck: LibraryDeck): number {
  return deck.entries.reduce((sum, entry) => sum + entry.count, 0);
}
