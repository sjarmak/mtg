// @vitest-environment jsdom
/**
 * A deck leaving the browser it was built in, and coming back.
 *
 * `../../src/routes/deck/saved-decks.ts` keeps a deck for the next visit to
 * *this* browser and says in its own docblock that a file is the answer to the
 * three costs of that. These are the tests for the file.
 *
 * What is asserted here is the round trip and the two ways it is allowed to
 * fail. The round trip is exact — format, parse, resolve, restore, and the
 * fingerprint on the far side is the fingerprint on the near side — because the
 * bracketed id is the key. The hand-typed grammar is asserted just as hard,
 * because a decklist a person can paste is the reason the format is text at all,
 * and a format only this page can read would have been a smaller change and a
 * worse one. And nothing is dropped in silence: a line naming a card the staged
 * set does not hold refuses the whole list and says which line.
 *
 * Pixels are not asserted and cannot be: jsdom performs no layout. What is
 * asserted on the surface is structure and the words a person reads — the note
 * after a partial load says the two numbers and names the cards that went.
 *
 * No card name is typed into this file. Every subject is picked out of the
 * committed prototype set by shape, exactly as the saved-decks suite next door
 * does it, and the few strings that stand in for a name the set does not print
 * are lowercase prose rather than names.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { BUILD_LABEL, DeckRoute } from '../../src/routes/DeckRoute';
import { addCopy, emptyBuild, selectable, spellCount } from '../../src/routes/deck/build';
import { pickedFile, saveTextFile } from '../../src/routes/deck/browser-file';
import {
  deckFileName,
  formatDeckFile,
  parseDeckFile,
  resolutionNotes,
  resolveDeckFile,
  toDeckFile,
} from '../../src/routes/deck/deck-file';
import {
  DECK_TEXT_LABEL,
  LOAD_TEXT_LABEL,
  RESET_TEXT_LABEL,
  SAVE_FILE_LABEL,
} from '../../src/routes/deck/DeckFilePanel';
import { DECK_NAME_LABEL, SAVED_DECKS_TITLE } from '../../src/routes/deck/SavedDecksPanel';
import {
  deckFingerprint,
  partialLoadLabel,
  partialLoadNote,
  readSavedDecks,
  restoreBuild,
  toSavedDeck,
  writeSavedDecks,
} from '../../src/routes/deck/saved-decks';

afterEach(cleanup);

afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
});

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

function subject(at = 0): Card {
  const card = selectable(SET)[at];
  if (card === undefined) throw new Error('the prototype set has no selectable card');
  return card;
}

const DECK_NAME = 'the list I keep coming back to';

/** Two of one card, three of another, and a counted mana base. */
function sampleBuild() {
  let build = addCopy(addCopy(emptyBuild(SET), subject().id), subject().id);
  build = addCopy(addCopy(addCopy(build, subject(1).id), subject(1).id), subject(1).id);
  return { ...build, basics: { U: 9, R: 8 } };
}

function sampleDeck() {
  return toSavedDeck('deck-1', DECK_NAME, sampleBuild(), '2026-08-20T00:00:00.000Z');
}

/** Parse, resolve and restore a list against a pool: the whole import path. */
function importText(pool: readonly Card[], text: string) {
  const parsed = parseDeckFile(text);
  if (!parsed.ok) return { failed: parsed.message } as const;
  const resolved = resolveDeckFile(pool, parsed.document, 'deck-2', '2026-08-20T01:00:00.000Z');
  if (!resolved.ok) return { failed: resolved.message } as const;
  const restored = restoreBuild(pool, resolved.deck);
  if (!restored.ok) return { failed: restored.message } as const;
  return { resolved, build: restored.build } as const;
}

