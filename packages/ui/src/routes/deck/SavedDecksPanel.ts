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
 * # The store is re-read on every write, and it is no longer only this browser
 *
 * Not written from the list this component is holding. Two tabs of the lab share
 * one store, and a write of a list read at mount would silently drop whatever
 * the other tab saved since. Read, change, write — which is what `./deck-keeping
 * .ts` does on this panel's behalf, one layer down, where it also writes the
 * deck to the machine's own deck library when `npm run play` started one. This
 * panel asks it to keep a deck and hears whether anything did; where the deck
 * ended up is a sentence under the list rather than a decision here.
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
 * # The bar is a disclosure, and what is outside it
 *
 * On a landscape phone this panel was a hundred pixels of a three-hundred-and-
 * ninety pixel viewport, and on arrival every control in it is disabled: nothing
 * is saved, the deck has no cards, and both save buttons are dark. So the
 * controls sit inside a `<details>` and the *summary* carries what a closed
 * panel still has to say — the title and whether this deck is saved, unsaved or
 * not saved yet.
 *
 * What can never be inside it: the refusal note, the message line, and the
 * repair button. Those appear because something happened, and a disclosure that
 * can hide a private window's refusal to store the deck is a disclosure that can
 * lose the only warning the person gets. They are drawn under the summary
 * whether it is open or shut.
 *
 * It starts open when there is a library to look at or a deck worth keeping,
 * which is `decks.length > 0 || cards > 0` read once at mount, and after that it
 * is the person's own. Nothing re-opens it behind them.
 *
 * **Except when the deck was handed to the builder rather than built in it**,
 * which `arrivedWithDeck` says. the playtester, 2026-09-01: "when I click play this
 * deck it just pops up the import/export save this deck view." A deck the
 * workbench hands over arrives with sixty cards in it, so `cards > 0` is true
 * the instant the builder mounts and the save controls open over the workspace
 * — pressing Play and being asked to name the deck. Neither half of the rule is
 * about that deck: the person did not build it here, and it is already kept, on
 * the deck server. The disclosure is still on the bar and one press away.
 *
 * # The file panel is a child rather than a sibling
 *
 * `./DeckFilePanel.ts` exports and imports a decklist as text, and it needs two
 * things this component owns: the name in the box, which is what an exported
 * list is called, and somewhere to hand an imported build. Composing it here
 * keeps both where they already live instead of lifting the name box into
 * `./ConstructedBuilder.ts` so two panels can share it.
 */
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
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
  savedEntries,
  toSavedDeck,
} from './saved-decks';
import type { RestoreOptions, SavedDeck, SavedDeckEntry } from './saved-decks';
import {
  KEPT_BY_BROWSER_NOTE,
  KEPT_BY_SERVER_NOTE,
  dropDeck,
  keepDeck,
  useDeckKeeping,
} from './deck-keeping';
import { deckSetOf } from './constructed-pool';
import type { DeckSetRef } from './library';
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

/**
 * The disclosure that holds the decklist text.
 *
 * The playtester's UI pass: "move import/export and raw decklist text behind More →
 * Import / Export". A textarea holding sixty lines was the tallest thing on a
 * deckbuilding screen and was wanted on the day somebody moves a deck between
 * machines, which is not most days. It is a press away and nothing about it
 * changed; what changed is that the screen no longer opens on it.
 */
export const DECK_FILE_TOGGLE_LABEL = 'Import / Export';

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

/** The same sentence for a lab whose machine is keeping the decks. */
export const EMPTY_LIST_SERVER_NOTE = 'Nothing saved yet on this machine.';

/**
 * What a link naming a deck this browser does not have says.
 *
 * A saved deck lives in one browser's `localStorage`, so a link to one is only
 * a link on the machine that saved it: sent to somebody else, or opened after
 * the deck was deleted, it names nothing. Saying so is the point — the
 * alternative is a builder that silently opens empty and looks like a deck that
 * lost its cards.
 */
export const NO_SUCH_DECK_NOTE =
  'That link names a deck this browser has not got. Saved decks live in the browser that saved them.';

