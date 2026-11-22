// @vitest-environment jsdom
/**
 * Editing a built deck inside its own artifact, and the two halves that has to
 * keep apart: the numbers an edit moves, and the evidence it cannot move.
 *
 * `mtg-ipse`. The decision the bead records is that a built deck edits within
 * the document it was written as, with no pool behind it, because cutting a
 * card, changing a count and putting a cut card back are arithmetic over fields
 * `packages/decklab/fixtures/decks/boros-aggro.deck.json` already carries. So
 * the first thing asserted here is that the arithmetic *is* the artifact's own:
 * recomputed over an unedited deck it reproduces `totalCards`, `priceUsd` and
 * the whole curve to the digit. A recomputation that disagreed with the built
 * document on the built deck would print two different numbers for one deck and
 * nobody could tell which was wrong.
 *
 * The second half is the frozen evidence. The prompt, the criteria, each card's
 * reason and the castability bands are the record of a build, and a moved count
 * stops them being claims about what is on screen; they stay, labeled as the
 * built version's, rather than being recomputed into a document nobody built.
 *
 * The subject is the committed artifact and no card name is written down: every
 * entry is picked out of it by position, so this file says nothing about which
 * printings the fixture holds.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CONSTRUCTED_COPY_LIMIT, CURVE_BUCKETS } from '@mtg/deckbuild';
import type { CurveBucket } from '@mtg/deckbuild';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import {
  BUILT_DECK,
  copyCeiling,
  cutEntries,
  deckFacts,
  editedEntries,
  entryCount,
  isEdited,
  withEntryCount,
} from '../../src/routes/deck/artifact-edit';
import {
  ADD_CARD_LABEL,
  ADD_CARD_REASON,
  BUILT_EVIDENCE_NOTE,
  DECK_FACTS_LABEL,
} from '../../src/routes/deck/DeckFacts';
import {
  ADD_COPY_LABEL,
  CUT_COPY_LABEL,
  DECK_DETAILS_LABEL,
  OpenDeck,
  RESTORE_BUILT_LABEL,
  addEntryLabel,
  cutEntryLabel,
  putBackLabel,
} from '../../src/routes/deck/OpenDeckScreen';
import { MAIN_DECK_LABEL } from '../../src/routes/deck/pane-names';

afterEach(cleanup);

/** Both panes keep their density here, so one test must not set the next one's. */
afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
});

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedDeck(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(FIXTURE, 'utf8')), FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const DECK = committedDeck();

function first<T>(list: readonly T[], what: string): T {
  const found = list[0];
  if (found === undefined) throw new Error(`the fixture has no ${what}`);
  return found;
}

/** A four-of spell: the entry every count assertion below moves. */
const SPELL = first(DECK.spells, 'spells');
/** The basic land, which is the one entry no copy limit applies to. */
const BASIC = first(DECK.basics, 'basics');

const MAIN: readonly DeckArtifactEntry[] = [...DECK.spells, ...DECK.lands, ...DECK.basics];