describe('a deck written out as text', () => {
  it('comes back as the same deck, because the bracketed id is the key', () => {
    const text = toDeckFile(sampleDeck());
    const back = importText(SET, text);
    if ('failed' in back) throw new Error(back.failed);
    expect(back.resolved.deck.name).toBe(DECK_NAME);
    expect(deckFingerprint(back.build)).toBe(deckFingerprint(sampleBuild()));
    expect(spellCount(back.build)).toBe(5);
    expect(back.build.basics).toEqual({ U: 9, R: 8 });
    // Nothing had to be guessed at, so the load has nothing to say for itself.
    expect(resolutionNotes(back.resolved.renamed, back.resolved.byName)).toEqual([]);
  });

  it('writes a list a person reads: a count, a name, an id, and basics by their own names', () => {
    const lines = toDeckFile(sampleDeck()).split('\n');
    expect(lines).toContain(`Name: ${DECK_NAME}`);
    expect(lines).toContain(`2 ${subject().name} [${subject().id}]`);
    expect(lines).toContain(`3 ${subject(1).name} [${subject(1).id}]`);
    expect(lines).toContain('9 Island');
    expect(lines).toContain('8 Mountain');
    expect(lines.filter((line) => line.startsWith('#')).length).toBeGreaterThan(0);
  });

  it('says a mana base was never counted out rather than writing five zeroes', () => {
    const build = addCopy(emptyBuild(SET), subject().id);
    const text = toDeckFile(toSavedDeck('deck-1', DECK_NAME, build, '2026-08-20T00:00:00.000Z'));
    const parsed = parseDeckFile(text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.document.basics).toBeNull();
    const back = importText(SET, text);
    if ('failed' in back) throw new Error(back.failed);
    expect(back.build.basics).toBeNull();
  });

  it('names the file after the deck, with nothing a filesystem has to think about', () => {
    expect(deckFileName(DECK_NAME)).toBe('the-list-i-keep-coming-back-to.deck.txt');
    expect(deckFileName('  ')).toBe('deck.deck.txt');
  });
});