/** The grammar of the two save buttons, stated once where somebody reads it. */
export const SAVE_EXPLAIN =
  'Save changes writes to the deck you have open, including a new name. Save as a new deck keeps both.';

/** Which saved deck is open, and what it held when it was last written. */
interface OpenDeck {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
}

/**
 * What a load did, which the link-open effect below reads and nothing else does.
 *
 * `'missing-cards'` is the one worth separating: it is the refusal that can stop
 * being true a moment later, because the pool this panel builds against is every
 * staged set's cards and those sets arrive over the network.
 */
type LoadOutcome = 'opened' | 'missing-cards' | 'refused';

/** A load that refused for naming cards the staged set no longer holds. */
interface Refusal {
  readonly deck: SavedDeck;
  readonly missing: readonly SavedDeckEntry[];
}

export interface SavedDecksPanelProps {
  readonly build: ConstructedBuild;
  /** Hands a reopened build back to whoever owns the builder's state. */
  readonly onLoad: (build: ConstructedBuild) => void;
  /**
   * A saved deck to open once, named by the link that arrived here.
   * `./open.ts` argues the link; this is the end of it.
   */
  readonly openDeckId?: string;
  /**
   * Which staged set each pool card came from, which is what a save reads to
   * record the set the deck was cut from.
   *
   * A map rather than one set (`mtg-6nqs`): the Constructed pool is the union of
   * every staged set, so a deck built here can be entirely somebody else's set
   * and writing the header's name into it would put a claim in the store that no
   * reader could check. `./saved-decks.ts` argues why the field is absent rather
   * than guessed when the page cannot name a set, and `deckSetOf` is where the
   * three ways of not being able to collapse into one answer.
   */
  readonly setOf?: ReadonlyMap<string, DeckSetRef>;
  /**
   * Opens with the decklist text already on screen, which is what *Import deck*
   * on the library above asks for: that button is a request to paste a list, and
   * a person who pressed it should not have to find the disclosure that holds
   * the box. Read once, on arrival, for the same reason `barOpen` is.
   */
  readonly openFiles?: boolean;
  /**
   * Whether the builder was opened *on* a deck rather than filled in it.
   *
   * Keeps the bar shut at mount. See the docblock: a handed-over deck makes
   * `cards > 0` true before the person has done anything, and the panel then
   * opens over the screen in answer to a press that meant "play this".
   */
  readonly arrivedWithDeck?: boolean;
  /**
   * Reports which saved deck is open, by name, so the page above can title
   * itself with it.
   *
   * `mtg-dcxg.7`, 2026-08-23: the route's `h1` read *Decks* over an open deck
   * and over an empty editor alike, so the one heading on a 390px screen named
   * the tab rather than the work. The name lives here — this panel owns which
   * deck is open, which one *Save changes* writes to, and the rename that
   * happens in its own text box — so it is reported upward rather than lifted
   * out, which would have put the name box in `./ConstructedBuilder.ts` for one
   * heading's sake.
   */
  readonly onOpenDeckChange?: (name: string | null) => void;
}

function openNote(open: OpenDeck | null, dirty: boolean): string {
  if (open === null) return NO_OPEN_DECK_NOTE;
  return `Editing “${open.name}” · ${dirty ? UNSAVED_NOTE : SAVED_NOTE}`;
}

