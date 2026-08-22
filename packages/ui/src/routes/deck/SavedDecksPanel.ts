/**
 * The deck library the builder writes to: name this deck, keep it, open it
 * again tomorrow.
 *
 * `./saved-decks.ts` holds the document, the store and the argument for both.
 * This is the surface, and it makes three decisions of its own.
 *
 * # Two save buttons rather than one
 *
 * Save, name, rename, list, load and delete are six verbs and this draws four
 * controls, because rename is not a control. *Save changes* writes the open deck
 * under whatever is in the name box, so renaming is editing the name and saving
 * — and *Save as a new deck* is the same gesture that keeps both, which is how
 * somebody forks a list they are half sure about. A single Save button would
 * have to guess between those two every time the name differs from the open
 * deck's, and the guess it gets wrong either overwrites a deck or leaves a
 * duplicate.
 *
 * A name another saved deck already uses is refused rather than allowed through.
 * The id is the key, so two decks called the same thing are storable; they are
 * just not usable, because every control that names one of them — open, delete —
 * would be ambiguous on screen.
 *
 * # The store is re-read on every write
 *
 * Not written from the list this component is holding. Two tabs of the lab share
 * one `localStorage`, and a write of a list read at mount would silently drop
 * whatever the other tab saved since. Read, change, write, and the render cache
 * takes what the write returned.
 *
 * # A refused write says so
 *
 * A page in a private window throws from `setItem`. The deck is *not* saved
 * then, so the panel says that instead of listing it: a list that shows a deck
 * the store does not hold is a promise the next reload breaks.
 *
 * # A refused *load* offers a repair, one press later
 *
 * `./saved-decks.ts` refuses a deck naming cards the staged set no longer holds,
 * and that refusal is the default and stays it. What this panel adds is the
 * thing the person wants next and could not reach: the refusal is followed by
 * one control, *Open the 57 cards that are left*, which is drawn only after they
 * have read which cards are gone and never otherwise. Pressing it opens the
 * survivors and says on screen what was left out; the saved deck is not
 * rewritten, so the sixty are still in the list for the day the right set is
 * staged. The build it hands back is deliberately *not* recorded as the open
 * deck, because *Save changes* would then overwrite the sixty with fifty-seven,
 * which is precisely the loss the refusal exists to prevent.
 *
 * # The file panel is a child rather than a sibling
 *
 * `./DeckFilePanel.ts` exports and imports a decklist as text, and it needs two
 * things this component owns: the name in the box, which is what an exported
 * list is called, and somewhere to hand an imported build. Composing it here
 * keeps both where they already live instead of lifting the name box into
 * `./ConstructedBuilder.ts` so two panels can share it.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import {
  deckFingerprint,
  nameTaken,
  newSavedDeckId,
  partialLoadLabel,
  partialLoadNote,
  readSavedDecks,
  restoreBuild,
  savedCardCount,
  toSavedDeck,
  withSaved,
  withoutSaved,
  writeSavedDecks,
} from './saved-decks';
import type { SavedDeck, SavedDeckEntry } from './saved-decks';
import { DeckFilePanel, DOWNLOAD_ASKED_NOTE, DOWNLOAD_REFUSED_NOTE } from './DeckFilePanel';
import { saveTextFile } from './browser-file';
import { deckFileName, toDeckFile } from './deck-file';
import { spellCount } from './build';
import type { ConstructedBuild } from './build';

export const SAVED_DECKS_TITLE = 'Saved decks';

/**
 * One word, because it sits between the deck's own name and Delete and the row
 * is already the longest thing in the panel. `DeckFilePanel`'s button says
 * "Save this to a file" and can afford to, since it stands alone under the text
 * box; here the row's `aria-label` carries the same sentence for a reader who
 * needs it.
 */
export const EXPORT_ROW_LABEL = 'Export';

/** The name box, labeled so a test — and a screen reader — can find it. */
export const DECK_NAME_LABEL = 'Deck name';

export const SAVE_NEW_LABEL = 'Save as a new deck';

export const SAVE_CHANGES_LABEL = 'Save changes';

/** The state of the deck on screen, said in the panel's own header. */
export const NO_OPEN_DECK_NOTE = 'Not saved yet';
export const UNSAVED_NOTE = 'unsaved changes';
export const SAVED_NOTE = 'saved';