describe('the numbers an edit moves', () => {
  it('reproduces the built document exactly when nothing has been edited', () => {
    const facts = deckFacts(DECK, BUILT_DECK);
    expect(facts.cards).toBe(DECK.totalCards);
    expect(facts.priceUsd).toBeCloseTo(DECK.priceUsd, 10);
    expect(facts.averageManaValue).toBeCloseTo(DECK.curve.averageManaValue, 10);
    for (const bucket of CURVE_BUCKETS) {
      expect(facts.histogram[bucket], `bucket ${String(bucket)}`).toBe(DECK.curve.histogram[bucket]);
    }
  });

  it('moves the count, the price and the curve together when copies are cut', () => {
    const edit = withEntryCount(BUILT_DECK, SPELL, SPELL.count - 2);
    const facts = deckFacts(DECK, edit);
    expect(facts.cards).toBe(DECK.totalCards - 2);
    expect(facts.priceUsd).toBeCloseTo(DECK.priceUsd - 2 * (SPELL.priceUsd ?? 0), 10);
    // The bucket rule restated rather than imported: `curveBucket` is what the
    // code under test calls, so calling it here would make the two agree by
    // construction. Six is the top bucket and everything above it lands there.
    const bucket = Math.min(Math.floor(SPELL.manaValue), 6) as CurveBucket;
    expect(facts.histogram[bucket]).toBe((DECK.curve.histogram[bucket] ?? 0) - 2);
    expect(facts.averageManaValue).not.toBeCloseTo(DECK.curve.averageManaValue, 10);
  });

  it('counts a card under every color of its identity', () => {
    const facts = deckFacts(DECK, BUILT_DECK);
    for (const color of ['W', 'R'] as const) {
      const expected = MAIN.filter((entry) => entry.colorIdentity.includes(color)).reduce(
        (sum, entry) => sum + entry.count,
        0,
      );
      const found = facts.colors.find((spread) => spread.color === color);
      expect(found?.cards, `${color} cards`).toBe(expected);
    }
  });

  it('caps a nonbasic at the constructed limit and caps no basic at all', () => {
    expect(copyCeiling(SPELL)).toBe(CONSTRUCTED_COPY_LIMIT);
    expect(copyCeiling(BASIC)).toBeNull();
    const capped = withEntryCount(BUILT_DECK, SPELL, CONSTRUCTED_COPY_LIMIT + 3);
    expect(entryCount(capped, SPELL)).toBe(CONSTRUCTED_COPY_LIMIT);
    const raised = withEntryCount(BUILT_DECK, BASIC, BASIC.count + 3);
    expect(entryCount(raised, BASIC)).toBe(BASIC.count + 3);
  });

  it('drops a wholly cut card out of the pane and into what can be put back', () => {
    const edit = withEntryCount(BUILT_DECK, SPELL, 0);
    expect(isEdited(edit)).toBe(true);
    expect(editedEntries(MAIN, edit).map((entry) => entry.name)).not.toContain(SPELL.name);
    expect(cutEntries(MAIN, edit).map((entry) => entry.name)).toEqual([SPELL.name]);
    expect(isEdited(withEntryCount(edit, SPELL, SPELL.count))).toBe(false);
  });
});

/**
 * The workspace tsconfig has no `lib: dom` (`../../src/mount.ts` records why),
 * so a rendered node is read through the structural interface every other test
 * in this directory reaches it through rather than through `HTMLElement`.
 */
