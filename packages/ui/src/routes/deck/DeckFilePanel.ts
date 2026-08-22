/**
 * The route out of this browser: the deck as text, a file to save it to, and a
 * box to paste one back into.
 *
 * `./saved-decks.ts` keeps a deck for the next time this page is opened *here*.
 * This is the other half — the only way a deck reaches another browser, another
 * machine, or another person — and it makes three decisions.
 *
 * # The text is always on screen, and the file is laid over it
 *
 * `./browser-file.ts` explains what a page-initiated download can claim
 * (that the browser was asked) and why it may quietly do nothing: the built app
 * is a static page opened from `file://` as often as from a server, and a
 * download from that origin is one a browser is entitled to drop without a word.
 * So the box holding the whole deck is the route, and *Save this to a file* is a
 * convenience over it. Nothing is hidden behind the button, and the sentence
 * after a press says the download may not have happened rather than saying
 * "saved".
 *
 * # One box, both directions
 *
 * The same textarea shows the deck on screen and accepts a pasted one. Two boxes
 * would mean deciding which one an opened file lands in, and a person who has
 * just exported a list and wants to change a line before sending it would have
 * to move it across. Until somebody types, the box is a *derived* view of the
 * build — it follows the deck and the name box with no press — and the first
 * keystroke or the first opened file turns it into an edit that stays put. Press
 * *Show the deck on screen* to go back.
 *
 * # Loading hands the build up rather than opening it here
 *
 * A parsed list becomes a `SavedDeck` and goes through `restoreBuild`, which is
 * the same function the saved-deck list uses, so the copy limit, the basics and
 * the refusals are checked once for both routes. The panel does not write to the
 * store: importing a list puts it on screen under its name and leaves saving it
 * to the person, because a file somebody pasted to look at is not yet a deck
 * they have decided to keep.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { pickedFile, saveTextFile } from './browser-file';
import { deckFileName, formatDeckFile, parseDeckFile, resolutionNotes, resolveDeckFile } from './deck-file';
import { newSavedDeckId, restoreBuild, savedBasics, savedEntries } from './saved-decks';
import type { ConstructedBuild } from './build';

export const DECK_FILE_TITLE = 'Move this deck to another browser';

export const DECK_TEXT_LABEL = 'Deck as text';

export const SAVE_FILE_LABEL = 'Save this to a file';

export const OPEN_FILE_LABEL = 'Open a deck file';

export const LOAD_TEXT_LABEL = 'Load this list';

export const RESET_TEXT_LABEL = 'Show the deck on screen';

export const DECK_FILE_EXPLAIN =
  'The box holds the deck on screen as a decklist anyone can read. Copy it into a message, or save it to a file and open that file in another browser. Paste a list in and press Load this list to build it here.';

/**
 * Said after a press, and deliberately not the word "saved".
 *
 * `./browser-file.ts` has the argument: the click was dispatched and that is the
 * end of what this code can know. A page opened from the disk may have had the
 * download refused without an error, and the person needs to be told to look
 * rather than to trust.
 */
export const DOWNLOAD_ASKED_NOTE =
  'Asked the browser for a file. A browser can refuse a download from a page opened off the disk and say nothing about it, so if no file appeared, the box above is the whole deck: select it and copy it.';

export const DOWNLOAD_REFUSED_NOTE =
  'This browser offers no file downloads at all. The box above is the whole deck: select it and copy it.';

export interface DeckFilePanelProps {
  readonly build: ConstructedBuild;
  /** Whatever the name box holds, so an exported list carries the name on screen. */
  readonly name: string;
  /** Hands an imported list up as a build and the name it arrived under. */
  readonly onImport: (build: ConstructedBuild, name: string) => void;
}

export function DeckFilePanel(props: DeckFilePanelProps): ReactElement {
  const { build, name, onImport } = props;
  /** Null while the box is following the build; a string once somebody edited it. */
  const [edited, setEdited] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const shown = edited ?? formatDeckFile(name, savedEntries(build), savedBasics(build));

  const save = useCallback((): void => {
    setMessage(saveTextFile(deckFileName(name), shown) ? DOWNLOAD_ASKED_NOTE : DOWNLOAD_REFUSED_NOTE);
  }, [name, shown]);

  const open = useCallback((files: unknown): void => {
    const file = pickedFile(files);
    if (file === null) return;
    file.text().then(
      (text: string): void => {
        setEdited(text);
        setMessage(`Read “${file.name}”. Press ${LOAD_TEXT_LABEL} to build it here.`);
      },
      (): void => {
        setMessage(`This browser could not read “${file.name}”. Open it in a text editor and paste it in.`);
      },
    );
  }, []);

  const load = useCallback((): void => {
    const parsed = parseDeckFile(shown);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    const resolved = resolveDeckFile(
      build.pool,
      parsed.document,
      newSavedDeckId(Date.now(), Math.random()),
      new Date().toISOString(),
    );
    if (!resolved.ok) {
      setMessage(resolved.message);
      return;
    }
    const restored = restoreBuild(build.pool, resolved.deck);
    if (!restored.ok) {
      setMessage(restored.message);
      return;
    }
    onImport(restored.build, resolved.deck.name);
    setEdited(null);
    const notes = resolutionNotes(resolved.renamed, resolved.byName);
    setMessage([`Built “${resolved.deck.name}” from the list. It is not saved yet.`, ...notes].join(' '));
  }, [build.pool, onImport, shown]);

  return createElement(
    'div',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, DECK_FILE_TITLE),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement('p', { className: 'mtg-prompt__explain' }, DECK_FILE_EXPLAIN),
      createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-deck-text' }, DECK_TEXT_LABEL),
      createElement('textarea', {
        id: 'mtg-deck-text',
        className: 'mtg-decklist',
        rows: 12,
        spellCheck: false,
        value: shown,
        onChange: (event: { readonly target: { readonly value: string } }): void => {
          setEdited(event.target.value);
        },
        // Focusing selects the whole list, because the reason somebody puts a
        // cursor in a read-only-looking box of sixty lines is to copy all of it.
        onFocus: (event: { readonly target: { readonly select?: () => void } }): void => {
          event.target.select?.();
        },
      }),
      createElement(
        'div',
        { className: 'mtg-toolbar', role: 'group', 'aria-label': DECK_FILE_TITLE },
        createElement('button', { type: 'button', className: 'mtg-btn', onClick: save }, SAVE_FILE_LABEL),
        createElement(
          'button',
          { type: 'button', className: 'mtg-btn', 'data-variant': 'primary', onClick: load },
          LOAD_TEXT_LABEL,
        ),
        edited === null
          ? null
          : createElement(
              'button',
              {
                type: 'button',
                className: 'mtg-btn',
                onClick: (): void => {
                  setEdited(null);
                  setMessage(null);
                },
              },
              RESET_TEXT_LABEL,
            ),
        createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-deck-file' }, OPEN_FILE_LABEL),
        createElement('input', {
          id: 'mtg-deck-file',
          type: 'file',
          accept: '.txt,text/plain',
          className: 'mtg-input',
          onChange: (event: { readonly target: { readonly files?: unknown } }): void => {
            open(event.target.files);
          },
        }),
      ),
      message === null ? null : createElement('p', { className: 'mtg-saved-decks__note' }, message),
    ),
  );
}