export const SAVE_REFUSED_NOTE =
  'This browser refused to store the deck, which is what a private window does. The deck is still on screen and will not survive a reload.';

export const EMPTY_LIST_NOTE = 'Nothing saved yet on this browser.';

/** The grammar of the two save buttons, stated once where somebody reads it. */
export const SAVE_EXPLAIN =
  'Save changes writes to the deck you have open, including a new name. Save as a new deck keeps both.';

/** Which saved deck is open, and what it held when it was last written. */
interface OpenDeck {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
}

/** A load that refused for naming cards the staged set no longer holds. */
interface Refusal {
  readonly deck: SavedDeck;
  readonly missing: readonly SavedDeckEntry[];
}

export interface SavedDecksPanelProps {
  readonly build: ConstructedBuild;
  /** Hands a reopened build back to whoever owns the builder's state. */
  readonly onLoad: (build: ConstructedBuild) => void;
}

function openNote(open: OpenDeck | null, dirty: boolean): string {
  if (open === null) return NO_OPEN_DECK_NOTE;
  return `Editing “${open.name}” · ${dirty ? UNSAVED_NOTE : SAVED_NOTE}`;
}

export function SavedDecksPanel(props: SavedDecksPanelProps): ReactElement {
  const { build, onLoad } = props;
  const [decks, setDecks] = useState<readonly SavedDeck[]>(() => readSavedDecks());
  const [open, setOpen] = useState<OpenDeck | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** The deck a missing-card refusal is about, and what it could not find. */
  const [refused, setRefused] = useState<Refusal | null>(null);

  const trimmed = name.trim();
  const cards = spellCount(build);
  const dirty = open !== null && deckFingerprint(build) !== open.fingerprint;

  /** Read, change, write. Returns false when the browser kept nothing. */
  const commit = useCallback((change: (kept: readonly SavedDeck[]) => readonly SavedDeck[]): boolean => {
    const next = change(readSavedDecks());
    if (!writeSavedDecks(next)) {
      setMessage(SAVE_REFUSED_NOTE);
      return false;
    }
    setDecks(next);
    setMessage(null);
    return true;
  }, []);

  const save = useCallback(
    (id: string | null): void => {
      const kept = readSavedDecks();
      if (nameTaken(kept, trimmed, id)) {
        setMessage(`Another saved deck is already called “${trimmed}”. Choose a different name.`);
        return;
      }
      const deck = toSavedDeck(
        id ?? newSavedDeckId(Date.now(), Math.random()),
        trimmed,
        build,
        new Date().toISOString(),
      );
      if (!commit((current) => withSaved(current, deck))) return;
      setOpen({ id: deck.id, name: deck.name, fingerprint: deckFingerprint(build) });
    },
    [build, commit, trimmed],
  );

  const load = useCallback(
    (deck: SavedDeck): void => {
      const restored = restoreBuild(build.pool, deck);
      if (!restored.ok) {
        setMessage(restored.message);
        // Only a missing-card refusal has a repair; `restoreBuild` says so by
        // handing back an empty list for the one that has not.
        setRefused(restored.missing.length === 0 ? null : { deck, missing: restored.missing });
        return;
      }
      onLoad(restored.build);
      setOpen({ id: deck.id, name: deck.name, fingerprint: deckFingerprint(restored.build) });
      setName(deck.name);
      setMessage(null);
      setRefused(null);
    },
    [build.pool, onLoad],
  );

  /**
   * Opens the part of a refused deck the staged set still holds.
   *
   * `open` is left null on purpose: the build on screen is a fork of the saved
   * deck rather than the saved deck, so *Save changes* stays unavailable and the
   * sixty cards in the store cannot be overwritten by the fifty-seven here.
   */
  const loadPartial = useCallback(
    (deck: SavedDeck): void => {
      const restored = restoreBuild(build.pool, deck, 'what-is-left');
      if (!restored.ok) {
        setMessage(restored.message);
        return;
      }
      onLoad(restored.build);
      setOpen(null);
      setName(deck.name);
      setMessage(partialLoadNote(deck, restored.omitted));
      setRefused(null);
    },
    [build.pool, onLoad],
  );

  /** An imported list lands the same way a partial load does: on screen, unsaved. */
  const importList = useCallback(
    (imported: ConstructedBuild, importedName: string): void => {
      onLoad(imported);
      setOpen(null);
      setName(importedName);
      setMessage(null);
      setRefused(null);
    },
    [onLoad],
  );

  const remove = useCallback(
    (deck: SavedDeck): void => {
      if (!commit((current) => withoutSaved(current, deck.id))) return;
      // The build stays on screen. Deleting the deck it came from does not
      // empty the pane; it makes what is on screen unsaved, which is what it is.
      setOpen((current) => (current?.id === deck.id ? null : current));
      setRefused((current) => (current?.deck.id === deck.id ? null : current));
    },
    [commit],
  );

  /**
   * Writes one stored deck out as a decklist, without opening it.
   *
   * Per row rather than only off the open build, because the deck most worth
   * moving to another machine is the one this browser cannot open: a saved deck
   * naming cards the staged set no longer holds refuses to load, and an export
   * that ran off the current build could therefore never reach it. `toDeckFile`
   * reads the stored `SavedDeck` directly and needs no pool, so the refusal and
   * the export are independent — a list that will not build still writes out
   * byte-exact, ids and all.
   *
   * The message is `DeckFilePanel`'s, unchanged and imported rather than
   * reworded, because it is the same claim: the browser was *asked*. Saying it
   * twice in two voices would be two claims, and one of them would drift.
   */
  const exportOne = useCallback((deck: SavedDeck): void => {
    const asked = saveTextFile(deckFileName(deck.name), toDeckFile(deck));
    setMessage(asked ? DOWNLOAD_ASKED_NOTE : DOWNLOAD_REFUSED_NOTE);
  }, []);

  const row = (deck: SavedDeck): ReactElement =>
    createElement(
      'span',
      { key: deck.id, className: 'mtg-saved-deck' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'aria-label': `Open ${deck.name}`,
          'aria-pressed': open?.id === deck.id,
          onClick: (): void => {
            load(deck);
          },
        },
        `${deck.name} · ${String(savedCardCount(deck))} cards`,
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'aria-label': `Save ${deck.name} to a file`,
          onClick: (): void => {
            exportOne(deck);
          },
        },
        EXPORT_ROW_LABEL,
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'aria-label': `Delete ${deck.name}`,
          onClick: (): void => {
            remove(deck);
          },
        },
        'Delete',
      ),
    );

  return createElement(
    'div',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, SAVED_DECKS_TITLE),
      createElement('span', { className: 'mtg-panel__note' }, openNote(open, dirty)),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'div',
        { className: 'mtg-toolbar', role: 'group', 'aria-label': 'Save this deck' },
        createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-deck-name' }, DECK_NAME_LABEL),
        createElement('input', {
          id: 'mtg-deck-name',
          type: 'text',
          className: 'mtg-input',
          value: name,
          placeholder: 'what you call this deck',
          onChange: (event: { readonly target: { readonly value: string } }): void => {
            setName(event.target.value);
          },
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            'data-variant': 'primary',
            disabled: open === null || trimmed === '',
            onClick: (): void => {
              save(open === null ? null : open.id);
            },
          },
          SAVE_CHANGES_LABEL,
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            disabled: trimmed === '' || cards === 0,
            onClick: (): void => {
              save(null);
            },
          },
          SAVE_NEW_LABEL,
        ),
      ),
      createElement('p', { className: 'mtg-prompt__explain' }, SAVE_EXPLAIN),
      message === null ? null : createElement('p', { className: 'mtg-saved-decks__note' }, message),
      refused === null
        ? null
        : createElement(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              onClick: (): void => {
                loadPartial(refused.deck);
              },
            },
            partialLoadLabel(refused.deck, refused.missing),
          ),
      decks.length === 0
        ? createElement('p', { className: 'mtg-prompt__explain' }, EMPTY_LIST_NOTE)
        : createElement(
            'div',
            { className: 'mtg-toolbar', role: 'group', 'aria-label': SAVED_DECKS_TITLE },
            ...decks.map(row),
          ),
      createElement(DeckFilePanel, { build, name: trimmed, onImport: importList }),
    ),
  );
}
