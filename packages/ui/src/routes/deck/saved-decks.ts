/**
 * A built deck, kept by name, so closing the tab does not lose it.
 *
 * The playtester, 2026-08-20: "I want to make sure that in the deck builder option we
 * have the option to save and name a given deck". Until now the Constructed
 * build lived in `ConstructedGame`'s `useState` and nothing wrote it anywhere.
 *
 * # Where it is kept, and why there
 *
 * `localStorage`, on the browser this page is open in. The lab is a static page
 * Vite serves off a staged set: there is no backend to POST to, no session, and
 * no account, and `npm run play` is expected to work on a checkout with no API
 * key and no network. Every other durable choice this page makes already lives
 * there (`./view-mode.ts`, `../play/rail-collapse.ts`), and the store is reached
 * through the same guarded accessor for the same two reasons.
 *
 * The costs are real and are stated rather than hidden: the decks are per
 * browser and per origin, a cleared site-data wipes them, and nothing syncs.
 * Exporting a deck to a file is the answer to all three and it is a separate
 * thing to build; this is the one that turns "closing the tab loses the deck"
 * into "closing the tab does not".
 *
 * # Why this is not the deck artifact
 *
 * `../../lab/deck-artifact.ts` is the obvious candidate and it does not fit. It
 * is `@mtg/decklab`'s document about *real printings chosen from the card
 * store*: it requires the prompt the deck was asked for, the criteria it was
 * held to, a per-card `reason`, a price, a `universeSize`, and a mana-base
 * report with castability per color. A deck built by clicking cards out of a
 * staged set has none of those, so writing one would mean inventing a prompt
 * nobody typed and a reason nobody gave for every card — a document that reads
 * like evidence and is fabricated.
 *
 * It also loses the only thing reloading needs. An artifact entry keys a card by
 * `name`, because a Scryfall printing has no id this page can resolve; a build
 * is counts by DSL card **id**, which is what `./build.ts` reopens against the
 * pool. So a saved deck is the build's own shape — id, count and the set's own
 * name for the card — and stays a separate, much smaller contract.
 *
 * # What happens when the staged set changes underneath a saved deck
 *
 * It refuses to load, and names the cards. A set is regenerated between sessions
 * and card ids do not survive that; a load that quietly dropped the three cards
 * the new set no longer prints would hand back a 57-card deck under the name of
 * a 60-card one, and the person would find out by losing a game. So the refusal
 * is the feature: the saved deck stays in the list untouched, the build on
 * screen is left alone, and the message says which cards the staged set no
 * longer holds.
 *
 * The refusal is still the default and is not weakened, but it is no longer the
 * only outcome available. `restoreBuild` takes a mode, and `'what-is-left'` is
 * the repair path: it opens the cards the staged set still holds and hands back
 * the ones it dropped so the caller can name them on screen. It is a *mode*
 * rather than a fallback for one reason — a person has to choose it, having read
 * which cards are gone — and the saved deck is not written by it, so the
 * untouched sixty are still there to open against the right set tomorrow.
 */
import { z } from 'zod';
import { BASIC_LAND_COLOR, COLORS } from '@mtg/dsl';
import { SET_ORIGINS } from '../../lab/set-origin';
import type { Card, Color } from '@mtg/dsl';
import { addCopy, copiesOf, emptyBuild } from './build';
import type { ConstructedBuild } from './build';
import type { DeckSetRef } from './library';
import { readStored, writeStored } from './local-store';

/**
 * Must be bumped whenever the shape below changes. A stored deck at another
 * version fails the schema and is dropped by `readSavedDecks`, which is the
 * honest outcome: the alternative is a half-read deck that plays wrong.
 */
export const SAVED_DECK_VERSION = 1;

/** Where the list lives, in the namespace the deck tab's other preference uses. */
export const SAVED_DECKS_KEY = 'mtg.deck.saved';

/**
 * One card in a saved deck.
 *
 * The name rides along beside the id although the id is what reopens the deck,
 * because the id is the only thing that can go stale and the name is the only
 * thing a refusal can say out loud. `xmp-emberwake-scout` is not a sentence
 * anybody can act on.
 */
const SavedEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  count: z.int().min(1),
});