describe('a list somebody typed', () => {
  it('loads with no ids at all, which is the whole point of the format being text', () => {
    const back = importText(SET, `2 ${subject().name}\n3 ${subject(1).name}\n9 Island\n`);
    if ('failed' in back) throw new Error(back.failed);
    expect(spellCount(back.build)).toBe(5);
    expect(back.build.basics).toEqual({ U: 9 });
    expect(back.resolved.byName).toEqual([subject().name, subject(1).name]);
    expect(resolutionNotes(back.resolved.renamed, back.resolved.byName)[0]).toContain('matched by name');
  });

  it('takes the variants every other client writes: 4x, stray spacing, comments, no name', () => {
    const back = importText(
      SET,
      ['# a list from somewhere else', '', `2x   ${subject().name}   `, `1 x ${subject(1).name}`].join('\n'),
    );
    if ('failed' in back) throw new Error(back.failed);
    expect(spellCount(back.build)).toBe(3);
    expect(back.resolved.deck.name).toBe('Imported deck');
  });

  it('sums two lines that name one card rather than letting the second win', () => {
    const back = importText(SET, `1 ${subject().name}\n2 ${subject().name}\n`);
    if ('failed' in back) throw new Error(back.failed);
    expect(spellCount(back.build)).toBe(3);
  });

  it('refuses a line it cannot read, and says which line and what a line looks like', () => {
    const parsed = parseDeckFile(`2 ${subject().name}\nSideboard\n`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('a section marker parsed as a deck');
    expect(parsed.message).toContain('Line 2');
    expect(parsed.message).toContain('Sideboard');
  });

  it('refuses a list of nothing rather than building an empty deck', () => {
    const parsed = parseDeckFile('# only a comment\n\n');
    expect(parsed.ok).toBe(false);
  });
});

describe('a list that meets a set it does not fit', () => {
  it('refuses the whole list and names the cards the staged set does not hold', () => {
    const back = importText(SET, `2 ${subject().name}\n1 nothing this set prints\n`);
    if (!('failed' in back)) throw new Error('a list naming an unknown card loaded');
    expect(back.failed).toContain('nothing this set prints');
    expect(back.failed).toContain('does not hold');
  });

  it('refuses a name two cards answer to, and says to write the id instead', () => {
    const twin: Card = { ...subject(2), name: subject().name };
    const back = importText([...SET, twin], `1 ${subject().name}\n`);
    if (!('failed' in back)) throw new Error('an ambiguous name loaded');
    expect(back.failed).toContain('More than one card');
    expect(back.failed).toContain('id in brackets');
  });

  it('lets the id outlive the name, and says the set calls the card something else now', () => {
    const renamedPool = SET.map((card) =>
      card.id === subject().id ? { ...card, name: 'a card under another name' } : card,
    );
    const back = importText(renamedPool, `2 ${subject().name} [${subject().id}]\n`);
    if ('failed' in back) throw new Error(back.failed);
    expect(spellCount(back.build)).toBe(2);
    expect(back.resolved.deck.entries[0]?.name).toBe('a card under another name');
    expect(resolutionNotes(back.resolved.renamed, back.resolved.byName)[0]).toContain(
      'a card under another name',
    );
  });
});

describe('handing the file to the browser', () => {
  it('reports that the browser was asked, never that a file arrived', () => {
    expect(saveTextFile('deck.txt', 'a list')).toBe(true);
  });

  it('reports false where there is no document at all, so the caller can say so', () => {
    const held = Reflect.getOwnPropertyDescriptor(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'document');
    try {
      expect(saveTextFile('deck.txt', 'a list')).toBe(false);
    } finally {
      if (held !== undefined) Reflect.defineProperty(globalThis, 'document', held);
    }
  });

  it('takes one file out of a picker, and nothing out of a canceled one', () => {
    const file = { name: 'a.deck.txt', text: (): Promise<string> => Promise.resolve('') };
    expect(pickedFile({ length: 1, 0: file })).toBe(file);
    expect(pickedFile({ length: 0 })).toBeNull();
    expect(pickedFile(null)).toBeNull();
    expect(pickedFile({ length: 1, 0: { name: 'a.txt' } })).toBeNull();
  });
});

/** Opens the Decks tab and presses Build, against whatever pool is passed. */
function openBuilder(pool: readonly Card[]): void {
  render(h(DeckRoute, { state: { status: 'absent' as const }, cards: pool }));
  fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
}

interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly textContent: string | null;
  readonly value?: string;
  readonly hasAttribute: (name: string) => boolean;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function factValue(label: string): string {
  const value = asElement(screen.getByText(label)).nextElementSibling;
  if (value === null) throw new Error(`toolbar fact ${label} has no value`);
  return value.textContent ?? '';
}

function decklistBox(): ElementLike {
  return asElement(screen.getByLabelText(DECK_TEXT_LABEL));
}

describe('the file panel on the screen', () => {
  it('shows the deck on screen as text without anybody pressing anything', () => {
    openBuilder(SET);
    fireEvent.change(screen.getByLabelText(DECK_NAME_LABEL), { target: { value: DECK_NAME } });
    fireEvent.change(screen.getByLabelText('Search the playable cards'), {
      target: { value: subject().name },
    });
    const pool = screen.getByRole('group', { name: 'Playable cards' });
    const face = within(pool).getAllByRole('button')[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');
    fireEvent.click(face);
    const text = decklistBox().value ?? '';
    expect(text).toContain(`Name: ${DECK_NAME}`);
    expect(text).toContain(`1 ${subject().name} [${subject().id}]`);
  });

  it('builds a pasted list here, and goes back to following the deck when told to', () => {
    openBuilder(SET);
    expect(factValue('spells').startsWith('0/')).toBe(true);
    fireEvent.change(decklistBox() as unknown as Element, {
      target: { value: `Name: ${DECK_NAME}\n2 ${subject().name}\n2 ${subject(1).name}\n` },
    });
    // Not a save: an imported list is on screen and is nobody's saved deck yet.
    expect(screen.getByRole('button', { name: RESET_TEXT_LABEL })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: LOAD_TEXT_LABEL }));
    expect(factValue('spells').startsWith('4/')).toBe(true);
    expect(readSavedDecks()).toEqual([]);
    expect(asElement(screen.getByLabelText(DECK_NAME_LABEL)).value).toBe(DECK_NAME);
    expect(screen.queryByRole('button', { name: RESET_TEXT_LABEL })).toBeNull();
  });

  it('says a download may have gone nowhere, because a page off the disk cannot tell', () => {
    openBuilder(SET);
    fireEvent.click(screen.getByRole('button', { name: SAVE_FILE_LABEL }));
    expect(screen.getByText(/if no file appeared, the box above is the whole deck/u)).toBeTruthy();
  });
});

