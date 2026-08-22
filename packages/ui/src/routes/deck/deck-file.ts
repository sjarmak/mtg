/**
 * A deck as text: the one shape in which a deck leaves the browser it was built
 * in.
 *
 * `./saved-decks.ts` keeps a built deck in `localStorage` and its own docblock
 * names the three costs of that — per browser, per origin, gone with the site
 * data — and says the answer is a file. This is the file. Everything else in
 * this module follows from one question that has no comfortable answer, so it is
 * settled here rather than left implied at the call sites.
 *
 * # The id is the key and the name is the check
 *
 * A build is counts by DSL **id**: that is what `./build.ts` reopens against the
 * pool, and it is the only thing that makes a round trip exact. A person writing
 * a decklist writes **names**. Those pull in opposite directions and the format
 * carries both rather than choosing:
 *
 *     4 Emberwake Scout [tgr-emberwake-scout]
 *
 * The bracketed id is what `resolveDeckFile` reads first, so a file this page
 * wrote reopens as the same deck even if the set has since renamed the card. The
 * name is what a refusal says out loud — `tgr-emberwake-scout` is not a sentence
 * anybody can act on — and it is the fallback: **delete the brackets, or never
 * type them, and the name is matched against the staged set instead.** That is
 * the whole of the hand-typed grammar. A pasted list with no ids is an ordinary
 * input, not a degraded one.
 *
 * The two are not allowed to disagree quietly. When an id resolves to a card the
 * set now prints under a different name, the resolution says so (`renamed`); the
 * id still wins, because the id is the card.
 *
 * # Nothing is dropped in silence
 *
 * A line that names no card in the staged set, or names one that two cards
 * answer to, refuses the **whole** list and says which lines. Two reasons. A
 * decklist is a claim about sixty cards and a fifty-seven-card deck under the
 * same name loses a game before anybody notices; and unlike a saved deck, the
 * text is *right there on screen and editable*, so the repair a person wants is
 * to fix the three lines and press Load again rather than to accept a lossy
 * import. The lossy path exists where there is no text to edit — a saved deck in
 * the list, opened through `restoreBuild`'s `what-is-left` mode.
 *
 * # Basics are written by name and carry no id
 *
 * `./build.ts` refuses to add a basic land through the pool for a stated reason,
 * and a saved deck keeps its mana base as counts by color rather than as
 * entries. So the five basic land names are read as the mana base wherever they
 * appear, whatever id follows them, and are written without one. A decklist that
 * says `12 Island` means twelve Islands in every client that has ever printed
 * one, and that is also what this means.
 *
 * A list with no basic line at all restores the state `./build.ts` calls `null`
 * — the mana base was never counted out and the lab suggests one — rather than
 * five zeroes, which is a different deck.
 */
import { BASIC_LAND_FOR_COLOR, BASIC_LAND_TYPES, COLORS } from '@mtg/dsl';
import type { BasicLandType, Card } from '@mtg/dsl';
import type { SavedDeck, SavedDeckBasic, SavedDeckEntry } from './saved-decks';
import { SAVED_DECK_VERSION } from './saved-decks';

/**
 * Bumped when the grammar below changes in a way an older reader would get
 * wrong. It is written into the file's header comment rather than into a field,
 * because a person hand-typing a list will not type a version and must not have
 * to.
 */
export const DECK_FILE_FORMAT = 1;

/** The one header the grammar reads. Everything else on a `Key: value` line is refused. */
const NAME_HEADER = 'name';

/** One line of a list, before anything has been matched against a set. */
export interface DeckFileLine {
  readonly count: number;
  readonly name: string;
  /** The bracketed id, or null when the line was written without one. */
  readonly id: string | null;
}

/** A list, parsed but not yet resolved against any pool. */
export interface DeckFileDocument {
  /** The `Name:` header, or null when the list did not carry one. */
  readonly name: string | null;
  readonly lines: readonly DeckFileLine[];
  /** The basic lands the list counted out, or null when it named none. */
  readonly basics: readonly SavedDeckBasic[] | null;
}

export type DeckFileParse =
  | { readonly ok: true; readonly document: DeckFileDocument }
  | { readonly ok: false; readonly message: string };

/** A line whose id resolved to a card the staged set prints under another name. */
export interface DeckFileRename {
  readonly wrote: string;
  readonly nowCalled: string;
}