export function SavedDecksPanel(props: SavedDecksPanelProps): ReactElement {
  const { build, onLoad } = props;
  const keeping = useDeckKeeping();
  const decks = keeping.decks;
  const [open, setOpen] = useState<OpenDeck | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** The deck a missing-card refusal is about, and what it could not find. */
  const [refused, setRefused] = useState<Refusal | null>(null);
  /** Whether the decklist text is on screen. Closed on arrival; see the label. */
  const [files, setFiles] = useState(props.openFiles === true);
  /**
   * Whether the save controls are on screen. Read once, from the state the
   * panel opened in: a library to browse or a deck worth naming. See the
   * docblock for why nothing reopens it later.
   */
  const [barOpen, setBarOpen] = useState(
    () => props.arrivedWithDeck !== true && (readSavedDecks().length > 0 || spellCount(build) > 0),
  );

  const trimmed = name.trim();
  const cards = spellCount(build);
  const dirty = open !== null && deckFingerprint(build) !== open.fingerprint;

  /** Hands a write to the store layer. False means nothing kept it at all. */
  const commit = useCallback((write: () => boolean): boolean => {
    if (!write()) {
      setMessage(SAVE_REFUSED_NOTE);
      return false;
    }
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
      const cut =
        props.setOf === undefined
          ? null
          : deckSetOf(
              props.setOf,
              savedEntries(build).map((entry) => entry.id),
            );
      const deck = toSavedDeck(
        id ?? newSavedDeckId(Date.now(), Math.random()),
        trimmed,
        build,
        new Date().toISOString(),
        cut ?? undefined,
        // Stated rather than left to the default, because this panel is the one
        // surface that knows: a deck assembled here was built card by card.
        'constructed',
      );
      if (!commit(() => keepDeck(deck))) return;
      setOpen({ id: deck.id, name: deck.name, fingerprint: deckFingerprint(build) });
    },
    [build, commit, props.setOf, trimmed],
  );

  /**
   * What a reopened deck resolves its basics against.
   *
   * Memoized because it is a dependency of `load`, and `load`'s identity is read
   * by the open-a-link effect below as the signal that another staged set has
   * landed; a fresh object every render would re-run that effect every render.
   */
  const setOf = props.setOf;
  const restoreOptions = useMemo<RestoreOptions>(() => (setOf === undefined ? {} : { setOf }), [setOf]);

  const load = useCallback(
    (deck: SavedDeck): LoadOutcome => {
      const restored = restoreBuild(build.pool, deck, restoreOptions);
      if (!restored.ok) {
        setMessage(restored.message);
        // Only a missing-card refusal has a repair; `restoreBuild` says so by
        // handing back an empty list for the one that has not.
        setRefused(restored.missing.length === 0 ? null : { deck, missing: restored.missing });
        return restored.missing.length === 0 ? 'refused' : 'missing-cards';
      }
      onLoad(restored.build);
      setOpen({ id: deck.id, name: deck.name, fingerprint: deckFingerprint(restored.build) });
      setName(deck.name);
      setMessage(null);
      setRefused(null);
      return 'opened';
    },
    [build.pool, onLoad, restoreOptions],
  );

  /**
   * Opens the deck a link named, once.
   *
   * In an effect rather than in a `useState` initializer because opening a deck
   * hands a whole build *up* to the builder's owner, which is a write to
   * somebody else's state and cannot happen while this component is rendering.
   * The latch is state rather than a ref so a second render cannot re-run it,
   * and it is set before the load either way: a link whose deck is missing has
   * been answered, and retrying it on every render would overwrite whatever the
   * person did next.
   */
  // Every route out of an open deck — a load, a save, a rename, a delete —
  // goes through `open`, so one effect on it is the whole report.
  const openName = open?.name ?? null;
  const report = props.onOpenDeckChange;
  useEffect(() => {
    report?.(openName);
  }, [openName, report]);

  const requested = props.openDeckId;
  const [requestAnswered, setRequestAnswered] = useState(requested === undefined);
  useEffect(() => {
    if (requestAnswered || requested === undefined) return;
    const asked = decks.find((deck) => deck.id === requested);
    if (asked === undefined) {
      setRequestAnswered(true);
      setMessage(NO_SUCH_DECK_NOTE);
      return;
    }
    // A missing-card refusal leaves the request outstanding rather than
    // answering it (`mtg-ti4v`). The Constructed pool is the union of every
    // staged set, and `LabApp` fetches those sets over the network, so the
    // first render this effect sees holds only the set the header names — a
    // link to a deck cut from any other one would refuse on ids that were about
    // to arrive, and the latch would make that refusal final. `load`'s identity
    // changes with the pool, so this re-attempts as each set lands and stops
    // the moment the deck opens. Every other outcome is final on the spot.
    if (load(asked) !== 'missing-cards') setRequestAnswered(true);
  }, [decks, load, requestAnswered, requested]);

  /**
   * Opens the part of a refused deck the staged set still holds.
   *
   * `open` is left null on purpose: the build on screen is a fork of the saved
   * deck rather than the saved deck, so *Save changes* stays unavailable and the
   * sixty cards in the store cannot be overwritten by the fifty-seven here.
   */
  const loadPartial = useCallback(
    (deck: SavedDeck): void => {
      setRequestAnswered(true);
      const restored = restoreBuild(build.pool, deck, { ...restoreOptions, mode: 'what-is-left' });
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
    [build.pool, onLoad, restoreOptions],
  );

  /** An imported list lands the same way a partial load does: on screen, unsaved. */
  const importList = useCallback(
    (imported: ConstructedBuild, importedName: string): void => {
      setRequestAnswered(true);
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
      if (!commit(() => dropDeck(deck.id))) return;
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
            // Pressing a deck answers an outstanding link, whatever it does:
            // the person is driving now, and a set landing later must not pull
            // the build out from under them.
            setRequestAnswered(true);
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

  // Every control that only matters once there is a deck to keep. The state
  // note stays in the summary above it, so a shut panel still says where the
  // deck on screen stands.
  const controls = createElement(
    'div',
    { className: 'mtg-savebar__row', role: 'group', 'aria-label': 'Save this deck' },
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
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-expanded': files,
        onClick: (): void => {
          setFiles(!files);
        },
      },
      DECK_FILE_TOGGLE_LABEL,
    ),
  );

  return createElement(
    'div',
    { className: 'mtg-savebar' },
    createElement(
      'details',
      {
        className: 'mtg-savebar__disclosure',
        open: barOpen,
        onToggle: (event: { readonly currentTarget: { readonly open: boolean } }): void => {
          setBarOpen(event.currentTarget.open);
        },
      },
      createElement(
        'summary',
        { className: 'mtg-savebar__summary' },
        createElement('span', { className: 'mtg-savebar__title' }, SAVED_DECKS_TITLE),
        createElement('span', { className: 'mtg-savebar__note' }, openNote(open, dirty)),
      ),
      // One box around everything the summary opens, rather than three siblings
      // of it. `mtg-i8xl`: inside the Constructed builder's toolbar this box is
      // what drops open over the workspace, and a popover cannot be assembled
      // out of three separately positioned elements. Below that toolbar it is an
      // ordinary column and changes nothing.
      createElement(
        'div',
        { className: 'mtg-savebar__body' },
        controls,
        decks.length === 0
          ? createElement(
              'p',
              { className: 'mtg-prompt__explain' },
              keeping.keeper.kind === 'server' ? EMPTY_LIST_SERVER_NOTE : EMPTY_LIST_NOTE,
            )
          : createElement(
              'div',
              { className: 'mtg-toolbar', role: 'group', 'aria-label': SAVED_DECKS_TITLE },
              ...decks.map(row),
            ),
        // Where the decks are, said once under the list. Ambient rather than a
        // warning, so it is the one line in this panel that may live inside the
        // disclosure: nothing is lost by a shut panel not saying it, and the two
        // sentences are long enough to crowd a phone that is not asking.
        createElement(
          'p',
          { className: 'mtg-prompt__explain' },
          keeping.keeper.kind === 'server' ? KEPT_BY_SERVER_NOTE : KEPT_BY_BROWSER_NOTE,
        ),
        files
          ? createElement(
              'div',
              { className: 'mtg-savebar__files' },
              createElement('p', { className: 'mtg-prompt__explain' }, SAVE_EXPLAIN),
              createElement(DeckFilePanel, { build, name: trimmed, onImport: importList }),
            )
          : null,
      ),
    ),
    message === null ? null : createElement('p', { className: 'mtg-saved-decks__note' }, message),
    // A deck library that refused a write says so where a shut panel cannot
    // hide it, for the reason the message line is out here: this is the only
    // warning that the machine has not got what this browser has.
    keeping.failure === null
      ? null
      : createElement(
          'p',
          { className: 'mtg-saved-decks__note' },
          `The deck library refused that write, so the deck is on this browser only: ${keeping.failure}`,
        ),
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
  );
}