describe('opening what is left of a deck the staged set outgrew', () => {
  const thinner = SET.filter((card) => card.id !== subject().id);

  it('says the two numbers, names what went, and leaves the saved deck whole', () => {
    const deck = sampleDeck();
    expect(writeSavedDecks([deck])).toBe(true);
    openBuilder(thinner);

    fireEvent.click(screen.getByRole('button', { name: `Open ${DECK_NAME}` }));
    expect(screen.getByText(new RegExp('no longer holds', 'u'))).toBeTruthy();
    expect(factValue('spells').startsWith('0/')).toBe(true);

    const repair = screen.getByRole('button', { name: partialLoadLabel(deck, deck.entries.slice(0, 1)) });
    expect(repair).toBeTruthy();
    fireEvent.click(repair);

    expect(factValue('spells').startsWith('3/')).toBe(true);
    const note = asElement(screen.getByText(new RegExp('Opened 3 of the 5 cards', 'u')));
    expect(note.textContent).toContain(subject().name);
    expect(note.textContent).toContain('is untouched');
    // The whole point: the store still holds all five.
    expect(readSavedDecks()[0]?.entries).toEqual(deck.entries);
  });

  it('leaves the fork unsaved, so Save changes cannot write 3 over the saved 5', () => {
    const deck = sampleDeck();
    writeSavedDecks([deck]);
    openBuilder(thinner);
    fireEvent.click(screen.getByRole('button', { name: `Open ${DECK_NAME}` }));
    fireEvent.click(screen.getByRole('button', { name: partialLoadLabel(deck, deck.entries.slice(0, 1)) }));
    expect(asElement(screen.getByRole('button', { name: 'Save changes' })).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('offers no repair for a refusal taking less cannot fix', () => {
    const deck = sampleDeck();
    // Five copies of one card: in the store, and refused by the builder at four.
    const overfull = { ...deck, entries: [{ ...deck.entries[0]!, count: 5 }] };
    const restored = restoreBuild(SET, overfull);
    expect(restored.ok).toBe(false);
    if (restored.ok) throw new Error('the builder accepted a fifth copy');
    expect(restored.missing).toEqual([]);
    expect(restored.message).toContain('cannot play');
  });

  it('exports the deck the builder just refused, whole, from the row', () => {
    const deck = sampleDeck();
    expect(writeSavedDecks([deck])).toBe(true);
    openBuilder(thinner);
    fireEvent.click(screen.getByRole('button', { name: `Open ${DECK_NAME}` }));
    // Refused: the staged set is missing a card this deck names.
    expect(factValue('spells').startsWith('0/')).toBe(true);

    // The download is an anchor carrying a data: URL, so the anchor is the
    // record of what left. Patched rather than mocked, and put back after.
    const asked: { name: string; text: string }[] = [];
    // `document` is not a type this package may name (no `lib: dom`), so it is
    // reached structurally here exactly as `browser-file.ts` reaches it.
    const host = globalThis as unknown as { readonly document: { createElement: (tag: string) => unknown } };
    const real = host.document.createElement.bind(host.document);
    host.document.createElement = (tag: string): unknown => {
      const made = real(tag);
      if (tag !== 'a') return made;
      const anchor = made as { download: string; href: string; click: () => void };
      anchor.click = (): void => {
        asked.push({ name: anchor.download, text: decodeURIComponent(anchor.href.split(',')[1] ?? '') });
      };
      return anchor;
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: `Save ${DECK_NAME} to a file` }));
    } finally {
      host.document.createElement = real;
    }

    expect(asked).toHaveLength(1);
    expect(asked[0]?.name).toBe(deckFileName(DECK_NAME));
    // Byte-exact against the stored deck, not against the build: all five, not the three that load.
    expect(asked[0]?.text).toBe(toDeckFile(deck));
    expect(screen.getByText(/if no file appeared, the box above is the whole deck/u)).toBeTruthy();
  });

  it('states the mode in the label and in the note, not in a number somebody counts', () => {
    const deck = sampleDeck();
    const omitted = deck.entries.slice(0, 1);
    expect(partialLoadLabel(deck, omitted)).toBe('Open the 3 cards that are left');
    expect(partialLoadNote(deck, omitted)).toContain('Opened 3 of the 5 cards');
    expect(partialLoadNote(deck, omitted)).toContain('needs a name of its own');
  });
});

describe('the panel is reached from the builder rather than bolted beside it', () => {
  it('draws the saved list and the file box on the same screen', () => {
    openBuilder(SET);
    expect(screen.getByText(SAVED_DECKS_TITLE)).toBeTruthy();
    expect(screen.getByLabelText(DECK_TEXT_LABEL)).toBeTruthy();
    expect(formatDeckFile('', [], null)).toContain('no mana base was counted out');
  });
});