export type DeckFileResolution =
  | {
      readonly ok: true;
      readonly deck: SavedDeck;
      readonly renamed: readonly DeckFileRename[];
      /** Names that carried no usable id and were matched against the set by name. */
      readonly byName: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

const BASIC_NAMES = new Map<string, BasicLandType>(
  BASIC_LAND_TYPES.map((type) => [type.toLowerCase(), type]),
);

/**
 * `['a','b','c']` → `'a, b and c'`.
 *
 * `./saved-decks.ts` and `../DeckRoute.ts` each hold their own copy and each
 * says why it is not imported from the other; this is the third, and the rule of
 * three does not fire on it because the two existing copies are refusals to
 * close a cycle rather than an accident. Importing this one *from* saved-decks
 * would point the arrow the way this module already points, which is the safe
 * direction — but saved-decks is the older module and would then depend on the
 * file format for a line of prose, which is the dependency this module exists to
 * keep out of it.
 */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${String(names[names.length - 1])}`;
}

function countPhrase(cards: number): string {
  return `${String(cards)} ${cards === 1 ? 'card' : 'cards'}`;
}

/**
 * The list as text.
 *
 * Takes the three parts rather than a `SavedDeck`, because the deck a person
 * wants to hand somebody is usually the one on screen under whatever is in the
 * name box, which has not been saved and has no id or timestamp. `toDeckFile`
 * next door is the same call for a deck that has been.
 *
 * The header is a comment block because a comment is the one thing every
 * decklist format in the world already ignores: a list written here and pasted
 * into another tool loses the explanation and keeps the cards.
 */
export function formatDeckFile(
  name: string,
  entries: readonly SavedDeckEntry[],
  basics: readonly SavedDeckBasic[] | null,
): string {
  const spells = entries.reduce((sum, entry) => sum + entry.count, 0);
  const lands = (basics ?? []).reduce((sum, basic) => sum + basic.count, 0);
  const lines: string[] = [
    `# A deck from the lab, file format ${String(DECK_FILE_FORMAT)}.`,
    '# A line is a count, the card name, and in brackets the id that reopens it',
    '# exactly. Drop the brackets and the name is matched against the staged set',
    '# instead, which is how a hand-typed list loads. A basic land is written by',
    '# name and needs no id.',
    '',
  ];
  if (name.trim() !== '') lines.push(`Name: ${name.trim()}`, '');
  for (const entry of entries) lines.push(`${String(entry.count)} ${entry.name} [${entry.id}]`);
  if (basics !== null && basics.length > 0) {
    lines.push('');
    for (const basic of basics) {
      lines.push(`${String(basic.count)} ${BASIC_LAND_FOR_COLOR[basic.color]}`);
    }
  }
  lines.push(
    '',
    basics === null
      ? `# ${countPhrase(spells)}, and no mana base was counted out: the lab suggests one.`
      : `# ${countPhrase(spells + lands)}, ${String(lands)} of them basic lands.`,
    '',
  );
  return lines.join('\n');
}

/** The same text for a deck that has been saved, which already holds its name. */
export function toDeckFile(deck: SavedDeck): string {
  return formatDeckFile(deck.name, deck.entries, deck.basics);
}

/**
 * A file name for a saved list. Nothing but lowercase letters, digits and
 * hyphens survives, because this string is handed to a filesystem that is not
 * this machine's.
 */
export function deckFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `${slug === '' ? 'deck' : slug}.deck.txt`;
}

/**
 * `4 Emberwake Scout [tgr-emberwake-scout]`, and the variants a person types.
 *
 * The count leads and is required. `4x Name` and `4 x Name` are the same line —
 * every client that exports a decklist writes one of the three — and the id, if
 * it is there at all, is the last bracketed run on the line. A bare name with no
 * count is deliberately *not* a card line: it would make every typo and every
 * stray section marker into a card, which is the one thing this format promises
 * not to do.
 */
const CARD_LINE = /^(\d+)\s*[xX]?\s+(.+?)(?:\s*\[([^\]]+)\])?$/u;

const HEADER_LINE = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/u;

/**
 * Text to a document, or a refusal naming the line it could not read.
 *
 * Blank lines and `#` comments are dropped. Everything else is a header or a
 * card line, and anything that is neither stops the parse: a list is a claim
 * about a whole deck, so a line nobody can read means the deck on the page would
 * not be the deck in the file.
 */