/**
 * The basics as a list rather than a record, so the document says exactly which
 * colors were counted out. `null` means the build never overrode the computed
 * mana base, which `./build.ts` treats as a state of its own rather than as five
 * zeroes — reloading it re-suggests the base, which is what the deck had.
 *
 * # Why the printing is recorded beside the count
 *
 * `mtg-t7ez`. A color and a number cannot say *which* Plains, and the pool a
 * deck is reopened against is the union of every staged set, so the count alone
 * was answered by whichever Plains that union offers first — M11's, on this
 * machine, in a deck cut from the flagship set alone. Every land on the board
 * then drew the labeled pending frame, because the flagship's art manifest has
 * no key for `m11-plains`. It is the same failure `ConstructedBuild.set` and
 * `Variation.basics` already carry an id for, one store further out.
 *
 * Optional, and for `SavedSetSchema`'s reason: a deck written before this change
 * still parses and still opens, where a `SAVED_DECK_VERSION` bump would have
 * dropped every deck already in every browser to gain a printing. It is also
 * *only* written when the build knows one. A build assembled by clicking cards
 * carries no printings, and stamping the union's first answer into the document
 * would make a guess durable — the one thing a recorded id is supposed to end.
 * `restoreBuild` resolves those decks through the set the deck names instead.
 */
const SavedBasicSchema = z.object({
  color: z.enum(COLORS),
  count: z.int().min(0),
  id: z.string().min(1).optional(),
});

/**
 * The set the deck was cut from, recorded so the library can shelve it under
 * that set rather than under whichever set happens to be staged today.
 *
 * `mtg-tewc.6` asks for one collection grouped by set, and a deck that carries
 * only card ids cannot say which set those ids came from: `xmp-emberwake-scout`
 * looks exactly like a card of any other set to a reader that has not got that
 * set staged. The origin rides along with the name because the taxonomy above
 * the group is a fact about the *set* (`../../lab/set-origin.ts` decides it off
 * the set document), and the deck list has no set document to read.
 *
 * # Why this did not bump `SAVED_DECK_VERSION`
 *
 * The field is optional, so a deck written before this change still parses and
 * still opens; a version bump would have dropped every deck already in every
 * browser to gain a grouping. An unrecorded set is drawn as exactly what it is —
 * a deck whose set is not known — rather than guessed at from the staged one,
 * which would file somebody's Magic 2011 deck under the flagship set the first
 * time they opened the tab.
 */
const SavedSetSchema = z.object({ name: z.string().min(1), origin: z.enum(SET_ORIGINS) });

/**
 * Which surface the deck came off.
 *
 * `mtg-j1rg` asks for Draft, Sealed and constructed decks to coexist, and
 * coexisting means being told apart: three decks cut from one set with three
 * different histories are three different things to a person looking for one of
 * them. `./library.ts` draws it on the tile.
 *
 * Optional, and absent means `constructed`, which did not bump
 * `SAVED_DECK_VERSION` for the reason `set` did not: every deck saved before
 * this existed came off the constructed builder, because it was the only surface
 * that could save one. A bump would have dropped them all to gain a word.
 */
export const SAVED_SOURCES = ['constructed', 'sealed', 'draft'] as const;
export type SavedDeckSource = (typeof SAVED_SOURCES)[number];

export const SavedDeckSchema = z.object({
  version: z.literal(SAVED_DECK_VERSION),
  /** Stable across renames, which is why the name is not the key. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** ISO 8601, written by the save. Shown so a list of five decks has an order. */
  savedAt: z.string().min(1),
  entries: z.array(SavedEntrySchema).readonly(),
  basics: z.array(SavedBasicSchema).readonly().nullable(),
  /** Absent for a deck saved before the library grouped by set, and only then. */
  set: SavedSetSchema.optional(),
  /** Absent for a deck saved before there was more than one surface to save from. */
  source: z.enum(SAVED_SOURCES).optional(),
});

export type SavedDeck = z.infer<typeof SavedDeckSchema>;
export type SavedDeckEntry = z.infer<typeof SavedEntrySchema>;
export type SavedDeckBasic = z.infer<typeof SavedBasicSchema>;
export type SavedDeckSet = z.infer<typeof SavedSetSchema>;