interface ElementLike {
  readonly hasAttribute: (name: string) => boolean;
  readonly textContent: string | null;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function openDeck(): void {
  render(h(OpenDeck, { deck: DECK, onBack: () => undefined }));
}

/**
 * The deck open on the density a copy can be picked at.
 *
 * The pane opens on whole cards since 2026-09-17 (`../../src/routes/deck/DeckPane.ts`'s
 * `PANE_CARD_VIEWS`), and this screen's full density is tiles rather than strips
 * -- a printed tile carries a paragraph of its reason, which cannot be the
 * content of a button, so a copy is picked in compact and always was. Every case
 * that cuts or restores a copy therefore presses the control first, which is
 * what a reader does.
 */
function openForEditing(): void {
  openDeck();
  fireEvent.click(screen.getByRole('button', { name: 'Compact list' }));
}

/** The pane's heading, which is where the deck's own count is printed. */
function paneHeading(): string {
  const pane = screen.getByRole('region', { name: MAIN_DECK_LABEL });
  return asElement(within(pane).getByRole('heading', { level: 2 })).textContent ?? '';
}

function factsLine(): string {
  return asElement(screen.getByRole('group', { name: DECK_FACTS_LABEL })).textContent ?? '';
}

/** True when a control is on screen and refusing to be pressed. */
function isDisabled(name: string): boolean {
  return asElement(screen.getByRole('button', { name })).hasAttribute('disabled');
}

/**
 * Selects one copy of an entry, which is the strip a cut then acts on.
 *
 * The name is `stripLabel`'s, restated rather than imported, because what this
 * file is asserting is that a reader can reach a copy by the name they hear:
 * calling the same function the screen calls would make the two agree by
 * construction and prove nothing. Its one branch is the same one -- a card with
 * a single copy left is spoken as its name alone, with no "copy 1 of 1" to say.
 */
function selectCopy(entry: DeckArtifactEntry, copy: number, of: number): void {
  const name = of === 1 ? entry.name : `${entry.name}, copy ${String(copy)} of ${String(of)}`;
  fireEvent.click(screen.getByRole('button', { name }));
}

function press(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('editing a built deck on screen', () => {
  it('opens on the built numbers, with adding a card offered and refused in words', () => {
    openDeck();
    expect(paneHeading()).toContain(String(DECK.totalCards));
    expect(factsLine()).toContain(`${String(DECK.totalCards)} cards`);
    expect(factsLine()).toContain(DECK.priceUsd.toFixed(2));
    expect(isDisabled(ADD_CARD_LABEL)).toBe(true);
    expect(screen.getByText(ADD_CARD_REASON)).toBeTruthy();
    expect(screen.queryByRole('button', { name: RESTORE_BUILT_LABEL })).toBeNull();
  });

  it('cuts a copy off the selected card and recounts the pane and the line', () => {
    openForEditing();
    selectCopy(SPELL, SPELL.count, SPELL.count);
    press(cutEntryLabel(SPELL.name));
    expect(paneHeading()).toContain(String(DECK.totalCards - 1));
    expect(factsLine()).toContain(`${String(DECK.totalCards - 1)} cards`);
    expect(factsLine()).toContain((DECK.priceUsd - (SPELL.priceUsd ?? 0)).toFixed(2));
  });

  it('refuses a fifth copy of a card the format allows four of', () => {
    openForEditing();
    selectCopy(SPELL, SPELL.count, SPELL.count);
    expect(isDisabled(addEntryLabel(SPELL.name))).toBe(true);
    expect(isDisabled(cutEntryLabel(SPELL.name))).toBe(false);
  });

  it('puts a wholly cut card back at the count the build chose', () => {
    openForEditing();
    for (let copy = SPELL.count; copy >= 1; copy -= 1) {
      selectCopy(SPELL, copy, copy);
      press(cutEntryLabel(SPELL.name));
    }
    expect(paneHeading()).toContain(String(DECK.totalCards - SPELL.count));
    press(putBackLabel(SPELL.name));
    expect(paneHeading()).toContain(String(DECK.totalCards));
    expect(screen.queryByRole('button', { name: putBackLabel(SPELL.name) })).toBeNull();
  });

  it("says the plan, the criteria and the bands are the built deck's once a count moves", () => {
    openForEditing();
    press(DECK_DETAILS_LABEL);
    expect(screen.queryByText(BUILT_EVIDENCE_NOTE)).toBeNull();
    selectCopy(SPELL, SPELL.count, SPELL.count);
    press(cutEntryLabel(SPELL.name));
    expect(screen.getByText(BUILT_EVIDENCE_NOTE)).toBeTruthy();
  });

  it('restores every count the build chose', () => {
    openForEditing();
    selectCopy(SPELL, SPELL.count, SPELL.count);
    press(cutEntryLabel(SPELL.name));
    press(RESTORE_BUILT_LABEL);
    expect(paneHeading()).toContain(String(DECK.totalCards));
    expect(screen.queryByRole('button', { name: RESTORE_BUILT_LABEL })).toBeNull();
  });
});

/** The two labels the selection bar prints, kept out of the assertions above. */
describe('the selection bar names its moves twice', () => {
  it('prints one thing and says another, so a screen reader hears the card', () => {
    expect(CUT_COPY_LABEL).not.toContain(SPELL.name);
    expect(ADD_COPY_LABEL).not.toContain(SPELL.name);
    expect(cutEntryLabel(SPELL.name)).toContain(SPELL.name);
    expect(addEntryLabel(SPELL.name)).toContain(SPELL.name);
  });
});
