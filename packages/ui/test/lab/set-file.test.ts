/**
 * The one reader the tools under `tools/` use for a set on disk.
 *
 * `mtg-6jk9`. Nineteen of them had transcribed the same shape check, and the
 * transcriptions had drifted: `board-edge.ts` said `has no "cards" array` and
 * `board-text.ts` said `has no "cards" array, so it is not a set document` for
 * the same input, none of them accepted the bare array `serializeCards` writes,
 * and two named no file at all. So the three things worth asserting are the
 * three that differed.
 *
 * The path in the message is why this wraps `parseCardsDocumentJson` rather
 * than being it. `@mtg/dsl` is handed text and cannot know where the text came
 * from; a tool run from a shell against a file the caller named can, and a
 * message without it is the one that sends somebody looking through four
 * candidate set files by hand.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EXAMPLE_SET, serializeCards } from '@mtg/dsl';
import { cardsInDocument, readSetCards } from '../../tools/set-file';

const SET_DOCUMENT = JSON.stringify({
  formatVersion: 1,
  set: { code: 'TST', name: 'Test Set' },
  cards: EXAMPLE_SET,
});

describe('the two spellings a set file comes in', () => {
  it('reads the set document setgen writes', () => {
    expect(cardsInDocument(SET_DOCUMENT, 'set.json').map((card) => card.id)).toStrictEqual(
      EXAMPLE_SET.map((card) => card.id),
    );
  });

  it('reads the bare array serializeCards writes, which no tool used to accept', () => {
    expect(cardsInDocument(serializeCards([...EXAMPLE_SET]), 'cards.json')).toHaveLength(EXAMPLE_SET.length);
  });
});

describe('what it says when the file is not one', () => {
  it.each([
    ['{"set":{"code":"TST"}}', 'a document with no cards field'],
    ['{"cards":3}', 'a cards field that is not an array'],
    ['not json at all', 'text that is not JSON'],
  ])('names the file for %s', (text) => {
    expect(() => cardsInDocument(text, 'out/XMP/set.json')).toThrow(/^out\/XMP\/set\.json: /);
  });

  it('names the file when the file is not there', () => {
    expect(() => readSetCards('/nonexistent/absent-set.json')).toThrow(/^\/nonexistent\/absent-set\.json: /);
  });

  it('says which of the two shapes it could not find, not just that something failed', () => {
    expect(() => cardsInDocument('{"set":{"code":"TST"}}', 'set.json')).toThrow(
      /a set document with a "cards" array/,
    );
  });
});

describe('a file on disk', () => {
  it('reads through to the same cards', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'set-file-')), 'set.json');
    writeFileSync(path, SET_DOCUMENT, 'utf8');

    expect(readSetCards(path)).toHaveLength(EXAMPLE_SET.length);
  });
});