const SavedDeckListSchema = z.array(SavedDeckSchema);

/** How many cards a saved deck plays, counting copies. */
export function savedCardCount(deck: SavedDeck): number {
  return deck.entries.reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * The colors a saved deck plays, in WUBRG order.
 *
 * Off the saved basics when the build counted them out, and off the staged
 * cards otherwise: a deck saved before its mana base was touched carries
 * `basics: null`, which means "the computed base", not "no colors". Falling
 * back to the cards is what keeps such a deck from being drawn as colorless.
 *
 * Exported (moved from `./DeckLibrary.ts` by `mtg-aay2k`) so the Cards tab's
 * gallery (`../cards/DeckGallery.ts`) can draw the same colors the library
 * does, rather than a second derivation that can drift from this one.
 */
export function savedDeckColors(deck: SavedDeck, cards: readonly Card[] | undefined): readonly Color[] {
  if (deck.basics !== null && deck.basics.length > 0) {
    return COLORS.filter((color) => deck.basics?.some((basic) => basic.color === color && basic.count > 0));
  }
  if (cards === undefined) return [];
  const played = new Set(deck.entries.map((entry) => entry.id));
  const seen = new Set<Color>();
  for (const card of cards) {
    if (!played.has(card.id)) continue;
    for (const color of card.colors) seen.add(color);
  }
  return COLORS.filter((color) => seen.has(color));
}

/**
 * The chosen cards as saved entries, in pool order.
 *
 * Pool order rather than click order, for `chosenCards`' reason: two builds of
 * the same list are the same list, so the same deck saved twice is the same
 * document and the unsaved-changes check below cannot be fooled by the order the
 * cards were added in.
 */
export function savedEntries(build: ConstructedBuild): readonly SavedDeckEntry[] {
  return build.pool
    .map((card) => ({ id: card.id, name: card.name, count: copiesOf(build, card.id) }))
    .filter((entry) => entry.count > 0);
}

/**
 * The basics the build counted out, as the document writes them down.
 *
 * Exported because `./deck-file.ts` writes the same list into a text decklist
 * for a deck that has never been saved, and deriving the mana base a second time
 * there is a second chance for the two to disagree about what `null` means.
 */
export function savedBasics(build: ConstructedBuild): readonly SavedDeckBasic[] | null {
  const chosen = build.basics;
  if (chosen === null) return null;
  const printed = basicPrintings(build.set);
  return COLORS.filter((color) => (chosen[color] ?? 0) > 0).map((color) => {
    const id = printed.get(color);
    return { color, count: chosen[color] ?? 0, ...(id === undefined ? {} : { id }) };
  });
}

/**
 * Which printing the build plays for each basic color, off the list it was
 * handed, or an empty map when it was handed none.
 *
 * First printing of a type wins, which is `setBasics`' own rule read from the
 * other end: that function takes the first card of each type out of the list it
 * mints from, so recording any later one would write down a card the game does
 * not deal.
 */
function basicPrintings(set: readonly Card[] | null): ReadonlyMap<Color, string> {
  const byColor = new Map<Color, string>();
  if (set === null) return byColor;
  for (const card of set) {
    if (card.kind !== 'land' || card.basicLandType === undefined) continue;
    const color = BASIC_LAND_COLOR[card.basicLandType];
    if (!byColor.has(color)) byColor.set(color, card.id);
  }
  return byColor;
}

/**
 * The document a save writes. `savedAt` is passed in so a test is not a clock.
 *
 * `set` is optional at the call site as well as in the document, because the
 * page can be opened on a flat set with no index row behind it and there is then
 * nothing truthful to record. Writing the staged set's name into every save
 * regardless would put a claim in the store that no reader could check.
 */
export function toSavedDeck(
  id: string,
  name: string,
  build: ConstructedBuild,
  savedAt: string,
  set?: SavedDeckSet,
  source?: SavedDeckSource,
): SavedDeck {
  return savedDeckDocument({
    id,
    name,
    savedAt,
    entries: savedEntries(build),
    basics: savedBasics(build),
    ...(set === undefined ? {} : { set }),
    ...(source === undefined ? {} : { source }),
  });
}

/** Everything a saved deck is, minus the version, which is this module's to say. */
export interface SavedDeckFields {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly entries: readonly SavedDeckEntry[];
  readonly basics: readonly SavedDeckBasic[] | null;
  readonly set?: SavedDeckSet;
  readonly source?: SavedDeckSource;
}

/**
 * The one place the document is assembled.
 *
 * `toSavedDeck` above derives the entries and the basics from a Constructed
 * build, and that derivation does not fit the other two surfaces: a Limited pool
 * lists the same card three times, so counting copies off the pool the way
 * `savedEntries` does would record three one-ofs
 * (`../play/keep-limited-deck.ts`). What the two share is the *document*, and it
 * is stamped here so the version is written down once — a second constructor
 * spelling out `version: SAVED_DECK_VERSION` is a second thing to remember to
 * bump on the day the shape changes.
 */
export function savedDeckDocument(fields: SavedDeckFields): SavedDeck {
  return {
    version: SAVED_DECK_VERSION,
    id: fields.id,
    name: fields.name,
    savedAt: fields.savedAt,
    entries: fields.entries,
    basics: fields.basics,
    ...(fields.set === undefined ? {} : { set: fields.set }),
    ...(fields.source === undefined ? {} : { source: fields.source }),
  };
}

/**
 * What each source is called where a deck is listed.
 *
 * A deck that records no source is a deck saved before there was more than one
 * surface, which the schema above says means `constructed`; it is labeled as
 * that rather than left blank, because a tile with the word missing reads as a
 * fourth kind of deck rather than as the oldest of the three.
 */
export const SAVED_SOURCE_LABELS: Readonly<Record<SavedDeckSource, string>> = {
  constructed: 'Constructed',
  sealed: 'Sealed',
  draft: 'Draft',
};

/** The source a deck records, with the default the schema states applied. */
export function savedDeckSource(deck: SavedDeck): SavedDeckSource {
  return deck.source ?? 'constructed';
}

/**
 * What a build looks like when it is compared with what was last saved.
 *
 * The name is deliberately not in it. Renaming the open deck is a change and is
 * saved by the same press, but the *deck* is the cards and the mana base, and a
 * pane reading "unsaved changes" because somebody put the cursor in the name box
 * would be crying wolf.
 */
export function deckFingerprint(build: ConstructedBuild): string {
  return JSON.stringify({ entries: savedEntries(build), basics: savedBasics(build) });
}

/**
 * How much of a saved deck a load is willing to take.
 *
 * `'whole'` is the default everywhere and is the behavior the refusal describes.
 * `'what-is-left'` is chosen by a person who has already read the refusal, and
 * it is never reached by any other route.
 */
export type RestoreMode = 'whole' | 'what-is-left';

/** Everything `restoreBuild` reads besides the pool and the deck itself. */
export interface RestoreOptions {
  readonly mode?: RestoreMode;
  /**
   * Which staged set each pool card came from, when the caller knows.
   *
   * `./constructed-pool.ts` builds it, and it is what resolves the basics of a
   * deck saved before the printing was recorded: the deck names its set, this
   * says which pool cards belong to that set, and the two together name the
   * Plains without guessing. Absent is an ordinary state — `./DeckFilePanel.ts`
   * restores a deck parsed out of a text list, which names no set at all — and
   * then a deck with no recorded printing is left to the union's order, which is
   * a deck whose printing is not known rather than one that has been guessed at.
   */
  readonly setOf?: ReadonlyMap<string, DeckSetRef>;
}

export type RestoreResult =
  | {
      readonly ok: true;
      readonly build: ConstructedBuild;
      /** The entries the staged set no longer holds. Empty on a whole restore. */
      readonly omitted: readonly SavedDeckEntry[];
    }
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * The entries that caused a missing-card refusal, so the caller can offer
       * the repair path without deriving the same list a second time. Empty when
       * the refusal was about something `'what-is-left'` cannot fix.
       */
      readonly missing: readonly SavedDeckEntry[];
    };