export function parseDeckFile(text: string): DeckFileParse {
  const lines: DeckFileLine[] = [];
  const basics = new Map<BasicLandType, number>();
  let name: string | null = null;
  let sawBasic = false;
  const rows = text.split(/\r?\n/u);
  for (let index = 0; index < rows.length; index += 1) {
    const row = (rows[index] ?? '').trim();
    if (row === '' || row.startsWith('#')) continue;
    const number = index + 1;
    const card = CARD_LINE.exec(row);
    if (card === null) {
      const header = HEADER_LINE.exec(row);
      if (header !== null && header[1]?.trim().toLowerCase() === NAME_HEADER) {
        const value = (header[2] ?? '').trim();
        if (value !== '') name = value;
        continue;
      }
      return {
        ok: false,
        message:
          `Line ${String(number)} is not a card: “${row}”. A card line is a count, ` +
          `then the card's name, and optionally its id in square brackets.`,
      };
    }
    const count = Number.parseInt(card[1] ?? '', 10);
    const written = (card[2] ?? '').trim();
    if (count <= 0) {
      return {
        ok: false,
        message: `Line ${String(number)} plays ${String(count)} copies of “${written}”. Delete the line instead.`,
      };
    }
    const basic = BASIC_NAMES.get(written.toLowerCase());
    if (basic !== undefined) {
      sawBasic = true;
      basics.set(basic, (basics.get(basic) ?? 0) + count);
      continue;
    }
    lines.push({ count, name: written, id: card[3]?.trim() ?? null });
  }
  if (lines.length === 0 && !sawBasic) {
    return { ok: false, message: 'That list names no cards. Paste a decklist, or open a file.' };
  }
  const counted: SavedDeckBasic[] = COLORS.map((color) => ({
    color,
    count: basics.get(BASIC_LAND_FOR_COLOR[color]) ?? 0,
  })).filter((entry) => entry.count > 0);
  return { ok: true, document: { name, lines, basics: sawBasic ? counted : null } };
}

/** Every card in the pool that answers to a name, case ignored. */
function byName(pool: readonly Card[]): ReadonlyMap<string, readonly Card[]> {
  const found = new Map<string, Card[]>();
  for (const card of pool) {
    const key = card.name.toLowerCase();
    const held = found.get(key);
    if (held === undefined) found.set(key, [card]);
    else held.push(card);
  }
  return found;
}

/**
 * A parsed list against the pool that is staged now, as a saved deck, or a
 * refusal naming what it could not find.
 *
 * The result is a `SavedDeck` rather than a build, so the import path ends where
 * the load path already starts: `restoreBuild` is what turns either of them into
 * something the builder can hold, and the copy limit, the basics and the
 * refusals are checked in exactly one place for both.
 */
export function resolveDeckFile(
  pool: readonly Card[],
  document: DeckFileDocument,
  id: string,
  savedAt: string,
): DeckFileResolution {
  const held = new Map(pool.map((card) => [card.id, card]));
  const named = byName(pool);
  const counts = new Map<string, { card: Card; count: number }>();
  const renamed: DeckFileRename[] = [];
  const resolvedByName: string[] = [];
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const line of document.lines) {
    const byId = line.id === null ? undefined : held.get(line.id);
    let card = byId;
    if (byId === undefined) {
      const candidates = named.get(line.name.toLowerCase()) ?? [];
      if (candidates.length > 1) {
        ambiguous.push(line.name);
        continue;
      }
      card = candidates[0];
      if (card === undefined) {
        missing.push(line.name);
        continue;
      }
      resolvedByName.push(line.name);
    } else if (byId.name.toLowerCase() !== line.name.toLowerCase()) {
      renamed.push({ wrote: line.name, nowCalled: byId.name });
    }
    if (card === undefined) continue;
    const already = counts.get(card.id);
    counts.set(card.id, { card, count: (already?.count ?? 0) + line.count });
  }
  if (missing.length > 0 || ambiguous.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `The staged set does not hold ${nameList(missing)}. Fix those lines or delete them, then load again.`,
      );
    }
    if (ambiguous.length > 0) {
      parts.push(
        `More than one card in the staged set is called ${nameList(ambiguous)}. ` +
          `Write the id in brackets to say which.`,
      );
    }
    return { ok: false, message: parts.join(' ') };
  }
  const entries: SavedDeckEntry[] = [...counts.values()].map(({ card, count }) => ({
    id: card.id,
    name: card.name,
    count,
  }));
  return {
    ok: true,
    deck: {
      version: SAVED_DECK_VERSION,
      id,
      name: document.name ?? 'Imported deck',
      savedAt,
      entries,
      basics: document.basics,
    },
    renamed,
    byName: resolvedByName,
  };
}

/**
 * What a successful load has to say for itself beyond the cards.
 *
 * Empty when the file and the set agree on every line, which is the ordinary
 * case and deserves no sentence. The two things worth saying are both about the
 * id-versus-name seam: a name that had to stand in for a missing id, and an id
 * that outlived the name written beside it.
 */
export function resolutionNotes(
  renamed: readonly DeckFileRename[],
  matchedByName: readonly string[],
): readonly string[] {
  const notes: string[] = [];
  if (matchedByName.length > 0) {
    notes.push(
      `${nameList([...matchedByName])} carried no id this set knows, so ${matchedByName.length === 1 ? 'it was' : 'they were'} matched by name.`,
    );
  }
  for (const rename of renamed) {
    notes.push(
      `This set calls “${rename.wrote}” ${rename.nowCalled} now; the id says they are the same card.`,
    );
  }
  return notes;
}