/**
 * `['a','b','c']` → `'a, b and c'`. `../DeckRoute.ts` exports the same sentence
 * builder and is deliberately not imported: this module is reached *from* that
 * route, so taking it back would close a cycle for one line of prose.
 */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${String(names[names.length - 1])}`;
}

/**
 * Reopens a saved deck against the pool that is staged now, or says why it
 * cannot be.
 *
 * Two refusals, both named, and neither of them silent. A card the staged set no
 * longer prints cannot be played; a card the pool holds but the builder refuses
 * to add — a basic land, or a fifth copy — would come back as a different deck
 * from the one that was saved. The second is unreachable through the screen,
 * because `addCopy` is also what put the copies there; it is checked because a
 * hand-edited store is the one input this function does not control.
 *
 * `mode` moves only the first of those two. `'what-is-left'` drops the cards the
 * staged set does not hold and reports them as `omitted`, which is the repair
 * path a person chooses after reading the refusal; the second refusal stands in
 * both modes, because taking fewer cards cannot make a store that records five
 * copies of one card into a deck this format plays.
 */
export function restoreBuild(
  pool: readonly Card[],
  saved: SavedDeck,
  options: RestoreOptions = {},
): RestoreResult {
  const mode = options.mode ?? 'whole';
  const held = new Set(pool.map((card) => card.id));
  const missing = saved.entries.filter((entry) => !held.has(entry.id));
  if (missing.length > 0 && mode === 'whole') {
    return {
      ok: false,
      missing,
      message:
        `“${saved.name}” plays ${nameList(missing.map((entry) => entry.name))}, ` +
        `which the staged set no longer holds. The deck is left as it was saved; ` +
        `stage the set it was built from, or delete it and build again.`,
    };
  }
  const kept = saved.entries.filter((entry) => held.has(entry.id));
  let build = emptyBuild(pool);
  for (const entry of kept) {
    for (let copy = 0; copy < entry.count; copy += 1) build = addCopy(build, entry.id);
  }
  const refused = kept.filter((entry) => copiesOf(build, entry.id) !== entry.count);
  if (refused.length > 0) {
    // Not repairable by taking less: these copies are in the store and the
    // builder will not hold them, which is a hand-edited store rather than a set
    // that moved on. `missing` is empty so no caller offers a mode that would
    // change nothing.
    return {
      ok: false,
      missing: [],
      message:
        `“${saved.name}” records copies of ${nameList(refused.map((entry) => entry.name))} ` +
        `that this format cannot play. The deck is left as it was saved.`,
    };
  }
  build = { ...build, set: restoredPrintings(pool, saved, options.setOf) };
  if (saved.basics !== null) {
    const basics: Partial<Record<Color, number>> = {};
    for (const basic of saved.basics) basics[basic.color] = basic.count;
    build = { ...build, basics };
  }
  return { ok: true, build, omitted: missing };
}

/**
 * The printings the reopened deck mints its basics from, or `null` when nothing
 * recorded names one.
 *
 * Two sources, most specific first, because they answer different populations.
 * A deck that recorded printing ids is answered by those ids and by nothing
 * else. A deck saved before there were ids — every deck already in every browser
 * on the day `SavedBasicSchema` gained one — names its set, and the set's own
 * basics are in the pool, so the deck's Plains is nameable without a guess. The
 * set route also answers the colors a counted base left out and the deck that
 * never counted a base at all: `setBasics` mints a type this list does not print
 * from the list's dominant set code, so five basics resolve out of one recorded
 * set the same way `./workbench/play.ts` resolves them out of one variation.
 *
 * `null` for a deck with neither, and that is the answer rather than a fallback:
 * the union's order then stands, which is what a deck whose printing is not
 * known should get. It is separate from the missing-card refusal above on
 * purpose — a basic the pool does not hold is not a card the deck loses, because
 * `setBasics` mints one, so an unresolvable printing narrows what this can say
 * and never refuses the deck.
 */
function restoredPrintings(
  pool: readonly Card[],
  saved: SavedDeck,
  setOf: ReadonlyMap<string, DeckSetRef> | undefined,
): readonly Card[] | null {
  const byId = new Map(pool.map((card) => [card.id, card]));
  const printings: Card[] = [];
  const taken = new Set<string>();
  const take = (card: Card | undefined): void => {
    if (card === undefined || taken.has(card.id)) return;
    taken.add(card.id);
    printings.push(card);
  };
  for (const basic of saved.basics ?? []) {
    take(basic.id === undefined ? undefined : byId.get(basic.id));
  }
  const named = saved.set;
  if (named !== undefined && setOf !== undefined) {
    for (const card of pool) {
      if (card.kind !== 'land' || card.basicLandType === undefined) continue;
      const owner = setOf.get(card.id);
      // Both halves, because the taxonomy is part of the name: two sets shelved
      // under different origins are two sets however alike they are called.
      if (owner?.name === named.name && owner.origin === named.origin) take(card);
    }
  }
  return printings.length === 0 ? null : printings;
}

/**
 * What the repair control is called, with the number it would open in it.
 *
 * The number is in the label rather than in a sentence beside it because the
 * whole decision the person is making is whether 57 of 60 is worth having, and a
 * button that says only "Open what is left" makes them count.
 */
export function partialLoadLabel(saved: SavedDeck, missing: readonly SavedDeckEntry[]): string {
  const gone = missing.reduce((sum, entry) => sum + entry.count, 0);
  return `Open the ${String(savedCardCount(saved) - gone)} cards that are left`;
}

/**
 * What a partial load says once it has happened.
 *
 * Three claims, in the order somebody needs them: how much came back, which
 * cards did not, and that the saved deck still holds all of it. The last is the
 * one that makes the mode safe to press — nothing about opening 57 cards writes
 * over the 60 in the store — and it is also the warning that this build is a
 * fork, because saving it under the old name is refused by `nameTaken` and the
 * person should hear why before they meet that message.
 */
export function partialLoadNote(saved: SavedDeck, omitted: readonly SavedDeckEntry[]): string {
  const total = savedCardCount(saved);
  const gone = omitted.reduce((sum, entry) => sum + entry.count, 0);
  return (
    `Opened ${String(total - gone)} of the ${String(total)} cards in “${saved.name}”. ` +
    `${nameList(omitted.map((entry) => entry.name))} ${omitted.length === 1 ? 'is' : 'are'} not in the ` +
    `staged set and ${omitted.length === 1 ? 'was' : 'were'} left out. The saved deck still holds all ` +
    `${String(total)} and is untouched, so keeping this one needs a name of its own.`
  );
}

/**
 * Every saved deck on this browser, newest save first.
 *
 * A stored value that is not a list of saved decks reads as none rather than as
 * an error. The only ways to get one are a hand-edited store or a build that
 * used to write a different shape, and in both cases the useful response is the
 * state a first visit is in — the same call `./view-mode.ts` makes about an
 * unrecognized mode.
 */
export function readSavedDecks(): readonly SavedDeck[] {
  const raw = readStored(SAVED_DECKS_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const decks = SavedDeckListSchema.safeParse(parsed);
  if (!decks.success) return [];
  return [...decks.data].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

/** Writes the whole list. False means the browser refused and nothing is kept. */
export function writeSavedDecks(decks: readonly SavedDeck[]): boolean {
  return writeStored(SAVED_DECKS_KEY, JSON.stringify(decks));
}

/** The deck in the list with this name, ignoring one id — the deck being renamed. */
export function nameTaken(decks: readonly SavedDeck[], name: string, exceptId: string | null): boolean {
  return decks.some((deck) => deck.id !== exceptId && deck.name === name);
}

/** The list with one deck added or replaced in place. */
export function withSaved(decks: readonly SavedDeck[], deck: SavedDeck): readonly SavedDeck[] {
  const known = decks.some((entry) => entry.id === deck.id);
  return known ? decks.map((entry) => (entry.id === deck.id ? deck : entry)) : [deck, ...decks];
}

/** The list without one deck. */
export function withoutSaved(decks: readonly SavedDeck[], id: string): readonly SavedDeck[] {
  return decks.filter((deck) => deck.id !== id);
}

/**
 * An id for a new deck.
 *
 * The clock plus a random suffix rather than a counter, because two tabs of the
 * same page save into one store and a counter read from a list either tab may
 * have already written is how two decks end up sharing an id and one of them
 * disappears.
 */
export function newSavedDeckId(now: number, random: number): string {
  const suffix = Math.floor(random * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `deck-${now.toString(36)}-${suffix}`;
}
